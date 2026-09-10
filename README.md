# Bingo Virtual — Backend + Frontend

Proyecto completo (no maqueta): Express + TypeScript + PostgreSQL + Prisma
para el backend, y las dos pantallas HTML conectadas de verdad como
frontend. Implementa todo lo que fuimos diseñando: usuarios y aprobación
de organizadores, tablero de números con reserva atómica (sin
double-booking), series de bingo con cartones únicos en formato de 90
bolillas, sorteo automático auditable, bolillero en vivo, y tiempo real
por WebSocket.

## Opción A — todo con un solo comando (recomendado)

Requiere Docker y Docker Compose.

```bash
cd tombola-backend
docker compose up --build
```

Eso levanta tres contenedores:
- **db** — PostgreSQL en `localhost:5432`
- **backend** — la API en `http://localhost:4000` (corre migraciones y crea el admin automáticamente al arrancar)
- **frontend** — las dos pantallas HTML servidas en `http://localhost:8080`

Abrí **http://localhost:8080** — ahí tenés una portada con los dos links
(vistas completas del sistema, y el bolillero en vivo). Las pantallas ya
apuntan por defecto a `http://localhost:4000`, así que no hay que tocar
nada más.

Admin por defecto: `admin@tombola.local` / `admin1234` (podés cambiarlo
con las variables `ADMIN_EMAIL` / `ADMIN_PASSWORD` antes de levantar, o
export ándolas en tu shell antes de correr `docker compose up`).

Para parar todo: `docker compose down` (agregá `-v` si además querés
borrar los datos de Postgres y empezar de cero).

## Publicar en Render

El repositorio incluye `render.yaml` para crear con un Blueprint un servicio
Docker y una base PostgreSQL. El mismo servicio publica frontend, API y
WebSockets bajo un solo dominio.

1. Subí este directorio a un repositorio privado de GitHub.
2. En Render elegí **New > Blueprint** y conectá el repositorio.
3. Render solicitará `ADMIN_EMAIL`, `ADMIN_PASSWORD` y `PUBLIC_BASE_URL`.
4. En `PUBLIC_BASE_URL` colocá la URL HTTPS asignada por Render, por ejemplo
   `https://bingo-virtual.onrender.com`.

Accesos después del despliegue:

- Administración: `/admin.html`
- Organizadores: `/organizador.html`
- Bolillero: `/sorteo-en-vivo.html`

El arranque aplica las migraciones incluidas en `prisma/migrations` y luego
crea el administrador. Si falla cualquiera de esos pasos, el servicio se
detiene y deja el error en los logs, para evitar publicar una aplicación
sin las tablas necesarias para ingresar o registrarse.

Si una versión anterior mostraba «Error interno del servidor» al ingresar
o registrarse, desplegá esta versión y revisá los logs de arranque. Deben
confirmar que se aplicaron las migraciones y que el administrador se creó
o ya existía. Verificá que `DATABASE_URL` apunte a la base del servicio y
que `ADMIN_EMAIL` y `ADMIN_PASSWORD` estén configurados. Cambiar esas
variables no modifica la contraseña de un administrador que ya existe.

La migración inicial está preparada para una base vacía. Si la base ya
tiene tablas creadas manualmente o con `prisma db push`, hay que comparar
su esquema y establecer una línea base de migraciones antes de desplegar;
no borres tablas ni reinicies una base con datos para resolver ese caso.

No uses las credenciales de ejemplo en producción. El plan gratuito puede
entrar en reposo cuando no recibe tráfico; para sorteos reales conviene un
servicio pago que permanezca activo.

## Opción B — correrlo a mano (mejor si vas a tocar el código del backend)

### 1. Requisitos

- Node.js 18 o superior
- Docker (para levantar solo PostgreSQL) — o un Postgres propio

### 2. Instalación

```bash
cd tombola-backend
cp .env.example .env

# levanta PostgreSQL en Docker
docker compose up -d

npm install

# crea las tablas
npx prisma migrate dev --name init

# crea el usuario admin (email/password están en .env)
npm run seed

# arranca el servidor con hot-reload
npm run dev
```

Si todo salió bien: `Bingo Virtual backend escuchando en http://localhost:4000`.

Podés inspeccionar la base de datos visualmente con `npm run studio`
(abre Prisma Studio en el navegador).

## 3. Qué es real y qué queda pendiente de conectar

**Funciona de punta a punta:** autenticación con JWT, aprobación de
organizadores, creación y publicación de sorteos, generación real de
números/series/cartones en la base de datos, reserva atómica sin
condiciones de carrera, verificación por código, reingreso, descarga de
la serie en PDF, sorteo automático con log auditable y verificación de
hash, y tablero en tiempo real por WebSocket.

