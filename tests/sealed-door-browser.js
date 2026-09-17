import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {browserAccount, startTestServer} from './auth-helper.js';
import {launchBrowser, resolveBrowserEngine} from './browser-engine.js';
import {saveWorld} from '../server/persistence.js';
import {rooms} from '../shared/rooms.js';
import {blocked, makeWorld} from '../shared/world.js';

const engine = process.argv[2] || 'chromium';
const mode = process.argv[3] || 'all';
resolveBrowserEngine(engine);
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vibe-sealed-door-browser-'));
const saveFile = path.join(dir, 'world.json');
const rulesWorld = makeWorld();
rulesWorld.structures.push(
  {id: 'floor', type: 'floor', x: 9, z: 0, rotation: 0},
  {id: 'roof', type: 'roof', x: 9, z: 0, rotation: 0},
  ...[0, 1, 2].map(rotation => ({id: `wall-${rotation}`, type: 'wall', x: 9, z: 0, rotation})),
  {id: 'outer-door', type: 'door', x: 9, z: 0, rotation: 3, open: false}
);
assert.equal(blocked(rulesWorld, 7.5, 0), true);
assert.equal(rooms(rulesWorld)[0].sealed, true);
rulesWorld.structures.at(-1).open = true;
assert.equal(blocked(rulesWorld, 7.5, 0), false);
assert.equal(rooms(rulesWorld)[0].sealed, false);
saveWorld(saveFile, rulesWorld);
const app = startTestServer({port: 0, host: '127.0.0.1', saveFile});
await new Promise(resolve => app.server.once('listening', resolve));
const browser = await launchBrowser(engine);
const pause = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

async function keyboardWalk(page, x, z) {
  const started = Date.now();
  let held = [];
  while (Date.now() - started < 22000) {
    const player = await page.evaluate(() => window.vibeDiagnostics.player);
    const dx = x - player.x, dz = z - player.z;
    if (Math.hypot(dx, dz) < .3) break;
    const desired = [];
    if (Math.abs(dx) > .18) desired.push(dx > 0 ? 'KeyD' : 'KeyA');
    if (Math.abs(dz) > .18) desired.push(dz > 0 ? 'KeyS' : 'KeyW');
    for (const key of held) if (!desired.includes(key)) await page.keyboard.up(key);
    for (const key of desired) if (!held.includes(key)) await page.keyboard.down(key);
    held = desired;
    await pause(70);
    if (Math.hypot(dx, dz) < 2) {
      for (const key of held) await page.keyboard.up(key);
      held = [];
      await pause(140);
    }
  }
  for (const key of held) await page.keyboard.up(key);
  await pause(200);
  const player = await page.evaluate(() => window.vibeDiagnostics.player);
  assert.ok(Math.hypot(player.x - x, player.z - z) < .7, `Keyboard walk failed: ${player.x},${player.z} -> ${x},${z}`);
}

async function keyboardGather(page, index) {
  const node = (await page.evaluate(() => window.vibeDiagnostics)).state.resources[index];
  await keyboardWalk(page, node.x, node.z);
  await page.keyboard.down('KeyE');
  await page.waitForFunction(id => window.vibeDiagnostics.state.resources.find(node => node.id === id).amount === 0, node.id, {timeout: 7000});
  await page.keyboard.up('KeyE');
  await pause(300);
}

async function touchWalk(page, session, x, z) {
  await page.locator('#stick').waitFor({state: 'visible'});
  const box = await page.locator('#stick').boundingBox();
  const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
  const started = Date.now();
  let active = false;
  while (Date.now() - started < 22000) {
    const player = await page.evaluate(() => window.vibeDiagnostics.player);
    const dx = x - player.x, dz = z - player.z, distance = Math.hypot(dx, dz);
    if (distance < .3) break;
    const point = {id: 1, x: cx + dx / distance * 35, y: cy + dz / distance * 35, radiusX: 2, radiusY: 2};
    await session.send('Input.dispatchTouchEvent', {type: active ? 'touchMove' : 'touchStart', touchPoints: [point]});
    active = true;
    await pause(distance < 2 ? 90 : 140);
  }
  if (active) await session.send('Input.dispatchTouchEvent', {type: 'touchEnd', touchPoints: []});
  await pause(250);
  const player = await page.evaluate(() => window.vibeDiagnostics.player);
  assert.ok(Math.hypot(player.x - x, player.z - z) < .8, `Touch walk failed: ${player.x},${player.z} -> ${x},${z}`);
}

