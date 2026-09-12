const {test} = require('node:test');
const assert = require('node:assert/strict');
const LiveSync = require('../frontend/live-sync');
class Events {
  constructor() { this.listeners = new Map(); }
  addEventListener(name, fn) { if (!this.listeners.has(name)) this.listeners.set(name,new Set()); this.listeners.get(name).add(fn); }
  removeEventListener(name, fn) { this.listeners.get(name)?.delete(fn); }
  emit(name) { for(const fn of [...(this.listeners.get(name)||[])]) fn(); }
  count() { return [...this.listeners.values()].reduce((n,s)=>n+s.size,0); }
}
class Clock {
  constructor() { this.now = 100000; this.id = 0; this.tasks = new Map(); }
  add(fn,ms,repeat) { const id=++this.id; this.tasks.set(id,{fn,ms,repeat,at:this.now+ms});return id; }
  async flush() { for(let i=0;i<10;i++) await Promise.resolve(); }
  async tick(ms) {
    const end=this.now+ms;
    for(;;) {
      const next=[...this.tasks].filter(([,t])=>t.at<=end).sort((a,b)=>a[1].at-b[1].at)[0];
      if(!next) break;
      this.now=next[1].at;
      if(next[1].repeat)next[1].at+=next[1].ms;else this.tasks.delete(next[0]);
      next[1].fn();await this.flush();
    }
    this.now=end;await this.flush();
  }
}
function snapshot(n,extra={}) {
  return {type:'STATE_SNAPSHOT', salaId:'room', secuencia:n, numeroActual:n||null,
    numerosExtraidos:Array.from({length:n},(_,i)=>i+1), estado:'EN_CURSO', timestamp:'2026-09-07T12:00:00.000Z', ronda:0,...extra};
}
function fixture() {
  const clock=new Clock(), win=new Events(), doc=new Events();doc.hidden=false;
  const frames=[], statuses=[], sockets=[];let server=snapshot(0), online=true, pong=true, snapshots=true, failHttp=false, httpCalls=0;
  class Socket {
    constructor(url) { this.url=url;this.readyState=0;this.sent=[];sockets.push(this); }
    open() { this.readyState=1;this.onopen?.(); }
    send(raw) {
      if(!online) return;
      const message=JSON.parse(raw);this.sent.push(message);
      if(message.type==='RESYNC'&&snapshots)queueMicrotask(()=>this.message({...server,type:'STATE_SNAPSHOT'}));
      if(message.type==='PING'&&pong)queueMicrotask(()=>this.message({type:'PONG'}));
    }
    message(value) { if(online&&this.readyState===1)this.onmessage?.({data:JSON.stringify(value)}); }
    close() { this.readyState=3;this.onclose?.(); }
  }
  const env={window:win,document:doc,navigator:{onLine:true}, Date:{now:()=>clock.now}, WebSocket:Socket, AbortController,
    setTimeout:(fn,ms)=>clock.add(fn,ms,false),clearTimeout:id=>clock.tasks.delete(id),
    setInterval:(fn,ms)=>clock.add(fn,ms,true),clearInterval:id=>clock.tasks.delete(id),
    fetch:async()=>{httpCalls++;if(!online||failHttp)throw new Error('offline');return {ok:true,json:async()=>({...server})};}};
  const client=new LiveSync({baseUrl:'https://bingo.test',token:'token',env,onState:(s,m)=>frames.push({s,m}),onStatus:s=>statuses.push(s)});
  return {clock,win,doc,env,client,sockets,frames,statuses,get server(){return server;},set server(s){server=s;},set online(v){online=v;},set pong(v){pong=v;},set snapshots(v){snapshots=v;},set failHttp(v){failHttp=v;},get httpCalls(){return httpCalls;},
    async start(){client.start();sockets.at(-1).open();await clock.flush();},
    async draw(n,deliver=true){server=snapshot(n);if(deliver)sockets.at(-1).message({...server,type:'STATE_UPDATE',accion:'extraida'});await clock.flush();}};
}
test('Internet desconectado durante cinco extracciones: conserva estado y recupera sin animaciones',async()=>{
 const f=fixture();await f.start();await f.draw(1);f.online=false;f.env.navigator.onLine=false;f.win.emit('offline');
 for(let n=2;n<=6;n++)await f.draw(n,false);await f.clock.tick(25000);
 assert.equal(f.client.sequence,1);assert.equal(f.statuses.at(-1).text,'Sin conexión');assert.equal(f.statuses.at(-1).stale,true);
 f.online=true;f.env.navigator.onLine=true;f.win.emit('online');f.sockets.at(-1).open();await f.clock.flush();
 assert.equal(f.client.sequence,6);assert.equal(f.frames.at(-1).m.animate,false);assert.equal(f.statuses.at(-1).text,'En vivo');f.client.stop();
});
test('Wi-Fi a datos sin evento close: online reemplaza socket y envía RESYNC',async()=>{
 const f=fixture();await f.start();const old=f.sockets[0];f.server=snapshot(5);f.win.emit('online');f.sockets.at(-1).open();await f.clock.flush();
 assert.equal(old.readyState,3);assert.equal(f.sockets.length,2);assert.equal(f.sockets[1].sent[0].type,'RESYNC');assert.equal(f.client.sequence,5);f.client.stop();
});
for(const event of ['visibilitychange','pageshow','focus'])test('Resincroniza al volver: '+event,async()=>{
 const f=fixture();await f.start();f.server=snapshot(5);f.doc.hidden=true;f.doc.emit('visibilitychange');f.doc.hidden=false;
 (event==='visibilitychange'?f.doc:f.win).emit(event);await f.clock.flush();assert.equal(f.client.sequence,5);assert.equal(f.frames.at(-1).m.animate,false);assert.equal(f.sockets.length,1);f.client.stop();
});
test('Suspender y desbloquear teléfono con timers congelados descarta conexión vieja',async()=>{
 const f=fixture();await f.start();f.clock.now+=120000;f.server=snapshot(9);f.win.emit('pageshow');f.sockets.at(-1).open();await f.clock.flush();
 assert.equal(f.sockets.length,2);assert.equal(f.client.sequence,9);assert.equal(f.frames.at(-1).m.animate,false);f.client.stop();
});
test('Reinicio WS y backoff exponencial con máximo de 30 segundos',async()=>{
 const f=fixture();await f.start();f.snapshots=false;
 for(const delay of [1000,2000,4000,8000,16000,30000,30000]){
   f.sockets.at(-1).close();const count=f.sockets.length;await f.clock.tick(delay-1);assert.equal(f.sockets.length,count);await f.clock.tick(1);assert.equal(f.sockets.length,count+1);
 }
 f.snapshots=true;f.server=snapshot(8);f.sockets.at(-1).open();await f.clock.flush();assert.equal(f.client.sequence,8);assert.equal(f.client.attempt,0);f.client.stop();
});
test('Mensajes duplicados, anteriores y sala incorrecta no cambian el tablero',async()=>{
 const f=fixture();await f.start();await f.draw(1);const count=f.frames.length;
 for(const s of [snapshot(1),snapshot(0),snapshot(50,{salaId:'other'})])f.sockets[0].message({...s,type:'STATE_UPDATE',accion:'extraida'});
 await f.clock.flush();assert.equal(f.frames.length,count);assert.equal(f.client.sequence,1);f.client.stop();
});
test('Secuencia perdida solicita snapshot inmediatamente y no anima números perdidos',async()=>{
 const f=fixture();await f.start();await f.draw(1);const count=f.sockets[0].sent.length;await f.draw(3);
 assert.equal(f.sockets[0].sent[count].type,'RESYNC');assert.equal(f.client.sequence,3);assert.equal(f.frames.at(-1).m.animate,false);f.client.stop();
});
test('HTTP cada 5s corrige mensajes silenciosamente perdidos aunque WS siga abierto',async()=>{
 const f=fixture();await f.start();const count=f.httpCalls;await f.draw(5,false);await f.clock.tick(4999);assert.equal(f.client.sequence,0);
 await f.clock.tick(1);assert.equal(f.httpCalls,count+1);assert.equal(f.client.sequence,5);assert.equal(f.frames.at(-1).m.animate,false);f.client.stop();
});
test('Heartbeat a 22s, sin PONG cierra en 8s y reconecta',async()=>{
 const f=fixture();await f.start();f.pong=false;await f.clock.tick(22000);assert.equal(f.sockets[0].sent.at(-1).type,'PING');
 await f.clock.tick(8000);assert.equal(f.sockets[0].readyState,3);assert.equal(f.statuses.at(-1).text,'Reconectando…');await f.clock.tick(1000);assert.equal(f.sockets.length,2);f.client.stop();
});
test('PONG mantiene una única conexión y stop elimina timers/listeners',async()=>{
 const f=fixture();await f.start();f.client.start();await f.clock.tick(70000);assert.equal(f.sockets.length,1);assert.equal(f.win.count()+f.doc.count(),5);
 f.client.stop();assert.equal(f.clock.tasks.size,0);assert.equal(f.win.count()+f.doc.count(),0);assert.equal(f.sockets[0].onmessage,null);
 await f.clock.tick(60000);assert.equal(f.sockets.length,1);
});
test('Recarga página recupera snapshot completo sin depender de memoria del cliente',async()=>{
 const f=fixture();f.server=snapshot(17);await f.start();assert.equal(f.client.sequence,17);assert.equal(f.frames[0].s.numeroActual,17);assert.equal(f.frames[0].m.animate,false);f.client.stop();
});
test('Reinicio de partida aumenta secuencia y permite historial vacío',async()=>{
 const f=fixture();f.server=snapshot(9);await f.start();f.server=snapshot(10,{ronda:1,numerosExtraidos:[],numeroActual:null});f.win.emit('focus');await f.clock.flush();assert.equal(f.client.sequence,10);assert.deepEqual(f.frames.at(-1).s.numerosExtraidos,[]);f.client.stop();
});
test('Sin primer HTTP/WS, recupera automáticamente sin recargar la página',async()=>{
 const f=fixture();f.online=false;f.client.start();await f.clock.flush();assert.equal(f.statuses.at(-1).text,'Sin conexión');
 await f.clock.tick(8000);f.online=true;await f.clock.tick(2000);f.sockets.at(-1).open();await f.clock.flush();assert.equal(f.client.sequence,0);assert.equal(f.statuses.at(-1).text,'En vivo');f.client.stop();
});
test('HTTP anterior que termina tarde no revierte la secuencia recibida por WS',async()=>{
 const f=fixture();await f.start();let finish;
 f.env.fetch=()=>new Promise(resolve=>{finish=resolve;});
 f.client.pull();await f.draw(1);
 finish({ok:true,json:async()=>snapshot(0)});await f.clock.flush();
 assert.equal(f.client.sequence,1);assert.equal(f.frames.at(-1).s.numeroActual,1);f.client.stop();
});
test('No llegar STATE_SNAPSHOT fuerza reconexión aunque el socket esté abierto',async()=>{
 const f=fixture();f.snapshots=false;await f.start();assert.equal(f.statuses.at(-1).text,'Reconectando…');
 await f.clock.tick(8000);assert.equal(f.sockets[0].readyState,3);await f.clock.tick(1000);assert.equal(f.sockets.length,2);f.client.stop();
});
test('HTTP pendiente se aborta al desmontar y no repinta después',async()=>{
 const f=fixture();await f.start();let finish,signal;
 f.env.fetch=(_url,opts)=>{signal=opts.signal;return new Promise(resolve=>{finish=resolve;});};
 f.client.pull();const count=f.frames.length;f.client.stop();assert(signal.aborted);
 finish({ok:true,json:async()=>snapshot(10)});await f.clock.flush();assert.equal(f.frames.length,count);assert.equal(f.clock.tasks.size,0);
});

test('Cambiar o quitar la fecha se refleja aunque no cambie la secuencia de bolillas',async()=>{
 const f=fixture();await f.start();
 f.server=snapshot(0,{inicioProgramado:'2030-01-02T12:00:00Z'});
 await f.clock.tick(5000);
 assert.equal(f.frames.at(-1).s.inicioProgramado,'2030-01-02T12:00:00Z');assert.equal(f.client.sequence,0);assert.equal(f.frames.at(-1).m.animate,false);
 f.server=snapshot(0,{inicioProgramado:null});await f.clock.tick(5000);
 assert.equal(f.frames.at(-1).s.inicioProgramado,null);f.client.stop();
});
