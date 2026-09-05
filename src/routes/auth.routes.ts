import { Router } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "../db";
import { firmarToken } from "../middleware/auth";
import { asyncHandler, HttpError } from "../middleware/errorHandler";

export const authRouter = Router();

const registroSchema = z.object({
  nombre: z.string().min(2),
  email: z.string().email(),
  password: z.string().min(8, "La contraseña necesita al menos 8 caracteres"),
});

/**
 * Cualquiera puede registrarse como organizador, pero queda en estado
 * PENDIENTE hasta que un admin lo aprueba (POST /admin/organizadores/:id/aprobar).
 */
authRouter.post(
  "/registro",
  asyncHandler(async (req, res) => {
    const datos = registroSchema.parse(req.body);

    const existente = await prisma.usuario.findUnique({ where: { email: datos.email } });
    if (existente) throw new HttpError(409, "Ya existe una cuenta con ese email");

    const passwordHash = await bcrypt.hash(datos.password, 10);
    const usuario = await prisma.usuario.create({
      data: {
        nombre: datos.nombre,
        email: datos.email,
        passwordHash,
        rol: "ORGANIZADOR",
        estado: "PENDIENTE",
      },
    });

    res.status(201).json({
      mensaje: "Cuenta creada. Un admin tiene que aprobarla antes de que puedas crear sorteos.",
      usuario: { id: usuario.id, nombre: usuario.nombre, email: usuario.email, estado: usuario.estado },
    });
  })
);

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string(),
});

authRouter.post(
  "/login",
  asyncHandler(async (req, res) => {
    const datos = loginSchema.parse(req.body);
    const usuario = await prisma.usuario.findUnique({ where: { email: datos.email } });
    if (!usuario) throw new HttpError(401, "Email o contraseña incorrectos");

    const ok = await bcrypt.compare(datos.password, usuario.passwordHash);
    if (!ok) throw new HttpError(401, "Email o contraseña incorrectos");

    const token = firmarToken({ sub: usuario.id, rol: usuario.rol });
    res.json({
      token,
      usuario: {
        id: usuario.id,
        nombre: usuario.nombre,
        email: usuario.email,
        rol: usuario.rol,
        estado: usuario.estado,
      },
    });
  })
);
