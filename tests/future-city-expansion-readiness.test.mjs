import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const MODULE_URL = new URL('../src/domain/futureCityExpansionReadiness.ts', import.meta.url);
const INVALID = {
  name: 'TypeError',
  message: 'Invalid Future City expansion readiness input',
};

async function loadReadiness(tag) {
  try {
    const source = await readFile(MODULE_URL, 'utf8');
    const output = ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    return import(`data:text/javascript;base64,${Buffer.from(output).toString('base64')}#${tag}`);
  } catch (error) {
    if (error?.code === 'ENOENT') return {};
    throw error;
  }
}

function createAllBlockedEvidence(domain) {
  return domain.createFutureCityExpansionGateEvidence(
    'blocked_missing_reviewed_evidence',
    'blocked_missing_reviewed_evidence',
    'blocked_missing_reviewed_evidence',
    'blocked_missing_reviewed_evidence',
    'blocked_missing_reviewed_evidence',
    'blocked_missing_reviewed_evidence',
    'blocked_missing_reviewed_evidence',
    'blocked_pending_human_decisions',
    '2026-11-24T12:00:00.000Z',
  );
}

test('T1 exact blocked gate evidence yields the minimal frozen expansion-readiness record', async () => {
  const domain = await loadReadiness('t1');
  assert.equal(typeof domain.createFutureCityExpansionGateEvidence, 'function');
  assert.equal(typeof domain.evaluateFutureCityExpansionReadiness, 'function');

  const result = domain.evaluateFutureCityExpansionReadiness(createAllBlockedEvidence(domain));

  assert.equal(Object.getPrototypeOf(result), null);
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.blockers), true);
  assert.deepEqual(Object.keys(result), [
    'schemaVersion', 'status', 'blockers', 'generatedAt', 'privacy', 'activationState',
  ]);
  assert.deepEqual({ ...result, blockers: [...result.blockers] }, {
    schemaVersion: 'future-city-expansion-readiness/1',
    status: 'blocked',
    blockers: [
      'first_skyscraper_gate_blocked',
      'tenancy_gate_blocked',
      'hosted_agents_gate_blocked',
      'durable_records_gate_blocked',
      'authority_controls_gate_blocked',
      'accessibility_gate_blocked',
      'performance_gate_blocked',
      'accounting_gate_blocked',
    ],
    generatedAt: '2026-11-24T12:00:00.000Z',
    privacy: 'private',
    activationState: 'dormant',
  });
});

test('T2 reviewed working gates remove only their ordered blockers while accounting stays blocked', async () => {
  const domain = await loadReadiness('t2');
  const evidence = domain.createFutureCityExpansionGateEvidence(
    'reviewed_working',
    'blocked_missing_reviewed_evidence',
    'reviewed_working',
    'blocked_missing_reviewed_evidence',
    'reviewed_working',
    'blocked_missing_reviewed_evidence',
    'reviewed_working',
    'blocked_pending_human_decisions',
    '2026-11-24T12:01:00.000Z',
  );

  const result = domain.evaluateFutureCityExpansionReadiness(evidence);

  assert.deepEqual(result.blockers, [
    'tenancy_gate_blocked',
    'durable_records_gate_blocked',
    'accessibility_gate_blocked',
    'accounting_gate_blocked',
  ]);
  assert.equal(result.status, 'blocked');
});

test('T3 unsupported gate claims fail closed with one generic error', async () => {
  const domain = await loadReadiness('t3');
  const baseline = [
    'blocked_missing_reviewed_evidence',
    'blocked_missing_reviewed_evidence',
    'blocked_missing_reviewed_evidence',
    'blocked_missing_reviewed_evidence',
    'blocked_missing_reviewed_evidence',
    'blocked_missing_reviewed_evidence',
    'blocked_missing_reviewed_evidence',
    'blocked_pending_human_decisions',
    '2026-11-24T12:02:00.000Z',
  ];
  const unsupported = [
    [0, 'working'],
    [1, 'ready'],
    [2, true],
    [3, new String('reviewed_working')],
    [4, 'production_active'],
    [5, 'accessible'],
    [6, 'performant'],
    [7, 'reviewed_working'],
    [7, 'payment_ready'],
    [7, 'prices_approved'],
  ];

  for (const [index, value] of unsupported) {
    const candidate = [...baseline];
    candidate[index] = value;
    assert.throws(() => domain.createFutureCityExpansionGateEvidence(...candidate), INVALID);
  }
});

