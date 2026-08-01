type AcceptedMeetingReadiness = Readonly<{
  schemaVersion: "readiness/1";
  purpose: Readonly<{ reference: string; summary: string }>;
  participants: ReadonlyArray<Readonly<{
    participantReference: string;
    authorizationReference: string;
    attendanceAuthority: "readiness-only";
  }>>;
  materials: ReadonlyArray<Readonly<{
    materialReference: string;
    evidenceReference: string;
  }>>;
  lifecycle: Readonly<{
    state: "ready";
    preparedAt: string;
    readyAt: string;
  }>;
  outcome: Readonly<{
    state: "no-outcome-yet";
    provenanceReference: string;
  }>;
}>;

const IDENTIFIER = /^syn-[a-z0-9]+(?:-[a-z0-9]+)*$/;
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const MAX_COLLECTION_LENGTH = 16;
const MAX_SERIALIZED_CODE_UNITS = 8192;

function sameKeys(actual: readonly PropertyKey[], expected: readonly string[]): boolean {
  if (actual.length !== expected.length || actual.some((key) => typeof key !== "string")) return false;
  const sortedActual = [...actual].sort();
  const sortedExpected = [...expected].sort();
  return sortedActual.every((key, index) => key === sortedExpected[index]);
}

function dataObject(value: unknown, expected: readonly string[]): Record<string, unknown> | null {
  if (value === null || typeof value !== "object") return null;
  if (Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) return null;
  return sameKeys(Reflect.ownKeys(value), expected) ? value as Record<string, unknown> : null;
}

function denseArray(value: unknown): unknown[] | null {
  if (!Array.isArray(value)) return null;
  return value.length > 0 && value.length <= MAX_COLLECTION_LENGTH ? value : null;
}

function isWellFormedText(value: unknown, maximumLength: number): value is string {
  if (typeof value !== "string" || value.length === 0 || value.length > maximumLength || value.trim().length === 0) {
    return false;
  }
  if (/[\u0000-\u001f\u007f-\u009f]/.test(value)) return false;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (next < 0xdc00 || next > 0xdfff) return false;
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return false;
    }
  }
  return true;
}

function isIdentifier(value: unknown): value is string {
  return typeof value === "string" && value.length <= 64 && IDENTIFIER.test(value);
}

function isTimestamp(value: unknown): value is string {
  if (typeof value !== "string" || !TIMESTAMP.test(value)) return false;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value;
}

function inspectMeetingReadiness(candidate: unknown): AcceptedMeetingReadiness | null {
  try {
    const root = dataObject(candidate, ["schemaVersion", "purpose", "participants", "materials", "lifecycle", "outcome"]);
    if (root === null || root.schemaVersion !== "readiness/1") return null;

    const purpose = dataObject(root.purpose, ["reference", "summary"]);
    const participants = denseArray(root.participants);
    const materials = denseArray(root.materials);
    const lifecycle = dataObject(root.lifecycle, ["state", "preparedAt", "readyAt"]);
    const outcome = dataObject(root.outcome, ["state", "provenanceReference"]);
    if (purpose === null
      || !isIdentifier(purpose.reference)
      || !isWellFormedText(purpose.summary, 200)
      || participants === null
      || materials === null
      || lifecycle === null
      || lifecycle.state !== "ready"
      || !isTimestamp(lifecycle.preparedAt)
      || !isTimestamp(lifecycle.readyAt)
      || Date.parse(lifecycle.preparedAt) >= Date.parse(lifecycle.readyAt)
      || outcome === null
      || outcome.state !== "no-outcome-yet"
      || !isIdentifier(outcome.provenanceReference)) {
      return null;
    }

    const acceptedParticipants = [];
    const participantReferences = new Set<string>();
    for (const value of participants) {
      const participant = dataObject(value, ["participantReference", "authorizationReference", "attendanceAuthority"]);
      if (participant === null
        || !isIdentifier(participant.participantReference)
        || !isIdentifier(participant.authorizationReference)
        || participant.attendanceAuthority !== "readiness-only"
        || participantReferences.has(participant.participantReference)) {
        return null;
      }
      participantReferences.add(participant.participantReference);
      acceptedParticipants.push({
        participantReference: participant.participantReference,
        authorizationReference: participant.authorizationReference,
        attendanceAuthority: "readiness-only" as const
      });
    }

    const acceptedMaterials = [];
    const materialReferences = new Set<string>();
    for (const value of materials) {
      const material = dataObject(value, ["materialReference", "evidenceReference"]);
      if (material === null
        || !isIdentifier(material.materialReference)
        || !isIdentifier(material.evidenceReference)
        || materialReferences.has(material.materialReference)) {
        return null;
      }
      materialReferences.add(material.materialReference);
      acceptedMaterials.push({
        materialReference: material.materialReference,
        evidenceReference: material.evidenceReference
      });
    }

    return {
      schemaVersion: "readiness/1",
      purpose: { reference: purpose.reference, summary: purpose.summary },
      participants: acceptedParticipants,
      materials: acceptedMaterials,
      lifecycle: {
        state: "ready",
        preparedAt: lifecycle.preparedAt,
        readyAt: lifecycle.readyAt
      },
      outcome: {
        state: "no-outcome-yet",
        provenanceReference: outcome.provenanceReference
      }
    };
  } catch {
    return null;
  }
}

function freezeReadiness(value: AcceptedMeetingReadiness): AcceptedMeetingReadiness {
  Object.freeze(value.purpose);
  for (const participant of value.participants) Object.freeze(participant);
  Object.freeze(value.participants);
  for (const material of value.materials) Object.freeze(material);
  Object.freeze(value.materials);
  Object.freeze(value.lifecycle);
  Object.freeze(value.outcome);
  return Object.freeze(value);
}

export function validateMeetingReadiness(candidate: unknown): AcceptedMeetingReadiness | null {
  if (typeof candidate !== "string"
    || candidate.length === 0
    || candidate.length > MAX_SERIALIZED_CODE_UNITS) return null;

  try {
    const parsed: unknown = JSON.parse(candidate);
    const accepted = inspectMeetingReadiness(parsed);
    if (accepted === null || JSON.stringify(accepted) !== candidate) return null;
    return freezeReadiness(accepted);
  } catch {
    return null;
  }
}