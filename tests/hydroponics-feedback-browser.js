import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {chromium} from 'playwright';
import {browserAccount, startTestServer} from './auth-helper.js';
import {rooms} from '../shared/rooms.js';

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

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'vibe-hydroponics-feedback-'));
let app;
let browser;
const contexts = [];
let primaryError;
try {
  app = startTestServer({port: 0, host: '127.0.0.1', saveFile: path.join(directory, 'world.json')});
  await bounded('local server listen', 5000, () => new Promise(resolve => app.server.once('listening', resolve)));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const pageErrors = [];
  const externalRequests = [];
  const gardenRequests = [];
  const originalAction = app.game.action.bind(app.game);
  app.game.action = (id, message) => {
    if (message?.type === 'garden') gardenRequests.push({id, structure: message.id});
    return originalAction(id, message);
  };
  browser = await bounded('installed Google Chrome launch', 10000, () => chromium.launch({
    headless: true,
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  }));

  async function openExplorer(name, touch = false) {
    const context = await browser.newContext({
      viewport: touch ? {width: 390, height: 844} : {width: 1400, height: 900},
      hasTouch: touch,
      isMobile: touch,
      reducedMotion: 'reduce',
    });
    contexts.push(context);
    const page = await context.newPage();
    page.on('pageerror', error => pageErrors.push(error.message));
    page.on('request', request => {
      const hostname = new URL(request.url()).hostname;
      if (!['127.0.0.1', 'localhost'].includes(hostname)) externalRequests.push(request.url());
    });
    await bounded(`${name} navigation`, 10000, () => page.goto(base, {waitUntil: 'domcontentloaded', timeout: 9000}));
    await bounded(`${name} verified account`, 30000, () => browserAccount(page, name));
    await page.locator('#enter').click();
    await page.waitForFunction(() => window.vibeDiagnostics?.connected, null, {timeout: 9500});
    return {page, id: await page.evaluate(() => window.vibeDiagnostics.id)};
  }

  const desktop = await openExplorer('Hydroponics Desktop');
  const touch = await openExplorer('Hydroponics Touch', true);
  const owner = app.game.world.players[desktop.id];
  const observer = app.game.world.players[touch.id];
  Object.assign(owner, {x: 11, z: 0});
  Object.assign(observer, {x: 11, z: 0});
  Object.assign(owner.inventory, {water: 2, fiber: 2});
  const structures = [
    {id: 'hydro-floor', type: 'floor', x: 9, z: 0, rotation: 0, owner: owner.id},
    {id: 'hydro-roof', type: 'roof', x: 9, z: 0, rotation: 0, owner: owner.id},
    ...[0, 1, 2, 3].map(rotation => ({id: `hydro-wall-${rotation}`, type: 'wall', x: 9, z: 0, rotation, owner: owner.id})),
    {id: 'hydro-support', type: 'lifeSupport', x: 9, z: 0, rotation: 0, power: 20, owner: owner.id},
    {id: 'hydro-bed', type: 'garden', x: 9, z: 0, rotation: 0, owner: owner.id},
  ];
  app.game.world.structures.push(...structures);
  const room = rooms(app.game.world).find(candidate => candidate.sealed && candidate.cells.length === 1);
  assert.ok(room, 'fixture must be one sealed room');
  app.game.world.roomAir[room.cells[0]] = 100;

  for (const explorer of [desktop, touch]) {
    await explorer.page.waitForFunction(() => window.vibeDiagnostics?.state.structures.some(structure => structure.id === 'hydro-bed'));
    await explorer.page.locator('#terminalAction').click();
    await explorer.page.locator('[data-tab="habitat"]').click();
    await explorer.page.evaluate(() => { document.body.style.zoom = '2'; });
  }
  await desktop.page.getByRole('button', {name: 'Plant water + fiber', exact: true}).click();
  await desktop.page.waitForFunction(() => window.vibeDiagnostics.state.structures.find(structure => structure.id === 'hydro-bed')?.readyAt > window.vibeDiagnostics.state.time);
  const bed = app.game.world.structures.find(structure => structure.id === 'hydro-bed');
  assert.equal(owner.inventory.water, 1);
  assert.equal(owner.inventory.fiber, 1);
  assert.equal(bed.readyAt - app.game.world.time <= 180, true);

  const growingText = /Hydroponic bed growing, \d+ seconds of server time remaining/;
  for (const explorer of [desktop, touch]) {
    await assert.doesNotReject(() => explorer.page.getByText(growingText).waitFor());
    assert.equal(await explorer.page.getByRole('button', {name: 'Harvest', exact: true}).count(), 0);
  }
  await desktop.page.keyboard.press('Enter');
  await desktop.page.mouse.click(5, 5);
  await touch.page.touchscreen.tap(5, 5);
  await touch.page.waitForTimeout(250);
  assert.equal(gardenRequests.length, 1, 'growing keyboard, pointer, and emulated touch must dispatch no harvest');

  app.game.world.time = bed.readyAt - 5;
  await desktop.page.waitForFunction(() => {
    const match = document.body.textContent.match(/Hydroponic bed growing, (\d+) seconds of server time remaining/);
    return match && Number(match[1]) <= 5;
  }, null, {timeout: 3000});
  assert.equal(await desktop.page.getByRole('button', {name: 'Harvest', exact: true}).count(), 0);

  app.game.world.time = bed.readyAt;
  for (const explorer of [desktop, touch]) {
    await assert.doesNotReject(() => explorer.page.getByText('Hydroponic bed ready to harvest', {exact: true}).waitFor({timeout: 3000}));
    await assert.doesNotReject(() => explorer.page.getByRole('button', {name: 'Harvest', exact: true}).waitFor({timeout: 3000}));
  }
  await touch.page.getByRole('button', {name: 'Harvest', exact: true}).tap();
  await touch.page.waitForFunction(() => !Object.hasOwn(window.vibeDiagnostics.state.structures.find(structure => structure.id === 'hydro-bed'), 'readyAt'));
  assert.equal(observer.inventory.fiber, 2);
  assert.equal(observer.inventory.ration, 1);
  await assert.doesNotReject(() => touch.page.locator('#terminalMessage').getByText('Harvested fiber and food.', {exact: true}).waitFor());
  await assert.doesNotReject(() => touch.page.getByRole('button', {name: 'Plant water + fiber', exact: true}).waitFor());
  assert.equal(gardenRequests.length, 2);
  assert.deepEqual(pageErrors, []);
  assert.deepEqual(externalRequests, []);
  console.log('PASS: test-only authoritative world-time advancement proved real planting, growing countdown without Harvest, due-time Harvest, exact output, desktop and 390x844 emulated touch at 200% zoom/reduced motion, no growing dispatch, page errors, or external requests.');
} catch (error) {
  primaryError = error;
}
const cleanupErrors = [];
for (const cleanup of [
  ...contexts.slice().reverse().flatMap(context => context.pages().map(page => () => page.close())),
  ...contexts.reverse().map(context => () => context.close()),
  () => browser?.close(),
  () => app?.close(),
  () => fs.rmSync(directory, {recursive: true, force: true}),
]) {
  try { await bounded('hydroponics browser cleanup', 5000, cleanup); } catch (error) { cleanupErrors.push(error); }
}
if (primaryError) {
  if (cleanupErrors.length) primaryError.cleanupErrors = cleanupErrors;
  throw primaryError;
}
if (cleanupErrors.length === 1) throw cleanupErrors[0];
if (cleanupErrors.length) throw new AggregateError(cleanupErrors, 'Hydroponics browser cleanup failed');
