import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFile, readdir } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const domainUrl = new URL('../src/domain/meetingInvitationReadiness.ts', import.meta.url);

async function loadDomain(fragment, beforeImport = () => {}) {
  const source = await readFile(domainUrl, 'utf8').catch(() => '');
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  beforeImport();
  return import(`data:text/javascript;base64,${Buffer.from(output).toString('base64')}#${fragment}`);
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
});

function completeCandidate() {
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
  };
}

function serialize(value = completeCandidate()) {
  return JSON.stringify(value);
}

function assertCanonicalValue(actual, expected, message = 'canonical values differ') {
  assert.ok(actual, message);
  assert.equal(actual.schemaVersion, expected.schemaVersion, message);
  assert.equal(actual.invitationReference, expected.invitationReference, message);
  assert.equal(actual.issuer.subjectReference, expected.issuer.subjectReference, message);
  assert.equal(
    actual.issuer.issuanceAuthorizationReference,
    expected.issuer.issuanceAuthorizationReference,
    message,
  );
  assert.equal(actual.recipient.subjectReference, expected.recipient.subjectReference, message);
  assert.equal(
    actual.recipient.participationAuthorizationReference,
    expected.recipient.participationAuthorizationReference,
    message,
  );
  assert.equal(actual.purpose.purposeReference, expected.purpose.purposeReference, message);
  assert.equal(Array.isArray(actual.materials), true, message);
  assert.equal(actual.materials.length, expected.materials.length, message);
  for (let index = 0; index < expected.materials.length; index += 1) {
    assert.equal(
      actual.materials[index].materialReference,
      expected.materials[index].materialReference,
      message,
    );
    assert.equal(
      actual.materials[index].evidenceReference,
      expected.materials[index].evidenceReference,
      message,
    );
  }
  assert.equal(actual.access.scope, expected.access.scope, message);
  assert.equal(actual.access.grantsAccess, expected.access.grantsAccess, message);
  assert.equal(actual.lifecycle.state, expected.lifecycle.state, message);
  assert.equal(actual.validity.preparedAt, expected.validity.preparedAt, message);
  assert.equal(actual.validity.validFrom, expected.validity.validFrom, message);
  assert.equal(actual.validity.expiresAt, expected.validity.expiresAt, message);
  assert.equal(actual.revocation.state, expected.revocation.state, message);
  assert.equal(
    actual.revocation.revocationAuthorityReference,
    expected.revocation.revocationAuthorityReference,
    message,
  );
}

test('missing any required invitation-readiness fact fails closed and projects or grants nothing', async () => {
  const domain = await loadDomain('required-facts');
  assert.equal(typeof domain.validateMeetingInvitationReadiness, 'function');

  for (const missingKey of [
    'issuer', 'recipient', 'purpose', 'materials', 'access', 'lifecycle', 'validity', 'revocation',
  ]) {
    const candidate = completeCandidate();
    delete candidate[missingKey];
    const accepted = domain.validateMeetingInvitationReadiness(serialize(candidate));
    assert.equal(accepted, null);
    assert.equal(accepted?.access?.grantsAccess ?? false, false);
    assert.equal(accepted?.invitation ?? null, null);
    assert.equal(accepted?.meeting ?? null, null);
  }
});

test('one exact canonical synthetic readiness value is detached frozen and non-authorizing', async () => {
  const domain = await loadDomain('canonical-candidate');
  const candidate = completeCandidate();
  const accepted = domain.validateMeetingInvitationReadiness(serialize(candidate));

  assertCanonicalValue(accepted, candidate);
  assert.notEqual(accepted, candidate);
  assert.equal(accepted.access.grantsAccess, false);
  assert.equal(accepted.lifecycle.state, 'prepared_only');
  const pending = [accepted];
  while (pending.length > 0) {
    const value = pending.pop();
    assert.equal(Object.isFrozen(value), true);
    for (const child of Object.values(value)) {
      if (child !== null && typeof child === 'object') pending.push(child);
    }
  }
  for (const forbidden of [
    'invitation', 'delivery', 'notification', 'participant', 'meeting', 'attendance',
    'occupancy', 'outcome', 'authority', 'provider', 'credential', 'currentWork',
  ]) {
    assert.equal(forbidden in accepted, false);
  }
});

