import assert from 'node:assert/strict';
import test from 'node:test';

let createAcquisitionTracker;
let createCleanupSession;
let runWithCleanup;
try {
  ({createAcquisitionTracker, createCleanupSession, runWithCleanup} = await import('./frame-time-cleanup.js'));
} catch (error) {
  if (error.code !== 'ERR_MODULE_NOT_FOUND') throw error;
}

test('helper-owned cleanup session preserves pending work across recreated actions', async () => {
  assert.equal(typeof createCleanupSession, 'function', 'cleanup session factory must exist');
  const session = createCleanupSession();
  const unhandledRejections = [];
  const baselineTimers = process.getActiveResourcesInfo().filter(type => type === 'Timeout').length;
  const onUnhandledRejection = reason => unhandledRejections.push(reason);
  process.on('unhandledRejection', onUnhandledRejection);

  let settleOriginalClose;
  const originalClose = new Promise(resolve => {
    settleOriginalClose = resolve;
  });
  let closeCalls = 0;
  let temporaryCalls = 0;
  const cleanup = timeoutMs => session.cleanup({
    timeoutMs,
    resources: () => [{
      label: 'browser close',
      close: () => {
        closeCalls += 1;
        return closeCalls === 1 ? originalClose : Promise.resolve();
      },
    }],
    removeTemporaryState: {
      label: 'temporary state remove',
      run: () => {
        temporaryCalls += 1;
        return Promise.resolve();
      },
    },
  });

  try {
    await assert.rejects(cleanup(5), error => {
      assert(error instanceof AggregateError);
      assert.match(error.errors[0].message, /browser close: exceeded 5 ms/);
      return true;
    });
    await assert.rejects(cleanup(20), error => {
      assert(error instanceof AggregateError);
      assert.match(
        error.errors.map(failure => failure.message).join('\n'),
        /browser close prior cleanup action: exceeded 20 ms/,
      );
      return true;
    });
    assert.deepEqual(
      [closeCalls, temporaryCalls],
      [2, 2],
      'every recreated current action must still be initiated',
    );

    settleOriginalClose();
    await originalClose;
    await assert.doesNotReject(cleanup(20));
    assert.deepEqual([closeCalls, temporaryCalls], [3, 3]);
    await new Promise(resolve => setImmediate(resolve));
  } finally {
    process.off('unhandledRejection', onUnhandledRejection);
  }

  assert.deepEqual(unhandledRejections, []);
  assert.equal(
    process.getActiveResourcesInfo().filter(type => type === 'Timeout').length,
    baselineTimers,
    'helper-owned cleanup session must leave no timer behind',
  );
});

test('cleanup session rejects lifecycle impostors and proxies before action getters', async () => {
  const session = createCleanupSession();
  const expected = /cleanup session options must be a plain object without lifecycle state/;

  for (const lifecycleDescriptor of [
    {value: {replacement: true}, enumerable: true},
    {get: () => assert.fail('lifecycle getter must not run'), enumerable: true},
  ]) {
    let resourceGetterReads = 0;
    const options = {};
    Object.defineProperty(options, 'lifecycle', lifecycleDescriptor);
    Object.defineProperty(options, 'resources', {
      enumerable: true,
      get() {
        resourceGetterReads += 1;
        return [];
      },
    });
    await assert.rejects(session.cleanup(options), expected);
    assert.equal(resourceGetterReads, 0);
  }

  let proxyReads = 0;
  const proxy = new Proxy({}, {
    get() {
      proxyReads += 1;
      return undefined;
    },
    ownKeys() {
      proxyReads += 1;
      return [];
    },
  });
  await assert.rejects(session.cleanup(proxy), expected);
  assert.equal(proxyReads, 0, 'proxy traps must not inspect session or action state');

  const {proxy: revokedProxy, revoke} = Proxy.revocable({}, {});
  revoke();
  await assert.rejects(session.cleanup(revokedProxy), expected);
});

