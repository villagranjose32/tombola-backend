const {test}=require('node:test');
const assert=require('node:assert/strict');
const {detectarGanadores}=require('../dist/src/utils/ganadoresBingo');
const card=(pos,start=1)=>({id:'carton'+pos,posicion:pos,contenido:Array.from({length:3},(_,r)=>[...Array.from({length:5},(_,i)=>start+r*5+i),null,null,null,null])});
const series=[{numero:1,participante:null,cartones:[card(1,50)]},{numero:2,participante:{nombre:'Participante'},cartones:[card(1,30),card(2)]}];
test('Detecta automáticamente cartón de la segunda serie y segunda posición',()=>{
 const r=detectarGanadores(series,[1,2,3,4,5],'LINEA');assert.equal(r.length,1);assert.equal(r[0].numeroSerie,2);assert.equal(r[0].numeroCarton,2);
});
test('Una línea no alcanza para cantar bingo',()=>assert.deepEqual(detectarGanadores(series,[1,2,3,4,5],'BINGO'),[]));
test('Detecta línea en cualquier fila',()=>assert.equal(detectarGanadores(series,[6,7,8,9,10],'LINEA')[0].numeroCarton,2));
test('Detecta bingo con las quince bolillas extraídas',()=>assert.equal(detectarGanadores(series,Array.from({length:15},(_,i)=>i+1),'BINGO')[0].numeroCarton,2));
test('Devuelve todos los cartones ganadores, sin exigir selección',()=>{
 const r=detectarGanadores([{numero:7,participante:null,cartones:[card(1),card(2)]}],Array.from({length:15},(_,i)=>i+1),'BINGO');assert.deepEqual(r.map(x=>x.numeroCarton),[1,2]);
});
test('Filas vacías y marcas manuales no producen ganadores',()=>{
 assert.deepEqual(detectarGanadores([{numero:1,participante:null,cartones:[{id:'a',posicion:1,contenido:[[null,null,null]]}],marcas:{a:[1,2,3]}}],[],'LINEA'),[]);
 assert.deepEqual(detectarGanadores(series,[],'BINGO'),[]);
});
