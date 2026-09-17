import assert from 'node:assert/strict';
import test from 'node:test';
import {createNetworkImpairment} from './network-impairment.js';

function virtualClock() {
  let now = 0;
  let nextId = 0;
  const timers = new Map();
  const runNext = () => {
    if (!timers.size) return false;
    const [id, timer] = [...timers].sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0];
    timers.delete(id);
    now = Math.max(now, timer.at);
    timer.callback();
    return true;
  };
  return {
    now: () => now,
    setTimer(callback, delay) {
      const id = ++nextId;
      timers.set(id, {at: now + delay, callback});
      return id;
    },
    clearTimer: id => timers.delete(id),
    jump(milliseconds) {
      now += milliseconds;
    },
    runNext,
    run() { while (runNext()); },
  };
}

function deterministicRun(seed = 7319) {
  const clock = virtualClock();
  const delivered = [];
  const impairment = createNetworkImpairment({
    seed,
    latencyMs: 20,
    jitterMs: 7,
    rules: [],
    maxQueuedPackets: 8,
    maxDelayedAgeMs: 100,
    maxTimers: 8,
    teardownDeadlineMs: 50,
  }, {
    ...clock,
    deliver: packet => delivered.push({at: clock.now(), ...packet}),
  });
  impairment.enqueue({direction: 'client-to-server', className: 'input', payload: 'one'});
  impairment.enqueue({direction: 'client-to-server', className: 'input', payload: 'two'});
  impairment.enqueue({direction: 'server-to-client', className: 'state', payload: 'three'});
  clock.run();
  return delivered;
}

test('identical seeds and packet input reproduce the exact schedule', () => {
  assert.deepEqual(deterministicRun(), deterministicRun());
  assert.notDeepEqual(deterministicRun(7319), deterministicRun(7320));
});

test('zero impairment preserves packet order, bytes, and metadata', () => {
  const clock = virtualClock();
  const delivered = [];
  const impairment = createNetworkImpairment({
    seed: 1,
    latencyMs: 0,
    jitterMs: 0,
    rules: [],
    maxQueuedPackets: 3,
    maxDelayedAgeMs: 10,
    maxTimers: 3,
    teardownDeadlineMs: 10,
  }, {...clock, deliver: packet => delivered.push(packet)});
  const binary = Buffer.from([0, 255, 17]);
  const packets = [
    {direction: 'client-to-server', className: 'join', payload: 'text'},
    {direction: 'server-to-client', className: 'state', payload: binary},
  ];
  packets.forEach(packet => impairment.enqueue(packet));
  clock.run();

  assert.deepEqual(delivered, packets);
  assert.equal(delivered[1].payload, binary);
});

test('selected drop ordinals affect only the matching class and direction', () => {
  const clock = virtualClock();
  const delivered = [];
  const impairment = createNetworkImpairment({
    seed: 2,
    latencyMs: 0,
    jitterMs: 0,
    rules: [{direction: 'client-to-server', className: 'input', dropOrdinals: [2]}],
    maxQueuedPackets: 6,
    maxDelayedAgeMs: 10,
    maxTimers: 6,
    teardownDeadlineMs: 10,
  }, {...clock, deliver: packet => delivered.push(packet.payload)});
  impairment.enqueue({direction: 'client-to-server', className: 'input', payload: 'input-1'});
  impairment.enqueue({direction: 'server-to-client', className: 'input', payload: 'other-direction'});
  impairment.enqueue({direction: 'client-to-server', className: 'join', payload: 'other-class'});
  impairment.enqueue({direction: 'client-to-server', className: 'input', payload: 'input-2'});
  impairment.enqueue({direction: 'client-to-server', className: 'input', payload: 'input-3'});
  clock.run();

  assert.deepEqual(delivered, ['input-1', 'other-direction', 'other-class', 'input-3']);
  assert.equal(impairment.stats.dropped, 1);
});

test('selected duplicate ordinals deliver one bounded extra copy', () => {
  const clock = virtualClock();
  const delivered = [];
  const impairment = createNetworkImpairment({
    seed: 3,
    latencyMs: 4,
    jitterMs: 0,
    rules: [{direction: 'client-to-server', className: 'input', duplicateOrdinals: [1]}],
    maxQueuedPackets: 4,
    maxDelayedAgeMs: 20,
    maxTimers: 4,
    teardownDeadlineMs: 10,
  }, {...clock, deliver: packet => delivered.push(packet)});
  const packet = {direction: 'client-to-server', className: 'input', payload: Buffer.from([7])};
  impairment.enqueue(packet);
  clock.run();

  assert.deepEqual(delivered, [packet, packet]);
  assert.equal(impairment.stats.duplicated, 1);
});

test('selected reorder ordinals add a finite delay window', () => {
  const clock = virtualClock();
  const delivered = [];
  const impairment = createNetworkImpairment({
    seed: 4,
    latencyMs: 5,
    jitterMs: 0,
    rules: [{direction: 'server-to-client', className: 'delta', reorderOrdinals: [1], reorderDelayMs: 10}],
    maxQueuedPackets: 3,
    maxDelayedAgeMs: 20,
    maxTimers: 3,
    teardownDeadlineMs: 10,
  }, {...clock, deliver: packet => delivered.push({payload: packet.payload, at: clock.now()})});
  impairment.enqueue({direction: 'server-to-client', className: 'delta', payload: 'held'});
  impairment.enqueue({direction: 'server-to-client', className: 'delta', payload: 'newer'});
  clock.run();

  assert.deepEqual(delivered, [{payload: 'newer', at: 5}, {payload: 'held', at: 15}]);
  assert.equal(impairment.stats.reordered, 1);
});

