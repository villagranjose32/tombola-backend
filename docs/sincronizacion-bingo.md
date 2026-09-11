# Sincronización del bingo en vivo

## Causa encontrada

La vista anterior sólo instalaba `onmessage`. No tenía apertura/cierre, reintentos,
heartbeat, recuperación por cambios de red/visibilidad ni consulta periódica HTTP.
Una desconexión dejaba indefinidamente el último estado en pantalla. Además,
el GET inicial pintaba historial y tablero pero no restauraba la bolilla central:
una entrada tardía podía mostrar «esperando» aunque ya se hubieran extraído números.
Los callbacks diferidos de animación podían aplicar respuestas antiguas.

El servidor ya esperaba la escritura antes de emitir, pero le faltaban secuencias
y serialización de extracciones concurrentes: dos solicitudes podían leer el mismo
historial y sobrescribirlo. Se corrigieron ambas APIs de bolillero existentes.

## Protocolo y persistencia

- PostgreSQL guarda historial, estado, `secuencia`, `ronda` y fecha de actualización.
- Una transacción con bloqueo de fila guarda cada mutación e incrementa la secuencia.
  El broadcast se ejecuta después del commit. Reiniciar/configurar aumenta también
  la ronda; la secuencia nunca se reinicia. La ronda permite limpiar marcas tras
  perderse un reinicio, aunque después ya hayan salido nuevas bolillas.
- `STATE_UPDATE` incluye `salaId`, `numeroActual`, `numerosExtraidos`, `estado`,
  `secuencia`, `timestamp` del servidor y configuración necesaria para renderizar.
- El cliente envía `RESYNC` al abrir/reabrir la conexión y al detectar un salto.
  `STATE_SNAPSHOT` se lee siempre de PostgreSQL, limitado a la sala de la conexión.
- `GET /vivo/:token` devuelve la misma representación, con `Cache-Control: no-store`.
  La API pública anterior `/s/:token/en-vivo` también incluye secuencia y snapshot.
- El proceso sólo mantiene suscripciones WS en memoria. Ante reinicios u otra
  instancia, HTTP y RESYNC recuperan el estado persistente. El broadcast es local
  a cada instancia; con varias instancias, el respaldo HTTP garantiza convergencia
  y puede introducir hasta 5 segundos de demora entre ellas.

## Recuperación y pantalla

`frontend/live-sync.js` mantiene una instancia por sala. Usa backoff de 1, 2, 4,
8, 16 y como máximo 30 segundos; apertura y RESYNC tienen timeout de 8 segundos.
Envía PING cada 22 segundos y espera PONG durante 8 segundos. El servidor además
usa ping de protocolo cada 20 segundos y termina conexiones sin pong en 10 segundos.

Consulta HTTP cada 5 segundos, con timeout de 8 segundos y sin solicitudes
simultáneas. Reacciona a online, offline, visibilitychange visible, pageshow y focus.
Al regresar de una suspensión descarta peticiones congeladas y conexiones viejas.
`stop()` elimina sockets, timers, listeners y aborta HTTP. La vista usa pagehide /
pageshow para limpiar y restaurar también desde la caché de navegación.

Mensajes repetidos o anteriores no repintan ni hacen retroceder el estado.
Snapshots se aplican completos sin voz ni animación de las bolillas perdidas.
La pantalla conserva el tablero y avisa «Reconectando…» o «Sin conexión», indicando
que puede estar desactualizado. Sólo muestra «En vivo» con socket sincronizado.

## Render

Verificado el 7 de septiembre de 2026 mediante conexión real de sólo lectura a
`wss://bingo-virtual-2k5k.onrender.com/ws?sorteo=verificacion-transporte`:

```
HTTP 101
Upgrade: websocket
Connection: upgrade
```

El primer intento agotó 15 segundos; el segundo consiguió el upgrade. Esto no
permite atribuir el primer timeout a una causa concreta. No hubo evidencia de una
configuración incorrecta de Upgrade. No hay nginx intermedio en el servicio Docker:
HTTP y WS comparten el servidor y puerto de Express.

Render soporta WebSockets y puede cerrar conexiones durante reemplazos de instancia:
https://render.com/docs/websocket

## Pruebas

