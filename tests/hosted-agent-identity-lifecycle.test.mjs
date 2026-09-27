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

function retirementEvent(overrides = {}) {
  return {
    tenantId: IDS.tenant,
    subjectId: IDS.subject,
    identityId: 'stg-spiders',
    profileName: 'spiders',
    priorRevision: 7,
    nextRevision: 8,
    occurredAt: '2026-09-27T10:00:30.000Z',
    ...overrides,
  };
}

function reviewedRetirementEvent(domain, overrides = {}) {
  const event = retirementEvent(overrides);
  return domain.createHostedIdentityRetirementEvent(
    event.tenantId,
    event.subjectId,
    event.identityId,
    event.profileName,
    event.priorRevision,
    event.nextRevision,
    event.occurredAt,
  );
}

function onboardingEvent(overrides = {}) {
  return {
    tenantId: IDS.tenant,
    subjectId: IDS.subject,
    identityId: 'stg-spiders',
    displayName: 'Spiders',
    profileName: 'spiders',
    roleLabel: 'Chief Agent',
    workplaceLabel: 'Chief Agent Office',
    skills: ['project-coordination'],
    permissions: [],
    actionAuthorities: [],
    initialRevision: 1,
    occurredAt: '2026-09-27T09:59:59.999Z',
    ...overrides,
  };
}

function reviewedOnboardingEvent(domain, overrides = {}, mappingInput) {
  const event = onboardingEvent(overrides);
  if (['skills', 'permissions', 'actionAuthorities'].some((field) => Object.hasOwn(overrides, field))) {
    return domain.createHostedIdentityOnboardingEvent(
      event.tenantId,
      event.subjectId,
      event.identityId,
      event.displayName,
      event.profileName,
      event.roleLabel,
      event.workplaceLabel,
      event.skills,
      event.permissions,
      event.actionAuthorities,
      event.initialRevision,
      event.occurredAt,
    );
  }
  const mapping = mappingInput ?? domain.createReviewedHostedIdentityMapping(mappingFixture({
    registryRevision: 1,
  }));
  return domain.createHostedIdentityOnboardingEvent(
    mapping,
    event.tenantId,
    event.subjectId,
    event.identityId,
    event.displayName,
    event.profileName,
    event.roleLabel,
    event.workplaceLabel,
    event.initialRevision,
    event.occurredAt,
  );
}

test('exact reviewed identity onboarding produces minimal detached frozen historical continuity', async () => {
  const domain = await loadDomain();
  assert.equal(typeof domain.createHostedIdentityOnboardingHistory, 'function');
  const mapping = domain.createReviewedHostedIdentityMapping(mappingFixture({
    registryRevision: 1,
  }));
  const event = domain.createHostedIdentityOnboardingEvent(
    mapping,
    IDS.tenant,
    IDS.subject,
    'stg-spiders',
    'Spiders',
    'spiders',
    'Chief Agent',
    'Chief Agent Office',
    1,
    '2026-09-27T09:59:59.999Z',
  );

  const history = domain.createHostedIdentityOnboardingHistory(mapping, event);

  assert.deepEqual(history, {
    tenantId: IDS.tenant,
    subjectId: IDS.subject,
    identityId: 'stg-spiders',
    profileName: 'spiders',
    initialRevision: 1,
    occurredAt: '2026-09-27T09:59:59.999Z',
    synchronizedAt: '2026-09-27T10:00:00.000Z',
    status: 'active',
    reason: 'identity_onboarded',
  });
  assert.notEqual(history, event);
  assert.equal(Object.isFrozen(history), true);
  assert.equal(Object.isFrozen(event), true);
  assert.equal(Object.isFrozen(event.skills), true);
  assert.throws(() => { event.skills.push('tampered'); }, TypeError);
  assert.throws(() => { history.status = 'retired'; }, TypeError);
});