test('cleanup session rejects detached and rebound methods before action getters', async () => {
  const session = createCleanupSession();
  const detached = session.cleanup;
  const expected = /cleanup session method requires its creating session/;

  for (const invoke of [
    options => detached(options),
    options => detached.call({replacement: true}, options),
  ]) {
    let resourceGetterReads = 0;
    const options = {
      timeoutMs: 20,
      removeTemporaryState: {label: 'temporary state remove', run: async () => {}},
    };
    Object.defineProperty(options, 'resources', {
      enumerable: true,
      get() {
        resourceGetterReads += 1;
        return [];
      },
    });
    await assert.rejects(invoke(options), expected);
    assert.equal(resourceGetterReads, 0);
  }
});

test('cleanup attempts every close and temporary-state removal before rejecting with named failures', async () => {
  const session = createCleanupSession();
  const attempts = [];
  const neverSettles = new Promise(() => {});

  await assert.rejects(
    session.cleanup({
      timeoutMs: 20,
      resources: [
        {
          label: 'browser context close',
          close: async () => {
            attempts.push('context');
            throw new Error('context exploded');
          },
        },
        {
          label: 'browser close',
          close: async () => {
            attempts.push('browser');
            return neverSettles;
          },
        },
        {
          label: 'server close',
          close: async () => {
            attempts.push('server');
          },
        },
      ],
      removeTemporaryState: {
        label: 'temporary state remove',
        run: async () => {
          attempts.push('temporary');
        },
      },
    }),
    error => {
      assert(error instanceof AggregateError);
      assert.match(error.message, /frame-time cleanup failed with 2 errors/);
      const evidence = error.errors.map(failure => failure.message).join('\n');
      assert.match(evidence, /browser context close: context exploded/);
      assert.match(evidence, /browser close: exceeded 20 ms/);
      return true;
    },
  );

  assert.deepEqual(attempts, ['context', 'browser', 'server', 'temporary']);
});

test('explicit postconditions determine cleanup success', async () => {
  const session = createCleanupSession();
  const options = {
    timeoutMs: 20,
    resources: [],
    removeTemporaryState: {label: 'temporary state remove', run: async () => {}},
  };

  await assert.doesNotReject(session.cleanup({
    ...options,
    postconditions: [
      {label: 'server stopped', check: async () => true},
      {label: 'temporary directory removed', check: async () => true},
    ],
  }));

  await assert.rejects(
    session.cleanup({
      ...options,
      postconditions: [
        {label: 'server stopped', check: async () => false},
        {label: 'temporary directory removed', check: async () => true},
      ],
    }),
    error => {
      assert(error instanceof AggregateError);
      assert.match(error.errors[0].message, /server stopped: postcondition failed/);
      return true;
    },
  );
});

test('late browser, context, and page acquisitions close before cleanup reports their timeouts', async () => {
  assert.equal(typeof createAcquisitionTracker, 'function', 'acquisition tracker must exist');
  const session = createCleanupSession();
  const tracked = [];
  const attempts = [];
  const tracker = createAcquisitionTracker({closeTimeoutMs: 20});
  const levels = ['browser launch', 'browser context', 'page'];
  const deferred = levels.map(label => {
    let fulfill;
    const acquired = new Promise(resolve => {
      fulfill = resolve;
    });
    const resource = {
      close: async () => attempts.push(`late ${label} close`),
    };
    const acquisition = tracker.acquire({
      label,
      timeoutMs: 10,
      acquire: async () => acquired,
      track: value => tracked.push(value),
      closeLate: value => value.close(),
    });
    return {acquisition, fulfill, resource};
  });
  await Promise.all(deferred.map(({acquisition}, index) => (
    assert.rejects(acquisition, new RegExp(`${levels[index]} acquisition exceeded 10 ms`))
  )));
  setTimeout(() => deferred.forEach(({fulfill, resource}) => fulfill(resource)), 5);

  await assert.rejects(
    session.cleanup({
      acquisitions: tracker,
      timeoutMs: 50,
      resources: [],
      removeTemporaryState: {
        label: 'temporary state remove',
        run: async () => attempts.push('temporary'),
      },
      postconditions: [
        {label: 'in-flight acquisitions drained', check: async () => tracker.size === 0},
        {label: 'tracked browsers released', check: async () => tracked.length === 0},
      ],
    }),
    error => {
      assert(error instanceof AggregateError);
      const evidence = error.errors.map(failure => failure.message).join('\n');
      for (const label of levels) assert.match(evidence, new RegExp(`${label} acquisition exceeded 10 ms`));
      return true;
    },
  );

  assert.deepEqual(attempts, [
    'late browser launch close',
    'late browser context close',
    'late page close',
    'temporary',
  ]);
  assert.equal(tracker.size, 0);
  assert.deepEqual(tracked, []);
});

