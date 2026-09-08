import { Router } from "express";
import { z } from "zod";
import crypto from "crypto";
import { prisma } from "../db";
import { asyncHandler, HttpError } from "../middleware/errorHandler";
import { generarCodigoVerificacion, hashCodigo, verificarCodigo } from "../utils/tokens";
import { firmarReingreso, verificarReingreso } from "../utils/reingreso";
import { generarPdfSerie } from "../utils/pdfSerie";
import { emitirCambio } from "../realtime";
import { estadoEnVivo } from "../utils/estadoEnVivo";
import { verificarResultado } from "../utils/sorteoEngine";

export const publicoRouter = Router();

const TTL_RESERVA_MS = 10 * 60 * 1000; // 10 minutos, igual que definimos en el diseño

async function obtenerSorteoPorToken(linkToken: string) {
  const sorteo = await prisma.sorteo.findUnique({ where: { linkToken } });
  if (!sorteo) throw new HttpError(404, "Sorteo no encontrado");
  return sorteo;
}

/** "Envía" el código de verificación. En dev lo logueamos e incluimos en la respuesta; acá se conecta un proveedor real de email/SMS (ver README). */
function enviarCodigo(destino: string, codigo: string) {
  console.log(`[dev] Código de verificación para ${destino}: ${codigo}`);
}

// ============ GET tablero público ============
publicoRouter.get(
  "/:token",
  asyncHandler(async (req, res) => {
    const sorteo = await obtenerSorteoPorToken(req.params.token);
    const ahora = new Date();

    if (sorteo.tipo === "RIFA") {
      const numeros = await prisma.numero.findMany({
        where: { sorteoId: sorteo.id },
        orderBy: { valor: "asc" },
        select: { valor: true, estado: true, reservadoHasta: true },
      });
      const tablero = numeros.map((n) => ({
        valor: n.valor,
        // si la reserva venció, se muestra libre aunque el job de limpieza no haya corrido todavía (chequeo perezoso)
        estado: n.estado === "RESERVADO" && n.reservadoHasta && n.reservadoHasta < ahora ? "LIBRE" : n.estado,
      }));
      return res.json({ tipo: sorteo.tipo, titulo: sorteo.titulo, descripcion: sorteo.descripcion, estado: sorteo.estado, fechaCierre: sorteo.fechaCierre, tablero });
    }

    if (sorteo.tipo === "BINGO") {
      const series = await prisma.serie.findMany({
        where: { sorteoId: sorteo.id },
        orderBy: { numero: "asc" },
        select: { numero: true, estado: true, cantidadCartones: true, reservadoHasta: true },
      });
      const tablero = series.map((s) => ({
        numero: s.numero,
        cantidadCartones: s.cantidadCartones,
        estado: s.estado === "RESERVADO" && s.reservadoHasta && s.reservadoHasta < ahora ? "LIBRE" : s.estado,
      }));
      return res.json({ tipo: sorteo.tipo, titulo: sorteo.titulo, descripcion: sorteo.descripcion, estado: sorteo.estado, fechaCierre: sorteo.fechaCierre, tablero });
    }

    // SORTEO_SIMPLE
    const cantidadInscriptos = await prisma.inscripcion.count({ where: { sorteoId: sorteo.id, verificado: true } });
    res.json({ tipo: sorteo.tipo, titulo: sorteo.titulo, descripcion: sorteo.descripcion, estado: sorteo.estado, fechaCierre: sorteo.fechaCierre, cantidadInscriptos });
  })
);

const contactoSchema = z.object({
  nombre: z.string().trim().min(3).max(120),
  dni: z.string().trim().regex(/^[0-9]{7,8}$/, "Ingresá un DNI de 7 u 8 dígitos, sin puntos"),
  telefono: z.string().trim().min(5).max(40).optional().or(z.literal("")),
});

async function obtenerOCrearParticipante(nombre: string, dni: string, telefono?: string) {
  // La identidad de una reserva anterior nunca se modifica por otra compra.
  // El teléfono puede ser compartido por distintas personas.
  const contacto = `titular:${crypto.createHash("sha256").update(JSON.stringify([dni, nombre, telefono || ""])).digest("hex")}`;
  return prisma.participante.upsert({
    where: { contacto },
    update: {},
    create: { contacto, nombre, dni, telefono },
  });
}