test('identity onboarding history requires the exact reviewed mapping that created its event', async () => {
  const domain = await loadDomain();
  const mappingA = domain.createReviewedHostedIdentityMapping(mappingFixture({ registryRevision: 1 }));
  const mappingB = domain.createReviewedHostedIdentityMapping(mappingFixture({ registryRevision: 1 }));
  assert.notEqual(mappingA, mappingB);
  const event = reviewedOnboardingEvent(domain, {}, mappingA);

  assert.throws(
    () => domain.createHostedIdentityOnboardingHistory(mappingB, event),
    { message: 'Invalid hosted agent presence input' },
  );
});

test('identity onboarding accepts only an active mapping at initial revision one', async () => {
  const domain = await loadDomain();
  for (const overrides of [
    { status: 'revoked', registryRevision: 1 },
    { status: 'retired', registryRevision: 1 },
    { status: 'active', registryRevision: 2 },
  ]) {
    const mapping = domain.createReviewedHostedIdentityMapping(mappingFixture(overrides));
    assert.throws(
      () => reviewedOnboardingEvent(domain, {}, mapping),
      { message: 'Invalid hosted agent presence input' },
    );
  }
});

test('identity onboarding requires one exact source event bound to every identity fact', async () => {
  const domain = await loadDomain();
  const mapping = domain.createReviewedHostedIdentityMapping(mappingFixture({ registryRevision: 1 }));
  for (const disagreement of [
    { tenantId: 'id_9999999999999999' },
    { subjectId: 'id_9999999999999999' },
    { identityId: 'other' },
    { displayName: 'Other' },
    { profileName: 'other' },
    { roleLabel: 'Other' },
    { workplaceLabel: 'Executive Office' },
    { skills: ['other-skill'] },
    { permissions: ['record.read'] },
    { actionAuthorities: ['spend'] },
    { initialRevision: 2 },
  ]) {
    assert.throws(
      () => domain.createHostedIdentityOnboardingHistory(
        mapping, reviewedOnboardingEvent(domain, disagreement),
      ),
      { message: 'Invalid hosted agent presence input' },
    );
  }

  const eventMapping = domain.createReviewedHostedIdentityMapping(mappingFixture({
    registryRevision: 1,
    skills: ['other-skill'],
  }));
  const event = reviewedOnboardingEvent(domain, {}, eventMapping);
  assert.throws(
    () => domain.createHostedIdentityOnboardingHistory(mapping, event),
    { message: 'Invalid hosted agent presence input' },
  );
});

test('identity onboarding event cannot occur after initial registry synchronization', async () => {
  const domain = await loadDomain();
  const mapping = domain.createReviewedHostedIdentityMapping(mappingFixture({ registryRevision: 1 }));
  assert.throws(
    () => domain.createHostedIdentityOnboardingHistory(
      mapping,
      reviewedOnboardingEvent(domain, { occurredAt: '2026-09-27T10:00:00.001Z' }, mapping),
    ),
    { message: 'Invalid hosted agent presence input' },
  );
});

test('identity onboarding event rejects malformed coercible and unsafe scalar facts', async () => {
  const domain = await loadDomain();
  let coercionCalls = 0;
  const coercible = {
    [Symbol.toPrimitive]() {
      coercionCalls += 1;
      return 1;
    },
  };
  for (const overrides of [
    { tenantId: '' },
    { subjectId: new String(IDS.subject) },
    { identityId: 'other' },
    { displayName: 'Other' },
    { profileName: 'Spiders' },
    { roleLabel: 'Other' },
    { workplaceLabel: 'Other' },
    { initialRevision: -0 },
    { initialRevision: '1' },
    { initialRevision: coercible },
    { initialRevision: Number.MAX_SAFE_INTEGER + 1 },
    { occurredAt: 'not-a-timestamp' },
  ]) {
    assert.throws(
      () => reviewedOnboardingEvent(domain, overrides),
      { message: 'Invalid hosted agent presence input' },
    );
  }
  assert.equal(coercionCalls, 0);
});

