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

function createReviewReadiness(
  domain,
  proposalId = 'proposal-22',
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
    '2026-11-25T00:10:00.000Z',
  );
  const expansionReadiness = domain.evaluateFutureCityExpansionReadiness(expansionEvidence);
  const proposal = domain.createFutureCityDistrictProposalEvidence(
    proposalId,
    '2026-11-25T00:11:00.000Z',
    'training',
    platformValueEvidence,
    'private',
    'dormant',
  );
  const valueGate = domain.evaluateFutureCityDistrictValueGate(expansionReadiness, proposal);
  const reviewEvidence = domain.createFutureCityDistrictReviewEvidence(
    valueGate,
    proposalId,
    '2026-11-25T00:12:00.000Z',
    'pending_human_decision',
    'private',
    'dormant',
  );
  return domain.evaluateFutureCityDistrictReviewReadiness(valueGate, reviewEvidence);
}

test('T1 authentic pending review yields only a frozen blocked milestone assessment', async () => {
  const domain = await loadDomain('m114-t1');
  const reviewReadiness = createReviewReadiness(domain);

  const result = domain.evaluateFutureCityMilestoneAssessment(reviewReadiness);

  assert.equal(Object.getPrototypeOf(result), null);
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.reasonCodes), true);
  assert.deepEqual(Object.keys(result), [
    'schemaVersion',
    'roadmapMilestone',
    'proposalId',
    'status',
    'districtCreationState',
    'sensitivity',
    'activationState',
    'generatedAt',
    'reasonCodes',
  ]);
  assert.deepEqual({ ...result, reasonCodes: [...result.reasonCodes] }, {
    schemaVersion: 'future-city-milestone-assessment/1',
    roadmapMilestone: 11,
    proposalId: 'proposal-22',
    status: 'blocked',
    districtCreationState: 'prohibited',
    sensitivity: 'private',
    activationState: 'dormant',
    generatedAt: '2026-11-25T00:12:00.000Z',
    reasonCodes: [
      'entry_gate_blocked',
      'human_review_required',
      'future_city_expansion_blocked',
    ],
  });
});

test('T2 missing value evidence remains in deterministic blocked reason order', async () => {
  const domain = await loadDomain('m114-t2');
  const reviewReadiness = createReviewReadiness(domain, 'proposal-23', 'not_provided');

  const result = domain.evaluateFutureCityMilestoneAssessment(reviewReadiness);

  assert.deepEqual(result.reasonCodes, [
    'entry_gate_blocked',
    'value_evidence_missing',
    'human_review_required',
    'future_city_expansion_blocked',
  ]);
  assert.equal(new Set(result.reasonCodes).size, result.reasonCodes.length);
});

test('T3 milestone assessment requires exactly one argument', async () => {
  const domain = await loadDomain('m114-t3');
  const reviewReadiness = createReviewReadiness(domain, 'proposal-24');

  assert.throws(() => domain.evaluateFutureCityMilestoneAssessment(), INVALID);
  assert.throws(
    () => domain.evaluateFutureCityMilestoneAssessment(reviewReadiness, 'extra'),
    INVALID,
  );
});

test('T4 characterization: only exact same-module authentic review readiness is accepted', async () => {
  const domain = await loadDomain('m114-t4-a');
  const other = await loadDomain('m114-t4-b');
  const authentic = createReviewReadiness(domain, 'proposal-25');
  const foreign = createReviewReadiness(other, 'proposal-25');
  let hooks = 0;
  const hostile = new Proxy(authentic, {
    get() { hooks += 1; throw new Error('must not read'); },
    getPrototypeOf() { hooks += 1; throw new Error('must not inspect'); },
    ownKeys() { hooks += 1; throw new Error('must not enumerate'); },
  });
  const accessor = Object.create(null, {
    proposalId: { enumerable: true, get() { hooks += 1; throw new Error('must not read'); } },
  });
  const hiddenCopy = { ...authentic };
  Object.defineProperty(hiddenCopy, 'hidden', { value: true });
  const symbolCopy = { ...authentic, [Symbol('extra')]: true };
  for (const candidate of [
    { ...authentic },
    Object.create(authentic),
    Object.freeze({ reviewReadiness: authentic }),
    hostile,
    accessor,
    hiddenCopy,
    symbolCopy,
    foreign,
    'coercible',
    null,
  ]) assert.throws(
    () => domain.evaluateFutureCityMilestoneAssessment(candidate),
    INVALID,
  );
  assert.equal(hooks, 0);
});

test('T5 characterization: successful assessments are fresh detached frozen snapshots', async () => {
  const domain = await loadDomain('m114-t5');
  const reviewReadiness = createReviewReadiness(domain, 'proposal-26', 'not_provided');
  const originalDefineProperty = Object.defineProperty;
  const originals = {
    create: Object.create,
    freeze: Object.freeze,
    weakSetHas: WeakSet.prototype.has,
  };
  const replace = (owner, key, value) => originalDefineProperty(owner, key, {
    configurable: true, value, writable: true,
  });
  let hooks = 0;
  const hostile = () => { hooks += 1; throw new Error('ambient hook'); };
  let first;
  let second;
  try {
    replace(Object, 'create', hostile);
    replace(Object, 'freeze', hostile);
    replace(WeakSet.prototype, 'has', hostile);
    first = domain.evaluateFutureCityMilestoneAssessment(reviewReadiness);
    second = domain.evaluateFutureCityMilestoneAssessment(reviewReadiness);
  } finally {
    replace(Object, 'create', originals.create);
    replace(Object, 'freeze', originals.freeze);
    replace(WeakSet.prototype, 'has', originals.weakSetHas);
  }
  assert.equal(hooks, 0);
  assert.notEqual(first, second);
  assert.notEqual(first.reasonCodes, second.reasonCodes);
  assert.throws(() => { first.proposalId = 'changed'; }, TypeError);
  assert.throws(() => { first.reasonCodes[0] = 'changed'; }, TypeError);
  assert.equal(second.proposalId, 'proposal-26');
  assert.deepEqual(second.reasonCodes, [
    'entry_gate_blocked',
    'value_evidence_missing',
    'human_review_required',
    'future_city_expansion_blocked',
  ]);
});

test('T6 characterization: milestone assessment stays dormant transport-neutral and unimported', async () => {
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

  const domain = await loadDomain('m114-t6');
  const result = domain.evaluateFutureCityMilestoneAssessment(
    createReviewReadiness(domain, 'proposal-27'),
  );
  for (const forbidden of [
    'district', 'reviewState', 'reviewer', 'humanDecision', 'approved', 'milestone9',
    'tenant', 'customer', 'price', 'credits', 'provider', 'publicCopy', 'route', 'url',
    'coordinates', 'geometry', 'marketplace', 'navigation', 'collaborationSession',
    'trainingSession', 'payment', 'deployment', 'production',
  ]) assert.equal(forbidden in result, false, `forbidden assessment field: ${forbidden}`);
});