test('closed canonical facts reject malformed keys references timestamps bounds and chronology', async () => {
  const domain = await loadDomain('closed-canonical-facts');
  const changes = [
    (value) => { value.unknown = true; },
    (value) => { delete value.invitationReference; },
    (value) => { value.invitationReference = 'invitation-visible'; },
    (value) => { value.invitationReference = 'id_ABCDEFABCDEFABCD'; },
    (value) => { value.invitationReference = 'id_123456789012345\u0000'; },
    (value) => { value.invitationReference = 'id_123456789012345\ud800'; },
    (value) => { value.issuer.subjectReference = value.invitationReference; },
    (value) => { value.materials[0].evidenceReference = value.purpose.purposeReference; },
    (value) => { value.materials = []; },
    (value) => { value.materials = Array.from({ length: 17 }, (_, index) => ({
      materialReference: `id_20000000000000${index.toString(16).padStart(2, '0')}`,
      evidenceReference: `id_30000000000000${index.toString(16).padStart(2, '0')}`,
    })); },
    (value) => { value.materials.push({ ...value.materials[0] }); },
    (value) => { value.validity.preparedAt = '2000-01-01T00:00:00Z'; },
    (value) => { value.validity.validFrom = '2000-02-30T00:01:00.000Z'; },
    (value) => { value.validity.validFrom = '1999-12-31T23:59:59.999Z'; },
    (value) => { value.validity.expiresAt = value.validity.validFrom; },
  ];
  for (const change of changes) {
    const candidate = completeCandidate();
    change(candidate);
    assert.equal(domain.validateMeetingInvitationReadiness(serialize(candidate)), null);
  }

  const canonical = serialize();
  const duplicate = canonical.replace(
    '{"schemaVersion":"invitation-readiness/1",',
    '{"schemaVersion":"invitation-readiness/1","schemaVersion":"invitation-readiness/1",',
  );
  const reordered = serialize({
    invitationReference: IDS.invitation,
    schemaVersion: 'invitation-readiness/1',
    ...Object.fromEntries(Object.entries(completeCandidate()).slice(2)),
  });
  const escaped = canonical.replace(IDS.purpose, 'id_100000000000000\\u0036');
  for (const text of [duplicate, reordered, escaped, ` ${canonical}`, `${canonical}\n`, `${canonical}null`]) {
    assert.equal(domain.validateMeetingInvitationReadiness(text), null);
  }
});

test('issued invited accepted active attendance occupancy outcome and access claims reject', async () => {
  const domain = await loadDomain('forbidden-claims');
  const changes = [
    (value) => { value.schemaVersion = 'invitation-readiness/2'; },
    (value) => { value.access.scope = 'temporary_access'; },
    (value) => { value.access.grantsAccess = true; },
    (value) => { value.lifecycle.state = 'issued'; },
    (value) => { value.lifecycle.state = 'invited'; },
    (value) => { value.lifecycle.state = 'accepted'; },
    (value) => { value.lifecycle.state = 'active'; },
    (value) => { value.lifecycle.state = 'completed'; },
    (value) => { value.lifecycle.state = 'cancelled'; },
    (value) => { value.lifecycle.state = 'expired'; },
    (value) => { value.revocation.state = 'revoked'; },
  ];
  for (const change of changes) {
    const candidate = completeCandidate();
    change(candidate);
    assert.equal(domain.validateMeetingInvitationReadiness(serialize(candidate)), null);
  }
  for (const forbidden of ['attendance', 'occupancy', 'outcome', 'meeting', 'participant']) {
    const candidate = completeCandidate();
    candidate[forbidden] = true;
    assert.equal(domain.validateMeetingInvitationReadiness(serialize(candidate)), null);
  }
});

test('primitive serialized boundary rejects hostile non-strings without traps and fails malformed input closed', async () => {
  const originalParse = JSON.parse;
  let parseCalls = 0;
  const domainPromise = loadDomain('primitive-boundary', () => {
    JSON.parse = (...args) => {
      parseCalls += 1;
      return originalParse(...args);
    };
  });
  const domain = await domainPromise.finally(() => { JSON.parse = originalParse; });
  let traps = 0;
  const hostile = new Proxy({}, {
    get() { traps += 1; throw new Error('must not read'); },
    getPrototypeOf() { traps += 1; throw new Error('must not inspect'); },
    ownKeys() { traps += 1; throw new Error('must not enumerate'); },
  });
  const coercible = {
    toString() { traps += 1; return serialize(); },
    valueOf() { traps += 1; return serialize(); },
    [Symbol.toPrimitive]() { traps += 1; return serialize(); },
    [Symbol.iterator]() { traps += 1; return [][Symbol.iterator](); },
  };
  for (const candidate of [
    undefined, null, false, 1, 1n, Symbol('readiness'), [], {}, hostile, coercible,
    new String(serialize()),
  ]) {
    assert.equal(domain.validateMeetingInvitationReadiness(candidate), null);
  }
  assert.equal(traps, 0);
  for (const malformed of ['', '{', 'undefined', '[] trailing', `${serialize()}null`]) {
    assert.doesNotThrow(() => assert.equal(domain.validateMeetingInvitationReadiness(malformed), null));
  }
  parseCalls = 0;
  assert.equal(domain.validateMeetingInvitationReadiness('x'.repeat(8193)), null);
  assert.equal(parseCalls, 0);
});

