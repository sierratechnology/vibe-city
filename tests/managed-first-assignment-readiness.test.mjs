import assert from 'node:assert/strict';
import test from 'node:test';

import { createManagedCustomerIdentityDomain } from '../server/managedCustomerIdentityDomain.mjs';
import { createManagedRepositoryConnectionReadiness } from '../server/managedRepositoryConnectionReadiness.mjs';
import { createManagedStarterAgentReadiness } from '../server/managedStarterAgentReadiness.mjs';
import { createManagedSuiteSelectionPresentation } from '../server/managedSuiteSelectionPresentation.mjs';
import { createManagedSuiteSelectionReadiness } from '../server/managedSuiteSelectionReadiness.mjs';

const MODULE_PATH = '../server/managedFirstAssignmentReadiness.mjs';
const SUFFIX = '0000000000000001';
const GATE_NAMES = [
  'direction_authorization',
  'assignment_definition',
  'owner_accountability',
  'assignee_identity',
  'repository_work_access',
  'evidence_plan',
  'review_authority',
  'outcome_acceptance',
];
const GENERIC_ERROR = {
  name: 'TypeError',
  message: 'Invalid managed first assignment readiness input',
};

async function loadDomain() {
  return import(MODULE_PATH).catch(() => ({}));
}

function identityFixture(suffix = SUFFIX) {
  return {
    schemaVersion: 'managed-customer-identity/1',
    account: { accountId: `account_${suffix}`, displayLabel: 'Synthetic Account', lifecycle: 'active' },
    organization: {
      organizationId: `organization_${suffix}`,
      displayLabel: 'Synthetic Organization',
      lifecycle: 'active',
    },
    membership: {
      accountId: `account_${suffix}`,
      organizationId: `organization_${suffix}`,
      roleLabel: 'member',
      lifecycle: 'active',
    },
  };
}

function suiteReadinessFixture(suffix = SUFFIX) {
  const names = ['pricing', 'lease_terms', 'payment', 'refunds', 'tax', 'capacity'];
  return {
    schemaVersion: 'managed-suite-selection-readiness/1',
    tenantId: `tenant_${suffix}`,
    organizationId: `organization_${suffix}`,
    evaluatedAt: '2026-10-04T05:00:00.000Z',
    gates: names.map((name, index) => ({
      name,
      state: index % 2 === 0 ? 'blocked' : 'not_configured',
      sourceRef: `${index + 1}`.padStart(16, '0'),
      observedAt: '2026-10-04T04:59:00.000Z',
    })),
  };
}

function starterObservationFixture(suffix = SUFFIX) {
  const names = [
    'suite_commitment', 'hosted_identity', 'provider_selection',
    'credential_issuance', 'authority_policy', 'workplace_assignment',
  ];
  return {
    schemaVersion: 'managed-starter-agent-readiness-observation/1',
    tenantId: `tenant_${suffix}`,
    accountId: `account_${suffix}`,
    organizationId: `organization_${suffix}`,
    evaluatedAt: '2026-10-04T05:30:00.000Z',
    gates: names.map((name, index) => ({
      name,
      state: index % 2 === 0 ? 'blocked' : 'not_configured',
      sourceRef: `${index + 7}`.padStart(16, '0'),
      observedAt: '2026-10-04T05:29:00.000Z',
    })),
  };
}

function repositoryObservationFixture(suffix = SUFFIX) {
  const names = [
    'repository_identity', 'tenant_binding', 'repository_access',
    'data_classification', 'credential_issuance', 'authorization_policy',
  ];
  return {
    schemaVersion: 'managed-repository-connection-readiness-observation/1',
    tenantId: `tenant_${suffix}`,
    accountId: `account_${suffix}`,
    organizationId: `organization_${suffix}`,
    evaluatedAt: '2026-10-04T06:00:00.000Z',
    gates: names.map((name, index) => ({
      name,
      state: index % 2 === 0 ? 'blocked' : 'not_configured',
      sourceRef: `${index + 13}`.padStart(16, '0'),
      observedAt: '2026-10-04T05:59:00.000Z',
    })),
  };
}

