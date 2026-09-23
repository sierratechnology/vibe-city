import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {browserAccount,startTestServer} from './auth-helper.js';
import {launchBrowser,resolveBrowserEngine} from './browser-engine.js';

const engine=process.argv[2]||'chromium',mode=process.argv[3]||'desktop';
resolveBrowserEngine(engine);
if(!['desktop','touch'].includes(mode))throw Error(`Unknown workbench browser mode: ${mode}`);
if(mode==='touch'&&engine!=='chromium')throw Error('CDP real-touch mode requires Chromium.');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'vibe-workbench-browser-'));
const app=startTestServer({port:0,host:'127.0.0.1',saveFile:path.join(dir,'world.json')});
await new Promise(resolve=>app.server.once('listening',resolve));
const browser=await launchBrowser(engine),errors=[];
const context=await browser.newContext(mode==='touch'?{viewport:{width:390,height:844},screen:{width:390,height:844},isMobile:true,hasTouch:true,deviceScaleFactor:2}:{viewport:{width:1440,height:900}});
const touch=async(page,session,locator)=>{await locator.scrollIntoViewIfNeeded();const box=await locator.boundingBox();assert.ok(box&&box.y>=0&&box.y+box.height<=844,'touch target is inside the phone viewport');const point={id:1,x:box.x+box.width/2,y:box.y+box.height/2,radiusX:2,radiusY:2};await session.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[point]});await session.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await new Promise(resolve=>setTimeout(resolve,150));};
async function join(page,name){page.on('pageerror',error=>errors.push(error.message));await page.goto(`http://127.0.0.1:${app.server.address().port}`);await browserAccount(page,name);await page.locator('#enter').click();await page.waitForFunction(()=>window.vibeDiagnostics?.connected);}
try{
 const page=await context.newPage(),session=mode==='touch'?await context.newCDPSession(page):null;if(session)await session.send('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:1});
 await join(page,mode==='touch'?'Touch Workbench Builder':'Workbench Builder');
 const id=(await page.evaluate(()=>window.vibeDiagnostics.id)),player=app.game.world.players[id];player.inventory.meat=2;player.inventory.fiber=2;app.game.world.structures.push({id:'browser-bench',type:'workbench',x:player.x,z:player.z,rotation:0,health:200,owner:id,workbenchQueue:[],workbenchNextSequence:0});
 await page.waitForFunction(()=>{const d=window.vibeDiagnostics;return d.player.inventory.meat===2&&d.state.structures.some(s=>s.id==='browser-bench');});
 const activate=locator=>mode==='touch'?touch(page,session,locator):locator.click();await activate(page.locator('#menuButton'));
 const meal=page.locator('.recipe').filter({has:page.locator('b',{hasText:'Field meal'})});await meal.locator('button').waitFor({state:'visible'});assert.equal(await meal.locator('button').getAttribute('aria-label'),'Queue field meal');assert.match(await meal.locator('p').innerText(),/Ready · 5 server seconds/);
 if(engine==='chromium'&&mode==='desktop'){await meal.locator('button').focus();assert.equal(await page.evaluate(()=>document.activeElement?.getAttribute('aria-label')),'Queue field meal');await page.keyboard.press('Enter');await page.waitForFunction(()=>window.vibeDiagnostics.state.structures.find(s=>s.id==='browser-bench')?.water===1);await new Promise(resolve=>setTimeout(resolve,700));assert.equal(await page.evaluate(()=>document.activeElement?.getAttribute('aria-label')),'Queue field meal');}else{await activate(meal.locator('button'));await page.waitForFunction(()=>window.vibeDiagnostics.state.structures.find(s=>s.id==='browser-bench')?.water===1);}await page.waitForFunction(()=>document.querySelector('.recipe p')&&[...document.querySelectorAll('.recipe')].some(r=>r.textContent.includes('Field meal')&&r.textContent.includes('IN PROGRESS')));
 await page.waitForFunction(()=>window.vibeDiagnostics.player.inventory.ration===1,{timeout:10000});assert.equal((await page.evaluate(()=>window.vibeDiagnostics.player.inventory.ration)),1);
 player.inventory.meat=1;player.inventory.fiber=1;await page.reload();await browserAccount(page,'Returning Workbench Builder');await page.locator('#enter').click();await page.waitForFunction(()=>window.vibeDiagnostics?.connected);assert.equal((await page.evaluate(()=>window.vibeDiagnostics.player.inventory.ration)),1);await new Promise(resolve=>setTimeout(resolve,500));assert.equal((await page.evaluate(()=>window.vibeDiagnostics.player.inventory.ration)),1);await activate(page.locator('#menuButton'));await meal.locator('button').waitFor({state:'visible'});await activate(meal.locator('button'));await page.waitForFunction(()=>window.vibeDiagnostics.player.inventory.ration===2,{timeout:10000});assert.deepEqual(errors,[]);
 console.log(`${engine}: ${mode} workbench queue, progress, completion, reconnect sequence, touch/keyboard-accessible controls, and exactly-once output passed`);
}finally{await context.close();await browser.close();await app.close();fs.rmSync(dir,{recursive:true});}
