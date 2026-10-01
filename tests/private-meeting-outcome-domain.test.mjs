import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const outcomeUrl = new URL('../src/domain/privateMeetingOutcome.ts', import.meta.url);
const endUrl = new URL('../src/domain/privateMeetingSessionEnd.ts', import.meta.url);
const startUrl = new URL('../src/domain/privateMeetingSessionStart.ts', import.meta.url);
const accessUrl = new URL('../src/domain/privateMeetingTemporaryAccess.ts', import.meta.url);
const acceptanceUrl = new URL('../src/domain/privateMeetingInvitationAcceptance.ts', import.meta.url);
const issuanceUrl = new URL('../src/domain/privateMeetingInvitationIssuance.ts', import.meta.url);
const readinessUrl = new URL('../src/domain/meetingInvitationReadiness.ts', import.meta.url);

async function loadDomain(tag) {
  const sources = await Promise.all([
    readFile(outcomeUrl, 'utf8').catch(() => null), readFile(endUrl, 'utf8'),
    readFile(startUrl, 'utf8'), readFile(accessUrl, 'utf8'),
    readFile(acceptanceUrl, 'utf8'), readFile(issuanceUrl, 'utf8'),
    readFile(readinessUrl, 'utf8'),
  ]);
  if (sources[0] === null) return Object.freeze({ missingCapability: 'private-meeting-outcome' });
  const options = { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } };
  const specifier = (source, name) => `data:text/javascript;base64,${Buffer.from(ts.transpileModule(source, options).outputText).toString('base64')}#${name}-${tag}`;
  const readinessSpecifier = specifier(sources[6], 'readiness');
  const issuanceSpecifier = specifier(sources[5].replace(
    /['"]\.\/meetingInvitation(?:Readiness|\\u0052eadiness)['"]/,
    JSON.stringify(readinessSpecifier),
  ), 'issuance');
  const acceptanceSpecifier = specifier(sources[4]
    .replace(/['"]\.\/meetingInvitation(?:Readiness|\\u0052eadiness)['"]/, JSON.stringify(readinessSpecifier))
    .replace(/['"]\.\/privateMeetingInvitation(?:Issuance|\\u0049ssuance)['"]/, JSON.stringify(issuanceSpecifier)), 'acceptance');
  const accessSpecifier = specifier(sources[3]
    .replace(/['"]\.\/privateMeetingInvitation(?:Acceptance|\\u0041cceptance)['"]/, JSON.stringify(acceptanceSpecifier))
    .replace(/['"]\.\/privateMeetingInvitation(?:Issuance|\\u0049ssuance)['"]/, JSON.stringify(issuanceSpecifier)), 'access');
  const startSpecifier = specifier(sources[2]
    .replace(/['"]\.\/privateMeetingTemporary(?:Access|\\u0041ccess)['"]/, JSON.stringify(accessSpecifier))
    .replace(/['"]\.\/privateMeetingInvitation(?:Issuance|\\u0049ssuance)['"]/, JSON.stringify(issuanceSpecifier)), 'start');
  const endSpecifier = specifier(sources[1]
    .replace(/['"]\.\/privateMeetingSession(?:Start|\\u0053tart)['"]/, JSON.stringify(startSpecifier))
    .replace(/['"]\.\/privateMeetingTemporary(?:Access|\\u0041ccess)['"]/, JSON.stringify(accessSpecifier))
    .replace(/['"]\.\/privateMeetingInvitation(?:Issuance|\\u0049ssuance)['"]/, JSON.stringify(issuanceSpecifier)), 'end');
  const outcomeSpecifier = specifier(sources[0]
    .replace(/['"]\.\/meetingInvitation(?:Readiness|\\u0052eadiness)['"]/, JSON.stringify(readinessSpecifier))
    .replace(/['"]\.\/privateMeetingInvitation(?:Acceptance|\\u0041cceptance)['"]/, JSON.stringify(acceptanceSpecifier))
    .replace(/['"]\.\/privateMeetingInvitation(?:Issuance|\\u0049ssuance)['"]/, JSON.stringify(issuanceSpecifier))
    .replace(/['"]\.\/privateMeetingTemporary(?:Access|\\u0041ccess)['"]/, JSON.stringify(accessSpecifier))
    .replace(/['"]\.\/privateMeetingSession(?:End|\\u0045nd)['"]/, JSON.stringify(endSpecifier)), 'outcome');
  const modules = await Promise.all([
    import(issuanceSpecifier), import(acceptanceSpecifier), import(accessSpecifier),
    import(startSpecifier), import(endSpecifier), import(outcomeSpecifier),
  ]);
  return Object.assign({}, ...modules);
}

const IDS = Object.freeze({
  invitation: 'id_2000000000000001', issuer: 'id_2000000000000002',
  issuanceAuthority: 'id_2000000000000003', recipient: 'id_2000000000000004',
  participationAuthority: 'id_2000000000000005', purpose: 'id_2000000000000006',
  material: 'id_2000000000000007', evidence: 'id_2000000000000008',
  revocationAuthority: 'id_2000000000000009', issuanceSource: 'id_200000000000000a',
  issuanceAuthorization: 'id_200000000000000b', acceptanceSource: 'id_200000000000000c',
  acceptanceAuthorization: 'id_200000000000000d', tenant: 'id_200000000000000e',
  meeting: 'id_200000000000000f', session: 'id_2000000000000010',
  startSource: 'id_2000000000000011', endSource: 'id_2000000000000012',
  outcomeSource: 'id_2000000000000013',
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
  const startEvent = domain.createPrivateMeetingSessionStartEvent(
    readinessDocument, issuanceEvent, acceptanceEvent, policyObservation,
    domain.createPrivateMeetingSessionStartCommand(
      IDS.session, IDS.startSource, IDS.acceptanceAuthorization, '2000-01-01T00:01:30.000Z',
    ),
  );
  const endEvent = domain.createPrivateMeetingSessionEndEvent(
    readinessDocument, issuanceEvent, acceptanceEvent, policyObservation, startEvent,
    domain.createPrivateMeetingSessionEndCommand(
      IDS.endSource, IDS.acceptanceAuthorization, '2000-01-01T00:02:00.000Z',
    ),
  );
  return { readinessDocument, issuanceEvent, acceptanceEvent, policyObservation, endEvent };
}

function outcomeCommand(domain, overrides = {}) {
  const command = {
    sourceEventId: IDS.outcomeSource,
    outcomeAuthorityReference: IDS.acceptanceAuthorization,
    recordedAt: '2000-01-01T00:02:30.000Z',
    ...overrides,
  };
  return domain.createPrivateMeetingNoDecisionCommand(
    command.sourceEventId, command.outcomeAuthorityReference, command.recordedAt,
  );
}

function createOutcome(domain, context, command = outcomeCommand(domain)) {
  return domain.createPrivateMeetingNoDecisionOutcomeEvent(
    context.readinessDocument, context.issuanceEvent, context.acceptanceEvent,
    context.policyObservation, context.endEvent, command,
  );
}

test('exact accepted session end yields one explicit no-decision outcome', async () => {
  const domain = await loadDomain('minimal-outcome');
  assert.equal(domain.missingCapability, undefined, `missing capability token: ${domain.missingCapability}`);
  const event = createOutcome(domain, createContext(domain));
  assert.deepEqual({
    ...event,
    materials: [{ ...event.materials[0] }],
  }, {
    schemaVersion: 'private-meeting-outcome/1', tenantId: IDS.tenant,
    meetingId: IDS.meeting, sessionId: IDS.session, invitationId: IDS.invitation,
    subjectId: IDS.recipient, purposeReference: IDS.purpose,
    materials: [{ materialReference: IDS.material, evidenceReference: IDS.evidence }],
    endedAt: '2000-01-01T00:02:00.000Z', recordedAt: '2000-01-01T00:02:30.000Z',
    sourceEventId: IDS.outcomeSource,
    outcomeAuthorityReference: IDS.acceptanceAuthorization,
    outcome: 'no_decision',
  });
});

test('no-decision outcome requires exact end provenance and permits only one outcome', async () => {
  const domain = await loadDomain('end-provenance-replay');
  const otherDomain = await loadDomain('end-provenance-replay-other');
  const context = createContext(domain);
  createOutcome(domain, context);
  for (const endEvent of [
    context.endEvent,
    Object.freeze(Object.assign(Object.create(null), context.endEvent)),
    JSON.parse(JSON.stringify(context.endEvent)),
    Object.freeze(Object.create(context.endEvent)),
    createContext(otherDomain).endEvent,
  ]) {
    assert.throws(() => createOutcome(domain, { ...context, endEvent }), {
      name: 'TypeError', message: 'Invalid private meeting outcome input',
    });
  }
});

test('no-decision outcome rejects separately genuine value-equivalent predecessor lineage', async () => {
  const domain = await loadDomain('exact-predecessor-lineage');
  const exactEndContext = createContext(domain);
  const separatelyGenuineEquivalent = createContext(domain);
  assert.throws(() => createOutcome(domain, {
    ...separatelyGenuineEquivalent,
    endEvent: exactEndContext.endEvent,
  }), { name: 'TypeError', message: 'Invalid private meeting outcome input' });
});

test('outcome source identity is fresh across exact private meeting lineage', async () => {
  const domain = await loadDomain('source-collisions');
  for (const sourceEventId of [
    IDS.tenant, IDS.meeting, IDS.session, IDS.invitation, IDS.issuer,
    IDS.issuanceAuthority, IDS.recipient, IDS.participationAuthority,
    IDS.purpose, IDS.material, IDS.evidence, IDS.revocationAuthority,
    IDS.issuanceSource, IDS.issuanceAuthorization, IDS.acceptanceSource,
    IDS.acceptanceAuthorization, IDS.startSource, IDS.endSource,
  ]) {
    assert.throws(() => {
      const context = createContext(domain);
      createOutcome(domain, context, outcomeCommand(domain, { sourceEventId }));
    }, { name: 'TypeError', message: 'Invalid private meeting outcome input' });
  }
});

test('no-decision outcome requires the exact accepted outcome authority', async () => {
  const domain = await loadDomain('exact-outcome-authority');
  const context = createContext(domain);
  assert.throws(() => createOutcome(domain, context, outcomeCommand(domain, {
    outcomeAuthorityReference: 'id_2000000000000014',
  })), { name: 'TypeError', message: 'Invalid private meeting outcome input' });
});

test('recorded chronology is canonical from end through accepted authority expiry', async () => {
  const domain = await loadDomain('recorded-chronology');
  for (const recordedAt of [
    '2000-01-01T00:01:59.999Z', '2000-01-01T00:03:00.001Z',
    '2000-01-01T00:02:30Z', '2000-02-30T00:02:30.000Z',
  ]) {
    assert.throws(() => createOutcome(
      domain, createContext(domain), outcomeCommand(domain, { recordedAt }),
    ), { name: 'TypeError', message: 'Invalid private meeting outcome input' });
  }
  assert.equal(createOutcome(
    domain, createContext(domain), outcomeCommand(domain, {
      recordedAt: '2000-01-01T00:03:00.000Z',
    }),
  ).recordedAt, '2000-01-01T00:03:00.000Z');
});

test('outcome material copying executes no ambient Array prototype hook', async () => {
  const domain = await loadDomain('ambient-array-hook');
  const context = createContext(domain);
  createOutcome(domain, context);
  let hooks = 0;
  const descriptor = Object.getOwnPropertyDescriptor(Array.prototype, '0');
  Object.defineProperty(Array.prototype, '0', {
    configurable: true,
    set() { hooks += 1; },
  });
  try {
    assert.throws(() => createOutcome(domain, context), {
      name: 'TypeError', message: 'Invalid private meeting outcome input',
    });
  } finally {
    if (descriptor === undefined) delete Array.prototype[0];
    else Object.defineProperty(Array.prototype, '0', descriptor);
  }
  assert.equal(hooks, 0);
});

test('no-decision command is closed module-owned data and hostile scalars execute no hooks', async () => {
  const domain = await loadDomain('closed-command');
  const otherDomain = await loadDomain('closed-command-other');
  const command = outcomeCommand(domain);
  assert.equal(Object.getPrototypeOf(command), null);
  assert.equal(Object.isFrozen(command), true);
  assert.deepEqual(Object.keys(command), ['sourceEventId', 'outcomeAuthorityReference', 'recordedAt']);
  let hooks = 0;
  const proxy = new Proxy(command, { get() { hooks += 1; throw new Error('no'); } });
  for (const invalid of [Object.freeze({ ...command }), Object.freeze(Object.create(command)), proxy, outcomeCommand(otherDomain)]) {
    assert.throws(() => createOutcome(domain, createContext(domain), invalid), {
      name: 'TypeError', message: 'Invalid private meeting outcome input',
    });
  }
  const hostile = { toString() { hooks += 1; return IDS.outcomeSource; } };
  assert.throws(() => domain.createPrivateMeetingNoDecisionCommand(
    hostile, IDS.acceptanceAuthorization, hostile,
  ), { name: 'TypeError', message: 'Invalid private meeting outcome input' });
  assert.equal(hooks, 0);
});

test('revoked stale or mismatched private lineage fails with one generic error', async () => {
  const domain = await loadDomain('generic-lineage-denial');
  const context = createContext(domain);
  const equivalent = createContext(domain);
  const revoked = domain.createPrivateMeetingTemporaryAccessPolicyObservation(
    context.readinessDocument, context.issuanceEvent, context.acceptanceEvent,
    IDS.tenant, IDS.meeting, 2, 'revoked', 'policy_inactive', '2000-01-01T00:02:30.000Z',
  );
  for (const candidate of [
    { ...context, policyObservation: revoked },
    { ...context, policyObservation: equivalent.policyObservation },
  ]) {
    assert.throws(() => createOutcome(domain, candidate), {
      name: 'TypeError', message: 'Invalid private meeting outcome input',
    });
  }
});

test('outcome is detached recursively frozen null-prototype tenant-private data', async () => {
  const domain = await loadDomain('closed-output');
  const event = createOutcome(domain, createContext(domain));
  assert.equal(Object.getPrototypeOf(event), null);
  assert.equal(Object.getPrototypeOf(event.materials), null);
  assert.equal(Object.getPrototypeOf(event.materials[0]), null);
  assert.equal(Object.isFrozen(event), true);
  assert.equal(Object.isFrozen(event.materials), true);
  assert.equal(Object.isFrozen(event.materials[0]), true);
  assert.deepEqual(Object.keys(event), [
    'schemaVersion', 'tenantId', 'meetingId', 'sessionId', 'invitationId',
    'subjectId', 'purposeReference', 'materials', 'endedAt', 'recordedAt',
    'sourceEventId', 'outcomeAuthorityReference', 'outcome',
  ]);
});

test('no-decision output exposes references without content or expanded authority', async () => {
  const domain = await loadDomain('minimal-private-output');
  const event = createOutcome(domain, createContext(domain));
  for (const forbidden of [
    'decision', 'votes', 'notes', 'transcript', 'agenda', 'materialContent',
    'participants', 'summary', 'actionItems', 'membership', 'roomOccupancy',
    'privateTaskData', 'customerData', 'credentials', 'provider', 'financialData',
    'meetingAdministration', 'recordAccess', 'decisionAuthority', 'spending',
    'externalCommunication', 'role', 'skill', 'permission',
  ]) assert.equal(forbidden in event, false);
  assert.equal('content' in event.materials[0], false);
});

test('hostile end wrappers fail without executing Proxy or accessor hooks', async () => {
  const domain = await loadDomain('hostile-end');
  const context = createContext(domain);
  let hooks = 0;
  const proxy = new Proxy(context.endEvent, {
    get() { hooks += 1; throw new Error('no'); },
    ownKeys() { hooks += 1; throw new Error('no'); },
  });
  const accessor = Object.create(null);
  Object.defineProperty(accessor, 'tenantId', { enumerable: true, get() { hooks += 1; throw new Error('no'); } });
  for (const endEvent of [proxy, Object.freeze(accessor)]) {
    assert.throws(() => createOutcome(domain, { ...context, endEvent }), {
      name: 'TypeError', message: 'Invalid private meeting outcome input',
    });
  }
  assert.equal(hooks, 0);
});

test('private meeting outcome boundary remains dormant', async () => {
  const [outcomeSource, mainSource] = await Promise.all([
    readFile(outcomeUrl, 'utf8'), readFile(new URL('../src/main.ts', import.meta.url), 'utf8'),
  ]);
  const imported = Array.from(outcomeSource.matchAll(/\bfrom\s+['"]([^'"]+)['"];?/g), (match) => match[1]);
  assert.deepEqual(imported, [
    './meetingInvitation\\u0052eadiness',
    './privateMeetingInvitation\\u0041cceptance',
    './privateMeetingInvitation\\u0049ssuance',
    './privateMeetingTemporary\\u0041ccess',
    './privateMeetingSession\\u0045nd',
  ]);
  assert.doesNotMatch(mainSource, /privateMeetingOutcome/);
  assert.doesNotMatch(outcomeSource, /\b(?:fetch|XMLHttpRequest|WebSocket|setTimeout|setInterval|process|document|window|localStorage|sessionStorage)\b/);
  assert.doesNotMatch(outcomeSource, /(?:route|server|provider|database|renderer|animation|occupancy|hermes)/i);
});
