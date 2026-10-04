import assert from 'node:assert/strict';
import test from 'node:test';

import { createManagedCustomerIdentityDomain } from '../server/managedCustomerIdentityDomain.mjs';
import { createManagedFirstAssignmentReadiness } from '../server/managedFirstAssignmentReadiness.mjs';
import { createManagedRepositoryConnectionReadiness } from '../server/managedRepositoryConnectionReadiness.mjs';
import { createManagedStarterAgentReadiness } from '../server/managedStarterAgentReadiness.mjs';
import { createManagedSuiteSelectionPresentation } from '../server/managedSuiteSelectionPresentation.mjs';
import { createManagedSuiteSelectionReadiness } from '../server/managedSuiteSelectionReadiness.mjs';

const MODULE_PATH = '../server/managedCustomerJourneyPresentation.mjs';
const SUFFIX = '0000000000000001';
const GENERIC_ERROR = {
  name: 'TypeError',
  message: 'Invalid managed customer journey presentation input',
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

function assignmentObservationFixture(suffix = SUFFIX) {
  const names = [
    'direction_authorization', 'assignment_definition', 'owner_accountability',
    'assignee_identity', 'repository_work_access', 'evidence_plan',
    'review_authority', 'outcome_acceptance',
  ];
  return {
    schemaVersion: 'managed-first-assignment-readiness-observation/1',
    tenantId: `tenant_${suffix}`,
    accountId: `account_${suffix}`,
    organizationId: `organization_${suffix}`,
    evaluatedAt: '2026-10-04T06:30:00.000Z',
    gates: names.map((name, index) => ({
      name,
      state: index % 2 === 0 ? 'blocked' : 'not_configured',
      sourceRef: `${index + 19}`.padStart(16, '0'),
      observedAt: '2026-10-04T06:29:00.000Z',
    })),
  };
}

function genuineJourney(suffix = SUFFIX, times = {}) {
  const identity = createManagedCustomerIdentityDomain(identityFixture(suffix));
  const suiteObservation = suiteReadinessFixture(suffix);
  if (times.presentation) {
    suiteObservation.evaluatedAt = times.presentation;
    for (const gate of suiteObservation.gates) gate.observedAt = times.presentation;
  }
  const suiteReadiness = createManagedSuiteSelectionReadiness(suiteObservation);
  const presentation = createManagedSuiteSelectionPresentation(identity, suiteReadiness);
  const starterObservation = starterObservationFixture(suffix);
  if (times.starter) {
    starterObservation.evaluatedAt = times.starter;
    for (const gate of starterObservation.gates) gate.observedAt = times.starter;
  }
  const starter = createManagedStarterAgentReadiness(
    identity,
    presentation,
    starterObservation,
  );
  const repositoryObservation = repositoryObservationFixture(suffix);
  if (times.repository) {
    repositoryObservation.evaluatedAt = times.repository;
    for (const gate of repositoryObservation.gates) gate.observedAt = times.repository;
  }
  const repository = createManagedRepositoryConnectionReadiness(
    identity,
    presentation,
    starter,
    repositoryObservation,
  );
  const assignmentObservation = assignmentObservationFixture(suffix);
  if (times.assignment) {
    assignmentObservation.evaluatedAt = times.assignment;
    for (const gate of assignmentObservation.gates) gate.observedAt = times.assignment;
  }
  const assignment = createManagedFirstAssignmentReadiness(
    repository,
    assignmentObservation,
  );
  return { identity, presentation, starter, repository, assignment };
}

test('T1 authentic aligned predecessors produce the exact blocked five-step journey', async () => {
  const domain = await loadDomain();
  assert.equal(typeof domain.createManagedCustomerJourneyPresentation, 'function');
  const inputs = genuineJourney();
  const result = domain.createManagedCustomerJourneyPresentation(
    inputs.identity,
    inputs.presentation,
    inputs.starter,
    inputs.repository,
    inputs.assignment,
  );
  assert.deepEqual({ ...result, steps: result.steps.map((step) => ({ ...step })) }, {
    schemaVersion: 'managed-customer-journey-presentation/1',
    tenantId: `tenant_${SUFFIX}`,
    accountId: `account_${SUFFIX}`,
    organizationId: `organization_${SUFFIX}`,
    evaluatedAt: inputs.assignment.evaluatedAt,
    journeyStatus: 'blocked',
    canAdvance: false,
    canComplete: false,
    steps: [
      { name: 'account_organization', state: 'ready' },
      { name: 'suite_selection', state: 'blocked' },
      { name: 'starter_agent', state: 'blocked' },
      { name: 'repository_connection', state: 'blocked' },
      { name: 'first_assignment', state: 'blocked' },
    ],
  });
});

test('T2 every predecessor must be an exact loaded-module authentic result', async () => {
  const domain = await loadDomain();
  const inputs = genuineJourney();
  const ordered = [
    inputs.identity, inputs.presentation, inputs.starter, inputs.repository, inputs.assignment,
  ];
  for (let index = 0; index < ordered.length; index += 1) {
    const copied = ordered.slice();
    copied[index] = Object.freeze(Object.assign(Object.create(null), ordered[index]));
    assert.throws(
      () => domain.createManagedCustomerJourneyPresentation(...copied),
      GENERIC_ERROR,
    );
  }
});

test('T3 tenant account and organization must align across every predecessor', async () => {
  const domain = await loadDomain();
  const inputs = genuineJourney();
  const other = genuineJourney('0000000000000002');
  const ordered = [
    inputs.identity, inputs.presentation, inputs.starter, inputs.repository, inputs.assignment,
  ];
  const otherOrdered = [
    other.identity, other.presentation, other.starter, other.repository, other.assignment,
  ];
  for (let index = 0; index < ordered.length; index += 1) {
    const mixed = ordered.slice();
    mixed[index] = otherOrdered[index];
    assert.throws(
      () => domain.createManagedCustomerJourneyPresentation(...mixed),
      GENERIC_ERROR,
    );
  }
});

test('T4 causal order and final freshness preserve the exact one-day boundary', async () => {
  const domain = await loadDomain();
  const boundary = genuineJourney(SUFFIX, {
    presentation: '2026-10-04T06:30:00.000Z',
    starter: '2026-10-04T06:30:00.000Z',
    repository: '2026-10-04T06:30:00.000Z',
    assignment: '2026-10-05T06:30:00.000Z',
  });
  assert.equal(
    domain.createManagedCustomerJourneyPresentation(...Object.values(boundary)).journeyStatus,
    'blocked',
  );

  const stale = genuineJourney(SUFFIX, {
    presentation: '2026-10-04T06:30:00.000Z',
    starter: '2026-10-04T06:30:00.000Z',
    repository: '2026-10-04T06:30:00.001Z',
    assignment: '2026-10-05T06:30:00.001Z',
  });
  assert.throws(
    () => domain.createManagedCustomerJourneyPresentation(...Object.values(stale)),
    GENERIC_ERROR,
  );

  const normal = genuineJourney();
  const laterPresentation = genuineJourney(SUFFIX, {
    presentation: '2026-10-04T05:45:00.000Z',
    starter: '2026-10-04T05:45:00.000Z',
    repository: '2026-10-04T06:00:00.000Z',
    assignment: '2026-10-04T06:30:00.000Z',
  });
  assert.throws(
    () => domain.createManagedCustomerJourneyPresentation(
      normal.identity,
      laterPresentation.presentation,
      normal.starter,
      normal.repository,
      normal.assignment,
    ),
    GENERIC_ERROR,
  );
});

test('T5 output is exact detached recursively frozen null-prototype and privately authentic', async () => {
  const domain = await loadDomain();
  assert.deepEqual(Object.keys(domain), ['createManagedCustomerJourneyPresentation']);
  const inputs = genuineJourney();
  const result = domain.createManagedCustomerJourneyPresentation(...Object.values(inputs));
  assert.deepEqual(Object.keys(result), [
    'schemaVersion', 'tenantId', 'accountId', 'organizationId', 'evaluatedAt',
    'journeyStatus', 'canAdvance', 'canComplete', 'steps',
  ]);
  assert.equal(Object.getPrototypeOf(result), null);
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.steps), true);
  for (const step of result.steps) {
    assert.deepEqual(Object.keys(step), ['name', 'state']);
    assert.equal(Object.getPrototypeOf(step), null);
    assert.equal(Object.isFrozen(step), true);
  }
  assert.deepEqual(Object.keys(domain.createManagedCustomerJourneyPresentation), []);
  assert.equal(domain.createManagedCustomerJourneyPresentation.isAuthenticResult(result), true);
  const copy = Object.freeze(Object.assign(Object.create(null), result));
  assert.equal(domain.createManagedCustomerJourneyPresentation.isAuthenticResult(copy), false);
  let hooks = 0;
  const wrapped = new Proxy(result, {
    get() { hooks += 1; throw new Error('private'); },
    getPrototypeOf() { hooks += 1; throw new Error('private'); },
  });
  assert.equal(domain.createManagedCustomerJourneyPresentation.isAuthenticResult(wrapped), false);
  assert.equal(hooks, 0);
  const serialized = JSON.stringify(result);
  assert.equal(serialized, JSON.stringify({
    schemaVersion: 'managed-customer-journey-presentation/1',
    tenantId: `tenant_${SUFFIX}`,
    accountId: `account_${SUFFIX}`,
    organizationId: `organization_${SUFFIX}`,
    evaluatedAt: inputs.assignment.evaluatedAt,
    journeyStatus: 'blocked',
    canAdvance: false,
    canComplete: false,
    steps: [
      { name: 'account_organization', state: 'ready' },
      { name: 'suite_selection', state: 'blocked' },
      { name: 'starter_agent', state: 'blocked' },
      { name: 'repository_connection', state: 'blocked' },
      { name: 'first_assignment', state: 'blocked' },
    ],
  }));
  for (const forbidden of [
    'displayLabel', 'roleLabel', 'tenantBinding', 'gates', 'sourceRef', 'observedAt',
    'provider', 'credential', 'price', 'capacity', 'repositoryId', 'workContent', 'authority',
    'route', 'action', 'access', 'membership',
  ]) assert.equal(serialized.includes(forbidden), false);
  for (const key of ['canSelect', 'canConnect', 'canAssign', 'canCreate', 'canStart']) {
    assert.equal(key in result, false);
  }
});

