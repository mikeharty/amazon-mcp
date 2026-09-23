import {afterAll,beforeAll,describe,it,expect} from 'vitest';
import {randomBytes,randomUUID} from 'node:crypto';
import pg from 'pg';
import {Store} from '../packages/store/index.js';
import {createOwnerUi} from '../apps/gateway/owner-ui.js';
const connection=process.env.TEST_DATABASE_URL;
describe.skipIf(!connection)('Owner review authorization',()=>{
 let store:Store,admin:pg.Pool;const db=`owner_test_${randomUUID().replaceAll('-','')}`;
 beforeAll(async()=>{admin=new pg.Pool({connectionString:connection});await admin.query(`CREATE DATABASE ${db}`);const u=new URL(connection!);u.pathname=`/${db}`;store=new Store(u.toString(),randomBytes(32).toString('base64'));await store.migrate();},30000);
 afterAll(async()=>{await store?.close();await admin?.query(`DROP DATABASE IF EXISTS ${db} WITH (FORCE)`);await admin?.end();});
 it('requires separate owner login and CSRF, escapes untrusted terms, and consumes approval once',async()=>{
  const origin='http://127.0.0.1:3433';const token=randomBytes(32).toString('hex');const ui=createOwnerUi(store,{ownerId:'owner',ownerToken:token,origin});const a=await store.account('owner');const intent=await store.prepare('owner',a.id,'fixture_purchase',{title:'<script>alert(1)</script>',total:{currency:'USD',minorUnits:1000}});
  const post=(path:string,body:Record<string,string>,cookie?:string,requestOrigin=origin)=>ui(new Request(origin+path,{method:'POST',headers:{origin:requestOrigin,'content-type':'application/x-www-form-urlencoded',...(cookie?{cookie}:{})},body:new URLSearchParams(body)}));
  expect((await post('/owner/login',{token:'mcp-token'})).status).toBe(401);
  expect((await post('/owner/login',{token},undefined,'https://evil.example')).status).toBe(403);
  const login=await post('/owner/login',{token});const cookie=login.headers.get('set-cookie')!.split(';')[0]!;expect(cookie).toContain('owner_session=');
  const url=`/owner/intents/${intent.id}`;const page=await ui(new Request(origin+url,{headers:{cookie}}));const body=await page.text();expect(body).not.toContain('<script>alert');expect(body).toContain('&lt;script&gt;');const csrf=/name="csrf" value="([^"]+)"/.exec(body)![1]!;
  expect((await post(url,{action:'approve',digest:intent.digest,csrf:'fake'},cookie)).status).toBe(403);expect((await store.getIntent('owner',intent.id)).approved_at).toBeNull();
  expect((await post(url,{action:'approve',digest:intent.digest,csrf},cookie)).status).toBe(200);
  const op=await store.submit('owner',intent.id,'approved-once');expect((await store.submit('owner',intent.id,'new-key')).id).toBe(op.id);
 });
});