test('identity onboarding rejects legacy categorical arrays and detaches trusted mapping facts', async () => {
  const domain = await loadDomain();
  for (const overrides of [
    { skills: 'project-coordination' },
    { skills: ['project-coordination'] },
    { skills: ['Project Coordination'] },
    { skills: ['project-coordination', 'project-coordination'] },
    { skills: Array.from({ length: 17 }, (_, index) => `skill-${index}`) },
    { permissions: [] },
    { permissions: ['record.read'] },
    { actionAuthorities: [] },
    { actionAuthorities: ['spend'] },
  ]) {
    assert.throws(
      () => reviewedOnboardingEvent(domain, overrides),
      { message: 'Invalid hosted agent presence input' },
    );
  }

  const skills = ['project-coordination'];
  const mapping = domain.createReviewedHostedIdentityMapping(mappingFixture({
    registryRevision: 1,
    skills,
  }));
  const event = reviewedOnboardingEvent(domain, {}, mapping);
  skills[0] = 'tampered';
  skills.push('another-skill');
  assert.deepEqual(event.skills, ['project-coordination']);
  assert.notEqual(event.skills, mapping.skills);
  assert.notEqual(event.permissions, mapping.permissions);
  assert.notEqual(event.actionAuthorities, mapping.actionAuthorities);
  assert.equal(Object.isFrozen(event.skills), true);
  assert.equal(Object.isFrozen(event.permissions), true);
  assert.equal(Object.isFrozen(event.actionAuthorities), true);
});

test('identity onboarding rejects proxied categorical arrays without executing traps', async () => {
  const domain = await loadDomain();
  const mapping = domain.createReviewedHostedIdentityMapping(mappingFixture({ registryRevision: 1 }));
  for (const [field, target] of [
    ['skills', ['project-coordination']],
    ['permissions', []],
    ['actionAuthorities', []],
  ]) {
    let trapCalls = 0;
    const proxy = new Proxy(target, {
      get() { trapCalls += 1; return undefined; },
      getOwnPropertyDescriptor() { trapCalls += 1; return undefined; },
      getPrototypeOf() { trapCalls += 1; return Array.prototype; },
      ownKeys() { trapCalls += 1; return []; },
    });
    let event;
    assert.throws(
      () => { event = reviewedOnboardingEvent(domain, { [field]: proxy }); },
      { message: 'Invalid hosted agent presence input' },
    );
    assert.equal(event, undefined);
    assert.throws(
      () => domain.createHostedIdentityOnboardingHistory(mapping, event),
      { message: 'Invalid hosted agent presence input' },
    );
    assert.equal(trapCalls, 0);
  }
});

test('identity onboarding rejects accessor-backed categorical arrays without executing getters', async () => {
  const domain = await loadDomain();
  const mapping = domain.createReviewedHostedIdentityMapping(mappingFixture({ registryRevision: 1 }));
  const getterCalls = [];
  const rejectedEvents = [];
  const rejectedHistories = [];
  for (const [field, value] of [
    ['skills', 'project-coordination'],
    ['permissions', 'record.read'],
    ['actionAuthorities', 'spend'],
  ]) {
    let calls = 0;
    const accessorBacked = [];
    Object.defineProperty(accessorBacked, '0', {
      enumerable: true,
      get() { calls += 1; return value; },
    });
    let event;
    assert.throws(
      () => { event = reviewedOnboardingEvent(domain, { [field]: accessorBacked }); },
      { message: 'Invalid hosted agent presence input' },
    );
    rejectedEvents.push(event);
    let history;
    assert.throws(
      () => { history = domain.createHostedIdentityOnboardingHistory(mapping, event); },
      { message: 'Invalid hosted agent presence input' },
    );
    rejectedHistories.push(history);
    getterCalls.push(calls);
  }
  assert.deepEqual(rejectedEvents, [undefined, undefined, undefined]);
  assert.deepEqual(rejectedHistories, [undefined, undefined, undefined]);
  assert.deepEqual(getterCalls, [0, 0, 0]);
});

