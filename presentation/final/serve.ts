import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildFinalApp } from './bundle.ts';
const root=path.dirname(fileURLToPath(import.meta.url));
const types: Record<string, string>={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.webp':'image/webp','.svg':'image/svg+xml','.pdf':'application/pdf','.zip':'application/zip'};
const server=createServer(async(req,res)=>{
 try{
  if(!['GET','HEAD'].includes(req.method ?? '')){res.writeHead(405,{Allow:'GET, HEAD'}).end();return;}
  const pathname=decodeURIComponent(new URL(req.url ?? '/','http://127.0.0.1').pathname);
  if(pathname==='/app.js'){
   const script=await buildFinalApp();
   res.writeHead(200,{'Content-Type':types['.js'],'Content-Length':Buffer.byteLength(script),'Cache-Control':'no-cache','X-Content-Type-Options':'nosniff'});
   res.end(req.method==='HEAD'?undefined:script);return;
  }
  const target=path.resolve(root,'.'+(pathname==='/'?'/index.html':pathname));
  if(!target.startsWith(root+path.sep)||!types[path.extname(target)]){res.writeHead(404).end('Not found');return;}
  const data=await readFile(target);
  res.writeHead(200,{'Content-Type':types[path.extname(target)],'Content-Length':data.length,'Cache-Control':'no-cache','X-Content-Type-Options':'nosniff'});
  res.end(req.method==='HEAD'?undefined:data);
 }catch{res.writeHead(404).end('Not found');}
});
server.listen(4173,'127.0.0.1',()=>console.log('FireLink final presentation: http://127.0.0.1:4173'));
server.on('error',e=>{console.error(e.message);process.exitCode=1;});
