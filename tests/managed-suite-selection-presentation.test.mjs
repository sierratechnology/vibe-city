import assert from 'node:assert/strict';
import test from 'node:test';

import { createManagedCustomerIdentityDomain } from '../server/managedCustomerIdentityDomain.mjs';
import { createManagedSuiteSelectionReadiness } from '../server/managedSuiteSelectionReadiness.mjs';

const MODULE_PATH = '../server/managedSuiteSelectionPresentation.mjs';
const SUFFIX = '0000000000000001';
const GATE_NAMES = ['pricing', 'lease_terms', 'payment', 'refunds', 'tax', 'capacity'];

async function loadPresentation() {
  return import(MODULE_PATH).catch(() => ({}));
}

function identityFixture() {
  return {
    schemaVersion: 'managed-customer-identity/1',
    account: {
      accountId: `account_${SUFFIX}`,
      displayLabel: 'Synthetic Account',
      lifecycle: 'active',
    },
    organization: {
      organizationId: `organization_${SUFFIX}`,
      displayLabel: 'Synthetic Organization',
      lifecycle: 'active',
    },
    membership: {
      accountId: `account_${SUFFIX}`,
      organizationId: `organization_${SUFFIX}`,
      roleLabel: 'member',
      lifecycle: 'active',
    },
  };
}

function readinessFixture() {
  return {
    schemaVersion: 'managed-suite-selection-readiness/1',
    tenantId: `tenant_${SUFFIX}`,
    organizationId: `organization_${SUFFIX}`,
    evaluatedAt: '2026-10-04T05:00:00.000Z',
    gates: GATE_NAMES.map((name, index) => ({
      name,
      state: index % 2 === 0 ? 'blocked' : 'not_configured',
      sourceRef: `${index + 1}`.padStart(16, '0'),
      observedAt: '2026-10-04T04:59:00.000Z',
    })),
  };
}

function genuineInputs() {
  return {
    identity: createManagedCustomerIdentityDomain(identityFixture()),
    readiness: createManagedSuiteSelectionReadiness(readinessFixture()),
  };
}

const GENERIC_ERROR = {
  name: 'TypeError',
  message: 'Invalid managed suite selection presentation input',
};

test('T1 genuine matching identity and readiness produce only the frozen blocked presentation', async () => {
  const domain = await loadPresentation();
  assert.equal(typeof domain.createManagedSuiteSelectionPresentation, 'function');
  const inputs = genuineInputs();
  const result = domain.createManagedSuiteSelectionPresentation(inputs.identity, inputs.readiness);

  assert.equal(Object.getPrototypeOf(result), null);
  assert.deepEqual(Object.keys(result), [
    'schemaVersion', 'tenantId', 'accountId', 'organizationId', 'evaluatedAt',
    'selectionStatus', 'canSelect', 'canCommit', 'gates',
  ]);
  assert.deepEqual({
    ...result,
    gates: result.gates.map((gate) => ({ ...gate })),
  }, {
    schemaVersion: 'managed-suite-selection-presentation/1',
    tenantId: `tenant_${SUFFIX}`,
    accountId: `account_${SUFFIX}`,
    organizationId: `organization_${SUFFIX}`,
    evaluatedAt: '2026-10-04T05:00:00.000Z',
    selectionStatus: 'blocked',
    canSelect: false,
    canCommit: false,
    gates: GATE_NAMES.map((name, index) => ({
      name,
      state: index % 2 === 0 ? 'blocked' : 'not_configured',
    })),
  });
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.gates), true);
  assert.notEqual(result.gates, inputs.readiness.gates);
  for (let index = 0; index < result.gates.length; index += 1) {
    assert.equal(Object.getPrototypeOf(result.gates[index]), null);
    assert.equal(Object.isFrozen(result.gates[index]), true);
    assert.notEqual(result.gates[index], inputs.readiness.gates[index]);
  }
  assert.equal(JSON.stringify(result).includes('sourceRef'), false);
  assert.equal(JSON.stringify(result).includes('observedAt'), false);
});

test('T2 shape-equivalent predecessor forgeries fail closed with one generic error', async () => {
  const domain = await loadPresentation();
  const inputs = genuineInputs();
  const forgedIdentity = {
    ...inputs.identity,
    account: { ...inputs.identity.account },
    organization: { ...inputs.identity.organization },
    membership: { ...inputs.identity.membership },
    tenantBinding: { ...inputs.identity.tenantBinding },
  };
  const forgedReadiness = {
    ...inputs.readiness,
    gates: inputs.readiness.gates.map((gate) => ({ ...gate })),
  };

  assert.throws(
    () => domain.createManagedSuiteSelectionPresentation(forgedIdentity, inputs.readiness),
    GENERIC_ERROR,
  );
  assert.throws(
    () => domain.createManagedSuiteSelectionPresentation(inputs.identity, forgedReadiness),
    GENERIC_ERROR,
  );
});

