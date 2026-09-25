import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {apiAccount,startTestServer} from './auth-helper.js';
import {launchBrowser,resolveBrowserEngine} from './browser-engine.js';

const engine='firefox';
resolveBrowserEngine(engine);
const directory=fs.mkdtempSync(path.join(os.tmpdir(),'vibe-workbench-yield-'));
const saveFile=path.join(directory,'world.json');
const app=startTestServer({port:0,host:'127.0.0.1',saveFile});
await new Promise(resolve=>app.server.once('listening',resolve));
const browser=await launchBrowser(engine),errors=[],external=[],contexts=[];

async function journey(mode){
  const base=`http://127.0.0.1:${app.server.address().port}`,account=await apiAccount(base,mode==='touch'?2:1),[name,value]=account.cookie.split('=');
  const context=await browser.newContext({viewport:mode==='touch'?{width:390,height:844}:{width:1280,height:800},hasTouch:mode==='touch',reducedMotion:'reduce'});contexts.push(context);
  await context.addCookies([{name,value,url:base}]);
  const page=await context.newPage();
  page.on('pageerror',error=>errors.push(`${mode}: ${error.message}`));
  page.on('request',request=>{const url=new URL(request.url());if(!['127.0.0.1','localhost'].includes(url.hostname))external.push(request.url());});
  await page.goto(base,{waitUntil:'domcontentloaded'});await page.locator('#landing:not(.hidden)').waitFor();await page.locator('#findGame').click();await page.locator('#character').selectOption(account.character);await page.locator('#enter').click();await page.waitForFunction(()=>window.vibeDiagnostics?.connected);
  const viewerId=await page.evaluate(()=>window.vibeDiagnostics.id),viewer=app.game.world.players[viewerId],owner=app.game.join(`${mode}-owner`,`${mode} owner`),following=app.game.join(`${mode}-following`,`${mode} following`);Object.assign(viewer,{x:0,z:3});Object.assign(owner,{x:0,z:3});Object.assign(following,{x:0,z:3});app.game.leave(owner.id);app.game.leave(following.id);
  const bench={id:`${mode}-yield-bench`,type:'workbench',x:0,z:3,rotation:0,health:200,owner:owner.id,workbenchQueue:[{id:'workbench-0',owner:owner.id,recipe:'ration',state:'in-progress',startedAt:app.game.world.time},{id:'workbench-1',owner:viewerId,recipe:'ration',state:'queued'},{id:'workbench-2',owner:following.id,recipe:'ration',state:'queued'}],workbenchNextSequence:3};app.game.world.structures.push(bench);
  await page.waitForFunction(id=>window.vibeDiagnostics.state.structures.find(s=>s.id===id)?.canYieldWorkbench===true,bench.id);await page.locator('#menuButton').click();await page.locator('#guideTab-fabrication').click();await page.evaluate(()=>{document.documentElement.style.zoom='2';});
  const label='Let next Field meal go first',button=page.getByRole('button',{name:label}),control=await button.evaluate(element=>{element.scrollIntoView({block:'nearest'});const bounds=element.getBoundingClientRect(),style=getComputedStyle(element);return{bounds:{x:bounds.x,y:bounds.y,width:bounds.width,height:bounds.height},visible:style.visibility!=='hidden'&&style.display!=='none'&&bounds.width>0&&bounds.height>0,enabled:!element.disabled};});assert.equal(control.visible,true);assert.equal(control.enabled,true);const{bounds}=control;assert.ok(bounds.y>=0&&bounds.y+bounds.height<=(mode==='touch'?844:800));const ferrite=viewer.inventory.ferrite;await button.evaluate(element=>window.yieldControlIdentity=element);viewer.inventory.ferrite=ferrite+1;await page.waitForFunction(ferrite=>window.vibeDiagnostics.player.inventory.ferrite===ferrite+1,ferrite);assert.equal(await button.evaluate(element=>element===window.yieldControlIdentity),true);await page.evaluate(()=>delete window.yieldControlIdentity);
  if(mode==='touch')await page.touchscreen.tap(bounds.x+bounds.width/2,bounds.y+bounds.height/2);else{await button.evaluate(element=>element.focus());assert.equal(await page.evaluate(()=>document.activeElement?.getAttribute('aria-label')),label);await page.keyboard.press('Enter');}
  await page.waitForFunction(id=>!window.vibeDiagnostics.state.structures.find(s=>s.id===id)?.canYieldWorkbench,bench.id);assert.deepEqual(bench.workbenchQueue.map(job=>job.id),['workbench-0','workbench-2','workbench-1']);assert.equal(await button.count(),0);if(mode==='desktop')assert.equal(await page.evaluate(()=>document.activeElement?.getAttribute('aria-label')),'Queue field meal');
  const persisted=JSON.parse(fs.readFileSync(saveFile,'utf8'));assert.deepEqual(persisted.structures.find(s=>s.id===bench.id).workbenchQueue.map(job=>job.id),['workbench-0','workbench-2','workbench-1']);
  await page.reload({waitUntil:'domcontentloaded'});await page.locator('#landing:not(.hidden)').waitFor();await page.locator('#findGame').click();await page.locator('#character').selectOption(account.character);await page.locator('#enter').click();await page.waitForFunction(()=>window.vibeDiagnostics?.connected);await page.locator('#menuButton').click();assert.equal(await page.getByRole('button',{name:label}).count(),0);assert.deepEqual(await page.evaluate(id=>window.vibeDiagnostics.state.structures.find(s=>s.id===id)?['persisted']:[],bench.id),['persisted']);
  await context.close();
}

try{
  await journey('desktop');
  await journey('touch');
  assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
  console.log('firefox: keyboard and emulated-touch one-position Workbench yield passed at 200% zoom with reduced motion, focus restoration, reconnect persistence, zero page errors, and zero external requests');
}finally{for(const context of contexts)if(context.pages().length)await context.close();await browser.close();await app.close();fs.rmSync(directory,{recursive:true,force:true});}
