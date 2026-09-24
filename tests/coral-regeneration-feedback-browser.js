import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {chromium} from 'playwright';
import {apiAccount, startTestServer} from './auth-helper.js';
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

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'vibe-coral-feedback-'));
let app;
let browser;
let desktopContext;
let touchContext;
let desktopPage;
let touchPage;
let primaryError;
try {
  app = startTestServer({port: 0, host: '127.0.0.1', saveFile: path.join(directory, 'world.json')});
  await bounded('local server listen', 5000, () => new Promise(resolve => app.server.once('listening', resolve)));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  browser = await bounded('installed Google Chrome launch', 10000, () => chromium.launch({
    headless: true,
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  }));
  const pageErrors = [];
  const externalRequests = [];
  const watch = page => {
    page.on('pageerror', error => pageErrors.push(error.message));
    page.on('request', request => {
      const url = new URL(request.url());
      if (url.hostname !== '127.0.0.1') externalRequests.push(request.url());
    });
  };
  const authenticate = async (context, number) => {
    const account = await apiAccount(base, number);
    const separator = account.cookie.indexOf('=');
    await context.addCookies([{
      name: account.cookie.slice(0, separator),
      value: account.cookie.slice(separator + 1),
      domain: '127.0.0.1',
      path: '/',
      httpOnly: true,
      sameSite: 'Lax',
    }]);
  };

  desktopContext = await browser.newContext({viewport: {width: 1440, height: 900}});
  await bounded('desktop API account bootstrap', 10000, () => authenticate(desktopContext, 51));
  desktopPage = await desktopContext.newPage();
  watch(desktopPage);
  await bounded('desktop navigation', 10000, () => desktopPage.goto(base, {waitUntil: 'domcontentloaded', timeout: 9000}));
  await desktopPage.waitForFunction(() => document.querySelector('#character')?.options.length > 0 && !document.querySelector('#enter')?.disabled, null, {timeout: 5000});
  await desktopPage.evaluate(() => document.querySelector('#findGame').click());
  await desktopPage.evaluate(() => document.querySelector('#enter').click());
  await desktopPage.waitForFunction(() => window.vibeDiagnostics?.connected, null, {timeout: 9500});
  const desktopId = await desktopPage.evaluate(() => window.vibeDiagnostics.id);
  const node = tileContent(app.game.world.seed, tileAt(0, -1500)).nodes.find(resource => resource.id.startsWith('p:coral:'));
  assert.ok(node, 'fixture tile must contain the deterministic Coral Shelf deposit');
  Object.assign(app.game.world.players[desktopId], {x: node.x, z: node.z});
  await desktopPage.waitForFunction(nodeId => window.vibeDiagnostics?.state.resources.some(resource => resource.id === nodeId && resource.amount === 6), node.id, {timeout: 7500});
  const initialIndex = await desktopPage.evaluate(nodeId => window.vibeDiagnostics.state.resources.findIndex(resource => resource.id === nodeId), node.id);
  const initialCrystal = await desktopPage.evaluate(() => window.vibeDiagnostics.player.inventory.crystal);

  for (let amount = 5; amount >= 0; amount--) {
    await desktopPage.keyboard.press('KeyE');
    await desktopPage.waitForFunction(({nodeId, amount, crystal}) => {
      const diagnostics = window.vibeDiagnostics;
      return diagnostics?.player.inventory.crystal === crystal
        && diagnostics.state.resources.find(resource => resource.id === nodeId)?.amount === amount;
    }, {nodeId: node.id, amount, crystal: initialCrystal + 6 - amount}, {timeout: 7500});
    if (amount > 0) await desktopPage.waitForTimeout(750);
  }

  await desktopPage.waitForFunction(nodeId => /^Flux crystal depleted, regenerates in \d+ seconds of server time\.$/.test(document.querySelector('#interaction')?.textContent || '')
    && window.vibeDiagnostics?.state.resources.find(resource => resource.id === nodeId)?.amount === 0, node.id, {timeout: 7500});
  const scheduledDue = app.game.world.coralFluxRegeneration[node.id];
  assert.equal(Number.isFinite(scheduledDue), true);
  const desktopBefore = structuredClone({
    crystal: app.game.world.players[desktopId].inventory.crystal,
    depleted: app.game.world.depleted[node.id],
    due: scheduledDue,
  });
  await desktopPage.keyboard.press('KeyE');
  await desktopPage.waitForTimeout(300);
  assert.deepEqual({
    crystal: app.game.world.players[desktopId].inventory.crystal,
    depleted: app.game.world.depleted[node.id],
    due: app.game.world.coralFluxRegeneration[node.id],
  }, desktopBefore);

  await bounded('desktop context close', 1000, () => desktopContext.close());
  desktopContext = null;
  desktopPage = null;

  touchContext = await browser.newContext({viewport: {width: 390, height: 844}, hasTouch: true, isMobile: true});
  await bounded('touch API account bootstrap', 10000, () => authenticate(touchContext, 52));
  touchPage = await touchContext.newPage();
  watch(touchPage);
  await bounded('touch navigation', 10000, () => touchPage.goto(base, {waitUntil: 'domcontentloaded', timeout: 9000}));
  await touchPage.waitForFunction(() => document.querySelector('#character')?.options.length > 0 && !document.querySelector('#enter')?.disabled, null, {timeout: 5000});
  await touchPage.evaluate(() => document.querySelector('#findGame').click());
  await touchPage.evaluate(() => document.querySelector('#enter').click());
  await touchPage.waitForFunction(() => window.vibeDiagnostics?.connected, null, {timeout: 9500});
  const touchId = await touchPage.evaluate(() => window.vibeDiagnostics.id);
  Object.assign(app.game.world.players[touchId], {x: node.x, z: node.z});
  await touchPage.waitForFunction(nodeId => /^Flux crystal depleted, regenerates in \d+ seconds of server time\.$/.test(document.querySelector('#interaction')?.textContent || '')
    && window.vibeDiagnostics?.state.resources.find(resource => resource.id === nodeId)?.amount === 0, node.id, {timeout: 7500});
  assert.equal(await touchPage.locator('#gatherAction').isVisible(), true);
  const touchBefore = structuredClone({
    crystal: app.game.world.players[touchId].inventory.crystal,
    depleted: app.game.world.depleted[node.id],
    due: app.game.world.coralFluxRegeneration[node.id],
  });
  await touchPage.locator('#gatherAction').tap({timeout: 5000});
  await touchPage.waitForTimeout(300);
  assert.deepEqual({
    crystal: app.game.world.players[touchId].inventory.crystal,
    depleted: app.game.world.depleted[node.id],
    due: app.game.world.coralFluxRegeneration[node.id],
  }, touchBefore);

  app.game.world.time = scheduledDue;
  app.game.tick(0);
  assert.equal(app.game.world.depleted[node.id], undefined);
  assert.equal(app.game.world.coralFluxRegeneration[node.id], undefined);
  await touchPage.waitForFunction(nodeId => document.querySelector('#interaction')?.textContent === '[E] Gather Flux crystal · 6 remaining'
    && window.vibeDiagnostics?.state.resources.filter(resource => resource.id === nodeId).length === 1
    && window.vibeDiagnostics.state.resources.find(resource => resource.id === nodeId).amount === 6, node.id, {timeout: 7500});
  const regeneratedIndex = await touchPage.evaluate(nodeId => window.vibeDiagnostics.state.resources.findIndex(resource => resource.id === nodeId), node.id);
  assert.equal(regeneratedIndex, initialIndex);
  const beforeRegather = app.game.world.players[touchId].inventory.crystal;
  await touchPage.locator('#gatherAction').tap({timeout: 5000});
  await touchPage.waitForFunction(({nodeId, before}) => window.vibeDiagnostics?.player.inventory.crystal === before + 1
    && window.vibeDiagnostics.state.resources.find(resource => resource.id === nodeId)?.amount === 5, {nodeId: node.id, before: beforeRegather}, {timeout: 7500});
  assert.equal(app.game.world.depleted[node.id], 5);
  assert.equal(app.game.world.coralFluxRegeneration[node.id], undefined);
  assert.deepEqual(pageErrors, []);
  assert.deepEqual(externalRequests, []);
  console.log('PASS: desktop and touch observed authoritative Coral depletion countdown, depleted inputs caused no mutation, exact due restored one stable amount-6 node, and touch gathered once with zero page errors or external requests.');
} catch (error) {
  primaryError = error;
}
const cleanupErrors = [];
for (const cleanup of [
  () => desktopPage?.close(),
  () => touchPage?.close(),
  () => desktopContext?.close(),
  () => touchContext?.close(),
  () => browser?.close(),
  () => app?.close(),
  () => fs.rmSync(directory, {recursive: true, force: true}),
]) {
  try { await bounded('Coral feedback browser cleanup', 700, cleanup); } catch (error) { cleanupErrors.push(error); }
}
if (primaryError) {
  if (cleanupErrors.length) primaryError.cleanupErrors = cleanupErrors;
  throw primaryError;
}
if (cleanupErrors.length === 1) throw cleanupErrors[0];
if (cleanupErrors.length) throw new AggregateError(cleanupErrors, 'Coral feedback browser cleanup failed');
