import "dotenv/config";
import express from "express";
import cors from "cors";
import http from "http";
import path from "path";
import { authRouter } from "./routes/auth.routes";
import { adminRouter } from "./routes/admin.routes";
import { sorteosRouter } from "./routes/sorteos.routes";
import { publicoRouter } from "./routes/publico.routes";
import { errorHandler } from "./middleware/errorHandler";
import { iniciarRealtime } from "./realtime";
import { iniciarLimpiezaReservas } from "./jobs/liberarReservasVencidas";
import { eventosEnVivoRouter, eventosEnVivoPublicoRouter } from "./routes/eventosEnVivo.routes";

const app = express();
app.use(cors());
app.use("/sorteos/:id/presentacion", express.json({ limit: "4mb" }));
app.use(express.json());

app.get("/health", (_req, res) => res.json({ ok: true }));

app.use("/auth", authRouter);
app.use("/admin", adminRouter);
app.use("/sorteos", sorteosRouter);
app.use("/s", publicoRouter); // rutas públicas, sin auth: /s/:token/...
app.use("/eventos-en-vivo", eventosEnVivoRouter);
app.use("/vivo", eventosEnVivoPublicoRouter);

// En producción el frontend se sirve desde el mismo dominio que la API.
app.use(express.static(path.join(process.cwd(), "frontend")));

app.use(errorHandler);

const server = http.createServer(app);
iniciarRealtime(server); // WS en /ws?sorteo=<link_token>
iniciarLimpiezaReservas(); // libera números/series con reserva vencida cada 60s

const PORT = Number(process.env.PORT) || 4000;
server.listen(PORT, () => {
  console.log(`Bingo Virtual backend escuchando en http://localhost:${PORT}`);
  console.log(`WebSocket en ws://localhost:${PORT}/ws?sorteo=<link_token>`);
});
