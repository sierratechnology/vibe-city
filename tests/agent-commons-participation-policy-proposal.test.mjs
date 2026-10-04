import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import test from 'node:test';

import { createManagedCustomerIdentityDomain } from '../server/managedCustomerIdentityDomain.mjs';

const MODULE_PATH = '../server/agentCommonsParticipationPolicyProposal.mjs';
const ACCOUNT_ID = 'account_0000000000000001';
const ORGANIZATION_ID = 'organization_0000000000000002';
const TENANT_ID = 'tenant_0000000000000002';
const PROPOSAL_ID = 'proposal_0000000000000003';
const INVALID = { name: 'TypeError', message: 'Invalid Agent Commons participation policy proposal input' };

async function loadDomain() {
  return import(MODULE_PATH).catch(() => ({}));
}

function identityInput() {
  return {
    schemaVersion: 'managed-customer-identity/1',
    account: {
      accountId: ACCOUNT_ID,
      displayLabel: 'Synthetic Account',
      lifecycle: 'active',
    },
    organization: {
      organizationId: ORGANIZATION_ID,
      displayLabel: 'Synthetic Organization',
      lifecycle: 'active',
    },
    membership: {
      accountId: ACCOUNT_ID,
      organizationId: ORGANIZATION_ID,
      roleLabel: 'member',
      lifecycle: 'active',
    },
  };
}

function authenticIdentity() {
  return createManagedCustomerIdentityDomain(identityInput());
}

function proposalInput(overrides = {}) {
  return {
    schemaVersion: 'agent-commons-participation-policy-proposal/1',
    proposalId: PROPOSAL_ID,
    participationMode: 'enabled',
    quietHours: {
      mode: 'disabled',
      startMinuteUtc: null,
      endMinuteUtc: null,
    },
    proposedAt: '2026-10-04T12:00:00.000Z',
    recordedAt: '2026-10-04T12:00:00.000Z',
    ...overrides,
  };
}

test('T1 creates the exact detached disabled-quiet-hours proposal for an authentic identity', async () => {
  const domain = await loadDomain();
  assert.equal(typeof domain.createAgentCommonsParticipationPolicyProposal, 'function');
  const proposal = domain.createAgentCommonsParticipationPolicyProposal(
    authenticIdentity(), proposalInput(),
  );

  assert.equal(Object.getPrototypeOf(proposal), null);
  assert.deepEqual(Object.keys(proposal), [
    'schemaVersion', 'proposalId', 'tenantId', 'accountId', 'participationMode',
    'quietHours', 'costPolicy', 'interruptionPolicy', 'authorizationStatus',
    'proposedAt', 'recordedAt',
  ]);
  assert.deepEqual({ ...proposal, quietHours: { ...proposal.quietHours } }, {
    schemaVersion: 'agent-commons-participation-policy-proposal/1',
    proposalId: PROPOSAL_ID,
    tenantId: TENANT_ID,
    accountId: ACCOUNT_ID,
    participationMode: 'enabled',
    quietHours: {
      mode: 'disabled',
      startMinuteUtc: null,
      endMinuteUtc: null,
    },
    costPolicy: 'no_incremental_spend',
    interruptionPolicy: 'return_to_assigned_state',
    authorizationStatus: 'proposed_not_authorized',
    proposedAt: '2026-10-04T12:00:00.000Z',
    recordedAt: '2026-10-04T12:00:00.000Z',
  });
});

test('T2 characterization: only an exact same-module managed identity has provenance', async () => {
  const domain = await loadDomain();
  const identity = authenticIdentity();
  const foreignIdentityModule = await import(`../server/managedCustomerIdentityDomain.mjs?foreign=${Date.now()}`);
  const foreignIdentity = foreignIdentityModule.createManagedCustomerIdentityDomain(identityInput());
  let hooks = 0;
  const proxy = new Proxy(identity, {
    get() { hooks += 1; throw new Error('must not read'); },
    getPrototypeOf() { hooks += 1; throw new Error('must not inspect'); },
    ownKeys() { hooks += 1; throw new Error('must not enumerate'); },
  });
  for (const candidate of [
    null,
    { ...identity },
    JSON.parse(JSON.stringify(identity)),
    Object.create(identity),
    proxy,
    foreignIdentity,
  ]) {
    assert.throws(
      () => domain.createAgentCommonsParticipationPolicyProposal(candidate, proposalInput()),
      INVALID,
    );
  }
  assert.equal(hooks, 0);
});

test('T3 preserves enabled and paused meanings and rejects all other modes', async () => {
  const domain = await loadDomain();
  const identity = authenticIdentity();
  for (const participationMode of ['enabled', 'paused']) {
    const proposal = domain.createAgentCommonsParticipationPolicyProposal(
      identity, proposalInput({ participationMode }),
    );
    assert.equal(proposal.participationMode, participationMode);
  }
  for (const participationMode of ['active', 'enabled_or_paused', null, new String('enabled')]) {
    assert.throws(
      () => domain.createAgentCommonsParticipationPolicyProposal(
        identity, proposalInput({ participationMode }),
      ),
      INVALID,
    );
  }
});

