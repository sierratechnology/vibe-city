import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {applySnapshotDelta} from '../client/snapshot-delta.js';
import {browserAccount, startTestServer as startServer} from './auth-helper.js';
import {launchBrowser, resolveBrowserEngine} from './browser-engine.js';

const browserEngine = process.argv[2] || process.env.BROWSER_ENGINE || 'chromium';
const scenario = process.argv[3] || 'single-loss';
resolveBrowserEngine(browserEngine);
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'vibe-delta-browser-'));
const app = startServer({port: 0, host: '127.0.0.1', saveFile: path.join(directory, 'world.json')});
await new Promise(resolve => app.server.once('listening', resolve));
const browser = await launchBrowser(browserEngine);
const context = await browser.newContext({viewport: {width: 1440, height: 900}});
const page = await context.newPage();
const errors = [];
let connections = 0;
let droppedRevision = null;
let latestState = null;
let latestRevision = null;
let freezeNext = false;
let frozenRevision = null;
let frozenState = null;
let recoveryTriggeredAfterRevision = null;
let stateBeforeMalformed = null;
let revisionBeforeMalformed = null;
let heldMalformedUpdate = null;
let heldRecoveryWelcome = null;
let recoveryWelcomeReleased = false;
const heldRecoveryUpdates = [];
page.on('pageerror', error => errors.push(error.message));
await context.routeWebSocket(/\/api\/ws$/, route => {
  connections++;
  if (connections === 2) recoveryTriggeredAfterRevision = latestRevision;
  const connection = connections;
  let corruptedFirstUpdate = false;
  const server = route.connectToServer();
  route.onMessage(message => server.send(message));
  server.onMessage(message => {
    const packet = JSON.parse(String(message));
    if (scenario === 'repeated-malformed' && (packet.type === 'delta' || packet.type === 'state')) {
      if (!corruptedFirstUpdate) {
        corruptedFirstUpdate = true;
        if (packet.type === 'delta') packet.delta.revision++;
        else packet.revision++;
        route.send(JSON.stringify(packet));
      }
      return;
    }
    if (scenario === 'nested-duplicate' && connection === 1 && !corruptedFirstUpdate && (packet.type === 'delta' || packet.type === 'state')) {
      corruptedFirstUpdate = true;
      const raw = String(message);
      const value = packet.type === 'delta' ? packet.delta.changes.time : packet.state.time;
      heldMalformedUpdate = {route, message: raw.replace(`"time":${JSON.stringify(value)}`, `"time":999,"time":${JSON.stringify(value)}`)};
      return;
    }
    if (scenario === 'nested-duplicate' && connection === 2 && packet.type === 'welcome' && !heldRecoveryWelcome) {
      heldRecoveryWelcome = {route, message};
      return;
    }
    if (scenario === 'nested-duplicate' && connection === 2 && heldRecoveryWelcome && !recoveryWelcomeReleased && (packet.type === 'delta' || packet.type === 'state')) {
      heldRecoveryUpdates.push({route, message});
      return;
    }
    if (scenario === 'nested-duplicate' && connection === 1 && corruptedFirstUpdate) return;
    if (packet.type === 'welcome') {
      latestState = structuredClone(packet.state);
      latestRevision = packet.revision;
    } else if (packet.type === 'delta') {
      latestState = applySnapshotDelta(latestState, packet.delta, latestRevision);
      latestRevision = packet.delta.revision;
      if (connection === 1 && droppedRevision === null) {
        droppedRevision = latestRevision;
        return;
      }
    } else if (packet.type === 'state') {
      latestState = structuredClone(packet.state);
      latestRevision = packet.revision;
    }
    if (freezeNext && (packet.type === 'delta' || packet.type === 'state')) {
      frozenRevision = latestRevision;
      frozenState = structuredClone(latestState);
      freezeNext = false;
      route.send(message);
      return;
    }
    if (frozenRevision === null) route.send(message);
  });
});
const diagnostics = () => page.evaluate(() => window.vibeDiagnostics);
const pause = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

