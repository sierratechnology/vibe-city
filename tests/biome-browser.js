import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {chromium} from 'playwright';
import {browserAccount,startTestServer} from './auth-helper.js';
import {classifyBiome} from '../shared/planet.js';

async function exerciseBiomeBrowser({page,context,app,mode,errors}){
 await page.goto(`http://127.0.0.1:${app.server.address().port}`);
 await browserAccount(page,mode==='touch'?'Biome Touch':'Biome Desktop');
 await (mode==='touch'?page.locator('#enter').tap():page.locator('#enter').click());
 await page.waitForFunction(()=>window.vibeDiagnostics?.connected);
 await page.locator(mode==='touch'?'#stick':'#coords').waitFor({state:'visible'});
 assert.equal(await page.locator('#coords').innerText(),'Quiet Basin');
 assert.equal(await page.locator('#coords').getAttribute('role'),'status');
 const before=await page.evaluate(()=>window.vibeDiagnostics.player);
 if(mode==='desktop'){
  await page.keyboard.down('KeyD');await page.waitForTimeout(350);await page.keyboard.up('KeyD');
 }else{
  const session=await context.newCDPSession(page),box=await page.locator('#stick').boundingBox(),x=box.x+box.width/2,y=box.y+box.height/2;
  await session.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{id:1,x:x+24,y:y-28,radiusX:2,radiusY:2}]});
  await page.waitForTimeout(350);
  await session.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
 }
 await page.waitForTimeout(250);
 const moved=await page.evaluate(()=>window.vibeDiagnostics.player);
 assert.ok(Math.hypot(moved.x-before.x,moved.z-before.z)>.2);
 const id=await page.evaluate(()=>window.vibeDiagnostics.id),fixture={x:0,z:-1500};
 assert.equal(classifyBiome(fixture.x,fixture.z,app.game.world.seed).name,'Coral Shelf');
 Object.assign(app.game.world.players[id],fixture);
 await page.waitForFunction(()=>document.querySelector('#coords').textContent==='Coral Shelf');
 assert.equal(await page.evaluate(()=>window.vibeDiagnostics.biome.name),'Coral Shelf');
 assert.deepEqual(errors,[]);
 console.log(`PASS: ${mode} biome label, movement accessibility, deterministic Coral Shelf relocation, and zero page errors.`);
}

