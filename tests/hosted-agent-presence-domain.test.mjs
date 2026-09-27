import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const moduleUrl = new URL('../src/domain/hostedAgentPresence.ts', import.meta.url);

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
  subject: 'id_2222222222222222',
});

function mappingFixture(overrides = {}) {
  return {
    tenantId: IDS.tenant,
    subjectId: IDS.subject,
    identityId: 'stg-spiders',
    displayName: 'Spiders',
    profileName: 'spiders',
    registryRevision: 7,
    synchronizedAt: '2026-09-27T10:00:00.000Z',
    status: 'active',
    roleLabel: 'Chief Agent',
    workplaceLabel: 'Chief Agent Office',
    skills: ['project-coordination'],
    permissions: [],
    actionAuthorities: [],
    ...overrides,
  };
}

test('reviewed mapping keeps identity membership capability and authority categorically separate', async () => {
  const domain = await loadDomain();
  assert.equal(typeof domain.createReviewedHostedIdentityMapping, 'function');

  const input = mappingFixture();
  const mapping = domain.createReviewedHostedIdentityMapping(input);
  assert.deepEqual(mapping, input);
  assert.notEqual(mapping, input);
  assert.notEqual(mapping.skills, input.skills);
  assert.deepEqual(mapping.permissions, []);
  assert.deepEqual(mapping.actionAuthorities, []);

  const rejected = [
    mappingFixture({ identityId: 'someone-else' }),
    mappingFixture({ displayName: 'Not Spiders' }),
    mappingFixture({ roleLabel: 'Administrator' }),
    mappingFixture({ workplaceLabel: 'Finance' }),
    mappingFixture({ registryRevision: 0 }),
    mappingFixture({ registryRevision: -0 }),
    mappingFixture({ registryRevision: Number.MAX_SAFE_INTEGER + 1 }),
    mappingFixture({ status: 'unknown' }),
    mappingFixture({ permissions: ['record.read'] }),
    mappingFixture({ actionAuthorities: ['spend'] }),
    { ...mappingFixture(), extra: true },
    Object.assign(Object.create({ inherited: true }), mappingFixture()),
    Object.defineProperty(mappingFixture(), 'displayName', { get: () => 'Spiders' }),
    Object.assign(mappingFixture(), { [Symbol('hidden')]: true }),
  ];
  for (const value of rejected) {
    assert.throws(
      () => domain.createReviewedHostedIdentityMapping(value),
      { message: 'Invalid hosted agent presence input' },
    );
  }
});

test('source request is exactly bound to one board profile mapping revision and evaluation clock', async () => {
  const domain = await loadDomain();
  const mapping = domain.createReviewedHostedIdentityMapping(mappingFixture());
  const input = {
    boardScope: 'default', profileName: 'spiders', mappingRevision: 7,
    evaluatedAt: '2026-09-27T10:01:00.000Z',
  };
  assert.equal(typeof domain.createHostedPresenceRequest, 'function');
  assert.deepEqual(domain.createHostedPresenceRequest(mapping, input), input);

  for (const value of [
    { ...input, boardScope: 'all' },
    { ...input, profileName: 'ariadne' },
    { ...input, mappingRevision: 8 },
    { ...input, evaluatedAt: '2026-09-27T09:59:59.999Z' },
    { ...input, tenantId: IDS.tenant },
  ]) {
    assert.throws(() => domain.createHostedPresenceRequest(mapping, value),
      { message: 'Invalid hosted agent presence input' });
  }
});

test('accepted request provenance cannot be replayed across mappings', async () => {
  const domain = await loadDomain();
  const mapping = domain.createReviewedHostedIdentityMapping(mappingFixture());
  const requestInput = {
    boardScope: 'default', profileName: 'spiders', mappingRevision: 7,
    evaluatedAt: '2026-09-27T10:01:00.000Z',
  };
  const request = domain.createHostedPresenceRequest(mapping, requestInput);
  const observationInput = {
    profileName: 'spiders', mappingRevision: 7,
    observedAt: '2026-09-27T10:00:30.000Z', status: 'available',
    reason: 'source_available', currentRun: null, decisiveEvent: null,
  };
  const mismatchedMappings = [
    domain.createReviewedHostedIdentityMapping(mappingFixture({
      tenantId: 'id_9999999999999999',
    })),
    domain.createReviewedHostedIdentityMapping(mappingFixture({
      subjectId: 'id_9999999999999999',
    })),
    domain.createReviewedHostedIdentityMapping(mappingFixture({ registryRevision: 8 })),
  ];

  for (const otherMapping of mismatchedMappings) {
    assert.throws(
      () => domain.createHermesPresenceObservation(otherMapping, request, observationInput),
      { message: 'Invalid hosted agent presence input' },
    );
  }
  assert.throws(() => domain.createHostedPresenceRequest({ ...mapping }, requestInput),
    { message: 'Invalid hosted agent presence input' });
  assert.throws(() => domain.createHermesPresenceObservation(mapping, { ...request }, observationInput),
    { message: 'Invalid hosted agent presence input' });
});

