import {browserAccount} from './auth-helper.js';
import {launchBrowser, resolveBrowserEngine} from './browser-engine.js';
// Real browsers + real WebSocket server. No inventory grants, teleports or gameplay hooks.
import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {startTestServer as startServer} from './auth-helper.js';
const browserEngine=process.argv[2]||process.env.BROWSER_ENGINE||'chromium';resolveBrowserEngine(browserEngine);
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'vibe-browser-')),saveFile=path.join(tmp,'world.json');
let app=startServer({port:0,host:'127.0.0.1',saveFile});await new Promise(r=>app.server.once('listening',r));let port=app.server.address().port;
const browser=await launchBrowser(browserEngine);
const c1=await browser.newContext({viewport:{width:1440,height:900}}),c2=await browser.newContext({viewport:{width:1440,height:900}}),a=await c1.newPage(),b=await c2.newPage();const errors=[];for(const p of [a,b])p.on('pageerror',e=>errors.push(e.message));
const pause=ms=>new Promise(r=>setTimeout(r,ms));
const diag=p=>p.evaluate(()=>window.vibeDiagnostics);
async function join(p,name){await p.goto(`http://127.0.0.1:${port}`);await browserAccount(p,name);await p.locator('#enter').click();await p.waitForFunction(()=>window.vibeDiagnostics?.connected);}
async function walk(p,x,z){const start=Date.now();let held=[];while(Date.now()-start<22000){const d=await diag(p),q=d.player,dx=x-q.x,dz=z-q.z;if(Math.hypot(dx,dz)<.3)break;const desired=[];if(Math.abs(dx)>.18)desired.push(dx>0?'KeyD':'KeyA');if(Math.abs(dz)>.18)desired.push(dz>0?'KeyS':'KeyW');for(const k of held)if(!desired.includes(k))await p.keyboard.up(k);for(const k of desired)if(!held.includes(k))await p.keyboard.down(k);held=desired;await pause(70);if(Math.hypot(dx,dz)<2){for(const k of held)await p.keyboard.up(k);held=[];await pause(140);}}for(const k of held)await p.keyboard.up(k);await pause(200);const q=(await diag(p)).player;assert.ok(Math.hypot(q.x-x,q.z-z)<.7,`Walk failed: ${q.x},${q.z} → ${x},${z}`);}
async function gather(p,index){const node=(await diag(p)).state.resources[index];await walk(p,node.x,node.z);await p.keyboard.down('KeyE');await p.waitForFunction(id=>window.vibeDiagnostics.state.resources.find(n=>n.id===id).amount===0,node.id,{timeout:7000});await p.keyboard.up('KeyE');await pause(250);console.log('Gathered',node.type,node.id);}
try{
 await join(a,'Ada');await join(b,'Bo');await a.waitForFunction(()=>window.vibeDiagnostics.state.players.length===2&&window.vibeDiagnostics.avatars===2);await b.waitForFunction(()=>window.vibeDiagnostics.avatars===2);console.log('Two rendered clients connected');
 const first=(await diag(a)).player;await gather(a,0);await b.waitForFunction(()=>window.vibeDiagnostics.state.resources[0].amount===0);const observed=(await diag(b)).state.players.find(p=>p.name==='Ada');assert.ok(Math.hypot(observed.x-first.x,observed.z-first.z)>3);console.log('Remote movement and depletion synchronized');
 await gather(a,1);await a.keyboard.press('KeyC');await a.locator('.recipe').filter({has:a.locator('b',{hasText:'Field cutter'})}).locator('button').click();await a.waitForFunction(()=>window.vibeDiagnostics.player.cutter);await a.locator('#closeGuide').click();
 await gather(a,3);await gather(a,5);await gather(a,4);
 await walk(a,24,-17);await walk(a,24,-24);await a.keyboard.press('KeyE');await a.waitForFunction(()=>window.vibeDiagnostics.player.unlocked);console.log('Ruin unlocked through real input');
 await walk(a,24,-17);await walk(a,9,4.5);
 for(const [key,type] of [['Digit1','floor'],['Digit2','wall'],['Digit3','roof'],['Digit4','heater']]){
 if(!(await diag(a)).buildMode)await a.keyboard.press('KeyB');await a.keyboard.press(key);await pause(250);let d=await diag(a);assert.equal(d.preview.x,9);assert.equal(d.preview.z,0);
 await a.locator('#placeAction').click();
 await a.waitForFunction(type=>window.vibeDiagnostics.state.structures.some(s=>s.type===type),type,{timeout:5000});await b.waitForFunction(type=>window.vibeDiagnostics.state.structures.some(s=>s.type===type),type);console.log('Shared construction',type);
 }
 await a.keyboard.press('KeyB');await a.keyboard.press('Escape');await walk(a,9,1);await a.waitForFunction(()=>window.vibeDiagnostics.player.completed);await walk(a,9,4.5);await pause(3600);
 await a.screenshot({path:path.join(tmp,'outpost.png')});await b.screenshot({path:path.join(tmp,'second-player.png')});
 const final=await diag(a),perf={fps:final.fps,drawCalls:final.drawCalls,triangles:final.triangles,avatars:final.avatars};assert.equal(errors.length,0,errors.join('\n'));console.log('Render diagnostics',perf);
 // Restart the actual server, then rejoin from the same browser identity.
 await app.close();app=startServer({port,host:'127.0.0.1',saveFile});await new Promise(r=>app.server.once('listening',r));await join(a,'Ada');await a.waitForFunction(()=>window.vibeDiagnostics.state.structures.length===4);const restored=(await diag(a)).player;assert.deepEqual(restored.inventory,final.player.inventory);assert.equal(restored.cutter,true);assert.equal(restored.unlocked,true);assert.equal(restored.completed,true);assert.equal((await diag(a)).state.resources[0].amount,0);console.log('Server restart preserved structures, depletion, inventory and progression');
 const report={at:new Date().toISOString(),passed:true,browsers:2,renderer:browserEngine,checks:['two visible avatars','keyboard movement','remote movement','shared resource depletion','gather/craft/scan loop','four modular pieces via preview and clicks','shared construction','completion','server restart persistence'],renderSample:perf,pageErrors:errors};fs.writeFileSync(path.join(tmp,'browser-test-report.json'),JSON.stringify(report,null,2));
}finally{await browser.close();await app.close();fs.rmSync(tmp,{recursive:true});}
