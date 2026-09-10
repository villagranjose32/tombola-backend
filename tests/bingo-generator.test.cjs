const {test} = require('node:test');
const assert = require('node:assert/strict');
const {generarSerieDeterministica: generar} = require('../dist/src/utils/bingoGenerator');
function verificar(cartones, cantidad) {
 assert.equal(cartones.length,cantidad);
 const numeros=[];
 for(const carton of cartones){
  assert.equal(carton.length,3);
  for(const fila of carton){assert.equal(fila.length,9);assert.equal(fila.filter(n=>n!==null).length,5);}
  for(let col=0;col<9;col++){
   const valores=carton.map(f=>f[col]).filter(n=>n!==null);
   assert(valores.length>=1 && valores.length<=3);
   assert.deepEqual(valores,[...valores].sort((a,b)=>a-b));
   for(const n of valores){assert(Number.isInteger(n));assert(n>=(col===0?1:col*10));assert(n<=(col===8?90:col*10+9));numeros.push(n);}
  }
 }
 assert.equal(numeros.length,cantidad*15);
 assert.equal(new Set(numeros).size,numeros.length);
 if(cantidad===6) assert.deepEqual([...numeros].sort((a,b)=>a-b),Array.from({length:90},(_,i)=>i+1));
}
test('Regresión: la serie que dejaba una fila con cuatro números ahora tiene cinco en todas',()=>verificar(generar('regresion-cartones',1,6),6));
test('Miles de series: filas completas, rangos, orden y ausencia de duplicados',()=>{
 for(let cantidad=3;cantidad<=6;cantidad++) for(let serie=1;serie<=2000;serie++) verificar(generar('prueba-'+(serie%13),serie,cantidad),cantidad);
});
test('Generación reproducible y validación de cantidad',()=>{
 assert.deepEqual(generar('sorteo',19,6),generar('sorteo',19,6));
 assert.notDeepEqual(generar('sorteo',19,6),generar('sorteo',20,6));
 for(const cantidad of [0,2,7,3.5,NaN]) assert.throws(()=>generar('sorteo',1,cantidad));
});
