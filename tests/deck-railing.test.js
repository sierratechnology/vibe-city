import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Game} from '../server/game.js';
import {clearPath} from '../shared/ecology.js';
import {rooms} from '../shared/rooms.js';
import {createSnapshotSession, nextSnapshotPacket} from '../server/snapshot-delta.js';
import {loadWorld, saveWorld} from '../server/persistence.js';
import {RECIPES, VERSION, blocked, makeWorld, placementError, sheltered} from '../shared/world.js';

const deck = (x = 9, z = 0) => ({id: 'deck', type: 'floor', x, z, rotation: 0, owner: 'builder'});
const railing = (rotation = 0, x = 9, z = 0) => ({type: 'railing', x, z, rotation});

test('Deck railing domain uses supported Deck edges without shelter or wall semantics', () => {
  assert.deepEqual(RECIPES.railing, {
    name: 'Deck railing',
    cost: {ferrite: 1},
    description: 'A low barrier on a supported Deck edge. R rotates to another edge.'
  });
  for (let rotation = 0; rotation < 4; rotation++) {
    const world = makeWorld();
    const player = {x: 9, z: 4.5, unlocked: false};
    assert.match(placementError(world, player, railing(rotation)), /deck/i);
    world.structures.push(deck());
    assert.equal(placementError(world, player, railing(rotation)), '', `rotation ${rotation}`);
    world.structures.push({...railing(rotation), id: `rail-${rotation}`});
    assert.equal(sheltered(world, {x: 9, z: 0}), false);
    assert.equal(rooms(world)[0].sealed, false);
    assert.match(placementError(world, player, {type: 'lamp', x: 9, z: 0, rotation}), /wall/i);
  }
  for (const occupiedType of ['wall', 'doorway', 'door', 'airlock', 'perimeter', 'stairs', 'railing']) {
    const world = makeWorld();
    world.structures.push(deck(), {id: 'edge', type: occupiedType, x: 9, z: 0, rotation: 1});
    assert.match(placementError(world, {x: 9, z: 4.5}, railing(1)), /occupied/i, occupiedType);
  }
  const neighboring = makeWorld();
  neighboring.structures.push(deck(), {id: 'neighbor-edge', type: 'wall', x: 12, z: 0, rotation: 3});
  assert.match(placementError(neighboring, {x: 9, z: 4.5}, railing(1)), /edge is occupied/i);
});

test('Deck railing follows authoritative payment persistence collision and dismantling paths', () => {
  const game = new Game();
  const owner = game.join('builder', 'Builder');
  const visitor = game.join('visitor', 'Visitor');
  game.world.resources = [];
  game.world.creatures = [];
  Object.assign(owner, {x: 9, z: 4.5});
  Object.assign(visitor, {x: 9, z: 4.5});
  owner.inventory.ferrite = 3;
  game.world.structures.push(deck());
  const beforeProgress = {unlocked: owner.unlocked, completed: owner.completed};
  assert.deepEqual(game.action(owner.id, {type: 'build', piece: 'railing', x: 9, z: 0, rotation: 0}), {
    ok: true,
    message: 'Deck railing constructed.'
  });
  assert.equal(owner.inventory.ferrite, 2);
  const placed = game.world.structures.at(-1);
  assert.deepEqual(placed, {type: 'railing', x: 9, z: 0, rotation: 0, health: 200, id: 's1', owner: owner.id});
  assert.deepEqual({unlocked: owner.unlocked, completed: owner.completed}, beforeProgress);
  assert.equal(sheltered(game.world, owner), false);
  assert.equal(blocked(game.world, 9, -1.5), true, 'player collision blocks the railing edge');
  assert.equal(clearPath(game.world, {x: 9, z: -2.5}, {x: 9, z: -.5}), false, 'creatures cannot cross the railing edge');
  assert.equal(game.snapshot(visitor.id).structures.at(-1).canDismantle, undefined);

  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'vibe-deck-railing-'));
  try {
    const file = path.join(directory, 'world.json');
    saveWorld(file, game.world);
    const restoredWorld = loadWorld(file, 999);
    assert.equal(VERSION, 1);
    assert.equal(restoredWorld.version, 1);
    const restored = new Game(restoredWorld);
    const session = createSnapshotSession(restored.snapshot(owner.id));
    restored.world.time += .1;
    const packet = nextSnapshotPacket(session, restored.snapshot(owner.id));
    assert.deepEqual(restored.world.structures.at(-1), placed);
    assert.deepEqual(session.state.structures.at(-1), restored.snapshot(owner.id).structures.at(-1));
    assert.ok(packet.type === 'state' || packet.type === 'delta');
  } finally {
    fs.rmSync(directory, {recursive: true});
  }

  const beforeRejected = structuredClone(game.world);
  assert.equal(game.action(visitor.id, {type: 'dismantle', id: placed.id}).ok, false);
  assert.deepEqual(game.world, beforeRejected);
  game.tick(1);
  assert.equal(game.action(owner.id, {type: 'dismantle', id: placed.id}).ok, true);
  assert.equal(owner.inventory.ferrite, 3);
  assert.equal(game.world.structures.some(structure => structure.id === placed.id), false);
  game.tick(1);
  const beforeMalformed = structuredClone(game.world);
  for (const request of [
    {type: 'build', piece: 'unknown', x: 9, z: 0, rotation: 0},
    {type: 'build', piece: 'railing', x: 9, z: 0, rotation: 4},
    {type: 'build', piece: 'railing', x: '9', z: 0, rotation: 0}
  ]) assert.equal(game.action(owner.id, request).ok, false);
  assert.deepEqual(game.world, beforeMalformed);
});

test('Deck railing catalog and renderer expose bounded open orientation-matched geometry', () => {
  const client = fs.readFileSync(new URL('../client/main.js', import.meta.url), 'utf8');
  assert.match(client, /const pieces=\[[^\n]*'railing'/);
  assert.match(client, /materials=\{[^\n]*railing:/);
  const renderer = client.match(/else if\(piece\.type==='railing'\)\{(?<body>.*?)\}else if\(piece\.type===/s)?.groups.body;
  assert.ok(renderer, 'Deck railing needs an explicit renderer branch');
  assert.match(renderer, /\[-1,1\]/, 'two posts are rendered');
  assert.match(renderer, /\[\.38,\.82\]/, 'two open horizontal rails are rendered');
  assert.doesNotMatch(renderer, /fetch|https?:|TextureLoader|load\(/);
  assert.match(client, /renderedRailings=.*pieceType==='railing'/);
  assert.match(client, /previewRailing=selected==='railing'/);
  assert.match(client, /rotation:structure\.rotation/);
});