test('T6 characterization: foreign descendants and proxies fail without attacker hooks', async () => {
  const domain = await loadDomain();
  const inputs = genuineJourney();
  const ordered = Object.values(inputs);
  let hooks = 0;
  for (let index = 0; index < ordered.length; index += 1) {
    const descendantInputs = ordered.slice();
    descendantInputs[index] = Object.create(ordered[index]);
    assert.throws(
      () => domain.createManagedCustomerJourneyPresentation(...descendantInputs),
      GENERIC_ERROR,
    );
    const proxyInputs = ordered.slice();
    proxyInputs[index] = new Proxy(ordered[index], {
      get() { hooks += 1; throw new Error('private'); },
      getPrototypeOf() { hooks += 1; throw new Error('private'); },
      ownKeys() { hooks += 1; throw new Error('private'); },
    });
    assert.throws(
      () => domain.createManagedCustomerJourneyPresentation(...proxyInputs),
      GENERIC_ERROR,
    );
  }
  const foreignAssignmentDomain = await import('../server/managedFirstAssignmentReadiness.mjs?journey-foreign=1');
  const foreignAssignment = foreignAssignmentDomain.createManagedFirstAssignmentReadiness(
    inputs.repository,
    assignmentObservationFixture(),
  );
  assert.throws(
    () => domain.createManagedCustomerJourneyPresentation(
      inputs.identity,
      inputs.presentation,
      inputs.starter,
      inputs.repository,
      foreignAssignment,
    ),
    GENERIC_ERROR,
  );
  const foreignDomain = await import(`${MODULE_PATH}?foreign=1`);
  const foreignResult = foreignDomain.createManagedCustomerJourneyPresentation(...ordered);
  assert.equal(domain.createManagedCustomerJourneyPresentation.isAuthenticResult(foreignResult), false);
  assert.equal(hooks, 0);
});

