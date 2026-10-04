import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';

const MODULE_PATH = '../server/tenantSkyscraperNavigationComposition.mjs';
const ROUTE = '/api/private/skyscraper-navigation/decision';
const CREDENTIAL = 'session_0000000000000001';
const BUILDING = 'id_0000000000000001';
const FLOOR = 'id_0000000000000002';
const STOP = 'id_0000000000000003';
const DESTINATION = 'id_0000000000000020';
const TENANT = 'id_0000000000000010';
const SUBJECT = 'id_0000000000000030';
const SESSION = 'id_0000000000000031';
const AUTHORIZATION_REFERENCE = 'id_0000000000000032';
const EVALUATED_AT = '2000-01-01T00:30:00.000Z';

async function loadComposition() {
  return import(MODULE_PATH).catch(() => ({}));
}

function trustedSource() {
  return {
    authenticate: async () => null,
    resolveTrustedNavigationState: async () => null,
  };
}

function navigation(channel = 'door', destinationId = DESTINATION) {
  return {
    schemaVersion: '1.0', channel, buildingId: BUILDING, floorId: FLOOR,
    elevatorStopId: STOP, destinationId,
  };
}

function destination(destinationId, overrides = {}) {
  return {
    destinationId, floorId: FLOOR, displayName: 'Synthetic Destination', lifecycle: 'active',
    destinationKind: 'suite', accessState: 'tenant', ownerTenantId: TENANT,
    sharedSpacePolicy: 'not_shared', ...overrides,
  };
}

function trustedState() {
  const suites = [1, 2, 3, 4].map((number) => destination(`id_000000000000010${number}`));
  return {
    catalog: {
      schemaVersion: '1.0',
      building: {
        buildingId: BUILDING, displayName: 'Synthetic Tower', lifecycle: 'active',
        floors: [{
          floorId: FLOOR, buildingId: BUILDING, displayName: 'Synthetic Floor',
          lifecycle: 'active', floorKind: 'customer', elevatorStopId: STOP,
          destinations: [...suites, destination(DESTINATION, {
            displayName: 'Synthetic Lobby', destinationKind: 'shared_space',
            accessState: 'public', ownerTenantId: null, sharedSpacePolicy: 'building_public',
          })],
        }],
      },
    },
    authorization: {
      kind: 'trusted-server-context', authenticatedSubjectId: SUBJECT,
      authenticatedSessionId: SESSION,
      ownerTenantLifecycles: [{ tenantId: TENANT, lifecycle: 'active' }],
      activeTenantMembership: { tenantId: TENANT, subjectId: SUBJECT, active: true },
      privateDestinationGrants: [], invitation: null, restrictedDestinationAuthorities: [],
      authorizationReference: AUTHORIZATION_REFERENCE, policyRevision: 7,
    },
    evaluatedAt: EVALUATED_AT,
  };
}

function sourceWithCounts(overrides = {}) {
  const counts = { authenticate: 0, resolve: 0 };
  const source = {
    authenticate: async () => {
      counts.authenticate += 1;
      return { authenticated: true, sessionId: SESSION, subjectId: SUBJECT };
    },
    resolveTrustedNavigationState: async () => {
      counts.resolve += 1;
      return trustedState();
    },
    ...overrides,
  };
  return { source, counts };
}

function sourceForStates(states) {
  let index = 0;
  return sourceWithCounts({
    resolveTrustedNavigationState: async () => states[Math.min(index++, states.length - 1)],
  });
}

function boundedSource({ authenticate, resolveTrustedNavigationState }) {
  const counts = { authenticate: 0, resolve: 0 };
  return {
    counts,
    source: {
      authenticate: async (...args) => {
        counts.authenticate += 1;
        return authenticate(...args);
      },
      resolveTrustedNavigationState: async (...args) => {
        counts.resolve += 1;
        return resolveTrustedNavigationState(...args);
      },
    },
  };
}

