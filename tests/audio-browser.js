import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {browserAccount, startTestServer} from './auth-helper.js';
import {launchBrowser, resolveBrowserEngine} from './browser-engine.js';

const engine = process.argv[2] || 'chromium';
const mode = process.argv[3] || 'desktop';
resolveBrowserEngine(engine);
if (mode === 'touch' && engine !== 'chromium') throw Error('real-touch mode requires chromium');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vibe-audio-'));
const app = startTestServer({port:0, host:'127.0.0.1', saveFile:path.join(dir, 'world.json')});
await new Promise(resolve => app.server.once('listening', resolve));
const browser = await launchBrowser(engine);
const context = await browser.newContext({viewport:mode === 'touch' ? {width:390,height:844} : {width:1440,height:900}, hasTouch:mode === 'touch', isMobile:mode === 'touch'});
const page = await context.newPage(), errors=[];
page.on('pageerror', error => errors.push(error.message));
page.setDefaultTimeout(10000);
await page.addInitScript(() => {
  window.__audioContexts = [];
  window.testPad={id:'Audio virtual controller',index:0,connected:true,mapping:'standard',axes:[0,0,0,0],buttons:Array.from({length:16},()=>({pressed:false}))};
  Object.defineProperty(navigator,'getGamepads',{value:()=>[window.testPad]});
  class TestAudioContext {
    constructor(){this.state='suspended';this.currentTime=1;this.destination={};this.oscillators=[];window.__audioContexts.push(this);}
    async resume(){this.state='running';}
    async suspend(){this.state='suspended';}
    async close(){this.state='closed';}
    createGain(){return {gain:{setValueAtTime(value){this.value=value;},exponentialRampToValueAtTime(){}},connect(){},disconnect(){}};}
    createOscillator(){const node={frequency:{setValueAtTime(value){this.value=value;}},connect(){},disconnect(){},start(){},stop(){queueMicrotask(()=>node.onended?.());},onended:null};this.oscillators.push(node);return node;}
  }
  Object.defineProperty(window, 'AudioContext', {value:TestAudioContext, configurable:true});
});
const base = `http://127.0.0.1:${app.server.address().port}`;
const press = async index => {await page.evaluate(i=>window.testPad.buttons[i].pressed=true,index);await page.waitForTimeout(100);await page.evaluate(i=>window.testPad.buttons[i].pressed=false,index);await page.waitForTimeout(100);};
try {
  await page.goto(base);
  assert.equal(await page.evaluate(() => window.__audioContexts.length), 0, 'no AudioContext before a user gesture');
  await browserAccount(page, `Audio ${engine} ${mode}`);
  await page.locator('#enter').click();
  await page.waitForFunction(() => window.vibeDiagnostics?.connected);
  assert.equal(await page.evaluate(() => window.__audioContexts.length), 1, 'first gesture creates one context');
  await page.locator('#menuButton').click();
  await page.locator('#guideTab-settings').click();
  const mute = page.getByLabel('Mute all game audio', {exact:true});
  const interfaceVolume = page.getByLabel('Interface volume', {exact:true});
  const worldVolume = page.getByLabel('World and gameplay volume', {exact:true});
  await assert.doesNotReject(() => mute.waitFor({state:'visible'}));
  assert.equal(await interfaceVolume.inputValue(), '40');
  assert.equal(await worldVolume.inputValue(), '55');
  assert.equal(await page.locator('#interfaceVolumeValue').innerText(), '40%');
  await interfaceVolume.focus();
  await page.keyboard.press('ArrowRight');
  assert.equal(await interfaceVolume.inputValue(), '41');
  await press(15);
  assert.equal(await interfaceVolume.inputValue(), '42', 'controller D-pad changes focused range');
  if (mode === 'touch') {
    const box = await worldVolume.boundingBox();
    assert.ok(box);
    const session = await context.newCDPSession(page);
    const x=box.x+box.width*.75, y=box.y+box.height/2;
    await session.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y}]});
    await session.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
    assert.notEqual(await worldVolume.inputValue(), '55');
  }
  const savedWorld = await worldVolume.inputValue();
  await mute.check();
  const mutedCount = await page.evaluate(() => window.__audioContexts[0].oscillators.length);
  await page.locator('#closeGuide').click();
  await page.locator('#menuButton').click();
  assert.equal(await page.evaluate(() => window.__audioContexts[0].oscillators.length), mutedCount);
  await page.locator('#guideTab-settings').click();
  assert.equal(await interfaceVolume.inputValue(), '42');
  assert.equal(await worldVolume.inputValue(), savedWorld);
  await mute.uncheck();
  await page.locator('#closeGuide').click();
  const beforeWorld = await page.evaluate(() => window.__audioContexts[0].oscillators.length);
  await page.locator('#eatAction').click();
  await page.waitForFunction(count => window.__audioContexts[0].oscillators.length > count, beforeWorld);
  await page.locator('#toast.show').waitFor();
  assert.ok((await page.evaluate(() => window.__audioContexts[0].oscillators.length)) > beforeWorld, 'server result routes a world cue');
  for (let index=0;index<10;index++) { await page.locator('#menuButton').click(); await page.locator('#closeGuide').click(); }
  assert.ok((await page.evaluate(() => window.vibeAudioDiagnostics().activeVoices)) <= 4, 'rapid cues stay bounded');
  await page.reload();
  await page.waitForFunction(() => document.querySelector('#interfaceVolume'));
  assert.equal(await page.locator('#interfaceVolume').inputValue(), '42');
  assert.equal(await page.locator('#worldVolume').inputValue(), savedWorld);
  await page.evaluate(() => localStorage.setItem('vc-audio-settings', '{bad'));
  await page.reload();
  await page.waitForFunction(() => document.querySelector('#interfaceVolume'));
  assert.equal(await page.locator('#interfaceVolume').inputValue(), '40');
  assert.equal(await page.locator('#worldVolume').inputValue(), '55');
  await page.mouse.click(1,1);
  await page.waitForFunction(() => window.__audioContexts.length === 1);
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide')));
  assert.equal(await page.evaluate(() => window.__audioContexts.at(-1)?.state), 'closed');
  assert.deepEqual(errors, []);
  const unavailableContext = await browser.newContext({viewport:{width:800,height:600}});
  await unavailableContext.addInitScript(() => Object.defineProperty(window,'AudioContext',{value:class{constructor(){throw Error('audio denied');}},configurable:true}));
  const unavailablePage = await unavailableContext.newPage(), unavailableErrors=[];
  unavailablePage.on('pageerror', error=>unavailableErrors.push(error.message));
  await unavailablePage.goto(base);
  await browserAccount(unavailablePage, 'No Audio');
  await unavailablePage.locator('#serverBrowser').waitFor({state:'visible'});
  assert.deepEqual(unavailableErrors, [], 'audio denial does not block navigation');
  await unavailableContext.close();
  console.log(`PASS audio browser ${engine} ${mode}: gesture gate, accessible values, input, persistence, mute, cues, bounds, cleanup, zero page errors.`);
} finally {
  await browser.close();
  await app.close();
  fs.rmSync(dir,{recursive:true,force:true});
}