test('identity onboarding rejects forged inherited unknown-key accessor and Proxy events', async () => {
  const domain = await loadDomain();
  const mapping = domain.createReviewedHostedIdentityMapping(mappingFixture({ registryRevision: 1 }));
  const reviewed = reviewedOnboardingEvent(domain);
  let hookCalls = 0;
  const accessor = Object.defineProperty(onboardingEvent(), 'occurredAt', {
    enumerable: true,
    get() { hookCalls += 1; return '2026-09-27T09:59:59.999Z'; },
  });
  const proxy = new Proxy(reviewed, {
    get() { hookCalls += 1; return undefined; },
    ownKeys() { hookCalls += 1; return []; },
    getPrototypeOf() { hookCalls += 1; return Object.prototype; },
  });
  for (const event of [
    onboardingEvent(),
    Object.assign(Object.create(reviewed), {}),
    { ...reviewed, reason: 'free text' },
    Object.assign({ ...reviewed }, { [Symbol('hidden')]: true }),
    accessor,
    proxy,
  ]) {
    assert.throws(
      () => domain.createHostedIdentityOnboardingHistory(mapping, event),
      { message: 'Invalid hosted agent presence input' },
    );
  }
  assert.equal(hookCalls, 0);
});

test('identity onboarding rejects forged reviewed mappings without executing Proxy traps', async () => {
  const domain = await loadDomain();
  const mapping = domain.createReviewedHostedIdentityMapping(mappingFixture({ registryRevision: 1 }));
  let trapCalls = 0;
  const proxy = new Proxy(mapping, {
    get() { trapCalls += 1; return undefined; },
    ownKeys() { trapCalls += 1; return []; },
    getPrototypeOf() { trapCalls += 1; return Object.prototype; },
  });
  for (const candidate of [
    { ...mapping },
    Object.assign(Object.create(mapping), {}),
    proxy,
  ]) {
    assert.throws(
      () => reviewedOnboardingEvent(domain, {}, candidate),
      { message: 'Invalid hosted agent presence input' },
    );
  }
  assert.equal(trapCalls, 0);
});

test('identity onboarding history grants no current operational state or authority', async () => {
  const domain = await loadDomain();
  const mapping = domain.createReviewedHostedIdentityMapping(mappingFixture({ registryRevision: 1 }));
  const history = domain.createHostedIdentityOnboardingHistory(
    mapping,
    reviewedOnboardingEvent(domain, { occurredAt: mapping.synchronizedAt }, mapping),
  );

  assert.deepEqual(Object.keys(history).sort(), [
    'identityId', 'initialRevision', 'occurredAt', 'profileName', 'reason',
    'status', 'subjectId', 'synchronizedAt', 'tenantId',
  ]);
  for (const forbidden of [
    'available', 'state', 'currentWork', 'work', 'working', 'meeting',
    'researching', 'reviewing', 'blocked', 'completed', 'movement',
    'roomOccupancy', 'session', 'sessionMembership', 'tenantMembership',
    'recordAccess', 'roleLabel', 'workplaceLabel', 'skills', 'permissions',
    'actionAuthorities', 'spending', 'externalCommunication',
    'releaseAuthority', 'providerAccess', 'credentials', 'reactivation',
  ]) {
    assert.equal(Object.hasOwn(history, forbidden), false);
  }
});

