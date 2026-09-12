import { Prisma } from "@prisma/client";
import { organizadorPublico, resultadosBingo, pagoPublico } from "../utils/transparencia";
import { Router } from "express";
import crypto from "crypto";
import { z } from "zod";
import { prisma } from "../db";
import { requiereAuth, requiereOrganizadorAprobado } from "../middleware/auth";
import { asyncHandler, HttpError } from "../middleware/errorHandler";
import { generarLinkToken } from "../utils/tokens";
import { comunidadEnVivo, publicarAviso } from "../comunidad";
import { emitirCambio } from "../realtime";
import { acumularCantos, detectarGanadores } from "../utils/ganadoresBingo";
import { estadoEnVivo, modificarEvento, snapshotPorToken, incluirGanadores } from "../utils/estadoEnVivo";

export const eventosEnVivoRouter = Router();
export const eventosEnVivoPublicoRouter = Router();

const configSchema = z.object({
  titulo: z.string().trim().min(3).max(150),
  modo: z.enum(["BINGO", "REPETICION"]),
  rangoMax: z.number().int().min(2).max(999),
  umbralRepeticion: z.number().int().min(1).max(20).optional(),
  sorteoBingoId: z.string().uuid().nullable().optional(),
}).superRefine((datos, ctx) => {
  if (datos.modo === "BINGO" && !datos.sorteoBingoId) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["sorteoBingoId"], message: "Seleccioná el bingo cuyas series se usarán en el bolillero" });
  }
});

eventosEnVivoRouter.use(requiereAuth, requiereOrganizadorAprobado);

async function propio(id: string, organizadorId: string) {
  const evento = await prisma.eventoEnVivo.findUnique({ where: { id }, include: incluirGanadores });
  if (!evento) throw new HttpError(404, "Sorteo en vivo no encontrado");
  if (evento.organizadorId !== organizadorId) throw new HttpError(403, "Este sorteo en vivo no te pertenece");
  return evento;
}

async function validarBingoVinculado(sorteoBingoId: string | null | undefined, organizadorId: string) {
  if (!sorteoBingoId) return;
  const bingo = await prisma.sorteo.findFirst({ where: { id: sorteoBingoId, organizadorId, tipo: "BINGO" } });
  if (!bingo) throw new HttpError(400, "El bingo seleccionado no existe o no pertenece al organizador");
}

eventosEnVivoRouter.get("/", asyncHandler(async (req, res) => {
  res.json(await prisma.eventoEnVivo.findMany({ where: { organizadorId: req.usuario!.sub }, orderBy: { creadoEn: "desc" } }));
}));

eventosEnVivoRouter.post("/", asyncHandler(async (req, res) => {
  const datos = configSchema.parse(req.body);
  await validarBingoVinculado(datos.sorteoBingoId, req.usuario!.sub);
  const evento = await prisma.eventoEnVivo.create({ data: {
    organizadorId: req.usuario!.sub, titulo: datos.titulo, linkToken: generarLinkToken(datos.titulo),
    modo: datos.modo, rangoMax: datos.rangoMax,
    umbralRepeticion: datos.modo === "REPETICION" ? datos.umbralRepeticion ?? 3 : null, sorteoBingoId: datos.sorteoBingoId,
  } });
  res.status(201).json(estadoEnVivo(evento));
}));

eventosEnVivoRouter.get("/:id", asyncHandler(async (req, res) => res.json(estadoEnVivo(await propio(req.params.id, req.usuario!.sub)))));

eventosEnVivoRouter.post("/:id/mensaje", asyncHandler(async (req, res) => {
  const evento = await propio(req.params.id, req.usuario!.sub);
  const { texto, leerEnVozAlta } = z.object({ texto: z.string().trim().min(1).max(280), leerEnVozAlta: z.boolean().default(false) }).parse(req.body);
  const comunidad = publicarAviso(evento.linkToken, texto, leerEnVozAlta);
  emitirCambio(evento.linkToken, { type: "COMMUNITY_UPDATE", comunidad });
  res.json({ ok: true, comunidad });
}));

eventosEnVivoRouter.post("/:id/configurar", asyncHandler(async (req, res) => {
  await propio(req.params.id, req.usuario!.sub);
  const datos = configSchema.parse(req.body);
  await validarBingoVinculado(datos.sorteoBingoId, req.usuario!.sub);
  const evento = await modificarEvento(req.params.id, req.usuario!.sub, async (_evento, tx) => {
    await tx.estadoCartonesEnVivo.deleteMany({ where: { eventoId: req.params.id } });
    return tx.eventoEnVivo.update({ include: incluirGanadores, where: { id: req.params.id }, data: {
      titulo: datos.titulo, modo: datos.modo, rangoMax: datos.rangoMax,
      umbralRepeticion: datos.modo === "REPETICION" ? datos.umbralRepeticion ?? 3 : null, sorteoBingoId: datos.sorteoBingoId,
      bolillas: [], conteos: {}, cantos: [], ganadorNumero: null, estado: "EN_CURSO",
      secuencia: { increment: 1 }, ronda: { increment: 1 },
    } });
  });
  emitirCambio(evento.linkToken, { tipo: "bolilla", type: "STATE_UPDATE", accion: "reiniciado", ...estadoEnVivo(evento) });
  res.json(estadoEnVivo(evento));
}));

