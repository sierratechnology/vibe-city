import assert from 'node:assert/strict';
import test from 'node:test';
import {hydroponicBedRenderState, hydroponicStatus} from '../client/hydroponics-status.js';

test('a bed without an accepted due is plantable', () => {
  assert.deepEqual(hydroponicStatus({worldTime: 12.5}), {
    kind: 'plantable',
    label: 'Plant water + fiber',
  });
});

test('a future due reports bounded remaining server seconds', () => {
  assert.deepEqual(hydroponicStatus({worldTime: 12.5, readyAt: 14.01}), {
    kind: 'growing',
    remainingSeconds: 2,
    label: 'Hydroponic bed growing, 2 seconds of server time remaining',
  });
});

test('a due reached in accepted server time is ready', () => {
  assert.deepEqual(hydroponicStatus({worldTime: 180.25, readyAt: 180.25}), {
    kind: 'ready',
    label: 'Hydroponic bed ready to harvest',
  });
});

test('malformed status input fails closed without invoking property getters', () => {
  let getterCalls = 0;
  const accessor = {worldTime: 12};
  Object.defineProperty(accessor, 'readyAt', {enumerable: true, get() { getterCalls++; return 99; }});
  const revoked = Proxy.revocable({worldTime: 12}, {});
  revoked.revoke();
  const rejected = [
    null, [], 'status', {worldTime: NaN}, {worldTime: Infinity}, {worldTime: -1},
    {worldTime: -0}, {worldTime: Number.MAX_SAFE_INTEGER + 1},
    {worldTime: 1, readyAt: NaN}, {worldTime: 1, readyAt: Infinity},
    {worldTime: 1, readyAt: -1}, {worldTime: 1, readyAt: Number.MAX_SAFE_INTEGER + 1},
    {worldTime: 1, extra: 'do not reflect me'}, Object.create({worldTime: 1}),
    accessor, new Proxy({worldTime: 12}, {}), revoked.proxy,
  ];
  for (const value of rejected) assert.doesNotThrow(() => assert.equal(hydroponicStatus(value), null));
  assert.equal(getterCalls, 0);
});

test('a growing bed render state has readable status and no harvest action', () => {
  assert.deepEqual(hydroponicBedRenderState({readyAt: 192.5}, 12.5), {
    label: 'Hydroponic bed growing, 180 seconds of server time remaining',
    action: null,
  });
});

test('plantable, ready, and rejected bed render states expose only truthful actions', () => {
  assert.deepEqual(hydroponicBedRenderState({}, 12.5), {
    label: 'Plant water + fiber',
    action: {label: 'Plant water + fiber', message: {type: 'garden'}},
  });
  assert.deepEqual(hydroponicBedRenderState({readyAt: 12.5}, 12.5), {
    label: 'Hydroponic bed ready to harvest',
    action: {label: 'Harvest', message: {type: 'garden'}},
  });
  assert.deepEqual(hydroponicBedRenderState({readyAt: 'stolen-value'}, 12.5), {
    label: 'Hydroponic bed status unavailable',
    action: null,
  });
});

test('a proxied bed render state fails closed without exposing a harvest action', () => {
  assert.deepEqual(hydroponicBedRenderState(new Proxy({readyAt: 12.5}, {}), 12.5), {
    label: 'Hydroponic bed status unavailable',
    action: null,
  });
});
