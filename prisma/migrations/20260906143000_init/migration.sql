-- CreateEnum
CREATE TYPE "RolUsuario" AS ENUM ('ADMIN', 'ORGANIZADOR');

-- CreateEnum
CREATE TYPE "EstadoOrganizador" AS ENUM ('PENDIENTE', 'APROBADO', 'RECHAZADO');

-- CreateEnum
CREATE TYPE "TipoSorteo" AS ENUM ('RIFA', 'BINGO', 'SORTEO_SIMPLE');

-- CreateEnum
CREATE TYPE "EstadoSorteo" AS ENUM ('BORRADOR', 'ACTIVO', 'CERRADO', 'SORTEADO');

-- CreateEnum
CREATE TYPE "EstadoItem" AS ENUM ('LIBRE', 'RESERVADO', 'TOMADO');

-- CreateEnum
CREATE TYPE "ModoTableroEnVivo" AS ENUM ('BINGO', 'REPETICION');

-- CreateTable
CREATE TABLE "usuarios" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "rol" "RolUsuario" NOT NULL DEFAULT 'ORGANIZADOR',
    "estado" "EstadoOrganizador" NOT NULL DEFAULT 'PENDIENTE',
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "usuarios_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "eventos_en_vivo" (
    "id" TEXT NOT NULL,
    "organizadorId" TEXT NOT NULL,
    "sorteoBingoId" TEXT,
    "titulo" TEXT NOT NULL,
    "linkToken" TEXT NOT NULL,
    "modo" "ModoTableroEnVivo" NOT NULL DEFAULT 'BINGO',
    "rangoMax" INTEGER NOT NULL DEFAULT 90,
    "umbralRepeticion" INTEGER,
    "bolillas" JSONB NOT NULL DEFAULT '[]',
    "conteos" JSONB NOT NULL DEFAULT '{}',
    "ganadorNumero" INTEGER,
    "estado" TEXT NOT NULL DEFAULT 'EN_CURSO',
    "actualizadoEn" TIMESTAMP(3) NOT NULL,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "eventos_en_vivo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sorteos" (
    "id" TEXT NOT NULL,
    "organizadorId" TEXT NOT NULL,
    "tipo" "TipoSorteo" NOT NULL,
    "titulo" TEXT NOT NULL,
    "descripcion" TEXT,
    "config" JSONB NOT NULL DEFAULT '{}',
    "estado" "EstadoSorteo" NOT NULL DEFAULT 'BORRADOR',
    "linkToken" TEXT,
    "fechaCierre" TIMESTAMP(3),
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sorteos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "participantes" (
    "id" TEXT NOT NULL,
    "nombre" TEXT,
    "telefono" TEXT,
    "contacto" TEXT NOT NULL,
    "verificado" BOOLEAN NOT NULL DEFAULT false,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "participantes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inscripciones" (
    "id" TEXT NOT NULL,
    "sorteoId" TEXT NOT NULL,
    "participanteId" TEXT NOT NULL,
    "verificado" BOOLEAN NOT NULL DEFAULT false,
    "codigoHash" TEXT,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inscripciones_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "numeros" (
    "id" TEXT NOT NULL,
    "sorteoId" TEXT NOT NULL,
    "valor" INTEGER NOT NULL,
    "estado" "EstadoItem" NOT NULL DEFAULT 'LIBRE',
    "participanteId" TEXT,
    "codigoHash" TEXT,
    "reservadoHasta" TIMESTAMP(3),

    CONSTRAINT "numeros_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "series" (
    "id" TEXT NOT NULL,
    "sorteoId" TEXT NOT NULL,
    "numero" INTEGER NOT NULL,
    "cantidadCartones" INTEGER NOT NULL,
    "estado" "EstadoItem" NOT NULL DEFAULT 'LIBRE',
    "participanteId" TEXT,
    "codigoHash" TEXT,
    "reservadoHasta" TIMESTAMP(3),

    CONSTRAINT "series_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "estados_cartones_en_vivo" (
    "id" TEXT NOT NULL,
    "eventoId" TEXT NOT NULL,
    "serieId" TEXT NOT NULL,
    "marcas" JSONB NOT NULL DEFAULT '{}',
    "actualizadoEn" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "estados_cartones_en_vivo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cartones" (
    "id" TEXT NOT NULL,
    "serieId" TEXT NOT NULL,
    "posicion" INTEGER NOT NULL,
    "contenido" JSONB NOT NULL,

    CONSTRAINT "cartones_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "resultados_sorteo" (
    "id" TEXT NOT NULL,
    "sorteoId" TEXT NOT NULL,
    "semilla" TEXT NOT NULL,
    "hashPublicado" TEXT NOT NULL,
    "ganadorTipo" TEXT NOT NULL,
    "ganadorValor" TEXT NOT NULL,
    "inputs" JSONB NOT NULL,
    "sorteadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "resultados_sorteo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tableros_en_vivo" (
    "id" TEXT NOT NULL,
    "sorteoId" TEXT NOT NULL,
    "modo" "ModoTableroEnVivo" NOT NULL DEFAULT 'BINGO',
    "rangoMax" INTEGER NOT NULL DEFAULT 90,
    "umbralRepeticion" INTEGER,
    "bolillas" JSONB NOT NULL DEFAULT '[]',
    "conteos" JSONB NOT NULL DEFAULT '{}',
    "ganadorNumero" INTEGER,
    "estado" TEXT NOT NULL DEFAULT 'EN_CURSO',
    "actualizadoEn" TIMESTAMP(3) NOT NULL,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tableros_en_vivo_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "usuarios_email_key" ON "usuarios"("email");

-- CreateIndex
CREATE UNIQUE INDEX "eventos_en_vivo_linkToken_key" ON "eventos_en_vivo"("linkToken");

-- CreateIndex
CREATE INDEX "eventos_en_vivo_organizadorId_idx" ON "eventos_en_vivo"("organizadorId");

-- CreateIndex
CREATE UNIQUE INDEX "sorteos_linkToken_key" ON "sorteos"("linkToken");

-- CreateIndex
CREATE UNIQUE INDEX "participantes_contacto_key" ON "participantes"("contacto");

-- CreateIndex
CREATE UNIQUE INDEX "inscripciones_sorteoId_participanteId_key" ON "inscripciones"("sorteoId", "participanteId");

-- CreateIndex
CREATE INDEX "numeros_sorteoId_estado_idx" ON "numeros"("sorteoId", "estado");

-- CreateIndex
CREATE UNIQUE INDEX "numeros_sorteoId_valor_key" ON "numeros"("sorteoId", "valor");

-- CreateIndex
CREATE INDEX "series_sorteoId_estado_idx" ON "series"("sorteoId", "estado");

-- CreateIndex
CREATE UNIQUE INDEX "series_sorteoId_numero_key" ON "series"("sorteoId", "numero");

-- CreateIndex
CREATE UNIQUE INDEX "estados_cartones_en_vivo_eventoId_serieId_key" ON "estados_cartones_en_vivo"("eventoId", "serieId");

-- CreateIndex
CREATE UNIQUE INDEX "cartones_serieId_posicion_key" ON "cartones"("serieId", "posicion");

-- CreateIndex
CREATE UNIQUE INDEX "resultados_sorteo_sorteoId_key" ON "resultados_sorteo"("sorteoId");

-- CreateIndex
CREATE UNIQUE INDEX "tableros_en_vivo_sorteoId_key" ON "tableros_en_vivo"("sorteoId");

-- AddForeignKey
ALTER TABLE "eventos_en_vivo" ADD CONSTRAINT "eventos_en_vivo_organizadorId_fkey" FOREIGN KEY ("organizadorId") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "eventos_en_vivo" ADD CONSTRAINT "eventos_en_vivo_sorteoBingoId_fkey" FOREIGN KEY ("sorteoBingoId") REFERENCES "sorteos"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sorteos" ADD CONSTRAINT "sorteos_organizadorId_fkey" FOREIGN KEY ("organizadorId") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inscripciones" ADD CONSTRAINT "inscripciones_sorteoId_fkey" FOREIGN KEY ("sorteoId") REFERENCES "sorteos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inscripciones" ADD CONSTRAINT "inscripciones_participanteId_fkey" FOREIGN KEY ("participanteId") REFERENCES "participantes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "numeros" ADD CONSTRAINT "numeros_sorteoId_fkey" FOREIGN KEY ("sorteoId") REFERENCES "sorteos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "numeros" ADD CONSTRAINT "numeros_participanteId_fkey" FOREIGN KEY ("participanteId") REFERENCES "participantes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "series" ADD CONSTRAINT "series_sorteoId_fkey" FOREIGN KEY ("sorteoId") REFERENCES "sorteos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "series" ADD CONSTRAINT "series_participanteId_fkey" FOREIGN KEY ("participanteId") REFERENCES "participantes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "estados_cartones_en_vivo" ADD CONSTRAINT "estados_cartones_en_vivo_eventoId_fkey" FOREIGN KEY ("eventoId") REFERENCES "eventos_en_vivo"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "estados_cartones_en_vivo" ADD CONSTRAINT "estados_cartones_en_vivo_serieId_fkey" FOREIGN KEY ("serieId") REFERENCES "series"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cartones" ADD CONSTRAINT "cartones_serieId_fkey" FOREIGN KEY ("serieId") REFERENCES "series"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "resultados_sorteo" ADD CONSTRAINT "resultados_sorteo_sorteoId_fkey" FOREIGN KEY ("sorteoId") REFERENCES "sorteos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tableros_en_vivo" ADD CONSTRAINT "tableros_en_vivo_sorteoId_fkey" FOREIGN KEY ("sorteoId") REFERENCES "sorteos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

