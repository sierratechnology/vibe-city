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

test('exact reviewed profile rename produces minimal detached frozen historical continuity', async () => {
  const domain = await loadDomain();
  assert.equal(typeof domain.createHostedIdentityProfileRenameHistory, 'function');
  const before = domain.createReviewedHostedIdentityMapping(mappingFixture());
  const after = domain.createReviewedHostedIdentityMapping(mappingFixture({
    profileName: 'spiders-renamed',
    registryRevision: 8,
    synchronizedAt: '2026-09-27T10:01:00.000Z',
  }));
  const event = renameEvent();

  const history = domain.createHostedIdentityProfileRenameHistory(before, after, event);

  assert.deepEqual(history, { ...event, reason: 'profile_renamed' });
  assert.notEqual(history, event);
  assert.equal(Object.isFrozen(history), true);
  event.oldProfileName = 'tampered';
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
      renameEvent({ newProfileName: 'spiders' }),
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
      () => domain.createHostedIdentityProfileRenameHistory(before, after, renameEvent()),
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
      () => domain.createHostedIdentityProfileRenameHistory(forgedBefore, forgedAfter, renameEvent()),
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
      () => domain.createHostedIdentityProfileRenameHistory(before, after, renameEvent()),
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
        before, after, renameEvent(revisions),
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
      before, after, renameEvent({ occurredAt }),
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
  const history = domain.createHostedIdentityProfileRenameHistory(before, after, renameEvent());

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
