import { Router } from "express";
import { z } from "zod";
import crypto from "crypto";
import { prisma } from "../db";
import { requiereAuth, requiereOrganizadorAprobado } from "../middleware/auth";
import { asyncHandler, HttpError } from "../middleware/errorHandler";
import { generarLinkToken } from "../utils/tokens";
import { generarSerieDeterministica } from "../utils/bingoGenerator";
import { ejecutarSorteoAuditable, CandidatoSorteo } from "../utils/sorteoEngine";
import { emitirCambio } from "../realtime";
import { estadoEnVivo, modificarTablero } from "../utils/estadoEnVivo";

export const sorteosRouter = Router();

sorteosRouter.use(requiereAuth, requiereOrganizadorAprobado);

const configRifaSchema = z.object({
  cantidadNumeros: z.number().int().min(2).max(10000),
  precio: z.number().nonnegative().optional(),
  cantidadGanadores: z.number().int().min(1).default(1),
});

const configBingoSchema = z.object({
  cartonesPorSerie: z.number().int().min(3).max(6),
  cantidadSeries: z.number().int().min(1).max(5000),
});

const configSimpleSchema = z.object({
  cantidadGanadores: z.number().int().min(1).default(1),
});

const crearSorteoSchema = z.object({
  tipo: z.enum(["RIFA", "BINGO", "SORTEO_SIMPLE"]),
  titulo: z.string().trim().min(3),
  descripcion: z.string().trim().optional(),
  fechaCierre: z.string().datetime().optional(),
  config: z.record(z.any()),
});

function validarConfigPorTipo(tipo: string, config: unknown) {
  if (tipo === "RIFA") return configRifaSchema.parse(config);
  if (tipo === "BINGO") return configBingoSchema.parse(config);
  return configSimpleSchema.parse(config);
}

// ---- crear (borrador) ----
sorteosRouter.post(
  "/",
  asyncHandler(async (req, res) => {
    const datos = crearSorteoSchema.parse(req.body);
    const config = validarConfigPorTipo(datos.tipo, datos.config);

    const normalizar = (texto: string | null | undefined) => (texto || "").trim().replace(/\s+/g, " ").toLocaleLowerCase("es");
    const fechaCierre = datos.fechaCierre ? new Date(datos.fechaCierre) : null;
    const resultado = await prisma.$transaction(async tx => {
      // Serializa creaciones del mismo organizador incluso desde distintas pestañas/procesos.
      await tx.$queryRaw`SELECT id FROM usuarios WHERE id = ${req.usuario!.sub} FOR UPDATE`;
      const candidatos = await tx.sorteo.findMany({where: {organizadorId: req.usuario!.sub, tipo: datos.tipo}});
      const existente = candidatos.find(s => {
        if (normalizar(s.titulo) !== normalizar(datos.titulo) || normalizar(s.descripcion) !== normalizar(datos.descripcion) ||
            s.fechaCierre?.getTime() !== fechaCierre?.getTime()) return false;
        try { return JSON.stringify(validarConfigPorTipo(s.tipo, s.config)) === JSON.stringify(config); }
        catch { return false; }
      });
      if (existente) return {sorteo: existente, creado: false};
      const sorteo = await tx.sorteo.create({data: {
        organizadorId: req.usuario!.sub, tipo: datos.tipo, titulo: datos.titulo,
        descripcion: datos.descripcion, fechaCierre, config, estado: "BORRADOR",
      }});
      return {sorteo, creado: true};
    });
    res.status(resultado.creado ? 201 : 200).json(resultado.sorteo);
  })
);

// ---- listar los propios ----
sorteosRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const sorteos = await prisma.sorteo.findMany({
      where: { organizadorId: req.usuario!.sub },
      orderBy: { creadoEn: "desc" },
    });
    res.json(sorteos);
  })
);

async function obtenerSorteoPropio(sorteoId: string, organizadorId: string) {
  const sorteo = await prisma.sorteo.findUnique({ where: { id: sorteoId } });
  if (!sorteo) throw new HttpError(404, "Sorteo no encontrado");
  if (sorteo.organizadorId !== organizadorId) throw new HttpError(403, "Ese sorteo no es tuyo");
  return sorteo;
}

