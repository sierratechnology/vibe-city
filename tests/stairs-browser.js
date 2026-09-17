import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {browserAccount, startTestServer} from './auth-helper.js';
import {launchBrowser, resolveBrowserEngine} from './browser-engine.js';

const engine = process.argv[2] || 'chromium';
const mode = process.argv[3] || 'desktop';
resolveBrowserEngine(engine);
if (!['desktop', 'touch'].includes(mode)) throw new Error(`Unknown stair browser mode: ${mode}`);
if (mode === 'touch' && engine !== 'chromium') throw new Error('CDP real-touch mode requires Chromium.');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vibe-stairs-browser-'));
const saveFile = path.join(dir, 'world.json');
const app = startTestServer({port: 0, host: '127.0.0.1', saveFile});
await new Promise(resolve => app.server.once('listening', resolve));
const browser = await launchBrowser(engine);
const pause = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
const diagnostics = page => page.evaluate(() => window.vibeDiagnostics);

async function join(page, name) {
  await page.goto(`http://127.0.0.1:${app.server.address().port}`);
  await browserAccount(page, name);
  await page.locator('#enter').click();
  await page.waitForFunction(() => window.vibeDiagnostics?.connected);
}

async function verifySelection(page, activate) {
  await activate('#menuButton');
  const recipe = page.locator('.recipe').filter({has: page.locator('b', {hasText: 'Deck stair'})});
  assert.equal(await recipe.locator('button').getAttribute('aria-label'), 'Select deck stair');
  const select = recipe.locator('button', {hasText: 'SELECT'});
  if (mode === 'touch') await select.tap(); else await activate(select);
  await page.waitForFunction(() => window.vibeDiagnostics.buildMode && window.vibeDiagnostics.selected === 'stairs');
  const hotbar = page.locator('[data-piece="stairs"]');
  assert.equal(await hotbar.getAttribute('aria-label'), 'Build deck stair');
  assert.equal(await hotbar.locator('b').count(), 0, 'Deck stair must not advertise an unsupported digit shortcut');
}