async function touchButton(page, session, selector) {
  const box = await page.locator(selector).boundingBox();
  const point = {id: 2, x: box.x + box.width / 2, y: box.y + box.height / 2, radiusX: 2, radiusY: 2};
  await session.send('Input.dispatchTouchEvent', {type: 'touchStart', touchPoints: [point]});
  await session.send('Input.dispatchTouchEvent', {type: 'touchEnd', touchPoints: []});
}

async function touchGather(page, session, index) {
  const node = (await page.evaluate(() => window.vibeDiagnostics)).state.resources[index];
  await touchWalk(page, session, node.x, node.z);
  const box = await page.locator('#gatherAction').boundingBox();
  const point = {id: 2, x: box.x + box.width / 2, y: box.y + box.height / 2, radiusX: 2, radiusY: 2};
  await session.send('Input.dispatchTouchEvent', {type: 'touchStart', touchPoints: [point]});
  await page.waitForFunction(id => window.vibeDiagnostics.state.resources.find(node => node.id === id).amount === 0, node.id, {timeout: 7000});
  await session.send('Input.dispatchTouchEvent', {type: 'touchEnd', touchPoints: []});
  await pause(300);
}

try {
  if (mode !== 'touch') {
    const context = await browser.newContext({viewport: {width: 1440, height: 900}});
    await context.addInitScript(() => {
      window.testPad = {id: 'Standard virtual test', index: 0, connected: true, mapping: 'standard', axes: [0, 0, 0, 0], buttons: Array.from({length: 16}, () => ({pressed: false}))};
      Object.defineProperty(navigator, 'getGamepads', {value: () => window.testPad ? [window.testPad] : []});
    });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${app.server.address().port}`);
    await browserAccount(page, 'Door Operator');
    await page.locator('#enter').click();
    await page.waitForFunction(() => window.vibeDiagnostics?.connected);
    await page.locator('#menuButton').click();
    const recipe = page.locator('.recipe').filter({has: page.locator('b', {hasText: 'Sealed door'})});
    assert.equal(await recipe.locator('button').getAttribute('aria-label'), 'Select sealed door');
    await recipe.locator('button', {hasText: 'SELECT'}).click();
    await page.waitForFunction(() => window.vibeDiagnostics.buildMode && window.vibeDiagnostics.selected === 'door');
    assert.equal(await page.locator('[data-piece="door"]').getAttribute('aria-label'), 'Build sealed door');
    assert.equal(await page.locator('[data-piece="door"] > b').count(), 0, 'Tenth palette item must not advertise an unsupported keyboard shortcut');
    const rendered = await page.evaluate(() => window.vibeDiagnostics);
    assert.equal(rendered.state.structures.find(structure => structure.type === 'door').open, true);
    assert.equal(rendered.renderedDoors.length, 1);
    assert.equal(rendered.renderedDoors[0].open, true);
    assert.ok(rendered.renderedDoors[0].parts >= 3, 'Open door keeps a visible frame and leaf');
    await page.keyboard.press('Escape');
    await keyboardWalk(page, 6, 0);
    await page.waitForFunction(() => document.querySelector('#interaction').textContent.includes('Close sealed door'));
    await page.keyboard.press('KeyE');
    await page.waitForFunction(() => window.vibeDiagnostics.state.structures.find(structure => structure.id === 'outer-door').open === false);
    assert.match(await page.locator('#interaction').innerText(), /Open sealed door/);
    await page.keyboard.press('KeyE');
    await page.waitForFunction(() => window.vibeDiagnostics.state.structures.find(structure => structure.id === 'outer-door').open === true);
    await keyboardWalk(page, 9, 0);
    assert.ok((await page.evaluate(() => window.vibeDiagnostics.player)).x > 8.3, 'Player did not traverse the open sealed door');
    await page.bringToFront();
    const pressPad = async index => {await page.evaluate(i => window.testPad.buttons[i].pressed = true, index);await pause(120);await page.evaluate(i => window.testPad.buttons[i].pressed = false, index);await pause(120);};
    await pressPad(2);
    await page.waitForFunction(() => window.vibeDiagnostics.state.structures.find(structure => structure.id === 'outer-door').open === false);
    await page.keyboard.press('KeyE');
    await page.waitForFunction(() => window.vibeDiagnostics.state.structures.find(structure => structure.id === 'outer-door').open === true);
    await keyboardWalk(page, 6, 0);
    await keyboardGather(page, 0);
    await keyboardGather(page, 1);
    await keyboardGather(page, 3);
    await keyboardWalk(page, 15, -5);
    await keyboardWalk(page, 15, 4.5);
    await page.keyboard.press('KeyB');
    await page.keyboard.press('Digit1');
    await page.waitForFunction(() => window.vibeDiagnostics.preview?.x === 15 && window.vibeDiagnostics.preview?.z === 0);
    await page.locator('#placeAction').click();
    await page.waitForFunction(() => window.vibeDiagnostics.state.structures.some(structure => structure.type === 'floor' && structure.x === 15));
    await pause(350);
    await page.locator('[data-piece="door"]').click();
    await page.locator('#placeAction').click();
    await page.waitForFunction(() => window.vibeDiagnostics.state.structures.filter(structure => structure.type === 'door').length === 2);
    await page.reload();
    await browserAccount(page, 'Door Operator');
    await page.locator('#enter').click();
    await page.waitForFunction(() => window.vibeDiagnostics?.connected && window.vibeDiagnostics.state.structures.filter(structure => structure.type === 'door').length === 2);
    assert.equal((await page.evaluate(() => window.vibeDiagnostics)).state.structures.find(structure => structure.id === 'outer-door').open, true);
    assert.deepEqual(errors, []);
    console.log(`${engine}: desktop selection, placement, keyboard/controller operation, rendering, traversal, sealing, and reconnect passed`);
    await context.close();
  }

  if (engine === 'chromium' && mode !== 'desktop') {
    const context = await browser.newContext({viewport: {width: 390, height: 844}, screen: {width: 390, height: 844}, isMobile: true, hasTouch: true, deviceScaleFactor: 2});
    const page = await context.newPage();
    const session = await context.newCDPSession(page);
    await session.send('Emulation.setTouchEmulationEnabled', {enabled: true, maxTouchPoints: 1});
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${app.server.address().port}`);
    await browserAccount(page, 'Touch Door Operator');
    await page.locator('#enter').tap();
    await page.waitForFunction(() => window.vibeDiagnostics?.connected);
    assert.deepEqual(await page.evaluate(() => ({maxTouchPoints: navigator.maxTouchPoints, touchEnabled: document.documentElement.classList.contains('touch-enabled'), stickVisible: !!document.querySelector('#stick')?.getClientRects().length})), {maxTouchPoints: 1, touchEnabled: true, stickVisible: true}, 'Phone-sized context exposes visible real touch controls');
    await touchWalk(page, session, 6, 0);
    await page.waitForFunction(() => document.querySelector('#interaction').textContent.includes('Close sealed door'));
    await touchButton(page, session, '#gatherAction');
    await page.waitForFunction(() => window.vibeDiagnostics.state.structures.find(structure => structure.id === 'outer-door').open === false);
    await touchButton(page, session, '#gatherAction');
    await page.waitForFunction(() => window.vibeDiagnostics.state.structures.find(structure => structure.id === 'outer-door').open === true);
    if (mode === 'touch') {
      await touchGather(page, session, 0);
      await touchGather(page, session, 1);
      await touchGather(page, session, 3);
      await touchWalk(page, session, 15, -5);
      await touchWalk(page, session, 15, 4.5);
      await touchButton(page, session, '#buildAction');
      await page.locator('[data-piece="floor"]').tap();
      await page.waitForFunction(() => window.vibeDiagnostics.preview?.x === 15 && window.vibeDiagnostics.preview?.z === 0);
      await touchButton(page, session, '#placeAction');
      await page.waitForFunction(() => window.vibeDiagnostics.state.structures.some(structure => structure.type === 'floor' && structure.x === 15));
      await pause(350);
      await page.locator('[data-piece="door"]').tap();
      await touchButton(page, session, '#placeAction');
      await page.waitForFunction(() => window.vibeDiagnostics.state.structures.filter(structure => structure.type === 'door').length === 2);
    }
    assert.deepEqual(errors, []);
    console.log('chromium: phone-sized CDP real-touch operation and placement passed');
    await context.close();
  }
} finally {
  await browser.close();
  await app.close();
  fs.rmSync(dir, {recursive: true, force: true});
}
