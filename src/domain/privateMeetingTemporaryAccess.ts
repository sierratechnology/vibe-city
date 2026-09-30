import {
  acceptPrivateMeetingInvitation,
  type PrivateMeetingInvitationAcceptanceEvent,
} from './privateMeetingInvitation\u0041cceptance';
import {
  freezePrivateMeetingInvitationObject,
  type PrivateMeetingInvitationIssuanceEvent,
} from './privateMeetingInvitation\u0049ssuance';

export type PrivateMeetingTemporaryAccessPolicyObservation = Readonly<{
  tenantId: string;
  meetingId: string;
  invitationId: string;
  inviterId: string;
  inviteeId: string;
  policyRevision: number;
  status: 'active' | 'revoked' | 'expired' | 'unavailable';
  reason: 'policy_current' | 'policy_inactive';
  evaluatedAt: string;
}>;

export type PrivateMeetingTemporaryAccessDecision = Readonly<{
  tenantId: string;
  meetingId: string;
  invitationId: string;
  subjectId: string;
  scope: 'meeting_session_entry';
  grantedAt: string;
  evaluatedAt: string;
  expiresAt: string;
  policyRevision: number;
  status: 'granted';
  reason: 'invitation_temporary_access';
}>;

export type PrivateMeetingTemporaryAccessUnavailable = Readonly<{
  status: 'unavailable';
  reason: 'temporary_access_unavailable';
}>;

type Binding = Readonly<{
  readinessDocument: string;
  issuanceEvent: PrivateMeetingInvitationIssuanceEvent;
  acceptanceEvent: PrivateMeetingInvitationAcceptanceEvent;
}>;

function closed<T extends object>(properties: T): T {
  return freezePrivateMeetingInvitationObject({ __proto__: null, ...properties }) as T;
}

class PolicyObservationBase {
  constructor(value: object) {
    return value as PolicyObservationBase;
  }
}

class GenuinePolicyObservation extends PolicyObservationBase {
  #binding: Binding;

  constructor(observation: PrivateMeetingTemporaryAccessPolicyObservation, binding: Binding) {
    super(closed(observation));
    this.#binding = freezePrivateMeetingInvitationObject(binding);
  }

  static binding(observation: unknown): Binding | undefined {
    try {
      return (observation as GenuinePolicyObservation).#binding;
    } catch {
      return undefined;
    }
  }
}

const GENERIC_ERROR = 'Invalid private meeting temporary access input';

function fail(): never { throw new TypeError(GENERIC_ERROR); }

function requireOpaqueId(value: unknown): string {
  if (typeof value !== 'string' || value.length < 19 || value.length > 67
    || value[0] !== 'i' || value[1] !== 'd' || value[2] !== '_') fail();
  for (let index = 3; index < value.length; index += 1) {
    const character = value[index];
    if (!((character >= '0' && character <= '9')
      || (character >= 'a' && character <= 'f'))) fail();
  }
  return value;
}