test('T4 accepts one bounded nonzero daily UTC quiet-hours window', async () => {
  const domain = await loadDomain();
  const identity = authenticIdentity();
  for (const quietHours of [
    { mode: 'daily_utc', startMinuteUtc: 0, endMinuteUtc: 1439 },
    { mode: 'daily_utc', startMinuteUtc: 1380, endMinuteUtc: 420 },
  ]) {
    assert.deepEqual(
      { ...domain.createAgentCommonsParticipationPolicyProposal(
        identity, proposalInput({ quietHours }),
      ).quietHours },
      quietHours,
    );
  }
  for (const quietHours of [
    { mode: 'disabled', startMinuteUtc: 0, endMinuteUtc: null },
    { mode: 'daily_utc', startMinuteUtc: null, endMinuteUtc: 1 },
    { mode: 'daily_utc', startMinuteUtc: -0, endMinuteUtc: 1 },
    { mode: 'daily_utc', startMinuteUtc: 0.5, endMinuteUtc: 1 },
    { mode: 'daily_utc', startMinuteUtc: 0, endMinuteUtc: 1440 },
    { mode: 'daily_utc', startMinuteUtc: 1, endMinuteUtc: 1 },
    { mode: 'daily_utc', startMinuteUtc: NaN, endMinuteUtc: 1 },
    { mode: 'daily_utc', startMinuteUtc: 0, endMinuteUtc: Infinity },
    { mode: 'sometimes', startMinuteUtc: null, endMinuteUtc: null },
  ]) {
    assert.throws(
      () => domain.createAgentCommonsParticipationPolicyProposal(
        identity, proposalInput({ quietHours }),
      ),
      INVALID,
    );
  }
});

test('T5 accepts only canonical bounded opaque proposal IDs', async () => {
  const domain = await loadDomain();
  const identity = authenticIdentity();
  for (const proposalId of [`proposal_${'0'.repeat(16)}`, `proposal_${'abcdef0123456789'.repeat(4)}`]) {
    assert.equal(domain.createAgentCommonsParticipationPolicyProposal(
      identity, proposalInput({ proposalId }),
    ).proposalId, proposalId);
  }
  for (const proposalId of [
    `proposal_${'0'.repeat(15)}`,
    `proposal_${'0'.repeat(65)}`,
    'proposal_000000000000000G',
    'proposal_000000000000000-1',
    'id_0000000000000001',
    null,
    new String(PROPOSAL_ID),
  ]) {
    assert.throws(
      () => domain.createAgentCommonsParticipationPolicyProposal(
        identity, proposalInput({ proposalId }),
      ),
      INVALID,
    );
  }
});

test('T6 accepts canonical UTC timestamps with recordedAt at or after proposedAt', async () => {
  const domain = await loadDomain();
  const identity = authenticIdentity();
  const later = domain.createAgentCommonsParticipationPolicyProposal(identity, proposalInput({
    proposedAt: '2024-02-29T23:59:59.999Z',
    recordedAt: '2024-03-01T00:00:00.000Z',
  }));
  assert.deepEqual([later.proposedAt, later.recordedAt], [
    '2024-02-29T23:59:59.999Z', '2024-03-01T00:00:00.000Z',
  ]);
  for (const overrides of [
    { proposedAt: '2026-10-04T12:00:00Z' },
    { proposedAt: '2026-02-29T12:00:00.000Z' },
    { proposedAt: '2026-13-01T12:00:00.000Z' },
    { proposedAt: '2026-10-04t12:00:00.000Z' },
    { proposedAt: new String('2026-10-04T12:00:00.000Z') },
    { recordedAt: '2026-10-04T11:59:59.999Z' },
    { recordedAt: null },
  ]) {
    assert.throws(
      () => domain.createAgentCommonsParticipationPolicyProposal(
        identity, proposalInput(overrides),
      ),
      INVALID,
    );
  }
});

