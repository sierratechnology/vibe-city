import assert from 'node:assert/strict';
import test from 'node:test';

const MODULE_PATH = '../server/managedSuiteSelectionReadiness.mjs';
const SUFFIX = '0000000000000001';
const GATE_NAMES = ['pricing', 'lease_terms', 'payment', 'refunds', 'tax', 'capacity'];

async function loadDomain() {
  return import(MODULE_PATH).catch(() => ({}));
}

function fixture() {
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

const GENERIC_ERROR = {
  name: 'TypeError',
  message: 'Invalid managed suite selection readiness input',
};

test('T1 constructs one detached recursively frozen blocked readiness record preserving gate states', async () => {
  const domain = await loadDomain();
  assert.equal(typeof domain.createManagedSuiteSelectionReadiness, 'function');
  const input = fixture();
  const result = domain.createManagedSuiteSelectionReadiness(input);

  assert.equal(Object.getPrototypeOf(result), null);
  assert.deepEqual(Object.keys(result), [
    'schemaVersion', 'tenantId', 'organizationId', 'evaluatedAt',
    'selectionStatus', 'canSelect', 'canCommit', 'gates',
  ]);
  assert.deepEqual({
    ...result,
    gates: result.gates.map((gate) => ({ ...gate })),
  }, {
    schemaVersion: 'managed-suite-selection-readiness/1',
    tenantId: `tenant_${SUFFIX}`,
    organizationId: `organization_${SUFFIX}`,
    evaluatedAt: '2026-10-04T05:00:00.000Z',
    selectionStatus: 'blocked',
    canSelect: false,
    canCommit: false,
    gates: input.gates.map((gate) => ({ ...gate })),
  });
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.gates), true);
  for (const gate of result.gates) {
    assert.equal(Object.getPrototypeOf(gate), null);
    assert.equal(Object.isFrozen(gate), true);
  }
  assert.notEqual(result.gates, input.gates);
  for (let index = 0; index < result.gates.length; index += 1) {
    assert.notEqual(result.gates[index], input.gates[index]);
  }
  input.gates[0].state = 'not_configured';
  assert.equal(result.gates[0].state, 'blocked');
  assert.equal('select' in result, false);
  assert.equal('commit' in result, false);
});

test('T2a tenant and organization IDs require one shared canonical lowercase-hex suffix', async () => {
  const domain = await loadDomain();
  const invalid = [];
  for (const [tenantId, organizationId] of [
    ['tenant_0000000000000001', 'organization_0000000000000002'],
    ['tenant_ABCDEF0000000001', 'organization_ABCDEF0000000001'],
    ['tenant_000000000000001', 'organization_000000000000001'],
    [`tenant_${'0'.repeat(65)}`, `organization_${'0'.repeat(65)}`],
    ['organization_0000000000000001', 'tenant_0000000000000001'],
  ]) invalid.push({ ...fixture(), tenantId, organizationId });

  for (const input of invalid) {
    assert.throws(
      () => domain.createManagedSuiteSelectionReadiness(input),
      GENERIC_ERROR,
    );
  }
});

test('T2b evaluated and observed times require canonical real UTC instants in causal order', async () => {
  const domain = await loadDomain();
  const invalid = [];
  for (const evaluatedAt of [
    '2026-10-04T05:00:00Z',
    '2026-02-29T05:00:00.000Z',
    '2026-10-04T24:00:00.000Z',
    '2026-10-04T05:00:00.000+00:00',
    new String('2026-10-04T05:00:00.000Z'),
  ]) invalid.push({ ...fixture(), evaluatedAt });
  const futureObservation = fixture();
  futureObservation.gates[0].observedAt = '2026-10-04T05:00:00.001Z';
  invalid.push(futureObservation);
  const impossibleObservation = fixture();
  impossibleObservation.gates[1].observedAt = '2026-04-31T04:59:00.000Z';
  invalid.push(impossibleObservation);

  for (const input of invalid) {
    assert.throws(
      () => domain.createManagedSuiteSelectionReadiness(input),
      GENERIC_ERROR,
    );
  }
});

