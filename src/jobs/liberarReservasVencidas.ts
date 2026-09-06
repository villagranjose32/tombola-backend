import { prisma } from "../db";
import { emitirCambio } from "../realtime";

/**
 * Corre cada 60s. El chequeo perezoso en el GET del tablero ya
 * garantiza que nadie ve un número "trabado" aunque este job todavía
 * no haya pasado — esto es la parte que además empuja la
 * actualización en vivo a quien está mirando el tablero sin
 * interactuar.
 */
export function iniciarLimpiezaReservas() {
  let ejecutando = false;
  return setInterval(async () => {
    if (ejecutando) return;
    ejecutando = true;
    try {
      const ahora = new Date();

      const numerosVencidos = await prisma.numero.findMany({
        where: { estado: "RESERVADO", reservadoHasta: { lt: ahora } },
        include: { sorteo: true },
      });
      for (const n of numerosVencidos) {
        await prisma.numero.update({
          where: { id: n.id },
          data: { estado: "LIBRE", participanteId: null, codigoHash: null, reservadoHasta: null },
        });
        if (n.sorteo.linkToken) {
          emitirCambio(n.sorteo.linkToken, { tipo: "numero", valor: n.valor, estado: "LIBRE" });
        }
      }

      const seriesVencidas = await prisma.serie.findMany({
        where: { estado: "RESERVADO", reservadoHasta: { lt: ahora } },
        include: { sorteo: true },
      });
      for (const s of seriesVencidas) {
        await prisma.serie.update({
          where: { id: s.id },
          data: { estado: "LIBRE", participanteId: null, codigoHash: null, reservadoHasta: null },
        });
        if (s.sorteo.linkToken) {
          emitirCambio(s.sorteo.linkToken, { tipo: "serie", numero: s.numero, estado: "LIBRE" });
        }
      }
    } catch (error) {
      console.error("Error al liberar reservas vencidas:", error);
    } finally {
      ejecutando = false;
    }
  }, 60_000);
}