test('exact reviewed identity retirement produces minimal detached frozen historical continuity', async () => {
  const domain = await loadDomain();
  assert.equal(typeof domain.createHostedIdentityRetirementHistory, 'function');
  const before = domain.createReviewedHostedIdentityMapping(mappingFixture());
  const after = domain.createReviewedHostedIdentityMapping(mappingFixture({
    status: 'retired',
    registryRevision: 8,
    synchronizedAt: '2026-09-27T10:01:00.000Z',
  }));
  const event = domain.createHostedIdentityRetirementEvent(
    IDS.tenant,
    IDS.subject,
    'stg-spiders',
    'spiders',
    7,
    8,
    '2026-09-27T10:00:30.000Z',
  );

  const history = domain.createHostedIdentityRetirementHistory(before, after, event);

  assert.deepEqual(history, {
    ...event,
    priorStatus: 'active',
    nextStatus: 'retired',
    reason: 'identity_retired',
  });
  assert.notEqual(history, event);
  assert.equal(Object.isFrozen(history), true);
  assert.equal(Object.isFrozen(event), true);
  assert.throws(() => { event.profileName = 'tampered'; }, TypeError);
  assert.equal(history.profileName, 'spiders');
  assert.throws(() => { history.nextStatus = 'active'; }, TypeError);
});

test('identity retirement accepts only an active to retired status transition', async () => {
  const domain = await loadDomain();
  const validBefore = domain.createReviewedHostedIdentityMapping(mappingFixture());
  const validAfterInput = {
    status: 'retired', registryRevision: 8,
    synchronizedAt: '2026-09-27T10:01:00.000Z',
  };
  const rejectedPairs = [
    [domain.createReviewedHostedIdentityMapping(mappingFixture({ status: 'retired' })), validAfterInput],
    [domain.createReviewedHostedIdentityMapping(mappingFixture({ status: 'revoked' })), validAfterInput],
    [validBefore, { ...validAfterInput, status: 'active' }],
    [validBefore, { ...validAfterInput, status: 'revoked' }],
  ];

  for (const [before, afterInput] of rejectedPairs) {
    const after = domain.createReviewedHostedIdentityMapping(mappingFixture(afterInput));
    assert.throws(
      () => domain.createHostedIdentityRetirementHistory(
        before, after, reviewedRetirementEvent(domain),
      ),
      { message: 'Invalid hosted agent presence input' },
    );
  }
});

test('identity retirement rejects drift in every variable identity fact', async () => {
  const domain = await loadDomain();
  const before = domain.createReviewedHostedIdentityMapping(mappingFixture());
  for (const drift of [
    { tenantId: 'id_9999999999999999' },
    { subjectId: 'id_9999999999999999' },
    { profileName: 'spiders-renamed' },
    { workplaceLabel: 'Executive Office' },
    { skills: ['different-skill'] },
  ]) {
    const after = domain.createReviewedHostedIdentityMapping(mappingFixture({
      status: 'retired', registryRevision: 8,
      synchronizedAt: '2026-09-27T10:01:00.000Z', ...drift,
    }));
    assert.throws(
      () => domain.createHostedIdentityRetirementHistory(
        before, after, reviewedRetirementEvent(domain),
      ),
      { message: 'Invalid hosted agent presence input' },
    );
  }
});

test('identity retirement requires one adjacent registry revision', async () => {
  const domain = await loadDomain();
  const before = domain.createReviewedHostedIdentityMapping(mappingFixture());
  for (const registryRevision of [7, 9]) {
    const after = domain.createReviewedHostedIdentityMapping(mappingFixture({
      status: 'retired', registryRevision,
      synchronizedAt: '2026-09-27T10:01:00.000Z',
    }));
    assert.throws(
      () => domain.createHostedIdentityRetirementHistory(
        before, after, reviewedRetirementEvent(domain, { nextRevision: registryRevision }),
      ),
      { message: 'Invalid hosted agent presence input' },
    );
  }
});

test('identity retirement requires synchronized time to advance strictly', async () => {
  const domain = await loadDomain();
  const before = domain.createReviewedHostedIdentityMapping(mappingFixture());
  for (const synchronizedAt of [
    '2026-09-27T10:00:00.000Z',
    '2026-09-27T09:59:59.999Z',
  ]) {
    const after = domain.createReviewedHostedIdentityMapping(mappingFixture({
      status: 'retired', registryRevision: 8, synchronizedAt,
    }));
    assert.throws(
      () => domain.createHostedIdentityRetirementHistory(
        before, after, reviewedRetirementEvent(domain, { occurredAt: synchronizedAt }),
      ),
      { message: 'Invalid hosted agent presence input' },
    );
  }
});

