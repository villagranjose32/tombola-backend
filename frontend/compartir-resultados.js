'use strict';
window.CompartirResultados = (() => {
  function montar(panel) {
    const tarjetas = [...panel.querySelectorAll('.resultado-canto, .winner-block')];
    if (!tarjetas.length) return;
    const boton = document.createElement('button');
    boton.type = 'button'; boton.className = 'btn btn-primary';
    boton.textContent = 'Compartir ganadores por WhatsApp';
    panel.prepend(boton);
    boton.onclick = async () => {
      boton.disabled = true;
      const dialog = document.createElement('dialog');
      dialog.style.cssText = 'width:min(760px,95vw);max-height:90vh;overflow:auto;background:#14231c;color:#f2e9d8;border:1px solid #4fa490;border-radius:12px;padding:20px';
      const titulo = document.createElement('h2'); titulo.textContent = 'Compartir ganadores';
      const cerrar = document.createElement('button'); cerrar.className = 'btn btn-ghost'; cerrar.textContent = 'Cerrar'; cerrar.onclick = () => dialog.close();
      const mensaje = document.createElement('p'); mensaje.setAttribute('role', 'status'); mensaje.textContent = 'Preparando imagen…';
      const previews = document.createElement('div');
      const compartir = document.createElement('button'); compartir.className = 'btn btn-primary'; compartir.textContent = 'Compartir por WhatsApp'; compartir.disabled = true;
      const descargas = document.createElement('div'); descargas.style.marginTop = '12px';
      dialog.append(titulo, cerrar, mensaje, previews, compartir, descargas);
      document.body.append(dialog); dialog.showModal();
      const urls = [], archivos = [];
      dialog.addEventListener('close', () => { urls.forEach(URL.revokeObjectURL); dialog.remove(); boton.disabled = false; }, {once:true});
      try {
        // Limita cada imagen para conservar la legibilidad y evitar un canvas gigante.
        for (let inicio = 0; inicio < tarjetas.length; inicio += 6) {
          if (!dialog.open) return;
          const captura = document.createElement('div');
          captura.style.cssText = 'position:absolute;left:-10000px;top:0;width:720px;padding:24px;background:#14231c;color:#f2e9d8;font:16px Arial,sans-serif;box-sizing:border-box';
          const encabezado = document.createElement('h2'); encabezado.textContent = 'Ganadores del sorteo'; captura.append(encabezado);
          const grilla = document.createElement('div'); grilla.style.cssText = 'display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:18px';
          for (const tarjeta of tarjetas.slice(inicio, inicio + 6)) {
            const copia = tarjeta.cloneNode(true);
            copia.querySelectorAll('details, button').forEach(n => n.remove());
            if (copia.matches('.winner-block')) copia.style.gridColumn = '1 / -1';
            grilla.append(copia);
          }
          captura.append(grilla); document.body.append(captura);
          let canvas;
          try { canvas = await html2canvas(captura, {backgroundColor:'#14231c',scale:2,logging:false}); }
          finally { captura.remove(); }
          const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
          canvas.width = canvas.height = 0;
          if (!dialog.open) return;
          if (!blob) throw new Error('No se pudo generar la imagen. Intentá nuevamente.');
          const nombre = `ganadores-${archivos.length + 1}.png`;
          archivos.push(new File([blob], nombre, {type:'image/png'}));
          const url = URL.createObjectURL(blob); urls.push(url);
          const img = document.createElement('img'); img.src = url; img.alt = `Ganadores y cartones, imagen ${archivos.length}`; img.style.cssText = 'display:block;width:100%;margin:12px 0'; previews.append(img);
          const descargar = document.createElement('a'); descargar.className = 'btn btn-ghost'; descargar.href = url; descargar.download = nombre; descargar.textContent = `Descargar imagen ${archivos.length}`; descargas.append(descargar);
        }
        const disponible = navigator.share && navigator.canShare?.({files:archivos});
        compartir.hidden = !disponible; compartir.disabled = false;
        mensaje.textContent = disponible ? 'Elegí WhatsApp en el menú para compartir solo las imágenes.' : 'Descargá las imágenes y adjuntalas en WhatsApp. Este navegador no permite compartir archivos directamente.';
        compartir.onclick = async () => {
          compartir.disabled = true;
          try { await navigator.share({files:archivos}); }
          catch (error) { if (error.name !== 'AbortError') mensaje.textContent = 'No se pudo compartir. Podés descargar las imágenes y adjuntarlas en WhatsApp.'; }
          finally { compartir.disabled = false; }
        };
      } catch (error) { mensaje.textContent = error.message || 'No se pudo preparar la imagen.'; compartir.hidden = true; }
    };
  }
  return {montar};
})();
