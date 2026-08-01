import { validateMeetingInvitationReadiness } from "./meetingInvitationReadiness";
import { validateMeetingParticipationReadiness } from "./meetingParticipationReadiness";
import { validateMeetingReadiness } from "./meetingReadiness";

type AcceptedMeetingSessionStartEvent = Readonly<{
  schemaVersion: "session-start-event/1";
  eventReference: string;
  occurredAt: string;
  purposeReference: string;
  participantReference: string;
  participationAuthorizationReference: string;
  materialReferences: ReadonlyArray<string>;
  trustState: "unverified";
  grantsStart: false;
  grantsAccess: false;
  grantsOccupancy: false;
}>;

const IDENTIFIER = /^syn-[a-z0-9]+(?:-[a-z0-9]+)*$/;
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const MAX_SERIALIZED_CODE_UNITS = 32_768;
const parseJson: (text: string) => unknown = JSON.parse;
const stringifyJson: (value: unknown) => string | undefined = JSON.stringify;
const isArray: (value: unknown) => value is unknown[] = Array.isArray;
const freezeObject: typeof Object.freeze = Object.freeze;
const defineProperty: typeof Object.defineProperty = Object.defineProperty;
const parseTimestamp: (value: string) => number = Date.parse;
const DateConstructor = Date;
const timestampToISOString = Date.prototype.toISOString.call.bind(
  Date.prototype.toISOString
) as (value: Date) => string;
const isFiniteNumber: (value: unknown) => boolean = Number.isFinite;
const testRegExp = RegExp.prototype.test.call.bind(RegExp.prototype.test) as (
  pattern: RegExp,
  value: string
) => boolean;
const validateMeeting = validateMeetingReadiness;
const validateInvitation = validateMeetingInvitationReadiness;
const validateParticipation = validateMeetingParticipationReadiness;

function isIdentifier(value: unknown): value is string {
  return typeof value === "string"
    && value.length <= 64
    && testRegExp(IDENTIFIER, value);
}

function isTimestamp(value: unknown): value is string {
  if (typeof value !== "string" || !testRegExp(TIMESTAMP, value)) return false;
  const parsed = parseTimestamp(value);
  return isFiniteNumber(parsed)
    && timestampToISOString(new DateConstructor(parsed)) === value;
}

export function validateMeetingSessionStartEvent(
  candidate: unknown
): AcceptedMeetingSessionStartEvent | null {
  if (typeof candidate !== "string"
    || candidate.length === 0
    || candidate.length > MAX_SERIALIZED_CODE_UNITS) return null;

  try {
    const parsed: unknown = parseJson(candidate);
    if (parsed === null || typeof parsed !== "object" || isArray(parsed)) return null;
    const root = parsed as Record<string, unknown>;
    if (root.schemaVersion !== "session-start-event/1"
      || !isIdentifier(root.eventReference)
      || !isTimestamp(root.occurredAt)
      || typeof root.meetingReadiness !== "string"
      || typeof root.participationReadiness !== "string"
      || stringifyJson({
        schemaVersion: "session-start-event/1",
        eventReference: root.eventReference,
        occurredAt: root.occurredAt,
        meetingReadiness: root.meetingReadiness,
        participationReadiness: root.participationReadiness
      }) !== candidate) return null;

    const meeting = validateMeeting(root.meetingReadiness);
    const participation = validateParticipation(root.participationReadiness);
    if (meeting === null
      || participation === null
      || participation.grantsAccess !== false
      || participation.grantsOccupancy !== false
      || meeting.outcome.state !== "no-outcome-yet") return null;

    const participationParsed: unknown = parseJson(root.participationReadiness);
    if (participationParsed === null
      || typeof participationParsed !== "object"
      || isArray(participationParsed)) return null;
    const participationRoot = participationParsed as Record<string, unknown>;
    if (participationRoot.meetingReadiness !== root.meetingReadiness
      || typeof participationRoot.invitationReadiness !== "string") return null;
    const invitation = validateInvitation(participationRoot.invitationReadiness);
    if (invitation === null
      || invitation.access.grantsAccess !== false
      || participation.invitationReference !== invitation.invitationReference
      || participation.participantReference !== invitation.recipient.subjectReference
      || participation.participationAuthorizationReference
        !== invitation.recipient.participationAuthorizationReference) return null;

    if (root.eventReference === meeting.purpose.reference
      || root.eventReference === meeting.outcome.provenanceReference
      || root.eventReference === invitation.invitationReference
      || root.eventReference === invitation.issuer.subjectReference
      || root.eventReference === invitation.issuer.issuanceAuthorizationReference
      || root.eventReference === invitation.recipient.subjectReference
      || root.eventReference === invitation.recipient.participationAuthorizationReference
      || root.eventReference === invitation.purpose.reference
      || root.eventReference === invitation.revocation.authorityReference) return null;

    let matchingParticipant = 0;
    for (let index = 0; index < meeting.participants.length; index += 1) {
      const participant = meeting.participants[index];
      if (root.eventReference === participant.participantReference
        || root.eventReference === participant.authorizationReference) return null;
      if (participant.participantReference === participation.participantReference
        && participant.authorizationReference
          === participation.participationAuthorizationReference) {
        matchingParticipant += 1;
      }
    }
    if (matchingParticipant !== 1
      || participation.purposeReference !== meeting.purpose.reference
      || participation.materialReferences.length !== meeting.materials.length
      || parseTimestamp(root.occurredAt) < parseTimestamp(meeting.lifecycle.readyAt)
      || parseTimestamp(root.occurredAt) >= parseTimestamp(invitation.validity.expiresAt)) {
      return null;
    }

    const materialReferences: string[] = [];
    for (let index = 0; index < meeting.materials.length; index += 1) {
      const materialReference = meeting.materials[index].materialReference;
      if (participation.materialReferences[index] !== materialReference
        || root.eventReference === materialReference
        || root.eventReference === meeting.materials[index].evidenceReference) return null;
      defineProperty(materialReferences, index, {
        configurable: true,
        enumerable: true,
        value: materialReference,
        writable: true
      });
    }

    freezeObject(materialReferences);
    return freezeObject({
      schemaVersion: "session-start-event/1",
      eventReference: root.eventReference,
      occurredAt: root.occurredAt,
      purposeReference: meeting.purpose.reference,
      participantReference: participation.participantReference,
      participationAuthorizationReference: participation.participationAuthorizationReference,
      materialReferences,
      trustState: "unverified",
      grantsStart: false,
      grantsAccess: false,
      grantsOccupancy: false
    });
  } catch {
    return null;
  }
}
