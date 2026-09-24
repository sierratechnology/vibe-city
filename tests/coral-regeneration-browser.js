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

const directory=fs.mkdtempSync(path.join(os.tmpdir(),'vibe-coral-regeneration-'));
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
 await bounded('verified local account and character bootstrap',30000,()=>browserAccount(page,'Coral Regeneration'));
 await page.locator('#enter').click({timeout:5000});
 await page.waitForFunction(()=>window.vibeDiagnostics?.connected,null,{timeout:9500});
 const id=await page.evaluate(()=>window.vibeDiagnostics.id),node=tileContent(app.game.world.seed,tileAt(0,-1500)).nodes.find(resource=>resource.id.startsWith('p:coral:'));
 assert.ok(node,'fixture tile must contain the deterministic Coral Shelf deposit');
 Object.assign(app.game.world.players[id],{x:node.x,z:node.z,cutter:true});
 await page.waitForFunction(nodeId=>window.vibeDiagnostics?.player.cutter===true&&window.vibeDiagnostics.state.resources.some(resource=>resource.id===nodeId&&resource.amount===6),node.id,{timeout:7500});
 assert.equal(await page.locator('#interaction').innerText(),'[E] Gather Coral Flux · 6 remaining');
 const initialCrystal=await page.evaluate(()=>window.vibeDiagnostics.player.inventory.crystal);
 for(const amount of[4,2,0]){
  await page.keyboard.press('KeyE');
  await page.waitForFunction(({nodeId,amount,crystal})=>window.vibeDiagnostics?.player.inventory.crystal===crystal&&window.vibeDiagnostics.state.resources.find(resource=>resource.id===nodeId)?.amount===amount,{nodeId:node.id,amount,crystal:initialCrystal+6-amount},{timeout:7500});
  if(amount>0){assert.equal(await page.locator('#interaction').innerText(),`[E] Gather Coral Flux · ${amount} remaining`);await page.waitForTimeout(750);}
 }
 assert.equal(app.game.world.depleted[node.id],0);
 await page.waitForFunction(nodeId=>!document.querySelector('#interaction')?.textContent.includes('Gather Coral Flux')&&window.vibeDiagnostics?.state.resources.find(resource=>resource.id===nodeId)?.amount===0,node.id,{timeout:7500});
 {
  const observedPostDepletionTime=app.game.world.time,scheduledDue=app.game.world.coralFluxRegeneration[node.id];
  assert.equal(Number.isFinite(scheduledDue),true);
  assert.ok(scheduledDue>observedPostDepletionTime);
  assert.ok(scheduledDue-observedPostDepletionTime<=300);
  app.game.world.time=scheduledDue-.001;
  assert.equal(app.game.snapshot(id).resources.find(resource=>resource.id===node.id).amount,0);
  assert.equal(app.game.world.coralFluxRegeneration[node.id],scheduledDue);
  app.game.world.time=scheduledDue;
  app.game.tick(0);
  assert.equal(app.game.world.time,scheduledDue);
  assert.equal(app.game.world.depleted[node.id],undefined);
  assert.equal(app.game.world.coralFluxRegeneration[node.id],undefined);
  assert.deepEqual(app.game.snapshot(id).resources.filter(resource=>resource.id===node.id).map(resource=>resource.amount),[6]);
  app.game.tick(0);
  assert.deepEqual(app.game.snapshot(id).resources.filter(resource=>resource.id===node.id).map(resource=>resource.amount),[6]);
 }
 await page.waitForFunction(nodeId=>window.vibeDiagnostics?.state.resources.find(resource=>resource.id===nodeId)?.amount===6,node.id,{timeout:7500});
 assert.equal(await page.locator('#interaction').innerText(),'[E] Gather Coral Flux · 6 remaining');
 const beforeRegather=await page.evaluate(()=>window.vibeDiagnostics.player.inventory.crystal);
 await page.keyboard.press('KeyE');
 await page.waitForFunction(({nodeId,before})=>window.vibeDiagnostics?.player.inventory.crystal===before+2&&window.vibeDiagnostics.state.resources.find(resource=>resource.id===nodeId)?.amount===4,{nodeId:node.id,before:beforeRegather},{timeout:7500});
 assert.equal(app.game.world.depleted[node.id],4);
 assert.equal(app.game.world.coralFluxRegeneration[node.id],undefined);
 assert.deepEqual(pageErrors,[]);
 assert.deepEqual(externalRequests,[]);
 console.log('PASS: Coral Shelf Flux was visibly labeled, depleted through three authoritative two-unit Field-cutter gathers, stayed absent before its world-time due boundary, returned at amount 6 exactly at due, and accepted one subsequent two-unit gather with zero external requests/page errors.');
}catch(error){primaryError=error;}
const cleanupErrors=[];
for(const cleanup of[()=>page?.close(),()=>context?.close(),()=>browser?.close(),()=>app?.close(),()=>fs.rmSync(directory,{recursive:true,force:true})])try{await bounded('Coral regeneration browser cleanup',1000,cleanup);}catch(error){cleanupErrors.push(error);}
if(primaryError){if(cleanupErrors.length)primaryError.cleanupErrors=cleanupErrors;throw primaryError;}
if(cleanupErrors.length===1)throw cleanupErrors[0];
if(cleanupErrors.length)throw new AggregateError(cleanupErrors,'Coral regeneration browser cleanup failed');
