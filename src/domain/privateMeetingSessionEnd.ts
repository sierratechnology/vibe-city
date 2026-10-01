import { freezePrivateMeetingInvitationObject } from './privateMeetingInvitation\u0049ssuance';
import {
  requirePrivateMeetingSessionStartEvent,
  type PrivateMeetingSessionStartEvent,
} from './privateMeetingSession\u0053tart';
import { decidePrivateMeetingTemporaryAccess } from './privateMeetingTemporary\u0041ccess';

export type PrivateMeetingSessionEndEvent = Readonly<{
  schemaVersion: 'private-meeting-session-end/1';
  tenantId: string;
  meetingId: string;
  sessionId: string;
  invitationId: string;
  subjectId: string;
  policyRevision: number;
  startedAt: string;
  endedAt: string;
  sourceEventId: string;
  lifecycleState: 'ended';
  participationState: 'left';
  reason: 'invited_temporary_access_expired_or_ended';
}>;

type EndCommand = Readonly<{
  sourceEventId: string;
  endAuthorityReference: string;
  endedAt: string;
}>;

const GENERIC_ERROR = 'Invalid private meeting session end input';
type EndedStartNode = Readonly<{
  event: PrivateMeetingSessionStartEvent;
  next: EndedStartNode | null;
}>;
let endedStarts: EndedStartNode | null = null;

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

function closed<T extends object>(properties: T): T {
  return freezePrivateMeetingInvitationObject({ __proto__: null, ...properties }) as T;
}

class EndCommandBase {
  constructor(value: object) {
    return value as EndCommandBase;
  }
}

class GenuineEndCommand extends EndCommandBase {
  #genuine = true;

  constructor(command: EndCommand) {
    super(closed(command));
  }

  static isGenuine(value: unknown): boolean {
    try {
      return (value as GenuineEndCommand).#genuine;
    } catch {
      return false;
    }
  }
}

class SessionEndEventBase {
  constructor(value: object) {
    return value as SessionEndEventBase;
  }
}

class GenuineSessionEndEvent extends SessionEndEventBase {
  #genuine = true;

  constructor(event: PrivateMeetingSessionEndEvent) {
    super(event);
  }

  static isGenuine(value: unknown): boolean {
    try {
      return (value as GenuineSessionEndEvent).#genuine;
    } catch {
      return false;
    }
  }
}

export function createPrivateMeetingSessionEndCommand(
  sourceEventIdInput: unknown,
  endAuthorityReferenceInput: unknown,
  endedAtInput: unknown,
): EndCommand {
  try {
    const sourceEventId = requireOpaqueId(sourceEventIdInput);
    const endAuthorityReference = requireOpaqueId(endAuthorityReferenceInput);
    const endedAt = requireTimestamp(endedAtInput);
    if (sourceEventId === endAuthorityReference) fail();
    return new GenuineEndCommand({
      sourceEventId, endAuthorityReference, endedAt,
    }) as unknown as EndCommand;
  } catch {
    throw new TypeError(GENERIC_ERROR);
  }
}

export function requirePrivateMeetingSessionEndEvent(
  value: unknown,
): PrivateMeetingSessionEndEvent {
  try {
    if (!GenuineSessionEndEvent.isGenuine(value)) fail();
    return value as PrivateMeetingSessionEndEvent;
  } catch {
    throw new TypeError(GENERIC_ERROR);
  }
}

export function createPrivateMeetingSessionEndEvent(
  readinessDocument: unknown,
  issuanceEvent: unknown,
  acceptanceEvent: unknown,
  policyObservation: unknown,
  startEventInput: unknown,
  commandInput: unknown,
): PrivateMeetingSessionEndEvent {
  try {
    const startEvent: PrivateMeetingSessionStartEvent
      = requirePrivateMeetingSessionStartEvent(startEventInput);
    for (let node = endedStarts; node !== null; node = node.next) {
      if (node.event === startEvent) fail();
    }
    const access = decidePrivateMeetingTemporaryAccess(
      readinessDocument, issuanceEvent, acceptanceEvent, policyObservation,
    );
    if (access.status !== 'granted') fail();
    if (!GenuineEndCommand.isGenuine(commandInput)) fail();
    const command = commandInput as EndCommand;
    if (startEvent.tenantId !== access.tenantId
      || startEvent.meetingId !== access.meetingId
      || startEvent.invitationId !== access.invitationId
      || startEvent.subjectId !== access.subjectId
      || startEvent.policyRevision !== access.policyRevision) fail();
    if (command.endAuthorityReference
      !== (acceptanceEvent as { authorizationReference?: unknown }).authorizationReference) fail();
    if (command.endedAt <= startEvent.startedAt || command.endedAt > access.expiresAt) fail();
    const identities = [
      startEvent.tenantId, startEvent.meetingId, startEvent.sessionId,
      startEvent.invitationId, startEvent.subjectId,
      (issuanceEvent as { sourceReference?: unknown }).sourceReference,
      (acceptanceEvent as { sourceReference?: unknown }).sourceReference,
      startEvent.sourceEventId,
      command.endAuthorityReference,
    ];
    for (let index = 0; index < identities.length; index += 1) {
      if (command.sourceEventId === identities[index]) fail();
    }
    const event = closed({
      schemaVersion: 'private-meeting-session-end/1' as const,
      tenantId: startEvent.tenantId,
      meetingId: startEvent.meetingId,
      sessionId: startEvent.sessionId,
      invitationId: startEvent.invitationId,
      subjectId: startEvent.subjectId,
      policyRevision: startEvent.policyRevision,
      startedAt: startEvent.startedAt,
      endedAt: command.endedAt,
      sourceEventId: command.sourceEventId,
      lifecycleState: 'ended' as const,
      participationState: 'left' as const,
      reason: 'invited_temporary_access_expired_or_ended' as const,
    });
    endedStarts = { event: startEvent, next: endedStarts };
    return new GenuineSessionEndEvent(event) as unknown as PrivateMeetingSessionEndEvent;
  } catch {
    throw new TypeError(GENERIC_ERROR);
  }
}
