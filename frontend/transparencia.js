'use strict';
window.Transparencia = (() => {
  const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  let solicitud = 0;
  function numeroWhatsapp(telefono) {
    const original = String(telefono || '').trim();
    if (!/^[+0-9()\s.-]+$/.test(original)) return '';
    let numero = original.replace(/\D/g, '');
    if (numero.startsWith('00')) numero = numero.slice(2);
    // Números argentinos registrados con o sin prefijo internacional.
    if (!original.startsWith('+') && !original.startsWith('00') && !numero.startsWith('54')) {
      numero = numero.replace(/^0/, '');
      if (numero.length === 12) numero = numero.replace(/^(\d{2,4})15(\d{6,8})$/, '$1$2');
      if (numero.length !== 10) return '';
      numero = '549' + numero;
    }
    if (/^54\d{10}$/.test(numero)) numero = '549' + numero.slice(2);
    return /^[1-9][0-9]{7,14}$/.test(numero) ? numero : '';
  }
  function agregarContactoYPago(box, data) {
    const numero = numeroWhatsapp(data.telefono);
    if (numero) {
      const enlace = document.createElement('a');
      enlace.className = 'contacto-whatsapp';
      enlace.href = 'https://wa.me/' + numero + '?text=' + encodeURIComponent('Hola, quisiera consultar por el sorteo.');
      enlace.target = '_blank'; enlace.rel = 'noopener noreferrer';
      enlace.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M20.4 3.6A11.8 11.8 0 0 0 1.9 17.9L.3 23.7l6-1.6A11.8 11.8 0 0 0 20.4 3.6ZM12 21.5a9.6 9.6 0 0 1-4.9-1.3l-.4-.2-3.5.9.9-3.4-.2-.4A9.6 9.6 0 1 1 12 21.5Z"/><path d="M8.3 6.5c-.3-.6-.6-.6-.9-.6h-.7c-.3 0-.6.1-.8.4-.3.3-1.1 1.1-1.1 2.6s1.1 3 1.3 3.2c.1.2 2.2 3.5 5.4 4.8 2.7 1.1 3.3.9 3.9.8.6-.1 1.9-.8 2.2-1.6.3-.8.3-1.5.2-1.6-.1-.2-.3-.3-.7-.4l-2.1-1c-.3-.1-.5-.2-.7.2l-1 1.2c-.2.2-.4.2-.7.1a8.5 8.5 0 0 1-2.5-1.5 9.4 9.4 0 0 1-1.7-2.1c-.2-.3 0-.5.1-.6l.5-.6.3-.5c.1-.2.1-.4 0-.6L8.3 6.5Z"/></svg><span>Escribir al organizador por WhatsApp</span>';
      box.append(enlace);
    }
    const datos = ['alias','cbu'].filter(k => typeof data.pago?.[k] === 'string' && data.pago[k]);
    if (!datos.length) return;
    const pago = document.createElement('section'); pago.className = 'datos-pago';
    const titulo = document.createElement('strong'); titulo.textContent = 'Datos para transferir'; pago.append(titulo);
    const aviso = document.createElement('p'); aviso.setAttribute('role','status');
    for (const clave of datos) {
      const nombre = clave === 'alias' ? 'Alias' : 'CBU';
      const label = document.createElement('label'); label.textContent = nombre;
      const valor = document.createElement('input'); valor.readOnly = true; valor.value = data.pago[clave]; valor.setAttribute('aria-label',nombre + ' para transferir');
      label.append(valor);
      const boton = document.createElement('button'); boton.type = 'button'; boton.className = 'copiar-pago'; boton.textContent = 'Copiar ' + nombre;
      boton.onclick = async () => {
        try { await navigator.clipboard.writeText(valor.value); aviso.textContent = nombre + ' copiado.'; }
        catch { valor.focus(); valor.select(); aviso.textContent = 'Seleccionamos el ' + nombre + ' para que puedas copiarlo manualmente.'; }
      };
      pago.append(label, boton);
    }
    pago.append(aviso); box.append(pago);
  }
  async function organizador(base, ruta) {
    const turno = ++solicitud;
    let box = document.getElementById('datosOrganizador');
    if (!box) {
      box = document.createElement('aside'); box.id = 'datosOrganizador';
      box.setAttribute('aria-label', 'Datos del organizador');
      (document.querySelector('header') || document.body).append(box);
    }
    box.textContent = 'Cargando datos del organizador…';
    try {
      const response = await fetch(base + ruta + '/organizador');
      if (!response.ok) throw new Error();
      const data = await response.json();
      if (turno !== solicitud) return;
      box.innerHTML = `<div class="datos-identidad"><strong>Organizador: ${escape(data.nombre)}</strong><span>DNI: ${escape(data.dni || 'No informado')}</span><span>Teléfono: ${escape(data.telefono || 'No informado')}</span></div>`;
      agregarContactoYPago(box, data);
    } catch (_) { if (turno === solicitud) box.textContent = 'No se pudieron cargar los datos del organizador.'; }
  }
  function resultados(data) {
    if (!data.cantos?.length) return '<p>Todavía no se registraron cantos de línea o bingo validados.</p>';
    return '<h2>Líneas y bingos validados</h2><div class="resultados-cantos">' + data.cantos.map(c => {
      const bolillas = new Set(c.bolillas);
      return `<article class="resultado-canto"><h3>${c.tipo === 'BINGO' ? 'Bingo' : c.tipo === 'SEGUNDA_LINEA' ? 'Segunda línea' : 'Primera línea'} · ${escape(c.participante || 'Titular no informado')}</h3>
        <p>${escape(c.evento.titulo)} · Ronda ${c.ronda + 1}<br>Serie ${c.numeroSerie} · Cartón ${c.numeroCarton}<br>${escape(new Date(c.cantadoEn).toLocaleString('es-AR'))}</p>
        <div class="resultado-celdas">${c.contenido.flat().map(n => `<span class="${n === null ? 'vacia' : bolillas.has(n) ? 'extraida' : ''}">${n === null ? '' : escape(n)}</span>`).join('')}</div>
        <details><summary>Ver bolillas extraídas al cantar</summary><p>${c.bolillas.map(escape).join(', ')}</p></details></article>`;
    }).join('') + '</div>';
  }
  return {organizador, resultados};
})();
