import assert from 'node:assert/strict';
import test from 'node:test';

const MODULE_PATH = '../server/tenantSkyscraperNavigationApi.mjs';
const BUILDING = 'id_0000000000000001';
const FLOOR = 'id_0000000000000002';
const STOP = 'id_0000000000000003';
const TENANT = 'id_0000000000000010';
const SUBJECT = 'id_0000000000000030';
const SESSION = 'id_0000000000000031';
const AUTHORIZATION_REFERENCE = 'id_0000000000000032';
const PUBLIC_DESTINATION = 'id_0000000000000020';
const EVALUATED_AT = '2000-01-01T00:30:00.000Z';

async function loadApi() {
  return import(MODULE_PATH).catch(() => ({}));
}

function request() {
  return {
    schemaVersion: '1.0',
    sessionCredential: 'session_0000000000000001',
    navigation: {
      schemaVersion: '1.0',
      channel: 'door',
      buildingId: 'id_0000000000000001',
      floorId: 'id_0000000000000002',
      elevatorStopId: 'id_0000000000000003',
      destinationId: 'id_0000000000000020',
    },
  };
}

function destination(destinationId, overrides = {}) {
  return {
    destinationId,
    floorId: FLOOR,
    displayName: `Synthetic ${destinationId.slice(-4)}`,
    lifecycle: 'active',
    destinationKind: 'suite',
    accessState: 'tenant',
    ownerTenantId: TENANT,
    sharedSpacePolicy: 'not_shared',
    ...overrides,
  };
}

function trustedState() {
  const suites = [1, 2, 3, 4].map((number) => destination(`id_000000000000010${number}`));
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
          destinations: [...suites, destination(PUBLIC_DESTINATION, {
            displayName: 'Synthetic Lobby',
            destinationKind: 'shared_space',
            accessState: 'public',
            ownerTenantId: null,
            sharedSpacePolicy: 'building_public',
          })],
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
    evaluatedAt: EVALUATED_AT,
  };
}

async function workingDependencies(overrides = {}) {
  return {
    authenticate: async () => ({ authenticated: true, sessionId: SESSION, subjectId: SUBJECT }),
    resolveTrustedNavigationState: async () => trustedState(),
    ...overrides,
  };
}

async function decideWithState(state, destinationId = PUBLIC_DESTINATION) {
  const api = await loadApi();
  const envelope = request();
  envelope.navigation.destinationId = destinationId;
  return api.createTenantSkyscraperNavigationApiHandler(await workingDependencies({
    resolveTrustedNavigationState: async () => structuredClone(state),
  }))(envelope);
}

test('A1 unauthenticated requests return fresh generic denial without resolving private state', async () => {
  const api = await loadApi();
  assert.equal(typeof api.createTenantSkyscraperNavigationApiHandler, 'function');
  let sourceCalls = 0;
  const handler = api.createTenantSkyscraperNavigationApiHandler({
    authenticate: async () => null,
    resolveTrustedNavigationState: async () => {
      sourceCalls += 1;
      throw new Error('private source must not be called');
    },
  });

  const first = await handler(request());
  const second = await handler(request());

  assert.deepEqual({ ...first }, { ok: false, code: 'not_found' });
  assert.deepEqual({ ...second }, { ...first });
  assert.notEqual(first, second);
  assert.equal(Object.getPrototypeOf(first), null);
  assert.equal(Object.isFrozen(first), true);
  assert.equal(sourceCalls, 0);
});

test('A2 authenticated ownerless public navigation returns the accepted frozen domain decision', async () => {
  const api = await loadApi();
  let authenticationCalls = 0;
  let sourceCalls = 0;
  const dependencies = await workingDependencies({
    authenticate: async () => {
      authenticationCalls += 1;
      return { authenticated: true, sessionId: SESSION, subjectId: SUBJECT };
    },
    resolveTrustedNavigationState: async () => {
      sourceCalls += 1;
      return trustedState();
    },
  });
  const result = await api.createTenantSkyscraperNavigationApiHandler(dependencies)(request());

  assert.equal(result.ok, true);
  assert.equal(Object.getPrototypeOf(result), null);
  assert.equal(Object.getPrototypeOf(result.decision), null);
  assert.deepEqual({ ...result.decision }, {
    allowed: true,
    code: 'allowed',
    schemaVersion: '1.0',
    channel: 'door',
    buildingId: BUILDING,
    floorId: FLOOR,
    elevatorStopId: STOP,
    destinationId: PUBLIC_DESTINATION,
    destinationKind: 'shared_space',
    accessState: 'public',
    subjectId: SUBJECT,
    tenantId: null,
    authorizationReference: AUTHORIZATION_REFERENCE,
    policyRevision: 7,
    evaluatedAt: EVALUATED_AT,
    validUntil: null,
  });
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.decision), true);
  assert.equal(authenticationCalls, 2);
  assert.equal(sourceCalls, 2);
});

