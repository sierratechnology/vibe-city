import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const issuanceUrl = new URL('../src/domain/privateMeetingInvitationIssuance.ts', import.meta.url);
const readinessUrl = new URL('../src/domain/meetingInvitationReadiness.ts', import.meta.url);

async function loadDomain(fragment) {
  const [issuanceSource, readinessSource] = await Promise.all([
    readFile(issuanceUrl, 'utf8').catch(() => ''),
    readFile(readinessUrl, 'utf8'),
  ]);
  const options = {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  };
  const readinessOutput = ts.transpileModule(readinessSource, options).outputText;
  const readinessSpecifier = `data:text/javascript;base64,${Buffer.from(readinessOutput).toString('base64')}#readiness-${fragment}`;
  const issuanceOutput = ts.transpileModule(issuanceSource, options).outputText.replace(
    /['"]\.\/meetingInvitation(?:Readiness|\\u0052eadiness)['"]/,
    JSON.stringify(readinessSpecifier),
  );
  return import(`data:text/javascript;base64,${Buffer.from(issuanceOutput).toString('base64')}#issuance-${fragment}`);
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
  source: 'id_100000000000000a',
  authorization: 'id_100000000000000b',
});

function readinessCandidate() {
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

function issuanceEvent() {
  return {
    schemaVersion: 'private-meeting-invitation-issuance/1',
    readinessSchemaVersion: 'invitation-readiness/1',
    invitationReference: IDS.invitation,
    issuerSubjectReference: IDS.issuer,
    intendedRecipientSubjectReference: IDS.recipient,
    purposeReference: IDS.purpose,
    materials: [{ materialReference: IDS.material, evidenceReference: IDS.evidence }],
    validFrom: '2000-01-01T00:01:00.000Z',
    expiresAt: '2000-01-01T00:02:00.000Z',
    revocationAuthorityReference: IDS.revocationAuthority,
    sourceReference: IDS.source,
    authorizationReference: IDS.authorization,
    policyRevision: 1,
    issuedAt: '2000-01-01T00:00:30.000Z',
  };
}

function createFactoryEvent(domain, readinessDocument = JSON.stringify(readinessCandidate())) {
  return domain.createPrivateMeetingInvitationIssuanceEvent(
    readinessDocument,
    IDS.source,
    IDS.authorization,
    1,
    '2000-01-01T00:00:30.000Z',
  );
}

test('factory event is accepted while raw and wrapped events reject before traps', async () => {
  const domain = await loadDomain('factory-provenance');
  assert.equal(typeof domain.createPrivateMeetingInvitationIssuanceEvent, 'function');

  const readinessDocument = JSON.stringify(readinessCandidate());
  const genuine = domain.createPrivateMeetingInvitationIssuanceEvent(
    readinessDocument,
    IDS.source,
    IDS.authorization,
    1,
    '2000-01-01T00:00:30.000Z',
  );
  assert.equal(
    domain.issuePrivateMeetingInvitation(readinessDocument, genuine).invitationReference,
    IDS.invitation,
  );
  assert.throws(
    () => domain.issuePrivateMeetingInvitation(readinessDocument, issuanceEvent()),
    { name: 'TypeError', message: 'Invalid private meeting invitation issuance input' },
  );

  let trapCalls = 0;
  const wrapped = new Proxy(genuine, {
    get(target, key, receiver) {
      trapCalls += 1;
      return Reflect.get(target, key, receiver);
    },
    getOwnPropertyDescriptor(target, key) {
      trapCalls += 1;
      return Reflect.getOwnPropertyDescriptor(target, key);
    },
    getPrototypeOf(target) {
      trapCalls += 1;
      return Reflect.getPrototypeOf(target);
    },
    ownKeys(target) {
      trapCalls += 1;
      return Reflect.ownKeys(target);
    },
  });
  assert.throws(
    () => domain.issuePrivateMeetingInvitation(readinessDocument, wrapped),
    { name: 'TypeError', message: 'Invalid private meeting invitation issuance input' },
  );
  assert.equal(trapCalls, 0);
});

test('factory rejects non-primitive source facts without coercion', async () => {
  const domain = await loadDomain('factory-primitive-no-coercion');
  const readinessDocument = JSON.stringify(readinessCandidate());
  let hookCalls = 0;
  const hostile = {
    toString() {
      hookCalls += 1;
      return IDS.source;
    },
    valueOf() {
      hookCalls += 1;
      return 1;
    },
    [Symbol.toPrimitive]() {
      hookCalls += 1;
      return IDS.source;
    },
  };
  const attempts = [
    () => domain.createPrivateMeetingInvitationIssuanceEvent(
      readinessDocument, hostile, IDS.authorization, 1, '2000-01-01T00:00:30.000Z',
    ),
    () => domain.createPrivateMeetingInvitationIssuanceEvent(
      readinessDocument, IDS.source, hostile, 1, '2000-01-01T00:00:30.000Z',
    ),
    () => domain.createPrivateMeetingInvitationIssuanceEvent(
      readinessDocument, IDS.source, IDS.authorization, hostile, '2000-01-01T00:00:30.000Z',
    ),
    () => domain.createPrivateMeetingInvitationIssuanceEvent(
      readinessDocument, IDS.source, IDS.authorization, 1, hostile,
    ),
  ];
  const outcomes = attempts.map((attempt) => {
    try {
      attempt();
      return 'accepted';
    } catch (error) {
      return `${error.name}: ${error.message}`;
    }
  });
  assert.deepEqual(outcomes, Array(4).fill(
    'TypeError: Invalid private meeting invitation issuance input',
  ));
  assert.equal(hookCalls, 0);
});

test('factory event and issued history are detached and recursively frozen', async () => {
  const domain = await loadDomain('factory-recursive-freeze');
  const readinessDocument = JSON.stringify(readinessCandidate());
  const event = domain.createPrivateMeetingInvitationIssuanceEvent(
    readinessDocument,
    IDS.source,
    IDS.authorization,
    1,
    '2000-01-01T00:00:30.000Z',
  );
  const issued = domain.issuePrivateMeetingInvitation(readinessDocument, event);

  assert.equal(Object.isFrozen(event), true);
  assert.equal(Object.isFrozen(event.materials), true);
  assert.equal(Object.isFrozen(event.materials[0]), true);
  assert.equal(Object.isFrozen(issued), true);
  assert.equal(Object.isFrozen(issued.materials), true);
  assert.equal(Object.isFrozen(issued.materials[0]), true);
  assert.notEqual(issued, event);
  assert.notEqual(issued.materials, event.materials);
  assert.notEqual(issued.materials[0], event.materials[0]);
});

test('factory event remains exactly bound to its validated readiness document', async () => {
  const domain = await loadDomain('factory-exact-readiness-binding');
  const readiness = readinessCandidate();
  const readinessDocument = JSON.stringify(readiness);
  const event = domain.createPrivateMeetingInvitationIssuanceEvent(
    readinessDocument,
    IDS.source,
    IDS.authorization,
    1,
    '2000-01-01T00:00:30.000Z',
  );

  assert.equal(event.invitationReference, readiness.invitationReference);
  assert.equal(event.issuerSubjectReference, readiness.issuer.subjectReference);
  assert.equal(event.intendedRecipientSubjectReference, readiness.recipient.subjectReference);
  assert.equal(event.purposeReference, readiness.purpose.purposeReference);
  assert.deepEqual(Array.from(event.materials), readiness.materials);
  assert.equal(event.validFrom, readiness.validity.validFrom);
  assert.equal(event.expiresAt, readiness.validity.expiresAt);
  assert.equal(
    event.revocationAuthorityReference,
    readiness.revocation.revocationAuthorityReference,
  );

  const differentReadiness = readinessCandidate();
  differentReadiness.purpose.purposeReference = 'id_2000000000000006';
  assert.throws(
    () => domain.issuePrivateMeetingInvitation(JSON.stringify(differentReadiness), event),
    { name: 'TypeError', message: 'Invalid private meeting invitation issuance input' },
  );
});

test('factory enforces issuance chronology against validated readiness', async () => {
  const domain = await loadDomain('factory-chronology');
  const readinessDocument = JSON.stringify(readinessCandidate());
  for (const issuedAt of [
    '1999-12-31T23:59:59.999Z',
    '2000-01-01T00:01:00.000Z',
  ]) {
    assert.throws(
      () => domain.createPrivateMeetingInvitationIssuanceEvent(
        readinessDocument,
        IDS.source,
        IDS.authorization,
        1,
        issuedAt,
      ),
      { name: 'TypeError', message: 'Invalid private meeting invitation issuance input' },
    );
  }
  assert.equal(
    domain.createPrivateMeetingInvitationIssuanceEvent(
      readinessDocument,
      IDS.source,
      IDS.authorization,
      1,
      '2000-01-01T00:00:00.000Z',
    ).issuedAt,
    '2000-01-01T00:00:00.000Z',
  );
});

test('factory requires source references distinct from every readiness binding', async () => {
  const domain = await loadDomain('factory-distinct-source-references');
  const readinessDocument = JSON.stringify(readinessCandidate());
  for (const [sourceReference, authorizationReference] of [
    [IDS.invitation, IDS.authorization],
    [IDS.source, IDS.material],
    [IDS.source, IDS.source],
  ]) {
    assert.throws(
      () => domain.createPrivateMeetingInvitationIssuanceEvent(
        readinessDocument,
        sourceReference,
        authorizationReference,
        1,
        '2000-01-01T00:00:30.000Z',
      ),
      { name: 'TypeError', message: 'Invalid private meeting invitation issuance input' },
    );
  }
});

test('one exact source issuance event produces only a frozen non-authorizing history record', async () => {
  const domain = await loadDomain('canonical');
  assert.equal(typeof domain.issuePrivateMeetingInvitation, 'function');

  const readinessDocument = JSON.stringify(readinessCandidate());
  const event = createFactoryEvent(domain, readinessDocument);
  const issued = domain.issuePrivateMeetingInvitation(
    readinessDocument,
    event,
  );

  const expected = {
    schemaVersion: 'private-meeting-invitation-issued-history/1',
    invitationReference: IDS.invitation,
    issuerSubjectReference: IDS.issuer,
    intendedRecipientSubjectReference: IDS.recipient,
    purposeReference: IDS.purpose,
    materials: [{ materialReference: IDS.material, evidenceReference: IDS.evidence }],
    revision: 1,
    lifecycle: 'issued',
    issuedAt: '2000-01-01T00:00:30.000Z',
    validFrom: '2000-01-01T00:01:00.000Z',
    expiresAt: '2000-01-01T00:02:00.000Z',
    sourceReference: IDS.source,
    authorizationReference: IDS.authorization,
    policyRevision: 1,
    grantsAccess: false,
    grantsOccupancy: false,
    grantsPermanentMembership: false,
  };
  const { materials: issuedMaterials, ...issuedScalars } = issued;
  const { materials: expectedMaterials, ...expectedScalars } = expected;
  assert.deepEqual(issuedScalars, expectedScalars);
  assert.deepEqual(Array.from(issuedMaterials), expectedMaterials);
  assert.notEqual(issued, event);
  assert.notEqual(issued.materials, event.materials);
  assert.notEqual(issued.materials[0], event.materials[0]);
  assert.equal(Object.isFrozen(issued), true);
  assert.equal(Object.isFrozen(issued.materials), true);
  assert.equal(Object.isFrozen(issued.materials[0]), true);
});

test('issuance event disagreement with readiness fails closed generically', async () => {
  const domain = await loadDomain('disagreement');
  const event = createFactoryEvent(domain);
  const differentReadiness = readinessCandidate();
  differentReadiness.purpose.purposeReference = 'id_2000000000000006';

  assert.throws(
    () => domain.issuePrivateMeetingInvitation(JSON.stringify(differentReadiness), event),
    (error) => error instanceof TypeError
      && error.message === 'Invalid private meeting invitation issuance input',
  );
});

test('issuedAt is canonical at or after preparation and strictly before validity', async () => {
  const domain = await loadDomain('issued-at-chronology');
  const readinessDocument = JSON.stringify(readinessCandidate());
  for (const issuedAt of [
    '1999-12-31T23:59:59.999Z',
    '2000-01-01T00:00:30Z',
    '2000-01-01T00:01:00.000Z',
  ]) {
    assert.throws(
      () => domain.createPrivateMeetingInvitationIssuanceEvent(
        readinessDocument,
        IDS.source,
        IDS.authorization,
        1,
        issuedAt,
      ),
      { name: 'TypeError', message: 'Invalid private meeting invitation issuance input' },
    );
  }

  const boundary = domain.createPrivateMeetingInvitationIssuanceEvent(
    readinessDocument,
    IDS.source,
    IDS.authorization,
    1,
    readinessCandidate().validity.preparedAt,
  );
  assert.equal(
    domain.issuePrivateMeetingInvitation(readinessDocument, boundary).issuedAt,
    boundary.issuedAt,
  );
});

test('source-only references and policy revision reject malformed or coercible scalars', async () => {
  const domain = await loadDomain('source-scalars');
  const readinessDocument = JSON.stringify(readinessCandidate());
  const facts = [
    ['source-visible', IDS.authorization, 1],
    [IDS.source, 1, 1],
    [IDS.source, { toString: () => IDS.authorization }, 1],
    [IDS.source, IDS.authorization, 0],
    [IDS.source, IDS.authorization, -0],
    [IDS.source, IDS.authorization, 1.5],
    [IDS.source, IDS.authorization, Number.MAX_SAFE_INTEGER + 1],
    [IDS.source, IDS.authorization, '1'],
  ];
  for (const [sourceReference, authorizationReference, policyRevision] of facts) {
    assert.throws(
      () => domain.createPrivateMeetingInvitationIssuanceEvent(
        readinessDocument,
        sourceReference,
        authorizationReference,
        policyRevision,
        '2000-01-01T00:00:30.000Z',
      ),
      { name: 'TypeError', message: 'Invalid private meeting invitation issuance input' },
    );
  }
});

test('issuance event accepts only closed plain data properties with exact keys', async () => {
  const domain = await loadDomain('closed-event');
  const candidates = [null, [], new Date(), Object.create(null)];

  const unknown = issuanceEvent();
  unknown.delivery = true;
  candidates.push(unknown);

  const missing = issuanceEvent();
  delete missing.sourceReference;
  candidates.push(missing);

  const symbol = issuanceEvent();
  symbol[Symbol('hidden')] = true;
  candidates.push(symbol);

  let accessorCalls = 0;
  const accessor = issuanceEvent();
  Object.defineProperty(accessor, 'sourceReference', {
    enumerable: true,
    get() {
      accessorCalls += 1;
      return IDS.source;
    },
  });
  candidates.push(accessor);

  for (const candidate of candidates) {
    assert.throws(
      () => domain.issuePrivateMeetingInvitation(JSON.stringify(readinessCandidate()), candidate),
      { name: 'TypeError', message: 'Invalid private meeting invitation issuance input' },
    );
  }
  assert.equal(accessorCalls, 0);
});

test('material bindings reject extra structure accessors sparse arrays and duplicates', async () => {
  const domain = await loadDomain('closed-materials');
  const events = [];

  const arrayProperty = issuanceEvent();
  arrayProperty.materials.extra = true;
  events.push(arrayProperty);

  const arraySymbol = issuanceEvent();
  arraySymbol.materials[Symbol('hidden')] = true;
  events.push(arraySymbol);

  const materialProperty = issuanceEvent();
  materialProperty.materials[0].description = 'private detail';
  events.push(materialProperty);

  const accessor = issuanceEvent();
  Object.defineProperty(accessor.materials, '0', {
    enumerable: true,
    get: () => issuanceEvent().materials[0],
  });
  events.push(accessor);

  const sparse = issuanceEvent();
  sparse.materials.length = 2;
  events.push(sparse);

  const duplicate = issuanceEvent();
  duplicate.materials.push({ ...duplicate.materials[0] });
  events.push(duplicate);

  for (const event of events) {
    assert.throws(
      () => domain.issuePrivateMeetingInvitation(JSON.stringify(readinessCandidate()), event),
      { name: 'TypeError', message: 'Invalid private meeting invitation issuance input' },
    );
  }
});

test('event reflection mutation races fail closed', async () => {
  const domain = await loadDomain('mutation-races');
  const event = issuanceEvent();
  let prototypeReads = 0;
  const changingPrototype = new Proxy(event, {
    getPrototypeOf() {
      prototypeReads += 1;
      return prototypeReads === 1 ? Object.prototype : null;
    },
  });
  assert.throws(
    () => domain.issuePrivateMeetingInvitation(
      JSON.stringify(readinessCandidate()),
      changingPrototype,
    ),
    { name: 'TypeError', message: 'Invalid private meeting invitation issuance input' },
  );
  assert.equal(prototypeReads, 0);

  let keyReads = 0;
  const changingKeys = new Proxy(issuanceEvent(), {
    ownKeys(target) {
      keyReads += 1;
      const keys = Reflect.ownKeys(target);
      return keyReads === 1 ? keys : keys.reverse();
    },
  });
  assert.throws(
    () => domain.issuePrivateMeetingInvitation(JSON.stringify(readinessCandidate()), changingKeys),
    { name: 'TypeError', message: 'Invalid private meeting invitation issuance input' },
  );
  assert.equal(keyReads, 0);
});

test('material array reflection mutation races fail closed', async () => {
  const domain = await loadDomain('material-mutation-races');
  const event = issuanceEvent();
  let keyReads = 0;
  event.materials = new Proxy(event.materials, {
    ownKeys(target) {
      keyReads += 1;
      const keys = Reflect.ownKeys(target);
      return keyReads === 1 ? keys : keys.reverse();
    },
  });
  assert.throws(
    () => domain.issuePrivateMeetingInvitation(JSON.stringify(readinessCandidate()), event),
    { name: 'TypeError', message: 'Invalid private meeting invitation issuance input' },
  );
  assert.equal(keyReads, 0);
});

test('raw Proxy ingress rejects at every boundary before traps execute', async () => {
  const domain = await loadDomain('stable-transparent-proxies');
  const counters = { event: 0, materials: 0, material: 0 };
  const handler = (boundary) => ({
    get(target, key, receiver) {
      counters[boundary] += 1;
      return Reflect.get(target, key, receiver);
    },
    getOwnPropertyDescriptor(target, key) {
      counters[boundary] += 1;
      return Reflect.getOwnPropertyDescriptor(target, key);
    },
    getPrototypeOf(target) {
      counters[boundary] += 1;
      return Reflect.getPrototypeOf(target);
    },
    ownKeys(target) {
      counters[boundary] += 1;
      return Reflect.ownKeys(target);
    },
  });
  const topLevel = issuanceEvent();
  const materialsArray = issuanceEvent();
  const materialRecord = issuanceEvent();
  materialsArray.materials = new Proxy(materialsArray.materials, handler('materials'));
  materialRecord.materials[0] = new Proxy(materialRecord.materials[0], handler('material'));

  const outcomes = [
    new Proxy(topLevel, handler('event')),
    materialsArray,
    materialRecord,
  ].map((candidate) => {
    try {
      domain.issuePrivateMeetingInvitation(JSON.stringify(readinessCandidate()), candidate);
      return 'accepted';
    } catch (error) {
      return `${error.name}: ${error.message}`;
    }
  });

  assert.deepEqual(outcomes, Array(3).fill(
    'TypeError: Invalid private meeting invitation issuance input',
  ));
  assert.deepEqual(counters, { event: 0, materials: 0, material: 0 });
});

test('source and authorization references cannot alias any bound reference', async () => {
  const domain = await loadDomain('distinct-source-references');
  const readinessDocument = JSON.stringify(readinessCandidate());
  for (const [sourceReference, authorizationReference] of [
    [IDS.invitation, IDS.authorization],
    [IDS.material, IDS.authorization],
    [IDS.source, IDS.issuer],
    [IDS.source, IDS.source],
  ]) {
    assert.throws(
      () => domain.createPrivateMeetingInvitationIssuanceEvent(
        readinessDocument,
        sourceReference,
        authorizationReference,
        1,
        '2000-01-01T00:00:30.000Z',
      ),
      { name: 'TypeError', message: 'Invalid private meeting invitation issuance input' },
    );
  }
});

test('caller and output mutation cannot rewrite detached issued history', async () => {
  const domain = await loadDomain('detached-history');
  const readinessDocument = JSON.stringify(readinessCandidate());
  const event = createFactoryEvent(domain, readinessDocument);
  const issued = domain.issuePrivateMeetingInvitation(readinessDocument, event);

  assert.throws(() => { event.sourceReference = IDS.invitation; }, TypeError);
  assert.throws(() => { event.materials[0].materialReference = IDS.source; }, TypeError);
  assert.equal(issued.sourceReference, IDS.source);
  assert.equal(issued.materials[0].materialReference, IDS.material);
  assert.throws(() => { issued.sourceReference = IDS.invitation; }, TypeError);
  assert.throws(() => { issued.materials[0].materialReference = IDS.source; }, TypeError);
  assert.throws(() => { issued.materials.push({}); }, TypeError);
  assert.equal(issued.grantsAccess, false);
  assert.equal(issued.grantsOccupancy, false);
  assert.equal(issued.grantsPermanentMembership, false);
});

test('captured issuance intrinsics resist later replacement attacks', async () => {
  const domain = await loadDomain('captured-intrinsics');
  const attacks = [
    [Object, 'freeze', (value) => value],
    [Object, 'getPrototypeOf', () => null],
    [Object, 'setPrototypeOf', () => { throw new Error('replacement called'); }],
    [Object, 'getOwnPropertyDescriptor', () => undefined],
    [Reflect, 'ownKeys', () => []],
    [Array, 'isArray', () => false],
    [Number, 'isSafeInteger', () => true],
    [Number, 'isFinite', () => true],
    [WeakSet.prototype, 'add', () => { throw new Error('replacement called'); }],
    [WeakSet.prototype, 'has', () => false],
  ];

  for (const [owner, key, replacement] of attacks) {
    const original = owner[key];
    let issued;
    owner[key] = replacement;
    try {
      const readinessDocument = JSON.stringify(readinessCandidate());
      issued = domain.issuePrivateMeetingInvitation(
        readinessDocument,
        createFactoryEvent(domain, readinessDocument),
      );
    } finally {
      owner[key] = original;
    }
    assert.equal(issued.invitationReference, IDS.invitation, String(key));
    assert.equal(Object.isFrozen(issued), true, String(key));
    assert.equal(Object.isFrozen(issued.materials), true, String(key));
  }
});

test('issued records do not inherit later Object prototype claims', async () => {
  const domain = await loadDomain('closed-issued-records');
  const readinessDocument = JSON.stringify(readinessCandidate());
  const issued = domain.issuePrivateMeetingInvitation(
    readinessDocument,
    createFactoryEvent(domain, readinessDocument),
  );
  const original = Object.getOwnPropertyDescriptor(Object.prototype, 'delivery');
  Object.defineProperty(Object.prototype, 'delivery', {
    configurable: true,
    enumerable: true,
    writable: true,
    value: true,
  });
  try {
    assert.equal(issued.delivery, undefined);
    assert.equal('delivery' in issued, false);
    assert.equal(issued.materials[0].delivery, undefined);
    assert.equal('delivery' in issued.materials[0], false);
  } finally {
    if (original) Object.defineProperty(Object.prototype, 'delivery', original);
    else delete Object.prototype.delivery;
  }
});

test('issued material arrays do not project later Array prototype claims', async () => {
  const domain = await loadDomain('closed-issued-material-array');
  const readinessDocument = JSON.stringify(readinessCandidate());
  const issued = domain.issuePrivateMeetingInvitation(
    readinessDocument,
    createFactoryEvent(domain, readinessDocument),
  );
  const original = Object.getOwnPropertyDescriptor(Array.prototype, 'delivery');
  Object.defineProperty(Array.prototype, 'delivery', {
    configurable: true,
    enumerable: true,
    writable: true,
    value: true,
  });
  try {
    assert.equal(issued.materials.delivery, undefined);
    assert.equal('delivery' in issued.materials, false);
    assert.equal(Object.getPrototypeOf(issued.materials).delivery, undefined);
    assert.equal(Object.getPrototypeOf(issued.materials).constructor.prototype.delivery, undefined);
  } finally {
    if (original) Object.defineProperty(Array.prototype, 'delivery', original);
    else delete Array.prototype.delivery;
  }
});

test('issuance boundary stays dormant with only its readiness dependency and no side effects', async () => {
  const source = await readFile(issuanceUrl, 'utf8');
  const ast = ts.createSourceFile(
    'privateMeetingInvitationIssuance.ts',
    source,
    ts.ScriptTarget.ES2022,
    true,
    ts.ScriptKind.TS,
  );
  const imports = ast.statements.filter((statement) => ts.isImportDeclaration(statement));
  assert.equal(imports.length, 1);
  assert.equal(imports[0].moduleSpecifier.text, './meetingInvitationReadiness');
  assert.equal(/\b(fetch|WebSocket|EventSource|setTimeout|setInterval)\s*\(/.test(source), false);
  assert.equal(
    /\b(process(?:\.env)?|localStorage|sessionStorage|indexedDB|supabase|sqlite)\b/i.test(source),
    false,
  );
  assert.equal(/main\.ts|public\/|client\/|server\/|api\/|provider|storage|network|hermes/i.test(source), false);

  const sourceRoot = new URL('../src/', import.meta.url);
  const entries = await readdir(sourceRoot, { recursive: true });
  for (const entry of entries.filter((name) => /\.(?:ts|js)$/.test(name))) {
    if (entry === 'domain/privateMeetingInvitationIssuance.ts') continue;
    const content = await readFile(new URL(entry, sourceRoot), 'utf8');
    assert.equal(
      content.includes('privateMeetingInvitationIssuance'),
      false,
      `unexpected runtime importer: ${entry}`,
    );
  }

  const before = Reflect.ownKeys(globalThis);
  await loadDomain('dormancy-a');
  await loadDomain('dormancy-b');
  assert.deepEqual(Reflect.ownKeys(globalThis), before);
});
