import { PrismaClient } from "@prisma/client";

// Un solo cliente Prisma para toda la app (evita agotar el pool de
// conexiones en desarrollo con hot-reload).
export const prisma = new PrismaClient();
