import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {browserAccount} from './auth-helper.js';
import {launchBrowser, resolveBrowserEngine} from './browser-engine.js';
import {startTestServer as startServer} from './auth-helper.js';

const browserEngine = process.argv[2] || process.env.BROWSER_ENGINE || 'chromium';
resolveBrowserEngine(browserEngine);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vibe-reconnect-'));
const saveFile = path.join(tmp, 'world.json');
let app = startServer({port: 0, host: '127.0.0.1', saveFile});
await new Promise(resolve => app.server.once('listening', resolve));
const port = app.server.address().port;
const browser = await launchBrowser(browserEngine);
const context = await browser.newContext({viewport: {width: 1440, height: 900}});
const page = await context.newPage();
const errors = [];
page.on('pageerror', error => errors.push(error.message));
const pause = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
const diagnostics = () => page.evaluate(() => window.vibeDiagnostics);

async function walkByKey(key, predicate, argument = null) {
  await page.keyboard.down(key);
  try {
    await page.waitForFunction(predicate, argument, {timeout: 5000});
  } finally {
    await page.keyboard.up(key);
  }
  await pause(200);
}

async function gather(resourceIndex) {
  const resource = (await diagnostics()).state.resources[resourceIndex];
  const start = Date.now();
  let held = [];
  while (Date.now() - start < 12000) {
    const {player} = await diagnostics();
    const dx = resource.x - player.x;
    const dz = resource.z - player.z;
    if (Math.hypot(dx, dz) < 0.6) break;
    const desired = [];
    if (Math.abs(dx) > 0.18) desired.push(dx > 0 ? 'KeyD' : 'KeyA');
    if (Math.abs(dz) > 0.18) desired.push(dz > 0 ? 'KeyS' : 'KeyW');
    for (const key of held) if (!desired.includes(key)) await page.keyboard.up(key);
    for (const key of desired) if (!held.includes(key)) await page.keyboard.down(key);
    held = desired;
    await pause(70);
  }
  for (const key of held) await page.keyboard.up(key);
  await page.keyboard.down('KeyE');
  try {
    await page.waitForFunction(id => window.vibeDiagnostics.state.resources.find(node => node.id === id).amount === 0, resource.id, {timeout: 7000});
  } finally {
    await page.keyboard.up('KeyE');
  }
}

async function walkTo(x, z) {
  const start = Date.now();
  let held = [];
  while (Date.now() - start < 12000) {
    const {player} = await diagnostics();
    const dx = x - player.x;
    const dz = z - player.z;
    if (Math.hypot(dx, dz) < 0.6) break;
    const desired = [];
    if (Math.abs(dx) > 0.18) desired.push(dx > 0 ? 'KeyD' : 'KeyA');
    if (Math.abs(dz) > 0.18) desired.push(dz > 0 ? 'KeyS' : 'KeyW');
    for (const key of held) if (!desired.includes(key)) await page.keyboard.up(key);
    for (const key of desired) if (!held.includes(key)) await page.keyboard.down(key);
    held = desired;
    await pause(70);
  }
  for (const key of held) await page.keyboard.up(key);
  const {player} = await diagnostics();
  assert.ok(Math.hypot(player.x - x, player.z - z) < 0.7, `walk failed: ${player.x},${player.z} → ${x},${z}`);
}

