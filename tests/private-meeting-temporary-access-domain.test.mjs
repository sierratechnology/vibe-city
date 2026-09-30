import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const accessUrl = new URL('../src/domain/privateMeetingTemporaryAccess.ts', import.meta.url);
const acceptanceUrl = new URL('../src/domain/privateMeetingInvitationAcceptance.ts', import.meta.url);
const issuanceUrl = new URL('../src/domain/privateMeetingInvitationIssuance.ts', import.meta.url);
const readinessUrl = new URL('../src/domain/meetingInvitationReadiness.ts', import.meta.url);

async function loadDomain(tag, beforeAccessImport = () => {}) {
  const [accessSource, acceptanceSource, issuanceSource, readinessSource] = await Promise.all([
    readFile(accessUrl, 'utf8').catch(() => null),
    readFile(acceptanceUrl, 'utf8'),
    readFile(issuanceUrl, 'utf8'),
    readFile(readinessUrl, 'utf8'),
  ]);
  if (accessSource === null) return Object.freeze({ missingCapability: 'private-meeting-temporary-access' });
  const options = { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } };
  const readinessOutput = ts.transpileModule(readinessSource, options).outputText;
  const readinessSpecifier = `data:text/javascript;base64,${Buffer.from(readinessOutput).toString('base64')}#readiness-${tag}`;
  const issuanceOutput = ts.transpileModule(issuanceSource, options).outputText.replace(
    /['"]\.\/meetingInvitation(?:Readiness|\\u0052eadiness)['"]/, JSON.stringify(readinessSpecifier),
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
  const issuanceDomain = await import(issuanceSpecifier);
  const acceptanceDomain = await import(acceptanceSpecifier);
  beforeAccessImport();
  const accessDomain = await import(accessSpecifier);
  return { ...issuanceDomain, ...acceptanceDomain, ...accessDomain };
}

const IDS = Object.freeze({
  invitation: 'id_1000000000000001', issuer: 'id_1000000000000002',
  issuanceAuthority: 'id_1000000000000003', recipient: 'id_1000000000000004',
  participationAuthority: 'id_1000000000000005', purpose: 'id_1000000000000006',
  material: 'id_1000000000000007', evidence: 'id_1000000000000008',
  revocationAuthority: 'id_1000000000000009', issuanceSource: 'id_100000000000000a',
  issuanceAuthorization: 'id_100000000000000b', acceptanceSource: 'id_100000000000000c',
  acceptanceAuthorization: 'id_100000000000000d', tenant: 'id_100000000000000e',
  meeting: 'id_100000000000000f', policySource: 'id_1000000000000010',
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

function createAccepted(domain) {
  const readinessDocument = JSON.stringify(readinessCandidate());
  const issuanceEvent = domain.createPrivateMeetingInvitationIssuanceEvent(
    readinessDocument, IDS.issuanceSource, IDS.issuanceAuthorization, 1, '2000-01-01T00:00:30.000Z',
  );
  const acceptanceEvent = domain.createPrivateMeetingInvitationAcceptanceEvent(
    readinessDocument, issuanceEvent, IDS.recipient, IDS.acceptanceSource,
    IDS.acceptanceAuthorization, 2, '2000-01-01T00:01:20.000Z',
  );
  return { readinessDocument, issuanceEvent, acceptanceEvent };
}

test('fresh access import and valid operation execute zero hostile Object.assign hooks', async () => {
  let hooks = 0;
  const originalAssign = Object.assign;
  let domain;
  try {
    domain = await loadDomain('pre-import-hostile-assign', () => {
      Object.assign = (...args) => {
        hooks += 1;
        return originalAssign(...args);
      };
    });
    const accepted = createAccepted(domain);
    const policy = domain.createPrivateMeetingTemporaryAccessPolicyObservation(
      accepted.readinessDocument, accepted.issuanceEvent, accepted.acceptanceEvent,
      IDS.tenant, IDS.meeting, 2, 'active', 'policy_current', '2000-01-01T00:01:30.000Z',
    );
    assert.equal(domain.decidePrivateMeetingTemporaryAccess(
      accepted.readinessDocument, accepted.issuanceEvent, accepted.acceptanceEvent, policy,
    ).status, 'granted');
  } finally {
    Object.assign = originalAssign;
  }
  assert.equal(hooks, 0, 'new boundary must not execute a hostile pre-import Object.assign hook');
});

test('fresh access import and valid operation execute zero hostile Object.freeze hooks', async () => {
  let hooks = 0;
  const originalFreeze = Object.freeze;
  let domain;
  try {
    domain = await loadDomain('pre-import-hostile-freeze', () => {
      Object.freeze = (value) => {
        hooks += 1;
        return originalFreeze(value);
      };
    });
    const accepted = createAccepted(domain);
    const policy = domain.createPrivateMeetingTemporaryAccessPolicyObservation(
      accepted.readinessDocument, accepted.issuanceEvent, accepted.acceptanceEvent,
      IDS.tenant, IDS.meeting, 2, 'active', 'policy_current', '2000-01-01T00:01:30.000Z',
    );
    assert.equal(domain.decidePrivateMeetingTemporaryAccess(
      accepted.readinessDocument, accepted.issuanceEvent, accepted.acceptanceEvent, policy,
    ).status, 'granted');
  } finally {
    Object.freeze = originalFreeze;
  }
  assert.equal(hooks, 0, 'new boundary must not execute a hostile pre-import Object.freeze hook');
});

test('hostile pre-import Object.freeze cannot turn an unavailable policy into a grant', async () => {
  const originalFreeze = Object.freeze;
  let decision;
  try {
    const domain = await loadDomain('pre-import-hostile-freeze-fail-open', () => {
      Object.freeze = (value) => value;
    });
    const accepted = createAccepted(domain);
    const policy = domain.createPrivateMeetingTemporaryAccessPolicyObservation(
      accepted.readinessDocument, accepted.issuanceEvent, accepted.acceptanceEvent,
      IDS.tenant, IDS.meeting, 2, 'unavailable', 'policy_inactive', '2000-01-01T00:01:30.000Z',
    );
    Reflect.set(policy, 'status', 'active');
    Reflect.set(policy, 'reason', 'policy_current');
    decision = domain.decidePrivateMeetingTemporaryAccess(
      accepted.readinessDocument, accepted.issuanceEvent, accepted.acceptanceEvent, policy,
    );
  } finally {
    Object.freeze = originalFreeze;
  }
  assert.deepEqual({ ...decision }, {
    status: 'unavailable', reason: 'temporary_access_unavailable',
  });
});

test('fresh access import and valid operation execute zero hostile alternate ambient intrinsic hooks', async () => {
  let hooks = 0;
  const originalCharacterCodeAt = String.prototype.charCodeAt;
  const OriginalDate = Date;
  const originalToISOString = Date.prototype.toISOString;
  const originalIsFinite = Number.isFinite;
  const originalIsSafeInteger = Number.isSafeInteger;
  const OriginalWeakMap = WeakMap;
  const originalWeakMapSet = WeakMap.prototype.set;
  const originalWeakMapGet = WeakMap.prototype.get;
  let domain;
  try {
    domain = await loadDomain('pre-import-hostile-alternate-intrinsics', () => {
      String.prototype.charCodeAt = function hostileCharacterCodeAt(...args) {
        hooks += 1;
        return originalCharacterCodeAt.call(this, ...args);
      };
      function HostileDate(...args) {
        hooks += 1;
        return Reflect.construct(OriginalDate, args, new.target || OriginalDate);
      }
      HostileDate.prototype = OriginalDate.prototype;
      HostileDate.parse = (...args) => {
        hooks += 1;
        return OriginalDate.parse(...args);
      };
      globalThis.Date = HostileDate;
      Date.prototype.toISOString = function hostileToISOString(...args) {
        hooks += 1;
        return originalToISOString.call(this, ...args);
      };
      Number.isFinite = (...args) => {
        hooks += 1;
        return originalIsFinite(...args);
      };
      Number.isSafeInteger = (...args) => {
        hooks += 1;
        return originalIsSafeInteger(...args);
      };
      globalThis.WeakMap = class HostileWeakMap extends OriginalWeakMap {
        constructor(...args) {
          hooks += 1;
          super(...args);
        }

        set(...args) {
          hooks += 1;
          return originalWeakMapSet.call(this, ...args);
        }

        get(...args) {
          hooks += 1;
          return originalWeakMapGet.call(this, ...args);
        }
      };
    });
    const accepted = createAccepted(domain);
    const policy = domain.createPrivateMeetingTemporaryAccessPolicyObservation(
      accepted.readinessDocument, accepted.issuanceEvent, accepted.acceptanceEvent,
      IDS.tenant, IDS.meeting, 2, 'active', 'policy_current', '2000-01-01T00:01:30.000Z',
    );
    assert.equal(domain.decidePrivateMeetingTemporaryAccess(
      accepted.readinessDocument, accepted.issuanceEvent, accepted.acceptanceEvent, policy,
    ).status, 'granted');
  } finally {
    String.prototype.charCodeAt = originalCharacterCodeAt;
    globalThis.Date = OriginalDate;
    Date.prototype.toISOString = originalToISOString;
    Number.isFinite = originalIsFinite;
    Number.isSafeInteger = originalIsSafeInteger;
    globalThis.WeakMap = OriginalWeakMap;
  }
  assert.equal(hooks, 0, 'new boundary must not execute hostile alternate ambient intrinsic hooks');
});

test('only exact accepted invitation inputs cross the temporary-access boundary without gaining categorical authority', async () => {
  const domain = await loadDomain('accepted-inputs');
  assert.equal(domain.missingCapability, undefined, `missing capability token: ${domain.missingCapability}`);
  assert.equal(typeof domain.createPrivateMeetingTemporaryAccessPolicyObservation, 'function');
  assert.equal(typeof domain.decidePrivateMeetingTemporaryAccess, 'function');
  const accepted = createAccepted(domain);
  const policy = domain.createPrivateMeetingTemporaryAccessPolicyObservation(
    accepted.readinessDocument, accepted.issuanceEvent, accepted.acceptanceEvent,
    IDS.tenant, IDS.meeting, 2, 'active', 'policy_current', '2000-01-01T00:01:30.000Z',
  );
  const granted = domain.decidePrivateMeetingTemporaryAccess(
    accepted.readinessDocument, accepted.issuanceEvent, accepted.acceptanceEvent, policy,
  );
  assert.equal(granted.status, 'granted');
  for (const forbidden of [
    'membership', 'permissions', 'skills', 'role', 'spending', 'communication',
    'providerAccess', 'protectedRelease', 'decisionAuthority',
  ]) assert.equal(forbidden in granted, false);
  const denied = domain.decidePrivateMeetingTemporaryAccess(
    accepted.readinessDocument, accepted.issuanceEvent, { ...accepted.acceptanceEvent }, policy,
  );
  assert.equal(Object.getPrototypeOf(denied), null);
  assert.deepEqual({ ...denied }, { status: 'unavailable', reason: 'temporary_access_unavailable' });
});

test('policy observation is closed and exactly bound to invitation identities and current revision', async () => {
  const domain = await loadDomain('closed-policy');
  const accepted = createAccepted(domain);
  const policy = domain.createPrivateMeetingTemporaryAccessPolicyObservation(
    accepted.readinessDocument, accepted.issuanceEvent, accepted.acceptanceEvent,
    IDS.tenant, IDS.meeting, 2, 'active', 'policy_current', '2000-01-01T00:01:30.000Z',
  );
  assert.deepEqual(Object.keys(policy), [
    'tenantId', 'meetingId', 'invitationId', 'inviterId', 'inviteeId',
    'policyRevision', 'status', 'reason', 'evaluatedAt',
  ]);
  assert.deepEqual({ ...policy }, {
    tenantId: IDS.tenant, meetingId: IDS.meeting, invitationId: IDS.invitation,
    inviterId: IDS.issuer, inviteeId: IDS.recipient, policyRevision: 2,
    status: 'active', reason: 'policy_current', evaluatedAt: '2000-01-01T00:01:30.000Z',
  });
  for (const facts of [
    ['visible-tenant', IDS.meeting, 2, 'active', 'policy_current', '2000-01-01T00:01:30.000Z'],
    [IDS.recipient, IDS.meeting, 2, 'active', 'policy_current', '2000-01-01T00:01:30.000Z'],
    [IDS.tenant, IDS.meeting, 1, 'active', 'policy_current', '2000-01-01T00:01:30.000Z'],
    [IDS.tenant, IDS.meeting, 2, 'revoked', 'free text', '2000-01-01T00:01:30.000Z'],
    [IDS.tenant, IDS.meeting, 2, 'active', 'policy_current', '2000-01-01T00:01:30Z'],
  ]) {
    assert.throws(
      () => domain.createPrivateMeetingTemporaryAccessPolicyObservation(
        accepted.readinessDocument, accepted.issuanceEvent, accepted.acceptanceEvent, ...facts,
      ),
      { name: 'TypeError', message: 'Invalid private meeting temporary access input' },
    );
  }
});

test('grant is the exact meeting-entry scope and begins only at current evaluation without outliving invitation', async () => {
  const domain = await loadDomain('exact-grant');
  const accepted = createAccepted(domain);
  const policy = domain.createPrivateMeetingTemporaryAccessPolicyObservation(
    accepted.readinessDocument, accepted.issuanceEvent, accepted.acceptanceEvent,
    IDS.tenant, IDS.meeting, 2, 'active', 'policy_current', '2000-01-01T00:01:30.000Z',
  );
  const grant = domain.decidePrivateMeetingTemporaryAccess(
    accepted.readinessDocument, accepted.issuanceEvent, accepted.acceptanceEvent, policy,
  );
  assert.equal(Object.getPrototypeOf(grant), null);
  assert.equal(Object.isFrozen(grant), true);
  assert.deepEqual(Object.keys(grant), [
    'tenantId', 'meetingId', 'invitationId', 'subjectId', 'scope', 'grantedAt',
    'evaluatedAt', 'expiresAt', 'policyRevision', 'status', 'reason',
  ]);
  assert.deepEqual({ ...grant }, {
    tenantId: IDS.tenant, meetingId: IDS.meeting, invitationId: IDS.invitation,
    subjectId: IDS.recipient, scope: 'meeting_session_entry',
    grantedAt: '2000-01-01T00:01:30.000Z', evaluatedAt: '2000-01-01T00:01:30.000Z',
    expiresAt: '2000-01-01T00:03:00.000Z', policyRevision: 2,
    status: 'granted', reason: 'invitation_temporary_access',
  });
});

test('revoked expired unavailable stale and mismatched policy facts fail closed', async () => {
  const domain = await loadDomain('inactive-policy');
  const accepted = createAccepted(domain);
  const unavailable = { status: 'unavailable', reason: 'temporary_access_unavailable' };
  for (const [status, evaluatedAt] of [
    ['revoked', '2000-01-01T00:01:30.000Z'],
    ['unavailable', '2000-01-01T00:01:30.000Z'],
    ['expired', '2000-01-01T00:03:00.000Z'],
  ]) {
    const policy = domain.createPrivateMeetingTemporaryAccessPolicyObservation(
      accepted.readinessDocument, accepted.issuanceEvent, accepted.acceptanceEvent,
      IDS.tenant, IDS.meeting, 2, status, 'policy_inactive', evaluatedAt,
    );
    const decision = domain.decidePrivateMeetingTemporaryAccess(
      accepted.readinessDocument, accepted.issuanceEvent, accepted.acceptanceEvent, policy,
    );
    assert.deepEqual({ ...decision }, unavailable);
  }
  const active = domain.createPrivateMeetingTemporaryAccessPolicyObservation(
    accepted.readinessDocument, accepted.issuanceEvent, accepted.acceptanceEvent,
    IDS.tenant, IDS.meeting, 2, 'active', 'policy_current', '2000-01-01T00:01:30.000Z',
  );
  const equivalent = createAccepted(domain);
  assert.deepEqual({ ...domain.decidePrivateMeetingTemporaryAccess(
    equivalent.readinessDocument, equivalent.issuanceEvent, equivalent.acceptanceEvent, active,
  ) }, unavailable);
  assert.throws(() => domain.createPrivateMeetingTemporaryAccessPolicyObservation(
    accepted.readinessDocument, accepted.issuanceEvent, accepted.acceptanceEvent,
    IDS.tenant, IDS.meeting, 3, 'active', 'policy_current', '2000-01-01T00:01:30.000Z',
  ), { name: 'TypeError', message: 'Invalid private meeting temporary access input' });
});

test('every denial is the same minimal frozen non-enumerating result without private detail', async () => {
  const domain = await loadDomain('generic-denial');
  const accepted = createAccepted(domain);
  const policy = domain.createPrivateMeetingTemporaryAccessPolicyObservation(
    accepted.readinessDocument, accepted.issuanceEvent, accepted.acceptanceEvent,
    IDS.tenant, IDS.meeting, 2, 'unavailable', 'policy_inactive', '2000-01-01T00:01:30.000Z',
  );
  const denials = [
    domain.decidePrivateMeetingTemporaryAccess(
      accepted.readinessDocument, accepted.issuanceEvent, accepted.acceptanceEvent, policy,
    ),
    domain.decidePrivateMeetingTemporaryAccess(null, null, null, null),
    domain.decidePrivateMeetingTemporaryAccess(
      accepted.readinessDocument, accepted.issuanceEvent, accepted.acceptanceEvent, { ...policy },
    ),
  ];
  assert.equal(denials[0], denials[1]);
  assert.equal(denials[1], denials[2]);
  assert.equal(Object.getPrototypeOf(denials[0]), null);
  assert.equal(Object.isFrozen(denials[0]), true);
  assert.deepEqual(Object.keys(denials[0]), ['status', 'reason']);
  assert.deepEqual({ ...denials[0] }, {
    status: 'unavailable', reason: 'temporary_access_unavailable',
  });
  assert.equal(JSON.stringify(denials).includes(IDS.invitation), false);
  assert.equal(JSON.stringify(denials).includes(IDS.tenant), false);
});

test('exact provenance remains O(1) and frozen while hostile wrappers and prototype mutation execute no hooks', async () => {
  const domain = await loadDomain('provenance-hardening');
  const accepted = createAccepted(domain);
  let hooks = 0;
  const hostile = new Proxy({}, {
    get() { hooks += 1; throw new Error('must not read'); },
    getPrototypeOf() { hooks += 1; throw new Error('must not inspect'); },
    ownKeys() { hooks += 1; throw new Error('must not enumerate'); },
  });
  assert.throws(() => domain.createPrivateMeetingTemporaryAccessPolicyObservation(
    accepted.readinessDocument, accepted.issuanceEvent, accepted.acceptanceEvent,
    hostile, IDS.meeting, 2, 'active', 'policy_current', '2000-01-01T00:01:30.000Z',
  ), { name: 'TypeError', message: 'Invalid private meeting temporary access input' });
  assert.equal(hooks, 0);

  const originalIncludes = Array.prototype.includes;
  Array.prototype.includes = () => { hooks += 1; throw new Error('must not execute'); };
  let policy;
  try {
    policy = domain.createPrivateMeetingTemporaryAccessPolicyObservation(
      accepted.readinessDocument, accepted.issuanceEvent, accepted.acceptanceEvent,
      IDS.tenant, IDS.meeting, 2, 'active', 'policy_current', '2000-01-01T00:01:30.000Z',
    );
  } finally {
    Array.prototype.includes = originalIncludes;
  }
  assert.equal(hooks, 0);
  assert.equal(Object.getPrototypeOf(policy), null);
  assert.equal(Object.isFrozen(policy), true);
  const wrapped = new Proxy(policy, {
    get() { hooks += 1; throw new Error('must not read'); },
    ownKeys() { hooks += 1; throw new Error('must not enumerate'); },
  });
  const denied = domain.decidePrivateMeetingTemporaryAccess(
    accepted.readinessDocument, accepted.issuanceEvent, accepted.acceptanceEvent, wrapped,
  );
  assert.equal(denied.status, 'unavailable');
  assert.equal(hooks, 0);
});

test('temporary-access boundary stays dormant with only predecessor domain dependencies and no runtime integration', async () => {
  const source = await readFile(accessUrl, 'utf8');
  const runtimeImports = [...source.matchAll(/^import(?!\s+type\b)[\s\S]*?from\s+['"]([^'"]+)['"];$/gm)]
    .map((match) => match[1]);
  assert.deepEqual(runtimeImports, [
    './privateMeetingInvitation\\u0041cceptance',
    './privateMeetingInvitation\\u0049ssuance',
  ]);
  for (const forbidden of [
    '../main', '/main', 'fetch(', 'WebSocket', 'setTimeout', 'setInterval',
    'process.', 'import.meta.env', 'localStorage', 'sessionStorage', 'document.', 'window.',
    'room occupancy', 'meeting start', 'meeting end', 'participant presence',
  ]) assert.equal(source.includes(forbidden), false, `forbidden runtime coupling: ${forbidden}`);
  const domain = await loadDomain('dormant');
  assert.equal(typeof domain.decidePrivateMeetingTemporaryAccess, 'function');
});
