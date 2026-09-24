import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {chromium} from 'playwright';
import {apiAccount,startTestServer} from './auth-helper.js';
import {coralShelfLandmark} from '../shared/landmarks.js';

async function bounded(label,milliseconds,operation){
 let timer;
 try{return await Promise.race([Promise.resolve().then(operation),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error(`${label} exceeded ${milliseconds} ms`)),milliseconds);})]);}
 finally{clearTimeout(timer);}
}

async function exerciseLandmarkBrowser({page,context,app,mode,errors}){
 const base=`http://127.0.0.1:${app.server.address().port}`;
 const account=await bounded('verified local account and character bootstrap',8000,()=>apiAccount(base,mode==='touch'?42:41));
 const separator=account.cookie.indexOf('=');
 await context.addCookies([{name:account.cookie.slice(0,separator),value:account.cookie.slice(separator+1),url:base}]);
 await bounded('application navigation',10000,()=>page.goto(base,{waitUntil:'domcontentloaded',timeout:9000}));
 await bounded('verified account profile',8000,async()=>{
  await page.waitForFunction(character=>document.querySelector('#character')?.value===character,account.character,{timeout:7500});
  const profile=await page.request.get(`${base}/api/account`).then(response=>response.json());
  assert.equal(profile.profile.emailVerified,true);
  assert.ok(profile.profile.characters.some(character=>character.id===account.character));
 });
 await bounded('server browser control',5000,()=>page.locator('#findGame').click({timeout:4500}));
 await bounded('join control',8000,()=>page.locator('#enter').waitFor({state:'visible',timeout:7500}));
 await (mode==='touch'?page.locator('#enter').tap({timeout:5000}):page.locator('#enter').click({timeout:5000}));
 await bounded('connected game state',10000,()=>page.waitForFunction(()=>window.vibeDiagnostics?.connected,null,{timeout:9500}));
 await bounded(`${mode} movement control`,5000,()=>page.locator(mode==='touch'?'#stick':'#coords').waitFor({state:'visible',timeout:4500}));
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
 const id=await page.evaluate(()=>window.vibeDiagnostics.id),landmark=coralShelfLandmark(app.game.world.seed);
 Object.assign(app.game.world.players[id],{x:landmark.x,z:landmark.z});
 try{await bounded('nearby Coral Crown status',8000,()=>page.waitForFunction(()=>document.querySelector('#coords').textContent==='Coral Shelf · Near Coral Crown',null,{timeout:7500}));}
 catch(error){const observed=await page.evaluate(()=>({coords:document.querySelector('#coords')?.textContent,connected:window.vibeDiagnostics?.connected,landmark:window.vibeDiagnostics?.landmark??null}));throw Error(`Expected nearby Coral Crown status after verified account entry; observed ${JSON.stringify(observed)}`,{cause:error});}
 const diagnosticLandmark=await page.evaluate(()=>window.vibeDiagnostics.landmark);
 assert.deepEqual(Object.keys(diagnosticLandmark),Object.keys(landmark));
 for(const key of['id','kind','name','proximity'])assert.equal(diagnosticLandmark[key],landmark[key]);
 assert.ok(Math.hypot(diagnosticLandmark.x-landmark.x,diagnosticLandmark.z-landmark.z)<1e-9,'browser and server landmark coordinates must agree within floating-point precision');
 assert.deepEqual(errors,[]);
 console.log(`PASS: ${mode} baseline biome text, nearby Coral Crown status, movement path, and zero page errors.`);
}

async function runLandmarkBrowser(mode){
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),`vibe-landmark-${mode}-`));
 let app,browser,context,page,primaryError;
 try{
  app=startTestServer({port:0,host:'127.0.0.1',saveFile:path.join(directory,'world.json')});
  await bounded('local server listen',5000,()=>new Promise(resolve=>app.server.once('listening',resolve)));
  browser=await bounded('installed Google Chrome launch',10000,()=>chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'}));
  context=await browser.newContext(mode==='touch'?{viewport:{width:390,height:844},isMobile:true,hasTouch:true,deviceScaleFactor:2}:{viewport:{width:1440,height:900}});
  page=await context.newPage();
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await exerciseLandmarkBrowser({page,context,app,mode,errors});
 }catch(error){primaryError=error;}
 const cleanupErrors=[];
 for(const cleanup of[()=>page?.close(),()=>context?.close(),()=>browser?.close(),()=>app?.close(),()=>fs.rmSync(directory,{recursive:true,force:true})])try{await bounded('landmark browser cleanup',1000,cleanup);}catch(error){cleanupErrors.push(error);}
 if(primaryError){if(cleanupErrors.length)primaryError.cleanupErrors=cleanupErrors;throw primaryError;}
 if(cleanupErrors.length===1)throw cleanupErrors[0];
 if(cleanupErrors.length)throw new AggregateError(cleanupErrors,'Landmark browser cleanup failed');
}

const mode=process.argv[2]||'desktop';
if(!['desktop','touch'].includes(mode))throw Error('Expected desktop or touch mode');
await runLandmarkBrowser(mode);
