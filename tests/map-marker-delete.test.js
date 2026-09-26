import assert from 'node:assert/strict';
import test from 'node:test';
import {Game} from '../server/game.js';
import {acceptSnapshotBaseline, applySnapshotDelta, createSnapshotDelta} from '../server/snapshot-delta.js';
import {VERSION} from '../shared/world.js';

test('marker creation accepts only name and records the server-accepted position', () => {
  const game = new Game();
  const player = game.join('explorer', 'Explorer');
  player.x = 12.5;
  player.z = -8.25;

  assert.deepEqual(game.action(player.id, {type: 'marker', name: '  Ridge  '}), {
    ok: true,
    message: 'Map marker saved.',
  });
  assert.deepEqual(player.markers, [{x: 12.5, z: -8.25, name: 'Ridge'}]);

  assert.equal(game.action(player.id, {type: 'marker', name: 'Bad', x: 1, z: 2}).ok, false);
  assert.deepEqual(player.markers, [{x: 12.5, z: -8.25, name: 'Ridge'}]);
});

test('owner snapshot supplies an opaque revision that deletes exactly one current marker', () => {
  const game = new Game();
  const player = game.join('explorer', 'Explorer');
  game.join('neighbor', 'Neighbor');
  game.action(player.id, {type: 'marker', name: 'First'});
  player.x = 9;
  game.action(player.id, {type: 'marker', name: 'Second'});

  const owner = game.snapshot(player.id).players.find(candidate => candidate.id === player.id);
  const remote = game.snapshot('neighbor').players.find(candidate => candidate.id === player.id);
  assert.match(owner.markerRevision, /^[a-f0-9]{64}$/);
  assert.equal(owner.markerRevision.includes('First'), false);
  assert.equal(Object.hasOwn(remote, 'markers'), false);
  assert.equal(Object.hasOwn(remote, 'markerRevision'), false);

  const request = {type: 'markerDelete', revision: owner.markerRevision, index: 0};
  assert.deepEqual(game.action(player.id, request), {ok: true, message: 'Map marker deleted.'});
  assert.deepEqual(player.markers, [{x: 9, z: 3, name: 'Second'}]);
  assert.equal(game.action(player.id, request).ok, false);
  assert.deepEqual(player.markers, [{x: 9, z: 3, name: 'Second'}]);
  assert.notEqual(game.snapshot(player.id).players.find(candidate => candidate.id === player.id).markerRevision, owner.markerRevision);
});

test('private marker revisions survive validated baseline and delta transitions', () => {
  const game = new Game();
  const player = game.join('explorer', 'Explorer');
  const before = game.snapshot(player.id);
  game.action(player.id, {type: 'marker', name: 'Camp'});
  const after = game.snapshot(player.id);

  const accepted = acceptSnapshotBaseline(before, 0);
  const applied = applySnapshotDelta(accepted, createSnapshotDelta(before, after, 0, 1), 0);
  assert.deepEqual(applied, after);
  assert.notEqual(
    applied.players.find(candidate => candidate.id === player.id).markerRevision,
    before.players.find(candidate => candidate.id === player.id).markerRevision,
  );
});

test('marker deletion rejects every non-exact request shape without mutation', () => {
  const game = new Game();
  const player = game.join('explorer', 'Explorer');
  game.action(player.id, {type: 'marker', name: 'Camp'});
  const revision = game.snapshot(player.id).players[0].markerRevision;
  const failure = {ok: false, message: 'Map marker changed. Refresh the map and try again.'};
  const requests = [
    {type: 'markerDelete', revision, index: 0, extra: true},
    {type: 'markerDelete', revision},
    {type: 'markerDelete', revision: '0'.repeat(64), index: 0},
    {type: 'markerDelete', revision, index: -1},
    {type: 'markerDelete', revision, index: 1},
    {type: 'markerDelete', revision, index: 30},
    {type: 'markerDelete', revision, index: 0.5},
    {type: 'markerDelete', revision, index: NaN},
    {type: 'markerDelete', revision, index: Infinity},
    {type: 'markerDelete', revision, index: '0'},
    {type: 'markerDelete', revision, index: Number.MAX_SAFE_INTEGER + 1},
    {type: 'markerDelete', revision: revision.toUpperCase(), index: 0},
    Object.assign({type: 'markerDelete', revision, index: 0}, {[Symbol('extra')]: true}),
    Object.assign(Object.create(null), {type: 'markerDelete', revision, index: 0}),
    Object.assign(Object.create({inherited: true}), {type: 'markerDelete', revision, index: 0}),
    Object.freeze({type: 'markerDelete', revision, index: 0}),
    new Proxy({type: 'markerDelete', revision, index: 0}, {}),
  ];

  for (const request of requests) {
    assert.deepEqual(game.action(player.id, request), failure);
    assert.deepEqual(player.markers, [{x: 0, z: 3, name: 'Camp'}]);
  }
});

