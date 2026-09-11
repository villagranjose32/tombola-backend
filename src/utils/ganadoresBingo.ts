/** Detecta los cartones completos únicamente contra las bolillas persistidas. */
export function detectarGanadores<T extends {
  numero: number;
  cartones: Array<{ id: string; posicion: number; contenido: unknown }>;
  participante: { nombre: string | null } | null;
}>(series: T[], bolillas: number[], tipo: "LINEA" | "SEGUNDA_LINEA" | "BINGO") {
  const extraidas = new Set(bolillas);
  return series.flatMap(serie => serie.cartones.filter(carton => {
    const filas = carton.contenido as (number | null)[][];
    const numerosPorFila = filas.map(fila => fila.filter((n): n is number => n !== null));
    if (tipo !== "BINGO") return numerosPorFila.filter(fila => fila.length > 0 && fila.every(n => extraidas.has(n))).length >= (tipo === "SEGUNDA_LINEA" ? 2 : 1);
    const numeros = numerosPorFila.flat();
    return numeros.length > 0 && numeros.every(n => extraidas.has(n));
  }).map(carton => ({
    numeroSerie: serie.numero,
    numeroCarton: carton.posicion,
    participante: serie.participante?.nombre || null,
    carton: { id: carton.id, posicion: carton.posicion, contenido: carton.contenido },
  })));
}

/** Conserva todos los cantos de la jugada sin duplicar un mismo cartón y premio. */
export function acumularCantos(anteriores: unknown, ganadores: ReturnType<typeof detectarGanadores>, tipo: "LINEA" | "SEGUNDA_LINEA" | "BINGO", jugada: number) {
  const cantos = (Array.isArray(anteriores) ? anteriores : []).filter(c => c.jugada === jugada);
  for (const ganador of ganadores) {
    if (!cantos.some(c => c.tipo === tipo && c.carton.id === ganador.carton.id)) {
      cantos.push({ ...ganador, tipo, jugada });
    }
  }
  return cantos;
}