// Elimina el sorteo y sus datos asociados de forma atómica, conservando los titulares.
sorteosRouter.delete("/:id", asyncHandler(async (req, res) => {
  await prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM sorteos WHERE id = ${req.params.id} FOR UPDATE`;
    const sorteo = await tx.sorteo.findUnique({ where: { id: req.params.id } });
    if (!sorteo) throw new HttpError(404, "Sorteo no encontrado");
    if (sorteo.organizadorId !== req.usuario!.sub) throw new HttpError(403, "Ese sorteo no es tuyo");
    await tx.$queryRaw`SELECT id FROM eventos_en_vivo WHERE "sorteoBingoId" = ${sorteo.id} ORDER BY id FOR UPDATE`;
    await tx.estadoCartonesEnVivo.deleteMany({ where: { OR: [
      { evento: { sorteoBingoId: sorteo.id } }, { serie: { sorteoId: sorteo.id } },
    ] } });
    await tx.eventoEnVivo.deleteMany({ where: { sorteoBingoId: sorteo.id } });
    await tx.carton.deleteMany({ where: { serie: { sorteoId: sorteo.id } } });
    await tx.serie.deleteMany({ where: { sorteoId: sorteo.id } });
    await tx.numero.deleteMany({ where: { sorteoId: sorteo.id } });
    await tx.inscripcion.deleteMany({ where: { sorteoId: sorteo.id } });
    await tx.resultadoSorteo.deleteMany({ where: { sorteoId: sorteo.id } });
    await tx.tableroEnVivo.deleteMany({ where: { sorteoId: sorteo.id } });
    await tx.sorteo.delete({ where: { id: sorteo.id } });
  });
  res.json({ mensaje: "Sorteo eliminado" });
}));

// Tablero privado del organizador: muestra quién reservó cada número.
sorteosRouter.get(
  "/:id/numeros",
  asyncHandler(async (req, res) => {
    const sorteo = await obtenerSorteoPropio(req.params.id, req.usuario!.sub);
    if (sorteo.tipo !== "RIFA") throw new HttpError(400, "Este sorteo no es una rifa");
    const tablero = await prisma.numero.findMany({
      where: { sorteoId: sorteo.id },
      orderBy: { valor: "asc" },
      select: {
        valor: true,
        estado: true,
        participante: { select: { nombre: true, contacto: true, telefono: true, dni: true } },
      },
    });
    res.json({
      tipo: sorteo.tipo,
      titulo: sorteo.titulo,
      descripcion: sorteo.descripcion,
      estado: sorteo.estado,
      tablero,
    });
  })
);

const cambiarEstadoNumeroSchema = z.object({ estado: z.enum(["LIBRE", "TOMADO"]) });

// Solo pasa por obtenerSorteoPropio: un organizador nunca puede modificar sorteos ajenos.
sorteosRouter.patch(
  "/:id/numeros/:valor",
  asyncHandler(async (req, res) => {
    const sorteo = await obtenerSorteoPropio(req.params.id, req.usuario!.sub);
    if (sorteo.tipo !== "RIFA") throw new HttpError(400, "Este sorteo no es una rifa");
    if (sorteo.estado !== "ACTIVO") throw new HttpError(409, "El sorteo no está activo");
    const { estado } = cambiarEstadoNumeroSchema.parse(req.body);
    const numero = await prisma.numero.findUnique({
      where: { sorteoId_valor: { sorteoId: sorteo.id, valor: Number(req.params.valor) } },
    });
    if (!numero) throw new HttpError(404, "Número no encontrado");
    if (estado === "TOMADO" && numero.estado !== "RESERVADO") {
      throw new HttpError(409, "Solo se puede confirmar un número pendiente de pago");
    }

    const actualizado = await prisma.numero.update({
      where: { id: numero.id },
      data: estado === "LIBRE"
        ? { estado, participanteId: null, codigoHash: null, reservadoHasta: null }
        : { estado, codigoHash: null, reservadoHasta: null },
    });
    if (sorteo.linkToken) emitirCambio(sorteo.linkToken, { tipo: "numero", valor: numero.valor, estado });
    res.json(actualizado);
  })
);

sorteosRouter.get("/:id/series", asyncHandler(async (req, res) => {
  const sorteo = await obtenerSorteoPropio(req.params.id, req.usuario!.sub);
  if (sorteo.tipo !== "BINGO") throw new HttpError(400, "Este sorteo no es un bingo");
  const tablero = await prisma.serie.findMany({ where: { sorteoId: sorteo.id }, orderBy: { numero: "asc" },
    select: { numero: true, cantidadCartones: true, estado: true, participante: { select: { nombre: true, telefono: true, dni: true } } } });
  res.json({ tipo: sorteo.tipo, titulo: sorteo.titulo, descripcion: sorteo.descripcion, estado: sorteo.estado, tablero });
}));

sorteosRouter.patch("/:id/series/:numero", asyncHandler(async (req, res) => {
  const sorteo = await obtenerSorteoPropio(req.params.id, req.usuario!.sub);
  if (sorteo.tipo !== "BINGO") throw new HttpError(400, "Este sorteo no es un bingo");
  if (sorteo.estado !== "ACTIVO") throw new HttpError(409, "El sorteo no está activo");
  const { estado } = cambiarEstadoNumeroSchema.parse(req.body);
  const serie = await prisma.serie.findUnique({ where: { sorteoId_numero: { sorteoId: sorteo.id, numero: Number(req.params.numero) } } });
  if (!serie) throw new HttpError(404, "Serie no encontrada");
  if (estado === "TOMADO" && serie.estado !== "RESERVADO") throw new HttpError(409, "Solo se puede confirmar una serie pendiente");
  const actualizado = await prisma.serie.update({ where: { id: serie.id }, data: estado === "LIBRE"
    ? { estado, participanteId: null, codigoHash: null, reservadoHasta: null }
    : { estado, codigoHash: null, reservadoHasta: null } });
  if (sorteo.linkToken) emitirCambio(sorteo.linkToken, { tipo: "serie", numero: serie.numero, estado });
  res.json(actualizado);
}));

sorteosRouter.get("/:id/inscripciones", asyncHandler(async (req, res) => {
  const sorteo = await obtenerSorteoPropio(req.params.id, req.usuario!.sub);
  if (sorteo.tipo !== "SORTEO_SIMPLE") throw new HttpError(400, "Este no es un sorteo simple");
  const inscripciones = await prisma.inscripcion.findMany({ where: { sorteoId: sorteo.id }, orderBy: { creadoEn: "asc" },
    include: { participante: { select: { nombre: true, telefono: true, dni: true } } } });
  res.json({ tipo: sorteo.tipo, titulo: sorteo.titulo, descripcion: sorteo.descripcion, estado: sorteo.estado,
    inscripciones: inscripciones.map(i => ({ id: i.id, estado: i.verificado ? "TOMADO" : "RESERVADO", participante: i.participante })) });
}));

sorteosRouter.patch("/:id/inscripciones/:inscripcionId", asyncHandler(async (req, res) => {
  const sorteo = await obtenerSorteoPropio(req.params.id, req.usuario!.sub);
  if (sorteo.tipo !== "SORTEO_SIMPLE") throw new HttpError(400, "Este no es un sorteo simple");
  if (sorteo.estado !== "ACTIVO") throw new HttpError(409, "El sorteo no está activo");
  const { estado } = cambiarEstadoNumeroSchema.parse(req.body);
  const inscripcion = await prisma.inscripcion.findUnique({ where: { id: req.params.inscripcionId } });
  if (!inscripcion || inscripcion.sorteoId !== sorteo.id) throw new HttpError(404, "Inscripción no encontrada");
  if (estado === "LIBRE") await prisma.inscripcion.delete({ where: { id: inscripcion.id } });
  else await prisma.inscripcion.update({ where: { id: inscripcion.id }, data: { verificado: true, codigoHash: null } });
  res.json({ estado });
}));

// ---- editar config (solo mientras está en borrador) ----
sorteosRouter.patch(
  "/:id",
  asyncHandler(async (req, res) => {
    const sorteo = await obtenerSorteoPropio(req.params.id, req.usuario!.sub);
    if (sorteo.estado !== "BORRADOR") throw new HttpError(409, "Solo se puede editar un sorteo en borrador");

    const datos = crearSorteoSchema.partial().parse(req.body);
    const config = datos.config ? validarConfigPorTipo(datos.tipo ?? sorteo.tipo, datos.config) : undefined;

    const actualizado = await prisma.sorteo.update({
      where: { id: sorteo.id },
      data: {
        titulo: datos.titulo,
        descripcion: datos.descripcion,
        fechaCierre: datos.fechaCierre ? new Date(datos.fechaCierre) : undefined,
        ...(config ? { config } : {}),
      },
    });
    res.json(actualizado);
  })
);

// ---- publicar: acá se generan los números o las series ----
sorteosRouter.post(
  "/:id/publicar",
  asyncHandler(async (req, res) => {
    const actualizado = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM sorteos WHERE id = ${req.params.id} FOR UPDATE`;
      const sorteo = await tx.sorteo.findUnique({where: {id: req.params.id}});
      if (!sorteo) throw new HttpError(404, "Sorteo no encontrado");
      if (sorteo.organizadorId !== req.usuario!.sub) throw new HttpError(403, "Ese sorteo no es tuyo");
      if (sorteo.linkToken) return sorteo;
      if (sorteo.estado !== "BORRADOR") throw new HttpError(409, "El sorteo no se puede publicar");
      const linkToken = generarLinkToken(sorteo.titulo);
      const config = sorteo.config as Record<string, number>;
      await tx.sorteo.update({
        where: { id: sorteo.id },
        data: { estado: "ACTIVO", linkToken },
      });

      if (sorteo.tipo === "RIFA") {
        const cantidad = config.cantidadNumeros;
        await tx.numero.createMany({
          data: Array.from({ length: cantidad }, (_, i) => ({
            sorteoId: sorteo.id,
            valor: i + 1,
            estado: "LIBRE" as const,
          })),
        });
      }

      if (sorteo.tipo === "BINGO") {
        const { cartonesPorSerie, cantidadSeries } = config;
        for (let numSerie = 1; numSerie <= cantidadSeries; numSerie++) {
          const serie = await tx.serie.create({
            data: {
              sorteoId: sorteo.id,
              numero: numSerie,
              cantidadCartones: cartonesPorSerie,
              estado: "LIBRE",
            },
          });
          const cartones = generarSerieDeterministica(sorteo.id, numSerie, cartonesPorSerie);
          await tx.carton.createMany({
            data: cartones.map((grilla, idx) => ({
              serieId: serie.id,
              posicion: idx + 1,
              contenido: grilla,
            })),
          });
        }
      }
      // SORTEO_SIMPLE no necesita generar nada: la gente se inscribe directo.
      return tx.sorteo.findUniqueOrThrow({where: {id: sorteo.id}});
    });
    res.json({
      ...actualizado,
      linkPublico: `${(process.env.PUBLIC_BASE_URL || "").replace(/\/$/, "")}/tablero-publico.html?sorteo=${encodeURIComponent(actualizado.linkToken!)}`,
    });
  })
);