test('captured validation intrinsics resist later replacement attacks', async () => {
  const domain = await loadDomain('captured-intrinsics');
  const canonical = serialize();
  const malformed = completeCandidate();
  malformed.issuer.issuanceAuthorizationReference = malformed.issuer.subjectReference;
  const malformedSerialized = serialize(malformed);

  const attacks = [
    [Reflect, 'ownKeys', () => []],
    [Object, 'getPrototypeOf', () => null],
    [Object, 'getOwnPropertyDescriptor', () => undefined],
    [Object, 'freeze', (value) => value],
    [JSON, 'parse', () => completeCandidate()],
    [JSON, 'stringify', () => canonical],
    [Date, 'parse', () => 0],
    [Date.prototype, 'toISOString', () => '2000-01-01T00:00:00.000Z'],
    [RegExp.prototype, 'test', () => true],
    [globalThis, 'Set', class { get size() { return 9; } }],
    [Array, 'isArray', () => true],
    [Array.prototype, 'map', () => []],
    [Array.prototype, 'some', () => false],
    [Array.prototype, 'every', () => true],
    [Array.prototype, Symbol.iterator, function () { return [][Symbol.iterator](); }],
  ];

  for (const [owner, key, replacement] of attacks) {
    const original = owner[key];
    let accepted;
    let rejected;
    owner[key] = replacement;
    try {
      accepted = domain.validateMeetingInvitationReadiness(canonical);
      rejected = domain.validateMeetingInvitationReadiness(malformedSerialized);
    } finally {
      owner[key] = original;
    }
    assertCanonicalValue(
      accepted,
      completeCandidate(),
      `canonical candidate rejected after ${String(key)} replacement`,
    );
    assert.equal(rejected, null, `duplicate reference accepted after ${String(key)} replacement`);
  }
});

test('opaque references reject malformed values after inherited RegExp exec replacement', async () => {
  const domain = await loadDomain('regexp-exec-replacement');
  const malformed = completeCandidate();
  malformed.invitationReference = 'not-an-opaque-reference';
  const serialized = serialize(malformed);
  const originalExec = RegExp.prototype.exec;
  let accepted;
  RegExp.prototype.exec = () => ['forced-match'];
  try {
    accepted = domain.validateMeetingInvitationReadiness(serialized);
  } finally {
    RegExp.prototype.exec = originalExec;
  }
  assert.equal(accepted, null);
});

test('canonical timestamps accept without inherited RegExp exec', async () => {
  const domain = await loadDomain('timestamp-regexp-exec-replacement');
  const canonical = serialize();
  const originalExec = RegExp.prototype.exec;
  let calls = 0;
  let accepted;
  RegExp.prototype.exec = () => {
    calls += 1;
    throw new Error('timestamp validation must not execute inherited RegExp exec');
  };
  try {
    accepted = domain.validateMeetingInvitationReadiness(canonical);
  } finally {
    RegExp.prototype.exec = originalExec;
  }
  assert.equal(calls, 0);
  assertCanonicalValue(accepted, completeCandidate());
});

test('timestamps require the exact four-digit UTC shape', async () => {
  const domain = await loadDomain('four-digit-timestamp-shape');

  const lowerBoundary = completeCandidate();
  lowerBoundary.validity = {
    preparedAt: '0000-01-01T00:00:00.000Z',
    validFrom: '0000-01-01T00:00:00.001Z',
    expiresAt: '0000-01-01T00:00:00.002Z',
  };
  assertCanonicalValue(
    domain.validateMeetingInvitationReadiness(serialize(lowerBoundary)),
    lowerBoundary,
  );

  const upperBoundary = completeCandidate();
  upperBoundary.validity = {
    preparedAt: '9999-12-31T23:59:59.997Z',
    validFrom: '9999-12-31T23:59:59.998Z',
    expiresAt: '9999-12-31T23:59:59.999Z',
  };
  assertCanonicalValue(
    domain.validateMeetingInvitationReadiness(serialize(upperBoundary)),
    upperBoundary,
  );

  const extendedYear = completeCandidate();
  extendedYear.validity = {
    preparedAt: '+010000-01-01T00:00:00.000Z',
    validFrom: '+010000-01-01T00:00:00.001Z',
    expiresAt: '+010000-01-01T00:00:00.002Z',
  };
  assert.equal(domain.validateMeetingInvitationReadiness(serialize(extendedYear)), null);
});

