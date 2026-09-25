import test from 'node:test';
import assert from 'node:assert/strict';
import fs, {readFileSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {RECIPES, VERSION, blocked, makeWorld, placementError, shape} from '../shared/world.js';
import {rooms} from '../shared/rooms.js';
import {Game} from '../server/game.js';
import {loadWorld, saveWorld} from '../server/persistence.js';
import {clearPath} from '../shared/ecology.js';

const deck = (x = 9) => ({id: `deck-${x}`, type: 'floor', x, z: 0, rotation: 0, owner: 'builder'});
const windowed = (rotation = 0, x = 9) => ({type: 'windowedBulkhead', x, z: 0, rotation});
const player = {id: 'builder', x: 9, z: 4.5, unlocked: false};
const clientSource = readFileSync(new URL('../client/main.js', import.meta.url), 'utf8');

test('Windowed bulkhead has stable catalog identity and exact recipe', () => {
  assert.deepEqual(RECIPES.windowedBulkhead, {
    name: 'Windowed bulkhead',
    cost: {ferrite: 2},
    description: 'A full-height sealed barrier with a transparent visual-only pane. R rotates to another edge.',
  });
});

test('Windowed bulkhead occupies four supported Deck edges and conflicts symmetrically with every whole-edge type', () => {
  const unsupported = makeWorld();
  unsupported.resources = [];
  assert.match(placementError(unsupported, player, windowed()), /deck/i);
  assert.deepEqual([0, 1, 2, 3].map(rotation => {
    const edge = shape(windowed(rotation), 7319);
    return [edge.x, edge.z, edge.w, edge.d, edge.h];
  }), [[9, -1.5, 3, .18, 2.6], [10.5, 0, .18, 3, 2.6], [9, 1.5, 3, .18, 2.6], [7.5, 0, .18, 3, 2.6]]);
  for (const type of ['wall', 'doorway', 'door', 'airlock', 'perimeter', 'campGate', 'stairs', 'railing', 'deckGate', 'windowedBulkhead']) {
    for (const [existing, candidate] of [
      [{id: 'edge', type, x: 9, z: 0, rotation: 1}, windowed(1)],
      [{id: 'edge', ...windowed(1)}, {type, x: 9, z: 0, rotation: 1}],
      [{id: 'edge', type, x: 12, z: 0, rotation: 3}, windowed(1)],
      [{id: 'edge', ...windowed(1)}, {type, x: 12, z: 0, rotation: 3}],
    ]) {
      const world = makeWorld();
      world.resources = [];
      world.structures.push(deck(), deck(12), existing);
      assert.match(placementError(world, player, candidate), /occupied/i, `${type} must conflict symmetrically`);
    }
  }
});

test('Windowed bulkhead seals a room edge and supports a Wall lumen exactly like Bulkhead', () => {
  const world = makeWorld();
  world.resources = [];
  world.structures.push(deck(), {id: 'roof', type: 'roof', x: 9, z: 0, rotation: 0, owner: 'builder'});
  for (const rotation of [1, 2, 3]) world.structures.push({id: `wall-${rotation}`, type: 'wall', x: 9, z: 0, rotation, owner: 'builder'});
  world.structures.push({id: 'window', ...windowed(0), owner: 'builder'});
  assert.equal(rooms(world)[0].sealed, true);
  assert.equal(placementError(world, player, {type: 'lamp', x: 9, z: 0, rotation: 0}), '');
});

test('Windowed bulkhead server build rejects non-exact requests before mutation', () => {
  const game = new Game();
  const owner = game.join('builder', 'Builder');
  Object.assign(owner, {x: 9, z: 4.5});
  owner.inventory.ferrite = 2;
  game.world.resources = [];
  game.world.creatures = [];
  game.world.structures.push(deck());
  const before = structuredClone(game.world);
  assert.equal(game.action(owner.id, {type: 'build', piece: 'windowedBulkhead', x: 9, z: 0, rotation: 0, extra: true}).ok, false);
  assert.deepEqual(game.world, before);
});

test('Windowed bulkhead frame and pane block explorers, creatures, shared paths, and attacks', () => {
  const world = makeWorld();
  world.resources = [];
  world.structures.push(deck(), {id: 'window', ...windowed(0), owner: 'builder'});
  assert.equal(blocked(world, 9, -1.5), true);
  assert.equal(clearPath(world, {x: 9, z: -3}, {x: 9, z: 0}), false);
  const game = new Game(world);
  const attacker = game.join('attacker', 'Attacker');
  Object.assign(attacker, {x: 9, z: -3, rifle: true});
  attacker.inventory.crystal = 1;
  game.world.creatures = [{id: 'creature', type: 'grazer', x: 9, z: 0, health: 30, respawnAt: 0}];
  assert.equal(game.action(attacker.id, {type: 'attack', id: 'creature', ranged: true}).ok, false);
  assert.equal(game.world.creatures[0].health, 30);
});

test('Client exposes named Windowed bulkhead controls and bounded opaque-frame transparent-pane geometry', () => {
  assert.match(clientSource, /const pieces=\[[^\]]*'windowedBulkhead'/);
  assert.match(clientSource, /piece\.type==='windowedBulkhead'[\s\S]*windowed-bulkhead-frame[\s\S]*windowed-bulkhead-pane/);
  assert.match(clientSource, /windowedBulkheadPane:mat\([^\n]*transparent:true[^\n]*depthWrite:false/);
  assert.doesNotMatch(clientSource, /assets\/windowed|fetch\([^)]*windowed|openWindowed|breakWindowed|windowedBulkheadHealth/);
});

test('Windowed bulkhead inherits version-one save, snapshot, authorization, capacity, and exact-once refund behavior', () => {
  const game = new Game();
  const owner = game.join('builder', 'Builder');
  const visitor = game.join('visitor', 'Visitor');
  Object.assign(owner, {x: 9, z: 2});
  Object.assign(visitor, {x: 9, z: 2});
  game.world.resources = [];
  game.world.structures.push(deck(), {id: 'window', ...windowed(0), health: 200, owner: owner.id});
  game.world.nextStructure = 2;
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'vibe-windowed-save-'));
  let restored;
  try {
    const file = path.join(directory, 'world.json');
    saveWorld(file, game.world);
    restored = new Game(loadWorld(file, 999));
  } finally {
    fs.rmSync(directory, {recursive: true, force: true});
  }
  assert.equal(VERSION, 1);
  assert.deepEqual(restored.snapshot(owner.id).structures.find(structure => structure.id === 'window'), {
    id: 'window', type: 'windowedBulkhead', x: 9, z: 0, rotation: 0, health: 200, owner: owner.id, canDismantle: true, dismantleGrantedTo: [],
  });
  const restoredOwner = restored.join(owner.id, owner.name);
  restored.join(visitor.id, visitor.name);
  const beforeUnauthorized = structuredClone(restored.world);
  assert.equal(restored.action(visitor.id, {type: 'dismantle', id: 'window'}).ok, false);
  assert.deepEqual(restored.world, beforeUnauthorized);
  restoredOwner.inventory.meat = 59;
  const beforeFull = structuredClone(restored.world);
  assert.equal(restored.action(owner.id, {type: 'dismantle', id: 'window'}).ok, false);
  assert.deepEqual(restored.world, beforeFull);
  restoredOwner.inventory.meat = 0;
  assert.equal(restored.action(owner.id, {type: 'dismantle', id: 'window'}).ok, true);
  assert.equal(restoredOwner.inventory.ferrite, 2);
  assert.equal(restored.world.structures.some(structure => structure.id === 'window'), false);
  assert.equal(restored.action(owner.id, {type: 'dismantle', id: 'window'}).ok, false);
  assert.equal(restoredOwner.inventory.ferrite, 2);
});
