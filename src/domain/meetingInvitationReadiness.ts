type AcceptedMeetingInvitationReadiness = Readonly<{
  schemaVersion: "invitation-readiness/1";
  invitationReference: string;
  issuer: Readonly<{
    subjectReference: string;
    issuanceAuthorizationReference: string;
  }>;
  recipient: Readonly<{
    subjectReference: string;
    participationAuthorizationReference: string;
  }>;
  purpose: Readonly<{ reference: string }>;
  materials: ReadonlyArray<Readonly<{
    materialReference: string;
    evidenceReference: string;
  }>>;
  access: Readonly<{
    scope: "readiness-only";
    grantsAccess: false;
  }>;
  lifecycle: Readonly<{ state: "prepared" }>;
  validity: Readonly<{
    preparedAt: string;
    validFrom: string;
    expiresAt: string;
  }>;
  revocation: Readonly<{
    state: "not-revoked-yet";
    authorityReference: string;
  }>;
}>;

const IDENTIFIER = /^syn-[a-z0-9]+(?:-[a-z0-9]+)*$/;
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const MAX_MATERIALS = 16;
const MAX_SERIALIZED_CODE_UNITS = 8192;
const parseJson: (text: string) => unknown = JSON.parse;
const stringifyJson: (value: unknown) => string | undefined = JSON.stringify;
const freezeObject: typeof Object.freeze = Object.freeze;
const DateConstructor = Date;
const parseTimestamp: (value: string) => number = Date.parse;
const timestampToISOString = Date.prototype.toISOString.call.bind(
  Date.prototype.toISOString
) as (value: Date) => string;
const isFiniteNumber: (value: unknown) => boolean = Number.isFinite;
const testRegExp = RegExp.prototype.test.call.bind(RegExp.prototype.test) as (
  pattern: RegExp,
  value: string
) => boolean;
const SetConstructor = Set;
const hasSetValue = Set.prototype.has.call.bind(Set.prototype.has) as (
  set: Set<string>,
  value: string
) => boolean;
const addSetValue = Set.prototype.add.call.bind(Set.prototype.add) as (
  set: Set<string>,
  value: string
) => Set<string>;
const setSizeGetter = Object.getOwnPropertyDescriptor(Set.prototype, "size")!.get as (
  this: Set<string>
) => number;
const applyFunction: typeof Reflect.apply = Reflect.apply;
const getSetSize = (set: Set<string>): number => applyFunction(setSizeGetter, set, []);

function sameKeys(actual: readonly PropertyKey[], expected: readonly string[]): boolean {
  if (actual.length !== expected.length || actual.some((key) => typeof key !== "string")) return false;
  const sortedActual = [...actual].sort();
  const sortedExpected = [...expected].sort();
  return sortedActual.every((key, index) => key === sortedExpected[index]);
}

function dataObject(value: unknown, expected: readonly string[]): Record<string, unknown> | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  if (Object.getPrototypeOf(value) !== Object.prototype) return null;
  return sameKeys(Reflect.ownKeys(value), expected) ? value as Record<string, unknown> : null;
}

function isIdentifier(value: unknown): value is string {
  return typeof value === "string" && value.length <= 64 && testRegExp(IDENTIFIER, value);
}

function isTimestamp(value: unknown): value is string {
  if (typeof value !== "string" || !testRegExp(TIMESTAMP, value)) return false;
  const parsed = parseTimestamp(value);
  return isFiniteNumber(parsed) && timestampToISOString(new DateConstructor(parsed)) === value;
}

