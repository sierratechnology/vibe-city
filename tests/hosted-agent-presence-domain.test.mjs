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

test('source status rejects coercible objects without invoking coercion or retaining caller values', async () => {
  const domain = await loadDomain();
  const mapping = domain.createReviewedHostedIdentityMapping(mappingFixture());
  const request = domain.createHostedPresenceRequest(mapping, {
    boardScope: 'default', profileName: 'spiders', mappingRevision: 7,
    evaluatedAt: '2026-09-27T10:01:00.000Z',
  });
  let coercionCalls = 0;
  const coercibleStatus = {
    mutablePrivateDetail: 'must not be retained',
    [Symbol.toPrimitive]() {
      coercionCalls += 1;
      return 'available';
    },
  };
  const boxedStatus = new String('available');
  Object.defineProperty(boxedStatus, Symbol.toPrimitive, {
    value() {
      coercionCalls += 1;
      return 'available';
    },
  });

  for (const status of [coercibleStatus, boxedStatus]) {
    let accepted;
    assert.throws(() => {
      accepted = domain.createHermesPresenceObservation(mapping, request, {
        profileName: 'spiders', mappingRevision: 7,
        observedAt: '2026-09-27T10:00:30.000Z', status,
        reason: 'source_available', currentRun: null, decisiveEvent: null,
      });
    }, { message: 'Invalid hosted agent presence input' });
    assert.equal(accepted, undefined);
  }
  assert.equal(coercionCalls, 0);
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

test('recent blocked run is closed detached frozen and chronologically coherent', async () => {
  const domain = await loadDomain();
  const mapping = domain.createReviewedHostedIdentityMapping(mappingFixture());
  const request = domain.createHostedPresenceRequest(mapping, {
    boardScope: 'default', profileName: 'spiders', mappingRevision: 7,
    evaluatedAt: '2026-09-27T10:01:00.000Z',
  });
  const recentRun = {
    runId: 'id_3333333333333333', taskId: 'id_4444444444444444', status: 'blocked',
    outcome: 'blocked', claimedAt: '2026-09-27T10:00:05.000Z',
    spawnedAt: '2026-09-27T10:00:10.000Z', endedAt: '2026-09-27T10:00:20.000Z',
    blockReason: 'needs_input',
  };
  const input = {
    profileName: 'spiders', mappingRevision: 7,
    observedAt: '2026-09-27T10:00:30.000Z', status: 'available',
    reason: 'source_available', currentRun: null, recentRun, decisiveEvent: null,
  };

  const accepted = domain.createHermesPresenceObservation(mapping, request, input);
  assert.deepEqual(accepted, input);
  assert.notEqual(accepted.recentRun, recentRun);
  assert.equal(Object.isFrozen(accepted.recentRun), true);
  recentRun.blockReason = 'capability';
  assert.equal(accepted.recentRun.blockReason, 'needs_input');

  for (const candidate of [
    { ...recentRun, blockReason: 'free form detail' },
    { ...recentRun, privateDetail: 'do not retain' },
    { ...recentRun, claimedAt: '2026-09-27T09:59:59.999Z' },
    { ...recentRun, spawnedAt: '2026-09-27T10:00:04.999Z' },
    { ...recentRun, endedAt: '2026-09-27T10:00:30.001Z' },
  ]) {
    assert.throws(() => domain.createHermesPresenceObservation(mapping, request, {
      ...input, recentRun: candidate,
    }), { message: 'Invalid hosted agent presence input' });
  }
});

test('block reason rejects coercible objects without invoking coercion or retaining caller values', async () => {
  const domain = await loadDomain();
  const mapping = domain.createReviewedHostedIdentityMapping(mappingFixture());
  const request = domain.createHostedPresenceRequest(mapping, {
    boardScope: 'default', profileName: 'spiders', mappingRevision: 7,
    evaluatedAt: '2026-09-27T10:01:00.000Z',
  });
  const recentRun = {
    runId: 'id_3333333333333333', taskId: 'id_4444444444444444', status: 'blocked',
    outcome: 'blocked', claimedAt: '2026-09-27T10:00:05.000Z',
    spawnedAt: '2026-09-27T10:00:10.000Z', endedAt: '2026-09-27T10:00:20.000Z',
    blockReason: 'dependency',
  };
  const decisiveEvent = {
    eventId: 'id_5555555555555555', runId: recentRun.runId,
    kind: 'blocked', occurredAt: recentRun.endedAt, blockReason: 'dependency',
  };
  let coercionCalls = 0;
  const coercibleReason = {
    mutablePrivateDetail: 'must not be retained',
    [Symbol.toPrimitive]() {
      coercionCalls += 1;
      return 'dependency';
    },
  };
  const boxedReason = new String('dependency');
  Object.defineProperty(boxedReason, Symbol.toPrimitive, {
    value() {
      coercionCalls += 1;
      return 'dependency';
    },
  });

  for (const reason of [coercibleReason, boxedReason]) {
    for (const [recentReason, eventReason] of [
      [reason, reason],
      ['dependency', reason],
    ]) {
      let accepted;
      assert.throws(() => {
        accepted = domain.createHermesPresenceObservation(mapping, request, {
          profileName: 'spiders', mappingRevision: 7,
          observedAt: '2026-09-27T10:00:30.000Z', status: 'available',
          reason: 'source_available', currentRun: null,
          recentRun: { ...recentRun, blockReason: recentReason },
          decisiveEvent: { ...decisiveEvent, blockReason: eventReason },
        });
      }, { message: 'Invalid hosted agent presence input' });
      assert.equal(accepted, undefined);
    }
  }
  assert.equal(coercionCalls, 0);
});

test('decisive blocked event binds exactly to one recent run and rejects contradictory facts', async () => {
  const domain = await loadDomain();
  const mapping = domain.createReviewedHostedIdentityMapping(mappingFixture());
  const request = domain.createHostedPresenceRequest(mapping, {
    boardScope: 'default', profileName: 'spiders', mappingRevision: 7,
    evaluatedAt: '2026-09-27T10:01:00.000Z',
  });
  const recentRun = {
    runId: 'id_3333333333333333', taskId: 'id_4444444444444444', status: 'blocked',
    outcome: 'blocked', claimedAt: '2026-09-27T10:00:05.000Z',
    spawnedAt: '2026-09-27T10:00:10.000Z', endedAt: '2026-09-27T10:00:20.000Z',
    blockReason: 'needs_input',
  };
  const decisiveEvent = {
    eventId: 'id_5555555555555555', runId: recentRun.runId,
    kind: 'blocked', occurredAt: recentRun.endedAt, blockReason: recentRun.blockReason,
  };
  const input = {
    profileName: 'spiders', mappingRevision: 7,
    observedAt: '2026-09-27T10:00:30.000Z', status: 'available',
    reason: 'source_available', currentRun: null, recentRun, decisiveEvent,
  };

  const accepted = domain.createHermesPresenceObservation(mapping, request, input);
  assert.deepEqual(accepted, input);
  assert.notEqual(accepted.decisiveEvent, decisiveEvent);
  assert.equal(Object.isFrozen(accepted.decisiveEvent), true);

  const hostileEvent = Object.create(decisiveEvent);
  const accessorEvent = Object.defineProperty({ ...decisiveEvent }, 'blockReason', {
    get: () => recentRun.blockReason,
  });
  let ownKeyReads = 0;
  const racingEvent = new Proxy({ ...decisiveEvent }, {
    ownKeys(target) {
      ownKeyReads += 1;
      return ownKeyReads === 1 ? Reflect.ownKeys(target) : [...Reflect.ownKeys(target), 'raced'];
    },
    getOwnPropertyDescriptor(target, key) {
      if (key === 'raced') return { value: true, enumerable: true, configurable: true };
      return Reflect.getOwnPropertyDescriptor(target, key);
    },
  });
  for (const event of [
    { ...decisiveEvent, runId: 'id_6666666666666666' },
    { ...decisiveEvent, occurredAt: '2026-09-27T10:00:20.001Z' },
    { ...decisiveEvent, blockReason: 'capability' },
    { ...decisiveEvent, detail: 'private task body' },
    { ...decisiveEvent, kind: 'heartbeat' },
    hostileEvent,
    accessorEvent,
    racingEvent,
  ]) {
    assert.throws(() => domain.createHermesPresenceObservation(mapping, request, {
      ...input, decisiveEvent: event,
    }), { message: 'Invalid hosted agent presence input' });
  }

  const currentRun = {
    runId: 'id_7777777777777777', taskId: 'id_8888888888888888', status: 'running',
    outcome: null, claimedAt: '2026-09-27T10:00:05.000Z',
    spawnedAt: '2026-09-27T10:00:10.000Z', pid: 321, pidLive: true,
    heartbeatAt: '2026-09-27T10:00:25.000Z',
  };
  assert.throws(() => domain.createHermesPresenceObservation(mapping, request, {
    ...input,
    currentRun,
    decisiveEvent: {
      eventId: 'id_9999999999999999', runId: currentRun.runId,
      kind: 'heartbeat', occurredAt: currentRun.heartbeatAt,
    },
  }), { message: 'Invalid hosted agent presence input' });
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

test('derived state accepts only an exact trusted mapping and its exact bound observation', async () => {
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
  assert.equal(typeof domain.deriveHostedAgentPresenceState, 'function');
  assert.doesNotThrow(() => domain.deriveHostedAgentPresenceState(mapping, observation));

  const identicalMapping = domain.createReviewedHostedIdentityMapping(mappingFixture());
  for (const [candidateMapping, candidateObservation] of [
    [{ ...mapping }, observation],
    [Object.create(mapping), observation],
    [new Proxy(mapping, {}), observation],
    [mapping, { ...observation }],
    [mapping, Object.create(observation)],
    [mapping, new Proxy(observation, {})],
    [identicalMapping, observation],
  ]) {
    assert.throws(
      () => domain.deriveHostedAgentPresenceState(candidateMapping, candidateObservation),
      { message: 'Invalid hosted agent presence input' },
    );
  }
});

test('available observation with a validated current run derives working from its heartbeat', async () => {
  const domain = await loadDomain();
  const mapping = domain.createReviewedHostedIdentityMapping(mappingFixture());
  const request = domain.createHostedPresenceRequest(mapping, {
    boardScope: 'default', profileName: 'spiders', mappingRevision: 7,
    evaluatedAt: '2026-09-27T10:01:00.000Z',
  });
  const currentRun = {
    runId: 'id_3333333333333333', taskId: 'id_4444444444444444', status: 'running',
    outcome: null, claimedAt: '2026-09-27T10:00:00.000Z',
    spawnedAt: '2026-09-27T10:00:05.000Z', pid: 321, pidLive: true,
    heartbeatAt: '2026-09-27T10:00:20.000Z',
  };
  const observation = domain.createHermesPresenceObservation(mapping, request, {
    profileName: 'spiders', mappingRevision: 7,
    observedAt: '2026-09-27T10:00:30.000Z', status: 'available',
    reason: 'source_available', currentRun,
    decisiveEvent: {
      eventId: 'id_5555555555555555', runId: currentRun.runId,
      kind: 'heartbeat', occurredAt: currentRun.heartbeatAt,
    },
  });

  assert.deepEqual(domain.deriveHostedAgentPresenceState(mapping, observation), {
    identityId: 'stg-spiders',
    subjectId: IDS.subject,
    profileName: 'spiders',
    state: 'working',
    reason: 'heartbeat',
    observedAt: '2026-09-27T10:00:30.000Z',
    taskId: currentRun.taskId,
    runId: currentRun.runId,
  });
});

test('coherent live run with exact reviewing activity evidence derives frozen minimal reviewing', async () => {
  const domain = await loadDomain();
  const mapping = domain.createReviewedHostedIdentityMapping(mappingFixture());
  const request = domain.createHostedPresenceRequest(mapping, {
    boardScope: 'default', profileName: 'spiders', mappingRevision: 7,
    evaluatedAt: '2026-09-27T10:01:00.000Z',
  });
  const currentRun = {
    runId: 'id_3333333333333333', taskId: 'id_4444444444444444', status: 'running',
    outcome: null, claimedAt: '2026-09-27T10:00:00.000Z',
    spawnedAt: '2026-09-27T10:00:05.000Z', pid: 321, pidLive: true,
    heartbeatAt: '2026-09-27T10:00:20.000Z',
  };
  const currentActivity = {
    runId: currentRun.runId, taskId: currentRun.taskId,
    activity: 'reviewing', occurredAt: '2026-09-27T10:00:15.000Z',
  };
  const observation = domain.createHermesPresenceObservation(mapping, request, {
    profileName: 'spiders', mappingRevision: 7,
    observedAt: '2026-09-27T10:00:30.000Z', status: 'available',
    reason: 'source_available', currentRun,
    decisiveEvent: {
      eventId: 'id_5555555555555555', runId: currentRun.runId,
      kind: 'heartbeat', occurredAt: currentRun.heartbeatAt,
    },
    currentActivity,
    activityEvent: {
      eventId: 'id_6666666666666666', runId: currentRun.runId,
      taskId: currentRun.taskId, activity: 'reviewing',
      occurredAt: currentActivity.occurredAt,
    },
  });

  const result = domain.deriveHostedAgentPresenceState(mapping, observation);
  assert.deepEqual(result, {
    identityId: 'stg-spiders',
    subjectId: IDS.subject,
    profileName: 'spiders',
    state: 'reviewing',
    reason: 'review_activity',
    observedAt: '2026-09-27T10:00:30.000Z',
    taskId: currentRun.taskId,
    runId: currentRun.runId,
  });
  assert.equal(Object.isFrozen(result), true);
  assert.deepEqual(Reflect.ownKeys(result), [
    'identityId', 'subjectId', 'profileName', 'state', 'reason', 'observedAt',
    'taskId', 'runId',
  ]);
});

test('reviewing requires both exact activity facts while an ordinary live run stays working', async () => {
  const domain = await loadDomain();
  const mapping = domain.createReviewedHostedIdentityMapping(mappingFixture());
  const request = domain.createHostedPresenceRequest(mapping, {
    boardScope: 'default', profileName: 'spiders', mappingRevision: 7,
    evaluatedAt: '2026-09-27T10:01:00.000Z',
  });
  const currentRun = {
    runId: 'id_3333333333333333', taskId: 'id_4444444444444444', status: 'running',
    outcome: null, claimedAt: '2026-09-27T10:00:00.000Z',
    spawnedAt: '2026-09-27T10:00:05.000Z', pid: 321, pidLive: true,
    heartbeatAt: '2026-09-27T10:00:20.000Z',
  };
  const currentActivity = {
    runId: currentRun.runId, taskId: currentRun.taskId,
    activity: 'reviewing', occurredAt: '2026-09-27T10:00:15.000Z',
  };
  const activityEvent = {
    eventId: 'id_6666666666666666', runId: currentRun.runId,
    taskId: currentRun.taskId, activity: 'reviewing',
    occurredAt: currentActivity.occurredAt,
  };
  const base = {
    profileName: 'spiders', mappingRevision: 7,
    observedAt: '2026-09-27T10:00:30.000Z', status: 'available',
    reason: 'source_available', currentRun,
    decisiveEvent: {
      eventId: 'id_5555555555555555', runId: currentRun.runId,
      kind: 'heartbeat', occurredAt: currentRun.heartbeatAt,
    },
  };

  const ordinary = domain.createHermesPresenceObservation(mapping, request, base);
  assert.equal(domain.deriveHostedAgentPresenceState(mapping, ordinary).state, 'working');

  for (const input of [
    { ...base, currentActivity },
    { ...base, activityEvent },
    { ...base, currentActivity, activityEvent: {
      ...activityEvent, runId: 'id_7777777777777777',
    } },
    { ...base, currentActivity, activityEvent: {
      ...activityEvent, taskId: 'id_7777777777777777',
    } },
    { ...base, currentActivity, activityEvent: {
      ...activityEvent, occurredAt: '2026-09-27T10:00:15.001Z',
    } },
  ]) {
    assert.throws(() => domain.createHermesPresenceObservation(mapping, request, input),
      { message: 'Invalid hosted agent presence input' });
  }
});

test('hostile reviewing discriminators fail closed without coercion or retention', async () => {
  const domain = await loadDomain();
  const mapping = domain.createReviewedHostedIdentityMapping(mappingFixture());
  const request = domain.createHostedPresenceRequest(mapping, {
    boardScope: 'default', profileName: 'spiders', mappingRevision: 7,
    evaluatedAt: '2026-09-27T10:01:00.000Z',
  });
  const currentRun = {
    runId: 'id_3333333333333333', taskId: 'id_4444444444444444', status: 'running',
    outcome: null, claimedAt: '2026-09-27T10:00:00.000Z',
    spawnedAt: '2026-09-27T10:00:05.000Z', pid: 321, pidLive: true,
    heartbeatAt: '2026-09-27T10:00:20.000Z',
  };
  const currentActivity = {
    runId: currentRun.runId, taskId: currentRun.taskId,
    activity: 'reviewing', occurredAt: '2026-09-27T10:00:15.000Z',
  };
  const activityEvent = {
    eventId: 'id_6666666666666666', runId: currentRun.runId,
    taskId: currentRun.taskId, activity: 'reviewing',
    occurredAt: currentActivity.occurredAt,
  };
  const base = {
    profileName: 'spiders', mappingRevision: 7,
    observedAt: '2026-09-27T10:00:30.000Z', status: 'available',
    reason: 'source_available', currentRun,
    decisiveEvent: {
      eventId: 'id_5555555555555555', runId: currentRun.runId,
      kind: 'heartbeat', occurredAt: currentRun.heartbeatAt,
    },
  };
  let coercionCalls = 0;
  const coercible = {
    mutableReviewDetail: 'must not be retained',
    [Symbol.toPrimitive]() {
      coercionCalls += 1;
      return 'reviewing';
    },
  };
  const boxed = new String('reviewing');
  Object.defineProperty(boxed, Symbol.toPrimitive, {
    value() {
      coercionCalls += 1;
      return 'reviewing';
    },
  });

  for (const activity of [coercible, boxed, Symbol('reviewing'), 1, true, null]) {
    for (const input of [
      { ...base, currentActivity: { ...currentActivity, activity }, activityEvent },
      { ...base, currentActivity, activityEvent: { ...activityEvent, activity } },
    ]) {
      let accepted;
      assert.throws(() => {
        accepted = domain.createHermesPresenceObservation(mapping, request, input);
      }, { message: 'Invalid hosted agent presence input' });
      assert.equal(accepted, undefined);
    }
  }
  assert.equal(coercionCalls, 0);
});

test('reviewing activity rejects malformed or out-of-run chronology', async () => {
  const domain = await loadDomain();
  const mapping = domain.createReviewedHostedIdentityMapping(mappingFixture());
  const request = domain.createHostedPresenceRequest(mapping, {
    boardScope: 'default', profileName: 'spiders', mappingRevision: 7,
    evaluatedAt: '2026-09-27T10:01:00.000Z',
  });
  const currentRun = {
    runId: 'id_3333333333333333', taskId: 'id_4444444444444444', status: 'running',
    outcome: null, claimedAt: '2026-09-27T10:00:00.000Z',
    spawnedAt: '2026-09-27T10:00:05.000Z', pid: 321, pidLive: true,
    heartbeatAt: '2026-09-27T10:00:20.000Z',
  };
  const base = {
    profileName: 'spiders', mappingRevision: 7,
    observedAt: '2026-09-27T10:00:30.000Z', status: 'available',
    reason: 'source_available', currentRun,
    decisiveEvent: {
      eventId: 'id_5555555555555555', runId: currentRun.runId,
      kind: 'heartbeat', occurredAt: currentRun.heartbeatAt,
    },
  };

  for (const occurredAt of [
    '2026-09-27T10:00:04.999Z',
    '2026-09-27T10:00:20.001Z',
    '2026-09-27T10:00:30.001Z',
    'not-a-timestamp',
  ]) {
    const currentActivity = {
      runId: currentRun.runId, taskId: currentRun.taskId,
      activity: 'reviewing', occurredAt,
    };
    assert.throws(() => domain.createHermesPresenceObservation(mapping, request, {
      ...base,
      currentActivity,
      activityEvent: {
        eventId: 'id_6666666666666666', runId: currentRun.runId,
        taskId: currentRun.taskId, activity: 'reviewing', occurredAt,
      },
    }), { message: 'Invalid hosted agent presence input' });
  }
});

test('reviewing evidence rejects hostile snapshots', async () => {
  const domain = await loadDomain();
  const mapping = domain.createReviewedHostedIdentityMapping(mappingFixture());
  const request = domain.createHostedPresenceRequest(mapping, {
    boardScope: 'default', profileName: 'spiders', mappingRevision: 7,
    evaluatedAt: '2026-09-27T10:01:00.000Z',
  });
  const currentRun = {
    runId: 'id_3333333333333333', taskId: 'id_4444444444444444', status: 'running',
    outcome: null, claimedAt: '2026-09-27T10:00:00.000Z',
    spawnedAt: '2026-09-27T10:00:05.000Z', pid: 321, pidLive: true,
    heartbeatAt: '2026-09-27T10:00:20.000Z',
  };
  const currentActivity = {
    runId: currentRun.runId, taskId: currentRun.taskId,
    activity: 'reviewing', occurredAt: '2026-09-27T10:00:15.000Z',
  };
  const activityEvent = {
    eventId: 'id_6666666666666666', runId: currentRun.runId,
    taskId: currentRun.taskId, activity: 'reviewing',
    occurredAt: currentActivity.occurredAt,
  };
  const base = {
    profileName: 'spiders', mappingRevision: 7,
    observedAt: '2026-09-27T10:00:30.000Z', status: 'available',
    reason: 'source_available', currentRun,
    decisiveEvent: {
      eventId: 'id_5555555555555555', runId: currentRun.runId,
      kind: 'heartbeat', occurredAt: currentRun.heartbeatAt,
    },
  };
  let accessorCalls = 0;
  const accessorActivity = Object.defineProperty({ ...currentActivity }, 'activity', {
    get() {
      accessorCalls += 1;
      return 'reviewing';
    },
  });
  const accessorEvent = Object.defineProperty({ ...activityEvent }, 'activity', {
    get() {
      accessorCalls += 1;
      return 'reviewing';
    },
  });
  const racing = (value) => {
    let ownKeyReads = 0;
    return new Proxy({ ...value }, {
      ownKeys(target) {
        ownKeyReads += 1;
        return ownKeyReads === 1 ? Reflect.ownKeys(target) : [...Reflect.ownKeys(target), 'raced'];
      },
      getOwnPropertyDescriptor(target, key) {
        if (key === 'raced') return { value: true, enumerable: true, configurable: true };
        return Reflect.getOwnPropertyDescriptor(target, key);
      },
    });
  };

  for (const [activity, event] of [
    [{ ...currentActivity, reviewSubject: 'must not be retained' }, activityEvent],
    [currentActivity, { ...activityEvent, reviewVerdict: 'must not be retained' }],
    [accessorActivity, activityEvent],
    [currentActivity, accessorEvent],
    [racing(currentActivity), activityEvent],
    [currentActivity, racing(activityEvent)],
  ]) {
    assert.throws(() => domain.createHermesPresenceObservation(mapping, request, {
      ...base, currentActivity: activity, activityEvent: event,
    }), { message: 'Invalid hosted agent presence input' });
  }
  assert.equal(accessorCalls, 0);
});

test('non-current mappings cannot present reviewing presence', async () => {
  const domain = await loadDomain();
  const currentRun = {
    runId: 'id_3333333333333333', taskId: 'id_4444444444444444', status: 'running',
    outcome: null, claimedAt: '2026-09-27T10:00:00.000Z',
    spawnedAt: '2026-09-27T10:00:05.000Z', pid: 321, pidLive: true,
    heartbeatAt: '2026-09-27T10:00:20.000Z',
  };
  const currentActivity = {
    runId: currentRun.runId, taskId: currentRun.taskId,
    activity: 'reviewing', occurredAt: '2026-09-27T10:00:15.000Z',
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
      reason: 'source_available', currentRun,
      decisiveEvent: {
        eventId: 'id_5555555555555555', runId: currentRun.runId,
        kind: 'heartbeat', occurredAt: currentRun.heartbeatAt,
      },
      currentActivity,
      activityEvent: {
        eventId: 'id_6666666666666666', runId: currentRun.runId,
        taskId: currentRun.taskId, activity: 'reviewing',
        occurredAt: currentActivity.occurredAt,
      },
    }), { message: 'Invalid hosted agent presence input' });
  }
});

test('exact trusted blocked facts derive a frozen minimal blocked result without reason detail', async () => {
  const domain = await loadDomain();
  const mapping = domain.createReviewedHostedIdentityMapping(mappingFixture());
  const request = domain.createHostedPresenceRequest(mapping, {
    boardScope: 'default', profileName: 'spiders', mappingRevision: 7,
    evaluatedAt: '2026-09-27T10:01:00.000Z',
  });
  const recentRun = {
    runId: 'id_3333333333333333', taskId: 'id_4444444444444444', status: 'blocked',
    outcome: 'blocked', claimedAt: '2026-09-27T10:00:05.000Z',
    spawnedAt: '2026-09-27T10:00:10.000Z', endedAt: '2026-09-27T10:00:20.000Z',
    blockReason: 'needs_input',
  };
  const base = {
    profileName: 'spiders', mappingRevision: 7,
    observedAt: '2026-09-27T10:00:30.000Z', status: 'available',
    reason: 'source_available', currentRun: null, recentRun,
  };
  const observation = domain.createHermesPresenceObservation(mapping, request, {
    ...base,
    decisiveEvent: {
      eventId: 'id_5555555555555555', runId: recentRun.runId,
      kind: 'blocked', occurredAt: recentRun.endedAt, blockReason: recentRun.blockReason,
    },
  });

  const result = domain.deriveHostedAgentPresenceState(mapping, observation);
  assert.deepEqual(result, {
    identityId: 'stg-spiders',
    subjectId: IDS.subject,
    profileName: 'spiders',
    state: 'blocked',
    reason: 'run_blocked',
    observedAt: '2026-09-27T10:00:30.000Z',
    taskId: recentRun.taskId,
    runId: recentRun.runId,
  });
  assert.equal(Object.isFrozen(result), true);
  assert.deepEqual(Reflect.ownKeys(result), [
    'identityId', 'subjectId', 'profileName', 'state', 'reason', 'observedAt',
    'taskId', 'runId',
  ]);
  assert.equal('blockReason' in result, false);

  const recentOnly = domain.createHermesPresenceObservation(mapping, request, {
    ...base, decisiveEvent: null,
  });
  assert.equal(domain.deriveHostedAgentPresenceState(mapping, recentOnly).state, 'idle');
});

test('coherent completed run with its decisive event derives a frozen minimal completed result', async () => {
  const domain = await loadDomain();
  const mapping = domain.createReviewedHostedIdentityMapping(mappingFixture());
  const request = domain.createHostedPresenceRequest(mapping, {
    boardScope: 'default', profileName: 'spiders', mappingRevision: 7,
    evaluatedAt: '2026-09-27T10:01:00.000Z',
  });
  const recentRun = {
    runId: 'id_3333333333333333', taskId: 'id_4444444444444444', status: 'completed',
    outcome: 'completed', claimedAt: '2026-09-27T10:00:05.000Z',
    spawnedAt: '2026-09-27T10:00:10.000Z', endedAt: '2026-09-27T10:00:20.000Z',
  };
  const observation = domain.createHermesPresenceObservation(mapping, request, {
    profileName: 'spiders', mappingRevision: 7,
    observedAt: '2026-09-27T10:00:30.000Z', status: 'available',
    reason: 'source_available', currentRun: null, recentRun,
    decisiveEvent: {
      eventId: 'id_5555555555555555', runId: recentRun.runId,
      kind: 'completed', occurredAt: recentRun.endedAt,
    },
  });

  const result = domain.deriveHostedAgentPresenceState(mapping, observation);
  assert.deepEqual(result, {
    identityId: 'stg-spiders',
    subjectId: IDS.subject,
    profileName: 'spiders',
    state: 'completed',
    reason: 'run_completed',
    observedAt: '2026-09-27T10:00:30.000Z',
    taskId: recentRun.taskId,
    runId: recentRun.runId,
  });
  assert.equal(Object.isFrozen(result), true);
  assert.deepEqual(Reflect.ownKeys(result), [
    'identityId', 'subjectId', 'profileName', 'state', 'reason', 'observedAt',
    'taskId', 'runId',
  ]);
});

test('incomplete or mismatched completion evidence never derives completed', async () => {
  const domain = await loadDomain();
  const mapping = domain.createReviewedHostedIdentityMapping(mappingFixture());
  const request = domain.createHostedPresenceRequest(mapping, {
    boardScope: 'default', profileName: 'spiders', mappingRevision: 7,
    evaluatedAt: '2026-09-27T10:01:00.000Z',
  });
  const recentRun = {
    runId: 'id_3333333333333333', taskId: 'id_4444444444444444', status: 'completed',
    outcome: 'completed', claimedAt: '2026-09-27T10:00:05.000Z',
    spawnedAt: '2026-09-27T10:00:10.000Z', endedAt: '2026-09-27T10:00:20.000Z',
  };
  const event = {
    eventId: 'id_5555555555555555', runId: recentRun.runId,
    kind: 'completed', occurredAt: recentRun.endedAt,
  };
  const base = {
    profileName: 'spiders', mappingRevision: 7,
    observedAt: '2026-09-27T10:00:30.000Z', status: 'available',
    reason: 'source_available', currentRun: null,
  };

  const runOnly = domain.createHermesPresenceObservation(mapping, request, {
    ...base, recentRun, decisiveEvent: null,
  });
  assert.equal(domain.deriveHostedAgentPresenceState(mapping, runOnly).state, 'idle');

  for (const input of [
    { ...base, decisiveEvent: event },
    { ...base, cardStatus: 'done', decisiveEvent: null },
    { ...base, recentRun, decisiveEvent: { ...event, runId: 'id_6666666666666666' } },
    { ...base, recentRun, decisiveEvent: { ...event, occurredAt: '2026-09-27T10:00:20.001Z' } },
    { ...base, recentRun, decisiveEvent: { ...event, kind: 'blocked' } },
  ]) {
    assert.throws(() => domain.createHermesPresenceObservation(mapping, request, input),
      { message: 'Invalid hosted agent presence input' });
  }
});

test('hostile completion discriminators fail closed without coercion or retention', async () => {
  const domain = await loadDomain();
  const mapping = domain.createReviewedHostedIdentityMapping(mappingFixture());
  const request = domain.createHostedPresenceRequest(mapping, {
    boardScope: 'default', profileName: 'spiders', mappingRevision: 7,
    evaluatedAt: '2026-09-27T10:01:00.000Z',
  });
  const recentRun = {
    runId: 'id_3333333333333333', taskId: 'id_4444444444444444', status: 'completed',
    outcome: 'completed', claimedAt: '2026-09-27T10:00:05.000Z',
    spawnedAt: '2026-09-27T10:00:10.000Z', endedAt: '2026-09-27T10:00:20.000Z',
  };
  const decisiveEvent = {
    eventId: 'id_5555555555555555', runId: recentRun.runId,
    kind: 'completed', occurredAt: recentRun.endedAt,
  };
  const base = {
    profileName: 'spiders', mappingRevision: 7,
    observedAt: '2026-09-27T10:00:30.000Z', status: 'available',
    reason: 'source_available', currentRun: null, recentRun, decisiveEvent,
  };
  let coercionCalls = 0;
  const coercible = {
    mutablePrivateDetail: 'must not be retained',
    [Symbol.toPrimitive]() {
      coercionCalls += 1;
      return 'completed';
    },
  };
  const boxed = new String('completed');
  Object.defineProperty(boxed, Symbol.toPrimitive, {
    value() {
      coercionCalls += 1;
      return 'completed';
    },
  });

  for (const discriminator of [coercible, boxed, Symbol('completed'), 1, true, null]) {
    for (const input of [
      { ...base, recentRun: { ...recentRun, status: discriminator } },
      { ...base, recentRun: { ...recentRun, outcome: discriminator } },
      { ...base, decisiveEvent: { ...decisiveEvent, kind: discriminator } },
    ]) {
      let accepted;
      assert.throws(() => {
        accepted = domain.createHermesPresenceObservation(mapping, request, input);
      }, { message: 'Invalid hosted agent presence input' });
      assert.equal(accepted, undefined);
    }
  }
  assert.equal(coercionCalls, 0);
});

test('completion run rejects stale malformed or hostile snapshots', async () => {
  const domain = await loadDomain();
  const mapping = domain.createReviewedHostedIdentityMapping(mappingFixture());
  const request = domain.createHostedPresenceRequest(mapping, {
    boardScope: 'default', profileName: 'spiders', mappingRevision: 7,
    evaluatedAt: '2026-09-27T10:01:00.000Z',
  });
  const recentRun = {
    runId: 'id_3333333333333333', taskId: 'id_4444444444444444', status: 'completed',
    outcome: 'completed', claimedAt: '2026-09-27T10:00:05.000Z',
    spawnedAt: '2026-09-27T10:00:10.000Z', endedAt: '2026-09-27T10:00:20.000Z',
  };
  const decisiveEvent = {
    eventId: 'id_5555555555555555', runId: recentRun.runId,
    kind: 'completed', occurredAt: recentRun.endedAt,
  };
  const base = {
    profileName: 'spiders', mappingRevision: 7,
    observedAt: '2026-09-27T10:00:30.000Z', status: 'available',
    reason: 'source_available', currentRun: null, decisiveEvent,
  };
  let accessorCalls = 0;
  const accessorRun = Object.defineProperty({ ...recentRun }, 'outcome', {
    get() {
      accessorCalls += 1;
      return 'completed';
    },
  });
  let ownKeyReads = 0;
  const racingRun = new Proxy({ ...recentRun }, {
    ownKeys(target) {
      ownKeyReads += 1;
      return ownKeyReads === 1 ? Reflect.ownKeys(target) : [...Reflect.ownKeys(target), 'raced'];
    },
    getOwnPropertyDescriptor(target, key) {
      if (key === 'raced') return { value: true, enumerable: true, configurable: true };
      return Reflect.getOwnPropertyDescriptor(target, key);
    },
  });

  for (const candidate of [
    { ...recentRun, claimedAt: '2026-09-27T09:59:59.999Z' },
    { ...recentRun, claimedAt: '2026-09-27T10:00:10.001Z' },
    { ...recentRun, spawnedAt: '2026-09-27T10:00:20.001Z' },
    { ...recentRun, endedAt: '2026-09-27T10:00:30.001Z' },
    { ...recentRun, endedAt: 'not-a-timestamp' },
    { ...recentRun, privateSummary: 'must not be retained' },
    accessorRun,
    racingRun,
  ]) {
    assert.throws(() => domain.createHermesPresenceObservation(mapping, request, {
      ...base, recentRun: candidate,
    }), { message: 'Invalid hosted agent presence input' });
  }
  assert.equal(accessorCalls, 0);
});

test('completion event rejects hostile snapshots', async () => {
  const domain = await loadDomain();
  const mapping = domain.createReviewedHostedIdentityMapping(mappingFixture());
  const request = domain.createHostedPresenceRequest(mapping, {
    boardScope: 'default', profileName: 'spiders', mappingRevision: 7,
    evaluatedAt: '2026-09-27T10:01:00.000Z',
  });
  const recentRun = {
    runId: 'id_3333333333333333', taskId: 'id_4444444444444444', status: 'completed',
    outcome: 'completed', claimedAt: '2026-09-27T10:00:05.000Z',
    spawnedAt: '2026-09-27T10:00:10.000Z', endedAt: '2026-09-27T10:00:20.000Z',
  };
  const decisiveEvent = {
    eventId: 'id_5555555555555555', runId: recentRun.runId,
    kind: 'completed', occurredAt: recentRun.endedAt,
  };
  const base = {
    profileName: 'spiders', mappingRevision: 7,
    observedAt: '2026-09-27T10:00:30.000Z', status: 'available',
    reason: 'source_available', currentRun: null, recentRun,
  };
  let accessorCalls = 0;
  const accessorEvent = Object.defineProperty({ ...decisiveEvent }, 'kind', {
    get() {
      accessorCalls += 1;
      return 'completed';
    },
  });
  let ownKeyReads = 0;
  const racingEvent = new Proxy({ ...decisiveEvent }, {
    ownKeys(target) {
      ownKeyReads += 1;
      return ownKeyReads === 1 ? Reflect.ownKeys(target) : [...Reflect.ownKeys(target), 'raced'];
    },
    getOwnPropertyDescriptor(target, key) {
      if (key === 'raced') return { value: true, enumerable: true, configurable: true };
      return Reflect.getOwnPropertyDescriptor(target, key);
    },
  });

  for (const event of [
    { ...decisiveEvent, occurredAt: 'not-a-timestamp' },
    { ...decisiveEvent, privateResult: 'must not be retained' },
    accessorEvent,
    racingEvent,
  ]) {
    assert.throws(() => domain.createHermesPresenceObservation(mapping, request, {
      ...base, decisiveEvent: event,
    }), { message: 'Invalid hosted agent presence input' });
  }
  assert.equal(accessorCalls, 0);
});

test('non-current mappings cannot present completed presence', async () => {
  const domain = await loadDomain();
  const recentRun = {
    runId: 'id_3333333333333333', taskId: 'id_4444444444444444', status: 'completed',
    outcome: 'completed', claimedAt: '2026-09-27T10:00:05.000Z',
    spawnedAt: '2026-09-27T10:00:10.000Z', endedAt: '2026-09-27T10:00:20.000Z',
  };
  const decisiveEvent = {
    eventId: 'id_5555555555555555', runId: recentRun.runId,
    kind: 'completed', occurredAt: recentRun.endedAt,
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
      reason: 'source_available', currentRun: null, recentRun, decisiveEvent,
    }), { message: 'Invalid hosted agent presence input' });
  }
});

