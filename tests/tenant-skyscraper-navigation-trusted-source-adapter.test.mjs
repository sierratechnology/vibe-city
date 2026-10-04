import assert from 'node:assert/strict';
import test from 'node:test';

const MODULE_PATH = '../server/tenantSkyscraperNavigationTrustedSourceAdapter.mjs';
const BUILDING = 'id_0000000000000001';
const FLOOR = 'id_0000000000000002';
const STOP = 'id_0000000000000003';
const TENANT = 'id_0000000000000010';
const DESTINATION = 'id_0000000000000020';
const SUBJECT = 'id_0000000000000030';
const SESSION = 'id_0000000000000031';
const AUTHORIZATION_REFERENCE = 'id_0000000000000032';

async function loadAdapter() {
  return import(MODULE_PATH).catch(() => ({}));
}

async function loadFreshAdapter(fragment) {
  return import(`${MODULE_PATH}?${fragment}`);
}

function request(channel = 'door') {
  return {
    schemaVersion: '1.0',
    sessionCredential: 'session_0000000000000001',
    navigation: {
      schemaVersion: '1.0',
      channel,
      buildingId: BUILDING,
      floorId: FLOOR,
      elevatorStopId: STOP,
      destinationId: DESTINATION,
    },
  };
}

function trustedState() {
  const suites = [1, 2, 3, 4].map((number) => ({
    destinationId: `id_000000000000010${number}`,
    floorId: FLOOR,
    displayName: `Synthetic Suite ${number}`,
    lifecycle: 'active',
    destinationKind: 'suite',
    accessState: 'tenant',
    ownerTenantId: TENANT,
    sharedSpacePolicy: 'not_shared',
  }));
  return {
    catalog: {
      schemaVersion: '1.0',
      building: {
        buildingId: BUILDING,
        displayName: 'Synthetic Tower',
        lifecycle: 'active',
        floors: [{
          floorId: FLOOR,
          buildingId: BUILDING,
          displayName: 'Synthetic Floor',
          lifecycle: 'active',
          floorKind: 'customer',
          elevatorStopId: STOP,
          destinations: [...suites, {
            destinationId: DESTINATION,
            floorId: FLOOR,
            displayName: 'Synthetic Lobby',
            lifecycle: 'active',
            destinationKind: 'shared_space',
            accessState: 'public',
            ownerTenantId: null,
            sharedSpacePolicy: 'building_public',
          }],
        }],
      },
    },
    authorization: {
      kind: 'trusted-server-context',
      authenticatedSubjectId: SUBJECT,
      authenticatedSessionId: SESSION,
      ownerTenantLifecycles: [{ tenantId: TENANT, lifecycle: 'active' }],
      activeTenantMembership: { tenantId: TENANT, subjectId: SUBJECT, active: true },
      privateDestinationGrants: [],
      invitation: null,
      restrictedDestinationAuthorities: [],
      authorizationReference: AUTHORIZATION_REFERENCE,
      policyRevision: 7,
    },
    evaluatedAt: '2000-01-01T00:30:00.000Z',
  };
}

function source(overrides = {}) {
  return {
    authenticate: () => ({ authenticated: true, sessionId: SESSION, subjectId: SUBJECT }),
    resolveTrustedNavigationState: () => trustedState(),
    ...overrides,
  };
}

test('T1 exact valid source produces the frozen null-prototype dependency record', async () => {
  const module = await loadAdapter();
  assert.deepEqual(Object.keys(module), ['createTenantSkyscraperNavigationTrustedSourceAdapter']);
  const authenticate = () => null;
  const resolveTrustedNavigationState = () => null;

  const dependencies = module.createTenantSkyscraperNavigationTrustedSourceAdapter({
    authenticate,
    resolveTrustedNavigationState,
  });

  assert.equal(Object.getPrototypeOf(dependencies), null);
  assert.equal(Object.isFrozen(dependencies), true);
  assert.deepEqual(Reflect.ownKeys(dependencies), [
    'authenticate', 'resolveTrustedNavigationState',
  ]);
  for (const key of Reflect.ownKeys(dependencies)) {
    const descriptor = Object.getOwnPropertyDescriptor(dependencies, key);
    assert.deepEqual({
      enumerable: descriptor.enumerable,
      writable: descriptor.writable,
      configurable: descriptor.configurable,
    }, { enumerable: true, writable: false, configurable: false });
    assert.equal(typeof descriptor.value, 'function');
    assert.equal(Object.isFrozen(descriptor.value), true);
    assert.notEqual(descriptor.value, key === 'authenticate'
      ? authenticate : resolveTrustedNavigationState);
  }
});

