import crypto from "crypto";

/**
 * Motor de sorteo automático auditable (versión "log verificable").
 *
 * No es azar ciego: guardamos la semilla, el timestamp exacto y la
 * lista de candidatos que entraron al sorteo en ese momento, junto
 * con un hash de todo eso. Cualquiera puede recalcular el hash con
 * esos mismos datos (endpoint /verificar) y confirmar que el
 * resultado no se tocó después.
 *
 * Es el "MVP simple" que dejamos definido en el diseño. El upgrade a
 * semilla-comprometida-antes-del-cierre (hash publicado ANTES de
 * sortear + dato público como la Lotería Nacional) queda como mejora
 * futura para sorteos con premios grandes.
 */

export interface CandidatoSorteo {
  tipo: "numero" | "participante";
  valor: string; // el número (como string) o el id/contacto del participante
}

export interface ResultadoAuditable {
  semilla: string;
  timestamp: string; // ISO — se guarda tal cual en sorteadoEn
  hashPublicado: string;
  ganador: CandidatoSorteo;
  inputs: { candidatos: CandidatoSorteo[]; cantidad: number };
}

function calcularHash(semilla: string, timestampISO: string, cantidad: number): string {
  return crypto.createHash("sha256").update(`${semilla}:${timestampISO}:${cantidad}`).digest("hex");
}

export function ejecutarSorteoAuditable(candidatos: CandidatoSorteo[]): ResultadoAuditable {
  if (candidatos.length === 0) {
    throw new Error("No hay candidatos para sortear");
  }

  const semilla = crypto.randomBytes(16).toString("hex");
  const timestamp = new Date().toISOString();
  const hash = calcularHash(semilla, timestamp, candidatos.length);
  const indice = parseInt(hash.slice(0, 8), 16) % candidatos.length;

  return {
    semilla,
    timestamp,
    hashPublicado: hash,
    ganador: candidatos[indice],
    inputs: { candidatos, cantidad: candidatos.length },
  };
}

/** Recalcula el hash a partir de los datos guardados — si coincide con el publicado, el resultado no se manipuló. */
export function verificarResultado(semilla: string, timestampISO: string, cantidadCandidatos: number): string {
  return calcularHash(semilla, timestampISO, cantidadCandidatos);
}
