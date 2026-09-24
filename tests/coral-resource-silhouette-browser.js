import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {chromium} from 'playwright';
import {apiAccount, startTestServer} from './auth-helper.js';
import {tileAt, tileContent, travel} from '../shared/planet.js';

const mode = process.argv.includes('--touch') ? 'touch' : 'desktop';
const directory = fs.mkdtempSync(path.join(os.tmpdir(), `vibe-coral-silhouette-${mode}-`));
let app;
let browser;
let context;
let page;
let primaryError;
const pageErrors = [];
const externalRequests = [];
const bounded = async (label, milliseconds, operation) => {
  let timer;
  try {
    return await Promise.race([
      Promise.resolve().then(operation),
      new Promise((_, reject) => { timer = setTimeout(() => reject(Error(`${label} exceeded ${milliseconds} ms`)), milliseconds); }),
    ]);
  } finally {
    clearTimeout(timer);
  }
};

try {
  app = startTestServer({port: 0, host: '127.0.0.1', saveFile: path.join(directory, 'world.json')});
  await bounded('local server listen', 5000, () => new Promise(resolve => app.server.once('listening', resolve)));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  browser = await bounded('installed Google Chrome launch', 10000, () => chromium.launch({
    headless: true,
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  }));
  context = await browser.newContext({
    viewport: mode === 'touch' ? {width: 390, height: 844} : {width: 1440, height: 900},
    hasTouch: mode === 'touch',
    isMobile: mode === 'touch',
    reducedMotion: 'reduce',
  });
  const account = await bounded('verified local account and character bootstrap', 8000, () => apiAccount(base, mode === 'touch' ? 62 : 61));
  const separator = account.cookie.indexOf('=');
  await context.addCookies([{
    name: account.cookie.slice(0, separator),
    value: account.cookie.slice(separator + 1),
    domain: '127.0.0.1',
    path: '/',
    httpOnly: true,
    sameSite: 'Lax',
  }]);
  page = await context.newPage();
  page.on('pageerror', error => pageErrors.push(error.message));
  page.on('request', request => { if (new URL(request.url()).hostname !== '127.0.0.1') externalRequests.push(request.url()); });
  await bounded('application navigation', 10000, () => page.goto(base, {waitUntil: 'domcontentloaded', timeout: 9000}));
  const cdp = await context.newCDPSession(page);
  await cdp.send('Emulation.setPageScaleFactor', {pageScaleFactor: 2});
  await bounded('verified account profile', 8000, async () => {
    await page.waitForFunction(() => document.querySelector('#character')?.options.length > 0, null, {timeout: 7500});
    await page.evaluate(character => {
      const select = document.querySelector('#character');
      select.value = character;
      select.dispatchEvent(new Event('change', {bubbles: true}));
    }, account.character);
    const profile = await page.request.get(`${base}/api/account`).then(response => response.json());
    assert.equal(profile.profile.emailVerified, true);
    assert.ok(profile.profile.characters.some(character => character.id === account.character));
  });
  await page.evaluate(() => document.querySelector('#findGame').click());
  await page.waitForFunction(() => !document.querySelector('#enter')?.disabled, null, {timeout: 5000});
  await page.evaluate(() => document.querySelector('#enter').click());
  await page.waitForFunction(() => window.vibeDiagnostics?.connected, null, {timeout: 9500});

  const id = await page.evaluate(() => window.vibeDiagnostics.id);
  const node = tileContent(app.game.world.seed, tileAt(0, -1500)).nodes.find(resource => resource.id.startsWith('p:coral:'));
  assert.ok(node);
  Object.assign(app.game.world.players[id], {...travel(node, 0, 2.4), cutter: true});
  await page.waitForFunction(nodeId => document.querySelector('#interaction')?.textContent === '[E] Gather Coral Flux · 6 remaining'
    && window.vibeDiagnostics?.state.resources.some(resource => resource.id === nodeId && resource.amount === 6), node.id, {timeout: 7500});

  const active = await page.evaluate(nodeId => window.vibeDiagnostics.coralFluxDeposits?.find(deposit => deposit.id === nodeId), node.id);
  assert.deepEqual(active && {depleted: active.depleted, parts: active.parts}, {depleted: false, parts: 4});
  assert.equal(active.inFrustum, true);
  assert.ok(active.screenWidth >= 18 && active.screenHeight >= 18, `active silhouette projected ${active.screenWidth}x${active.screenHeight}px`);

  app.game.world.depleted[node.id] = 0;
  app.game.coralFluxRegeneration[node.id] = app.game.world.time + 300;
  await page.waitForFunction(nodeId => /^Coral Flux depleted, regenerates in \d+ seconds of server time\.$/.test(document.querySelector('#interaction')?.textContent || '')
    && window.vibeDiagnostics?.state.resources.find(resource => resource.id === nodeId)?.amount === 0, node.id, {timeout: 7500});
  const depleted = await page.evaluate(nodeId => window.vibeDiagnostics.coralFluxDeposits?.find(deposit => deposit.id === nodeId), node.id);
  assert.deepEqual(depleted && {depleted: depleted.depleted, parts: depleted.parts}, {depleted: true, parts: 4});
  assert.equal(depleted.inFrustum, true);
  assert.ok(depleted.screenWidth >= 18 && depleted.screenHeight >= 18, `depleted silhouette projected ${depleted.screenWidth}x${depleted.screenHeight}px`);

  const due = app.game.coralFluxRegeneration[node.id];
  app.game.world.time = due;
  app.game.tick(0);
  await page.waitForFunction(nodeId => document.querySelector('#interaction')?.textContent === '[E] Gather Coral Flux · 6 remaining'
    && window.vibeDiagnostics?.state.resources.filter(resource => resource.id === nodeId).length === 1
    && window.vibeDiagnostics.state.resources.find(resource => resource.id === nodeId).amount === 6, node.id, {timeout: 7500});
  const regenerated = await page.evaluate(nodeId => window.vibeDiagnostics.coralFluxDeposits?.find(deposit => deposit.id === nodeId), node.id);
  assert.deepEqual(regenerated && {depleted: regenerated.depleted, parts: regenerated.parts}, {depleted: false, parts: 4});
  assert.equal(await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches), true);
  assert.equal(await page.evaluate(() => visualViewport.scale), 2);
  assert.deepEqual(pageErrors, []);
  assert.deepEqual(externalRequests, []);
  console.log(`PASS: ${mode} installed-Chrome journey kept one readable four-part Coral Flux silhouette active, depleted, and exact-due regenerated at 200% zoom with reduced motion, zero page errors, and zero external requests.`);
} catch (error) {
  if (page) {
    const observed = await page.evaluate(() => ({
      accountGate: document.querySelector('#accountGate')?.className,
      accountFeedback: document.querySelector('#accountFeedback')?.textContent,
      character: document.querySelector('#character')?.value,
      characters: document.querySelector('#character')?.options.length,
      joinError: document.querySelector('#joinError')?.textContent,
    })).catch(() => null);
    error.message += `; observed ${JSON.stringify(observed)}; page errors ${JSON.stringify(pageErrors)}`;
  }
  primaryError = error;
}
const cleanupErrors = [];
for (const cleanup of [() => page?.close(), () => context?.close(), () => browser?.close(), () => app?.close(), () => fs.rmSync(directory, {recursive: true, force: true})]) {
  try { await bounded('Coral silhouette browser cleanup', 1000, cleanup); } catch (error) { cleanupErrors.push(error); }
}
if (primaryError) {
  if (cleanupErrors.length) primaryError.cleanupErrors = cleanupErrors;
  throw primaryError;
}
if (cleanupErrors.length === 1) throw cleanupErrors[0];
if (cleanupErrors.length) throw new AggregateError(cleanupErrors, 'Coral silhouette browser cleanup failed');