function observationFixture(suffix = SUFFIX) {
  return {
    schemaVersion: 'managed-first-assignment-readiness-observation/1',
    tenantId: `tenant_${suffix}`,
    accountId: `account_${suffix}`,
    organizationId: `organization_${suffix}`,
    evaluatedAt: '2026-10-04T06:30:00.000Z',
    gates: GATE_NAMES.map((name, index) => ({
      name,
      state: index % 2 === 0 ? 'blocked' : 'not_configured',
      sourceRef: `${index + 19}`.padStart(16, '0'),
      observedAt: '2026-10-04T06:29:00.000Z',
    })),
  };
}

function genuineRepository(
  suffix = SUFFIX,
  repositoryFactory = createManagedRepositoryConnectionReadiness,
) {
  const identity = createManagedCustomerIdentityDomain(identityFixture(suffix));
  const suiteReadiness = createManagedSuiteSelectionReadiness(suiteReadinessFixture(suffix));
  const presentation = createManagedSuiteSelectionPresentation(identity, suiteReadiness);
  const starter = createManagedStarterAgentReadiness(
    identity,
    presentation,
    starterObservationFixture(suffix),
  );
  return repositoryFactory(
    identity,
    presentation,
    starter,
    repositoryObservationFixture(suffix),
  );
}

test('T1 genuine matching repository readiness produces only blocked assignment readiness', async () => {
  const domain = await loadDomain();
  assert.equal(typeof domain.createManagedFirstAssignmentReadiness, 'function');
  const observation = observationFixture();
  const result = domain.createManagedFirstAssignmentReadiness(genuineRepository(), observation);
  assert.deepEqual({ ...result, gates: result.gates.map((gate) => ({ ...gate })) }, {
    schemaVersion: 'managed-first-assignment-readiness/1',
    tenantId: `tenant_${SUFFIX}`,
    accountId: `account_${SUFFIX}`,
    organizationId: `organization_${SUFFIX}`,
    evaluatedAt: observation.evaluatedAt,
    assignmentStatus: 'blocked',
    canCreate: false,
    canStart: false,
    canComplete: false,
    gates: observation.gates.map(({ name, state }) => ({ name, state })),
  });
});

test('T2 exact repository result and tenant account organization binding are mandatory', async () => {
  const domain = await loadDomain();
  const repository = genuineRepository();
  const other = genuineRepository('0000000000000002');
  const observation = observationFixture();
  const copied = Object.freeze(Object.assign(Object.create(null), repository));
  for (const [candidateRepository, candidateObservation] of [
    [copied, observation],
    [other, observation],
    [repository, { ...observation, tenantId: 'tenant_0000000000000002' }],
    [repository, { ...observation, accountId: 'account_0000000000000002' }],
    [repository, { ...observation, organizationId: 'organization_0000000000000002' }],
  ]) {
    assert.throws(
      () => domain.createManagedFirstAssignmentReadiness(candidateRepository, candidateObservation),
      GENERIC_ERROR,
    );
  }
});

test('T3 observation schema and ordered non-ready gates are exact and closed', async () => {
  const domain = await loadDomain();
  const repository = genuineRepository();
  const invalid = [{ ...observationFixture(), assignment: 'invented' }];
  const omitted = observationFixture();
  omitted.gates.pop();
  invalid.push(omitted);
  const reordered = observationFixture();
  [reordered.gates[0], reordered.gates[1]] = [reordered.gates[1], reordered.gates[0]];
  invalid.push(reordered);
  const duplicate = observationFixture();
  duplicate.gates[7].name = duplicate.gates[6].name;
  invalid.push(duplicate);
  const extraGateField = observationFixture();
  extraGateField.gates[0].actor = 'invented';
  invalid.push(extraGateField);
  for (const index of [0, 3, 4, 6, 7]) {
    const claiming = observationFixture();
    claiming.gates[index].state = 'ready';
    invalid.push(claiming);
  }
  for (const observation of invalid) {
    assert.throws(
      () => domain.createManagedFirstAssignmentReadiness(repository, observation),
      GENERIC_ERROR,
    );
  }
});

