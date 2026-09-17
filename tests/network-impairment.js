function nextRandom(state) {
  let value = state.value | 0;
  value ^= value << 13;
  value ^= value >>> 17;
  value ^= value << 5;
  state.value = value | 0;
  return (value >>> 0) / 0x100000000;
}

const directions = new Set(['client-to-server', 'server-to-client']);
const configKeys = new Set(['seed', 'latencyMs', 'jitterMs', 'rules', 'maxQueuedPackets', 'maxDelayedAgeMs', 'maxTimers', 'teardownDeadlineMs']);
const ruleKeys = new Set(['direction', 'className', 'dropOrdinals', 'duplicateOrdinals', 'reorderOrdinals', 'reorderDelayMs']);

function failConfiguration() {
  throw new TypeError('Invalid network impairment configuration');
}

function isSafeNonnegative(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

function validOrdinals(value) {
  return value === undefined || (Array.isArray(value)
    && value.length <= 1024
    && new Set(value).size === value.length
    && value.every(ordinal => Number.isSafeInteger(ordinal) && ordinal > 0));
}

function validateConfiguration(config, dependencies) {
  if (!config || typeof config !== 'object' || Array.isArray(config)
      || Object.keys(config).some(key => !configKeys.has(key))
      || !Number.isSafeInteger(config.seed)
      || !isSafeNonnegative(config.latencyMs)
      || !isSafeNonnegative(config.jitterMs)
      || !Number.isSafeInteger(config.maxQueuedPackets) || config.maxQueuedPackets < 1
      || !Number.isSafeInteger(config.maxDelayedAgeMs) || config.maxDelayedAgeMs < config.latencyMs + config.jitterMs
      || !Number.isSafeInteger(config.maxTimers) || config.maxTimers < 1
      || !Number.isSafeInteger(config.teardownDeadlineMs) || config.teardownDeadlineMs < 1
      || !Array.isArray(config.rules) || config.rules.length > 128
      || !dependencies || ['now', 'setTimer', 'clearTimer', 'deliver'].some(key => typeof dependencies[key] !== 'function')
      || (dependencies.closeResource !== undefined && typeof dependencies.closeResource !== 'function')) {
    failConfiguration();
  }
  for (const rule of config.rules) {
    if (!rule || typeof rule !== 'object' || Array.isArray(rule)
        || Object.keys(rule).some(key => !ruleKeys.has(key))
        || !directions.has(rule.direction)
        || typeof rule.className !== 'string' || rule.className.length < 1 || rule.className.length > 64
        || !validOrdinals(rule.dropOrdinals)
        || !validOrdinals(rule.duplicateOrdinals)
        || !validOrdinals(rule.reorderOrdinals)
        || (rule.reorderOrdinals !== undefined && !isSafeNonnegative(rule.reorderDelayMs))
        || config.latencyMs + config.jitterMs + (rule.reorderDelayMs || 0) + (rule.duplicateOrdinals?.length ? 1 : 0) > config.maxDelayedAgeMs) {
      failConfiguration();
    }
  }
}

export function createNetworkImpairment(config, dependencies) {
  validateConfiguration(config, dependencies);
  const randomState = {value: config.seed};
  const ordinals = new Map();
  const stats = {dropped: 0, duplicated: 0, reordered: 0, expired: 0, delivered: 0};
  const timers = new Set();
  const idleWaiters = new Set();
  let closed = false;
  let closePromise = null;
  let terminalError = null;

  function settleIdle() {
    if (timers.size) return;
    for (const waiter of idleWaiters) waiter.resolve();
    idleWaiters.clear();
  }

  function beginClose(error) {
    if (closePromise) return closePromise;
    closed = true;
    terminalError = error;
    for (const timer of timers) dependencies.clearTimer(timer);
    timers.clear();
    for (const waiter of idleWaiters) waiter.reject(error);
    idleWaiters.clear();
    if (!dependencies.closeResource) closePromise = Promise.resolve();
    else closePromise = new Promise((resolve, reject) => {
      const deadline = dependencies.setTimer(() => reject(new Error('Network impairment teardown deadline exceeded')), config.teardownDeadlineMs);
      Promise.resolve().then(() => dependencies.closeResource()).then(
        () => { dependencies.clearTimer(deadline); resolve(); },
        failure => { dependencies.clearTimer(deadline); reject(failure); },
      );
    });
    return closePromise;
  }

  function close() {
    return beginClose(new Error('Network impairment closed'));
  }

  function schedule(packet, delay) {
    if (timers.size >= config.maxQueuedPackets) {
      void close().catch(() => {});
      throw new Error('Network impairment queue limit exceeded');
    }
    if (timers.size >= config.maxTimers) {
      void close().catch(() => {});
      throw new Error('Network impairment timer limit exceeded');
    }
    const queuedAt = dependencies.now();
    const timer = dependencies.setTimer(() => {
      timers.delete(timer);
      if (closed) return;
      if (dependencies.now() - queuedAt > config.maxDelayedAgeMs) {
        stats.expired++;
        void close().catch(() => {});
        return;
      }
      try {
        dependencies.deliver(packet);
        stats.delivered++;
      } catch (error) {
        const failure = error instanceof Error ? error : new Error('Network impairment delivery failed');
        void beginClose(failure).catch(() => {});
        return;
      }
      settleIdle();
    }, Math.max(0, delay));
    timers.add(timer);
  }

  const impairment = {
    enqueue(packet) {
      if (closed) throw new Error('Network impairment is closed');
      const rule = config.rules?.find(candidate => candidate.direction === packet.direction && candidate.className === packet.className);
      const key = `${packet.direction}\u0000${packet.className}`;
      const ordinal = (ordinals.get(key) || 0) + 1;
      ordinals.set(key, ordinal);
      if (rule?.dropOrdinals?.includes(ordinal)) {
        stats.dropped++;
        settleIdle();
        return;
      }
      const jitter = Math.round((nextRandom(randomState) * 2 - 1) * config.jitterMs);
      const reordered = rule?.reorderOrdinals?.includes(ordinal);
      if (reordered) stats.reordered++;
      const delay = config.latencyMs + jitter + (reordered ? rule.reorderDelayMs : 0);
      schedule(packet, delay);
      if (rule?.duplicateOrdinals?.includes(ordinal)) {
        stats.duplicated++;
        schedule(packet, delay + 1);
      }
    },
    close,
    waitForIdle() {
      if (closed) return Promise.reject(terminalError || new Error('Network impairment closed'));
      if (!timers.size) return Promise.resolve();
      return new Promise((resolve, reject) => idleWaiters.add({resolve, reject}));
    },
    get closed() { return closed; },
    get pendingCount() { return timers.size; },
    stats,
  };
  return impairment;
}