// ---- cerrar inscripciones ----
sorteosRouter.post(
  "/:id/cerrar",
  asyncHandler(async (req, res) => {
    const sorteo = await obtenerSorteoPropio(req.params.id, req.usuario!.sub);
    if (sorteo.estado !== "ACTIVO") throw new HttpError(409, "El sorteo no está activo");
    const actualizado = await prisma.sorteo.update({
      where: { id: sorteo.id },
      data: { estado: "CERRADO" },
    });
    res.json(actualizado);
  })
);

// ---- sortear (motor auditable) ----
sorteosRouter.post(
  "/:id/sortear",
  asyncHandler(async (req, res) => {
    const sorteo = await obtenerSorteoPropio(req.params.id, req.usuario!.sub);
    if (sorteo.estado !== "CERRADO") throw new HttpError(409, "Primero tenés que cerrar el sorteo");
    if (sorteo.tipo === "BINGO") throw new HttpError(400, "El bingo se juega en vivo, no tiene sorteo automático de ganador único");

    let candidatos: CandidatoSorteo[] = [];

    if (sorteo.tipo === "RIFA") {
      const numeros = await prisma.numero.findMany({ where: { sorteoId: sorteo.id, estado: "TOMADO" } });
      candidatos = numeros.map((n) => ({ tipo: "numero", valor: String(n.valor) }));
    } else {
      const inscripciones = await prisma.inscripcion.findMany({
        where: { sorteoId: sorteo.id, verificado: true },
        include: { participante: true },
      });
      candidatos = inscripciones.map((i) => ({
        tipo: "participante",
        valor: i.participante.nombre || i.participante.telefono || i.participante.contacto,
      }));
    }

    if (candidatos.length === 0) {
      throw new HttpError(409, "No se puede sortear: todavía no hay participantes con el pago confirmado");
    }

    const resultado = ejecutarSorteoAuditable(candidatos);

    await prisma.$transaction([
      prisma.resultadoSorteo.create({
        data: {
          sorteoId: sorteo.id,
          inputs: JSON.parse(JSON.stringify(resultado.inputs)),
          semilla: resultado.semilla,
          hashPublicado: resultado.hashPublicado,
          ganadorTipo: resultado.ganador.tipo,
          ganadorValor: resultado.ganador.valor,
          sorteadoEn: new Date(resultado.timestamp),
        },
      }),
      prisma.sorteo.update({ where: { id: sorteo.id }, data: { estado: "SORTEADO" } }),
    ]);

    res.json(resultado);
  })
);