test('A3 all four channels have identical authorization meaning', async () => {
  const api = await loadApi();
  const decisions = [];
  for (const channel of ['door', 'elevator', 'direct', 'alternative']) {
    const envelope = request();
    envelope.navigation.channel = channel;
    const result = await api.createTenantSkyscraperNavigationApiHandler(
      await workingDependencies(),
    )(envelope);
    assert.equal(result.ok, true);
    decisions.push({ ...result.decision, channel: 'same' });
  }
  assert.deepEqual(decisions[1], decisions[0]);
  assert.deepEqual(decisions[2], decisions[0]);
  assert.deepEqual(decisions[3], decisions[0]);
});

test('A4 tenant navigation requires exact active same-tenant membership', async () => {
  const destinationId = 'id_0000000000000101';
  const allowed = await decideWithState(trustedState(), destinationId);
  assert.equal(allowed.ok, true);
  const foreign = trustedState();
  foreign.authorization.activeTenantMembership.tenantId = 'id_0000000000000011';
  assert.deepEqual(
    { ...await decideWithState(foreign, destinationId) },
    { ok: false, code: 'not_found' },
  );
});

test('A5 invited navigation requires an exact accepted unexpired invitation', async () => {
  const state = trustedState();
  Object.assign(state.catalog.building.floors[0].destinations[4], {
    accessState: 'invited', ownerTenantId: TENANT, sharedSpacePolicy: 'exact_invitation',
  });
  state.authorization.invitation = {
    tenantId: TENANT,
    invitationId: 'id_0000000000000033',
    subjectId: SUBJECT,
    destinationId: PUBLIC_DESTINATION,
    lifecycle: 'accepted',
    revision: 2,
    validFrom: '2000-01-01T00:00:00.000Z',
    expiresAt: '2000-01-01T01:00:00.000Z',
  };
  const allowed = await decideWithState(state);
  assert.equal(allowed.ok, true);
  assert.equal(allowed.decision.validUntil, '2000-01-01T01:00:00.000Z');
  state.authorization.invitation.expiresAt = EVALUATED_AT;
  assert.deepEqual(
    { ...await decideWithState(state) },
    { ok: false, code: 'not_found' },
  );
});

test('A6 private navigation requires exact same-tenant grant authority', async () => {
  const destinationId = 'id_0000000000000101';
  const state = trustedState();
  state.catalog.building.floors[0].destinations[0].accessState = 'private';
  state.authorization.privateDestinationGrants = [{
    tenantId: TENANT, subjectId: SUBJECT, destinationId,
  }];
  assert.equal((await decideWithState(state, destinationId)).ok, true);
  state.authorization.privateDestinationGrants = [];
  assert.deepEqual(
    { ...await decideWithState(state, destinationId) },
    { ok: false, code: 'not_found' },
  );
});

test('A7 restricted navigation requires exact same-tenant restricted authority', async () => {
  const destinationId = 'id_0000000000000101';
  const state = trustedState();
  state.catalog.building.floors[0].destinations[0].accessState = 'restricted';
  state.authorization.restrictedDestinationAuthorities = [{
    tenantId: TENANT, subjectId: SUBJECT, destinationId,
  }];
  assert.equal((await decideWithState(state, destinationId)).ok, true);
  state.authorization.restrictedDestinationAuthorities = [];
  assert.deepEqual(
    { ...await decideWithState(state, destinationId) },
    { ok: false, code: 'not_found' },
  );
});

test('A8 final reauthorization denies policy drift without leaking the prior allow', async () => {
  const api = await loadApi();
  let sourceCalls = 0;
  const dependencies = await workingDependencies({
    resolveTrustedNavigationState: async () => {
      sourceCalls += 1;
      const state = trustedState();
      state.authorization.policyRevision = sourceCalls;
      return state;
    },
  });
  const result = await api.createTenantSkyscraperNavigationApiHandler(dependencies)(request());
  assert.deepEqual({ ...result }, { ok: false, code: 'not_found' });
  assert.equal(sourceCalls, 2);
});

test('A9 hostile dependency output fails closed without leaking private fields', async () => {
  const api = await loadApi();
  const dependencies = await workingDependencies({
    resolveTrustedNavigationState: async () => ({
      ...trustedState(), secret: 'private-source-payload',
    }),
  });
  const result = await api.createTenantSkyscraperNavigationApiHandler(dependencies)(request());
  assert.deepEqual({ ...result }, { ok: false, code: 'not_found' });
  assert.equal('secret' in result, false);
});

