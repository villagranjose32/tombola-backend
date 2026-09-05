import { Router } from "express";
import crypto from "crypto";
import { z } from "zod";
import { prisma } from "../db";
import { requiereAuth, requiereOrganizadorAprobado } from "../middleware/auth";
import { asyncHandler, HttpError } from "../middleware/errorHandler";
import { generarLinkToken } from "../utils/tokens";
import { emitirCambio } from "../realtime";

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
  const evento = await prisma.eventoEnVivo.findUnique({ where: { id } });
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
  res.status(201).json(evento);
}));

eventosEnVivoRouter.get("/:id", asyncHandler(async (req, res) => res.json(await propio(req.params.id, req.usuario!.sub))));

eventosEnVivoRouter.post("/:id/configurar", asyncHandler(async (req, res) => {
  await propio(req.params.id, req.usuario!.sub);
  const datos = configSchema.parse(req.body);
  await validarBingoVinculado(datos.sorteoBingoId, req.usuario!.sub);
  const evento = await prisma.eventoEnVivo.update({ where: { id: req.params.id }, data: {
    titulo: datos.titulo, modo: datos.modo, rangoMax: datos.rangoMax,
    umbralRepeticion: datos.modo === "REPETICION" ? datos.umbralRepeticion ?? 3 : null, sorteoBingoId: datos.sorteoBingoId,
    bolillas: [], conteos: {}, ganadorNumero: null, estado: "EN_CURSO",
  } });
  emitirCambio(evento.linkToken, { tipo: "bolilla", accion: "reiniciado", ...evento });
  res.json(evento);
}));

eventosEnVivoRouter.post("/:id/extraer", asyncHandler(async (req, res) => {
  const evento = await propio(req.params.id, req.usuario!.sub);
  if (evento.estado !== "EN_CURSO") throw new HttpError(409, evento.estado === "PAUSADO" ? "La extracción está pausada por un bingo validado" : "El sorteo ya finalizó");
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
  const actualizado = await prisma.eventoEnVivo.update({ where: { id: evento.id }, data: { bolillas, conteos, ganadorNumero, estado } });
  emitirCambio(evento.linkToken, { tipo: "bolilla", accion: "extraida", numero, ...actualizado });
  res.json({ numero, tablero: actualizado });
}));

eventosEnVivoRouter.post("/:id/reiniciar", asyncHandler(async (req, res) => {
  const evento = await propio(req.params.id, req.usuario!.sub);
  const [actualizado] = await prisma.$transaction([
    prisma.eventoEnVivo.update({ where: { id: evento.id }, data: { bolillas: [], conteos: {}, ganadorNumero: null, estado: "EN_CURSO" } }),
    prisma.estadoCartonesEnVivo.deleteMany({ where: { eventoId: evento.id } }),
  ]);
  emitirCambio(evento.linkToken, { tipo: "bolilla", accion: "reiniciado", ...actualizado });
  res.json(actualizado);
}));

eventosEnVivoRouter.post("/:id/reanudar", asyncHandler(async (req, res) => {
  const evento = await propio(req.params.id, req.usuario!.sub);
  if (evento.estado !== "PAUSADO") throw new HttpError(409, "El sorteo no está pausado");
  const actualizado = await prisma.eventoEnVivo.update({ where: { id: evento.id }, data: { estado: "EN_CURSO" } });
  emitirCambio(evento.linkToken, { tipo: "bolilla", accion: "reanudado", ...actualizado });
  res.json(actualizado);
}));

eventosEnVivoPublicoRouter.get("/:token", asyncHandler(async (req, res) => {
  const evento = await prisma.eventoEnVivo.findUnique({ where: { linkToken: req.params.token } });
  if (!evento) throw new HttpError(404, "Sorteo en vivo no encontrado");
  res.json(evento);
}));