// ---- auditoría ----
sorteosRouter.get(
  "/:id/auditoria",
  asyncHandler(async (req, res) => {
    const sorteo = await obtenerSorteoPropio(req.params.id, req.usuario!.sub);
    const resultado = await prisma.resultadoSorteo.findUnique({ where: { sorteoId: sorteo.id } });
    if (!resultado) throw new HttpError(404, "Este sorteo todavía no se sorteó");
    res.json(resultado);
  })
);

// ============ SORTEO EN VIVO (bolillero) — solo para BINGO ============

const iniciarEnVivoSchema = z.object({
  modo: z.enum(["BINGO", "REPETICION"]).default("BINGO"),
  rangoMax: z.number().int().min(2).max(999).default(90),
  umbralRepeticion: z.number().int().min(1).max(10).optional(),
});

sorteosRouter.post(
  "/:id/en-vivo/iniciar",
  asyncHandler(async (req, res) => {
    const sorteo = await obtenerSorteoPropio(req.params.id, req.usuario!.sub);
    if (sorteo.tipo !== "BINGO") throw new HttpError(400, "El sorteo en vivo solo aplica a bingos");
    const datos = iniciarEnVivoSchema.parse(req.body);

    const tablero = await modificarTablero(sorteo.id, tx => tx.tableroEnVivo.upsert({
      where: { sorteoId: sorteo.id },
      update: {
        secuencia: { increment: 1 }, ronda: { increment: 1 },
        modo: datos.modo,
        rangoMax: datos.rangoMax,
        umbralRepeticion: datos.umbralRepeticion ?? null,
        bolillas: [],
        conteos: {},
        ganadorNumero: null,
        estado: "EN_CURSO",
      },
      create: {
        sorteoId: sorteo.id,
        modo: datos.modo,
        rangoMax: datos.rangoMax,
        umbralRepeticion: datos.umbralRepeticion ?? null,
      },
    }));

    if (sorteo.linkToken) emitirCambio(sorteo.linkToken, { tipo: "bolilla", type: "STATE_UPDATE", accion: "iniciado", ...estadoEnVivo(tablero), titulo: sorteo.titulo });
    res.json(estadoEnVivo(tablero));
  })
);