function requireTimestamp(value: unknown): string {
  if (typeof value !== 'string' || value.length !== 24
    || value[4] !== '-' || value[7] !== '-' || value[10] !== 'T'
    || value[13] !== ':' || value[16] !== ':' || value[19] !== '.'
    || value[23] !== 'Z') fail();
  const digit = (index: number): number => {
    const character = value[index];
    if (character < '0' || character > '9') fail();
    if (character === '0') return 0;
    if (character === '1') return 1;
    if (character === '2') return 2;
    if (character === '3') return 3;
    if (character === '4') return 4;
    if (character === '5') return 5;
    if (character === '6') return 6;
    if (character === '7') return 7;
    if (character === '8') return 8;
    return 9;
  };
  const numberAt = (start: number, length: number): number => {
    let result = 0;
    for (let index = start; index < start + length; index += 1) {
      result = result * 10 + digit(index);
    }
    return result;
  };
  for (let index = 0; index < value.length; index += 1) {
    if (index !== 4 && index !== 7 && index !== 10 && index !== 13
      && index !== 16 && index !== 19 && index !== 23) digit(index);
  }
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

function requirePolicyRevision(value: unknown): number {
  if (typeof value !== 'number' || value <= 0 || value > 9007199254740991
    || value % 1 !== 0) fail();
  return value;
}

const unavailable = closed({
  status: 'unavailable' as const,
  reason: 'temporary_access_unavailable' as const,
});

export function createPrivateMeetingTemporaryAccessPolicyObservation(
  readinessDocument: unknown,
  issuanceEvent: unknown,
  acceptanceEvent: unknown,
  tenantId: string,
  meetingId: string,
  policyRevision: number,
  status: 'active' | 'revoked' | 'expired' | 'unavailable',
  reason: 'policy_current' | 'policy_inactive',
  evaluatedAt: string,
): PrivateMeetingTemporaryAccessPolicyObservation {
  try {
    const accepted = acceptPrivateMeetingInvitation(readinessDocument, issuanceEvent, acceptanceEvent);
    requireOpaqueId(tenantId);
    requireOpaqueId(meetingId);
    if (tenantId === meetingId
      || tenantId === accepted.invitationReference
      || tenantId === accepted.issuerSubjectReference
      || tenantId === accepted.intendedRecipientSubjectReference
      || meetingId === accepted.invitationReference
      || meetingId === accepted.issuerSubjectReference
      || meetingId === accepted.intendedRecipientSubjectReference) fail();
    requirePolicyRevision(policyRevision);
    if (policyRevision !== accepted.acceptancePolicyRevision) fail();
    if ((status !== 'active' && status !== 'revoked'
      && status !== 'expired' && status !== 'unavailable')
      || (status === 'active' ? reason !== 'policy_current' : reason !== 'policy_inactive')) fail();
    requireTimestamp(evaluatedAt);
    if (evaluatedAt < accepted.acceptedAt
      || (status === 'active' && evaluatedAt >= accepted.expiresAt)
      || (status === 'expired' && evaluatedAt < accepted.expiresAt)) fail();
    const observation = new GenuinePolicyObservation({
      tenantId,
      meetingId,
      invitationId: accepted.invitationReference,
      inviterId: accepted.issuerSubjectReference,
      inviteeId: accepted.intendedRecipientSubjectReference,
      policyRevision,
      status,
      reason,
      evaluatedAt,
    }, {
      readinessDocument: readinessDocument as string,
      issuanceEvent: issuanceEvent as PrivateMeetingInvitationIssuanceEvent,
      acceptanceEvent: acceptanceEvent as PrivateMeetingInvitationAcceptanceEvent,
    });
    return observation as unknown as PrivateMeetingTemporaryAccessPolicyObservation;
  } catch {
    throw new TypeError(GENERIC_ERROR);
  }
}

export function decidePrivateMeetingTemporaryAccess(
  readinessDocument: unknown,
  issuanceEvent: unknown,
  acceptanceEvent: unknown,
  policyObservation: unknown,
): PrivateMeetingTemporaryAccessDecision | PrivateMeetingTemporaryAccessUnavailable {
  const binding = GenuinePolicyObservation.binding(policyObservation);
  if (binding === undefined
    || binding.readinessDocument !== readinessDocument
    || binding.issuanceEvent !== issuanceEvent
    || binding.acceptanceEvent !== acceptanceEvent) return unavailable;
  try {
    const accepted = acceptPrivateMeetingInvitation(readinessDocument, issuanceEvent, acceptanceEvent);
    const policy = policyObservation as PrivateMeetingTemporaryAccessPolicyObservation;
    if (policy.status !== 'active') return unavailable;
    return closed({
      tenantId: policy.tenantId,
      meetingId: policy.meetingId,
      invitationId: accepted.invitationReference,
      subjectId: accepted.intendedRecipientSubjectReference,
      scope: 'meeting_session_entry' as const,
      grantedAt: policy.evaluatedAt,
      evaluatedAt: policy.evaluatedAt,
      expiresAt: accepted.expiresAt,
      policyRevision: policy.policyRevision,
      status: 'granted' as const,
      reason: 'invitation_temporary_access' as const,
    });
  } catch {
    return unavailable;
  }
}