test('T4 generatedAt requires an exact canonical finite millisecond UTC timestamp', async () => {
  const domain = await loadReadiness('t4');
  const prefix = [
    'reviewed_working',
    'reviewed_working',
    'reviewed_working',
    'reviewed_working',
    'reviewed_working',
    'reviewed_working',
    'reviewed_working',
    'blocked_pending_human_decisions',
  ];
  for (const generatedAt of [
    null,
    new String('2026-11-24T12:03:00.000Z'),
    '2026-11-24T12:03:00Z',
    '2026-11-24T12:03:00.000+00:00',
    '2026-02-30T12:03:00.000Z',
    '99999-01-01T00:00:00.000Z',
  ]) assert.throws(
    () => domain.createFutureCityExpansionGateEvidence(...prefix, generatedAt),
    INVALID,
  );
});

test('T5 characterization: branded evidence is exact and copies wrappers accessors proxies fail without hooks', async () => {
  const domain = await loadReadiness('t5');
  const evidence = createAllBlockedEvidence(domain);
  assert.equal(Object.getPrototypeOf(evidence), null);
  assert.equal(Object.isFrozen(evidence), true);
  assert.deepEqual(Object.keys(evidence), [
    'firstSkyscraper',
    'tenancy',
    'hostedAgents',
    'durableRecords',
    'authorityControls',
    'accessibility',
    'performance',
    'accounting',
    'generatedAt',
  ]);
  let hooks = 0;
  const proxy = new Proxy(evidence, {
    get() { hooks += 1; throw new Error('must not read'); },
    getPrototypeOf() { hooks += 1; throw new Error('must not inspect'); },
    ownKeys() { hooks += 1; throw new Error('must not enumerate'); },
  });
  const accessor = Object.defineProperty(Object.create(null), 'generatedAt', {
    enumerable: true,
    get() { hooks += 1; throw new Error('must not invoke'); },
  });
  for (const candidate of [
    { ...evidence },
    JSON.parse(JSON.stringify(evidence)),
    Object.create(evidence),
    Object.freeze({ evidence }),
    proxy,
    accessor,
  ]) assert.throws(() => domain.evaluateFutureCityExpansionReadiness(candidate), INVALID);
  assert.equal(hooks, 0);
});

test('T6 characterization: exact arity rejects missing and extra values before attacker hooks', async () => {
  const domain = await loadReadiness('t6');
  const evidence = createAllBlockedEvidence(domain);
  let hooks = 0;
  const hostile = new Proxy(Object.create(null), {
    get() { hooks += 1; throw new Error('must not read'); },
    getPrototypeOf() { hooks += 1; throw new Error('must not inspect'); },
    ownKeys() { hooks += 1; throw new Error('must not enumerate'); },
  });
  assert.equal(domain.createFutureCityExpansionGateEvidence.length, 9);
  assert.equal(domain.evaluateFutureCityExpansionReadiness.length, 1);
  assert.throws(() => domain.createFutureCityExpansionGateEvidence(), INVALID);
  assert.throws(() => domain.createFutureCityExpansionGateEvidence(
    hostile, hostile, hostile, hostile, hostile, hostile, hostile, hostile, hostile, hostile,
  ), INVALID);
  assert.throws(() => domain.evaluateFutureCityExpansionReadiness(), INVALID);
  assert.throws(() => domain.evaluateFutureCityExpansionReadiness(hostile, evidence), INVALID);
  assert.equal(hooks, 0);
});

test('T7 characterization: post-import intrinsic replacement cannot alter validation or output', async () => {
  const domain = await loadReadiness('t7');
  const originalDefineProperty = Object.defineProperty;
  const datePrototype = Date.prototype;
  const originals = {
    create: Object.create,
    freeze: Object.freeze,
    defineProperty: Object.defineProperty,
    Date: globalThis.Date,
    dateGetTime: Date.prototype.getTime,
    dateToISOString: Date.prototype.toISOString,
    regexpTest: RegExp.prototype.test,
    weakSetAdd: WeakSet.prototype.add,
    weakSetHas: WeakSet.prototype.has,
    numberIsFinite: Number.isFinite,
  };
  let hooks = 0;
  const hostile = () => { hooks += 1; throw new Error('ambient hook'); };
  const replace = (owner, key, value) => originalDefineProperty(owner, key, {
    configurable: true,
    value,
    writable: true,
  });
  let result;
  try {
    replace(Object, 'create', hostile);
    replace(Object, 'freeze', hostile);
    replace(Object, 'defineProperty', hostile);
    replace(globalThis, 'Date', hostile);
    replace(datePrototype, 'getTime', hostile);
    replace(datePrototype, 'toISOString', hostile);
    replace(RegExp.prototype, 'test', hostile);
    replace(WeakSet.prototype, 'add', hostile);
    replace(WeakSet.prototype, 'has', hostile);
    replace(Number, 'isFinite', hostile);
    result = domain.evaluateFutureCityExpansionReadiness(createAllBlockedEvidence(domain));
  } finally {
    replace(Object, 'create', originals.create);
    replace(Object, 'freeze', originals.freeze);
    replace(Object, 'defineProperty', originals.defineProperty);
    replace(globalThis, 'Date', originals.Date);
    replace(datePrototype, 'getTime', originals.dateGetTime);
    replace(datePrototype, 'toISOString', originals.dateToISOString);
    replace(RegExp.prototype, 'test', originals.regexpTest);
    replace(WeakSet.prototype, 'add', originals.weakSetAdd);
    replace(WeakSet.prototype, 'has', originals.weakSetHas);
    replace(Number, 'isFinite', originals.numberIsFinite);
  }
  assert.equal(hooks, 0);
  assert.equal(result.status, 'blocked');
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.blockers), true);
});

