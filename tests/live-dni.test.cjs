const {test} = require('node:test');
const assert = require('node:assert/strict');
const {prisma} = require('../dist/src/db');
const {eventosEnVivoPublicoRouter} = require('../dist/src/routes/eventosEnVivo.routes');
const handler = eventosEnVivoPublicoRouter.stack.find(l => l.route?.path === '/:token/mis-series').route.stack[0].handle;
const invoke = body => new Promise((resolve,reject) => handler({body,params:{token:'evento'}}, {set(){return this;},json:resolve}, reject));
test('Consulta por DNI limitada al bingo y sus series pagadas, con marcas del evento', async () => {
 const findEvento = prisma.eventoEnVivo.findUnique, findSeries = prisma.serie.findMany;
 let vinculado = true, calls = 0;
 prisma.eventoEnVivo.findUnique = async () => ({id:'vivo',sorteoBingoId:vinculado ? 'bingo' : null});
 prisma.serie.findMany = async args => {
  calls++;
  assert.deepEqual(args.where,{sorteoId:'bingo',participante:{dni:'12345678'},estado:'TOMADO'});
  assert.deepEqual(args.select.estadosEnVivo.where,{eventoId:'vivo'});
  return [ {numero:1,cartones:[{id:'carton'}],estadosEnVivo:[{marcas:{carton:[7]}}]}, {numero:2,cartones:[],estadosEnVivo:[]} ];
 };
 try {
  assert.deepEqual(await invoke({dni:'12345678'}),{series:[{numeroSerie:1,cartones:[{id:'carton'}],marcas:{carton:[7]}},{numeroSerie:2,cartones:[],marcas:{}}]});
  for(const dni of [undefined,'123','12.345.678']) await assert.rejects(invoke({dni}));
  assert.equal(calls,1);
  prisma.serie.findMany = async () => [];
  assert.deepEqual(await invoke({dni:'87654321'}),{series:[]});
  vinculado = false;
  await assert.rejects(invoke({dni:'12345678'}), e => e.status === 400);
 } finally {prisma.eventoEnVivo.findUnique=findEvento;prisma.serie.findMany=findSeries;}
});