eventosEnVivoRouter.post("/:id/extraer", asyncHandler(async (req, res) => {
  const actualizado = await modificarEvento(req.params.id, req.usuario!.sub, async (evento, tx) => {
    if (evento.estado !== "EN_CURSO") throw new HttpError(409, evento.estado === "PAUSADO" ? "La extracción está pausada por un canto de línea o bingo" : "El sorteo ya finalizó");
    const bolillas = [...(evento.bolillas as number[])];
    const conteos = { ...(evento.conteos as Record<string, number>) };
    let numero: number;
    if (evento.modo === "BINGO") {
      const usados = new Set(bolillas);
      const disponibles = Array.from({ length: evento.rangoMax }, (_, i) => i + 1).filter(n => !usados.has(n));
      if (!disponibles.length) throw new HttpError(409, "Ya salieron todos los números");
      numero = disponibles[crypto.randomInt(disponibles.length)];
    } else numero = crypto.randomInt(1, evento.rangoMax + 1);
    bolillas.push(numero); conteos[numero] = (conteos[numero] || 0) + 1;
    let ganadorNumero = evento.ganadorNumero; let estado = evento.estado;
    if (evento.modo === "REPETICION" && evento.umbralRepeticion && conteos[numero] >= evento.umbralRepeticion) { ganadorNumero = numero; estado = "FINALIZADO"; }
    if (evento.modo === "BINGO" && bolillas.length === evento.rangoMax) estado = "FINALIZADO";
    return tx.eventoEnVivo.update({ include: incluirGanadores, where: { id: evento.id }, data: { bolillas, conteos, cantos: [], ganadorNumero, estado, secuencia: { increment: 1 } } });
  });
  const duracionGiroMs = Math.max(650, Math.min(8000, Number(req.body?.duracionGiroMs) || 650));
  const snapshot = { ...estadoEnVivo(actualizado), duracionGiroMs };
  emitirCambio(actualizado.linkToken, { tipo: "bolilla", type: "STATE_UPDATE", accion: "extraida", numero: snapshot.numeroActual, ...snapshot });
  res.json({ numero: snapshot.numeroActual, tablero: snapshot });
}));

eventosEnVivoRouter.post("/:id/reiniciar", asyncHandler(async (req, res) => {
  const actualizado = await modificarEvento(req.params.id, req.usuario!.sub, async (evento, tx) => {
    await tx.estadoCartonesEnVivo.deleteMany({ where: { eventoId: evento.id } });
    return tx.eventoEnVivo.update({ include: incluirGanadores, where: { id: evento.id }, data: {
      bolillas: [], conteos: {}, cantos: [], ganadorNumero: null, estado: "EN_CURSO",
      secuencia: { increment: 1 }, ronda: { increment: 1 },
    } });
  });
  emitirCambio(actualizado.linkToken, { tipo: "bolilla", type: "STATE_UPDATE", accion: "reiniciado", ...estadoEnVivo(actualizado) });
  res.json(estadoEnVivo(actualizado));
}));

eventosEnVivoRouter.post("/:id/reanudar", asyncHandler(async (req, res) => {
  const actualizado = await modificarEvento(req.params.id, req.usuario!.sub, async (evento, tx) => {
    if (evento.estado !== "PAUSADO") throw new HttpError(409, "El sorteo no está pausado");
    return tx.eventoEnVivo.update({ include: incluirGanadores, where: { id: evento.id }, data: { estado: "EN_CURSO", cantos: [], secuencia: { increment: 1 } } });
  });
  emitirCambio(actualizado.linkToken, { tipo: "bolilla", type: "STATE_UPDATE", accion: "reanudado", ...estadoEnVivo(actualizado) });
  res.json(estadoEnVivo(actualizado));
}));

eventosEnVivoPublicoRouter.get("/:token", asyncHandler(async (req, res) => {
  const evento = await snapshotPorToken(req.params.token);
  if (!evento) throw new HttpError(404, "Sorteo en vivo no encontrado");
  res.set("Cache-Control", "no-store").json({ type: "STATE_SNAPSHOT", ...evento, comunidad: comunidadEnVivo(req.params.token) });
}));

