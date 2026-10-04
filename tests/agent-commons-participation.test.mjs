import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const presenceUrl = new URL('../src/domain/hostedAgentPresence.ts', import.meta.url);
const commonsUrl = new URL('../src/domain/agentCommonsParticipation.ts', import.meta.url);

async function loadDomain(tag) {
  const presenceSource = await readFile(presenceUrl, 'utf8');
  const outputOptions = {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  };
  const presenceOutput = ts.transpileModule(presenceSource, outputOptions).outputText;
  const presenceSpecifier = `data:text/javascript;base64,${Buffer.from(presenceOutput).toString('base64')}#presence-${tag}`;
  let commonsSource;
  try {
    commonsSource = await readFile(commonsUrl, 'utf8');
  } catch (error) {
    if (error?.code === 'ENOENT') return import(presenceSpecifier);
    throw error;
  }
  const commonsOutput = ts.transpileModule(commonsSource, outputOptions).outputText.replace(
    /['"]\.\/hostedAgentPresence['"]/,
    JSON.stringify(presenceSpecifier),
  );
  const commonsSpecifier = `data:text/javascript;base64,${Buffer.from(commonsOutput).toString('base64')}#commons-${tag}`;
  return { ...await import(presenceSpecifier), ...await import(commonsSpecifier) };
}

const IDS = Object.freeze({
  tenant: 'id_1111111111111111',
  subject: 'id_2222222222222222',
  event: 'id_3333333333333333',
});

function mappingInput(overrides = {}) {
  return {
    tenantId: IDS.tenant,
    subjectId: IDS.subject,
    identityId: 'stg-spiders',
    displayName: 'Spiders',
    profileName: 'spiders',
    registryRevision: 7,
    synchronizedAt: '2026-10-04T10:00:00.000Z',
    status: 'active',
    roleLabel: 'Chief Agent',
    workplaceLabel: 'Chief Agent Office',
    skills: ['project-coordination'],
    permissions: [],
    actionAuthorities: [],
    ...overrides,
  };
}

function participationInput(overrides = {}) {
  return {
    schemaVersion: 'agent-commons-participation/1',
    eventId: IDS.event,
    tenantId: IDS.tenant,
    identityId: 'stg-spiders',
    activityKind: 'recreation',
    participation: 'voluntary',
    privacy: 'tenant_private',
    costPolicy: 'no_incremental_spend',
    interruptionPolicy: 'return_to_assigned_state',
    lifecycle: 'active',
    startedAt: '2026-10-04T10:01:00.000Z',
    endedAt: null,
    recordedAt: '2026-10-04T10:01:00.000Z',
    ...overrides,
  };
}

function exactMapping(domain, overrides = {}) {
  return domain.createReviewedHostedIdentityMapping(mappingInput(overrides));
}

function participationDraft(domain, mapping, overrides = {}) {
  const input = participationInput(overrides);
  return domain.createAgentCommonsParticipationDraft(
    mapping, input.eventId, input.activityKind, input.lifecycle,
    input.startedAt, input.endedAt, input.recordedAt,
  );
}

test('primitive draft factory yields one detached frozen voluntary recreation record', async () => {
  const domain = await loadDomain('valid-recreation');
  assert.equal(typeof domain.createAgentCommonsParticipationDraft, 'function');
  assert.equal(typeof domain.createAgentCommonsParticipation, 'function');
  const input = participationInput();
  const mapping = exactMapping(domain);
  const draft = domain.createAgentCommonsParticipationDraft(
    mapping, input.eventId, input.activityKind, input.lifecycle,
    input.startedAt, input.endedAt, input.recordedAt,
  );
  const record = domain.createAgentCommonsParticipation(mapping, draft);
  assert.deepEqual({ ...draft }, input);
  assert.equal(Object.getPrototypeOf(draft), null);
  assert.equal(Object.isFrozen(draft), true);
  assert.deepEqual({ ...record }, {
    ...input,
    sourceIdentityRevision: 7,
  });
  assert.notEqual(record, draft);
  assert.equal(Object.getPrototypeOf(record), null);
  assert.equal(Object.isFrozen(record), true);
  assert.deepEqual(Object.keys(record), [
    'schemaVersion', 'eventId', 'tenantId', 'identityId', 'activityKind',
    'participation', 'privacy', 'costPolicy', 'interruptionPolicy', 'lifecycle',
    'startedAt', 'endedAt', 'recordedAt', 'sourceIdentityRevision',
  ]);
});

test('participation preserves each bounded activity meaning and rejects other meanings', async () => {
  const domain = await loadDomain('activity-meanings');
  const mapping = exactMapping(domain);
  for (const activityKind of ['social', 'creative', 'recreation']) {
    assert.equal(domain.createAgentCommonsParticipation(
      mapping, participationDraft(domain, mapping, { activityKind }),
    ).activityKind, activityKind);
  }
  assert.throws(() => participationDraft(
    domain, mapping, { activityKind: 'working' },
  ), { name: 'TypeError', message: 'Invalid agent commons participation input' });
});

test('active and ended lifecycles enforce canonical inclusive chronology', async () => {
  const domain = await loadDomain('lifecycle-chronology');
  const mapping = exactMapping(domain);
  assert.equal(domain.createAgentCommonsParticipation(
    mapping, participationDraft(domain, mapping),
  ).endedAt, null);
  const ended = domain.createAgentCommonsParticipation(mapping, participationDraft(domain, mapping, {
    lifecycle: 'ended',
    endedAt: '2026-10-04T10:02:00.000Z',
    recordedAt: '2026-10-04T10:02:00.000Z',
  }));
  assert.deepEqual([ended.lifecycle, ended.endedAt], [
    'ended', '2026-10-04T10:02:00.000Z',
  ]);
  for (const overrides of [
    { lifecycle: 'active', endedAt: '2026-10-04T10:02:00.000Z' },
    { lifecycle: 'ended', endedAt: null },
    { lifecycle: 'ended', endedAt: '2026-10-04T10:00:59.999Z' },
    { lifecycle: 'ended', endedAt: '2026-10-04T10:02:00.000Z', recordedAt: '2026-10-04T10:01:59.999Z' },
    { startedAt: '2026-10-04T10:01:00Z' },
    { recordedAt: '2026-10-04T10:00:59.999Z' },
  ]) {
    assert.throws(() => participationDraft(
      domain, mapping, overrides,
    ), { name: 'TypeError', message: 'Invalid agent commons participation input' });
  }
});

test('participation requires the exact active mapping and exact tenant identity binding', async () => {
  const domain = await loadDomain('exact-mapping-binding');
  const mapping = exactMapping(domain);
  let hooks = 0;
  const mappingProxy = new Proxy(mapping, {
    get() { hooks += 1; throw new Error('unexpected get'); },
    ownKeys() { hooks += 1; throw new Error('unexpected ownKeys'); },
  });
  const otherTenantMapping = exactMapping(domain, {
    tenantId: 'id_aaaaaaaaaaaaaaaa',
    subjectId: 'id_bbbbbbbbbbbbbbbb',
  });
  const newerRevisionMapping = exactMapping(domain, { registryRevision: 8 });
  const draft = participationDraft(domain, mapping);
  for (const candidateMapping of [
    Object.freeze({ ...mapping }),
    JSON.parse(JSON.stringify(mapping)),
    Object.freeze(Object.create(mapping)),
    mappingProxy,
    otherTenantMapping,
    newerRevisionMapping,
  ]) {
    assert.throws(() => domain.createAgentCommonsParticipation(
      candidateMapping, draft,
    ), { name: 'TypeError', message: 'Invalid agent commons participation input' });
  }
  for (const status of ['revoked', 'retired']) {
    const inactive = exactMapping(domain, { status });
    assert.throws(() => participationDraft(domain, inactive), {
      name: 'TypeError', message: 'Invalid agent commons participation input',
    });
  }
  assert.equal(hooks, 0);
});

test('draft derives fixed participation policies and canonical event identity fails closed', async () => {
  const domain = await loadDomain('fixed-policies');
  const mapping = exactMapping(domain);
  const draft = participationDraft(domain, mapping);
  assert.deepEqual([
    draft.schemaVersion, draft.tenantId, draft.identityId, draft.participation,
    draft.privacy, draft.costPolicy, draft.interruptionPolicy,
  ], [
    'agent-commons-participation/1', IDS.tenant, 'stg-spiders', 'voluntary',
    'tenant_private', 'no_incremental_spend', 'return_to_assigned_state',
  ]);
  assert.throws(() => participationDraft(domain, mapping, { eventId: 'event-friendly-name' }),
    { name: 'TypeError', message: 'Invalid agent commons participation input' });
});

test('only exact branded drafts participate and arbitrary objects execute zero hooks', async () => {
  const domain = await loadDomain('closed-input');
  const mapping = exactMapping(domain);
  const unknown = participationInput({ taskId: 'id_4444444444444444' });
  const missing = participationInput();
  delete missing.privacy;
  const inherited = Object.create(participationInput());
  const symbolic = participationInput();
  symbolic[Symbol('authority')] = true;
  let hooks = 0;
  const accessor = participationInput();
  Object.defineProperty(accessor, 'tenantId', {
    enumerable: true,
    get() { hooks += 1; throw new Error('unexpected getter'); },
  });
  for (const candidate of [
    unknown, missing, inherited, symbolic, accessor, [], null,
    { ...participationDraft(domain, mapping) },
    JSON.parse(JSON.stringify(participationDraft(domain, mapping))),
    Object.create(participationDraft(domain, mapping)),
  ]) {
    assert.throws(() => domain.createAgentCommonsParticipation(mapping, candidate), {
      name: 'TypeError', message: 'Invalid agent commons participation input',
    });
  }
  assert.equal(hooks, 0);
});

test('participation proxies fail generically without executing getPrototypeOf hooks', async () => {
  const domain = await loadDomain('participation-proxy-zero-hook');
  const mapping = exactMapping(domain);
  let hooks = 0;
  const participationProxy = new Proxy(participationInput(), {
    getPrototypeOf() {
      hooks += 1;
      throw new Error('unexpected getPrototypeOf');
    },
  });

  assert.throws(() => domain.createAgentCommonsParticipation(mapping, participationProxy), {
    name: 'TypeError', message: 'Invalid agent commons participation input',
  });
  assert.equal(hooks, 0);
});

test('post-import TypeError replacement executes zero hooks and preserves generic denial', async () => {
  const domain = await loadDomain('captured-type-error');
  const NativeTypeError = globalThis.TypeError;
  let hooks = 0;
  let error;
  class HostileTypeError extends Error {
    constructor() {
      hooks += 1;
      super('hostile TypeError invoked');
    }
  }
  try {
    globalThis.TypeError = HostileTypeError;
    try {
      domain.createAgentCommonsParticipationDraft(
        exactMapping(domain), 'invalid-event', 'recreation', 'active',
        '2026-10-04T10:01:00.000Z', null, '2026-10-04T10:01:00.000Z',
      );
    } catch (caught) {
      error = caught;
    }
  } finally {
    globalThis.TypeError = NativeTypeError;
  }
  assert.equal(hooks, 0);
  assert.equal(error instanceof NativeTypeError, true);
  assert.equal(error?.message, 'Invalid agent commons participation input');
});

test('Object.prototype descriptor poisoning executes zero hooks during draft and result creation', async () => {
  const domain = await loadDomain('null-prototype-descriptors');
  const mapping = exactMapping(domain);
  const descriptorKeys = ['get', 'set', 'value', 'writable', 'configurable', 'enumerable'];
  let hooks = 0;
  let record;
  try {
    for (const key of descriptorKeys) {
      const descriptor = Object.create(null);
      descriptor.get = () => { hooks += 1; throw new Error(`unexpected ${key} getter`); };
      descriptor.configurable = true;
      Object.defineProperty(Object.prototype, key, descriptor);
    }
    const draft = participationDraft(domain, mapping);
    record = domain.createAgentCommonsParticipation(mapping, draft);
  } finally {
    for (const key of descriptorKeys) delete Object.prototype[key];
  }
  assert.equal(hooks, 0);
  assert.equal(record?.eventId, IDS.event);
});

test('accepted mapping and captured intrinsics survive hostile post-import ambient mutation', async () => {
  const domain = await loadDomain('hostile-ambient');
  const mapping = exactMapping(domain);
  domain.createAgentCommonsParticipation(mapping, participationDraft(domain, mapping));
  let hooks = 0;
  const replacements = [
    [Object, 'getPrototypeOf'], [Object, 'getOwnPropertyDescriptor'],
    [Object, 'defineProperty'], [Object, 'defineProperties'], [Object, 'freeze'],
    [Reflect, 'ownKeys'], [Number, 'isFinite'],
    [Date.prototype, 'getTime'], [Date.prototype, 'toISOString'],
    [String.prototype, 'charCodeAt'], [RegExp.prototype, 'test'],
    [WeakSet.prototype, 'has'], [WeakSet.prototype, 'add'],
  ].map(([holder, key]) => [holder, key, holder[key]]);
  const hostile = () => { hooks += 1; throw new Error('unexpected ambient hook'); };
  let record;
  try {
    for (const [holder, key] of replacements) holder[key] = hostile;
    record = domain.createAgentCommonsParticipation(
      mapping,
      participationDraft(domain, mapping, { eventId: 'id_4444444444444444' }),
    );
  } finally {
    for (const [holder, key, original] of replacements) holder[key] = original;
  }
  assert.equal(hooks, 0);
  assert.equal(record.eventId, 'id_4444444444444444');
  assert.equal(Object.getPrototypeOf(record), null);
  assert.equal(Object.isFrozen(record), true);
});

test('characterization: record exposes no work, authority, provider, customer, or financial claims', async () => {
  const domain = await loadDomain('minimal-output');
  const mapping = exactMapping(domain);
  const record = domain.createAgentCommonsParticipation(
    mapping, participationDraft(domain, mapping),
  );
  for (const forbidden of [
    'state', 'workState', 'status', 'taskId', 'runId', 'boardId', 'permissions',
    'skills', 'actionAuthorities', 'spendingAuthority', 'customerData',
    'repositoryData', 'provider', 'endpoint', 'credential', 'transcript',
    'amount', 'currency', 'friendship', 'attendance', 'productivity',
  ]) assert.equal(forbidden in record, false);
  assert.deepEqual(JSON.parse(JSON.stringify(record)), { ...record });
});

test('characterization: hostile scalar values fail with one generic error and zero coercion hooks', async () => {
  const domain = await loadDomain('hostile-scalars');
  const mapping = exactMapping(domain);
  let hooks = 0;
  const hostile = Object.freeze({
    toString() { hooks += 1; return 'id_3333333333333333'; },
    valueOf() { hooks += 1; return 0; },
  });
  for (const field of ['eventId', 'activityKind', 'lifecycle', 'startedAt', 'endedAt', 'recordedAt']) {
    assert.throws(() => participationDraft(
      domain, mapping, { [field]: hostile },
    ), { name: 'TypeError', message: 'Invalid agent commons participation input' });
  }
  assert.equal(hooks, 0);
});

test('characterization: draft factory accepts only its bounded primitive argument list', async () => {
  const domain = await loadDomain('primitive-only-arguments');
  const mapping = exactMapping(domain);
  let hooks = 0;
  const hostile = new Proxy(Object.create(null), {
    get() { hooks += 1; throw new Error('unexpected get'); },
    getPrototypeOf() { hooks += 1; throw new Error('unexpected getPrototypeOf'); },
    ownKeys() { hooks += 1; throw new Error('unexpected ownKeys'); },
  });
  const valid = [
    IDS.event, 'recreation', 'active',
    '2026-10-04T10:01:00.000Z', null, '2026-10-04T10:01:00.000Z',
  ];
  for (let index = 0; index < valid.length; index += 1) {
    const candidate = valid.slice();
    candidate[index] = hostile;
    assert.throws(() => domain.createAgentCommonsParticipationDraft(mapping, ...candidate), {
      name: 'TypeError', message: 'Invalid agent commons participation input',
    });
  }
  assert.throws(() => domain.createAgentCommonsParticipationDraft(mapping, ...valid, hostile), {
    name: 'TypeError', message: 'Invalid agent commons participation input',
  });
  assert.equal(hooks, 0);
});

test('final participation factory rejects extra arguments without executing hostile hooks', async () => {
  const domain = await loadDomain('final-factory-exact-arity');
  const mapping = exactMapping(domain);
  const draft = participationDraft(domain, mapping);
  let hooks = 0;
  const hostileExtra = new Proxy(Object.create(null), {
    get() { hooks += 1; throw new Error('unexpected get'); },
    getPrototypeOf() { hooks += 1; throw new Error('unexpected getPrototypeOf'); },
    ownKeys() { hooks += 1; throw new Error('unexpected ownKeys'); },
  });

  assert.throws(() => domain.createAgentCommonsParticipation(mapping, draft, hostileExtra), {
    name: 'TypeError', message: 'Invalid agent commons participation input',
  });
  assert.equal(hooks, 0);
});

test('characterization: agent commons participation boundary remains dormant', async () => {
  const [commonsSource, sourcePaths] = await Promise.all([
    readFile(commonsUrl, 'utf8'),
    readdir(new URL('../src', import.meta.url), { recursive: true }),
  ]);
  const imported = Array.from(
    commonsSource.matchAll(/\bfrom\s+['"]([^'"]+)['"];?/g),
    (match) => match[1],
  );
  assert.deepEqual(imported, ['./hostedAgentPresence']);
  const importers = [];
  for (const relativePath of sourcePaths) {
    if (!/\.(?:ts|js|mjs)$/.test(relativePath)
      || relativePath === 'domain/agentCommonsParticipation.ts') continue;
    const source = await readFile(new URL(`../src/${relativePath}`, import.meta.url), 'utf8');
    if (/agentCommonsParticipation/.test(source)) importers.push(relativePath);
  }
  assert.deepEqual(importers, []);
  assert.doesNotMatch(commonsSource, /\b(?:fetch|XMLHttpRequest|WebSocket|setTimeout|setInterval|process|document|window|localStorage|sessionStorage)\b/);
  assert.doesNotMatch(commonsSource, /(?:route|server|provider|database|storage|renderer|animation|occupancy|payment|price|credit)/i);
});