test('observation preserves explicit available degraded and unavailable source facts', async () => {
  const domain = await loadDomain();
  const mapping = domain.createReviewedHostedIdentityMapping(mappingFixture());
  const request = domain.createHostedPresenceRequest(mapping, {
    boardScope: 'default', profileName: 'spiders', mappingRevision: 7,
    evaluatedAt: '2026-09-27T10:01:00.000Z',
  });
  const base = {
    profileName: 'spiders', mappingRevision: 7,
    observedAt: '2026-09-27T10:00:30.000Z', status: 'available',
    reason: 'source_available', currentRun: null, decisiveEvent: null,
  };
  assert.equal(typeof domain.createHermesPresenceObservation, 'function');
  for (const [status, reason] of [
    ['available', 'source_available'], ['degraded', 'heartbeat_delayed'],
    ['unavailable', 'source_unavailable'],
  ]) {
    const input = { ...base, status, reason };
    assert.deepEqual(domain.createHermesPresenceObservation(mapping, request, input), input);
  }
  for (const value of [
    { ...base, status: 'healthy' },
    { ...base, reason: '' },
    { ...base, observedAt: '2026-09-27T10:01:00.001Z' },
    { ...base, profileName: 'ariadne' },
    { ...base, mappingRevision: 6 },
    { ...base, extra: 'private detail' },
  ]) {
    assert.throws(() => domain.createHermesPresenceObservation(mapping, request, value),
      { message: 'Invalid hosted agent presence input' });
  }
});

test('source status rejects a contradictory truthful-state reason', async () => {
  const domain = await loadDomain();
  const mapping = domain.createReviewedHostedIdentityMapping(mappingFixture());
  const request = domain.createHostedPresenceRequest(mapping, {
    boardScope: 'default', profileName: 'spiders', mappingRevision: 7,
    evaluatedAt: '2026-09-27T10:01:00.000Z',
  });

  assert.throws(() => domain.createHermesPresenceObservation(mapping, request, {
    profileName: 'spiders', mappingRevision: 7,
    observedAt: '2026-09-27T10:00:30.000Z', status: 'unavailable',
    reason: 'source_available', currentRun: null, decisiveEvent: null,
  }), { message: 'Invalid hosted agent presence input' });
});

test('current running claim requires coherent spawn PID heartbeat and decisive event facts', async () => {
  const domain = await loadDomain();
  const mapping = domain.createReviewedHostedIdentityMapping(mappingFixture());
  const request = domain.createHostedPresenceRequest(mapping, {
    boardScope: 'default', profileName: 'spiders', mappingRevision: 7,
    evaluatedAt: '2026-09-27T10:01:00.000Z',
  });
  const run = {
    runId: 'id_3333333333333333', taskId: 'id_4444444444444444', status: 'running',
    outcome: null, claimedAt: '2026-09-27T10:00:00.000Z',
    spawnedAt: '2026-09-27T10:00:05.000Z', pid: 321, pidLive: true,
    heartbeatAt: '2026-09-27T10:00:20.000Z',
  };
  const event = {
    eventId: 'id_5555555555555555', runId: run.runId,
    kind: 'heartbeat', occurredAt: run.heartbeatAt,
  };
  const input = {
    profileName: 'spiders', mappingRevision: 7,
    observedAt: '2026-09-27T10:00:30.000Z', status: 'available',
    reason: 'source_available', currentRun: run, decisiveEvent: event,
  };
  const accepted = domain.createHermesPresenceObservation(mapping, request, input);
  assert.deepEqual(accepted, input);
  assert.notEqual(accepted.currentRun, run);

  for (const value of [
    { ...input, currentRun: { ...run, spawnedAt: null } },
    { ...input, currentRun: { ...run, pid: 0 } },
    { ...input, currentRun: { ...run, pidLive: false } },
    { ...input, currentRun: { ...run, heartbeatAt: '2026-09-27T09:59:59.000Z' } },
    { ...input, decisiveEvent: { ...event, runId: 'id_6666666666666666' } },
    { ...input, decisiveEvent: null },
    { ...input, status: 'degraded' },
  ]) {
    assert.throws(() => domain.createHermesPresenceObservation(mapping, request, value),
      { message: 'Invalid hosted agent presence input' });
  }
});

