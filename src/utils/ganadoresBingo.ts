/** Detecta los cartones completos únicamente contra las bolillas persistidas. */
export function detectarGanadores<T extends {
  numero: number;
  cartones: Array<{ id: string; posicion: number; contenido: unknown }>;
  participante: { nombre: string | null } | null;
}>(series: T[], bolillas: number[], tipo: "LINEA" | "BINGO") {
  const extraidas = new Set(bolillas);
  return series.flatMap(serie => serie.cartones.filter(carton => {
    const filas = carton.contenido as (number | null)[][];
    const numerosPorFila = filas.map(fila => fila.filter((n): n is number => n !== null));
    if (tipo === "LINEA") return numerosPorFila.some(fila => fila.length > 0 && fila.every(n => extraidas.has(n)));
    const numeros = numerosPorFila.flat();
    return numeros.length > 0 && numeros.every(n => extraidas.has(n));
  }).map(carton => ({
    numeroSerie: serie.numero,
    numeroCarton: carton.posicion,
    participante: serie.participante?.nombre || null,
    carton: { id: carton.id, posicion: carton.posicion, contenido: carton.contenido },
  })));
}
