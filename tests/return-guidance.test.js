import assert from 'node:assert/strict';
import test from 'node:test';
import {computeReturnGuidance} from '../client/return-guidance.js';

test('return guidance reports a rounded non-axis bearing and zero-distance semantics', () => {
  assert.deepEqual(
    computeReturnGuidance({x: 0, z: 0}, {x: 10, z: -10}),
    {
      distance: 14,
      bearing: 45,
      direction: 'NE',
      label: 'Return to first Coral Shelf contact: 14 m · NE · 45°',
    },
  );
  assert.deepEqual(
    computeReturnGuidance({x: 10, z: -10}, {x: 10, z: -10}),
    {
      distance: 0,
      bearing: null,
      direction: null,
      label: 'At first Coral Shelf contact',
    },
  );
});

test('return guidance preserves direction for a nonzero submeter separation', () => {
  assert.deepEqual(
    computeReturnGuidance({x: 0, z: 0}, {x: 0.4, z: 0}),
    {
      distance: 0,
      bearing: 90,
      direction: 'E',
      label: 'Return to first Coral Shelf contact: 0 m · E · 90°',
    },
  );
});

test('return guidance fails closed when the derived distance is not a finite safe integer', () => {
  assert.equal(
    computeReturnGuidance(
      {x: -Number.MAX_SAFE_INTEGER, z: -Number.MAX_SAFE_INTEGER},
      {x: Number.MAX_SAFE_INTEGER, z: Number.MAX_SAFE_INTEGER},
    ),
    null,
  );
  assert.equal(
    computeReturnGuidance(
      {x: -Number.MAX_VALUE, z: -Number.MAX_VALUE},
      {x: Number.MAX_VALUE, z: Number.MAX_VALUE},
    ),
    null,
  );
});

test('return guidance uses stable compass axes, octant boundaries, wrap, and meter rounding', () => {
  const pointAt = (degrees, distance = 10) => ({
    x: Math.sin(degrees * Math.PI / 180) * distance,
    z: -Math.cos(degrees * Math.PI / 180) * distance,
  });
  for (const [degrees, bearing, direction] of [
    [0, 0, 'N'], [45, 45, 'NE'], [90, 90, 'E'], [135, 135, 'SE'],
    [180, 180, 'S'], [225, 225, 'SW'], [270, 270, 'W'], [315, 315, 'NW'],
    [22.5, 23, 'NE'], [67.5, 68, 'E'], [112.5, 113, 'SE'], [157.5, 158, 'S'],
    [202.5, 203, 'SW'], [247.5, 248, 'W'], [292.5, 293, 'NW'], [337.5, 338, 'N'],
    [359.4, 359, 'N'],
  ]) {
    const guidance = computeReturnGuidance({x: 0, z: 0}, pointAt(degrees));
    assert.equal(guidance.bearing, bearing, `${degrees}° bearing`);
    assert.equal(guidance.direction, direction, `${degrees}° direction`);
  }
  assert.equal(computeReturnGuidance({x: 0, z: 0}, {x: 1.49, z: 0}).distance, 1);
  assert.equal(computeReturnGuidance({x: 0, z: 0}, {x: 1.5, z: 0}).distance, 2);
});

test('return guidance fails closed for noncanonical points without invoking getters or reflecting values', () => {
  let getterCalls = 0;
  const getterPoint = {};
  Object.defineProperty(getterPoint, 'x', {enumerable: true, get() { getterCalls++; return 4; }});
  Object.defineProperty(getterPoint, 'z', {enumerable: true, value: 5});
  const invalidPoints = [
    null,
    [],
    {x: 1},
    {x: 1, z: 2, extra: 'DO_NOT_REFLECT'},
    {x: Infinity, z: 2},
    {x: NaN, z: 2},
    {x: -0, z: 2},
    {x: 1, z: -0},
    Object.assign(Object.create(null), {x: 1, z: 2}),
    getterPoint,
    new Proxy({x: 1, z: 2}, {}),
    new Proxy({x: 1, z: 2}, {ownKeys() { throw new Error('DO_NOT_REFLECT'); }}),
  ];
  for (const point of invalidPoints) {
    assert.equal(computeReturnGuidance(point, {x: 3, z: 4}), null);
    assert.equal(computeReturnGuidance({x: 3, z: 4}, point), null);
  }
  assert.equal(getterCalls, 0);
});