test('A10 closed request envelopes reject client authority and hostile shapes before authentication', async () => {
  const api = await loadApi();
  let authenticationCalls = 0;
  let sourceCalls = 0;
  let accessorCalls = 0;
  const handler = api.createTenantSkyscraperNavigationApiHandler(await workingDependencies({
    authenticate: async () => {
      authenticationCalls += 1;
      return { authenticated: true, sessionId: SESSION, subjectId: SUBJECT };
    },
    resolveTrustedNavigationState: async () => {
      sourceCalls += 1;
      return trustedState();
    },
  }));
  const clientAuthority = request();
  clientAuthority.tenantId = TENANT;
  const invalidChannel = request();
  invalidChannel.navigation.channel = 'direct-url-bypass';
  const symbol = request();
  symbol[Symbol('hidden')] = true;
  const accessor = request();
  Object.defineProperty(accessor, 'sessionCredential', {
    enumerable: true,
    get() { accessorCalls += 1; return 'session_0000000000000001'; },
  });
  const oversized = request();
  oversized.sessionCredential = `session_${'x'.repeat(257)}`;
  for (const attack of [clientAuthority, invalidChannel, symbol, accessor, oversized, new Proxy(request(), {})]) {
    assert.deepEqual({ ...await handler(attack) }, { ok: false, code: 'not_found' });
  }
  assert.equal(authenticationCalls, 0);
  assert.equal(sourceCalls, 0);
  assert.equal(accessorCalls, 0);
});

test('A11 direct identifiers and alternate channels cannot bypass the trusted tuple', async () => {
  const api = await loadApi();
  const handler = api.createTenantSkyscraperNavigationApiHandler(await workingDependencies());
  for (const mutate of [
    (value) => { value.navigation.buildingId = 'id_ffffffffffffffff'; },
    (value) => { value.navigation.floorId = 'id_ffffffffffffffff'; },
    (value) => { value.navigation.elevatorStopId = 'id_ffffffffffffffff'; },
    (value) => { value.navigation.destinationId = 'id_ffffffffffffffff'; },
  ]) {
    const envelope = request();
    envelope.navigation.channel = 'direct';
    mutate(envelope);
    assert.deepEqual({ ...await handler(envelope) }, { ok: false, code: 'not_found' });
    envelope.navigation.channel = 'alternative';
    assert.deepEqual({ ...await handler(envelope) }, { ok: false, code: 'not_found' });
  }
});

test('A12 session revocation and catalog lifecycle drift deny the final response', async () => {
  const api = await loadApi();
  let authenticationCalls = 0;
  const revoked = api.createTenantSkyscraperNavigationApiHandler(await workingDependencies({
    authenticate: async () => {
      authenticationCalls += 1;
      return authenticationCalls === 1
        ? { authenticated: true, sessionId: SESSION, subjectId: SUBJECT }
        : null;
    },
  }));
  assert.deepEqual({ ...await revoked(request()) }, { ok: false, code: 'not_found' });

  let sourceCalls = 0;
  const drifted = api.createTenantSkyscraperNavigationApiHandler(await workingDependencies({
    resolveTrustedNavigationState: async () => {
      sourceCalls += 1;
      const state = trustedState();
      if (sourceCalls === 2) state.catalog.building.lifecycle = 'archived';
      return state;
    },
  }));
  assert.deepEqual({ ...await drifted(request()) }, { ok: false, code: 'not_found' });
});

test('A13 throwing and hostile dependency returns fail closed within fixed call ceilings', async () => {
  const api = await loadApi();
  let authenticationCalls = 0;
  let sourceCalls = 0;
  const thrownAuthentication = api.createTenantSkyscraperNavigationApiHandler(
    await workingDependencies({
      authenticate: async () => {
        authenticationCalls += 1;
        throw new Error('credential detail');
      },
      resolveTrustedNavigationState: async () => {
        sourceCalls += 1;
        return trustedState();
      },
    }),
  );
  assert.deepEqual(
    { ...await thrownAuthentication(request()) },
    { ok: false, code: 'not_found' },
  );
  assert.deepEqual({ authenticationCalls, sourceCalls }, { authenticationCalls: 1, sourceCalls: 0 });

  const hostileState = api.createTenantSkyscraperNavigationApiHandler(
    await workingDependencies({
      resolveTrustedNavigationState: async () => new Proxy(trustedState(), {}),
    }),
  );
  assert.deepEqual({ ...await hostileState(request()) }, { ok: false, code: 'not_found' });
});

