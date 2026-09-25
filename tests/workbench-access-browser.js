import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {browserAccount,startTestServer} from './auth-helper.js';
import {launchBrowser,resolveBrowserEngine} from './browser-engine.js';

const engine=process.argv[2]||'chromium',mode=process.argv[3]||'desktop';
resolveBrowserEngine(engine);
if(!['desktop','touch'].includes(mode))throw Error(`Unknown workbench access browser mode: ${mode}`);
if(mode==='touch'&&engine!=='chromium')throw Error('CDP real-touch mode requires Chromium.');
const directory=fs.mkdtempSync(path.join(os.tmpdir(),'vibe-workbench-access-')),saveFile=path.join(directory,'world.json');
const app=startTestServer({port:0,host:'127.0.0.1',saveFile});
await new Promise(resolve=>app.server.once('listening',resolve));
const browser=await launchBrowser(engine),errors=[],contexts=[];
const options=mode==='touch'?{viewport:{width:390,height:844},screen:{width:390,height:844},isMobile:true,hasTouch:true,deviceScaleFactor:2}:{viewport:{width:1440,height:900}};
const touch=async(page,session,locator)=>{const box=await locator.evaluate(element=>{element.scrollIntoView({block:'center'});const rect=element.getBoundingClientRect();return{x:rect.x,y:rect.y,width:rect.width,height:rect.height,visible:element.isConnected&&getComputedStyle(element).visibility==='visible'&&document.elementFromPoint(rect.x+rect.width/2,rect.y+rect.height/2)===element};});assert.ok(box.visible&&box.y>=0&&box.y+box.height<=844,'touch target is visible inside phone viewport');const point={id:1,x:box.x+box.width/2,y:box.y+box.height/2,radiusX:2,radiusY:2};await session.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[point]});await session.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});};
async function explorer(name){const context=await browser.newContext(options),page=await context.newPage();contexts.push(context);page.on('pageerror',error=>errors.push(error.message));await page.goto(`http://127.0.0.1:${app.server.address().port}`);await browserAccount(page,name);await page.locator('#enter').click();await page.waitForFunction(()=>window.vibeDiagnostics?.connected);const session=mode==='touch'?await context.newCDPSession(page):null;if(session)await session.send('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:1});return{page,session,id:await page.evaluate(()=>window.vibeDiagnostics.id)};}
const activate=({page,session},locator)=>mode==='touch'?touch(page,session,locator):locator.click();
try{
 const owner=await explorer('Workbench Owner'),collaborator=await explorer('Workbench Collaborator'),stranger=await explorer('Workbench Stranger');
 const ownerPlayer=app.game.world.players[owner.id],collaboratorPlayer=app.game.world.players[collaborator.id],strangerPlayer=app.game.world.players[stranger.id];
 for(const player of[ownerPlayer,collaboratorPlayer,strangerPlayer])Object.assign(player,{x:0,z:3});collaboratorPlayer.inventory.meat=2;collaboratorPlayer.inventory.fiber=2;strangerPlayer.inventory.meat=1;strangerPlayer.inventory.fiber=1;
 app.game.world.structures.push({id:'browser-bench',type:'workbench',x:0,z:3,rotation:0,health:200,owner:owner.id,workbenchQueue:[],workbenchNextSequence:0});
 await Promise.all([owner,collaborator,stranger].map(actor=>actor.page.waitForFunction(()=>window.vibeDiagnostics.state.structures.some(s=>s.id==='browser-bench'))));
 await activate(owner,owner.page.locator('#menuButton'));await owner.page.locator('#workbenchAccessCandidate').selectOption(collaborator.id);const grant=owner.page.getByRole('button',{name:'Grant workbench access'});if(mode==='desktop'){await grant.focus();await owner.page.keyboard.press('Enter');}else await activate(owner,grant);
 await owner.page.waitForFunction(id=>window.vibeDiagnostics.state.structures.find(s=>s.id==='browser-bench')?.workbenchGrantedTo?.some(character=>character.id===id),collaborator.id);await collaborator.page.waitForFunction(()=>window.vibeDiagnostics.state.structures.find(s=>s.id==='browser-bench')?.canUseWorkbench===true);
 await activate(collaborator,collaborator.page.locator('#menuButton'));const collaboratorMeal=collaborator.page.locator('.recipe').filter({hasText:'Field meal'}).getByRole('button',{name:'Queue field meal',exact:true});assert.equal(await collaboratorMeal.isEnabled(),true);await activate(collaborator,collaboratorMeal);await collaborator.page.waitForFunction(()=>window.vibeDiagnostics.state.structures.find(s=>s.id==='browser-bench')?.water===1);
 await activate(stranger,stranger.page.locator('#menuButton'));const strangerMeal=stranger.page.locator('.recipe').filter({hasText:'Field meal'}).getByRole('button',{name:'Queue field meal',exact:true});assert.equal(await strangerMeal.isDisabled(),true);assert.match(await stranger.page.locator('.recipe').filter({hasText:'Field meal'}).innerText(),/Move within 3 m of a workbench you may use/);
 const revoke=owner.page.getByRole('button',{name:`Revoke workbench access for ${collaboratorPlayer.name}`});if(mode==='desktop'){await revoke.focus();await owner.page.keyboard.press('Enter');await owner.page.waitForTimeout(300);assert.equal(await owner.page.evaluate(()=>document.activeElement?.getAttribute('aria-label')),'Grant workbench access');}else await activate(owner,revoke);
 await collaborator.page.waitForFunction(()=>window.vibeDiagnostics.state.structures.find(s=>s.id==='browser-bench')?.canUseWorkbench!==true);await collaborator.page.waitForFunction(()=>window.vibeDiagnostics.player.inventory.ration===1,{timeout:10000});assert.equal(ownerPlayer.inventory.ration,0);assert.equal(collaboratorPlayer.inventory.ration,1);
 const before={meat:collaboratorPlayer.inventory.meat,fiber:collaboratorPlayer.inventory.fiber,next:app.game.world.structures[0].workbenchNextSequence};assert.equal(await collaboratorMeal.isDisabled(),true,'revocation disables the next queue action');assert.equal(app.game.action(collaborator.id,{type:'workbench',id:'browser-bench',recipe:'ration',sequence:before.next}).ok,false,'revocation denies the next server action');assert.deepEqual({meat:collaboratorPlayer.inventory.meat,fiber:collaboratorPlayer.inventory.fiber,next:app.game.world.structures[0].workbenchNextSequence},before);assert.equal(app.game.action(stranger.id,{type:'workbench',id:'browser-bench',recipe:'ration',sequence:before.next}).ok,false,'stranger remains denied');
 assert.deepEqual(errors,[]);console.log(`${engine}: ${mode} owner grant, collaborator own-input/output queue, stranger denial, immediate revoke, focus restoration, and touch/keyboard accessibility passed`);
}finally{for(const context of contexts)await context.close();await browser.close();await app.close();fs.rmSync(directory,{recursive:true,force:true});}
