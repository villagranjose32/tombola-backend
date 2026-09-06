// Compatibilidad con enlaces compartidos antes de separar las páginas públicas.
(() => {
  const params = new URLSearchParams(location.search);
  const token = params.get('sorteo');
  if (!token) return;
  const url = new URL(params.get('serie') ? '/descargar-serie.html' : '/tablero-publico.html', location.origin);
  url.searchParams.set('sorteo', token);
  if (params.get('serie')) url.searchParams.set('serie', params.get('serie'));
  location.replace(url.href);
})();
