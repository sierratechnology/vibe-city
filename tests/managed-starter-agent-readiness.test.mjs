import assert from 'node:assert/strict';
import test from 'node:test';

import { createManagedCustomerIdentityDomain } from '../server/managedCustomerIdentityDomain.mjs';
import { createManagedSuiteSelectionPresentation } from '../server/managedSuiteSelectionPresentation.mjs';
import { createManagedSuiteSelectionReadiness } from '../server/managedSuiteSelectionReadiness.mjs';

const MODULE_PATH = '../server/managedStarterAgentReadiness.mjs';
const SUFFIX = '0000000000000001';
const GATE_NAMES = [
  'suite_commitment',
  'hosted_identity',
  'provider_selection',
  'credential_issuance',
  'authority_policy',
  'workplace_assignment',
];

async function loadDomain() {
  return import(MODULE_PATH).catch(() => ({}));
}

function identityFixture(suffix = SUFFIX) {
  return {
    schemaVersion: 'managed-customer-identity/1',
    account: {
      accountId: `account_${suffix}`,
      displayLabel: 'Synthetic Account',
      lifecycle: 'active',
    },
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

function observationFixture(suffix = SUFFIX) {
  return {
    schemaVersion: 'managed-starter-agent-readiness-observation/1',
    tenantId: `tenant_${suffix}`,
    accountId: `account_${suffix}`,
    organizationId: `organization_${suffix}`,
    evaluatedAt: '2026-10-04T05:00:00.000Z',
    gates: GATE_NAMES.map((name, index) => ({
      name,
      state: index % 2 === 0 ? 'blocked' : 'not_configured',
      sourceRef: `${index + 7}`.padStart(16, '0'),
      observedAt: '2026-10-04T04:59:00.000Z',
    })),
  };
}

function genuineInputs(suffix = SUFFIX) {
  const identity = createManagedCustomerIdentityDomain(identityFixture(suffix));
  const suiteReadiness = createManagedSuiteSelectionReadiness(suiteReadinessFixture(suffix));
  const presentation = createManagedSuiteSelectionPresentation(identity, suiteReadiness);
  return { identity, presentation };
}

const GENERIC_ERROR = {
  name: 'TypeError',
  message: 'Invalid managed starter agent readiness input',
};

test('T1 genuine matching predecessors and mixed gates produce only frozen blocked readiness', async () => {
  const domain = await loadDomain();
  assert.equal(typeof domain.createManagedStarterAgentReadiness, 'function');
  const inputs = genuineInputs();
  const observation = observationFixture();
  const result = domain.createManagedStarterAgentReadiness(
    inputs.identity,
    inputs.presentation,
    observation,
  );

  assert.equal(Object.getPrototypeOf(result), null);
  assert.deepEqual(Object.keys(result), [
    'schemaVersion', 'tenantId', 'accountId', 'organizationId', 'evaluatedAt',
    'introductionStatus', 'canIntroduce', 'canActivate', 'gates',
  ]);
  assert.deepEqual({
    ...result,
    gates: result.gates.map((gate) => ({ ...gate })),
  }, {
    schemaVersion: 'managed-starter-agent-readiness/1',
    tenantId: `tenant_${SUFFIX}`,
    accountId: `account_${SUFFIX}`,
    organizationId: `organization_${SUFFIX}`,
    evaluatedAt: observation.evaluatedAt,
    introductionStatus: 'blocked',
    canIntroduce: false,
    canActivate: false,
    gates: observation.gates.map(({ name, state }) => ({ name, state })),
  });
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.gates), true);
  assert.notEqual(result.gates, observation.gates);
  for (let index = 0; index < result.gates.length; index += 1) {
    assert.equal(Object.getPrototypeOf(result.gates[index]), null);
    assert.equal(Object.isFrozen(result.gates[index]), true);
    assert.notEqual(result.gates[index], observation.gates[index]);
  }
  observation.gates[0].state = 'not_configured';
  assert.equal(result.gates[0].state, 'blocked');
});