test('T2 wrappers use captured apply with undefined receiver and one unchanged argument', async () => {
  const originalApply = Reflect.apply;
  let applyCalls = 0;
  let module;
  try {
    Reflect.apply = function observedApply(target, receiver, argumentsList) {
      applyCalls += 1;
      return originalApply(target, receiver, argumentsList);
    };
    module = await loadFreshAdapter('captured-apply');
  } finally {
    Reflect.apply = originalApply;
  }
  const credential = 'session_synthetic_0001';
  const context = Object.freeze(Object.assign(Object.create(null), {
    session: Object.freeze(Object.create(null)),
    navigation: Object.freeze(Object.create(null)),
  }));
  const calls = [];
  const originalAuthenticate = function authenticate(...args) {
    calls.push({ name: 'authenticate', receiver: this, args });
    return 'authenticated-result';
  };
  const originalResolve = function resolve(...args) {
    calls.push({ name: 'resolve', receiver: this, args });
    return 'trusted-state-result';
  };
  const source = {
    authenticate: originalAuthenticate,
    resolveTrustedNavigationState: originalResolve,
  };
  const dependencies = module.createTenantSkyscraperNavigationTrustedSourceAdapter(source);
  source.authenticate = () => 'mutated-authenticate';
  source.resolveTrustedNavigationState = () => 'mutated-resolve';

  assert.equal(dependencies.authenticate(credential), 'authenticated-result');
  assert.equal(dependencies.resolveTrustedNavigationState(context), 'trusted-state-result');
  assert.deepEqual(calls, [
    { name: 'authenticate', receiver: undefined, args: [credential] },
    { name: 'resolve', receiver: undefined, args: [context] },
  ]);
  assert.equal(calls[0].args[0], credential);
  assert.equal(calls[1].args[0], context);
  assert.equal(applyCalls, 2);
});

test('T3 malformed and hostile sources fail generically without invoking attacker hooks', async () => {
  const module = await loadAdapter();
  const factory = module.createTenantSkyscraperNavigationTrustedSourceAdapter;
  const authenticate = () => null;
  const resolveTrustedNavigationState = () => null;
  let attackerHooks = 0;
  const accessor = {};
  Object.defineProperties(accessor, {
    authenticate: {
      enumerable: true,
      get() { attackerHooks += 1; return authenticate; },
    },
    resolveTrustedNavigationState: {
      enumerable: true,
      value: resolveTrustedNavigationState,
    },
  });
  const recordProxy = new Proxy({}, {
    get() { attackerHooks += 1; return authenticate; },
    getPrototypeOf() { attackerHooks += 1; return Object.prototype; },
    ownKeys() { attackerHooks += 1; return []; },
    getOwnPropertyDescriptor() { attackerHooks += 1; return undefined; },
  });
  const functionProxy = new Proxy(authenticate, {
    apply() { attackerHooks += 1; return null; },
    get() { attackerHooks += 1; return undefined; },
  });
  const inherited = Object.create({ authenticate });
  inherited.resolveTrustedNavigationState = resolveTrustedNavigationState;
  const customPrototype = Object.create({ marker: true });
  customPrototype.authenticate = authenticate;
  customPrototype.resolveTrustedNavigationState = resolveTrustedNavigationState;
  const symbolKey = { authenticate, resolveTrustedNavigationState };
  symbolKey[Symbol('synthetic-private')] = true;
  const nonEnumerable = { authenticate };
  Object.defineProperty(nonEnumerable, 'resolveTrustedNavigationState', {
    value: resolveTrustedNavigationState,
  });
  const proxiedFunction = {
    authenticate: functionProxy,
    resolveTrustedNavigationState,
  };
  const attacks = [
    () => factory(),
    () => factory({ authenticate, resolveTrustedNavigationState }, 'extra'),
    () => factory(null),
    () => factory('synthetic-private-source'),
    () => factory([]),
    () => factory(new Date(0)),
    () => factory(Object(1)),
    () => factory(inherited),
    () => factory(customPrototype),
    () => factory({ authenticate, resolveTrustedNavigationState, extra: true }),
    () => factory(symbolKey),
    () => factory(accessor),
    () => factory(nonEnumerable),
    () => factory({ authenticate: null, resolveTrustedNavigationState }),
    () => factory({ authenticate, resolveTrustedNavigationState: null }),
    () => factory(recordProxy),
    () => factory(proxiedFunction),
  ];
  const messages = [];
  for (const attack of attacks) {
    let thrown;
    try {
      attack();
    } catch (error) {
      thrown = error;
    }
    assert.equal(thrown instanceof TypeError, true);
    messages.push(thrown.message);
  }
  assert.equal(new Set(messages).size, 1);
  assert.equal(messages[0].includes('synthetic'), false);
  assert.equal(messages[0].includes('private'), false);
  assert.equal(attackerHooks, 0);

  const nullPrototypeSource = Object.assign(Object.create(null), {
    authenticate,
    resolveTrustedNavigationState,
  });
  assert.equal(Object.isFrozen(factory(nullPrototypeSource)), true);
});