test('T8 characterization: evidence and results are detached recursively frozen snapshots', async () => {
  const domain = await loadReadiness('t8');
  const evidence = createAllBlockedEvidence(domain);
  const first = domain.evaluateFutureCityExpansionReadiness(evidence);
  const second = domain.evaluateFutureCityExpansionReadiness(evidence);
  assert.notEqual(first, second);
  assert.notEqual(first.blockers, second.blockers);
  assert.equal(Object.isFrozen(evidence), true);
  assert.equal(Object.isFrozen(first), true);
  assert.equal(Object.isFrozen(first.blockers), true);
  assert.throws(() => { evidence.generatedAt = '2026-11-24T13:00:00.000Z'; }, TypeError);
  assert.throws(() => { first.blockers[0] = 'working'; }, TypeError);
  assert.deepEqual(JSON.parse(JSON.stringify(first)), {
    ...first,
    blockers: [...first.blockers],
  });
});

test('T9 characterization: boundary stays dormant and fabricates no expansion or commerce object', async () => {
  const source = await readFile(MODULE_URL, 'utf8');
  const imports = Array.from(
    source.matchAll(/\bfrom\s+['"]([^'"]+)['"];?/g),
    (match) => match[1],
  );
  assert.deepEqual(imports, []);
  const importers = [];
  for (const root of ['../src', '../server']) {
    const paths = await readdir(new URL(root, import.meta.url), { recursive: true });
    for (const path of paths) {
      if (!/\.(?:[cm]?ts|tsx|[cm]?js|jsx)$/.test(path)
          || root === '../src' && path === 'domain/futureCityExpansionReadiness.ts') continue;
      const candidate = await readFile(new URL(`${root}/${path}`, import.meta.url), 'utf8');
      if (/futureCityExpansionReadiness/.test(candidate)) importers.push(`${root}/${path}`);
    }
  }
  assert.deepEqual(importers, []);
  assert.doesNotMatch(source, /\b(?:fetch|XMLHttpRequest|WebSocket|setTimeout|setInterval|process|document|window|localStorage|sessionStorage|console|eval)\b/);
  assert.doesNotMatch(source, /\bnew\s+Function\b/);

  const domain = await loadReadiness('t9');
  const result = domain.evaluateFutureCityExpansionReadiness(createAllBlockedEvidence(domain));
  for (const forbidden of [
    'district',
    'building',
    'marketplace',
    'listing',
    'convention',
    'training',
    'collaboration',
    'tenantVisibilityPolicy',
    'publicData',
    'price',
    'creditsValue',
    'payment',
    'refund',
    'tax',
    'legal',
    'customer',
    'provider',
    'hostedAgentActivity',
    'production',
  ]) assert.equal(forbidden in result, false, `forbidden readiness field: ${forbidden}`);
});

test('T10 characterization: unknown hidden symbol and inherited keys cannot forge gate evidence', async () => {
  const domain = await loadReadiness('t10');
  const evidence = createAllBlockedEvidence(domain);
  const hidden = Object.defineProperty({ ...evidence }, 'hidden', { value: true });
  const symbol = { ...evidence, [Symbol('hidden')]: true };
  const inherited = Object.assign(Object.create({ hidden: true }), evidence);
  const unknown = { ...evidence, marketplaceEligible: true };
  for (const candidate of [hidden, symbol, inherited, unknown]) {
    assert.throws(() => domain.evaluateFutureCityExpansionReadiness(candidate), INVALID);
  }
  assert.throws(() => { evidence.hidden = true; }, TypeError);
});
