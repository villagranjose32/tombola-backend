const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
function iniciar(rol) {
  const elements = new Map();
  const get = id => {
    if (!elements.has(id)) elements.set(id, {value: '', hidden: false, type: 'password', textContent: '', focus() {}, reset() {}, setAttribute() {}, querySelector() {return get(id + '-submit');}});
    return elements.get(id);
  };
  const storage = new Map();
  const calls = [];
  const location = {hostname: 'example.com', origin: 'https://example.com', replace(url) {this.redirect = url;}};
  vm.runInNewContext(fs.readFileSync('frontend/login.js', 'utf8'), {
    document: {getElementById: get}, location,
    sessionStorage: {getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key)},
    fetch: async (url, options) => {calls.push({url, options}); return {ok: true, json: async () => ({token: 'token-prueba', usuario: {rol}, mensaje: 'Cuenta pendiente de aprobación'})};}
  });
  return {get, storage, calls, location};
}
for (const [rol, pagina] of [['ADMIN', '/admin.html'], ['ORGANIZADOR', '/organizador.html']]) {
  test(`El ingreso de ${rol} abre su panel`, async () => {
    const app = iniciar(rol);
    app.get('email').value = 'cuenta@example.com';
    app.get('password').value = 'password123';
    await app.get('login').onsubmit({preventDefault() {}});
    assert.equal(app.location.redirect, pagina);
    assert.equal(app.storage.get('tombolaOrgToken'), 'token-prueba');
    assert.deepEqual(JSON.parse(app.calls[0].options.body), {email: 'cuenta@example.com', password: 'password123'});
  });
}
test('Registro valida confirmación y envía solo los datos del organizador', async () => {
  const app = iniciar('ORGANIZADOR');
  app.get('registroPassword').value = 'password123';
  app.get('repetirPassword').value = 'distinta';
  await app.get('registro').onsubmit({preventDefault() {}});
  assert.equal(app.calls.length, 0);
  app.get('repetirPassword').value = 'password123';
  app.get('nombre').value = 'Club';
  app.get('registroEmail').value = 'club@example.com';
  await app.get('registro').onsubmit({preventDefault() {}});
  assert.equal(app.calls[0].url, 'https://example.com/auth/registro');
  assert.deepEqual(JSON.parse(app.calls[0].options.body), {nombre: 'Club', email: 'club@example.com', password: 'password123'});
  assert.equal(app.get('registro').hidden, true);
  assert.equal(app.get('mensaje').textContent, 'Cuenta pendiente de aprobación');
});
