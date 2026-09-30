import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const sessionUrl = new URL('../src/domain/privateMeetingSessionStart.ts', import.meta.url);
const accessUrl = new URL('../src/domain/privateMeetingTemporaryAccess.ts', import.meta.url);
const acceptanceUrl = new URL('../src/domain/privateMeetingInvitationAcceptance.ts', import.meta.url);
const issuanceUrl = new URL('../src/domain/privateMeetingInvitationIssuance.ts', import.meta.url);
const readinessUrl = new URL('../src/domain/meetingInvitationReadiness.ts', import.meta.url);

async function loadDomain(tag, aroundSessionImport) {
  const [sessionSource, accessSource, acceptanceSource, issuanceSource, readinessSource] = await Promise.all([
    readFile(sessionUrl, 'utf8').catch(() => null),
    readFile(accessUrl, 'utf8'),
    readFile(acceptanceUrl, 'utf8'),
    readFile(issuanceUrl, 'utf8'),
    readFile(readinessUrl, 'utf8'),
  ]);
  if (sessionSource === null) return Object.freeze({ missingCapability: 'private-meeting-session-start' });
  const options = { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } };
  const readinessOutput = ts.transpileModule(readinessSource, options).outputText;
  const readinessSpecifier = `data:text/javascript;base64,${Buffer.from(readinessOutput).toString('base64')}#readiness-${tag}`;
  const issuanceOutput = ts.transpileModule(issuanceSource, options).outputText.replace(
    /['"]\.\/meetingInvitation(?:Readiness|\\u0052eadiness)['"]/,
    JSON.stringify(readinessSpecifier),
  );
  const issuanceSpecifier = `data:text/javascript;base64,${Buffer.from(issuanceOutput).toString('base64')}#issuance-${tag}`;
  const acceptanceOutput = ts.transpileModule(acceptanceSource, options).outputText
    .replace(/['"]\.\/meetingInvitation(?:Readiness|\\u0052eadiness)['"]/, JSON.stringify(readinessSpecifier))
    .replace(/['"]\.\/privateMeetingInvitation(?:Issuance|\\u0049ssuance)['"]/, JSON.stringify(issuanceSpecifier));
  const acceptanceSpecifier = `data:text/javascript;base64,${Buffer.from(acceptanceOutput).toString('base64')}#acceptance-${tag}`;
  const accessOutput = ts.transpileModule(accessSource, options).outputText
    .replace(/['"]\.\/privateMeetingInvitation(?:Acceptance|\\u0041cceptance)['"]/, JSON.stringify(acceptanceSpecifier))
    .replace(/['"]\.\/privateMeetingInvitation(?:Issuance|\\u0049ssuance)['"]/, JSON.stringify(issuanceSpecifier));
  const accessSpecifier = `data:text/javascript;base64,${Buffer.from(accessOutput).toString('base64')}#access-${tag}`;
  const sessionOutput = ts.transpileModule(sessionSource, options).outputText
    .replace(/['"]\.\/privateMeetingTemporary(?:Access|\\u0041ccess)['"]/, JSON.stringify(accessSpecifier))
    .replace(/['"]\.\/privateMeetingInvitation(?:Issuance|\\u0049ssuance)['"]/, JSON.stringify(issuanceSpecifier));
  const sessionSpecifier = `data:text/javascript;base64,${Buffer.from(sessionOutput).toString('base64')}#session-${tag}`;
  const [issuance, acceptance, access] = await Promise.all([
    import(issuanceSpecifier), import(acceptanceSpecifier), import(accessSpecifier),
  ]);
  const dependencies = { ...issuance, ...acceptance, ...access };
  const importSession = async () => ({
    ...dependencies,
    ...await import(sessionSpecifier),
  });
  return aroundSessionImport === undefined
    ? importSession()
    : aroundSessionImport({ dependencies, importSession });
}

const IDS = Object.freeze({
  invitation: 'id_1000000000000001', issuer: 'id_1000000000000002',
  issuanceAuthority: 'id_1000000000000003', recipient: 'id_1000000000000004',
  participationAuthority: 'id_1000000000000005', purpose: 'id_1000000000000006',
  material: 'id_1000000000000007', evidence: 'id_1000000000000008',
  revocationAuthority: 'id_1000000000000009', issuanceSource: 'id_100000000000000a',
  issuanceAuthorization: 'id_100000000000000b', acceptanceSource: 'id_100000000000000c',
  acceptanceAuthorization: 'id_100000000000000d', tenant: 'id_100000000000000e',
  meeting: 'id_100000000000000f', session: 'id_1000000000000010',
  startSource: 'id_1000000000000011', startAuthority: 'id_1000000000000012',
});

function readinessCandidate() {
  return {
    schemaVersion: 'invitation-readiness/1', invitationReference: IDS.invitation,
    issuer: { subjectReference: IDS.issuer, issuanceAuthorizationReference: IDS.issuanceAuthority },
    recipient: { subjectReference: IDS.recipient, participationAuthorizationReference: IDS.participationAuthority },
    purpose: { purposeReference: IDS.purpose },
    materials: [{ materialReference: IDS.material, evidenceReference: IDS.evidence }],
    access: { scope: 'readiness_only', grantsAccess: false }, lifecycle: { state: 'prepared_only' },
    validity: { preparedAt: '2000-01-01T00:00:00.000Z', validFrom: '2000-01-01T00:01:00.000Z', expiresAt: '2000-01-01T00:03:00.000Z' },
    revocation: { state: 'not_revoked_yet', revocationAuthorityReference: IDS.revocationAuthority },
  };
}

function createAcceptedAccess(domain) {
  const readinessDocument = JSON.stringify(readinessCandidate());
  const issuanceEvent = domain.createPrivateMeetingInvitationIssuanceEvent(
    readinessDocument, IDS.issuanceSource, IDS.issuanceAuthorization, 1, '2000-01-01T00:00:30.000Z',
  );
  const acceptanceEvent = domain.createPrivateMeetingInvitationAcceptanceEvent(
    readinessDocument, issuanceEvent, IDS.recipient, IDS.acceptanceSource,
    IDS.acceptanceAuthorization, 2, '2000-01-01T00:01:20.000Z',
  );
  const policyObservation = domain.createPrivateMeetingTemporaryAccessPolicyObservation(
    readinessDocument, issuanceEvent, acceptanceEvent, IDS.tenant, IDS.meeting,
    2, 'active', 'policy_current', '2000-01-01T00:01:30.000Z',
  );
  return { readinessDocument, issuanceEvent, acceptanceEvent, policyObservation };
}

function startCommand(domain, overrides = {}) {
  const command = {
    sessionId: IDS.session,
    sourceEventId: IDS.startSource,
    startAuthorityReference: IDS.acceptanceAuthorization,
    startedAt: '2000-01-01T00:01:30.000Z',
    ...overrides,
  };
  return domain.createPrivateMeetingSessionStartCommand(
    command.sessionId, command.sourceEventId,
    command.startAuthorityReference, command.startedAt,
  );
}

test('exact accepted invitation and active temporary entry yield one minimal session-start event', async () => {
  const domain = await loadDomain('minimal-start');
  assert.equal(domain.missingCapability, undefined, `missing capability token: ${domain.missingCapability}`);
  const accepted = createAcceptedAccess(domain);
  const event = domain.createPrivateMeetingSessionStartEvent(
    accepted.readinessDocument, accepted.issuanceEvent, accepted.acceptanceEvent,
    accepted.policyObservation, startCommand(domain),
  );
  assert.deepEqual({ ...event }, {
    schemaVersion: 'private-meeting-session-start/1',
    tenantId: IDS.tenant,
    meetingId: IDS.meeting,
    sessionId: IDS.session,
    invitationId: IDS.invitation,
    subjectId: IDS.recipient,
    policyRevision: 2,
    startedAt: '2000-01-01T00:01:30.000Z',
    sourceEventId: IDS.startSource,
    lifecycleState: 'started',
    participationState: 'joined',
    reason: 'invited_temporary_access',
  });
});

test('exact same-module session-start event is accepted by identity while a frozen structural copy is rejected', async () => {
  const domain = await loadDomain('event-provenance-identity');
  assert.equal(typeof domain.requirePrivateMeetingSessionStartEvent, 'function');
  const accepted = createAcceptedAccess(domain);
  const event = domain.createPrivateMeetingSessionStartEvent(
    accepted.readinessDocument, accepted.issuanceEvent, accepted.acceptanceEvent,
    accepted.policyObservation, startCommand(domain),
  );
  assert.equal(domain.requirePrivateMeetingSessionStartEvent(event), event);
  const structuralCopy = Object.freeze(Object.assign(Object.create(null), event));
  assert.throws(() => domain.requirePrivateMeetingSessionStartEvent(structuralCopy), {
    name: 'TypeError', message: 'Invalid private meeting session start input',
  });
});

test('session-start event provenance rejects a genuine event from another module instance', async () => {
  const domain = await loadDomain('event-provenance-cross-module-a');
  const otherDomain = await loadDomain('event-provenance-cross-module-b');
  const accepted = createAcceptedAccess(domain);
  const event = domain.createPrivateMeetingSessionStartEvent(
    accepted.readinessDocument, accepted.issuanceEvent, accepted.acceptanceEvent,
    accepted.policyObservation, startCommand(domain),
  );
  assert.throws(() => otherDomain.requirePrivateMeetingSessionStartEvent(event), {
    name: 'TypeError', message: 'Invalid private meeting session start input',
  });
});

test('session-start event provenance rejects an inherited child of a genuine event', async () => {
  const domain = await loadDomain('event-provenance-inherited');
  const accepted = createAcceptedAccess(domain);
  const event = domain.createPrivateMeetingSessionStartEvent(
    accepted.readinessDocument, accepted.issuanceEvent, accepted.acceptanceEvent,
    accepted.policyObservation, startCommand(domain),
  );
  const inherited = Object.freeze(Object.create(event));
  assert.throws(() => domain.requirePrivateMeetingSessionStartEvent(inherited), {
    name: 'TypeError', message: 'Invalid private meeting session start input',
  });
});

test('session-start event provenance rejects a JSON round trip of a genuine event', async () => {
  const domain = await loadDomain('event-provenance-json-copy');
  const accepted = createAcceptedAccess(domain);
  const event = domain.createPrivateMeetingSessionStartEvent(
    accepted.readinessDocument, accepted.issuanceEvent, accepted.acceptanceEvent,
    accepted.policyObservation, startCommand(domain),
  );
  const jsonCopy = Object.freeze(JSON.parse(JSON.stringify(event)));
  assert.throws(() => domain.requirePrivateMeetingSessionStartEvent(jsonCopy), {
    name: 'TypeError', message: 'Invalid private meeting session start input',
  });
});

test('session-start event provenance rejects a null-prototype copy of a genuine event', async () => {
  const domain = await loadDomain('event-provenance-null-copy');
  const accepted = createAcceptedAccess(domain);
  const event = domain.createPrivateMeetingSessionStartEvent(
    accepted.readinessDocument, accepted.issuanceEvent, accepted.acceptanceEvent,
    accepted.policyObservation, startCommand(domain),
  );
  const nullPrototypeCopy = Object.freeze(Object.assign(Object.create(null), event));
  assert.throws(() => domain.requirePrivateMeetingSessionStartEvent(nullPrototypeCopy), {
    name: 'TypeError', message: 'Invalid private meeting session start input',
  });
});

test('session-start event provenance rejects object array and function wrappers', async () => {
  const domain = await loadDomain('event-provenance-wrappers');
  const accepted = createAcceptedAccess(domain);
  const event = domain.createPrivateMeetingSessionStartEvent(
    accepted.readinessDocument, accepted.issuanceEvent, accepted.acceptanceEvent,
    accepted.policyObservation, startCommand(domain),
  );
  for (const wrapper of [Object.freeze({ event }), Object.freeze([event]), () => event]) {
    assert.throws(() => domain.requirePrivateMeetingSessionStartEvent(wrapper), {
      name: 'TypeError', message: 'Invalid private meeting session start input',
    });
  }
});

test('session-start event provenance rejects hostile proxies accessors and coercible values with zero hooks', async () => {
  const domain = await loadDomain('event-provenance-zero-hooks');
  const accepted = createAcceptedAccess(domain);
  const event = domain.createPrivateMeetingSessionStartEvent(
    accepted.readinessDocument, accepted.issuanceEvent, accepted.acceptanceEvent,
    accepted.policyObservation, startCommand(domain),
  );
  let hooks = 0;
  const proxy = new Proxy(event, {
    get() { hooks += 1; throw new Error('must not read'); },
    getPrototypeOf() { hooks += 1; throw new Error('must not inspect'); },
    ownKeys() { hooks += 1; throw new Error('must not enumerate'); },
  });
  const revoked = Proxy.revocable(event, {
    get() { hooks += 1; throw new Error('must not read'); },
  });
  revoked.revoke();
  const accessor = Object.create(null);
  Object.defineProperty(accessor, 'event', {
    get() { hooks += 1; throw new Error('must not read'); },
  });
  const coercible = {
    valueOf() { hooks += 1; return event; },
    toString() { hooks += 1; return '[event]'; },
    [Symbol.toPrimitive]() { hooks += 1; return '[event]'; },
  };
  for (const value of [proxy, revoked.proxy, accessor, coercible, null, undefined, true, 1, 1n, 'event', Symbol('event')]) {
    assert.throws(() => domain.requirePrivateMeetingSessionStartEvent(value), {
      name: 'TypeError', message: 'Invalid private meeting session start input',
    });
  }
  assert.equal(hooks, 0);
});

test('failed session-start construction does not register any supplied object as an event', async () => {
  const domain = await loadDomain('event-provenance-failed-start');
  const accepted = createAcceptedAccess(domain);
  const command = startCommand(domain, { startedAt: '2000-01-01T00:03:00.000Z' });
  assert.throws(() => domain.createPrivateMeetingSessionStartEvent(
    accepted.readinessDocument, accepted.issuanceEvent, accepted.acceptanceEvent,
    accepted.policyObservation, command,
  ), { name: 'TypeError', message: 'Invalid private meeting session start input' });
  for (const suppliedObject of [
    accepted.issuanceEvent, accepted.acceptanceEvent, accepted.policyObservation, command,
  ]) {
    assert.throws(() => domain.requirePrivateMeetingSessionStartEvent(suppliedObject), {
      name: 'TypeError', message: 'Invalid private meeting session start input',
    });
  }
});

test('successful session-start provenance preserves the exact genuine event unchanged', async () => {
  const domain = await loadDomain('event-provenance-unchanged');
  const accepted = createAcceptedAccess(domain);
  const event = domain.createPrivateMeetingSessionStartEvent(
    accepted.readinessDocument, accepted.issuanceEvent, accepted.acceptanceEvent,
    accepted.policyObservation, startCommand(domain),
  );
  const before = Object.getOwnPropertyDescriptors(event);
  const result = domain.requirePrivateMeetingSessionStartEvent(event);
  assert.equal(result, event);
  assert.deepEqual(Object.getOwnPropertyDescriptors(event), before);
  assert.equal(Object.getPrototypeOf(event), null);
  assert.equal(Object.isFrozen(event), true);
});

test('session-start ownership uses captured intrinsics after ambient WeakSet hooks change', async () => {
  const domain = await loadDomain('event-provenance-captured-intrinsics');
  const accepted = createAcceptedAccess(domain);
  let hooks = 0;
  const originalAdd = WeakSet.prototype.add;
  const originalHas = WeakSet.prototype.has;
  WeakSet.prototype.add = function (...args) { hooks += 1; return originalAdd.apply(this, args); };
  WeakSet.prototype.has = function (...args) { hooks += 1; return originalHas.apply(this, args); };
  try {
    const event = domain.createPrivateMeetingSessionStartEvent(
      accepted.readinessDocument, accepted.issuanceEvent, accepted.acceptanceEvent,
      accepted.policyObservation, startCommand(domain),
    );
    assert.equal(domain.requirePrivateMeetingSessionStartEvent(event), event);
  } finally {
    WeakSet.prototype.add = originalAdd;
    WeakSet.prototype.has = originalHas;
  }
  assert.equal(hooks, 0);
});

test('session-start ownership executes no hostile pre-import WeakSet method accessors', async () => {
  let hooks = 0;
  await loadDomain('event-provenance-pre-import-weak-set', async ({ dependencies, importSession }) => {
    const accepted = createAcceptedAccess(dependencies);
    const addDescriptor = Object.getOwnPropertyDescriptor(WeakSet.prototype, 'add');
    const hasDescriptor = Object.getOwnPropertyDescriptor(WeakSet.prototype, 'has');
    Object.defineProperty(WeakSet.prototype, 'add', {
      configurable: true,
      get() { hooks += 1; return addDescriptor.value; },
    });
    Object.defineProperty(WeakSet.prototype, 'has', {
      configurable: true,
      get() { hooks += 1; return hasDescriptor.value; },
    });
    try {
      const domain = await importSession();
      const event = domain.createPrivateMeetingSessionStartEvent(
        accepted.readinessDocument, accepted.issuanceEvent, accepted.acceptanceEvent,
        accepted.policyObservation, startCommand(domain),
      );
      assert.equal(domain.requirePrivateMeetingSessionStartEvent(event), event);
    } finally {
      Object.defineProperty(WeakSet.prototype, 'add', addDescriptor);
      Object.defineProperty(WeakSet.prototype, 'has', hasDescriptor);
    }
  });
  assert.equal(hooks, 0);
});

test('session start requires exact module-owned invitation and access provenance', async () => {
  const domain = await loadDomain('exact-provenance-a');
  const otherDomain = await loadDomain('exact-provenance-b');
  const accepted = createAcceptedAccess(domain);
  const command = startCommand(domain);
  const attempts = [
    () => domain.createPrivateMeetingSessionStartEvent(
      accepted.readinessDocument, { ...accepted.issuanceEvent }, accepted.acceptanceEvent,
      accepted.policyObservation, command,
    ),
    () => domain.createPrivateMeetingSessionStartEvent(
      accepted.readinessDocument, accepted.issuanceEvent, { ...accepted.acceptanceEvent },
      accepted.policyObservation, command,
    ),
    () => domain.createPrivateMeetingSessionStartEvent(
      accepted.readinessDocument, accepted.issuanceEvent, accepted.acceptanceEvent,
      { ...accepted.policyObservation }, command,
    ),
    () => otherDomain.createPrivateMeetingSessionStartEvent(
      accepted.readinessDocument, accepted.issuanceEvent, accepted.acceptanceEvent,
      accepted.policyObservation, command,
    ),
  ];
  for (const attempt of attempts) {
    assert.throws(attempt, {
      name: 'TypeError', message: 'Invalid private meeting session start input',
    });
  }
});

test('session source identities are opaque and distinct from every bound identity', async () => {
  const domain = await loadDomain('identity-binding');
  const accepted = createAcceptedAccess(domain);
  const invalidOverrides = [
    { sessionId: 'visible-session' },
    { sourceEventId: IDS.session },
    { startAuthorityReference: IDS.startSource },
    { sessionId: IDS.tenant },
    { sourceEventId: IDS.meeting },
    { startAuthorityReference: IDS.invitation },
    { sessionId: IDS.recipient },
  ];
  for (const overrides of invalidOverrides) {
    assert.throws(() => {
      const command = startCommand(domain, overrides);
      return domain.createPrivateMeetingSessionStartEvent(
        accepted.readinessDocument, accepted.issuanceEvent, accepted.acceptanceEvent,
        accepted.policyObservation, command,
      );
    }, { name: 'TypeError', message: 'Invalid private meeting session start input' });
  }
});

test('session start authority is bound to the exact accepted invitation authority', async () => {
  const domain = await loadDomain('start-authority-binding');
  const accepted = createAcceptedAccess(domain);
  const exactAuthority = startCommand(domain, {
    startAuthorityReference: IDS.acceptanceAuthorization,
  });
  const event = domain.createPrivateMeetingSessionStartEvent(
    accepted.readinessDocument, accepted.issuanceEvent, accepted.acceptanceEvent,
    accepted.policyObservation, exactAuthority,
  );
  assert.equal(event.sessionId, IDS.session);
  assert.throws(() => domain.createPrivateMeetingSessionStartEvent(
    accepted.readinessDocument, accepted.issuanceEvent, accepted.acceptanceEvent,
    accepted.policyObservation, startCommand(domain, {
      startAuthorityReference: 'id_1000000000000013',
    }),
  ), { name: 'TypeError', message: 'Invalid private meeting session start input' });
});

test('session module executes no hostile pre-import Object construction hooks', async () => {
  let hooks = 0;
  await loadDomain('hostile-object-hooks', async ({ dependencies, importSession }) => {
    const accepted = createAcceptedAccess(dependencies);
    const originalFreeze = Object.freeze;
    const originalAssign = Object.assign;
    const originalCreate = Object.create;
    Object.freeze = (...args) => { hooks += 1; return originalFreeze(...args); };
    Object.assign = (...args) => { hooks += 1; return originalAssign(...args); };
    Object.create = (...args) => { hooks += 1; return originalCreate(...args); };
    try {
      const domain = await importSession();
      const command = startCommand(domain);
      domain.createPrivateMeetingSessionStartEvent(
        accepted.readinessDocument, accepted.issuanceEvent, accepted.acceptanceEvent,
        accepted.policyObservation, command,
      );
    } finally {
      Object.freeze = originalFreeze;
      Object.assign = originalAssign;
      Object.create = originalCreate;
    }
  });
  assert.equal(hooks, 0);
});

test('session start is canonical at the grant boundary and strictly before access expiry', async () => {
  const domain = await loadDomain('start-chronology');
  const accepted = createAcceptedAccess(domain);
  const atGrant = domain.createPrivateMeetingSessionStartEvent(
    accepted.readinessDocument, accepted.issuanceEvent, accepted.acceptanceEvent,
    accepted.policyObservation, startCommand(domain),
  );
  assert.equal(atGrant.startedAt, '2000-01-01T00:01:30.000Z');
  for (const startedAt of [
    '2000-01-01T00:01:29.999Z',
    '2000-01-01T00:03:00.000Z',
    '2000-01-01T00:01:30Z',
    '2000-02-30T00:01:30.000Z',
  ]) {
    assert.throws(() => domain.createPrivateMeetingSessionStartEvent(
      accepted.readinessDocument, accepted.issuanceEvent, accepted.acceptanceEvent,
      accepted.policyObservation, startCommand(domain, { startedAt }),
    ), { name: 'TypeError', message: 'Invalid private meeting session start input' });
  }
});

test('session start command is closed plain data and rejects hostile values without coercion', async () => {
  const domain = await loadDomain('closed-command');
  const accepted = createAcceptedAccess(domain);
  let hooks = 0;
  const accessor = {
    sourceEventId: IDS.startSource,
    startAuthorityReference: IDS.startAuthority,
    startedAt: '2000-01-01T00:01:30.000Z',
  };
  Object.defineProperty(accessor, 'sessionId', {
    enumerable: true,
    get() { hooks += 1; return IDS.session; },
  });
  Object.freeze(accessor);
  const hostileValue = new Proxy({}, {
    get() { hooks += 1; throw new Error('must not read'); },
    getPrototypeOf() { hooks += 1; throw new Error('must not inspect'); },
    ownKeys() { hooks += 1; throw new Error('must not enumerate'); },
  });
  const inherited = Object.create(startCommand(domain));
  const symbolKey = { ...startCommand(domain) };
  symbolKey[Symbol('authority')] = true;
  Object.freeze(symbolKey);
  const invalidCommands = [
    accessor,
    inherited,
    Object.freeze({ ...startCommand(domain), unknown: true }),
    symbolKey,
    [IDS.session, IDS.startSource, IDS.startAuthority, '2000-01-01T00:01:30.000Z'],
  ];
  for (const command of invalidCommands) {
    assert.throws(() => domain.createPrivateMeetingSessionStartEvent(
      accepted.readinessDocument, accepted.issuanceEvent, accepted.acceptanceEvent,
      accepted.policyObservation, command,
    ), { name: 'TypeError', message: 'Invalid private meeting session start input' });
  }
  for (const overrides of [
    { sessionId: hostileValue },
    { startedAt: { toString() { hooks += 1; return '2000-01-01T00:01:30.000Z'; } } },
  ]) {
    assert.throws(() => startCommand(domain, overrides), {
      name: 'TypeError', message: 'Invalid private meeting session start input',
    });
  }
  assert.equal(hooks, 0);

  const racing = new Proxy({ ...startCommand(domain) }, {
    ownKeys() { hooks += 1; return Reflect.ownKeys(startCommand(domain)); },
  });
  assert.throws(() => domain.createPrivateMeetingSessionStartEvent(
    accepted.readinessDocument, accepted.issuanceEvent, accepted.acceptanceEvent,
    accepted.policyObservation, racing,
  ), { name: 'TypeError', message: 'Invalid private meeting session start input' });
});

test('a frozen Proxy command rejects before executing any attacker hook', async () => {
  const domain = await loadDomain('frozen-proxy-command');
  const accepted = createAcceptedAccess(domain);
  let hooks = 0;
  const target = startCommand(domain);
  const command = new Proxy(target, {
    isExtensible(value) { hooks += 1; return Reflect.isExtensible(value); },
    ownKeys(value) { hooks += 1; return Reflect.ownKeys(value); },
    getOwnPropertyDescriptor(value, key) {
      hooks += 1;
      return Reflect.getOwnPropertyDescriptor(value, key);
    },
    getPrototypeOf(value) { hooks += 1; return Reflect.getPrototypeOf(value); },
  });
  assert.throws(() => domain.createPrivateMeetingSessionStartEvent(
    accepted.readinessDocument, accepted.issuanceEvent, accepted.acceptanceEvent,
    accepted.policyObservation, command,
  ), { name: 'TypeError', message: 'Invalid private meeting session start input' });
  assert.equal(hooks, 0);
});

test('session event is detached frozen null-prototype data with no authority expansion', async () => {
  const domain = await loadDomain('closed-output');
  const accepted = createAcceptedAccess(domain);
  const event = domain.createPrivateMeetingSessionStartEvent(
    accepted.readinessDocument, accepted.issuanceEvent, accepted.acceptanceEvent,
    accepted.policyObservation, startCommand(domain),
  );
  assert.equal(Object.getPrototypeOf(event), null);
  assert.equal(Object.isFrozen(event), true);
  assert.deepEqual(Object.keys(event), [
    'schemaVersion', 'tenantId', 'meetingId', 'sessionId', 'invitationId',
    'subjectId', 'policyRevision', 'startedAt', 'sourceEventId',
    'lifecycleState', 'participationState', 'reason',
  ]);
  for (const forbidden of [
    'membership', 'roomOccupancy', 'agenda', 'materials', 'privateTaskData',
    'transcript', 'credentials', 'provider', 'financialData', 'customerData',
    'meetingAdministration', 'recordAccess', 'decisionAuthority', 'spending',
    'externalCommunication', 'protectedRelease', 'role', 'skill', 'permission',
  ]) assert.equal(forbidden in event, false);
  assert.throws(() => { event.lifecycleState = 'ended'; }, TypeError);
});

test('inactive stale and mismatched access fail closed with one generic error', async () => {
  const domain = await loadDomain('generic-unavailable');
  const accepted = createAcceptedAccess(domain);
  const inactivePolicy = domain.createPrivateMeetingTemporaryAccessPolicyObservation(
    accepted.readinessDocument, accepted.issuanceEvent, accepted.acceptanceEvent,
    IDS.tenant, IDS.meeting, 2, 'revoked', 'policy_inactive', '2000-01-01T00:01:30.000Z',
  );
  const equivalent = createAcceptedAccess(domain);
  const attempts = [
    () => domain.createPrivateMeetingSessionStartEvent(
      accepted.readinessDocument, accepted.issuanceEvent, accepted.acceptanceEvent,
      inactivePolicy, startCommand(domain),
    ),
    () => domain.createPrivateMeetingSessionStartEvent(
      equivalent.readinessDocument, equivalent.issuanceEvent, equivalent.acceptanceEvent,
      accepted.policyObservation, startCommand(domain),
    ),
    () => domain.createPrivateMeetingSessionStartEvent(
      accepted.readinessDocument, accepted.issuanceEvent, accepted.acceptanceEvent,
      accepted.policyObservation, startCommand(domain, { startedAt: '2000-01-01T00:03:00.000Z' }),
    ),
  ];
  for (const attempt of attempts) {
    assert.throws(attempt, {
      name: 'TypeError', message: 'Invalid private meeting session start input',
    });
  }
});

test('session-start boundary stays dormant outside the private domain module', async () => {
  const [sessionSource, mainSource] = await Promise.all([
    readFile(sessionUrl, 'utf8'),
    readFile(new URL('../src/main.ts', import.meta.url), 'utf8'),
  ]);
  const importedSpecifiers = Array.from(
    sessionSource.matchAll(/^import\s+.+?\s+from\s+['"]([^'"]+)['"];?$/gm),
    (match) => match[1],
  );
  assert.deepEqual(importedSpecifiers, [
    './privateMeetingTemporary\\u0041ccess',
    './privateMeetingInvitation\\u0049ssuance',
  ]);
  assert.doesNotMatch(mainSource, /privateMeetingSessionStart/);
  assert.doesNotMatch(sessionSource, /\b(?:fetch|XMLHttpRequest|WebSocket|setTimeout|setInterval|process|document|window|localStorage|sessionStorage)\b/);
  assert.doesNotMatch(sessionSource, /(?:route|server|provider|database|renderer|animation|occupancy|hermes)/i);
});
