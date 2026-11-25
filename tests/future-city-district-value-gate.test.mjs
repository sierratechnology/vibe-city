import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import test from 'node:test';

const MODULE_URL = new URL('../src/domain/futureCityDistrictValueGate.ts', import.meta.url);
const INVALID = {
  name: 'TypeError',
  message: 'Invalid Future City district value gate input',
};

async function loadDomain(tag) {
  try {
    return await import(`${MODULE_URL.href}?${tag}`);
  } catch (error) {
    if (error?.code === 'ENOENT') return {};
    throw error;
  }
}

function createReadiness(domain, generatedAt = '2026-11-24T14:00:00.000Z') {
  const evidence = domain.createFutureCityExpansionGateEvidence(
    'reviewed_working',
    'reviewed_working',
    'reviewed_working',
    'reviewed_working',
    'reviewed_working',
    'reviewed_working',
    'reviewed_working',
    'blocked_pending_human_decisions',
    generatedAt,
  );
  return domain.evaluateFutureCityExpansionReadiness(evidence);
}

test('T1 reviewed value evidence yields the minimal frozen blocked district gate record', async () => {
  const domain = await loadDomain('t1');
  assert.equal(typeof domain.createFutureCityDistrictProposalEvidence, 'function');
  assert.equal(typeof domain.evaluateFutureCityDistrictValueGate, 'function');
  const readiness = createReadiness(domain);
  const evidence = domain.createFutureCityDistrictProposalEvidence(
    'proposal-7',
    '2026-11-24T14:01:00.000Z',
    'training',
    'reviewed_value',
    'private',
    'dormant',
  );

  const result = domain.evaluateFutureCityDistrictValueGate(readiness, evidence);

  assert.equal(Object.getPrototypeOf(result), null);
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.reasonCodes), true);
  assert.deepEqual(Object.keys(result), [
    'proposalId', 'status', 'sensitivity', 'activationState', 'generatedAt', 'reasonCodes',
  ]);
  assert.deepEqual({ ...result, reasonCodes: [...result.reasonCodes] }, {
    proposalId: 'proposal-7',
    status: 'blocked',
    sensitivity: 'private',
    activationState: 'dormant',
    generatedAt: '2026-11-24T14:01:00.000Z',
    reasonCodes: ['entry_gate_blocked'],
  });
});

test('T2 missing value evidence adds only the ordered missing-value reason', async () => {
  const domain = await loadDomain('t2');
  const readiness = createReadiness(domain, '2026-11-24T14:02:00.000Z');
  const evidence = domain.createFutureCityDistrictProposalEvidence(
    'proposal-8',
    '2026-11-24T14:03:00.000Z',
    'service_access',
    'not_provided',
    'private',
    'dormant',
  );

  const result = domain.evaluateFutureCityDistrictValueGate(readiness, evidence);

  assert.equal(result.status, 'blocked');
  assert.deepEqual(result.reasonCodes, ['entry_gate_blocked', 'value_evidence_missing']);
});

test('T3 proposal evidence rejects noncanonical or unsupported values with one generic error', async () => {
  const domain = await loadDomain('t3');
  const valid = [
    'proposal-9',
    '2026-11-24T14:04:00.000Z',
    'collaboration',
    'reviewed_value',
    'private',
    'dormant',
  ];
  const invalid = [
    [0, ''],
    [0, 'Proposal 9'],
    [0, 'a'.repeat(65)],
    [0, new String('proposal-9')],
    [1, '2026-11-24T14:04:00Z'],
    [1, '2026-02-30T14:04:00.000Z'],
    [2, 'marketplace'],
    [2, true],
    [3, 'working'],
    [3, new String('reviewed_value')],
    [4, 'public'],
    [5, 'active'],
  ];
  for (const [index, value] of invalid) {
    const candidate = [...valid];
    candidate[index] = value;
    assert.throws(() => domain.createFutureCityDistrictProposalEvidence(...candidate), INVALID);
  }
  assert.throws(() => domain.createFutureCityDistrictProposalEvidence(), INVALID);
  assert.throws(
    () => domain.createFutureCityDistrictProposalEvidence(...valid, 'extra'),
    INVALID,
  );
});