function inspectInvitationReadiness(candidate: unknown): AcceptedMeetingInvitationReadiness | null {
  const root = dataObject(candidate, [
    "schemaVersion",
    "invitationReference",
    "issuer",
    "recipient",
    "purpose",
    "materials",
    "access",
    "lifecycle",
    "validity",
    "revocation"
  ]);
  if (root === null
    || root.schemaVersion !== "invitation-readiness/1"
    || !isIdentifier(root.invitationReference)) return null;

  const issuer = dataObject(root.issuer, ["subjectReference", "issuanceAuthorizationReference"]);
  const recipient = dataObject(root.recipient, ["subjectReference", "participationAuthorizationReference"]);
  const purpose = dataObject(root.purpose, ["reference"]);
  const access = dataObject(root.access, ["scope", "grantsAccess"]);
  const lifecycle = dataObject(root.lifecycle, ["state"]);
  const validity = dataObject(root.validity, ["preparedAt", "validFrom", "expiresAt"]);
  const revocation = dataObject(root.revocation, ["state", "authorityReference"]);
  if (issuer === null
    || !isIdentifier(issuer.subjectReference)
    || !isIdentifier(issuer.issuanceAuthorizationReference)
    || recipient === null
    || !isIdentifier(recipient.subjectReference)
    || !isIdentifier(recipient.participationAuthorizationReference)
    || purpose === null
    || !isIdentifier(purpose.reference)
    || !Array.isArray(root.materials)
    || root.materials.length === 0
    || root.materials.length > MAX_MATERIALS
    || access === null
    || access.scope !== "readiness-only"
    || access.grantsAccess !== false
    || lifecycle === null
    || lifecycle.state !== "prepared"
    || validity === null
    || !isTimestamp(validity.preparedAt)
    || !isTimestamp(validity.validFrom)
    || !isTimestamp(validity.expiresAt)
    || parseTimestamp(validity.preparedAt) > parseTimestamp(validity.validFrom)
    || parseTimestamp(validity.validFrom) >= parseTimestamp(validity.expiresAt)
    || revocation === null
    || revocation.state !== "not-revoked-yet"
    || !isIdentifier(revocation.authorityReference)) {
    return null;
  }

  const references = new SetConstructor<string>();
  addSetValue(references, root.invitationReference);
  addSetValue(references, issuer.subjectReference);
  addSetValue(references, issuer.issuanceAuthorizationReference);
  addSetValue(references, recipient.subjectReference);
  addSetValue(references, recipient.participationAuthorizationReference);
  addSetValue(references, purpose.reference);
  addSetValue(references, revocation.authorityReference);
  if (getSetSize(references) !== 7) return null;

  const materials = [];
  for (const value of root.materials) {
    const material = dataObject(value, ["materialReference", "evidenceReference"]);
    if (material === null
      || !isIdentifier(material.materialReference)
      || !isIdentifier(material.evidenceReference)
      || hasSetValue(references, material.materialReference)
      || hasSetValue(references, material.evidenceReference)
      || material.materialReference === material.evidenceReference) {
      return null;
    }
    addSetValue(references, material.materialReference);
    addSetValue(references, material.evidenceReference);
    materials.push({
      materialReference: material.materialReference,
      evidenceReference: material.evidenceReference
    });
  }

  return {
    schemaVersion: "invitation-readiness/1",
    invitationReference: root.invitationReference,
    issuer: {
      subjectReference: issuer.subjectReference,
      issuanceAuthorizationReference: issuer.issuanceAuthorizationReference
    },
    recipient: {
      subjectReference: recipient.subjectReference,
      participationAuthorizationReference: recipient.participationAuthorizationReference
    },
    purpose: { reference: purpose.reference },
    materials,
    access: { scope: "readiness-only", grantsAccess: false },
    lifecycle: { state: "prepared" },
    validity: {
      preparedAt: validity.preparedAt,
      validFrom: validity.validFrom,
      expiresAt: validity.expiresAt
    },
    revocation: {
      state: "not-revoked-yet",
      authorityReference: revocation.authorityReference
    }
  };
}

function freezeInvitationReadiness(
  value: AcceptedMeetingInvitationReadiness
): AcceptedMeetingInvitationReadiness {
  freezeObject(value.issuer);
  freezeObject(value.recipient);
  freezeObject(value.purpose);
  for (let index = 0; index < value.materials.length; index += 1) {
    freezeObject(value.materials[index]);
  }
  freezeObject(value.materials);
  freezeObject(value.access);
  freezeObject(value.lifecycle);
  freezeObject(value.validity);
  freezeObject(value.revocation);
  return freezeObject(value);
}

export function validateMeetingInvitationReadiness(
  candidate: unknown
): AcceptedMeetingInvitationReadiness | null {
  if (typeof candidate !== "string"
    || candidate.length === 0
    || candidate.length > MAX_SERIALIZED_CODE_UNITS) return null;

  try {
    const parsed = parseJson(candidate);
    const accepted = inspectInvitationReadiness(parsed);
    if (accepted === null) return null;
    if (stringifyJson(accepted) !== candidate) return null;
    return freezeInvitationReadiness(accepted);
  } catch {
    return null;
  }
}