test('cleanup closes an acquisition that fulfills after outer journey rejection', async () => {
  let fulfillAcquisition;
  const acquired = new Promise(resolve => {
    fulfillAcquisition = resolve;
  });
  const tracked = [];
  const attempts = [];
  const tracker = createAcquisitionTracker({closeTimeoutMs: 20});
  const acquisition = tracker.acquire({
    label: 'browser context',
    timeoutMs: 100,
    acquire: async () => acquired,
    track: context => tracked.push(context),
    closeLate: async () => attempts.push('late context close'),
  });
  setTimeout(() => fulfillAcquisition({}), 5);

  await assert.deepEqual(await tracker.drain(50), []);
  assert.equal(await acquisition, undefined);
  assert.deepEqual(attempts, ['late context close']);
  assert.deepEqual(tracked, []);
  assert.equal(tracker.size, 0);
});

test('journey and cleanup failures survive together with named causes', async () => {
  assert.equal(typeof runWithCleanup, 'function', 'journey cleanup wrapper must exist');
  const journeyFailure = new Error('journey exploded');
  const cleanupFailure = new Error('cleanup exploded');

  await assert.rejects(
    runWithCleanup(
      async () => { throw journeyFailure; },
      async () => { throw cleanupFailure; },
    ),
    error => {
      assert(error instanceof AggregateError);
      assert.match(error.message, /frame-time journey and cleanup both failed/);
      assert.deepEqual(error.errors, [journeyFailure, cleanupFailure]);
      return true;
    },
  );
});

test('never-settling acquisition remains visible and fails every cleanup attempt', async () => {
  const tracker = createAcquisitionTracker({closeTimeoutMs: 20});
  const session = createCleanupSession();
  const acquisition = tracker.acquire({
    label: 'browser launch',
    timeoutMs: 10,
    acquire: async () => new Promise(() => {}),
    track: () => assert.fail('never-settling acquisition must not be tracked'),
    closeLate: () => assert.fail('never-settling acquisition must not close'),
  });

  await assert.rejects(acquisition, /browser launch acquisition exceeded 10 ms/);
  assert.equal(tracker.size, 1);

  for (const attempt of ['first', 'second']) {
    await assert.rejects(
      session.cleanup({
        acquisitions: tracker,
        timeoutMs: 20,
        resources: [],
        removeTemporaryState: {label: 'temporary state remove', run: async () => {}},
      }),
      error => {
        assert(error instanceof AggregateError, `${attempt} cleanup must reject`);
        assert.match(
          error.errors.map(failure => failure.message).join('\n'),
          /in-flight acquisition cleanup.*exceeded 20 ms/,
        );
        return true;
      },
    );
    assert.equal(tracker.size, 1, `${attempt} cleanup must preserve unresolved work`);
  }
});