**Queda pendiente (a propósito, para no inventar credenciales falsas):**
el envío real de emails/SMS. En desarrollo (`NODE_ENV=development`), el
código de verificación se imprime por consola del servidor y además viaja
en la respuesta de la API como `codigoDev`, así podés probar el flujo
completo sin tener Twilio/SendGrid conectado. Para producción, conectá un
proveedor en la función `enviarCodigo()` de
`src/routes/publico.routes.ts`.

## 4. Flujo de prueba completo con curl

### 4.1 Login como admin

```bash
curl -X POST http://localhost:4000/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@tombola.local","password":"admin1234"}'
# guardá el "token" de la respuesta -> $ADMIN_TOKEN
```

### 4.2 Un organizador se registra y pide acceso

```bash
curl -X POST http://localhost:4000/auth/registro \
  -H "Content-Type: application/json" \
  -d '{"nombre":"Club Belgrano","email":"club@ejemplo.com","password":"12345678"}'
```

### 4.3 El admin lo aprueba

```bash
curl http://localhost:4000/admin/organizadores?estado=pendiente \
  -H "Authorization: Bearer $ADMIN_TOKEN"
# copiá el "id" del organizador -> $ORG_ID

curl -X POST http://localhost:4000/admin/organizadores/$ORG_ID/aprobar \
  -H "Authorization: Bearer $ADMIN_TOKEN"
```

### 4.4 El organizador se loguea y crea una rifa

```bash
curl -X POST http://localhost:4000/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"club@ejemplo.com","password":"12345678"}'
# -> $ORG_TOKEN

curl -X POST http://localhost:4000/sorteos \
  -H "Authorization: Bearer $ORG_TOKEN" -H "Content-Type: application/json" \
  -d '{
    "tipo": "RIFA",
    "titulo": "Viaje a Bariloche 2027",
    "config": { "cantidadNumeros": 100, "cantidadGanadores": 1 }
  }'
# -> $SORTEO_ID
```

### 4.5 Publicar (acá se generan los 100 números)

```bash
curl -X POST http://localhost:4000/sorteos/$SORTEO_ID/publicar \
  -H "Authorization: Bearer $ORG_TOKEN"
# -> devuelve "linkPublico" con el link_token, ej: viaje-a-bariloche-2027-a1b2c3d4
```

### 4.6 El público mira el tablero (sin login)

```bash
curl http://localhost:4000/s/<link_token>
```

### 4.7 Alguien reserva el número 47

```bash
curl -X POST http://localhost:4000/s/<link_token>/numeros/47/reservar \
  -H "Content-Type: application/json" \
  -d '{"contacto":"+5493854000000"}'
# en dev, la respuesta trae "codigoDev": "123456"
```

### 4.8 Confirma con el código

```bash
curl -X POST http://localhost:4000/s/<link_token>/numeros/47/confirmar \
  -H "Content-Type: application/json" \
  -d '{"contacto":"+5493854000000","codigo":"123456"}'
# -> devuelve "reingreso": un token largo. Con eso puede volver a entrar:
curl "http://localhost:4000/s/<link_token>/mi-numero?reingreso=<ese_token>"
```

### 4.9 Cerrar y sortear

```bash
curl -X POST http://localhost:4000/sorteos/$SORTEO_ID/cerrar -H "Authorization: Bearer $ORG_TOKEN"
curl -X POST http://localhost:4000/sorteos/$SORTEO_ID/sortear -H "Authorization: Bearer $ORG_TOKEN"

# cualquiera puede verificar el resultado sin login:
curl http://localhost:4000/s/<link_token>/resultado
```

### 4.10 Un bingo con series

```bash
curl -X POST http://localhost:4000/sorteos \
  -H "Authorization: Bearer $ORG_TOKEN" -H "Content-Type: application/json" \
  -d '{
    "tipo": "BINGO",
    "titulo": "Bingo Solidario Agosto",
    "config": { "cartonesPorSerie": 5, "cantidadSeries": 20 }
  }'
# publicar igual que antes -> genera 20 series x 5 cartones = 100 cartones reales

# reservar la serie 7:
curl -X POST http://localhost:4000/s/<link_token>/series/7/reservar \
  -H "Content-Type: application/json" -d '{"contacto":"vecino@ejemplo.com"}'

# confirmar (con el codigoDev que devolvió el paso anterior):
curl -X POST http://localhost:4000/s/<link_token>/series/7/confirmar \
  -H "Content-Type: application/json" \
  -d '{"contacto":"vecino@ejemplo.com","codigo":"123456"}'
# -> trae "reingreso"

# descargar los 5 cartones en PDF:
curl "http://localhost:4000/s/<link_token>/mi-serie/descargar?reingreso=<token>" \
  --output serie.pdf
```

### 4.11 Tiempo real

Conectate por WebSocket a `ws://localhost:4000/ws?sorteo=<link_token>` y vas
a recibir un mensaje JSON cada vez que un número o serie cambia de estado
(`{"tipo":"numero","valor":47,"estado":"TOMADO"}`), para actualizar el
tablero en vivo sin refrescar la página.

