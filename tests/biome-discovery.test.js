import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {Game} from '../server/game.js';
import {loadWorld, saveWorld} from '../server/persistence.js';
import {frameRoom, joinRoom, leaveRoom} from '../server/cloud-room.js';
import {transaction} from '../server/cloud-store.js';
import {classifyBiome} from '../shared/planet.js';

const CORAL_SHELF_POINT = Object.freeze({x: 5000, z: -33250});

test('authoritative simulation discovers Quiet Basin then Coral Shelf exactly once', () => {
  const game = new Game();
  const player = game.join('explorer', 'Explorer');

  assert.equal(classifyBiome(player.x, player.z, game.world.seed).id, 'quiet-basin');
  game.tick(0.05);
  assert.deepEqual(player.discoveredBiomes, ['quiet-basin']);

  player.x = CORAL_SHELF_POINT.x;
  player.z = CORAL_SHELF_POINT.z;
  assert.equal(classifyBiome(player.x, player.z, game.world.seed).id, 'coral-shelf');
  game.tick(0.05);
  game.tick(0.05);

  assert.deepEqual(player.discoveredBiomes, ['quiet-basin', 'coral-shelf']);
});

test('legacy biome discovery state normalizes to a bounded allowlisted plain list without invoking accessors', () => {
  const base = new Game();
  base.join('explorer', 'Explorer');
  const saved = structuredClone(base.world);
  const cases = [
    {value: ['quiet-basin', 'quiet-basin'], expected: ['quiet-basin']},
    {value: ['quiet-basin', 'coral-shelf'], expected: ['quiet-basin', 'coral-shelf']},
    {value: ['quiet-basin', 'unknown-biome'], expected: []},
    {value: ['quiet-basin', 'coral-shelf', 'quiet-basin'], expected: []},
    {value: [17], expected: []},
    {value: Object.assign(Object.create(null), {0: 'quiet-basin', length: 1}), expected: []},
  ];
  const sparse = ['quiet-basin'];
  sparse.length = 2;
  cases.push({value: sparse, expected: []});
  const proxied = new Proxy(['quiet-basin'], {});
  cases.push({value: proxied, expected: []});
  let getterCalls = 0;
  const accessor = [];
  Object.defineProperty(accessor, 0, {enumerable: true, get() { getterCalls++; return 'quiet-basin'; }});
  accessor.length = 1;
  cases.push({value: accessor, expected: []});

  for (const {value, expected} of cases) {
    const world = structuredClone(saved);
    world.players.explorer.discoveredBiomes = value;
    let restored;
    assert.doesNotThrow(() => { restored = new Game(world); });
    assert.deepEqual(restored.world.players.explorer.discoveredBiomes, expected);
  }
  assert.equal(getterCalls, 0);
});

test('discovered biomes survive local save reload and cloud reconnect without crossing characters', async () => {
  const game = new Game();
  const explorer = game.join('explorer', 'Explorer');
  const neighbor = game.join('neighbor', 'Neighbor');
  game.tick(0.05);
  explorer.x = CORAL_SHELF_POINT.x;
  explorer.z = CORAL_SHELF_POINT.z;
  game.tick(0.05);

  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'vibe-biome-discovery-'));
  const saveFile = path.join(directory, 'world.json');
  try {
    saveWorld(saveFile, game.world);
    const restored = new Game(loadWorld(saveFile, game.world.seed));
    assert.deepEqual(restored.world.players.explorer.discoveredBiomes, ['quiet-basin', 'coral-shelf']);
    assert.deepEqual(restored.world.players.neighbor.discoveredBiomes, ['quiet-basin']);
  } finally {
    fs.rmSync(directory, {recursive: true});
  }

  class Store {
    raw = null;
    async read() { return this.raw; }
    async compareAndSet(before, after) {
      if (this.raw !== before) return false;
      this.raw = after;
      return true;
    }
  }
  const store = new Store();
  await transaction(store, room => {
    room.world = structuredClone(game.world);
    return joinRoom(room, {id: 'explorer', session: 'first', name: 'Explorer'});
  });
  await transaction(store, room => leaveRoom(room, 'explorer', 'first'));
  const rejoined = await transaction(store, room => joinRoom(room, {id: 'explorer', session: 'second', name: 'Explorer'}));
  const own = rejoined.result.state.players.find(player => player.id === 'explorer');
  const other = rejoined.result.state.players.find(player => player.id === 'neighbor');
  assert.deepEqual(own.discoveredBiomes, ['quiet-basin', 'coral-shelf']);
  assert.equal(other, undefined);

  const framed = await transaction(store, room => frameRoom(room, [{id: 'explorer', session: 'second', input: null}], []));
  assert.deepEqual(framed.result.states.explorer.players.find(player => player.id === 'explorer').discoveredBiomes, ['quiet-basin', 'coral-shelf']);
});