test('offline marker deletion uses the same generic failure without mutation', () => {
  const game = new Game();
  const player = game.join('explorer', 'Explorer');
  game.action(player.id, {type: 'marker', name: 'Camp'});
  const revision = game.snapshot(player.id).players[0].markerRevision;
  game.leave(player.id);

  assert.deepEqual(
    game.action(player.id, {type: 'markerDelete', revision, index: 0}),
    {ok: false, message: 'Map marker changed. Refresh the map and try again.'},
  );
  assert.deepEqual(player.markers, [{x: 0, z: 3, name: 'Camp'}]);
});

test('marker operations fail closed for malformed saved marker arrays', () => {
  const failure = {ok: false, message: 'Map marker changed. Refresh the map and try again.'};
  const malformed = [
    new Array(1),
    new Proxy([], {}),
    Array.from({length: 31}, () => ({x: 0, z: 3, name: 'Camp'})),
    Object.defineProperty([], '0', {get() { throw Error('must not run'); }, enumerable: true, configurable: true}),
  ];

  for (const markers of malformed) {
    const game = new Game();
    const player = game.join('explorer', 'Explorer');
    player.markers = markers;
    assert.deepEqual(game.action(player.id, {type: 'markerDelete', revision: '0'.repeat(64), index: 0}), failure);
    assert.equal(game.action(player.id, {type: 'marker', name: 'Camp'}).ok, false);
    assert.equal(player.markers, markers);
  }
});

test('malformed saved marker descriptors fail closed without projection or mutation', () => {
  const game = new Game();
  const player = game.join('explorer', 'Explorer');
  const marker = {x: 0, z: 3, [Symbol('name')]: 'Camp'};
  player.markers = [marker];

  const projected = game.snapshot(player.id).players[0];
  assert.equal(Object.hasOwn(projected, 'markers'), false);
  assert.equal(Object.hasOwn(projected, 'markerRevision'), false);
  assert.deepEqual(
    game.action(player.id, {type: 'markerDelete', revision: '0'.repeat(64), index: 0}),
    {ok: false, message: 'Map marker changed. Refresh the map and try again.'},
  );
  assert.deepEqual(player.markers, [marker]);
});

test('private projection ignores non-enumerable and stored derived player fields', () => {
  const game = new Game();
  const player = game.join('explorer', 'Explorer');
  let getterCalls = 0;
  Object.defineProperty(player, 'hiddenPrivateState', {value: 'secret'});
  Object.defineProperty(player, 'derivedTrap', {get() { getterCalls++; return 'secret'; }});
  player.markerRevision = '0'.repeat(64);

  const projected = game.snapshot(player.id).players[0];

  assert.equal(getterCalls, 0);
  assert.equal(Object.hasOwn(projected, 'hiddenPrivateState'), false);
  assert.equal(Object.hasOwn(projected, 'derivedTrap'), false);
  assert.notEqual(projected.markerRevision, player.markerRevision);
});

test('marker creation trims, defaults, bounds names, and rejects every non-exact shape', () => {
  const game = new Game();
  const player = game.join('explorer', 'Explorer');
  const invalid = {ok: false, message: 'Invalid marker or marker limit reached.'};

  assert.equal(game.action(player.id, {type: 'marker', name: '   '}).ok, true);
  assert.equal(game.action(player.id, {type: 'marker', name: 'x'.repeat(32)}).ok, true);
  assert.deepEqual(game.action(player.id, {type: 'marker', name: 'x'.repeat(33)}), invalid);
  assert.deepEqual(game.action(player.id, {type: 'marker', name: 'Bad', x: 0}), invalid);
  assert.deepEqual(game.action(player.id, Object.freeze({type: 'marker', name: 'Bad'})), invalid);
  assert.deepEqual(player.markers, [
    {x: 0, z: 3, name: 'Waypoint'},
    {x: 0, z: 3, name: 'x'.repeat(32)},
  ]);
});