async function invoke(handler, requestedNavigation = navigation(), overrides = {}) {
  const body = overrides.body ?? JSON.stringify({
    schemaVersion: '1.0', navigation: requestedNavigation,
  });
  const request = new EventEmitter();
  Object.assign(request, {
    method: overrides.method ?? 'POST',
    url: overrides.path ?? ROUTE,
    headers: {},
    rawHeaders: overrides.rawHeaders ?? [
      'authorization', `Bearer ${CREDENTIAL}`, 'content-type', 'application/json',
    ],
    aborted: false, complete: false, destroyed: false,
  });
  const response = {
    destroyed: false, writableEnded: false, headersSent: false,
    statusCode: null, headers: null, body: '',
    writeHead(statusCode, headers) {
      this.statusCode = statusCode; this.headers = headers; this.headersSent = true;
    },
    end(value) {
      this.body = Buffer.from(value).toString('utf8'); this.writableEnded = true;
    },
    destroy() { this.destroyed = true; },
  };
  const pending = handler(request, response);
  if (body.length > 0) request.emit('data', Buffer.from(body));
  request.complete = true;
  request.emit('end');
  await pending;
  return response;
}

test('T1 exact valid source produces the exact frozen non-constructible HTTP adapter', async () => {
  const composition = await loadComposition();
  assert.deepEqual(Object.keys(composition), ['createTenantSkyscraperNavigationComposition']);

  const handler = composition.createTenantSkyscraperNavigationComposition(trustedSource());

  assert.equal(typeof handler, 'function');
  assert.equal(Object.isFrozen(handler), true);
  assert.throws(() => Reflect.construct(handler, []), TypeError);
});

test('T2 one ownerless-public request traverses the composition exactly twice per source operation', async () => {
  const composition = await loadComposition();
  const { source, counts } = sourceWithCounts();

  const response = await invoke(
    composition.createTenantSkyscraperNavigationComposition(source),
  );

  assert.equal(response.statusCode, 200);
  const result = JSON.parse(response.body);
  assert.equal(result.ok, true);
  assert.equal(result.decision.accessState, 'public');
  assert.equal(result.decision.tenantId, null);
  assert.deepEqual(counts, { authenticate: 2, resolve: 2 });
});

test('T3 door elevator direct and alternative channels preserve identical authorization meaning', async () => {
  const composition = await loadComposition();
  const decisions = [];
  for (const channel of ['door', 'elevator', 'direct', 'alternative']) {
    const { source, counts } = sourceWithCounts();
    const response = await invoke(
      composition.createTenantSkyscraperNavigationComposition(source),
      navigation(channel),
    );
    assert.equal(response.statusCode, 200);
    const result = JSON.parse(response.body);
    decisions.push({ ...result.decision, channel: 'same' });
    assert.deepEqual(counts, { authenticate: 2, resolve: 2 });
  }
  assert.deepEqual(decisions.slice(1), [decisions[0], decisions[0], decisions[0]]);
});

test('T4 tenant invited private-grant and restricted-authority positive meanings remain intact', async () => {
  const composition = await loadComposition();
  const scenarios = [];

  const tenant = trustedState();
  scenarios.push({ state: tenant, destinationId: 'id_0000000000000101', accessState: 'tenant' });

  const invited = trustedState();
  Object.assign(invited.catalog.building.floors[0].destinations[4], {
    accessState: 'invited', ownerTenantId: TENANT, sharedSpacePolicy: 'exact_invitation',
  });
  invited.authorization.invitation = {
    tenantId: TENANT, invitationId: 'id_0000000000000033', subjectId: SUBJECT,
    destinationId: DESTINATION, lifecycle: 'accepted', revision: 2,
    validFrom: '2000-01-01T00:00:00.000Z', expiresAt: '2000-01-01T01:00:00.000Z',
  };
  scenarios.push({ state: invited, destinationId: DESTINATION, accessState: 'invited' });

  const privateGrant = trustedState();
  privateGrant.catalog.building.floors[0].destinations[0].accessState = 'private';
  privateGrant.authorization.privateDestinationGrants = [{
    tenantId: TENANT, subjectId: SUBJECT, destinationId: 'id_0000000000000101',
  }];
  scenarios.push({
    state: privateGrant, destinationId: 'id_0000000000000101', accessState: 'private',
  });

  const restricted = trustedState();
  restricted.catalog.building.floors[0].destinations[0].accessState = 'restricted';
  restricted.authorization.restrictedDestinationAuthorities = [{
    tenantId: TENANT, subjectId: SUBJECT, destinationId: 'id_0000000000000101',
  }];
  scenarios.push({
    state: restricted, destinationId: 'id_0000000000000101', accessState: 'restricted',
  });

  for (const scenario of scenarios) {
    const { source } = sourceForStates([scenario.state]);
    const response = await invoke(
      composition.createTenantSkyscraperNavigationComposition(source),
      navigation('door', scenario.destinationId),
    );
    assert.equal(response.statusCode, 200);
    assert.equal(JSON.parse(response.body).decision.accessState, scenario.accessState);
  }
});