sorteosRouter.post(
  "/:id/en-vivo/extraer",
  asyncHandler(async (req, res) => {
    const sorteo = await obtenerSorteoPropio(req.params.id, req.usuario!.sub);
    const actualizado = await modificarTablero(sorteo.id, async tx => {
      const tablero = await tx.tableroEnVivo.findUnique({ where: { sorteoId: sorteo.id } });
      if (!tablero) throw new HttpError(409, "Primero iniciá el tablero en vivo");
      if (tablero.estado === "FINALIZADO") throw new HttpError(409, "El tablero ya finalizó");

      const bolillas = [...(tablero.bolillas as number[])];
      const conteos = { ...(tablero.conteos as Record<string, number>) };

      let numero: number;
      if (tablero.modo === "BINGO") {
        const usados = new Set(bolillas);
        const disponibles: number[] = [];
        for (let n = 1; n <= tablero.rangoMax; n++) if (!usados.has(n)) disponibles.push(n);
        if (disponibles.length === 0) throw new HttpError(409, "Ya salieron todas las bolillas");
        numero = disponibles[crypto.randomInt(0, disponibles.length)];
      } else {
        numero = crypto.randomInt(1, tablero.rangoMax + 1);
      }

      bolillas.push(numero);
      conteos[numero] = (conteos[numero] || 0) + 1;

      let ganadorNumero = tablero.ganadorNumero;
      let estado = tablero.estado;
      if (tablero.modo === "REPETICION" && tablero.umbralRepeticion && !ganadorNumero) {
        if (conteos[numero] >= tablero.umbralRepeticion) {
          ganadorNumero = numero;
          estado = "FINALIZADO";
        }
      }
      if (tablero.modo === "BINGO" && bolillas.length >= tablero.rangoMax) {
        estado = "FINALIZADO";
      }

      return tx.tableroEnVivo.update({
        where: { id: tablero.id },
        data: { bolillas, conteos, ganadorNumero, estado, secuencia: { increment: 1 } },
      });
    });
    const numero = estadoEnVivo(actualizado).numeroActual;

    if (sorteo.linkToken) emitirCambio(sorteo.linkToken, { tipo: "bolilla", type: "STATE_UPDATE", accion: "extraida", numero, ...estadoEnVivo(actualizado), titulo: sorteo.titulo });
    res.json({ numero, tablero: estadoEnVivo(actualizado) });
  })
);

