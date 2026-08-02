type TrustedMeetingSession = Readonly<{
  kind: "trusted_authenticated_session";
  subjectId: string;
  tenantId: string;
  authorizationRef: string;
  policyRevision: number;
  active: true;
}>;

type PrivateMeetingSessionInterfaceElements = {
  dialog: HTMLDialogElement;
  status: HTMLElement;
  purpose: HTMLElement;
  participants: HTMLElement;
  materials: HTMLElement;
  lifecycle: HTMLElement;
  startedAt: HTMLElement;
  endedAt: HTMLElement;
  outcome: HTMLElement;
  occupancy: HTMLElement;
  refresh: HTMLButtonElement;
  close: HTMLButtonElement;
};

type PrivateMeetingSessionInterfaceAdapter = {
  getTrustedSession: () => unknown;
  readAuthorizedMeetingSession: (
    session: TrustedMeetingSession,
    meetingSessionId: string
  ) => Promise<unknown>;
};

type MeetingSnapshot = Readonly<{
  tenantId: string;
  sessionId: string;
  purposeReference: string;
  participantSubjectIds: readonly string[];
  materialReferences: readonly string[];
  startedAt: string;
  lifecycle: "active" | "ended";
  endedAt: string | null;
}>;

type DetachedValue = null | boolean | number | string | DetachedObject | readonly DetachedValue[];
type DetachedObject = { readonly [key: string]: DetachedValue };

const arrayIsArray = Array.isArray;
const arrayJoin = Array.prototype.join;

const nativeDate = Date;
const dateParse = Date.parse;
const dateToISOString = Date.prototype.toISOString;
const numberIsFinite = Number.isFinite;
const numberIsSafeInteger = Number.isSafeInteger;
const objectFreeze = Object.freeze;
const objectGetOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const objectGetPrototypeOf = Object.getPrototypeOf;
const objectIs = Object.is;
const objectKeys = Object.keys;
const reflectApply = Reflect.apply;
const reflectOwnKeys = Reflect.ownKeys;
const regexpTest = RegExp.prototype.test;
const stringStartsWith = String.prototype.startsWith;
const cloneStructured = globalThis.structuredClone;

const UNAVAILABLE_MESSAGE = "Private meeting unavailable. Authorized tenant session required.";
const MAX_SCALAR_LENGTH = 128;
const MAX_PARTICIPANTS = 32;
const MAX_MATERIALS = 32;
const UTC_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const REFERENCE = /^syn-[a-z0-9]+(?:-[a-z0-9]+)*--[a-z0-9]+(?:-[a-z0-9]+)*$/;
const TENANT = /^syn-tenant-[a-z0-9]+(?:-[a-z0-9]+)*$/;
const AUTHORITY_KEYS = ["kind", "subjectId", "tenantId", "authorizationRef", "policyRevision", "active"];
const ACTIVE_MEETING_KEYS = [
  "privacy", "tenantId", "sessionId", "revision", "purposeReference", "participantSubjectIds",
  "materialReferences", "startedAt", "endedAt", "lifecycle", "outcome", "sourceReference",
  "createdBySubjectId", "authorizationReference", "policyRevision"
];
const ENDED_MEETING_KEYS = [
  "privacy", "tenantId", "sessionId", "revision", "purposeReference", "participantSubjectIds",
  "materialReferences", "startedAt", "endedAt", "lifecycle", "outcome", "sourceReference",
  "createdBySubjectId", "authorizationReference", "policyRevision", "endedBySubjectId",
  "endAuthorizationReference", "endPolicyRevision"
];