test('T7 accepts only exact closed ordinary or null-prototype proposal schemas', async () => {
  const domain = await loadDomain();
  const identity = authenticIdentity();
  const nullProposal = Object.assign(Object.create(null), proposalInput({
    quietHours: Object.assign(Object.create(null), {
      mode: 'disabled', startMinuteUtc: null, endMinuteUtc: null,
    }),
  }));
  assert.equal(domain.createAgentCommonsParticipationPolicyProposal(
    identity, nullProposal,
  ).proposalId, PROPOSAL_ID);

  const extra = proposalInput();
  extra.tenantId = TENANT_ID;
  const missing = proposalInput();
  delete missing.schemaVersion;
  const quietExtra = proposalInput();
  quietExtra.quietHours.authority = 'approved';
  const quietMissing = proposalInput();
  delete quietMissing.quietHours.endMinuteUtc;
  const wrongSchema = proposalInput({ schemaVersion: 'agent-commons-participation-policy-proposal/2' });
  const symbolic = proposalInput();
  symbolic[Symbol('hidden')] = true;
  const quietSymbolic = proposalInput();
  quietSymbolic.quietHours[Symbol('hidden')] = true;
  const inherited = Object.assign(Object.create({ inherited: true }), proposalInput());
  const quietInherited = proposalInput({ quietHours: Object.assign(
    Object.create({ inherited: true }), proposalInput().quietHours,
  ) });
  const nonEnumerable = proposalInput();
  Object.defineProperty(nonEnumerable, 'schemaVersion', {
    value: nonEnumerable.schemaVersion,
    enumerable: false,
  });
  for (const candidate of [
    extra, missing, quietExtra, quietMissing, wrongSchema, symbolic, quietSymbolic,
    inherited, quietInherited, nonEnumerable, [], null,
  ]) {
    assert.throws(
      () => domain.createAgentCommonsParticipationPolicyProposal(identity, candidate),
      INVALID,
    );
  }
});

test('T8 has exact arity two and rejects missing or extra arguments before hostile values', async () => {
  const domain = await loadDomain();
  const factory = domain.createAgentCommonsParticipationPolicyProposal;
  assert.equal(factory.length, 2);
  let hooks = 0;
  const hostile = new Proxy(Object.create(null), {
    get() { hooks += 1; throw new Error('must not read'); },
    getPrototypeOf() { hooks += 1; throw new Error('must not inspect'); },
    ownKeys() { hooks += 1; throw new Error('must not enumerate'); },
  });
  assert.throws(() => factory(), INVALID);
  assert.throws(() => factory(authenticIdentity()), INVALID);
  assert.throws(
    () => factory(authenticIdentity(), proposalInput(), hostile),
    INVALID,
  );
  assert.equal(hooks, 0);
});

test('T9 characterization: hostile proposal data fails generically with zero attacker hooks', async () => {
  const domain = await loadDomain();
  const identity = authenticIdentity();
  let hooks = 0;
  const accessor = proposalInput();
  Object.defineProperty(accessor, 'proposalId', {
    enumerable: true,
    get() { hooks += 1; return PROPOSAL_ID; },
  });
  const quietAccessor = proposalInput();
  Object.defineProperty(quietAccessor.quietHours, 'mode', {
    enumerable: true,
    get() { hooks += 1; return 'disabled'; },
  });
  const proxy = new Proxy(proposalInput(), {
    get() { hooks += 1; throw new Error('must not read'); },
    getPrototypeOf() { hooks += 1; throw new Error('must not inspect'); },
    ownKeys() { hooks += 1; throw new Error('must not enumerate'); },
  });
  const quietProxy = proposalInput({ quietHours: new Proxy(proposalInput().quietHours, {
    get() { hooks += 1; throw new Error('must not read'); },
    getPrototypeOf() { hooks += 1; throw new Error('must not inspect'); },
    ownKeys() { hooks += 1; throw new Error('must not enumerate'); },
  }) });
  const coercible = Object.freeze({
    toString() { hooks += 1; return PROPOSAL_ID; },
    valueOf() { hooks += 1; return 0; },
  });
  for (const candidate of [
    accessor,
    quietAccessor,
    proxy,
    quietProxy,
    proposalInput({ schemaVersion: coercible }),
    proposalInput({ proposalId: coercible }),
    proposalInput({ participationMode: coercible }),
    proposalInput({ proposedAt: coercible }),
    proposalInput({ recordedAt: coercible }),
    proposalInput({ quietHours: {
      mode: 'daily_utc', startMinuteUtc: coercible, endMinuteUtc: 1,
    } }),
  ]) {
    assert.throws(
      () => domain.createAgentCommonsParticipationPolicyProposal(identity, candidate),
      INVALID,
    );
  }
  assert.equal(hooks, 0);
});

