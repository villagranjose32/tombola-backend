import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { prisma } from "../db";

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-cambiar";

export interface JwtPayloadUsuario {
  sub: string;
  rol: "ADMIN" | "ORGANIZADOR";
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      usuario?: JwtPayloadUsuario;
    }
  }
}

export function firmarToken(payload: JwtPayloadUsuario): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: "7d" });
}

/** Exige un JWT válido de usuario (organizador o admin) en el header Authorization: Bearer <token>. */
export function requiereAuth(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Falta el token de autenticación" });
  }
  try {
    const payload = jwt.verify(header.slice(7), JWT_SECRET) as JwtPayloadUsuario;
    req.usuario = payload;
    next();
  } catch {
    return res.status(401).json({ error: "Token inválido o vencido" });
  }
}

export function requiereRol(...roles: Array<"ADMIN" | "ORGANIZADOR">) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.usuario || !roles.includes(req.usuario.rol)) {
      return res.status(403).json({ error: "No tenés permiso para esto" });
    }
    next();
  };
}

/** Además de estar logueado como organizador, tiene que estar APROBADO por un admin. */
export async function requiereOrganizadorAprobado(req: Request, res: Response, next: NextFunction) {
  if (!req.usuario) return res.status(401).json({ error: "Falta autenticación" });
  const usuario = await prisma.usuario.findUnique({ where: { id: req.usuario.sub } });
  if (!usuario) return res.status(401).json({ error: "Usuario no encontrado" });
  if (usuario.rol === "ADMIN") return next(); // el admin puede todo
  if (usuario.estado !== "APROBADO") {
    return res.status(403).json({ error: "Tu cuenta todavía no fue aprobada por un admin" });
  }
  next();
}
