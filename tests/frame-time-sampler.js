export const MAX_FRAME_TIMESTAMPS = 10_000;

export function summarizeFrameTimes(timestamps, {budgetMs, minSamples} = {}) {
  if (!Array.isArray(timestamps)) {
    throw new TypeError('timestamps must be a dense array');
  }
  if (timestamps.length > MAX_FRAME_TIMESTAMPS) {
    throw new RangeError('timestamps cannot exceed 10000 samples');
  }
  for (let index = 0; index < timestamps.length; index += 1) {
    if (!Object.hasOwn(timestamps, index)) throw new TypeError('timestamps must be a dense array');
  }
  if (!Number.isFinite(budgetMs) || budgetMs <= 0) {
    throw new TypeError('budgetMs must be a finite positive number');
  }
  if (!Number.isSafeInteger(minSamples) || minSamples < 1 || minSamples >= MAX_FRAME_TIMESTAMPS) {
    throw new RangeError('minSamples must be a safe integer between 1 and 9999');
  }
  if (timestamps.some(timestamp => !Number.isFinite(timestamp))) {
    throw new TypeError('timestamps must contain only finite numbers');
  }
  const intervals = timestamps.slice(1).map((timestamp, index) => timestamp - timestamps[index]);
  if (intervals.some(interval => interval <= 0)) {
    throw new RangeError('timestamps must increase strictly');
  }
  if (intervals.length < minSamples) {
    throw new RangeError(`at least ${minSamples} frame intervals are required`);
  }
  const sorted = [...intervals].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  const medianMs = sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
  return {
    count: intervals.length,
    durationMs: timestamps.at(-1) - timestamps[0],
    minMs: sorted[0],
    medianMs,
    p95Ms: sorted[Math.ceil(sorted.length * 0.95) - 1],
    maxMs: sorted.at(-1),
    overBudgetCount: intervals.filter(interval => interval > budgetMs).length,
    budgetMs,
  };
}