test('canonical acceptance ignores inherited Object prototype toJSON', async () => {
  const domain = await loadDomain('inherited-to-json');
  const canonical = serialize();
  const originalDescriptor = Object.getOwnPropertyDescriptor(Object.prototype, 'toJSON');
  let calls = 0;
  let accepted;
  Object.defineProperty(Object.prototype, 'toJSON', {
    configurable: true,
    enumerable: true,
    writable: true,
    value() {
      calls += 1;
      return { poisoned: true };
    },
  });
  try {
    accepted = domain.validateMeetingInvitationReadiness(canonical);
  } finally {
    if (originalDescriptor) {
      Object.defineProperty(Object.prototype, 'toJSON', originalDescriptor);
    } else {
      delete Object.prototype.toJSON;
    }
  }
  assert.equal(calls, 0);
  assertCanonicalValue(accepted, completeCandidate());
});

test('accepted closed records do not inherit forbidden Object prototype claims', async () => {
  const domain = await loadDomain('inherited-forbidden-claim');
  const canonical = serialize();
  const originalDescriptor = Object.getOwnPropertyDescriptor(Object.prototype, 'invitation');
  let accepted;
  Object.defineProperty(Object.prototype, 'invitation', {
    configurable: true,
    enumerable: true,
    writable: true,
    value: true,
  });
  try {
    accepted = domain.validateMeetingInvitationReadiness(canonical);
    assertCanonicalValue(accepted, completeCandidate());
    const pending = [accepted];
    while (pending.length > 0) {
      const value = pending.pop();
      assert.equal('invitation' in value, false);
      assert.equal(value.invitation, undefined);
      for (const child of Object.values(value)) {
        if (child !== null && typeof child === 'object') pending.push(child);
      }
    }
  } finally {
    if (originalDescriptor) {
      Object.defineProperty(Object.prototype, 'invitation', originalDescriptor);
    } else {
      delete Object.prototype.invitation;
    }
  }
});

test('materials do not project post-import Array prototype claims', async () => {
  const domain = await loadDomain('inherited-array-forbidden-claim');
  const canonical = serialize();
  const originalDescriptor = Object.getOwnPropertyDescriptor(Array.prototype, 'invitation');
  let projectedValues = 0;
  let accepted;
  Object.defineProperty(Array.prototype, 'invitation', {
    configurable: true,
    enumerable: true,
    writable: true,
    value: true,
  });
  try {
    accepted = domain.validateMeetingInvitationReadiness(canonical);
    const projectedValue = accepted.materials.invitation;
    if (projectedValue === true) projectedValues += 1;
    assert.equal(projectedValue, undefined);
    assert.equal('invitation' in accepted.materials, false);
    assert.equal(Reflect.ownKeys(accepted.materials).includes('invitation'), false);
    assert.equal(Object.keys(accepted.materials).includes('invitation'), false);
    assert.equal(accepted.materials.length, 1);
    assert.deepEqual(accepted.materials[0], completeCandidate().materials[0]);
    assert.deepEqual([...accepted.materials], completeCandidate().materials);
  } finally {
    if (originalDescriptor) {
      Object.defineProperty(Array.prototype, 'invitation', originalDescriptor);
    } else {
      delete Array.prototype.invitation;
    }
  }
  assert.equal(projectedValues, 0);
});

test('materials iteration ignores post-import Array iterator next replacement', async () => {
  const domain = await loadDomain('array-iterator-next-replacement');
  const accepted = domain.validateMeetingInvitationReadiness(serialize());
  const iteratorPrototype = Object.getPrototypeOf(Array.prototype[Symbol.iterator].call([]));
  const originalDescriptor = Object.getOwnPropertyDescriptor(iteratorPrototype, 'next');
  let hostileCalls = 0;
  let iterated;
  let iterationError;
  Object.defineProperty(iteratorPrototype, 'next', {
    configurable: true,
    enumerable: originalDescriptor.enumerable,
    writable: true,
    value() {
      hostileCalls += 1;
      throw new Error('accepted materials must not execute mutable iterator next');
    },
  });
  try {
    iterated = [...accepted.materials];
  } catch (error) {
    iterationError = error;
  } finally {
    Object.defineProperty(iteratorPrototype, 'next', originalDescriptor);
  }
  assert.equal(hostileCalls, 0);
  assert.equal(iterationError, undefined);
  assert.deepEqual(iterated, completeCandidate().materials);
});

