import assert from 'node:assert/strict';
import test from 'node:test';
import {Game} from '../server/game.js';
import {coralRegenerationFeedback, coralRegenerationStatus} from '../client/snapshot-delta.js';
import {makeWorld} from '../shared/world.js';
import {tileAt, tileContent} from '../shared/planet.js';

function coralNode(seed = 7319) {
  return tileContent(seed, tileAt(0, -1500)).nodes.find(node => node.id.startsWith('p:coral:'));
}

test('snapshot projects regeneration due only for the scheduled depleted Coral Flux node', () => {
  const world = makeWorld(7319);
  const coral = coralNode(world.seed);
  const due = 412.25;
  world.time = 112.25;
  world.depleted = {};
  world.depleted[coral.id] = 0;
  world.coralFluxRegeneration = {[coral.id]: due};
  const game = new Game(world);
  const player = game.join('feedback-explorer', 'Ada');
  Object.assign(player, {x: coral.x, z: coral.z});

  const excluded = [
    {...coral, id: 'p:coral:7319:2:128:120', amount: 0},
    {...coral, id: 'p:coral:7319:2:128:121', amount: 6},
    {...coral, id: 'p:7319:2:128:122', amount: 0},
    {...coral, id: 'r0', amount: 0},
    {...coral, id: 'drop1', amount: 0},
    {...coral, id: 'non-coral', type: 'ferrite', amount: 0},
  ];
  world.resources.push(...excluded);
  game.coralFluxRegeneration[excluded[1].id] = due;
  game.coralFluxRegeneration[excluded[2].id] = due;
  game.coralFluxRegeneration[excluded[3].id] = due;
  game.coralFluxRegeneration[excluded[4].id] = due;
  game.coralFluxRegeneration[excluded[5].id] = due;
  game.coralFluxRegeneration['p:coral:7319:2:128:123'] = NaN;
  world.resources.push({...coral, id: 'p:coral:7319:2:128:123', amount: 0});

  const first = game.snapshot(player.id);
  const second = game.snapshot(player.id);
  const projected = first.resources.find(node => node.id === coral.id);
  assert.equal(projected.amount, 0);
  assert.equal(projected.regeneratesAt, due);
  assert.deepEqual(second.resources, first.resources);
  assert.deepEqual(
    first.resources.filter(node => Object.hasOwn(node, 'regeneratesAt')).map(node => node.id),
    [coral.id],
  );
  assert.equal(world.resources.some(node => Object.hasOwn(node, 'regeneratesAt')), false);
});

test('Coral Flux countdown uses bounded whole server-time seconds and fails closed', () => {
  const depleted = {id: 'p:coral:7319:2:128:119', type: 'crystal', amount: 0, regeneratesAt: 102};
  assert.equal(coralRegenerationStatus(depleted, 100), 'Flux crystal depleted, regenerates in 2 seconds of server time.');
  assert.equal(coralRegenerationStatus({...depleted, regeneratesAt: 100.01}, 100), 'Flux crystal depleted, regenerates in 1 seconds of server time.');
  assert.equal(coralRegenerationStatus({...depleted, regeneratesAt: 100}, 100), 'Flux crystal depleted, regenerates in 0 seconds of server time.');
  assert.equal(coralRegenerationStatus({...depleted, regeneratesAt: 99}, 100), 'Flux crystal depleted, regenerates in 0 seconds of server time.');

  const invalidResources = [
    {...depleted, regeneratesAt: undefined},
    {...depleted, regeneratesAt: NaN},
    {...depleted, regeneratesAt: Infinity},
    {...depleted, regeneratesAt: -1},
    {...depleted, regeneratesAt: Number.MAX_SAFE_INTEGER + 1},
    {...depleted, amount: 1},
    {...depleted, id: 'p:7319:2:128:119'},
    {...depleted, type: 'ferrite'},
  ];
  for (const resource of invalidResources) assert.equal(coralRegenerationStatus(resource, 100), null);
  for (const worldTime of [undefined, NaN, Infinity, -1, Number.MAX_SAFE_INTEGER + 1]) {
    assert.equal(coralRegenerationStatus(depleted, worldTime), null);
  }
});

test('depleted Coral feedback is range-bounded, non-actionable, and below actionable targets', () => {
  const world = makeWorld(7319);
  const coral = coralNode(world.seed);
  world.depleted = {[coral.id]: 0};
  world.coralFluxRegeneration = {[coral.id]: 300};
  const game = new Game(world);
  const player = game.join('interaction-explorer', 'Ada');
  Object.assign(player, {x: coral.x, z: coral.z});
  const resource = game.snapshot(player.id).resources.find(node => node.id === coral.id);
  const planarDistance = (left, right) => Math.hypot(left.x - right.x, left.z - right.z);

  assert.equal(
    coralRegenerationFeedback([resource], {x: resource.x + 3, z: resource.z}, world.time, null, planarDistance),
    'Flux crystal depleted, regenerates in 300 seconds of server time.',
  );
  assert.equal(coralRegenerationFeedback([resource], {x: resource.x + 3.001, z: resource.z}, world.time, null, planarDistance), null);
  for (const actionableTarget of [{type: 'gather'}, {type: 'door'}, {type: 'scan'}]) {
    assert.equal(coralRegenerationFeedback([resource], player, world.time, actionableTarget, planarDistance), null);
  }

  const before = structuredClone({inventory: player.inventory, depleted: world.depleted, schedule: game.coralFluxRegeneration});
  assert.deepEqual(game.action(player.id, {type: 'gather', id: coral.id}), {ok: false, message: 'This deposit is depleted.'});
  assert.deepEqual({inventory: player.inventory, depleted: world.depleted, schedule: game.coralFluxRegeneration}, before);
});