test('T2c observations older than the bounded one-day readiness window fail closed', async () => {
  const domain = await loadDomain();
  const boundary = fixture();
  boundary.gates[0].observedAt = '2026-10-03T05:00:00.000Z';
  assert.equal(
    domain.createManagedSuiteSelectionReadiness(boundary).gates[0].observedAt,
    '2026-10-03T05:00:00.000Z',
  );
  const stale = fixture();
  stale.gates[0].observedAt = '2026-10-03T04:59:59.999Z';
  assert.throws(
    () => domain.createManagedSuiteSelectionReadiness(stale),
    GENERIC_ERROR,
  );
});

test('T3a gates require the complete exact unambiguous semantic sequence', async () => {
  const domain = await loadDomain();
  const invalid = [];
  const missing = fixture();
  missing.gates.pop();
  invalid.push(missing);
  const duplicate = fixture();
  duplicate.gates[5].name = 'pricing';
  invalid.push(duplicate);
  const unknown = fixture();
  unknown.gates[2].name = 'availability';
  invalid.push(unknown);
  const reordered = fixture();
  [reordered.gates[0], reordered.gates[1]] = [reordered.gates[1], reordered.gates[0]];
  invalid.push(reordered);
  const ambiguous = fixture();
  ambiguous.gates[3].name = 'refunds_or_tax';
  invalid.push(ambiguous);

  for (const input of invalid) {
    assert.throws(
      () => domain.createManagedSuiteSelectionReadiness(input),
      GENERIC_ERROR,
    );
  }
});

test('T3b every gate state is exactly blocked or not_configured and never implies availability', async () => {
  const domain = await loadDomain();
  for (const state of ['available', 'working', 'approved', 'selected', 'committed', 'blocked_or_ready']) {
    const input = fixture();
    input.gates[0].state = state;
    assert.throws(
      () => domain.createManagedSuiteSelectionReadiness(input),
      GENERIC_ERROR,
    );
  }
});

test('T4a only exact closed plain-data schemas and canonical primitive scalars are accepted', async () => {
  const domain = await loadDomain();
  const invalid = [null, [], { ...fixture(), extra: true }];
  const wrongSchema = fixture();
  wrongSchema.schemaVersion = 'managed-suite-selection-readiness/2';
  invalid.push(wrongSchema);
  const nonArrayGates = fixture();
  nonArrayGates.gates = { ...nonArrayGates.gates };
  invalid.push(nonArrayGates);
  const extraArrayKey = fixture();
  extraArrayKey.gates.extra = true;
  invalid.push(extraArrayKey);
  const extraGateKey = fixture();
  extraGateKey.gates[0].price = 'hidden';
  invalid.push(extraGateKey);
  const symbolGateKey = fixture();
  symbolGateKey.gates[1][Symbol('hidden')] = true;
  invalid.push(symbolGateKey);
  for (const sourceRef of [
    '123456789012345',
    '0'.repeat(65),
    'https://example.invalid/private',
    'provider_customer_task',
    'ABCDEF0000000000',
    new String('0000000000000001'),
    '\ud800000000000000',
  ]) {
    const input = fixture();
    input.gates[0].sourceRef = sourceRef;
    invalid.push(input);
  }
  const boxedTenant = fixture();
  boxedTenant.tenantId = new String(boxedTenant.tenantId);
  invalid.push(boxedTenant);

  for (const input of invalid) {
    assert.throws(
      () => domain.createManagedSuiteSelectionReadiness(input),
      GENERIC_ERROR,
    );
  }
});

