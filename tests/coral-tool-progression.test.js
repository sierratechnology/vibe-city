import assert from 'node:assert/strict';
import test from 'node:test';
import {Game} from '../server/game.js';
import * as snapshotDelta from '../client/snapshot-delta.js';
import {dist, interactionTarget, makeWorld} from '../shared/world.js';
import {tileAt, tileContent, travel} from '../shared/planet.js';

function setupAtCoral() {
  const game = new Game(makeWorld(7319));
  const player = game.join('coral-tool-explorer', 'Ada');
  const coral = tileContent(game.world.seed, tileAt(0, -1500)).nodes.find(node => node.id.startsWith('p:coral:'));
  assert.ok(coral, 'fixture tile must contain the deterministic Coral Shelf deposit');
  Object.assign(player, {x: coral.x, z: coral.z});
  return {game, player, coral};
}

function authoritativeState(game, player, coral) {
  return structuredClone({
    amount: game.snapshot(player.id).resources.find(resource => resource.id === coral.id)?.amount,
    inventory: player.inventory,
    depleted: game.world.depleted,
    regeneration: game.world.coralFluxRegeneration,
    skills: player.skills,
    world: {
      time: game.world.time,
      resources: game.world.resources,
      structures: game.world.structures,
      nextStructure: game.world.nextStructure,
      nextDrop: game.world.nextDrop,
    },
    cooldowns: [...game.cooldowns],
  });
}

test('server requires a Field cutter for active canonical Coral Flux without mutating state', () => {
  const {game, player, coral} = setupAtCoral();
  const before = authoritativeState(game, player, coral);

  assert.deepEqual(
    game.action(player.id, {type: 'gather', id: coral.id}),
    {ok: false, message: 'A Field cutter is required to gather Coral Flux.'},
  );
  assert.deepEqual(authoritativeState(game, player, coral), before);
});

test('Field cutter preserves shipped Coral gathering while non-Coral gathering remains cutter-free', () => {
  const equipped = setupAtCoral();
  equipped.player.cutter = true;
  assert.deepEqual(
    equipped.game.action(equipped.player.id, {type: 'gather', id: equipped.coral.id}),
    {ok: true, message: '+2 crystal'},
  );
  assert.equal(equipped.player.inventory.crystal, 2);
  assert.equal(equipped.game.world.depleted[equipped.coral.id], 4);
  assert.equal(equipped.game.world.coralFluxRegeneration[equipped.coral.id], undefined);
  assert.equal(equipped.player.skills.mining, 1);

  const game = new Game(makeWorld(7319));
  const player = game.join('starter-explorer', 'Bo');
  const ferrite = game.world.resources.find(resource => resource.id === 'r0');
  Object.assign(player, {x: ferrite.x, z: ferrite.z});
  assert.equal(player.cutter, false);
  assert.deepEqual(game.action(player.id, {type: 'gather', id: ferrite.id}), {ok: true, message: '+1 ferrite'});
  assert.equal(player.inventory.ferrite, 1);
  assert.equal(ferrite.amount, 3);
});

test('canonical Coral tool boundary includes exactly 3 m and excludes 3.001 m', () => {
  const {game, player, coral} = setupAtCoral();
  const resources = [{...coral}];
  const targetWorld = {...game.world, resources, structures: []};
  const gather = {type: 'gather', id: coral.id};
  const required = 'A Field cutter is required to gather Coral Flux.';

  Object.assign(player, travel(coral, 3, 0));
  assert.ok(dist(coral, player) > 3, 'canonical reconstruction must exercise binary64 boundary drift');
  const exactTarget = interactionTarget(targetWorld, player);
  assert.deepEqual(exactTarget, gather);
  assert.equal(snapshotDelta.coralFieldCutterFeedback(resources, player, exactTarget, dist), required);
  assert.deepEqual(game.action(player.id, gather), {ok: false, message: required});

  Object.assign(player, travel(coral, 3.001, 0));
  assert.equal(interactionTarget(targetWorld, player), null);
  assert.equal(snapshotDelta.coralFieldCutterFeedback(resources, player, gather, dist), null);
  assert.deepEqual(game.action(player.id, gather), {ok: false, message: 'Move closer to gather (3 m).'});
});

test('Coral Field cutter feedback is range-bounded, fail-closed, and follows interaction priority', () => {
  assert.equal(typeof snapshotDelta.coralFieldCutterFeedback, 'function', 'client must expose pure Coral tool feedback');
  const feedback = snapshotDelta.coralFieldCutterFeedback;
  const coral = {id: 'p:coral:7319:2:128:119', type: 'crystal', amount: 6, x: 0, z: 0, y: 0};
  const player = {x: 3, z: 0, cutter: false};
  const distance = (left, right) => Math.hypot(left.x - right.x, left.z - right.z);
  const gather = {type: 'gather', id: coral.id};
  const required = 'A Field cutter is required to gather Coral Flux.';

  assert.equal(feedback([coral], player, gather, distance), required);
  assert.equal(feedback([coral], {...player, x: 3.001}, gather, distance), null);
  assert.equal(feedback([coral], {...player, cutter: true}, gather, distance), null);

  const rejectedResources = [
    {...coral, amount: 0},
    {...coral, type: 'ferrite'},
    {...coral, id: 'p:7319:2:128:119'},
    {...coral, id: 'p:coral:7319:9:128:119'},
    {...coral, id: 'p:coral:7319:2:128:not-a-number'},
    null,
  ];
  for (const resource of rejectedResources) assert.equal(feedback([resource], player, gather, distance), null);
  for (const malformed of [null, {}, [], {x: 3, z: 0}, {...player, cutter: 'no'}]) {
    assert.equal(feedback([coral], malformed, gather, distance), null);
  }
  for (const target of [null, {type: 'door', id: 'door'}, {type: 'scan'}, {type: 'gather', id: 'other'}]) {
    assert.equal(feedback([coral], player, target, distance), null);
  }

  const world = makeWorld(7319);
  world.resources = [{...coral, x: 2}];
  world.structures = [{id: 'door', type: 'door', x: 0, z: 1, rotation: 0, open: false}];
  const closerDoor = interactionTarget(world, {x: 0, z: 0});
  assert.deepEqual(closerDoor, {type: 'door', id: 'door'});
  assert.equal(feedback(world.resources, {...player, x: 0}, closerDoor, distance), null);
});