try {
  await page.goto(`http://127.0.0.1:${port}`);

  await browserAccount(page, 'Reconnect Pilot');
  await page.locator('#enter').click();
  await page.waitForFunction(() => window.vibeDiagnostics?.connected);

  await gather(0);
  await gather(1);
  await walkTo(9, 4.5);
  await page.keyboard.press('KeyB');
  await page.keyboard.press('Digit1');
  await page.waitForFunction(() => window.vibeDiagnostics.preview?.x === 9 && window.vibeDiagnostics.preview?.z === 0);
  await page.locator('#gatherAction').click();
  await page.waitForFunction(() => window.vibeDiagnostics.state.structures.length === 1);
  await page.keyboard.press('KeyB');

  const before = await diagnostics();
  assert.ok(Number.isSafeInteger(before.inputAck), 'pre-reconnect input must be acknowledged');
  const pageMarker = await page.evaluate(() => window.__reconnectPageMarker = crypto.randomUUID());
  const disconnectedAt = Date.now();
  await app.close();
  app = null;
  await page.waitForFunction(() => !window.vibeDiagnostics.connected && document.querySelector('#network').textContent === 'RECONNECTING');
  await pause(800);
  assert.equal((await diagnostics()).connected, false, 'client must remain disconnected while transport is unavailable');

  app = startServer({port, host: '127.0.0.1', saveFile});
  await new Promise(resolve => app.server.once('listening', resolve));
  await page.waitForFunction(() => window.vibeDiagnostics.connected, null, {timeout: 6000});
  const reconnectMs = Date.now() - disconnectedAt;
  const freshEpoch = await page.waitForFunction(priorInputAck => {
    const next = window.vibeDiagnostics;
    return Number.isSafeInteger(next.inputAck) && next.inputAck < priorInputAck && next.pendingInputs <= 1 ? next : false;
  }, before.inputAck, {timeout: 5000});
  const after = await freshEpoch.jsonValue();
  await freshEpoch.dispose();

  assert.equal(await page.evaluate(() => window.__reconnectPageMarker), pageMarker, 'page must not reload');
  assert.equal(after.id, before.id, 'authenticated character id must be reused');
  assert.deepEqual(after.player.inventory, before.player.inventory, 'inventory must survive reconnect');
  assert.equal(after.player.cutter, before.player.cutter);
  assert.equal(after.player.unlocked, before.player.unlocked);
  assert.equal(after.player.completed, before.player.completed);
  assert.deepEqual(after.state.structures, before.state.structures, 'structures must survive reconnect');
  assert.equal(after.state.players.length, 1, 'server snapshot must contain one player presence');
  assert.equal(new Set(after.state.players.map(player => player.id)).size, 1, 'player presence must not be duplicated');
  assert.equal(after.avatars, 1, 'browser must render one avatar');
  assert.ok(Number.isSafeInteger(after.inputAck) && after.inputAck < before.inputAck, 'reconnect must begin a fresh acknowledged sequence epoch');
  assert.ok(after.pendingInputs <= 1, `reconnect must reset the pending input epoch: ${JSON.stringify({inputAck: after.inputAck, pendingInputs: after.pendingInputs, priorInputAck: before.inputAck})}`);
  assert.ok(reconnectMs <= 6000, `reconnect exceeded technical test ceiling: ${reconnectMs} ms`);

  const xBeforeMovement = after.player.x;
  await walkByKey('KeyD', x => window.vibeDiagnostics.player.x > x + 1, xBeforeMovement);
  const moved = await diagnostics();
  assert.ok(moved.player.x > xBeforeMovement + 1, 'post-reconnect movement must be accepted by the server');
  assert.ok(Number.isSafeInteger(moved.inputAck) && moved.inputAck < before.inputAck, 'reconnect must begin a fresh acknowledged sequence epoch');
  assert.ok(moved.pendingInputs <= 32, 'post-reconnect pending inputs must remain bounded');
  assert.equal(errors.length, 0, errors.join('\n'));
  console.log(JSON.stringify({browserEngine, reconnectMs, retryCeilingMs: 6000, playerId: after.id, players: after.state.players.length, avatars: after.avatars, structures: after.state.structures.length, priorInputAck: before.inputAck, freshInputAck: after.inputAck, freshPendingInputs: after.pendingInputs, movedInputAck: moved.inputAck, movedPendingInputs: moved.pendingInputs, movementAccepted: moved.player.x > xBeforeMovement + 1, pageErrors: errors.length}));
} finally {
  await browser.close();
  if (app) await app.close();
  fs.rmSync(tmp, {recursive: true});
}
