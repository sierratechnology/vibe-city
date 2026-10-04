import assert from 'node:assert/strict';
import test from 'node:test';

const MODULE_PATH = '../server/tenantSkyscraperNavigationDomain.mjs';
const BUILDING = 'id_0000000000000001';
const FLOOR = 'id_0000000000000002';
const STOP = 'id_0000000000000003';
const TENANT = 'id_0000000000000010';
const FOREIGN_TENANT = 'id_0000000000000011';
const SUBJECT = 'id_0000000000000030';
const SESSION = 'id_0000000000000031';
const AUTHORIZATION_REFERENCE = 'id_0000000000000032';
const INVITATION = 'id_0000000000000033';
const PUBLIC_DESTINATION = 'id_0000000000000020';
const EVALUATED_AT = '2000-01-01T00:30:00.000Z';

async function loadDomain() {
  return import(MODULE_PATH).catch(() => ({}));
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

function publicFixture() {
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
      authenticatedSubjectId: null,
      authenticatedSessionId: null,
      ownerTenantLifecycles: [{ tenantId: TENANT, lifecycle: 'active' }],
      activeTenantMembership: null,
      privateDestinationGrants: [],
      invitation: null,
      restrictedDestinationAuthorities: [],
      authorizationReference: null,
      policyRevision: 1,
    },
    evaluatedAt: EVALUATED_AT,
  };
}

function request(destinationId = PUBLIC_DESTINATION, channel = 'door') {
  return {
    schemaVersion: '1.0',
    channel,
    buildingId: BUILDING,
    floorId: FLOOR,
    elevatorStopId: STOP,
    destinationId,
  };
}

function authenticatedFixture() {
  const options = publicFixture();
  options.authorization.authenticatedSubjectId = SUBJECT;
  options.authorization.authenticatedSessionId = SESSION;
  options.authorization.activeTenantMembership = { tenantId: TENANT, subjectId: SUBJECT, active: true };
  options.authorization.authorizationReference = AUTHORIZATION_REFERENCE;
  options.authorization.policyRevision = 7;
  return options;
}

function invitedFixture() {
  const options = authenticatedFixture();
  Object.assign(options.catalog.building.floors[0].destinations[4], {
    accessState: 'invited', ownerTenantId: TENANT, sharedSpacePolicy: 'exact_invitation',
  });
  options.authorization.invitation = {
    tenantId: TENANT, invitationId: INVITATION, subjectId: SUBJECT,
    destinationId: PUBLIC_DESTINATION, lifecycle: 'accepted', revision: 2,
    validFrom: '2000-01-01T00:00:00.000Z', expiresAt: '2000-01-01T01:00:00.000Z',
  };
  return options;
}

test('B1 exposes only the frozen navigation authorizer shell and fresh generic failures', async () => {
  const domain = await loadDomain();
  assert.deepEqual(Object.keys(domain).sort(), [
    'TENANT_SKYSCRAPER_NAVIGATION_ACCESS_STATES',
    'createTenantSkyscraperNavigationAuthorizer',
  ]);
  assert.deepEqual(domain.TENANT_SKYSCRAPER_NAVIGATION_ACCESS_STATES, [
    'public', 'tenant', 'invited', 'private', 'restricted',
  ]);
  assert.equal(Object.isFrozen(domain.TENANT_SKYSCRAPER_NAVIGATION_ACCESS_STATES), true);
  const authorizer = domain.createTenantSkyscraperNavigationAuthorizer({});
  assert.equal(Object.getPrototypeOf(authorizer), null);
  assert.deepEqual(Object.keys(authorizer), ['decideNavigation']);
  assert.equal(Object.isFrozen(authorizer), true);
  const first = authorizer.decideNavigation({});
  const second = authorizer.decideNavigation({});
  assert.deepEqual({ ...first }, { ok: false, code: 'not_found' });
  assert.deepEqual({ ...second }, { ...first });
  assert.notEqual(first, second);
  assert.equal(Object.isFrozen(first), true);
});

test('B2 allows the smallest ownerless public destination with a detached frozen decision', async () => {
  const domain = await loadDomain();
  const options = publicFixture();
  const authorizer = domain.createTenantSkyscraperNavigationAuthorizer(options);
  const result = authorizer.decideNavigation(request());
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
    subjectId: null,
    tenantId: null,
    authorizationReference: null,
    policyRevision: 1,
    evaluatedAt: EVALUATED_AT,
    validUntil: null,
  });
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.decision), true);
  options.catalog.building.displayName = 'Synthetic Mutated';
  options.authorization.policyRevision = 2;
  assert.equal(result.decision.policyRevision, 1);
});

test('B3 requires stable unique links and exactly four suites on customer floors', async () => {
  const domain = await loadDomain();
  const attacks = [];
  const duplicate = publicFixture();
  duplicate.catalog.building.floors[0].destinations[1].destinationId =
    duplicate.catalog.building.floors[0].destinations[0].destinationId;
  attacks.push(duplicate);
  const wrongFloor = publicFixture();
  wrongFloor.catalog.building.floors[0].destinations[4].floorId = 'id_ffffffffffffffff';
  attacks.push(wrongFloor);
  const threeSuites = publicFixture();
  threeSuites.catalog.building.floors[0].destinations.shift();
  attacks.push(threeSuites);
  for (const options of attacks) {
    assert.deepEqual(
      domain.createTenantSkyscraperNavigationAuthorizer(options).decideNavigation(request()),
      { ok: false, code: 'not_found' },
    );
  }
});

