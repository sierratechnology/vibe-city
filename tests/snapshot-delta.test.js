import assert from 'node:assert/strict';
import test from 'node:test';
import {Game} from '../server/game.js';
import {
  SNAPSHOT_DELTA_LIMITS,
  acceptSnapshotBaseline,
  applySnapshotDelta,
  createSnapshotDelta,
  createSnapshotSession,
  nextSnapshotPacket,
} from '../server/snapshot-delta.js';
import {parseSnapshotMessage} from '../client/snapshot-delta.js';

function snapshot(overrides = {}) {
  return {
    planet: {version: 1, circumference: 145000, solarDistanceAU: 1.42, rotationSeconds: 1018, daySeconds: 509, nightSeconds: 509},
    settings: {name: 'The Quiet Basin', maxPlayers: 50, pvp: true},
    circumference: 145000,
    monuments: [{id: 'relay', x: 24, z: -24}],
    vehicles: [],
    locks: {s1: {locked: true}},
    seed: 7319,
    time: 1,
    structures: [{id: 's1', type: 'cargo'}],
    containers: {},
    creatures: [],
    resources: [{id: 'p:0', type: 'ferrite', amount: 4}],
    playerCount: 1,
    players: [{id: 'p1', x: 0, z: 3}],
    ...overrides,
  };
}

test('current planet snapshot is accepted, detached, delta-preserved, and exact-key checked', () => {
  const before = snapshot();
  const accepted = acceptSnapshotBaseline(before, 0);
  const after = snapshot({planet: {...before.planet, solarDistanceAU: 1.6, rotationSeconds: 1062, daySeconds: 531, nightSeconds: 531}});
  const delta = createSnapshotDelta(before, after, 0, 1);
  const applied = applySnapshotDelta(accepted, delta, 0);

  assert.deepEqual(Object.keys(delta.changes), ['planet']);
  assert.deepEqual(applied, after);
  before.planet.solarDistanceAU = 99;
  delta.changes.planet.rotationSeconds = 99;
  assert.equal(accepted.planet.solarDistanceAU, 1.42);
  assert.equal(applied.planet.rotationSeconds, 1062);
  assert.throws(() => acceptSnapshotBaseline({...after, mystery: true}, 1), /snapshot field set/);
});

test('two-player viewer snapshot supplies finite remote aim yaw before input', () => {
  const game = new Game();
  const viewer = game.join('viewer', 'Viewer');
  const remote = game.join('remote', 'Remote');
  remote.yaw = 1.25;

  const projected = game.snapshot(viewer.id);
  let accepted;
  assert.doesNotThrow(
    () => { accepted = acceptSnapshotBaseline(projected, 0); },
    'root.players[1].aimYaw must be finite before the snapshot boundary',
  );
  assert.equal(accepted.players[1].aimYaw, remote.yaw);
  assert.equal(Number.isFinite(accepted.players[1].aimYaw), true);
});

test('player snapshots reject private and unknown nested fields without changing accepted state', () => {
  const accepted = snapshot();
  const unchanged = structuredClone(accepted);

  for (const field of ['token', 'save', 'inputAck', 'metadata', 'mystery']) {
    const malformed = snapshot({players: [{...accepted.players[0], [field]: {value: 'private'}}]});
    assert.throws(() => applySnapshotDelta(accepted, {
      type: 'delta', baseRevision: 0, revision: 1, changes: {players: malformed.players},
    }, 0), /Invalid snapshot delta/);
    assert.deepEqual(accepted, unchanged);
  }
});

test('snapshot schemas reject recursive unsafe integers while accepting finite fractional coordinates', () => {
  const accepted = snapshot({players: [{id: 'p1', x: 0.125, z: 3.75}]});
  assert.deepEqual(acceptSnapshotBaseline(accepted, 0), accepted);

  const unchanged = structuredClone(accepted);
  const malformed = snapshot({resources: [{id: 'p:0', type: 'ferrite', amount: Number.MAX_SAFE_INTEGER + 1}]});
  assert.throws(() => applySnapshotDelta(accepted, {
    type: 'delta', baseRevision: 0, revision: 1, changes: {resources: malformed.resources},
  }, 0), /Invalid snapshot delta/);
  assert.deepEqual(accepted, unchanged);
});