test('T2 exact predecessor instances and tenant account organization binding are mandatory', async () => {
  const domain = await loadDomain();
  const inputs = genuineInputs();
  const other = genuineInputs('0000000000000002');
  const observation = observationFixture();
  const forgedIdentity = {
    ...inputs.identity,
    account: { ...inputs.identity.account },
    organization: { ...inputs.identity.organization },
    membership: { ...inputs.identity.membership },
    tenantBinding: { ...inputs.identity.tenantBinding },
  };
  const forgedPresentation = {
    ...inputs.presentation,
    selectionStatus: 'available',
    canSelect: true,
    canCommit: true,
    gates: inputs.presentation.gates.map((gate) => ({ ...gate })),
  };

  for (const [identity, presentation, candidateObservation] of [
    [forgedIdentity, inputs.presentation, observation],
    [inputs.identity, forgedPresentation, observation],
    [inputs.identity, other.presentation, observation],
    [inputs.identity, inputs.presentation, { ...observation, tenantId: other.presentation.tenantId }],
    [inputs.identity, inputs.presentation, { ...observation, accountId: other.identity.account.accountId }],
    [inputs.identity, inputs.presentation, { ...observation, organizationId: other.presentation.organizationId }],
  ]) {
    assert.throws(
      () => domain.createManagedStarterAgentReadiness(
        identity,
        presentation,
        candidateObservation,
      ),
      GENERIC_ERROR,
    );
  }
});

test('T3 exact closed ordered gates reject omissions ambiguity readiness claims and private fields', async () => {
  const domain = await loadDomain();
  const inputs = genuineInputs();
  const invalid = [];
  const missing = observationFixture();
  missing.gates.pop();
  invalid.push(missing);
  const duplicate = observationFixture();
  duplicate.gates[5].name = 'suite_commitment';
  invalid.push(duplicate);
  const reordered = observationFixture();
  [reordered.gates[0], reordered.gates[1]] = [reordered.gates[1], reordered.gates[0]];
  invalid.push(reordered);
  const unknown = observationFixture();
  unknown.gates[2].name = 'agent_availability';
  invalid.push(unknown);
  for (const state of ['available', 'ready', 'approved', 'working', 'active']) {
    const candidate = observationFixture();
    candidate.gates[1].state = state;
    invalid.push(candidate);
  }
  const suiteNotConfigured = observationFixture();
  suiteNotConfigured.gates[0].state = 'not_configured';
  invalid.push(suiteNotConfigured);
  for (const [field, value] of [
    ['agentId', 'agent_0000000000000001'],
    ['provider', 'synthetic'],
    ['credential', 'synthetic'],
    ['authority', 'owner'],
    ['price', 1],
    ['customer', 'synthetic'],
    ['repository', 'synthetic'],
    ['action', () => {}],
  ]) invalid.push({ ...observationFixture(), [field]: value });
  const extraGate = observationFixture();
  extraGate.gates[0].permission = 'introduce';
  invalid.push(extraGate);

  for (const observation of invalid) {
    assert.throws(
      () => domain.createManagedStarterAgentReadiness(
        inputs.identity,
        inputs.presentation,
        observation,
      ),
      GENERIC_ERROR,
    );
  }
});

