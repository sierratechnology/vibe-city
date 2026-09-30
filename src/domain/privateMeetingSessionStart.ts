import { decidePrivateMeetingTemporaryAccess } from './privateMeetingTemporary\u0041ccess';
import { freezePrivateMeetingInvitationObject } from './privateMeetingInvitation\u0049ssuance';

export type PrivateMeetingSessionStartEvent = Readonly<{
  schemaVersion: 'private-meeting-session-start/1';
  tenantId: string;
  meetingId: string;
  sessionId: string;
  invitationId: string;
  subjectId: string;
  policyRevision: number;
  startedAt: string;
  sourceEventId: string;
  lifecycleState: 'started';
  participationState: 'joined';
  reason: 'invited_temporary_access';
}>;

type StartCommand = Readonly<{
  sessionId: string;
  sourceEventId: string;
  startAuthorityReference: string;
  startedAt: string;
}>;

const GENERIC_ERROR = 'Invalid private meeting session start input';

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

class StartCommandBase {
  constructor(value: object) {
    return value as StartCommandBase;
  }
}

class GenuineStartCommand extends StartCommandBase {
  #genuine = true;

  constructor(command: StartCommand) {
    super(closed(command));
  }

  static isGenuine(value: unknown): boolean {
    try {
      return (value as GenuineStartCommand).#genuine;
    } catch {
      return false;
    }
  }
}

export function createPrivateMeetingSessionStartCommand(
  sessionIdInput: unknown,
  sourceEventIdInput: unknown,
  startAuthorityReferenceInput: unknown,
  startedAtInput: unknown,
): StartCommand {
  try {
    const sessionId = requireOpaqueId(sessionIdInput);
    const sourceEventId = requireOpaqueId(sourceEventIdInput);
    const startAuthorityReference = requireOpaqueId(startAuthorityReferenceInput);
    const startedAt = requireTimestamp(startedAtInput);
    if (sessionId === sourceEventId || sessionId === startAuthorityReference
      || sourceEventId === startAuthorityReference) fail();
    return new GenuineStartCommand({
      sessionId, sourceEventId, startAuthorityReference, startedAt,
    }) as unknown as StartCommand;
  } catch {
    throw new TypeError(GENERIC_ERROR);
  }
}

function requireCommand(value: unknown): StartCommand {
  if (!GenuineStartCommand.isGenuine(value)) fail();
  return value as StartCommand;
}

export function createPrivateMeetingSessionStartEvent(
  readinessDocument: unknown,
  issuanceEvent: unknown,
  acceptanceEvent: unknown,
  policyObservation: unknown,
  commandInput: unknown,
): PrivateMeetingSessionStartEvent {
  try {
    const access = decidePrivateMeetingTemporaryAccess(
      readinessDocument, issuanceEvent, acceptanceEvent, policyObservation,
    );
    if (access.status !== 'granted') fail();
    const command = requireCommand(commandInput);
    if (typeof command.sessionId !== 'string'
      || typeof command.sourceEventId !== 'string'
      || typeof command.startAuthorityReference !== 'string'
      || typeof command.startedAt !== 'string') fail();
    const sessionId = requireOpaqueId(command.sessionId);
    const sourceEventId = requireOpaqueId(command.sourceEventId);
    const startAuthorityReference = requireOpaqueId(command.startAuthorityReference);
    const startedAt = requireTimestamp(command.startedAt);
    if (startAuthorityReference
      !== (acceptanceEvent as { authorizationReference?: unknown }).authorizationReference) fail();
    if (startedAt < access.grantedAt || startedAt >= access.expiresAt) fail();
    const identities = [
      access.tenantId, access.meetingId, access.invitationId, access.subjectId,
      sessionId, sourceEventId, startAuthorityReference,
    ];
    for (let left = 0; left < identities.length; left += 1) {
      for (let right = left + 1; right < identities.length; right += 1) {
        if (identities[left] === identities[right]) fail();
      }
    }
    return closed({
      schemaVersion: 'private-meeting-session-start/1' as const,
      tenantId: access.tenantId,
      meetingId: access.meetingId,
      sessionId,
      invitationId: access.invitationId,
      subjectId: access.subjectId,
      policyRevision: access.policyRevision,
      startedAt,
      sourceEventId,
      lifecycleState: 'started' as const,
      participationState: 'joined' as const,
      reason: 'invited_temporary_access' as const,
    });
  } catch {
    throw new TypeError(GENERIC_ERROR);
  }
}