test('T4 predecessor and gate freshness accepts exactly one day and rejects stale or future', async () => {
  const domain = await loadDomain();
  const repository = genuineRepository();
  const boundary = observationFixture();
  boundary.evaluatedAt = '2026-10-05T06:00:00.000Z';
  for (const gate of boundary.gates) gate.observedAt = '2026-10-04T06:00:00.000Z';
  assert.equal(
    domain.createManagedFirstAssignmentReadiness(repository, boundary).assignmentStatus,
    'blocked',
  );

  const stalePredecessor = observationFixture();
  stalePredecessor.evaluatedAt = '2026-10-05T06:00:00.001Z';
  const futurePredecessor = observationFixture();
  futurePredecessor.evaluatedAt = '2026-10-04T05:59:59.999Z';
  const staleGate = observationFixture();
  staleGate.gates[0].observedAt = '2026-10-03T06:29:59.999Z';
  const futureGate = observationFixture();
  futureGate.gates[0].observedAt = '2026-10-04T06:30:00.001Z';
  const malformedTime = observationFixture();
  malformedTime.evaluatedAt = '2026-02-29T06:30:00.000Z';
  for (const observation of [
    stalePredecessor, futurePredecessor, staleGate, futureGate, malformedTime,
  ]) {
    assert.throws(
      () => domain.createManagedFirstAssignmentReadiness(repository, observation),
      GENERIC_ERROR,
    );
  }
});

test('T5 hostile closed-schema inputs fail generically without dispatching hooks', async () => {
  const domain = await loadDomain();
  const repository = genuineRepository();
  let hooks = 0;
  const hostileRepository = new Proxy(repository, {
    get() { hooks += 1; throw new Error('private'); },
    getPrototypeOf() { hooks += 1; throw new Error('private'); },
    ownKeys() { hooks += 1; throw new Error('private'); },
  });
  const accessor = observationFixture();
  Object.defineProperty(accessor.gates[0], 'sourceRef', {
    enumerable: true,
    get() { hooks += 1; return '0000000000000019'; },
  });
  const inherited = Object.assign(Object.create({ private: true }), observationFixture());
  const symbolic = observationFixture();
  symbolic.gates[0][Symbol('private')] = true;
  const shared = observationFixture();
  shared.gates[7] = shared.gates[6];
  const cyclic = observationFixture();
  cyclic.gates[0].sourceRef = cyclic;
  const oversized = observationFixture();
  oversized.gates[0].sourceRef = '0'.repeat(100_000);
  const malformedRef = observationFixture();
  malformedRef.gates[0].sourceRef = 'not-an-opaque-ref';
  const readinessClaim = { ...observationFixture(), canCreate: true };
  for (const [candidateRepository, observation] of [
    [hostileRepository, observationFixture()],
    [repository, accessor],
    [repository, inherited],
    [repository, symbolic],
    [repository, shared],
    [repository, cyclic],
    [repository, oversized],
    [repository, malformedRef],
    [repository, readinessClaim],
  ]) {
    assert.throws(
      () => domain.createManagedFirstAssignmentReadiness(candidateRepository, observation),
      GENERIC_ERROR,
    );
  }
  assert.equal(hooks, 0);
});

test('T6 output is exact detached recursively frozen null-prototype and privately authentic', async () => {
  const domain = await loadDomain();
  assert.deepEqual(Object.keys(domain), ['createManagedFirstAssignmentReadiness']);
  const observation = observationFixture();
  const repository = genuineRepository();
  const result = domain.createManagedFirstAssignmentReadiness(repository, observation);
  assert.deepEqual(Object.keys(result), [
    'schemaVersion', 'tenantId', 'accountId', 'organizationId', 'evaluatedAt',
    'assignmentStatus', 'canCreate', 'canStart', 'canComplete', 'gates',
  ]);
  assert.equal(Object.getPrototypeOf(result), null);
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.gates), true);
  assert.notEqual(result.gates, observation.gates);
  for (let index = 0; index < result.gates.length; index += 1) {
    assert.deepEqual(Object.keys(result.gates[index]), ['name', 'state']);
    assert.equal(Object.getPrototypeOf(result.gates[index]), null);
    assert.equal(Object.isFrozen(result.gates[index]), true);
    assert.notEqual(result.gates[index], observation.gates[index]);
  }
  observation.gates[0].state = 'not_configured';
  assert.equal(result.gates[0].state, 'blocked');
  const serialized = JSON.stringify(result);
  for (const forbidden of [
    'sourceRef', 'observedAt', 'provider', 'credential', 'permission',
    'directionText', 'assignmentContent', 'ownerIdentity', 'assigneeIdentity', 'reviewerIdentity',
    'outcomeRecord',
  ]) assert.equal(serialized.includes(forbidden), false);
  for (const key of ['create', 'start', 'complete', 'action', 'route', 'token']) {
    assert.equal(key in result, false);
  }
  assert.deepEqual(Object.keys(domain.createManagedFirstAssignmentReadiness), []);
  assert.equal(domain.createManagedFirstAssignmentReadiness.isAuthenticResult(result), true);
  const copy = Object.freeze(Object.assign(Object.create(null), result));
  assert.equal(domain.createManagedFirstAssignmentReadiness.isAuthenticResult(copy), false);
  let hooks = 0;
  const wrapped = new Proxy(result, {
    get() { hooks += 1; throw new Error('private'); },
    getPrototypeOf() { hooks += 1; throw new Error('private'); },
  });
  assert.equal(domain.createManagedFirstAssignmentReadiness.isAuthenticResult(wrapped), false);
  const foreignDomain = await import(`${MODULE_PATH}?foreign=1`);
  const foreignResult = foreignDomain.createManagedFirstAssignmentReadiness(
    repository,
    observationFixture(),
  );
  assert.equal(domain.createManagedFirstAssignmentReadiness.isAuthenticResult(foreignResult), false);
  assert.equal(hooks, 0);
});