async function serieAutorizada(token: string, numeroSerie: number) {
  const evento = await prisma.eventoEnVivo.findUnique({ where: { linkToken: token } });
  if (!evento?.sorteoBingoId) throw new HttpError(400, "Este evento no está vinculado a un bingo");
  if (!Number.isInteger(numeroSerie) || numeroSerie < 1) throw new HttpError(400, "Número de serie inválido");
  const serie = await prisma.serie.findUnique({ where: { sorteoId_numero: { sorteoId: evento.sorteoBingoId, numero: numeroSerie } }, include: { cartones: { orderBy: { posicion: "asc" } }, participante: { select: { nombre: true } } } });
  if (!serie || serie.estado !== "TOMADO") throw new HttpError(403, "La serie no existe o todavía no fue confirmada");
  return { evento, serie };
}

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
  const { evento, serie } = await serieAutorizada(req.params.token, Number(req.body.numeroSerie));
  const tipoReclamo = z.enum(["LINEA", "BINGO"]).parse(req.body.tipo);
  const numeroCarton = z.number().int().min(1).parse(Number(req.body.numeroCarton));
  const carton = serie.cartones.find((item) => item.posicion === numeroCarton);
  if (!carton) throw new HttpError(404, `El cartón ${numeroCarton} no pertenece a la serie ${serie.numero}`);

  const grilla = carton.contenido as (number | null)[][];
  const extraidas = new Set(evento.bolillas as number[]);
  const filasCompletas = grilla.map((fila) => fila.filter((n): n is number => n !== null).every((n) => extraidas.has(n)));
  const numeros = grilla.flat().filter((n): n is number => n !== null);
  const valido = tipoReclamo === "LINEA" ? filasCompletas.some(Boolean) : numeros.every((n) => extraidas.has(n));
  if (!valido) {
    if (tipoReclamo === "BINGO") {
      const faltantes = numeros.filter((n) => !extraidas.has(n));
      throw new HttpError(409, `Bingo no válido: todavía faltan ${faltantes.length} números en ese cartón`);
    }
    const menorCantidadFaltante = Math.min(...grilla.map((fila) => fila.filter((n): n is number => n !== null && !extraidas.has(n)).length));
    throw new HttpError(409, `Línea no válida: ninguna fila está completa (a la más cercana le faltan ${menorCantidadFaltante})`);
  }

  const eventoPausado = tipoReclamo === "BINGO"
    ? await prisma.eventoEnVivo.update({ where: { id: evento.id }, data: { estado: "PAUSADO" } })
    : evento;
  const reclamo = {
    tipo: "reclamo",
    reclamo: tipoReclamo,
    validado: true,
    numeroSerie: serie.numero,
    numeroCarton: carton.posicion,
    participante: serie.participante?.nombre || null,
    carton: { id: carton.id, posicion: carton.posicion, contenido: carton.contenido },
    bolillas: evento.bolillas,
    estadoEvento: eventoPausado.estado,
  };
  emitirCambio(evento.linkToken, reclamo);
  res.json({ ok: true, ...reclamo });
}));

eventosEnVivoRouter.get("/:id/series/:numero", asyncHandler(async (req, res) => {
  const evento = await propio(req.params.id, req.usuario!.sub);
  if (!evento.sorteoBingoId) throw new HttpError(400, "Este evento no está vinculado a un bingo");
  const serie = await prisma.serie.findUnique({ where: { sorteoId_numero: { sorteoId: evento.sorteoBingoId, numero: Number(req.params.numero) } }, include: { cartones: { orderBy: { posicion: "asc" } }, participante: { select: { nombre: true, telefono: true } } } });
  if (!serie) throw new HttpError(404, "Serie no encontrada");
  const estado = await prisma.estadoCartonesEnVivo.findUnique({ where: { eventoId_serieId: { eventoId: evento.id, serieId: serie.id } } });
  res.json({ numeroSerie: serie.numero, participante: serie.participante, cartones: serie.cartones, marcas: estado?.marcas || {} });
}));
