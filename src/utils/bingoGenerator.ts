import crypto from "crypto";

/**
 * Genera cartones de bingo en el formato tradicional de 90 bolillas:
 * 3 filas x 9 columnas, 5 números y 4 blancos por fila, cada columna
 * respeta su rango (col.1: 1-9, col.2: 10-19 ... col.9: 80-90) y va
 * en orden ascendente de arriba hacia abajo.
 *
 * Una SERIE de N cartones (3 <= N <= 6) reparte los números sin
 * repetir ninguno dentro de la misma serie. Con N=6 se cubre 1-90
 * exacto (6 cartones x 15 números = 90), que es el estándar real de
 * salón. Con N<6 quedan números que no entran en esa serie, pero
 * nunca se repite un número entre los cartones de la serie.
 */

export type CeldaCarton = number | null;
export type FilaCarton = CeldaCarton[]; // 9 celdas
export type GrillaCarton = FilaCarton[]; // 3 filas

const RANGOS_COLUMNA: [number, number][] = [
  [1, 9],
  [10, 19],
  [20, 29],
  [30, 39],
  [40, 49],
  [50, 59],
  [60, 69],
  [70, 79],
  [80, 90],
];

function shuffle<T>(arr: T[], rng: () => number): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** RNG determinístico (mulberry32) a partir de una semilla numérica, para que la serie sea reproducible si hace falta auditar cómo se generó. */
function rngDesdeSemilla(semilla: number) {
  let a = semilla;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Distribuye cuántas celdas de cada fila corresponden a cada columna,
 * para una serie de `cantidadCartones` cartones. Reparte los 15
 * números de cada cartón en 9 columnas (cada columna con 1, 2 o 3
 * números en ESE cartón), y entre todos los cartones de la serie
 * nunca se repite un número.
 */
function generarSerie(cantidadCartones: number, seedInt: number): GrillaCarton[] {
  const rng = rngDesdeSemilla(seedInt);

  // Pool de números disponibles por columna (sin usar todavía en esta serie)
  const pools: number[][] = RANGOS_COLUMNA.map(([min, max]) => {
    const nums: number[] = [];
    for (let n = min; n <= max; n++) nums.push(n);
    return shuffle(nums, rng);
  });

  const cartones: GrillaCarton[] = [];

  for (let c = 0; c < cantidadCartones; c++) {
    // 1) decidir cuántos números de este cartón caen en cada columna
    //    (entre 0 y 3 por columna, sumando 15 en total, sin superar
    //    lo que queda disponible en el pool de esa columna)
    const cuposPorColumna = new Array(9).fill(0);
    let restantes = 15;
    // primero garantizamos al menos 1 número por columna si alcanza el pool
    for (let col = 0; col < 9 && restantes > 0; col++) {
      if (pools[col].length - contarUsados(cartones, col) > 0) {
        cuposPorColumna[col] = 1;
        restantes--;
      }
    }
    // repartimos el resto al azar, respetando máximo 3 por columna y disponibilidad
    let intentos = 0;
    while (restantes > 0 && intentos < 500) {
      const col = Math.floor(rng() * 9);
      const disponibles = pools[col].length - contarUsados(cartones, col) - cuposPorColumna[col];
      if (cuposPorColumna[col] < 3 && disponibles > 0) {
        cuposPorColumna[col]++;
        restantes--;
      }
      intentos++;
    }

    // 2) elegir, para cada columna con cupo, qué números de su pool le tocan a este cartón
    const numerosPorColumna: number[][] = cuposPorColumna.map((cupo, col) => {
      const usados = contarUsados(cartones, col);
      const disponiblesCol = pools[col].slice(usados, usados + cupo);
      return disponiblesCol.sort((a, b) => a - b); // ascendente dentro de la columna
    });

    // 3) repartir esos números entre las 3 filas: cada fila necesita
    //    exactamente 5 números en total, y como máximo 1 número de
    //    cada columna por fila (así se ve como un cartón real).
    const filas: FilaCarton[] = [
      new Array(9).fill(null),
      new Array(9).fill(null),
      new Array(9).fill(null),
    ];
    const cupoFila = [5, 5, 5];

    for (let col = 0; col < 9; col++) {
      const nums = numerosPorColumna[col];
      if (nums.length === 0) continue;
      // elegimos, entre las filas con cupo disponible, tantas como números tenga la columna
      const filasDisponibles = shuffle([0, 1, 2], rng).filter((f) => cupoFila[f] > 0);
      const filasElegidas = filasDisponibles.slice(0, nums.length).sort((a, b) => a - b);
      // por si el shuffle dejó menos filas disponibles que números (raro, pero por las dudas)
      const asignables = Math.min(filasElegidas.length, nums.length);
      for (let i = 0; i < asignables; i++) {
        filas[filasElegidas[i]][col] = nums[i]; // ya vienen ordenados ascendente
        cupoFila[filasElegidas[i]]--;
      }
    }

    cartones.push(filas);
  }

  return cartones;
}

function contarUsados(cartonesPrevios: GrillaCarton[], col: number): number {
  let usados = 0;
  for (const carton of cartonesPrevios) {
    for (const fila of carton) {
      if (fila[col] !== null) usados++;
    }
  }
  return usados;
}

/** Genera una serie (N cartones) de forma determinística a partir de una semilla de texto (sorteoId + número de serie), para que sea reproducible/auditable. */
export function generarSerieDeterministica(
  sorteoId: string,
  numeroSerie: number,
  cantidadCartones: number
): GrillaCarton[] {
  const hash = crypto.createHash("sha256").update(`${sorteoId}:${numeroSerie}`).digest("hex");
  const seedInt = parseInt(hash.slice(0, 8), 16);
  return generarSerie(cantidadCartones, seedInt);
}