function stableObservation(
  candidate: object,
  keys: readonly PropertyKey[],
  descriptors: ReadonlyMap<PropertyKey, PropertyDescriptor>
): boolean {
  const recheckedKeys = reflectOwnKeys(candidate);
  if (recheckedKeys.length !== keys.length) return false;
  for (let index = 0; index < keys.length; index += 1) {
    if (recheckedKeys[index] !== keys[index]) return false;
    const before = descriptors.get(keys[index]);
    const after = objectGetOwnPropertyDescriptor(candidate, keys[index]);
    if (
      before === undefined || after === undefined || !("value" in before) || !("value" in after) ||
      before.enumerable !== after.enumerable || before.configurable !== after.configurable ||
      before.writable !== after.writable || !objectIs(before.value, after.value)
    ) return false;
  }
  return true;
}

function detachedSnapshot(value: unknown): DetachedValue | undefined {
  let nodes = 0;
  const observations: Array<{
    candidate: object;
    keys: readonly PropertyKey[];
    descriptors: ReadonlyMap<PropertyKey, PropertyDescriptor>;
  }> = [];

  function visit(candidate: unknown, depth: number): DetachedValue | undefined {
    if (candidate === null || typeof candidate === "boolean" || typeof candidate === "string") return candidate;
    if (typeof candidate === "number" && numberIsFinite(candidate)) return candidate;
    if (typeof candidate !== "object" || depth > 4 || ++nodes > 80) return undefined;

    const isArray = arrayIsArray(candidate);
    const prototype = objectGetPrototypeOf(candidate);
    if (isArray ? prototype !== Array.prototype : prototype !== Object.prototype && prototype !== null) return undefined;

    let arrayLength = 0;
    if (isArray) {
      const lengthDescriptor = objectGetOwnPropertyDescriptor(candidate, "length");
      if (
        lengthDescriptor === undefined || !("value" in lengthDescriptor) ||
        !numberIsSafeInteger(lengthDescriptor.value) || lengthDescriptor.value < 0 || lengthDescriptor.value > 32
      ) return undefined;
      arrayLength = lengthDescriptor.value;
    }

    const keys = reflectOwnKeys(candidate);
    if (keys.length > 40) return undefined;
    const descriptors = new Map<PropertyKey, PropertyDescriptor>();
    for (let index = 0; index < keys.length; index += 1) {
      const key = keys[index];
      if (typeof key !== "string") return undefined;
      const descriptor = objectGetOwnPropertyDescriptor(candidate, key);
      if (descriptor === undefined || !("value" in descriptor)) return undefined;
      if (isArray ? key !== "length" && !descriptor.enumerable : !descriptor.enumerable) return undefined;
      descriptors.set(key, descriptor);
    }
    observations.push({ candidate, keys, descriptors });

    if (isArray) {
      if (keys.length !== arrayLength + 1) return undefined;
      const copy: DetachedValue[] = [];
      for (let index = 0; index < arrayLength; index += 1) {
        const descriptor = descriptors.get(String(index));
        if (descriptor === undefined || !("value" in descriptor)) return undefined;
        const nested = visit(descriptor.value, depth + 1);
        if (nested === undefined) return undefined;
        copy[index] = nested;
      }
      if (!stableObservation(candidate, keys, descriptors)) return undefined;
      return objectFreeze(copy);
    }

    const copy: Record<string, DetachedValue> = {};
    for (let index = 0; index < keys.length; index += 1) {
      const key = keys[index] as string;
      const descriptor = descriptors.get(key);
      if (descriptor === undefined || !("value" in descriptor)) return undefined;
      const nested = visit(descriptor.value, depth + 1);
      if (nested === undefined) return undefined;
      copy[key] = nested;
    }
    if (!stableObservation(candidate, keys, descriptors)) return undefined;
    return objectFreeze(copy);
  }

  try {
    const snapshot = visit(value, 0);
    if (snapshot === undefined) return undefined;
    for (let index = 0; index < observations.length; index += 1) {
      const observation = observations[index];
      if (!stableObservation(observation.candidate, observation.keys, observation.descriptors)) return undefined;
    }
    cloneStructured(value);
    for (let index = 0; index < observations.length; index += 1) {
      const observation = observations[index];
      if (!stableObservation(observation.candidate, observation.keys, observation.descriptors)) return undefined;
    }
    return snapshot;
  } catch {
    return undefined;
  }
}

