import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  const email = process.env.ADMIN_EMAIL || "admin@tombola.local";
  const password = process.env.ADMIN_PASSWORD || "admin1234";

  const existente = await prisma.usuario.findUnique({ where: { email } });
  if (existente) {
    console.log(`El admin ${email} ya existe, no se creó de nuevo.`);
    return;
  }

  const passwordHash = await bcrypt.hash(password, 10);
  await prisma.usuario.create({
    data: {
      nombre: "Admin",
      email,
      passwordHash,
      rol: "ADMIN",
      estado: "APROBADO",
    },
  });

  console.log(`Admin creado -> email: ${email}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