test('B4 applies one public policy meaning identically across all navigation channels', async () => {
  const domain = await loadDomain();
  const decisions = ['door', 'elevator', 'direct', 'alternative'].map((channel) =>
    domain.createTenantSkyscraperNavigationAuthorizer(publicFixture())
      .decideNavigation(request(PUBLIC_DESTINATION, channel)));
  for (const result of decisions) assert.equal(result.ok, true);
  const normalized = decisions.map((result) => ({ ...result.decision, channel: 'same' }));
  assert.deepEqual(normalized[1], normalized[0]);
  assert.deepEqual(normalized[2], normalized[0]);
  assert.deepEqual(normalized[3], normalized[0]);
});

test('B5 tenant navigation requires exact active same-tenant membership', async () => {
  const domain = await loadDomain();
  const destinationId = 'id_0000000000000101';
  const allowed = domain.createTenantSkyscraperNavigationAuthorizer(authenticatedFixture())
    .decideNavigation(request(destinationId));
  assert.equal(allowed.ok, true);
  assert.equal(allowed.decision.tenantId, TENANT);
  const foreign = authenticatedFixture();
  foreign.authorization.activeTenantMembership.tenantId = FOREIGN_TENANT;
  assert.deepEqual(
    domain.createTenantSkyscraperNavigationAuthorizer(foreign).decideNavigation(request(destinationId)),
    { ok: false, code: 'not_found' },
  );
});

test('B6 invited navigation requires an exact accepted unexpired invitation', async () => {
  const domain = await loadDomain();
  const allowed = domain.createTenantSkyscraperNavigationAuthorizer(invitedFixture())
    .decideNavigation(request());
  assert.equal(allowed.ok, true);
  assert.equal(allowed.decision.accessState, 'invited');
  assert.equal(allowed.decision.validUntil, '2000-01-01T01:00:00.000Z');
  const expired = invitedFixture();
  expired.authorization.invitation.expiresAt = EVALUATED_AT;
  assert.deepEqual(
    domain.createTenantSkyscraperNavigationAuthorizer(expired).decideNavigation(request()),
    { ok: false, code: 'not_found' },
  );
  const unauthenticated = invitedFixture();
  unauthenticated.authorization.authenticatedSubjectId = null;
  unauthenticated.authorization.authenticatedSessionId = null;
  unauthenticated.authorization.activeTenantMembership = null;
  unauthenticated.authorization.authorizationReference = null;
  unauthenticated.authorization.invitation.subjectId = null;
  assert.deepEqual(
    domain.createTenantSkyscraperNavigationAuthorizer(unauthenticated).decideNavigation(request()),
    { ok: false, code: 'not_found' },
  );
});

test('B7 private navigation requires active membership plus an exact private grant', async () => {
  const domain = await loadDomain();
  const destinationId = 'id_0000000000000101';
  const options = authenticatedFixture();
  options.catalog.building.floors[0].destinations[0].accessState = 'private';
  options.authorization.privateDestinationGrants = [{ tenantId: TENANT, subjectId: SUBJECT, destinationId }];
  assert.equal(
    domain.createTenantSkyscraperNavigationAuthorizer(options).decideNavigation(request(destinationId)).ok,
    true,
  );
  const missing = authenticatedFixture();
  missing.catalog.building.floors[0].destinations[0].accessState = 'private';
  assert.deepEqual(
    domain.createTenantSkyscraperNavigationAuthorizer(missing).decideNavigation(request(destinationId)),
    { ok: false, code: 'not_found' },
  );
});

test('B8 restricted navigation requires active membership plus exact restricted authority', async () => {
  const domain = await loadDomain();
  const destinationId = 'id_0000000000000101';
  const options = authenticatedFixture();
  options.catalog.building.floors[0].destinations[0].accessState = 'restricted';
  options.authorization.restrictedDestinationAuthorities = [{
    tenantId: TENANT, subjectId: SUBJECT, destinationId,
  }];
  assert.equal(
    domain.createTenantSkyscraperNavigationAuthorizer(options).decideNavigation(request(destinationId)).ok,
    true,
  );
  options.authorization.restrictedDestinationAuthorities = [];
  assert.deepEqual(
    domain.createTenantSkyscraperNavigationAuthorizer(options).decideNavigation(request(destinationId)),
    { ok: false, code: 'not_found' },
  );
});