test('T5 malformed foreign revoked expired stale raced thrown rejected and hostile cases fail closed', async () => {
  const composition = await loadComposition();
  const authenticated = async () => ({ authenticated: true, sessionId: SESSION, subjectId: SUBJECT });
  const publicNavigation = navigation();
  const tenantNavigation = navigation('door', 'id_0000000000000101');
  const cases = [];

  cases.push({
    name: 'malformed', requestedNavigation: publicNavigation,
    ...boundedSource({ authenticate: authenticated, resolveTrustedNavigationState: async () => null }),
  });

  const foreign = trustedState();
  foreign.authorization.activeTenantMembership.tenantId = 'id_0000000000000011';
  cases.push({
    name: 'foreign', requestedNavigation: tenantNavigation,
    ...boundedSource({ authenticate: authenticated, resolveTrustedNavigationState: async () => foreign }),
  });

  let revokedAuthenticationCalls = 0;
  cases.push({
    name: 'revoked', requestedNavigation: publicNavigation,
    ...boundedSource({
      authenticate: async () => {
        revokedAuthenticationCalls += 1;
        return revokedAuthenticationCalls === 1
          ? { authenticated: true, sessionId: SESSION, subjectId: SUBJECT } : null;
      },
      resolveTrustedNavigationState: async () => trustedState(),
    }),
  });

  const expired = trustedState();
  Object.assign(expired.catalog.building.floors[0].destinations[4], {
    accessState: 'invited', ownerTenantId: TENANT, sharedSpacePolicy: 'exact_invitation',
  });
  expired.authorization.invitation = {
    tenantId: TENANT, invitationId: 'id_0000000000000033', subjectId: SUBJECT,
    destinationId: DESTINATION, lifecycle: 'accepted', revision: 2,
    validFrom: '2000-01-01T00:00:00.000Z', expiresAt: EVALUATED_AT,
  };
  cases.push({
    name: 'expired', requestedNavigation: publicNavigation,
    ...boundedSource({ authenticate: authenticated, resolveTrustedNavigationState: async () => expired }),
  });

  let staleCalls = 0;
  cases.push({
    name: 'stale', requestedNavigation: publicNavigation,
    ...boundedSource({
      authenticate: authenticated,
      resolveTrustedNavigationState: async () => {
        staleCalls += 1;
        const state = trustedState();
        if (staleCalls === 2) state.evaluatedAt = '2000-01-01T00:29:59.999Z';
        return state;
      },
    }),
  });

  let racedCalls = 0;
  cases.push({
    name: 'raced', requestedNavigation: publicNavigation,
    ...boundedSource({
      authenticate: authenticated,
      resolveTrustedNavigationState: async () => {
        racedCalls += 1;
        const state = trustedState();
        state.authorization.policyRevision = racedCalls;
        return state;
      },
    }),
  });

  cases.push({
    name: 'thrown', requestedNavigation: publicNavigation,
    ...boundedSource({
      authenticate: async () => { throw new Error('synthetic authentication failure'); },
      resolveTrustedNavigationState: async () => trustedState(),
    }),
  });
  cases.push({
    name: 'rejected', requestedNavigation: publicNavigation,
    ...boundedSource({
      authenticate: authenticated,
      resolveTrustedNavigationState: async () => Promise.reject(
        new Error('synthetic trusted-state failure'),
      ),
    }),
  });
  cases.push({
    name: 'hostile', requestedNavigation: publicNavigation,
    ...boundedSource({
      authenticate: authenticated,
      resolveTrustedNavigationState: async () => new Proxy(trustedState(), {}),
    }),
  });

  for (const scenario of cases) {
    const response = await invoke(
      composition.createTenantSkyscraperNavigationComposition(scenario.source),
      scenario.requestedNavigation,
    );
    assert.equal(response.statusCode, 404, scenario.name);
    assert.equal(response.body, '{"ok":false,"code":"not_found"}', scenario.name);
    assert.equal(scenario.counts.authenticate <= 2, true, scenario.name);
    assert.equal(scenario.counts.resolve <= 2, true, scenario.name);
  }
});