test('every authoritative snapshot object shape rejects unknown nested fields', () => {
  const accepted = snapshot();
  const unchanged = structuredClone(accepted);
  const malformedValues = [
    {planet: {...accepted.planet, mystery: true}},
    {settings: {...accepted.settings, mystery: true}},
    {monuments: [{...accepted.monuments[0], mystery: true}]},
    {vehicles: [{id: 'v1', type: 'crawler', x: 2, z: 4, occupants: [], mystery: true}]},
    {locks: {s1: {locked: true, mystery: true}}},
    {structures: [{...accepted.structures[0], mystery: true}]},
    {containers: {s1: {ferrite: 1, mystery: true}}},
    {creatures: [{id: 'c1', type: 'grazer', x: 1, z: 2, mystery: true}]},
    {resources: [{...accepted.resources[0], mystery: true}]},
  ];

  for (const changes of malformedValues) {
    assert.throws(() => applySnapshotDelta(accepted, {
      type: 'delta', baseRevision: 0, revision: 1, changes,
    }, 0), /Invalid snapshot delta/);
    assert.deepEqual(accepted, unchanged);
  }
});

test('snapshot cloning rejects accessors without invoking attacker-controlled getters', () => {
  let getterCalls = 0;
  const player = {id: 'p1', x: 0, z: 3};
  Object.defineProperty(player, 'mystery', {enumerable: true, get() { getterCalls++; return 'private'; }});

  assert.throws(() => acceptSnapshotBaseline(snapshot({players: [player]}), 0), /Invalid snapshot delta/);
  assert.equal(getterCalls, 0);
});

test('baseline rejects a transparent root proxy without changing prior accepted state', () => {
  const accepted = acceptSnapshotBaseline(snapshot(), 0);
  const unchanged = structuredClone(accepted);
  const proxied = new Proxy(snapshot({time: 2}), {});

  assert.throws(() => acceptSnapshotBaseline(proxied, 1), /Invalid snapshot delta/);
  assert.deepEqual(accepted, unchanged);
});

test('baseline rejects a transparent proxy at players zero while preserving accessor safety', () => {
  const accepted = acceptSnapshotBaseline(snapshot(), 0);
  const unchanged = structuredClone(accepted);
  let getterCalls = 0;
  const ordinaryPlayer = {id: 'p1', x: 0, z: 3};
  Object.defineProperty(ordinaryPlayer, 'mystery', {enumerable: true, get() { getterCalls++; return 'private'; }});
  assert.throws(() => acceptSnapshotBaseline(snapshot({players: [ordinaryPlayer]}), 1), /Invalid snapshot delta/);
  assert.equal(getterCalls, 0);

  const proxiedPlayer = new Proxy({id: 'p1', x: 0, z: 3}, {});
  assert.throws(() => acceptSnapshotBaseline(snapshot({players: [proxiedPlayer]}), 1), /Invalid snapshot delta/);
  assert.deepEqual(accepted, unchanged);
});

test('proxy detection exceptions fail closed generically without reading values', () => {
  const revoked = Proxy.revocable(snapshot(), {});
  revoked.revoke();
  assert.throws(
    () => acceptSnapshotBaseline(revoked.proxy, 1),
    error => error instanceof TypeError && error.message === 'Invalid snapshot delta: value rejected',
  );

  let valueReads = 0;
  const player = new Proxy({id: 'p1', x: 0, z: 3}, {
    get(target, key, receiver) {
      valueReads++;
      return Reflect.get(target, key, receiver);
    },
  });
  assert.throws(() => acceptSnapshotBaseline(snapshot({players: [player]}), 1), /Invalid snapshot delta/);
  assert.equal(valueReads, 0);
});

