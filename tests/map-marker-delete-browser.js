// Real browser/server matrix. Touch is emulated and controller is virtual; physical devices remain unverified.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {apiAccount, startTestServer} from './auth-helper.js';
import {launchBrowser, resolveBrowserEngine} from './browser-engine.js';

const engine = process.argv[2] || 'chromium';
const mode = process.argv[3] || 'desktop';
resolveBrowserEngine(engine);
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'vibe-marker-delete-'));
const app = startTestServer({port: 0, host: '127.0.0.1', saveFile: path.join(directory, 'world.json')});
await new Promise(resolve => app.server.once('listening', resolve));
const browser = await launchBrowser(engine);
const context = await browser.newContext(mode === 'touch' ? {viewport: {width: 390, height: 844}, hasTouch: true, isMobile: true} : {viewport: {width: 1440, height: 900}});
const base = `http://127.0.0.1:${app.server.address().port}`;
const accountNumber = mode === 'touch' ? 95 : mode === 'controller' ? 96 : engine === 'firefox' ? 97 : 94;
const account = await apiAccount(base, accountNumber);
const cookieSeparator = account.cookie.indexOf('=');
await context.addCookies([{name: account.cookie.slice(0, cookieSeparator), value: account.cookie.slice(cookieSeparator + 1), url: base}]);
const page = await context.newPage();
await page.emulateMedia({reducedMotion: 'reduce'});
const errors = [];
const external = [];
page.on('pageerror', error => errors.push(error.message));
page.on('request', request => {if (!request.url().startsWith(`http://127.0.0.1:${app.server.address().port}`)) external.push(request.url());});
if (mode === 'controller') await page.addInitScript(() => {
  window.testPad = {id: 'Map marker virtual standard controller', index: 0, connected: true, mapping: 'standard', axes: [0, 0, 0, 0], buttons: Array.from({length: 16}, () => ({pressed: false})), samples: 0};
  Object.defineProperty(navigator, 'getGamepads', {value: () => {window.testPad.samples++;return [window.testPad];}});
});
const pressPad = async index => {
  await page.evaluate(button => {window.testPad.buttons[button].pressed = true;}, index);
  await page.waitForTimeout(100);
  await page.evaluate(button => {window.testPad.buttons[button].pressed = false;}, index);
  await page.waitForTimeout(100);
};
try {
  await page.goto(base, {waitUntil: 'domcontentloaded'});
  await page.locator('#findGame').waitFor({state: 'visible'});
  await page.locator('#findGame').click();
  await page.waitForFunction(() => document.querySelector('#character')?.options.length > 0);
  await page.locator('#enter').click();
  await page.waitForFunction(() => window.vibeDiagnostics?.connected);
  await page.keyboard.press('KeyM');
  await page.evaluate(() => { document.documentElement.style.zoom = '200%'; });
  assert.equal(await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches), true);
  assert.equal(await page.evaluate(() => getComputedStyle(document.documentElement).zoom), '2');
  const initialGlyphs = await page.locator('#planetMap').evaluate(canvas => canvas.toDataURL());
  const createMarker = async name => {
    const count = await page.evaluate(() => window.vibeDiagnostics.player.markers.length);
    await page.locator('#markerName').fill(name);
    await page.getByRole('button', {name: 'Mark current location'}).click();
    await page.waitForFunction(expected => window.vibeDiagnostics.player.markers?.length === expected, count + 1);
    await page.getByRole('button', {name: `Delete ${name} marker`}).waitFor();
  };
  await createMarker('Alpha');
  await createMarker('Beta');
  await createMarker('Gamma');
  assert.match(await page.locator('#markerList').innerText(), /Alpha.*0 E \/ -3 N.*Beta.*0 E \/ -3 N.*Gamma.*0 E \/ -3 N/s);
  assert.notEqual(await page.locator('#planetMap').evaluate(canvas => canvas.toDataURL()), initialGlyphs);

  const synchronous = await page.getByRole('button', {name: 'Delete Beta marker'}).evaluate(button => {
    button.click();
    return {
      rows: document.querySelectorAll('#markerList li').length,
      markers: window.vibeDiagnostics.player.markers.length,
    };
  });
  assert.deepEqual(synchronous, {rows: 3, markers: 3});
  await page.waitForFunction(() => window.vibeDiagnostics.player.markers?.map(marker => marker.name).join(',') === 'Alpha,Gamma');
  assert.equal(await page.getByRole('button', {name: 'Delete Gamma marker'}).evaluate(node => node === document.activeElement), true);

  const removeGamma = page.getByRole('button', {name: 'Delete Gamma marker'});
  if (mode === 'touch') {
    await removeGamma.tap();
  } else if (mode === 'controller') {
    await page.getByRole('button', {name: 'Delete Alpha marker'}).focus();
    await pressPad(13);
    assert.equal(await removeGamma.evaluate(node => node === document.activeElement), true);
    await pressPad(0);
    assert.ok(await page.evaluate(() => window.testPad.samples > 0));
  } else {
    await removeGamma.focus();
    await page.keyboard.press('Enter');
  }
  await page.waitForFunction(() => window.vibeDiagnostics.player.markers?.map(marker => marker.name).join(',') === 'Alpha');
  const removeAlpha = page.getByRole('button', {name: 'Delete Alpha marker'});
  assert.equal(await removeAlpha.evaluate(node => node === document.activeElement), true);
  if (mode === 'touch') {
    await removeAlpha.tap();
  } else if (mode === 'controller') await pressPad(0);
  else await removeAlpha.click();
  await page.waitForFunction(() => window.vibeDiagnostics.player.markers?.length === 0);
  await page.locator('#terminalMessage').getByText('Map marker deleted.', {exact: true}).waitFor();
  assert.equal(await page.locator('#markerListHeading').evaluate(node => node === document.activeElement), true);
  assert.equal(await page.locator('#markerList').locator('li').count(), 0);
  assert.equal(await page.locator('#planetMap').evaluate(canvas => canvas.toDataURL()), initialGlyphs);
  assert.deepEqual(errors, []);
  assert.deepEqual(external, []);
  console.log(`PASS ${engine} ${mode}: authoritative list/glyph refresh, no optimistic deletion, next/previous/heading focus, 200% zoom, reduced motion, zero page errors, zero non-loopback requests`);
} finally {
  await browser.close();
  await app.close();
  fs.rmSync(directory, {recursive: true, force: true});
}