function isBoundedString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= MAX_SCALAR_LENGTH;
}

function startsWith(value: string, prefix: string): boolean {
  return reflectApply(stringStartsWith, value, [prefix]);
}

function isTenant(value: unknown): value is string {
  return typeof value === "string" && value.length <= MAX_SCALAR_LENGTH &&
    reflectApply(regexpTest, TENANT, [value]);
}

function isScopedReference(value: unknown, tenantId: string): value is string {
  return typeof value === "string" && value.length <= MAX_SCALAR_LENGTH &&
    reflectApply(regexpTest, REFERENCE, [value]) && startsWith(value, `${tenantId}--`);
}

function isCanonicalUtc(value: unknown): value is string {
  if (typeof value !== "string" || !reflectApply(regexpTest, UTC_INSTANT, [value])) return false;
  const parsed = reflectApply(dateParse, nativeDate, [value]);
  return numberIsFinite(parsed) && reflectApply(dateToISOString, new nativeDate(parsed), []) === value;
}

function hasExactKeys(value: object, expected: readonly string[]): boolean {
  const keys = objectKeys(value);
  if (keys.length !== expected.length) return false;
  for (let index = 0; index < keys.length; index += 1) {
    if (keys[index] !== expected[index]) return false;
  }
  return true;
}

function hasDuplicate(values: readonly string[]): boolean {
  for (let left = 0; left < values.length; left += 1) {
    for (let right = left + 1; right < values.length; right += 1) {
      if (values[left] === values[right]) return true;
    }
  }
  return false;
}

function contains(values: readonly string[], expected: string): boolean {
  for (let index = 0; index < values.length; index += 1) {
    if (values[index] === expected) return true;
  }
  return false;
}

