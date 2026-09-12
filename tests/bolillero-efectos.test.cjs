const {test}=require('node:test');const assert=require('node:assert/strict');
const Efectos=require('../frontend/bolillero-efectos');
function fixture({reducido=false,oculto=false}={}) {
 const clases=new Set(),attrs=new Map(),timers=new Map();let id=0;
 const cage={classList:{add:c=>clases.add(c),remove:c=>clases.delete(c)},setAttribute:(k,v)=>attrs.set(k,v),removeAttribute:k=>attrs.delete(k)};
 const env={document:{hidden:oculto},matchMedia:()=>({matches:reducido}),setTimeout:(fn,ms)=>{timers.set(++id,{fn,ms});return id},clearTimeout:id=>timers.delete(id)};
 return {efecto:new Efectos(cage,env),clases,attrs,timers};
}
test('Gira antes de revelar y cancela el giro anterior si llega otro estado',()=>{
 const f=fixture(),vistos=[];
 f.efecto.girar(()=>vistos.push(1),true);assert(f.clases.has('spinning'));assert.equal(f.attrs.get('aria-busy'),'true');assert.deepEqual(vistos,[]);
 f.efecto.girar(()=>vistos.push(2),true);assert.equal(f.timers.size,1);
 const [{fn,ms}]=f.timers.values();assert.equal(ms,650);fn();assert.deepEqual(vistos,[2]);assert.equal(f.clases.has('spinning'),false);
});
test('Snapshot, reinicio y navegación cancelan cualquier revelado pendiente',()=>{
 const f=fixture(),vistos=[];f.efecto.girar(()=>vistos.push(1),true);f.efecto.girar(()=>vistos.push('reiniciado'),false);
 assert.equal(f.timers.size,0);assert.deepEqual(vistos,['reiniciado']);
 f.efecto.girar(()=>vistos.push(2),true);f.efecto.cancelar();assert.equal(f.timers.size,0);assert.equal(f.clases.has('spinning'),false);
});
test('Movimiento reducido o página oculta muestran el estado sin giro ni sonido',()=>{
 for(const opcion of [{reducido:true},{oculto:true}]){const f=fixture(opcion);let vistas=0;f.efecto.choques=()=>{throw Error('No debe sonar')};f.efecto.girar(()=>vistas++,true);assert.equal(vistas,1);assert.equal(f.timers.size,0);}
});
test('El sonido requiere activación explícita y funciona sin AudioContext',async()=>{
 const f=fixture();assert.equal(f.efecto.sonido,false);assert.equal(await f.efecto.activarSonido(),false);assert.doesNotThrow(()=>f.efecto.choques());
});

test('El intervalo automático controla giro, mezcla y sonido hasta revelar',()=>{
 const f=fixture();let mezcla,sonido,revelado=false;
 f.efecto.alGirar=ms=>mezcla=ms;f.efecto.choques=ms=>sonido=ms;
 f.efecto.girar(()=>revelado=true,true,5000);
 assert.equal(mezcla,5000);assert.equal(sonido,5000);assert.equal(revelado,false);
 const [{fn,ms}]=f.timers.values();assert.equal(ms,5000);
 fn();assert.equal(revelado,true);assert.equal(f.clases.has('spinning'),false);
});