test('C1 malformed source uses the captured TypeError intrinsic', async () => {
  const module = await loadAdapter();
  const factory = module.createTenantSkyscraperNavigationTrustedSourceAdapter;
  const TypeErrorIntrinsic = TypeError;
  const originalDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'TypeError');
  let attackerCalls = 0;
  let thrown;

  try {
    Object.defineProperty(globalThis, 'TypeError', {
      ...originalDescriptor,
      value: function attackerTypeError() {
        attackerCalls += 1;
      },
    });
    try {
      factory(null);
    } catch (error) {
      thrown = error;
    }
  } finally {
    Object.defineProperty(globalThis, 'TypeError', originalDescriptor);
  }

  assert.equal(attackerCalls, 0);
  assert.equal(thrown instanceof TypeErrorIntrinsic, true);
  assert.equal(thrown.message, 'trusted navigation source is required');
});

test('C2 wrappers expose only recursively frozen non-constructible boundaries', async () => {
  const module = await loadAdapter();
  const calls = [];
  const authenticateResult = Object.freeze(Object.create(null));
  const resolveResult = Object.freeze(Object.create(null));
  const authenticate = function authenticate(...args) {
    calls.push({ name: 'authenticate', receiver: this, args });
    return authenticateResult;
  };
  const resolveTrustedNavigationState = function resolveTrustedNavigationState(...args) {
    calls.push({ name: 'resolveTrustedNavigationState', receiver: this, args });
    return resolveResult;
  };
  const dependencies = module.createTenantSkyscraperNavigationTrustedSourceAdapter({
    authenticate,
    resolveTrustedNavigationState,
  });
  const wrappers = [dependencies.authenticate, dependencies.resolveTrustedNavigationState];
  const observedBoundaries = wrappers.map((wrapper) => {
    const prototypeDescriptor = Object.getOwnPropertyDescriptor(wrapper, 'prototype');
    let constructible = true;
    try {
      Reflect.construct(function constructTarget() {}, [], wrapper);
    } catch {
      constructible = false;
    }
    return {
      wrapperFrozen: Object.isFrozen(wrapper),
      hasOwnPrototype: prototypeDescriptor !== undefined,
      prototypeFrozen: prototypeDescriptor === undefined
        ? null : Object.isFrozen(prototypeDescriptor.value),
      constructible,
    };
  });

  assert.deepEqual(observedBoundaries, [
    {
      wrapperFrozen: true,
      hasOwnPrototype: false,
      prototypeFrozen: null,
      constructible: false,
    },
    {
      wrapperFrozen: true,
      hasOwnPrototype: false,
      prototypeFrozen: null,
      constructible: false,
    },
  ]);

  const credential = 'session_synthetic_boundary';
  const context = Object.freeze(Object.create(null));
  assert.equal(dependencies.authenticate(credential), authenticateResult);
  assert.equal(dependencies.resolveTrustedNavigationState(context), resolveResult);
  assert.deepEqual(calls, [
    { name: 'authenticate', receiver: undefined, args: [credential] },
    { name: 'resolveTrustedNavigationState', receiver: undefined, args: [context] },
  ]);

  const visited = new WeakSet();
  function assertOwnValueGraphFrozen(value) {
    if ((typeof value !== 'object' || value === null) && typeof value !== 'function') return;
    if (visited.has(value)) return;
    visited.add(value);
    assert.equal(Object.isFrozen(value), true);
    for (const key of Reflect.ownKeys(value)) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if ('value' in descriptor) assertOwnValueGraphFrozen(descriptor.value);
    }
  }
  assertOwnValueGraphFrozen(dependencies);
});