test('T3 genuine inputs bound to different tenants and organizations fail closed', async () => {
  const domain = await loadPresentation();
  const identityInput = identityFixture();
  const otherSuffix = '0000000000000002';
  identityInput.organization.organizationId = `organization_${otherSuffix}`;
  identityInput.membership.organizationId = `organization_${otherSuffix}`;
  const identity = createManagedCustomerIdentityDomain(identityInput);
  const readiness = createManagedSuiteSelectionReadiness(readinessFixture());

  assert.throws(
    () => domain.createManagedSuiteSelectionPresentation(identity, readiness),
    GENERIC_ERROR,
  );
});

test('T4 inactive identity and stale or malformed readiness copies remain untrusted', async () => {
  const domain = await loadPresentation();
  const inputs = genuineInputs();
  const inactiveIdentity = {
    ...inputs.identity,
    account: { ...inputs.identity.account, lifecycle: 'inactive' },
  };
  const staleReadiness = {
    ...inputs.readiness,
    evaluatedAt: '2026-10-03T04:59:59.999Z',
  };
  const malformedReadiness = {
    ...inputs.readiness,
    selectionStatus: 'available',
  };

  for (const [identity, readiness] of [
    [inactiveIdentity, inputs.readiness],
    [inputs.identity, staleReadiness],
    [inputs.identity, malformedReadiness],
  ]) {
    assert.throws(
      () => domain.createManagedSuiteSelectionPresentation(identity, readiness),
      GENERIC_ERROR,
    );
  }
});

test('T5 attempted authority commercial customer and provider fields fail closed', async () => {
  const domain = await loadPresentation();
  const inputs = genuineInputs();
  for (const [field, value] of [
    ['authority', 'owner'],
    ['price', 1],
    ['currency', 'USD'],
    ['credits', 1],
    ['leaseDuration', 'month'],
    ['recurringObligation', true],
    ['payment', 'configured'],
    ['refund', 'approved'],
    ['tax', 'included'],
    ['capacity', 1],
    ['provider', 'synthetic'],
    ['customer', 'synthetic'],
    ['action', () => {}],
  ]) {
    const forgedReadiness = { ...inputs.readiness, [field]: value };
    assert.throws(
      () => domain.createManagedSuiteSelectionPresentation(inputs.identity, forgedReadiness),
      GENERIC_ERROR,
    );
  }
});

test('T6 hostile descriptors proxies graphs races and oversized inputs fail closed without hooks', async () => {
  const domain = await loadPresentation();
  const inputs = genuineInputs();
  let hooks = 0;
  const accessor = Object.create(null);
  Object.defineProperty(accessor, 'tenantBinding', {
    enumerable: true,
    get() { hooks += 1; throw new Error('must not read'); },
  });
  const proxied = new Proxy(inputs.identity, {
    get() { hooks += 1; throw new Error('must not read'); },
    getPrototypeOf() { hooks += 1; throw new Error('must not inspect'); },
    ownKeys() { hooks += 1; throw new Error('must not enumerate'); },
  });
  const cyclic = { value: null };
  cyclic.value = cyclic;
  const shared = { left: inputs.identity.account, right: inputs.identity.account };
  const inherited = Object.create({ tenantBinding: inputs.identity.tenantBinding });
  const symbolic = { [Symbol('hidden')]: inputs.identity };
  const nonPlain = new Map([['identity', inputs.identity]]);
  const race = Object.create(null);
  Object.defineProperty(race, 'evaluatedAt', {
    enumerable: true,
    get() { hooks += 1; return '2026-10-04T05:00:00.000Z'; },
  });
  const oversized = {};
  for (let index = 0; index < 1000; index += 1) oversized[`extra${index}`] = index;
  const proxiedReadiness = new Proxy(inputs.readiness, {
    get() { hooks += 1; throw new Error('must not read'); },
    ownKeys() { hooks += 1; throw new Error('must not enumerate'); },
  });

  for (const [identity, readiness] of [
    [accessor, inputs.readiness],
    [proxied, inputs.readiness],
    [cyclic, inputs.readiness],
    [shared, inputs.readiness],
    [inherited, inputs.readiness],
    [symbolic, inputs.readiness],
    [nonPlain, inputs.readiness],
    [inputs.identity, race],
    [inputs.identity, proxiedReadiness],
    [oversized, inputs.readiness],
  ]) {
    assert.throws(
      () => domain.createManagedSuiteSelectionPresentation(identity, readiness),
      GENERIC_ERROR,
    );
  }
  assert.equal(hooks, 0);
});