### 4.12 Sorteo en vivo del bingo (bolillero)

Solo para sorteos tipo `BINGO`. Es una secuencia de bolillas que van
saliendo (con o sin repetición según el modo), con estado persistido en
`TableroEnVivo` — así cualquier pantalla (la del organizador o una
"espectador" en un proyector) puede reconectarse y ver exactamente lo
mismo.

```bash
# iniciar (o reiniciar la config) — requiere estar logueado como el organizador dueño
curl -X POST http://localhost:4000/sorteos/$SORTEO_ID/en-vivo/iniciar \
  -H "Authorization: Bearer $ORG_TOKEN" -H "Content-Type: application/json" \
  -d '{"modo":"BINGO","rangoMax":90}'

# o, para la variante "gana al repetirse 3 veces":
curl -X POST http://localhost:4000/sorteos/$SORTEO_ID/en-vivo/iniciar \
  -H "Authorization: Bearer $ORG_TOKEN" -H "Content-Type: application/json" \
  -d '{"modo":"REPETICION","rangoMax":60,"umbralRepeticion":3}'

# extraer la próxima bolilla
curl -X POST http://localhost:4000/sorteos/$SORTEO_ID/en-vivo/extraer \
  -H "Authorization: Bearer $ORG_TOKEN"

# reiniciar (vacía las bolillas salidas, mantiene la config)
curl -X POST http://localhost:4000/sorteos/$SORTEO_ID/en-vivo/reiniciar \
  -H "Authorization: Bearer $ORG_TOKEN"

# cualquiera puede mirar el estado sin login (para una pantalla espectador/proyector):
curl http://localhost:4000/s/<link_token>/en-vivo
```

Cada extracción también se emite por el mismo WebSocket del tablero
(`{"tipo":"bolilla","accion":"extraida","numero":47,...}`), así que la
pantalla del bolillero puede quedar abierta en dos lugares (control del
organizador + proyector) y ambas ven lo mismo en tiempo real.

## 5. Estructura del proyecto

```
prisma/
  schema.prisma      — el modelo de datos completo
  seed.ts             — crea el usuario admin inicial
src/
  index.ts             — arranque del servidor
  db.ts                — cliente Prisma
  realtime.ts           — WebSocket / pub-sub del tablero
  jobs/
    liberarReservasVencidas.ts  — libera reservas vencidas cada 60s
  middleware/
    auth.ts              — JWT, roles, chequeo de organizador aprobado
    errorHandler.ts
  routes/
    auth.routes.ts        — registro / login de organizadores
    admin.routes.ts        — aprobar / rechazar organizadores
    sorteos.routes.ts       — crear, publicar, cerrar, sortear, auditoría
    publico.routes.ts        — tablero, reservas, confirmaciones, descarga
  utils/
    bingoGenerator.ts        — cartones/series de 90 bolillas sin repetir
    sorteoEngine.ts           — motor de sorteo auditable (semilla + hash)
    tokens.ts                  — link_token, código de verificación
    reingreso.ts                 — token liviano para "volver a entrar"
    pdfSerie.ts                   — arma el PDF de una serie de cartones
```

## 6. Próximos pasos sugeridos

- Conectar un proveedor real de email/SMS (Resend, Twilio, etc.) en `enviarCodigo()`.
- Sumar rate-limiting por IP en las rutas públicas de reserva (anti-bot).
- Si esto corre en más de una instancia, reemplazar el pub-sub en memoria
  de `realtime.ts` por Redis pub/sub o `LISTEN/NOTIFY` de Postgres.
- Endpoint de exportación de resultados/ventas a Excel para el organizador.
- Subir el motor de sorteo a la versión "semilla comprometida antes del
  cierre" (hash publicado antes de sortear + dato público verificable)
  para sorteos con premios grandes.

### Página pública unificada

El enlace `/tablero-publico.html?sorteo=TOKEN` reúne la compra o inscripción,
la consulta de series por DNI, los resultados y el acceso al bolillero vinculado.
El vivo se muestra dentro de la página al presionar **Ingresar al vivo**. Si todavía
no existe un evento vinculado, se informa que no comenzó. Los enlaces anteriores
siguen disponibles para quienes ya los guardaron.

En **Mis sorteos → Fotos de premios y cuenta regresiva**, el organizador puede
agregar o quitar hasta cuatro imágenes y configurar una fecha de inicio opcional.
Las fotos se reducen en el navegador y se guardan con la presentación en `config`,
sin migraciones ni almacenamiento externo. La fecha usa la zona horaria del navegador;
la cuenta regresiva es informativa y no inicia el bolillero ni cierra las ventas.

Verificación: `npm run build`, `node --test tests/presentacion.test.cjs` y
`node tests/publico-unificado-browser.cjs` (requiere Chromium).