test('B9 valid navigation does not execute replaceable ambient intrinsic hooks', async () => {
  const domain = await loadDomain();
  let hooks = 0;
  const originals = {
    assign: Object.assign,
    isArray: Array.isArray,
    isFinite: Number.isFinite,
    isSafeInteger: Number.isSafeInteger,
    objectIs: Object.is,
    setHas: Set.prototype.has,
    Date: globalThis.Date,
  };
  try {
    Object.assign = (...args) => { hooks += 1; return originals.assign(...args); };
    Array.isArray = (...args) => { hooks += 1; return originals.isArray(...args); };
    Number.isFinite = (...args) => { hooks += 1; return originals.isFinite(...args); };
    Number.isSafeInteger = (...args) => { hooks += 1; return originals.isSafeInteger(...args); };
    Object.is = (...args) => { hooks += 1; return originals.objectIs(...args); };
    Set.prototype.has = function hostileHas(...args) {
      hooks += 1;
      return originals.setHas.call(this, ...args);
    };
    globalThis.Date = function HostileDate(...args) {
      hooks += 1;
      return Reflect.construct(originals.Date, args, new.target || originals.Date);
    };
    assert.equal(
      domain.createTenantSkyscraperNavigationAuthorizer(publicFixture()).decideNavigation(request()).ok,
      true,
    );
  } finally {
    Object.assign = originals.assign;
    Array.isArray = originals.isArray;
    Number.isFinite = originals.isFinite;
    Number.isSafeInteger = originals.isSafeInteger;
    Object.is = originals.objectIs;
    Set.prototype.has = originals.setHas;
    globalThis.Date = originals.Date;
  }
  assert.equal(hooks, 0);
});

test('B9 rejects tenant-owned public suites without resolving the ambient Set constructor', async () => {
  const domain = await loadDomain();
  const options = publicFixture();
  for (const suite of options.catalog.building.floors[0].destinations.slice(0, 4)) {
    suite.accessState = 'public';
  }
  const OriginalSet = globalThis.Set;
  let hostileConstructorCalls = 0;
  try {
    globalThis.Set = function HostileSet(iterable) {
      hostileConstructorCalls += 1;
      const value = new OriginalSet(iterable);
      if (Array.isArray(iterable) && iterable.length === 3
          && iterable[0] === 'tenant' && iterable[1] === 'private' && iterable[2] === 'restricted') {
        value.add('public');
      }
      return value;
    };
    const authorizer = domain.createTenantSkyscraperNavigationAuthorizer(options);
    const first = authorizer.decideNavigation(request('id_0000000000000101'));
    const second = authorizer.decideNavigation(request('id_0000000000000101'));
    assert.deepEqual({
      hostileConstructorCalls,
      first: { ok: first.ok, code: first.code },
      second: { ok: second.ok, code: second.code },
      fresh: first !== second,
    }, {
      hostileConstructorCalls: 0,
      first: { ok: false, code: 'not_found' },
      second: { ok: false, code: 'not_found' },
      fresh: true,
    });
  } finally {
    globalThis.Set = OriginalSet;
  }
});

test('B9 rejects duplicate linked IDs without resolving ambient Set insertion', async () => {
  const domain = await loadDomain();
  const options = publicFixture();
  options.catalog.building.floors[0].destinations[1].destinationId =
    options.catalog.building.floors[0].destinations[0].destinationId;
  const originalAdd = Set.prototype.add;
  let hostileAddCalls = 0;
  try {
    Set.prototype.add = function hostileAdd() {
      hostileAddCalls += 1;
      return this;
    };
    const authorizer = domain.createTenantSkyscraperNavigationAuthorizer(options);
    const first = authorizer.decideNavigation(request());
    const second = authorizer.decideNavigation(request());
    assert.deepEqual({
      hostileAddCalls,
      first: { ok: first.ok, code: first.code },
      second: { ok: second.ok, code: second.code },
      fresh: first !== second,
    }, {
      hostileAddCalls: 0,
      first: { ok: false, code: 'not_found' },
      second: { ok: false, code: 'not_found' },
      fresh: true,
    });
  } finally {
    Set.prototype.add = originalAdd;
  }
});

test('B9 rejects mismatched owner catalogs without resolving ambient Set iteration', async () => {
  const domain = await loadDomain();
  const baselineOptions = publicFixture();
  baselineOptions.authorization.ownerTenantLifecycles = [{
    tenantId: FOREIGN_TENANT,
    lifecycle: 'active',
  }];
  const baselineAuthorizer = domain.createTenantSkyscraperNavigationAuthorizer(baselineOptions);
  const baselineFirst = baselineAuthorizer.decideNavigation(request());
  const baselineSecond = baselineAuthorizer.decideNavigation(request());
  assert.deepEqual({
    first: { ok: baselineFirst.ok, code: baselineFirst.code },
    second: { ok: baselineSecond.ok, code: baselineSecond.code },
    fresh: baselineFirst !== baselineSecond,
  }, {
    first: { ok: false, code: 'not_found' },
    second: { ok: false, code: 'not_found' },
    fresh: true,
  });

  const options = publicFixture();
  options.authorization.ownerTenantLifecycles = [{
    tenantId: FOREIGN_TENANT,
    lifecycle: 'active',
  }];
  const originalIterator = Set.prototype[Symbol.iterator];
  let hostileIteratorCalls = 0;
  try {
    Set.prototype[Symbol.iterator] = function hostileIterator() {
      hostileIteratorCalls += 1;
      return { next() { return { done: true, value: undefined }; } };
    };
    const authorizer = domain.createTenantSkyscraperNavigationAuthorizer(options);
    const first = authorizer.decideNavigation(request());
    const second = authorizer.decideNavigation(request());
    assert.deepEqual({
      hostileIteratorCalls,
      first: { ok: first.ok, code: first.code },
      second: { ok: second.ok, code: second.code },
      fresh: first !== second,
    }, {
      hostileIteratorCalls: 0,
      first: { ok: false, code: 'not_found' },
      second: { ok: false, code: 'not_found' },
      fresh: true,
    });
  } finally {
    Set.prototype[Symbol.iterator] = originalIterator;
  }
});

