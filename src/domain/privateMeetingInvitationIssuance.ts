import {
  validateMeetingInvitationReadiness,
  type MeetingInvitationReadiness,
} from './meetingInvitation\u0052eadiness';

const GENERIC_ERROR = 'Invalid private meeting invitation issuance input';
const DateConstructor = Date;
const parseTimestamp: (value: string) => number = Date.parse;
const timestampToISOString = Date.prototype.toISOString.call.bind(
  Date.prototype.toISOString,
) as (value: Date) => string;
const characterCodeAt = String.prototype.charCodeAt.call.bind(
  String.prototype.charCodeAt,
) as (value: string, index: number) => number;
const isSafeInteger: (value: unknown) => boolean = Number.isSafeInteger;
const isFiniteNumber: (value: unknown) => boolean = Number.isFinite;
const isSameValue: (left: unknown, right: unknown) => boolean = Object.is;
const freezeObject: typeof Object.freeze = Object.freeze;
const getPrototypeOf: typeof Object.getPrototypeOf = Object.getPrototypeOf;
const setPrototypeOf: typeof Object.setPrototypeOf = Object.setPrototypeOf;
const getOwnPropertyDescriptor: typeof Object.getOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const ProxyConstructor = Proxy;
const WeakSetConstructor = WeakSet;
const addWeakSetValue = WeakSet.prototype.add.call.bind(WeakSet.prototype.add) as (
  set: WeakSet<object>,
  value: object,
) => WeakSet<object>;
const hasWeakSetValue = WeakSet.prototype.has.call.bind(WeakSet.prototype.has) as (
  set: WeakSet<object>,
  value: unknown,
) => boolean;
const genuineIssuanceEvents = new WeakSetConstructor<object>();

export type PrivateMeetingInvitationIssuanceEvent = Readonly<{
  schemaVersion: 'private-meeting-invitation-issuance/1';
  readinessSchemaVersion: 'invitation-readiness/1';
  invitationReference: string;
  issuerSubjectReference: string;
  intendedRecipientSubjectReference: string;
  purposeReference: string;
  materials: readonly Readonly<{
    materialReference: string;
    evidenceReference: string;
  }>[];
  validFrom: string;
  expiresAt: string;
  revocationAuthorityReference: string;
  sourceReference: string;
  authorizationReference: string;
  policyRevision: number;
  issuedAt: string;
}>;

export type PrivateMeetingInvitationIssuedHistory = Readonly<{
  schemaVersion: 'private-meeting-invitation-issued-history/1';
  invitationReference: string;
  issuerSubjectReference: string;
  intendedRecipientSubjectReference: string;
  purposeReference: string;
  materials: readonly Readonly<{
    materialReference: string;
    evidenceReference: string;
  }>[];
  revision: 1;
  lifecycle: 'issued';
  issuedAt: string;
  validFrom: string;
  expiresAt: string;
  sourceReference: string;
  authorizationReference: string;
  policyRevision: number;
  grantsAccess: false;
  grantsOccupancy: false;
  grantsPermanentMembership: false;
}>;

function fail(): never {
  throw new TypeError(GENERIC_ERROR);
}

const closedRecordHandler: ProxyHandler<object> = freezeObject(Object.assign(Object.create(null), {
  get(target: object, key: string | symbol): unknown {
    const descriptor = getOwnPropertyDescriptor(target, key);
    return descriptor && 'value' in descriptor ? descriptor.value : undefined;
  },
  has(target: object, key: string | symbol): boolean {
    return getOwnPropertyDescriptor(target, key) !== undefined;
  },
}));

function closeRecord<T extends object>(value: T): T {
  return freezeObject(new ProxyConstructor(value, closedRecordHandler as ProxyHandler<T>));
}

function requireCanonicalTimestamp(value: unknown): string {
  if (typeof value !== 'string' || value.length !== 24
    || characterCodeAt(value, 4) !== 0x2d || characterCodeAt(value, 7) !== 0x2d
    || characterCodeAt(value, 10) !== 0x54 || characterCodeAt(value, 13) !== 0x3a
    || characterCodeAt(value, 16) !== 0x3a || characterCodeAt(value, 19) !== 0x2e
    || characterCodeAt(value, 23) !== 0x5a) fail();
  for (let index = 0; index < value.length; index += 1) {
    if (index === 4 || index === 7 || index === 10 || index === 13
      || index === 16 || index === 19 || index === 23) continue;
    const code = characterCodeAt(value, index);
    if (code < 0x30 || code > 0x39) fail();
  }
  const parsed = parseTimestamp(value);
  if (!isFiniteNumber(parsed)
    || timestampToISOString(new DateConstructor(parsed)) !== value) fail();
  return value;
}

function requireOpaqueReference(value: unknown): string {
  if (typeof value !== 'string' || value.length < 19 || value.length > 67
    || characterCodeAt(value, 0) !== 0x69
    || characterCodeAt(value, 1) !== 0x64
    || characterCodeAt(value, 2) !== 0x5f) fail();
  for (let index = 3; index < value.length; index += 1) {
    const code = characterCodeAt(value, index);
    if (!((code >= 0x30 && code <= 0x39) || (code >= 0x61 && code <= 0x66))) fail();
  }
  return value;
}

function requirePolicyRevision(value: unknown): number {
  if (!isSafeInteger(value) || (value as number) <= 0 || isSameValue(value, -0)) fail();
  return value as number;
}