test('T6 composition accepts exactly one trusted-source argument', async () => {
  const composition = await loadComposition();
  let sourceCalls = 0;
  const source = {
    authenticate: async () => { sourceCalls += 1; return null; },
    resolveTrustedNavigationState: async () => { sourceCalls += 1; return null; },
  };

  assert.throws(
    () => composition.createTenantSkyscraperNavigationComposition(source, 'extra'),
    TypeError,
  );
  assert.equal(sourceCalls, 0);
});

test('T7 malformed accessor proxy wrapper and extra-key sources fail before source invocation', async () => {
  const composition = await loadComposition();
  const factory = composition.createTenantSkyscraperNavigationComposition;
  let attackerHooks = 0;
  const authenticate = async () => { attackerHooks += 1; return null; };
  const resolveTrustedNavigationState = async () => { attackerHooks += 1; return null; };
  const accessor = { resolveTrustedNavigationState };
  Object.defineProperty(accessor, 'authenticate', {
    enumerable: true,
    get() { attackerHooks += 1; return authenticate; },
  });
  const proxy = new Proxy({ authenticate, resolveTrustedNavigationState }, {
    get() { attackerHooks += 1; return undefined; },
    getPrototypeOf() { attackerHooks += 1; return Object.prototype; },
    ownKeys() { attackerHooks += 1; return []; },
  });
  const wrapper = Object.create({ authenticate });
  wrapper.resolveTrustedNavigationState = resolveTrustedNavigationState;
  const extraKey = { authenticate, resolveTrustedNavigationState, tenantId: TENANT };

  for (const malformed of [null, accessor, proxy, wrapper, extraKey]) {
    assert.throws(() => factory(malformed), TypeError);
  }
  assert.equal(attackerHooks, 0);
});

test('T8 malformed request boundaries deny before authentication or trusted-state work', async () => {
  const composition = await loadComposition();
  const { source, counts } = sourceWithCounts();
  const handler = composition.createTenantSkyscraperNavigationComposition(source);
  const clientAuthority = JSON.stringify({
    schemaVersion: '1.0', navigation: navigation(), tenantId: TENANT,
  });
  const invalidChannel = JSON.stringify({
    schemaVersion: '1.0', navigation: navigation('direct-url-bypass'),
  });
  const scenarios = [
    { body: '{}' },
    { body: clientAuthority },
    { body: invalidChannel },
    { rawHeaders: ['content-type', 'application/json'] },
    { method: 'GET' },
  ];

  for (const overrides of scenarios) {
    const response = await invoke(handler, navigation(), overrides);
    assert.equal(response.statusCode, 404);
    assert.equal(response.body, '{"ok":false,"code":"not_found"}');
  }
  assert.deepEqual(counts, { authenticate: 0, resolve: 0 });
});