test('B9 rejects incomplete owner catalogs without resolving ambient Set cardinality', async () => {
  const domain = await loadDomain();
  const makeOptions = () => {
    const options = publicFixture();
    options.catalog.building.floors[0].destinations[3].ownerTenantId = FOREIGN_TENANT;
    return options;
  };
  const baselineAuthorizer = domain.createTenantSkyscraperNavigationAuthorizer(makeOptions());
  const baselineFirst = baselineAuthorizer.decideNavigation(request());
  const baselineSecond = baselineAuthorizer.decideNavigation(request());
  assert.deepEqual({
    first: { ok: baselineFirst.ok, code: baselineFirst.code },
    second: { ok: baselineSecond.ok, code: baselineSecond.code },
    fresh: baselineFirst !== baselineSecond,
  }, {
    first: { ok: false, code: 'not_found' },
    second: { ok: false, code: 'not_found' },
    fresh: true,
  });

  const originalSizeDescriptor = Object.getOwnPropertyDescriptor(Set.prototype, 'size');
  let hostileSizeCalls = 0;
  try {
    Object.defineProperty(Set.prototype, 'size', {
      ...originalSizeDescriptor,
      get() {
        hostileSizeCalls += 1;
        return 1;
      },
    });
    const authorizer = domain.createTenantSkyscraperNavigationAuthorizer(makeOptions());
    const first = authorizer.decideNavigation(request());
    const second = authorizer.decideNavigation(request());
    assert.deepEqual({
      hostileSizeCalls,
      first: { ok: first.ok, code: first.code },
      second: { ok: second.ok, code: second.code },
      fresh: first !== second,
    }, {
      hostileSizeCalls: 0,
      first: { ok: false, code: 'not_found' },
      second: { ok: false, code: 'not_found' },
      fresh: true,
    });
  } finally {
    Object.defineProperty(Set.prototype, 'size', originalSizeDescriptor);
  }
});

test('B9 rejects shared authorization arrays without resolving ambient WeakSet identity hooks', async () => {
  const domain = await loadDomain();
  const makeOptions = () => {
    const options = publicFixture();
    const sharedScopes = [];
    options.authorization.privateDestinationGrants = sharedScopes;
    options.authorization.restrictedDestinationAuthorities = sharedScopes;
    return options;
  };
  const baselineAuthorizer = domain.createTenantSkyscraperNavigationAuthorizer(makeOptions());
  const baselineFirst = baselineAuthorizer.decideNavigation(request());
  const baselineSecond = baselineAuthorizer.decideNavigation(request());
  assert.deepEqual({
    first: { ok: baselineFirst.ok, code: baselineFirst.code },
    second: { ok: baselineSecond.ok, code: baselineSecond.code },
    fresh: baselineFirst !== baselineSecond,
  }, {
    first: { ok: false, code: 'not_found' },
    second: { ok: false, code: 'not_found' },
    fresh: true,
  });

  const originalWeakSetDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'WeakSet');
  let constructorCalls = 0;
  let hasCalls = 0;
  let addCalls = 0;
  try {
    Object.defineProperty(globalThis, 'WeakSet', {
      ...originalWeakSetDescriptor,
      value: class HostileWeakSet {
        constructor() { constructorCalls += 1; }
        has() { hasCalls += 1; return false; }
        add() { addCalls += 1; return this; }
      },
    });
    const authorizer = domain.createTenantSkyscraperNavigationAuthorizer(makeOptions());
    const first = authorizer.decideNavigation(request());
    const second = authorizer.decideNavigation(request());
    assert.deepEqual({
      constructorCalls,
      hasCalls,
      addCalls,
      first: { ok: first.ok, code: first.code },
      second: { ok: second.ok, code: second.code },
      fresh: first !== second,
    }, {
      constructorCalls: 0,
      hasCalls: 0,
      addCalls: 0,
      first: { ok: false, code: 'not_found' },
      second: { ok: false, code: 'not_found' },
      fresh: true,
    });
  } finally {
    Object.defineProperty(globalThis, 'WeakSet', originalWeakSetDescriptor);
  }
});