test('delta packets reject accessors before assignment without invoking getters', () => {
  const accepted = snapshot();
  const unchanged = structuredClone(accepted);
  let getterCalls = 0;
  const changes = {};
  Object.defineProperty(changes, 'time', {enumerable: true, get() { getterCalls++; return 2; }});

  assert.throws(() => applySnapshotDelta(accepted, {type: 'delta', baseRevision: 0, revision: 1, changes}, 0), /Invalid snapshot delta/);
  assert.equal(getterCalls, 0);
  assert.deepEqual(accepted, unchanged);
});

test('delta rejects a transparent proxy under changes before assignment', () => {
  const accepted = acceptSnapshotBaseline(snapshot(), 0);
  const unchanged = structuredClone(accepted);
  const changes = new Proxy({time: 2}, {});

  assert.throws(() => applySnapshotDelta(accepted, {
    type: 'delta', baseRevision: 0, revision: 1, changes,
  }, 0), /Invalid snapshot delta/);
  assert.deepEqual(accepted, unchanged);
  assert.equal(JSON.stringify(accepted), JSON.stringify(unchanged));
});

test('built snapshot omits undefined optional structure fields at the server boundary', () => {
  const game = new Game();
  const player = game.join('builder', 'Builder');
  Object.keys(player.inventory).forEach(item => { player.inventory[item] = 100; });
  player.x = 9;
  player.z = 4.5;
  assert.equal(game.action(player.id, {type: 'build', piece: 'floor', x: 9, z: 0, rotation: 0}).ok, true);

  let accepted;
  assert.doesNotThrow(
    () => { accepted = acceptSnapshotBaseline(game.snapshot(player.id), 0); },
    'root.structures[0] must not contain an undefined optional power field',
  );
  assert.equal(Object.hasOwn(accepted.structures[0], 'power'), false);
});

test('legal 4,999-structure world establishes and continues snapshot delivery', () => {
  const game = new Game();
  const player = game.join('builder', 'Builder');
  game.world.structures = Array.from({length: 4999}, (_, index) => ({
    type: 'floor',
    x: index * 3,
    z: 0,
    rotation: 0,
    health: 200,
    id: `s${index + 1}`,
    owner: player.id,
  }));

  let session;
  assert.doesNotThrow(() => { session = createSnapshotSession(game.snapshot(player.id)); });
  game.world.time += 0.1;
  let packet;
  assert.doesNotThrow(() => { packet = nextSnapshotPacket(session, game.snapshot(player.id)); });
  assert.equal(session.state.structures.length, 4999);
  assert.equal(packet.state.structures.length, 4999);
});

test('snapshot delta reconstructs the exact current snapshot within explicit budgets', () => {
  const before = snapshot();
  const after = snapshot({
    time: 1.1,
    vehicles: [{id: 'v1', type: 'crawler', x: 2, z: 4, occupants: []}],
    locks: {s1: {locked: false}},
    players: [{id: 'p1', x: 0.42, z: 3}],
  });

  const delta = createSnapshotDelta(before, after, 4, 5);
  assert.deepEqual(Object.keys(delta.changes).sort(), ['locks', 'players', 'time', 'vehicles']);
  assert.deepEqual(applySnapshotDelta(before, delta, 4), after);
  assert.deepEqual(SNAPSHOT_DELTA_LIMITS, {maxBytes: 2097152, maxDepth: 8, maxKeys: 100000, maxNodes: 120000});

  delta.changes.players[0].x = 99;
  before.resources[0].amount = 0;
  assert.equal(after.players[0].x, 0.42);
  assert.equal(applySnapshotDelta(snapshot(), createSnapshotDelta(snapshot(), after, 4, 5), 4).resources[0].amount, 4);
});

