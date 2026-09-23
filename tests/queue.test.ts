import {afterAll,beforeAll,describe,expect,it} from 'vitest';
import {randomBytes,randomUUID} from 'node:crypto';
import pg from 'pg';
import {run,type Runner} from 'graphile-worker';
import {Store} from '../packages/store/index.js';
import {Executor} from '../packages/core/execution.js';
const connection=process.env.TEST_DATABASE_URL;
const waitUntil=async(fn:()=>Promise<boolean>)=>{const deadline=Date.now()+8000;while(!(await fn())){if(Date.now()>deadline)throw new Error('Timed out awaiting durable job');await new Promise(r=>setTimeout(r,30));}};
describe.skipIf(!connection)('Graphile queue integration',()=>{
 let store:Store,admin:pg.Pool;let runner:Runner|undefined;const db=`queue_test_${randomUUID().replaceAll('-','')}`;
 beforeAll(async()=>{admin=new pg.Pool({connectionString:connection});await admin.query(`CREATE DATABASE ${db}`);const u=new URL(connection!);u.pathname=`/${db}`;store=new Store(u.toString(),randomBytes(32).toString('base64'));await store.migrate();},30000);
 afterAll(async()=>{await runner?.stop();await store?.close();await admin?.query(`DROP DATABASE IF EXISTS ${db} WITH (FORCE)`);await admin?.end();});
 it('persists jobs without gateway, serializes account writes and suppresses redelivery',async()=>{
  const a=await store.account('queue');let concurrent=0,max=0,effects=0;
  const executor=new Executor(store,{read:async()=>({status:'ok'}),mutate:async()=>{concurrent++;max=Math.max(max,concurrent);effects++;await new Promise(r=>setTimeout(r,40));concurrent--;return {status:'ok',data:{verified:true}};},close:async()=>{}},'queue-worker');
  const one=await store.start('queue',a.id,'cart_add','write',{line:1},'job-one');const two=await store.start('queue',a.id,'cart_add','write',{line:2},'job-two');
  const start=()=>run({pgPool:store.pool,noHandleSignals:true,concurrency:2,pollInterval:50,taskList:{execute_operation:async(payload)=>{await executor.run((payload as {operationId:string}).operationId);}}});
  runner=await start();await waitUntil(async()=> (await store.getOperation('queue',two.id)).status==='ok');expect(effects).toBe(2);expect(max).toBe(1);
  await runner.stop();await runner.promise;runner=undefined;
  await store.pool.query("SELECT graphile_worker.add_job('execute_operation',$1::json,queue_name:=$2)",[JSON.stringify({operationId:one.id}),`account:${a.id}`]);
  runner=await start();await new Promise(r=>setTimeout(r,150));expect(effects).toBe(2);
 },15000);
 it('rolls back queue publication with the application transaction',async()=>{
  await expect(store.transaction(async c=>{await c.query("SELECT graphile_worker.add_job('uncommitted',$1::json,job_key:='must-rollback')",['{}']);throw new Error('rollback');})).rejects.toThrow('rollback');
  const r=await store.pool.query("SELECT count(*) FROM graphile_worker.jobs WHERE key='must-rollback'");expect(r.rows[0].count).toBe('0');
 });
});
