import assert from 'node:assert/strict';
import test from 'node:test';

let MAX_FRAME_TIMESTAMPS, summarizeFrameTimes;
try {
  ({MAX_FRAME_TIMESTAMPS, summarizeFrameTimes} = await import('./frame-time-sampler.js'));
} catch (error) {
  if (error.code !== 'ERR_MODULE_NOT_FOUND') throw error;
}

test('summarizes raw frame intervals and an explicit reference threshold', () => {
  assert.equal(typeof summarizeFrameTimes, 'function', 'frame-time sampler must exist');
  const summary = summarizeFrameTimes([10, 20, 32, 47, 67, 92], {
    budgetMs: 16,
    minSamples: 5,
  });

  assert.deepEqual(summary, {
    count: 5,
    durationMs: 82,
    minMs: 10,
    medianMs: 15,
    p95Ms: 25,
    maxMs: 25,
    overBudgetCount: 2,
    budgetMs: 16,
  });
});

test('rejects non-finite timestamps', () => {
  for (const timestamp of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
    assert.throws(
      () => summarizeFrameTimes([0, timestamp, 20], {budgetMs: 16, minSamples: 2}),
      /timestamps must contain only finite numbers/,
    );
  }
});

test('rejects timestamps that do not increase strictly', () => {
  for (const timestamps of [[0, 10, 10], [0, 10, 9]]) {
    assert.throws(
      () => summarizeFrameTimes(timestamps, {budgetMs: 16, minSamples: 2}),
      /timestamps must increase strictly/,
    );
  }
});

test('rejects unsafe sample counts and reference thresholds', () => {
  for (const budgetMs of [Number.NaN, Number.POSITIVE_INFINITY, 0, -1]) {
    assert.throws(
      () => summarizeFrameTimes([0, 10], {budgetMs, minSamples: 1}),
      /budgetMs must be a finite positive number/,
    );
  }
  for (const minSamples of [0, 1.5, MAX_FRAME_TIMESTAMPS]) {
    assert.throws(
      () => summarizeFrameTimes([0, 10], {budgetMs: 16, minSamples}),
      /minSamples must be a safe integer between 1 and 9999/,
    );
  }
});

test('rejects sparse arrays and hostile array-like objects', () => {
  const sparse = [0, 10, 20];
  delete sparse[1];
  let hostilePropertyRead = false;
  const hostile = {
    get length() {
      hostilePropertyRead = true;
      throw new Error('hostile getter executed');
    },
  };

  assert.throws(
    () => summarizeFrameTimes(sparse, {budgetMs: 16, minSamples: 2}),
    /timestamps must be a dense array/,
  );
  assert.throws(
    () => summarizeFrameTimes(hostile, {budgetMs: 16, minSamples: 2}),
    /timestamps must be a dense array/,
  );
  assert.equal(hostilePropertyRead, false);
});

test('rejects fewer frame intervals than the required minimum', () => {
  assert.throws(
    () => summarizeFrameTimes([0, 10], {budgetMs: 16, minSamples: 2}),
    /at least 2 frame intervals are required/,
  );
});

test('rejects timestamp capture beyond the fixed maximum', () => {
  const timestamps = Array.from({length: MAX_FRAME_TIMESTAMPS + 1}, (_, index) => index);
  assert.throws(
    () => summarizeFrameTimes(timestamps, {budgetMs: 16, minSamples: 1}),
    /timestamps cannot exceed 10000 samples/,
  );
});