test('all materials iterator surfaces ignore post-import Array iterator next replacement', async () => {
  const domain = await loadDomain('all-array-iterator-surfaces');
  const candidate = completeCandidate();
  const accepted = domain.validateMeetingInvitationReadiness(serialize(candidate));
  const iteratorPrototype = Object.getPrototypeOf(Array.prototype[Symbol.iterator].call([]));
  const originalDescriptor = Object.getOwnPropertyDescriptor(iteratorPrototype, 'next');
  let hostileCalls = 0;
  const observations = [];
  Object.defineProperty(iteratorPrototype, 'next', {
    configurable: true,
    enumerable: originalDescriptor.enumerable,
    writable: true,
    value() {
      hostileCalls += 1;
      throw new Error('accepted materials iterators must not execute mutable iterator next');
    },
  });
  try {
    const surfaces = [
      ['iterator', () => accepted.materials[Symbol.iterator]()],
      ['values', () => accepted.materials.values()],
      ['keys', () => accepted.materials.keys()],
      ['entries', () => accepted.materials.entries()],
    ];
    for (let index = 0; index < surfaces.length; index += 1) {
      const name = surfaces[index][0];
      const createIterator = surfaces[index][1];
      try {
        observations.push([name, [...createIterator()]]);
      } catch (error) {
        observations.push([name, error]);
      }
    }
  } finally {
    Object.defineProperty(iteratorPrototype, 'next', originalDescriptor);
  }
  assert.equal(hostileCalls, 0);
  assert.deepEqual(observations, [
    ['iterator', candidate.materials],
    ['values', candidate.materials],
    ['keys', [0]],
    ['entries', [[0, candidate.materials[0]]]],
  ]);
});

test('materials prototype reflection hides post-import Array prototype claims', async () => {
  const domain = await loadDomain('array-prototype-reflection');
  const candidate = completeCandidate();
  const accepted = domain.validateMeetingInvitationReadiness(serialize(candidate));
  const originalDescriptor = Object.getOwnPropertyDescriptor(Array.prototype, 'invitation');
  let observations;
  Object.defineProperty(Array.prototype, 'invitation', {
    configurable: true,
    enumerable: true,
    writable: true,
    value: true,
  });
  try {
    observations = {
      reflectedClaim: Object.getPrototypeOf(accepted.materials).invitation,
      arrayIdentity: Array.isArray(accepted.materials),
      first: accepted.materials[0],
      length: accepted.materials.length,
      iterated: [...accepted.materials],
      json: JSON.stringify(accepted.materials),
      ownKeys: Reflect.ownKeys(accepted.materials),
      enumerableKeys: Object.keys(accepted.materials),
      frozen: Object.isFrozen(accepted.materials),
      entryFrozen: Object.isFrozen(accepted.materials[0]),
    };
  } finally {
    if (originalDescriptor) {
      Object.defineProperty(Array.prototype, 'invitation', originalDescriptor);
    } else {
      delete Array.prototype.invitation;
    }
  }
  assert.equal(observations.reflectedClaim, undefined);
  assert.equal(observations.arrayIdentity, true);
  assert.deepEqual(observations.first, candidate.materials[0]);
  assert.equal(observations.length, 1);
  assert.deepEqual(observations.iterated, candidate.materials);
  assert.equal(observations.json, JSON.stringify(candidate.materials));
  assert.deepEqual(observations.ownKeys, ['0', 'length']);
  assert.deepEqual(observations.enumerableKeys, ['0']);
  assert.equal(observations.frozen, true);
  assert.equal(observations.entryFrozen, true);
  assert.notEqual(accepted.materials, candidate.materials);
  assert.notEqual(accepted.materials[0], candidate.materials[0]);
});

