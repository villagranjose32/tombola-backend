'use strict';
(() => {
  const params = new URLSearchParams(location.search);
  const token = params.get('sorteo');
  const vista = document.body.dataset.vista;
  const $ = id => document.getElementById(id);
  const apiBase = ['localhost', '127.0.0.1'].includes(location.hostname) && location.port === '8080'
    ? `${location.protocol}//${location.hostname}:4000` : location.origin;
  const ruta = `/s/${encodeURIComponent(token || '')}`;
  const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  let seleccion = null;
  let cargando = false;
  let numeroSerie = params.get('serie') || '';
  function enlace(pagina, serie) {
    const url = new URL(pagina, location.origin);
    url.searchParams.set('sorteo', token);
    if (serie) url.searchParams.set('serie', serie);
    return url.href;
  }
  async function compartir(url) {
    try {
      if (navigator.share) await navigator.share({title: $('titulo').textContent, url});
      else { await navigator.clipboard.writeText(url); $('mensaje').textContent = 'Enlace copiado.'; }
    } catch (error) {
      if (error.name !== 'AbortError') window.prompt('Copiá este enlace:', url);
    }
  }
  async function api(path, body) {
    const response = await fetch(apiBase + path, body ? {
      method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(body)
    } : {});
    let data;
    try { data = await response.json(); } catch { throw new Error('No se pudo conectar con el sorteo. Intentá nuevamente.'); }
    if (!response.ok) throw new Error(data.error || 'No se pudo completar la solicitud.');
    return data;
  }
  function reservar(path, titulo, serie) {
    seleccion = {path, serie};
    $('formReserva').reset();
    $('reservaTitulo').textContent = titulo;
    $('reservaMensaje').textContent = 'La reserva queda pendiente de pago hasta que el organizador la confirme.';
    $('reserva').showModal();
  }
  $('cancelar').onclick = () => $('reserva').close();
  $('formReserva').onsubmit = async event => {
    event.preventDefault();
    const boton = event.submitter;
    boton.disabled = true;
    const datos = new FormData(event.target);
    try {
      const data = await api(seleccion.path, {nombre: datos.get('nombre').trim(), dni: datos.get('dni').trim(), telefono: datos.get('telefono').trim()});
      $('reserva').close();
      await cargar();
      $('mensaje').textContent = data.mensaje;
      if (seleccion.serie) {
        const url = enlace('/descargar-serie.html', seleccion.serie);
        const aviso = document.createElement('div');
        aviso.innerHTML = `<p>Guardá el enlace de tu serie. Podrás descargarla cuando el organizador confirme el pago.</p><div class="acciones"><a class="enlace" href="${escape(url)}">Ver mi serie</a><button>Copiar enlace de mi serie</button></div>`;
        aviso.querySelector('button').onclick = () => compartir(url);
        $('comprobante').replaceChildren(aviso);
      }
    } catch (error) { $('reservaMensaje').textContent = error.message; }
    finally { boton.disabled = false; }
  };
  async function tablero() {
    const data = await api(ruta);
    $('titulo').textContent = data.titulo;
    $('descripcion').textContent = data.descripcion || '';
    $('mensaje').textContent = `Estado: ${data.estado}.`;
    $('contenido').replaceChildren();
    if (data.tipo === 'SORTEO_SIMPLE') {
      $('contenido').innerHTML = `<p>Inscriptos confirmados: ${escape(data.cantidadInscriptos)}</p><button id="participar">Quiero participar</button>`;
      $('participar').disabled = data.estado !== 'ACTIVO';
      $('participar').onclick = () => reservar(ruta + '/participar', 'Participar en el sorteo');
      return;
    }
    const bingo = data.tipo === 'BINGO';
    $('contenido').innerHTML = '<p class="leyenda">Verde: disponible · Amarillo: pendiente de pago · Oscuro: vendido</p><div class="grid"></div>';
    const grid = $('contenido').querySelector('.grid');
    for (const item of data.tablero) {
      const numero = bingo ? item.numero : item.valor;
      const boton = document.createElement('button');
      boton.className = 'item ' + item.estado.toLowerCase();
      boton.textContent = String(numero);
      const estado = item.estado === 'LIBRE' ? 'Disponible' : item.estado === 'RESERVADO' ? 'Pendiente' : 'Vendido';
      boton.setAttribute('aria-label', `${bingo ? 'Serie' : 'Número'} ${numero}, ${estado}${bingo ? `, ${item.cantidadCartones} cartones` : ''}`);
      boton.disabled = item.estado !== 'LIBRE' || data.estado !== 'ACTIVO';
      boton.onclick = () => reservar(`${ruta}/${bingo ? 'series' : 'numeros'}/${numero}/reservar`, `Reservar ${bingo ? 'serie' : 'número'} ${numero}`, bingo ? numero : null);
      grid.append(boton);
    }
  }
  function prepararDescarga() {
    $('contenido').innerHTML = `<form id="formSerie"><label>Número de serie<input id="serie" type="number" min="1" step="1" required value="${escape(numeroSerie)}"></label><button>Consultar mi serie</button></form><div id="cartones"></div>`;
    $('formSerie').onsubmit = event => {
      event.preventDefault();
      numeroSerie = $('serie').value;
      history.replaceState(null, '', enlace('/descargar-serie.html', numeroSerie));
      cargar();
    };
  }
  async function descarga() {
    $('cartones').replaceChildren();
    if (!numeroSerie) { $('mensaje').textContent = 'Ingresá tu número de serie. La descarga se habilita después de confirmar el pago.'; return; }
    if (!Number.isInteger(Number(numeroSerie)) || Number(numeroSerie) < 1) throw new Error('Ingresá un número de serie válido.');
    const data = await api(`${ruta}/mi-serie?numeroSerie=${encodeURIComponent(numeroSerie)}`);
    $('mensaje').textContent = `Serie ${data.numeroSerie} confirmada.`;
    const pdf = `${apiBase}${ruta}/mi-serie/descargar?numeroSerie=${encodeURIComponent(numeroSerie)}`;
    $('cartones').innerHTML = `<div class="acciones"><a class="enlace" href="${escape(pdf)}" target="_blank" rel="noopener">Descargar PDF</a></div><div class="cartones">${data.cartones.map(c => `<article class="carton"><h2>Cartón ${escape(c.posicion)}</h2><div class="celdas">${c.contenido.flat().map(n => `<div class="celda ${n === null ? 'vacia' : ''}">${escape(n)}</div>`).join('')}</div></article>`).join('')}</div>`;
  }
  async function resultado() {
    const data = await api(ruta + '/resultado');
    $('mensaje').textContent = `Ganador: ${data.ganadorValor}`;
    $('contenido').innerHTML = `<dl>${[['Fecha',new Date(data.sorteadoEn).toLocaleString('es-AR')],['Verificación',data.verificado ? 'El hash coincide' : 'El hash no coincide'],['Semilla',data.semilla],['Hash publicado',data.hashPublicado],['Hash recalculado',data.hashRecalculado]].map(([k,v])=>`<dt>${k}</dt><dd>${escape(v)}</dd>`).join('')}</dl>`;
  }
  async function cargar() {
    if (cargando) return;
    cargando = true;
    try { await (vista === 'descarga' ? descarga() : vista === 'resultado' ? resultado() : tablero()); }
    catch (error) { $('mensaje').textContent = error.message; }
    finally { cargando = false; }
  }
  if (!token?.trim()) { $('mensaje').textContent = 'El enlace está incompleto. Pedile el enlace al organizador.'; return; }
  $('compartir').hidden = false;
  $('actualizar').hidden = false;
  $('compartir').onclick = () => compartir(enlace(location.pathname, vista === 'descarga' ? numeroSerie : null));
  $('actualizar').onclick = cargar;
  if (vista === 'descarga') prepararDescarga();
  cargar();
  // Actualiza disponibilidad y pagos aunque se haya interrumpido la conexión.
  const timer = setInterval(() => {
    if (!document.hidden && !$('reserva').open && vista === 'tablero') cargar();
  }, 15000);
  window.addEventListener('pagehide', () => clearInterval(timer), {once:true});
})();
