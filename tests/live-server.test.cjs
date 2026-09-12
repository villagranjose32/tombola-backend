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
const {publicoRouter} = require('../dist/src/routes/publico.routes');
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
 const user=await prisma.usuario.create({data:{nombre:'Sync Test',dni:'12345678',telefono:'+54 11 12345678',email:crypto.randomUUID()+'@example.test',passwordHash:'unused',estado:'APROBADO'}});
 const evento=await prisma.eventoEnVivo.create({data:{organizadorId:user.id,titulo:'Test',linkToken:crypto.randomUUID(),modo:'BINGO',rangoMax:90}});
 const app=express();app.use(express.json());app.use('/s',publicoRouter);app.use('/auth',authRouter);app.use('/sorteos',sorteosRouter);app.use('/eventos-en-vivo',eventosEnVivoRouter);app.use('/vivo',eventosEnVivoPublicoRouter);app.use(errorHandler);
 const server=http.createServer(app);let wss=iniciarRealtime(server);
 server.listen(0,'127.0.0.1');await once(server,'listening');const base='http://127.0.0.1:'+server.address().port;
 const sockets=new Set();
 async function open(options={},token=evento.linkToken){const ws=new WebSocket(base.replace('http','ws')+'/ws?sorteo='+token,options);sockets.add(ws);await once(ws,'open');return ws;}
 async function request(action,body){const res=await fetch(base+'/eventos-en-vivo/'+evento.id+'/'+action,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+firmarToken({sub:user.id,rol:'ORGANIZADOR'})},body:body?JSON.stringify(body):undefined});return {res,data:await res.json()};}
 try{
 await t.test('DNI obligatorio, titular inmutable y datos privados en reservas de rifa y bingo',async()=>{
   const ids=[];
   const phone='tel-'+crypto.randomUUID();
   try {
     for(const tipo of ['RIFA','BINGO']) {
       const sorteo=await prisma.sorteo.create({data:{organizadorId:user.id,titulo:'DNI',tipo,estado:'ACTIVO',linkToken:crypto.randomUUID()}});ids.push(sorteo.id);
       if(tipo==='RIFA')await prisma.numero.createMany({data:[1,2].map(valor=>({sorteoId:sorteo.id,valor}))});
       else await prisma.serie.createMany({data:[1,2].map(numero=>({sorteoId:sorteo.id,numero,cantidadCartones:1}))});
       const path=base+'/s/'+sorteo.linkToken+'/'+(tipo==='RIFA'?'numeros':'series');
       const reserve=(n,body)=>fetch(path+'/'+n+'/reservar',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
       for(const dni of [undefined,'abc','123','12.345.678'])assert.equal((await reserve(1,{nombre:'Titular Uno',dni})).status,400);
       assert.equal((await reserve(1,{nombre:'Titular Uno',dni:'12345678',telefono:phone})).status,200);
       assert.equal((await reserve(2,{nombre:'Titular Dos',dni:'23456789',telefono:phone})).status,200);
       const model=tipo==='RIFA'?prisma.numero:prisma.serie;
       const rows=await model.findMany({where:{sorteoId:sorteo.id},include:{participante:true},orderBy:tipo==='RIFA'?{valor:'asc'}:{numero:'asc'}});
       assert.equal(rows[0].participante.nombre,'Titular Uno');assert.equal(rows[0].participante.dni,'12345678');assert.equal(rows[1].participante.dni,'23456789');
       assert.notEqual(rows[0].participanteId,rows[1].participanteId);
       const pub=await (await fetch(base+'/s/'+sorteo.linkToken)).text();assert(!pub.includes('12345678'));assert(!pub.includes('23456789'));
       const priv=await fetch(base+'/sorteos/'+sorteo.id+'/'+(tipo==='RIFA'?'numeros':'series'),{headers:{Authorization:'Bearer '+firmarToken({sub:user.id,rol:'ORGANIZADOR'})}});
       assert.equal(priv.status,200);assert((await priv.text()).includes('12345678'));
     }
   } finally {
     await prisma.numero.deleteMany({where:{sorteoId:{in:ids}}});await prisma.serie.deleteMany({where:{sorteoId:{in:ids}}});await prisma.sorteo.deleteMany({where:{id:{in:ids}}});await prisma.participante.deleteMany({where:{telefono:phone}});
   }
 });
 await t.test('Registro exige nombre completo, DNI y teléfono y solo crea organizadores',async()=>{
   const email=crypto.randomUUID()+'@example.test';
   const body={nombre:'Ana Pérez',dni:'12345678',telefono:'+54 11 12345678',email,password:'Password123',rol:'ADMIN'};
   const registrar=datos=>fetch(base+'/auth/registro',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(datos)});
   try {
     for(const faltante of ['dni','telefono'])assert.equal((await registrar({...body,[faltante]:undefined})).status,400);
     assert.equal((await registrar({...body,nombre:'Ana'})).status,400);
     assert.equal((await registrar({...body,dni:'abc'})).status,400);
     assert.equal((await registrar({...body,telefono:'abcdefg'})).status,400);
     assert.equal((await registrar(body)).status,201);
     const guardado=await prisma.usuario.findUnique({where:{email}});
     assert.equal(guardado.rol,'ORGANIZADOR');assert.equal(guardado.dni,body.dni);assert.equal(guardado.telefono,body.telefono);
   }finally{await prisma.usuario.deleteMany({where:{email}});}
 });
 await t.test('Eliminar exige titularidad y borra todos los datos del sorteo, conservando participantes',async()=>{
   const titular=await prisma.participante.create({data:{contacto:crypto.randomUUID(),nombre:'Titular'}});
   const otro=await prisma.usuario.create({data:{nombre:'Otro',email:crypto.randomUUID()+'@example.test',passwordHash:'unused',estado:'APROBADO'}});
   const ids=[];
   const eliminar=(id,sub)=>fetch(base+'/sorteos/'+id,{method:'DELETE',headers:sub?{Authorization:'Bearer '+firmarToken({sub,rol:'ORGANIZADOR'})}:{}});
   try {
     for(const tipo of ['BINGO','RIFA','SORTEO_SIMPLE']) {
       const sorteo=await prisma.sorteo.create({data:{organizadorId:user.id,titulo:'Eliminar',tipo,estado:'ACTIVO',linkToken:crypto.randomUUID()}});ids.push(sorteo.id);
       if(tipo==='BINGO') {
         const serie=await prisma.serie.create({data:{sorteoId:sorteo.id,numero:1,cantidadCartones:1,estado:'TOMADO',participanteId:titular.id,cartones:{create:{posicion:1,contenido:[[1,2,3]]}}},include:{cartones:true}});
         const sala=await prisma.eventoEnVivo.create({data:{organizadorId:user.id,sorteoBingoId:sorteo.id,titulo:'Eliminar',linkToken:crypto.randomUUID()}});
         await prisma.estadoCartonesEnVivo.create({data:{eventoId:sala.id,serieId:serie.id,marcas:{}}});
         await prisma.cantoBingo.create({data:{eventoId:sala.id,sorteoId:sorteo.id,ronda:0,tipo:'LINEA',cartonId:serie.cartones[0].id,numeroSerie:1,numeroCarton:1,contenido:[[1,2,3]],bolillas:[1,2,3]}});
       } else if(tipo==='RIFA') await prisma.numero.create({data:{sorteoId:sorteo.id,valor:1,estado:'TOMADO',participanteId:titular.id}});
       else await prisma.inscripcion.create({data:{sorteoId:sorteo.id,participanteId:titular.id}});
       await prisma.tableroEnVivo.create({data:{sorteoId:sorteo.id}});
       await prisma.resultadoSorteo.create({data:{sorteoId:sorteo.id,semilla:'test',hashPublicado:'test',ganadorTipo:tipo,ganadorValor:'1',inputs:{}}});
       assert.equal((await eliminar(sorteo.id)).status,401);
       assert.equal((await eliminar(sorteo.id,otro.id)).status,403);
       assert(await prisma.sorteo.findUnique({where:{id:sorteo.id}}));
       assert.equal((await eliminar(sorteo.id,user.id)).status,200);
       assert.equal(await prisma.sorteo.findUnique({where:{id:sorteo.id}}),null);
       assert.equal(await prisma.eventoEnVivo.count({where:{sorteoBingoId:sorteo.id}}),0);
       assert.equal(await prisma.cantoBingo.count({where:{sorteoId:sorteo.id}}),0);
       assert.equal((await fetch(base+'/s/'+sorteo.linkToken)).status,404);
       assert.equal((await eliminar(sorteo.id,user.id)).status,404);
     }
     assert(await prisma.participante.findUnique({where:{id:titular.id}}));
   } finally {
     for(const id of ids) await eliminar(id,user.id);
     await prisma.participante.delete({where:{id:titular.id}});await prisma.usuario.delete({where:{id:otro.id}});
   }
 });
 await t.test('DNI reúne series confirmadas del mismo bingo y descarga PDF conjunto',async()=>{
   const ids=[],participantes=[];
   try {
     for(const [nombre,dni] of [['Ana Pérez','12345678'],['Ana Pérez','12345678'],['Otra Persona','87654321']]) {
       participantes.push(await prisma.participante.create({data:{nombre,dni,contacto:crypto.randomUUID()}}));
     }
     for(let i=0;i<2;i++)ids.push(await prisma.sorteo.create({data:{organizadorId:user.id,tipo:'BINGO',titulo:'Consulta DNI',linkToken:crypto.randomUUID()}}));
     const carton={posicion:1,contenido:[[1,2,3,4,5,null,null,null,null],[6,7,8,9,10,null,null,null,null],[11,12,13,14,15,null,null,null,null]]};
     for(const [numero,persona,estado] of [[1,0,'TOMADO'],[2,1,'TOMADO'],[3,0,'RESERVADO'],[4,2,'TOMADO']]) {
       await prisma.serie.create({data:{sorteoId:ids[0].id,numero,cantidadCartones:1,participanteId:participantes[persona].id,estado,cartones:{create:carton}}});
     }
     await prisma.serie.create({data:{sorteoId:ids[1].id,numero:99,cantidadCartones:1,participanteId:participantes[0].id,estado:'TOMADO',cartones:{create:carton}}});
     const consultar=(suffix,body)=>fetch(base+'/s/'+ids[0].linkToken+'/mis-series'+suffix,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
     assert.equal((await consultar('',{dni:'abc'})).status,400);
     const respuesta=await consultar('',{dni:'12345678'});assert.equal(respuesta.headers.get('cache-control'),'no-store');
     const datos=await respuesta.json();assert.deepEqual(datos.series.map(s=>s.numeroSerie),[1,2]);assert.deepEqual(datos.pendientes,[3]);
     assert.equal(datos.series[0].cartones.length,1);assert.equal(datos.series[1].nombre,'Ana Pérez');
     assert.deepEqual((await (await consultar('',{dni:'11111111'})).json()).series,[]);
     for(const numeroSerie of [3,4,99])assert.equal((await consultar('/descargar',{dni:'12345678',numeroSerie})).status,404);
     const pdf=await consultar('/descargar',{dni:'12345678'});assert.equal(pdf.status,200);assert.match(pdf.headers.get('content-type'),/application\/pdf/);
     const buffer=Buffer.from(await pdf.arrayBuffer());assert.equal(buffer.subarray(0,5).toString(),'%PDF-');
     const {spawnSync}=require('node:child_process');
     const texto=spawnSync('pdftotext',['-','-'],{input:buffer});assert.equal(texto.status,0);
     assert.match(texto.stdout.toString(),/001/);assert.match(texto.stdout.toString(),/002/);assert.doesNotMatch(texto.stdout.toString(),/003|004|099/);
     const individual=await consultar('/descargar',{dni:'12345678',numeroSerie:2});assert.equal(individual.status,200);assert.match(individual.headers.get('content-disposition'),/serie-2.pdf/);await individual.arrayBuffer();
   } finally {
     for(const sorteo of ids)await fetch(base+'/sorteos/'+sorteo.id,{method:'DELETE',headers:{Authorization:'Bearer '+firmarToken({sub:user.id,rol:'ORGANIZADOR'})}});
     await prisma.participante.deleteMany({where:{id:{in:participantes.map(p=>p.id)}}});
   }
 });
 await t.test('Presencia por sala excluye organizador y mensajes requieren titularidad',async()=>{
   const owner=await open({},evento.linkToken+'&espectador=0');
   const viewers=message(owner,x=>x.type==='COMMUNITY_UPDATE'&&x.comunidad.espectadores===1);
   const spectator=await open();await viewers;
   const isolated=await open({},'otra-sala');
   const received=message(spectator,x=>x.type==='COMMUNITY_UPDATE'&&x.comunidad.aviso);
   const sent=await request('mensaje',{texto:'  Seguimos con el bingo  '});
   assert.equal(sent.res.status,200);
   const aviso=(await received).comunidad.aviso;assert.equal(aviso.texto,'Seguimos con el bingo');assert.equal(aviso.leerEnVozAlta,false);
   assert(aviso.expiraEn>Date.now()&&aviso.expiraEn<=Date.now()+8000);
   const snapshot=await (await fetch(base+'/vivo/'+evento.linkToken)).json();assert.equal(snapshot.comunidad.aviso.id,aviso.id);assert.equal(snapshot.comunidad.espectadores,1);
   const hablado=await request('mensaje',{texto:'Siguiente línea',leerEnVozAlta:true});assert.equal(hablado.data.comunidad.aviso.leerEnVozAlta,true);
   assert.equal((await request('mensaje',{texto:'Inválido',leerEnVozAlta:'si'})).res.status,400);
   for(const texto of ['', '   ', 'x'.repeat(281)])assert.equal((await request('mensaje',{texto})).res.status,400);
   assert.equal((await fetch(base+'/eventos-en-vivo/'+evento.id+'/mensaje',{method:'POST',headers:{'Content-Type':'application/json'},body:'{"texto":"No autorizado"}'})).status,401);
   const other=await prisma.usuario.create({data:{nombre:'Otro',email:crypto.randomUUID()+'@example.test',passwordHash:'unused',estado:'APROBADO'}});
   try {
     const denied=await fetch(base+'/eventos-en-vivo/'+evento.id+'/mensaje',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+firmarToken({sub:other.id,rol:'ORGANIZADOR'})},body:'{"texto":"No autorizado"}'});
     assert.equal(denied.status,403);
   } finally {await prisma.usuario.delete({where:{id:other.id}});}
   const isolatedSnapshot=message(isolated,x=>x.type==='COMMUNITY_UPDATE');
   const extra=await open({},'otra-sala');assert.equal((await isolatedSnapshot).comunidad.aviso,null);
   const left=message(owner,x=>x.type==='COMMUNITY_UPDATE'&&x.comunidad.espectadores===0);spectator.close();await left;
   for(const ws of [owner,isolated,extra]){ws.terminate();sockets.delete(ws);}sockets.delete(spectator);
 });
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
     assert.equal(paused.historialGanadores.length,1);
     const resumed=await request('reanudar');assert.equal(resumed.data.secuencia,30);assert.equal(resumed.data.historialGanadores.length,1);
     assert.equal((await (await fetch(base+'/vivo/'+evento.linkToken)).json()).historialGanadores.length,1);
     const config=await request('configurar',{titulo:'Configurado',modo:'BINGO',rangoMax:90,sorteoBingoId:bingo.id});assert.equal(config.data.secuencia,31);assert.equal(config.data.ronda,2);assert.deepEqual(config.data.historialGanadores,[]);assert.deepEqual(config.data.numerosExtraidos,[]);
     const historial=await (await fetch(base+'/vivo/'+evento.linkToken+'/resultados')).json();
     assert.equal(historial.cantos.length,1);assert.equal(historial.cantos[0].tipo,'BINGO');
     assert.equal(historial.cantos[0].bolillas.length,15);
     assert.equal(historial.cantos[0].ronda,1);
     const identidad=await (await fetch(base+'/vivo/'+evento.linkToken+'/organizador')).json();
     assert.deepEqual(identidad,{nombre:'Sync Test',dni:'12345678',telefono:'+54 11 12345678'});
   } finally {
     await prisma.eventoEnVivo.update({where:{id:evento.id},data:{sorteoBingoId:null}});
     await prisma.carton.deleteMany({where:{serieId:serie.id}});await prisma.serie.delete({where:{id:serie.id}});await prisma.sorteo.delete({where:{id:bingo.id}});
   }
 });
 await t.test('Editar bingo y datos de cobro conserva series, pagos y presentación',async()=>{
   const headers={'Content-Type':'application/json',Authorization:'Bearer '+firmarToken({sub:user.id,rol:'ORGANIZADOR'})};
   const creado=await fetch(base+'/sorteos',{method:'POST',headers,body:JSON.stringify({tipo:'BINGO',titulo:'Bingo editable',inicioProgramado:'2030-01-02T12:00:00Z',config:{cartonesPorSerie:3,cantidadSeries:1,alias:'bingo.inicial',cbu:'0123456789012345678901'}})});
   assert.equal(creado.status,201);const bingo=await creado.json();assert.equal(bingo.config.presentacion.inicioProgramado,'2030-01-02T12:00:00Z');
   const patch=body=>fetch(base+'/sorteos/'+bingo.id,{method:'PATCH',headers,body:JSON.stringify(body)});
   try {
     assert.equal((await patch({config:{cantidadSeries:2}})).status,200);
     const publicado=await fetch(base+'/sorteos/'+bingo.id+'/publicar',{method:'POST',headers});assert.equal(publicado.status,200);
     const activo=await prisma.sorteo.findUnique({where:{id:bingo.id}});
     const series=await prisma.serie.findMany({where:{sorteoId:bingo.id},include:{cartones:true},orderBy:{numero:'asc'}});assert.equal(series.length,2);
     await prisma.serie.update({where:{id:series[0].id},data:{estado:'TOMADO'}});
     await prisma.sorteo.update({where:{id:bingo.id},data:{config:{...activo.config,presentacion:{inicioProgramado:null,imagenesPremios:[]}}}});
     const guardado=await patch({titulo:'Bingo actualizado',descripcion:'Nueva descripción',fechaCierre:null,inicioProgramado:'2030-02-03T18:30:00Z',config:{alias:'nuevo.alias',cbu:'0012345678901234567890'}});assert.equal(guardado.status,200);
     const actualizado=await guardado.json();assert.deepEqual(actualizado.config.presentacion,{inicioProgramado:'2030-02-03T18:30:00Z',imagenesPremios:[]});assert.equal(actualizado.linkToken,activo.linkToken);
     const despues=await prisma.serie.findMany({where:{sorteoId:bingo.id},include:{cartones:true},orderBy:{numero:'asc'}});
     assert.deepEqual(despues.map(s=>s.cartones),series.map(s=>s.cartones));assert.equal(despues[0].estado,'TOMADO');
     assert.equal((await patch({config:{cantidadSeries:3}})).status,409);
     assert.equal((await patch({config:{cartonesPorSerie:6}})).status,409);
     assert.equal((await patch({tipo:'RIFA'})).status,409);
     assert.equal((await patch({config:{cbu:'abc'}})).status,400);
     assert.equal((await fetch(base+'/sorteos/'+bingo.id,{method:'PATCH',headers:{'Content-Type':'application/json'},body:'{"titulo":"Sin permiso"}'})).status,401);
     const otro=await prisma.usuario.create({data:{nombre:'Otro',email:crypto.randomUUID()+'@example.test',passwordHash:'unused',estado:'APROBADO'}});
     try {
       const otraIdentidad={...headers,Authorization:'Bearer '+firmarToken({sub:otro.id,rol:'ORGANIZADOR'})};
       assert.equal((await fetch(base+'/sorteos/'+bingo.id,{method:'PATCH',headers:otraIdentidad,body:'{"titulo":"Sin permiso"}'})).status,403);
     } finally {await prisma.usuario.delete({where:{id:otro.id}});}
     const identidad=await (await fetch(base+'/s/'+activo.linkToken+'/organizador')).json();assert.deepEqual(identidad.pago,{alias:'nuevo.alias',cbu:'0012345678901234567890'});
     const sala=await prisma.eventoEnVivo.create({data:{organizadorId:user.id,sorteoBingoId:bingo.id,titulo:'Sala',linkToken:crypto.randomUUID()}});
     assert.deepEqual((await(await fetch(base+'/vivo/'+sala.linkToken+'/organizador')).json()).pago,identidad.pago);
     const publico=await(await fetch(base+'/s/'+activo.linkToken)).json();
     assert.equal(publico.presentacion.inicioProgramado,'2030-02-03T18:30:00Z');assert.equal(publico.enVivo.iniciado,false);
     assert.equal((await(await fetch(base+'/vivo/'+sala.linkToken)).json()).inicioProgramado,'2030-02-03T18:30:00Z');
     await prisma.eventoEnVivo.update({where:{id:sala.id},data:{bolillas:[1]}});
     assert.equal((await(await fetch(base+'/s/'+activo.linkToken)).json()).enVivo.iniciado,true);
     assert.equal((await patch({inicioProgramado:null})).status,200);
     assert.equal((await(await fetch(base+'/vivo/'+sala.linkToken)).json()).inicioProgramado,null);

     assert.equal((await patch({config:{alias:'',cbu:''}})).status,200);
     assert.equal((await(await fetch(base+'/s/'+activo.linkToken+'/organizador')).json()).pago,undefined);
   } finally {await fetch(base+'/sorteos/'+bingo.id,{method:'DELETE',headers});}
 });
 await t.test('Sesión del organizador se recupera sin exponer contraseña',async()=>{
   const r=await fetch(base+'/auth/me',{headers:{Authorization:'Bearer '+firmarToken({sub:user.id,rol:'ORGANIZADOR'})}});const data=await r.json();
   assert.equal(r.status,200);assert.equal(data.id,user.id);assert.equal(data.passwordHash,undefined);assert.equal((await fetch(base+'/auth/me')).status,401);
 });
 await t.test('Canto automático revisa todas las series confirmadas y rechaza bingo incompleto',async()=>{
   const bingo=await prisma.sorteo.create({data:{organizadorId:user.id,tipo:'BINGO',titulo:'Auto test',linkToken:crypto.randomUUID()}});
   const card=(pos,start)=>({posicion:pos,contenido:Array.from({length:3},(_,r)=>[...Array.from({length:5},(_,i)=>start+r*5+i),null,null,null,null])});
   const a=await prisma.serie.create({data:{sorteoId:bingo.id,numero:1,cantidadCartones:1,estado:'TOMADO',cartones:{create:[card(1,50)]}}});
   const b=await prisma.serie.create({data:{sorteoId:bingo.id,numero:2,cantidadCartones:2,estado:'TOMADO',cartones:{create:[card(1,30),card(2,1)]}}});
   const c=await prisma.serie.create({data:{sorteoId:bingo.id,numero:3,cantidadCartones:1,estado:'RESERVADO',cartones:{create:[card(1,1)]}}});
   const room=await prisma.eventoEnVivo.create({data:{organizadorId:user.id,titulo:'Auto',linkToken:crypto.randomUUID(),sorteoBingoId:bingo.id,bolillas:[1,2,3,4,5]}});
   const cantar=async(tipo,numerosSeries)=>{const r=await fetch(base+'/vivo/'+room.linkToken+'/cantar',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({tipo,numerosSeries})});return {status:r.status,data:await r.json()};};
   try {
     assert.equal((await cantar('BINGO',[1,2])).status,409);
     assert.equal((await cantar('SEGUNDA_LINEA',[1,2])).status,409);
     assert.equal((await cantar('LINEA',[3])).status,403);
     assert.equal((await cantar('LINEA',[99])).status,403);
     const line=await cantar('LINEA',[1,2]);assert.equal(line.status,200);assert.equal(line.data.numeroSerie,2);assert.equal(line.data.numeroCarton,2);assert.equal(line.data.estado,'PAUSADO');
     assert.equal(line.data.cantos.length,1);
     const extraer=await fetch(base+'/eventos-en-vivo/'+room.id+'/extraer',{method:'POST',headers:{Authorization:'Bearer '+firmarToken({sub:user.id,rol:'ORGANIZADOR'})}});
     assert.equal(extraer.status,409);
     await prisma.serie.update({where:{id:c.id},data:{estado:'TOMADO'}});
     await Promise.all([cantar('LINEA',[2]),cantar('LINEA',[3])]);
     const recuperado=await (await fetch(base+'/vivo/'+room.linkToken)).json();
     assert.equal(recuperado.cantos.length,2);
     assert.deepEqual(recuperado.cantos.map(c=>c.numeroSerie).sort(),[2,3]);
     const resultados=await (await fetch(base+'/s/'+bingo.linkToken+'/resultado')).json();
     assert.equal(resultados.tipo,'BINGO');assert.equal(resultados.cantos.length,2);
     assert.deepEqual(resultados.cantos.map(c=>c.numeroSerie).sort(),[2,3]);
     const identidad=await (await fetch(base+'/s/'+bingo.linkToken+'/organizador')).json();
     assert.equal(identidad.dni,'12345678');assert.equal(identidad.passwordHash,undefined);
     await modificarEvento(room.id,user.id,(e,tx)=>tx.eventoEnVivo.update({where:{id:e.id},data:{bolillas:Array.from({length:15},(_,i)=>i+1),secuencia:{increment:1}}}));
     const segunda=await cantar('SEGUNDA_LINEA',[1,2]);assert.equal(segunda.status,200);assert(segunda.data.historialGanadores.some(g=>g.tipo==='SEGUNDA_LINEA'));
     const repetida=await cantar('SEGUNDA_LINEA',[1,2]);assert.equal(repetida.data.historialGanadores.filter(g=>g.tipo==='SEGUNDA_LINEA').length,1);
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
