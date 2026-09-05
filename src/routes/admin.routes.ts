import { Router } from "express";
import { prisma } from "../db";
import { requiereAuth, requiereRol } from "../middleware/auth";
import { asyncHandler, HttpError } from "../middleware/errorHandler";

export const adminRouter = Router();

adminRouter.use(requiereAuth, requiereRol("ADMIN"));

adminRouter.get(
  "/organizadores",
  asyncHandler(async (req, res) => {
    const estado = req.query.estado as string | undefined;
    const organizadores = await prisma.usuario.findMany({
      where: {
        rol: "ORGANIZADOR",
        ...(estado ? { estado: estado.toUpperCase() as "PENDIENTE" | "APROBADO" | "RECHAZADO" } : {}),
      },
      orderBy: { creadoEn: "desc" },
      select: { id: true, nombre: true, email: true, estado: true, creadoEn: true },
    });
    res.json(organizadores);
  })
);

adminRouter.post(
  "/organizadores/:id/aprobar",
  asyncHandler(async (req, res) => {
    const usuario = await prisma.usuario.findUnique({ where: { id: req.params.id } });
    if (!usuario || usuario.rol !== "ORGANIZADOR") throw new HttpError(404, "Organizador no encontrado");
    const actualizado = await prisma.usuario.update({
      where: { id: usuario.id },
      data: { estado: "APROBADO" },
    });
    res.json({ id: actualizado.id, estado: actualizado.estado });
  })
);

adminRouter.post(
  "/organizadores/:id/rechazar",
  asyncHandler(async (req, res) => {
    const usuario = await prisma.usuario.findUnique({ where: { id: req.params.id } });
    if (!usuario || usuario.rol !== "ORGANIZADOR") throw new HttpError(404, "Organizador no encontrado");
    const actualizado = await prisma.usuario.update({
      where: { id: usuario.id },
      data: { estado: "RECHAZADO" },
    });
    res.json({ id: actualizado.id, estado: actualizado.estado });
  })
);
