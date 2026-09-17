import assert from 'node:assert/strict';
import test from 'node:test';

let createReconnectController;
try {
  ({createReconnectController} = await import('../client/reconnect.js'));
} catch (error) {
  if (error.code !== 'ERR_MODULE_NOT_FOUND') throw error;
}

test('bounds reconnect attempts without overlapping timers', () => {
  assert.equal(typeof createReconnectController, 'function', 'reconnect controller must exist');

  const timers = [];
  const attempts = [];
  let exhausted = 0;
  const controller = createReconnectController({
    delays: [500, 1000, 2000],
    attempt: () => attempts.push(timers.length),
    exhausted: () => exhausted++,
    setTimer: (callback, delay) => {
      timers.push({callback, delay, cancelled: false});
      return timers.length - 1;
    },
    clearTimer: id => {
      timers[id].cancelled = true;
    },
  });

  controller.connected();
  controller.disconnected();
  controller.disconnected();
  assert.deepEqual(timers.map(timer => timer.delay), [500]);

  for (let index = 0; index < 3; index++) {
    timers[index].callback();
    controller.disconnected();
  }

  assert.deepEqual(timers.map(timer => timer.delay), [500, 1000, 2000]);
  assert.equal(attempts.length, 3);
  assert.equal(exhausted, 1);
  assert.equal(controller.active, false);

  controller.disconnected();
  assert.equal(timers.length, 3);
});

test('valid welcomes do not reset recovery attempts before authoritative progression', () => {
  const timers = [];
  let attempts = 0;
  let exhausted = 0;
  let controller;
  controller = createReconnectController({
    delays: [1, 1, 1],
    attempt: () => {
      attempts++;
      controller.connected();
      controller.disconnected();
    },
    exhausted: () => exhausted++,
    setTimer: callback => {
      timers.push(callback);
      return callback;
    },
    clearTimer: () => {},
  });

  controller.connected();
  controller.disconnected();
  for (let cycle = 0; cycle < 6 && timers.length; cycle++) timers.shift()();

  assert.equal(attempts, 3);
  assert.equal(exhausted, 1);
  assert.equal(controller.active, false);
  assert.equal(timers.length, 0);
});

test('accepted authoritative progression clears recovery failure history', () => {
  const timers = [];
  let attempts = 0;
  let exhausted = 0;
  const controller = createReconnectController({
    delays: [1, 1],
    attempt: () => attempts++,
    exhausted: () => exhausted++,
    setTimer: callback => {
      timers.push(callback);
      return callback;
    },
    clearTimer: () => {},
  });

  controller.connected();
  controller.disconnected();
  timers.shift()();
  controller.connected();
  controller.stable();

  for (let failure = 0; failure < 2; failure++) {
    controller.disconnected();
    timers.shift()();
    controller.connected();
  }
  controller.disconnected();

  assert.equal(attempts, 3);
  assert.equal(exhausted, 1);
  assert.equal(controller.active, false);
});