test('successful deletion releases one version-one marker slot without changing stored shape', () => {
  const game = new Game();
  const player = game.join('explorer', 'Explorer');
  for (let index = 0; index < 30; index++) {
    assert.equal(game.action(player.id, {type: 'marker', name: `M${index}`}).ok, true);
  }
  assert.equal(game.action(player.id, {type: 'marker', name: 'Overflow'}).ok, false);
  const revision = game.snapshot(player.id).players[0].markerRevision;
  assert.equal(game.action(player.id, {type: 'markerDelete', revision, index: 12}).ok, true);
  player.x = 4;
  player.z = 5;
  assert.equal(game.action(player.id, {type: 'marker', name: 'Replacement'}).ok, true);

  assert.equal(game.world.version, VERSION);
  assert.equal(VERSION, 1);
  assert.equal(Object.hasOwn(player, 'markerRevision'), false);
  assert.equal(player.markers.length, 30);
  assert.deepEqual(player.markers.at(-1), {x: 4, z: 5, name: 'Replacement'});
  assert.equal(player.markers.every(marker => Object.keys(marker).sort().join(',') === 'name,x,z'), true);
});

test('marker revisions are deterministic for exact ordered content and opaque to raw values', () => {
  const first = new Game();
  const second = new Game();
  const firstPlayer = first.join('first', 'First');
  const secondPlayer = second.join('second', 'Second');
  for (const [name, x, z] of [['North camp', 2, -8], ['Ridge', 7, 11]]) {
    Object.assign(firstPlayer, {x, z});
    Object.assign(secondPlayer, {x, z});
    first.action(firstPlayer.id, {type: 'marker', name});
    second.action(secondPlayer.id, {type: 'marker', name});
  }
  const firstRevision = first.snapshot(firstPlayer.id).players[0].markerRevision;
  const secondRevision = second.snapshot(secondPlayer.id).players[0].markerRevision;

  assert.equal(firstRevision, secondRevision);
  assert.equal(firstRevision.includes('North camp'), false);
  assert.equal(firstRevision.includes('-8'), false);
  firstPlayer.markers.reverse();
  assert.notEqual(first.snapshot(firstPlayer.id).players[0].markerRevision, firstRevision);
});

test('marker deletion is isolated to the acting current character and private projections', () => {
  const game = new Game();
  const owner = game.join('owner', 'Owner');
  const neighbor = game.join('neighbor', 'Neighbor');
  game.action(owner.id, {type: 'marker', name: 'Owner camp'});
  game.action(neighbor.id, {type: 'marker', name: 'Neighbor camp'});
  const ownerRevision = game.snapshot(owner.id).players.find(player => player.id === owner.id).markerRevision;

  assert.equal(game.action(neighbor.id, {type: 'markerDelete', revision: ownerRevision, index: 0}).ok, false);
  assert.deepEqual(neighbor.markers, [{x: 0, z: 3, name: 'Neighbor camp'}]);
  assert.equal(game.action(owner.id, {type: 'markerDelete', revision: ownerRevision, index: 0}).ok, true);
  assert.deepEqual(owner.markers, []);
  const ownerSeenByNeighbor = game.snapshot(neighbor.id).players.find(player => player.id === owner.id);
  assert.equal(Object.hasOwn(ownerSeenByNeighbor, 'markers'), false);
  assert.equal(Object.hasOwn(ownerSeenByNeighbor, 'markerRevision'), false);
});

test('ordinary marker deletion cannot alter the immutable coral-shelf first contact', () => {
  const game = new Game();
  const player = game.join('explorer', 'Explorer');
  player.discoveredBiomes.push('coral-shelf');
  player.firstBiomeContacts['coral-shelf'] = {x: 101, z: -202};
  game.action(player.id, {type: 'marker', name: 'Disposable'});
  const revision = game.snapshot(player.id).players[0].markerRevision;

  assert.equal(game.action(player.id, {type: 'markerDelete', revision, index: 0}).ok, true);
  assert.deepEqual(player.firstBiomeContacts, {'coral-shelf': {x: 101, z: -202}});
  assert.deepEqual(game.snapshot(player.id).players[0].firstBiomeContacts, {'coral-shelf': {x: 101, z: -202}});
});
