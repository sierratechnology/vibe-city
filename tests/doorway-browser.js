import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {browserAccount, startTestServer} from './auth-helper.js';
import {launchBrowser, resolveBrowserEngine} from './browser-engine.js';

const engine = process.argv[2] || 'chromium';
const mode = process.argv[3] || 'all';
resolveBrowserEngine(engine);
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vibe-doorway-browser-'));
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
  assert.ok(Math.hypot(player.x - x, player.z - z) < .7, `Keyboard walk failed: ${player.x},${player.z} -> ${x},${z}`);
}

async function keyboardGather(page, index) {
  const node = (await diagnostics(page)).state.resources[index];
  await keyboardWalk(page, node.x, node.z);
  await page.keyboard.down('KeyE');
  await page.waitForFunction(id => window.vibeDiagnostics.state.resources.find(node => node.id === id).amount === 0, node.id, {timeout: 7000});
  await page.keyboard.up('KeyE');
  await pause(300);
}

async function verifySelection(page) {
  await page.locator('#menuButton').click();
  const doorway = page.locator('.recipe').filter({has: page.locator('b', {hasText: 'Doorway frame'})});
  assert.equal(await doorway.locator('button').getAttribute('aria-label'), 'Select doorway frame');
  await doorway.locator('button', {hasText: 'SELECT'}).click();
  await page.waitForFunction(() => window.vibeDiagnostics.buildMode && window.vibeDiagnostics.selected === 'doorway');
  assert.equal(await page.locator('[data-piece="doorway"]').getAttribute('aria-label'), 'Build doorway frame');
  await page.waitForFunction(() => window.vibeDiagnostics.previewParts === 3, null, {timeout: 2000});
}

async function desktopJourney(page) {
  await verifySelection(page);
  await page.keyboard.press('Escape');
  await keyboardGather(page, 0);
  await keyboardGather(page, 1);
  await keyboardWalk(page, 9, 4.5);

  await page.keyboard.press('KeyB');
  await page.keyboard.press('Digit1');
  await page.waitForFunction(() => window.vibeDiagnostics.preview?.x === 9 && window.vibeDiagnostics.preview?.z === 0);
  await page.locator('#gatherAction').click();
  await page.waitForFunction(() => window.vibeDiagnostics.state.structures.some(structure => structure.type === 'floor'));
  await pause(350);

  await page.keyboard.press('Digit8');
  await page.waitForFunction(() => window.vibeDiagnostics.selected === 'doorway' && window.vibeDiagnostics.previewParts === 3);
  await page.locator('#gatherAction').click();
  await page.waitForFunction(() => window.vibeDiagnostics.state.structures.some(structure => structure.type === 'doorway'));
  assert.equal((await diagnostics(page)).state.structures.filter(structure => structure.type === 'doorway').length, 1);

  await page.keyboard.press('Escape');
  await keyboardWalk(page, 9, -3);
  assert.ok((await diagnostics(page)).player.z < -2.3, 'Player did not traverse the doorway opening');
  await page.locator('#removeAction').click();
  await page.waitForFunction(() => !window.vibeDiagnostics.state.structures.some(structure => structure.type === 'doorway'));
  assert.equal((await diagnostics(page)).player.inventory.ferrite, 2);
  console.log(`${engine}: desktop keyboard selection, placement, rendered opening, traversal, and dismantling passed`);
}

async function touchWalk(page, session, x, z) {
  await page.locator('#stick').waitFor({state: 'visible'});
  const box = await page.locator('#stick').boundingBox();
  const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
  const send = (type, points) => session.send('Input.dispatchTouchEvent', {type, touchPoints: points});
  const started = Date.now();
  let active = false;
  while (Date.now() - started < 22000) {
    const player = (await diagnostics(page)).player;
    const dx = x - player.x, dz = z - player.z, distance = Math.hypot(dx, dz);
    if (distance < .3) break;
    const point = {id: 1, x: cx + dx / distance * 35, y: cy + dz / distance * 35, radiusX: 2, radiusY: 2};
    await send(active ? 'touchMove' : 'touchStart', [point]);
    active = true;
    await pause(distance < 2 ? 90 : 140);
  }
  if (active) await send('touchEnd', []);
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

async function touchJourney(page, context) {
  const session = await context.newCDPSession(page);
  await verifySelection(page);
  await page.locator('#buildAction').tap();
  const [ferriteNode, fiberNode] = mode === 'all' ? [3, 4] : [0, 1];
  await touchGather(page, session, ferriteNode);
  await touchGather(page, session, fiberNode);
  await touchWalk(page, session, 15, 4.5);

  await page.locator('#buildAction').tap();
  await page.locator('[data-piece="floor"]').tap();
  await page.waitForFunction(() => window.vibeDiagnostics.preview?.x === 15 && window.vibeDiagnostics.preview?.z === 0);
  await page.locator('#gatherAction').tap();
  await pause(1000);
  const floorPlaced = (await diagnostics(page)).state.structures.some(structure => structure.type === 'floor' && structure.x === 15 && structure.z === 0);
  if (!floorPlaced) throw new Error(`Touch floor placement failed: ${await page.locator('#toast').innerText()} | ${JSON.stringify(await diagnostics(page))}`);
  await pause(350);

  await page.locator('[data-piece="doorway"]').tap();
  await page.locator('#gatherAction').tap();
  await page.waitForFunction(() => window.vibeDiagnostics.state.structures.some(structure => structure.type === 'doorway'));
  await page.locator('#buildAction').tap();
  await touchWalk(page, session, 15, -3);
  await page.locator('#removeAction').tap();
  await page.waitForFunction(() => !window.vibeDiagnostics.state.structures.some(structure => structure.type === 'doorway'));
  assert.equal((await diagnostics(page)).player.inventory.ferrite, 2);
  console.log('chromium: phone-sized touch selection, placement, rendered opening, traversal, and dismantling passed');
}

try {
  if (mode !== 'touch') {
    const desktopContext = await browser.newContext({viewport: {width: 1440, height: 900}});
    const desktop = await desktopContext.newPage();
    const errors = [];
    desktop.on('pageerror', error => errors.push(error.message));
    await join(desktop, 'Door Builder');
    await desktopJourney(desktop);
    assert.deepEqual(errors, []);
    await desktopContext.close();
  }

  if (engine === 'chromium' && mode !== 'desktop') {
    const touchContext = await browser.newContext({viewport: {width: 390, height: 844}, isMobile: true, hasTouch: true, deviceScaleFactor: 2});
    const touch = await touchContext.newPage();
    const touchErrors = [];
    touch.on('pageerror', error => touchErrors.push(error.message));
    await join(touch, 'Touch Builder');
    await touchJourney(touch, touchContext);
    assert.deepEqual(touchErrors, []);
    await touchContext.close();
  }
} finally {
  await browser.close();
  await app.close();
  fs.rmSync(dir, {recursive: true});
}
