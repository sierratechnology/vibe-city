import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {browserAccount} from './auth-helper.js';
import {launchBrowser, resolveBrowserEngine} from './browser-engine.js';
import {startServer} from '../server/index.js';

const browserEngine = process.argv[2] || process.env.BROWSER_ENGINE || 'chromium';
resolveBrowserEngine(browserEngine);
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'vibe-sequence-browser-'));
const app = startServer({port: 0, host: '127.0.0.1', saveFile: path.join(directory, 'world.json')});
await new Promise(resolve => app.server.once('listening', resolve));
const port = app.server.address().port;
const browser = await launchBrowser(browserEngine);
const context = await browser.newContext({viewport: {width: 1440, height: 900}});
const page = await context.newPage();
const errors = [];
const forwardedSequences = [];
let delayedSequence = null;
let reorderedSequence = null;
page.on('pageerror', error => errors.push(error.message));
await context.routeWebSocket(/\/api\/ws$/, route => {
  const server = route.connectToServer();
  route.onMessage(message => {
    const text = String(message);
    const packet = JSON.parse(text);
    if (packet.type !== 'input' || (!packet.x && !packet.z) || reorderedSequence !== null) {
      server.send(message);
      return;
    }
    if (delayedSequence === null) {
      delayedSequence = packet.sequence;
      setTimeout(() => {
        forwardedSequences.push(delayedSequence);
        server.send(message);
      }, 150);
      return;
    }
    reorderedSequence = packet.sequence;
    forwardedSequences.push(reorderedSequence);
    server.send(message);
  });
});
const diagnostics = () => page.evaluate(() => window.vibeDiagnostics);
const pause = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

try {
  await page.goto(`http://127.0.0.1:${port}`);
  await page.locator('#findGame').click();
  await browserAccount(page, 'Sequence Pilot');
  await page.locator('#enter').click();
  await page.waitForFunction(() => window.vibeDiagnostics?.connected);
  const start = await diagnostics();
  await page.keyboard.down('KeyD');
  try {
    await page.waitForFunction(x => window.vibeDiagnostics.player.x > x + 1.5, start.player.x, {timeout: 5000});
  } finally {
    await page.keyboard.up('KeyD');
  }
  await page.waitForFunction(() => window.vibeDiagnostics.inputAck !== null && window.vibeDiagnostics.pendingInputs <= 32);
  await pause(500);
  const settledA = await diagnostics();
  await pause(500);
  const settledB = await diagnostics();

  assert.ok(Number.isSafeInteger(delayedSequence));
  assert.equal(reorderedSequence, delayedSequence + 1);
  assert.deepEqual(forwardedSequences.slice(0, 2), [reorderedSequence, delayedSequence]);
  assert.ok(settledB.inputAck >= reorderedSequence, 'server must acknowledge the newer reordered input');
  assert.ok(settledB.pendingInputs <= 32, 'client pending input state must remain bounded');
  assert.ok(settledB.player.x > start.player.x + 1.5, 'meaningful movement must continue after reordered input');
  assert.ok(Math.hypot(settledB.player.x - settledA.player.x, settledB.player.z - settledA.player.z) < 0.15, 'authoritative position must settle after input acknowledgement');
  assert.equal(errors.length, 0, errors.join('\n'));
  console.log(JSON.stringify({browserEngine, delayedSequence, reorderedSequence, inputAck: settledB.inputAck, pendingInputs: settledB.pendingInputs, movement: settledB.player.x - start.player.x, pageErrors: errors.length}));
} finally {
  await browser.close();
  await app.close();
  fs.rmSync(directory, {recursive: true});
}
