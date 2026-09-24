import {types} from 'node:util';

function boundedAttempt(action, timeoutMs, label, reportedTimeoutMs = timeoutMs) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`exceeded ${reportedTimeoutMs} ms`)), timeoutMs);
  });
  return Promise.race([Promise.resolve().then(action), timeout])
    .finally(() => clearTimeout(timer))
    .catch(cause => {
      throw new Error(`${label}: ${cause instanceof Error ? cause.message : String(cause)}`, {cause});
    });
}

function startCleanupAction(action, label, key, state) {
  const record = {key, label, status: 'pending'};
  record.promise = Promise.resolve().then(action);
  const records = state.records.get(key) ?? new Set();
  state.records.set(key, records);
  records.add(record);
  record.promise.then(
    () => {
      record.status = 'fulfilled';
      records.delete(record);
      if (!records.size) state.records.delete(key);
    },
    cause => {
      record.status = 'rejected';
      record.cause = cause;
    },
  );
  return record.promise;
}

function priorCleanupActions(state) {
  const prior = [];
  for (const records of state.records.values()) prior.push(...records);
  return prior;
}

export function createAcquisitionTracker({closeTimeoutMs}) {
  const inFlight = new Set();
  const failures = [];
  let closing = false;

  return {
    get size() {
      return inFlight.size;
    },

    acquire({label, timeoutMs, acquire, track, closeLate}) {
      if (closing) {
        const error = new Error(`${label} acquisition started during cleanup`);
        failures.push(error);
        return Promise.reject(error);
      }
      let timedOut = false;
      let timer;
      const timeoutError = new Error(`${label} acquisition exceeded ${timeoutMs} ms`);
      const settlement = Promise.resolve()
        .then(acquire)
        .then(async resource => {
          if (timedOut || closing) {
            try {
              await boundedAttempt(() => closeLate(resource), closeTimeoutMs, `${label} late resource close`);
            } catch (error) {
              failures.push(error);
            }
            return undefined;
          }
          track(resource);
          return resource;
        })
        .finally(() => inFlight.delete(settlement));
      inFlight.add(settlement);

      return Promise.race([
        settlement,
        new Promise((_, reject) => {
          timer = setTimeout(() => {
            timedOut = true;
            failures.push(timeoutError);
            reject(timeoutError);
          }, timeoutMs);
        }),
      ]).finally(() => clearTimeout(timer));
    },

    async drain(timeoutMs) {
      closing = true;
      const deadline = Date.now() + timeoutMs;
      while (inFlight.size) {
        const remainingMs = deadline - Date.now();
        if (remainingMs <= 0) {
          failures.push(new Error(`in-flight acquisition cleanup exceeded ${timeoutMs} ms`));
          break;
        }
        try {
          await boundedAttempt(
            () => Promise.allSettled([...inFlight]),
            remainingMs,
            'in-flight acquisition cleanup',
          );
        } catch (error) {
          failures.push(error);
          break;
        }
      }
      return failures.splice(0);
    },

    takeFailures() {
      return failures.splice(0);
    },
  };
}

export async function runWithCleanup(runJourney, cleanup) {
  let result;
  let journeyFailure;
  try {
    result = await runJourney();
  } catch (error) {
    journeyFailure = error;
  }

  let cleanupFailure;
  try {
    await cleanup();
  } catch (error) {
    cleanupFailure = error;
  }

  if (journeyFailure && cleanupFailure) {
    throw new AggregateError(
      [journeyFailure, cleanupFailure],
      'frame-time journey and cleanup both failed',
    );
  }
  if (journeyFailure) throw journeyFailure;
  if (cleanupFailure) throw cleanupFailure;
  return result;
}

export function createCleanupSession() {
  const state = {
    records: new Map(),
    actionTable: undefined,
    actionTableChanged: false,
  };
  const session = Object.freeze({
    cleanup(options) {
      if (this !== session) {
        return Promise.reject(new TypeError('cleanup session method requires its creating session'));
      }
      if (
        !options
        || typeof options !== 'object'
        || types.isProxy(options)
        || Object.getPrototypeOf(options) !== Object.prototype
        || Object.getOwnPropertyDescriptor(options, 'lifecycle')
      ) {
        return Promise.reject(
          new TypeError('cleanup session options must be a plain object without lifecycle state'),
        );
      }
      return cleanupResources(state, options);
    },
  });
  return session;
}

async function cleanupResources(state, options) {
  const {acquisitions, resources, removeTemporaryState, postconditions = [], timeoutMs} = options;
  const failures = [];
  const deadline = Date.now() + timeoutMs;
  const remainingMs = () => Math.max(0, deadline - Date.now());
  if (acquisitions) failures.push(...await acquisitions.drain(remainingMs()));
  const cleanupTargets = typeof resources === 'function' ? resources() : resources;
  const actionTable = [
    ...cleanupTargets.map((resource, index) => `resource:${index}:${resource.label}`),
    `temporary:0:${removeTemporaryState.label}`,
    ...postconditions.map((postcondition, index) => `postcondition:${index}:${postcondition.label}`),
  ];
  if (state.actionTable === undefined) {
    state.actionTable = actionTable;
  } else if (
    state.actionTable.length !== actionTable.length
    || state.actionTable.some((key, index) => key !== actionTable[index])
  ) {
    state.actionTableChanged = true;
  }
  if (state.actionTableChanged) failures.push(new Error('cleanup session action table changed'));
  const priorActions = priorCleanupActions(state);
  for (const prior of priorActions) {
    try {
      await boundedAttempt(
        () => prior.promise,
        remainingMs(),
        `${prior.label} prior cleanup action`,
        timeoutMs,
      );
    } catch (error) {
      failures.push(error);
    }
  }
  for (const [index, resource] of cleanupTargets.entries()) {
    try {
      const action = startCleanupAction(
        resource.close,
        resource.label,
        `resource:${index}:${resource.label}`,
        state,
      );
      await boundedAttempt(() => action, remainingMs(), resource.label, timeoutMs);
    } catch (error) {
      failures.push(error);
    }
  }

  try {
    const action = startCleanupAction(
      removeTemporaryState.run,
      removeTemporaryState.label,
      `temporary:0:${removeTemporaryState.label}`,
      state,
    );
    await boundedAttempt(() => action, remainingMs(), removeTemporaryState.label, timeoutMs);
  } catch (error) {
    failures.push(error);
  }

  for (const [index, postcondition] of postconditions.entries()) {
    try {
      const action = startCleanupAction(
        postcondition.check,
        postcondition.label,
        `postcondition:${index}:${postcondition.label}`,
        state,
      );
      const satisfied = await boundedAttempt(() => action, remainingMs(), postcondition.label, timeoutMs);
      if (!satisfied) throw new Error(`${postcondition.label}: postcondition failed`);
    } catch (error) {
      failures.push(error);
    }
  }

  if (acquisitions) failures.push(...acquisitions.takeFailures());

  if (failures.length) {
    throw new AggregateError(failures, `frame-time cleanup failed with ${failures.length} errors`);
  }
}
