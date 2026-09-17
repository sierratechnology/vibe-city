import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {browserAccount, startTestServer as startServer} from './auth-helper.js';
import {launchBrowser, resolveBrowserEngine} from './browser-engine.js';
import {createNetworkImpairment} from './network-impairment.js';
import {blocked} from '../shared/world.js';

const browserEngine = process.argv[2] || process.env.BROWSER_ENGINE || 'chromium';
resolveBrowserEngine(browserEngine);
// Authentication, join, and each revision-0 baseline pass through unchanged. Once accepted,
// the seeded profile delays every packet, drops the first eligible delta once to force
// baseline recovery, replays one accepted delta late behind a newer delta, and targets
// movement ordinals 1-3 for loss, reorder, and duplication; all later movement packets
// form the reliable tail.
const profile = Object.freeze({
  seed: 7319,
  latencyMs: 45,
  jitterMs: 0,
  rules: [{
    direction: 'client-to-server',
    className: 'movement-input',
    dropOrdinals: [1],
    reorderOrdinals: [2],
    reorderDelayMs: 120,
    duplicateOrdinals: [3],
  }, {
    direction: 'server-to-client',
    className: 'delta',
    dropOrdinals: [1],
  }, {
    direction: 'server-to-client',
    className: 'stale-delta',
    reorderOrdinals: [1],
    reorderDelayMs: 180,
  }],
  maxQueuedPackets: 64,
  maxDelayedAgeMs: 2000,
  maxTimers: 64,
  teardownDeadlineMs: 1000,
});
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'vibe-latency-loss-'));
const saveFile = path.join(directory, 'world.json');
let app = null;
let port = null;
let browser = null;
const contexts = [];
const pages = [];
const errors = [];
const connections = [[], []];
const impairments = [];
const revisionSamples = [[], []];
const postReconnectRevisionSamples = [[], []];
let report;
let testFailure = null;
const cleanupFailures = [];

const pause = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
const withTimeout = async (description, promise, milliseconds) => {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((resolve, reject) => { timer = setTimeout(() => reject(new Error(`Timed out waiting for ${description}`)), milliseconds); }),
    ]);
  } finally {
    clearTimeout(timer);
  }
};
const waitForListening = server => withTimeout('server listening', new Promise((resolve, reject) => {
  const listening = () => { server.off('error', failed); resolve(); };
  const failed = error => { server.off('listening', listening); reject(error); };
  server.once('listening', listening);
  server.once('error', failed);
}), 5000);
const deadline = async (description, predicate, milliseconds) => {
  const end = Date.now() + milliseconds;
  while (Date.now() < end) {
    const value = await predicate();
    if (value) return value;
    await pause(25);
  }
  throw new Error(`Timed out waiting for ${description}`);
};

function classify(direction, message) {
  if (typeof message !== 'string' || Buffer.byteLength(message) > 2097152) return 'binary';
  try {
    const packet = JSON.parse(message);
    if (!packet || typeof packet !== 'object' || typeof packet.type !== 'string') return 'unknown';
    if (direction === 'client-to-server' && packet.type === 'input' && (packet.x !== 0 || packet.z !== 0)) return 'movement-input';
    return packet.type.slice(0, 64) || 'unknown';
  } catch {
    return 'malformed';
  }
}

function eventMetadata(direction, className, message, eventId) {
  const event = {eventId, direction, className};
  try {
    const packet = JSON.parse(String(message));
    if (Number.isSafeInteger(packet.sequence)) event.sequence = packet.sequence;
    if (Number.isSafeInteger(packet.revision)) event.revision = packet.revision;
    if (Number.isSafeInteger(packet.delta?.baseRevision)) event.baseRevision = packet.delta.baseRevision;
    if (Number.isSafeInteger(packet.delta?.revision)) event.revision = packet.delta.revision;
    if (Number.isFinite(packet.delta?.changes?.time)) event.stateTime = packet.delta.changes.time;
  } catch {}
  return event;
}