test('identity retirement requires an exact closed source event bound to the transition', async () => {
  const domain = await loadDomain();
  const before = domain.createReviewedHostedIdentityMapping(mappingFixture());
  const after = domain.createReviewedHostedIdentityMapping(mappingFixture({
    status: 'retired', registryRevision: 8,
    synchronizedAt: '2026-09-27T10:01:00.000Z',
  }));
  const disagreements = [
    { tenantId: 'id_9999999999999999' },
    { subjectId: 'id_9999999999999999' },
    { identityId: 'other' },
    { profileName: 'other' },
    { priorRevision: 6 },
    { nextRevision: 9 },
    { occurredAt: '2026-09-27T09:59:59.999Z' },
    { occurredAt: '2026-09-27T10:01:00.001Z' },
  ];

  for (const disagreement of disagreements) {
    assert.throws(
      () => domain.createHostedIdentityRetirementHistory(
        before, after, reviewedRetirementEvent(domain, disagreement),
      ),
      { message: 'Invalid hosted agent presence input' },
    );
  }
  assert.throws(
    () => domain.createHostedIdentityRetirementHistory(before, after, retirementEvent()),
    { message: 'Invalid hosted agent presence input' },
  );
});

test('identity retirement event rejects malformed coercible and unsafe scalars', async () => {
  const domain = await loadDomain();
  let coercionCalls = 0;
  const coercible = {
    [Symbol.toPrimitive]() {
      coercionCalls += 1;
      return 7;
    },
  };
  for (const overrides of [
    { tenantId: '' },
    { subjectId: new String(IDS.subject) },
    { identityId: 'other' },
    { profileName: 'Spiders' },
    { priorRevision: -0 },
    { priorRevision: '7' },
    { priorRevision: coercible },
    { nextRevision: Number.MAX_SAFE_INTEGER + 1 },
    { nextRevision: Number.NaN },
    { occurredAt: 'not-a-timestamp' },
  ]) {
    const event = retirementEvent(overrides);
    assert.throws(
      () => domain.createHostedIdentityRetirementEvent(
        event.tenantId,
        event.subjectId,
        event.identityId,
        event.profileName,
        event.priorRevision,
        event.nextRevision,
        event.occurredAt,
      ),
      { message: 'Invalid hosted agent presence input' },
    );
  }
  assert.equal(coercionCalls, 0);
});

test('identity retirement rejects forged inherited unknown-key and Proxy source events', async () => {
  const domain = await loadDomain();
  const before = domain.createReviewedHostedIdentityMapping(mappingFixture());
  const after = domain.createReviewedHostedIdentityMapping(mappingFixture({
    status: 'retired', registryRevision: 8,
    synchronizedAt: '2026-09-27T10:01:00.000Z',
  }));
  const reviewed = reviewedRetirementEvent(domain);
  const forgedEvents = [
    { ...reviewed },
    Object.assign(Object.create(reviewed), {}),
    { ...reviewed, reason: 'free text' },
    Object.assign({ ...reviewed }, { [Symbol('hidden')]: true }),
    new Proxy(reviewed, {}),
  ];

  for (const event of forgedEvents) {
    assert.throws(
      () => domain.createHostedIdentityRetirementHistory(before, after, event),
      { message: 'Invalid hosted agent presence input' },
    );
  }
});