test('T4 canonical bounded evidence timestamps and opaque source references are required', async () => {
  const domain = await loadDomain();
  const inputs = genuineInputs();
  const boundary = observationFixture();
  boundary.gates[5].observedAt = '2026-10-03T05:00:00.000Z';
  assert.equal(
    domain.createManagedStarterAgentReadiness(
      inputs.identity,
      inputs.presentation,
      boundary,
    ).gates[5].state,
    'not_configured',
  );

  const invalid = [];
  for (const evaluatedAt of [
    '2026-10-04T05:00:00Z',
    '2026-02-29T05:00:00.000Z',
    '2026-10-04T24:00:00.000Z',
    new String('2026-10-04T05:00:00.000Z'),
  ]) invalid.push({ ...observationFixture(), evaluatedAt });
  const future = observationFixture();
  future.gates[1].observedAt = '2026-10-04T05:00:00.001Z';
  invalid.push(future);
  const stale = observationFixture();
  stale.gates[2].observedAt = '2026-10-03T04:59:59.999Z';
  invalid.push(stale);
  const impossible = observationFixture();
  impossible.gates[3].observedAt = '2026-04-31T04:59:00.000Z';
  invalid.push(impossible);
  for (const sourceRef of [
    '123456789012345',
    '0'.repeat(65),
    'https://example.invalid/private',
    'provider_customer_task',
    'ABCDEF0000000000',
    new String('0000000000000001'),
  ]) {
    const candidate = observationFixture();
    candidate.gates[4].sourceRef = sourceRef;
    invalid.push(candidate);
  }

  for (const observation of invalid) {
    assert.throws(
      () => domain.createManagedStarterAgentReadiness(
        inputs.identity,
        inputs.presentation,
        observation,
      ),
      GENERIC_ERROR,
    );
  }
});

test('T5 hostile descriptors proxies graphs races and oversized inputs fail without hooks', async () => {
  const domain = await loadDomain();
  const inputs = genuineInputs();
  let hooks = 0;
  const hostileIdentity = new Proxy(inputs.identity, {
    get() { hooks += 1; throw new Error('must not read'); },
    getPrototypeOf() { hooks += 1; throw new Error('must not inspect'); },
    ownKeys() { hooks += 1; throw new Error('must not enumerate'); },
  });
  const hostilePresentation = new Proxy(inputs.presentation, {
    get() { hooks += 1; throw new Error('must not read'); },
    getPrototypeOf() { hooks += 1; throw new Error('must not inspect'); },
    ownKeys() { hooks += 1; throw new Error('must not enumerate'); },
  });
  assert.throws(
    () => domain.createManagedStarterAgentReadiness(
      hostileIdentity,
      inputs.presentation,
      observationFixture(),
    ),
    GENERIC_ERROR,
  );
  assert.throws(
    () => domain.createManagedStarterAgentReadiness(
      inputs.identity,
      hostilePresentation,
      observationFixture(),
    ),
    GENERIC_ERROR,
  );
  const accessor = observationFixture();
  Object.defineProperty(accessor.gates[0], 'sourceRef', {
    enumerable: true,
    get() { hooks += 1; return '0000000000000007'; },
  });
  const proxied = observationFixture();
  proxied.gates[1] = new Proxy(proxied.gates[1], {
    get() { hooks += 1; throw new Error('must not read'); },
    getPrototypeOf() { hooks += 1; throw new Error('must not inspect'); },
    ownKeys() { hooks += 1; throw new Error('must not enumerate'); },
  });
  const arrayRace = observationFixture();
  const firstGate = arrayRace.gates[0];
  Object.defineProperty(arrayRace.gates, '0', {
    enumerable: true,
    get() { hooks += 1; arrayRace.gates[1].state = 'active'; return firstGate; },
  });
  const inherited = Object.assign(Object.create({ private: true }), observationFixture());
  const symbolic = observationFixture();
  symbolic.gates[2][Symbol('hidden')] = 'private';
  const cyclic = observationFixture();
  cyclic.gates[3].sourceRef = cyclic.gates[3];
  const shared = observationFixture();
  shared.gates[5] = shared.gates[4];
  const oversizedRecord = observationFixture();
  for (let index = 0; index < 1000; index += 1) oversizedRecord[`extra${index}`] = index;
  const oversizedGates = observationFixture();
  for (let index = 0; index < 1000; index += 1) oversizedGates.gates.push({});
  const oversizedScalar = observationFixture();
  oversizedScalar.gates[5].sourceRef = '0'.repeat(100_000);

  for (const observation of [
    accessor,
    proxied,
    arrayRace,
    inherited,
    symbolic,
    cyclic,
    shared,
    oversizedRecord,
    oversizedGates,
    oversizedScalar,
  ]) {
    assert.throws(
      () => domain.createManagedStarterAgentReadiness(
        inputs.identity,
        inputs.presentation,
        observation,
      ),
      GENERIC_ERROR,
    );
  }
  assert.equal(hooks, 0);
});

