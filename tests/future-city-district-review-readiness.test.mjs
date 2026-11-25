import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import test from 'node:test';

const MODULE_URL = new URL('../src/domain/futureCityDistrictValueGate.ts', import.meta.url);
const INVALID = {
  name: 'TypeError',
  message: 'Invalid Future City district value gate input',
};

async function loadDomain(tag) {
  return import(`${MODULE_URL.href}?${tag}`);
}

function createValueGate(
  domain,
  proposalId = 'proposal-13',
  generatedAt = '2026-11-24T14:11:00.000Z',
  platformValueEvidence = 'reviewed_value',
) {
  const expansionEvidence = domain.createFutureCityExpansionGateEvidence(
    'reviewed_working',
    'reviewed_working',
    'reviewed_working',
    'reviewed_working',
    'reviewed_working',
    'reviewed_working',
    'reviewed_working',
    'blocked_pending_human_decisions',
    '2026-11-24T14:10:00.000Z',
  );
  const readiness = domain.evaluateFutureCityExpansionReadiness(expansionEvidence);
  const proposal = domain.createFutureCityDistrictProposalEvidence(
    proposalId,
    generatedAt,
    'training',
    platformValueEvidence,
    'private',
    'dormant',
  );
  return domain.evaluateFutureCityDistrictValueGate(readiness, proposal);
}

function createReviewEvidence(
  domain,
  valueGate,
  proposalId = valueGate.proposalId,
  generatedAt = '2026-11-24T14:12:00.000Z',
) {
  return domain.createFutureCityDistrictReviewEvidence(
    valueGate,
    proposalId,
    generatedAt,
    'pending_human_decision',
    'private',
    'dormant',
  );
}

test('T1 pending human review yields only a minimal frozen blocked readiness record', async () => {
  const domain = await loadDomain('m113-t1');
  const valueGate = createValueGate(domain);
  const evidence = createReviewEvidence(domain, valueGate);

  const result = domain.evaluateFutureCityDistrictReviewReadiness(valueGate, evidence);

  assert.equal(Object.getPrototypeOf(evidence), null);
  assert.equal(Object.isFrozen(evidence), true);
  assert.deepEqual(Object.keys(evidence), [
    'proposalId', 'generatedAt', 'reviewState', 'sensitivity', 'activationState',
  ]);
  assert.deepEqual({ ...evidence }, {
    proposalId: 'proposal-13',
    generatedAt: '2026-11-24T14:12:00.000Z',
    reviewState: 'pending_human_decision',
    sensitivity: 'private',
    activationState: 'dormant',
  });
  assert.equal(Object.getPrototypeOf(result), null);
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.reasonCodes), true);
  assert.deepEqual(Object.keys(result), [
    'proposalId', 'status', 'reviewState', 'sensitivity', 'activationState',
    'generatedAt', 'reasonCodes',
  ]);
  assert.deepEqual({ ...result, reasonCodes: [...result.reasonCodes] }, {
    proposalId: 'proposal-13',
    status: 'blocked',
    reviewState: 'pending_human_decision',
    sensitivity: 'private',
    activationState: 'dormant',
    generatedAt: '2026-11-24T14:12:00.000Z',
    reasonCodes: ['entry_gate_blocked', 'human_review_required'],
  });
});

test('T2 missing value evidence remains blocked between entry and human-review reasons', async () => {
  const domain = await loadDomain('m113-t2');
  const valueGate = createValueGate(
    domain,
    'proposal-14',
    '2026-11-24T14:13:00.000Z',
    'not_provided',
  );
  const evidence = createReviewEvidence(
    domain,
    valueGate,
    'proposal-14',
    '2026-11-24T14:14:00.000Z',
  );

  const result = domain.evaluateFutureCityDistrictReviewReadiness(valueGate, evidence);

  assert.deepEqual(result.reasonCodes, [
    'entry_gate_blocked',
    'value_evidence_missing',
    'human_review_required',
  ]);
});

test('T3 review evidence accepts only exact authentic bounded pending-review values', async () => {
  const domain = await loadDomain('m113-t3-a');
  const other = await loadDomain('m113-t3-b');
  const valueGate = createValueGate(domain, 'proposal-15', '2026-11-24T14:15:00.000Z');
  const foreignGate = createValueGate(other, 'proposal-15', '2026-11-24T14:15:00.000Z');
  const valid = [
    valueGate,
    'proposal-15',
    '2026-11-24T14:16:00.000Z',
    'pending_human_decision',
    'private',
    'dormant',
  ];
  let hooks = 0;
  const hostile = new Proxy(Object.create(null), {
    get() { hooks += 1; throw new Error('must not read'); },
    getPrototypeOf() { hooks += 1; throw new Error('must not inspect'); },
    ownKeys() { hooks += 1; throw new Error('must not enumerate'); },
  });
  const invalid = [
    [0, { ...valueGate }],
    [0, Object.create(valueGate)],
    [0, foreignGate],
    [0, hostile],
    [1, 'proposal-16'],
    [1, new String('proposal-15')],
    [2, '2026-11-24T14:16:00Z'],
    [2, '2026-02-30T14:16:00.000Z'],
    [3, 'approved'],
    [3, new String('pending_human_decision')],
    [4, 'public'],
    [5, 'active'],
  ];
  for (const [index, value] of invalid) {
    const candidate = [...valid];
    candidate[index] = value;
    assert.throws(() => domain.createFutureCityDistrictReviewEvidence(...candidate), INVALID);
  }
  assert.throws(() => domain.createFutureCityDistrictReviewEvidence(), INVALID);
  assert.throws(
    () => domain.createFutureCityDistrictReviewEvidence(...valid, hostile),
    INVALID,
  );
  assert.equal(hooks, 0);
});

