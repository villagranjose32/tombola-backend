'use strict';
(() => {
  const $ = id => document.getElementById(id);
  const API = ['localhost', '127.0.0.1'].includes(location.hostname) && location.port === '8080'
    ? `${location.protocol}//${location.hostname}:4000` : location.origin;
  const clave = 'tombolaOrgToken';
  function destino(usuario) {
    if (usuario.rol === 'ADMIN') return '/admin.html';
    if (usuario.rol === 'ORGANIZADOR') return '/organizador.html';
    throw new Error('La cuenta no tiene un rol válido.');
  }
  async function api(path, body, token) {
    const response = await fetch(API + path, {
      method: body ? 'POST' : 'GET',
      headers: {...(body ? {'Content-Type': 'application/json'} : {}), ...(token ? {Authorization: 'Bearer ' + token} : {})},
      ...(body ? {body: JSON.stringify(body)} : {})
    });
    const data = await response.json();
    if (!response.ok) throw new Error(Object.values(data.detalles?.fieldErrors || {}).flat().join(' ') || data.error || 'No se pudo completar la solicitud.');
    return data;
  }
  function mostrarRegistro(registro) {
    $('login').hidden = registro;
    $('registro').hidden = !registro;
    $('mensaje').textContent = '';
    $(registro ? 'nombre' : 'email').focus();
  }
  $('mostrarLoginPassword').onclick = () => {
    const visible = $('password').type === 'password';
    $('password').type = visible ? 'text' : 'password';
    $('mostrarLoginPassword').setAttribute('aria-pressed', String(visible));
    $('mostrarLoginPassword').setAttribute('aria-label', visible ? 'Ocultar contraseña' : 'Mostrar contraseña');
  };
  $('crearCuenta').onclick = () => mostrarRegistro(true);
  $('volver').onclick = () => mostrarRegistro(false);
  $('mostrarPassword').onclick = () => {
    const visible = $('registroPassword').type === 'password';
    for (const id of ['registroPassword', 'repetirPassword']) $(id).type = visible ? 'text' : 'password';
    $('mostrarPassword').setAttribute('aria-pressed', String(visible));
    $('mostrarPassword').textContent = visible ? 'Ocultar contraseñas' : 'Mostrar contraseñas';
  };
  $('login').onsubmit = async event => {
    event.preventDefault();
    const boton = $('login').querySelector('[type="submit"]');
    boton.disabled = true;
    $('mensaje').textContent = '';
    try {
      const data = await api('/auth/login', {email: $('email').value.trim(), password: $('password').value});
      const pagina = destino(data.usuario);
      sessionStorage.setItem(clave, data.token);
      location.replace(pagina);
    } catch (error) { $('mensaje').textContent = error.message; }
    finally { boton.disabled = false; }
  };
  $('registro').onsubmit = async event => {
    event.preventDefault();
    if ($('registroPassword').value !== $('repetirPassword').value) {
      $('mensaje').textContent = 'Las contraseñas no coinciden.';
      $('repetirPassword').focus();
      return;
    }
    const boton = $('registro').querySelector('[type="submit"]');
    boton.disabled = true;
    try {
      const email = $('registroEmail').value.trim();
      const data = await api('/auth/registro', {nombre: $('nombre').value.trim(), dni: $('dni').value.trim(), telefono: $('telefono').value.trim(), email, password: $('registroPassword').value});
      $('registro').reset();
      $('email').value = email;
      mostrarRegistro(false);
      $('mensaje').textContent = data.mensaje;
    } catch (error) { $('mensaje').textContent = error.message; }
    finally { boton.disabled = false; }
  };
  const token = sessionStorage.getItem(clave);
  if (token) api('/auth/me', null, token).then(usuario => location.replace(destino(usuario))).catch(() => {
    sessionStorage.removeItem(clave);
  });
})();
