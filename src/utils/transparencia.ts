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

export function pagoPublico(config: unknown) {
  const datos = config as { alias?: unknown; cbu?: unknown } | null;
  const alias = typeof datos?.alias === "string" ? datos.alias : "";
  const cbu = typeof datos?.cbu === "string" ? datos.cbu : "";
  return alias || cbu ? { pago: { alias, cbu } } : {};
}