test('acquisition attempted by a cleanup action fails that cleanup with its named cause', async () => {
  const tracker = createAcquisitionTracker({closeTimeoutMs: 20});
  const session = createCleanupSession();
  let caughtAcquisitionFailure;

  await assert.rejects(
    session.cleanup({
      acquisitions: tracker,
      timeoutMs: 20,
      resources: [{
        label: 'browser close',
        close: async () => {
          try {
            await tracker.acquire({
              label: 'page',
              timeoutMs: 10,
              acquire: async () => assert.fail('closing mode must prevent acquisition'),
              track: () => assert.fail('closing mode must prevent tracking'),
              closeLate: () => assert.fail('closing mode must prevent late close'),
            });
          } catch (error) {
            caughtAcquisitionFailure = error;
          }
        },
      }],
      removeTemporaryState: {label: 'temporary state remove', run: async () => {}},
    }),
    error => {
      assert(error instanceof AggregateError);
      assert.deepEqual(error.errors, [caughtAcquisitionFailure]);
      assert.match(error.errors[0].message, /page acquisition started during cleanup/);
      return true;
    },
  );
});

test('cleanup shares one absolute deadline across every unresolved action', async () => {
  const session = createCleanupSession();
  const timeoutMs = 25;
  const toleranceMs = 45;
  const attempts = [];
  const unhandledRejections = [];
  const neverSettles = () => new Promise(() => {});
  const baselineTimers = process.getActiveResourcesInfo().filter(type => type === 'Timeout').length;
  const onUnhandledRejection = reason => unhandledRejections.push(reason);
  process.on('unhandledRejection', onUnhandledRejection);

  let failure;
  const startedAt = performance.now();
  try {
    await session.cleanup({
      timeoutMs,
      resources: ['browser context close', 'browser close'].map(label => ({
        label,
        close: () => {
          attempts.push(label);
          return neverSettles();
        },
      })),
      removeTemporaryState: {
        label: 'temporary state remove',
        run: () => {
          attempts.push('temporary state remove');
          return neverSettles();
        },
      },
      postconditions: [{
        label: 'temporary directory removed',
        check: () => {
          attempts.push('temporary directory removed');
          return neverSettles();
        },
      }],
    });
  } catch (error) {
    failure = error;
  } finally {
    process.off('unhandledRejection', onUnhandledRejection);
  }
  const elapsedMs = performance.now() - startedAt;

  assert(failure instanceof AggregateError);
  assert.deepEqual(attempts, [
    'browser context close',
    'browser close',
    'temporary state remove',
    'temporary directory removed',
  ]);
  assert.deepEqual(
    failure.errors.map(error => error.message.split(':')[0]),
    attempts,
    'every initiated unresolved action must retain named failure evidence',
  );
  assert(
    elapsedMs <= timeoutMs + toleranceMs,
    `cleanup took ${elapsedMs} ms; expected at most ${timeoutMs + toleranceMs} ms `
      + `(${timeoutMs} ms deadline + ${toleranceMs} ms tolerance)`,
  );
  assert.deepEqual(unhandledRejections, []);
  assert.equal(
    process.getActiveResourcesInfo().filter(type => type === 'Timeout').length,
    baselineTimers,
    'cleanup must leave no timer behind',
  );
});

test('cleanup preserves timed-out action settlement truth across repeated calls', async () => {
  const session = createCleanupSession();
  const unhandledRejections = [];
  const baselineTimers = process.getActiveResourcesInfo().filter(type => type === 'Timeout').length;
  const onUnhandledRejection = reason => unhandledRejections.push(reason);
  process.on('unhandledRejection', onUnhandledRejection);

  let settleOriginalClose;
  const originalClose = new Promise(resolve => {
    settleOriginalClose = resolve;
  });
  let closeCalls = 0;
  const resource = {
    label: 'browser close',
    close: () => {
      closeCalls += 1;
      return closeCalls === 1 ? originalClose : Promise.resolve();
    },
  };
  const cleanup = timeoutMs => session.cleanup({
    timeoutMs,
    resources: [resource],
    removeTemporaryState: {label: 'temporary state remove', run: async () => {}},
  });

  try {
    await assert.rejects(
      cleanup(5),
      error => {
        assert(error instanceof AggregateError);
        assert.match(error.errors[0].message, /browser close: exceeded 5 ms/);
        return true;
      },
    );
    assert.equal(closeCalls, 1);

    await assert.rejects(
      cleanup(20),
      error => {
        assert(error instanceof AggregateError);
        assert.match(
          error.errors.map(failure => failure.message).join('\n'),
          /browser close.*exceeded 20 ms/,
          'the unresolved original close must remain observable',
        );
        return true;
      },
    );
    assert.equal(closeCalls, 2, 'current authorized close must still be initiated');

    settleOriginalClose();
    await originalClose;
    await assert.doesNotReject(cleanup(20));
    assert.equal(closeCalls, 3);
    await new Promise(resolve => setImmediate(resolve));
  } finally {
    process.off('unhandledRejection', onUnhandledRejection);
  }

  assert.deepEqual(unhandledRejections, []);
  assert.equal(
    process.getActiveResourcesInfo().filter(type => type === 'Timeout').length,
    baselineTimers,
    'repeated cleanup must leave no timer behind',
  );
});

