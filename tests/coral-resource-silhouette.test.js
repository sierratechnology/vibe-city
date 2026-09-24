import assert from 'node:assert/strict';
import test from 'node:test';
import {coralFluxDepositDescriptor} from '../client/planet-renderer.js';
import {coralFieldCutterFeedback, coralFluxAccessibleRegenerationFeedback, coralFluxAccessibleRegenerationStatus, coralFluxResourceLabel} from '../client/snapshot-delta.js';

test('canonical Coral Flux alone receives one bounded distinct deposit composition', () => {
  const coral = {id: 'p:coral:7319:2:128:119', type: 'crystal', x: 12, z: -18, y: 4.5, amount: 6};
  const descriptor = coralFluxDepositDescriptor(coral);

  assert.deepEqual(Object.keys(descriptor), ['kind', 'depleted', 'bounds', 'parts']);
  assert.equal(descriptor.kind, 'coral-flux-deposit');
  assert.equal(descriptor.depleted, false);
  assert.deepEqual(descriptor.bounds, {radius: 1.45, height: 2.4});
  assert.equal(descriptor.parts.length, 4);
  assert.deepEqual(descriptor.parts.map(part => part.primitive), ['cylinder', 'cone', 'cone', 'cone']);
  assert.equal(descriptor.parts.every(part => Object.values(part).every(value => typeof value === 'string' || Number.isFinite(value))), true);

  const depleted = coralFluxDepositDescriptor({...coral, amount: 0, regeneratesAt: 300});
  assert.equal(depleted.depleted, true);
  assert.equal(depleted.parts.length, 4);

  const rejected = [
    {...coral, id: 'p:7319:2:128:119'},
    {...coral, id: 'p:coral:7319:2:128'},
    {...coral, id: 'p:coral:07319:2:128:119'},
    {...coral, type: 'ferrite'},
    {...coral, x: NaN},
    {...coral, amount: -1},
    {...coral, amount: 7},
    {...coral, extra: true},
    {id: coral.id, type: coral.type, amount: coral.amount},
    null,
  ];
  for (const resource of rejected) assert.equal(coralFluxDepositDescriptor(resource), null);
  assert.equal(coralFluxDepositDescriptor({id: 'p:7319:2:128:119', type: 'crystal', x: 12, z: -18, y: 4.5, amount: 6}), null);
});

test('canonical Coral Flux meaning is explicit active and depleted while remaining fail-closed and subordinate', () => {
  const active = {id: 'p:coral:7319:2:128:119', type: 'crystal', x: 12, z: -18, y: 4.5, amount: 6};
  const depleted = {...active, amount: 0, regeneratesAt: 102};
  const player = {x: 15, z: -18, cutter: false};
  const distance = (left, right) => Math.hypot(left.x - right.x, left.z - right.z);

  assert.equal(coralFluxResourceLabel(active), 'Coral Flux');
  assert.equal(coralFieldCutterFeedback([active], player, {type: 'gather', id: active.id}, distance), 'A Field cutter is required to gather Coral Flux.');
  assert.equal(coralFluxAccessibleRegenerationStatus(depleted, 100), 'Coral Flux depleted, regenerates in 2 seconds of server time.');
  assert.equal(coralFluxAccessibleRegenerationStatus({...depleted, regeneratesAt: 100.01}, 100), 'Coral Flux depleted, regenerates in 1 seconds of server time.');
  assert.equal(coralFluxAccessibleRegenerationFeedback([depleted], player, 100, null, distance), 'Coral Flux depleted, regenerates in 2 seconds of server time.');
  assert.equal(coralFluxAccessibleRegenerationFeedback([depleted], {...player, x: 15.001}, 100, null, distance), null);
  assert.equal(coralFluxAccessibleRegenerationFeedback([depleted], player, 100, {type: 'door', id: 'door-1'}, distance), null);

  const malformed = [
    {...active, id: 'p:coral:07319:2:128:119'},
    {...active, type: 'ferrite'},
    {...active, x: NaN},
    {...active, amount: 7},
    {...active, extra: true},
  ];
  for (const resource of malformed) {
    assert.equal(coralFluxResourceLabel(resource), null);
    assert.equal(coralFieldCutterFeedback([resource], player, {type: 'gather', id: resource.id}, distance), null);
    if (resource.amount !== 7) assert.equal(coralFluxAccessibleRegenerationStatus({...resource, amount: 0, regeneratesAt: 102}, 100), null);
  }
  assert.equal(coralFluxAccessibleRegenerationStatus({...depleted, regeneratesAt: NaN}, 100), null);
});