async function runBiomeBrowser(selectedMode,dependencies={}){
 const makeDirectory=dependencies.makeDirectory??(currentMode=>fs.mkdtempSync(path.join(os.tmpdir(),`vibe-biome-${currentMode}-`)));
 const startServer=dependencies.startServer??(directory=>startTestServer({port:0,host:'127.0.0.1',saveFile:path.join(directory,'world.json')}));
 const launchBrowser=dependencies.launchBrowser??(()=>chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'}));
 const executeScenario=dependencies.executeScenario??exerciseBiomeBrowser;
 const removeDirectory=dependencies.removeDirectory??(directory=>fs.rmSync(directory,{recursive:true,force:true}));
 let directory,app,browser,context,page,primaryError,hasPrimaryError=false;
 try{
  directory=makeDirectory(selectedMode);
  app=startServer(directory);
  await new Promise(resolve=>app.server.once('listening',resolve));
  browser=await launchBrowser();
  context=await browser.newContext(selectedMode==='touch'?{viewport:{width:390,height:844},isMobile:true,hasTouch:true,deviceScaleFactor:2}:{viewport:{width:1440,height:900}});
  page=await context.newPage();
  const errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await executeScenario({page,context,app,mode:selectedMode,errors});
 }catch(error){hasPrimaryError=true;primaryError=error;}
 const cleanups=[];
 if(page)cleanups.push(()=>page.close());
 if(context)cleanups.push(()=>context.close());
 if(browser)cleanups.push(()=>browser.close());
 if(app)cleanups.push(()=>app.close());
 if(directory)cleanups.push(()=>removeDirectory(directory));
 const cleanupErrors=[];
 for(const cleanup of cleanups)try{await cleanup();}catch(error){cleanupErrors.push(error);}
 if(hasPrimaryError){if(cleanupErrors.length)primaryError.cleanupErrors=cleanupErrors;throw primaryError;}
 if(cleanupErrors.length===1)throw cleanupErrors[0];
 if(cleanupErrors.length)throw new AggregateError(cleanupErrors,'Biome browser cleanup failed');
}

const mode=process.argv[2]||'desktop';
if(!['desktop','touch','cleanup-test'].includes(mode))throw Error('Expected desktop, touch, or cleanup-test mode');
if(mode==='cleanup-test'){
 for(const failure of['launch','context','page','navigation','assertion']){
  const closed=[],page={on(){},async close(){closed.push('page');}},context={async newPage(){if(failure==='page')throw Error('injected page failure');return page;},async close(){closed.push('context');}},browser={async newContext(){if(failure==='context')throw Error('injected context failure');return context;},async close(){closed.push('browser');}},app={server:{once(_event,resolve){resolve();},address(){return{port:1};}},async close(){closed.push('server');}};
  await assert.rejects(()=>runBiomeBrowser('desktop',{makeDirectory:()=>'/tmp/injected-biome',startServer:()=>app,launchBrowser:async()=>{if(failure==='launch')throw Error('injected launch failure');return browser;},executeScenario:async()=>{if(failure==='navigation')throw Error('injected navigation failure');throw Error('injected assertion failure');},removeDirectory:()=>closed.push('directory')}),new RegExp(`injected ${failure} failure`));
  const acquired=failure==='launch'?['server','directory']:failure==='context'?['browser','server','directory']:failure==='page'?['context','browser','server','directory']:['page','context','browser','server','directory'];
  assert.deepEqual(closed,acquired,`${failure} failure must release every acquired resource`);
 }
 for(const cleanupFailure of['page','context','browser','server','directory']){
  const closed=[],primaryError=Error('injected primary failure'),cleanupError=Error(`injected ${cleanupFailure} cleanup failure`),close=resource=>{closed.push(resource);if(resource===cleanupFailure)throw cleanupError;};
  const page={on(){},async close(){close('page');}},context={async newPage(){return page;},async close(){close('context');}},browser={async newContext(){return context;},async close(){close('browser');}},app={server:{once(_event,resolve){resolve();},address(){return{port:1};}},close(){close('server');}};
  await assert.rejects(()=>runBiomeBrowser('desktop',{makeDirectory:()=>'/tmp/injected-biome',startServer:()=>app,launchBrowser:async()=>browser,executeScenario:async()=>{throw primaryError;},removeDirectory:()=>close('directory')}),error=>{
   assert.equal(error,primaryError,`${cleanupFailure} cleanup must not replace the primary failure`);
   assert.deepEqual(error.cleanupErrors,[cleanupError]);
   return true;
  });
  assert.deepEqual(closed,['page','context','browser','server','directory'],`${cleanupFailure} cleanup failure must not skip later cleanup`);
 }
 {
  const cleanupError=Error('injected cleanup-only failure'),closed=[],page={on(){},async close(){closed.push('page');throw cleanupError;}},context={async newPage(){return page;},async close(){closed.push('context');}},browser={async newContext(){return context;},async close(){closed.push('browser');}},app={server:{once(_event,resolve){resolve();},address(){return{port:1};}},async close(){closed.push('server');}};
  await assert.rejects(()=>runBiomeBrowser('desktop',{makeDirectory:()=>'/tmp/injected-biome',startServer:()=>app,launchBrowser:async()=>browser,executeScenario:async()=>{},removeDirectory:()=>closed.push('directory')}),error=>error===cleanupError);
  assert.deepEqual(closed,['page','context','browser','server','directory']);
 }
 console.log('PASS: setup and scenario failures release page, context, browser, server, and temporary directory ownership.');
}else await runBiomeBrowser(mode);
