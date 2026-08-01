import { validateMeetingSessionStartEvent } from "./meetingSessionStartEvent";

type AcceptedMeetingNoDecisionOutcomeReadiness = Readonly<{
  schemaVersion: "no-decision-outcome-readiness/1";
  outcomeReference: string;
  endedAt: string;
  purposeReference: string;
  participantReference: string;
  participationAuthorizationReference: string;
  materialReferences: ReadonlyArray<string>;
  resultState: "no-decision";
  trustState: "unverified";
  recordsOutcome: false;
  grantsCompletion: false;
  grantsAccess: false;
  grantsOccupancy: false;
}>;

const IDENTIFIER = /^syn-[a-z0-9]+(?:-[a-z0-9]+)*$/;
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const MAX_SERIALIZED_CODE_UNITS = 65_536;
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
const validateSessionStartEvent = validateMeetingSessionStartEvent;

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

export function validateMeetingNoDecisionOutcomeReadiness(
  candidate: unknown
): AcceptedMeetingNoDecisionOutcomeReadiness | null {
  if (typeof candidate !== "string"
    || candidate.length === 0
    || candidate.length > MAX_SERIALIZED_CODE_UNITS) return null;

  try {
    const parsed: unknown = parseJson(candidate);
    if (parsed === null || typeof parsed !== "object" || isArray(parsed)) return null;
    const root = parsed as Record<string, unknown>;
    if (root.schemaVersion !== "no-decision-outcome-readiness/1"
      || !isIdentifier(root.outcomeReference)
      || !isTimestamp(root.endedAt)
      || typeof root.sessionStartEvent !== "string"
      || root.resultState !== "no-decision"
      || stringifyJson({
        schemaVersion: "no-decision-outcome-readiness/1",
        outcomeReference: root.outcomeReference,
        endedAt: root.endedAt,
        sessionStartEvent: root.sessionStartEvent,
        resultState: "no-decision"
      }) !== candidate) return null;

    const sessionStartEvent = validateSessionStartEvent(root.sessionStartEvent);
    if (sessionStartEvent === null
      || sessionStartEvent.trustState !== "unverified"
      || sessionStartEvent.grantsStart !== false
      || sessionStartEvent.grantsAccess !== false
      || sessionStartEvent.grantsOccupancy !== false
      || parseTimestamp(root.endedAt) <= parseTimestamp(sessionStartEvent.occurredAt)) {
      return null;
    }

    if (root.outcomeReference === sessionStartEvent.eventReference
      || root.outcomeReference === sessionStartEvent.purposeReference
      || root.outcomeReference === sessionStartEvent.participantReference
      || root.outcomeReference
        === sessionStartEvent.participationAuthorizationReference) return null;

    const materialReferences: string[] = [];
    for (let index = 0; index < sessionStartEvent.materialReferences.length; index += 1) {
      if (root.outcomeReference === sessionStartEvent.materialReferences[index]) return null;
      defineProperty(materialReferences, index, {
        configurable: true,
        enumerable: true,
        value: sessionStartEvent.materialReferences[index],
        writable: true
      });
    }
    freezeObject(materialReferences);
    return freezeObject({
      schemaVersion: "no-decision-outcome-readiness/1",
      outcomeReference: root.outcomeReference,
      endedAt: root.endedAt,
      purposeReference: sessionStartEvent.purposeReference,
      participantReference: sessionStartEvent.participantReference,
      participationAuthorizationReference:
        sessionStartEvent.participationAuthorizationReference,
      materialReferences,
      resultState: "no-decision",
      trustState: "unverified",
      recordsOutcome: false,
      grantsCompletion: false,
      grantsAccess: false,
      grantsOccupancy: false
    });
  } catch {
    return null;
  }
}