test('revoked and retired mappings cannot produce available current-live observations', async () => {
  const domain = await loadDomain();
  const currentRun = {
    runId: 'id_3333333333333333', taskId: 'id_4444444444444444', status: 'running',
    outcome: null, claimedAt: '2026-09-27T10:00:00.000Z',
    spawnedAt: '2026-09-27T10:00:05.000Z', pid: 321, pidLive: true,
    heartbeatAt: '2026-09-27T10:00:20.000Z',
  };
  const decisiveEvent = {
    eventId: 'id_5555555555555555', runId: currentRun.runId,
    kind: 'heartbeat', occurredAt: currentRun.heartbeatAt,
  };

  for (const status of ['revoked', 'retired']) {
    const mapping = domain.createReviewedHostedIdentityMapping(mappingFixture({ status }));
    const request = domain.createHostedPresenceRequest(mapping, {
      boardScope: 'default', profileName: 'spiders', mappingRevision: 7,
      evaluatedAt: '2026-09-27T10:01:00.000Z',
    });
    assert.throws(() => domain.createHermesPresenceObservation(mapping, request, {
      profileName: 'spiders', mappingRevision: 7,
      observedAt: '2026-09-27T10:00:30.000Z', status: 'available',
      reason: 'source_available', currentRun, decisiveEvent,
    }), { message: 'Invalid hosted agent presence input' });
  }
});

test('tenant-private response carries at most one neutral record and exact same-tenant reference', async () => {
  const domain = await loadDomain();
  const mapping = domain.createReviewedHostedIdentityMapping(mappingFixture());
  const request = domain.createHostedPresenceRequest(mapping, {
    boardScope: 'default', profileName: 'spiders', mappingRevision: 7,
    evaluatedAt: '2026-09-27T10:01:00.000Z',
  });
  const observation = domain.createHermesPresenceObservation(mapping, request, {
    profileName: 'spiders', mappingRevision: 7,
    observedAt: '2026-09-27T10:00:30.000Z', status: 'available',
    reason: 'source_available', currentRun: null, decisiveEvent: null,
  });
  const record = {
    tenantId: IDS.tenant, subjectId: IDS.subject, identityId: 'stg-spiders',
    displayName: 'Spiders', roleLabel: 'Chief Agent', workplaceLabel: 'Chief Agent Office',
    state: 'not_derived', freshness: 'recent', reason: 'source_available',
    observedAt: observation.observedAt,
    recordRef: `/api/private/tenants/${IDS.tenant}/records/id_7777777777777777`,
  };
  const input = {
    tenantId: IDS.tenant, generatedAt: '2026-09-27T10:01:00.000Z', records: [record],
  };
  assert.equal(typeof domain.createPrivateHostedPresenceResponse, 'function');
  assert.deepEqual(domain.createPrivateHostedPresenceResponse(mapping, observation, input), input);
  assert.deepEqual(domain.createPrivateHostedPresenceResponse(mapping, observation,
    { ...input, records: [] }).records, []);

  for (const value of [
    { ...input, tenantId: 'id_8888888888888888' },
    { ...input, records: [record, record] },
    { ...input, records: [{ ...record, state: 'working' }] },
    { ...input, records: [{ ...record, permissions: ['record.read'] }] },
    { ...input, records: [{ ...record, recordRef: 'https://private.invalid/record' }] },
    { ...input, records: [{ ...record, recordRef: `/api/private/tenants/id_8888888888888888/records/id_7777777777777777` }] },
    { ...input, records: [{ ...record, recordRef: `${record.recordRef}/../secret` }] },
  ]) {
    assert.throws(() => domain.createPrivateHostedPresenceResponse(mapping, observation, value),
      { message: 'Invalid hosted agent presence input' });
  }
});

test('trusted observation provenance cannot be replayed into another mapping response', async () => {
  const domain = await loadDomain();
  const mappingA = domain.createReviewedHostedIdentityMapping(mappingFixture());
  const requestA = domain.createHostedPresenceRequest(mappingA, {
    boardScope: 'default', profileName: 'spiders', mappingRevision: 7,
    evaluatedAt: '2026-09-27T10:01:00.000Z',
  });
  const observationA = domain.createHermesPresenceObservation(mappingA, requestA, {
    profileName: 'spiders', mappingRevision: 7,
    observedAt: '2026-09-27T10:00:30.000Z', status: 'available',
    reason: 'source_available', currentRun: null, decisiveEvent: null,
  });
  const mappingB = domain.createReviewedHostedIdentityMapping(mappingFixture({
    tenantId: 'id_9999999999999999', subjectId: 'id_8888888888888888',
  }));
  domain.createHostedPresenceRequest(mappingB, {
    boardScope: 'default', profileName: 'spiders', mappingRevision: 7,
    evaluatedAt: '2026-09-27T10:01:00.000Z',
  });
  const inputB = {
    tenantId: mappingB.tenantId,
    generatedAt: '2026-09-27T10:01:00.000Z',
    records: [{
      tenantId: mappingB.tenantId, subjectId: mappingB.subjectId,
      identityId: 'stg-spiders', displayName: 'Spiders', roleLabel: 'Chief Agent',
      workplaceLabel: 'Chief Agent Office', state: 'not_derived', freshness: 'recent',
      reason: observationA.reason, observedAt: observationA.observedAt,
      recordRef: `/api/private/tenants/${mappingB.tenantId}/records/id_7777777777777777`,
    }],
  };

  assert.throws(
    () => domain.createPrivateHostedPresenceResponse(mappingB, observationA, inputB),
    { message: 'Invalid hosted agent presence input' },
  );
});

