import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Game} from '../server/game.js';

const clientSource = readFileSync(new URL('../client/main.js', import.meta.url), 'utf8');
import {clearPath} from '../shared/ecology.js';
import {rooms} from '../shared/rooms.js';
import {createSnapshotSession, nextSnapshotPacket} from '../server/snapshot-delta.js';
import {loadWorld, saveWorld} from '../server/persistence.js';
import * as contextActions from '../shared/context-action.js';
import {RECIPES, VERSION, blocked, interactionTarget, makeWorld, placementError, shape, sheltered} from '../shared/world.js';

const {contextAction} = contextActions;

const deck = (x = 9, z = 0) => ({id: 'deck', type: 'floor', x, z, rotation: 0, owner: 'builder'});
const gate = (rotation = 0, x = 9, z = 0) => ({type: 'deckGate', x, z, rotation});
const player = (x = 9, z = 4.5) => ({id: 'builder', x, z, unlocked: false});
const supportedWorld = () => {
  const world = makeWorld();
  world.resources = [];
  world.structures.push(deck());
  return world;
};
const deckGateGame = ({x = 9, z = 4.5, ferrite = 2, fiber = 1} = {}) => {
  const game = new Game();
  const owner = game.join('builder', 'Builder');
  Object.assign(owner, {x, z});
  Object.assign(owner.inventory, {ferrite, fiber});
  game.world.resources = [];
  game.world.creatures = [];
  game.world.structures.push(deck());
  return {game, owner};
};
const symmetricEdgeResults = occupiedType => {
  const cases = [
    {existing: {id: 'occupied', type: occupiedType, x: 9, z: 0, rotation: 1}, candidate: gate(1), decks: [deck()]},
    {existing: {...gate(1), id: 'occupied'}, candidate: {type: occupiedType, x: 9, z: 0, rotation: 1}, decks: [deck()]},
    {existing: {id: 'occupied', type: occupiedType, x: 12, z: 0, rotation: 3}, candidate: gate(1), decks: [deck(), deck(12)]},
    {existing: {...gate(1), id: 'occupied'}, candidate: {type: occupiedType, x: 12, z: 0, rotation: 3}, decks: [deck(), deck(12)]},
  ];
  return cases.map(({existing, candidate, decks}) => {
    const world = makeWorld();
    world.resources = [];
    world.structures.push(...decks, existing);
    return /occupied/i.test(placementError(world, player(), candidate));
  });
};

test('Deck gate has stable catalog identity and exact recipe', () => {
  assert.deepEqual(RECIPES.deckGate, {
    name: 'Deck gate',
    cost: {ferrite: 2, fiber: 1},
    description: 'A low operable gate on a supported Deck edge. R rotates to another edge.',
  });
});

test('Deck gate requires a supported Deck edge', () => {
  const world = makeWorld();
  world.resources = [];
  assert.match(placementError(world, player(), gate()), /deck/i);
  world.structures.push(deck());
  assert.equal(placementError(world, player(), gate()), '');
});

test('Deck gate rotation 0 occupies the north edge', () => {
  const edge = shape(gate(0), 7319);
  assert.deepEqual({x: edge.x, z: edge.z, w: edge.w, d: edge.d, h: edge.h}, {x: 9, z: -1.5, w: 3, d: .18, h: 2.6});
});

test('Deck gate rotation 1 occupies the east edge', () => {
  const edge = shape(gate(1), 7319);
  assert.deepEqual({x: edge.x, z: edge.z, w: edge.w, d: edge.d, h: edge.h}, {x: 10.5, z: 0, w: .18, d: 3, h: 2.6});
});

test('Deck gate rotation 2 occupies the south edge', () => {
  const edge = shape(gate(2), 7319);
  assert.deepEqual({x: edge.x, z: edge.z, w: edge.w, d: edge.d, h: edge.h}, {x: 9, z: 1.5, w: 3, d: .18, h: 2.6});
});

test('Deck gate rotation 3 occupies the west edge', () => {
  const edge = shape(gate(3), 7319);
  assert.deepEqual({x: edge.x, z: edge.z, w: edge.w, d: edge.d, h: edge.h}, {x: 7.5, z: 0, w: .18, d: 3, h: 2.6});
});

test('Deck gate same-edge duplicate is a pre-existing generic conflict invariant', () => {
  const world = supportedWorld();
  world.structures.push({...gate(1), id: 'first'});
  assert.match(placementError(world, player(), gate(1)), /occupied/i);
});

test('Deck gates may occupy different free edges of one Deck', () => {
  const world = supportedWorld();
  world.structures.push({...gate(1), id: 'east'});
  assert.equal(placementError(world, player(), gate(3)), '');
});

