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