test('T4 evaluator rejects substitutions and hostile representations without hooks', async () => {
  const domain = await loadDomain('m113-t4-a');
  const other = await loadDomain('m113-t4-b');
  const valueGate = createValueGate(domain, 'proposal-17', '2026-11-24T14:17:00.000Z');
  const substituteGate = createValueGate(
    domain,
    'proposal-17',
    '2026-11-24T14:17:00.000Z',
  );
  const mismatchedGate = createValueGate(
    domain,
    'proposal-18',
    '2026-11-24T14:17:00.000Z',
  );
  const evidence = createReviewEvidence(
    domain,
    valueGate,
    'proposal-17',
    '2026-11-24T14:18:00.000Z',
  );
  const mismatchedEvidence = createReviewEvidence(
    domain,
    mismatchedGate,
    'proposal-18',
    '2026-11-24T14:18:00.000Z',
  );
  const foreignGate = createValueGate(other, 'proposal-17', '2026-11-24T14:17:00.000Z');
  const foreignEvidence = createReviewEvidence(
    other,
    foreignGate,
    'proposal-17',
    '2026-11-24T14:18:00.000Z',
  );
  let hooks = 0;
  const hostile = new Proxy(Object.create(null), {
    get() { hooks += 1; throw new Error('must not read'); },
    getPrototypeOf() { hooks += 1; throw new Error('must not inspect'); },
    ownKeys() { hooks += 1; throw new Error('must not enumerate'); },
  });
  const accessor = Object.create(null, {
    proposalId: { enumerable: true, get() { hooks += 1; throw new Error('must not read'); } },
  });
  const hiddenCopy = { ...evidence };
  Object.defineProperty(hiddenCopy, 'hidden', { value: true });
  const symbolCopy = { ...evidence, [Symbol('extra')]: true };
  for (const [candidateGate, candidateEvidence] of [
    [{ ...valueGate }, evidence],
    [Object.create(valueGate), evidence],
    [valueGate, { ...evidence }],
    [valueGate, Object.create(evidence)],
    [valueGate, Object.freeze({ evidence })],
    [hostile, evidence],
    [valueGate, hostile],
    [valueGate, accessor],
    [valueGate, hiddenCopy],
    [valueGate, symbolCopy],
    [foreignGate, foreignEvidence],
    [substituteGate, evidence],
    [valueGate, mismatchedEvidence],
  ]) assert.throws(
    () => domain.evaluateFutureCityDistrictReviewReadiness(candidateGate, candidateEvidence),
    INVALID,
  );
  assert.throws(() => domain.evaluateFutureCityDistrictReviewReadiness(), INVALID);
  assert.throws(
    () => domain.evaluateFutureCityDistrictReviewReadiness(valueGate, evidence, hostile),
    INVALID,
  );
  assert.equal(hooks, 0);
});

test('T5 review chronology includes equality and rejects evidence predating the value gate', async () => {
  const domain = await loadDomain('m113-t5');
  const valueGate = createValueGate(domain, 'proposal-19', '2026-11-24T14:20:00.000Z');
  const equalEvidence = createReviewEvidence(
    domain,
    valueGate,
    'proposal-19',
    '2026-11-24T14:20:00.000Z',
  );
  const olderEvidence = createReviewEvidence(
    domain,
    valueGate,
    'proposal-19',
    '2026-11-24T14:19:59.999Z',
  );

  assert.equal(
    domain.evaluateFutureCityDistrictReviewReadiness(valueGate, equalEvidence).generatedAt,
    '2026-11-24T14:20:00.000Z',
  );
  assert.throws(
    () => domain.evaluateFutureCityDistrictReviewReadiness(valueGate, olderEvidence),
    INVALID,
  );
});

