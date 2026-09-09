import { prisma } from "../db";

// Solo los datos de identificación que se muestran a los participantes.
export const organizadorPublico = { nombre: true, dni: true, telefono: true } as const;

export async function resultadosBingo(where: { sorteoId?: string; eventoId?: string }) {
  const cantos = await prisma.cantoBingo.findMany({ where, orderBy: [{ cantadoEn: "asc" }, { id: "asc" }],
    select: { id: true, tipo: true, ronda: true, numeroSerie: true, numeroCarton: true,
      participante: true, contenido: true, bolillas: true, cantadoEn: true,
      evento: { select: { titulo: true } } },
  });
  return { tipo: "BINGO", cantos };
}