async function serieAutorizada(token: string, numeroSerie: number) {
  const evento = await prisma.eventoEnVivo.findUnique({ where: { linkToken: token } });
  if (!evento?.sorteoBingoId) throw new HttpError(400, "Este evento no está vinculado a un bingo");
  if (!Number.isInteger(numeroSerie) || numeroSerie < 1) throw new HttpError(400, "Número de serie inválido");
  const serie = await prisma.serie.findUnique({ where: { sorteoId_numero: { sorteoId: evento.sorteoBingoId, numero: numeroSerie } }, include: { cartones: { orderBy: { posicion: "asc" } }, participante: { select: { nombre: true } } } });
  if (!serie || serie.estado !== "TOMADO") throw new HttpError(403, "La serie no existe o todavía no fue confirmada");
  return { evento, serie };
}

eventosEnVivoPublicoRouter.post("/:token/mis-series", asyncHandler(async (req, res) => {
  const { dni } = z.object({ dni: z.string().trim().regex(/^[0-9]{7,8}$/, "Ingresá un DNI de 7 u 8 dígitos, sin puntos") }).parse(req.body);
  const evento = await prisma.eventoEnVivo.findUnique({ where: { linkToken: req.params.token } });
  if (!evento) throw new HttpError(404, "Sorteo en vivo no encontrado");
  if (!evento.sorteoBingoId) throw new HttpError(400, "Este evento no está vinculado a un bingo");
  const series = await prisma.serie.findMany({
    where: { sorteoId: evento.sorteoBingoId, participante: { dni }, estado: "TOMADO" },
    orderBy: { numero: "asc" },
    select: { numero: true, cartones: { orderBy: { posicion: "asc" } },
      estadosEnVivo: { where: { eventoId: evento.id }, select: { marcas: true } } },
  });
  res.set("Cache-Control", "no-store").json({ series: series.map(serie => ({
    numeroSerie: serie.numero, cartones: serie.cartones, marcas: serie.estadosEnVivo[0]?.marcas || {},
  })) });
}));

eventosEnVivoPublicoRouter.get("/:token/mi-serie", asyncHandler(async (req, res) => {
  const { evento, serie } = await serieAutorizada(req.params.token, Number(req.query.numeroSerie));
  const estado = await prisma.estadoCartonesEnVivo.findUnique({ where: { eventoId_serieId: { eventoId: evento.id, serieId: serie.id } } });
  res.json({ numeroSerie: serie.numero, cartones: serie.cartones, marcas: estado?.marcas || {} });
}));

eventosEnVivoPublicoRouter.put("/:token/mi-serie/marcas", asyncHandler(async (req, res) => {
  const { evento, serie } = await serieAutorizada(req.params.token, Number(req.body.numeroSerie));
  const marcas = z.record(z.array(z.number().int())).parse(req.body.marcas);
  await prisma.estadoCartonesEnVivo.upsert({ where: { eventoId_serieId: { eventoId: evento.id, serieId: serie.id } }, update: { marcas }, create: { eventoId: evento.id, serieId: serie.id, marcas } });
  res.json({ ok: true });
}));