test('B9 rejects tenant-owned suites without resolving ambient Array insertion', async () => {
  const domain = await loadDomain();
  const targetDestinationId = 'id_0000000000000101';
  const baselineAuthorizer = domain.createTenantSkyscraperNavigationAuthorizer(publicFixture());
  const baselineFirst = baselineAuthorizer.decideNavigation(request(targetDestinationId));
  const baselineSecond = baselineAuthorizer.decideNavigation(request(targetDestinationId));
  assert.deepEqual({
    first: { ok: baselineFirst.ok, code: baselineFirst.code },
    second: { ok: baselineSecond.ok, code: baselineSecond.code },
    fresh: baselineFirst !== baselineSecond,
  }, {
    first: { ok: false, code: 'not_found' },
    second: { ok: false, code: 'not_found' },
    fresh: true,
  });

  const originalPushDescriptor = Object.getOwnPropertyDescriptor(Array.prototype, 'push');
  const originalPush = originalPushDescriptor.value;
  let pushCalls = 0;
  let targetedCalls = 0;
  let observed;
  try {
    Object.defineProperty(Array.prototype, 'push', {
      ...originalPushDescriptor,
      value: function hostilePush(...args) {
        pushCalls += 1;
        if (args.length === 1 && args[0] !== null
            && Object.getPrototypeOf(args[0]) === null
            && args[0].destinationId === targetDestinationId) {
          targetedCalls += 1;
          args[0].destinationKind = 'shared_space';
          args[0].accessState = 'public';
          args[0].ownerTenantId = null;
          args[0].sharedSpacePolicy = 'building_public';
        }
        return Reflect.apply(originalPush, this, args);
      },
    });
    const authorizer = domain.createTenantSkyscraperNavigationAuthorizer(publicFixture());
    const first = authorizer.decideNavigation(request(targetDestinationId));
    const second = authorizer.decideNavigation(request(targetDestinationId));
    observed = {
      pushCalls,
      targetedCalls,
      first: { ok: first.ok, code: first.code },
      second: { ok: second.ok, code: second.code },
      fresh: first !== second,
    };
  } finally {
    Object.defineProperty(Array.prototype, 'push', originalPushDescriptor);
  }
  assert.deepEqual(observed, {
    pushCalls: 0,
    targetedCalls: 0,
    first: { ok: false, code: 'not_found' },
    second: { ok: false, code: 'not_found' },
    fresh: true,
  });
});

test('B9 rejects five-suite catalogs without resolving ambient Array iteration', async () => {
  const domain = await loadDomain();
  const targetDestinationId = 'id_0000000000000101';
  const makeOptions = () => {
    const options = publicFixture();
    options.catalog.building.floors[0].destinations[4] =
      destination('id_0000000000000105');
    return options;
  };
  const baselineAuthorizer = domain.createTenantSkyscraperNavigationAuthorizer(makeOptions());
  const baselineFirst = baselineAuthorizer.decideNavigation(request(targetDestinationId));
  const baselineSecond = baselineAuthorizer.decideNavigation(request(targetDestinationId));
  assert.deepEqual({
    first: { ok: baselineFirst.ok, code: baselineFirst.code },
    second: { ok: baselineSecond.ok, code: baselineSecond.code },
    fresh: baselineFirst !== baselineSecond,
  }, {
    first: { ok: false, code: 'not_found' },
    second: { ok: false, code: 'not_found' },
    fresh: true,
  });

  const options = makeOptions();
  const originalIteratorDescriptor = Object.getOwnPropertyDescriptor(
    Array.prototype,
    Symbol.iterator,
  );
  const originalIterator = originalIteratorDescriptor.value;
  let iteratorCalls = 0;
  let targetedCalls = 0;
  let observed;
  try {
    Object.defineProperty(Array.prototype, Symbol.iterator, {
      ...originalIteratorDescriptor,
      value: function hostileIterator() {
        iteratorCalls += 1;
        if (this.length === 5 && this[0].destinationId === targetDestinationId) {
          targetedCalls += 1;
          this[0].destinationKind = 'shared_space';
          this[0].accessState = 'public';
          this[0].ownerTenantId = null;
          this[0].sharedSpacePolicy = 'building_public';
        }
        return Reflect.apply(originalIterator, this, []);
      },
    });
    const authorizer = domain.createTenantSkyscraperNavigationAuthorizer(options);
    const first = authorizer.decideNavigation(request(targetDestinationId));
    const second = authorizer.decideNavigation(request(targetDestinationId));
    observed = {
      iteratorCalls,
      targetedCalls,
      first: { ok: first.ok, code: first.code },
      second: { ok: second.ok, code: second.code },
      fresh: first !== second,
    };
  } finally {
    Object.defineProperty(Array.prototype, Symbol.iterator, originalIteratorDescriptor);
  }
  assert.deepEqual(observed, {
    iteratorCalls: 0,
    targetedCalls: 0,
    first: { ok: false, code: 'not_found' },
    second: { ok: false, code: 'not_found' },
    fresh: true,
  });
});