test('T4 evaluator accepts only same-module branded exact inputs without attacker hooks', async () => {
  const domain = await loadDomain('t4-a');
  const other = await loadDomain('t4-b');
  const readiness = createReadiness(domain, '2026-11-24T14:05:00.000Z');
  const evidence = domain.createFutureCityDistrictProposalEvidence(
    'proposal-10',
    '2026-11-24T14:06:00.000Z',
    'convention',
    'reviewed_value',
    'private',
    'dormant',
  );
  let hooks = 0;
  const hostile = new Proxy(Object.create(null), {
    get() { hooks += 1; throw new Error('must not read'); },
    getPrototypeOf() { hooks += 1; throw new Error('must not inspect'); },
    ownKeys() { hooks += 1; throw new Error('must not enumerate'); },
  });
  for (const [candidateReadiness, candidateEvidence] of [
    [{ ...readiness }, evidence],
    [readiness, { ...evidence }],
    [Object.create(readiness), evidence],
    [readiness, Object.freeze({ evidence })],
    [hostile, evidence],
    [readiness, hostile],
    [other.evaluateFutureCityExpansionReadiness(
      other.createFutureCityExpansionGateEvidence(
        'reviewed_working', 'reviewed_working', 'reviewed_working', 'reviewed_working',
        'reviewed_working', 'reviewed_working', 'reviewed_working',
        'blocked_pending_human_decisions', '2026-11-24T14:05:00.000Z',
      ),
    ), evidence],
  ]) assert.throws(
    () => domain.evaluateFutureCityDistrictValueGate(candidateReadiness, candidateEvidence),
    INVALID,
  );
  assert.throws(() => domain.evaluateFutureCityDistrictValueGate(), INVALID);
  assert.throws(
    () => domain.evaluateFutureCityDistrictValueGate(readiness, evidence, hostile),
    INVALID,
  );
  assert.throws(() => domain.evaluateFutureCityExpansionReadiness(), INVALID);
  assert.equal(hooks, 0);
});

test('T5 captured intrinsics preserve detached frozen snapshots without ambient hooks', async () => {
  const domain = await loadDomain('t5');
  const originalDefineProperty = Object.defineProperty;
  const originals = {
    create: Object.create,
    assign: Object.assign,
    freeze: Object.freeze,
    Date: globalThis.Date,
    numberIsFinite: Number.isFinite,
    regexpTest: RegExp.prototype.test,
    weakSetAdd: WeakSet.prototype.add,
    weakSetHas: WeakSet.prototype.has,
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
    replace(Object, 'assign', hostile);
    replace(Object, 'freeze', hostile);
    replace(globalThis, 'Date', hostile);
    replace(Number, 'isFinite', hostile);
    replace(RegExp.prototype, 'test', hostile);
    replace(WeakSet.prototype, 'add', hostile);
    replace(WeakSet.prototype, 'has', hostile);
    const readiness = createReadiness(domain, '2026-11-24T14:07:00.000Z');
    evidence = domain.createFutureCityDistrictProposalEvidence(
      'proposal-11', '2026-11-24T14:08:00.000Z',
      'training', 'reviewed_value', 'private', 'dormant',
    );
    first = domain.evaluateFutureCityDistrictValueGate(readiness, evidence);
    second = domain.evaluateFutureCityDistrictValueGate(readiness, evidence);
  } finally {
    replace(Object, 'create', originals.create);
    replace(Object, 'assign', originals.assign);
    replace(Object, 'freeze', originals.freeze);
    replace(globalThis, 'Date', originals.Date);
    replace(Number, 'isFinite', originals.numberIsFinite);
    replace(RegExp.prototype, 'test', originals.regexpTest);
    replace(WeakSet.prototype, 'add', originals.weakSetAdd);
    replace(WeakSet.prototype, 'has', originals.weakSetHas);
  }
  assert.equal(hooks, 0);
  assert.equal(Object.getPrototypeOf(evidence), null);
  assert.equal(Object.isFrozen(evidence), true);
  assert.deepEqual(Object.keys(evidence), [
    'proposalId', 'generatedAt', 'purpose', 'platformValueEvidence',
    'sensitivity', 'activationState',
  ]);
  assert.notEqual(first, second);
  assert.notEqual(first.reasonCodes, second.reasonCodes);
  assert.throws(() => { evidence.proposalId = 'changed'; }, TypeError);
  assert.throws(() => { first.reasonCodes[0] = 'changed'; }, TypeError);
});

test('T6 characterization: boundary is dormant transport-neutral and has no runtime importer', async () => {
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
  assert.doesNotMatch(source, /\b(?:fetch|XMLHttpRequest|WebSocket|setTimeout|setInterval|process|document|window|localStorage|sessionStorage|console|eval)\b/);
  assert.doesNotMatch(source, /\bnew\s+Function\b/);

  const domain = await loadDomain('t6');
  const result = domain.evaluateFutureCityDistrictValueGate(
    createReadiness(domain, '2026-11-24T14:09:00.000Z'),
    domain.createFutureCityDistrictProposalEvidence(
      'proposal-12', '2026-11-24T14:10:00.000Z',
      'training', 'reviewed_value', 'private', 'dormant',
    ),
  );
  for (const forbidden of [
    'district', 'name', 'tenant', 'customer', 'price', 'credits', 'provider',
    'publicCopy', 'url', 'coordinates', 'geometry', 'marketplace', 'navigation',
    'collaborationSession', 'trainingSession', 'production',
  ]) assert.equal(forbidden in result, false, `forbidden gate field: ${forbidden}`);
});
