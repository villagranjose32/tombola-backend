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

/** Construye una tira completa de seis cartones y devuelve los solicitados. */
function generarSerie(cantidadCartones: number, seedInt: number): GrillaCarton[] {
  if (!Number.isInteger(cantidadCartones) || cantidadCartones < 3 || cantidadCartones > 6) {
    throw new Error("La serie debe tener entre 3 y 6 cartones");
  }
  const rng = rngDesdeSemilla(seedInt);
  const pools = RANGOS_COLUMNA.map(([min, max]) =>
    shuffle(Array.from({ length: max - min + 1 }, (_, i) => min + i), rng)
  );

  // Una celda por columna en cada cartón. Los 36 números restantes
  // se asignan a los cartones con menos números, con desempate aleatorio.
  // Cada columna tiene entre 3 y 5 extras, para cartones distintos.
  // Así los seis totales quedan exactamente en 15 sin agotar un pool.
  const cupos = Array.from({ length: 6 }, () => Array(9).fill(1) as number[]);
  const totales = Array(6).fill(9) as number[];
  for (const col of shuffle(Array.from({ length: 9 }, (_, i) => i), rng)) {
    const candidatos = shuffle([0, 1, 2, 3, 4, 5], rng).sort((a, b) => totales[a] - totales[b]);
    for (const carton of candidatos.slice(0, pools[col].length - 6)) {
      cupos[carton][col]++;
      totales[carton]++;
    }
  }

  const cartones = cupos.map(cuposCarton => {
    const filas: GrillaCarton = Array.from({ length: 3 }, () => Array(9).fill(null));
    const libres = [5, 5, 5];
    // Atiende primero las columnas más pobladas y las filas con más
    // espacio. No se descarta ningún número si una fila ya está llena.
    const columnas = shuffle(Array.from({ length: 9 }, (_, i) => i), rng)
      .sort((a, b) => cuposCarton[b] - cuposCarton[a]);
    for (const col of columnas) {
      const cantidad = cuposCarton[col];
      const elegidas = shuffle([0, 1, 2], rng).sort((a, b) => libres[b] - libres[a])
        .slice(0, cantidad).sort((a, b) => a - b);
      const numeros = pools[col].splice(0, cantidad).sort((a, b) => a - b);
      for (const [i, fila] of elegidas.entries()) {
        if (libres[fila] <= 0 || numeros[i] === undefined) throw new Error("Distribución de cartón inválida");
        filas[fila][col] = numeros[i];
        libres[fila]--;
      }
    }
    if (libres.some(cupo => cupo !== 0)) throw new Error("Cada fila debe contener cinco números");
    return filas;
  });
  return cartones.slice(0, cantidadCartones);
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