test('T6 valid and invalid composition avoid replaceable post-import ambient hooks', async () => {
  const domain = await loadDomain();
  const inputs = genuineInputs();
  const observation = observationFixture();
  const OriginalTypeError = globalThis.TypeError;
  const originals = {
    arrayIsArray: Array.isArray,
    iterator: Array.prototype[Symbol.iterator],
    create: Object.create,
    defineProperty: Object.defineProperty,
    freeze: Object.freeze,
    descriptor: Object.getOwnPropertyDescriptor,
    prototype: Object.getPrototypeOf,
    ownKeys: Reflect.ownKeys,
    floor: Math.floor,
    charCodeAt: String.prototype.charCodeAt,
    weakSetHas: WeakSet.prototype.has,
  };
  let hooks = 0;
  let result;
  let observed;
  try {
    Array.isArray = (...args) => { hooks += 1; return originals.arrayIsArray(...args); };
    Array.prototype[Symbol.iterator] = function hostileIterator(...args) {
      hooks += 1;
      return originals.iterator.apply(this, args);
    };
    Object.create = (...args) => { hooks += 1; return originals.create(...args); };
    Object.defineProperty = (...args) => { hooks += 1; return originals.defineProperty(...args); };
    Object.freeze = (...args) => { hooks += 1; return originals.freeze(...args); };
    Object.getOwnPropertyDescriptor = (...args) => {
      hooks += 1;
      return originals.descriptor(...args);
    };
    Object.getPrototypeOf = (...args) => { hooks += 1; return originals.prototype(...args); };
    Reflect.ownKeys = (...args) => { hooks += 1; return originals.ownKeys(...args); };
    Math.floor = (...args) => { hooks += 1; return originals.floor(...args); };
    String.prototype.charCodeAt = function hostileCharCodeAt(...args) {
      hooks += 1;
      return originals.charCodeAt.apply(this, args);
    };
    WeakSet.prototype.has = function hostileHas(...args) {
      hooks += 1;
      return originals.weakSetHas.apply(this, args);
    };
    globalThis.TypeError = function HostileTypeError(...args) {
      hooks += 1;
      return new OriginalTypeError(...args);
    };
    result = domain.createManagedStarterAgentReadiness(
      inputs.identity,
      inputs.presentation,
      observation,
    );
    try {
      domain.createManagedStarterAgentReadiness(null, inputs.presentation, observation);
    } catch (error) {
      observed = error;
    }
  } finally {
    Array.isArray = originals.arrayIsArray;
    Array.prototype[Symbol.iterator] = originals.iterator;
    Object.create = originals.create;
    Object.defineProperty = originals.defineProperty;
    Object.freeze = originals.freeze;
    Object.getOwnPropertyDescriptor = originals.descriptor;
    Object.getPrototypeOf = originals.prototype;
    Reflect.ownKeys = originals.ownKeys;
    Math.floor = originals.floor;
    String.prototype.charCodeAt = originals.charCodeAt;
    WeakSet.prototype.has = originals.weakSetHas;
    globalThis.TypeError = OriginalTypeError;
  }
  assert.equal(result.introductionStatus, 'blocked');
  assert.equal(Object.getPrototypeOf(observed), OriginalTypeError.prototype);
  assert.equal(observed.message, GENERIC_ERROR.message);
  assert.equal(hooks, 0);
});

test('T7 the dormant module exposes no actions identities authority or private evidence', async () => {
  const domain = await loadDomain();
  assert.deepEqual(Object.keys(domain), ['createManagedStarterAgentReadiness']);
  const inputs = genuineInputs();
  const result = domain.createManagedStarterAgentReadiness(
    inputs.identity,
    inputs.presentation,
    observationFixture(),
  );
  const serialized = JSON.stringify(result);
  for (const forbidden of [
    'sourceRef', 'observedAt', 'displayLabel', 'roleLabel', 'agentId', 'agentName',
    'profile', 'skill', 'permission', 'customer', 'price', 'Credits', 'capacity',
    'lease', 'payment', 'legal', 'repository',
    'task_', 'available', 'ready', 'approved', 'working', 'active',
  ]) assert.equal(serialized.includes(forbidden), false, `forbidden output content: ${forbidden}`);
  for (const key of ['introduce', 'activate', 'assign', 'action', 'route']) {
    assert.equal(key in result, false);
  }
  for (const value of Object.values(result)) assert.notEqual(typeof value, 'function');
  for (const gate of result.gates) {
    for (const value of Object.values(gate)) assert.notEqual(typeof value, 'function');
  }
});

