import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {chromium} from 'playwright';
import {browserAccount, startTestServer} from './auth-helper.js';
import {tileAt, tileContent} from '../shared/planet.js';

async function bounded(label, milliseconds, operation) {
  let timer;
  try {
    return await Promise.race([
      Promise.resolve().then(operation),
      new Promise((_, reject) => { timer = setTimeout(() => reject(Error(`${label} exceeded ${milliseconds} ms`)), milliseconds); }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'vibe-coral-tool-'));
let app;
let browser;
const contexts = [];
let primaryError;
try {
  app = startTestServer({port: 0, host: '127.0.0.1', saveFile: path.join(directory, 'world.json')});
  await bounded('local server listen', 5000, () => new Promise(resolve => app.server.once('listening', resolve)));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const gatherRequests = [];
  const originalAction = app.game.action.bind(app.game);
  app.game.action = (id, message) => {
    if (message?.type === 'gather') gatherRequests.push({id, resource: message.id});
    return originalAction(id, message);
  };
  browser = await bounded('installed Google Chrome launch', 10000, () => chromium.launch({
    headless: true,
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  }));
  const pageErrors = [];
  const externalRequests = [];
  const node = tileContent(app.game.world.seed, tileAt(0, -1500)).nodes.find(resource => resource.id.startsWith('p:coral:'));
  assert.ok(node, 'fixture tile must contain the deterministic Coral Shelf deposit');

  const openExplorer = async ({name, touch = false}) => {
    const context = await browser.newContext(touch
      ? {viewport: {width: 390, height: 844}, hasTouch: true, isMobile: true}
      : {viewport: {width: 1440, height: 900}});
    contexts.push(context);
    const page = await context.newPage();
    page.on('pageerror', error => pageErrors.push(error.message));
    page.on('request', request => {
      const url = new URL(request.url());
      if (url.hostname !== '127.0.0.1') externalRequests.push(request.url());
    });
    await bounded(`${touch ? 'touch' : 'desktop'} navigation`, 10000, () => page.goto(base, {waitUntil: 'domcontentloaded', timeout: 9000}));
    try {
      await bounded(`${touch ? 'touch' : 'desktop'} verified account bootstrap`, 20000, () => browserAccount(page, name));
    } catch (error) {
      const accountState = await page.evaluate(() => ({
        gate: document.querySelector('#accountGate')?.className,
        accountError: document.querySelector('#accountError')?.textContent,
        accountFeedback: document.querySelector('#accountFeedback')?.textContent,
        verifyActions: document.querySelector('#verifyActions')?.className,
        joinError: document.querySelector('#joinError')?.textContent,
        verification: document.querySelector('#verifyStatus')?.textContent,
        characters: document.querySelector('#character')?.options.length,
      }));
      error.message += `; account UI ${JSON.stringify(accountState)}; page errors ${JSON.stringify(pageErrors)}`;
      throw error;
    }
    await page.locator('#enter').click({timeout: 5000});
    await page.waitForFunction(() => window.vibeDiagnostics?.connected, null, {timeout: 9500});
    return {page, id: await page.evaluate(() => window.vibeDiagnostics.id)};
  };

  const desktop = await openExplorer({name: 'Coral Tool Desktop'});
  const touch = await openExplorer({name: 'Coral Tool Touch', touch: true});
  for (const explorer of [desktop, touch]) Object.assign(app.game.world.players[explorer.id], {x: node.x, z: node.z});
  const required = 'A Field cutter is required to gather Coral Flux.';
  for (const explorer of [desktop, touch]) {
    await explorer.page.waitForFunction(({nodeId, required}) => document.querySelector('#interaction')?.textContent === required
      && window.vibeDiagnostics?.state.resources.find(resource => resource.id === nodeId)?.amount === 6
      && window.vibeDiagnostics.player.cutter === false, {nodeId: node.id, required}, {timeout: 7500});
  }
  assert.equal(await touch.page.locator('#gatherAction').isVisible(), true);

  const beforeBlocked = structuredClone({
    amount: app.game.snapshot(desktop.id).resources.find(resource => resource.id === node.id).amount,
    desktopInventory: app.game.world.players[desktop.id].inventory,
    touchInventory: app.game.world.players[touch.id].inventory,
    depleted: app.game.world.depleted,
    regeneration: app.game.world.coralFluxRegeneration,
    cooldowns: [...app.game.cooldowns],
  });
  await desktop.page.keyboard.press('KeyE');
  await desktop.page.locator('#gatherAction').click({timeout: 5000});
  await touch.page.locator('#gatherAction').tap({timeout: 5000});
  await touch.page.waitForTimeout(350);
  assert.equal(gatherRequests.length, 0, 'keyboard, mouse pointer, and emulated touch must send no gather without a cutter');
  assert.deepEqual({
    amount: app.game.snapshot(desktop.id).resources.find(resource => resource.id === node.id).amount,
    desktopInventory: app.game.world.players[desktop.id].inventory,
    touchInventory: app.game.world.players[touch.id].inventory,
    depleted: app.game.world.depleted,
    regeneration: app.game.world.coralFluxRegeneration,
    cooldowns: [...app.game.cooldowns],
  }, beforeBlocked);

  app.game.world.players[desktop.id].cutter = true;
  app.game.world.players[touch.id].cutter = true;
  for (const explorer of [desktop, touch]) {
    await explorer.page.waitForFunction(nodeId => document.querySelector('#interaction')?.textContent === '[E] Gather Coral Flux · 6 remaining'
      && window.vibeDiagnostics?.player.cutter === true
      && window.vibeDiagnostics.state.resources.find(resource => resource.id === nodeId)?.amount === 6, node.id, {timeout: 7500});
  }

  await desktop.page.keyboard.press('KeyE');
  await desktop.page.waitForFunction(nodeId => window.vibeDiagnostics?.player.inventory.crystal === 2
    && window.vibeDiagnostics.state.resources.find(resource => resource.id === nodeId)?.amount === 4, node.id, {timeout: 7500});
  await touch.page.waitForFunction(nodeId => window.vibeDiagnostics?.state.resources.find(resource => resource.id === nodeId)?.amount === 4, node.id, {timeout: 7500});
  await touch.page.locator('#gatherAction').tap({timeout: 5000});
  await touch.page.waitForFunction(nodeId => window.vibeDiagnostics?.player.inventory.crystal === 2
    && window.vibeDiagnostics.state.resources.find(resource => resource.id === nodeId)?.amount === 2, node.id, {timeout: 7500});
  assert.equal(gatherRequests.length, 2);
  assert.deepEqual(gatherRequests.map(request => request.id), [desktop.id, touch.id]);
  assert.equal(app.game.world.depleted[node.id], 2);
  assert.deepEqual(pageErrors, []);
  assert.deepEqual(externalRequests, []);
  console.log('PASS: readable Field cutter status blocked keyboard, mouse-pointer, and emulated-touch gather sends without mutation; equipping the canonical fixture restored keyboard and touch gathering with zero page errors or external requests.');
} catch (error) {
  primaryError = error;
}
const cleanupErrors = [];
for (const cleanup of [
  ...contexts.reverse().map(context => () => context.close()),
  () => browser?.close(),
  () => app?.close(),
  () => fs.rmSync(directory, {recursive: true, force: true}),
]) {
  try { await bounded('Coral tool browser cleanup', 1000, cleanup); } catch (error) { cleanupErrors.push(error); }
}
if (primaryError) {
  if (cleanupErrors.length) primaryError.cleanupErrors = cleanupErrors;
  throw primaryError;
}
if (cleanupErrors.length === 1) throw cleanupErrors[0];
if (cleanupErrors.length) throw new AggregateError(cleanupErrors, 'Coral tool browser cleanup failed');