test('B9 rejects five-suite catalogs without resolving ambient Array predicates', async () => {
  const domain = await loadDomain();
  const targetDestinationId = 'id_0000000000000101';
  const makeOptions = () => {
    const options = publicFixture();
    options.catalog.building.floors[0].destinations[4] =
      destination('id_0000000000000105');
    return options;
  };
  const baselineAuthorizer = domain.createTenantSkyscraperNavigationAuthorizer(makeOptions());
  const baselineFirst = baselineAuthorizer.decideNavigation(request(targetDestinationId));
  const baselineSecond = baselineAuthorizer.decideNavigation(request(targetDestinationId));
  assert.deepEqual({
    first: { ok: baselineFirst.ok, code: baselineFirst.code },
    second: { ok: baselineSecond.ok, code: baselineSecond.code },
    fresh: baselineFirst !== baselineSecond,
  }, {
    first: { ok: false, code: 'not_found' },
    second: { ok: false, code: 'not_found' },
    fresh: true,
  });

  const options = makeOptions();
  const originalSomeDescriptor = Object.getOwnPropertyDescriptor(Array.prototype, 'some');
  const originalSome = originalSomeDescriptor.value;
  let someCalls = 0;
  let targetedCalls = 0;
  let observed;
  try {
    Object.defineProperty(Array.prototype, 'some', {
      ...originalSomeDescriptor,
      value: function hostileSome(...args) {
        someCalls += 1;
        if (targetedCalls === 0 && this.length === 8 && this[0] === 'destinationId'
            && this[7] === 'sharedSpacePolicy') {
          targetedCalls += 1;
          const target = options.catalog.building.floors[0].destinations[0];
          target.destinationKind = 'shared_space';
          target.accessState = 'public';
          target.ownerTenantId = null;
          target.sharedSpacePolicy = 'building_public';
        }
        return Reflect.apply(originalSome, this, args);
      },
    });
    const authorizer = domain.createTenantSkyscraperNavigationAuthorizer(options);
    const first = authorizer.decideNavigation(request(targetDestinationId));
    const second = authorizer.decideNavigation(request(targetDestinationId));
    observed = {
      someCalls,
      targetedCalls,
      first: { ok: first.ok, code: first.code },
      second: { ok: second.ok, code: second.code },
      fresh: first !== second,
    };
  } finally {
    Object.defineProperty(Array.prototype, 'some', originalSomeDescriptor);
  }
  assert.deepEqual(observed, {
    someCalls: 0,
    targetedCalls: 0,
    first: { ok: false, code: 'not_found' },
    second: { ok: false, code: 'not_found' },
    fresh: true,
  });
});

test('B9 rejects five-suite catalogs without resolving ambient Array membership', async () => {
  const domain = await loadDomain();
  const targetDestinationId = 'id_0000000000000101';
  const makeOptions = () => {
    const options = publicFixture();
    options.catalog.building.floors[0].destinations[4] =
      destination('id_0000000000000105');
    return options;
  };
  const baselineAuthorizer = domain.createTenantSkyscraperNavigationAuthorizer(makeOptions());
  const baselineFirst = baselineAuthorizer.decideNavigation(request(targetDestinationId));
  const baselineSecond = baselineAuthorizer.decideNavigation(request(targetDestinationId));
  assert.deepEqual({
    first: { ok: baselineFirst.ok, code: baselineFirst.code },
    second: { ok: baselineSecond.ok, code: baselineSecond.code },
    fresh: baselineFirst !== baselineSecond,
  }, {
    first: { ok: false, code: 'not_found' },
    second: { ok: false, code: 'not_found' },
    fresh: true,
  });

  const options = makeOptions();
  const originalIncludesDescriptor = Object.getOwnPropertyDescriptor(Array.prototype, 'includes');
  const originalIncludes = originalIncludesDescriptor.value;
  let includesCalls = 0;
  let targetedCalls = 0;
  let observed;
  try {
    Object.defineProperty(Array.prototype, 'includes', {
      ...originalIncludesDescriptor,
      value: function hostileIncludes(...args) {
        includesCalls += 1;
        if (targetedCalls === 0 && this.length === 8 && this[0] === 'destinationId'
            && this[7] === 'sharedSpacePolicy') {
          targetedCalls += 1;
          const target = options.catalog.building.floors[0].destinations[0];
          target.destinationKind = 'shared_space';
          target.accessState = 'public';
          target.ownerTenantId = null;
          target.sharedSpacePolicy = 'building_public';
        }
        return Reflect.apply(originalIncludes, this, args);
      },
    });
    const authorizer = domain.createTenantSkyscraperNavigationAuthorizer(options);
    const first = authorizer.decideNavigation(request(targetDestinationId));
    const second = authorizer.decideNavigation(request(targetDestinationId));
    observed = {
      includesCalls,
      targetedCalls,
      first: { ok: first.ok, code: first.code },
      second: { ok: second.ok, code: second.code },
      fresh: first !== second,
    };
  } finally {
    Object.defineProperty(Array.prototype, 'includes', originalIncludesDescriptor);
  }
  assert.deepEqual(observed, {
    includesCalls: 0,
    targetedCalls: 0,
    first: { ok: false, code: 'not_found' },
    second: { ok: false, code: 'not_found' },
    fresh: true,
  });
});

