import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {WebSocket} from 'ws';
import {applySnapshotDelta} from '../client/snapshot-delta.js';
import {FULL_SNAPSHOT_INTERVAL, createSnapshotSession, nextSnapshotPacket} from '../server/snapshot-delta.js';
import {apiAccount, startTestServer} from './auth-helper.js';

function inbox(ws) {
  const queued = [];
  const waiting = [];
  ws.on('message', raw => {
    const message = JSON.parse(raw);
    const match = waiting.findIndex(waiter => waiter.predicate(message));
    if (match >= 0) waiting.splice(match, 1)[0].resolve(message);
    else queued.push(message);
  });
  return predicate => {
    const match = queued.findIndex(predicate);
    if (match >= 0) return Promise.resolve(queued.splice(match, 1)[0]);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Timed out waiting for snapshot packet')), 2500);
      waiting.push({predicate, resolve: value => { clearTimeout(timer); resolve(value); }});
    });
  };
}

async function connect(base, account) {
  const ws = new WebSocket(base.replace('http:', 'ws:'), {headers: {Cookie: account.cookie}});
  const next = inbox(ws);
  await new Promise((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });
  ws.send(JSON.stringify({type: 'join', character: account.character}));
  const welcome = await next(message => message.type === 'welcome');
  return {ws, next, welcome};
}

async function advance(connection, until) {
  let state = structuredClone(connection.welcome.state);
  let revision = connection.welcome.revision;
  for (;;) {
    const packet = await connection.next(message => message.type === 'delta' || message.type === 'state');
    if (packet.type === 'delta') state = applySnapshotDelta(state, packet.delta, revision);
    else state = structuredClone(packet.state);
    revision = packet.type === 'delta' ? packet.delta.revision : packet.revision;
    if (until(packet)) return {packet, state, revision};
  }
}

function publicSnapshot(snapshot) {
  const copy = structuredClone(snapshot);
  for (const player of copy.players) {
    delete player.account;
    delete player.role;
  }
  return copy;
}

test('local sessions receive exact current-world deltas with private acknowledgement and account isolation', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'vibe-delta-server-'));
  const app = startTestServer({port: 0, host: '127.0.0.1', saveFile: path.join(directory, 'world.json')});
  const packetTimeStates = new Map();
  const snapshot = app.game.snapshot.bind(app.game);
  app.game.snapshot = viewer => {
    const state = snapshot(viewer);
    if (!packetTimeStates.has(viewer)) packetTimeStates.set(viewer, []);
    packetTimeStates.get(viewer).push(publicSnapshot(state));
    return state;
  };
  await new Promise(resolve => app.server.once('listening', resolve));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const sockets = [];
  try {
    const first = await connect(base, await apiAccount(base, 'delta-a'));
    const second = await connect(base, await apiAccount(base, 'delta-b'));
    sockets.push(first.ws, second.ws);
    assert.equal(first.welcome.revision, 0);
    assert.equal(second.welcome.revision, 0);
    for (const player of first.welcome.state.players) {
      assert.equal(Object.hasOwn(player, 'account'), false);
      assert.equal(Object.hasOwn(player, 'role'), false);
    }

    first.ws.send(JSON.stringify({type: 'input', sequence: 3, x: 1, z: 0}));
    const [firstResult, secondResult] = await Promise.all([
      advance(first, packet => packet.type === 'delta' && packet.inputAck === 3),
      advance(second, packet => packet.type === 'delta'),
    ]);
    assert.equal(firstResult.packet.inputAck, 3);
    assert.equal(secondResult.packet.inputAck, null);
    assert.equal(Object.hasOwn(firstResult.state, 'inputAck'), false);
    assert.equal(Object.hasOwn(firstResult.state, 'lastSaved'), false);
    assert.deepEqual(firstResult.state, packetTimeStates.get(first.welcome.id)[firstResult.revision]);
    assert.deepEqual(secondResult.state, packetTimeStates.get(second.welcome.id)[secondResult.revision]);
    for (const field of ['settings', 'circumference', 'monuments', 'resources', 'structures', 'containers']) {
      assert.equal(Object.hasOwn(firstResult.packet.delta.changes, field), false);
    }
  } finally {
    for (const ws of sockets) ws.terminate();
    await app.close();
    fs.rmSync(directory, {recursive: true});
  }
});

test('snapshot sessions force a deterministic periodic full baseline', () => {
  const state = snapshotFixture();
  const session = createSnapshotSession(state);
  let packet;
  for (let revision = 1; revision <= FULL_SNAPSHOT_INTERVAL + 1; revision++) {
    packet = nextSnapshotPacket(session, {...state, time: revision / 10});
    assert.equal(packet.type, revision === 1 || revision === FULL_SNAPSHOT_INTERVAL + 1 ? 'state' : 'delta');
  }
  assert.equal(packet.revision, FULL_SNAPSHOT_INTERVAL + 1);
});

function snapshotFixture() {
  return {
    planet: {version: 1, circumference: 145000, solarDistanceAU: 1.42, rotationSeconds: 1018, daySeconds: 509, nightSeconds: 509},
    settings: {name: 'The Quiet Basin', maxPlayers: 50}, circumference: 145000,
    monuments: [], vehicles: [], locks: {}, seed: 7319, time: 0, structures: [],
    containers: {}, creatures: [], resources: [], playerCount: 0, players: [],
  };
}
