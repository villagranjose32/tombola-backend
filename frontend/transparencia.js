'use strict';
window.Transparencia = (() => {
  const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  let solicitud = 0;
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
      box.innerHTML = `<strong>Organizador: ${escape(data.nombre)}</strong><br>DNI: ${escape(data.dni || 'No informado')}<br>Teléfono: ${escape(data.telefono || 'No informado')}`;
    } catch (_) { if (turno === solicitud) box.textContent = 'No se pudieron cargar los datos del organizador.'; }
  }
  function resultados(data) {
    if (!data.cantos?.length) return '<p>Todavía no se registraron cantos de línea o bingo validados.</p>';
    return '<h2>Líneas y bingos validados</h2><div class="resultados-cantos">' + data.cantos.map(c => {
      const bolillas = new Set(c.bolillas);
      return `<article class="resultado-canto"><h3>${c.tipo === 'BINGO' ? 'Bingo' : 'Línea'} · ${escape(c.participante || 'Titular no informado')}</h3>
        <p>${escape(c.evento.titulo)} · Ronda ${c.ronda + 1}<br>Serie ${c.numeroSerie} · Cartón ${c.numeroCarton}<br>${escape(new Date(c.cantadoEn).toLocaleString('es-AR'))}</p>
        <div class="resultado-celdas">${c.contenido.flat().map(n => `<span class="${n === null ? 'vacia' : bolillas.has(n) ? 'extraida' : ''}">${n === null ? '' : escape(n)}</span>`).join('')}</div>
        <details><summary>Ver bolillas extraídas al cantar</summary><p>${c.bolillas.map(escape).join(', ')}</p></details></article>`;
    }).join('') + '</div>';
  }
  return {organizador, resultados};
})();