test('T8 valid and invalid composition avoid numeric Array prototype dispatch', async () => {
  const domain = await loadDomain();
  const inputs = genuineInputs();
  const observation = observationFixture();
  const defineProperty = Object.defineProperty;
  const deleteProperty = Reflect.deleteProperty;
  const originalDescriptor = Object.getOwnPropertyDescriptor(Array.prototype, '0');
  let hooks = 0;
  let result;
  let observed;
  try {
    defineProperty(Array.prototype, '0', {
      configurable: true,
      set(value) {
        hooks += 1;
        defineProperty(this, '0', {
          configurable: true,
          enumerable: true,
          value,
          writable: true,
        });
      },
    });
    result = domain.createManagedStarterAgentReadiness(
      inputs.identity,
      inputs.presentation,
      observation,
    );
    try {
      domain.createManagedStarterAgentReadiness(null, inputs.presentation, observation);
    } catch (error) {
      observed = error;
    }
  } finally {
    if (originalDescriptor) defineProperty(Array.prototype, '0', originalDescriptor);
    else deleteProperty(Array.prototype, '0');
  }
  assert.equal(result.introductionStatus, 'blocked');
  assert.equal(observed.name, GENERIC_ERROR.name);
  assert.equal(observed.message, GENERIC_ERROR.message);
  assert.equal(hooks, 0);
});

test('T9 genuine predecessor presentation must be within the observation freshness window', async () => {
  const domain = await loadDomain();
  const identity = createManagedCustomerIdentityDomain(identityFixture());
  const observation = observationFixture();

  const boundaryReadinessInput = suiteReadinessFixture();
  boundaryReadinessInput.evaluatedAt = '2026-10-03T05:00:00.000Z';
  for (const gate of boundaryReadinessInput.gates) {
    gate.observedAt = '2026-10-03T04:59:00.000Z';
  }
  const boundaryPresentation = createManagedSuiteSelectionPresentation(
    identity,
    createManagedSuiteSelectionReadiness(boundaryReadinessInput),
  );
  assert.equal(
    domain.createManagedStarterAgentReadiness(
      identity,
      boundaryPresentation,
      observation,
    ).introductionStatus,
    'blocked',
  );

  const staleReadinessInput = suiteReadinessFixture();
  staleReadinessInput.evaluatedAt = '2026-10-01T05:00:00.000Z';
  for (const gate of staleReadinessInput.gates) {
    gate.observedAt = '2026-10-01T04:59:00.000Z';
  }
  const stalePresentation = createManagedSuiteSelectionPresentation(
    identity,
    createManagedSuiteSelectionReadiness(staleReadinessInput),
  );
  assert.throws(
    () => domain.createManagedStarterAgentReadiness(identity, stalePresentation, observation),
    GENERIC_ERROR,
  );
});

test('T10 genuine predecessor presentation later than the observation is rejected generically', async () => {
  const domain = await loadDomain();
  const identity = createManagedCustomerIdentityDomain(identityFixture());
  const futureReadinessInput = suiteReadinessFixture();
  futureReadinessInput.evaluatedAt = '2026-10-04T05:00:00.001Z';
  const futurePresentation = createManagedSuiteSelectionPresentation(
    identity,
    createManagedSuiteSelectionReadiness(futureReadinessInput),
  );

  assert.throws(
    () => domain.createManagedStarterAgentReadiness(
      identity,
      futurePresentation,
      observationFixture(),
    ),
    GENERIC_ERROR,
  );
});
