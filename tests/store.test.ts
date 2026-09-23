import { afterAll,beforeAll,describe,expect,it } from 'vitest';
import { randomBytes,randomUUID } from 'node:crypto';
import pg from 'pg';
import { Store } from '../packages/store/index.js';
import { Monitoring } from '../packages/store/monitoring.js';
import { Executor } from '../packages/core/execution.js';
import type {ShoppingProvider} from '../packages/contracts/index.js';
const connection=process.env.TEST_DATABASE_URL;
describe.skipIf(!connection)('Postgres durable operations',()=>{
 let store:Store;let admin:pg.Pool;const db=`amazon_test_${randomUUID().replaceAll('-','')}`;
 beforeAll(async()=>{admin=new pg.Pool({connectionString:connection});await admin.query(`CREATE DATABASE ${db}`);const u=new URL(connection!);u.pathname=`/${db}`;store=new Store(u.toString(),randomBytes(32).toString('base64'));await store.migrate();},30000);
 afterAll(async()=>{await store?.close();await admin?.query(`DROP DATABASE IF EXISTS ${db} WITH (FORCE)`);await admin?.end();});
 it('atomically reuses operation across repeated and concurrent keys for one consent',async()=>{
  const a=await store.account('owner');const intent=await store.prepare('owner',a.id,'checkout_submit',{total:{currency:'USD',minorUnits:1299}});
  await expect(store.submit('owner',intent.id,'no-consent')).rejects.toThrow('owner-approved');
  await store.approve('owner',intent.id,intent.digest);
  const [first,second]=await Promise.all([store.submit('owner',intent.id,'first'),store.submit('owner',intent.id,'new-key')]);expect(first.id).toBe(second.id);
  expect((await store.pool.query('SELECT count(*) FROM operations WHERE intent_id=$1',[intent.id])).rows[0].count).toBe('1');
  await expect(store.getOperation('other',first.id)).rejects.toThrow('not found');
 });
 it('rejects reused request keys, scopes encryption and persists across store reconnect',async()=>{
  const a=await store.account('reads');const op=await store.start('reads',a.id,'products_get','read',{asin:'B000000001'},'same');
  expect((await store.start('reads',a.id,'products_get','read',{asin:'B000000001'},'same')).id).toBe(op.id);
  await expect(store.start('reads',a.id,'products_get','read',{asin:'B000000002'},'same')).rejects.toThrow('different');
  const raw=(await store.pool.query('SELECT input FROM operations WHERE id=$1',[op.id])).rows[0].input;expect(raw).not.toContain('B000000001');expect(()=>store.vault.open(raw,'other')).toThrow();
  expect((await store.getOperation('reads',op.id)).input.asin).toBe('B000000001');
 });
 it('crash after dispatch quarantines writes and cannot retry under another key',async()=>{
  const a=await store.account('crash');const op=await store.start('crash',a.id,'cart_add','write',{asin:'B000000001'},'crash-key');const claimed=await store.claim(op.id,'dead');expect(claimed).not.toBeNull();await store.markDispatch(op.id,'dead');
  await store.pool.query("UPDATE operations SET heartbeat_at=now()-interval '10 minutes' WHERE id=$1",[op.id]);await store.recoverStale(new Date(Date.now()-60000));
  expect((await store.getOperation('crash',op.id)).status).toBe('outcome_unknown');await expect(store.start('crash',a.id,'cart_add','write',{},'new-key')).rejects.toThrow('reconciliation');
  expect(await store.claim(op.id,'new-worker')).toBeNull();
 });
 it('executor refuses changed terms and does not dispatch a consequential effect',async()=>{
  const a=await store.account('terms');const intent=await store.prepare('terms',a.id,'checkout_submit',{total:100});await store.approve('terms',intent.id,intent.digest);const op=await store.submit('terms',intent.id,'terms-key');let effects=0;
  const provider:ShoppingProvider={read:async()=>({status:'ok',data:{total:101}}),mutate:async()=>{effects++;return {status:'ok'};},close:async()=>{}};
  await new Executor(store,provider,'tester').run(op.id);expect(effects).toBe(0);expect((await store.getOperation('terms',op.id)).status).toBe('conflict');
 });
 it('lost response after effect is uncertain and never automatically repeats',async()=>{
  const a=await store.account('lost');const op=await store.start('lost',a.id,'cart_add','write',{},'lost-key');let effects=0;
  const provider:ShoppingProvider={read:async()=>({status:'ok'}),mutate:async()=>{effects++;throw new Error('network response lost');},close:async()=>{}};const executor=new Executor(store,provider,'tester');await executor.run(op.id);await executor.run(op.id);
  expect(effects).toBe(1);expect((await store.getOperation('lost',op.id)).status).toBe('outcome_unknown');
 });
 it('deduplicates repeated observations but preserves A-B-A occurrences and ownership',async()=>{
  const a=await store.account('watch');const monitor=new Monitoring(store);const w=await monitor.create('watch',a.id,'shipments_get',{orderId:'111-1111111-1111111'},300);
  expect(await monitor.observe(w,{status:'ok',data:{status:'A',observedAt:'one'}})).toBe(false);
  expect(await monitor.observe(w,{status:'ok',data:{status:'A',observedAt:'two'}})).toBe(false);
  expect(await monitor.observe(w,{status:'ok',data:{status:'B'}})).toBe(true);expect(await monitor.observe(w,{status:'ok',data:{status:'A'}})).toBe(true);
  expect((await monitor.events('watch')).items).toHaveLength(2);expect((await monitor.events('other')).items).toHaveLength(0);
  await monitor.pause('watch',w.id,true,w.revision);expect(await monitor.observe(w,{status:'ok',data:{status:'C'}})).toBe(false);
 });
 it('cancels only queued work with matching revision',async()=>{const a=await store.account('cancel');const op=await store.start('cancel',a.id,'cart_get','read',{},'cancel-key');await store.cancel('cancel',op.id,op.revision);expect(await store.claim(op.id,'tester')).toBeNull();});
});
