import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {apiAccount, startTestServer} from './auth-helper.js';
import {launchBrowser} from './browser-engine.js';
import {blocked} from '../shared/world.js';

const engine = process.argv[2] || 'chromium';
const mode = process.argv[3] || 'desktop';
if (!['desktop', 'touch'].includes(mode)) throw new Error(`Unsupported Windowed bulkhead journey ${mode}`);
const directory = fs.mkdtempSync(path.join(os.tmpdir(), `vibe-windowed-${engine}-${mode}-`));
const app = startTestServer({port: 0, host: '127.0.0.1', saveFile: path.join(directory, 'world.json')});
let browser;
const errors = [], external = [];
try {
  await new Promise((resolve, reject) => {const timer = setTimeout(() => reject(new Error('listen timeout')), 5000);app.server.once('listening', () => {clearTimeout(timer);resolve();});});
  browser = await launchBrowser(engine);
  const context = await browser.newContext({
    viewport: mode === 'touch' ? {width: 390, height: 844} : {width: 1440, height: 900},
    ...(mode === 'touch' ? {screen: {width: 390, height: 844}, isMobile: true, hasTouch: true, deviceScaleFactor: 2} : {}),
    reducedMotion: 'reduce',
  });
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const account = await apiAccount(base, mode === 'touch' ? 82 : engine === 'firefox' ? 83 : 81);
  const split = account.cookie.indexOf('=');
  await context.addCookies([{name: account.cookie.slice(0, split), value: account.cookie.slice(split + 1), url: base}]);
  const page = await context.newPage();
  page.setDefaultTimeout(10000);
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => {const url = new URL(request.url());if (!['127.0.0.1', 'localhost'].includes(url.hostname)) external.push(request.url());});
  await page.goto(base, {waitUntil: 'domcontentloaded'});
  await page.locator('#findGame').waitFor({state: 'visible'});
  await page.locator('#findGame').click();
  await page.waitForFunction(() => document.querySelector('#character')?.options.length > 0);
  await page.locator('#enter').click();
  await page.waitForFunction(() => window.vibeDiagnostics?.connected);
  const id = await page.evaluate(() => window.vibeDiagnostics.id);
  const player = app.game.world.players[id];
  for (const item of Object.keys(player.inventory)) player.inventory[item] = 0;
  Object.assign(player.inventory, {ferrite: 2, crystal: 1});
  Object.assign(player, {x: 9, z: 4.5});
  app.game.world.resources = [];
  app.game.world.creatures = [];
  app.game.world.structures.push({id: 'deck-support', type: 'floor', x: 9, z: 0, rotation: 0, owner: id});
  app.save();
  await page.waitForFunction(() => window.vibeDiagnostics.player.x === 9 && window.vibeDiagnostics.state.structures.some(s => s.id === 'deck-support'));
  assert.equal(await page.getByLabel('Build windowed bulkhead', {exact: true}).count(), 1);
  await page.locator('#menuButton').click();
  const recipe = page.locator('.recipe').filter({has: page.locator('b', {hasText: 'Windowed bulkhead'})});
  assert.equal(await recipe.locator('small').innerText(), '2/2 Ferrite');
  assert.match(await recipe.locator('p').innerText(), /transparent visual-only pane/);
  const select = recipe.getByLabel('Select windowed bulkhead', {exact: true});
  await select.focus();
  assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('aria-label')), 'Select windowed bulkhead');
  if (mode === 'touch') await select.tap(); else await select.click();
  await page.waitForFunction(() => window.vibeDiagnostics.preview?.type === 'windowedBulkhead');
  for (let attempt = 0; attempt < 4; attempt++) {
    const preview = await page.evaluate(() => window.vibeDiagnostics.preview);
    if (preview.x === 9 && preview.z === 0) break;
    player.x += 9 - preview.x; player.z += -preview.z;
    await page.waitForTimeout(250);
  }
  await page.waitForFunction(() => window.vibeDiagnostics.preview?.x === 9 && window.vibeDiagnostics.preview?.z === 0);
  assert.match(await page.locator('#buildHint').innerText(), /^Windowed bulkhead · VALID — click to place · Rotate \/ Place buttons$/);
  const beforeRotation = await page.evaluate(() => window.vibeDiagnostics.preview.rotation);
  if (mode === 'touch') {await page.locator('#menuButton').tap();await page.locator('#guideTab-manual').tap();await page.locator('#rotateAction').tap();}
  else await page.keyboard.press('KeyR');
  await page.waitForFunction(before => window.vibeDiagnostics.preview.rotation === (before + 1) % 4, beforeRotation);
  if (mode === 'touch') await page.locator('#gatherAction').tap(); else await page.keyboard.press('KeyE');
  await page.waitForFunction(() => window.vibeDiagnostics.state.structures.some(s => s.type === 'windowedBulkhead'));
  const built = app.game.world.structures.find(s => s.type === 'windowedBulkhead');
  assert.ok(built && built.owner === id && !Object.hasOwn(built, 'open'));
  assert.equal(blocked(app.game.world, built.x + (built.rotation % 2 ? 1.5 : 0), built.z + (built.rotation % 2 ? 0 : -1.5)), true);
  assert.equal(player.inventory.ferrite, 0);
  Object.assign(player.inventory, {ferrite: 1, crystal: 1});
  app.game.tick(.25);
  assert.equal(app.game.action(id, {type: 'build', piece: 'lamp', x: 9, z: 0, rotation: built.rotation}).ok, true);
  const lamp = app.game.world.structures.find(s => s.type === 'lamp');
  assert.ok(lamp);
  app.game.tick(.25);
  assert.equal(app.game.action(id, {type: 'dismantle', id: built.id}).ok, false);
  assert.equal(app.game.action(id, {type: 'dismantle', id: lamp.id}).ok, true);
  const ferriteBeforeReclaim = player.inventory.ferrite;
  await page.reload({waitUntil: 'domcontentloaded'});
  await page.locator('#findGame').click();
  await page.locator('#enter').click();
  await page.waitForFunction(() => window.vibeDiagnostics?.connected && window.vibeDiagnostics.state.structures.some(s => s.type === 'windowedBulkhead'));
  await page.evaluate(() => {document.body.style.zoom = '200%';});
  assert.equal(await page.evaluate(() => getComputedStyle(document.body).zoom), '2');
  assert.equal(await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches), true);
  Object.assign(player, {x: 9, z: 2});
  if (mode === 'touch') {await page.locator('#menuButton').tap();await page.locator('#guideTab-fabrication').tap();await page.locator('#driver-reclaim').tap();}
  else await page.keyboard.press('KeyV');
  await page.waitForFunction(() => document.querySelector('#gatherAction').textContent === 'Reclaim Windowed bulkhead');
  if (mode === 'touch') await page.locator('#gatherAction').tap(); else await page.keyboard.press('KeyE');
  await page.waitForFunction(() => !window.vibeDiagnostics.state.structures.some(s => s.type === 'windowedBulkhead'));
  assert.equal(player.inventory.ferrite, ferriteBeforeReclaim + 2);
  assert.deepEqual(errors, []);
  assert.deepEqual(external, []);
  console.log(`${engine} ${mode}: Windowed bulkhead select/rotate/place/collision/reconnect/lumen/reclaim/refund/zoom/reduced-motion/focus passed; zero page errors and external requests`);
  await context.close();
} finally {
  if (browser) await browser.close();
  await app.close();
  fs.rmSync(directory, {recursive: true, force: true});
}