try {
  await page.goto(`http://127.0.0.1:${app.server.address().port}`);
  await browserAccount(page, 'Delta Pilot');
  await page.locator('#enter').click();
  if (scenario === 'nested-duplicate') {
    for (let i = 0; i < 100 && !heldMalformedUpdate; i++) await pause(50);
    assert.ok(heldMalformedUpdate, 'fixture must hold the malformed update until browser state is captured');
    const beforeMalformed = await diagnostics();
    stateBeforeMalformed = structuredClone(beforeMalformed.state);
    revisionBeforeMalformed = beforeMalformed.snapshotRevision;
    heldMalformedUpdate.route.send(heldMalformedUpdate.message);
    for (let i = 0; i < 100 && !heldRecoveryWelcome; i++) await pause(50);
    assert.ok(heldRecoveryWelcome, 'nested duplicate must trigger a bounded recovery connection');
    const unchanged = await diagnostics();
    assert.deepEqual(unchanged.state, stateBeforeMalformed);
    assert.equal(unchanged.snapshotRevision, null, 'closed malformed connection must clear the active revision without changing state');
    recoveryWelcomeReleased = true;
    heldRecoveryWelcome.route.send(heldRecoveryWelcome.message);
    for (const update of heldRecoveryUpdates) update.route.send(update.message);
    await page.waitForFunction(revision => window.vibeDiagnostics?.connected && window.vibeDiagnostics.snapshotRevision > revision, revisionBeforeMalformed);
    const settled = await diagnostics();
    assert.equal(connections, 2);
    assert.equal(settled.state.players.length, 1);
    assert.equal(errors.length, 0, errors.join('\n'));
    console.log(JSON.stringify({browserEngine, scenario, recoveryConnections: connections, unchangedRevision: revisionBeforeMalformed, recoveredRevision: settled.snapshotRevision, pageErrors: errors.length}));
  } else if (scenario === 'repeated-malformed') {
    await page.waitForFunction(() => document.querySelector('#joinError').textContent === 'Connection lost. Rejoin manually.', null, {timeout: 20000});
    const finalConnections = connections;
    await pause(750);
    const settled = await diagnostics();
    assert.equal(connections, finalConnections, 'automatic reconnects must stop after exhaustion');
    assert.equal(finalConnections, 6, 'initial connection plus five recovery attempts must be bounded');
    assert.equal(settled.reconnectActive, false);
    assert.equal(settled.reconnectPending, false);
    assert.equal(settled.connected, false);
    assert.ok(settled.state.players.length <= 1);
    assert.equal(new Set(settled.state.players.map(player => player.id)).size, settled.state.players.length);
    assert.ok(settled.avatars <= 1);
    assert.equal(await page.locator('#network').textContent(), 'OFFLINE');
    assert.equal(await page.locator('#enter').isEnabled(), true);
    assert.equal(errors.length, 0, errors.join('\n'));
    console.log(JSON.stringify({browserEngine, scenario, recoveryConnections: connections, reconnectActive: settled.reconnectActive, reconnectPending: settled.reconnectPending, players: settled.state.players.length, avatars: settled.avatars, manualRejoin: await page.locator('#joinError').textContent(), pageErrors: errors.length}));
  } else {
    await page.waitForFunction(() => window.vibeDiagnostics?.connected);
    for (let i = 0; i < 80 && connections < 2; i++) await pause(50);
    assert.ok(Number.isSafeInteger(droppedRevision), 'fixture must drop one authoritative delta');
    assert.equal(connections, 2, 'skipped delta must trigger one bounded baseline recovery connection');
    assert.equal(recoveryTriggeredAfterRevision, droppedRevision + 1, 'the first noncontiguous delta must trigger recovery without waiting for a periodic full snapshot');
    await page.waitForFunction(() => window.vibeDiagnostics?.connected && Number.isSafeInteger(window.vibeDiagnostics.snapshotRevision));
    const start = await diagnostics();
    await page.keyboard.down('KeyD');
    try {
      await page.waitForFunction(origin => Math.hypot(window.vibeDiagnostics.player.x - origin.x, window.vibeDiagnostics.player.z - origin.z) > 1, {x: start.player.x, z: start.player.z}, {timeout: 5000});
    } finally {
      await page.keyboard.up('KeyD');
    }
    freezeNext = true;
    for (let i = 0; i < 80 && frozenRevision === null; i++) await pause(25);
    assert.ok(Number.isSafeInteger(frozenRevision));
    await page.waitForFunction(revision => window.vibeDiagnostics.snapshotRevision === revision, frozenRevision);
    const settled = await diagnostics();
    assert.equal(connections, 2, 'ordinary single-loss recovery must remain on one replacement connection');
    assert.deepEqual(settled.state, frozenState);
    assert.equal(settled.state.players.length, 1);
    assert.equal(new Set(settled.state.players.map(player => player.id)).size, 1);
    assert.equal(settled.avatars, 1);
    const movement = Math.hypot(settled.player.x - start.player.x, settled.player.z - start.player.z);
    assert.ok(movement > 1);
    assert.equal(errors.length, 0, errors.join('\n'));
    console.log(JSON.stringify({browserEngine, scenario, droppedRevision, recoveryConnections: connections, revision: frozenRevision, players: settled.state.players.length, avatars: settled.avatars, movement, pageErrors: errors.length}));
  }
} finally {
  await browser.close();
  await app.close();
  fs.rmSync(directory, {recursive: true});
}