test('available observation without a current run derives idle without run identifiers', async () => {
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

  assert.deepEqual(domain.deriveHostedAgentPresenceState(mapping, observation), {
    identityId: 'stg-spiders',
    subjectId: IDS.subject,
    profileName: 'spiders',
    state: 'idle',
    reason: 'source_available',
    observedAt: '2026-09-27T10:00:30.000Z',
  });
});

test('unavailable observation derives offline for active revoked and retired identities', async () => {
  const domain = await loadDomain();
  for (const mappingStatus of ['active', 'revoked', 'retired']) {
    const mapping = domain.createReviewedHostedIdentityMapping(mappingFixture({ status: mappingStatus }));
    const request = domain.createHostedPresenceRequest(mapping, {
      boardScope: 'default', profileName: 'spiders', mappingRevision: 7,
      evaluatedAt: '2026-09-27T10:01:00.000Z',
    });
    const observation = domain.createHermesPresenceObservation(mapping, request, {
      profileName: 'spiders', mappingRevision: 7,
      observedAt: '2026-09-27T10:00:30.000Z', status: 'unavailable',
      reason: 'source_unavailable', currentRun: null, decisiveEvent: null,
    });

    assert.deepEqual(domain.deriveHostedAgentPresenceState(mapping, observation), {
      identityId: 'stg-spiders',
      subjectId: IDS.subject,
      profileName: 'spiders',
      state: 'offline',
      reason: 'source_unavailable',
      observedAt: '2026-09-27T10:00:30.000Z',
    });
  }
});

