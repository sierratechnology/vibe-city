import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {chromium} from 'playwright';
import {apiAccount, startTestServer} from './auth-helper.js';
import {coralShelfLandmark} from '../shared/landmarks.js';
import {tileAt, tileContent, travel} from '../shared/planet.js';

const mode = process.argv.includes('--touch') ? 'touch' : 'desktop';
const directory = fs.mkdtempSync(path.join(os.tmpdir(), `vibe-coral-environment-${mode}-`));
let app, browser, context, page, primaryError;
const pageErrors = [], externalRequests = [];
const bounded = async (label, milliseconds, operation) => {
  let timer;
  try { return await Promise.race([Promise.resolve().then(operation), new Promise((_, reject) => { timer = setTimeout(() => reject(Error(`${label} exceeded ${milliseconds} ms`)), milliseconds); })]); }
  finally { clearTimeout(timer); }
};

try {
  await bounded(`${mode} Coral Shelf environment journey`, 120000, async () => {
    app = startTestServer({port: 0, host: '127.0.0.1', saveFile: path.join(directory, 'world.json')});
    await bounded('local server listen', 5000, () => new Promise(resolve => app.server.once('listening', resolve)));
    const base = `http://127.0.0.1:${app.server.address().port}`;
    browser = await bounded('installed Google Chrome launch', 10000, () => chromium.launch({headless: true, executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'}));
    context = await browser.newContext({viewport: mode === 'touch' ? {width: 390, height: 844} : {width: 1440, height: 900}, hasTouch: mode === 'touch', isMobile: mode === 'touch', reducedMotion: 'reduce'});
    const account = await bounded('verified local account and character bootstrap', 8000, () => apiAccount(base, mode === 'touch' ? 82 : 81));
    const separator = account.cookie.indexOf('=');
    await context.addCookies([{name: account.cookie.slice(0, separator), value: account.cookie.slice(separator + 1), domain: '127.0.0.1', path: '/', httpOnly: true, sameSite: 'Lax'}]);
    page = await context.newPage();
    page.on('pageerror', error => pageErrors.push(error.message));
    page.on('request', request => { if (new URL(request.url()).hostname !== '127.0.0.1') externalRequests.push(request.url()); });
    await page.goto(base, {waitUntil: 'domcontentloaded', timeout: 9000});
    const cdp = await context.newCDPSession(page);
    await cdp.send('Emulation.setPageScaleFactor', {pageScaleFactor: 2});
    await page.waitForFunction(() => document.querySelector('#character')?.options.length > 0, null, {timeout: 7500});
    await page.evaluate(character => { const select = document.querySelector('#character'); select.value = character; select.dispatchEvent(new Event('change', {bubbles: true})); }, account.character);
    await page.evaluate(() => document.querySelector('#findGame').click());
    await page.waitForFunction(() => !document.querySelector('#enter')?.disabled, null, {timeout: 5000});
    await page.evaluate(() => document.querySelector('#enter').click());
    await page.waitForFunction(() => window.vibeDiagnostics?.connected, null, {timeout: 9500});
    assert.equal(await page.locator('#coords').innerText(), 'Quiet Basin');
    assert.deepEqual(await page.evaluate(() => window.vibeDiagnostics.coralShelfEnvironment), {formations: 0, parts: 0, instanced: true, role: 'scenery', inFrustum: false});

    const id = await page.evaluate(() => window.vibeDiagnostics.id);
    const crown = coralShelfLandmark(app.game.world.seed);
    Object.assign(app.game.world.players[id], {x: crown.x, z: crown.z});
    await page.waitForFunction(() => document.querySelector('#coords')?.textContent === 'Coral Shelf · Near Coral Crown', null, {timeout: 7500});
    assert.deepEqual(await page.evaluate(() => window.vibeDiagnostics.coralCrown), {count: 1, visible: true, parts: 5});

    const node = tileContent(app.game.world.seed, tileAt(0, -1500)).nodes.find(resource => resource.id.startsWith('p:coral:'));
    assert.ok(node);
    Object.assign(app.game.world.players[id], {...travel(node, 0, 2.4), cutter: true});
    await page.waitForFunction(nodeId => document.querySelector('#interaction')?.textContent === '[E] Gather Coral Flux · 6 remaining' && window.vibeDiagnostics?.coralShelfEnvironment?.formations > 0 && window.vibeDiagnostics?.state.resources.filter(resource => resource.id === nodeId).length === 1, node.id, {timeout: 7500});
    const observed = await page.evaluate(nodeId => ({environment: window.vibeDiagnostics.coralShelfEnvironment, deposits: window.vibeDiagnostics.coralFluxDeposits.filter(deposit => deposit.id === nodeId), interaction: document.querySelector('#interaction').textContent}), node.id);
    assert.ok(observed.environment.formations <= 20);
    assert.equal(observed.environment.parts, observed.environment.formations * 5);
    assert.equal(observed.environment.instanced, true);
    assert.equal(observed.environment.role, 'scenery');
    assert.equal(observed.environment.inFrustum, true);
    assert.equal(observed.deposits.length, 1);
    assert.equal(observed.deposits[0].parts, 4);
    assert.equal(observed.interaction, '[E] Gather Coral Flux · 6 remaining');
    assert.equal(await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches), true);
    assert.equal(await page.evaluate(() => visualViewport.scale), 2);
    assert.deepEqual(pageErrors, []);
    assert.deepEqual(externalRequests, []);
    console.log(`PASS: ${mode} installed-Chrome journey showed bounded instanced Coral Shelf fans while Quiet Basin remained clear and Coral Crown/Coral Flux stayed single and truthful at 200% zoom with reduced motion, zero page errors, and zero external requests.`);
  });
} catch (error) {
  const observed = await page?.evaluate(() => ({accountGate: document.querySelector('#accountGate')?.className, accountFeedback: document.querySelector('#accountFeedback')?.textContent, characterOptions: document.querySelector('#character')?.options.length})).catch(() => null);
  error.message += `; observed ${JSON.stringify(observed)}; page errors ${JSON.stringify(pageErrors)}`;
  primaryError = error;
}
const cleanupErrors = [];
const cleanupDeadline = Date.now() + 5000;
for (const cleanup of [() => page?.close(), () => context?.close(), () => browser?.close(), () => app?.close(), () => fs.rmSync(directory, {recursive: true, force: true})]) {
  try { await bounded('Coral environment browser cleanup', Math.max(1, cleanupDeadline - Date.now()), cleanup); } catch (error) { cleanupErrors.push(error); }
}
if (primaryError) { if (cleanupErrors.length) primaryError.cleanupErrors = cleanupErrors; throw primaryError; }
if (cleanupErrors.length === 1) throw cleanupErrors[0];
if (cleanupErrors.length) throw new AggregateError(cleanupErrors, 'Coral environment browser cleanup failed');
