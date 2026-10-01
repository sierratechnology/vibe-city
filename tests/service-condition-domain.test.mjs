import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const moduleUrl = new URL('../src/domain/serviceCondition.ts', import.meta.url);

async function loadDomain() {
  let source;
  try {
    source = await readFile(moduleUrl, 'utf8');
  } catch (error) {
    if (error?.code === 'ENOENT') return {};
    throw error;
  }
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(output).toString('base64')}`);
}

const IDS = Object.freeze({
  tenant: 'id_1111111111111111',
  service: 'id_2222222222222222',
  observation: 'id_3333333333333333',
});

function observationFixture(overrides = {}) {
  return {
    tenantId: IDS.tenant,
    serviceId: IDS.service,
    sourceObservationId: IDS.observation,
    observedAt: '2026-09-30T12:00:00.000Z',
    evaluatedAt: '2026-09-30T12:00:30.000Z',
    sourceAvailability: 'available',
    lifecycle: 'active',
    required: true,
    configured: true,
    healthEvidence: 'affirmative',
    blockReason: null,
    ...overrides,
  };
}

test('closed synthetic identity derives one working service observation', async () => {
  const domain = await loadDomain();
  assert.equal(typeof domain.deriveServiceCondition, 'function');

  const result = domain.deriveServiceCondition(observationFixture());
  assert.deepEqual({ ...result }, {
    tenantId: IDS.tenant,
    serviceId: IDS.service,
    sourceObservationId: IDS.observation,
    classification: 'working',
    freshness: 'live',
    observedAt: '2026-09-30T12:00:00.000Z',
    evaluatedAt: '2026-09-30T12:00:30.000Z',
    reasonCode: 'source_healthy',
  });
});

test('classification vocabulary is exactly seven categorical service states', async () => {
  const domain = await loadDomain();
  const cases = [
    [{}, 'working', 'source_healthy'],
    [{ sourceAvailability: 'degraded', healthEvidence: 'impaired' },
      'degraded', 'source_impaired'],
    [{ healthEvidence: 'none', blockReason: 'dependency_missing' },
      'blocked', 'dependency_missing'],
    [{ sourceAvailability: 'unavailable', healthEvidence: 'failure' },
      'broken', 'source_failure'],
    [{ configured: false, healthEvidence: 'none' },
      'not_configured', 'service_not_configured'],
    [{ required: false, configured: false, healthEvidence: 'none' },
      'optional', 'service_optional'],
    [{ lifecycle: 'retired', required: false, configured: false, healthEvidence: 'none' },
      'retired', 'service_retired'],
  ];

  const actual = cases.map(([overrides, classification, reasonCode]) => {
    const result = domain.deriveServiceCondition(observationFixture(overrides));
    assert.equal(result.reasonCode, reasonCode);
    return result.classification;
  });
  assert.deepEqual(actual, cases.map(([, classification]) => classification));
  assert.deepEqual([...new Set(actual)].sort(), [
    'blocked', 'broken', 'degraded', 'not_configured', 'optional', 'retired', 'working',
  ]);
});

test('freshness uses explicit source facts and exact bounded age thresholds', async () => {
  const domain = await loadDomain();
  const atAge = (evaluatedAt, overrides = {}) => domain.deriveServiceCondition(
    observationFixture({ evaluatedAt, ...overrides }),
  );

  assert.equal(atAge('2026-09-30T12:01:00.000Z').freshness, 'live');
  assert.equal(atAge('2026-09-30T12:01:00.001Z').freshness, 'recent');
  assert.equal(atAge('2026-09-30T12:05:00.000Z').freshness, 'recent');
  assert.equal(atAge('2026-09-30T12:05:00.001Z').freshness, 'historical');
  assert.equal(atAge('2026-10-01T12:00:00.000Z').freshness, 'historical');
  const stale = atAge('2026-10-01T12:00:00.001Z');
  assert.equal(stale.freshness, 'stale');
  assert.equal(stale.classification, 'degraded');
  assert.equal(stale.reasonCode, 'stale_observation');
  assert.equal(atAge('2026-09-30T12:00:30.000Z', {
    sourceAvailability: 'degraded', healthEvidence: 'impaired',
  }).freshness, 'degraded');
  assert.equal(atAge('2026-09-30T12:00:30.000Z', {
    sourceAvailability: 'unavailable', healthEvidence: 'failure',
  }).freshness, 'unavailable');
});

test('extended-year chronology rejects an evaluated instant before observation', async () => {
  const domain = await loadDomain();

  assert.throws(
    () => domain.deriveServiceCondition(observationFixture({
      observedAt: '+010000-01-01T00:00:00.000Z',
      evaluatedAt: '9999-12-31T23:59:59.999Z',
    })),
    { message: 'Invalid service condition observation' },
  );
});

test('not configured optional and retired remain non-failure categories', async () => {
  const domain = await loadDomain();
  for (const overrides of [
    { configured: false, healthEvidence: 'failure' },
    { required: false, configured: true },
    { lifecycle: 'retired', required: false, configured: false,
      healthEvidence: 'failure', sourceAvailability: 'unavailable' },
    { lifecycle: 'retired', required: false, configured: false,
      healthEvidence: 'none', sourceAvailability: 'degraded' },
    { lifecycle: 'retired', required: false, configured: false,
      healthEvidence: 'none', blockReason: 'dependency_missing' },
  ]) {
    assert.throws(
      () => domain.deriveServiceCondition(observationFixture(overrides)),
      { message: 'Invalid service condition observation' },
    );
  }
});

test('degraded blocked and broken require localized closed evidence', async () => {
  const domain = await loadDomain();
  const decisionBlocked = domain.deriveServiceCondition(observationFixture({
    healthEvidence: 'none', blockReason: 'decision_required',
  }));
  assert.equal(decisionBlocked.classification, 'blocked');
  assert.equal(decisionBlocked.reasonCode, 'decision_required');

  for (const overrides of [
    { healthEvidence: 'none', blockReason: 'free text' },
    { healthEvidence: 'failure' },
    { sourceAvailability: 'unavailable', healthEvidence: 'impaired' },
    { sourceAvailability: 'degraded', healthEvidence: 'failure' },
    { sourceAvailability: 'degraded', healthEvidence: 'impaired',
      blockReason: 'dependency_missing' },
  ]) {
    assert.throws(
      () => domain.deriveServiceCondition(observationFixture(overrides)),
      { message: 'Invalid service condition observation' },
    );
  }
});

test('hostile objects fail closed without invoking value or coercion hooks', async () => {
  const domain = await loadDomain();
  let hookCalls = 0;
  const accessor = Object.defineProperty(observationFixture(), 'healthEvidence', {
    enumerable: true,
    get() {
      hookCalls += 1;
      return 'affirmative';
    },
  });
  const coercible = {
    [Symbol.toPrimitive]() {
      hookCalls += 1;
      return 'available';
    },
  };
  const symbolKey = Object.assign(observationFixture(), { [Symbol('hidden')]: true });
  const inherited = Object.assign(Object.create({ hidden: true }), observationFixture());
  let ownKeyReads = 0;
  const racing = new Proxy(observationFixture(), {
    ownKeys(target) {
      ownKeyReads += 1;
      return ownKeyReads === 1 ? Reflect.ownKeys(target) : [...Reflect.ownKeys(target), 'raced'];
    },
    getOwnPropertyDescriptor(target, key) {
      if (key === 'raced') return { value: true, enumerable: true, configurable: true };
      return Reflect.getOwnPropertyDescriptor(target, key);
    },
  });

  for (const input of [
    accessor,
    observationFixture({ sourceAvailability: coercible }),
    symbolKey,
    inherited,
    racing,
    observationFixture({ tenantId: IDS.service }),
    observationFixture({ evaluatedAt: '2026-09-30 12:00:30Z' }),
    { ...observationFixture(), extra: true },
  ]) {
    assert.throws(
      () => domain.deriveServiceCondition(input),
      { message: 'Invalid service condition observation' },
    );
  }
  assert.equal(hookCalls, 0);
});

test('stable Proxy input fails closed without invoking attacker hooks', async () => {
  const domain = await loadDomain();
  let hookCalls = 0;
  const input = new Proxy(observationFixture(), {
    getPrototypeOf(target) {
      hookCalls += 1;
      return Reflect.getPrototypeOf(target);
    },
    ownKeys(target) {
      hookCalls += 1;
      return Reflect.ownKeys(target);
    },
    getOwnPropertyDescriptor(target, key) {
      hookCalls += 1;
      return Reflect.getOwnPropertyDescriptor(target, key);
    },
  });

  assert.throws(
    () => domain.deriveServiceCondition(input),
    { message: 'Invalid service condition observation' },
  );
  assert.equal(hookCalls, 0);
});

test('source availability stays an exact primitive for non-operational categories', async () => {
  const domain = await loadDomain();
  let coercionCalls = 0;
  const coercible = {
    [Symbol.toPrimitive]() {
      coercionCalls += 1;
      return 'available';
    },
  };
  for (const input of [
    observationFixture({ required: false, configured: false, healthEvidence: 'none',
      sourceAvailability: coercible }),
    observationFixture({ configured: false, healthEvidence: 'none',
      sourceAvailability: 'healthy' }),
  ]) {
    assert.throws(
      () => domain.deriveServiceCondition(input),
      { message: 'Invalid service condition observation' },
    );
  }
  assert.equal(coercionCalls, 0);
});

test('result is detached recursively frozen null-prototype minimal data', async () => {
  const domain = await loadDomain();
  const input = observationFixture();
  const result = domain.deriveServiceCondition(input);

  assert.equal(Object.getPrototypeOf(result), null);
  assert.equal(Object.isFrozen(result), true);
  assert.deepEqual(Reflect.ownKeys(result), [
    'tenantId', 'serviceId', 'sourceObservationId', 'classification', 'freshness',
    'observedAt', 'evaluatedAt', 'reasonCode',
  ]);
  for (const forbidden of [
    'permissions', 'authority', 'role', 'skill', 'credentials', 'provider', 'url',
    'customer', 'capacity', 'price', 'rawError', 'tenantMembership',
  ]) {
    assert.equal(Object.hasOwn(result, forbidden), false);
  }
  input.tenantId = 'id_9999999999999999';
  input.healthEvidence = 'failure';
  assert.equal(result.tenantId, IDS.tenant);
  assert.equal(result.classification, 'working');
});

test('service condition boundary remains dormant and runtime-disconnected', async () => {
  const [source, main] = await Promise.all([
    readFile(moduleUrl, 'utf8'),
    readFile(new URL('../src/main.ts', import.meta.url), 'utf8'),
  ]);
  assert.deepEqual(
    [...source.matchAll(/\bfrom\s+['"]([^'"]+)['"]/gs)].map((match) => match[1]),
    ['node:util'],
  );
  assert.doesNotMatch(source, /\b(fetch|XMLHttpRequest|WebSocket|setTimeout|setInterval|Date\.now|process|localStorage|sessionStorage|document|window|navigator|indexedDB)\b/);
  assert.doesNotMatch(source, /\b(route|server|provider|database|renderer|animation|occupancy|hermes|sqlite)\b/i);
  assert.doesNotMatch(main, /serviceCondition|deriveServiceCondition/);
});