test('B9 rejects five-suite catalogs without resolving the ambient Array prototype', async () => {
  const domain = await loadDomain();
  const targetDestinationId = 'id_0000000000000101';
  const makeOptions = () => {
    const options = publicFixture();
    options.catalog.building.floors[0].destinations[4] =
      destination('id_0000000000000105');
    return options;
  };
  const baselineAuthorizer = domain.createTenantSkyscraperNavigationAuthorizer(makeOptions());
  const baselineFirst = baselineAuthorizer.decideNavigation(request(targetDestinationId));
  const baselineSecond = baselineAuthorizer.decideNavigation(request(targetDestinationId));
  assert.deepEqual({
    first: { ok: baselineFirst.ok, code: baselineFirst.code },
    second: { ok: baselineSecond.ok, code: baselineSecond.code },
    fresh: baselineFirst !== baselineSecond,
  }, {
    first: { ok: false, code: 'not_found' },
    second: { ok: false, code: 'not_found' },
    fresh: true,
  });

  const options = makeOptions();
  const originalArrayDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'Array');
  const originalArray = originalArrayDescriptor.value;
  let prototypeGets = 0;
  let targetedCalls = 0;
  let observed;
  try {
    Object.defineProperty(globalThis, 'Array', {
      ...originalArrayDescriptor,
      value: new Proxy(originalArray, {
        get(target, property, receiver) {
          if (property === 'prototype') {
            prototypeGets += 1;
            if (targetedCalls === 0) {
              targetedCalls += 1;
              const destinationToMutate = options.catalog.building.floors[0].destinations[0];
              destinationToMutate.destinationKind = 'shared_space';
              destinationToMutate.accessState = 'public';
              destinationToMutate.ownerTenantId = null;
              destinationToMutate.sharedSpacePolicy = 'building_public';
            }
          }
          return Reflect.get(target, property, receiver);
        },
      }),
    });
    const authorizer = domain.createTenantSkyscraperNavigationAuthorizer(options);
    const first = authorizer.decideNavigation(request(targetDestinationId));
    const second = authorizer.decideNavigation(request(targetDestinationId));
    observed = {
      prototypeGets,
      targetedCalls,
      first: { ok: first.ok, code: first.code },
      second: { ok: second.ok, code: second.code },
      fresh: first !== second,
    };
  } finally {
    Object.defineProperty(globalThis, 'Array', originalArrayDescriptor);
  }
  assert.deepEqual(observed, {
    prototypeGets: 0,
    targetedCalls: 0,
    first: { ok: false, code: 'not_found' },
    second: { ok: false, code: 'not_found' },
    fresh: true,
  });
});

test('B9 rejects five-suite catalogs without resolving the ambient Object prototype', async () => {
  const domain = await loadDomain();
  const targetDestinationId = 'id_0000000000000101';
  const makeOptions = () => {
    const options = publicFixture();
    options.catalog.building.floors[0].destinations[4] =
      destination('id_0000000000000105');
    return options;
  };
  const baselineAuthorizer = domain.createTenantSkyscraperNavigationAuthorizer(makeOptions());
  const baselineFirst = baselineAuthorizer.decideNavigation(request(targetDestinationId));
  const baselineSecond = baselineAuthorizer.decideNavigation(request(targetDestinationId));
  assert.deepEqual({
    first: { ok: baselineFirst.ok, code: baselineFirst.code },
    second: { ok: baselineSecond.ok, code: baselineSecond.code },
    fresh: baselineFirst !== baselineSecond,
  }, {
    first: { ok: false, code: 'not_found' },
    second: { ok: false, code: 'not_found' },
    fresh: true,
  });

  const options = makeOptions();
  const defineProperty = Object.defineProperty;
  const originalObjectDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'Object');
  const originalObject = originalObjectDescriptor.value;
  let prototypeGets = 0;
  let targetedCalls = 0;
  let observed;
  try {
    defineProperty(globalThis, 'Object', {
      ...originalObjectDescriptor,
      value: new Proxy(originalObject, {
        get(target, property, receiver) {
          if (property === 'prototype') {
            prototypeGets += 1;
            if (targetedCalls === 0) {
              targetedCalls += 1;
              const destinationToMutate = options.catalog.building.floors[0].destinations[0];
              destinationToMutate.destinationKind = 'shared_space';
              destinationToMutate.accessState = 'public';
              destinationToMutate.ownerTenantId = null;
              destinationToMutate.sharedSpacePolicy = 'building_public';
            }
          }
          return Reflect.get(target, property, receiver);
        },
      }),
    });
    const authorizer = domain.createTenantSkyscraperNavigationAuthorizer(options);
    const first = authorizer.decideNavigation(request(targetDestinationId));
    const second = authorizer.decideNavigation(request(targetDestinationId));
    observed = {
      prototypeGets,
      targetedCalls,
      first: { ok: first.ok, code: first.code },
      second: { ok: second.ok, code: second.code },
      fresh: first !== second,
    };
  } finally {
    defineProperty(globalThis, 'Object', originalObjectDescriptor);
  }
  assert.deepEqual(observed, {
    prototypeGets: 0,
    targetedCalls: 0,
    first: { ok: false, code: 'not_found' },
    second: { ok: false, code: 'not_found' },
    fresh: true,
  });
});