test('identity retirement rejects accessor and racing source events without executing hooks', async () => {
  const domain = await loadDomain();
  const before = domain.createReviewedHostedIdentityMapping(mappingFixture());
  const after = domain.createReviewedHostedIdentityMapping(mappingFixture({
    status: 'retired', registryRevision: 8,
    synchronizedAt: '2026-09-27T10:01:00.000Z',
  }));
  let hookCalls = 0;
  const accessorEvent = Object.defineProperty(retirementEvent(), 'occurredAt', {
    enumerable: true,
    get() { hookCalls += 1; return '2026-09-27T10:00:30.000Z'; },
  });
  const racingEvent = new Proxy(retirementEvent(), {
    ownKeys(target) { hookCalls += 1; return Reflect.ownKeys(target); },
    get(target, key) { hookCalls += 1; return Reflect.get(target, key); },
  });

  for (const event of [accessorEvent, racingEvent]) {
    assert.throws(
      () => domain.createHostedIdentityRetirementHistory(before, after, event),
      { message: 'Invalid hosted agent presence input' },
    );
  }
  assert.equal(hookCalls, 0);
});

test('identity retirement rejects forged reviewed mappings without executing Proxy traps', async () => {
  const domain = await loadDomain();
  const before = domain.createReviewedHostedIdentityMapping(mappingFixture());
  const after = domain.createReviewedHostedIdentityMapping(mappingFixture({
    status: 'retired', registryRevision: 8,
    synchronizedAt: '2026-09-27T10:01:00.000Z',
  }));
  let trapCalls = 0;
  const forgedBefore = new Proxy(before, {
    get() { trapCalls += 1; return undefined; },
    getPrototypeOf() { trapCalls += 1; return Object.prototype; },
    ownKeys() { trapCalls += 1; return []; },
  });
  for (const [candidateBefore, candidateAfter] of [
    [{ ...before }, after],
    [Object.assign(Object.create(before), {}), after],
    [forgedBefore, after],
    [before, { ...after }],
  ]) {
    assert.throws(
      () => domain.createHostedIdentityRetirementHistory(
        candidateBefore, candidateAfter, reviewedRetirementEvent(domain),
      ),
      { message: 'Invalid hosted agent presence input' },
    );
  }
  assert.equal(trapCalls, 0);
});

test('identity retirement history grants no current operational state or authority', async () => {
  const domain = await loadDomain();
  const before = domain.createReviewedHostedIdentityMapping(mappingFixture());
  const after = domain.createReviewedHostedIdentityMapping(mappingFixture({
    status: 'retired', registryRevision: 8,
    synchronizedAt: '2026-09-27T10:01:00.000Z',
  }));
  const history = domain.createHostedIdentityRetirementHistory(
    before, after, reviewedRetirementEvent(domain),
  );

  assert.deepEqual(Object.keys(history).sort(), [
    'identityId', 'nextRevision', 'nextStatus', 'occurredAt', 'priorRevision',
    'priorStatus', 'profileName', 'reason', 'subjectId', 'tenantId',
  ]);
  for (const forbidden of [
    'available', 'state', 'currentWork', 'work', 'movement', 'occupancy',
    'session', 'membership', 'tenantMembership', 'recordAccess', 'roleLabel',
    'skills', 'permissions', 'actionAuthorities', 'spending',
    'externalCommunication', 'releaseAuthority', 'providerAccess', 'deleted',
    'revoked', 'reactivation',
  ]) {
    assert.equal(Object.hasOwn(history, forbidden), false);
  }
});

test('identity retirement event time accepts both synchronized boundaries', async () => {
  const domain = await loadDomain();
  const before = domain.createReviewedHostedIdentityMapping(mappingFixture());
  const after = domain.createReviewedHostedIdentityMapping(mappingFixture({
    status: 'retired', registryRevision: 8,
    synchronizedAt: '2026-09-27T10:01:00.000Z',
  }));
  for (const occurredAt of [before.synchronizedAt, after.synchronizedAt]) {
    const history = domain.createHostedIdentityRetirementHistory(
      before, after, reviewedRetirementEvent(domain, { occurredAt }),
    );
    assert.equal(history.occurredAt, occurredAt);
  }
});

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
