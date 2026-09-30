export type MeetingInvitationReadiness = Readonly<{
  schemaVersion: 'invitation-readiness/1';
  invitationReference: string;
  issuer: Readonly<{
    subjectReference: string;
    issuanceAuthorizationReference: string;
  }>;
  recipient: Readonly<{
    subjectReference: string;
    participationAuthorizationReference: string;
  }>;
  purpose: Readonly<{ purposeReference: string }>;
  materials: readonly Readonly<{
    materialReference: string;
    evidenceReference: string;
  }>[];
  access: Readonly<{ scope: 'readiness_only'; grantsAccess: false }>;
  lifecycle: Readonly<{ state: 'prepared_only' }>;
  validity: Readonly<{
    preparedAt: string;
    validFrom: string;
    expiresAt: string;
  }>;
  revocation: Readonly<{
    state: 'not_revoked_yet';
    revocationAuthorityReference: string;
  }>;
}>;

type UnknownRecord = Record<string, unknown>;

const parseJson: (text: string) => unknown = JSON.parse;
const freezeObject: typeof Object.freeze = Object.freeze;
const isArray: (value: unknown) => value is unknown[] = Array.isArray;
const objectPrototype = Object.prototype;
const arrayPrototype = Array.prototype;
function createArrayIterator(
  values: unknown[],
  projection: 'entries' | 'keys' | 'values',
): IterableIterator<unknown> {
  let index = 0;
  const iterator: IterableIterator<unknown> = {
    next(): IteratorResult<unknown> {
      if (index >= values.length) return { done: true, value: undefined };
      const value = projection === 'keys'
        ? index
        : projection === 'entries' ? [index, values[index]] : values[index];
      index += 1;
      return { done: false, value };
    },
    [Symbol.iterator](): IterableIterator<unknown> {
      return iterator;
    },
  };
  return freezeObject(iterator);
}
function arrayIterator(this: unknown[]): IterableIterator<unknown> {
  return createArrayIterator(this, 'values');
}
function arrayEntries(this: unknown[]): IterableIterator<unknown> {
  return createArrayIterator(this, 'entries');
}
function arrayKeys(this: unknown[]): IterableIterator<unknown> {
  return createArrayIterator(this, 'keys');
}
const ProxyConstructor = Proxy;
const getPrototypeOf: typeof Object.getPrototypeOf = Object.getPrototypeOf;
const setPrototypeOf: typeof Object.setPrototypeOf = Object.setPrototypeOf;
const defineProperty: typeof Object.defineProperty = Object.defineProperty;
const getOwnPropertyDescriptor: typeof Object.getOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const ownKeys: typeof Reflect.ownKeys = Reflect.ownKeys;
const arrayPrototypeKeys = ownKeys(arrayPrototype);
const arrayPrototypeDescriptors: (PropertyDescriptor | undefined)[] = [];
for (let index = 0; index < arrayPrototypeKeys.length; index += 1) {
  arrayPrototypeDescriptors[index] = getOwnPropertyDescriptor(
    arrayPrototype,
    arrayPrototypeKeys[index],
  );
}
freezeObject(arrayPrototypeKeys);
freezeObject(arrayPrototypeDescriptors);
const fixedArrayConstructorPrototype = freezeObject(Object.create(null));
const fixedArrayConstructor = freezeObject(Object.assign(Object.create(null), {
  prototype: fixedArrayConstructorPrototype,
}));
const fixedArrayConstructorDescriptor = freezeObject({
  configurable: true,
  enumerable: false,
  writable: true,
  value: fixedArrayConstructor,
});
const fixedArrayEntriesDescriptor = freezeObject({
  configurable: true,
  enumerable: false,
  writable: true,
  value: arrayEntries,
});
const fixedArrayKeysDescriptor = freezeObject({
  configurable: true,
  enumerable: false,
  writable: true,
  value: arrayKeys,
});
const fixedArrayValuesDescriptor = freezeObject({
  configurable: true,
  enumerable: false,
  writable: true,
  value: arrayIterator,
});
const DateConstructor = Date;
const parseTimestamp: (value: string) => number = Date.parse;
const timestampToISOString = Date.prototype.toISOString.call.bind(
  Date.prototype.toISOString,
) as (value: Date) => string;
const isFiniteNumber: (value: unknown) => boolean = Number.isFinite;
const SetConstructor = Set;
const hasSetValue = Set.prototype.has.call.bind(Set.prototype.has) as (
  set: Set<string>,
  value: string,
) => boolean;
const addSetValue = Set.prototype.add.call.bind(Set.prototype.add) as (
  set: Set<string>,
  value: string,
) => Set<string>;
const characterCodeAt = String.prototype.charCodeAt.call.bind(
  String.prototype.charCodeAt,
) as (value: string, index: number) => number;

