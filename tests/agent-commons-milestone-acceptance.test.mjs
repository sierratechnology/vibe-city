import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

import { createManagedCustomerIdentityDomain } from '../server/managedCustomerIdentityDomain.mjs';
import { createAgentCommonsParticipationPolicyProposal } from '../server/agentCommonsParticipationPolicyProposal.mjs';
import {
  createAgentCommonsActivationReadiness,
  createAgentCommonsActivityDefinition,
  createAgentCommonsAdmissionReadiness,
  createAgentCommonsSharedSpaceDefinition,
} from '../src/domain/agentCommonsSharedSpace.ts';

const MODULE_URL = new URL('../src/domain/agentCommonsMilestoneAcceptance.ts', import.meta.url);
const PRESENCE_URL = new URL('../src/domain/hostedAgentPresence.ts', import.meta.url);
const PARTICIPATION_URL = new URL('../src/domain/agentCommonsParticipation.ts', import.meta.url);
const SHARED_SPACE_URL = new URL('../src/domain/agentCommonsSharedSpace.ts', import.meta.url);
const INVALID = {
  name: 'TypeError',
  message: 'Invalid Agent Commons milestone acceptance input',
};

async function loadAcceptance(tag) {
  const options = {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  };
  const presenceOutput = ts.transpileModule(await readFile(PRESENCE_URL, 'utf8'), options).outputText;
  const presenceSpecifier = `data:text/javascript;base64,${Buffer.from(presenceOutput).toString('base64')}#presence-${tag}`;
  const participationOutput = ts.transpileModule(
    await readFile(PARTICIPATION_URL, 'utf8'), options,
  ).outputText.replace(
    /['"]\.\/hostedAgentPresence['"]/,
    JSON.stringify(presenceSpecifier),
  );
  const participationSpecifier = `data:text/javascript;base64,${Buffer.from(participationOutput).toString('base64')}#participation-${tag}`;
  const [presence, participation] = await Promise.all([
    import(presenceSpecifier), import(participationSpecifier),
  ]);
  try {
    const source = await readFile(MODULE_URL, 'utf8');
    const output = ts.transpileModule(source, options).outputText
      .replace(/['"]\.\/hostedAgentPresence['"]/, JSON.stringify(presenceSpecifier))
      .replace(/['"]\.\/agentCommons(?:Participation|\\u0050articipation)['"]/, JSON.stringify(participationSpecifier))
      .replace(/['"]\.\/agentCommons(?:SharedSpace|\\u0053haredSpace)['"]/, JSON.stringify(SHARED_SPACE_URL.href));
    const acceptance = await import(
      `data:text/javascript;base64,${Buffer.from(output).toString('base64')}#acceptance-${tag}`
    );
    return { ...presence, ...participation, ...acceptance };
  } catch (error) {
    if (error?.code === 'ENOENT') return { ...presence, ...participation };
    throw error;
  }
}

function createLineage(domain, overrides = {}) {
  const accountSuffix = overrides.accountSuffix ?? '0000000000000001';
  const organizationSuffix = overrides.organizationSuffix ?? '0000000000000002';
  const mapping = domain.createReviewedHostedIdentityMapping({
    tenantId: `id_${organizationSuffix}`,
    subjectId: `id_${accountSuffix}`,
    identityId: 'stg-spiders',
    displayName: 'Spiders',
    profileName: 'spiders',
    registryRevision: 7,
    synchronizedAt: '2026-10-05T11:55:00.000Z',
    status: 'active',
    roleLabel: 'Chief Agent',
    workplaceLabel: 'Chief Agent Office',
    skills: ['project-coordination'],
    permissions: [],
    actionAuthorities: [],
  });
  const draft = (lifecycle, endedAt, recordedAt) => domain.createAgentCommonsParticipationDraft(
    mapping,
    'id_3333333333333333',
    overrides.participationActivityKind ?? overrides.activityKind ?? 'creative',
    lifecycle,
    '2026-10-05T12:02:00.000Z',
    endedAt,
    recordedAt,
  );
  const active = domain.createAgentCommonsParticipation(
    mapping,
    draft('active', null, '2026-10-05T12:02:00.000Z'),
  );
  const ended = domain.createAgentCommonsParticipation(
    mapping,
    draft('ended', '2026-10-05T12:03:00.000Z', '2026-10-05T12:03:00.000Z'),
  );
  const identity = createManagedCustomerIdentityDomain({
    schemaVersion: 'managed-customer-identity/1',
    account: {
      accountId: `account_${accountSuffix}`,
      displayLabel: 'Synthetic Account',
      lifecycle: 'active',
    },
    organization: {
      organizationId: `organization_${organizationSuffix}`,
      displayLabel: 'Synthetic Organization',
      lifecycle: 'active',
    },
    membership: {
      accountId: `account_${accountSuffix}`,
      organizationId: `organization_${organizationSuffix}`,
      roleLabel: 'member',
      lifecycle: 'active',
    },
  });
  const space = createAgentCommonsSharedSpaceDefinition(identity, {
    schemaVersion: 'agent-commons-shared-space/1',
    spaceId: 'space_0000000000000003',
    displayName: 'Agent Commons',
    purpose: 'voluntary_social_creative_recreation',
    definedAt: '2026-10-05T12:00:00.000Z',
    recordedAt: '2026-10-05T12:00:00.000Z',
  });
  const activity = createAgentCommonsActivityDefinition(space, {
    schemaVersion: 'agent-commons-activity-definition/1',
    activityId: 'activity_0000000000000004',
    activityKind: overrides.activityKind ?? 'creative',
    definedAt: '2026-10-05T12:01:00.000Z',
    recordedAt: '2026-10-05T12:01:00.000Z',
  });
  const proposal = createAgentCommonsParticipationPolicyProposal(identity, {
    schemaVersion: 'agent-commons-participation-policy-proposal/1',
    proposalId: 'proposal_0000000000000005',
    participationMode: 'enabled',
    quietHours: overrides.quietHours ?? {
      mode: 'daily_utc', startMinuteUtc: 1320, endMinuteUtc: 360,
    },
    proposedAt: '2026-10-05T11:59:00.000Z',
    recordedAt: '2026-10-05T11:59:00.000Z',
  });
  const activation = createAgentCommonsActivationReadiness(space, activity, proposal);
  const admission = createAgentCommonsAdmissionReadiness(
    identity, space, activity, proposal, activation, 720,
  );
  return { mapping, active, ended, identity, space, activity, proposal, activation, admission };
}

function evaluate(domain, lineage) {
  return domain.createAgentCommonsMilestoneAcceptance(
    lineage.mapping,
    lineage.active,
    lineage.ended,
    lineage.identity,
    lineage.space,
    lineage.activity,
    lineage.proposal,
    lineage.activation,
    lineage.admission,
  );
}

test('T1 exact authentic blocked lineage yields the minimal frozen Milestone 10 acceptance record', async () => {
  const domain = await loadAcceptance('t1');
  const lineage = createLineage(domain);
  assert.equal(typeof domain.createAgentCommonsMilestoneAcceptance, 'function');

  const result = evaluate(domain, lineage);

  assert.equal(Object.getPrototypeOf(result), null);
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.getPrototypeOf(result.quietHoursConfiguration), null);
  assert.equal(Object.isFrozen(result.quietHoursConfiguration), true);
  assert.equal(Object.isFrozen(result.blockers), true);
  assert.deepEqual(Object.keys(result), [
    'milestoneIdentifier', 'readinessStatus', 'participantIdentityStatus',
    'recreationSeparationStatus', 'authorityExpansionStatus', 'costPolicy', 'privacy',
    'interruptionPolicy', 'returnReadinessStatus', 'quietHoursConfiguration',
    'quietHoursConfigurationStatus', 'retentionStatus', 'sourceIdentityRevision', 'blockers',
  ]);
  assert.deepEqual({
    ...result,
    quietHoursConfiguration: { ...result.quietHoursConfiguration },
    blockers: [...result.blockers],
  }, {
    milestoneIdentifier: 'office-platform-milestone-10',
    readinessStatus: 'blocked',
    participantIdentityStatus: 'exact_reviewed_hosted_identity',
    recreationSeparationStatus: 'voluntary_non_work',
    authorityExpansionStatus: 'not_expanded',
    costPolicy: 'no_incremental_spend',
    privacy: 'tenant_private',
    interruptionPolicy: 'return_to_assigned_state',
    returnReadinessStatus: 'ready_for_assignment_reconciliation',
    quietHoursConfiguration: {
      mode: 'daily_utc', startMinuteUtc: 1320, endMinuteUtc: 360,
    },
    quietHoursConfigurationStatus: 'proposed_not_authorized',
    retentionStatus: 'not_configured',
    sourceIdentityRevision: 7,
    blockers: ['participation_policy_authorization_required', 'retention_configuration_required'],
  });
});

test('T2 characterization: copies wrappers proxies and accessors fail generically without hooks', async () => {
  const domain = await loadAcceptance('t2');
  const lineage = createLineage(domain);
  let hooks = 0;
  const proxy = (value) => new Proxy(value, {
    get() { hooks += 1; throw new Error('must not read'); },
    getPrototypeOf() { hooks += 1; throw new Error('must not inspect'); },
    ownKeys() { hooks += 1; throw new Error('must not enumerate'); },
  });
  const accessor = Object.defineProperty({}, 'activityKind', {
    enumerable: true,
    get() { hooks += 1; throw new Error('must not invoke'); },
  });
  const cases = [
    { ...lineage, mapping: { ...lineage.mapping } },
    { ...lineage, active: JSON.parse(JSON.stringify(lineage.active)) },
    { ...lineage, ended: Object.create(lineage.ended) },
    { ...lineage, identity: Object.freeze({ value: lineage.identity }) },
    { ...lineage, space: proxy(lineage.space) },
    { ...lineage, activity: accessor },
    { ...lineage, proposal: { ...lineage.proposal } },
    { ...lineage, activation: Object.create(lineage.activation) },
    { ...lineage, admission: proxy(lineage.admission) },
  ];
  for (const candidate of cases) assert.throws(() => evaluate(domain, candidate), INVALID);
  assert.equal(hooks, 0);
});

test('T3 characterization: authentic but mixed and foreign lineages fail closed', async () => {
  const domain = await loadAcceptance('t3');
  const foreignDomain = await loadAcceptance('t3-foreign');
  const lineage = createLineage(domain);
  const other = createLineage(domain);
  const foreign = createLineage(foreignDomain);

  for (const candidate of [
    { ...lineage, ended: other.ended },
    { ...lineage, admission: other.admission },
    { ...lineage, mapping: foreign.mapping, active: foreign.active, ended: foreign.ended },
  ]) assert.throws(() => evaluate(domain, candidate), INVALID);
});

test('T4 characterization: exact arity fails before any supplied value or extra is observed', async () => {
  const domain = await loadAcceptance('t4');
  const lineage = createLineage(domain);
  const args = Object.values(lineage);
  let hooks = 0;
  const hostile = new Proxy(Object.create(null), {
    get() { hooks += 1; throw new Error('must not read'); },
    getPrototypeOf() { hooks += 1; throw new Error('must not inspect'); },
    ownKeys() { hooks += 1; throw new Error('must not enumerate'); },
  });
  assert.equal(domain.createAgentCommonsMilestoneAcceptance.length, 9);
  assert.throws(() => domain.createAgentCommonsMilestoneAcceptance(), INVALID);
  assert.throws(
    () => domain.createAgentCommonsMilestoneAcceptance(...args.slice(0, 8)), INVALID,
  );
  assert.throws(
    () => domain.createAgentCommonsMilestoneAcceptance(hostile, ...args.slice(1), hostile), INVALID,
  );
  assert.equal(hooks, 0);
});

test('T5 participation and shared-space activity meanings must identify the same activity kind', async () => {
  const domain = await loadAcceptance('t5');
  const mismatched = createLineage(domain, {
    participationActivityKind: 'recreation',
    activityKind: 'creative',
  });
  assert.throws(() => evaluate(domain, mismatched), INVALID);
});

test('T6 characterization: result is detached recursively frozen closed scalar evidence', async () => {
  const domain = await loadAcceptance('t6');
  const lineage = createLineage(domain);
  const first = evaluate(domain, lineage);
  const second = evaluate(domain, lineage);
  assert.notEqual(first, second);
  assert.notEqual(first.quietHoursConfiguration, lineage.proposal.quietHours);
  assert.notEqual(first.quietHoursConfiguration, lineage.admission.quietHours);
  assert.notEqual(first.blockers, lineage.activation.blockers);
  assert.notEqual(first.blockers, lineage.admission.blockers);
  assert.deepEqual(JSON.parse(JSON.stringify(first)), {
    ...first,
    quietHoursConfiguration: { ...first.quietHoursConfiguration },
    blockers: [...first.blockers],
  });
  for (const value of Object.values(first)) {
    assert.notEqual(typeof value, 'function');
    if (value !== null && typeof value === 'object') assert.equal(Object.isFrozen(value), true);
  }
});

test('T7 characterization: evidence widens no authority and creates no live work or social claim', async () => {
  const domain = await loadAcceptance('t7');
  const result = evaluate(domain, createLineage(domain));
  assert.equal(result.authorityExpansionStatus, 'not_expanded');
  assert.equal(result.returnReadinessStatus, 'ready_for_assignment_reconciliation');
  for (const forbidden of [
    'participant', 'participation', 'occupancy', 'attendance', 'friendship', 'relationship',
    'movement', 'availability', 'workState', 'assigned', 'assignment', 'resumed', 'completed',
    'active', 'provider', 'runtime', 'production', 'price', 'credits', 'amount', 'currency',
    'skills', 'permissions', 'actionAuthorities', 'tenantMembership', 'recordAccess',
    'spendingAuthority', 'externalCommunicationAuthority', 'protectedReleaseAuthority',
  ]) assert.equal(forbidden in result, false, `forbidden acceptance field: ${forbidden}`);
});

test('T8 characterization: quiet hours remain copied proposed configuration, never enforcement', async () => {
  const domain = await loadAcceptance('t8');
  for (const quietHours of [
    { mode: 'disabled', startMinuteUtc: null, endMinuteUtc: null },
    { mode: 'daily_utc', startMinuteUtc: 1320, endMinuteUtc: 360 },
  ]) {
    const lineage = createLineage(domain, { quietHours });
    const result = evaluate(domain, lineage);
    assert.deepEqual({ ...result.quietHoursConfiguration }, quietHours);
    assert.equal(result.quietHoursConfigurationStatus, 'proposed_not_authorized');
    assert.equal('quietHoursStatus' in result, false);
    assert.equal('quietHoursEnforced' in result, false);
  }
});

test('T9 characterization: milestone evaluator remains dormant with no runtime importer', async () => {
  const source = await readFile(MODULE_URL, 'utf8');
  const imports = Array.from(
    source.matchAll(/\bfrom\s+['"]([^'"]+)['"];?/g),
    (match) => match[1],
  );
  assert.deepEqual(imports, [
    './agentCommons\\u0050articipation', './agentCommons\\u0053haredSpace',
  ]);
  const importers = [];
  for (const root of ['../src', '../server']) {
    const paths = await readdir(new URL(root, import.meta.url), { recursive: true });
    for (const path of paths) {
      if (!/\.(?:[cm]?ts|tsx|[cm]?js|jsx)$/.test(path)
          || root === '../src' && path === 'domain/agentCommonsMilestoneAcceptance.ts') continue;
      const candidate = await readFile(new URL(`${root}/${path}`, import.meta.url), 'utf8');
      if (/agentCommonsMilestoneAcceptance/.test(candidate)) importers.push(`${root}/${path}`);
    }
  }
  assert.deepEqual(importers, []);
  assert.doesNotMatch(source, /\b(?:fetch|XMLHttpRequest|WebSocket|setTimeout|setInterval|process|document|window|localStorage|sessionStorage|console|eval)\b/);
  assert.doesNotMatch(source, /\bnew\s+Function\b/);
  assert.doesNotMatch(source, /(?:route|server|database|storage|payment|price|credit|provider|occupancy|attendance|friendship|productivity)/i);
});

test('T10 hosted identity and managed customer identity branches must bind to one participant', async () => {
  const domain = await loadAcceptance('t10');
  const first = createLineage(domain);
  const second = createLineage(domain, {
    accountSuffix: '0000000000000006',
    organizationSuffix: '0000000000000007',
  });
  assert.throws(() => evaluate(domain, {
    ...first,
    mapping: second.mapping,
    active: second.active,
    ended: second.ended,
  }), INVALID);
});
