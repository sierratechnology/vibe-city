// Deterministic local two-client fixture; browser controls and WebSocket actions are real.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {startTestServer,apiAccount} from './auth-helper.js';
import {launchBrowser} from './browser-engine.js';

const requestedEngine=process.argv[2];
for(const [engine,accountNumber] of [['chromium',30],['firefox',40]].filter(([name])=>!requestedEngine||name===requestedEngine)){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),`vibe-collaboration-${engine}-`));
 const app=startTestServer({port:0,host:'127.0.0.1',saveFile:path.join(dir,'world.json')});
 await new Promise(resolve=>app.server.once('listening',resolve));
 const browser=await launchBrowser(engine);
 const owner=await browser.newPage({viewport:{width:1280,height:800}});
 const collaborator=await browser.newPage({viewport:{width:390,height:844},hasTouch:true});
 const errors=[];
 for(const page of[owner,collaborator]){page.setDefaultTimeout(10000);page.on('pageerror',error=>errors.push(error.message));}
 try{
  const base=`http://127.0.0.1:${app.server.address().port}`;
  const accounts=[await apiAccount(base,accountNumber),await apiAccount(base,accountNumber+1)];
  for(const [page,account] of [[owner,accounts[0]],[collaborator,accounts[1]]]){const[name,value]=account.cookie.split('=');await page.context().addCookies([{name,value,url:base}]);await page.goto(base);await page.locator('#findGame').click();await page.locator('#character option').waitFor({state:'attached'});await page.locator('#enter').click();await page.waitForFunction(()=>window.vibeDiagnostics.connected);}
  const ownerId=await owner.evaluate(()=>window.vibeDiagnostics.id),collaboratorId=await collaborator.evaluate(()=>window.vibeDiagnostics.id);
  const ownerPlayer=app.game.world.players[ownerId],collaboratorPlayer=app.game.world.players[collaboratorId];
  Object.assign(ownerPlayer,{x:9,z:0});Object.assign(collaboratorPlayer,{x:9,z:0});
  app.game.world.structures.push({id:'s-collab-1',type:'floor',x:9,z:0,rotation:0,health:200,owner:ownerId});
  await Promise.all([owner.waitForFunction(()=>window.vibeDiagnostics.state.structures.some(s=>s.id==='s-collab-1')),collaborator.waitForFunction(()=>window.vibeDiagnostics.state.structures.some(s=>s.id==='s-collab-1'))]);

  const tabUntil=async predicate=>{for(let i=0;i<20;i++){if(await owner.evaluate(predicate))return;await owner.keyboard.press('Tab');}assert.fail('Keyboard Tab traversal did not reach the requested terminal control.');};
  const openOwnerHabitat=async()=>{await owner.locator('body').press('KeyM');await owner.locator('#expedition').waitFor({state:'visible'});assert.equal(await owner.evaluate(()=>document.activeElement?.id),'closeExpedition');await owner.keyboard.press('Tab');assert.equal(await owner.evaluate(()=>document.activeElement?.dataset.tab),'map');await tabUntil(()=>document.activeElement?.dataset.tab==='habitat');await owner.keyboard.press('Enter');await tabUntil(()=>document.activeElement?.id==='dismantleTarget-s-collab-1');await owner.keyboard.press('Home');assert.equal(await owner.evaluate(()=>document.activeElement?.value),collaboratorId);await owner.keyboard.press('Tab');};
  await owner.bringToFront();assert.equal(await owner.evaluate(()=>document.activeElement===document.body),true);await openOwnerHabitat();
  assert.equal(await owner.evaluate(()=>document.activeElement?.textContent),'Grant dismantling access');await owner.keyboard.press('Enter');
  await owner.waitForFunction(({structureId,target})=>window.vibeDiagnostics.state.structures.find(s=>s.id===structureId)?.dismantleGrantedTo?.includes(target),{structureId:'s-collab-1',target:collaboratorId});

  await owner.locator('#dismantleAccess-s-collab-1').getByText('Revoke dismantling access').waitFor();assert.equal(await owner.evaluate(()=>document.activeElement?.id),'dismantleAccess-s-collab-1');await owner.keyboard.press('Enter');
  await owner.waitForFunction(({structureId,target})=>!window.vibeDiagnostics.state.structures.find(s=>s.id===structureId)?.dismantleGrantedTo?.includes(target),{structureId:'s-collab-1',target:collaboratorId});

  await collaborator.bringToFront();await collaborator.locator('#terminalAction').tap();
  await collaborator.locator('[data-tab="habitat"]').tap();
  const firstControls=collaborator.locator('#structureControls-s-collab-1');
  await firstControls.getByText('Owner-only by default').waitFor();
  assert.equal(await firstControls.getByRole('button',{name:'Dismantle Deck'}).count(),0);

  await owner.bringToFront();await owner.locator('#dismantleAccess-s-collab-1').getByText('Grant dismantling access').waitFor();assert.equal(await owner.evaluate(()=>document.activeElement?.id),'dismantleAccess-s-collab-1');await owner.keyboard.press('Enter');
  await owner.waitForFunction(({structureId,target})=>window.vibeDiagnostics.state.structures.find(s=>s.id===structureId)?.dismantleGrantedTo?.includes(target),{structureId:'s-collab-1',target:collaboratorId});
  await owner.keyboard.press('KeyM');assert.equal(await owner.evaluate(()=>document.activeElement?.id),'terminalAction');await owner.keyboard.press('Tab');assert.equal(await owner.evaluate(()=>document.activeElement?.id),'terminalAction');
  await collaborator.bringToFront();await firstControls.getByText('Authorized collaborator').waitFor();
  await firstControls.getByRole('button',{name:'Dismantle Deck'}).tap();
  await collaborator.waitForFunction(()=>!window.vibeDiagnostics.state.structures.some(s=>s.id==='s-collab-1'));
  assert.deepEqual({ferrite:collaboratorPlayer.inventory.ferrite,fiber:collaboratorPlayer.inventory.fiber},{ferrite:2,fiber:1});
  assert.deepEqual(errors,[]);
  console.log(`PASS ${engine}: keyboard grant/revoke, touch collaborator dismantle, one refund, revoked UI authorization.`);
 }finally{await browser.close();await app.close();fs.rmSync(dir,{recursive:true,force:true});}
}
