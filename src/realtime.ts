import { WebSocketServer, WebSocket } from "ws";
import { Server } from "http";

/**
 * Tiempo real del tablero (números y series).
 *
 * En este proyecto de una sola instancia usamos un pub/sub en
 * memoria: cada conexión WS se suscribe a un sorteo por su
 * link_token, y cuando algo cambia (reserva, confirmación, liberación
 * por TTL vencido) hacemos broadcast a todos los suscriptos a ESE
 * sorteo. Es el equivalente en memoria al LISTEN/NOTIFY de Postgres
 * que describimos en el diseño — si el día de mañana esto corre en
 * varias instancias detrás de un load balancer, ahí sí conviene
 * reemplazar este pub/sub en memoria por LISTEN/NOTIFY real (o Redis
 * pub/sub), para que el broadcast llegue a todas las instancias.
 */

const suscriptores = new Map<string, Set<WebSocket>>();

export function iniciarRealtime(server: Server) {
  const wss = new WebSocketServer({ server, path: "/ws" });

  wss.on("connection", (ws, req) => {
    const url = new URL(req.url || "", "http://localhost");
    const linkToken = url.searchParams.get("sorteo");
    if (!linkToken) {
      ws.close(1008, "Falta ?sorteo=<link_token>");
      return;
    }

    if (!suscriptores.has(linkToken)) suscriptores.set(linkToken, new Set());
    suscriptores.get(linkToken)!.add(ws);

    ws.on("close", () => {
      suscriptores.get(linkToken)?.delete(ws);
    });
  });

  return wss;
}

export function emitirCambio(linkToken: string, evento: Record<string, unknown>) {
  const clientes = suscriptores.get(linkToken);
  if (!clientes) return;
  const payload = JSON.stringify(evento);
  for (const ws of clientes) {
    if (ws.readyState === WebSocket.OPEN) ws.send(payload);
  }
}
