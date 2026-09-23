import { createServer, type Server } from 'node:http';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { boundedRequest,validateLocalRequest } from './auth.js';
export function serve(handler:(request:Request)=>Promise<Response>,port:number):Server {
 const server=createServer(async(req,res)=>{
  try {
   const host=req.headers.host;if(!host){res.writeHead(400).end();return;}
   const headers=new Headers();for(const [key,value] of Object.entries(req.headers))if(value!==undefined)headers.set(key,Array.isArray(value)?value.join(','):value);
   const controller=new AbortController();res.on('close',()=>controller.abort());
   const request=new Request(`http://${host}${req.url??'/'}`,{method:req.method,headers,body:['GET','HEAD'].includes(req.method??'GET')?undefined:Readable.toWeb(req) as ReadableStream<Uint8Array>,duplex:'half',signal:controller.signal} as RequestInit);
   const invalid=validateLocalRequest(request,['127.0.0.1','localhost']);
   const bounded=invalid??await boundedRequest(request,1024*1024);
   const response=bounded instanceof Response?bounded:await handler(bounded);
   res.writeHead(response.status,Object.fromEntries(response.headers));
   if(response.body)await pipeline(Readable.fromWeb(response.body as import('node:stream/web').ReadableStream),res);else res.end();
  }catch{if(!res.headersSent)res.writeHead(500,{'content-type':'application/json'});res.end('{"error":"Request failed"}');}
 });
 server.requestTimeout=30000;server.headersTimeout=15000;
 server.listen(port,'127.0.0.1');return server;
}