test('bounded JSON parser rejects duplicate keys before ordinary materialization', async () => {
  const domain = await loadDomain();
  assert.equal(typeof domain.parseHostedPresenceJson, 'function');
  assert.deepEqual(domain.parseHostedPresenceJson('{"status":"available","count":1}'),
    { status: 'available', count: 1 });
  for (const text of [
    '{"status":"available","status":"unavailable"}',
    '{"nested":{"id":1,"id":2}}',
    '{"unsafe":9007199254740992}',
    '{"negativeZero":-0}',
    '{"deep":{"a":{"b":{"c":{"d":{"e":{"f":{"g":{"h":{"i":{"j":{"k":{"l":1}}}}}}}}}}}}}',
    `{"large":"${'x'.repeat(17000)}"}`,
  ]) {
    assert.throws(() => domain.parseHostedPresenceJson(text),
      { message: 'Invalid hosted agent presence input' });
  }
});

test('accepted outputs are detached recursively frozen and mutation races fail closed', async () => {
  const domain = await loadDomain();
  const source = mappingFixture();
  const mapping = domain.createReviewedHostedIdentityMapping(source);
  source.skills[0] = 'mutated';
  assert.equal(mapping.skills[0], 'project-coordination');
  assert.equal(Object.isFrozen(mapping), true);
  assert.equal(Object.isFrozen(mapping.skills), true);

  const parsed = domain.parseHostedPresenceJson('{"nested":{"items":[1]}}');
  assert.equal(Object.isFrozen(parsed), true);
  assert.equal(Object.isFrozen(parsed.nested), true);
  assert.equal(Object.isFrozen(parsed.nested.items), true);

  let ownKeyReads = 0;
  const racing = new Proxy(mappingFixture(), {
    ownKeys(target) {
      ownKeyReads += 1;
      return ownKeyReads === 1 ? Reflect.ownKeys(target) : [...Reflect.ownKeys(target), 'raced'];
    },
    getOwnPropertyDescriptor(target, key) {
      if (key === 'raced') return { value: true, enumerable: true, configurable: true };
      return Reflect.getOwnPropertyDescriptor(target, key);
    },
  });
  assert.throws(() => domain.createReviewedHostedIdentityMapping(racing),
    { message: 'Invalid hosted agent presence input' });

  let skillKeyReads = 0;
  const racingSkills = new Proxy(['project-coordination'], {
    ownKeys(target) {
      skillKeyReads += 1;
      return skillKeyReads === 1 ? Reflect.ownKeys(target) : ['0', '1', 'length'];
    },
    getOwnPropertyDescriptor(target, key) {
      if (key === '1') return { value: 'raced', enumerable: true, configurable: true };
      return Reflect.getOwnPropertyDescriptor(target, key);
    },
  });
  assert.throws(() => domain.createReviewedHostedIdentityMapping(
    mappingFixture({ skills: racingSkills })),
  { message: 'Invalid hosted agent presence input' });
});

test('hosted presence contract remains dormant with zero runtime import or side-effect boundary', async () => {
  const source = await readFile(moduleUrl, 'utf8');
  assert.equal(/^\s*import\s/m.test(source), false);
  assert.equal(/\b(fetch|WebSocket|EventSource|setTimeout|setInterval)\s*\(/.test(source), false);
  assert.equal(/\b(process\.env|localStorage|sessionStorage|indexedDB|supabase|sqlite)\b/i.test(source), false);
  assert.equal(/Math\.random|Date\.now/.test(source), false);

  const sourceRoot = new URL('../src/', import.meta.url);
  const entries = await readdir(sourceRoot, { recursive: true });
  for (const entry of entries.filter((name) => /\.(?:ts|js)$/.test(name))) {
    if (entry === 'domain/hostedAgentPresence.ts') continue;
    const content = await readFile(new URL(entry, sourceRoot), 'utf8');
    assert.equal(content.includes('hostedAgentPresence'), false, `unexpected runtime importer: ${entry}`);
  }
});