test('invalid configuration and unsafe numeric inputs are rejected generically', () => {
  const clock = virtualClock();
  const dependencies = {...clock, deliver() {}};
  const valid = {
    seed: 5,
    latencyMs: 5,
    jitterMs: 2,
    rules: [],
    maxQueuedPackets: 4,
    maxDelayedAgeMs: 20,
    maxTimers: 4,
    teardownDeadlineMs: 10,
  };
  const invalid = [
    {...valid, seed: Number.MAX_SAFE_INTEGER + 1},
    {...valid, latencyMs: -1},
    {...valid, jitterMs: Infinity},
    {...valid, maxQueuedPackets: 0},
    {...valid, maxDelayedAgeMs: 4},
    {...valid, maxTimers: 0},
    {...valid, teardownDeadlineMs: NaN},
    {...valid, rules: [{direction: 'external', className: 'input'}]},
    {...valid, rules: [{direction: 'client-to-server', className: '', dropOrdinals: [1]}]},
    {...valid, rules: [{direction: 'client-to-server', className: 'input', dropOrdinals: [0]}]},
  ];
  for (const config of invalid) {
    assert.throws(
      () => createNetworkImpairment(config, dependencies),
      error => error instanceof TypeError && error.message === 'Invalid network impairment configuration',
    );
  }
});

test('queue overflow fails closed, observes resource-close rejection, and cancels delivery', async () => {
  const clock = virtualClock();
  const delivered = [];
  const impairment = createNetworkImpairment({
    seed: 6,
    latencyMs: 10,
    jitterMs: 0,
    rules: [],
    maxQueuedPackets: 1,
    maxDelayedAgeMs: 20,
    maxTimers: 2,
    teardownDeadlineMs: 10,
  }, {
    ...clock,
    deliver: packet => delivered.push(packet),
    closeResource: () => Promise.reject(new Error('close failed')),
  });
  impairment.enqueue({direction: 'client-to-server', className: 'input', payload: 'first'});
  assert.throws(
    () => impairment.enqueue({direction: 'client-to-server', className: 'input', payload: 'overflow'}),
    /Network impairment queue limit exceeded/,
  );
  await assert.rejects(impairment.close(), /close failed/);
  clock.run();

  assert.deepEqual(delivered, []);
  assert.equal(impairment.closed, true);
  assert.equal(impairment.pendingCount, 0);
});

test('timer overflow fails closed before a duplicate can escape', () => {
  const clock = virtualClock();
  const delivered = [];
  const impairment = createNetworkImpairment({
    seed: 7,
    latencyMs: 10,
    jitterMs: 0,
    rules: [{direction: 'client-to-server', className: 'input', duplicateOrdinals: [1]}],
    maxQueuedPackets: 3,
    maxDelayedAgeMs: 20,
    maxTimers: 1,
    teardownDeadlineMs: 10,
  }, {...clock, deliver: packet => delivered.push(packet)});
  assert.throws(
    () => impairment.enqueue({direction: 'client-to-server', className: 'input', payload: 'duplicate'}),
    /Network impairment timer limit exceeded/,
  );
  clock.run();

  assert.deepEqual(delivered, []);
  assert.equal(impairment.closed, true);
});

test('packets older than the delayed-age ceiling observe resource-close rejection', async () => {
  const clock = virtualClock();
  const delivered = [];
  const impairment = createNetworkImpairment({
    seed: 8,
    latencyMs: 5,
    jitterMs: 0,
    rules: [],
    maxQueuedPackets: 2,
    maxDelayedAgeMs: 10,
    maxTimers: 2,
    teardownDeadlineMs: 10,
  }, {
    ...clock,
    deliver: packet => delivered.push(packet),
    closeResource: () => Promise.reject(new Error('close failed')),
  });
  impairment.enqueue({direction: 'server-to-client', className: 'state', payload: 'stale'});
  clock.jump(11);
  clock.runNext();
  await assert.rejects(impairment.close(), /close failed/);
  clock.run();

  assert.deepEqual(delivered, []);
  assert.equal(impairment.closed, true);
  assert.equal(impairment.stats.expired, 1);
});

test('teardown is idempotent, rejects pending waits, and prevents post-close delivery', async () => {
  const clock = virtualClock();
  const delivered = [];
  const impairment = createNetworkImpairment({
    seed: 9,
    latencyMs: 5,
    jitterMs: 0,
    rules: [],
    maxQueuedPackets: 2,
    maxDelayedAgeMs: 10,
    maxTimers: 2,
    teardownDeadlineMs: 10,
  }, {...clock, deliver: packet => delivered.push(packet)});
  impairment.enqueue({direction: 'server-to-client', className: 'state', payload: 'pending'});
  const pending = impairment.waitForIdle();
  const firstClose = impairment.close();
  const secondClose = impairment.close();

  assert.equal(secondClose, firstClose);
  await assert.rejects(pending, /Network impairment closed/);
  await firstClose;
  clock.run();
  assert.deepEqual(delivered, []);
  assert.equal(impairment.pendingCount, 0);
});

test('delivery failures reject idle waiters and fail closed without retaining timers', async () => {
  const clock = virtualClock();
  const impairment = createNetworkImpairment({
    seed: 10,
    latencyMs: 0,
    jitterMs: 0,
    rules: [],
    maxQueuedPackets: 1,
    maxDelayedAgeMs: 10,
    maxTimers: 1,
    teardownDeadlineMs: 10,
  }, {...clock, deliver: () => { throw new Error('delivery failed'); }});
  impairment.enqueue({direction: 'server-to-client', className: 'state', payload: 'packet'});
  const idle = assert.rejects(impairment.waitForIdle(), /delivery failed/);
  clock.run();

  await idle;
  await impairment.close();
  assert.equal(impairment.closed, true);
  assert.equal(impairment.pendingCount, 0);
  assert.equal(impairment.stats.delivered, 0);
});
