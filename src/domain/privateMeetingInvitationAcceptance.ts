import { validateMeetingInvitationReadiness } from './meetingInvitation\u0052eadiness';
import {
  freezePrivateMeetingInvitationArray,
  freezePrivateMeetingInvitationObject,
  hardenPrivateMeetingInvitationRecord,
  issuePrivateMeetingInvitation,
  type PrivateMeetingInvitationIssuanceEvent,
} from './privateMeetingInvitation\u0049ssuance';

const GENERIC_ERROR = 'Invalid private meeting invitation acceptance input';
const DateConstructor = Date;
const parseTimestamp: (value: string) => number = Date.parse;
const timestampToISOString = Date.prototype.toISOString.call.bind(
  Date.prototype.toISOString,
) as (value: Date) => string;
const characterCodeAt = String.prototype.charCodeAt.call.bind(
  String.prototype.charCodeAt,
) as (value: string, index: number) => number;
const isFiniteNumber: (value: unknown) => boolean = Number.isFinite;
const isSafeInteger: (value: unknown) => boolean = Number.isSafeInteger;
const isSameValue: (left: unknown, right: unknown) => boolean = Object.is;
const WeakMapConstructor = WeakMap;
const setWeakMapValue = WeakMap.prototype.set.call.bind(WeakMap.prototype.set) as (
  map: WeakMap<object, AcceptanceBinding>,
  key: object,
  value: AcceptanceBinding,
) => WeakMap<object, AcceptanceBinding>;
const getWeakMapValue = WeakMap.prototype.get.call.bind(WeakMap.prototype.get) as (
  map: WeakMap<object, AcceptanceBinding>,
  key: unknown,
) => AcceptanceBinding | undefined;

export type PrivateMeetingInvitationAcceptanceEvent = Readonly<{
  schemaVersion: 'private-meeting-invitation-acceptance/1';
  invitationReference: string;
  acceptingSubjectReference: string;
  sourceReference: string;
  authorizationReference: string;
  policyRevision: number;
  acceptedAt: string;
}>;

export type PrivateMeetingInvitationAcceptedHistory = Readonly<{
  schemaVersion: 'private-meeting-invitation-accepted-history/1';
  invitationReference: string;
  issuerSubjectReference: string;
  intendedRecipientSubjectReference: string;
  purposeReference: string;
  materials: readonly Readonly<{
    materialReference: string;
    evidenceReference: string;
  }>[];
  revision: 2;
  lifecycle: 'accepted';
  issuedAt: string;
  validFrom: string;
  expiresAt: string;
  acceptedAt: string;
  issuanceSourceReference: string;
  issuanceAuthorizationReference: string;
  issuancePolicyRevision: number;
  acceptanceSourceReference: string;
  acceptanceAuthorizationReference: string;
  acceptancePolicyRevision: number;
  grantsAccess: false;
  grantsOccupancy: false;
  grantsMembership: false;
  grantsAttendance: false;
  grantsSession: false;
}>;

type AcceptanceBinding = Readonly<{
  issuanceEvent: PrivateMeetingInvitationIssuanceEvent;
  readinessDocument: string;
}>;

const genuineAcceptanceEvents = new WeakMapConstructor<object, AcceptanceBinding>();

function fail(): never {
  throw new TypeError(GENERIC_ERROR);
}

