import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { CallToolResult } from '@modelcontextprotocol/server';
import { DomainError, type Result, type Owner } from '../../packages/contracts/index.js';
import { Store } from '../../packages/store/index.js';
import { Monitoring } from '../../packages/store/monitoring.js';
import { digest } from '../../packages/store/crypto.js';
import { compareOffers } from '../../packages/core/comparison.js';
import type { ToolDefinition, ResourceDefinition } from './transport.js';
const account={accountRef:z.uuid()};
const asin=z.string().regex(/^[A-Z0-9]{10}$/);
const idempotencyKey=z.string().min(8).max(120);
const pagination={page:z.number().int().min(1).max(10).optional()};
const resultSchema=z.object({status:z.string(),data:z.unknown().optional(),operationId:z.string().optional(),error:z.object({code:z.string(),retryable:z.boolean(),message:z.string().optional()}).optional()}).passthrough();
export const readSchemas:Record<string,z.ZodType>={
 products_search:z.object({...account,query:z.string().min(1).max(200),...pagination}).strict(),
 products_get:z.object({...account,asin}).strict(),
 offers_list:z.object({...account,asin}).strict(),
 product_reviews_list:z.object({...account,asin,...pagination}).strict(),
 product_media_list:z.object({...account,asin}).strict(),
 cart_get:z.object(account).strict(),
 orders_list:z.object({...account,...pagination}).strict(),
 orders_get:z.object({...account,orderId:z.string().regex(/^\d{3}-\d{7}-\d{7}$/)}).strict(),
 shipments_get:z.object({...account,orderId:z.string().regex(/^\d{3}-\d{7}-\d{7}$/)}).strict(),
 subscriptions_list:z.object(account).strict(),
};
export function content(result:Result):CallToolResult {
 const safe=JSON.parse(JSON.stringify(result));
 return {structuredContent:safe,content:[{type:'text',text:JSON.stringify(safe)}],...(['failed','conflict','outcome_unknown'].includes(result.status)?{isError:true}:{})};
}
export function createRegistry(store:Store,options:{liveEnabled:boolean;retainObservations:boolean;origin:string;readKinds?:string[];writeSchemas?:Record<string,z.ZodType>}) {
 const monitoring=new Monitoring(store);
 const tools:ToolDefinition[]=[];
 const add=(name:string,description:string,inputSchema:z.ZodType,scope:string,readOnly:boolean,handler:(input:Record<string,unknown>,owner:Owner)=>Promise<Result>)=>{
  tools.push({name,description,inputSchema,outputSchema:resultSchema,annotations:{readOnlyHint:readOnly,destructiveHint:!readOnly,idempotentHint:readOnly,openWorldHint:!['products_compare','operations_get','events_list','prices_history'].includes(name)},handler:async(input,ctx)=>{
   if(!ctx.owner.scopes.includes(scope))return content({status:'failed',error:{code:'FORBIDDEN',retryable:false}});
   try{return content(await handler(input as Record<string,unknown>,ctx.owner));}catch(e){return content({status:e instanceof DomainError&&e.status===409?'conflict':'failed',error:{code:e instanceof DomainError?e.code:'INTERNAL_ERROR',retryable:false,...(e instanceof DomainError?{message:e.message}:{})}});}
  }});
 };
 add('amazon_capabilities','Get implemented tools, source/access state, account handle and worker health. Fixture verification does not imply live support.',z.object({}).strict(),'account:read',true,async(_,owner)=>{
  const a=await store.account(owner.id);return {status:'ok',data:{accountRef:a.id,marketplace:a.marketplace,sessionGeneration:a.session_generation,quarantined:a.quarantined,workerOnline:await store.workerHealth(),liveEnabled:options.liveEnabled,verification:'fixture-verified; live account verification pending',notificationChannels:['event-inbox'],creatorsEnabled:false,keepaEnabled:false,retainsObservations:options.retainObservations,readTools:options.readKinds??Object.keys(readSchemas),writeTools:Object.keys(options.writeSchemas??{}),consequentialActions:'handoff-only; not live verified',loginCommand:'pnpm browser:login'}};
 });
 for(const kind of options.readKinds??Object.keys(readSchemas)) {
  const schema=readSchemas[kind];if(!schema)throw new Error(`No input schema for ${kind}`);
  add(kind,`Read ${kind.replaceAll('_',' ')} through the dedicated Amazon browser. Returns a durable operation; poll operations_get. Coverage is partial and source dependent.`,schema,kind.startsWith('product')||kind==='offers_list'?'catalog:read':'account:read',true,async(input,owner)=>{
   const {accountRef,...args}=input;await store.getAccount(owner.id,String(accountRef));
   if(!options.liveEnabled)return {status:'requires_user_action',action:{kind:'enable_dedicated_browser'},data:{instructions:'Complete pnpm browser:login; establish source access; set AMAZON_LIVE_ENABLED=true and restart the worker and gateway.'}};
   const op=await store.start(owner.id,String(accountRef),kind,'read',args,randomUUID());return {status:'pending',operationId:op.id};
  });
 }
 for(const [kind,schema] of Object.entries(options.writeSchemas??{}))add(kind,`Apply and verify ${kind.replaceAll('_',' ')}. Requires exact current cart revision; uncertain effects quarantine writes.`,schema,'cart:write',false,async(input,owner)=>{
  const {accountRef,idempotencyKey:key,...args}=input;await store.getAccount(owner.id,String(accountRef));
  if(!options.liveEnabled)return {status:'requires_user_action',data:{instructions:'Dedicated account login and source access must be established first.'}};
  const op=await store.start(owner.id,String(accountRef),kind,'write',args,String(key));return {status:'pending',operationId:op.id};
 });
 add('operations_get','Read owner-scoped durable progress/result. Unknown outcomes must not be retried as a new purchase.',z.object({operationId:z.uuid()}).strict(),'account:read',true,async(input,owner)=>{
  const op=await store.getOperation(owner.id,String(input.operationId));return {status:'ok',data:{id:op.id,kind:op.kind,status:op.status,revision:op.revision,result:op.result}};
 });
 add('operations_cancel','Cancel queued work only. This never cancels an Amazon order or proves a dispatched effect stopped.',z.object({operationId:z.uuid(),revision:z.number().int().positive()}).strict(),'cart:write',false,async(input,owner)=>{const op=await store.cancel(owner.id,String(input.operationId),Number(input.revision));return {status:'ok',data:{id:op.id,status:op.status,revision:op.revision}};});
 const money=z.object({currency:z.string().length(3),minorUnits:z.number().int().nonnegative()}).strict();
 const offer=z.object({asin,sellerId:z.string().optional(),condition:z.string(),purchaseMode:z.string(),price:money,shipping:money.optional(),tax:money.optional(),quantity:z.number().int().positive(),unitsPerItem:z.number().positive().optional(),unit:z.string().optional()}).strict();
 add('products_compare','Calculate unit/delivered costs from supplied offer observations. Does not fetch or certify current prices; unknown fees remain unknown.',z.object({offers:z.array(offer).min(1).max(20)}).strict(),'catalog:read',true,async(input)=>({status:'ok',data:{source:'caller-supplied-observations',items:compareOffers(input.offers as z.infer<typeof offer>[])}}));
 add('prices_history','Read retained own product observations for this account/session. No pre-install backfill; only populated when permitted retention is enabled.',z.object({...account,asin,limit:z.number().int().min(1).max(500).default(100)}).strict(),'catalog:read',true,async(input,owner)=>{
  const a=await store.getAccount(owner.id,String(input.accountRef));const subject=digest({kind:'products_get',input:{asin:input.asin},session:a.session_generation});return {status:'partial',data:{items:await monitoring.history(owner.id,a.id,subject,Number(input.limit)),source:'own-observations',retentionEnabled:options.retainObservations},coverage:{complete:false,missing:['pre-install-history'],reason:'Only permitted observations recorded by this installation'}};
 });
 const watchKinds=['shipments_get','orders_get','products_get','offers_list','subscriptions_list'] as const;
 add('watches_upsert','Create an idempotent inbox-only change watch. Minimum cadence five minutes. First observation establishes a baseline; no automatic shopping actions.',z.object({...account,kind:z.enum(watchKinds),input:z.record(z.string(),z.unknown()),cadenceSeconds:z.number().int().min(300).max(604800).default(900),expiresAt:z.iso.datetime().optional(),idempotencyKey}).strict(),'watches:write',false,async(input,owner)=>{
  if(!options.liveEnabled)return {status:'requires_user_action',data:{instructions:'Enable and verify a dedicated source before starting scheduled observation.'}};
  const kind=String(input.kind);const parsed=readSchemas[kind]!.parse({...input.input as object,accountRef:input.accountRef}) as Record<string,unknown>;delete parsed.accountRef;
  return {status:'ok',data:await monitoring.create(owner.id,String(input.accountRef),kind,parsed,Number(input.cadenceSeconds),input.expiresAt as string|undefined,String(input.idempotencyKey))};
 });
 add('watches_list','List owner watches, next due time and last successful observation.',z.object({}).strict(),'account:read',true,async(_,owner)=>({status:'ok',data:{items:await monitoring.list(owner.id)}}));
 add('watches_pause','Pause/resume a watch using optimistic revision checking.',z.object({watchRef:z.uuid(),paused:z.boolean(),revision:z.number().int().positive()}).strict(),'watches:write',false,async(i,o)=>{await monitoring.pause(o.id,String(i.watchRef),Boolean(i.paused),Number(i.revision));return {status:'ok'};});
 add('watches_delete','Delete an owner watch without altering its Amazon subject.',z.object({watchRef:z.uuid()}).strict(),'watches:write',false,async(i,o)=>{await monitoring.remove(o.id,String(i.watchRef));return {status:'ok'};});
 add('events_list','Read durable owner notifications after an opaque sequence cursor. MCP cannot wake a closed client.',z.object({cursor:z.string().regex(/^\d{1,18}$/).default('0'),limit:z.number().int().min(1).max(100).default(50)}).strict(),'account:read',true,async(i,o)=>({status:'ok',data:await monitoring.events(o.id,String(i.cursor),Number(i.limit))}));
 add('events_acknowledge','Mark inbox events read; never performs downstream shopping actions.',z.object({eventIds:z.array(z.uuid()).max(100)}).strict(),'watches:write',false,async(i,o)=>{await monitoring.acknowledge(o.id,i.eventIds as string[]);return {status:'ok'};});
 const resources:ResourceDefinition[]=[{name:'event-inbox',uri:'amazon://events',description:'Owner-scoped persisted notification inbox',mimeType:'application/json',handler:async(uri,ctx)=>{
  if(!ctx.owner.scopes.includes('account:read'))throw new DomainError('FORBIDDEN','Read scope required',403);
  return {contents:[{uri:uri.toString(),mimeType:'application/json',text:JSON.stringify(await monitoring.events(ctx.owner.id))}]};
 }}];
 return {tools,resources};
}
