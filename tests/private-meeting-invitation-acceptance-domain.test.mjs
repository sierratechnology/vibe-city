import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const acceptanceUrl = new URL('../src/domain/privateMeetingInvitationAcceptance.ts', import.meta.url);
const issuanceUrl = new URL('../src/domain/privateMeetingInvitationIssuance.ts', import.meta.url);
const readinessUrl = new URL('../src/domain/meetingInvitationReadiness.ts', import.meta.url);

async function loadDomain(tag, beforeAcceptanceImport) {
  const [acceptanceSource, issuanceSource, readinessSource] = await Promise.all([
    readFile(acceptanceUrl, 'utf8').catch(() => null),
    readFile(issuanceUrl, 'utf8'),
    readFile(readinessUrl, 'utf8'),
  ]);
  if (acceptanceSource === null) {
    return Object.freeze({ missingCapability: 'private-meeting-invitation-acceptance' });
  }
  const options = {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  };
  const readinessOutput = ts.transpileModule(readinessSource, options).outputText;
  const readinessSpecifier = `data:text/javascript;base64,${Buffer.from(readinessOutput).toString('base64')}#readiness-${tag}`;
  const issuanceOutput = ts.transpileModule(issuanceSource, options).outputText.replace(
    /['"]\.\/meetingInvitation(?:Readiness|\\u0052eadiness)['"]/,
    JSON.stringify(readinessSpecifier),
  );
  const issuanceSpecifier = `data:text/javascript;base64,${Buffer.from(issuanceOutput).toString('base64')}#issuance-${tag}`;
  const acceptanceOutput = ts.transpileModule(acceptanceSource, options).outputText
    .replace(
      /['"]\.\/meetingInvitation(?:Readiness|\\u0052eadiness)['"]/,
      JSON.stringify(readinessSpecifier),
    )
    .replace(
      /['"]\.\/privateMeetingInvitation(?:Issuance|\\u0049ssuance)['"]/,
      JSON.stringify(issuanceSpecifier),
    );
  const acceptanceSpecifier = `data:text/javascript;base64,${Buffer.from(acceptanceOutput).toString('base64')}#acceptance-${tag}`;
  const issuance = await import(issuanceSpecifier);
  let restore;
  let acceptance;
  if (beforeAcceptanceImport) restore = beforeAcceptanceImport();
  try {
    acceptance = await import(acceptanceSpecifier);
  } finally {
    if (restore) restore();
  }
  return Object.freeze({ ...acceptance, ...issuance });
}

const IDS = Object.freeze({
  invitation: 'id_1000000000000001',
  issuer: 'id_1000000000000002',
  issuanceAuthority: 'id_1000000000000003',
  recipient: 'id_1000000000000004',
  participationAuthority: 'id_1000000000000005',
  purpose: 'id_1000000000000006',
  material: 'id_1000000000000007',
  evidence: 'id_1000000000000008',
  revocationAuthority: 'id_1000000000000009',
  issuanceSource: 'id_100000000000000a',
  issuanceAuthorization: 'id_100000000000000b',
  acceptanceSource: 'id_100000000000000c',
  acceptanceAuthorization: 'id_100000000000000d',
});

function readinessCandidate(overrides = {}) {
  return {
    schemaVersion: 'invitation-readiness/1',
    invitationReference: IDS.invitation,
    issuer: {
      subjectReference: IDS.issuer,
      issuanceAuthorizationReference: IDS.issuanceAuthority,
    },
    recipient: {
      subjectReference: IDS.recipient,
      participationAuthorizationReference: IDS.participationAuthority,
    },
    purpose: { purposeReference: IDS.purpose },
    materials: [{ materialReference: IDS.material, evidenceReference: IDS.evidence }],
    access: { scope: 'readiness_only', grantsAccess: false },
    lifecycle: { state: 'prepared_only' },
    validity: {
      preparedAt: '2000-01-01T00:00:00.000Z',
      validFrom: '2000-01-01T00:01:00.000Z',
      expiresAt: '2000-01-01T00:02:00.000Z',
    },
    revocation: {
      state: 'not_revoked_yet',
      revocationAuthorityReference: IDS.revocationAuthority,
    },
    ...overrides,
  };
}

function createIssued(domain, readinessDocument = JSON.stringify(readinessCandidate())) {
  const issuanceEvent = domain.createPrivateMeetingInvitationIssuanceEvent(
    readinessDocument,
    IDS.issuanceSource,
    IDS.issuanceAuthorization,
    1,
    '2000-01-01T00:00:30.000Z',
  );
  return { issuanceEvent, issued: domain.issuePrivateMeetingInvitation(readinessDocument, issuanceEvent) };
}

function createAcceptance(domain, readinessDocument, issuanceEvent, overrides = {}) {
  return domain.createPrivateMeetingInvitationAcceptanceEvent(
    readinessDocument,
    issuanceEvent,
    overrides.acceptingSubjectReference ?? IDS.recipient,
    overrides.sourceReference ?? IDS.acceptanceSource,
    overrides.authorizationReference ?? IDS.acceptanceAuthorization,
    overrides.policyRevision ?? 1,
    overrides.acceptedAt ?? '2000-01-01T00:01:30.000Z',
  );
}

test('genuine recipient acceptance yields one non-authorizing continuity record and rejects raw or wrapped events before hooks', async () => {
  const domain = await loadDomain('genuine-continuity');
  assert.equal(
    domain.missingCapability,
    undefined,
    `missing capability token: ${domain.missingCapability}`,
  );
  const readinessDocument = JSON.stringify(readinessCandidate());
  const { issuanceEvent } = createIssued(domain, readinessDocument);
  const acceptanceEvent = createAcceptance(domain, readinessDocument, issuanceEvent);
  const accepted = domain.acceptPrivateMeetingInvitation(
    readinessDocument,
    issuanceEvent,
    acceptanceEvent,
  );

  assert.equal(accepted.schemaVersion, 'private-meeting-invitation-accepted-history/1');
  assert.equal(accepted.invitationReference, IDS.invitation);
  assert.equal(accepted.intendedRecipientSubjectReference, IDS.recipient);
  assert.equal(accepted.lifecycle, 'accepted');
  assert.equal(accepted.revision, 2);
  assert.equal(accepted.grantsAccess, false);
  assert.equal(accepted.grantsOccupancy, false);
  assert.equal(accepted.grantsMembership, false);
  assert.equal(accepted.grantsAttendance, false);
  assert.equal(accepted.grantsSession, false);

  assert.throws(
    () => domain.acceptPrivateMeetingInvitation(
      readinessDocument,
      issuanceEvent,
      { ...acceptanceEvent },
    ),
    { name: 'TypeError', message: 'Invalid private meeting invitation acceptance input' },
  );

  let hookCalls = 0;
  const wrapped = new Proxy(acceptanceEvent, {
    get(target, key, receiver) {
      hookCalls += 1;
      return Reflect.get(target, key, receiver);
    },
    getOwnPropertyDescriptor(target, key) {
      hookCalls += 1;
      return Reflect.getOwnPropertyDescriptor(target, key);
    },
    getPrototypeOf(target) {
      hookCalls += 1;
      return Reflect.getPrototypeOf(target);
    },
    ownKeys(target) {
      hookCalls += 1;
      return Reflect.ownKeys(target);
    },
  });
  assert.throws(
    () => domain.acceptPrivateMeetingInvitation(readinessDocument, issuanceEvent, wrapped),
    { name: 'TypeError', message: 'Invalid private meeting invitation acceptance input' },
  );
  assert.equal(hookCalls, 0);
});

test('accepting subject exactly matches the recipient and every primitive fact rejects without coercion', async () => {
  const domain = await loadDomain('recipient-and-primitives');
  const readinessDocument = JSON.stringify(readinessCandidate());
  const { issuanceEvent } = createIssued(domain, readinessDocument);
  let hookCalls = 0;
  const hostile = {
    toString() { hookCalls += 1; return IDS.recipient; },
    valueOf() { hookCalls += 1; return 1; },
    [Symbol.toPrimitive]() { hookCalls += 1; return IDS.recipient; },
  };
  const attempts = [
    () => createAcceptance(domain, readinessDocument, issuanceEvent, {
      acceptingSubjectReference: IDS.issuer,
    }),
    () => domain.createPrivateMeetingInvitationAcceptanceEvent(
      readinessDocument, issuanceEvent, hostile,
      IDS.acceptanceSource, IDS.acceptanceAuthorization, 1, '2000-01-01T00:01:30.000Z',
    ),
    () => domain.createPrivateMeetingInvitationAcceptanceEvent(
      readinessDocument, issuanceEvent, IDS.recipient,
      hostile, IDS.acceptanceAuthorization, 1, '2000-01-01T00:01:30.000Z',
    ),
    () => domain.createPrivateMeetingInvitationAcceptanceEvent(
      readinessDocument, issuanceEvent, IDS.recipient,
      IDS.acceptanceSource, hostile, 1, '2000-01-01T00:01:30.000Z',
    ),
    () => domain.createPrivateMeetingInvitationAcceptanceEvent(
      readinessDocument, issuanceEvent, IDS.recipient,
      IDS.acceptanceSource, IDS.acceptanceAuthorization, hostile, '2000-01-01T00:01:30.000Z',
    ),
    () => domain.createPrivateMeetingInvitationAcceptanceEvent(
      readinessDocument, issuanceEvent, IDS.recipient,
      IDS.acceptanceSource, IDS.acceptanceAuthorization, 1, hostile,
    ),
  ];
  for (const attempt of attempts) {
    assert.throws(
      attempt,
      { name: 'TypeError', message: 'Invalid private meeting invitation acceptance input' },
    );
  }
  assert.equal(hookCalls, 0);
});

test('acceptedAt is canonical at or after issuance and validity and strictly before expiry', async () => {
  const domain = await loadDomain('acceptance-chronology');
  const readinessDocument = JSON.stringify(readinessCandidate());
  const { issuanceEvent } = createIssued(domain, readinessDocument);
  for (const acceptedAt of [
    '2000-01-01T00:00:29.999Z',
    '2000-01-01T00:00:30.000Z',
    '2000-01-01T00:00:59.999Z',
    '2000-01-01T00:01:30Z',
    '2000-02-30T00:01:30.000Z',
    '2000-01-01T00:02:00.000Z',
  ]) {
    assert.throws(
      () => createAcceptance(domain, readinessDocument, issuanceEvent, { acceptedAt }),
      { name: 'TypeError', message: 'Invalid private meeting invitation acceptance input' },
    );
  }
  for (const acceptedAt of [
    '2000-01-01T00:01:00.000Z',
    '2000-01-01T00:01:59.999Z',
  ]) {
    const event = createAcceptance(domain, readinessDocument, issuanceEvent, { acceptedAt });
    assert.equal(
      domain.acceptPrivateMeetingInvitation(readinessDocument, issuanceEvent, event).acceptedAt,
      acceptedAt,
    );
  }
});

test('acceptance source authorization and policy are valid distinct and non-aliasing', async () => {
  const domain = await loadDomain('acceptance-source-policy');
  const readinessDocument = JSON.stringify(readinessCandidate());
  const { issuanceEvent } = createIssued(domain, readinessDocument);
  const protectedReferences = [
    IDS.invitation,
    IDS.issuer,
    IDS.issuanceAuthority,
    IDS.recipient,
    IDS.participationAuthority,
    IDS.purpose,
    IDS.material,
    IDS.evidence,
    IDS.revocationAuthority,
    IDS.issuanceSource,
    IDS.issuanceAuthorization,
  ];
  const invalidFacts = [
    ['source-visible', IDS.acceptanceAuthorization, 1],
    [IDS.acceptanceSource, 'authorization-visible', 1],
    [IDS.acceptanceSource, IDS.acceptanceSource, 1],
    [IDS.acceptanceSource, IDS.acceptanceAuthorization, 0],
    [IDS.acceptanceSource, IDS.acceptanceAuthorization, -0],
    [IDS.acceptanceSource, IDS.acceptanceAuthorization, 1.5],
    [IDS.acceptanceSource, IDS.acceptanceAuthorization, Number.POSITIVE_INFINITY],
    [IDS.acceptanceSource, IDS.acceptanceAuthorization, Number.MAX_SAFE_INTEGER + 1],
  ];
  for (const reference of protectedReferences) {
    invalidFacts.push([reference, IDS.acceptanceAuthorization, 1]);
    invalidFacts.push([IDS.acceptanceSource, reference, 1]);
  }
  for (const [sourceReference, authorizationReference, policyRevision] of invalidFacts) {
    assert.throws(
      () => createAcceptance(domain, readinessDocument, issuanceEvent, {
        sourceReference,
        authorizationReference,
        policyRevision,
      }),
      { name: 'TypeError', message: 'Invalid private meeting invitation acceptance input' },
    );
  }
});

test('acceptance is bound to the exact readiness and exact genuine issuance provenance', async () => {
  const domain = await loadDomain('exact-binding');
  const readinessDocument = JSON.stringify(readinessCandidate());
  const { issuanceEvent } = createIssued(domain, readinessDocument);
  const equivalentIssuanceEvent = domain.createPrivateMeetingInvitationIssuanceEvent(
    readinessDocument,
    IDS.issuanceSource,
    IDS.issuanceAuthorization,
    1,
    '2000-01-01T00:00:30.000Z',
  );
  const acceptanceEvent = createAcceptance(domain, readinessDocument, issuanceEvent);
  assert.throws(
    () => domain.acceptPrivateMeetingInvitation(
      readinessDocument,
      equivalentIssuanceEvent,
      acceptanceEvent,
    ),
    { name: 'TypeError', message: 'Invalid private meeting invitation acceptance input' },
  );

  const mismatched = readinessCandidate();
  mismatched.purpose = { purposeReference: 'id_2000000000000006' };
  assert.throws(
    () => domain.acceptPrivateMeetingInvitation(
      JSON.stringify(mismatched),
      issuanceEvent,
      acceptanceEvent,
    ),
    { name: 'TypeError', message: 'Invalid private meeting invitation acceptance input' },
  );
});

test('acceptance event and additive history are detached recursively frozen and resist future claims', async () => {
  const domain = await loadDomain('detached-additive-history');
  const readinessDocument = JSON.stringify(readinessCandidate());
  const { issuanceEvent, issued } = createIssued(domain, readinessDocument);
  const acceptanceEvent = createAcceptance(domain, readinessDocument, issuanceEvent);
  const accepted = domain.acceptPrivateMeetingInvitation(
    readinessDocument,
    issuanceEvent,
    acceptanceEvent,
  );

  assert.equal(Object.isFrozen(acceptanceEvent), true);
  assert.equal(Object.isFrozen(accepted), true);
  assert.equal(Object.isFrozen(accepted.materials), true);
  assert.equal(Object.isFrozen(accepted.materials[0]), true);
  assert.notEqual(accepted, issued);
  assert.notEqual(accepted.materials, issued.materials);
  assert.notEqual(accepted.materials[0], issued.materials[0]);
  assert.equal(issued.lifecycle, 'issued');
  assert.equal(issued.revision, 1);
  assert.equal(accepted.invitationReference, issued.invitationReference);
  assert.equal(accepted.issuerSubjectReference, issued.issuerSubjectReference);
  assert.equal(accepted.intendedRecipientSubjectReference, issued.intendedRecipientSubjectReference);
  assert.equal(accepted.purposeReference, issued.purposeReference);
  assert.equal(accepted.issuedAt, issued.issuedAt);
  assert.equal(accepted.validFrom, issued.validFrom);
  assert.equal(accepted.expiresAt, issued.expiresAt);
  assert.deepEqual(Array.from(accepted.materials), Array.from(issued.materials));

  const objectClaim = Object.getOwnPropertyDescriptor(Object.prototype, 'grantsTemporaryAccess');
  const arrayClaim = Object.getOwnPropertyDescriptor(Array.prototype, 'grantsTemporaryAccess');
  Object.defineProperty(Object.prototype, 'grantsTemporaryAccess', {
    configurable: true, enumerable: true, writable: true, value: true,
  });
  Object.defineProperty(Array.prototype, 'grantsTemporaryAccess', {
    configurable: true, enumerable: true, writable: true, value: true,
  });
  try {
    for (const value of [acceptanceEvent, accepted, accepted.materials, accepted.materials[0]]) {
      assert.equal(value.grantsTemporaryAccess, undefined);
      assert.equal('grantsTemporaryAccess' in value, false);
    }
  } finally {
    if (objectClaim) Object.defineProperty(Object.prototype, 'grantsTemporaryAccess', objectClaim);
    else delete Object.prototype.grantsTemporaryAccess;
    if (arrayClaim) Object.defineProperty(Array.prototype, 'grantsTemporaryAccess', arrayClaim);
    else delete Array.prototype.grantsTemporaryAccess;
  }
});

test('acceptance capability is dormant on import with exactly two approved domain dependencies', async () => {
  const source = await readFile(acceptanceUrl, 'utf8');
  const imports = Array.from(source.matchAll(/^import[\s\S]*?from\s+['"]([^'"]+)['"];$/gm));
  assert.equal(imports.length, 2);
  assert.deepEqual(
    imports.map((match) => match[1]).sort(),
    ['./meetingInvitation\\u0052eadiness', './privateMeetingInvitation\\u0049ssuance'],
  );
  assert.equal(source.includes('./meetingInvitationReadiness'), false);
  assert.equal(source.includes('./privateMeetingInvitationIssuance'), false);

  const domainDirectory = new URL('../src/domain/', import.meta.url);
  for (const name of await readdir(domainDirectory)) {
    if (!name.endsWith('.ts') || name === 'privateMeetingInvitationAcceptance.ts') continue;
    const otherSource = await readFile(new URL(name, domainDirectory), 'utf8');
    assert.equal(otherSource.includes('privateMeetingInvitationAcceptance'), false);
  }

  const globalKeys = Reflect.ownKeys(globalThis);
  const objectPrototypeKeys = Reflect.ownKeys(Object.prototype);
  const arrayPrototypeKeys = Reflect.ownKeys(Array.prototype);
  await loadDomain('dormant-import');
  assert.deepEqual(Reflect.ownKeys(globalThis), globalKeys);
  assert.deepEqual(Reflect.ownKeys(Object.prototype), objectPrototypeKeys);
  assert.deepEqual(Reflect.ownKeys(Array.prototype), arrayPrototypeKeys);
});

test('pre-import intrinsic pollution cannot install handler traps or execute adversarial hooks', async () => {
  const originalAssign = Object.assign;
  const originalCreate = Object.create;
  let hookCalls = 0;
  const domain = await loadDomain('pre-import-intrinsic-pollution', () => {
    Object.assign = function pollutedAssign(...args) {
      hookCalls += 1;
      return Reflect.apply(originalAssign, Object, args);
    };
    Object.create = function pollutedCreate(...args) {
      hookCalls += 1;
      return Reflect.apply(originalCreate, Object, args);
    };
    return () => {
      Object.assign = originalAssign;
      Object.create = originalCreate;
    };
  });
  assert.equal(hookCalls, 0);

  const readinessDocument = JSON.stringify(readinessCandidate());
  const { issuanceEvent } = createIssued(domain, readinessDocument);
  const acceptanceEvent = createAcceptance(domain, readinessDocument, issuanceEvent);
  const accepted = domain.acceptPrivateMeetingInvitation(
    readinessDocument,
    issuanceEvent,
    acceptanceEvent,
  );
  assert.equal(hookCalls, 0);
  assert.equal(accepted.grantsTemporaryAccess, undefined);
  assert.equal('grantsTemporaryAccess' in accepted, false);
});

test('pre-import descriptor substitution cannot execute hooks or synthesize authority claims', async () => {
  const originalGetOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
  let hookCalls = 0;
  const domain = await loadDomain('pre-import-descriptor-substitution', () => {
    Object.getOwnPropertyDescriptor = function substitutedGetOwnPropertyDescriptor(target, key) {
      hookCalls += 1;
      if (key === 'grantsTemporaryAccess') {
        return { configurable: true, enumerable: true, writable: true, value: true };
      }
      return Reflect.apply(originalGetOwnPropertyDescriptor, Object, [target, key]);
    };
    return () => {
      Object.getOwnPropertyDescriptor = originalGetOwnPropertyDescriptor;
    };
  });
  assert.equal(hookCalls, 0);

  const readinessDocument = JSON.stringify(readinessCandidate());
  const { issuanceEvent } = createIssued(domain, readinessDocument);
  const acceptanceEvent = createAcceptance(domain, readinessDocument, issuanceEvent);
  const accepted = domain.acceptPrivateMeetingInvitation(
    readinessDocument,
    issuanceEvent,
    acceptanceEvent,
  );

  assert.equal(accepted.grantsTemporaryAccess, undefined);
  assert.equal('grantsTemporaryAccess' in accepted, false);
  assert.equal(originalGetOwnPropertyDescriptor(accepted, 'grantsTemporaryAccess'), undefined);
  assert.equal(accepted.grantsAccess, false);
  assert.equal(accepted.grantsOccupancy, false);
  assert.equal(accepted.grantsMembership, false);
  assert.equal(accepted.grantsAttendance, false);
  assert.equal(accepted.grantsSession, false);
  assert.equal(hookCalls, 0);
});

test('pre-import Proxy substitution cannot execute hooks or synthesize authority claims', async () => {
  const OriginalProxy = Proxy;
  let hookCalls = 0;
  const unsupportedClaims = ['grantsTemporaryAccess', 'canInviteOthers'];
  const domain = await loadDomain('pre-import-proxy-substitution', () => {
    globalThis.Proxy = function SubstitutedProxy(target) {
      hookCalls += 1;
      return new OriginalProxy(target, {
        get(innerTarget, key, receiver) {
          hookCalls += 1;
          if (unsupportedClaims.includes(key)) return true;
          return Reflect.get(innerTarget, key, receiver);
        },
        has(innerTarget, key) {
          hookCalls += 1;
          if (unsupportedClaims.includes(key)) return true;
          return Reflect.has(innerTarget, key);
        },
      });
    };
    return () => {
      globalThis.Proxy = OriginalProxy;
    };
  });
  assert.equal(hookCalls, 0);

  const readinessDocument = JSON.stringify(readinessCandidate());
  const { issuanceEvent } = createIssued(domain, readinessDocument);
  const acceptanceEvent = createAcceptance(domain, readinessDocument, issuanceEvent);
  const accepted = domain.acceptPrivateMeetingInvitation(
    readinessDocument,
    issuanceEvent,
    acceptanceEvent,
  );

  for (const value of [acceptanceEvent, accepted]) {
    for (const claim of unsupportedClaims) {
      assert.equal(value[claim], undefined);
      assert.equal(claim in value, false);
      assert.equal(Object.getOwnPropertyDescriptor(value, claim), undefined);
    }
  }
  assert.equal(hookCalls, 0);
});

test('pre-import Object.freeze substitution cannot execute hooks or synthesize authority claims', async () => {
  const originalFreeze = Object.freeze;
  const OriginalProxy = Proxy;
  let hookCalls = 0;
  const unsupportedClaims = ['grantsTemporaryAccess', 'canInviteOthers'];
  const domain = await loadDomain('pre-import-freeze-substitution', () => {
    Object.freeze = function substitutedFreeze(value) {
      hookCalls += 1;
      return new OriginalProxy(originalFreeze(value), {
        get(innerTarget, key, receiver) {
          hookCalls += 1;
          if (unsupportedClaims.includes(key)) return true;
          return Reflect.get(innerTarget, key, receiver);
        },
        has(innerTarget, key) {
          hookCalls += 1;
          if (unsupportedClaims.includes(key)) return true;
          return Reflect.has(innerTarget, key);
        },
      });
    };
    return () => {
      Object.freeze = originalFreeze;
    };
  });
  assert.equal(hookCalls, 0);

  const readinessDocument = JSON.stringify(readinessCandidate());
  const { issuanceEvent } = createIssued(domain, readinessDocument);
  const acceptanceEvent = createAcceptance(domain, readinessDocument, issuanceEvent);
  const accepted = domain.acceptPrivateMeetingInvitation(
    readinessDocument,
    issuanceEvent,
    acceptanceEvent,
  );

  for (const value of [acceptanceEvent, accepted]) {
    for (const claim of unsupportedClaims) {
      assert.equal(value[claim], undefined);
      assert.equal(claim in value, false);
      assert.equal(Object.getOwnPropertyDescriptor(value, claim), undefined);
    }
  }
  assert.equal(hookCalls, 0);
});

test('pre-import Object.getPrototypeOf substitution cannot execute hooks or synthesize authority claims', async () => {
  const originalGetPrototypeOf = Object.getPrototypeOf;
  let hookCalls = 0;
  const unsupportedClaims = ['grantsTemporaryAccess', 'canInviteOthers'];
  const hostilePrototype = Object.freeze({
    grantsTemporaryAccess: true,
    canInviteOthers: true,
  });
  const domain = await loadDomain('pre-import-get-prototype-of-substitution', () => {
    Object.getPrototypeOf = function substitutedGetPrototypeOf() {
      hookCalls += 1;
      return hostilePrototype;
    };
    return () => {
      Object.getPrototypeOf = originalGetPrototypeOf;
    };
  });
  assert.equal(hookCalls, 0);

  const readinessDocument = JSON.stringify(readinessCandidate());
  const { issuanceEvent } = createIssued(domain, readinessDocument);
  const acceptanceEvent = createAcceptance(domain, readinessDocument, issuanceEvent);
  const accepted = domain.acceptPrivateMeetingInvitation(
    readinessDocument,
    issuanceEvent,
    acceptanceEvent,
  );

  for (const value of [accepted.materials, accepted]) {
    for (const claim of unsupportedClaims) {
      assert.equal(value[claim], undefined);
      assert.equal(claim in value, false);
      assert.equal(Object.getOwnPropertyDescriptor(value, claim), undefined);
    }
  }
  assert.equal(hookCalls, 0);
});

test('symbol values reject at every acceptance primitive boundary without coercion', async () => {
  const domain = await loadDomain('symbol-primitive-boundaries');
  const readinessDocument = JSON.stringify(readinessCandidate());
  const { issuanceEvent } = createIssued(domain, readinessDocument);
  const symbol = Symbol('hostile-primitive');
  const attempts = [
    [symbol, IDS.acceptanceSource, IDS.acceptanceAuthorization, 1, '2000-01-01T00:01:30.000Z'],
    [IDS.recipient, symbol, IDS.acceptanceAuthorization, 1, '2000-01-01T00:01:30.000Z'],
    [IDS.recipient, IDS.acceptanceSource, symbol, 1, '2000-01-01T00:01:30.000Z'],
    [IDS.recipient, IDS.acceptanceSource, IDS.acceptanceAuthorization, symbol, '2000-01-01T00:01:30.000Z'],
    [IDS.recipient, IDS.acceptanceSource, IDS.acceptanceAuthorization, 1, symbol],
  ];
  for (const facts of attempts) {
    assert.throws(
      () => domain.createPrivateMeetingInvitationAcceptanceEvent(
        readinessDocument,
        issuanceEvent,
        ...facts,
      ),
      { name: 'TypeError', message: 'Invalid private meeting invitation acceptance input' },
    );
  }
});