test('T7 foreign predecessor and hostile post-import ambient replacements stay inert', async () => {
  const domain = await loadDomain();
  const foreignRepositoryDomain = await import('../server/managedRepositoryConnectionReadiness.mjs?foreign=1');
  const foreignRepository = genuineRepository(
    SUFFIX,
    foreignRepositoryDomain.createManagedRepositoryConnectionReadiness,
  );
  assert.throws(
    () => domain.createManagedFirstAssignmentReadiness(foreignRepository, observationFixture()),
    GENERIC_ERROR,
  );

  const repository = genuineRepository();
  const originals = {
    isArray: Array.isArray,
    create: Object.create,
    defineProperty: Object.defineProperty,
    freeze: Object.freeze,
    descriptor: Object.getOwnPropertyDescriptor,
    prototype: Object.getPrototypeOf,
    ownKeys: Reflect.ownKeys,
    floor: Math.floor,
    charCodeAt: String.prototype.charCodeAt,
    weakSetAdd: WeakSet.prototype.add,
    weakSetHas: WeakSet.prototype.has,
    fetch: globalThis.fetch,
    setTimeout: globalThis.setTimeout,
  };
  const OriginalTypeError = globalThis.TypeError;
  let hooks = 0;
  let result;
  let error;
  try {
    Array.isArray = (...args) => { hooks += 1; return originals.isArray(...args); };
    Object.create = (...args) => { hooks += 1; return originals.create(...args); };
    Object.defineProperty = (...args) => { hooks += 1; return originals.defineProperty(...args); };
    Object.freeze = (...args) => { hooks += 1; return originals.freeze(...args); };
    Object.getOwnPropertyDescriptor = (...args) => { hooks += 1; return originals.descriptor(...args); };
    Object.getPrototypeOf = (...args) => { hooks += 1; return originals.prototype(...args); };
    Reflect.ownKeys = (...args) => { hooks += 1; return originals.ownKeys(...args); };
    Math.floor = (...args) => { hooks += 1; return originals.floor(...args); };
    String.prototype.charCodeAt = function hostileCharCodeAt(...args) {
      hooks += 1; return originals.charCodeAt.apply(this, args);
    };
    WeakSet.prototype.add = function hostileAdd(...args) {
      hooks += 1; return originals.weakSetAdd.apply(this, args);
    };
    WeakSet.prototype.has = function hostileHas(...args) {
      hooks += 1; return originals.weakSetHas.apply(this, args);
    };
    globalThis.TypeError = function HostileTypeError(...args) {
      hooks += 1; return new OriginalTypeError(...args);
    };
    globalThis.fetch = () => { hooks += 1; throw new Error('network'); };
    globalThis.setTimeout = () => { hooks += 1; throw new Error('timer'); };
    result = domain.createManagedFirstAssignmentReadiness(repository, observationFixture());
    try {
      domain.createManagedFirstAssignmentReadiness(repository, null);
    } catch (caught) {
      error = caught;
    }
  } finally {
    Array.isArray = originals.isArray;
    Object.create = originals.create;
    Object.defineProperty = originals.defineProperty;
    Object.freeze = originals.freeze;
    Object.getOwnPropertyDescriptor = originals.descriptor;
    Object.getPrototypeOf = originals.prototype;
    Reflect.ownKeys = originals.ownKeys;
    Math.floor = originals.floor;
    String.prototype.charCodeAt = originals.charCodeAt;
    WeakSet.prototype.add = originals.weakSetAdd;
    WeakSet.prototype.has = originals.weakSetHas;
    globalThis.TypeError = OriginalTypeError;
    globalThis.fetch = originals.fetch;
    globalThis.setTimeout = originals.setTimeout;
  }
  assert.equal(result.assignmentStatus, 'blocked');
  assert.equal(Object.getPrototypeOf(error), OriginalTypeError.prototype);
  assert.equal(error.message, GENERIC_ERROR.message);
  assert.equal(hooks, 0);
});

