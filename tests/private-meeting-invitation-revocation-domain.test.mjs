import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const freezeTestObject = Object.freeze;
const getTestPrototypeOf = Object.getPrototypeOf;
const revocationUrl = new URL('../src/domain/privateMeetingInvitationRevocation.ts', import.meta.url);
const acceptanceUrl = new URL('../src/domain/privateMeetingInvitationAcceptance.ts', import.meta.url);
const issuanceUrl = new URL('../src/domain/privateMeetingInvitationIssuance.ts', import.meta.url);
const readinessUrl = new URL('../src/domain/meetingInvitationReadiness.ts', import.meta.url);

async function loadDomain(tag, beforeRevocationImport, keepRevocationHooks = false) {
  const [revocationSource, acceptanceSource, issuanceSource, readinessSource] = await Promise.all([
    readFile(revocationUrl, 'utf8').catch(() => null),
    readFile(acceptanceUrl, 'utf8'),
    readFile(issuanceUrl, 'utf8'),
    readFile(readinessUrl, 'utf8'),
  ]);
  if (revocationSource === null) {
    return Object.freeze({ missingCapability: 'private-meeting-invitation-revocation' });
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
  const revocationOutput = ts.transpileModule(revocationSource, options).outputText
    .replace(
      /['"]\.\/meetingInvitation(?:Readiness|\\u0052eadiness)['"]/,
      JSON.stringify(readinessSpecifier),
    )
    .replace(
      /['"]\.\/privateMeetingInvitation(?:Acceptance|\\u0041cceptance)['"]/,
      JSON.stringify(acceptanceSpecifier),
    )
    .replace(
      /['"]\.\/privateMeetingInvitation(?:Issuance|\\u0049ssuance)['"]/,
      JSON.stringify(issuanceSpecifier),
    );
  const revocationSpecifier = `data:text/javascript;base64,${Buffer.from(revocationOutput).toString('base64')}#revocation-${tag}`;
  const issuance = await import(issuanceSpecifier);
  const acceptance = await import(acceptanceSpecifier);
  let restore;
  if (beforeRevocationImport) restore = beforeRevocationImport();
  let revocation;
  try {
    revocation = await import(revocationSpecifier);
  } finally {
    if (restore && !keepRevocationHooks) restore();
  }
  const domain = { ...issuance, ...acceptance, ...revocation };
  if (restore && keepRevocationHooks) domain.restoreRevocationHooks = restore;
  return freezeTestObject(domain);
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
  revocationSource: 'id_100000000000000e',
  revocationAuthorization: 'id_100000000000000f',
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

function createAccepted(domain, readinessDocument = JSON.stringify(readinessCandidate())) {
  const issuanceEvent = domain.createPrivateMeetingInvitationIssuanceEvent(
    readinessDocument,
    IDS.issuanceSource,
    IDS.issuanceAuthorization,
    1,
    '2000-01-01T00:00:30.000Z',
  );
  const acceptanceEvent = domain.createPrivateMeetingInvitationAcceptanceEvent(
    readinessDocument,
    issuanceEvent,
    IDS.recipient,
    IDS.acceptanceSource,
    IDS.acceptanceAuthorization,
    2,
    '2000-01-01T00:01:20.000Z',
  );
  return { readinessDocument, issuanceEvent, acceptanceEvent };
}

function createRevocation(domain, accepted, overrides = {}) {
  return domain.createPrivateMeetingInvitationRevocationEvent(
    accepted.readinessDocument,
    accepted.issuanceEvent,
    accepted.acceptanceEvent,
    overrides.revocationAuthorityReference ?? IDS.revocationAuthority,
    overrides.sourceReference ?? IDS.revocationSource,
    overrides.authorizationReference ?? IDS.revocationAuthorization,
    overrides.policyRevision ?? 3,
    overrides.revokedAt ?? '2000-01-01T00:01:40.000Z',
  );
}

test('authorized revocation yields exact revision 3 accepted-history continuity', async () => {
  const domain = await loadDomain('authorized-continuity');
  assert.equal(
    domain.missingCapability,
    undefined,
    `missing capability token: ${domain.missingCapability}`,
  );
  const accepted = createAccepted(domain);
  const event = createRevocation(domain, accepted);
  const revoked = domain.revokePrivateMeetingInvitation(
    accepted.readinessDocument,
    accepted.issuanceEvent,
    accepted.acceptanceEvent,
    event,
  );

  const expected = {
    schemaVersion: 'private-meeting-invitation-revoked-history/1',
    invitationReference: IDS.invitation,
    issuerSubjectReference: IDS.issuer,
    intendedRecipientSubjectReference: IDS.recipient,
    purposeReference: IDS.purpose,
    materials: [{ materialReference: IDS.material, evidenceReference: IDS.evidence }],
    revision: 3,
    lifecycle: 'revoked',
    issuedAt: '2000-01-01T00:00:30.000Z',
    validFrom: '2000-01-01T00:01:00.000Z',
    expiresAt: '2000-01-01T00:02:00.000Z',
    acceptedAt: '2000-01-01T00:01:20.000Z',
    revokedAt: '2000-01-01T00:01:40.000Z',
    issuanceSourceReference: IDS.issuanceSource,
    issuanceAuthorizationReference: IDS.issuanceAuthorization,
    issuancePolicyRevision: 1,
    acceptanceSourceReference: IDS.acceptanceSource,
    acceptanceAuthorizationReference: IDS.acceptanceAuthorization,
    acceptancePolicyRevision: 2,
    revocationSourceReference: IDS.revocationSource,
    revocationAuthorizationReference: IDS.revocationAuthorization,
    revocationPolicyRevision: 3,
    grantsAccess: false,
    grantsTemporaryAccess: false,
    grantsPermanentMembership: false,
    grantsOccupancy: false,
    grantsAttendance: false,
    grantsSession: false,
    grantsParticipantPresence: false,
    assertsMeetingExists: false,
    assertsWorkState: false,
    grantsSpending: false,
    grantsCommunication: false,
    grantsProviderAccess: false,
    grantsProtectedRelease: false,
  };
  assert.deepEqual(Reflect.ownKeys(revoked), Reflect.ownKeys(expected));
  assert.deepEqual(
    Reflect.ownKeys(revoked.materials[0]),
    Reflect.ownKeys(expected.materials[0]),
  );
  assert.deepEqual({
    ...revoked,
    materials: [...revoked.materials].map((material) => ({ ...material })),
  }, expected);
  assert.equal(Array.isArray(revoked.materials), true);
  assert.equal(JSON.stringify(revoked), JSON.stringify(expected));
  assert.equal(Object.isFrozen(revoked), true);
  assert.equal(Object.isFrozen(revoked.materials), true);
  assert.equal(Object.isFrozen(revoked.materials[0]), true);
});

test('revocation provenance requires exact authority opaque distinct references and positive policy', async () => {
  const domain = await loadDomain('revocation-provenance');
  const accepted = createAccepted(domain);
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
    IDS.acceptanceSource,
    IDS.acceptanceAuthorization,
  ];
  const invalid = [
    { revocationAuthorityReference: IDS.issuer },
    { sourceReference: 'visible-source' },
    { authorizationReference: 'visible-authorization' },
    { sourceReference: IDS.revocationAuthorization },
    { policyRevision: 0 },
    { policyRevision: -0 },
    { policyRevision: 1.5 },
    { policyRevision: Number.POSITIVE_INFINITY },
    { policyRevision: Number.MAX_SAFE_INTEGER + 1 },
  ];
  for (const reference of protectedReferences) {
    invalid.push({ sourceReference: reference });
    invalid.push({ authorizationReference: reference });
  }
  let hookCalls = 0;
  const hostile = {
    toString() { hookCalls += 1; return IDS.revocationSource; },
    valueOf() { hookCalls += 1; return 3; },
    [Symbol.toPrimitive]() { hookCalls += 1; return IDS.revocationSource; },
  };
  invalid.push(
    { sourceReference: hostile },
    { authorizationReference: hostile },
    { policyRevision: hostile },
  );

  for (const overrides of invalid) {
    assert.throws(
      () => createRevocation(domain, accepted, overrides),
      { name: 'TypeError', message: 'Invalid private meeting invitation revocation input' },
    );
  }
  assert.equal(hookCalls, 0);
});

test('revokedAt is canonical at or after acceptance and strictly before expiry', async () => {
  const domain = await loadDomain('revocation-chronology');
  const accepted = createAccepted(domain);
  for (const revokedAt of [
    '2000-01-01T00:01:19.999Z',
    '2000-01-01T00:01:40Z',
    '2000-02-30T00:01:40.000Z',
    '2000-01-01T00:02:00.000Z',
    '2000-01-01T00:02:00.001Z',
  ]) {
    assert.throws(
      () => createRevocation(domain, accepted, { revokedAt }),
      { name: 'TypeError', message: 'Invalid private meeting invitation revocation input' },
    );
  }
  for (const revokedAt of [
    '2000-01-01T00:01:20.000Z',
    '2000-01-01T00:01:59.999Z',
  ]) {
    const event = createRevocation(domain, accepted, { revokedAt });
    assert.equal(
      domain.revokePrivateMeetingInvitation(
        accepted.readinessDocument,
        accepted.issuanceEvent,
        accepted.acceptanceEvent,
        event,
      ).revokedAt,
      revokedAt,
    );
  }
});

test('revocation continuity is exact frozen detached and closed against hostile replay and prototype claims', async () => {
  const domain = await loadDomain('exact-closed-continuity');
  const accepted = createAccepted(domain);
  const equivalent = createAccepted(domain, accepted.readinessDocument);
  const event = createRevocation(domain, accepted);
  const revoked = domain.revokePrivateMeetingInvitation(
    accepted.readinessDocument,
    accepted.issuanceEvent,
    accepted.acceptanceEvent,
    event,
  );

  assert.throws(
    () => domain.revokePrivateMeetingInvitation(
      equivalent.readinessDocument,
      equivalent.issuanceEvent,
      equivalent.acceptanceEvent,
      event,
    ),
    { name: 'TypeError', message: 'Invalid private meeting invitation revocation input' },
  );
  assert.throws(
    () => domain.revokePrivateMeetingInvitation(
      accepted.readinessDocument,
      accepted.issuanceEvent,
      accepted.acceptanceEvent,
      { ...event },
    ),
    { name: 'TypeError', message: 'Invalid private meeting invitation revocation input' },
  );

  let hookCalls = 0;
  const wrapped = new Proxy(event, {
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
    () => domain.revokePrivateMeetingInvitation(
      accepted.readinessDocument,
      accepted.issuanceEvent,
      accepted.acceptanceEvent,
      wrapped,
    ),
    { name: 'TypeError', message: 'Invalid private meeting invitation revocation input' },
  );
  assert.equal(hookCalls, 0);

  assert.equal(Object.isFrozen(event), true);
  assert.equal(Object.isFrozen(revoked), true);
  assert.equal(Object.isFrozen(revoked.materials), true);
  assert.equal(Object.isFrozen(revoked.materials[0]), true);
  assert.notEqual(revoked.materials, domain.acceptPrivateMeetingInvitation(
    accepted.readinessDocument,
    accepted.issuanceEvent,
    accepted.acceptanceEvent,
  ).materials);
  assert.equal(Object.getPrototypeOf(event), Object.prototype);
  assert.equal(Object.getPrototypeOf(revoked), Object.prototype);
  assert.equal(Array.isArray(revoked.materials), true);
  assert.equal(Object.getPrototypeOf(revoked.materials[0]), Object.prototype);

  const original = Object.getOwnPropertyDescriptor(Array.prototype, 'grantsProviderAccess');
  Object.defineProperty(Array.prototype, 'grantsProviderAccess', {
    configurable: true, enumerable: true, writable: true, value: true,
  });
  try {
    assert.equal(revoked.materials.grantsProviderAccess, undefined);
    assert.equal('grantsProviderAccess' in revoked.materials, false);
  } finally {
    if (original) Object.defineProperty(Array.prototype, 'grantsProviderAccess', original);
    else delete Array.prototype.grantsProviderAccess;
  }
});

test('revoked materials hide post-import claims through their reflected sanitized prototype', async () => {
  const domain = await loadDomain('reflected-sanitized-array-prototype');
  const accepted = createAccepted(domain);
  const event = createRevocation(domain, accepted);
  const original = Object.getOwnPropertyDescriptor(Array.prototype, 'grantsProviderAccess');
  const originalObjectClaim = Object.getOwnPropertyDescriptor(
    Object.prototype,
    'grantsProtectedRelease',
  );
  Object.defineProperty(Array.prototype, 'grantsProviderAccess', {
    configurable: true, enumerable: true, writable: true, value: true,
  });
  Object.defineProperty(Object.prototype, 'grantsProtectedRelease', {
    configurable: true, enumerable: true, writable: true, value: true,
  });
  try {
    const revoked = domain.revokePrivateMeetingInvitation(
      accepted.readinessDocument,
      accepted.issuanceEvent,
      accepted.acceptanceEvent,
      event,
    );
    const reflectedPrototype = Object.getPrototypeOf(revoked.materials);
    assert.notEqual(reflectedPrototype, Array.prototype);
    assert.equal(reflectedPrototype.grantsProviderAccess, undefined);
    assert.equal('grantsProviderAccess' in reflectedPrototype, false);
    assert.equal(Object.getOwnPropertyDescriptor(
      reflectedPrototype,
      'grantsProviderAccess',
    ), undefined);
    assert.equal(Reflect.ownKeys(reflectedPrototype).includes('grantsProviderAccess'), false);
    const reflectedObjectPrototype = Object.getPrototypeOf(reflectedPrototype);
    assert.notEqual(reflectedObjectPrototype, Object.prototype);
    assert.equal(reflectedObjectPrototype.grantsProtectedRelease, undefined);
    assert.equal('grantsProtectedRelease' in reflectedObjectPrototype, false);
    assert.equal(Object.getPrototypeOf(reflectedObjectPrototype), null);
    assert.equal(Array.isArray(revoked.materials), true);
    assert.deepEqual([...revoked.materials], [{
      materialReference: IDS.material,
      evidenceReference: IDS.evidence,
    }]);
    assert.equal(JSON.stringify(revoked.materials), JSON.stringify([{
      materialReference: IDS.material,
      evidenceReference: IDS.evidence,
    }]));
  } finally {
    if (original) Object.defineProperty(Array.prototype, 'grantsProviderAccess', original);
    else delete Array.prototype.grantsProviderAccess;
    if (originalObjectClaim) {
      Object.defineProperty(Object.prototype, 'grantsProtectedRelease', originalObjectClaim);
    } else delete Object.prototype.grantsProtectedRelease;
  }
});

test('pre-import Array prototype claims are absent from revoked materials', async () => {
  const original = Object.getOwnPropertyDescriptor(Array.prototype, 'grantsProviderAccess');
  const domain = await loadDomain('pre-import-array-prototype-claim', () => {
    Object.defineProperty(Array.prototype, 'grantsProviderAccess', {
      configurable: true, enumerable: true, writable: true, value: true,
    });
    return () => {
      if (original) Object.defineProperty(Array.prototype, 'grantsProviderAccess', original);
      else delete Array.prototype.grantsProviderAccess;
    };
  });
  const accepted = createAccepted(domain);
  const event = createRevocation(domain, accepted);
  const revoked = domain.revokePrivateMeetingInvitation(
    accepted.readinessDocument,
    accepted.issuanceEvent,
    accepted.acceptanceEvent,
    event,
  );

  assert.equal(revoked.materials.grantsProviderAccess, undefined);
  assert.equal('grantsProviderAccess' in revoked.materials, false);
  assert.equal(Object.keys(revoked.materials).includes('grantsProviderAccess'), false);
  assert.equal(Object.getOwnPropertyDescriptor(revoked.materials, 'grantsProviderAccess'), undefined);
});

test('pre-import known Array keys execute no accessors or substituted values', async () => {
  const mapDescriptor = Object.getOwnPropertyDescriptor(Array.prototype, 'map');
  const filterDescriptor = Object.getOwnPropertyDescriptor(Array.prototype, 'filter');
  let accessorCalls = 0;
  let substitutedCalls = 0;
  function substitutedFilter() { substitutedCalls += 1; return []; }
  const domain = await loadDomain('pre-import-known-array-keys', () => {
    Object.defineProperty(Array.prototype, 'map', {
      configurable: true,
      get() { accessorCalls += 1; return mapDescriptor.value; },
    });
    Object.defineProperty(Array.prototype, 'filter', {
      ...filterDescriptor,
      value: substitutedFilter,
    });
    return () => {
      Object.defineProperty(Array.prototype, 'map', mapDescriptor);
      Object.defineProperty(Array.prototype, 'filter', filterDescriptor);
    };
  });
  assert.equal(accessorCalls, 0);
  assert.equal(substitutedCalls, 0);

  const accepted = createAccepted(domain);
  const event = createRevocation(domain, accepted);
  const revoked = domain.revokePrivateMeetingInvitation(
    accepted.readinessDocument,
    accepted.issuanceEvent,
    accepted.acceptanceEvent,
    event,
  );
  const reflectedPrototype = Object.getPrototypeOf(revoked.materials);
  assert.notEqual(reflectedPrototype.map, mapDescriptor.value);
  assert.notEqual(reflectedPrototype.filter, substitutedFilter);
  assert.equal(accessorCalls, 0);
  assert.equal(substitutedCalls, 0);
});

test('a genuine revocation event is consumed exactly once', async () => {
  const domain = await loadDomain('single-use-revocation-event');
  const accepted = createAccepted(domain);
  const event = createRevocation(domain, accepted);
  const first = domain.revokePrivateMeetingInvitation(
    accepted.readinessDocument,
    accepted.issuanceEvent,
    accepted.acceptanceEvent,
    event,
  );
  assert.equal(first.lifecycle, 'revoked');
  assert.throws(
    () => domain.revokePrivateMeetingInvitation(
      accepted.readinessDocument,
      accepted.issuanceEvent,
      accepted.acceptanceEvent,
      event,
    ),
    { name: 'TypeError', message: 'Invalid private meeting invitation revocation input' },
  );
});

test('revocation provenance is event-owned exact-instance constant-time under many events', async () => {
  const domain = await loadDomain('bounded-revocation-provenance');
  assert.deepEqual(domain.privateMeetingInvitationRevocationProvenance, {
    lookup: 'private-field-constant-time',
    retention: 'event-owned',
    consumption: 'single-use',
  });
  assert.equal(Object.isFrozen(domain.privateMeetingInvitationRevocationProvenance), true);

  const issued = [];
  for (let index = 0; index < 256; index += 1) {
    const accepted = createAccepted(domain);
    issued.push({ accepted, event: createRevocation(domain, accepted) });
  }
  for (const index of [0, 127, 255]) {
    const { accepted, event } = issued[index];
    assert.equal(domain.revokePrivateMeetingInvitation(
      accepted.readinessDocument,
      accepted.issuanceEvent,
      accepted.acceptanceEvent,
      event,
    ).lifecycle, 'revoked');
  }
  assert.throws(
    () => domain.revokePrivateMeetingInvitation(
      issued[127].accepted.readinessDocument,
      issued[127].accepted.issuanceEvent,
      issued[127].accepted.acceptanceEvent,
      { ...issued[127].event },
    ),
    { name: 'TypeError', message: 'Invalid private meeting invitation revocation input' },
  );
});

test('revoked materials assignment cannot execute an inherited setter', async () => {
  const domain = await loadDomain('materials-assignment-boundary');
  const accepted = createAccepted(domain);
  const event = createRevocation(domain, accepted);
  const revoked = domain.revokePrivateMeetingInvitation(
    accepted.readinessDocument,
    accepted.issuanceEvent,
    accepted.acceptanceEvent,
    event,
  );
  const original = Object.getOwnPropertyDescriptor(Array.prototype, 'reviewSetter');
  let hookCalls = 0;
  Object.defineProperty(Array.prototype, 'reviewSetter', {
    configurable: true,
    set() { hookCalls += 1; },
  });
  try {
    assert.throws(() => { revoked.materials.reviewSetter = true; }, TypeError);
  } finally {
    if (original) Object.defineProperty(Array.prototype, 'reviewSetter', original);
    else delete Array.prototype.reviewSetter;
  }
  assert.equal(hookCalls, 0);
});

test('revoked materials meta-operations cannot execute inherited proxy traps', async () => {
  const domain = await loadDomain('materials-meta-operation-boundary');
  const accepted = createAccepted(domain);
  const event = createRevocation(domain, accepted);
  const revoked = domain.revokePrivateMeetingInvitation(
    accepted.readinessDocument,
    accepted.issuanceEvent,
    accepted.acceptanceEvent,
    event,
  );
  const trapNames = ['defineProperty', 'deleteProperty', 'setPrototypeOf', 'preventExtensions'];
  const originals = trapNames.map((name) => Object.getOwnPropertyDescriptor(Object.prototype, name));
  const calls = { defineProperty: 0, deleteProperty: 0, setPrototypeOf: 0, preventExtensions: 0 };
  for (const name of trapNames) {
    Object.defineProperty(Object.prototype, name, {
      configurable: true,
      value() { calls[name] += 1; return name === 'preventExtensions'; },
    });
  }
  try {
    assert.throws(() => Object.defineProperty(revoked.materials, 'claim', { value: true }), TypeError);
    assert.throws(() => { delete revoked.materials[0]; }, TypeError);
    assert.throws(() => Object.setPrototypeOf(revoked.materials, null), TypeError);
    Object.preventExtensions(revoked.materials);
  } finally {
    trapNames.forEach((name, index) => {
      if (originals[index]) Object.defineProperty(Object.prototype, name, originals[index]);
      else delete Object.prototype[name];
    });
  }
  assert.deepEqual(calls, {
    defineProperty: 0, deleteProperty: 0, setPrototypeOf: 0, preventExtensions: 0,
  });
});

test('pre-import intrinsic substitution executes no hooks during valid revocation', async () => {
  const hookCalls = {};
  const scenarios = [
    ['Reflect.getOwnPropertyDescriptor', () => {
      const original = Reflect.getOwnPropertyDescriptor;
      Reflect.getOwnPropertyDescriptor = (...args) => {
        hookCalls['Reflect.getOwnPropertyDescriptor'] += 1;
        return original(...args);
      };
      return () => { Reflect.getOwnPropertyDescriptor = original; };
    }],
    ['Reflect.ownKeys', () => {
      const original = Reflect.ownKeys;
      Reflect.ownKeys = (...args) => {
        hookCalls['Reflect.ownKeys'] += 1;
        return original(...args);
      };
      return () => { Reflect.ownKeys = original; };
    }],
    ['Proxy', () => {
      const original = globalThis.Proxy;
      globalThis.Proxy = new original(original, {
        construct(target, args, newTarget) {
          hookCalls.Proxy += 1;
          return Reflect.construct(target, args, newTarget);
        },
      });
      return () => { globalThis.Proxy = original; };
    }],
    ['WeakMap', () => {
      const original = globalThis.WeakMap;
      globalThis.WeakMap = new Proxy(original, {
        construct(target, args, newTarget) {
          hookCalls.WeakMap += 1;
          return Reflect.construct(target, args, newTarget);
        },
      });
      return () => { globalThis.WeakMap = original; };
    }],
    ['Date', () => {
      const original = globalThis.Date;
      globalThis.Date = new Proxy(original, {
        construct(target, args, newTarget) {
          hookCalls.Date += 1;
          return Reflect.construct(target, args, newTarget);
        },
      });
      return () => { globalThis.Date = original; };
    }],
    ['Date.parse', () => {
      const original = Date.parse;
      Date.parse = (...args) => {
        hookCalls['Date.parse'] += 1;
        return original(...args);
      };
      return () => { Date.parse = original; };
    }],
    ['Number.isSafeInteger', () => {
      const original = Number.isSafeInteger;
      Number.isSafeInteger = (...args) => {
        hookCalls['Number.isSafeInteger'] += 1;
        return original(...args);
      };
      return () => { Number.isSafeInteger = original; };
    }],
    ['Object.is', () => {
      const original = Object.is;
      Object.is = (...args) => {
        hookCalls['Object.is'] += 1;
        return original(...args);
      };
      return () => { Object.is = original; };
    }],
  ];
  const lifecycles = {};
  for (const [name, install] of scenarios) {
    hookCalls[name] = 0;
    const domain = await loadDomain(`pre-import-${name}`, install);
    const accepted = createAccepted(domain);
    const event = createRevocation(domain, accepted);
    lifecycles[name] = domain.revokePrivateMeetingInvitation(
      accepted.readinessDocument,
      accepted.issuanceEvent,
      accepted.acceptanceEvent,
      event,
    ).lifecycle;
  }
  assert.equal(Object.keys(lifecycles).length, scenarios.length);
  assert.deepEqual(hookCalls, {
    'Reflect.getOwnPropertyDescriptor': 0,
    'Reflect.ownKeys': 0,
    Proxy: 0,
    WeakMap: 0,
    Date: 0,
    'Date.parse': 0,
    'Number.isSafeInteger': 0,
    'Object.is': 0,
  });
});

test('revocation captures trusted intrinsics without executing substituted Object hooks', async () => {
  const originalDescriptor = Object.getOwnPropertyDescriptor;
  const originalFreeze = Object.freeze;
  let hookCalls = 0;
  const domain = await loadDomain('intrinsic-substitution', () => {
    Object.getOwnPropertyDescriptor = function substitutedDescriptor(...args) {
      hookCalls += 1;
      return Reflect.apply(originalDescriptor, Object, args);
    };
    Object.freeze = function substitutedFreeze(value) {
      hookCalls += 1;
      return value;
    };
    return () => {
      Object.getOwnPropertyDescriptor = originalDescriptor;
      Object.freeze = originalFreeze;
    };
  });
  assert.equal(hookCalls, 0);

  const accepted = createAccepted(domain);
  const replacements = [
    [Date, 'parse', () => { hookCalls += 1; return Number.NaN; }],
    [Number, 'isFinite', () => { hookCalls += 1; return false; }],
    [Number, 'isSafeInteger', () => { hookCalls += 1; return false; }],
    [Object, 'is', () => { hookCalls += 1; return true; }],
    [Reflect, 'ownKeys', () => { hookCalls += 1; return []; }],
    [Reflect, 'getOwnPropertyDescriptor', () => { hookCalls += 1; return undefined; }],
    [WeakMap.prototype, 'get', () => { hookCalls += 1; return undefined; }],
    [WeakMap.prototype, 'set', () => { hookCalls += 1; throw new Error('replacement called'); }],
  ];
  const originals = replacements.map(([owner, key]) => owner[key]);
  let revoked;
  try {
    replacements.forEach(([owner, key, replacement]) => { owner[key] = replacement; });
    const event = createRevocation(domain, accepted);
    revoked = domain.revokePrivateMeetingInvitation(
      accepted.readinessDocument,
      accepted.issuanceEvent,
      accepted.acceptanceEvent,
      event,
    );
  } finally {
    replacements.forEach(([owner, key], index) => { owner[key] = originals[index]; });
  }
  assert.equal(revoked.lifecycle, 'revoked');
  assert.equal(Object.isFrozen(revoked), true);
  assert.equal(hookCalls, 0);
});

test('pre-import WeakMap method accessors execute no hooks during valid revocation', async () => {
  const methodNames = ['set', 'get', 'delete'];
  const descriptors = Object.fromEntries(methodNames.map((name) => [
    name,
    Object.getOwnPropertyDescriptor(WeakMap.prototype, name),
  ]));
  const hookCalls = { set: 0, get: 0, delete: 0 };
  const domain = await loadDomain('pre-import-weakmap-method-accessors', () => {
    for (const name of methodNames) {
      Object.defineProperty(WeakMap.prototype, name, {
        configurable: true,
        get() {
          hookCalls[name] += 1;
          return descriptors[name].value;
        },
      });
    }
    return () => {
      for (const name of methodNames) {
        Object.defineProperty(WeakMap.prototype, name, descriptors[name]);
      }
    };
  });
  const accepted = createAccepted(domain);
  const event = createRevocation(domain, accepted);
  const revoked = domain.revokePrivateMeetingInvitation(
    accepted.readinessDocument,
    accepted.issuanceEvent,
    accepted.acceptanceEvent,
    event,
  );

  assert.equal(revoked.lifecycle, 'revoked');
  assert.deepEqual(hookCalls, { set: 0, get: 0, delete: 0 });
});

test('pre-import Function toString substitution and accessor execute no hooks', async () => {
  const originalDescriptor = Object.getOwnPropertyDescriptor(Function.prototype, 'toString');
  const hookCalls = { substitution: 0, accessor: 0 };
  const scenarios = [
    ['substitution', () => {
      Object.defineProperty(Function.prototype, 'toString', {
        ...originalDescriptor,
        value(...args) {
          hookCalls.substitution += 1;
          return Reflect.apply(originalDescriptor.value, this, args);
        },
      });
    }],
    ['accessor', () => {
      Object.defineProperty(Function.prototype, 'toString', {
        configurable: true,
        get() {
          hookCalls.accessor += 1;
          return originalDescriptor.value;
        },
      });
    }],
  ];
  for (const [name, install] of scenarios) {
    const domain = await loadDomain(`pre-import-function-tostring-${name}`, () => {
      install();
      return () => Object.defineProperty(
        Function.prototype,
        'toString',
        originalDescriptor,
      );
    });
    const accepted = createAccepted(domain);
    const event = createRevocation(domain, accepted);
    assert.equal(domain.revokePrivateMeetingInvitation(
      accepted.readinessDocument,
      accepted.issuanceEvent,
      accepted.acceptanceEvent,
      event,
    ).lifecycle, 'revoked');
  }

  assert.deepEqual(hookCalls, { substitution: 0, accessor: 0 });
});

test('pre-import String charCodeAt substitution and accessor execute no hooks', async () => {
  const originalDescriptor = Object.getOwnPropertyDescriptor(String.prototype, 'charCodeAt');
  const hookCalls = { substitution: 0, accessor: 0 };
  const scenarios = [
    ['substitution', () => {
      Object.defineProperty(String.prototype, 'charCodeAt', {
        ...originalDescriptor,
        value(...args) {
          hookCalls.substitution += 1;
          return Reflect.apply(originalDescriptor.value, this, args);
        },
      });
    }],
    ['accessor', () => {
      Object.defineProperty(String.prototype, 'charCodeAt', {
        configurable: true,
        get() {
          hookCalls.accessor += 1;
          return originalDescriptor.value;
        },
      });
    }],
  ];
  const lifecycles = {};
  for (const [name, install] of scenarios) {
    const domain = await loadDomain(`pre-import-string-charcodeat-${name}`, () => {
      install();
      return () => Object.defineProperty(
        String.prototype,
        'charCodeAt',
        originalDescriptor,
      );
    });
    const accepted = createAccepted(domain);
    const event = createRevocation(domain, accepted);
    lifecycles[name] = domain.revokePrivateMeetingInvitation(
      accepted.readinessDocument,
      accepted.issuanceEvent,
      accepted.acceptanceEvent,
      event,
    ).lifecycle;
  }

  assert.deepEqual(lifecycles, { substitution: 'revoked', accessor: 'revoked' });
  assert.deepEqual(hookCalls, { substitution: 0, accessor: 0 });
});

test('pre-import global Array and Object hooks are neither executed nor retained', async () => {
  const defineGlobalProperty = Reflect.defineProperty;
  const scenarios = [
    ['Array accessor', 'Array', 'accessor'],
    ['Array substitution', 'Array', 'substitution'],
    ['Object accessor', 'Object', 'accessor'],
    ['Object substitution', 'Object', 'substitution'],
  ];
  const observations = {};
  for (const [name, globalName, variant] of scenarios) {
    const originalDescriptor = Object.getOwnPropertyDescriptor(globalThis, globalName);
    const originalValue = originalDescriptor.value;
    let hooks = 0;
    function hostileConstructor() { hooks += 1; }
    const domain = await loadDomain(`pre-import-global-${globalName}-${variant}`, () => {
      defineGlobalProperty(globalThis, globalName, variant === 'accessor'
        ? {
          configurable: true,
          get() { hooks += 1; return originalValue; },
        }
        : { ...originalDescriptor, value: hostileConstructor });
      return () => defineGlobalProperty(globalThis, globalName, originalDescriptor);
    });
    const accepted = createAccepted(domain);
    const event = createRevocation(domain, accepted);
    const revoked = domain.revokePrivateMeetingInvitation(
      accepted.readinessDocument,
      accepted.issuanceEvent,
      accepted.acceptanceEvent,
      event,
    );
    const reflectedArrayPrototype = Object.getPrototypeOf(revoked.materials);
    const reflectedObjectPrototype = Object.getPrototypeOf(reflectedArrayPrototype);
    observations[name] = {
      hooks,
      retained: (globalName === 'Array'
        ? reflectedArrayPrototype.constructor
        : reflectedObjectPrototype?.constructor) === hostileConstructor,
    };
  }

  assert.deepEqual(observations, {
    'Array accessor': { hooks: 0, retained: false },
    'Array substitution': { hooks: 0, retained: false },
    'Object accessor': { hooks: 0, retained: false },
    'Object substitution': { hooks: 0, retained: false },
  });
});

test('pre-import Proxy Symbol and TypeError hooks are not captured by valid revocation', async () => {
  const defineGlobalProperty = Reflect.defineProperty;
  const scenarios = ['Proxy', 'Symbol', 'TypeError'];
  const hookCalls = {};
  const lifecycles = {};
  for (const globalName of scenarios) {
    const originalDescriptor = Object.getOwnPropertyDescriptor(globalThis, globalName);
    hookCalls[globalName] = 0;
    const domain = await loadDomain(`pre-import-global-${globalName}-accessor`, () => {
      defineGlobalProperty(globalThis, globalName, {
        configurable: true,
        get() {
          hookCalls[globalName] += 1;
          return originalDescriptor.value;
        },
      });
      return () => defineGlobalProperty(globalThis, globalName, originalDescriptor);
    });
    const accepted = createAccepted(domain);
    const event = createRevocation(domain, accepted);
    lifecycles[globalName] = domain.revokePrivateMeetingInvitation(
      accepted.readinessDocument,
      accepted.issuanceEvent,
      accepted.acceptanceEvent,
      event,
    ).lifecycle;
  }

  assert.deepEqual(lifecycles, {
    Proxy: 'revoked', Symbol: 'revoked', TypeError: 'revoked',
  });
  assert.deepEqual(hookCalls, { Proxy: 0, Symbol: 0, TypeError: 0 });
});

test('persistent pre-import ambient hooks remain absent through use iteration and denial', async () => {
  const defineGlobalProperty = Reflect.defineProperty;
  const scenarios = [
    ['Array accessor', 'Array', 'accessor'],
    ['Array substitution', 'Array', 'substitution'],
    ['Object accessor', 'Object', 'accessor'],
    ['Object substitution', 'Object', 'substitution'],
    ['Proxy substitution', 'Proxy', 'proxy-substitution'],
    ['Symbol accessor', 'Symbol', 'accessor'],
    ['TypeError accessor', 'TypeError', 'accessor'],
  ];
  const observations = {};
  for (const [name, globalName, variant] of scenarios) {
    const originalDescriptor = Object.getOwnPropertyDescriptor(globalThis, globalName);
    const originalValue = originalDescriptor.value;
    let hooks = 0;
    function hostileConstructor() { hooks += 1; }
    let domain;
    try {
      domain = await loadDomain(`persistent-pre-import-${globalName}-${variant}`, () => {
        let replacement;
        if (variant === 'accessor') {
          replacement = {
            configurable: true,
            get() { hooks += 1; return originalValue; },
          };
        } else if (variant === 'proxy-substitution') {
          replacement = {
            ...originalDescriptor,
            value: new originalValue(originalValue, {
              construct(target, args, newTarget) {
                hooks += 1;
                return Reflect.construct(target, args, newTarget);
              },
            }),
          };
        } else {
          replacement = { ...originalDescriptor, value: hostileConstructor };
        }
        defineGlobalProperty(globalThis, globalName, replacement);
        return () => defineGlobalProperty(globalThis, globalName, originalDescriptor);
      }, true);
      const accepted = createAccepted(domain);
      const event = createRevocation(domain, accepted);
      const revoked = domain.revokePrivateMeetingInvitation(
        accepted.readinessDocument,
        accepted.issuanceEvent,
        accepted.acceptanceEvent,
        event,
      );
      const iterated = [...revoked.materials];
      let denial;
      try {
        createRevocation(domain, accepted, { policyRevision: 0 });
      } catch (error) {
        denial = { name: error.name, message: error.message };
      }
      const reflectedArrayPrototype = getTestPrototypeOf(revoked.materials);
      const reflectedObjectPrototype = getTestPrototypeOf(reflectedArrayPrototype);
      observations[name] = {
        hooks,
        lifecycle: revoked.lifecycle,
        iteratedMaterialReference: iterated[0].materialReference,
        retained: (globalName === 'Array'
          ? reflectedArrayPrototype.constructor
          : reflectedObjectPrototype?.constructor) === hostileConstructor,
        denial,
      };
    } finally {
      domain?.restoreRevocationHooks?.();
    }
  }

  assert.deepEqual(observations, Object.fromEntries(scenarios.map(([name]) => [
    name,
    {
      hooks: 0,
      lifecycle: 'revoked',
      iteratedMaterialReference: IDS.material,
      retained: false,
      denial: {
        name: 'TypeError',
        message: 'Invalid private meeting invitation revocation input',
      },
    },
  ])));
});

test('sanitized factory and revoked materials close raw constructor prototype bridges', async () => {
  const domain = await loadDomain('closed-constructor-prototype-bridges');
  const prototypeSource = domain.createPrivateMeetingInvitationSanitizedArrayPrototypeSource();
  const factoryArrayPrototype = Object.getPrototypeOf(prototypeSource);
  const factoryObjectPrototype = Object.getPrototypeOf(factoryArrayPrototype);
  const factoryArrayConstructor = factoryArrayPrototype.constructor;
  const factoryObjectConstructor = factoryObjectPrototype.constructor;
  const accepted = createAccepted(domain);
  const event = createRevocation(domain, accepted);
  const revoked = domain.revokePrivateMeetingInvitation(
    accepted.readinessDocument,
    accepted.issuanceEvent,
    accepted.acceptanceEvent,
    event,
  );
  const outputArrayConstructor = Object.getPrototypeOf(revoked.materials).constructor;
  const arrayClaim = '__private_invitation_array_constructor_claim__';
  const objectClaim = '__private_invitation_object_constructor_claim__';
  const originalArrayClaim = Object.getOwnPropertyDescriptor(Array.prototype, arrayClaim);
  const originalObjectClaim = Object.getOwnPropertyDescriptor(Object.prototype, objectClaim);
  let observations;
  Object.defineProperty(Array.prototype, arrayClaim, {
    configurable: true,
    value: true,
  });
  Object.defineProperty(Object.prototype, objectClaim, {
    configurable: true,
    value: true,
  });
  try {
    let rawArrayConstructorCallable = false;
    try {
      rawArrayConstructorCallable = Array.isArray(factoryArrayConstructor());
    } catch {
      // A closed inert constructor meaning must not be callable.
    }
    observations = {
      factoryArrayConstructorIsRaw: factoryArrayConstructor === Array,
      factoryObjectConstructorIsRaw: factoryObjectConstructor === Object,
      outputArrayConstructorIsRaw: outputArrayConstructor === Array,
      rawArrayConstructorCallable,
      arrayClaimViaExposedConstructor: factoryArrayConstructor?.prototype?.[arrayClaim] === true,
      objectClaimViaExposedConstructor: factoryObjectConstructor?.prototype?.[objectClaim] === true,
    };
  } finally {
    if (originalArrayClaim) Object.defineProperty(Array.prototype, arrayClaim, originalArrayClaim);
    else delete Array.prototype[arrayClaim];
    if (originalObjectClaim) Object.defineProperty(Object.prototype, objectClaim, originalObjectClaim);
    else delete Object.prototype[objectClaim];
  }

  assert.deepEqual(observations, {
    factoryArrayConstructorIsRaw: false,
    factoryObjectConstructorIsRaw: false,
    outputArrayConstructorIsRaw: false,
    rawArrayConstructorCallable: false,
    arrayClaimViaExposedConstructor: false,
    objectClaimViaExposedConstructor: false,
  });
  assert.equal(Array.isArray(revoked.materials), true);
  assert.deepEqual([...revoked.materials], [
    { materialReference: IDS.material, evidenceReference: IDS.evidence },
  ]);
  assert.equal(JSON.stringify(revoked.materials), JSON.stringify([
    { materialReference: IDS.material, evidenceReference: IDS.evidence },
  ]));
});

test('reflected sanitized prototypes reject meta-mutations without changing global intrinsics', async () => {
  const domain = await loadDomain('reflected-prototype-meta-mutations');
  const accepted = createAccepted(domain);
  const event = createRevocation(domain, accepted);
  const revoked = domain.revokePrivateMeetingInvitation(
    accepted.readinessDocument,
    accepted.issuanceEvent,
    accepted.acceptanceEvent,
    event,
  );
  const sanitizedArrayPrototype = Object.getPrototypeOf(revoked.materials);
  const sanitizedObjectPrototype = Object.getPrototypeOf(sanitizedArrayPrototype);
  const layers = [
    ['Array', sanitizedArrayPrototype, Array.prototype],
    ['Object', sanitizedObjectPrototype, Object.prototype],
  ];
  const extensibility = [];
  for (const [name, sanitizedPrototype, globalPrototype] of layers) {
    assert.equal(Reflect.set(sanitizedPrototype, 'grantsProviderAccess', true), false);
    assert.equal(Reflect.defineProperty(
      sanitizedPrototype,
      'grantsProviderAccess',
      { configurable: true, value: true },
    ), false);
    assert.equal(Reflect.deleteProperty(sanitizedPrototype, 'constructor'), false);
    assert.equal(Reflect.setPrototypeOf(sanitizedPrototype, null), false);
    const before = Object.isExtensible(globalPrototype);
    let threw = false;
    try {
      Object.preventExtensions(sanitizedPrototype);
    } catch (error) {
      assert.equal(error instanceof TypeError, true);
      threw = true;
    }
    extensibility.push({
      name,
      before,
      after: Object.isExtensible(globalPrototype),
      threw,
    });
  }

  assert.deepEqual(extensibility, [
    { name: 'Array', before: true, after: true, threw: true },
    { name: 'Object', before: true, after: true, threw: true },
  ]);
});