function hasExactKeys(value: UnknownRecord, expected: readonly string[]): boolean {
  const keys = ownKeys(value);
  if (keys.length !== expected.length) return false;
  for (let index = 0; index < keys.length; index += 1) {
    if (keys[index] !== expected[index]) return false;
    const descriptor = getOwnPropertyDescriptor(value, keys[index]);
    if (!descriptor || !('value' in descriptor) || descriptor.enumerable !== true) return false;
  }
  return true;
}

function record(value: unknown): UnknownRecord | null {
  if (value === null || typeof value !== 'object' || isArray(value)
    || getPrototypeOf(value) !== objectPrototype) return null;
  return value as UnknownRecord;
}

function isOpaqueId(value: unknown): value is string {
  if (typeof value !== 'string' || value.length < 19 || value.length > 67
    || characterCodeAt(value, 0) !== 0x69
    || characterCodeAt(value, 1) !== 0x64
    || characterCodeAt(value, 2) !== 0x5f) return false;
  for (let index = 3; index < value.length; index += 1) {
    const code = characterCodeAt(value, index);
    if (!((code >= 0x30 && code <= 0x39) || (code >= 0x61 && code <= 0x66))) return false;
  }
  return true;
}

function isCanonicalTimestamp(value: unknown): value is string {
  if (typeof value !== 'string' || value.length !== 24
    || characterCodeAt(value, 4) !== 0x2d || characterCodeAt(value, 7) !== 0x2d
    || characterCodeAt(value, 10) !== 0x54 || characterCodeAt(value, 13) !== 0x3a
    || characterCodeAt(value, 16) !== 0x3a || characterCodeAt(value, 19) !== 0x2e
    || characterCodeAt(value, 23) !== 0x5a) return false;
  for (let index = 0; index < value.length; index += 1) {
    if (index === 4 || index === 7 || index === 10 || index === 13
      || index === 16 || index === 19 || index === 23) continue;
    const code = characterCodeAt(value, index);
    if (code < 0x30 || code > 0x39) return false;
  }
  const parsed = parseTimestamp(value);
  return isFiniteNumber(parsed)
    && timestampToISOString(new DateConstructor(parsed)) === value;
}

function serializeReadiness(value: MeetingInvitationReadiness): string {
  let materials = '';
  for (let index = 0; index < value.materials.length; index += 1) {
    if (index > 0) materials += ',';
    const material = value.materials[index];
    materials += `{"materialReference":"${material.materialReference}","evidenceReference":"${material.evidenceReference}"}`;
  }
  return `{"schemaVersion":"invitation-readiness/1","invitationReference":"${value.invitationReference}","issuer":{"subjectReference":"${value.issuer.subjectReference}","issuanceAuthorizationReference":"${value.issuer.issuanceAuthorizationReference}"},"recipient":{"subjectReference":"${value.recipient.subjectReference}","participationAuthorizationReference":"${value.recipient.participationAuthorizationReference}"},"purpose":{"purposeReference":"${value.purpose.purposeReference}"},"materials":[${materials}],"access":{"scope":"readiness_only","grantsAccess":false},"lifecycle":{"state":"prepared_only"},"validity":{"preparedAt":"${value.validity.preparedAt}","validFrom":"${value.validity.validFrom}","expiresAt":"${value.validity.expiresAt}"},"revocation":{"state":"not_revoked_yet","revocationAuthorityReference":"${value.revocation.revocationAuthorityReference}"}}`;
}

const closedRecordHandler: ProxyHandler<object> = freezeObject(Object.assign(Object.create(null), {
  get(target: object, key: string | symbol): unknown {
    const own = getOwnPropertyDescriptor(target, key);
    if (own && 'value' in own) return own.value;
    if (isArray(target) && key === Symbol.iterator) return arrayIterator;
    return undefined;
  },
  has(target: object, key: string | symbol): boolean {
    if (getOwnPropertyDescriptor(target, key)) return true;
    return isArray(target) && key === Symbol.iterator;
  },
}));

