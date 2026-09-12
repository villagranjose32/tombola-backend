(function(root) {
  'use strict';
  function texto(fecha, iniciado, ahora = Date.now()) {
    if (!fecha || iniciado) return '';
    const inicio = new Date(fecha);
    if (!Number.isFinite(inicio.getTime())) return '';
    const segundos = Math.max(0, Math.ceil((inicio.getTime() - ahora) / 1000));
    if (!segundos) return 'Llegó la hora del sorteo. Esperando que el organizador comience.';
    const dos = n => String(n).padStart(2, '0');
    return `Sorteo: ${inicio.toLocaleString('es-AR', {dateStyle:'short', timeStyle:'short'})} · Faltan ${Math.floor(segundos / 86400)} días · ${dos(Math.floor(segundos / 3600) % 24)} h ${dos(Math.floor(segundos / 60) % 60)} min ${dos(segundos % 60)} s`;
  }
  function pintar(elemento, fecha, iniciado) {
    const contenido = texto(fecha, iniciado);
    elemento.hidden = !contenido;
    elemento.textContent = contenido;
  }
  const api = {texto, pintar};
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.CuentaRegresiva = api;
})(typeof window !== 'undefined' ? window : globalThis);
