import { EventoEnVivo, Prisma } from "@prisma/client";
import { prisma } from "../db";
import { HttpError } from "../middleware/errorHandler";

/** Una sola representación del estado confirmado para HTTP y WebSocket. */
export function estadoEnVivo<T extends { id: string; bolillas: unknown; secuencia: number; actualizadoEn: Date }>(evento: T) {
  const numerosExtraidos = evento.bolillas as number[];
  return {
    ...evento,
    salaId: evento.id,
    numeroActual: numerosExtraidos.length ? numerosExtraidos[numerosExtraidos.length - 1] : null,
    numerosExtraidos,
    secuencia: evento.secuencia,
    timestamp: evento.actualizadoEn.toISOString(),
  };
}

/** Serializa TODAS las mutaciones de una sala en PostgreSQL, entre procesos también.
 * El callback y la secuencia se confirman juntos antes de publicar cualquier evento.
 */
export async function modificarEvento<T>(
  id: string,
  organizadorId: string | null,
  modificar: (evento: EventoEnVivo, tx: Prisma.TransactionClient) => Promise<T>
) {
  return prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM eventos_en_vivo WHERE id = ${id} FOR UPDATE`;
    const evento = await tx.eventoEnVivo.findUnique({ where: { id } });
    if (!evento) throw new HttpError(404, "Sorteo en vivo no encontrado");
    if (organizadorId && evento.organizadorId !== organizadorId) throw new HttpError(403, "Este sorteo en vivo no te pertenece");
    return modificar(evento, tx);
  });
}

/** La API anterior bloquea el sorteo padre incluso antes de crear el tablero. */
export async function modificarTablero<T>(sorteoId: string, modificar: (tx: Prisma.TransactionClient) => Promise<T>) {
  return prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM sorteos WHERE id = ${sorteoId} FOR UPDATE`;
    return modificar(tx);
  });
}

export async function snapshotPorToken(linkToken: string) {
  const evento = await prisma.eventoEnVivo.findUnique({ where: { linkToken } });
  if (evento) return estadoEnVivo(evento);
  const tablero = await prisma.tableroEnVivo.findFirst({ where: { sorteo: { linkToken } }, include: { sorteo: true } });
  if (!tablero) return null;
  const { sorteo, ...estado } = tablero;
  return estadoEnVivo({ ...estado, titulo: sorteo.titulo, linkToken, sorteoBingoId: null });
}