test('T7 characterization: post-import ambient replacements stay inert', async () => {
  const domain = await loadDomain();
  const inputs = genuineJourney();
  const originals = {
    create: Object.create,
    defineProperty: Object.defineProperty,
    freeze: Object.freeze,
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
    Object.create = (...args) => { hooks += 1; return originals.create(...args); };
    Object.defineProperty = (...args) => { hooks += 1; return originals.defineProperty(...args); };
    Object.freeze = (...args) => { hooks += 1; return originals.freeze(...args); };
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
    result = domain.createManagedCustomerJourneyPresentation(...Object.values(inputs));
    try {
      domain.createManagedCustomerJourneyPresentation(null, null, null, null, null);
    } catch (caught) {
      error = caught;
    }
  } finally {
    Object.create = originals.create;
    Object.defineProperty = originals.defineProperty;
    Object.freeze = originals.freeze;
    Math.floor = originals.floor;
    String.prototype.charCodeAt = originals.charCodeAt;
    WeakSet.prototype.add = originals.weakSetAdd;
    WeakSet.prototype.has = originals.weakSetHas;
    globalThis.TypeError = OriginalTypeError;
    globalThis.fetch = originals.fetch;
    globalThis.setTimeout = originals.setTimeout;
  }
  assert.equal(result.journeyStatus, 'blocked');
  assert.equal(Object.getPrototypeOf(error), OriginalTypeError.prototype);
  assert.equal(error.message, GENERIC_ERROR.message);
  assert.equal(hooks, 0);
});