// ============ RIFA: reservar / confirmar un número ============
publicoRouter.post(
  "/:token/numeros/:valor/reservar",
  asyncHandler(async (req, res) => {
    const sorteo = await obtenerSorteoPorToken(req.params.token);
    if (sorteo.tipo !== "RIFA") throw new HttpError(400, "Este sorteo no es una rifa");
    if (sorteo.estado !== "ACTIVO") throw new HttpError(409, "El sorteo no está activo");
    const { nombre, dni, telefono } = contactoSchema.parse(req.body);
    const valor = Number(req.params.valor);

    const participante = await obtenerOCrearParticipante(nombre, dni, telefono || undefined);
    const ahora = new Date();

    // UPDATE atómico: solo reserva si está libre, o si estaba reservado pero ya venció el TTL.
    const actualizados = await prisma.$executeRaw`
      UPDATE numeros
      SET estado = 'RESERVADO',
          "participanteId" = ${participante.id},
          "codigoHash" = NULL,
          "reservadoHasta" = NULL
      WHERE "sorteoId" = ${sorteo.id}
        AND valor = ${valor}
        AND (estado = 'LIBRE' OR (estado = 'RESERVADO' AND "reservadoHasta" < ${ahora}))
    `;

    if (actualizados === 0) {
      throw new HttpError(409, "Ese número ya no está disponible");
    }

    emitirCambio(sorteo.linkToken!, { tipo: "numero", valor, estado: "RESERVADO" });

    res.json({
      mensaje: "Número reservado. Queda pendiente hasta que el organizador confirme el pago.",
      estado: "RESERVADO",
      requiereConfirmacion: false,
    });
  })
);

const confirmarSchema = z.object({ contacto: z.string().min(5), codigo: z.string().length(6) });

publicoRouter.post(
  "/:token/numeros/:valor/confirmar",
  asyncHandler(async (req, res) => {
    const sorteo = await obtenerSorteoPorToken(req.params.token);
    const { contacto, codigo } = confirmarSchema.parse(req.body);
    const valor = Number(req.params.valor);

    const numero = await prisma.numero.findFirst({
      where: { sorteoId: sorteo.id, valor },
      include: { participante: true },
    });
    if (!numero || numero.estado !== "RESERVADO" || !numero.codigoHash) {
      throw new HttpError(409, "No hay una reserva activa para ese número");
    }
    if (numero.reservadoHasta && numero.reservadoHasta < new Date()) {
      throw new HttpError(409, "La reserva venció, el número volvió a estar libre");
    }
    if (numero.participante?.contacto !== contacto || !verificarCodigo(codigo, numero.codigoHash)) {
      throw new HttpError(401, "Código incorrecto");
    }

    await prisma.$transaction([
      prisma.numero.update({ where: { id: numero.id }, data: { estado: "TOMADO", codigoHash: null } }),
      prisma.participante.update({ where: { id: numero.participanteId! }, data: { verificado: true } }),
    ]);

    emitirCambio(sorteo.linkToken!, { tipo: "numero", valor, estado: "TOMADO" });

    const reingreso = firmarReingreso({ participanteId: numero.participanteId!, sorteoId: sorteo.id });
    res.json({ mensaje: `Número ${valor} confirmado.`, reingreso });
  })
);

// ============ BINGO: reservar / confirmar una serie ============
publicoRouter.post(
  "/:token/series/:numero/reservar",
  asyncHandler(async (req, res) => {
    const sorteo = await obtenerSorteoPorToken(req.params.token);
    if (sorteo.tipo !== "BINGO") throw new HttpError(400, "Este sorteo no es un bingo");
    if (sorteo.estado !== "ACTIVO") throw new HttpError(409, "El sorteo no está activo");
    const { nombre, dni, telefono } = contactoSchema.parse(req.body);
    const numeroSerie = Number(req.params.numero);

    const participante = await obtenerOCrearParticipante(nombre, dni, telefono || undefined);
    const ahora = new Date();

    const actualizados = await prisma.$executeRaw`
      UPDATE series
      SET estado = 'RESERVADO',
          "participanteId" = ${participante.id},
          "codigoHash" = NULL,
          "reservadoHasta" = NULL
      WHERE "sorteoId" = ${sorteo.id}
        AND numero = ${numeroSerie}
        AND (estado = 'LIBRE' OR (estado = 'RESERVADO' AND "reservadoHasta" < ${ahora}))
    `;

    if (actualizados === 0) throw new HttpError(409, "Esa serie ya no está disponible");

    emitirCambio(sorteo.linkToken!, { tipo: "serie", numero: numeroSerie, estado: "RESERVADO" });

    res.json({
      mensaje: "Serie reservada. Queda pendiente hasta que el organizador confirme el pago.",
      estado: "RESERVADO",
      requiereConfirmacion: false,
      reingreso: firmarReingreso({ participanteId: participante.id, sorteoId: sorteo.id }),
    });
  })
);