test('degraded observation derives not_derived without inventing a blocked state', async () => {
  const domain = await loadDomain();
  const mapping = domain.createReviewedHostedIdentityMapping(mappingFixture());
  const request = domain.createHostedPresenceRequest(mapping, {
    boardScope: 'default', profileName: 'spiders', mappingRevision: 7,
    evaluatedAt: '2026-09-27T10:01:00.000Z',
  });
  const observation = domain.createHermesPresenceObservation(mapping, request, {
    profileName: 'spiders', mappingRevision: 7,
    observedAt: '2026-09-27T10:00:30.000Z', status: 'degraded',
    reason: 'heartbeat_delayed', currentRun: null, decisiveEvent: null,
  });

  assert.deepEqual(domain.deriveHostedAgentPresenceState(mapping, observation), {
    identityId: 'stg-spiders',
    subjectId: IDS.subject,
    profileName: 'spiders',
    state: 'not_derived',
    reason: 'heartbeat_delayed',
    observedAt: '2026-09-27T10:00:30.000Z',
  });
});

test('derived output is detached frozen minimal and carries no capability or authority facts', async () => {
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
  const result = domain.deriveHostedAgentPresenceState(mapping, observation);

  assert.equal(Object.isFrozen(result), true);
  assert.deepEqual(Reflect.ownKeys(result), [
    'identityId', 'subjectId', 'profileName', 'state', 'reason', 'observedAt',
  ]);
  assert.equal('taskId' in result, false);
  assert.equal('runId' in result, false);
  assert.equal('skills' in result, false);
  assert.equal('permissions' in result, false);
  assert.equal('actionAuthorities' in result, false);
  assert.throws(() => { result.state = 'working'; }, TypeError);
  assert.equal(result.state, 'idle');
});