function readMeeting(value: unknown, tenantId: string, sessionId: string): MeetingSnapshot | null {
  try {
    const detached = detachedSnapshot(value);
    if (detached === undefined || detached === null || typeof detached !== "object" || arrayIsArray(detached)) return null;
    const meeting = detached as DetachedObject;
    if (
      meeting.lifecycle === "active"
        ? !hasExactKeys(meeting, ACTIVE_MEETING_KEYS)
        : meeting.lifecycle === "ended"
          ? !hasExactKeys(meeting, ENDED_MEETING_KEYS)
          : true
    ) return null;

    const participants = meeting.participantSubjectIds;
    const materials = meeting.materialReferences;
    if (
      meeting.privacy !== "tenant-private" || meeting.tenantId !== tenantId || meeting.sessionId !== sessionId ||
      !isTenant(meeting.tenantId) || !isScopedReference(meeting.sessionId, meeting.tenantId) ||
      !numberIsSafeInteger(meeting.revision) || objectIs(meeting.revision, -0) ||
      !isScopedReference(meeting.purposeReference, tenantId) || !arrayIsArray(participants) || participants.length < 1 ||
      participants.length > MAX_PARTICIPANTS || !arrayIsArray(materials) || materials.length < 1 ||
      materials.length > MAX_MATERIALS ||
      !isCanonicalUtc(meeting.startedAt) || !isScopedReference(meeting.sourceReference, tenantId) ||
      !isScopedReference(meeting.createdBySubjectId, tenantId) ||
      !isScopedReference(meeting.authorizationReference, tenantId) ||
      !numberIsSafeInteger(meeting.policyRevision) || objectIs(meeting.policyRevision, -0) ||
      (meeting.policyRevision as number) < 1
    ) return null;

    const participantCopy: string[] = [];
    for (let index = 0; index < participants.length; index += 1) {
      const reference = participants[index];
      if (!isScopedReference(reference, tenantId)) return null;
      participantCopy[index] = reference;
    }
    const materialCopy: string[] = [];
    for (let index = 0; index < materials.length; index += 1) {
      const reference = materials[index];
      if (!isScopedReference(reference, tenantId)) return null;
      materialCopy[index] = reference;
    }
    if (
      hasDuplicate(participantCopy) || hasDuplicate(materialCopy) || !contains(participantCopy, meeting.createdBySubjectId)
    ) return null;

    let lifecycle: "active" | "ended";
    let endedAt: string | null;
    if (meeting.lifecycle === "active") {
      if (meeting.revision !== 1 || meeting.endedAt !== null || meeting.outcome !== null) return null;
      lifecycle = "active";
      endedAt = null;
    } else if (meeting.lifecycle === "ended") {
      const outcome = meeting.outcome;
      const outcomeObject = outcome as DetachedObject;
      if (
        meeting.revision !== 2 || !isCanonicalUtc(meeting.endedAt) || meeting.endedAt <= meeting.startedAt ||
        outcome === null || typeof outcome !== "object" || arrayIsArray(outcome) ||
        !hasExactKeys(outcome, ["resultState", "outcomeReference"]) || outcomeObject.resultState !== "no-decision" ||
        !isScopedReference(outcomeObject.outcomeReference, tenantId) ||
        !isScopedReference(meeting.endedBySubjectId, tenantId) ||
        !isScopedReference(meeting.endAuthorizationReference, tenantId) ||
        !numberIsSafeInteger(meeting.endPolicyRevision) || objectIs(meeting.endPolicyRevision, -0) ||
        (meeting.endPolicyRevision as number) < 1 || !contains(participantCopy, meeting.endedBySubjectId)
      ) return null;
      lifecycle = "ended";
      endedAt = meeting.endedAt;
    } else return null;

    return objectFreeze({
      tenantId,
      sessionId,
      purposeReference: meeting.purposeReference,
      participantSubjectIds: objectFreeze(participantCopy),
      materialReferences: objectFreeze(materialCopy),
      startedAt: meeting.startedAt,
      lifecycle,
      endedAt
    });
  } catch {
    return null;
  }
}

function sameAuthority(left: TrustedMeetingSession | null, right: TrustedMeetingSession): boolean {
  return left !== null && left.kind === right.kind && left.subjectId === right.subjectId &&
    left.tenantId === right.tenantId && left.authorizationRef === right.authorizationRef &&
    left.policyRevision === right.policyRevision && left.active === right.active;
}