test('T4b inherited accessor proxy cyclic and shared graphs fail closed with zero hostile hooks', async () => {
  const domain = await loadDomain();
  let hooks = 0;
  const inherited = Object.assign(Object.create({ private: true }), fixture());
  const accessor = fixture();
  Object.defineProperty(accessor.gates[0], 'sourceRef', {
    enumerable: true,
    get() { hooks += 1; return '0000000000000001'; },
  });
  const proxied = fixture();
  proxied.gates[1] = new Proxy(proxied.gates[1], {
    get() { hooks += 1; throw new Error('must not read'); },
    getPrototypeOf() { hooks += 1; throw new Error('must not inspect'); },
    ownKeys() { hooks += 1; throw new Error('must not enumerate'); },
  });
  const cyclic = fixture();
  cyclic.gates[2].sourceRef = cyclic.gates[2];
  const shared = fixture();
  shared.gates[3] = shared.gates[2];

  for (const input of [inherited, accessor, proxied, cyclic, shared]) {
    assert.throws(
      () => domain.createManagedSuiteSelectionReadiness(input),
      GENERIC_ERROR,
    );
  }
  assert.equal(hooks, 0);
});

test('T4c valid and invalid construction avoid replaceable ambient authority hooks', async () => {
  const domain = await loadDomain();
  const OriginalTypeError = globalThis.TypeError;
  const originals = {
    arrayIsArray: Array.isArray,
    iterator: Array.prototype[Symbol.iterator],
    freeze: Object.freeze,
    descriptor: Object.getOwnPropertyDescriptor,
    prototype: Object.getPrototypeOf,
    ownKeys: Reflect.ownKeys,
    regexpExec: RegExp.prototype.exec,
    regexpTest: RegExp.prototype.test,
    charCodeAt: String.prototype.charCodeAt,
    slice: String.prototype.slice,
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
    Object.freeze = (...args) => { hooks += 1; return originals.freeze(...args); };
    Object.getOwnPropertyDescriptor = (...args) => {
      hooks += 1;
      return originals.descriptor(...args);
    };
    Object.getPrototypeOf = (...args) => { hooks += 1; return originals.prototype(...args); };
    Reflect.ownKeys = (...args) => { hooks += 1; return originals.ownKeys(...args); };
    RegExp.prototype.exec = function hostileExec() { hooks += 1; throw new Error('must not exec'); };
    RegExp.prototype.test = function hostileTest() { hooks += 1; throw new Error('must not test'); };
    String.prototype.charCodeAt = function hostileCharCodeAt(...args) {
      hooks += 1;
      return originals.charCodeAt.apply(this, args);
    };
    String.prototype.slice = function hostileSlice(...args) {
      hooks += 1;
      return originals.slice.apply(this, args);
    };
    globalThis.TypeError = function HostileTypeError(...args) {
      hooks += 1;
      return new OriginalTypeError(...args);
    };
    result = domain.createManagedSuiteSelectionReadiness(fixture());
    try {
      domain.createManagedSuiteSelectionReadiness(null);
    } catch (error) {
      observed = error;
    }
  } finally {
    Array.isArray = originals.arrayIsArray;
    Array.prototype[Symbol.iterator] = originals.iterator;
    Object.freeze = originals.freeze;
    Object.getOwnPropertyDescriptor = originals.descriptor;
    Object.getPrototypeOf = originals.prototype;
    Reflect.ownKeys = originals.ownKeys;
    RegExp.prototype.exec = originals.regexpExec;
    RegExp.prototype.test = originals.regexpTest;
    String.prototype.charCodeAt = originals.charCodeAt;
    String.prototype.slice = originals.slice;
    globalThis.TypeError = OriginalTypeError;
  }
  assert.equal(result.selectionStatus, 'blocked');
  assert.equal(Object.getPrototypeOf(observed), OriginalTypeError.prototype);
  assert.equal(observed.message, GENERIC_ERROR.message);
  assert.equal(hooks, 0);
});

