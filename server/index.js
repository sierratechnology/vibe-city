import http from 'node:http';
import {createHash} from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {WebSocketServer,WebSocket} from 'ws';
import {Game} from './game.js';
import {loadWorld,saveWorld} from './persistence.js';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
export function startServer({port=Number(process.env.PORT||4173),host=process.env.HOST||'0.0.0.0',saveFile=process.env.SAVE_FILE||path.join(root,'data/world.json'),seed=Number(process.env.SEED||7319)}={}){
 const game=new Game(loadWorld(saveFile,seed));let saveError=null,lastSaved=null;
 const save=()=>{try{saveWorld(saveFile,game.world);saveError=null;lastSaved=new Date().toISOString();}catch(e){saveError='World save failed; check server disk permissions.';console.error(saveError,e.message);}};
 const server=http.createServer((req,res)=>{
 const pathname=new URL(req.url,'http://localhost').pathname;
 if(pathname==='/health'){res.setHeader('Content-Type','application/json');return res.end(JSON.stringify({ok:!saveError,players:game.online.size,seed:game.world.seed,lastSaved,saveError}));}
 let rel=pathname==='/'?'client/index.html':pathname.slice(1);
 if(!/^(client\/|shared\/|node_modules\/three\/build\/)/.test(rel)){res.writeHead(404);return res.end('Not found');}
 const file=path.resolve(root,rel);if(!file.startsWith(root+path.sep)){res.writeHead(403);return res.end();}
 fs.readFile(file,(e,data)=>{if(e){res.writeHead(404);return res.end('Not found');}res.setHeader('Content-Type',({'html':'text/html','js':'text/javascript','css':'text/css','svg':'image/svg+xml'})[path.extname(file).slice(1)]||'application/octet-stream');res.setHeader('Cache-Control','no-cache');res.end(data);});
 });
 const wss=new WebSocketServer({server,maxPayload:4096});const sockets=new Map();
 function send(ws,data){if(ws.readyState===WebSocket.OPEN&&ws.bufferedAmount<262144)ws.send(JSON.stringify(data));}
 wss.on('connection',ws=>{
 let id=null,count=0;const deadline=setTimeout(()=>{if(!id)ws.close(1008,'Join timeout');},10000);
 const limiter=setInterval(()=>count=0,1000);
 ws.on('message',raw=>{if(++count>80){ws.close(1008,'Too many messages');return;}let m;try{m=JSON.parse(raw);}catch{return;}if(!m||typeof m!=='object')return;
 if(m.type==='join'){
 if(id)return;if(typeof m.token!=='string'||!/^\w[\w-]{15,79}$/.test(m.token)){send(ws,{type:'error',message:'Invalid explorer identity.'});return;}
 id=createHash('sha256').update(m.token).digest('hex');if(sockets.has(id)){send(ws,{type:'error',message:'This explorer is already online. Use a different pilot slot.'});id=null;return;}
 if(sockets.size>=10){id=null;send(ws,{type:'error',message:'Prototype server full (10 explorers).'});return;}
 const name=String(m.name||'Explorer').replace(/[^\p{L}\p{N} _-]/gu,'').slice(0,20)||'Explorer';game.join(id,name);sockets.set(id,ws);clearTimeout(deadline);send(ws,{type:'welcome',id,state:game.snapshot()});save();return;
 }
 if(!id)return;
 if(m.type==='input')game.input(id,m);else{const result=game.action(id,m);if(result.ok)save();send(ws,{type:'result',...result});}
 });
 ws.on('close',()=>{clearTimeout(deadline);clearInterval(limiter);if(id){game.leave(id);sockets.delete(id);save();}});ws.on('error',()=>{});
 });
 let ticks=0;const tick=setInterval(()=>{game.tick(.05);if(++ticks%2===0){const packet={type:'state',state:game.snapshot(),saveError,lastSaved};for(const ws of sockets.values())send(ws,packet);}if(ticks%100===0)save();},50);
 server.listen(port,host,()=>console.log(`Vibe City: First Signal → http://localhost:${server.address().port} | seed ${game.world.seed}`));
 const close=()=>new Promise(resolve=>{clearInterval(tick);save();for(const ws of wss.clients)ws.terminate();wss.close();server.close(resolve);});
 return{server,game,close,save};
}
if(process.argv[1]===fileURLToPath(import.meta.url)){const app=startServer();for(const sig of ['SIGINT','SIGTERM'])process.once(sig,async()=>{await app.close();process.exit(0);});}