function fixedArrayPrototypeDescriptor(key: string | symbol): PropertyDescriptor | undefined {
  if (key === 'constructor') return fixedArrayConstructorDescriptor;
  if (key === 'entries') return fixedArrayEntriesDescriptor;
  if (key === 'keys') return fixedArrayKeysDescriptor;
  if (key === 'values' || key === Symbol.iterator) return fixedArrayValuesDescriptor;
  for (let index = 0; index < arrayPrototypeKeys.length; index += 1) {
    if (arrayPrototypeKeys[index] === key) return arrayPrototypeDescriptors[index];
  }
  return undefined;
}

const arrayPrototypeViewTarget = Object.create(null);
for (let index = 0; index < arrayPrototypeKeys.length; index += 1) {
  const key = arrayPrototypeKeys[index];
  const descriptor = fixedArrayPrototypeDescriptor(key);
  if (descriptor) defineProperty(arrayPrototypeViewTarget, key, descriptor);
}

const arrayPrototypeViewHandler: ProxyHandler<object> = freezeObject(Object.assign(
  Object.create(null),
  {
    get(_target: object, key: string | symbol): unknown {
      if (key === Symbol.iterator) return arrayIterator;
      const descriptor = fixedArrayPrototypeDescriptor(key);
      if (descriptor && 'value' in descriptor) return descriptor.value;
      return undefined;
    },
    has(_target: object, key: string | symbol): boolean {
      return fixedArrayPrototypeDescriptor(key) !== undefined;
    },
    ownKeys(): (string | symbol)[] {
      return arrayPrototypeKeys;
    },
    getOwnPropertyDescriptor(_target: object, key: string | symbol): PropertyDescriptor | undefined {
      if (key === Symbol.iterator) {
        return { configurable: true, enumerable: false, writable: true, value: arrayIterator };
      }
      return fixedArrayPrototypeDescriptor(key);
    },
    set(): false {
      return false;
    },
    defineProperty(): false {
      return false;
    },
    deleteProperty(): false {
      return false;
    },
    setPrototypeOf(): false {
      return false;
    },
    preventExtensions(): false {
      return false;
    },
  },
));
const arrayPrototypeView = new ProxyConstructor(arrayPrototypeViewTarget, arrayPrototypeViewHandler);

function closeRecord<T extends object>(value: T): T {
  if (isArray(value)) {
    setPrototypeOf(value, arrayPrototypeView);
    return freezeObject(value);
  }
  return freezeObject(new ProxyConstructor(value, closedRecordHandler as ProxyHandler<T>));
}

function freezeReadiness(value: MeetingInvitationReadiness): MeetingInvitationReadiness {
  const materials: { materialReference: string; evidenceReference: string }[] = [];
  for (let index = 0; index < value.materials.length; index += 1) {
    const material = value.materials[index];
    materials[materials.length] = closeRecord({
      materialReference: material.materialReference,
      evidenceReference: material.evidenceReference,
    });
  }
  return closeRecord({
    schemaVersion: value.schemaVersion,
    invitationReference: value.invitationReference,
    issuer: closeRecord({
      subjectReference: value.issuer.subjectReference,
      issuanceAuthorizationReference: value.issuer.issuanceAuthorizationReference,
    }),
    recipient: closeRecord({
      subjectReference: value.recipient.subjectReference,
      participationAuthorizationReference: value.recipient.participationAuthorizationReference,
    }),
    purpose: closeRecord({ purposeReference: value.purpose.purposeReference }),
    materials: closeRecord(materials),
    access: closeRecord({ scope: value.access.scope, grantsAccess: value.access.grantsAccess }),
    lifecycle: closeRecord({ state: value.lifecycle.state }),
    validity: closeRecord({
      preparedAt: value.validity.preparedAt,
      validFrom: value.validity.validFrom,
      expiresAt: value.validity.expiresAt,
    }),
    revocation: closeRecord({
      state: value.revocation.state,
      revocationAuthorityReference: value.revocation.revocationAuthorityReference,
    }),
  });
}