async function createClient(index, name) {
  const context = await browser.newContext({viewport: {width: 1440, height: 900}});
  contexts.push(context);
  await context.routeWebSocket(url => url.hostname === '127.0.0.1' && Number(url.port) === port && url.pathname === '/api/ws', route => {
    const previous = connections[index].at(-1);
    if (previous) {
      previous.closed = true;
      void previous.impairment.close();
    }
    const server = route.connectToServer();
    const connectionNumber = connections[index].length;
    const includeDeltaLoss = index === 0 && connectionNumber === 0;
    const includeStaleDeltaReplay = index === 0 && connectionNumber === 1;
    const connectionProfile = {...profile, rules: profile.rules.filter(rule => (
      (rule.className !== 'delta' || includeDeltaLoss)
      && (rule.className !== 'stale-delta' || includeStaleDeltaReplay)
    ))};
    const record = {route, baselines: [], events: [], deliveries: [], profile: connectionProfile, enabled: false, staleReplayQueued: false, closed: false};
    let nextEventId = 1;
    let nextDeliveryOrder = 1;
    const impairment = createNetworkImpairment(connectionProfile, {
      now: Date.now,
      setTimer: setTimeout,
      clearTimer: clearTimeout,
      deliver(packet) {
        record.deliveries.push({
          ...eventMetadata(packet.direction, classify(packet.direction, packet.payload), packet.payload, null),
          impairmentClassName: packet.className,
          deliveryOrder: nextDeliveryOrder++,
        });
        if (packet.direction === 'client-to-server') server.send(packet.payload);
        else route.send(packet.payload);
      },
    });
    record.impairment = impairment;
    connections[index].push(record);
    impairments.push(impairment);
    route.onMessage(message => {
      if (impairment.closed) return;
      const direction = 'client-to-server';
      const className = classify(direction, message);
      record.events.push(eventMetadata(direction, className, message, nextEventId++));
      if (record.events.length > 512) record.events.shift();
      if (record.enabled) impairment.enqueue({direction, className, payload: message});
      else server.send(message);
    });
    server.onMessage(message => {
      if (impairment.closed) return;
      const direction = 'server-to-client';
      const className = classify(direction, message);
      record.events.push(eventMetadata(direction, className, message, nextEventId++));
      if (record.events.length > 512) record.events.shift();
      if (className === 'welcome') {
        const packet = JSON.parse(String(message));
        record.baselines.push({id: packet.id, revision: packet.revision});
      }
      if (!record.enabled) route.send(message);
      else if (includeStaleDeltaReplay && className === 'delta' && !record.staleReplayQueued) {
        record.staleReplayQueued = true;
        impairment.enqueue({direction, className, payload: message});
        impairment.enqueue({direction, className: 'stale-delta', payload: message});
      } else impairment.enqueue({direction, className, payload: message});
    });
  });
  const page = await context.newPage();
  pages.push(page);
  page.on('pageerror', error => errors.push({client: index + 1, message: error.message}));
  page.setDefaultTimeout(10000);
  page.setDefaultNavigationTimeout(10000);
  await page.goto(`http://127.0.0.1:${port}`);
  await browserAccount(page, name);
  await page.locator('#enter').click();
  await page.waitForFunction(() => window.vibeDiagnostics?.connected && Number.isSafeInteger(window.vibeDiagnostics.snapshotRevision), null, {timeout: 10000});
  connections[index][0].enabled = true;
  return page;
}