test('T4c2 timestamp validation avoids post-import ambient Math dispatch', async () => {
  const domain = await loadDomain();
  const originalFloor = Math.floor;
  let hooks = 0;
  let result;
  try {
    Math.floor = (...args) => { hooks += 1; return originalFloor(...args); };
    result = domain.createManagedSuiteSelectionReadiness(fixture());
  } finally {
    Math.floor = originalFloor;
  }
  assert.equal(result.canCommit, false);
  assert.equal(hooks, 0);
});

test('T4g valid and invalid construction avoid post-import numeric Array prototype dispatch', async () => {
  const domain = await loadDomain();
  const input = fixture();
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
    result = domain.createManagedSuiteSelectionReadiness(input);
    try {
      domain.createManagedSuiteSelectionReadiness(null);
    } catch (error) {
      observed = error;
    }
  } finally {
    if (originalDescriptor) defineProperty(Array.prototype, '0', originalDescriptor);
    else deleteProperty(Array.prototype, '0');
  }
  assert.equal(result.selectionStatus, 'blocked');
  assert.equal(result.canSelect, false);
  assert.equal(result.canCommit, false);
  assert.equal(observed.name, GENERIC_ERROR.name);
  assert.equal(observed.message, GENERIC_ERROR.message);
  assert.equal(hooks, 0);
});

test('T4d the sole dormant export and output expose no action commercial detail or private context', async () => {
  const domain = await loadDomain();
  assert.deepEqual(Object.keys(domain), ['createManagedSuiteSelectionReadiness']);
  const result = domain.createManagedSuiteSelectionReadiness(fixture());
  const serialized = JSON.stringify(result);
  for (const forbidden of [
    'http', '://', 'USD', '$', 'credential', 'customer', 'provider', 'repository',
    'task_', 'authority', 'legal', 'neighbor', 'route', 'duration', 'quantity',
    'instruction', 'approved', 'available', 'working', 'selected', 'committed',
  ]) assert.equal(serialized.includes(forbidden), false, `forbidden output content: ${forbidden}`);
  for (const key of ['price', 'currency', 'credits', 'leaseDuration', 'select', 'commit', 'action']) {
    assert.equal(key in result, false);
  }
  for (const gate of result.gates) {
    for (const value of Object.values(gate)) assert.notEqual(typeof value, 'function');
  }
});

test('T4e oversized containers and scalars fail closed within fixed schema bounds', async () => {
  const domain = await loadDomain();
  const oversizedRecord = fixture();
  for (let index = 0; index < 1000; index += 1) oversizedRecord[`extra${index}`] = index;
  const oversizedGates = fixture();
  for (let index = 0; index < 1000; index += 1) oversizedGates.gates.push({});
  const oversizedScalar = fixture();
  oversizedScalar.gates[0].sourceRef = '0'.repeat(100_000);
  for (const input of [oversizedRecord, oversizedGates, oversizedScalar]) {
    assert.throws(
      () => domain.createManagedSuiteSelectionReadiness(input),
      GENERIC_ERROR,
    );
  }
});

test('T4f descriptor-based mutation attempts are rejected before any race hook executes', async () => {
  const domain = await loadDomain();
  let hooks = 0;
  const outerRace = fixture();
  const outerGates = outerRace.gates;
  Object.defineProperty(outerRace, 'gates', {
    enumerable: true,
    get() {
      hooks += 1;
      outerGates[0].state = 'available';
      return outerGates;
    },
  });
  const arrayRace = fixture();
  const firstGate = arrayRace.gates[0];
  Object.defineProperty(arrayRace.gates, '0', {
    enumerable: true,
    get() {
      hooks += 1;
      arrayRace.gates[1].state = 'working';
      return firstGate;
    },
  });
  for (const input of [outerRace, arrayRace]) {
    assert.throws(
      () => domain.createManagedSuiteSelectionReadiness(input),
      GENERIC_ERROR,
    );
  }
  assert.equal(hooks, 0);
});
