import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {apiAccount, startTestServer} from './auth-helper.js';
import {launchBrowser, resolveBrowserEngine} from './browser-engine.js';
import {blocked, sheltered} from '../shared/world.js';

const engine = process.argv[2] || 'chromium';
const mode = process.argv[3] || 'desktop';
resolveBrowserEngine(engine);
if (engine !== 'chromium') throw new Error('The bounded Deck railing journey uses Chromium CDP zoom and touch emulation.');
if (!['desktop', 'touch'].includes(mode)) throw new Error(`Unknown Deck railing browser mode: ${mode}`);
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'vibe-deck-railing-browser-'));
const app = startTestServer({port: 0, host: '127.0.0.1', saveFile: path.join(directory, 'world.json')});
let browser;
const diagnostics = page => page.evaluate(() => window.vibeDiagnostics);
const railingDiagnostics = page => page.evaluate(() => window.vibeRailingDiagnostics());

async function join(page, base, errors) {
  await page.goto(base, {waitUntil: 'domcontentloaded'});
  try {
    await page.waitForFunction(() => document.querySelector('#character')?.options.length > 0);
  } catch (error) {
    const account = await page.request.get(`${base}/api/account`).then(response => response.text());
    throw new Error(`Character selector did not populate: ${account}; diagnostics: ${JSON.stringify(await page.evaluate(() => ({feedback: document.querySelector('#accountFeedback')?.textContent, error: document.querySelector('#accountError')?.textContent, scripts: [...document.scripts].map(script => script.src), diagnostics: typeof window.vibeDiagnostics}))) }; errors: ${JSON.stringify(errors)}`, {cause: error});
  }
  await page.locator('#findGame').click();
  await page.locator('#enter').click();
  await page.waitForFunction(() => window.vibeDiagnostics?.connected);
}

async function activate(locator, touch) {
  if (touch) await locator.tap();
  else await locator.click();
}

async function selectPiece(page, piece, touch) {
  await activate(page.locator('#buildAction'), touch);
  await activate(page.locator(`[data-piece="${piece}"]`), touch);
  await page.waitForFunction(selected => window.vibeDiagnostics?.selected === selected, piece);
}

async function alignPreviewWithDeck(page, player, deck) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const preview = (await diagnostics(page)).preview;
    if (preview?.x === deck.x && preview?.z === deck.z) return;
    assert.ok(preview && Number.isFinite(preview.x) && Number.isFinite(preview.z), 'Expected a finite build preview');
    player.x += deck.x - preview.x;
    player.z += deck.z - preview.z;
    const expected = [player.x, player.z];
    await page.waitForFunction(([x, z]) => Math.abs(window.vibeDiagnostics.player.x - x) < .05 && Math.abs(window.vibeDiagnostics.player.z - z) < .05, expected);
  }
  const preview = (await diagnostics(page)).preview;
  assert.deepEqual([preview?.x, preview?.z], [deck.x, deck.z], 'Could not align the UI preview with its supporting Deck');
}

