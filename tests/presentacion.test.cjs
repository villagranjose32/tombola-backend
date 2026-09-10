const {test} = require('node:test');
const assert = require('node:assert/strict');
const {prisma} = require('../dist/src/db');
const {sorteosRouter} = require('../dist/src/routes/sorteos.routes');
const handler = sorteosRouter.stack.find(l => l.route?.path === '/:id/presentacion').route.stack[0].handle;
const invoke = (body, sub='owner') => new Promise((resolve,reject) => handler({body,params:{id:'sorteo'},usuario:{sub}}, {json:resolve}, reject));
test('Presentación: permisos, validación y conservación de la configuración', async () => {
 const transaction = prisma.$transaction;
 let writes=0;
 const actual = {id:'sorteo',organizadorId:'owner',config:{cantidadSeries:20,cartonesPorSerie:6}};
 prisma.$transaction = async fn => fn({$queryRaw:async()=>[],sorteo:{findUnique:async()=>actual,update:async({data})=>{writes++;return data;}}});
 try {
  const body={inicioProgramado:'2026-12-20T18:00:00.000Z',imagenesPremios:['data:image/png;base64,aGVsbG8='],descripcionesPremios:['Bicicleta rodado 29']};
  const saved=await invoke(body);
  assert.equal(saved.config.cantidadSeries,20);
  assert.deepEqual(saved.config.presentacion,body);
  await assert.rejects(invoke(body,'other'),e=>e.status===403);
  for (const invalid of [ {...body,descripcionesPremios:[]}, {...body,descripcionesPremios:['x'.repeat(501)]}, {...body,inicioProgramado:'ayer'}, {...body,imagenesPremios:['data:image/svg+xml;base64,AAAA']}, {...body,imagenesPremios:Array(5).fill(body.imagenesPremios[0])} ]) await assert.rejects(invoke(invalid));
  assert.equal(writes,1);
  assert.deepEqual((await invoke({inicioProgramado:null,imagenesPremios:[]})).config.presentacion,{inicioProgramado:null,imagenesPremios:[]});
 } finally {prisma.$transaction=transaction;}
});