test('malformed, private, stale, skipped, duplicate, unknown and oversized deltas fail closed', () => {
  const accepted = snapshot();
  const unchanged = structuredClone(accepted);
  const valid = createSnapshotDelta(accepted, snapshot({time: 2}), 7, 8);
  const packets = [
    undefined,
    {...valid, revision: 7},
    {...valid, revision: 9},
    {...valid, baseRevision: 6},
    {...valid, baseRevision: Number.MAX_SAFE_INTEGER},
    {...valid, extra: true},
    {...valid, changes: {mystery: []}},
    {...valid, changes: {players: {id: 'not-an-array'}}},
    {...valid, changes: {time: -0}},
    {...valid, changes: {players: [{id: 'p1', x: 0, z: 3, account: 'private-account', role: 'admin'}]}},
    {...valid, changes: {containers: {payload: 'x'.repeat(SNAPSHOT_DELTA_LIMITS.maxBytes)}}},
  ];
  for (const packet of packets) {
    assert.throws(() => applySnapshotDelta(accepted, packet, 7), /Invalid snapshot delta/);
    assert.deepEqual(accepted, unchanged);
  }
});

test('inbound snapshot JSON rejects duplicate envelope keys before parsing', () => {
  const raw = '{"type":"delta","revision":999,"revision":1,"delta":{"baseRevision":0,"revision":1,"changes":{}}}';
  assert.throws(() => parseSnapshotMessage(raw), /Invalid snapshot message/);
});

test('inbound snapshot JSON preserves normal packets and rejects nested duplicates and oversized text', () => {
  const packet = {type: 'delta', delta: {baseRevision: 0, revision: 1, changes: {time: 2}}};
  assert.deepEqual(parseSnapshotMessage(JSON.stringify(packet)), packet);
  assert.throws(() => parseSnapshotMessage('{"type":"delta","delta":{"changes":{"time":999,"time":2}}}'), /Invalid snapshot message/);
  assert.throws(() => parseSnapshotMessage(`{"value":"${'x'.repeat(SNAPSHOT_DELTA_LIMITS.maxBytes)}"}`), /Invalid snapshot message/);
});

test('welcome full-state and delta validation fail before replacing prior accepted state', () => {
  let state = acceptSnapshotBaseline(snapshot(), 0);
  const unchanged = structuredClone(state);
  const malformed = snapshot({players: [{id: 'p1', x: 0, z: 3, metadata: {private: true}}]});

  for (const operation of [
    () => { state = acceptSnapshotBaseline(malformed, 0); },
    () => { state = acceptSnapshotBaseline(malformed, 1); },
    () => { state = applySnapshotDelta(state, {type: 'delta', baseRevision: 0, revision: 1, changes: {players: malformed.players}}, 0); },
  ]) {
    assert.throws(operation, /Invalid snapshot delta/);
    assert.deepEqual(state, unchanged);
  }
});

test('stable-state fixture omits unchanged large collections and is smaller than a full packet', () => {
  const resources = Array.from({length: 200}, (_, index) => ({id: `r${index}`, type: 'ferrite', amount: 4, x: index, z: -(index + 1)}));
  const structures = Array.from({length: 80}, (_, index) => ({id: `s${index}`, type: 'floor', x: index * 3, z: 0}));
  const containers = Object.fromEntries(structures.slice(0, 20).map(item => [item.id, {ferrite: 20}]));
  const before = snapshot({resources, structures, containers});
  const after = snapshot({resources, structures, containers, time: 1.1, players: [{id: 'p1', x: 0.42, z: 3}]});
  const delta = createSnapshotDelta(before, after, 10, 11);
  for (const field of ['resources', 'structures', 'containers']) assert.equal(Object.hasOwn(delta.changes, field), false);
  const deltaPacket = {type: 'delta', delta, inputAck: 4, lastSaved: null};
  const fullPacket = {type: 'state', revision: 11, state: after, inputAck: 4, lastSaved: null};
  assert.ok(Buffer.byteLength(JSON.stringify(deltaPacket)) < Buffer.byteLength(JSON.stringify(fullPacket)));
});
