import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {chromium} from 'playwright';
import {browserAccount,startTestServer} from './auth-helper.js';
import {tileAt,tileContent} from '../shared/planet.js';

async function bounded(label,milliseconds,operation){
 let timer;
 try{return await Promise.race([Promise.resolve().then(operation),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error(`${label} exceeded ${milliseconds} ms`)),milliseconds);})]);}
 finally{clearTimeout(timer);}
}

const directory=fs.mkdtempSync(path.join(os.tmpdir(),'vibe-coral-resource-'));
let app,browser,context,page,primaryError;
try{
 app=startTestServer({port:0,host:'127.0.0.1',saveFile:path.join(directory,'world.json')});
 await bounded('local server listen',5000,()=>new Promise(resolve=>app.server.once('listening',resolve)));
 const base=`http://127.0.0.1:${app.server.address().port}`;
 browser=await bounded('installed Google Chrome launch',10000,()=>chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'}));
 context=await browser.newContext({viewport:{width:1440,height:900}});
 page=await context.newPage();
 const pageErrors=[],externalRequests=[];
 page.on('pageerror',error=>pageErrors.push(error.message));
 page.on('request',request=>{const url=new URL(request.url());if(url.hostname!=='127.0.0.1')externalRequests.push(request.url());});
 await bounded('application navigation',10000,()=>page.goto(base,{waitUntil:'domcontentloaded',timeout:9000}));
 await bounded('verified local account and character bootstrap',8000,()=>browserAccount(page,'Coral Resource'));
 await page.locator('#enter').click({timeout:5000});
 await page.waitForFunction(()=>window.vibeDiagnostics?.connected,null,{timeout:9500});
 const id=await page.evaluate(()=>window.vibeDiagnostics.id),tile=tileAt(0,-1500),node=tileContent(app.game.world.seed,tile).nodes.find(resource=>resource.id.startsWith('p:coral:'));
 assert.ok(node,'fixture tile must contain the deterministic Coral Shelf deposit');
 Object.assign(app.game.world.players[id],{x:node.x,z:node.z,cutter:true});
 await page.waitForFunction(nodeId=>window.vibeDiagnostics?.player.cutter===true&&window.vibeDiagnostics.state.resources.some(resource=>resource.id===nodeId&&resource.amount===6),node.id,{timeout:7500});
 await page.waitForFunction(()=>document.querySelector('#interaction')?.textContent==='[E] Gather Coral Flux · 6 remaining',null,{timeout:7500});
 assert.equal(await page.locator('#interaction').innerText(),'[E] Gather Coral Flux · 6 remaining');
 const before=await page.evaluate(()=>window.vibeDiagnostics.player.inventory.crystal);
 await page.keyboard.press('KeyE');
 await page.waitForFunction(({nodeId,before})=>window.vibeDiagnostics?.player.inventory.crystal===before+2&&window.vibeDiagnostics.state.resources.filter(resource=>resource.id===nodeId).length===1&&window.vibeDiagnostics.state.resources.find(resource=>resource.id===nodeId).amount===4,{nodeId:node.id,before},{timeout:7500});
 assert.equal(app.game.world.players[id].inventory.crystal,before+2);
 assert.equal(app.game.world.depleted[node.id],4);
 assert.equal(app.game.snapshot(id).resources.find(resource=>resource.id===node.id).amount,4);
 assert.equal(await page.locator('#interaction').innerText(),'[E] Gather Coral Flux · 4 remaining');
 assert.deepEqual(pageErrors,[]);
 assert.deepEqual(externalRequests,[]);
 console.log('PASS: Coral Shelf Flux deposit rendered through existing resource state, exposed meaningful interaction text, gathered two units authoritatively with a Field cutter, reflected depletion in the next snapshot, and made zero external requests/page errors.');
}catch(error){primaryError=error;}
const cleanupErrors=[];
for(const cleanup of[()=>page?.close(),()=>context?.close(),()=>browser?.close(),()=>app?.close(),()=>fs.rmSync(directory,{recursive:true,force:true})])try{await bounded('Coral resource browser cleanup',1000,cleanup);}catch(error){cleanupErrors.push(error);}
if(primaryError){if(cleanupErrors.length)primaryError.cleanupErrors=cleanupErrors;throw primaryError;}
if(cleanupErrors.length===1)throw cleanupErrors[0];
if(cleanupErrors.length)throw new AggregateError(cleanupErrors,'Coral resource browser cleanup failed');