test('B9 rejects five-suite catalogs without calling the ambient String constructor', async () => {
  const domain = await loadDomain();
  const targetDestinationId = 'id_0000000000000101';
  const makeOptions = () => {
    const options = publicFixture();
    options.catalog.building.floors[0].destinations[4] =
      destination('id_0000000000000105');
    return options;
  };
  const baselineAuthorizer = domain.createTenantSkyscraperNavigationAuthorizer(makeOptions());
  const baselineFirst = baselineAuthorizer.decideNavigation(request(targetDestinationId));
  const baselineSecond = baselineAuthorizer.decideNavigation(request(targetDestinationId));
  assert.deepEqual({
    first: { ok: baselineFirst.ok, code: baselineFirst.code },
    second: { ok: baselineSecond.ok, code: baselineSecond.code },
    fresh: baselineFirst !== baselineSecond,
  }, {
    first: { ok: false, code: 'not_found' },
    second: { ok: false, code: 'not_found' },
    fresh: true,
  });

  const options = makeOptions();
  const originalStringDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'String');
  const originalString = originalStringDescriptor.value;
  let stringCalls = 0;
  let targetedCalls = 0;
  let observed;
  try {
    Object.defineProperty(globalThis, 'String', {
      ...originalStringDescriptor,
      value: new Proxy(originalString, {
        apply(target, thisArgument, argumentsList) {
          stringCalls += 1;
          if (targetedCalls === 0) {
            targetedCalls += 1;
            const destinationToMutate = options.catalog.building.floors[0].destinations[0];
            destinationToMutate.destinationKind = 'shared_space';
            destinationToMutate.accessState = 'public';
            destinationToMutate.ownerTenantId = null;
            destinationToMutate.sharedSpacePolicy = 'building_public';
          }
          return Reflect.apply(target, thisArgument, argumentsList);
        },
      }),
    });
    const authorizer = domain.createTenantSkyscraperNavigationAuthorizer(options);
    const first = authorizer.decideNavigation(request(targetDestinationId));
    const second = authorizer.decideNavigation(request(targetDestinationId));
    observed = {
      stringCalls,
      targetedCalls,
      first: { ok: first.ok, code: first.code },
      second: { ok: second.ok, code: second.code },
      fresh: first !== second,
    };
  } finally {
    Object.defineProperty(globalThis, 'String', originalStringDescriptor);
  }
  assert.deepEqual(observed, {
    stringCalls: 0,
    targetedCalls: 0,
    first: { ok: false, code: 'not_found' },
    second: { ok: false, code: 'not_found' },
    fresh: true,
  });
});

test('B10 hostile graphs, descriptors, proxies, scalars, and budgets fail closed without coercion', async () => {
  const domain = await loadDomain();
  let hooks = 0;
  const accessor = publicFixture();
  Object.defineProperty(accessor.catalog.building, 'displayName', {
    enumerable: true,
    get() { hooks += 1; return 'Synthetic Tower'; },
  });
  const inherited = Object.create({ catalog: publicFixture().catalog });
  Object.assign(inherited, {
    authorization: publicFixture().authorization,
    evaluatedAt: EVALUATED_AT,
  });
  const symbol = publicFixture();
  symbol[Symbol('hidden')] = true;
  const shared = publicFixture();
  shared.catalog.building.floors[0].destinations[1] =
    shared.catalog.building.floors[0].destinations[0];
  const oversized = publicFixture();
  oversized.catalog.building.floors[0].destinations.push(
    destination('id_0000000000000201'), destination('id_0000000000000202'),
    destination('id_0000000000000203'), destination('id_0000000000000204'),
  );
  const frozenArray = publicFixture();
  Object.freeze(frozenArray.catalog.building.floors[0].destinations);
  for (const options of [accessor, inherited, symbol, shared, oversized, frozenArray]) {
    assert.deepEqual(
      domain.createTenantSkyscraperNavigationAuthorizer(options).decideNavigation(request()),
      { ok: false, code: 'not_found' },
    );
  }
  const valid = domain.createTenantSkyscraperNavigationAuthorizer(publicFixture());
  assert.deepEqual(valid.decideNavigation(new Proxy(request(), {})), { ok: false, code: 'not_found' });
  assert.deepEqual(valid.decideNavigation({ ...request(), policyRevision: 1 }), { ok: false, code: 'not_found' });
  assert.equal(hooks, 0);
});

test('B11 inactive resources and mismatched navigation tuples always return generic denial', async () => {
  const domain = await loadDomain();
  const attacks = [];
  for (const mutate of [
    (value) => { value.catalog.building.lifecycle = 'archived'; },
    (value) => { value.catalog.building.floors[0].lifecycle = 'deleted_tombstone'; },
    (value) => { value.catalog.building.floors[0].destinations[4].lifecycle = 'archived'; },
  ]) {
    const options = publicFixture();
    mutate(options);
    attacks.push([options, request()]);
  }
  attacks.push([publicFixture(), { ...request(), elevatorStopId: 'id_ffffffffffffffff' }]);
  attacks.push([publicFixture(), { ...request(), channel: 'route-label' }]);
  const ownerArchived = authenticatedFixture();
  ownerArchived.authorization.ownerTenantLifecycles[0].lifecycle = 'archived';
  attacks.push([ownerArchived, request('id_0000000000000101')]);
  for (const [options, navigationRequest] of attacks) {
    assert.deepEqual(
      domain.createTenantSkyscraperNavigationAuthorizer(options).decideNavigation(navigationRequest),
      { ok: false, code: 'not_found' },
    );
  }
});