publicoRouter.post(
  "/:token/series/:numero/confirmar",
  asyncHandler(async (req, res) => {
    const sorteo = await obtenerSorteoPorToken(req.params.token);
    const { contacto, codigo } = confirmarSchema.parse(req.body);
    const numeroSerie = Number(req.params.numero);

    const serie = await prisma.serie.findFirst({
      where: { sorteoId: sorteo.id, numero: numeroSerie },
      include: { participante: true },
    });
    if (!serie || serie.estado !== "RESERVADO" || !serie.codigoHash) {
      throw new HttpError(409, "No hay una reserva activa para esa serie");
    }
    if (serie.reservadoHasta && serie.reservadoHasta < new Date()) {
      throw new HttpError(409, "La reserva venció, la serie volvió a estar libre");
    }
    if (serie.participante?.contacto !== contacto || !verificarCodigo(codigo, serie.codigoHash)) {
      throw new HttpError(401, "Código incorrecto");
    }

    await prisma.$transaction([
      prisma.serie.update({ where: { id: serie.id }, data: { estado: "TOMADO", codigoHash: null } }),
      prisma.participante.update({ where: { id: serie.participanteId! }, data: { verificado: true } }),
    ]);

    emitirCambio(sorteo.linkToken!, { tipo: "serie", numero: numeroSerie, estado: "TOMADO" });

    const reingreso = firmarReingreso({ participanteId: serie.participanteId!, sorteoId: sorteo.id });
    res.json({ mensaje: `Serie ${numeroSerie} confirmada.`, reingreso });
  })
);

// ============ SORTEO_SIMPLE: inscribirse / confirmar ============
publicoRouter.post(
  "/:token/participar",
  asyncHandler(async (req, res) => {
    const sorteo = await obtenerSorteoPorToken(req.params.token);
    if (sorteo.tipo !== "SORTEO_SIMPLE") throw new HttpError(400, "Este sorteo no admite inscripción directa");
    if (sorteo.estado !== "ACTIVO") throw new HttpError(409, "El sorteo no está activo");
    const { nombre, dni, telefono } = contactoSchema.parse(req.body);

    const participante = await obtenerOCrearParticipante(nombre, dni, telefono || undefined);

    await prisma.inscripcion.upsert({
      where: { sorteoId_participanteId: { sorteoId: sorteo.id, participanteId: participante.id } },
      update: { codigoHash: null, verificado: false },
      create: { sorteoId: sorteo.id, participanteId: participante.id, codigoHash: null },
    });

    res.json({
      mensaje: "Inscripción recibida. Queda pendiente hasta que el organizador confirme el pago.",
      estado: "RESERVADO",
      requiereConfirmacion: false,
    });
  })
);

publicoRouter.post(
  "/:token/participar/confirmar",
  asyncHandler(async (req, res) => {
    const sorteo = await obtenerSorteoPorToken(req.params.token);
    const { contacto, codigo } = confirmarSchema.parse(req.body);
    const participante = await prisma.participante.findUnique({ where: { contacto } });
    if (!participante) throw new HttpError(404, "No hay inscripción con ese contacto");

    const inscripcion = await prisma.inscripcion.findUnique({
      where: { sorteoId_participanteId: { sorteoId: sorteo.id, participanteId: participante.id } },
    });
    if (!inscripcion || !inscripcion.codigoHash) throw new HttpError(409, "No hay inscripción pendiente");
    if (!verificarCodigo(codigo, inscripcion.codigoHash)) throw new HttpError(401, "Código incorrecto");

    await prisma.inscripcion.update({
      where: { id: inscripcion.id },
      data: { verificado: true, codigoHash: null },
    });

    const reingreso = firmarReingreso({ participanteId: participante.id, sorteoId: sorteo.id });
    res.json({ mensaje: "Inscripción confirmada.", reingreso });
  })
);

