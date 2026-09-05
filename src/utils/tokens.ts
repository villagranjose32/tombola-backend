import crypto from "crypto";

/** Token no adivinable para el link público de un sorteo (ej. /s/br-2027-x9k2f8). */
export function generarLinkToken(titulo: string): string {
  const slug = titulo
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 20);
  const random = crypto.randomBytes(4).toString("hex");
  return `${slug || "sorteo"}-${random}`;
}

/** Código de verificación de 6 dígitos (el que se "envía" por email/SMS al reservar un número o serie). */
export function generarCodigoVerificacion(): string {
  return crypto.randomInt(100000, 999999).toString();
}

export function hashCodigo(codigo: string): string {
  return crypto.createHash("sha256").update(codigo).digest("hex");
}

export function verificarCodigo(codigo: string, hash: string): boolean {
  return hashCodigo(codigo) === hash;
}
