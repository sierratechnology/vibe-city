import { validateMeetingInvitationReadiness } from './meetingInvitation\u0052eadiness';
import { acceptPrivateMeetingInvitation } from './privateMeetingInvitation\u0041cceptance';
import { freezePrivateMeetingInvitationObject } from './privateMeetingInvitation\u0049ssuance';
import { decidePrivateMeetingTemporaryAccess } from './privateMeetingTemporary\u0041ccess';
import {
  requirePrivateMeetingSessionEndEvent,
  requirePrivateMeetingSessionEndProvenance,
  type PrivateMeetingSessionEndEvent,
} from './privateMeetingSession\u0045nd';

export type PrivateMeetingNoDecisionOutcomeEvent = Readonly<{
  schemaVersion: 'private-meeting-outcome/1';
  tenantId: string;
  meetingId: string;
  sessionId: string;
  invitationId: string;
  subjectId: string;
  purposeReference: string;
  materials: readonly Readonly<{
    materialReference: string;
    evidenceReference: string;
  }>[];
  endedAt: string;
  recordedAt: string;
  sourceEventId: string;
  outcomeAuthorityReference: string;
  outcome: 'no_decision';
}>;

type NoDecisionCommand = Readonly<{
  sourceEventId: string;
  outcomeAuthorityReference: string;
  recordedAt: string;
}>;

