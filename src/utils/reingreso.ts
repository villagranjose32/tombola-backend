import jwt from "jsonwebtoken";
import { HttpError } from "../middleware/errorHandler";

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-cambiar";

export interface ReingresoPayload {
  participanteId: string;
  sorteoId: string;
}

/**
 * En producción esto viaja adentro de un link tipo
 * https://tombola.app/s/<token>/mi-numero?reingreso=<jwt>
 * que se manda por email/SMS. Acá generamos el JWT; el envío real
 * por un proveedor de email/SMS queda pendiente de conectar (ver README).
 */
export function firmarReingreso(payload: ReingresoPayload): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: "90d" });
}

export function verificarReingreso(token: string): ReingresoPayload {
  try {
    return jwt.verify(token, JWT_SECRET) as ReingresoPayload;
  } catch {
    throw new HttpError(401, "Link de reingreso inválido o vencido");
  }
}