test('cleanup session preserves pending work across recreated action wrappers', async () => {
  const session = createCleanupSession();
  const unhandledRejections = [];
  const baselineTimers = process.getActiveResourcesInfo().filter(type => type === 'Timeout').length;
  const onUnhandledRejection = reason => unhandledRejections.push(reason);
  process.on('unhandledRejection', onUnhandledRejection);

  let settleOriginalClose;
  const originalClose = new Promise(resolve => {
    settleOriginalClose = resolve;
  });
  let closeCalls = 0;
  let temporaryCalls = 0;
  const cleanup = timeoutMs => session.cleanup({
    timeoutMs,
    resources: () => [{
      label: 'browser close',
      close: () => {
        closeCalls += 1;
        return closeCalls === 1 ? originalClose : Promise.resolve();
      },
    }],
    removeTemporaryState: {
      label: 'temporary state remove',
      run: () => {
        temporaryCalls += 1;
        return Promise.resolve();
      },
    },
  });

  try {
    await assert.rejects(cleanup(5), error => {
      assert(error instanceof AggregateError);
      assert.match(error.errors[0].message, /browser close: exceeded 5 ms/);
      return true;
    });
    assert.deepEqual([closeCalls, temporaryCalls], [1, 1]);

    await assert.rejects(cleanup(20), error => {
      assert(error instanceof AggregateError);
      assert.match(
        error.errors.map(failure => failure.message).join('\n'),
        /browser close prior cleanup action: exceeded 20 ms/,
        'the session must expose the original pending close',
      );
      return true;
    });
    assert.deepEqual(
      [closeCalls, temporaryCalls],
      [2, 2],
      'every current authorized action must still be initiated',
    );

    settleOriginalClose();
    await originalClose;
    await assert.doesNotReject(cleanup(20));
    assert.deepEqual([closeCalls, temporaryCalls], [3, 3]);
    await new Promise(resolve => setImmediate(resolve));
  } finally {
    process.off('unhandledRejection', onUnhandledRejection);
  }

  assert.deepEqual(unhandledRejections, []);
  assert.equal(
    process.getActiveResourcesInfo().filter(type => type === 'Timeout').length,
    baselineTimers,
    'recreated-wrapper cleanup must leave no timer behind',
  );
});

test('cleanup session keeps same-label aliased actions separate by position', async () => {
  const session = createCleanupSession();
  let settleFirst;
  const firstClose = new Promise(resolve => {
    settleFirst = resolve;
  });
  let closeCalls = 0;
  const sharedResource = {
    label: 'shared close',
    close: () => {
      closeCalls += 1;
      return closeCalls === 1 ? firstClose : Promise.resolve();
    },
  };
  const cleanup = timeoutMs => session.cleanup({
    timeoutMs,
    resources: [sharedResource, sharedResource],
    removeTemporaryState: {label: 'temporary state remove', run: async () => {}},
  });

  await assert.rejects(cleanup(5), /frame-time cleanup failed/);
  assert.equal(closeCalls, 2, 'both aliased positions must start independently');
  await assert.rejects(cleanup(20), error => {
    assert.match(
      error.errors.map(failure => failure.message).join('\n'),
      /shared close prior cleanup action: exceeded 20 ms/,
    );
    return true;
  });
  assert.equal(closeCalls, 4, 'both current aliased positions must still start');

  settleFirst();
  await firstClose;
  await assert.doesNotReject(cleanup(20));
  assert.equal(closeCalls, 6);
});

