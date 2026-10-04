import assert from 'node:assert/strict';
import test from 'node:test';

import { createManagedCustomerIdentityDomain } from '../server/managedCustomerIdentityDomain.mjs';
import { createManagedSuiteSelectionPresentation } from '../server/managedSuiteSelectionPresentation.mjs';
import { createManagedSuiteSelectionReadiness } from '../server/managedSuiteSelectionReadiness.mjs';
import { createManagedStarterAgentReadiness } from '../server/managedStarterAgentReadiness.mjs';

const MODULE_PATH = '../server/managedRepositoryConnectionReadiness.mjs';
const SUFFIX = '0000000000000001';
const GATE_NAMES = [
  'repository_identity',
  'tenant_binding',
  'repository_access',
  'data_classification',
  'credential_issuance',
  'authorization_policy',
];
const GENERIC_ERROR = {
  name: 'TypeError',
  message: 'Invalid managed repository connection readiness input',
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

function observationFixture(suffix = SUFFIX) {
  return {
    schemaVersion: 'managed-repository-connection-readiness-observation/1',
    tenantId: `tenant_${suffix}`,
    accountId: `account_${suffix}`,
    organizationId: `organization_${suffix}`,
    evaluatedAt: '2026-10-04T06:00:00.000Z',
    gates: GATE_NAMES.map((name, index) => ({
      name,
      state: index % 2 === 0 ? 'blocked' : 'not_configured',
      sourceRef: `${index + 13}`.padStart(16, '0'),
      observedAt: '2026-10-04T05:59:00.000Z',
    })),
  };
}

function genuineInputs(suffix = SUFFIX) {
  const identity = createManagedCustomerIdentityDomain(identityFixture(suffix));
  const suiteReadiness = createManagedSuiteSelectionReadiness(suiteReadinessFixture(suffix));
  const presentation = createManagedSuiteSelectionPresentation(identity, suiteReadiness);
  const starter = createManagedStarterAgentReadiness(
    identity,
    presentation,
    starterObservationFixture(suffix),
  );
  return { identity, presentation, starter };
}

test('T1 genuine matching predecessors produce only blocked connection readiness', async () => {
  const domain = await loadDomain();
  assert.equal(typeof domain.createManagedRepositoryConnectionReadiness, 'function');
  const inputs = genuineInputs();
  const observation = observationFixture();
  const result = domain.createManagedRepositoryConnectionReadiness(
    inputs.identity,
    inputs.presentation,
    inputs.starter,
    observation,
  );
  assert.deepEqual({ ...result, gates: result.gates.map((gate) => ({ ...gate })) }, {
    schemaVersion: 'managed-repository-connection-readiness/1',
    tenantId: `tenant_${SUFFIX}`,
    accountId: `account_${SUFFIX}`,
    organizationId: `organization_${SUFFIX}`,
    evaluatedAt: observation.evaluatedAt,
    connectionStatus: 'blocked',
    canConnect: false,
    canAssign: false,
    gates: observation.gates.map(({ name, state }) => ({ name, state })),
  });
});

test('T2 exact predecessor instances and tenant account organization binding are mandatory', async () => {
  const domain = await loadDomain();
  const inputs = genuineInputs();
  const other = genuineInputs('0000000000000002');
  const observation = observationFixture();
  const copiedStarter = Object.freeze(Object.assign(Object.create(null), inputs.starter));
  for (const [identity, presentation, starter, candidate] of [
    [inputs.identity, inputs.presentation, copiedStarter, observation],
    [inputs.identity, inputs.presentation, other.starter, observation],
    [inputs.identity, other.presentation, inputs.starter, observation],
    [other.identity, inputs.presentation, inputs.starter, observation],
    [inputs.identity, inputs.presentation, inputs.starter, { ...observation, tenantId: 'tenant_0000000000000002' }],
    [inputs.identity, inputs.presentation, inputs.starter, { ...observation, accountId: 'account_0000000000000002' }],
    [inputs.identity, inputs.presentation, inputs.starter, { ...observation, organizationId: 'organization_0000000000000002' }],
  ]) {
    assert.throws(
      () => domain.createManagedRepositoryConnectionReadiness(
        identity,
        presentation,
        starter,
        candidate,
      ),
      GENERIC_ERROR,
    );
  }
});

test('T3 observation schema and ordered non-ready gates are exact and closed', async () => {
  const domain = await loadDomain();
  const inputs = genuineInputs();
  const invalid = [];
  invalid.push({ ...observationFixture(), repository: 'invented' });
  const omitted = observationFixture();
  omitted.gates.pop();
  invalid.push(omitted);
  const reordered = observationFixture();
  [reordered.gates[0], reordered.gates[1]] = [reordered.gates[1], reordered.gates[0]];
  invalid.push(reordered);
  const duplicate = observationFixture();
  duplicate.gates[5].name = duplicate.gates[4].name;
  invalid.push(duplicate);
  const extraGateField = observationFixture();
  extraGateField.gates[0].provider = 'invented';
  invalid.push(extraGateField);
  for (const index of [2, 4, 5]) {
    const claiming = observationFixture();
    claiming.gates[index].state = 'ready';
    invalid.push(claiming);
  }
  for (const observation of invalid) {
    assert.throws(
      () => domain.createManagedRepositoryConnectionReadiness(
        inputs.identity,
        inputs.presentation,
        inputs.starter,
        observation,
      ),
      GENERIC_ERROR,
    );
  }
});

test('T4 predecessor and gate evidence freshness accepts exactly one day and rejects stale or future', async () => {
  const domain = await loadDomain();
  const inputs = genuineInputs();
  const boundary = observationFixture();
  boundary.evaluatedAt = '2026-10-05T05:00:00.000Z';
  for (const gate of boundary.gates) gate.observedAt = '2026-10-04T05:00:00.000Z';
  assert.equal(domain.createManagedRepositoryConnectionReadiness(
    inputs.identity,
    inputs.presentation,
    inputs.starter,
    boundary,
  ).connectionStatus, 'blocked');

  const stalePredecessor = observationFixture();
  stalePredecessor.evaluatedAt = '2026-10-05T05:00:00.001Z';
  const futurePredecessor = observationFixture();
  futurePredecessor.evaluatedAt = '2026-10-04T05:29:59.999Z';
  const staleGate = observationFixture();
  staleGate.gates[0].observedAt = '2026-10-03T05:59:59.999Z';
  const futureGate = observationFixture();
  futureGate.gates[0].observedAt = '2026-10-04T06:00:00.001Z';
  for (const observation of [stalePredecessor, futurePredecessor, staleGate, futureGate]) {
    assert.throws(
      () => domain.createManagedRepositoryConnectionReadiness(
        inputs.identity,
        inputs.presentation,
        inputs.starter,
        observation,
      ),
      GENERIC_ERROR,
    );
  }
});

test('T5 hostile inputs fail generically without hooks while output stays detached frozen and dormant', async () => {
  const domain = await loadDomain();
  assert.deepEqual(Object.keys(domain), ['createManagedRepositoryConnectionReadiness']);
  const inputs = genuineInputs();
  let hooks = 0;
  const hostileStarter = new Proxy(inputs.starter, {
    get() { hooks += 1; throw new Error('private'); },
    getPrototypeOf() { hooks += 1; throw new Error('private'); },
    ownKeys() { hooks += 1; throw new Error('private'); },
  });
  assert.throws(
    () => domain.createManagedRepositoryConnectionReadiness(
      inputs.identity, inputs.presentation, hostileStarter, observationFixture(),
    ),
    GENERIC_ERROR,
  );
  const accessor = observationFixture();
  Object.defineProperty(accessor.gates[0], 'sourceRef', {
    enumerable: true,
    get() { hooks += 1; return '0000000000000013'; },
  });
  assert.throws(
    () => domain.createManagedRepositoryConnectionReadiness(
      inputs.identity, inputs.presentation, inputs.starter, accessor,
    ),
    GENERIC_ERROR,
  );
  assert.equal(hooks, 0);

  const observation = observationFixture();
  const result = domain.createManagedRepositoryConnectionReadiness(
    inputs.identity, inputs.presentation, inputs.starter, observation,
  );
  assert.equal(Object.getPrototypeOf(result), null);
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
  const serialized = JSON.stringify(result);
  for (const forbidden of ['sourceRef', 'observedAt', 'provider', 'permission', 'task_']) {
    assert.equal(serialized.includes(forbidden), false);
  }
  for (const key of ['connect', 'assign', 'action', 'route', 'token']) assert.equal(key in result, false);
});

test('T6 bounded hostile graphs and replaced ambient intrinsics cannot dispatch hooks', async () => {
  const domain = await loadDomain();
  const inputs = genuineInputs();
  const candidates = [];
  const shared = observationFixture();
  shared.gates[5] = shared.gates[4];
  candidates.push(shared);
  const cyclic = observationFixture();
  cyclic.gates[0].sourceRef = cyclic;
  candidates.push(cyclic);
  const oversized = observationFixture();
  oversized.gates[0].sourceRef = '0'.repeat(100_000);
  candidates.push(oversized);
  const symbolic = observationFixture();
  symbolic.gates[0][Symbol('private')] = true;
  candidates.push(symbolic);
  for (const observation of candidates) {
    assert.throws(
      () => domain.createManagedRepositoryConnectionReadiness(
        inputs.identity, inputs.presentation, inputs.starter, observation,
      ),
      GENERIC_ERROR,
    );
  }

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
    weakSetHas: WeakSet.prototype.has,
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
    WeakSet.prototype.has = function hostileHas(...args) {
      hooks += 1; return originals.weakSetHas.apply(this, args);
    };
    globalThis.TypeError = function HostileTypeError(...args) {
      hooks += 1; return new OriginalTypeError(...args);
    };
    result = domain.createManagedRepositoryConnectionReadiness(
      inputs.identity, inputs.presentation, inputs.starter, observationFixture(),
    );
    try {
      domain.createManagedRepositoryConnectionReadiness(
        inputs.identity, inputs.presentation, inputs.starter, null,
      );
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
    WeakSet.prototype.has = originals.weakSetHas;
    globalThis.TypeError = OriginalTypeError;
  }
  assert.equal(result.connectionStatus, 'blocked');
  assert.equal(Object.getPrototypeOf(error), OriginalTypeError.prototype);
  assert.equal(error.message, GENERIC_ERROR.message);
  assert.equal(hooks, 0);
});

test('T7 only exact module-owned results carry private authenticity', async () => {
  const domain = await loadDomain();
  const inputs = genuineInputs();
  const result = domain.createManagedRepositoryConnectionReadiness(
    inputs.identity, inputs.presentation, inputs.starter, observationFixture(),
  );
  assert.deepEqual(Object.keys(domain.createManagedRepositoryConnectionReadiness), []);
  assert.equal(domain.createManagedRepositoryConnectionReadiness.isAuthenticResult(result), true);
  const copy = Object.freeze(Object.assign(Object.create(null), result));
  assert.equal(domain.createManagedRepositoryConnectionReadiness.isAuthenticResult(copy), false);
  let hooks = 0;
  const wrapped = new Proxy(result, {
    get() { hooks += 1; throw new Error('private'); },
    getPrototypeOf() { hooks += 1; throw new Error('private'); },
  });
  assert.equal(domain.createManagedRepositoryConnectionReadiness.isAuthenticResult(wrapped), false);
  assert.equal(hooks, 0);
});
