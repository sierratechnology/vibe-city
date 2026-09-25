// Virtual standard gamepad coverage; physical controller verification remains separate.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {apiAccount, startTestServer} from './auth-helper.js';
import {launchBrowser} from './browser-engine.js';

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'vibe-windowed-bulkhead-controller-'));
const app = startTestServer({port: 0, host: '127.0.0.1', saveFile: path.join(directory, 'world.json')});
let browser;
const errors = [], external = [];
try {
  await new Promise((resolve, reject) => {const timer = setTimeout(() => reject(new Error('listen timeout')), 5000);app.server.once('listening', () => {clearTimeout(timer);resolve();});});
  browser = await launchBrowser('chromium');
  const context = await browser.newContext({viewport: {width: 1440, height: 900}});
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const account = await apiAccount(base, 84);
  const separator = account.cookie.indexOf('=');
  await context.addCookies([{name: account.cookie.slice(0, separator), value: account.cookie.slice(separator + 1), url: base}]);
  const page = await context.newPage();
  page.setDefaultTimeout(10000);
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => {const url = new URL(request.url());if (!['127.0.0.1', 'localhost'].includes(url.hostname)) external.push(request.url());});
  await page.addInitScript(() => {
    window.testPad = {id: 'Windowed bulkhead virtual standard controller', index: 0, connected: true, mapping: 'standard', axes: [0, 0, 0, 0], buttons: Array.from({length: 16}, () => ({pressed: false})), samples: 0};
    Object.defineProperty(navigator, 'getGamepads', {value: () => {window.testPad.samples++;return [window.testPad];}});
  });
  const press = async index => {
    for (const pressed of [true, false]) {
      const sample = await page.evaluate(({index, pressed}) => {const sample = window.testPad.samples;window.testPad.buttons[index].pressed = pressed;return sample;}, {index, pressed});
      await page.waitForFunction(sample => window.testPad.samples > sample, sample);
    }
  };
  await page.goto(base, {waitUntil: 'domcontentloaded'});
  await page.locator('#findGame').waitFor({state: 'visible'});
  await page.locator('#findGame').click();
  await page.waitForFunction(() => document.querySelector('#character')?.options.length > 0);
  await page.locator('#enter').click();
  await page.waitForFunction(() => window.vibeDiagnostics?.connected);
  await page.bringToFront();
  const id = await page.evaluate(() => window.vibeDiagnostics.id);
  const player = app.game.world.players[id];
  for (const item of Object.keys(player.inventory)) player.inventory[item] = 0;
  player.inventory.ferrite = 2;
  Object.assign(player, {x: 9, z: 4.5});
  app.game.world.resources = [];
  app.game.world.creatures = [];
  app.game.world.structures.push({id: 'deck-support', type: 'floor', x: 9, z: 0, rotation: 0, owner: id});
  app.save();
  await page.waitForFunction(() => window.vibeDiagnostics.player.x === 9 && window.vibeDiagnostics.state.structures.some(s => s.id === 'deck-support'));
  assert.equal(await page.getByLabel('Build windowed bulkhead', {exact: true}).count(), 1);

  await press(3);
  assert.equal(await page.evaluate(() => window.vibeDiagnostics.buildMode), true);
  await press(5);
  await press(5);
  await page.waitForFunction(() => window.vibeDiagnostics.preview?.type === 'windowedBulkhead');
  await press(4);
  await page.waitForFunction(() => window.vibeDiagnostics.preview?.type === 'wall');
  await press(5);
  await page.waitForFunction(() => window.vibeDiagnostics.preview?.type === 'windowedBulkhead');
  for (let attempt = 0; attempt < 4; attempt++) {
    const preview = await page.evaluate(() => window.vibeDiagnostics.preview);
    if (preview.x === 9 && preview.z === 0) break;
    player.x += 9 - preview.x;
    player.z -= preview.z;
    await page.waitForTimeout(250);
  }
  await page.waitForFunction(() => window.vibeDiagnostics.preview?.x === 9 && window.vibeDiagnostics.preview?.z === 0);
  const rotation = await page.evaluate(() => window.vibeDiagnostics.preview.rotation);
  await press(6);
  await page.waitForFunction(rotation => window.vibeDiagnostics.preview?.rotation === (rotation + 1) % 4, rotation);
  await press(7);
  await page.waitForFunction(() => window.vibeDiagnostics.state.structures.some(s => s.type === 'windowedBulkhead'));
  const built = app.game.world.structures.find(s => s.type === 'windowedBulkhead');
  assert.ok(built && built.owner === id && !Object.hasOwn(built, 'open'));
  assert.equal(player.inventory.ferrite, 0);

  await press(3);
  Object.assign(player, {x: 9, z: 2});
  await press(9);
  await page.waitForFunction(() => document.activeElement?.id === 'guideTab-fabrication');
  for (let index = 0; index < 6; index++) await press(13);
  assert.equal(await page.evaluate(() => document.activeElement?.id), 'driver-reclaim');
  await press(0);
  await page.waitForFunction(() => document.querySelector('#gatherAction').textContent === 'Reclaim Windowed bulkhead');
  await press(7);
  await page.waitForFunction(() => !window.vibeDiagnostics.state.structures.some(s => s.type === 'windowedBulkhead'));
  assert.equal(player.inventory.ferrite, 2);
  assert.deepEqual(errors, []);
  assert.deepEqual(external, []);
  console.log('virtual standard controller: named Windowed bulkhead selection, previous/next, rotate, place, reclaim, and exact refund passed');
  await context.close();
} finally {
  if (browser) await browser.close();
  await app.close();
  fs.rmSync(directory, {recursive: true, force: true});
}