test('separate cleanup sessions do not merge settlement state', async () => {
  const firstSession = createCleanupSession();
  const secondSession = createCleanupSession();
  let settleFirst;
  const firstClose = new Promise(resolve => {
    settleFirst = resolve;
  });
  const options = close => ({
    timeoutMs: 5,
    resources: [{label: 'browser close', close}],
    removeTemporaryState: {label: 'temporary state remove', run: async () => {}},
  });

  await assert.rejects(firstSession.cleanup(options(() => firstClose)), /frame-time cleanup failed/);
  await assert.doesNotReject(secondSession.cleanup(options(async () => {})));
  await assert.rejects(
    firstSession.cleanup(options(async () => {})),
    /frame-time cleanup failed/,
    'the second session must not settle or validate the first session',
  );

  settleFirst();
  await firstClose;
  await assert.doesNotReject(firstSession.cleanup(options(async () => {})));
});

test('cleanup session stays compromised after inserted and removed action-table entries', async () => {
  for (const mutate of [
    labels => ['inserted close', ...labels],
    labels => labels.slice(0, -1),
  ]) {
    const session = createCleanupSession();
    const originalLabels = ['first close', 'second close'];
    let labels = originalLabels;
    const cleanup = () => session.cleanup({
      timeoutMs: 20,
      resources: labels.map(label => ({label, close: async () => {}})),
      removeTemporaryState: {label: 'temporary state remove', run: async () => {}},
    });

    await assert.doesNotReject(cleanup());
    labels = mutate(originalLabels);
    await assert.rejects(cleanup(), /frame-time cleanup failed/);
    labels = originalLabels;
    await assert.rejects(
      cleanup(),
      /frame-time cleanup failed/,
      'restoring the original table must not clear session compromise',
    );
  }
});

test('cleanup session fails closed when the action table is reordered', async () => {
  const session = createCleanupSession();
  const attempts = [];
  let labels = ['first close', 'second close'];
  const cleanup = () => session.cleanup({
    timeoutMs: 20,
    resources: labels.map(label => ({
      label,
      close: async () => attempts.push(label),
    })),
    removeTemporaryState: {label: 'temporary state remove', run: async () => {}},
  });

  await assert.doesNotReject(cleanup());
  labels = [...labels].reverse();
  await assert.rejects(cleanup(), error => {
    assert.match(error.errors[0].message, /cleanup session action table changed/);
    return true;
  });
  assert.deepEqual(attempts, ['first close', 'second close', 'second close', 'first close']);
  labels = [...labels].reverse();
  await assert.rejects(cleanup(), error => {
    assert.match(error.errors[0].message, /cleanup session action table changed/);
    return true;
  });
  assert.deepEqual(
    attempts,
    ['first close', 'second close', 'second close', 'first close', 'first close', 'second close'],
    'a compromised session must remain failed closed while starting current actions',
  );
});

test('cleanup session fails closed when an action-table entry changes', async () => {
  const session = createCleanupSession();
  let label = 'browser close';
  let closeCalls = 0;
  const cleanup = () => session.cleanup({
    timeoutMs: 20,
    resources: [{label, close: async () => { closeCalls += 1; }}],
    removeTemporaryState: {label: 'temporary state remove', run: async () => {}},
  });

  await assert.doesNotReject(cleanup());
  label = 'server close';
  await assert.rejects(cleanup(), error => {
    assert.match(error.errors[0].message, /cleanup session action table changed/);
    return true;
  });
  assert.equal(closeCalls, 2, 'changed current action must still be initiated');
});
