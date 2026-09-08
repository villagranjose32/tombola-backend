import { WebSocketServer, WebSocket } from "ws";
import { Server } from "http";
import { snapshotPorToken } from "./utils/estadoEnVivo";

const suscriptores = new Map<string, Set<WebSocket>>();

export function iniciarRealtime(server: Server, opciones: {
  cargarSnapshot?: typeof snapshotPorToken;
  heartbeatMs?: number;
  pongTimeoutMs?: number;
} = {}) {
  const leer = opciones.cargarSnapshot || snapshotPorToken;
  const wss = new WebSocketServer({ server, path: "/ws", maxPayload: 4096 });
  const pendientes = new Map<WebSocket, ReturnType<typeof setTimeout>>();
  function enviar(ws: WebSocket, mensaje: unknown) {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(mensaje), error => {
      if (error) ws.terminate();
    });
  }
  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
      if (ws.readyState !== WebSocket.OPEN || pendientes.has(ws)) continue;
      ws.ping(undefined, undefined, error => { if (error) ws.terminate(); });
      pendientes.set(ws, setTimeout(() => {
        pendientes.delete(ws);
        ws.terminate();
      }, opciones.pongTimeoutMs ?? 10000));
    }
  }, opciones.heartbeatMs ?? 20000);
  heartbeat.unref();
  wss.on("close", () => {
    clearInterval(heartbeat);
    pendientes.forEach(clearTimeout);
    pendientes.clear();
  });
  wss.on("connection", (ws, req) => {
    const url = new URL(req.url || "", "http://localhost");
    const linkToken = url.searchParams.get("sorteo");
    if (!linkToken || linkToken.length > 300) { ws.close(1008, "Falta una sala válida"); return; }
    if (!suscriptores.has(linkToken)) suscriptores.set(linkToken, new Set());
    suscriptores.get(linkToken)!.add(ws);
    let sincronizando = false;
    ws.on("pong", () => {
      clearTimeout(pendientes.get(ws));
      pendientes.delete(ws);
    });
    ws.on("error", () => ws.terminate());
    ws.on("message", async raw => {
      let mensaje;
      try { mensaje = JSON.parse(raw.toString()); } catch { return; }
      if (!mensaje || typeof mensaje !== "object") return;
      if (mensaje.type === "PING") { enviar(ws, { type: "PONG", timestamp: new Date().toISOString() }); return; }
      if (mensaje.type !== "RESYNC" || sincronizando) return;
      sincronizando = true;
      try {
        // La suscripción de la conexión limita la sala: nunca leer una sala arbitraria del mensaje.
        const snapshot = await leer(linkToken);
        if (!snapshot) { enviar(ws, { type: "SYNC_ERROR", error: "Sala no encontrada" }); return; }
        if (mensaje.salaId && mensaje.salaId !== snapshot.salaId && mensaje.salaId !== linkToken) {
          enviar(ws, { type: "SYNC_ERROR", error: "La sala no coincide" }); return;
        }
        enviar(ws, { type: "STATE_SNAPSHOT", ...snapshot });
      } catch (error) {
        console.error("Error al resincronizar sala:", error);
        enviar(ws, { type: "SYNC_ERROR", error: "No se pudo recuperar el estado" });
      } finally { sincronizando = false; }
    });
    ws.on("close", () => {
      clearTimeout(pendientes.get(ws));
      pendientes.delete(ws);
      const clientes = suscriptores.get(linkToken);
      clientes?.delete(ws);
      if (!clientes?.size) suscriptores.delete(linkToken);
    });
  });
  return wss;
}

/** Se llama únicamente después del commit. La memoria contiene conexiones, nunca el estado. */
export function emitirCambio(linkToken: string, evento: Record<string, unknown>) {
  const clientes = suscriptores.get(linkToken);
  if (!clientes) return;
  const payload = JSON.stringify(evento);
  for (const ws of clientes) {
    if (ws.bufferedAmount > 1024 * 1024) { ws.terminate(); continue; }
    if (ws.readyState === WebSocket.OPEN) ws.send(payload, error => { if (error) ws.terminate(); });
  }
}