test('materials prototype constructor cannot reopen post-import Array prototype claims', async () => {
  const domain = await loadDomain('array-prototype-constructor-reflection');
  const candidate = completeCandidate();
  const accepted = domain.validateMeetingInvitationReadiness(serialize(candidate));
  const stringClaim = '__invitation_constructor_claim__';
  const symbolClaim = Symbol('invitation-constructor-claim');
  const originalStringDescriptor = Object.getOwnPropertyDescriptor(Array.prototype, stringClaim);
  const originalSymbolDescriptor = Object.getOwnPropertyDescriptor(Array.prototype, symbolClaim);
  let observations;
  Object.defineProperty(Array.prototype, stringClaim, {
    configurable: true,
    enumerable: true,
    writable: true,
    value: true,
  });
  Object.defineProperty(Array.prototype, symbolClaim, {
    configurable: true,
    enumerable: true,
    writable: true,
    value: true,
  });
  try {
    const reflected = Object.getPrototypeOf(accepted.materials);
    observations = {
      reflectedStringClaim: reflected.constructor.prototype[stringClaim],
      reflectedSymbolClaim: reflected.constructor.prototype[symbolClaim],
      arrayIdentity: Array.isArray(accepted.materials),
      first: accepted.materials[0],
      length: accepted.materials.length,
      iterated: [...accepted.materials],
      json: JSON.stringify(accepted.materials),
      ownKeys: Reflect.ownKeys(accepted.materials),
      enumerableKeys: Object.keys(accepted.materials),
      frozen: Object.isFrozen(accepted.materials),
      entryFrozen: Object.isFrozen(accepted.materials[0]),
    };
  } finally {
    if (originalStringDescriptor) {
      Object.defineProperty(Array.prototype, stringClaim, originalStringDescriptor);
    } else {
      delete Array.prototype[stringClaim];
    }
    if (originalSymbolDescriptor) {
      Object.defineProperty(Array.prototype, symbolClaim, originalSymbolDescriptor);
    } else {
      delete Array.prototype[symbolClaim];
    }
  }
  assert.equal(observations.reflectedStringClaim, undefined);
  assert.equal(observations.reflectedSymbolClaim, undefined);
  assert.equal(observations.arrayIdentity, true);
  assert.deepEqual(observations.first, candidate.materials[0]);
  assert.equal(observations.length, 1);
  assert.deepEqual(observations.iterated, candidate.materials);
  assert.equal(observations.json, JSON.stringify(candidate.materials));
  assert.deepEqual(observations.ownKeys, ['0', 'length']);
  assert.deepEqual(observations.enumerableKeys, ['0']);
  assert.equal(observations.frozen, true);
  assert.equal(observations.entryFrozen, true);
  assert.notEqual(accepted.materials, candidate.materials);
  assert.notEqual(accepted.materials[0], candidate.materials[0]);
});

test('ordinary inherited materials constructor cannot reopen post-import Array prototype claims', async () => {
  const domain = await loadDomain('array-inherited-constructor-reflection');
  const candidate = completeCandidate();
  const accepted = domain.validateMeetingInvitationReadiness(serialize(candidate));
  const reflected = Object.getPrototypeOf(accepted.materials);
  const stringClaim = '__invitation_inherited_constructor_claim__';
  const symbolClaim = Symbol('invitation-inherited-constructor-claim');
  const originalStringDescriptor = Object.getOwnPropertyDescriptor(Array.prototype, stringClaim);
  const originalSymbolDescriptor = Object.getOwnPropertyDescriptor(Array.prototype, symbolClaim);
  let observations;
  Object.defineProperty(Array.prototype, stringClaim, {
    configurable: true,
    enumerable: true,
    writable: true,
    value: true,
  });
  Object.defineProperty(Array.prototype, symbolClaim, {
    configurable: true,
    enumerable: true,
    writable: true,
    value: true,
  });
  try {
    const ordinaryPrototype = accepted.materials.constructor.prototype;
    const receiverPrototype = Reflect.get(reflected, 'constructor', accepted.materials).prototype;
    observations = {
      ordinaryStringClaim: ordinaryPrototype[stringClaim],
      ordinarySymbolClaim: ordinaryPrototype[symbolClaim],
      receiverStringClaim: receiverPrototype[stringClaim],
      receiverSymbolClaim: receiverPrototype[symbolClaim],
      arrayIdentity: Array.isArray(accepted.materials),
      firstMaterialReference: accepted.materials[0].materialReference,
      firstEvidenceReference: accepted.materials[0].evidenceReference,
      length: accepted.materials.length,
      iteratedMaterialReference: [...accepted.materials][0].materialReference,
      valuesMaterialReference: [...accepted.materials.values()][0].materialReference,
      keys: [...accepted.materials.keys()],
      entriesMaterialReference: [...accepted.materials.entries()][0][1].materialReference,
      json: JSON.stringify(accepted.materials),
      ownKeys: Reflect.ownKeys(accepted.materials),
      enumerableKeys: Object.keys(accepted.materials),
      frozen: Object.isFrozen(accepted.materials),
      entryFrozen: Object.isFrozen(accepted.materials[0]),
    };
  } finally {
    if (originalStringDescriptor) {
      Object.defineProperty(Array.prototype, stringClaim, originalStringDescriptor);
    } else {
      delete Array.prototype[stringClaim];
    }
    if (originalSymbolDescriptor) {
      Object.defineProperty(Array.prototype, symbolClaim, originalSymbolDescriptor);
    } else {
      delete Array.prototype[symbolClaim];
    }
  }
  assert.equal(observations.ordinaryStringClaim, undefined);
  assert.equal(observations.ordinarySymbolClaim, undefined);
  assert.equal(observations.receiverStringClaim, undefined);
  assert.equal(observations.receiverSymbolClaim, undefined);
  assert.equal(observations.arrayIdentity, true);
  assert.equal(observations.firstMaterialReference, candidate.materials[0].materialReference);
  assert.equal(observations.firstEvidenceReference, candidate.materials[0].evidenceReference);
  assert.equal(observations.length, 1);
  assert.equal(observations.iteratedMaterialReference, candidate.materials[0].materialReference);
  assert.equal(observations.valuesMaterialReference, candidate.materials[0].materialReference);
  assert.deepEqual(observations.keys, [0]);
  assert.equal(observations.entriesMaterialReference, candidate.materials[0].materialReference);
  assert.equal(observations.json, JSON.stringify(candidate.materials));
  assert.deepEqual(observations.ownKeys, ['0', 'length']);
  assert.deepEqual(observations.enumerableKeys, ['0']);
  assert.equal(observations.frozen, true);
  assert.equal(observations.entryFrozen, true);
  assert.notEqual(accepted.materials, candidate.materials);
  assert.notEqual(accepted.materials[0], candidate.materials[0]);
});