const GENERIC_ERROR = 'Invalid private meeting outcome input';
const defineProperty: typeof Object.defineProperty = Object.defineProperty;
const setPrototypeOf: typeof Object.setPrototypeOf = Object.setPrototypeOf;
type RecordedEndNode = Readonly<{
  event: PrivateMeetingSessionEndEvent;
  next: RecordedEndNode | null;
}>;
let recordedEnds: RecordedEndNode | null = null;

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
    return character === '0' ? 0 : character === '1' ? 1 : character === '2' ? 2
      : character === '3' ? 3 : character === '4' ? 4 : character === '5' ? 5
        : character === '6' ? 6 : character === '7' ? 7 : character === '8' ? 8 : 9;
  };
  const numberAt = (start: number, length: number): number => {
    let result = 0;
    for (let index = start; index < start + length; index += 1) result = result * 10 + digit(index);
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

function closed<T extends object>(properties: T): T {
  return freezePrivateMeetingInvitationObject({ __proto__: null, ...properties }) as T;
}

class CommandBase {
  constructor(value: object) { return value as CommandBase; }
}

class GenuineNoDecisionCommand extends CommandBase {
  #genuine = true;

  constructor(command: NoDecisionCommand) { super(closed(command)); }

  static isGenuine(value: unknown): boolean {
    try { return (value as GenuineNoDecisionCommand).#genuine; } catch { return false; }
  }
}

function copyMaterials(materials: readonly Readonly<{
  materialReference: string;
  evidenceReference: string;
}>[]): readonly Readonly<{ materialReference: string; evidenceReference: string }>[] {
  const copied: { materialReference: string; evidenceReference: string }[] = [];
  for (let index = 0; index < materials.length; index += 1) {
    defineProperty(copied, index, {
      configurable: true,
      enumerable: true,
      writable: true,
      value: closed({
        materialReference: materials[index].materialReference,
        evidenceReference: materials[index].evidenceReference,
      }),
    });
  }
  setPrototypeOf(copied, null);
  return freezePrivateMeetingInvitationObject(copied);
}

export function createPrivateMeetingNoDecisionCommand(
  sourceEventIdInput: unknown,
  outcomeAuthorityReferenceInput: unknown,
  recordedAtInput: unknown,
): NoDecisionCommand {
  try {
    const sourceEventId = requireOpaqueId(sourceEventIdInput);
    const outcomeAuthorityReference = requireOpaqueId(outcomeAuthorityReferenceInput);
    const recordedAt = requireTimestamp(recordedAtInput);
    if (sourceEventId === outcomeAuthorityReference) fail();
    return new GenuineNoDecisionCommand({
      sourceEventId, outcomeAuthorityReference, recordedAt,
    }) as unknown as NoDecisionCommand;
  } catch {
    throw new TypeError(GENERIC_ERROR);
  }
}

export function createPrivateMeetingNoDecisionOutcomeEvent(
  readinessDocument: unknown,
  issuanceEvent: unknown,
  acceptanceEvent: unknown,
  policyObservation: unknown,
  endEventInput: unknown,
  commandInput: unknown,
): PrivateMeetingNoDecisionOutcomeEvent {
  try {
    const endEvent: PrivateMeetingSessionEndEvent
      = requirePrivateMeetingSessionEndEvent(endEventInput);
    const startSourceEventId = requirePrivateMeetingSessionEndProvenance(
      endEvent, readinessDocument, issuanceEvent, acceptanceEvent, policyObservation,
    );
    for (let node = recordedEnds; node !== null; node = node.next) {
      if (node.event === endEvent) fail();
    }
    const access = decidePrivateMeetingTemporaryAccess(
      readinessDocument, issuanceEvent, acceptanceEvent, policyObservation,
    );
    if (access.status !== 'granted' || !GenuineNoDecisionCommand.isGenuine(commandInput)) fail();
    const accepted = acceptPrivateMeetingInvitation(
      readinessDocument, issuanceEvent, acceptanceEvent,
    );
    const readiness = validateMeetingInvitationReadiness(readinessDocument);
    if (readiness === null) fail();
    const command = commandInput as NoDecisionCommand;
    if (endEvent.tenantId !== access.tenantId
      || endEvent.meetingId !== access.meetingId
      || endEvent.invitationId !== access.invitationId
      || endEvent.subjectId !== access.subjectId
      || endEvent.policyRevision !== access.policyRevision
      || accepted.invitationReference !== endEvent.invitationId
      || accepted.intendedRecipientSubjectReference !== endEvent.subjectId
      || command.outcomeAuthorityReference
        !== accepted.acceptanceAuthorizationReference
      || command.recordedAt < endEvent.endedAt
      || command.recordedAt > access.expiresAt) fail();
    const protectedIdentities = [
      endEvent.tenantId, endEvent.meetingId, endEvent.sessionId,
      accepted.invitationReference, accepted.issuerSubjectReference,
      accepted.intendedRecipientSubjectReference, accepted.purposeReference,
      accepted.issuanceSourceReference, accepted.issuanceAuthorizationReference,
      accepted.acceptanceSourceReference, accepted.acceptanceAuthorizationReference,
      readiness.issuer.issuanceAuthorizationReference,
      readiness.recipient.participationAuthorizationReference,
      readiness.revocation.revocationAuthorityReference,
      startSourceEventId,
      endEvent.sourceEventId,
    ];
    for (let index = 0; index < accepted.materials.length; index += 1) {
      const material = accepted.materials[index];
      if (command.sourceEventId === material.materialReference
        || command.sourceEventId === material.evidenceReference) fail();
    }
    for (let index = 0; index < protectedIdentities.length; index += 1) {
      if (command.sourceEventId === protectedIdentities[index]) fail();
    }
    const event = closed({
      schemaVersion: 'private-meeting-outcome/1' as const,
      tenantId: endEvent.tenantId,
      meetingId: endEvent.meetingId,
      sessionId: endEvent.sessionId,
      invitationId: endEvent.invitationId,
      subjectId: endEvent.subjectId,
      purposeReference: accepted.purposeReference,
      materials: copyMaterials(accepted.materials),
      endedAt: endEvent.endedAt,
      recordedAt: command.recordedAt,
      sourceEventId: command.sourceEventId,
      outcomeAuthorityReference: command.outcomeAuthorityReference,
      outcome: 'no_decision' as const,
    });
    recordedEnds = { event: endEvent, next: recordedEnds };
    return event;
  } catch {
    throw new TypeError(GENERIC_ERROR);
  }
}
