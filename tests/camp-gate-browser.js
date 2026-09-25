import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {browserAccount, startTestServer} from './auth-helper.js';
import {launchBrowser} from './browser-engine.js';
import {blocked} from '../shared/world.js';

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'vibe-camp-gate-browser-'));
const app = startTestServer({port: 0, host: '127.0.0.1', saveFile: path.join(directory, 'world.json')});
let browser;
const errors = [], external = [];
const track = page => {
  page.setDefaultTimeout(10000);
  page.setDefaultNavigationTimeout(10000);
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => {const url = new URL(request.url());if (!['127.0.0.1', 'localhost'].includes(url.hostname)) external.push(request.url());});
};
async function join(page, base, create = false) {
  await page.goto(base, {waitUntil: 'domcontentloaded'});
  if (create) {await page.waitForFunction(() => document.querySelector('#username')?.getClientRects().length || document.querySelector('#character')?.options.length);await browserAccount(page, 'Gate Operator');}
  else {await page.waitForFunction(() => document.querySelector('#character')?.options.length > 0);await page.locator('#findGame').click();}
  await page.locator('#enter').click();
  await page.waitForFunction(() => window.vibeDiagnostics?.connected);
}

try {
  await new Promise((resolve, reject) => {const timer = setTimeout(() => reject(new Error('listen timeout')), 5000);app.server.once('listening', () => {clearTimeout(timer);resolve();});});
  browser = await launchBrowser('chromium');
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const desktop = await browser.newContext({viewport: {width: 1440, height: 900}, reducedMotion: 'reduce'});
  const page = await desktop.newPage();
  track(page);
  await join(page, base, true);
  const id = (await page.evaluate(() => window.vibeDiagnostics.id));
  const player = app.game.world.players[id];
  for (const item of Object.keys(player.inventory)) player.inventory[item] = 0;
  Object.assign(player.inventory, {ferrite: 3, fiber: 1});
  Object.assign(player, {x: 9, z: 4.5});
  app.game.world.resources = [];
  app.game.world.creatures = [];
  app.save();
  await page.waitForFunction(() => window.vibeDiagnostics.player.x === 9 && window.vibeDiagnostics.player.inventory.ferrite === 3);

  await page.locator('#menuButton').click();
  const recipe = page.locator('.recipe').filter({has: page.locator('b', {hasText: 'Camp gate'})});
  assert.equal(await recipe.locator('small').innerText(), '3 Ferrite + 1 Ribbon fiber');
  assert.equal(await recipe.locator('p').innerText(), 'Freestanding perimeter opening. Operate toggles it. R rotates its edge.');
  await page.locator('#closeGuide').click();
  const cdp = await desktop.newCDPSession(page);
  await cdp.send('Emulation.setPageScaleFactor', {pageScaleFactor: 2});
  assert.ok(await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches));
  assert.ok(await page.evaluate(() => visualViewport.scale >= 1.99));
  await cdp.send('Emulation.setPageScaleFactor', {pageScaleFactor: 1});

  await page.locator('#buildAction').click();
  await page.locator('[data-piece="campGate"]').click();
  await page.waitForFunction(() => window.vibeDiagnostics.preview?.type === 'campGate');
  for (let attempt = 0; attempt < 4; attempt++) {
    const preview = (await page.evaluate(() => window.vibeDiagnostics.preview));
    if (preview.x === 9 && preview.z === 0) break;
    player.x += 9 - preview.x;
    player.z += 0 - preview.z;
    await page.waitForTimeout(250);
  }
  await page.waitForFunction(() => window.vibeDiagnostics.preview?.x === 9 && window.vibeDiagnostics.preview?.z === 0);
  assert.deepEqual(await page.evaluate(() => window.vibeCampGateDiagnostics().previewGate), {rotation: 0, parts: 3, leafSpan: 2.45});
  await page.locator('#gatherAction').click();
  await page.waitForFunction(() => window.vibeDiagnostics.state.structures.some(s => s.type === 'campGate'));
  const gate = app.game.world.structures.find(s => s.type === 'campGate');
  assert.ok(gate && gate.owner === id && gate.open === false);
  assert.deepEqual({ferrite: player.inventory.ferrite, fiber: player.inventory.fiber}, {ferrite: 0, fiber: 0});
  assert.equal(blocked(app.game.world, gate.x, gate.z - 1.5), true);
  await page.locator('#buildAction').click();
  Object.assign(player, {x: 9, z: 2});
  await page.waitForFunction(() => document.querySelector('#interaction').textContent.includes('Open Camp gate'));
  await page.keyboard.press('KeyE');
  await page.waitForFunction(() => window.vibeDiagnostics.state.structures.find(s => s.type === 'campGate').open === true);
  assert.equal(blocked(app.game.world, gate.x, gate.z - 1.5), false);
  assert.equal((await page.evaluate(() => window.vibeCampGateDiagnostics().renderedGates[0])).open, true);
  await page.reload({waitUntil: 'domcontentloaded'});
  await page.waitForFunction(() => document.querySelector('#character')?.options.length > 0);
  await page.locator('#findGame').click();
  await page.locator('#enter').click();
  await page.waitForFunction(() => window.vibeDiagnostics?.connected && window.vibeDiagnostics.state.structures.some(s => s.type === 'campGate' && s.open));
  assert.equal((await page.evaluate(() => window.vibeDiagnostics.state.structures.find(s => s.type === 'campGate').owner)), id);
  const cookies = await desktop.cookies();
  await desktop.close();

  const touch = await browser.newContext({viewport: {width: 390, height: 844}, screen: {width: 390, height: 844}, isMobile: true, hasTouch: true, deviceScaleFactor: 2, reducedMotion: 'reduce'});
  await touch.addCookies(cookies);
  const phone = await touch.newPage();
  track(phone);
  await join(phone, base);
  Object.assign(player, {x: 9, z: 2});
  await phone.waitForFunction(() => document.querySelector('#interaction').textContent.includes('Close Camp gate'));
  await phone.locator('#gatherAction').tap();
  await phone.waitForFunction(() => window.vibeDiagnostics.state.structures.find(s => s.type === 'campGate').open === false);
  assert.equal(blocked(app.game.world, gate.x, gate.z - 1.5), true);
  await touch.close();

  assert.deepEqual(errors, []);
  assert.deepEqual(external, []);
  assert.equal(fs.existsSync(path.join(directory, 'world.json')), true);
  console.log('chromium: desktop placement/open/reconnect and 390x844 emulated-touch close passed with reduced motion, 200% zoom, zero page errors, and zero external requests');
} finally {
  if (browser) await browser.close();
  await app.close();
  fs.rmSync(directory, {recursive: true, force: true});
}
