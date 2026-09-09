const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const html=fs.readFileSync('frontend/sorteo-en-vivo.html','utf8');
for(const script of html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g))new vm.Script(script[1]);
test('La vista muestra varios titulares, oculta los otros cartones y los recupera al reanudar',()=>{
 const elements={reclamoPublico:{innerHTML:'',dataset:{},classList:{toggle(){},add(){}},scrollIntoView(){}},cartonesEnVivo:{hidden:false}};
 const context={document:{getElementById:id=>elements[id]},escapeHtml:s=>s.replaceAll('<','&lt;')};
 vm.createContext(context);
 vm.runInContext(html.slice(html.indexOf('  function mostrarReclamo(evt)'),html.indexOf('  async function cantarReclamo(tipo)')),context);
 const carton={id:'a',posicion:2,contenido:[[1,2,null]]};
 context.mostrarReclamo({numeroActual:2,bolillas:[1,2],cantos:[{tipo:'LINEA',numeroSerie:1,numeroCarton:2,participante:'Ana',carton},{tipo:'BINGO',numeroSerie:3,numeroCarton:2,participante:'Luis',carton:{...carton,id:'b'}}]});
 assert.equal(elements.cartonesEnVivo.hidden,true);
 assert.match(elements.reclamoPublico.innerHTML,/Ana/);assert.match(elements.reclamoPublico.innerHTML,/Luis/);
 assert.equal((elements.reclamoPublico.innerHTML.match(/class="live-card"/g)||[]).length,2);
 context.mostrarReclamo({cantos:[]});
 assert.equal(elements.cartonesEnVivo.hidden,false);assert.equal(elements.reclamoPublico.innerHTML,'');
});
