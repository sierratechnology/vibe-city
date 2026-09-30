import {
  acceptPrivateMeetingInvitation,
  type PrivateMeetingInvitationAcceptanceEvent,
  type PrivateMeetingInvitationAcceptedHistory,
} from './privateMeetingInvitation\u0041cceptance';
import {
  createPrivateMeetingInvitationSanitizedArrayPrototypeSource,
  freezePrivateMeetingInvitationArray,
  freezePrivateMeetingInvitationObject,
  hardenPrivateMeetingInvitationRecord,
  type PrivateMeetingInvitationIssuanceEvent,
} from './privateMeetingInvitation\u0049ssuance';
import { validateMeetingInvitationReadiness } from './meetingInvitation\u0052eadiness';

const GENERIC_ERROR = 'Invalid private meeting invitation revocation input';
const sanitizedArrayPrototypeSource =
  createPrivateMeetingInvitationSanitizedArrayPrototypeSource();

type RevocationBinding = Readonly<{
  readinessDocument: string;
  issuanceEvent: PrivateMeetingInvitationIssuanceEvent;
  acceptanceEvent: PrivateMeetingInvitationAcceptanceEvent;
  accepted: PrivateMeetingInvitationAcceptedHistory;
}>;

export type PrivateMeetingInvitationRevocationEvent = Readonly<{
  schemaVersion: 'private-meeting-invitation-revocation/1';
  invitationReference: string;
  revocationAuthorityReference: string;
  sourceReference: string;
  authorizationReference: string;
  policyRevision: number;
  revokedAt: string;
}>;

class RevocationEventBase {
  constructor(value: object) {
    return value as RevocationEventBase;
  }
}

class GenuineRevocationEvent extends RevocationEventBase {
  #binding: RevocationBinding | undefined;

  constructor(event: PrivateMeetingInvitationRevocationEvent, binding: RevocationBinding) {
    super(hardenPrivateMeetingInvitationRecord(event));
    this.#binding = binding;
  }

  static binding(event: unknown): RevocationBinding | undefined {
    try {
      return (event as GenuineRevocationEvent).#binding;
    } catch {
      return undefined;
    }
  }

