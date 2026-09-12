import { randomUUID } from "crypto";

const espectadores = new Map<string, number>();
const avisos = new Map<string, { id: string; texto: string; expiraEn: number; leerEnVozAlta: boolean }>();

export function comunidadEnVivo(token: string) {
  const aviso = avisos.get(token);
  return { espectadores: espectadores.get(token) || 0, aviso: aviso && aviso.expiraEn > Date.now() ? aviso : null };
}

export function cambiarEspectadores(token: string, cambio: number) {
  const total = Math.max(0, (espectadores.get(token) || 0) + cambio);
  if (total) espectadores.set(token, total);
  else espectadores.delete(token);
  return comunidadEnVivo(token);
}

export function publicarAviso(token: string, texto: string, leerEnVozAlta = false) {
  const aviso = { id: randomUUID(), texto, leerEnVozAlta, expiraEn: Date.now() + 8000 };
  avisos.set(token, aviso);
  setTimeout(() => { if (avisos.get(token)?.id === aviso.id) avisos.delete(token); }, 8000).unref();
  return comunidadEnVivo(token);
}
