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

const {acumularCantos}=require('../dist/src/utils/ganadoresBingo');
test('Acumula cantos de diferentes titulares y premios sin duplicarlos',()=>{
 const first=detectarGanadores([{numero:1,participante:{nombre:'Ana'},cartones:[card(1)]}],Array.from({length:15},(_,i)=>i+1),'BINGO');
 const second=detectarGanadores([{numero:2,participante:{nombre:'Luis'},cartones:[{...card(2),id:'otro'}]}],Array.from({length:15},(_,i)=>i+1),'BINGO');
 let cantos=acumularCantos([],first,'LINEA',15);
 cantos=acumularCantos(cantos,second,'BINGO',15);
 cantos=acumularCantos(cantos,first,'LINEA',15);
 assert.equal(cantos.length,2);
 assert.deepEqual(cantos.map(c=>c.participante),['Ana','Luis']);
 assert.deepEqual(acumularCantos(cantos,second,'LINEA',16).map(c=>c.participante),['Luis']);
});

test('Segunda línea acepta otro cartón con una línea y exige otra fila al ganador anterior',()=>{
 assert.equal(detectarGanadores(series,[1,2,3,4,5],'SEGUNDA_LINEA',new Set(['otro-carton']))[0].numeroCarton,2);
 assert.deepEqual(detectarGanadores(series,[1,2,3,4,5],'SEGUNDA_LINEA',new Set(['carton2'])),[]);
 assert.equal(detectarGanadores(series,[1,2,3,4,5,6,7,8,9,10],'SEGUNDA_LINEA',new Set(['carton2']))[0].numeroCarton,2);
 const distintas=[{numero:1,participante:null,cartones:[card(1),card(2,30)]}];
 assert.deepEqual(detectarGanadores(distintas,[1,2,3,4,5,30,31,32,33,34],'SEGUNDA_LINEA',new Set(['carton1'])).map(x=>x.numeroCarton),[2]);
});