1. `npm run test:live`: 18 pruebas deterministas de cliente con reloj y transporte
   controlados. Incluyen los ocho escenarios solicitados: cinco extracciones sin
   Internet, cambio Wi-Fi/datos, segundo plano, suspensión/desbloqueo, reinicio WS,
   duplicados, pérdida de secuencia y recarga. También prueban heartbeats, máximo
   de backoff, HTTP tardío, fallo inicial y limpieza de recursos.
2. `npm run test:live:server`: 12 subpruebas con PostgreSQL aislado, HTTP y WebSockets
   reales. Verifican commit antes de broadcast, 20 extracciones concurrentes,
   snapshots, rollback, pausa/reanudación/configuración, reinicios, compatibilidad
   con la API anterior y cierre por falta de pong.
3. `npm run test:live:browser`: 9 verificaciones de la vista real en Chromium:
   entrada tardía, red interrumpida durante cinco extracciones, recuperación por
   HTTP sin broadcast, reinicio de ronda y ciclo pagehide/pageshow con un solo WS. También comprueba canto automático,
   historial fijo en móvil, confirmación de contraseña y navegación del organizador.
   Usa CDP; `CHROMIUM_PATH` permite elegir otro ejecutable.

Las pruebas de cambios de red y suspensión simulan esos eventos; no sustituyen
una prueba física en un teléfono con distintos operadores. No se modificaron
partidas ni participantes de producción.

Para integración, crear una base exclusiva cuyo nombre contenga `sync_test`,
aplicar las migraciones con `DATABASE_URL` apuntando a ella y ejecutar:

```bash
TEST_DATABASE_URL="postgresql://.../bingo_sync_test" npm run test:live:server
```

Sin `TEST_DATABASE_URL`, la suite de servidor se marca omitida. Las pruebas del
navegador usan su propio servidor local y no requieren esa base.

## Despliegue

Se agregan dos migraciones no destructivas: `20260907120000_live_sync` y
`20260907121000_legacy_live_sync`. El entrypoint existente aplica `prisma migrate
deploy` antes de iniciar el servidor. Publicar frontend y backend juntos y recargar
las páginas abiertas del organizador y participantes para cargar el nuevo cliente.

## Detalles de registro y juego

El registro compara contraseña y repetición antes de enviar la solicitud, y cada
campo tiene un botón accesible para mostrar/ocultar el texto. El menú del bolillero
permite volver a todas las vistas del organizador; `/auth/me` recupera la sesión
con el JWT existente y devuelve sólo los datos públicos de esa cuenta.

El participante canta enviando `numerosSeries`, con las series cargadas en pantalla.
El servidor busca todos los cartones ganadores de esas series confirmadas dentro
de la transacción de la sala, usando exclusivamente las bolillas persistidas.
Devuelve `ganadores` y mantiene los campos del primer ganador para compatibilidad
con las páginas anteriores. Las marcas manuales no validan un premio.
`npm run test:bingo` comprueba seis casos de detección de ganadores.

### Espectadores, avisos y premios en vivo

La cabecera muestra las conexiones WebSocket de espectadores de la sala. Cada
pestaña cuenta como una conexión; la pantalla del organizador envía
`espectador=0` y no se suma. El heartbeat elimina conexiones que dejaron de
responder. El contador se oculta mientras la conexión no está sincronizada.

El dueño del evento puede publicar texto libre (1 a 280 caracteres) desde los
controles. `POST /eventos-en-vivo/:id/mensaje` exige autenticación, aprobación y
titularidad. El aviso se transmite con `COMMUNITY_UPDATE`, dura 8 segundos y un
nuevo aviso reemplaza al anterior. Los snapshots HTTP y WS incluyen el aviso
vigente para recuperar mensajes perdidos sin reiniciar su duración. Los avisos
son temporales, en memoria, y se pierden al reiniciar el servidor. La presencia y
los avisos corresponden a una instancia, igual que el transporte WS actual.

El panel debajo del tablero muestra nombre, serie y cartón de todos los cantos
validados en la ronda actual. `historialGanadores` se recupera desde CantoBingo,
independientemente de la pausa: reanudar no borra premios; una nueva ronda limpia
el panel y conserva los resultados anteriores en el historial. `SEGUNDA_LINEA`
requiere dos filas completas del mismo cartón contra las bolillas del servidor.
No requiere una migración: el tipo de canto ya es un campo de texto.

Prueba de navegador centrada en la pantalla en vivo (incluye avisos, formulario
del organizador y pantalla móvil): `node tests/live-browser.cjs --live-only`.