test('T6 characterization: captured intrinsics keep snapshots detached under hostile globals', async () => {
  const domain = await loadDomain('m113-t6');
  const originalDefineProperty = Object.defineProperty;
  const originals = {
    create: Object.create,
    freeze: Object.freeze,
    Date: globalThis.Date,
    numberIsFinite: Number.isFinite,
    regexpTest: RegExp.prototype.test,
    weakSetAdd: WeakSet.prototype.add,
    weakSetHas: WeakSet.prototype.has,
    weakMapSet: WeakMap.prototype.set,
    weakMapGet: WeakMap.prototype.get,
  };
  const replace = (owner, key, value) => originalDefineProperty(owner, key, {
    configurable: true, value, writable: true,
  });
  let hooks = 0;
  const hostile = () => { hooks += 1; throw new Error('ambient hook'); };
  let evidence;
  let first;
  let second;
  try {
    replace(Object, 'create', hostile);
    replace(Object, 'freeze', hostile);
    replace(globalThis, 'Date', hostile);
    replace(Number, 'isFinite', hostile);
    replace(RegExp.prototype, 'test', hostile);
    replace(WeakSet.prototype, 'add', hostile);
    replace(WeakSet.prototype, 'has', hostile);
    replace(WeakMap.prototype, 'set', hostile);
    replace(WeakMap.prototype, 'get', hostile);
    const valueGate = createValueGate(
      domain,
      'proposal-20',
      '2026-11-24T14:21:00.000Z',
    );
    evidence = createReviewEvidence(
      domain,
      valueGate,
      'proposal-20',
      '2026-11-24T14:22:00.000Z',
    );
    first = domain.evaluateFutureCityDistrictReviewReadiness(valueGate, evidence);
    second = domain.evaluateFutureCityDistrictReviewReadiness(valueGate, evidence);
  } finally {
    replace(Object, 'create', originals.create);
    replace(Object, 'freeze', originals.freeze);
    replace(globalThis, 'Date', originals.Date);
    replace(Number, 'isFinite', originals.numberIsFinite);
    replace(RegExp.prototype, 'test', originals.regexpTest);
    replace(WeakSet.prototype, 'add', originals.weakSetAdd);
    replace(WeakSet.prototype, 'has', originals.weakSetHas);
    replace(WeakMap.prototype, 'set', originals.weakMapSet);
    replace(WeakMap.prototype, 'get', originals.weakMapGet);
  }
  assert.equal(hooks, 0);
  assert.notEqual(first, second);
  assert.notEqual(first.reasonCodes, second.reasonCodes);
  assert.throws(() => { evidence.proposalId = 'changed'; }, TypeError);
  assert.throws(() => { first.reasonCodes[0] = 'changed'; }, TypeError);
  assert.equal(first.proposalId, 'proposal-20');

  const valueGate = createValueGate(domain, 'proposal-20b', '2026-11-24T14:21:00.000Z');
  const setterEvidence = createReviewEvidence(
    domain,
    valueGate,
    'proposal-20b',
    '2026-11-24T14:22:00.000Z',
  );
  const originalZero = Object.getOwnPropertyDescriptor(Array.prototype, '0');
  try {
    originalDefineProperty(Array.prototype, '0', {
      configurable: true,
      set() { hooks += 1; throw new Error('numeric setter hook'); },
    });
    second = domain.evaluateFutureCityDistrictReviewReadiness(valueGate, setterEvidence);
  } finally {
    if (originalZero) originalDefineProperty(Array.prototype, '0', originalZero);
    else delete Array.prototype[0];
  }
  assert.equal(hooks, 0);
  assert.deepEqual(second.reasonCodes, ['entry_gate_blocked', 'human_review_required']);
});

test('T7 characterization: review boundary is dormant transport-neutral and unimported', async () => {
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
          || root === '../src' && path === 'domain/futureCityDistrictValueGate.ts') continue;
      const candidate = await readFile(new URL(`${root}/${path}`, import.meta.url), 'utf8');
      if (/futureCityDistrictValueGate/.test(candidate)) importers.push(`${root}/${path}`);
    }
  }
  assert.deepEqual(importers, []);
  assert.doesNotMatch(
    source,
    /\b(?:fetch|XMLHttpRequest|WebSocket|setTimeout|setInterval|process|document|window|localStorage|sessionStorage|console|eval)\b/,
  );
  assert.doesNotMatch(source, /\bnew\s+Function\b/);

  const domain = await loadDomain('m113-t7');
  const valueGate = createValueGate(domain, 'proposal-21', '2026-11-24T14:23:00.000Z');
  const result = domain.evaluateFutureCityDistrictReviewReadiness(
    valueGate,
    createReviewEvidence(
      domain,
      valueGate,
      'proposal-21',
      '2026-11-24T14:24:00.000Z',
    ),
  );
  for (const forbidden of [
    'district', 'name', 'reviewer', 'tenant', 'customer', 'decisionText', 'price',
    'credits', 'provider', 'publicCopy', 'url', 'coordinates', 'geometry', 'executable',
    'marketplace', 'navigation', 'collaborationSession', 'trainingSession', 'production',
  ]) assert.equal(forbidden in result, false, `forbidden review field: ${forbidden}`);
});
