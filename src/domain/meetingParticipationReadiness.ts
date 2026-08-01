import { validateMeetingInvitationReadiness } from "./meetingInvitationReadiness";
import { validateMeetingReadiness } from "./meetingReadiness";

type AcceptedMeetingParticipationReadiness = Readonly<{
  schemaVersion: "participation-readiness/1";
  invitationReference: string;
  participantReference: string;
  participationAuthorizationReference: string;
  purposeReference: string;
  materialReferences: ReadonlyArray<string>;
  readiness: Readonly<{ state: "prepared" }>;
  grantsAccess: false;
  grantsOccupancy: false;
}>;

const MAX_SERIALIZED_CODE_UNITS = 20_000;
const parseJson: (text: string) => unknown = JSON.parse;
const stringifyJson: (value: unknown) => string | undefined = JSON.stringify;
const defineProperty: typeof Object.defineProperty = Object.defineProperty;
const freezeObject: typeof Object.freeze = Object.freeze;
const parseTimestamp: (value: string) => number = Date.parse;

export function validateMeetingParticipationReadiness(
  candidate: unknown
): AcceptedMeetingParticipationReadiness | null {
  if (typeof candidate !== "string"
    || candidate.length === 0
    || candidate.length > MAX_SERIALIZED_CODE_UNITS) return null;

  try {
    const parsed: unknown = parseJson(candidate);
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const root = parsed as Record<string, unknown>;
    if (root.schemaVersion !== "participation-readiness/1"
      || typeof root.meetingReadiness !== "string"
      || typeof root.invitationReadiness !== "string"
      || stringifyJson({
        schemaVersion: "participation-readiness/1",
        meetingReadiness: root.meetingReadiness,
        invitationReadiness: root.invitationReadiness
      }) !== candidate) return null;

    const meeting = validateMeetingReadiness(root.meetingReadiness);
    const invitation = validateMeetingInvitationReadiness(root.invitationReadiness);
    if (meeting === null || invitation === null) return null;

    let participant: (typeof meeting.participants)[number] | null = null;
    for (let index = 0; index < meeting.participants.length; index += 1) {
      const current = meeting.participants[index];
      if (current.participantReference === invitation.recipient.subjectReference) {
        if (participant !== null) return null;
        participant = current;
      }
    }
    if (participant === null
      || participant.authorizationReference
        !== invitation.recipient.participationAuthorizationReference) return null;

    if (invitation.purpose.reference !== meeting.purpose.reference
      || invitation.materials.length !== meeting.materials.length
      || parseTimestamp(meeting.lifecycle.readyAt) < parseTimestamp(invitation.validity.validFrom)
      || parseTimestamp(meeting.lifecycle.readyAt) >= parseTimestamp(invitation.validity.expiresAt)) {
      return null;
    }

    const materialReferences: string[] = [];
    for (let index = 0; index < invitation.materials.length; index += 1) {
      const invitationMaterial = invitation.materials[index];
      const meetingMaterial = meeting.materials[index];
      if (invitationMaterial.materialReference !== meetingMaterial.materialReference
        || invitationMaterial.evidenceReference !== meetingMaterial.evidenceReference) return null;
      defineProperty(materialReferences, index, {
        configurable: true,
        enumerable: true,
        value: invitationMaterial.materialReference,
        writable: true
      });
    }
    const readiness = freezeObject({ state: "prepared" as const });
    freezeObject(materialReferences);
    return freezeObject({
      schemaVersion: "participation-readiness/1",
      invitationReference: invitation.invitationReference,
      participantReference: participant.participantReference,
      participationAuthorizationReference: participant.authorizationReference,
      purposeReference: invitation.purpose.reference,
      materialReferences,
      readiness,
      grantsAccess: false,
      grantsOccupancy: false
    });
  } catch {
    return null;
  }
}
