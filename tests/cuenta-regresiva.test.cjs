const {test}=require('node:test');
const assert=require('node:assert/strict');
const {texto}=require('../frontend/cuenta-regresiva');
const ahora=Date.parse('2030-01-01T12:00:00Z');
test('Cuenta días, horas, minutos y segundos a partir del instante programado',()=>{
 assert.match(texto('2030-01-02T15:04:05Z',false,ahora),/1 días · 03 h 04 min 05 s/);
 assert.equal(texto('2030-01-02T12:04:05-03:00',false,ahora),texto('2030-01-02T15:04:05Z',false,ahora));
});
test('Solo desaparece al comenzar o quitar la fecha; nunca muestra negativos',()=>{
 assert.equal(texto(null,false,ahora),'');assert.equal(texto('inválida',false,ahora),'');
 assert.equal(texto('2030-01-02T15:04:05Z',true,ahora),'');
 assert.match(texto('2030-01-01T11:00:00Z',false,ahora),/Esperando/);
 assert.match(texto('2030-01-01T12:00:00.100Z',false,ahora),/01 s$/);
});
