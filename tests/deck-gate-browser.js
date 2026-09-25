import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {apiAccount, startTestServer} from './auth-helper.js';
import {launchBrowser} from './browser-engine.js';
import {blocked} from '../shared/world.js';

const engine = process.argv[2] || 'chromium';
const mode = process.argv[3] || 'desktop';
if (!['desktop', 'touch'].includes(mode)) throw new Error(`Unsupported Deck gate journey ${mode}`);
const directory = fs.mkdtempSync(path.join(os.tmpdir(), `vibe-deck-gate-${engine}-${mode}-`));
const app = startTestServer({port: 0, host: '127.0.0.1', saveFile: path.join(directory, 'world.json')});
let browser;
const errors = [], external = [];
const track = page => {
  page.setDefaultTimeout(10000);
  page.setDefaultNavigationTimeout(10000);
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => {const url = new URL(request.url());if (!['127.0.0.1', 'localhost'].includes(url.hostname)) external.push(request.url());});
};
async function join(page, base) {
  await page.goto(base, {waitUntil: 'domcontentloaded'});
  await page.locator('#findGame').click();
  await page.locator('#enter').click();
  await page.waitForFunction(() => window.vibeDiagnostics?.connected);
}
async function prepareAndPlace(page) {
  const id = await page.evaluate(() => window.vibeDiagnostics.id);
  const player = app.game.world.players[id];
  for (const item of Object.keys(player.inventory)) player.inventory[item] = 0;
  Object.assign(player.inventory, {ferrite: 2, fiber: 1});
  Object.assign(player, {x: 9, z: 4.5});
  app.game.world.resources = [];
  app.game.world.creatures = [];
  app.game.world.structures.push({id: 'deck-support', type: 'floor', x: 9, z: 0, rotation: 0, owner: id});
  app.save();
  await page.waitForFunction(() => window.vibeDiagnostics.player.x === 9 && window.vibeDiagnostics.state.structures.some(s => s.id === 'deck-support'));
  await page.locator('#menuButton').click();
  const recipe = page.locator('.recipe').filter({has: page.locator('b', {hasText: 'Deck gate'})});
  assert.equal(await recipe.locator('small').innerText(), '2/2 Ferrite · 1/1 Ribbon fiber');
  assert.match(await recipe.locator('p').innerText(), /supported Deck edge/);
  const select = recipe.getByLabel('Select deck gate', {exact: true});
  if (mode === 'touch') await select.tap();
  else await select.click();
  await page.waitForFunction(() => window.vibeDiagnostics.preview?.type === 'deckGate');
  for (let attempt = 0; attempt < 4; attempt++) {
    const preview = await page.evaluate(() => window.vibeDiagnostics.preview);
    if (preview.x === 9 && preview.z === 0) break;
    player.x += 9 - preview.x;
    player.z += 0 - preview.z;
    await page.waitForTimeout(250);
  }
  await page.waitForFunction(() => window.vibeDiagnostics.preview?.x === 9 && window.vibeDiagnostics.preview?.z === 0);
  const before = await page.evaluate(() => window.vibeDiagnostics.preview.rotation);
  if (mode === 'touch') {
    await page.locator('#menuButton').tap();
    await page.locator('#guideTab-manual').tap();
    await page.locator('#rotateAction').tap();
  } else await page.keyboard.press('KeyR');
  await page.waitForFunction(before => window.vibeDiagnostics.preview?.rotation === (before + 1) % 4, before);
  if (mode === 'touch') await page.locator('#gatherAction').tap();
  else await page.keyboard.press('KeyE');
  await page.waitForFunction(() => window.vibeDiagnostics.state.structures.some(s => s.type === 'deckGate'));
  const gate = app.game.world.structures.find(s => s.type === 'deckGate');
  assert.ok(gate && gate.owner === id && gate.open === false);
  assert.deepEqual({ferrite: player.inventory.ferrite, fiber: player.inventory.fiber}, {ferrite: 0, fiber: 0});
  assert.equal(blocked(app.game.world, gate.x + 1.5, gate.z), true);
  return {id, player, gate};
}

try {
  await new Promise((resolve, reject) => {const timer = setTimeout(() => reject(new Error('listen timeout')), 5000);app.server.once('listening', () => {clearTimeout(timer);resolve();});});
  browser = await launchBrowser(engine);
  const context = await browser.newContext(mode === 'touch'
    ? {viewport: {width: 390, height: 844}, screen: {width: 390, height: 844}, isMobile: true, hasTouch: true, deviceScaleFactor: 2}
    : {viewport: {width: 1440, height: 900}});
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const account = await apiAccount(base, mode === 'touch' ? 72 : engine === 'firefox' ? 73 : 71);
  const separator = account.cookie.indexOf('=');
  await context.addCookies([{name: account.cookie.slice(0, separator), value: account.cookie.slice(separator + 1), url: base}]);
  const page = await context.newPage();
  track(page);
  await join(page, base);
  const {id, player, gate} = await prepareAndPlace(page);
  if (mode === 'touch') {
    await page.locator('#menuButton').tap();
    await page.locator('#guideTab-fabrication').tap();
    await page.locator('#driver-stow').tap();
  } else await page.keyboard.press('Escape');
  Object.assign(player, {x: 9, z: 2});
  await page.waitForFunction(() => document.querySelector('#interaction').textContent.includes('Deck gate closed · Open Deck gate'));
  if (mode === 'touch') {
    gate.open = true;
    app.save();
    await page.waitForFunction(() => window.vibeDiagnostics.state.structures.find(s => s.type === 'deckGate')?.open === true);
    await page.waitForFunction(() => document.querySelector('#interaction').textContent.includes('Deck gate open · Close Deck gate'));
    await page.locator('#gatherAction').tap();
    await page.waitForFunction(() => window.vibeDiagnostics.state.structures.find(s => s.type === 'deckGate')?.open === false);
    assert.equal(blocked(app.game.world, gate.x + 1.5, gate.z), true);
    await page.locator('#menuButton').tap();
    await page.locator('#guideTab-fabrication').tap();
    await page.locator('#driver-reclaim').tap();
    await page.waitForFunction(() => document.querySelector('#gatherAction').textContent.includes('Reclaim Deck gate'));
    await page.locator('#gatherAction').tap();
    await page.waitForFunction(() => !window.vibeDiagnostics.state.structures.some(s => s.type === 'deckGate'));
    assert.deepEqual({ferrite: player.inventory.ferrite, fiber: player.inventory.fiber}, {ferrite: 2, fiber: 1});
  } else {
    await page.keyboard.press('KeyE');
    await page.waitForFunction(() => window.vibeDiagnostics.state.structures.find(s => s.type === 'deckGate')?.open === true);
    assert.equal(blocked(app.game.world, gate.x + 1.5, gate.z), false);
    await page.reload({waitUntil: 'domcontentloaded'});
    await page.waitForFunction(() => document.querySelector('#character')?.options.length > 0);
    await page.locator('#findGame').click();
    await page.locator('#enter').click();
    await page.waitForFunction(() => window.vibeDiagnostics?.connected && window.vibeDiagnostics.state.structures.some(s => s.type === 'deckGate' && s.open));
    assert.equal(await page.evaluate(() => window.vibeDiagnostics.state.structures.find(s => s.type === 'deckGate').owner), id);
  }
  assert.deepEqual(errors, []);
  assert.deepEqual(external, []);
  console.log(`${engine} ${mode}: Deck gate journey passed with zero page errors and zero external requests`);
  await context.close();
} finally {
  if (browser) await browser.close();
  await app.close();
  fs.rmSync(directory, {recursive: true, force: true});
}