// ============ Reingreso: "mi número" / "mi serie" ============
publicoRouter.get(
  "/:token/mi-numero",
  asyncHandler(async (req, res) => {
    const sorteo = await obtenerSorteoPorToken(req.params.token);
    const reingreso = String(req.query.reingreso || "");
    const payload = verificarReingreso(reingreso);
    if (payload.sorteoId !== sorteo.id) throw new HttpError(403, "Ese link no corresponde a este sorteo");

    const numero = await prisma.numero.findFirst({
      where: { sorteoId: sorteo.id, participanteId: payload.participanteId, estado: "TOMADO" },
    });
    if (!numero) throw new HttpError(404, "No encontramos un número confirmado para ese link");
    res.json({ valor: numero.valor, estado: numero.estado });
  })
);

publicoRouter.get(
  "/:token/mi-serie",
  asyncHandler(async (req, res) => {
    const sorteo = await obtenerSorteoPorToken(req.params.token);
    const numeroSerie = Number(req.query.numeroSerie);
    if (!Number.isInteger(numeroSerie) || numeroSerie < 1) throw new HttpError(400, "Número de serie inválido");

    const serie = await prisma.serie.findFirst({
      where: { sorteoId: sorteo.id, numero: numeroSerie, estado: "TOMADO" },
      include: { cartones: { orderBy: { posicion: "asc" } } },
    });
    if (!serie) throw new HttpError(409, "La serie todavía está pendiente de confirmación por el organizador");
    res.json({
      numeroSerie: serie.numero,
      cantidadCartones: serie.cantidadCartones,
      cartones: serie.cartones.map((c) => ({ posicion: c.posicion, contenido: c.contenido })),
    });
  })
);

// ============ Descarga de la serie en PDF ============
publicoRouter.get(
  "/:token/mi-serie/descargar",
  asyncHandler(async (req, res) => {
    const sorteo = await obtenerSorteoPorToken(req.params.token);
    const numeroSerie = Number(req.query.numeroSerie);
    if (!Number.isInteger(numeroSerie) || numeroSerie < 1) throw new HttpError(400, "Número de serie inválido");

    const serie = await prisma.serie.findFirst({
      where: { sorteoId: sorteo.id, numero: numeroSerie, estado: "TOMADO" },
      include: { cartones: { orderBy: { posicion: "asc" } } },
    });
    if (!serie) throw new HttpError(409, "La serie todavía está pendiente de confirmación por el organizador");

    generarPdfSerie(res, {
      tituloSorteo: sorteo.titulo,
      numeroSerie: serie.numero,
      cartones: serie.cartones.map((c) => ({ posicion: c.posicion, contenido: c.contenido as any })),
    });
  })
);

// ============ Estado del sorteo en vivo (público, solo lectura) ============
publicoRouter.get(
  "/:token/en-vivo",
  asyncHandler(async (req, res) => {
    const sorteo = await obtenerSorteoPorToken(req.params.token);
    const tablero = await prisma.tableroEnVivo.findUnique({ where: { sorteoId: sorteo.id } });
    if (!tablero) throw new HttpError(404, "Este bingo todavía no arrancó el sorteo en vivo");
    res.set("Cache-Control", "no-store").json({ type: "STATE_SNAPSHOT", ...estadoEnVivo(tablero) });
  })
);

// ============ Verificación pública del resultado auditable ============
publicoRouter.get(
  "/:token/resultado",
  asyncHandler(async (req, res) => {
    const sorteo = await obtenerSorteoPorToken(req.params.token);
    const resultado = await prisma.resultadoSorteo.findUnique({ where: { sorteoId: sorteo.id } });
    if (!resultado) throw new HttpError(404, "Este sorteo todavía no tiene resultado");

    const hashRecalculado = verificarResultado(
      resultado.semilla,
      resultado.sorteadoEn.toISOString(),
      (resultado.inputs as { cantidad: number }).cantidad
    );

    res.json({
      ganadorTipo: resultado.ganadorTipo,
      ganadorValor: resultado.ganadorValor,
      sorteadoEn: resultado.sorteadoEn,
      semilla: resultado.semilla,
      hashPublicado: resultado.hashPublicado,
      hashRecalculado,
      verificado: hashRecalculado === resultado.hashPublicado,
    });
  })
);
