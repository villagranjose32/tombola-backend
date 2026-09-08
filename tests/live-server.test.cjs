const {test} = require('node:test');
const assert = require('node:assert/strict');
const {once} = require('node:events');
const http = require('node:http');
const crypto = require('node:crypto');
const express = require('express');
const WebSocket = require('ws');
const database = process.env.TEST_DATABASE_URL;
if (database && !new URL(database).pathname.includes('sync_test')) throw new Error('Usá una base aislada cuyo nombre incluya sync_test');
if(database)process.env.DATABASE_URL=database;
const {prisma} = require('../dist/src/db');
const {iniciarRealtime} = require('../dist/src/realtime');
const {modificarEvento} = require('../dist/src/utils/estadoEnVivo');
const {eventosEnVivoRouter,eventosEnVivoPublicoRouter} = require('../dist/src/routes/eventosEnVivo.routes');
const {authRouter} = require('../dist/src/routes/auth.routes');
const {sorteosRouter} = require('../dist/src/routes/sorteos.routes');
const {firmarToken} = require('../dist/src/middleware/auth');
const {errorHandler} = require('../dist/src/middleware/errorHandler');
function message(ws,predicate) {
 return new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>{ws.off('message',listener);reject(new Error('No llegó mensaje esperado'));},4000);
  const listener=raw=>{const value=JSON.parse(raw);if(predicate(value)){clearTimeout(timer);ws.off('message',listener);resolve(value);}};
  ws.on('message',listener);
 });
}
test('Servidor PostgreSQL + HTTP + WebSocket', {skip:!database,timeout:40000}, async t=>{
 const user=await prisma.usuario.create({data:{nombre:'Sync Test',email:crypto.randomUUID()+'@example.test',passwordHash:'unused',estado:'APROBADO'}});
 const evento=await prisma.eventoEnVivo.create({data:{organizadorId:user.id,titulo:'Test',linkToken:crypto.randomUUID(),modo:'BINGO',rangoMax:90}});
 const app=express();app.use(express.json());app.use('/auth',authRouter);app.use('/sorteos',sorteosRouter);app.use('/eventos-en-vivo',eventosEnVivoRouter);app.use('/vivo',eventosEnVivoPublicoRouter);app.use(errorHandler);
 const server=http.createServer(app);let wss=iniciarRealtime(server);
 server.listen(0,'127.0.0.1');await once(server,'listening');const base='http://127.0.0.1:'+server.address().port;
 const sockets=new Set();
 async function open(options={},token=evento.linkToken){const ws=new WebSocket(base.replace('http','ws')+'/ws?sorteo='+token,options);sockets.add(ws);await once(ws,'open');return ws;}
 async function request(action,body){const res=await fetch(base+'/eventos-en-vivo/'+evento.id+'/'+action,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+firmarToken({sub:user.id,rol:'ORGANIZADOR'})},body:body?JSON.stringify(body):undefined});return {res,data:await res.json()};}
 try{
 await t.test('Upgrade 101 y RESYNC con todos los campos persistidos',async()=>{
   const ws=new WebSocket(base.replace('http','ws')+'/ws?sorteo='+evento.linkToken);sockets.add(ws);
   const opened=once(ws,'open');
   const [upgrade]=await once(ws,'upgrade');assert.equal(upgrade.statusCode,101);assert.equal(upgrade.headers.upgrade,'websocket');assert.equal(upgrade.headers.connection.toLowerCase(),'upgrade');
   await opened;const reply=message(ws,x=>x.type==='STATE_SNAPSHOT');ws.send(JSON.stringify({type:'RESYNC',salaId:evento.id}));
   const s=await reply;assert.equal(s.salaId,evento.id);assert.equal(s.secuencia,0);assert.equal(s.numeroActual,null);assert.deepEqual(s.numerosExtraidos,[]);assert.equal(s.estado,'EN_CURSO');assert(Number.isFinite(Date.parse(s.timestamp)));
 });
 await t.test('Extracción se confirma en PostgreSQL antes del broadcast',async()=>{
   const ws=await open();const update=message(ws,x=>x.type==='STATE_UPDATE');const action=request('extraer');const evt=await update;
   const saved=await prisma.eventoEnVivo.findUnique({where:{id:evento.id}});
   assert.equal(saved.secuencia,evt.secuencia);assert.deepEqual(saved.bolillas,evt.numerosExtraidos);assert.equal(evt.numeroActual,saved.bolillas.at(-1));assert.equal((await action).res.status,200);
 });
 await t.test('20 extracciones concurrentes no pierden números ni secuencias',async()=>{
   const results=await Promise.all(Array.from({length:20},()=>request('extraer')));assert(results.every(r=>r.res.status===200));
   const saved=await prisma.eventoEnVivo.findUnique({where:{id:evento.id}});assert.equal(saved.secuencia,21);assert.equal(saved.bolillas.length,21);assert.equal(new Set(saved.bolillas).size,21);
   assert.deepEqual(results.map(r=>r.data.tablero.secuencia).sort((a,b)=>a-b),Array.from({length:20},(_,i)=>i+2));
 });
 await t.test('HTTP snapshot sin caché recupera cinco extracciones sin conexión',async()=>{
   for(const ws of sockets)ws.terminate();sockets.clear();for(let i=0;i<5;i++)await request('extraer');
   const response=await fetch(base+'/vivo/'+evento.linkToken);const data=await response.json();assert.equal(response.headers.get('cache-control'),'no-store');assert.equal(data.secuencia,26);assert.equal(data.numerosExtraidos.length,26);
   const ws=await open();const reply=message(ws,x=>x.type==='STATE_SNAPSHOT');ws.send(JSON.stringify({type:'RESYNC',salaId:evento.id}));assert.deepEqual((await reply).numerosExtraidos,data.numerosExtraidos);
 });
 await t.test('Rollback no altera estado ni secuencia',async()=>{
   await assert.rejects(modificarEvento(evento.id,user.id,async(e,tx)=>{await tx.eventoEnVivo.update({where:{id:e.id},data:{secuencia:{increment:1},bolillas:[]}});throw new Error('rollback');}));
   const saved=await prisma.eventoEnVivo.findUnique({where:{id:evento.id}});assert.equal(saved.secuencia,26);assert.equal(saved.bolillas.length,26);
 });
 await t.test('Reiniciar sala conserva secuencia creciente y cambia ronda',async()=>{
   const r=await request('reiniciar');assert.equal(r.data.secuencia,27);assert.equal(r.data.ronda,1);assert.deepEqual(r.data.numerosExtraidos,[]);assert.equal(r.data.numeroActual,null);
 });
 await t.test('API anterior: extracciones concurrentes, RESYNC y reinicio conservan secuencia',async()=>{
   const bingo=await prisma.sorteo.create({data:{organizadorId:user.id,tipo:'BINGO',titulo:'Legacy test',linkToken:crypto.randomUUID()}});
   try {
     const post=async(action)=>{const r=await fetch(base+'/sorteos/'+bingo.id+'/en-vivo/'+action,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+firmarToken({sub:user.id,rol:'ORGANIZADOR'})},body:'{}'});assert.equal(r.status,200);return r.json();};
     await post('iniciar');await Promise.all(Array.from({length:8},()=>post('extraer')));
     const ws=await open({},bingo.linkToken);const reply=message(ws,x=>x.type==='STATE_SNAPSHOT');ws.send(JSON.stringify({type:'RESYNC'}));const state=await reply;
     assert.equal(state.secuencia,8);assert.equal(state.numerosExtraidos.length,8);assert.equal(new Set(state.numerosExtraidos).size,8);
     const restarted=await post('reiniciar');assert.equal(restarted.secuencia,9);assert.equal(restarted.ronda,1);
     const response=await fetch(base+'/vivo/'+bingo.linkToken);assert.deepEqual((await response.json()).numerosExtraidos,[]);
   } finally { await prisma.tableroEnVivo.deleteMany({where:{sorteoId:bingo.id}});await prisma.sorteo.delete({where:{id:bingo.id}}); }
 });
 await t.test('Reinicio del servidor WS recupera desde PostgreSQL y heartbeat responde',async()=>{
   for(const ws of sockets)ws.terminate();sockets.clear();await new Promise(r=>wss.close(r));
   wss=iniciarRealtime(server,{heartbeatMs:80,pongTimeoutMs:40});const ws=await open();const reply=message(ws,x=>x.type==='STATE_SNAPSHOT');ws.send(JSON.stringify({type:'RESYNC'}));assert.equal((await reply).secuencia,27);
   const pong=message(ws,x=>x.type==='PONG');ws.send(JSON.stringify({type:'PING'}));assert((await pong).timestamp);
   const other=message(ws,x=>x.type==='SYNC_ERROR');ws.send(JSON.stringify({type:'RESYNC',salaId:'otra-sala'}));assert.equal((await other).error,'La sala no coincide');
 });
 await t.test('Servidor termina un socket muerto sin pong',async()=>{
   const ws=await open({autoPong:false});await once(ws,'close');assert.equal(ws.readyState,WebSocket.CLOSED);
 });
 await t.test('Bingo validado, reanudación y configuración incrementan secuencia con snapshot consistente',async()=>{
   const bingo=await prisma.sorteo.create({data:{organizadorId:user.id,tipo:'BINGO',titulo:'Claims test'}});
   const serie=await prisma.serie.create({data:{sorteoId:bingo.id,numero:1,cantidadCartones:1,estado:'TOMADO',cartones:{create:{posicion:1,contenido:[[1,2,3,4,5,null,null,null,null],[6,7,8,9,10,null,null,null,null],[11,12,13,14,15,null,null,null,null]]}}}});
   try {
     await modificarEvento(evento.id,user.id,(e,tx)=>tx.eventoEnVivo.update({where:{id:e.id},data:{sorteoBingoId:bingo.id,bolillas:Array.from({length:15},(_,i)=>i+1),secuencia:{increment:1}}}));
     const ws=await open();const update=message(ws,x=>x.type==='STATE_UPDATE'&&x.tipo==='reclamo');
     const r=await fetch(base+'/vivo/'+evento.linkToken+'/cantar',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({numeroSerie:1,numeroCarton:1,tipo:'BINGO'})});assert.equal(r.status,200);
     const paused=await update;assert.equal(paused.estado,'PAUSADO');assert.equal(paused.secuencia,29);assert.equal(paused.numeroActual,15);
     assert.equal((await request('reanudar')).data.secuencia,30);
     const config=await request('configurar',{titulo:'Configurado',modo:'BINGO',rangoMax:90,sorteoBingoId:bingo.id});assert.equal(config.data.secuencia,31);assert.equal(config.data.ronda,2);assert.deepEqual(config.data.numerosExtraidos,[]);
   } finally {
     await prisma.eventoEnVivo.update({where:{id:evento.id},data:{sorteoBingoId:null}});
     await prisma.carton.deleteMany({where:{serieId:serie.id}});await prisma.serie.delete({where:{id:serie.id}});await prisma.sorteo.delete({where:{id:bingo.id}});
   }
 });
 await t.test('Sesión del organizador se recupera sin exponer contraseña',async()=>{
   const r=await fetch(base+'/auth/me',{headers:{Authorization:'Bearer '+firmarToken({sub:user.id,rol:'ORGANIZADOR'})}});const data=await r.json();
   assert.equal(r.status,200);assert.equal(data.id,user.id);assert.equal(data.passwordHash,undefined);assert.equal((await fetch(base+'/auth/me')).status,401);
 });
 await t.test('Canto automático revisa todas las series confirmadas y rechaza bingo incompleto',async()=>{
   const bingo=await prisma.sorteo.create({data:{organizadorId:user.id,tipo:'BINGO',titulo:'Auto test'}});
   const card=(pos,start)=>({posicion:pos,contenido:Array.from({length:3},(_,r)=>[...Array.from({length:5},(_,i)=>start+r*5+i),null,null,null,null])});
   const a=await prisma.serie.create({data:{sorteoId:bingo.id,numero:1,cantidadCartones:1,estado:'TOMADO',cartones:{create:[card(1,50)]}}});
   const b=await prisma.serie.create({data:{sorteoId:bingo.id,numero:2,cantidadCartones:2,estado:'TOMADO',cartones:{create:[card(1,30),card(2,1)]}}});
   const c=await prisma.serie.create({data:{sorteoId:bingo.id,numero:3,cantidadCartones:1,estado:'RESERVADO',cartones:{create:[card(1,1)]}}});
   const room=await prisma.eventoEnVivo.create({data:{organizadorId:user.id,titulo:'Auto',linkToken:crypto.randomUUID(),sorteoBingoId:bingo.id,bolillas:[1,2,3,4,5]}});
   const cantar=async(tipo,numerosSeries)=>{const r=await fetch(base+'/vivo/'+room.linkToken+'/cantar',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({tipo,numerosSeries})});return {status:r.status,data:await r.json()};};
   try {
     assert.equal((await cantar('BINGO',[1,2])).status,409);
     assert.equal((await cantar('LINEA',[3])).status,403);
     assert.equal((await cantar('LINEA',[99])).status,403);
     const line=await cantar('LINEA',[1,2]);assert.equal(line.status,200);assert.equal(line.data.numeroSerie,2);assert.equal(line.data.numeroCarton,2);assert.equal(line.data.estado,'EN_CURSO');
     await modificarEvento(room.id,user.id,(e,tx)=>tx.eventoEnVivo.update({where:{id:e.id},data:{bolillas:Array.from({length:15},(_,i)=>i+1),secuencia:{increment:1}}}));
     const win=await cantar('BINGO',[1,2]);assert.equal(win.status,200);assert.equal(win.data.ganadores.length,1);assert.equal(win.data.numeroCarton,2);assert.equal(win.data.estado,'PAUSADO');
   } finally {
     await prisma.eventoEnVivo.delete({where:{id:room.id}});await prisma.carton.deleteMany({where:{serieId:{in:[a.id,b.id,c.id]}}});await prisma.serie.deleteMany({where:{sorteoId:bingo.id}});await prisma.sorteo.delete({where:{id:bingo.id}});
   }
 });
 }finally{
   for(const ws of sockets)ws.terminate();await new Promise(r=>wss.close(r));await new Promise(r=>server.close(r));
   await prisma.eventoEnVivo.delete({where:{id:evento.id}});await prisma.usuario.delete({where:{id:user.id}});await prisma.$disconnect();
 }
});