test('T4 wrappers transparently preserve synchronous and promise outcomes without retries', async () => {
  const module = await loadAdapter();
  const syncResult = Object.freeze(Object.create(null));
  const asyncResult = Object.freeze(Object.create(null));
  const syncFailure = new Error('synthetic synchronous failure');
  const asyncFailure = new Error('synthetic asynchronous failure');
  const resolved = Promise.resolve(asyncResult);
  const rejected = Promise.reject(asyncFailure);
  rejected.catch(() => {});
  let authenticateCalls = 0;
  let resolveCalls = 0;
  const syncDependencies = module.createTenantSkyscraperNavigationTrustedSourceAdapter({
    authenticate: (...args) => {
      authenticateCalls += 1;
      assert.deepEqual(args, ['credential']);
      return syncResult;
    },
    resolveTrustedNavigationState: () => {
      resolveCalls += 1;
      throw syncFailure;
    },
  });

  assert.equal(syncDependencies.authenticate('credential', 'ignored'), syncResult);
  assert.throws(() => syncDependencies.resolveTrustedNavigationState('context'),
    (error) => error === syncFailure);
  assert.deepEqual({ authenticateCalls, resolveCalls }, { authenticateCalls: 1, resolveCalls: 1 });

  const asyncDependencies = module.createTenantSkyscraperNavigationTrustedSourceAdapter({
    authenticate: () => resolved,
    resolveTrustedNavigationState: () => rejected,
  });
  const returnedResolved = asyncDependencies.authenticate('credential');
  const returnedRejected = asyncDependencies.resolveTrustedNavigationState('context');
  assert.equal(returnedResolved, resolved);
  assert.equal(returnedRejected, rejected);
  assert.equal(await returnedResolved, asyncResult);
  await assert.rejects(returnedRejected, (error) => error === asyncFailure);
});

test('T5 injected adapter preserves M7.2 public parity and generic failure closure', async () => {
  const adapterModule = await loadAdapter();
  const api = await import('../server/tenantSkyscraperNavigationApi.mjs');
  const contexts = [];
  const dependencies = adapterModule.createTenantSkyscraperNavigationTrustedSourceAdapter(source({
    resolveTrustedNavigationState: (context) => {
      contexts.push(context);
      return trustedState();
    },
  }));
  const handler = api.createTenantSkyscraperNavigationApiHandler(dependencies);
  const decisions = [];
  for (const channel of ['door', 'elevator', 'direct', 'alternative']) {
    const result = await handler(request(channel));
    assert.equal(result.ok, true);
    assert.equal(result.decision.tenantId, null);
    assert.equal(result.decision.accessState, 'public');
    decisions.push({ ...result.decision, channel: 'same' });
  }
  assert.deepEqual(decisions[1], decisions[0]);
  assert.deepEqual(decisions[2], decisions[0]);
  assert.deepEqual(decisions[3], decisions[0]);
  assert.equal(contexts.length, 8);
  for (const context of contexts) {
    assert.equal(Object.getPrototypeOf(context), null);
    assert.equal(Object.isFrozen(context), true);
    assert.equal(Object.isFrozen(context.session), true);
    assert.equal(Object.isFrozen(context.navigation), true);
    assert.deepEqual(Reflect.ownKeys(context), ['session', 'navigation']);
  }

  const failures = [
    source({ authenticate: () => { throw new Error('synthetic credential detail'); } }),
    source({
      resolveTrustedNavigationState: () => Promise.reject(
        new Error('synthetic private source detail'),
      ),
    }),
    source({
      resolveTrustedNavigationState: () => ({
        ...trustedState(), privateSourceDetail: 'must-not-leak',
      }),
    }),
    source({ resolveTrustedNavigationState: () => new Proxy(trustedState(), {}) }),
  ];
  for (const hostileSource of failures) {
    const denied = await api.createTenantSkyscraperNavigationApiHandler(
      adapterModule.createTenantSkyscraperNavigationTrustedSourceAdapter(hostileSource),
    )(request());
    assert.deepEqual({ ...denied }, { ok: false, code: 'not_found' });
    assert.equal(JSON.stringify(denied).includes('synthetic'), false);
    assert.equal(JSON.stringify(denied).includes('private'), false);
  }
});
