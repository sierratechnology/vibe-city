import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const presenceUrl = new URL('../src/domain/hostedAgentPresence.ts', import.meta.url);
const lifecycleUrl = new URL('../src/domain/hostedAgentIdentityLifecycle.ts', import.meta.url);

async function transpile(url) {
  const source = await readFile(url, 'utf8');
  return ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText;
}

async function loadDomain() {
  const presenceOutput = await transpile(presenceUrl);
  const presenceModuleUrl = `data:text/javascript;base64,${Buffer.from(presenceOutput).toString('base64')}`;
  let lifecycleOutput;
  try {
    lifecycleOutput = await transpile(lifecycleUrl);
  } catch (error) {
    if (error?.code === 'ENOENT') return import(presenceModuleUrl);
    throw error;
  }
  lifecycleOutput = lifecycleOutput.replaceAll('./hostedAgentPresence', presenceModuleUrl);
  const lifecycleModuleUrl = `data:text/javascript;base64,${Buffer.from(lifecycleOutput).toString('base64')}`;
  return { ...await import(presenceModuleUrl), ...await import(lifecycleModuleUrl) };
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

function renameEvent(overrides = {}) {
  return {
    tenantId: IDS.tenant,
    subjectId: IDS.subject,
    identityId: 'stg-spiders',
    oldProfileName: 'spiders',
    newProfileName: 'spiders-renamed',
    priorRevision: 7,
    nextRevision: 8,
    occurredAt: '2026-09-27T10:00:30.000Z',
    ...overrides,
  };
}

function reviewedRenameEvent(domain, overrides = {}) {
  const event = renameEvent(overrides);
  return domain.createHostedIdentityProfileRenameEvent(
    event.tenantId,
    event.subjectId,
    event.identityId,
    event.oldProfileName,
    event.newProfileName,
    event.priorRevision,
    event.nextRevision,
    event.occurredAt,
  );
}

function workplaceReassignmentEvent(overrides = {}) {
  return {
    tenantId: IDS.tenant,
    subjectId: IDS.subject,
    identityId: 'stg-spiders',
    profileName: 'spiders',
    oldWorkplaceLabel: 'Chief Agent Office',
    newWorkplaceLabel: 'Executive Office',
    priorRevision: 7,
    nextRevision: 8,
    occurredAt: '2026-09-27T10:00:30.000Z',
    ...overrides,
  };
}

function reviewedWorkplaceReassignmentEvent(domain, overrides = {}) {
  const event = workplaceReassignmentEvent(overrides);
  return domain.createHostedIdentityWorkplaceReassignmentEvent(
    event.tenantId,
    event.subjectId,
    event.identityId,
    event.profileName,
    event.oldWorkplaceLabel,
    event.newWorkplaceLabel,
    event.priorRevision,
    event.nextRevision,
    event.occurredAt,
  );
}

test('exact reviewed workplace reassignment produces minimal detached frozen historical continuity', async () => {
  const domain = await loadDomain();
  assert.equal(typeof domain.createHostedIdentityWorkplaceReassignmentHistory, 'function');
  const before = domain.createReviewedHostedIdentityMapping(mappingFixture());
  const after = domain.createReviewedHostedIdentityMapping(mappingFixture({
    workplaceLabel: 'Executive Office',
    registryRevision: 8,
    synchronizedAt: '2026-09-27T10:01:00.000Z',
  }));
  const event = domain.createHostedIdentityWorkplaceReassignmentEvent(
    IDS.tenant,
    IDS.subject,
    'stg-spiders',
    'spiders',
    'Chief Agent Office',
    'Executive Office',
    7,
    8,
    '2026-09-27T10:00:30.000Z',
  );

  const history = domain.createHostedIdentityWorkplaceReassignmentHistory(before, after, event);

  assert.deepEqual(history, { ...event, reason: 'workplace_reassigned' });
  assert.notEqual(history, event);
  assert.equal(Object.isFrozen(history), true);
  assert.equal(Object.isFrozen(event), true);
  assert.throws(() => { event.oldWorkplaceLabel = 'tampered'; }, TypeError);
  assert.equal(history.oldWorkplaceLabel, 'Chief Agent Office');
  assert.throws(() => { history.newWorkplaceLabel = 'tampered'; }, TypeError);
});

test('workplace reassignment rejects a no-op workplace', async () => {
  const domain = await loadDomain();
  const before = domain.createReviewedHostedIdentityMapping(mappingFixture());
  const after = domain.createReviewedHostedIdentityMapping(mappingFixture({
    registryRevision: 8,
    synchronizedAt: '2026-09-27T10:01:00.000Z',
  }));

  assert.throws(
    () => domain.createHostedIdentityWorkplaceReassignmentHistory(
      before,
      after,
      reviewedWorkplaceReassignmentEvent(domain, { newWorkplaceLabel: 'Chief Agent Office' }),
    ),
    { message: 'Invalid hosted agent presence input' },
  );
});

test('workplace reassignment accepts only an active adjacent revision with unchanged identity facts', async () => {
  const domain = await loadDomain();
  const acceptedBefore = domain.createReviewedHostedIdentityMapping(mappingFixture());
  const acceptedAfterInput = {
    workplaceLabel: 'Executive Office', registryRevision: 8,
    synchronizedAt: '2026-09-27T10:01:00.000Z',
  };
  const rejectedPairs = [
    [domain.createReviewedHostedIdentityMapping(mappingFixture({ status: 'revoked' })), acceptedAfterInput],
    [acceptedBefore, { ...acceptedAfterInput, status: 'retired' }],
    [acceptedBefore, { ...acceptedAfterInput, tenantId: 'id_9999999999999999' }],
    [acceptedBefore, { ...acceptedAfterInput, subjectId: 'id_9999999999999999' }],
    [acceptedBefore, { ...acceptedAfterInput, profileName: 'other-profile' }],
    [acceptedBefore, { ...acceptedAfterInput, skills: ['different-skill'] }],
    [acceptedBefore, { ...acceptedAfterInput, registryRevision: 7 }],
    [acceptedBefore, { ...acceptedAfterInput, registryRevision: 9 }],
    [acceptedBefore, { ...acceptedAfterInput, synchronizedAt: '2026-09-27T10:00:00.000Z' }],
    [acceptedBefore, { ...acceptedAfterInput, synchronizedAt: '2026-09-27T09:59:59.999Z' }],
  ];

  for (const [before, afterOverrides] of rejectedPairs) {
    const after = domain.createReviewedHostedIdentityMapping(mappingFixture(afterOverrides));
    assert.throws(
      () => domain.createHostedIdentityWorkplaceReassignmentHistory(
        before, after, reviewedWorkplaceReassignmentEvent(domain),
      ),
      { message: 'Invalid hosted agent presence input' },
    );
  }
});

test('workplace reassignment requires one exact closed source event bound to the transition', async () => {
  const domain = await loadDomain();
  const before = domain.createReviewedHostedIdentityMapping(mappingFixture());
  const after = domain.createReviewedHostedIdentityMapping(mappingFixture({
    workplaceLabel: 'Executive Office', registryRevision: 8,
    synchronizedAt: '2026-09-27T10:01:00.000Z',
  }));
  const rejected = [
    workplaceReassignmentEvent({ tenantId: 'id_9999999999999999' }),
    workplaceReassignmentEvent({ subjectId: 'id_9999999999999999' }),
    workplaceReassignmentEvent({ identityId: 'other' }),
    workplaceReassignmentEvent({ profileName: 'other' }),
    workplaceReassignmentEvent({ oldWorkplaceLabel: 'Executive Office' }),
    workplaceReassignmentEvent({ newWorkplaceLabel: 'Chief Agent Office' }),
    workplaceReassignmentEvent({ priorRevision: 6 }),
    workplaceReassignmentEvent({ nextRevision: 9 }),
    workplaceReassignmentEvent({ occurredAt: '2026-09-27T09:59:59.999Z' }),
    workplaceReassignmentEvent({ occurredAt: '2026-09-27T10:01:00.001Z' }),
    workplaceReassignmentEvent({ occurredAt: 'not-a-timestamp' }),
    workplaceReassignmentEvent({ priorRevision: '7' }),
    workplaceReassignmentEvent({ nextRevision: Number.MAX_SAFE_INTEGER + 1 }),
    workplaceReassignmentEvent({ reason: 'free text' }),
    Object.assign(Object.create({ inherited: true }), workplaceReassignmentEvent()),
    Object.defineProperty(workplaceReassignmentEvent(), 'occurredAt', {
      get: () => '2026-09-27T10:00:30.000Z',
    }),
    Object.assign(workplaceReassignmentEvent(), { [Symbol('hidden')]: true }),
  ];

  for (const event of rejected) {
    assert.throws(
      () => domain.createHostedIdentityWorkplaceReassignmentHistory(before, after, event),
      { message: 'Invalid hosted agent presence input' },
    );
  }
});

test('workplace reassignment rejects proxy and racing source events', async () => {
  const domain = await loadDomain();
  const before = domain.createReviewedHostedIdentityMapping(mappingFixture());
  const after = domain.createReviewedHostedIdentityMapping(mappingFixture({
    workplaceLabel: 'Executive Office', registryRevision: 8,
    synchronizedAt: '2026-09-27T10:01:00.000Z',
  }));
  let ownKeyReads = 0;
  const racingEvent = new Proxy(workplaceReassignmentEvent(), {
    ownKeys(target) {
      ownKeyReads += 1;
      return ownKeyReads === 1 ? Reflect.ownKeys(target) : [...Reflect.ownKeys(target), 'raced'];
    },
    getOwnPropertyDescriptor(target, key) {
      if (key === 'raced') return { value: true, enumerable: true, configurable: true };
      return Reflect.getOwnPropertyDescriptor(target, key);
    },
  });

  for (const event of [new Proxy(workplaceReassignmentEvent(), {}), racingEvent]) {
    assert.throws(
      () => domain.createHostedIdentityWorkplaceReassignmentHistory(before, after, event),
      { message: 'Invalid hosted agent presence input' },
    );
  }
});

test('workplace reassignment rejects Proxy source events without executing traps', async () => {
  const domain = await loadDomain();
  const before = domain.createReviewedHostedIdentityMapping(mappingFixture());
  const after = domain.createReviewedHostedIdentityMapping(mappingFixture({
    workplaceLabel: 'Executive Office', registryRevision: 8,
    synchronizedAt: '2026-09-27T10:01:00.000Z',
  }));
  const trapCounts = Object.fromEntries([
    'get', 'set', 'has', 'deleteProperty', 'defineProperty', 'ownKeys',
    'getOwnPropertyDescriptor', 'getPrototypeOf', 'setPrototypeOf',
    'isExtensible', 'preventExtensions',
  ].map((trap) => [trap, 0]));
  const handler = Object.fromEntries(Object.keys(trapCounts).map((trap) => [
    trap,
    (...args) => {
      trapCounts[trap] += 1;
      return Reflect[trap](...args);
    },
  ]));
  const sourceEvent = new Proxy(workplaceReassignmentEvent(), handler);

  assert.throws(
    () => domain.createHostedIdentityWorkplaceReassignmentHistory(before, after, sourceEvent),
    { message: 'Invalid hosted agent presence input' },
  );
  assert.deepEqual(trapCounts, Object.fromEntries(
    Object.keys(trapCounts).map((trap) => [trap, 0]),
  ));
});

test('workplace reassignment rejects self-healing accessors without executing getters', async () => {
  const domain = await loadDomain();
  const before = domain.createReviewedHostedIdentityMapping(mappingFixture());
  const after = domain.createReviewedHostedIdentityMapping(mappingFixture({
    workplaceLabel: 'Executive Office', registryRevision: 8,
    synchronizedAt: '2026-09-27T10:01:00.000Z',
  }));
  const sourceEvent = workplaceReassignmentEvent();
  let accessorCalls = 0;
  Object.defineProperty(sourceEvent, 'occurredAt', {
    configurable: true,
    enumerable: true,
    get() {
      accessorCalls += 1;
      Object.defineProperty(sourceEvent, 'occurredAt', {
        value: '2026-09-27T10:00:30.000Z',
        enumerable: true,
        configurable: true,
        writable: true,
      });
      return '2026-09-27T10:00:30.000Z';
    },
  });

  assert.throws(
    () => domain.createHostedIdentityWorkplaceReassignmentHistory(before, after, sourceEvent),
    { message: 'Invalid hosted agent presence input' },
  );
  assert.equal(accessorCalls, 0);
});

test('workplace reassignment rejects forged reviewed mappings', async () => {
  const domain = await loadDomain();
  const before = domain.createReviewedHostedIdentityMapping(mappingFixture());
  const after = domain.createReviewedHostedIdentityMapping(mappingFixture({
    workplaceLabel: 'Executive Office', registryRevision: 8,
    synchronizedAt: '2026-09-27T10:01:00.000Z',
  }));
  for (const [forgedBefore, forgedAfter] of [
    [{ ...before }, after],
    [Object.assign(Object.create(before), {}), after],
    [new Proxy(before, {}), after],
    [before, { ...after }],
  ]) {
    assert.throws(
      () => domain.createHostedIdentityWorkplaceReassignmentHistory(
        forgedBefore, forgedAfter, reviewedWorkplaceReassignmentEvent(domain),
      ),
      { message: 'Invalid hosted agent presence input' },
    );
  }
});

test('workplace reassignment rejects forged Proxy mappings without executing traps', async () => {
  const domain = await loadDomain();
  const before = domain.createReviewedHostedIdentityMapping(mappingFixture());
  const after = domain.createReviewedHostedIdentityMapping(mappingFixture({
    workplaceLabel: 'Executive Office', registryRevision: 8,
    synchronizedAt: '2026-09-27T10:01:00.000Z',
  }));
  const trapCounts = Object.fromEntries([
    'get', 'set', 'has', 'deleteProperty', 'defineProperty', 'ownKeys',
    'getOwnPropertyDescriptor', 'getPrototypeOf', 'setPrototypeOf',
    'isExtensible', 'preventExtensions',
  ].map((trap) => [trap, 0]));
  const handler = Object.fromEntries(Object.keys(trapCounts).map((trap) => [
    trap,
    (...args) => {
      trapCounts[trap] += 1;
      return Reflect[trap](...args);
    },
  ]));
  const forgedBefore = new Proxy(before, handler);

  assert.throws(
    () => domain.createHostedIdentityWorkplaceReassignmentHistory(
      forgedBefore, after, reviewedWorkplaceReassignmentEvent(domain),
    ),
    { message: 'Invalid hosted agent presence input' },
  );
  assert.deepEqual(trapCounts, Object.fromEntries(
    Object.keys(trapCounts).map((trap) => [trap, 0]),
  ));
});

test('reviewed mappings accept only the two exact canonical workplace labels', async () => {
  const domain = await loadDomain();
  for (const workplaceLabel of ['Chief Agent Office', 'Executive Office']) {
    const mapping = domain.createReviewedHostedIdentityMapping(mappingFixture({ workplaceLabel }));
    assert.equal(mapping.workplaceLabel, workplaceLabel);
  }
  for (const workplaceLabel of [
    '', 'Operations Office', 'executive office', ' Executive Office',
    'Executive Office ', new String('Executive Office'), { toString: () => 'Executive Office' },
  ]) {
    assert.throws(
      () => domain.createReviewedHostedIdentityMapping(mappingFixture({ workplaceLabel })),
      { message: 'Invalid hosted agent presence input' },
    );
  }
});

test('workplace reassignment revisions reject malformed coercible and unsafe scalars', async () => {
  const domain = await loadDomain();
  const before = domain.createReviewedHostedIdentityMapping(mappingFixture());
  const after = domain.createReviewedHostedIdentityMapping(mappingFixture({
    workplaceLabel: 'Executive Office', registryRevision: 8,
    synchronizedAt: '2026-09-27T10:01:00.000Z',
  }));
  let coercionCalls = 0;
  const coercible = {
    [Symbol.toPrimitive]() {
      coercionCalls += 1;
      return 7;
    },
  };
  for (const revisions of [
    { priorRevision: -0 },
    { priorRevision: '7' },
    { priorRevision: coercible },
    { priorRevision: Number.MAX_SAFE_INTEGER + 1 },
    { nextRevision: -0 },
    { nextRevision: new Number(8) },
    { nextRevision: Number.NaN },
    { nextRevision: Number.POSITIVE_INFINITY },
  ]) {
    assert.throws(
      () => domain.createHostedIdentityWorkplaceReassignmentHistory(
        before, after, reviewedWorkplaceReassignmentEvent(domain, revisions),
      ),
      { message: 'Invalid hosted agent presence input' },
    );
  }
  assert.equal(coercionCalls, 0);
});

test('workplace reassignment event time accepts both synchronized boundaries', async () => {
  const domain = await loadDomain();
  const before = domain.createReviewedHostedIdentityMapping(mappingFixture());
  const after = domain.createReviewedHostedIdentityMapping(mappingFixture({
    workplaceLabel: 'Executive Office', registryRevision: 8,
    synchronizedAt: '2026-09-27T10:01:00.000Z',
  }));
  for (const occurredAt of [before.synchronizedAt, after.synchronizedAt]) {
    const history = domain.createHostedIdentityWorkplaceReassignmentHistory(
      before, after, reviewedWorkplaceReassignmentEvent(domain, { occurredAt }),
    );
    assert.equal(history.occurredAt, occurredAt);
  }
});

test('workplace reassignment orders canonical extended-year timestamps chronologically', async () => {
  const domain = await loadDomain();
  const before = domain.createReviewedHostedIdentityMapping(mappingFixture({
    synchronizedAt: '9999-12-31T23:59:59.999Z',
  }));
  const after = domain.createReviewedHostedIdentityMapping(mappingFixture({
    workplaceLabel: 'Executive Office', registryRevision: 8,
    synchronizedAt: '+010000-01-01T00:00:00.000Z',
  }));
  const occurredAt = after.synchronizedAt;

  const history = domain.createHostedIdentityWorkplaceReassignmentHistory(
    before, after, reviewedWorkplaceReassignmentEvent(domain, { occurredAt }),
  );

  assert.equal(history.occurredAt, '+010000-01-01T00:00:00.000Z');
});

test('workplace reassignment history grants no operational state or authority', async () => {
  const domain = await loadDomain();
  const before = domain.createReviewedHostedIdentityMapping(mappingFixture());
  const after = domain.createReviewedHostedIdentityMapping(mappingFixture({
    workplaceLabel: 'Executive Office', registryRevision: 8,
    synchronizedAt: '2026-09-27T10:01:00.000Z',
  }));
  const history = domain.createHostedIdentityWorkplaceReassignmentHistory(
    before, after, reviewedWorkplaceReassignmentEvent(domain),
  );

  assert.deepEqual(Object.keys(history).sort(), [
    'identityId', 'newWorkplaceLabel', 'nextRevision', 'occurredAt',
    'oldWorkplaceLabel', 'priorRevision', 'profileName', 'reason', 'subjectId', 'tenantId',
  ]);
  for (const forbidden of [
    'available', 'state', 'status', 'currentWork', 'work', 'movement', 'session',
    'membership', 'recordAccess', 'roleLabel', 'skills', 'permissions',
    'actionAuthorities', 'spending', 'externalCommunication', 'releaseAuthority',
    'providerAccess', 'presence', 'roomOccupancy',
  ]) {
    assert.equal(Object.hasOwn(history, forbidden), false);
  }
});

test('exact reviewed profile rename produces minimal detached frozen historical continuity', async () => {
  const domain = await loadDomain();
  assert.equal(typeof domain.createHostedIdentityProfileRenameHistory, 'function');
  const before = domain.createReviewedHostedIdentityMapping(mappingFixture());
  const after = domain.createReviewedHostedIdentityMapping(mappingFixture({
    profileName: 'spiders-renamed',
    registryRevision: 8,
    synchronizedAt: '2026-09-27T10:01:00.000Z',
  }));
  const event = domain.createHostedIdentityProfileRenameEvent(
    IDS.tenant,
    IDS.subject,
    'stg-spiders',
    'spiders',
    'spiders-renamed',
    7,
    8,
    '2026-09-27T10:00:30.000Z',
  );

  const history = domain.createHostedIdentityProfileRenameHistory(before, after, event);

  assert.deepEqual(history, { ...event, reason: 'profile_renamed' });
  assert.notEqual(history, event);
  assert.equal(Object.isFrozen(history), true);
  assert.equal(Object.isFrozen(event), true);
  assert.throws(() => { event.oldProfileName = 'tampered'; }, TypeError);
  assert.equal(history.oldProfileName, 'spiders');
  assert.throws(() => { history.newProfileName = 'tampered'; }, TypeError);
});

test('profile rename rejects a no-op profile name', async () => {
  const domain = await loadDomain();
  const before = domain.createReviewedHostedIdentityMapping(mappingFixture());
  const after = domain.createReviewedHostedIdentityMapping(mappingFixture({
    registryRevision: 8,
    synchronizedAt: '2026-09-27T10:01:00.000Z',
  }));

  assert.throws(
    () => domain.createHostedIdentityProfileRenameHistory(
      before,
      after,
      reviewedRenameEvent(domain, { newProfileName: 'spiders' }),
    ),
    { message: 'Invalid hosted agent presence input' },
  );
});

test('profile rename accepts only an active adjacent revision with unchanged identity facts', async () => {
  const domain = await loadDomain();
  const acceptedBefore = domain.createReviewedHostedIdentityMapping(mappingFixture());
  const acceptedAfterInput = {
    profileName: 'spiders-renamed', registryRevision: 8,
    synchronizedAt: '2026-09-27T10:01:00.000Z',
  };
  const rejectedPairs = [
    [domain.createReviewedHostedIdentityMapping(mappingFixture({ status: 'revoked' })), acceptedAfterInput],
    [acceptedBefore, { ...acceptedAfterInput, status: 'retired' }],
    [acceptedBefore, { ...acceptedAfterInput, tenantId: 'id_9999999999999999' }],
    [acceptedBefore, { ...acceptedAfterInput, subjectId: 'id_9999999999999999' }],
    [acceptedBefore, { ...acceptedAfterInput, skills: ['different-skill'] }],
    [acceptedBefore, { ...acceptedAfterInput, registryRevision: 7 }],
    [acceptedBefore, { ...acceptedAfterInput, registryRevision: 9 }],
    [acceptedBefore, { ...acceptedAfterInput, synchronizedAt: '2026-09-27T10:00:00.000Z' }],
    [acceptedBefore, { ...acceptedAfterInput, synchronizedAt: '2026-09-27T09:59:59.999Z' }],
  ];

  for (const [before, afterOverrides] of rejectedPairs) {
    const after = domain.createReviewedHostedIdentityMapping(mappingFixture(afterOverrides));
    assert.throws(
      () => domain.createHostedIdentityProfileRenameHistory(
        before, after, reviewedRenameEvent(domain),
      ),
      { message: 'Invalid hosted agent presence input' },
    );
  }
});

test('profile rename requires one exact closed source event bound to the transition', async () => {
  const domain = await loadDomain();
  const before = domain.createReviewedHostedIdentityMapping(mappingFixture());
  const after = domain.createReviewedHostedIdentityMapping(mappingFixture({
    profileName: 'spiders-renamed', registryRevision: 8,
    synchronizedAt: '2026-09-27T10:01:00.000Z',
  }));
  const rejected = [
    renameEvent({ tenantId: 'id_9999999999999999' }),
    renameEvent({ subjectId: 'id_9999999999999999' }),
    renameEvent({ identityId: 'other' }),
    renameEvent({ oldProfileName: 'other' }),
    renameEvent({ newProfileName: 'other' }),
    renameEvent({ priorRevision: 6 }),
    renameEvent({ nextRevision: 9 }),
    renameEvent({ occurredAt: '2026-09-27T09:59:59.999Z' }),
    renameEvent({ occurredAt: '2026-09-27T10:01:00.001Z' }),
    renameEvent({ occurredAt: 'not-a-timestamp' }),
    renameEvent({ priorRevision: '7' }),
    renameEvent({ nextRevision: Number.MAX_SAFE_INTEGER + 1 }),
    renameEvent({ reason: 'free text' }),
    Object.assign(Object.create({ inherited: true }), renameEvent()),
    Object.defineProperty(renameEvent(), 'occurredAt', { get: () => '2026-09-27T10:00:30.000Z' }),
    Object.assign(renameEvent(), { [Symbol('hidden')]: true }),
  ];

  for (const event of rejected) {
    assert.throws(
      () => domain.createHostedIdentityProfileRenameHistory(before, after, event),
      { message: 'Invalid hosted agent presence input' },
    );
  }
});

test('profile rename rejects proxy source events', async () => {
  const domain = await loadDomain();
  const before = domain.createReviewedHostedIdentityMapping(mappingFixture());
  const after = domain.createReviewedHostedIdentityMapping(mappingFixture({
    profileName: 'spiders-renamed', registryRevision: 8,
    synchronizedAt: '2026-09-27T10:01:00.000Z',
  }));
  let ownKeyReads = 0;
  const racingEvent = new Proxy(renameEvent(), {
    ownKeys(target) {
      ownKeyReads += 1;
      return ownKeyReads === 1 ? Reflect.ownKeys(target) : [...Reflect.ownKeys(target), 'raced'];
    },
    getOwnPropertyDescriptor(target, key) {
      if (key === 'raced') return { value: true, enumerable: true, configurable: true };
      return Reflect.getOwnPropertyDescriptor(target, key);
    },
  });

  for (const event of [new Proxy(renameEvent(), {}), racingEvent]) {
    assert.throws(
      () => domain.createHostedIdentityProfileRenameHistory(before, after, event),
      { message: 'Invalid hosted agent presence input' },
    );
  }
});

test('profile rename rejects forged reviewed mappings', async () => {
  const domain = await loadDomain();
  const before = domain.createReviewedHostedIdentityMapping(mappingFixture());
  const after = domain.createReviewedHostedIdentityMapping(mappingFixture({
    profileName: 'spiders-renamed', registryRevision: 8,
    synchronizedAt: '2026-09-27T10:01:00.000Z',
  }));
  for (const [forgedBefore, forgedAfter] of [
    [{ ...before }, after],
    [Object.assign(Object.create(before), {}), after],
    [new Proxy(before, {}), after],
    [before, { ...after }],
  ]) {
    assert.throws(
      () => domain.createHostedIdentityProfileRenameHistory(
        forgedBefore, forgedAfter, reviewedRenameEvent(domain),
      ),
      { message: 'Invalid hosted agent presence input' },
    );
  }
});

test('profile rename rejects noncanonical names and every identity fact drift', async () => {
  const domain = await loadDomain();
  for (const profileName of ['', 'Spiders', '-spiders', 'spiders space', 'a'.repeat(65)]) {
    assert.throws(
      () => domain.createReviewedHostedIdentityMapping(mappingFixture({ profileName })),
      { message: 'Invalid hosted agent presence input' },
    );
  }
  for (const overrides of [
    { identityId: 'other' },
    { displayName: 'Other' },
    { roleLabel: 'Other' },
    { workplaceLabel: 'Other' },
    { permissions: ['record.read'] },
    { actionAuthorities: ['spend'] },
  ]) {
    assert.throws(
      () => domain.createReviewedHostedIdentityMapping(mappingFixture(overrides)),
      { message: 'Invalid hosted agent presence input' },
    );
  }

  const before = domain.createReviewedHostedIdentityMapping(mappingFixture());
  for (const overrides of [
    { tenantId: 'id_9999999999999999' },
    { subjectId: 'id_9999999999999999' },
    { skills: ['different-skill'] },
  ]) {
    const after = domain.createReviewedHostedIdentityMapping(mappingFixture({
      profileName: 'spiders-renamed', registryRevision: 8,
      synchronizedAt: '2026-09-27T10:01:00.000Z', ...overrides,
    }));
    assert.throws(
      () => domain.createHostedIdentityProfileRenameHistory(
        before, after, reviewedRenameEvent(domain),
      ),
      { message: 'Invalid hosted agent presence input' },
    );
  }
});

test('profile rename revisions reject malformed coercible and unsafe scalars', async () => {
  const domain = await loadDomain();
  const before = domain.createReviewedHostedIdentityMapping(mappingFixture());
  const after = domain.createReviewedHostedIdentityMapping(mappingFixture({
    profileName: 'spiders-renamed', registryRevision: 8,
    synchronizedAt: '2026-09-27T10:01:00.000Z',
  }));
  let coercionCalls = 0;
  const coercible = {
    [Symbol.toPrimitive]() {
      coercionCalls += 1;
      return 7;
    },
  };
  for (const revisions of [
    { priorRevision: -0 },
    { priorRevision: '7' },
    { priorRevision: coercible },
    { priorRevision: Number.MAX_SAFE_INTEGER + 1 },
    { nextRevision: -0 },
    { nextRevision: new Number(8) },
    { nextRevision: Number.NaN },
    { nextRevision: Number.POSITIVE_INFINITY },
  ]) {
    assert.throws(
      () => domain.createHostedIdentityProfileRenameHistory(
        before, after, reviewedRenameEvent(domain, revisions),
      ),
      { message: 'Invalid hosted agent presence input' },
    );
  }
  assert.equal(coercionCalls, 0);
});

test('profile rename event time accepts both synchronized boundaries', async () => {
  const domain = await loadDomain();
  const before = domain.createReviewedHostedIdentityMapping(mappingFixture());
  const after = domain.createReviewedHostedIdentityMapping(mappingFixture({
    profileName: 'spiders-renamed', registryRevision: 8,
    synchronizedAt: '2026-09-27T10:01:00.000Z',
  }));
  for (const occurredAt of [before.synchronizedAt, after.synchronizedAt]) {
    const history = domain.createHostedIdentityProfileRenameHistory(
      before, after, reviewedRenameEvent(domain, { occurredAt }),
    );
    assert.equal(history.occurredAt, occurredAt);
  }
});

test('profile rename history grants no operational state or authority', async () => {
  const domain = await loadDomain();
  const before = domain.createReviewedHostedIdentityMapping(mappingFixture());
  const after = domain.createReviewedHostedIdentityMapping(mappingFixture({
    profileName: 'spiders-renamed', registryRevision: 8,
    synchronizedAt: '2026-09-27T10:01:00.000Z',
  }));
  const history = domain.createHostedIdentityProfileRenameHistory(
    before, after, reviewedRenameEvent(domain),
  );

  assert.deepEqual(Object.keys(history).sort(), [
    'identityId', 'newProfileName', 'nextRevision', 'occurredAt', 'oldProfileName',
    'priorRevision', 'reason', 'subjectId', 'tenantId',
  ]);
  for (const forbidden of [
    'available', 'state', 'status', 'work', 'movement', 'session', 'membership',
    'recordAccess', 'skills', 'permissions', 'actionAuthorities', 'spending',
    'externalCommunication', 'releaseAuthority', 'providerAccess',
  ]) {
    assert.equal(Object.hasOwn(history, forbidden), false);
  }
});