test('T7 valid and invalid composition avoid replaceable post-import ambient hooks', async () => {
  const domain = await loadPresentation();
  const inputs = genuineInputs();
  const OriginalTypeError = globalThis.TypeError;
  const originals = {
    iterator: Array.prototype[Symbol.iterator],
    create: Object.create,
    defineProperty: Object.defineProperty,
    freeze: Object.freeze,
    weakSetHas: WeakSet.prototype.has,
  };
  let hooks = 0;
  let result;
  let observed;
  try {
    Array.prototype[Symbol.iterator] = function hostileIterator(...args) {
      hooks += 1;
      return originals.iterator.apply(this, args);
    };
    Object.create = (...args) => { hooks += 1; return originals.create(...args); };
    Object.defineProperty = (...args) => { hooks += 1; return originals.defineProperty(...args); };
    Object.freeze = (...args) => { hooks += 1; return originals.freeze(...args); };
    WeakSet.prototype.has = function hostileHas(...args) {
      hooks += 1;
      return originals.weakSetHas.apply(this, args);
    };
    globalThis.TypeError = function HostileTypeError(...args) {
      hooks += 1;
      return new OriginalTypeError(...args);
    };
    result = domain.createManagedSuiteSelectionPresentation(inputs.identity, inputs.readiness);
    try {
      domain.createManagedSuiteSelectionPresentation(null, inputs.readiness);
    } catch (error) {
      observed = error;
    }
  } finally {
    Array.prototype[Symbol.iterator] = originals.iterator;
    Object.create = originals.create;
    Object.defineProperty = originals.defineProperty;
    Object.freeze = originals.freeze;
    WeakSet.prototype.has = originals.weakSetHas;
    globalThis.TypeError = OriginalTypeError;
  }
  assert.equal(result.selectionStatus, 'blocked');
  assert.equal(Object.getPrototypeOf(observed), OriginalTypeError.prototype);
  assert.equal(observed.message, GENERIC_ERROR.message);
  assert.equal(hooks, 0);
});

test('T8 the dormant module and projection expose no actions private facts or commercial claims', async () => {
  const domain = await loadPresentation();
  assert.deepEqual(Object.keys(domain), ['createManagedSuiteSelectionPresentation']);
  const inputs = genuineInputs();
  const result = domain.createManagedSuiteSelectionPresentation(inputs.identity, inputs.readiness);
  const serialized = JSON.stringify(result);
  for (const forbidden of [
    'sourceRef', 'observedAt', 'displayLabel', 'roleLabel', 'neighbor', 'price',
    'currency', 'Credits', 'duration', 'recurring', 'taxRule',
    'quantity', 'legal', 'provider', 'customer', 'credential', 'repository', 'task_',
    'available', 'ready', 'selected', 'leased', 'purchased', 'provisioned',
    'approved', 'activated', 'working',
  ]) assert.equal(serialized.includes(forbidden), false, `forbidden projection content: ${forbidden}`);
  for (const key of ['select', 'commit', 'action']) assert.equal(key in result, false);
  for (const value of Object.values(result)) assert.notEqual(typeof value, 'function');
  for (const gate of result.gates) {
    for (const value of Object.values(gate)) assert.notEqual(typeof value, 'function');
  }
});

test('T9 only exact module-produced presentation instances carry private authenticity', async () => {
  const domain = await loadPresentation();
  const inputs = genuineInputs();
  const presentation = domain.createManagedSuiteSelectionPresentation(
    inputs.identity,
    inputs.readiness,
  );
  const forgery = {
    ...presentation,
    gates: presentation.gates.map((gate) => ({ ...gate })),
  };

  assert.equal(
    domain.createManagedSuiteSelectionPresentation.isAuthenticResult(presentation),
    true,
  );
  assert.equal(
    domain.createManagedSuiteSelectionPresentation.isAuthenticResult(forgery),
    false,
  );
  assert.deepEqual(Object.keys(domain), ['createManagedSuiteSelectionPresentation']);
  assert.deepEqual(Object.keys(domain.createManagedSuiteSelectionPresentation), []);
});
