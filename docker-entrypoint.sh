#!/bin/sh
set -e

echo "Aplicando migraciones..."
./node_modules/.bin/prisma migrate deploy

echo "Creando admin si no existe..."
node dist/prisma/seed.js

echo "Arrancando servidor..."
exec node dist/src/index.js