test('materials prototype reflection survives non-configurable post-import Array claims', () => {
  const script = `
    import assert from 'node:assert/strict';
    import { readFile } from 'node:fs/promises';
    import ts from 'typescript';
    const source = await readFile(new URL(${JSON.stringify(domainUrl.href)}), 'utf8');
    const output = ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    const domain = await import(
      \`data:text/javascript;base64,\${Buffer.from(output).toString('base64')}#nonconfigurable-claims\`
    );
    const candidate = ${JSON.stringify(completeCandidate())};
    const accepted = domain.validateMeetingInvitationReadiness(JSON.stringify(candidate));
    assert.ok(accepted);
    const stringClaim = '__invitation_nonconfigurable_claim__';
    const symbolClaim = Symbol('invitation-nonconfigurable-claim');
    Object.defineProperty(Array.prototype, stringClaim, {
      configurable: false, enumerable: true, writable: true, value: true,
    });
    Object.defineProperty(Array.prototype, symbolClaim, {
      configurable: false, enumerable: true, writable: true, value: true,
    });
    const reflected = Object.getPrototypeOf(accepted.materials);
    assert.doesNotThrow(() => Reflect.ownKeys(reflected));
    assert.doesNotThrow(() => Object.getOwnPropertyDescriptor(reflected, stringClaim));
    assert.doesNotThrow(() => Object.getOwnPropertyDescriptor(reflected, symbolClaim));
    assert.equal(Reflect.ownKeys(reflected).includes(stringClaim), false);
    assert.equal(Reflect.ownKeys(reflected).includes(symbolClaim), false);
    assert.equal(Object.getOwnPropertyDescriptor(reflected, stringClaim), undefined);
    assert.equal(Object.getOwnPropertyDescriptor(reflected, symbolClaim), undefined);
    assert.equal(reflected[stringClaim], undefined);
    assert.equal(reflected[symbolClaim], undefined);
    assert.equal(Array.isArray(accepted.materials), true);
    assert.deepEqual(accepted.materials[0], candidate.materials[0]);
    assert.equal(accepted.materials.length, 1);
    assert.deepEqual([...accepted.materials], candidate.materials);
    assert.equal(JSON.stringify(accepted.materials), JSON.stringify(candidate.materials));
    assert.deepEqual(Reflect.ownKeys(accepted.materials), ['0', 'length']);
    assert.deepEqual(Object.keys(accepted.materials), ['0']);
    assert.equal(Object.isFrozen(accepted.materials), true);
    assert.equal(Object.isFrozen(accepted.materials[0]), true);
  `;
  const result = spawnSync(process.execPath, ['--input-type=module', '--eval', script], {
    encoding: 'utf8',
    env: process.env,
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
});

test('closed-record freezing ignores inherited Proxy preventExtensions traps', async () => {
  const domain = await loadDomain('inherited-proxy-prevent-extensions');
  const canonical = serialize();
  const originalDescriptor = Object.getOwnPropertyDescriptor(Object.prototype, 'preventExtensions');
  let calls = 0;
  let accepted;
  Object.defineProperty(Object.prototype, 'preventExtensions', {
    configurable: true,
    enumerable: true,
    writable: true,
    value() {
      calls += 1;
      throw new Error('closed-record handlers must not inherit Proxy traps');
    },
  });
  try {
    accepted = domain.validateMeetingInvitationReadiness(canonical);
  } finally {
    if (originalDescriptor) {
      Object.defineProperty(Object.prototype, 'preventExtensions', originalDescriptor);
    } else {
      delete Object.prototype.preventExtensions;
    }
  }
  assert.equal(calls, 0);
  assertCanonicalValue(accepted, completeCandidate());
});

test('closed-record handlers expose no inherited internal Proxy traps', async () => {
  const domain = await loadDomain('inherited-proxy-traps');
  const canonical = serialize();
  for (const trapName of [
    'ownKeys', 'getOwnPropertyDescriptor', 'defineProperty', 'isExtensible', 'getPrototypeOf',
  ]) {
    const originalDescriptor = Object.getOwnPropertyDescriptor(Object.prototype, trapName);
    let calls = 0;
    let accepted;
    Object.defineProperty(Object.prototype, trapName, {
      configurable: true,
      enumerable: true,
      writable: true,
      value() {
        calls += 1;
        throw new Error(`closed-record handlers must not inherit ${trapName}`);
      },
    });
    try {
      accepted = domain.validateMeetingInvitationReadiness(canonical);
    } finally {
      if (originalDescriptor) {
        Object.defineProperty(Object.prototype, trapName, originalDescriptor);
      } else {
        delete Object.prototype[trapName];
      }
    }
    assert.equal(calls, 0, `inherited ${trapName} trap executed`);
    assertCanonicalValue(accepted, completeCandidate());
  }
});

test('missing root facts reject without inherited accessors', async () => {
  const domain = await loadDomain('missing-root-inherited-accessor');
  const missingIssuer = completeCandidate();
  delete missingIssuer.issuer;
  const serialized = serialize(missingIssuer);
  const originalDescriptor = Object.getOwnPropertyDescriptor(Object.prototype, 'issuer');
  let calls = 0;
  let accepted;
  Object.defineProperty(Object.prototype, 'issuer', {
    configurable: true,
    enumerable: true,
    get() {
      calls += 1;
      return completeCandidate().issuer;
    },
  });
  try {
    accepted = domain.validateMeetingInvitationReadiness(serialized);
  } finally {
    if (originalDescriptor) {
      Object.defineProperty(Object.prototype, 'issuer', originalDescriptor);
    } else {
      delete Object.prototype.issuer;
    }
  }
  assert.equal(calls, 0);
  assert.equal(accepted, null);
});

test('missing nested facts reject without inherited accessors', async () => {
  const domain = await loadDomain('missing-nested-inherited-accessor');
  const missingSubject = completeCandidate();
  delete missingSubject.issuer.subjectReference;
  const serialized = serialize(missingSubject);
  const originalDescriptor = Object.getOwnPropertyDescriptor(Object.prototype, 'subjectReference');
  let calls = 0;
  let accepted;
  Object.defineProperty(Object.prototype, 'subjectReference', {
    configurable: true,
    enumerable: true,
    get() {
      calls += 1;
      return IDS.issuer;
    },
  });
  try {
    accepted = domain.validateMeetingInvitationReadiness(serialized);
  } finally {
    if (originalDescriptor) {
      Object.defineProperty(Object.prototype, 'subjectReference', originalDescriptor);
    } else {
      delete Object.prototype.subjectReference;
    }
  }
  assert.equal(calls, 0);
  assert.equal(accepted, null);
});

test('invitation readiness stays dormant unimported side-effect-free and separate from meeting readiness', async () => {
  const source = await readFile(domainUrl, 'utf8');
  const ast = ts.createSourceFile(
    'meetingInvitationReadiness.ts', source, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS,
  );
  const imports = ast.statements.filter((statement) => ts.isImportDeclaration(statement));
  assert.deepEqual(imports, []);
  assert.equal(source.includes('meetingReadiness'), false);
  assert.equal(/\b(fetch|WebSocket|EventSource|setTimeout|setInterval)\s*\(/.test(source), false);
  assert.equal(/\b(process(?:\.env)?|localStorage|sessionStorage|indexedDB|supabase|sqlite)\b/i.test(source), false);
  assert.equal(/main\.ts|public\/|client\/|server\/|api\/|provider|storage|network|hermes/i.test(source), false);

  const sourceRoot = new URL('../src/', import.meta.url);
  const entries = await readdir(sourceRoot, { recursive: true });
  for (const entry of entries.filter((name) => /\.(?:ts|js)$/.test(name))) {
    if (entry === 'domain/meetingInvitationReadiness.ts') continue;
    const content = await readFile(new URL(entry, sourceRoot), 'utf8');
    assert.equal(
      content.includes('meetingInvitationReadiness'),
      false,
      `unexpected runtime importer: ${entry}`,
    );
  }

  const before = Reflect.ownKeys(globalThis);
  await loadDomain('dormancy-a');
  await loadDomain('dormancy-b');
  assert.deepEqual(Reflect.ownKeys(globalThis), before);
});