test('Opposite-neighbor Deck gates conflict on one physical edge', () => {
  const world = makeWorld();
  world.resources = [];
  world.structures.push(deck(), deck(12), {...gate(3, 12, 0), id: 'west-neighbor'});
  assert.match(placementError(world, player(), gate(1)), /occupied/i);
});

test('Deck gate and Bulkhead conflict symmetrically on one physical edge', () => {
  assert.deepEqual(symmetricEdgeResults('wall'), [true, true, true, true]);
});

test('Deck gate and Doorway frame conflict symmetrically on one physical edge', () => {
  assert.deepEqual(symmetricEdgeResults('doorway'), [true, true, true, true]);
});

test('Deck gate and Sealed door conflict symmetrically on one physical edge', () => {
  assert.deepEqual(symmetricEdgeResults('door'), [true, true, true, true]);
});

test('Deck gate and Airlock door conflict symmetrically on one physical edge', () => {
  assert.deepEqual(symmetricEdgeResults('airlock'), [true, true, true, true]);
});

test('Deck gate and Camp barrier conflict symmetrically on one physical edge', () => {
  assert.deepEqual(symmetricEdgeResults('perimeter'), [true, true, true, true]);
});

test('Deck gate and Camp gate conflict symmetrically on one physical edge', () => {
  assert.deepEqual(symmetricEdgeResults('campGate'), [true, true, true, true]);
});

test('Deck gate and Deck stair conflict symmetrically on one physical edge', () => {
  assert.deepEqual(symmetricEdgeResults('stairs'), [true, true, true, true]);
});

test('Deck gate and Deck railing conflict symmetrically on one physical edge', () => {
  assert.deepEqual(symmetricEdgeResults('railing'), [true, true, true, true]);
});

test('Deck gate placement rejects an explorer occupying its edge', () => {
  assert.match(placementError(supportedWorld(), player(), gate(0), [{x: 9, z: -1.5}]), /player/i);
});

test('Deck gate placement rejects an ungathered resource occupying its edge', () => {
  const world = supportedWorld();
  world.resources = [{id: 'ore', type: 'ferrite', x: 9, z: -1.5, amount: 1}];
  assert.match(placementError(world, player(), gate(0)), /resource/i);
});

test('Deck gate remains outside shelter as a pre-existing exclusion invariant', () => {
  const world = supportedWorld();
  world.structures.push({...gate(), id: 'gate'});
  assert.equal(sheltered(world, {x: 9, z: 0}), false);
});

test('Deck gate remains outside room sealing as a pre-existing exclusion invariant', () => {
  const world = supportedWorld();
  world.structures.push({...gate(), id: 'gate'});
  assert.equal(rooms(world)[0]?.sealed ?? false, false);
});

test('Deck gate remains outside Wall-lumen support as a pre-existing exclusion invariant', () => {
  const world = supportedWorld();
  world.structures.push({...gate(), id: 'gate'});
  assert.match(placementError(world, player(), {type: 'lamp', x: 9, z: 0, rotation: 0}), /wall/i);
});

test('Deck gate build rejects non-exact request shapes without mutation', () => {
  const game = new Game();
  const owner = game.join('builder', 'Builder');
  Object.assign(owner, {x: 9, z: 4.5});
  Object.assign(owner.inventory, {ferrite: 2, fiber: 1});
  game.world.resources = [];
  game.world.creatures = [];
  game.world.structures.push(deck());
  const before = structuredClone(game.world);
  assert.equal(game.action(owner.id, {type: 'build', piece: 'deckGate', x: 9, z: 0, rotation: 0, extra: true}).ok, false);
  assert.deepEqual(game.world, before);
});

test('Deck gate structure-cap rejection preserves world and payment', () => {
  const {game, owner} = deckGateGame();
  while (game.world.structures.length < 5000) {
    const index = game.world.structures.length;
    game.world.structures.push({id: `cap-${index}`, type: 'floor', x: 10000 + index * 3, z: 0, rotation: 0, health: 200, owner: 'builder'});
  }
  const before = structuredClone(game.world);
  assert.equal(game.action(owner.id, {type: 'build', piece: 'deckGate', x: 9, z: 0, rotation: 0}).ok, false);
  assert.deepEqual(game.world, before);
});

test('Deck gate range rejection preserves world and payment', () => {
  const {game, owner} = deckGateGame({z: 20});
  const before = structuredClone(game.world);
  assert.equal(game.action(owner.id, {type: 'build', piece: 'deckGate', x: 9, z: 0, rotation: 0}).ok, false);
  assert.deepEqual(game.world, before);
});

