import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {chromium} from 'playwright';
import {browserAccount, startTestServer} from './auth-helper.js';

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'vibe-biome-browser-'));
const saveFile = path.join(directory, 'world.json');
let app = startTestServer({port: 0, host: '127.0.0.1', saveFile});
await new Promise(resolve => app.server.once('listening', resolve));
let port = app.server.address().port;
const browser = await chromium.launch({headless: true, executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
const errors = [];
const externalRequests = [];

async function connect(page, name) {
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => {
    const url = new URL(request.url());
    if (!['127.0.0.1', 'localhost'].includes(url.hostname)) externalRequests.push(request.url());
  });
  await page.goto(`http://127.0.0.1:${port}`);
  try {
    await page.locator('#username').waitFor({state: 'visible', timeout: 3000});
  } catch {
    const state = await page.evaluate(() => ({feedback: document.querySelector('#accountFeedback')?.textContent, gate: document.querySelector('#accountGate')?.className}));
    throw new Error(`Account form did not become visible: ${JSON.stringify({errors, state})}`);
  }
  await browserAccount(page, name);
  await page.locator('#enter').click();
  await page.waitForFunction(() => window.vibeDiagnostics?.connected);
  await page.evaluate(() => { document.body.style.zoom = '2'; });
  await installMapLabelCapture(page);
}

async function installMapLabelCapture(page) {
  await page.evaluate(() => {
    window.__mapLabels = [];
    const fillText = CanvasRenderingContext2D.prototype.fillText;
    CanvasRenderingContext2D.prototype.fillText = function (...args) {
      window.__mapLabels.push(String(args[0]));
      return fillText.apply(this, args);
    };
  });
}

async function assertMap(page, coralDiscovered) {
  await page.locator('#terminalAction').click();
  const list = page.locator('#discoveredBiomes');
  await assert.doesNotReject(() => list.getByText('Quiet Basin', {exact: true}).waitFor());
  assert.equal(await list.getByText('Coral Shelf', {exact: true}).count(), coralDiscovered ? 1 : 0);
  const player = await page.evaluate(() => window.vibeDiagnostics.player);
  assert.equal(Object.hasOwn(player, 'firstBiomeContacts'), coralDiscovered);
  const waypoint = page.locator('#firstBiomeContacts');
  assert.equal(await waypoint.count(), coralDiscovered ? 1 : 0);
  if (coralDiscovered) {
    const contact = player.firstBiomeContacts['coral-shelf'];
    await assert.doesNotReject(() => waypoint.getByText(
      `First Coral Shelf contact · ${Math.round(contact.x)} E / ${Math.round(-contact.z)} N`,
      {exact: true},
    ).waitFor());
  }
  const cuePixel = await page.locator('#planetMap').evaluate(canvas => [...canvas.getContext('2d').getImageData(16, 16, 1, 1).data]);
  assert.deepEqual(cuePixel, coralDiscovered ? [184, 117, 112, 255] : [16, 30, 41, 255]);
  const labels = await page.evaluate(() => window.__mapLabels);
  assert.equal(labels.includes('FIRST CORAL SHELF CONTACT'), coralDiscovered);
  await page.keyboard.press('Escape');
}

async function tap(cdp, box) {
  assert.ok(box?.width > 0 && box?.height > 0, 'touch target must have a nonempty bounding rectangle');
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await cdp.send('Input.dispatchTouchEvent', {type: 'touchStart', touchPoints: [{x, y, id: 1}]});
  await cdp.send('Input.dispatchTouchEvent', {type: 'touchEnd', touchPoints: []});
}

async function assertTouchMap(page, cdp, coralDiscovered) {
  await tap(cdp, await page.locator('#terminalAction').boundingBox());
  await page.locator('#expedition:not(.hidden)').waitFor();
  const list = page.locator('#discoveredBiomes');
  await assert.doesNotReject(() => list.getByText('Quiet Basin', {exact: true}).waitFor());
  assert.equal(await list.getByText('Coral Shelf', {exact: true}).count(), coralDiscovered ? 1 : 0);
  const player = await page.evaluate(() => window.vibeDiagnostics.player);
  assert.equal(Object.hasOwn(player, 'firstBiomeContacts'), coralDiscovered);
  const waypoint = page.locator('#firstBiomeContacts');
  assert.equal(await waypoint.count(), coralDiscovered ? 1 : 0);
  if (coralDiscovered) {
    const contact = player.firstBiomeContacts['coral-shelf'];
    await assert.doesNotReject(() => waypoint.getByText(
      `First Coral Shelf contact · ${Math.round(contact.x)} E / ${Math.round(-contact.z)} N`,
      {exact: true},
    ).waitFor());
  }
  const cuePixel = await page.locator('#planetMap').evaluate(canvas => [...canvas.getContext('2d').getImageData(16, 16, 1, 1).data]);
  assert.deepEqual(cuePixel, coralDiscovered ? [184, 117, 112, 255] : [16, 30, 41, 255]);
  const labels = await page.evaluate(() => window.__mapLabels);
  assert.equal(labels.includes('FIRST CORAL SHELF CONTACT'), coralDiscovered);
  const closeBox = await page.locator('#closeExpedition').boundingBox();
  const viewport = page.viewportSize();
  assert.ok(closeBox?.width > 0 && closeBox?.height > 0, 'Close must have a nonempty bounding rectangle');
  assert.ok(closeBox.x >= 0 && closeBox.y >= 0 && closeBox.x + closeBox.width <= viewport.width && closeBox.y + closeBox.height <= viewport.height,
    `Close must be wholly inside the ${viewport.width}x${viewport.height} viewport; received ${JSON.stringify(closeBox)}`);
  await tap(cdp, closeBox);
  await page.locator('#expedition').waitFor({state: 'hidden'});
}

async function placeOutsideCoral(page) {
  const id = await page.evaluate(() => window.vibeDiagnostics.id);
  const player = app.game.world.players[id];
  player.x = 5000;
  player.z = -33257;
  if (!player.markers.some(marker => marker.name === 'Existing marker')) player.markers.push({x: 5002, z: -33256, name: 'Existing marker'});
  await page.waitForFunction(() => Math.abs(window.vibeDiagnostics.player.z + 33257) < 0.5);
  return player;
}

try {
  const desktopContext = await browser.newContext({viewport: {width: 1400, height: 900}, reducedMotion: 'reduce'});
  const desktop = await desktopContext.newPage();
  await connect(desktop, 'Keyboard Explorer');
  const desktopPlayer = await placeOutsideCoral(desktop);
  await assertMap(desktop, false);
  await desktop.keyboard.down('KeyS');
  await desktop.waitForFunction(() => window.vibeDiagnostics.player.discoveredBiomes?.includes('coral-shelf'), null, {timeout: 5000});
  await desktop.keyboard.up('KeyS');
  assert.ok(desktopPlayer.z > -33257, 'keyboard input must physically move the authoritative player');
  await desktop.keyboard.press('KeyM');
  await assert.doesNotReject(() => desktop.locator('#discoveredBiomes').getByText('Coral Shelf', {exact: true}).waitFor());
  const desktopCue = await desktop.locator('#planetMap').evaluate(canvas => [...canvas.getContext('2d').getImageData(16, 16, 1, 1).data]);
  assert.deepEqual(desktopCue, [184, 117, 112, 255]);
  assert.equal((await desktop.evaluate(() => window.__mapLabels)).includes('FIRST CORAL SHELF CONTACT'), true);
  assert.equal((await desktop.evaluate(() => window.__mapLabels)).includes('Existing marker'), true);
  await desktop.keyboard.press('Escape');

  app.save();
  await app.close();
  app = startTestServer({port, host: '127.0.0.1', saveFile});
  await new Promise(resolve => app.server.once('listening', resolve));
  await desktop.reload();
  await desktop.locator('#findGame').click();
  await desktop.locator('#enter').click();
  await desktop.waitForFunction(() => window.vibeDiagnostics?.connected);
  await desktop.evaluate(() => { document.body.style.zoom = '2'; });
  await installMapLabelCapture(desktop);
  await assertMap(desktop, true);
  await desktopContext.close();

  const touchContext = await browser.newContext({viewport: {width: 390, height: 844}, hasTouch: true, isMobile: true, reducedMotion: 'reduce'});
  const touch = await touchContext.newPage();
  await connect(touch, 'Touch Explorer');
  const touchPlayer = await placeOutsideCoral(touch);
  const cdp = await touchContext.newCDPSession(touch);
  await assertTouchMap(touch, cdp, false);
  const box = await touch.locator('#stick').boundingBox();
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await cdp.send('Input.dispatchTouchEvent', {type: 'touchStart', touchPoints: [{x, y, id: 1}]});
  await cdp.send('Input.dispatchTouchEvent', {type: 'touchMove', touchPoints: [{x, y: y + Math.min(40, box.height / 3), id: 1}]});
  await touch.waitForFunction(() => window.vibeDiagnostics.player.discoveredBiomes?.includes('coral-shelf'), null, {timeout: 5000});
  await cdp.send('Input.dispatchTouchEvent', {type: 'touchEnd', touchPoints: []});
  assert.ok(touchPlayer.z > -33257, 'touch input must physically move the authoritative player');
  await assertTouchMap(touch, cdp, true);
  await touchContext.close();

  assert.deepEqual(errors, []);
  assert.deepEqual(externalRequests, []);
  console.log('PASS: desktop keyboard and 390x844 touch at 200% zoom/reduced motion conceal then reveal the private first-contact text/coordinates/map label; restart preserves contact and existing markers/survey; zero page errors/external requests.');
} finally {
  await browser.close();
  await app.close();
  fs.rmSync(directory, {recursive: true});
}
