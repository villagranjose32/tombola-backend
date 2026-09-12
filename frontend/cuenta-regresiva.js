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
  const vistas = new WeakMap();
  function pintar(elemento, fecha, iniciado) {
    let vista = vistas.get(elemento);
    if (!vista) {
      const mensaje = elemento.ownerDocument.createElement('span');
      mensaje.setAttribute('role', 'timer');
      const cerrar = elemento.ownerDocument.createElement('button');
      cerrar.type = 'button'; cerrar.className = 'cerrar-cuenta'; cerrar.textContent = '×';
      cerrar.setAttribute('aria-label', 'Cerrar aviso de la hora del sorteo');
      cerrar.title = 'Cerrar aviso';
      vista = {mensaje, cerrar, clave: null, cerrado: false};
      cerrar.onclick = () => {
        vista.cerrado = true;
        elemento.hidden = true;
        try { root.sessionStorage.setItem(vista.clave, '1'); } catch { /* Sigue cerrado aunque no haya almacenamiento. */ }
      };
      elemento.replaceChildren(mensaje, cerrar);
      vistas.set(elemento, vista);
    }
    const sorteo = new URLSearchParams(root.location?.search || '').get('sorteo') || '';
    const clave = 'bingo-aviso-hora:' + sorteo + ':' + fecha;
    if (vista.clave !== clave) {
      vista.clave = clave;
      try { vista.cerrado = root.sessionStorage.getItem(clave) === '1'; }
      catch { vista.cerrado = false; }
    }
    const contenido = texto(fecha, iniciado);
    elemento.hidden = !contenido || vista.cerrado;
    vista.mensaje.textContent = contenido;
    vista.cerrar.hidden = !contenido || Date.parse(fecha) > Date.now();
  }
  const api = {texto, pintar};
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.CuentaRegresiva = api;
})(typeof window !== 'undefined' ? window : globalThis);