test('Deck gate affordability rejection preserves world and payment', () => {
  const {game, owner} = deckGateGame({ferrite: 1, fiber: 0});
  const before = structuredClone(game.world);
  assert.equal(game.action(owner.id, {type: 'build', piece: 'deckGate', x: 9, z: 0, rotation: 0}).ok, false);
  assert.deepEqual(game.world, before);
});

test('Accepted Deck gate build charges exactly once', () => {
  const {game, owner} = deckGateGame({ferrite: 4, fiber: 3});
  assert.equal(game.action(owner.id, {type: 'build', piece: 'deckGate', x: 9, z: 0, rotation: 0}).ok, true);
  assert.deepEqual({ferrite: owner.inventory.ferrite, fiber: owner.inventory.fiber}, {ferrite: 2, fiber: 2});
});

test('Accepted Deck gate records authoritative health id owner and rotation', () => {
  const {game, owner} = deckGateGame();
  const expectedId = `s${game.world.nextStructure}`;
  assert.equal(game.action(owner.id, {type: 'build', piece: 'deckGate', x: 9, z: 0, rotation: 3}).ok, true);
  const accepted = game.world.structures.at(-1);
  assert.deepEqual(
    {health: accepted.health, id: accepted.id, owner: accepted.owner, rotation: accepted.rotation},
    {health: 200, id: expectedId, owner: owner.id, rotation: 3},
  );
});

test('Accepted Deck gate initializes closed', () => {
  const game = new Game();
  const owner = game.join('builder', 'Builder');
  Object.assign(owner, {x: 9, z: 4.5});
  Object.assign(owner.inventory, {ferrite: 2, fiber: 1});
  game.world.resources = [];
  game.world.creatures = [];
  game.world.structures.push(deck());
  assert.equal(game.action(owner.id, {type: 'build', piece: 'deckGate', x: 9, z: 0, rotation: 0}).ok, true);
  assert.equal(game.world.structures.at(-1).open, false);
});

test('Deck gate operation rejects non-exact request shapes', () => {
  const game = new Game();
  const actor = game.join('actor', 'Actor');
  const before = structuredClone(game.world);
  assert.deepEqual(game.action(actor.id, {type: 'deckGate', id: 'gate', extra: true}), {ok: false, message: 'Invalid Deck gate request.'});
  assert.deepEqual(game.world, before);
});

test('Missing exact Deck gate operation ID is a no-op', () => {
  const game = new Game();
  const actor = game.join('actor', 'Actor');
  Object.assign(actor, {x: 9, z: 2});
  game.world.structures.push(deck(), {...gate(), id: 'gate', owner: actor.id, open: false});
  const before = structuredClone(game.world);
  assert.equal(game.action(actor.id, {type: 'deckGate', id: 'missing'}).ok, false);
  assert.deepEqual(game.world, before);
});

test('Wrong-type Deck gate operation ID is a no-op', () => {
  const game = new Game();
  const actor = game.join('actor', 'Actor');
  Object.assign(actor, {x: 9, z: 2});
  game.world.structures.push(
    deck(),
    {id: 'wrong-type', type: 'wall', x: 9, z: 0, rotation: 0, owner: actor.id},
    {...gate(1), id: 'gate', owner: actor.id, open: false},
  );
  const before = structuredClone(game.world);
  assert.equal(game.action(actor.id, {type: 'deckGate', id: 'wrong-type'}).ok, false);
  assert.deepEqual(game.world, before);
});

test('Remote exact Deck gate operation ID is a no-op', () => {
  const game = new Game();
  const actor = game.join('actor', 'Actor');
  Object.assign(actor, {x: 9, z: 2});
  game.world.structures.push({...gate(0, 100, 0), id: 'remote-gate', owner: actor.id, open: false});
  const before = structuredClone(game.world);
  assert.equal(game.action(actor.id, {type: 'deckGate', id: 'remote-gate'}).ok, false);
  assert.deepEqual(game.world, before);
});

test('Interaction selects the nearest exact Deck gate rather than a wrong nearby type', () => {
  const world = supportedWorld();
  world.structures.push(
    {id: 'near-wall', type: 'wall', x: 12, z: 2, rotation: 0},
    {...gate(0), id: 'exact-gate', open: false},
  );
  assert.deepEqual(interactionTarget(world, {x: 9, z: 2}), {type: 'deckGate', id: 'exact-gate'});
});