function copyMaterials(readiness: MeetingInvitationReadiness): readonly Readonly<{
  materialReference: string;
  evidenceReference: string;
}>[] {
  const materials: { materialReference: string; evidenceReference: string }[] = [];
  for (let index = 0; index < readiness.materials.length; index += 1) {
    const material = readiness.materials[index];
    materials[materials.length] = closeRecord({
      materialReference: material.materialReference,
      evidenceReference: material.evidenceReference,
    });
  }
  setPrototypeOf(materials, getPrototypeOf(readiness.materials));
  return freezeObject(materials);
}

function sameMaterials(
  readiness: MeetingInvitationReadiness,
  materials: readonly Readonly<{ materialReference: string; evidenceReference: string }>[],
): boolean {
  if (readiness.materials.length !== materials.length) return false;
  for (let index = 0; index < materials.length; index += 1) {
    if (readiness.materials[index].materialReference !== materials[index].materialReference
      || readiness.materials[index].evidenceReference !== materials[index].evidenceReference) return false;
  }
  return true;
}

function requireDistinctReferences(
  readiness: MeetingInvitationReadiness,
  sourceReference: string,
  authorizationReference: string,
): void {
  const references = [
    readiness.invitationReference,
    readiness.issuer.subjectReference,
    readiness.issuer.issuanceAuthorizationReference,
    readiness.recipient.subjectReference,
    readiness.recipient.participationAuthorizationReference,
    readiness.purpose.purposeReference,
    readiness.revocation.revocationAuthorityReference,
    sourceReference,
    authorizationReference,
  ];
  for (let index = 0; index < readiness.materials.length; index += 1) {
    references[references.length] = readiness.materials[index].materialReference;
    references[references.length] = readiness.materials[index].evidenceReference;
  }
  for (let left = 0; left < references.length; left += 1) {
    for (let right = left + 1; right < references.length; right += 1) {
      if (references[left] === references[right]) fail();
    }
  }
}

export function issuePrivateMeetingInvitation(
  readinessDocument: unknown,
  issuanceEvent: unknown,
): PrivateMeetingInvitationIssuedHistory {
  try {
    if (!hasWeakSetValue(genuineIssuanceEvents, issuanceEvent)) fail();
    const readiness = validateMeetingInvitationReadiness(readinessDocument);
    if (readiness === null) fail();
    const event = issuanceEvent as PrivateMeetingInvitationIssuanceEvent;
    if (event.schemaVersion !== 'private-meeting-invitation-issuance/1'
      || event.readinessSchemaVersion !== readiness.schemaVersion
      || event.invitationReference !== readiness.invitationReference
      || event.issuerSubjectReference !== readiness.issuer.subjectReference
      || event.intendedRecipientSubjectReference !== readiness.recipient.subjectReference
      || event.purposeReference !== readiness.purpose.purposeReference
      || !sameMaterials(readiness, event.materials)
      || event.validFrom !== readiness.validity.validFrom
      || event.expiresAt !== readiness.validity.expiresAt
      || event.revocationAuthorityReference !== readiness.revocation.revocationAuthorityReference) fail();
    return closeRecord({
      schemaVersion: 'private-meeting-invitation-issued-history/1',
      invitationReference: event.invitationReference,
      issuerSubjectReference: event.issuerSubjectReference,
      intendedRecipientSubjectReference: event.intendedRecipientSubjectReference,
      purposeReference: event.purposeReference,
      materials: copyMaterials(readiness),
      revision: 1,
      lifecycle: 'issued',
      issuedAt: event.issuedAt,
      validFrom: event.validFrom,
      expiresAt: event.expiresAt,
      sourceReference: event.sourceReference,
      authorizationReference: event.authorizationReference,
      policyRevision: event.policyRevision,
      grantsAccess: false,
      grantsOccupancy: false,
      grantsPermanentMembership: false,
    });
  } catch {
    throw new TypeError(GENERIC_ERROR);
  }
}

export function createPrivateMeetingInvitationIssuanceEvent(
  readinessDocument: unknown,
  sourceReferenceInput: string,
  authorizationReferenceInput: string,
  policyRevisionInput: number,
  issuedAtInput: string,
): PrivateMeetingInvitationIssuanceEvent {
  try {
    const readiness = validateMeetingInvitationReadiness(readinessDocument);
    if (readiness === null) fail();
    const sourceReference = requireOpaqueReference(sourceReferenceInput);
    const authorizationReference = requireOpaqueReference(authorizationReferenceInput);
    const policyRevision = requirePolicyRevision(policyRevisionInput);
    const issuedAt = requireCanonicalTimestamp(issuedAtInput);
    requireDistinctReferences(readiness, sourceReference, authorizationReference);
    if (parseTimestamp(issuedAt) < parseTimestamp(readiness.validity.preparedAt)
      || parseTimestamp(issuedAt) >= parseTimestamp(readiness.validity.validFrom)
      || parseTimestamp(issuedAt) >= parseTimestamp(readiness.validity.expiresAt)) fail();
    const event = closeRecord({
      schemaVersion: 'private-meeting-invitation-issuance/1' as const,
      readinessSchemaVersion: readiness.schemaVersion,
      invitationReference: readiness.invitationReference,
      issuerSubjectReference: readiness.issuer.subjectReference,
      intendedRecipientSubjectReference: readiness.recipient.subjectReference,
      purposeReference: readiness.purpose.purposeReference,
      materials: copyMaterials(readiness),
      validFrom: readiness.validity.validFrom,
      expiresAt: readiness.validity.expiresAt,
      revocationAuthorityReference: readiness.revocation.revocationAuthorityReference,
      sourceReference,
      authorizationReference,
      policyRevision,
      issuedAt,
    });
    addWeakSetValue(genuineIssuanceEvents, event);
    return event;
  } catch {
    throw new TypeError(GENERIC_ERROR);
  }
}
