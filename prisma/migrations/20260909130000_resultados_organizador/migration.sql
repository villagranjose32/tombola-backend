ALTER TABLE "usuarios" ADD COLUMN "dni" TEXT, ADD COLUMN "telefono" TEXT;
CREATE TABLE "cantos_bingo" (
  "id" TEXT NOT NULL, "eventoId" TEXT NOT NULL, "sorteoId" TEXT NOT NULL,
  "ronda" INTEGER NOT NULL, "tipo" TEXT NOT NULL, "cartonId" TEXT NOT NULL,
  "numeroSerie" INTEGER NOT NULL, "numeroCarton" INTEGER NOT NULL,
  "participante" TEXT, "contenido" JSONB NOT NULL, "bolillas" JSONB NOT NULL,
  "cantadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "cantos_bingo_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "cantos_bingo_eventoId_fkey" FOREIGN KEY ("eventoId") REFERENCES "eventos_en_vivo"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "cantos_bingo_sorteoId_fkey" FOREIGN KEY ("sorteoId") REFERENCES "sorteos"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "cantos_bingo_eventoId_ronda_tipo_cartonId_key" ON "cantos_bingo"("eventoId", "ronda", "tipo", "cartonId");
CREATE INDEX "cantos_bingo_sorteoId_cantadoEn_idx" ON "cantos_bingo"("sorteoId", "cantadoEn");
