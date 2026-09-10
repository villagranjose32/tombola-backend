'use strict';
window.DescargaDni = {
  montar(contenedor, base, obtenerToken) {
    const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    contenedor.innerHTML = `<form class="consulta-dni"><label>DNI del titular<input name="dni" inputmode="numeric" pattern="[0-9]{7,8}" minlength="7" maxlength="8" placeholder="Sin puntos" required></label><button class="btn btn-primary" type="submit">Consultar mis cartones</button></form><p class="mensaje-dni" role="status">Ingresá el DNI con el que reservaste tus series. La descarga se habilita al confirmar el pago.</p><div class="series-dni"></div>`;
    const form = contenedor.querySelector('form');
    const mensaje = contenedor.querySelector('.mensaje-dni');
    const resultados = contenedor.querySelector('.series-dni');
    let consulta = null;
    let buscando = false;
    let version = 0;
    form.oninput = () => { version++; consulta = null; resultados.replaceChildren(); mensaje.textContent = ''; };
    async function buscar() {
      if (buscando || !form.reportValidity()) return;
      const token = obtenerToken();
      if (!token) { mensaje.textContent = 'Ingresá el enlace del sorteo.'; return; }
      const dni = form.elements.dni.value.trim();
      const actual = ++version;
      buscando = true;
      form.querySelector('button').disabled = true;
      consulta = null; resultados.replaceChildren(); mensaje.textContent = 'Buscando cartones…';
      try {
        const response = await fetch(`${base}/s/${encodeURIComponent(token)}/mis-series`, {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({dni})});
        const data = await response.json();
        if (actual !== version) return;
        if (!response.ok) throw new Error(data.error || 'No se pudieron consultar los cartones.');
        consulta = {dni, token};
        const cantidad = data.series.reduce((total, s) => total + s.cartones.length, 0);
        mensaje.textContent = data.series.length ? `${cantidad} cartones en ${data.series.length} series confirmadas.` : 'No encontramos series confirmadas para ese DNI en este sorteo.';
        if (data.pendientes.length) mensaje.textContent += ` Pendientes de pago: series ${data.pendientes.join(', ')}.`;
        resultados.innerHTML = (data.series.length ? '<button class="btn btn-primary" type="button" data-pdf="">Descargar todos mis cartones (PDF)</button>' : '') + data.series.map(s => `<section><h2>Serie ${s.numeroSerie} · ${escape(s.nombre || 'Titular')}</h2><div class="resultados-cantos">${s.cartones.map(c => `<article class="resultado-canto"><h3>Cartón ${c.posicion}</h3><div class="resultado-celdas">${c.contenido.flat().map(n => `<span class="${n === null ? 'vacia' : ''}">${escape(n)}</span>`).join('')}</div></article>`).join('')}</div></section>`).join('');
      } catch (error) { if (actual === version) mensaje.textContent = error.message; }
      finally { buscando = false; form.querySelector('button').disabled = false; }
    }
    form.onsubmit = event => { event.preventDefault(); buscar(); };
    resultados.onclick = async event => {
      const boton = event.target.closest('[data-pdf]');
      if (!boton || boton.disabled || !consulta) return;
      const {dni, token} = consulta;
      boton.disabled = true;
      try {
        const response = await fetch(`${base}/s/${encodeURIComponent(token)}/mis-series/descargar`, {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({dni})});
        if (!response.ok) { const data = await response.json(); throw new Error(data.error || 'No se pudo descargar el PDF.'); }
        const url = URL.createObjectURL(await response.blob());
        const link = document.createElement('a'); link.href = url; link.download = 'mis-cartones.pdf';
        document.body.append(link); link.click(); link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 60000);
      } catch (error) { mensaje.textContent = error.message; }
      finally { boton.disabled = false; }
    };
    return {buscar};
  }
};