sorteosRouter.post(
  "/:id/en-vivo/reiniciar",
  asyncHandler(async (req, res) => {
    const sorteo = await obtenerSorteoPropio(req.params.id, req.usuario!.sub);
    const actualizado = await modificarTablero(sorteo.id, async tx => {
      const existente = await tx.tableroEnVivo.findUnique({ where: { sorteoId: sorteo.id } });
      if (!existente) throw new HttpError(404, "Todavía no se inició un tablero en vivo para este sorteo");

      return tx.tableroEnVivo.update({
        where: { id: existente.id },
        data: { bolillas: [], conteos: {}, ganadorNumero: null, estado: "EN_CURSO", secuencia: { increment: 1 }, ronda: { increment: 1 } },
      });
    });

    if (sorteo.linkToken) emitirCambio(sorteo.linkToken, { tipo: "bolilla", type: "STATE_UPDATE", accion: "reiniciado", ...estadoEnVivo(actualizado), titulo: sorteo.titulo });
    res.json(estadoEnVivo(actualizado));
  })
);

sorteosRouter.get(
  "/:id/en-vivo",
  asyncHandler(async (req, res) => {
    const sorteo = await obtenerSorteoPropio(req.params.id, req.usuario!.sub);
    const tablero = await prisma.tableroEnVivo.findUnique({ where: { sorteoId: sorteo.id } });
    if (!tablero) throw new HttpError(404, "Todavía no se inició el tablero en vivo para este sorteo");
    res.json(estadoEnVivo(tablero));
  })
);