try {
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Test server listen timeout')), 5000);
    app.server.once('listening', () => { clearTimeout(timer); resolve(); });
  });
  browser = await launchBrowser(engine);
  const touch = mode === 'touch';
  const context = await browser.newContext(touch
    ? {viewport: {width: 390, height: 844}, screen: {width: 390, height: 844}, isMobile: true, hasTouch: true, deviceScaleFactor: 2, reducedMotion: 'reduce'}
    : {viewport: {width: 1440, height: 900}, reducedMotion: 'reduce'});
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const account = await apiAccount(base, touch ? 2 : 1);
  const [name, value] = account.cookie.split('=');
  await context.addCookies([{name, value, url: base}]);
  const page = await context.newPage();
  page.setDefaultTimeout(10000);
  page.setDefaultNavigationTimeout(10000);
  const errors = [], external = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => {
    const url = new URL(request.url());
    if (!['127.0.0.1', 'localhost'].includes(url.hostname)) external.push(request.url());
  });

  await join(page, base, errors);
  const id = (await diagnostics(page)).id;
  const player = app.game.world.players[id];
  for (const item of Object.keys(player.inventory)) player.inventory[item] = 0;
  player.inventory.ferrite = touch ? 4 : 3;
  player.inventory.fiber = 1;
  app.game.world.resources = [];
  app.save();
  await page.waitForFunction(expected => window.vibeDiagnostics.player.inventory.ferrite === expected, touch ? 4 : 3);

  await activate(page.locator('#menuButton'), touch);
  const recipe = page.locator('.recipe').filter({has: page.locator('b', {hasText: 'Deck railing'})});
  assert.equal(await recipe.locator('button:not(.pin-recipe)').getAttribute('aria-label'), 'Select deck railing');
  assert.equal(await recipe.locator('small').innerText(), '1 Ferrite');
  assert.equal(await recipe.locator('p').innerText(), 'A low barrier on a supported Deck edge. R rotates to another edge.');
  await activate(page.locator('#closeGuide'), touch);

  const cdp = await context.newCDPSession(page);
  await cdp.send('Emulation.setPageScaleFactor', {pageScaleFactor: 2});
  assert.ok(await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches));
  assert.ok(await page.evaluate(() => visualViewport.scale >= 1.99), '200% zoom was not applied');
  await cdp.send('Emulation.setPageScaleFactor', {pageScaleFactor: 1});

  await selectPiece(page, 'floor', touch);
  await page.waitForFunction(() => window.vibeDiagnostics.preview && !document.querySelector('#buildHint').textContent.includes('occupied'));
  await activate(page.locator('#gatherAction'), touch);
  await page.waitForFunction(() => window.vibeDiagnostics.state.structures.some(structure => structure.type === 'floor'));
  await page.waitForFunction(expected => window.vibeDiagnostics.player.inventory.ferrite === expected && window.vibeDiagnostics.player.inventory.fiber === 0, touch ? 2 : 1);
  await page.waitForFunction(readyAt => window.vibeDiagnostics.state.time >= readyAt, app.game.world.time + .25);

  await activate(page.locator('[data-piece="railing"]'), touch);
  const deck = app.game.world.structures.find(structure => structure.type === 'floor');
  await alignPreviewWithDeck(page, player, deck);
  await activate(page.locator('#rotateAction'), touch);
  await page.waitForFunction(() => window.vibeRailingDiagnostics().previewRailing?.rotation === 1);
  const preview = await railingDiagnostics(page);
  assert.deepEqual(preview.previewRailing, {rotation: 1, parts: 4});
  assert.match(await page.locator('#buildHint').innerText(), /VALID/, 'Railing preview must remain on the supported Deck');
  const ferriteBefore = (await diagnostics(page)).player.inventory.ferrite;
  await activate(page.locator('#gatherAction'), touch);
  await page.waitForFunction(() => window.vibeDiagnostics.state.structures.some(structure => structure.type === 'railing'));
  await page.waitForFunction(expected => window.vibeDiagnostics.player.inventory.ferrite === expected, ferriteBefore - 1);

  const accepted = app.game.world.structures.find(structure => structure.type === 'railing');
  assert.ok(accepted && accepted.owner === id && accepted.rotation === 1);
  assert.equal(blocked(app.game.world, accepted.x + 1.5, accepted.z), true);
  assert.equal(sheltered(app.game.world, accepted), false);
  assert.deepEqual((await railingDiagnostics(page)).renderedRailings, [{id: accepted.id, rotation: 1, parts: 4}]);
  assert.equal(fs.existsSync(path.join(directory, 'world.json')), true);

  await page.reload({waitUntil: 'domcontentloaded'});
  await page.waitForFunction(() => document.querySelector('#character')?.options.length > 0);
  await page.locator('#findGame').click();
  await page.locator('#enter').click();
  await page.waitForFunction(() => window.vibeDiagnostics?.connected && window.vibeDiagnostics.state.structures.some(structure => structure.type === 'railing'));
  assert.equal((await diagnostics(page)).state.structures.find(structure => structure.type === 'railing').owner, id);

  if (touch) {
    await selectPiece(page, 'railing', true);
    await alignPreviewWithDeck(page, player, deck);
    await activate(page.locator('#rotateAction'), true);
    await activate(page.locator('#rotateAction'), true);
    await page.waitForFunction(() => window.vibeRailingDiagnostics().previewRailing?.rotation === 2);
    await activate(page.locator('#gatherAction'), true);
    await page.waitForFunction(() => window.vibeDiagnostics.state.structures.filter(structure => structure.type === 'railing').length === 2);
    const railings = (await diagnostics(page)).state.structures.filter(structure => structure.type === 'railing');
    assert.deepEqual(railings.map(structure => structure.rotation).sort(), [1, 2]);
    assert.equal((await diagnostics(page)).player.inventory.ferrite, 0);
  }

  assert.deepEqual(errors, []);
  assert.deepEqual(external, []);
  console.log(`${engine}: ${mode} Deck railing catalog, exact cost, UI placement, collision, open non-shelter rendering, reconnect, reduced motion, 200% zoom${touch ? ', and emulated-touch second-edge placement' : ''} passed`);
  await context.close();
} finally {
  if (browser) await browser.close();
  await app.close();
  fs.rmSync(directory, {recursive: true, force: true});
}