export function validateMeetingInvitationReadiness(
  candidate: unknown,
): MeetingInvitationReadiness | null {
  if (typeof candidate !== 'string' || candidate.length === 0 || candidate.length > 8192) {
    return null;
  }
  try {
    const root = record(parseJson(candidate));
    if (root === null || !hasExactKeys(root, [
      'schemaVersion', 'invitationReference', 'issuer', 'recipient', 'purpose',
      'materials', 'access', 'lifecycle', 'validity', 'revocation',
    ])) return null;
    const issuer = record(root.issuer);
    const recipient = record(root.recipient);
    const purpose = record(root.purpose);
    const access = record(root.access);
    const lifecycle = record(root.lifecycle);
    const validity = record(root.validity);
    const revocation = record(root.revocation);
    if (issuer === null || !hasExactKeys(issuer, [
      'subjectReference', 'issuanceAuthorizationReference',
    ]) || recipient === null || !hasExactKeys(recipient, [
      'subjectReference', 'participationAuthorizationReference',
    ]) || purpose === null || !hasExactKeys(purpose, ['purposeReference'])
      || !isArray(root.materials) || access === null || lifecycle === null
      || validity === null || revocation === null
      || !hasExactKeys(access, ['scope', 'grantsAccess'])
      || !hasExactKeys(lifecycle, ['state'])
      || !hasExactKeys(validity, ['preparedAt', 'validFrom', 'expiresAt'])
      || !hasExactKeys(revocation, ['state', 'revocationAuthorityReference'])
      || root.materials.length < 1 || root.materials.length > 16
      || root.schemaVersion !== 'invitation-readiness/1'
      || access.scope !== 'readiness_only' || access.grantsAccess !== false
      || lifecycle.state !== 'prepared_only'
      || revocation.state !== 'not_revoked_yet') return null;
    const materials: { materialReference: string; evidenceReference: string }[] = [];
    for (let index = 0; index < root.materials.length; index += 1) {
      const entry = root.materials[index];
      const material = record(entry);
      if (material === null
        || !hasExactKeys(material, ['materialReference', 'evidenceReference'])) {
        throw new TypeError('invalid material');
      }
      materials[materials.length] = {
        materialReference: material.materialReference as string,
        evidenceReference: material.evidenceReference as string,
      };
    }
    const accepted: MeetingInvitationReadiness = {
      schemaVersion: root.schemaVersion as 'invitation-readiness/1',
      invitationReference: root.invitationReference as string,
      issuer: {
        subjectReference: issuer.subjectReference as string,
        issuanceAuthorizationReference: issuer.issuanceAuthorizationReference as string,
      },
      recipient: {
        subjectReference: recipient.subjectReference as string,
        participationAuthorizationReference: recipient.participationAuthorizationReference as string,
      },
      purpose: { purposeReference: purpose.purposeReference as string },
      materials,
      access: {
        scope: access.scope as 'readiness_only',
        grantsAccess: access.grantsAccess as false,
      },
      lifecycle: { state: lifecycle.state as 'prepared_only' },
      validity: {
        preparedAt: validity.preparedAt as string,
        validFrom: validity.validFrom as string,
        expiresAt: validity.expiresAt as string,
      },
      revocation: {
        state: revocation.state as 'not_revoked_yet',
        revocationAuthorityReference: revocation.revocationAuthorityReference as string,
      },
    };
    const references: unknown[] = [
      accepted.invitationReference,
      accepted.issuer.subjectReference,
      accepted.issuer.issuanceAuthorizationReference,
      accepted.recipient.subjectReference,
      accepted.recipient.participationAuthorizationReference,
      accepted.purpose.purposeReference,
      accepted.revocation.revocationAuthorityReference,
    ];
    for (let index = 0; index < accepted.materials.length; index += 1) {
      const material = accepted.materials[index];
      references[references.length] = material.materialReference;
      references[references.length] = material.evidenceReference;
    }
    const distinctReferences = new SetConstructor<string>();
    for (let index = 0; index < references.length; index += 1) {
      const reference = references[index];
      if (!isOpaqueId(reference) || hasSetValue(distinctReferences, reference)) return null;
      addSetValue(distinctReferences, reference);
    }
    const { preparedAt, validFrom, expiresAt } = accepted.validity;
    if (!isCanonicalTimestamp(preparedAt) || !isCanonicalTimestamp(validFrom)
      || !isCanonicalTimestamp(expiresAt)
      || parseTimestamp(preparedAt) > parseTimestamp(validFrom)
      || parseTimestamp(validFrom) >= parseTimestamp(expiresAt)) return null;
    if (serializeReadiness(accepted) !== candidate) return null;
    return freezeReadiness(accepted);
  } catch {
    return null;
  }
}
