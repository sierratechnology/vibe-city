import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const endUrl = new URL('../src/domain/privateMeetingSessionEnd.ts', import.meta.url);
const startUrl = new URL('../src/domain/privateMeetingSessionStart.ts', import.meta.url);
const accessUrl = new URL('../src/domain/privateMeetingTemporaryAccess.ts', import.meta.url);
const acceptanceUrl = new URL('../src/domain/privateMeetingInvitationAcceptance.ts', import.meta.url);
const issuanceUrl = new URL('../src/domain/privateMeetingInvitationIssuance.ts', import.meta.url);
const readinessUrl = new URL('../src/domain/meetingInvitationReadiness.ts', import.meta.url);

async function loadDomain(tag) {
  const [endSource, startSource, accessSource, acceptanceSource, issuanceSource, readinessSource] = await Promise.all([
    readFile(endUrl, 'utf8').catch(() => null),
    readFile(startUrl, 'utf8'),
    readFile(accessUrl, 'utf8'),
    readFile(acceptanceUrl, 'utf8'),
    readFile(issuanceUrl, 'utf8'),
    readFile(readinessUrl, 'utf8'),
  ]);
  if (endSource === null) return Object.freeze({ missingCapability: 'private-meeting-session-end' });
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
  const startOutput = ts.transpileModule(startSource, options).outputText
    .replace(/['"]\.\/privateMeetingTemporary(?:Access|\\u0041ccess)['"]/, JSON.stringify(accessSpecifier))
    .replace(/['"]\.\/privateMeetingInvitation(?:Issuance|\\u0049ssuance)['"]/, JSON.stringify(issuanceSpecifier));
  const startSpecifier = `data:text/javascript;base64,${Buffer.from(startOutput).toString('base64')}#start-${tag}`;
  const endOutput = ts.transpileModule(endSource, options).outputText
    .replace(/['"]\.\/privateMeetingSession(?:Start|\\u0053tart)['"]/, JSON.stringify(startSpecifier))
    .replace(/['"]\.\/privateMeetingTemporary(?:Access|\\u0041ccess)['"]/, JSON.stringify(accessSpecifier))
    .replace(/['"]\.\/privateMeetingInvitation(?:Issuance|\\u0049ssuance)['"]/, JSON.stringify(issuanceSpecifier));
  const endSpecifier = `data:text/javascript;base64,${Buffer.from(endOutput).toString('base64')}#end-${tag}`;
  const [issuance, acceptance, access, start, end] = await Promise.all([
    import(issuanceSpecifier), import(acceptanceSpecifier), import(accessSpecifier),
    import(startSpecifier), import(endSpecifier),
  ]);
  return { ...issuance, ...acceptance, ...access, ...start, ...end };
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
  startSource: 'id_1000000000000011', endSource: 'id_1000000000000012',
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

function createContext(domain) {
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
  const startCommand = domain.createPrivateMeetingSessionStartCommand(
    IDS.session, IDS.startSource, IDS.acceptanceAuthorization, '2000-01-01T00:01:30.000Z',
  );
  const startEvent = domain.createPrivateMeetingSessionStartEvent(
    readinessDocument, issuanceEvent, acceptanceEvent, policyObservation, startCommand,
  );
  return { readinessDocument, issuanceEvent, acceptanceEvent, policyObservation, startEvent };
}

function endCommand(domain, overrides = {}) {
  const command = {
    sourceEventId: IDS.endSource,
    endAuthorityReference: IDS.acceptanceAuthorization,
    endedAt: '2000-01-01T00:02:00.000Z',
    ...overrides,
  };
  return domain.createPrivateMeetingSessionEndCommand(
    command.sourceEventId, command.endAuthorityReference, command.endedAt,
  );
}

function createEnd(domain, context, command = endCommand(domain)) {
  return domain.createPrivateMeetingSessionEndEvent(
    context.readinessDocument, context.issuanceEvent, context.acceptanceEvent,
    context.policyObservation, context.startEvent, command,
  );
}

test('exact accepted session start yields one minimal session-end event', async () => {
  const domain = await loadDomain('minimal-end');
  assert.equal(domain.missingCapability, undefined, `missing capability token: ${domain.missingCapability}`);
  const event = createEnd(domain, createContext(domain));
  assert.deepEqual({ ...event }, {
    schemaVersion: 'private-meeting-session-end/1',
    tenantId: IDS.tenant,
    meetingId: IDS.meeting,
    sessionId: IDS.session,
    invitationId: IDS.invitation,
    subjectId: IDS.recipient,
    policyRevision: 2,
    startedAt: '2000-01-01T00:01:30.000Z',
    endedAt: '2000-01-01T00:02:00.000Z',
    sourceEventId: IDS.endSource,
    lifecycleState: 'ended',
    participationState: 'left',
    reason: 'invited_temporary_access_expired_or_ended',
  });
});

test('session-end verifier accepts only an exact event owned by this module instance', async () => {
  const domain = await loadDomain('end-event-provenance');
  const otherDomain = await loadDomain('end-event-provenance-other');
  const event = createEnd(domain, createContext(domain));
  const otherEvent = createEnd(otherDomain, createContext(otherDomain));
  let hooks = 0;
  const proxy = new Proxy(event, {
    get() { hooks += 1; throw new Error('must not read'); },
    ownKeys() { hooks += 1; throw new Error('must not enumerate'); },
    getPrototypeOf() { hooks += 1; throw new Error('must not inspect'); },
  });
  const accessor = Object.create(null);
  Object.defineProperty(accessor, 'schemaVersion', {
    enumerable: true,
    get() { hooks += 1; throw new Error('must not read'); },
  });

  assert.equal(domain.requirePrivateMeetingSessionEndEvent(event), event);
  for (const invalidEvent of [
    Object.freeze(Object.assign(Object.create(null), event)),
    JSON.parse(JSON.stringify(event)),
    Object.freeze(Object.create(event)),
    proxy,
    Object.freeze(accessor),
    otherEvent,
  ]) {
    assert.throws(() => domain.requirePrivateMeetingSessionEndEvent(invalidEvent), {
      name: 'TypeError', message: 'Invalid private meeting session end input',
    });
  }
  assert.equal(hooks, 0);
});

test('session end requires exact start provenance and rejects replay', async () => {
  const domain = await loadDomain('start-provenance');
  const otherDomain = await loadDomain('start-provenance-other');
  const context = createContext(domain);
  createEnd(domain, context);
  for (const startEvent of [
    context.startEvent,
    Object.freeze(Object.assign(Object.create(null), context.startEvent)),
    JSON.parse(JSON.stringify(context.startEvent)),
    Object.freeze(Object.create(context.startEvent)),
    createContext(otherDomain).startEvent,
  ]) {
    assert.throws(() => createEnd(domain, { ...context, startEvent }), {
      name: 'TypeError', message: 'Invalid private meeting session end input',
    });
  }
});

test('end source identity is opaque and distinct from every bound identity', async (t) => {
  const domain = await loadDomain('identity-binding');
  const context = createContext(domain);
  for (const sourceEventId of [
    'visible-end', IDS.tenant, IDS.meeting, IDS.session, IDS.invitation,
    IDS.recipient, IDS.startSource, IDS.acceptanceAuthorization,
  ]) {
    assert.throws(() => createEnd(
      domain, context, endCommand(domain, { sourceEventId }),
    ), { name: 'TypeError', message: 'Invalid private meeting session end input' });
  }
  for (const [name, selectSourceEventId] of [
    ['exact issuance source reference', (candidate) => candidate.issuanceEvent.sourceReference],
    ['exact acceptance source reference', (candidate) => candidate.acceptanceEvent.sourceReference],
  ]) {
    await t.test(name, () => {
      const collisionContext = createContext(domain);
      assert.throws(() => createEnd(
        domain, collisionContext, endCommand(domain, {
          sourceEventId: selectSourceEventId(collisionContext),
        }),
      ), { name: 'TypeError', message: 'Invalid private meeting session end input' });
    });
  }
});

test('session end is canonical strictly after start and no later than access expiry', async () => {
  const domain = await loadDomain('end-chronology');
  const atExpiry = createEnd(
    domain, createContext(domain), endCommand(domain, { endedAt: '2000-01-01T00:03:00.000Z' }),
  );
  assert.equal(atExpiry.endedAt, '2000-01-01T00:03:00.000Z');
  for (const endedAt of [
    '2000-01-01T00:01:30.000Z',
    '2000-01-01T00:01:29.999Z',
    '2000-01-01T00:03:00.001Z',
    '2000-01-01T00:02:00Z',
    '2000-02-30T00:02:00.000Z',
  ]) {
    assert.throws(() => createEnd(
      domain, createContext(domain), endCommand(domain, { endedAt }),
    ), { name: 'TypeError', message: 'Invalid private meeting session end input' });
  }
});

test('end command is closed module-owned data and rejects hostile values with zero hooks', async () => {
  const domain = await loadDomain('closed-command');
  const otherDomain = await loadDomain('closed-command-other');
  const command = endCommand(domain);
  assert.equal(Object.getPrototypeOf(command), null);
  assert.equal(Object.isFrozen(command), true);
  assert.deepEqual(Object.keys(command), ['sourceEventId', 'endAuthorityReference', 'endedAt']);
  let hooks = 0;
  const proxy = new Proxy(command, {
    get() { hooks += 1; throw new Error('must not read'); },
    ownKeys() { hooks += 1; throw new Error('must not enumerate'); },
    getPrototypeOf() { hooks += 1; throw new Error('must not inspect'); },
  });
  for (const invalidCommand of [
    Object.freeze({ ...command }), Object.freeze(Object.create(command)), proxy,
    endCommand(otherDomain), Object.freeze([command]),
  ]) {
    assert.throws(() => createEnd(domain, createContext(domain), invalidCommand), {
      name: 'TypeError', message: 'Invalid private meeting session end input',
    });
  }
  for (const value of [
    { toString() { hooks += 1; return IDS.endSource; } },
    { valueOf() { hooks += 1; return '2000-01-01T00:02:00.000Z'; } },
  ]) {
    assert.throws(() => domain.createPrivateMeetingSessionEndCommand(
      value, IDS.acceptanceAuthorization, value,
    ), { name: 'TypeError', message: 'Invalid private meeting session end input' });
  }
  assert.equal(hooks, 0);
});

test('stale mismatched or revoked authority fails closed with one generic error', async () => {
  const domain = await loadDomain('generic-denial');
  const context = createContext(domain);
  const equivalent = createContext(domain);
  const revokedPolicy = domain.createPrivateMeetingTemporaryAccessPolicyObservation(
    context.readinessDocument, context.issuanceEvent, context.acceptanceEvent,
    IDS.tenant, IDS.meeting, 2, 'revoked', 'policy_inactive', '2000-01-01T00:02:00.000Z',
  );
  const attempts = [
    () => createEnd(domain, { ...context, policyObservation: revokedPolicy }),
    () => createEnd(domain, { ...equivalent, policyObservation: context.policyObservation }),
    () => createEnd(domain, context, endCommand(domain, {
      endAuthorityReference: 'id_1000000000000013',
    })),
  ];
  for (const attempt of attempts) {
    assert.throws(attempt, {
      name: 'TypeError', message: 'Invalid private meeting session end input',
    });
  }
});

test('session-end event is detached frozen null-prototype data with no authority expansion', async () => {
  const domain = await loadDomain('closed-output');
  const event = createEnd(domain, createContext(domain));
  assert.equal(Object.getPrototypeOf(event), null);
  assert.equal(Object.isFrozen(event), true);
  assert.deepEqual(Object.keys(event), [
    'schemaVersion', 'tenantId', 'meetingId', 'sessionId', 'invitationId',
    'subjectId', 'policyRevision', 'startedAt', 'endedAt', 'sourceEventId',
    'lifecycleState', 'participationState', 'reason',
  ]);
  for (const forbidden of [
    'membership', 'roomOccupancy', 'agenda', 'materials', 'privateTaskData',
    'transcript', 'credentials', 'provider', 'financialData', 'customerData',
    'meetingAdministration', 'recordAccess', 'decisionAuthority', 'spending',
    'externalCommunication', 'protectedRelease', 'role', 'skill', 'permission',
    'outcome', 'endAuthorityReference',
  ]) assert.equal(forbidden in event, false);
  assert.throws(() => { event.lifecycleState = 'started'; }, TypeError);
});

test('session replay tracking executes no ambient Array prototype hook', async () => {
  const domain = await loadDomain('replay-zero-hooks');
  const context = createContext(domain);
  createEnd(domain, context);
  let hooks = 0;
  const descriptor = Object.getOwnPropertyDescriptor(Array.prototype, '0');
  Object.defineProperty(Array.prototype, '0', {
    configurable: true,
    set() { hooks += 1; },
  });
  try {
    assert.throws(() => createEnd(domain, context), {
      name: 'TypeError', message: 'Invalid private meeting session end input',
    });
  } finally {
    if (descriptor === undefined) delete Array.prototype[0];
    else Object.defineProperty(Array.prototype, '0', descriptor);
  }
  assert.equal(hooks, 0);
});

test('session-end boundary stays dormant outside the private domain module', async () => {
  const [endSource, mainSource] = await Promise.all([
    readFile(endUrl, 'utf8'),
    readFile(new URL('../src/main.ts', import.meta.url), 'utf8'),
  ]);
  const importedSpecifiers = Array.from(
    endSource.matchAll(/\bfrom\s+['"]([^'"]+)['"];?/g),
    (match) => match[1],
  );
  assert.deepEqual(importedSpecifiers, [
    './privateMeetingInvitation\\u0049ssuance',
    './privateMeetingSession\\u0053tart',
    './privateMeetingTemporary\\u0041ccess',
  ]);
  assert.doesNotMatch(mainSource, /privateMeetingSessionEnd/);
  assert.doesNotMatch(endSource, /\b(?:fetch|XMLHttpRequest|WebSocket|setTimeout|setInterval|process|document|window|localStorage|sessionStorage)\b/);
  assert.doesNotMatch(endSource, /(?:route|server|provider|database|renderer|animation|occupancy|hermes)/i);
});