test('Exact nearby Deck gate operation opens a closed gate', () => {
  const game = new Game();
  const actor = game.join('actor', 'Actor');
  Object.assign(actor, {x: 9, z: 2});
  game.world.resources = [];
  game.world.creatures = [];
  game.world.structures.push(deck(), {...gate(), id: 'gate', owner: actor.id, open: false});
  assert.deepEqual(game.action(actor.id, {type: 'deckGate', id: 'gate'}), {ok: true, message: 'Deck gate open.'});
  assert.equal(game.world.structures.at(-1).open, true);
});

test('Exact nearby Deck gate operation closes an open gate', () => {
  const game = new Game();
  const actor = game.join('actor', 'Actor');
  Object.assign(actor, {x: 9, z: 2});
  game.world.resources = [];
  game.world.creatures = [];
  game.world.structures.push(deck(), {...gate(), id: 'gate', owner: actor.id, open: true});
  assert.deepEqual(game.action(actor.id, {type: 'deckGate', id: 'gate'}), {ok: true, message: 'Deck gate closed.'});
  assert.equal(game.world.structures.at(-1).open, false);
});

test('Closed Deck gate blocks traversal through its edge', () => {
  const world = supportedWorld();
  world.structures.push({...gate(), id: 'gate', open: false});
  assert.equal(blocked(world, 9, -1.5), true);
});

test('Open Deck gate permits traversal through its edge', () => {
  const world = supportedWorld();
  world.structures.push({...gate(), id: 'gate', open: true});
  assert.equal(blocked(world, 9, -1.5), false);
});

test('Client renderer has a dedicated authored Deck gate branch', () => {
  assert.match(clientSource, /piece\.type==='deckGate'/);
});

test('Construction controls expose Deck gate as a selectable piece', () => {
  assert.match(clientSource, /const pieces=\[[^\]]*'deckGate'/);
});

test('Version-one local save and load preserve Deck gate state', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'deck-gate-save-'));
  const file = path.join(directory, 'world.json');
  try {
    const world = supportedWorld();
    world.structures.push({...gate(2), id: 'gate', owner: 'builder', open: true});
    saveWorld(file, world);
    const loaded = loadWorld(file, world.seed);
    assert.deepEqual(loaded.structures.at(-1), world.structures.at(-1));
    assert.equal(loaded.version, VERSION);
  } finally {
    fs.rmSync(directory, {recursive: true, force: true});
  }
});

test('Snapshot baseline preserves Deck gate state', () => {
  const game = new Game();
  const owner = game.join('builder', 'Builder');
  game.world.structures.push(deck(), {...gate(3), id: 'gate', owner: owner.id, open: true});
  const session = createSnapshotSession(game.snapshot(owner.id));
  assert.deepEqual(session.state.structures.at(-1), game.snapshot(owner.id).structures.at(-1));
});

test('Snapshot delta preserves an accepted Deck gate state change', () => {
  const game = new Game();
  const owner = game.join('builder', 'Builder');
  game.world.structures.push(deck(), {...gate(1), id: 'gate', owner: owner.id, open: false});
  const session = createSnapshotSession(game.snapshot(owner.id));
  nextSnapshotPacket(session, game.snapshot(owner.id));
  game.world.structures.at(-1).open = true;
  const packet = nextSnapshotPacket(session, game.snapshot(owner.id));
  assert.equal(packet.type, 'delta');
  assert.equal(packet.delta.changes.structures.at(-1).open, true);
});

test('JSON-cloned cloud-equivalent state preserves Deck gate fields', () => {
  const original = {...gate(2), id: 'gate', owner: 'builder', open: true, health: 200};
  const cloned = JSON.parse(JSON.stringify(original));
  assert.deepEqual(cloned, original);
});

test('Unauthorized Deck gate reclaim is a no-op', () => {
  const game = new Game();
  const owner = game.join('owner', 'Owner');
  const actor = game.join('actor', 'Actor');
  Object.assign(actor, {x: 9, z: 2});
  game.world.structures.push(deck(), {...gate(), id: 'gate', owner: owner.id, open: false});
  const before = structuredClone(game.world);
  assert.equal(game.action(actor.id, {type: 'dismantle', id: 'gate'}).ok, false);
  assert.deepEqual(game.world, before);
});