test('T8 inherited descriptor values cannot dispatch hooks at record or array boundaries', async () => {
  const domain = await loadDomain();
  const repository = genuineRepository();
  const originalValueDescriptor = Object.getOwnPropertyDescriptor(Object.prototype, 'value');

  for (const boundary of ['record', 'array']) {
    const observation = observationFixture();
    let sourceAccessorHooks = 0;
    let prototypeValueHooks = 0;
    let error;
    let inheritedValue;
    if (boundary === 'record') {
      inheritedValue = observation.schemaVersion;
      Object.defineProperty(observation, 'schemaVersion', {
        enumerable: true,
        get() { sourceAccessorHooks += 1; return inheritedValue; },
      });
    } else {
      inheritedValue = observation.gates[0];
      Object.defineProperty(observation.gates, '0', {
        enumerable: true,
        get() { sourceAccessorHooks += 1; return inheritedValue; },
      });
    }
    try {
      Object.defineProperty(Object.prototype, 'value', {
        configurable: true,
        get() { prototypeValueHooks += 1; return inheritedValue; },
      });
      try {
        domain.createManagedFirstAssignmentReadiness(repository, observation);
      } catch (caught) {
        error = caught;
      }
    } finally {
      if (originalValueDescriptor) {
        Object.defineProperty(Object.prototype, 'value', originalValueDescriptor);
      } else {
        delete Object.prototype.value;
      }
    }
    assert.deepEqual({ name: error?.name, message: error?.message }, GENERIC_ERROR);
    assert.equal(sourceAccessorHooks, 0);
    assert.equal(prototypeValueHooks, 0);
  }
});

test('T9 descriptor records ignore hostile inherited get and set accessors', async () => {
  const domain = await loadDomain();
  const repository = genuineRepository();
  const observation = observationFixture();
  const originalGetDescriptor = Object.getOwnPropertyDescriptor(Object.prototype, 'get');
  const originalSetDescriptor = Object.getOwnPropertyDescriptor(Object.prototype, 'set');
  let hooks = 0;
  let result;
  let error;
  try {
    Object.defineProperty(Object.prototype, 'get', {
      configurable: true,
      get() { hooks += 1; return undefined; },
    });
    Object.defineProperty(Object.prototype, 'set', {
      configurable: true,
      get() { hooks += 1; return undefined; },
    });
    try {
      result = domain.createManagedFirstAssignmentReadiness(repository, observation);
    } catch (caught) {
      error = caught;
    }
  } finally {
    delete Object.prototype.get;
    delete Object.prototype.set;
    if (originalGetDescriptor) {
      Object.defineProperty(Object.prototype, 'get', originalGetDescriptor);
    }
    if (originalSetDescriptor) {
      Object.defineProperty(Object.prototype, 'set', originalSetDescriptor);
    }
  }
  assert.deepEqual({ error: error && `${error.name}:${error.message}`, hooks }, {
    error: undefined,
    hooks: 0,
  });
  assert.deepEqual({ ...result, gates: result.gates.map((gate) => ({ ...gate })) }, {
    schemaVersion: 'managed-first-assignment-readiness/1',
    tenantId: `tenant_${SUFFIX}`,
    accountId: `account_${SUFFIX}`,
    organizationId: `organization_${SUFFIX}`,
    evaluatedAt: observation.evaluatedAt,
    assignmentStatus: 'blocked',
    canCreate: false,
    canStart: false,
    canComplete: false,
    gates: observation.gates.map(({ name, state }) => ({ name, state })),
  });
});