async function keyboardWalk(page, x, z) {
  const started = Date.now();
  let held = [];
  while (Date.now() - started < 22000) {
    const player = (await diagnostics(page)).player;
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
  const player = (await diagnostics(page)).player;
  assert.ok(Math.hypot(player.x - x, player.z - z) < .75, `Keyboard walk failed: ${player.x},${player.z} -> ${x},${z}`);
}

async function keyboardGather(page, index) {
  const node = (await diagnostics(page)).state.resources[index];
  await keyboardWalk(page, node.x, node.z);
  await page.keyboard.down('KeyE');
  await page.waitForFunction(id => window.vibeDiagnostics.state.resources.find(node => node.id === id).amount === 0, node.id, {timeout: 7000});
  await page.keyboard.up('KeyE');
  await pause(300);
}

async function desktopJourney(page) {
  const click = async target => typeof target === 'string' ? page.locator(target).click() : target.click();
  await verifySelection(page, click);
  await page.keyboard.press('Escape');
  await keyboardGather(page, 0);
  await keyboardGather(page, 1);
  await keyboardGather(page, 26);
  await keyboardWalk(page, 9, 4.5);
  await page.keyboard.press('KeyB');
  await page.keyboard.press('Digit1');
  await page.waitForFunction(() => window.vibeDiagnostics.preview?.x === 9 && window.vibeDiagnostics.preview?.z === 0);
  await page.locator('#placeAction').click();
  await page.waitForFunction(() => window.vibeDiagnostics.state.structures.some(structure => structure.type === 'floor'));
  await pause(350);
  await page.locator('[data-piece="stairs"]').click();
  await page.keyboard.press('KeyR');
  await page.waitForFunction(() => window.vibeDiagnostics.preview?.rotation === 1 && window.vibeDiagnostics.previewStair);
  const preview = (await diagnostics(page)).previewStair;
  assert.ok(preview.angle > 0 && preview.rotation === 1, `Unexpected stair preview: ${JSON.stringify(preview)}`);
  await page.locator('#placeAction').click();
  await pause(1000);
  if (!(await diagnostics(page)).state.structures.some(structure => structure.type === 'stairs')) throw new Error(`Desktop stair placement failed: ${await page.locator('#toast').innerText()} | ${JSON.stringify(await diagnostics(page))}`);
  const placed = await diagnostics(page);
  assert.equal(placed.state.structures.find(structure => structure.type === 'stairs').rotation, 1);
  assert.equal(placed.renderedStairs.length, 1);
  assert.equal(placed.renderedStairs[0].rotation, 1);
  assert.ok(placed.renderedStairs[0].rotationZ < 0 && Math.abs(placed.renderedStairs[0].rotationX) < 1e-9, `Visible ramp points toward the wrong edge: ${JSON.stringify(placed.renderedStairs[0])}`);
  await page.keyboard.press('Escape');
  await keyboardWalk(page, 12.5, 0);
  const terrainY = (await diagnostics(page)).localPosition[1];
  await keyboardWalk(page, 9.2, 0);
  const deck = await diagnostics(page);
  assert.ok(deck.localPosition[1] > terrainY + .15, `Stair did not rise to the deck: ${terrainY} -> ${deck.localPosition[1]}`);
  assert.ok(Math.abs(deck.localPosition[1] - deck.surfaceAtPlayer) < 1e-6, 'Visible explorer height diverged from authoritative surface');
  await keyboardWalk(page, 12.5, 0);
  const descended = await diagnostics(page);
  assert.ok(Math.abs(descended.localPosition[1] - terrainY) < .08, 'Explorer did not descend back to terrain');
  await page.locator('#removeAction').click();
  await page.waitForFunction(() => !window.vibeDiagnostics.state.structures.some(structure => structure.type === 'stairs'));
  await keyboardWalk(page, 9, 0);
  await page.locator('#removeAction').click();
  await page.waitForFunction(() => window.vibeDiagnostics.state.structures.length === 0);
  assert.deepEqual({ferrite:(await diagnostics(page)).player.inventory.ferrite,fiber:(await diagnostics(page)).player.inventory.fiber},{ferrite:8,fiber:4});
}

async function touchButton(page, session, target) {
  const locator = typeof target === 'string' ? page.locator(target) : target;
  const box = await locator.boundingBox();
  assert.ok(box, `Touch target is not visible: ${target}`);
  const point = {id: 7, x: box.x + box.width / 2, y: box.y + box.height / 2, radiusX: 2, radiusY: 2};
  await session.send('Input.dispatchTouchEvent', {type: 'touchStart', touchPoints: [point]});
  await session.send('Input.dispatchTouchEvent', {type: 'touchEnd', touchPoints: []});
  await pause(120);
}

async function touchWalk(page, session, x, z) {
  await page.locator('#stick').waitFor({state: 'visible'});
  const box = await page.locator('#stick').boundingBox();
  const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
  const started = Date.now();
  let active = false;
  while (Date.now() - started < 22000) {
    const player = (await diagnostics(page)).player;
    const dx = x - player.x, dz = z - player.z, distance = Math.hypot(dx, dz);
    if (distance < .3) break;
    const point = {id: 1, x: cx + dx / distance * 35, y: cy + dz / distance * 35, radiusX: 2, radiusY: 2};
    await session.send('Input.dispatchTouchEvent', {type: active ? 'touchMove' : 'touchStart', touchPoints: [point]});
    active = true;
    await pause(distance < 2 ? 90 : 140);
  }
  if (active) await session.send('Input.dispatchTouchEvent', {type: 'touchEnd', touchPoints: []});
  await pause(250);
  const player = (await diagnostics(page)).player;
  assert.ok(Math.hypot(player.x - x, player.z - z) < .8, `Touch walk failed: ${player.x},${player.z} -> ${x},${z}`);
}

async function touchGather(page, session, index) {
  const node = (await diagnostics(page)).state.resources[index];
  await touchWalk(page, session, node.x, node.z);
  const box = await page.locator('#gatherAction').boundingBox();
  const point = {id: 2, x: box.x + box.width / 2, y: box.y + box.height / 2, radiusX: 2, radiusY: 2};
  await session.send('Input.dispatchTouchEvent', {type: 'touchStart', touchPoints: [point]});
  await page.waitForFunction(id => window.vibeDiagnostics.state.resources.find(node => node.id === id).amount === 0, node.id, {timeout: 7000});
  await session.send('Input.dispatchTouchEvent', {type: 'touchEnd', touchPoints: []});
  await pause(300);
}

async function touchJourney(page, session) {
  const touch = target => touchButton(page, session, target);
  await verifySelection(page, touch);
  await touch('#buildAction');
  await touchGather(page, session, 0);
  await touchGather(page, session, 1);
  await touchGather(page, session, 26);
  await touchWalk(page, session, 9, 4.5);
  await touch('#buildAction');
  await page.locator('[data-piece="floor"]').tap();
  await page.waitForFunction(() => window.vibeDiagnostics.preview?.x === 9 && window.vibeDiagnostics.preview?.z === 0);
  await touch('#placeAction');
  await page.waitForFunction(() => window.vibeDiagnostics.state.structures.some(structure => structure.type === 'floor'));
  await pause(350);
  await page.locator('[data-piece="stairs"]').tap();
  await touch('#rotateAction');
  await touch('#placeAction');
  await page.waitForFunction(() => window.vibeDiagnostics.state.structures.some(structure => structure.type === 'stairs'));
  assert.equal((await diagnostics(page)).renderedStairs[0].rotation, 1);
  await touch('#buildAction');
  await touchWalk(page, session, 12.5, 0);
  const terrainY = (await diagnostics(page)).localPosition[1];
  await touchWalk(page, session, 9.2, 0);
  assert.ok((await diagnostics(page)).localPosition[1] > terrainY + .15);
  await touchWalk(page, session, 12.5, 0);
  await touch('#removeAction');
  await page.waitForFunction(() => !window.vibeDiagnostics.state.structures.some(structure => structure.type === 'stairs'));
  await touchWalk(page, session, 9, 0);
  await touch('#removeAction');
  await page.waitForFunction(() => window.vibeDiagnostics.state.structures.length === 0);
}

try {
  const context = await browser.newContext(mode === 'touch'
    ? {viewport: {width: 390, height: 844}, screen: {width: 390, height: 844}, isMobile: true, hasTouch: true, deviceScaleFactor: 2}
    : {viewport: {width: 1440, height: 900}});
  const page = await context.newPage();
  const touchSession = mode === 'touch' ? await context.newCDPSession(page) : null;
  if (touchSession) await touchSession.send('Emulation.setTouchEmulationEnabled', {enabled: true, maxTouchPoints: 1});
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await join(page, mode === 'touch' ? 'Touch Stair Builder' : 'Stair Builder');
  if (mode === 'touch') await touchJourney(page, touchSession); else await desktopJourney(page);
  assert.deepEqual(errors, []);
  console.log(`${engine}: ${mode} gather, pay, select, rotate, place, traverse up/down, render parity, and cleanup passed`);
  await context.close();
} finally {
  await browser.close();
  await app.close();
  fs.rmSync(dir, {recursive: true});
}