test('T10 captured intrinsics resist post-import ambient replacement with zero hooks', async () => {
  const domain = await loadDomain();
  const identity = authenticIdentity();
  const NativeTypeError = globalThis.TypeError;
  const replacements = [
    [Object, 'create'],
    [Object, 'freeze'],
    [Object, 'is'],
    [Object, 'getOwnPropertyDescriptor'],
    [Object, 'getPrototypeOf'],
    [Reflect, 'ownKeys'],
    [Number, 'isInteger'],
    [String.prototype, 'charCodeAt'],
    [String.prototype, 'slice'],
  ];
  for (let index = 0; index < replacements.length; index += 1) {
    replacements[index][2] = replacements[index][0][replacements[index][1]];
  }
  let hooks = 0;
  const hostile = () => { hooks += 1; throw new Error('ambient hook ran'); };
  let proposal;
  let denial;
  try {
    globalThis.TypeError = function HostileTypeError() { hooks += 1; return new Error('wrong'); };
    for (let index = 0; index < replacements.length; index += 1) {
      replacements[index][0][replacements[index][1]] = hostile;
    }
    proposal = domain.createAgentCommonsParticipationPolicyProposal(identity, proposalInput({
      proposalId: 'proposal_abcdef0123456789',
      quietHours: { mode: 'daily_utc', startMinuteUtc: 1380, endMinuteUtc: 420 },
    }));
    try {
      domain.createAgentCommonsParticipationPolicyProposal(identity, proposalInput({
        proposalId: 'not-canonical',
      }));
    } catch (error) {
      denial = error;
    }
  } finally {
    for (let index = 0; index < replacements.length; index += 1) {
      replacements[index][0][replacements[index][1]] = replacements[index][2];
    }
    globalThis.TypeError = NativeTypeError;
  }
  assert.equal(hooks, 0);
  assert.equal(proposal.proposalId, 'proposal_abcdef0123456789');
  assert.equal(Object.getPrototypeOf(denial), NativeTypeError.prototype);
  assert.equal(denial.message, INVALID.message);
});

test('T11 characterization: output is detached null-prototype and recursively frozen', async () => {
  const domain = await loadDomain();
  const input = proposalInput({
    quietHours: { mode: 'daily_utc', startMinuteUtc: 1380, endMinuteUtc: 420 },
  });
  const proposal = domain.createAgentCommonsParticipationPolicyProposal(
    authenticIdentity(), input,
  );
  assert.notEqual(proposal, input);
  assert.notEqual(proposal.quietHours, input.quietHours);
  assert.equal(Object.getPrototypeOf(proposal), null);
  assert.equal(Object.getPrototypeOf(proposal.quietHours), null);
  assert.equal(Object.isFrozen(proposal), true);
  assert.equal(Object.isFrozen(proposal.quietHours), true);
  input.proposalId = 'proposal_ffffffffffffffff';
  input.quietHours.startMinuteUtc = 0;
  assert.equal(proposal.proposalId, PROPOSAL_ID);
  assert.equal(proposal.quietHours.startMinuteUtc, 1380);
});

test('T12 characterization: proposal remains dormant private data without authority or runtime claims', async () => {
  const domain = await loadDomain();
  assert.deepEqual(Object.keys(domain), ['createAgentCommonsParticipationPolicyProposal']);
  const proposal = domain.createAgentCommonsParticipationPolicyProposal(
    authenticIdentity(), proposalInput(),
  );
  assert.equal(proposal.authorizationStatus, 'proposed_not_authorized');
  for (const forbidden of [
    'approved', 'active', 'runtimeActive', 'attendance', 'friendship', 'productivity',
    'workState', 'quietHoursEnforced', 'spendingPermission', 'providerState',
    'credential', 'email', 'legalName', 'customerData', 'repositoryData', 'taskData',
    'price', 'balance', 'payment', 'providerIdentity', 'endpoint',
  ]) assert.equal(forbidden in proposal, false, `forbidden proposal field: ${forbidden}`);
  for (const value of Object.values(proposal)) assert.notEqual(typeof value, 'function');

  const moduleUrl = new URL('../server/agentCommonsParticipationPolicyProposal.mjs', import.meta.url);
  const source = await readFile(moduleUrl, 'utf8');
  const imports = Array.from(source.matchAll(/\bfrom\s+['"]([^'"]+)['"];?/g), (match) => match[1]);
  assert.deepEqual(imports, [
    './managedCustomerIdentityDomain.mjs',
    'node:util/types',
  ]);
  const importers = [];
  for (const root of ['../server', '../src']) {
    const paths = await readdir(new URL(root, import.meta.url), { recursive: true });
    for (const path of paths) {
      if (!/\.(?:ts|tsx|js|jsx|mjs|cjs)$/.test(path)
          || root === '../server' && path === 'agentCommonsParticipationPolicyProposal.mjs') continue;
      const candidate = await readFile(new URL(`${root}/${path}`, import.meta.url), 'utf8');
      if (/agentCommonsParticipationPolicyProposal/.test(candidate)) importers.push(`${root}/${path}`);
    }
  }
  assert.deepEqual(importers, []);
  assert.doesNotMatch(source, /\b(?:fetch|XMLHttpRequest|WebSocket|setTimeout|setInterval|process|document|window|localStorage|sessionStorage|console|eval)\b/);
  assert.doesNotMatch(source, /\bnew\s+Function\b/);
  assert.doesNotMatch(source, /(?:route|database|storage|payment|price|balance|attendance|friendship|productivity)/i);
});
