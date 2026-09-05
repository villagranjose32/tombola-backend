#!/bin/sh
set -e

echo "Aplicando migraciones..."
npx prisma migrate deploy

echo "Creando admin si no existe..."
node dist/prisma/seed.js || true

echo "Arrancando servidor..."
exec node dist/src/index.js