eventosEnVivoPublicoRouter.post("/:token/cantar", asyncHandler(async (req, res) => {
  const datos = z.object({
    tipo: z.enum(["LINEA", "SEGUNDA_LINEA", "BINGO"]),
    numerosSeries: z.array(z.number().int().positive()).min(1).max(100).optional(),
    // Compatibilidad con pantallas abiertas antes de este cambio.
    numeroSerie: z.number().int().positive().optional(),
    numeroCarton: z.number().int().positive().optional(),
  }).parse(req.body);
  const numerosSeries = [...new Set(datos.numerosSeries || (datos.numeroSerie ? [datos.numeroSerie] : []))];
  if (!numerosSeries.length) throw new HttpError(400, "Agregá tu serie antes de cantar");
  const evento = await prisma.eventoEnVivo.findUnique({ where: { linkToken: req.params.token } });
  if (!evento) throw new HttpError(404, "Sorteo en vivo no encontrado");
  const { actualizado, ganadores } = await modificarEvento(evento.id, null, async (actual, tx) => {
    if (!actual.sorteoBingoId) throw new HttpError(400, "Este evento no está vinculado a un bingo");
    const series = await tx.serie.findMany({
      where: { sorteoId: actual.sorteoBingoId, numero: { in: numerosSeries }, estado: "TOMADO" },
      orderBy: { numero: "asc" },
      include: { cartones: { orderBy: { posicion: "asc" } }, participante: { select: { nombre: true } } },
    });
    if (series.length !== numerosSeries.length) throw new HttpError(403, "Alguna serie no existe o todavía no fue confirmada");
    const candidatas = !datos.numerosSeries && datos.numeroCarton
      ? series.map(serie => ({ ...serie, cartones: serie.cartones.filter(c => c.posicion === datos.numeroCarton) }))
      : series;
    const primerasLineas = datos.tipo === "SEGUNDA_LINEA" ? new Set((await tx.cantoBingo.findMany({
      where: { eventoId: actual.id, ronda: actual.ronda, tipo: "LINEA" }, select: { cartonId: true },
    })).map(canto => canto.cartonId)) : new Set<string>();
    if (datos.tipo === "SEGUNDA_LINEA" && !primerasLineas.size) {
      throw new HttpError(409, "Primero debe haberse validado el canto de primera línea.");
    }
    const ganadores = detectarGanadores(candidatas, actual.bolillas as number[], datos.tipo, primerasLineas);
    if (!ganadores.length) throw new HttpError(409, datos.tipo === "BINGO"
      ? "Todavía no hay un cartón con bingo entre tus series."
      : datos.tipo === "SEGUNDA_LINEA" ? "Todavía no hay un segundo canto de línea válido entre tus cartones." : "Todavía no hay una línea completa entre tus cartones.");
    for (const ganador of ganadores) {
      await tx.cantoBingo.upsert({
        where: { eventoId_ronda_tipo_cartonId: { eventoId: actual.id, ronda: actual.ronda, tipo: datos.tipo, cartonId: ganador.carton.id } },
        update: {},
        create: { eventoId: actual.id, sorteoId: actual.sorteoBingoId, ronda: actual.ronda,
          tipo: datos.tipo, cartonId: ganador.carton.id, numeroSerie: ganador.numeroSerie,
          numeroCarton: ganador.numeroCarton, participante: ganador.participante,
          contenido: ganador.carton.contenido as Prisma.InputJsonValue, bolillas: actual.bolillas as Prisma.InputJsonValue },
      });
    }
    const actualizado = await tx.eventoEnVivo.update({ include: incluirGanadores, where: { id: actual.id }, data: {
      estado: "PAUSADO",
      cantos: acumularCantos(actual.cantos, ganadores, datos.tipo, (actual.bolillas as number[]).length),
      secuencia: { increment: 1 },
    } });
    return { actualizado, ganadores };
  });
  const reclamo = {
    tipo: "reclamo", reclamo: datos.tipo, validado: true,
    ...ganadores[0], ganadores,
    ...estadoEnVivo(actualizado), type: "STATE_UPDATE", estadoEvento: actualizado.estado,
  };
  emitirCambio(evento.linkToken, reclamo);
  res.json({ ok: true, ...reclamo });
}));

eventosEnVivoRouter.get("/:id/series/:numero", asyncHandler(async (req, res) => {
  const evento = await propio(req.params.id, req.usuario!.sub);
  if (!evento.sorteoBingoId) throw new HttpError(400, "Este evento no está vinculado a un bingo");
  const serie = await prisma.serie.findUnique({ where: { sorteoId_numero: { sorteoId: evento.sorteoBingoId, numero: Number(req.params.numero) } }, include: { cartones: { orderBy: { posicion: "asc" } }, participante: { select: { nombre: true, telefono: true, dni: true } } } });
  if (!serie) throw new HttpError(404, "Serie no encontrada");
  const estado = await prisma.estadoCartonesEnVivo.findUnique({ where: { eventoId_serieId: { eventoId: evento.id, serieId: serie.id } } });
  res.json({ numeroSerie: serie.numero, participante: serie.participante, cartones: serie.cartones, marcas: estado?.marcas || {} });
}));

eventosEnVivoPublicoRouter.get("/:token/organizador", asyncHandler(async (req, res) => {
  const evento = await prisma.eventoEnVivo.findUnique({ where: { linkToken: req.params.token }, select: { sorteoBingo: { select: { config: true } }, organizador: { select: organizadorPublico } } });
  if (!evento) throw new HttpError(404, "Sorteo en vivo no encontrado");
  res.set("Cache-Control", "no-store").json({ ...evento.organizador, ...pagoPublico(evento.sorteoBingo?.config) });
}));
eventosEnVivoPublicoRouter.get("/:token/resultados", asyncHandler(async (req, res) => {
  const evento = await prisma.eventoEnVivo.findUnique({ where: { linkToken: req.params.token }, select: { id: true, titulo: true } });
  if (!evento) throw new HttpError(404, "Sorteo en vivo no encontrado");
  res.set("Cache-Control", "no-store").json({ titulo: evento.titulo, ...await resultadosBingo({ eventoId: evento.id }) });
}));
