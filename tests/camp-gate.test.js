import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Game} from '../server/game.js';
import {clearPath} from '../shared/ecology.js';
import {rooms} from '../shared/rooms.js';
import {loadWorld, saveWorld} from '../server/persistence.js';
import {RECIPES, VERSION, blocked, interactionTarget, makeWorld, placementError, sheltered} from '../shared/world.js';

const gate = (rotation = 0, x = 9, z = 0) => ({type: 'campGate', x, z, rotation});

test('Camp gate domain uses freestanding physical edges without shelter or wall-light semantics', () => {
  assert.deepEqual(RECIPES.campGate, {
    name: 'Camp gate',
    cost: {ferrite: 3, fiber: 1},
    description: 'Freestanding perimeter opening. Operate toggles it. R rotates its edge.'
  });
  for (let rotation = 0; rotation < 4; rotation++) {
    const world = makeWorld();
    const player = {x: 9, z: 4.5, unlocked: false};
    assert.equal(placementError(world, player, gate(rotation)), '', `rotation ${rotation}`);
    world.structures.push({...gate(rotation), id: `gate-${rotation}`, open: false});
    assert.equal(sheltered(world, {x: 9, z: 0}), false);
    assert.equal(rooms(world)[0]?.sealed ?? false, false);
    assert.match(placementError(world, player, {type: 'lamp', x: 9, z: 0, rotation}), /wall/i);
  }
  for (const occupiedType of ['perimeter', 'wall', 'doorway', 'door', 'airlock', 'stairs', 'railing', 'campGate']) {
    const world = makeWorld();
    world.structures.push({id: 'edge', type: occupiedType, x: 9, z: 0, rotation: 1});
    assert.match(placementError(world, {x: 9, z: 4.5}, gate(1)), /occupied/i, occupiedType);
  }
  const neighboring = makeWorld();
  neighboring.structures.push({id: 'neighbor-edge', type: 'perimeter', x: 12, z: 0, rotation: 3});
  assert.match(placementError(neighboring, {x: 9, z: 4.5}, gate(1)), /edge is occupied/i);
});

test('Camp gate authority persists operation collision ownership and exact refunds', () => {
  const game = new Game();
  const owner = game.join('builder', 'Builder');
  const visitor = game.join('visitor', 'Visitor');
  game.world.resources = [];
  game.world.creatures = [];
  Object.assign(owner, {x: 9, z: 2});
  Object.assign(visitor, {x: 9, z: 2});
  Object.assign(owner.inventory, {ferrite: 3, fiber: 1});
  const beforeProgress = {unlocked: owner.unlocked, completed: owner.completed};
  assert.deepEqual(game.action(owner.id, {type: 'build', piece: 'campGate', x: 9, z: 0, rotation: 0}), {ok: true, message: 'Camp gate constructed.'});
  assert.deepEqual({ferrite: owner.inventory.ferrite, fiber: owner.inventory.fiber}, {ferrite: 0, fiber: 0});
  const placed = game.world.structures.at(-1);
  assert.deepEqual(placed, {type: 'campGate', x: 9, z: 0, rotation: 0, health: 200, open: false, id: 's1', owner: owner.id});
  assert.deepEqual({unlocked: owner.unlocked, completed: owner.completed}, beforeProgress);
  assert.equal(sheltered(game.world, owner), false);
  assert.equal(rooms(game.world)[0]?.sealed ?? false, false);
  assert.equal(blocked(game.world, 9, -1.5), true);
  assert.equal(clearPath(game.world, {x: 9, z: -2.5}, {x: 9, z: -.5}), false);
  assert.deepEqual(interactionTarget(game.world, visitor), {type: 'campGate', id: placed.id});

  for (const request of [null, {type: 'campGate'}, {type: 'campGate', id: 3}, {type: 'campGate', id: placed.id, extra: true}, {type: 'campGate', id: 'missing'}]) {
    const before = structuredClone(game.world);
    assert.equal(game.action(visitor.id, request).ok, false);
    assert.deepEqual(game.world, before);
  }
  visitor.x = 40;
  const distantBefore = structuredClone(game.world);
  assert.equal(game.action(visitor.id, {type: 'campGate', id: placed.id}).ok, false);
  assert.deepEqual(game.world, distantBefore);
  Object.assign(visitor, {x: 9, z: 2});
  assert.deepEqual(game.action(visitor.id, {type: 'campGate', id: placed.id}), {ok: true, message: 'Camp gate open.'});
  assert.equal(placed.open, true);
  assert.equal(blocked(game.world, 9, -1.5), false);
  assert.equal(clearPath(game.world, {x: 9, z: -2.5}, {x: 9, z: -.5}), true);

  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'vibe-camp-gate-'));
  try {
    const file = path.join(directory, 'world.json');
    saveWorld(file, game.world);
    const restored = new Game(loadWorld(file, 999));
    assert.equal(VERSION, 1);
    assert.deepEqual(restored.world.structures.at(-1), placed);
    assert.equal(restored.snapshot(owner.id).structures.at(-1).open, true);
  } finally {
    fs.rmSync(directory, {recursive: true});
  }

  assert.equal(game.snapshot(visitor.id).structures.at(-1).canDismantle, undefined);
  assert.equal(game.action(visitor.id, {type: 'dismantle', id: placed.id}).ok, false);
  game.tick(.3);
  assert.equal(game.action(owner.id, {type: 'dismantle', id: placed.id}).ok, true);
  assert.deepEqual({ferrite: owner.inventory.ferrite, fiber: owner.inventory.fiber}, {ferrite: 3, fiber: 1});
});

test('Camp gate catalog renderer and accessible operation expose local stateful geometry', () => {
  const client = fs.readFileSync(new URL('../client/main.js', import.meta.url), 'utf8');
  assert.match(client, /const pieces=\[[^\n]*'campGate'/);
  assert.match(client, /materials=\{[^\n]*campGate:/);
  const renderer = client.match(/else if\(piece\.type==='campGate'\)\{(?<body>.*?)\}else if\(piece\.type===/s)?.groups.body;
  assert.ok(renderer, 'Camp gate needs an explicit renderer branch');
  assert.match(renderer, /\[-1,1\]/, 'two posts are rendered');
  assert.match(renderer, /piece\.open/, 'the leaf geometry changes with accepted open state');
  assert.doesNotMatch(renderer, /fetch|https?:|TextureLoader|load\(/);
  assert.match(client, /function updateHUD\(\)\{const p=me\(\);if\(!p\)return;const action=contextAction\(state,p,\{buildMode,reclaimMode,yaw\}\);.*?\$\('gatherAction'\)\.textContent=action\?\.label\|\|'Action';.*?\$\('interaction'\)\.textContent=buildMode\?'':action\?`\[E\] \$\{readableActionLabel\(state,action\)\}`:/s);
  assert.match(client, /vibeCampGateDiagnostics/);
  assert.match(client, /rotation:structure\.rotation/);
});