const diagnostics = page => page.evaluate(() => window.vibeDiagnostics);
const movementEvents = record => record.events.filter(event => event.direction === 'client-to-server' && event.className === 'movement-input');
const deltaEvents = record => record.events.filter(event => event.direction === 'server-to-client' && event.className === 'delta');
const staleDeltaPair = record => {
  const deliveries = record.deliveries.filter(event => event.direction === 'server-to-client' && event.className === 'delta');
  for (let index = 1; index < deliveries.length; index++) {
    const stale = deliveries[index];
    const newer = deliveries.slice(0, index).findLast(event => event.revision > stale.revision);
    if (newer) return {stale, newer};
  }
  return null;
};
const hasPrivateKey = value => {
  const privateKeys = new Set(['account', 'role', 'email', 'emailVerified', 'verificationToken', 'password', 'passwordHash', 'session', 'sessionToken', 'cookie', 'admin', 'inputAck']);
  const stack = [value];
  while (stack.length) {
    const current = stack.pop();
    if (!current || typeof current !== 'object') continue;
    for (const [key, nested] of Object.entries(current)) {
      if (privateKeys.has(key)) return true;
      stack.push(nested);
    }
  }
  return false;
};

try {
  app = startServer({port: 0, host: '127.0.0.1', saveFile});
  await waitForListening(app.server);
  port = app.server.address().port;
  browser = await withTimeout('browser launch', launchBrowser(browserEngine), 15000);
  const first = await withTimeout('first authenticated client', createClient(0, 'Latency Pilot'), 30000);
  const second = await withTimeout('second authenticated client', createClient(1, 'Loss Observer'), 30000);
  assert.deepEqual(connections.map(items => items[0]?.baselines[0]?.revision), [0, 0], 'both clients must receive a revision-0 baseline');
  try {
    await deadline('delta-loss baseline recovery', () => connections[0].length === 2 && connections[0][1].baselines.length === 1, 8000);
  } catch (error) {
    throw new Error(`${error.message}: ${JSON.stringify({diagnostics: await diagnostics(first), connections: connections[0].map(record => ({baselines: record.baselines, events: record.events, enabled: record.enabled, closed: record.closed, stats: record.impairment.stats}))})}`);
  }
  await first.waitForFunction(() => window.vibeDiagnostics?.connected && Number.isSafeInteger(window.vibeDiagnostics.snapshotRevision), null, {timeout: 8000});
  const deltaLossRecord = connections[0][0];
  const staleReplayRecord = connections[0][1];
  const lostDeltaEvents = deltaEvents(deltaLossRecord);
  assert.equal(deltaLossRecord.impairment.stats.dropped, 1, 'the selected eligible delta must be dropped exactly once');
  assert.ok(lostDeltaEvents.length >= 1, 'the selected dropped packet must be a revisioned delta');
  assert.equal(staleReplayRecord.baselines[0].revision, 0, 'delta loss must recover through a fresh revision-0 baseline');
  assert.equal(staleReplayRecord.baselines[0].id, deltaLossRecord.baselines[0].id, 'delta recovery must preserve character identity');
  staleReplayRecord.enabled = true;
  let acceptedBeforeStale;
  await deadline('newer delta acceptance before stale delivery', async () => {
    const deliveries = deltaEvents({events: staleReplayRecord.deliveries});
    const replayedRevision = deliveries[0]?.revision;
    const newerDelivery = deliveries.find(event => event.revision > replayedRevision);
    if (!newerDelivery || deliveries.some(event => event.impairmentClassName === 'stale-delta')) return false;
    const accepted = await diagnostics(first);
    if (accepted.snapshotRevision < newerDelivery.revision) return false;
    acceptedBeforeStale = accepted;
    return true;
  }, 3000);
  await deadline('stale delta rejection and baseline recovery', () => connections[0].length === 3 && connections[0][2].baselines.length === 1, 8000);
  const staleDelivery = staleDeltaPair(staleReplayRecord);
  assert.ok(staleDelivery, 'an older server delta must be delivered after a newer server delta');
  assert.equal(staleReplayRecord.impairment.stats.reordered, 1, 'the stale server delta replay must exercise configured reordering');
  const preReconnectRecord = connections[0][2];
  assert.equal(preReconnectRecord.baselines[0].revision, 0, 'stale delta rejection must recover through a fresh revision-0 baseline');
  assert.equal(preReconnectRecord.baselines[0].id, deltaLossRecord.baselines[0].id, 'stale delta recovery must preserve character identity');
  const acceptedAfterStale = await diagnostics(first);
  assert.ok(Number.isSafeInteger(acceptedAfterStale.snapshotRevision), 'stale delta recovery must establish a valid accepted revision');
  assert.ok(acceptedBeforeStale.snapshotRevision >= staleDelivery.newer.revision, 'the newer server delta must be accepted before stale delivery');
  assert.ok(acceptedAfterStale.state.time >= acceptedBeforeStale.state.time, 'a stale delivered delta must not replace newer accepted state');
  preReconnectRecord.enabled = true;
  const initial = await diagnostics(first);
  const observerInitial = await diagnostics(second);
  assert.notEqual(initial.id, observerInitial.id);
  app.game.world.structures.push({id: 'impairment-wall', type: 'perimeter', x: 3, z: 3, rotation: 1, owner: initial.id});
  await deadline('collision fixture replication', async () => {
    const [firstState, secondState] = await Promise.all([diagnostics(first), diagnostics(second)]);
    return firstState.state.structures.some(structure => structure.id === 'impairment-wall')
      && secondState.state.structures.some(structure => structure.id === 'impairment-wall');
  }, 3000);

  const startAuthoritative = {...app.game.world.players[initial.id]};
  const firstMovementStartedAt = Date.now();
  await first.keyboard.down('KeyD');
  try {
    try {
      await deadline('impaired movement and configured events', async () => {
        const current = await diagnostics(first);
        revisionSamples[0].push(current.snapshotRevision);
        const stats = preReconnectRecord.impairment.stats;
        return current.player.x > initial.player.x + 3.5 && stats.dropped >= 1 && stats.reordered >= 1 && stats.duplicated >= 1;
      }, 8000);
    } catch (error) {
      const current = await diagnostics(first);
      const authority = app.game.world.players[initial.id];
      throw new Error(`${error.message}: ${JSON.stringify({
        connectionCount: connections[0].length,
        impairmentStats: impairments.map(impairment => impairment.stats),
        movementDelta: {
          clientX: current.player.x - initial.player.x,
          authoritativeX: authority.x - startAuthoritative.x,
        },
        revision: current.snapshotRevision,
        inputAck: current.inputAck,
        pendingInputs: current.pendingInputs,
      })}`);
    }
  } finally {
    await first.keyboard.up('KeyD');
  }
  const firstMovementSeconds = (Date.now() - firstMovementStartedAt) / 1000;
  const firstMovementDistance = Math.hypot(app.game.world.players[initial.id].x - startAuthoritative.x, app.game.world.players[initial.id].z - startAuthoritative.z);
  assert.ok(firstMovementDistance <= firstMovementSeconds * 6.5 + 0.5, 'first movement epoch must retain the server speed ceiling');
  const preReconnectMovements = movementEvents(preReconnectRecord);
  assert.ok(preReconnectMovements.length > 3, 'a reliable movement tail must follow the three selected impaired packets');
  const lastPreReconnectMovement = preReconnectMovements.at(-1).sequence;
  await deadline('reliable movement tail acknowledgement', async () => (await diagnostics(first)).inputAck >= lastPreReconnectMovement, 3000);
  await deadline('authoritative convergence', async () => {
    const authority = app.game.world.players[initial.id];
    const [firstState, secondState] = await Promise.all([diagnostics(first), diagnostics(second)]);
    revisionSamples[0].push(firstState.snapshotRevision);
    revisionSamples[1].push(secondState.snapshotRevision);
    const firstPlayer = firstState.state.players.find(player => player.id === initial.id);
    const secondPlayer = secondState.state.players.find(player => player.id === initial.id);
    if (!firstPlayer || !secondPlayer) return false;
    return Math.hypot(firstPlayer.x - authority.x, firstPlayer.z - authority.z) <= 0.2
      && Math.hypot(secondPlayer.x - authority.x, secondPlayer.z - authority.z) <= 0.2
      && firstState.pendingInputs <= 32;
  }, 8000);
  const collisionAuthority = app.game.world.players[initial.id];
  assert.ok(collisionAuthority.x > initial.player.x + 3.5, 'server must accept valid movement up to the collision boundary');
  assert.equal(blocked(app.game.world, collisionAuthority.x, collisionAuthority.z), false, 'server must not place the player inside collision geometry');
  assert.equal(blocked(app.game.world, collisionAuthority.x + 0.5, collisionAuthority.z), true, 'server movement must stop at the configured collision boundary');

  const beforeInterruption = await diagnostics(first);
  const preInterruptionAck = beforeInterruption.inputAck;
  assert.ok(Number.isSafeInteger(preInterruptionAck));
  const oldRevision = beforeInterruption.snapshotRevision;
  const connectionCountsBeforeRestart = connections.map(records => records.length);
  const interruptedAt = Date.now();
  await withTimeout('initial server shutdown', app.close(), 5000);
  await Promise.allSettled(connections.map((records, index) => withTimeout(`client ${index + 1} transport interruption`, records.at(-1).route.close({code: 1012, reason: 'bounded test interruption'}), 2000)));
  app = null;
  await deadline('both clients to observe the bounded outage', async () => {
    const [firstState, secondState] = await Promise.all([diagnostics(first), diagnostics(second)]);
    return !firstState.connected && !secondState.connected;
  }, 2000);
  app = startServer({port, host: '127.0.0.1', saveFile});
  await waitForListening(app.server);
  try {
    await deadline('reconnect baselines', () => connections.every((records, index) => records.length === connectionCountsBeforeRestart[index] + 1 && records.at(-1).baselines.length === 1), 8000);
  } catch (error) {
    const current = await diagnostics(first);
    throw new Error(`${error.message}: ${JSON.stringify({
      connectionCount: connections[0].length,
      connections: connections[0].map(record => ({baselines: record.baselines, events: record.events, closed: record.closed, stats: record.impairment.stats})),
      connected: current.connected,
      revision: current.snapshotRevision,
      inputAck: current.inputAck,
      pendingInputs: current.pendingInputs,
    })}`);
  }
  await Promise.all([
    first.waitForFunction(() => window.vibeDiagnostics?.connected && Number.isSafeInteger(window.vibeDiagnostics.snapshotRevision), null, {timeout: 8000}),
    second.waitForFunction(() => window.vibeDiagnostics?.connected && Number.isSafeInteger(window.vibeDiagnostics.snapshotRevision), null, {timeout: 8000}),
  ]);
  const postReconnectRecord = connections[0].at(-1);
  postReconnectRecord.enabled = true;
  connections[1].at(-1).enabled = true;
  const reconnectMs = Date.now() - interruptedAt;
  const reconnected = await diagnostics(first);
  assert.equal(postReconnectRecord.baselines[0].revision, 0, 'replacement transport must receive a fresh baseline epoch');
  assert.equal(postReconnectRecord.baselines[0].id, initial.id, 'character identity must survive reconnect');
  assert.equal(reconnected.id, initial.id);
  assert.ok(reconnected.pendingInputs <= 32, 'replacement epoch must reset into the bounded pending-input window');

  const reconnectStartX = app.game.world.players[initial.id].x;
  const reconnectStartAuthority = {...app.game.world.players[initial.id]};
  const secondMovementStartedAt = Date.now();
  await first.keyboard.down('KeyA');
  try {
    await deadline('post-reconnect authoritative movement', () => app.game.world.players[initial.id].x < reconnectStartX - 1, 8000);
  } finally {
    await first.keyboard.up('KeyA');
  }
  const secondMovementSeconds = (Date.now() - secondMovementStartedAt) / 1000;
  const secondMovementDistance = Math.hypot(app.game.world.players[initial.id].x - reconnectStartAuthority.x, app.game.world.players[initial.id].z - reconnectStartAuthority.z);
  assert.ok(secondMovementDistance <= secondMovementSeconds * 6.5 + 0.5, 'replacement movement epoch must retain the server speed ceiling');
  const postReconnectMovements = movementEvents(postReconnectRecord);
  assert.ok(postReconnectMovements.length > 3, 'replacement transport must also include a reliable movement tail');
  const lastPostReconnectMovement = postReconnectMovements.at(-1).sequence;
  await deadline('post-reconnect reliable tail acknowledgement', async () => (await diagnostics(first)).inputAck >= lastPostReconnectMovement, 3000);
  await deadline('post-reconnect convergence', async () => {
    const authority = app.game.world.players[initial.id];
    const [firstState, secondState] = await Promise.all([diagnostics(first), diagnostics(second)]);
    postReconnectRevisionSamples[0].push(firstState.snapshotRevision);
    postReconnectRevisionSamples[1].push(secondState.snapshotRevision);
    const firstPlayer = firstState.state.players.find(player => player.id === initial.id);
    const secondPlayer = secondState.state.players.find(player => player.id === initial.id);
    return firstPlayer && secondPlayer
      && Math.hypot(firstPlayer.x - authority.x, firstPlayer.z - authority.z) <= 0.2
      && Math.hypot(secondPlayer.x - authority.x, secondPlayer.z - authority.z) <= 0.2
      && firstState.pendingInputs <= 32;
  }, 8000);

  const finalAuthority = app.game.world.players[initial.id];
  const [finalFirst, finalSecond] = await Promise.all([diagnostics(first), diagnostics(second)]);
  postReconnectRevisionSamples[0].push(finalFirst.snapshotRevision);
  postReconnectRevisionSamples[1].push(finalSecond.snapshotRevision);
  const finalFirstPlayer = finalFirst.state.players.find(player => player.id === initial.id);
  const finalSecondPlayer = finalSecond.state.players.find(player => player.id === initial.id);
  const firstError = Math.hypot(finalFirstPlayer.x - finalAuthority.x, finalFirstPlayer.z - finalAuthority.z);
  const secondError = Math.hypot(finalSecondPlayer.x - finalAuthority.x, finalSecondPlayer.z - finalAuthority.z);
  const authoritativeDistance = Math.hypot(finalAuthority.x - startAuthoritative.x, finalAuthority.z - startAuthoritative.z);
  assert.ok(Number.isSafeInteger(finalFirst.inputAck) && finalFirst.inputAck < preInterruptionAck, 'reconnect must reset the input sequence epoch');
  assert.ok(finalFirst.pendingInputs <= 32);
  assert.ok(finalSecond.pendingInputs <= 32);
  assert.equal(hasPrivateKey(finalFirst.state), false, 'shared state must omit private and acknowledgement fields');
  assert.equal(hasPrivateKey(finalSecond.state), false, 'observer state must omit private and acknowledgement fields');
  assert.equal(errors.length, 0, errors.map(error => error.message).join('\n'));
  assert.ok(revisionSamples[0].every((revision, index, values) => index === 0 || revision >= values[index - 1]), 'accepted revisions must not regress before the forced epoch reset');
  for (const samples of postReconnectRevisionSamples) {
    assert.ok(samples.every((revision, index, values) => index === 0 || revision >= values[index - 1]), 'accepted revisions must not regress in the replacement epoch');
  }
  assert.ok(oldRevision > 0);
  for (const record of [preReconnectRecord, postReconnectRecord]) {
    assert.ok(record.impairment.stats.dropped >= 1 && record.impairment.stats.reordered >= 1 && record.impairment.stats.duplicated >= 1, 'each movement epoch must exercise the selected drop, reorder, and duplicate');
  }
  for (const record of connections.flat()) {
    for (const event of deltaEvents(record)) assert.equal(event.revision, event.baseRevision + 1, `delta event ${event.eventId} must have a valid base`);
  }

  const impairmentTotals = impairments.reduce((totals, impairment) => {
    for (const key of Object.keys(totals)) totals[key] += impairment.stats[key];
    return totals;
  }, {dropped: 0, duplicated: 0, reordered: 0, expired: 0, delivered: 0});
  const files = fs.readdirSync(directory).sort();
  assert.deepEqual(files, ['accounts.json', 'world.json']);
  report = {
    browserEngine,
    conditions: 'local deterministic synthetic impairment; not production or real-WAN evidence',
    profile,
    impairmentTotals,
    clients: 2,
    revisionZeroBaselines: connections.map(records => records.flatMap(record => record.baselines).filter(item => item.revision === 0).length),
    reconnectMs,
    reconnectConnections: connections[0].length,
    deltaRecovery: {
      droppedEventId: lostDeltaEvents[0].eventId,
      droppedRevision: lostDeltaEvents[0].revision,
      recoveryBaselineRevision: staleReplayRecord.baselines[0].revision,
    },
    staleDeltaRejection: {
      staleRevision: staleDelivery.stale.revision,
      staleDeliveryOrder: staleDelivery.stale.deliveryOrder,
      newerRevision: staleDelivery.newer.revision,
      newerDeliveryOrder: staleDelivery.newer.deliveryOrder,
      acceptedRevisionBeforeStale: acceptedBeforeStale.snapshotRevision,
      acceptedStateTimeBeforeStale: acceptedBeforeStale.state.time,
      acceptedRevisionAfterRecovery: acceptedAfterStale.snapshotRevision,
      acceptedStateTimeAfterRecovery: acceptedAfterStale.state.time,
      recoveryBaselineRevision: preReconnectRecord.baselines[0].revision,
    },
    finalRevision: [finalFirst.snapshotRevision, finalSecond.snapshotRevision],
    finalInputAck: finalFirst.inputAck,
    finalPendingInputs: [finalFirst.pendingInputs, finalSecond.pendingInputs],
    acknowledgedMovementTail: [lastPreReconnectMovement, lastPostReconnectMovement],
    movementEventSchedule: [preReconnectRecord, postReconnectRecord].map(record => movementEvents(record).slice(0, 6)),
    speedChecks: [
      {seconds: firstMovementSeconds, distance: firstMovementDistance},
      {seconds: secondMovementSeconds, distance: secondMovementDistance},
    ],
    finalPositionError: [firstError, secondError],
    authoritativeDistance,
    pageErrors: errors.length,
    privateLeakage: false,
    saveFiles: files,
  };
} catch (error) {
  testFailure = error;
} finally {
  const collectCleanup = results => cleanupFailures.push(...results.filter(result => result.status === 'rejected').map(result => result.reason));
  collectCleanup(await Promise.allSettled(impairments.map(impairment => Promise.resolve().then(() => impairment.close()))));
  collectCleanup(await Promise.allSettled(contexts.map(context => Promise.resolve().then(() => withTimeout('browser context shutdown', context.close(), 5000)))));
  if (browser) collectCleanup(await Promise.allSettled([Promise.resolve().then(() => withTimeout('browser shutdown', browser.close(), 5000))]));
  if (app) collectCleanup(await Promise.allSettled([Promise.resolve().then(() => withTimeout('server shutdown', app.close(), 5000))]));
  try {
    fs.rmSync(directory, {recursive: true, force: true});
  } catch (error) {
    cleanupFailures.push(error);
  }
}

if (browser?.isConnected()) cleanupFailures.push(new Error('Browser remained connected after cleanup'));
if (app?.server.listening) cleanupFailures.push(new Error('Server remained listening after cleanup'));
if (fs.existsSync(directory)) cleanupFailures.push(new Error('Temporary directory remained after cleanup'));
if (impairments.some(impairment => impairment.pendingCount !== 0)) cleanupFailures.push(new Error('Impairment timers remained after cleanup'));
if (testFailure) {
  if (cleanupFailures.length) testFailure.cause = new AggregateError(cleanupFailures, 'Cleanup also failed');
  throw testFailure;
}
if (cleanupFailures.length) throw new AggregateError(cleanupFailures, 'Latency/loss test cleanup failed');
report.cleanup = {browserDisconnected: true, serverListening: false, temporaryDirectoryRemoved: true};
console.log(JSON.stringify(report));
