const {test} = require('node:test');
const assert = require('node:assert/strict');
const voz = require('../frontend/bingo-voz');
for (const [n, texto] of [
  [1,'Uno, el agua.'], [15,'Quince, la quinceañera.'], [22,'Veintidós, los patos.'],
  [30,'Treinta, las flores.'], [33,'Treinta y tres, el Cristo.'], [47,'Cuarenta y siete, San Cono.'],
  [55,'Cincuenta y cinco, la música.'], [66,'Sesenta y seis, las dos mujeres.'],
  [81,'Ochenta y uno, las flores.'], [88,'Ochenta y ocho, el Papa.'], [90,'Noventa, el miedo.']
]) test(`Frase exacta para ${n}`, () => assert.equal(voz.frase(n), texto));
test('Los 90 números tienen una frase y rechaza valores inválidos', () => {
  for(let n=1;n<=90;n++) assert.match(voz.frase(n), /^[^,]+, [^,]+\.$/);
  for(const n of [null,0,91,-1,1.5,'22',NaN]) assert.equal(voz.frase(n),null);
});
test('Cancela antes de hablar una sola vez y conserva español y silencio', () => {
  const calls=[];
  const env={speechSynthesis:{cancel:()=>calls.push('cancel'),speak:u=>calls.push(u)},SpeechSynthesisUtterance:class {constructor(text){this.text=text;}}};
  voz.cantar(22,{gender:'femenina',voice:{lang:'en-US'},volume:.5},env);
  assert.equal(calls.length,2);assert.equal(calls[0],'cancel');
  assert.equal(calls[1].text,'Veintidós, los patos.');assert.equal(calls[1].lang,'es-ES');assert.equal(calls[1].volume,.5);
  voz.cantar(1,{gender:'ninguna'},env);assert.equal(calls.length,3);assert.equal(calls[2],'cancel');
});
