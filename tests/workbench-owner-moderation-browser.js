import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {apiAccount,startTestServer} from './auth-helper.js';
import {launchBrowser,resolveBrowserEngine} from './browser-engine.js';

const engine='firefox';
resolveBrowserEngine(engine);
const directory=fs.mkdtempSync(path.join(os.tmpdir(),'vibe-workbench-owner-moderation-'));
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
 await page.goto(base,{waitUntil:'domcontentloaded'});await page.locator('#landing:not(.hidden)').waitFor();await page.locator('#findGame').click();await page.locator('#character').selectOption(account.character);
 await page.locator('#enter').click();
 await page.waitForFunction(()=>window.vibeDiagnostics?.connected);
 const ownerId=await page.evaluate(()=>window.vibeDiagnostics.id),owner=app.game.world.players[ownerId];
 const collaborator=app.game.join(`${mode}-collaborator`,mode==='touch'?'Touch Bo':'Keyboard Bo');
 Object.assign(owner,{x:0,z:3});Object.assign(collaborator,{x:0,z:3});app.game.leave(collaborator.id);
 const bench={id:`${mode}-moderation-bench`,type:'workbench',x:0,z:3,rotation:0,health:200,owner:ownerId,workbenchGrants:[collaborator.id],workbenchQueue:[{id:'workbench-0',owner:ownerId,recipe:'ration',state:'in-progress',startedAt:app.game.world.time},{id:'workbench-1',owner:collaborator.id,recipe:'ration',state:'queued'}],workbenchNextSequence:2};
 app.game.world.structures.push(bench);
 await page.waitForFunction(id=>window.vibeDiagnostics.state.structures.find(s=>s.id===id)?.canModerateWorkbench===true,bench.id);
 await page.locator('#menuButton').click();
 await page.evaluate(()=>{document.documentElement.style.zoom='2';});
 const label=`Cancel ${collaborator.name}’s pending Field meal`,button=page.getByRole('button',{name:label});
 await button.scrollIntoViewIfNeeded();assert.equal(await button.isVisible(),true);assert.equal(await button.isEnabled(),true);
 assert.match(await page.locator('#workbenchModerationStatus').innerText(),new RegExp(`${collaborator.name}.*Active and blocked jobs cannot be cancelled`));
 if(mode==='touch')await button.tap();else{await button.focus();assert.equal(await page.evaluate(()=>document.activeElement?.getAttribute('aria-label')),label);await page.keyboard.press('Enter');}
 await page.waitForFunction(id=>!window.vibeDiagnostics.state.structures.find(s=>s.id===id)?.canModerateWorkbench,bench.id);
 assert.deepEqual(bench.workbenchQueue.map(job=>job.id),['workbench-0']);assert.equal(collaborator.inventory.meat,1);assert.equal(collaborator.inventory.fiber,1);assert.equal(await button.count(),0);
 if(mode==='desktop')assert.ok(await page.evaluate(()=>document.activeElement?.id==='workbenchAccessManager'||document.activeElement?.getAttribute('aria-label')==='Grant workbench access'));
 const persisted=JSON.parse(fs.readFileSync(saveFile,'utf8'));assert.equal(persisted.players[collaborator.id].inventory.meat,1);assert.equal(persisted.players[collaborator.id].inventory.fiber,1);assert.deepEqual(persisted.structures.find(s=>s.id===bench.id).workbenchQueue.map(job=>job.id),['workbench-0']);
 await page.reload({waitUntil:'domcontentloaded'});await page.locator('#landing:not(.hidden)').waitFor();await page.locator('#findGame').click();await page.locator('#character').selectOption(account.character);await page.locator('#enter').click();await page.waitForFunction(()=>window.vibeDiagnostics?.connected);await page.locator('#menuButton').click();assert.equal(await page.getByRole('button',{name:label}).count(),0);
 await context.close();
}

try{
 await journey('desktop');
 await journey('touch');
 assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
 console.log('firefox: keyboard and emulated-touch owner moderation passed at 200% zoom with reduced motion, focus restoration, reconnect persistence, zero page errors, and zero external requests');
}finally{for(const context of contexts)if(context.pages().length)await context.close();await browser.close();await app.close();fs.rmSync(directory,{recursive:true,force:true});}