  static consume(event: unknown, binding: RevocationBinding): boolean {
    try {
      const genuineEvent = event as GenuineRevocationEvent;
      if (genuineEvent.#binding !== binding) return false;
      genuineEvent.#binding = undefined;
      return true;
    } catch {
      return false;
    }
  }
}

export const privateMeetingInvitationRevocationProvenance =
  freezePrivateMeetingInvitationObject({
    lookup: 'private-field-constant-time' as const,
    retention: 'event-owned' as const,
    consumption: 'single-use' as const,
  });

export type PrivateMeetingInvitationRevokedHistory = Readonly<{
  schemaVersion: 'private-meeting-invitation-revoked-history/1';
  invitationReference: string;
  issuerSubjectReference: string;
  intendedRecipientSubjectReference: string;
  purposeReference: string;
  materials: readonly Readonly<{
    materialReference: string;
    evidenceReference: string;
  }>[];
  revision: 3;
  lifecycle: 'revoked';
  issuedAt: string;
  validFrom: string;
  expiresAt: string;
  acceptedAt: string;
  revokedAt: string;
  issuanceSourceReference: string;
  issuanceAuthorizationReference: string;
  issuancePolicyRevision: number;
  acceptanceSourceReference: string;
  acceptanceAuthorizationReference: string;
  acceptancePolicyRevision: number;
  revocationSourceReference: string;
  revocationAuthorizationReference: string;
  revocationPolicyRevision: number;
  grantsAccess: false;
  grantsTemporaryAccess: false;
  grantsPermanentMembership: false;
  grantsOccupancy: false;
  grantsAttendance: false;
  grantsSession: false;
  grantsParticipantPresence: false;
  assertsMeetingExists: false;
  assertsWorkState: false;
  grantsSpending: false;
  grantsCommunication: false;
  grantsProviderAccess: false;
  grantsProtectedRelease: false;
}>;

function fail(): never {
  try {
    return (undefined as unknown as { unreachable: never }).unreachable;
  } catch (error) {
    (error as { message: string }).message = GENERIC_ERROR;
    throw error;
  }
}

function isDecimalDigit(value: string): boolean {
  return value === '0' || value === '1' || value === '2' || value === '3'
    || value === '4' || value === '5' || value === '6' || value === '7'
    || value === '8' || value === '9';
}

function decimalDigitValue(value: string): number {
  if (value === '0') return 0;
  if (value === '1') return 1;
  if (value === '2') return 2;
  if (value === '3') return 3;
  if (value === '4') return 4;
  if (value === '5') return 5;
  if (value === '6') return 6;
  if (value === '7') return 7;
  if (value === '8') return 8;
  if (value === '9') return 9;
  fail();
}

function requireOpaqueReference(value: unknown): string {
  if (typeof value !== 'string' || value.length < 19 || value.length > 67
    || value[0] !== 'i' || value[1] !== 'd' || value[2] !== '_') fail();
  for (let index = 3; index < value.length; index += 1) {
    const character = value[index];
    if (!(isDecimalDigit(character) || character === 'a' || character === 'b' || character === 'c'
      || character === 'd' || character === 'e' || character === 'f')) fail();
  }
  return value;
}

function requireCanonicalTimestamp(value: unknown): string {
  if (typeof value !== 'string' || value.length !== 24
    || value[4] !== '-' || value[7] !== '-' || value[10] !== 'T'
    || value[13] !== ':' || value[16] !== ':' || value[19] !== '.'
    || value[23] !== 'Z') fail();
  for (let index = 0; index < value.length; index += 1) {
    if (index === 4 || index === 7 || index === 10 || index === 13
      || index === 16 || index === 19 || index === 23) continue;
    decimalDigitValue(value[index]);
  }
  const numberAt = (start: number, length: number): number => {
    let result = 0;
    for (let index = start; index < start + length; index += 1) {
      result = result * 10 + decimalDigitValue(value[index]);
    }
    return result;
  };
  const year = numberAt(0, 4);
  const month = numberAt(5, 2);
  const day = numberAt(8, 2);
  const hour = numberAt(11, 2);
  const minute = numberAt(14, 2);
  const second = numberAt(17, 2);
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (month < 1 || month > 12 || day < 1 || day > days[month - 1]
    || hour > 23 || minute > 59 || second > 59) fail();
  return value;
}

function copyMaterials(materials: PrivateMeetingInvitationAcceptedHistory['materials']) {
  const copied: { materialReference: string; evidenceReference: string }[] = [];
  for (let index = 0; index < materials.length; index += 1) {
    copied[copied.length] = hardenPrivateMeetingInvitationRecord({
      materialReference: materials[index].materialReference,
      evidenceReference: materials[index].evidenceReference,
    });
  }
  return freezePrivateMeetingInvitationArray(copied, sanitizedArrayPrototypeSource);
}

export function createPrivateMeetingInvitationRevocationEvent(
  readinessDocument: unknown,
  issuanceEvent: unknown,
  acceptanceEvent: unknown,
  revocationAuthorityReference: string,
  sourceReference: string,
  authorizationReference: string,
  policyRevision: number,
  revokedAt: string,
): PrivateMeetingInvitationRevocationEvent {
  try {
    const readiness = validateMeetingInvitationReadiness(readinessDocument);
    if (readiness === null) fail();
    const accepted = acceptPrivateMeetingInvitation(
      readinessDocument,
      issuanceEvent,
      acceptanceEvent,
    );
    const issuance = issuanceEvent as PrivateMeetingInvitationIssuanceEvent;
    if (typeof revocationAuthorityReference !== 'string'
      || revocationAuthorityReference !== issuance.revocationAuthorityReference
      || revocationAuthorityReference !== readiness.revocation.revocationAuthorityReference) fail();
    requireOpaqueReference(sourceReference);
    requireOpaqueReference(authorizationReference);
    if (typeof policyRevision !== 'number' || policyRevision <= 0
      || policyRevision > 9007199254740991 || policyRevision % 1 !== 0
      || (policyRevision === 0 && 1 / policyRevision < 0)) fail();
    const protectedReferences = [
      readiness.invitationReference,
      readiness.issuer.subjectReference,
      readiness.issuer.issuanceAuthorizationReference,
      readiness.recipient.subjectReference,
      readiness.recipient.participationAuthorizationReference,
      readiness.purpose.purposeReference,
      readiness.revocation.revocationAuthorityReference,
      accepted.issuanceSourceReference,
      accepted.issuanceAuthorizationReference,
      accepted.acceptanceSourceReference,
      accepted.acceptanceAuthorizationReference,
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
    requireCanonicalTimestamp(revokedAt);
    if (revokedAt < accepted.acceptedAt || revokedAt >= accepted.expiresAt) fail();
    const binding = freezePrivateMeetingInvitationObject({
      readinessDocument: readinessDocument as string,
      issuanceEvent: issuanceEvent as PrivateMeetingInvitationIssuanceEvent,
      acceptanceEvent: acceptanceEvent as PrivateMeetingInvitationAcceptanceEvent,
      accepted,
    });
    return new GenuineRevocationEvent({
      schemaVersion: 'private-meeting-invitation-revocation/1' as const,
      invitationReference: accepted.invitationReference,
      revocationAuthorityReference,
      sourceReference,
      authorizationReference,
      policyRevision,
      revokedAt,
    }, binding) as unknown as PrivateMeetingInvitationRevocationEvent;
  } catch {
    fail();
  }
}

export function revokePrivateMeetingInvitation(
  readinessDocument: unknown,
  issuanceEvent: unknown,
  acceptanceEvent: unknown,
  revocationEvent: unknown,
): PrivateMeetingInvitationRevokedHistory {
  try {
    const binding = GenuineRevocationEvent.binding(revocationEvent);
    if (binding === undefined || binding.readinessDocument !== readinessDocument
      || binding.issuanceEvent !== issuanceEvent
      || binding.acceptanceEvent !== acceptanceEvent) fail();
    const accepted = acceptPrivateMeetingInvitation(
      readinessDocument,
      issuanceEvent,
      acceptanceEvent,
    );
    const event = revocationEvent as PrivateMeetingInvitationRevocationEvent;
    const revoked: PrivateMeetingInvitationRevokedHistory = hardenPrivateMeetingInvitationRecord({
      schemaVersion: 'private-meeting-invitation-revoked-history/1' as const,
      invitationReference: accepted.invitationReference,
      issuerSubjectReference: accepted.issuerSubjectReference,
      intendedRecipientSubjectReference: accepted.intendedRecipientSubjectReference,
      purposeReference: accepted.purposeReference,
      materials: copyMaterials(accepted.materials),
      revision: 3 as const,
      lifecycle: 'revoked' as const,
      issuedAt: accepted.issuedAt,
      validFrom: accepted.validFrom,
      expiresAt: accepted.expiresAt,
      acceptedAt: accepted.acceptedAt,
      revokedAt: event.revokedAt,
      issuanceSourceReference: accepted.issuanceSourceReference,
      issuanceAuthorizationReference: accepted.issuanceAuthorizationReference,
      issuancePolicyRevision: accepted.issuancePolicyRevision,
      acceptanceSourceReference: accepted.acceptanceSourceReference,
      acceptanceAuthorizationReference: accepted.acceptanceAuthorizationReference,
      acceptancePolicyRevision: accepted.acceptancePolicyRevision,
      revocationSourceReference: event.sourceReference,
      revocationAuthorizationReference: event.authorizationReference,
      revocationPolicyRevision: event.policyRevision,
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
    });
    if (!GenuineRevocationEvent.consume(event, binding)) fail();
    return revoked;
  } catch {
    fail();
  }
}