test('Deck gate reclaim refunds exactly 2 ferrite and 1 fiber once', () => {
  const game = new Game();
  const owner = game.join('builder', 'Builder');
  Object.assign(owner, {x: 9, z: 2});
  game.world.structures.push(deck(), {...gate(), id: 'gate', owner: owner.id, open: false});
  assert.equal(game.action(owner.id, {type: 'dismantle', id: 'gate'}).ok, true);
  assert.deepEqual({ferrite: owner.inventory.ferrite, fiber: owner.inventory.fiber}, {ferrite: 2, fiber: 1});
  assert.equal(game.world.structures.some(structure => structure.id === 'gate'), false);
  assert.equal(game.action(owner.id, {type: 'dismantle', id: 'gate'}).ok, false);
  assert.deepEqual({ferrite: owner.inventory.ferrite, fiber: owner.inventory.fiber}, {ferrite: 2, fiber: 1});
});

test('Deck gate reclaim fails closed when its refund would exceed backpack capacity', () => {
  const game = new Game();
  const owner = game.join('builder', 'Builder');
  Object.assign(owner, {x: 9, z: 2});
  owner.inventory.meat = 58;
  game.world.structures.push(deck(), {...gate(), id: 'gate', owner: owner.id, open: false});
  const before = structuredClone(owner.inventory);
  assert.equal(game.action(owner.id, {type: 'dismantle', id: 'gate'}).ok, false);
  assert.deepEqual(owner.inventory, before);
  assert.equal(game.world.structures.some(structure => structure.id === 'gate'), true);
});

test('A supporting Deck cannot be reclaimed before its Deck gate', () => {
  const game = new Game();
  const owner = game.join('builder', 'Builder');
  Object.assign(owner, {x: 9, z: 2});
  game.world.structures.push({...deck(), owner: owner.id}, {...gate(), id: 'gate', owner: owner.id, open: false});
  assert.equal(game.action(owner.id, {type: 'dismantle', id: 'deck'}).ok, false);
  assert.equal(game.world.structures.some(structure => structure.id === 'deck'), true);
});

test('Reclaim context selects a dependent Deck gate before its supporting Deck', () => {
  const world = supportedWorld();
  world.structures[0].canDismantle = true;
  world.structures.push({...gate(), id: 'gate', owner: 'builder', open: false, canDismantle: true});
  assert.deepEqual(contextAction(world, player(9, 2), {reclaimMode: true}), {
    kind: 'message',
    message: {type: 'dismantle', id: 'gate'},
    label: 'Reclaim Deck gate',
    repeat: false,
  });
});

test('Deck gate construction control derives the accessible Build deck gate label', () => {
  assert.match(clientSource, /b\.setAttribute\('aria-label',`Build \$\{RECIPES\[key\]\.name\.toLowerCase\(\)\}`\)/);
});

test('Accepted closed and open Deck gates use distinct primitive geometry', () => {
  assert.match(clientSource, /piece\.type==='deckGate'[\s\S]*piece\.open\?\.16:2\.5/);
});

test('Accepted Deck gate state changes invalidate rendered structure geometry', () => {
  assert.match(clientSource, /state\.structures\.map\(s=>s\.id\+'\:'\+!!s\.open\)/);
});

test('Unified context exposes readable accepted Deck gate state and exact action', () => {
  const world = supportedWorld();
  world.structures.push({...gate(), id: 'gate', owner: 'builder', open: false});
  const action = contextAction(world, player(9, 2));
  assert.equal(contextActions.readableActionLabel?.(world, action), 'Deck gate closed · Open Deck gate');
});

test('Client interaction status uses the unified readable action label', () => {
  assert.match(clientSource, /readableActionLabel\(state,action\)/);
});

test('Deck gate has no external asset or network dependency', () => {
  assert.doesNotMatch(clientSource, /assets\/deck[-_]gate|fetch\([^)]*deckGate|loadAuthoredMesh\([^)]*deckGate/);
});

test('Closed Deck gate blocks a creature path across its edge', () => {
  const world = supportedWorld();
  world.structures.push({...gate(), id: 'gate', open: false});
  assert.equal(clearPath(world, {x: 9, z: -3}, {x: 9, z: 0}), false);
});

test('Open Deck gate permits a creature path across its edge', () => {
  const world = supportedWorld();
  world.structures.push({...gate(), id: 'gate', open: true});
  assert.equal(clearPath(world, {x: 9, z: -3}, {x: 9, z: 0}), true);
});

test('Closed Deck gate exposes the exact Open Deck gate context label', () => {
  const world = supportedWorld();
  world.structures.push({...gate(), id: 'gate', open: false});
  assert.equal(contextAction(world, player(9, 2)).label, 'Open Deck gate');
});

test('Open Deck gate exposes the exact Close Deck gate context label', () => {
  const world = supportedWorld();
  world.structures.push({...gate(), id: 'gate', open: true});
  assert.equal(contextAction(world, player(9, 2)).label, 'Close Deck gate');
});