function requireCanonicalTimestamp(value: string): string {
  if (value.length !== 24
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

function requireOpaqueReference(value: string): string {
  if (value.length < 19 || value.length > 67
    || characterCodeAt(value, 0) !== 0x69
    || characterCodeAt(value, 1) !== 0x64
    || characterCodeAt(value, 2) !== 0x5f) fail();
  for (let index = 3; index < value.length; index += 1) {
    const code = characterCodeAt(value, index);
    if (!((code >= 0x30 && code <= 0x39) || (code >= 0x61 && code <= 0x66))) fail();
  }
  return value;
}

function closeRecord<T extends object>(value: T): T {
  return hardenPrivateMeetingInvitationRecord(value);
}

function copyMaterials(materials: readonly Readonly<{
  materialReference: string;
  evidenceReference: string;
}>[]): readonly Readonly<{ materialReference: string; evidenceReference: string }>[] {
  const copied: { materialReference: string; evidenceReference: string }[] = [];
  for (let index = 0; index < materials.length; index += 1) {
    copied[copied.length] = closeRecord({
      materialReference: materials[index].materialReference,
      evidenceReference: materials[index].evidenceReference,
    });
  }
  return freezePrivateMeetingInvitationArray(copied, materials);
}

export function createPrivateMeetingInvitationAcceptanceEvent(
  readinessDocument: unknown,
  issuanceEvent: unknown,
  acceptingSubjectReference: string,
  sourceReference: string,
  authorizationReference: string,
  policyRevision: number,
  acceptedAt: string,
): PrivateMeetingInvitationAcceptanceEvent {
  try {
    const issued = issuePrivateMeetingInvitation(readinessDocument, issuanceEvent);
    const readiness = validateMeetingInvitationReadiness(readinessDocument);
    if (readiness === null) fail();
    if (typeof acceptingSubjectReference !== 'string'
      || acceptingSubjectReference !== issued.intendedRecipientSubjectReference
      || typeof sourceReference !== 'string'
      || typeof authorizationReference !== 'string'
      || typeof policyRevision !== 'number'
      || typeof acceptedAt !== 'string') fail();
    requireOpaqueReference(sourceReference);
    requireOpaqueReference(authorizationReference);
    if (!isSafeInteger(policyRevision) || policyRevision <= 0
      || isSameValue(policyRevision, -0)) fail();
    const protectedReferences = [
      readiness.invitationReference,
      readiness.issuer.subjectReference,
      readiness.issuer.issuanceAuthorizationReference,
      readiness.recipient.subjectReference,
      readiness.recipient.participationAuthorizationReference,
      readiness.purpose.purposeReference,
      readiness.revocation.revocationAuthorityReference,
      issued.sourceReference,
      issued.authorizationReference,
      sourceReference,
      authorizationReference,
    ];
    for (let index = 0; index < readiness.materials.length; index += 1) {
      protectedReferences[protectedReferences.length] = readiness.materials[index].materialReference;
      protectedReferences[protectedReferences.length] = readiness.materials[index].evidenceReference;
    }
    for (let left = 0; left < protectedReferences.length; left += 1) {
      for (let right = left + 1; right < protectedReferences.length; right += 1) {
        if (protectedReferences[left] === protectedReferences[right]) fail();
      }
    }
    requireCanonicalTimestamp(acceptedAt);
    if (parseTimestamp(acceptedAt) < parseTimestamp(issued.issuedAt)
      || parseTimestamp(acceptedAt) < parseTimestamp(issued.validFrom)
      || parseTimestamp(acceptedAt) >= parseTimestamp(issued.expiresAt)) fail();
    const event = closeRecord({
      schemaVersion: 'private-meeting-invitation-acceptance/1' as const,
      invitationReference: issued.invitationReference,
      acceptingSubjectReference,
      sourceReference,
      authorizationReference,
      policyRevision,
      acceptedAt,
    });
    setWeakMapValue(genuineAcceptanceEvents, event, freezePrivateMeetingInvitationObject({
      issuanceEvent: issuanceEvent as PrivateMeetingInvitationIssuanceEvent,
      readinessDocument: readinessDocument as string,
    }));
    return event;
  } catch {
    throw new TypeError(GENERIC_ERROR);
  }
}

export function acceptPrivateMeetingInvitation(
  readinessDocument: unknown,
  issuanceEvent: unknown,
  acceptanceEvent: unknown,
): PrivateMeetingInvitationAcceptedHistory {
  try {
    const binding = getWeakMapValue(genuineAcceptanceEvents, acceptanceEvent);
    if (binding === undefined || binding.issuanceEvent !== issuanceEvent
      || binding.readinessDocument !== readinessDocument) fail();
    const readiness = validateMeetingInvitationReadiness(readinessDocument);
    if (readiness === null) fail();
    const issued = issuePrivateMeetingInvitation(readinessDocument, issuanceEvent);
    const event = acceptanceEvent as PrivateMeetingInvitationAcceptanceEvent;
    return closeRecord({
      schemaVersion: 'private-meeting-invitation-accepted-history/1',
      invitationReference: issued.invitationReference,
      issuerSubjectReference: issued.issuerSubjectReference,
      intendedRecipientSubjectReference: issued.intendedRecipientSubjectReference,
      purposeReference: issued.purposeReference,
      materials: copyMaterials(readiness.materials),
      revision: 2,
      lifecycle: 'accepted',
      issuedAt: issued.issuedAt,
      validFrom: issued.validFrom,
      expiresAt: issued.expiresAt,
      acceptedAt: event.acceptedAt,
      issuanceSourceReference: issued.sourceReference,
      issuanceAuthorizationReference: issued.authorizationReference,
      issuancePolicyRevision: issued.policyRevision,
      acceptanceSourceReference: event.sourceReference,
      acceptanceAuthorizationReference: event.authorizationReference,
      acceptancePolicyRevision: event.policyRevision,
      grantsAccess: false,
      grantsOccupancy: false,
      grantsMembership: false,
      grantsAttendance: false,
      grantsSession: false,
    });
  } catch {
    throw new TypeError(GENERIC_ERROR);
  }
}