export function createPrivateMeetingSessionInterfaceController(
  elements: PrivateMeetingSessionInterfaceElements,
  adapter: PrivateMeetingSessionInterfaceAdapter
): {
  open: (invoker: HTMLElement, tenantId: string, meetingSessionId: string) => Promise<void>;
  refresh: () => Promise<void>;
  close: () => void;
} {
  let activeInvoker: HTMLElement | null = null;
  let requestedTenantId: string | null = null;
  let requestedMeetingSessionId: string | null = null;
  let requestGeneration = 0;

  function clearPrivateFields(): void {
    elements.purpose.textContent = "";
    elements.participants.textContent = "";
    elements.materials.textContent = "";
    elements.lifecycle.textContent = "";
    elements.startedAt.textContent = "";
    elements.endedAt.textContent = "";
    elements.outcome.textContent = "";
    elements.occupancy.textContent = "";
  }

  function unavailable(): void {
    clearPrivateFields();
    elements.status.textContent = UNAVAILABLE_MESSAGE;
  }

  function trustedSessionFor(tenantId: string): TrustedMeetingSession | null {
    try {
      const detached = detachedSnapshot(adapter.getTrustedSession());
      if (detached === undefined || detached === null || typeof detached !== "object" || arrayIsArray(detached)) return null;
      const candidate = detached as DetachedObject;
      if (!hasExactKeys(candidate, AUTHORITY_KEYS)) return null;
      if (
        candidate.kind !== "trusted_authenticated_session" || !isBoundedString(candidate.subjectId) ||
        !isTenant(candidate.tenantId) || candidate.tenantId !== tenantId ||
        !isScopedReference(candidate.subjectId, tenantId) ||
        !isScopedReference(candidate.authorizationRef, tenantId) ||
        !numberIsSafeInteger(candidate.policyRevision) || objectIs(candidate.policyRevision, -0) ||
        (candidate.policyRevision as number) < 1 || candidate.active !== true
      ) return null;
      return objectFreeze({
        kind: candidate.kind,
        subjectId: candidate.subjectId,
        tenantId: candidate.tenantId,
        authorizationRef: candidate.authorizationRef,
        policyRevision: candidate.policyRevision as number,
        active: true
      });
    } catch {
      return null;
    }
  }

  async function load(): Promise<void> {
    const generation = ++requestGeneration;
    unavailable();
    if (
      requestedTenantId === null || requestedMeetingSessionId === null ||
      !isTenant(requestedTenantId) || !isScopedReference(requestedMeetingSessionId, requestedTenantId)
    ) return;
    const authority = trustedSessionFor(requestedTenantId);
    if (authority === null) return;

    let loaded: unknown;
    try {
      loaded = await adapter.readAuthorizedMeetingSession(authority, requestedMeetingSessionId);
    } catch {
      if (generation === requestGeneration) unavailable();
      return;
    }
    if (generation !== requestGeneration) return;
    const afterAwait = trustedSessionFor(authority.tenantId);
    if (!sameAuthority(afterAwait, authority)) {
      unavailable();
      return;
    }
    const meeting = readMeeting(loaded, authority.tenantId, requestedMeetingSessionId);
    if (meeting === null) {
      unavailable();
      return;
    }
    const beforeRender = trustedSessionFor(authority.tenantId);
    if (generation !== requestGeneration || !sameAuthority(beforeRender, authority)) {
      unavailable();
      return;
    }
    elements.purpose.textContent = `Purpose: ${meeting.purposeReference}`;
    elements.participants.textContent = `Participants: ${reflectApply(arrayJoin, meeting.participantSubjectIds, ["\n"])}`;
    elements.materials.textContent = `Materials: ${reflectApply(arrayJoin, meeting.materialReferences, ["\n"])}`;
    elements.lifecycle.textContent = meeting.lifecycle === "active" ? "Lifecycle: Active" : "Lifecycle: Ended";
    elements.startedAt.textContent = `Started: ${meeting.startedAt}`;
    elements.endedAt.textContent = meeting.endedAt === null ? "" : `Ended: ${meeting.endedAt}`;
    elements.outcome.textContent = meeting.lifecycle === "active" ? "Outcome: Pending" : "Outcome: No decision";
    elements.occupancy.textContent = meeting.lifecycle === "active"
      ? `Current room occupancy: ${meeting.participantSubjectIds.length} participants`
      : "Current room occupancy: None";
    elements.status.textContent = "Authorized private meeting loaded.";
  }

  async function open(invoker: HTMLElement, tenantId: string, meetingSessionId: string): Promise<void> {
    activeInvoker = invoker;
    requestedTenantId = tenantId;
    requestedMeetingSessionId = meetingSessionId;
    if (!elements.dialog.open) elements.dialog.showModal();
    await load();
  }

  async function refresh(): Promise<void> {
    await load();
  }

  function close(): void {
    if (elements.dialog.open) elements.dialog.close();
  }

  elements.refresh.addEventListener("click", () => void refresh());
  elements.close.addEventListener("click", close);
  elements.dialog.addEventListener("close", () => {
    requestGeneration += 1;
    unavailable();
    requestedTenantId = null;
    requestedMeetingSessionId = null;
    activeInvoker?.focus();
    activeInvoker = null;
  });

  return objectFreeze({ open, refresh, close });
}