test('A14 valid navigation does not resolve the replaceable ambient String constructor', async () => {
  const api = await loadApi();
  const dependencies = await workingDependencies();
  const original = globalThis.String;
  let calls = 0;
  let result;
  try {
    globalThis.String = new Proxy(original, {
      apply(target, thisArgument, argumentsList) {
        calls += 1;
        return Reflect.apply(target, thisArgument, argumentsList);
      },
    });
    result = await api.createTenantSkyscraperNavigationApiHandler(dependencies)(request());
  } finally {
    globalThis.String = original;
  }
  assert.equal(result.ok, true);
  assert.equal(calls, 0);
});

test('A15 final reauthorization denies trusted clock rollback', async () => {
  const api = await loadApi();
  let sourceCalls = 0;
  const dependencies = await workingDependencies({
    resolveTrustedNavigationState: async () => {
      sourceCalls += 1;
      const state = trustedState();
      if (sourceCalls === 2) state.evaluatedAt = '2000-01-01T00:29:59.999Z';
      return state;
    },
  });
  const result = await api.createTenantSkyscraperNavigationApiHandler(dependencies)(request());
  assert.deepEqual({ ...result }, { ok: false, code: 'not_found' });
});

test('A16 private source receives only the frozen authenticated session and requested tuple', async () => {
  const api = await loadApi();
  const contexts = [];
  const dependencies = await workingDependencies({
    resolveTrustedNavigationState: async (context) => {
      contexts.push(context);
      return trustedState();
    },
  });
  assert.equal(
    (await api.createTenantSkyscraperNavigationApiHandler(dependencies)(request())).ok,
    true,
  );
  assert.equal(contexts.length, 2);
  for (const context of contexts) {
    assert.deepEqual(Object.keys(context), ['session', 'navigation']);
    assert.equal(Object.getPrototypeOf(context), null);
    assert.equal(Object.isFrozen(context), true);
    assert.equal(Object.isFrozen(context.session), true);
    assert.equal(Object.isFrozen(context.navigation), true);
    assert.equal('sessionCredential' in context, false);
  }
});

test('A17 hostile trusted-state graphs and strict size budgets fail closed without accessors', async () => {
  const api = await loadApi();
  let accessorCalls = 0;
  const accessor = trustedState();
  Object.defineProperty(accessor.catalog.building, 'displayName', {
    enumerable: true,
    get() { accessorCalls += 1; return 'Synthetic Tower'; },
  });
  const shared = trustedState();
  shared.authorization.restrictedDestinationAuthorities =
    shared.authorization.privateDestinationGrants;
  const nestedProxy = trustedState();
  nestedProxy.catalog = new Proxy(nestedProxy.catalog, {});
  const oversized = trustedState();
  oversized.catalog.building.displayName = 'x'.repeat(524289);
  for (const state of [accessor, shared, nestedProxy, oversized]) {
    const handler = api.createTenantSkyscraperNavigationApiHandler(
      await workingDependencies({ resolveTrustedNavigationState: async () => state }),
    );
    assert.deepEqual({ ...await handler(request()) }, { ok: false, code: 'not_found' });
  }
  assert.equal(accessorCalls, 0);
});

test('A18 factory accepts only authentication and trusted-state dependencies', async () => {
  const api = await loadApi();
  const handler = api.createTenantSkyscraperNavigationApiHandler({
    authenticate: async () => null,
    resolveTrustedNavigationState: async () => trustedState(),
  });
  assert.deepEqual({ ...await handler(request()) }, { ok: false, code: 'not_found' });
  assert.throws(() => api.createTenantSkyscraperNavigationApiHandler({
    authenticate: async () => null,
    resolveTrustedNavigationState: async () => trustedState(),
    createNavigationAuthorizer: () => ({ decideNavigation: () => ({ ok: true }) }),
  }), TypeError);
});

test('A19 trusted authorization must belong to the authenticated session', async () => {
  const api = await loadApi();
  let authenticationCalls = 0;
  let sourceCalls = 0;
  const handler = api.createTenantSkyscraperNavigationApiHandler(await workingDependencies({
    authenticate: async () => {
      authenticationCalls += 1;
      return { authenticated: true, sessionId: SESSION, subjectId: SUBJECT };
    },
    resolveTrustedNavigationState: async () => {
      sourceCalls += 1;
      const state = trustedState();
      state.authorization.authenticatedSessionId = 'id_0000000000000099';
      return state;
    },
  }));

  const separateDenial = await handler({});
  const result = await handler(request());

  assert.deepEqual({ ...result }, { ok: false, code: 'not_found' });
  assert.deepEqual(Reflect.ownKeys(result), ['ok', 'code']);
  assert.notEqual(result, separateDenial);
  assert.equal(Object.getPrototypeOf(result), null);
  assert.equal(Object.isFrozen(result), true);
  assert.equal(authenticationCalls, 1);
  assert.equal(sourceCalls, 1);
});
