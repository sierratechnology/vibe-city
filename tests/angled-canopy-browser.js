import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as THREE from 'three';
import {browserAccount, startTestServer} from './auth-helper.js';
import {launchBrowser} from './browser-engine.js';

const engine = process.argv[2] || 'chromium';
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vibe-angled-canopy-browser-'));
const saveFile = path.join(dir, 'world.json');
const app = startTestServer({port: 0, host: '127.0.0.1', saveFile});
await new Promise(resolve => app.server.once('listening', resolve));
const browser = await launchBrowser(engine);
const pause = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
const diagnostics = page => page.evaluate(() => window.vibeDiagnostics);
const panelWorldNormal = slope => (slope.worldNormal
  ? new THREE.Vector3().fromArray(slope.worldNormal)
  : new THREE.Vector3(0, 1, 0).applyEuler(new THREE.Euler(slope.xRotation, slope.yRotation, 0, slope.order || 'XYZ')))
  .toArray().map(value => Number(value.toFixed(5)));

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

try {
  const context = await browser.newContext({viewport: {width: 1440, height: 900}});
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await join(page, 'Canopy Builder');

  await page.locator('#menuButton').click();
  const recipe = page.locator('.recipe').filter({has: page.locator('b', {hasText: 'Angled canopy'})});
  assert.equal(await recipe.locator('button').getAttribute('aria-label'), 'Select angled canopy');
  await recipe.locator('button', {hasText: 'SELECT'}).click();
  await page.waitForFunction(() => window.vibeDiagnostics.selected === 'angledCanopy' && window.vibeDiagnostics.previewSlope);
  assert.equal(await page.locator('[data-piece="angledCanopy"]').getAttribute('aria-label'), 'Build angled canopy');
  const before = await page.evaluate(() => window.vibeDiagnostics.previewSlope);
  assert.ok(Math.abs(before.xRotation) > .2, `Expected visible tilt, got ${JSON.stringify(before)}`);
  const slopes = [before];
  for (let next = 1; next < 4; next++) {
    await page.keyboard.press('KeyR');
    await page.waitForFunction(previous => Math.abs(window.vibeDiagnostics.previewSlope.yRotation - previous) > 1, slopes.at(-1).yRotation);
    slopes.push(await page.evaluate(() => window.vibeDiagnostics.previewSlope));
  }
  const slopeNormals = slopes.map(panelWorldNormal);
  assert.equal(new Set(slopeNormals.map(normal => JSON.stringify(normal))).size, 4, `Expected four rendered slope directions, got ${JSON.stringify(slopeNormals)}`);
  await page.keyboard.press('KeyR');
  await page.keyboard.press('KeyR');
  await page.waitForFunction(() => window.vibeDiagnostics.preview?.rotation === 1);
  await page.keyboard.press('Escape');
  await keyboardGather(page, 0);
  await keyboardGather(page, 1);
  await keyboardWalk(page, 9, 4.5);
  await page.keyboard.press('KeyB');
  await page.keyboard.press('Digit1');
  await page.waitForFunction(() => window.vibeDiagnostics.preview?.x === 9 && window.vibeDiagnostics.preview?.z === 0);
  await page.locator('#placeAction').click();
  await page.waitForFunction(() => window.vibeDiagnostics.state.structures.some(structure => structure.type === 'floor'));
  await pause(350);
  await page.keyboard.press('Digit9');
  await page.keyboard.press('KeyR');
  await page.locator('#placeAction').click();
  await page.waitForFunction(() => window.vibeDiagnostics.state.structures.some(structure => structure.type === 'angledCanopy'));
  const placed = await diagnostics(page);
  assert.equal(placed.state.structures.find(structure => structure.type === 'angledCanopy').rotation, 2);
  assert.equal(placed.renderedAngledCanopies.length, 1);
  assert.ok(Math.abs(placed.renderedAngledCanopies[0].xRotation) > .2);
  assert.ok(Math.abs(placed.renderedAngledCanopies[0].yRotation - Math.PI) < .01);
  assert.match(await page.locator('#steps').innerText(), /✓ Build a canopy over a deck/);
  await page.keyboard.press('Escape');
  await pause(350);
  await page.locator('#removeAction').click();
  await page.waitForFunction(() => !window.vibeDiagnostics.state.structures.some(structure => structure.type === 'angledCanopy'));
  assert.deepEqual({ferrite:(await diagnostics(page)).player.inventory.ferrite,fiber:(await diagnostics(page)).player.inventory.fiber},{ferrite:2,fiber:3});
  assert.deepEqual(errors, []);
  console.log(`${engine}: desktop selection, rotation, directional rendering, placement, and dismantling passed`);
  await context.close();

  if (engine === 'chromium') {
    const touchContext = await browser.newContext({viewport: {width: 390, height: 844}, isMobile: true, hasTouch: true, deviceScaleFactor: 2});
    const touch = await touchContext.newPage();
    const touchErrors = [];
    touch.on('pageerror', error => touchErrors.push(error.message));
    await join(touch, 'Touch Canopy Builder');
    const session = await touchContext.newCDPSession(touch);
    await touchGather(touch, session, 3);
    await touchGather(touch, session, 4);
    await touchWalk(touch, session, 15, 4.5);
    await touch.locator('#buildAction').tap();
    await touch.locator('[data-piece="floor"]').tap();
    await touch.waitForFunction(() => window.vibeDiagnostics.preview?.x === 15 && window.vibeDiagnostics.preview?.z === 0);
    await touch.locator('#placeAction').tap();
    await touch.waitForFunction(() => window.vibeDiagnostics.state.structures.some(structure => structure.type === 'floor' && structure.x === 15));
    await pause(350);
    await touch.locator('[data-piece="angledCanopy"]').tap();
    await touch.locator('#rotateAction').tap();
    await touch.locator('#placeAction').tap();
    await touch.waitForFunction(() => window.vibeDiagnostics.state.structures.some(structure => structure.type === 'angledCanopy'));
    const touchPlaced = await diagnostics(touch);
    assert.equal(touchPlaced.state.structures.find(structure => structure.type === 'angledCanopy').rotation, 1);
    assert.equal(touchPlaced.renderedAngledCanopies.length, 1);
    assert.ok(Math.abs(touchPlaced.renderedAngledCanopies[0].yRotation - Math.PI / 2) < .01);
    await touch.locator('#buildAction').tap();
    await pause(350);
    await touch.locator('#removeAction').tap();
    await touch.waitForFunction(() => !window.vibeDiagnostics.state.structures.some(structure => structure.type === 'angledCanopy'));
    assert.deepEqual(touchErrors, []);
    console.log('chromium: phone-sized real touch-event selection, rotation, placement, directional rendering, and dismantling passed');
    await touchContext.close();
  }
} finally {
  await browser.close();
  await app.close();
  fs.rmSync(dir, {recursive: true});
}
