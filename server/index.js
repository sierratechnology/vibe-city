import {adminHandler} from './admin.js';
import {MAX_PLAYERS,DEFAULT_SETTINGS} from '../shared/settings.js';
import {Accounts,cookieToken} from './accounts.js';
import {LocalAccountStore} from './local-accounts.js';
import {catalog,SERVER_ID} from './catalog.js';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {WebSocketServer,WebSocket} from 'ws';
import {Game} from './game.js';
import {loadWorld,saveWorld} from './persistence.js';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
export function startServer({port=Number(process.env.PORT||4173),host=process.env.HOST||'0.0.0.0',saveFile=process.env.SAVE_FILE||path.join(root,'data/world.json'),seed=Number(process.env.SEED||7319),mailer}={}){
 const accounts=new Accounts(new LocalAccountStore(path.join(path.dirname(saveFile),'accounts.json')),{mailer});const game=new Game(loadWorld(saveFile,seed));let saveError=null,lastSaved=null;
 const save=()=>{try{saveWorld(saveFile,game.world);saveError=null;lastSaved=new Date().toISOString();}catch(e){saveError='World save failed; check server disk permissions.';console.error(saveError,e.message);}};
 const server=http.createServer((req,res)=>{
 const pathname=new URL(req.url,'http://localhost').pathname;
 if(pathname==='/api/admin')return adminHandler(accounts,async fn=>{fn(game.world);save();})(req,res);
 if(pathname==='/api/account')return accounts.handle(req,res);
 if(pathname==='/api/servers'){res.setHeader('Content-Type','application/json');if(req.method!=='GET'){res.writeHead(405);return res.end(JSON.stringify({error:'Creating servers is disabled.'}));}return res.end(JSON.stringify(catalog(game.online.size,game.world.settings)));}
 if(pathname==='/health'){res.setHeader('Content-Type','application/json');return res.end(JSON.stringify({ok:!saveError,players:game.online.size,seed:game.world.seed,lastSaved,saveError}));}
 let rel=pathname==='/'?'client/index.html':pathname==='/wiki/'?'wiki/index.html':pathname.slice(1);
 if(!/^(client\/|shared\/|wiki\/|node_modules\/three\/build\/)/.test(rel)){res.writeHead(404);return res.end('Not found');}
 const file=path.resolve(root,rel);if(!file.startsWith(root+path.sep)){res.writeHead(403);return res.end();}
 fs.readFile(file,(e,data)=>{if(e){res.writeHead(404);return res.end('Not found');}res.setHeader('Content-Type',({'html':'text/html','js':'text/javascript','css':'text/css','svg':'image/svg+xml'})[path.extname(file).slice(1)]||'application/octet-stream');res.setHeader('Cache-Control','no-cache');res.end(data);});
 });
 const wss=new WebSocketServer({server,maxPayload:4096});const sockets=new Map();
 function send(ws,data){if(ws.readyState===WebSocket.OPEN&&ws.bufferedAmount<262144)ws.send(JSON.stringify(data));}
 wss.on('connection',(ws,req)=>{
 if(req.headers.origin){try{if(new URL(req.headers.origin).host!==req.headers.host){ws.close(1008,'Origin not allowed');return;}}catch{ws.close(1008,'Invalid origin');return;}}
 let id=null,count=0,joining=false;const revalidate=setInterval(async()=>{if(!id)return;try{if(!await accounts.identity(cookieToken(req),id))ws.close(1008,'Account access changed');}catch{ws.close(1008,'Account access changed');}},30000);const deadline=setTimeout(()=>{if(!id)ws.close(1008,'Join timeout');},10000);
 const limiter=setInterval(()=>count=0,1000);
 ws.on('message',async raw=>{if(++count>80){ws.close(1008,'Too many messages');return;}let m;try{m=JSON.parse(raw);}catch{return;}if(!m||typeof m!=='object')return;
 if(m.type==='join'){
 if(id||joining)return;joining=true;let character;try{character=await accounts.identity(cookieToken(req),m.character);}catch{send(ws,{type:'error',message:'Account service unavailable.'});joining=false;return;}joining=false;if(!character){send(ws,{type:'error',message:'Sign in and select one of your characters.'});return;}if(ws.readyState!==WebSocket.OPEN)return;
 if(m.server&&m.server!==SERVER_ID){send(ws,{type:'error',message:'Unknown server.'});return;}
 id=character.id;if(sockets.has(id)){send(ws,{type:'error',message:'This character is already online.'});id=null;return;}
 if(sockets.size>=(game.world.settings?.maxPlayers||MAX_PLAYERS)){id=null;send(ws,{type:'error',message:'Server full.'});return;}
 game.join(id,character.name);game.world.players[id].account=character.account;game.world.players[id].role=character.role;sockets.set(id,ws);clearTimeout(deadline);send(ws,{type:'welcome',id,state:game.snapshot(id)});save();return;
 }
 if(!id)return;
 if(m.type==='input')game.input(id,m);else{const result=game.action(id,m);if(result.ok)save();send(ws,{type:'result',...result});}
 });
 ws.on('close',()=>{clearTimeout(deadline);clearInterval(limiter);clearInterval(revalidate);if(id){game.leave(id);sockets.delete(id);save();}});ws.on('error',()=>{});
 });
 let backupDay=new Date().toISOString().slice(0,10);let ticks=0;const tick=setInterval(()=>{game.tick(.05);if(++ticks%2===0){for(const [playerId,ws]of sockets)send(ws,{type:'state',state:game.snapshot(playerId),inputAck:game.inputAck(playerId),saveError,lastSaved});}if(ticks%100===0){save();const day=new Date().toISOString().slice(0,10);if(day!==backupDay){try{const dir=path.join(path.dirname(saveFile),'daily');saveWorld(path.join(dir,day+'.json'),game.world);backupDay=day;for(const file of fs.readdirSync(dir).filter(f=>/^\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort().slice(0,-8))fs.unlinkSync(path.join(dir,file));}catch(e){console.error('Daily backup failed:',e.message);}}}},50);
 server.listen(port,host,()=>console.log(`Vibe City: First Signal → http://localhost:${server.address().port} | seed ${game.world.seed}`));
 const close=()=>new Promise(resolve=>{clearInterval(tick);save();for(const ws of wss.clients)ws.terminate();wss.close();server.close(resolve);});
 return{server,game,close,save};
}
if(process.argv[1]===fileURLToPath(import.meta.url)){const app=startServer();for(const sig of ['SIGINT','SIGTERM'])process.once(sig,async()=>{await app.close();process.exit(0);});}
