import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {browserAccount,startTestServer} from './auth-helper.js';import {launchBrowser} from './browser-engine.js';
const directory=fs.mkdtempSync(path.join(os.tmpdir(),'vibe-staff-browser-'));
const app=startTestServer({port:0,host:'127.0.0.1',saveFile:path.join(directory,'world.json')});let browser;const errors=[];
try{
 await new Promise(r=>app.server.once('listening',r));browser=await launchBrowser('chromium');
 const page=await browser.newPage({viewport:{width:1440,height:900}});page.setDefaultTimeout(15000);page.on('pageerror',e=>errors.push(e.message));
 const base=`http://127.0.0.1:${app.server.address().port}`;await page.goto(base);await browserAccount(page,'Staff Tester');
 const profile=await page.request.get(base+'/api/account').then(r=>r.json());process.env.MASTER_ADMIN_EMAIL=profile.profile.email;
 await page.locator('#enter').click();await page.waitForFunction(()=>window.vibeDiagnostics?.connected);
 const id=await page.evaluate(()=>window.vibeDiagnostics.id),p=app.game.world.players[id];p.x=12;p.z=0;app.game.world.resources=[];app.game.world.creatures=[];app.save();
 await page.waitForFunction(()=>window.vibeDiagnostics.player.x===12);
 await page.locator('#menuButton').click();await page.locator('#guideTab-admin').click();await page.locator('#adminItem').selectOption('ferrite');await page.locator('#adminAmount').fill('10');await page.locator('#adminSpawn').click();
 await page.waitForFunction(()=>window.vibeDiagnostics.player.inventory.ferrite===10);
 await page.locator('#adminDestination').selectOption('ground');await page.locator('#adminAmount').fill('4');await page.locator('#adminSpawn').click();await page.waitForFunction(()=>window.vibeDiagnostics.state.resources.some(n=>n.id.startsWith('drop')));
 await page.locator('#adminQuickBuild').check();await page.locator('#adminPiece').selectOption('floor');await page.locator('#adminSelectPiece').click();await page.waitForFunction(()=>window.vibeDiagnostics.buildMode&&window.vibeDiagnostics.preview);
 const inventory=structuredClone(p.inventory);await page.locator('#gatherAction').click();await page.waitForFunction(()=>window.vibeDiagnostics.state.structures.some(s=>s.type==='floor'));assert.deepEqual(p.inventory,inventory);
 await page.locator('#buildAction').click();await page.locator('#jumpAction').click();await page.waitForFunction(()=>window.vibeDiagnostics.player.jumpHeight>0);await page.waitForFunction(()=>window.vibeDiagnostics.player.jumpHeight===0);
 assert.equal(await page.locator('#attackAction').isVisible(),false);assert.equal(await page.locator('#storageAction').isVisible(),false);
 await page.locator('#menuButton').click();await page.locator('#guideTab-admin').click();await page.screenshot({path:path.join(directory,'admin-desktop.png')});
 await page.setViewportSize({width:390,height:844});await page.screenshot({path:path.join(directory,'admin-phone.png')});assert.ok(await page.locator('#adminSpawn').isVisible());
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
 await page.locator('#closeGuide').click();await page.keyboard.press('Space');await page.waitForFunction(()=>window.vibeDiagnostics.player.jumpHeight>0);
 const peer=await browser.newPage({viewport:{width:1280,height:800}});peer.setDefaultTimeout(15000);peer.on('pageerror',e=>errors.push(e.message));await peer.goto(base);await browserAccount(peer,'Moderator Tester');await peer.locator('#enter').click();await peer.waitForFunction(()=>window.vibeDiagnostics?.connected);const peerProfile=await peer.request.get(base+'/api/account').then(r=>r.json());let grant=await page.request.post(base+'/api/admin',{data:{action:'role',username:peerProfile.profile.username,role:'moderator'}});assert.equal(grant.status(),200);await peer.locator('#menuButton').click();await peer.locator('#guideTab-admin').click();assert.equal(await peer.locator('#adminWorld').isVisible(),false);assert.equal(await peer.locator('#adminRoles').isVisible(),false);assert.equal(await peer.locator('#adminBan').isVisible(),true);await peer.locator('#closeGuide').click();await page.waitForFunction(()=>window.vibeDiagnostics.player.jumpHeight===0);await page.locator('#jumpAction').click();await peer.waitForFunction(id=>window.vibeDiagnostics.state.players.some(p=>p.id===id&&p.jumpHeight>0),id);await peer.close();
 await page.setViewportSize({width:1440,height:900});for(const [name,fraction] of [['dawn',0],['day',.25],['dusk',.5],['night',.75]]){app.game.world.time=app.game.world.planet.rotationSeconds*fraction;await page.waitForTimeout(1600);await page.screenshot({path:path.join(directory,`sun-${name}.png`)});}
 assert.deepEqual(errors,[]);console.log(JSON.stringify({result:'passed',checks:['owner panel','backpack spawn','ground spawn','free build','jump and landing','unified action buttons','phone width','keyboard jump'],screenshots:directory}));
}finally{await browser?.close();await app.close();}
