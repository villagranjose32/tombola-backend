'use strict';
(() => {
  const params = new URLSearchParams(location.search);
  const token = params.get('sorteo');
  let vista = document.body.dataset.vista;
  const unificado = vista === 'tablero';
  let inicioProgramado = null;
  let enVivo = null;
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
    if (params.get('evento') === '1') url.searchParams.set('evento', '1');
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
        const url = enlace('/tablero-publico.html');
        const aviso = document.createElement('div');
        aviso.innerHTML = `<p>Guardá el enlace del sorteo. En Ver y descargar mis cartones podrás descargarla cuando el organizador confirme el pago.</p><div class="acciones"><button>Copiar enlace del sorteo</button></div>`;
        aviso.querySelector('button').onclick = () => compartir(url);
        $('comprobante').replaceChildren(aviso);
      }
    } catch (error) { $('reservaMensaje').textContent = error.message; }
    finally { boton.disabled = false; }
  };
  async function tablero() {
    const data = await api(ruta);
    if (unificado) presentar(data);
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
    if (bingo) {
      grid.classList.add('series-compra');
      $('contenido').querySelector('.leyenda').textContent = 'Azul: disponible · Amarillo: pendiente de pago · Rojo: vendido';
    }
    for (const item of data.tablero) {
      const numero = bingo ? item.numero : item.valor;
      const boton = document.createElement('button');
      boton.className = 'item ' + item.estado.toLowerCase();
      boton.textContent = String(numero);
      const estado = item.estado === 'LIBRE' ? 'Disponible' : item.estado === 'RESERVADO' ? 'Pendiente' : 'Vendido';
      if (bingo) {
        const etiqueta = document.createElement('span');
        etiqueta.textContent = estado;
        boton.append(etiqueta);
      }
      boton.setAttribute('aria-label', `${bingo ? 'Serie' : 'Número'} ${numero}, ${estado}${bingo ? `, ${item.cantidadCartones} cartones` : ''}`);
      boton.disabled = item.estado !== 'LIBRE' || data.estado !== 'ACTIVO';
      boton.onclick = () => reservar(`${ruta}/${bingo ? 'series' : 'numeros'}/${numero}/reservar`, `Reservar ${bingo ? 'serie' : 'número'} ${numero}`, bingo ? numero : null);
      grid.append(boton);
    }
  }
  let consultaDni;
  function prepararDescarga() {
    $('mensaje').textContent = '';
    consultaDni = DescargaDni.montar($('contenido'), apiBase, () => token);
  }
  async function resultado() {
    const data = await api(params.get('evento') === '1' ? `/vivo/${encodeURIComponent(token)}/resultados` : ruta + '/resultado');
    if (data.tipo === 'BINGO') {
      $('titulo').textContent = data.titulo || 'Resultados del bingo';
      $('mensaje').textContent = data.cantos.length ? 'Consultá los cantos validados y sus cartones.' : 'No hay ganadores aún.';
      $('contenido').innerHTML = Transparencia.resultados(data);
      return;
    }
    $('mensaje').textContent = `Ganador: ${data.ganadorValor}`;
    $('contenido').innerHTML = `<dl>${[['Fecha',new Date(data.sorteadoEn).toLocaleString('es-AR')],['Verificación',data.verificado ? 'El hash coincide' : 'El hash no coincide'],['Semilla',data.semilla],['Hash publicado',data.hashPublicado],['Hash recalculado',data.hashRecalculado]].map(([k,v])=>`<dt>${k}</dt><dd>${escape(v)}</dd>`).join('')}</dl>`;
  }
  async function cargar() {
    if (cargando) return;
    cargando = true;
    try { await (vista === 'descarga' ? consultaDni.buscar() : vista === 'resultado' ? resultado() : tablero()); }
    catch (error) { $('mensaje').textContent = vista === 'resultado' && error.message.includes('todavía no tiene resultado') ? 'Aún no se ha jugado este sorteo.' : error.message; }
    finally { cargando = false; }
  }
  if (!token?.trim()) { $('mensaje').textContent = 'El enlace está incompleto. Pedile el enlace al organizador.'; return; }
  Transparencia.organizador(apiBase, params.get('evento') === '1' ? `/vivo/${encodeURIComponent(token)}` : ruta);
  function presentar(data) {
    inicioProgramado = data.presentacion?.inicioProgramado;
    enVivo = data.enVivo;
    $('premios').replaceChildren();
    const fotos = data.presentacion?.imagenesPremios || [];
    if (fotos.length) {
      const titulo = document.createElement('h2'); titulo.textContent = 'Premios'; $('premios').append(titulo);
      for (const [i, src] of fotos.entries()) {
        const img = document.createElement('img'); img.src = src; img.alt = `Premio ${i + 1}`;
        img.style.cssText = 'width:100%;max-width:280px;max-height:260px;object-fit:contain;border-radius:12px;margin:8px';
        const figura = document.createElement('figure');
        figura.style.cssText = 'display:inline-block;vertical-align:top;max-width:280px;margin:8px';
        img.style.margin = '0'; figura.append(img);
        const descripcion = data.presentacion?.descripcionesPremios?.[i];
        if (descripcion) {
          const texto = document.createElement('figcaption'); texto.textContent = descripcion;
          texto.style.cssText = 'white-space:pre-wrap;overflow-wrap:anywhere;margin-top:8px';
          figura.append(texto);
        }
        $('premios').append(figura);
      }
    }
    document.getElementById('verSeries').hidden = data.tipo !== 'BINGO';
    actualizarCuenta();
  }
  function actualizarCuenta() {
    if (!unificado) return;
    CuentaRegresiva.pintar($('cuentaRegresiva'), inicioProgramado, !!enVivo?.iniciado || enVivo?.estado === 'FINALIZADO');
  }
  async function cambiarVista(nueva) {
    if (cargando) return;
    vista = nueva;
    $('contenido').replaceChildren(); $('mensaje').textContent = '';
    if (vista === 'descarga') { prepararDescarga(); return; }
    if (vista === 'vivo') {
      cargando = true;
      try {
        const data = await api(ruta); presentar(data);
        if (!enVivo) { $('mensaje').textContent = 'El sorteo en vivo aún no ha comenzado.'; return; }
        const frame = document.createElement('iframe');
        frame.title = 'Sorteo en vivo';
        frame.src = '/sorteo-en-vivo.html?modo=espectador&sorteo=' + encodeURIComponent(enVivo.linkToken) + '&integrado=1';
        frame.style.cssText = 'width:100%;height:85vh;border:0';
        $('contenido').append(frame);
      } catch (error) { $('mensaje').textContent = error.message; }
      finally { cargando = false; }
      return;
    }
    await cargar();
  }
  if (unificado) {
    for (const [nombre, destino, id] of [['Comprar / participar', 'tablero', 'verCompra'], ['Ver y descargar mis cartones', 'descarga', 'verSeries'], ['Ingresar al vivo', 'vivo', 'verVivo'], ['Ver resultados', 'resultado', 'verResultados']]) {
      const boton = document.createElement('button'); boton.id = id; boton.textContent = nombre;
      boton.onclick = () => cambiarVista(destino); document.querySelector('.acciones').append(boton);
    }
  }
  $('compartir').hidden = unificado;
  $('actualizar').hidden = unificado;
  $('compartir').onclick = () => compartir(enlace(unificado ? '/tablero-publico.html' : location.pathname, unificado ? null : vista === 'descarga' ? numeroSerie : null));
  $('actualizar').onclick = () => vista === 'vivo' ? cambiarVista('vivo') : cargar;
  if (vista === 'descarga') prepararDescarga();
  if (vista !== 'descarga') cargar();
  let refrescandoPresentacion = false;
  async function refrescarPresentacion() {
    if (!unificado || refrescandoPresentacion) return;
    refrescandoPresentacion = true;
    try { presentar(await api(ruta)); }
    catch { /* Mantener la fecha conocida si se interrumpe la conexión. */ }
    finally { refrescandoPresentacion = false; }
  }
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refrescarPresentacion(); });
  // Actualiza disponibilidad y pagos aunque se haya interrumpido la conexión.
  function actualizarDesdeServidor() {
    if (document.hidden || $('reserva').open) return;
    if (vista === 'tablero') cargar();
    else {
      refrescarPresentacion();
      if (vista === 'resultado') cargar();
    }
  }
  let reloj, timer;
  function detenerRelojes() { clearInterval(reloj); clearInterval(timer); }
  function iniciarRelojes() {
    detenerRelojes();
    if (unificado) reloj = setInterval(actualizarCuenta, 1000);
    timer = setInterval(actualizarDesdeServidor, 15000);
    actualizarCuenta();
  }
  iniciarRelojes();
  window.addEventListener('pagehide', detenerRelojes);
  window.addEventListener('pageshow', () => { iniciarRelojes(); refrescarPresentacion(); });
})();
