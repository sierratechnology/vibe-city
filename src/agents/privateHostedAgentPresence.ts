export interface PrivateHostedPresenceAuthoritySnapshot {
  schemaVersion: "1.0";
  tenantId: string;
  subjectId: string;
  sessionId: string;
  mappingRevision: number;
  policyRevision: number;
  authorizationRef: string;
  membershipActive: boolean;
  canReadHostedAgentPresence: boolean;
}

export interface PrivateHostedAgentPresenceControllerDependencies {
  getTrustedAuthoritySnapshot: () => unknown;
  loadPrivatePresence: () => Promise<unknown>;
}

export interface PrivateHostedAgentPresenceController {
  refresh: () => Promise<unknown | null>;
  getAcceptedPresence: () => unknown | null;
}

const AUTHORITY_KEYS = [
  "authorizationRef",
  "canReadHostedAgentPresence",
  "mappingRevision",
  "membershipActive",
  "policyRevision",
  "schemaVersion",
  "sessionId",
  "subjectId",
  "tenantId"
];
const OPAQUE_ID = /^id_[a-f0-9]{16,64}$/;
const UTC_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const DETACH_MAX_NODES = 32;
const DETACH_MAX_DEPTH = 8;

type DetachedValue =
  | null
  | boolean
  | number
  | string
  | DetachedObject;

interface DetachedObject {
  readonly [key: string]: DetachedValue;
}

function detachAndFreeze(value: unknown): DetachedValue | undefined {
  let nodes = 0;
  const observations: Array<{
    candidate: object;
    keys: string[];
    descriptors: Map<string, PropertyDescriptor>;
  }> = [];

  function isStable(observation: typeof observations[number]): boolean {
    const { candidate, keys, descriptors } = observation;
    const recheckedKeys = Reflect.ownKeys(candidate);
    if (recheckedKeys.length !== keys.length || recheckedKeys.some((key, index) => key !== keys[index])) return false;
    for (const key of keys) {
      const before = descriptors.get(key);
      const after = Object.getOwnPropertyDescriptor(candidate, key);
      if (!before || !after || !("value" in before) || !("value" in after) ||
          before.enumerable !== after.enumerable || before.configurable !== after.configurable ||
          before.writable !== after.writable || !Object.is(before.value, after.value)) return false;
    }
    return true;
  }

  function visit(candidate: unknown, depth: number): DetachedValue | undefined {
    if (candidate === null || typeof candidate === "boolean" || typeof candidate === "string") {
      return candidate as null | boolean | string;
    }
    if (typeof candidate === "number" && Number.isFinite(candidate)) return candidate;
    if (typeof candidate !== "object" || Array.isArray(candidate) || depth > DETACH_MAX_DEPTH) return undefined;
    if (++nodes > DETACH_MAX_NODES) return undefined;

    const prototype = Object.getPrototypeOf(candidate);
    if (prototype !== Object.prototype && prototype !== null) return undefined;
    const keys = Reflect.ownKeys(candidate);
    if (keys.some((key) => typeof key !== "string")) return undefined;
    const descriptors = new Map<string, PropertyDescriptor>();
    for (const key of keys as string[]) {
      const descriptor = Object.getOwnPropertyDescriptor(candidate, key);
      if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) return undefined;
      descriptors.set(key, descriptor);
    }
    const observation = { candidate, keys: keys as string[], descriptors };
    observations.push(observation);
    const copy: Record<string, DetachedValue> = {};
    for (const key of keys as string[]) {
      const descriptor = descriptors.get(key) as PropertyDescriptor & { value: unknown };
      const nested = visit(descriptor.value, depth + 1);
      if (nested === undefined) return undefined;
      copy[key] = nested;
    }
    if (!isStable(observation)) return undefined;
    return Object.freeze(copy);
  }

  try {
    const detached = visit(value, 0);
    if (detached === undefined || observations.some((observation) => !isStable(observation))) return undefined;
    structuredClone(value);
    return detached;
  } catch {
    return undefined;
  }
}

function hasExactKeys(value: DetachedValue, expected: string[]): value is DetachedObject {
  return value !== null && typeof value === "object" &&
    Object.keys(value).slice().sort().join("\0") === expected.join("\0");
}

function isCanonicalUtc(value: DetachedValue): value is string {
  if (typeof value !== "string" || !UTC_INSTANT.test(value)) return false;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value;
}

function isAcceptedPrivateResponse(
  value: DetachedValue,
  authority: Readonly<PrivateHostedPresenceAuthoritySnapshot>
): value is DetachedObject {
  if (!hasExactKeys(value, ["generatedAt", "presence", "schemaVersion", "tenantId"])) return false;
  if (value.schemaVersion !== "1.0" || value.tenantId !== authority.tenantId || !isCanonicalUtc(value.generatedAt)) return false;
  const presence = value.presence;
  if (!hasExactKeys(presence, [
    "checkedAt", "displayName", "freshness", "identityId", "observedAt", "reason", "recordRef", "roleLabel",
    "state", "stateChangedAt", "workplace"
  ])) return false;
  if (presence.identityId !== "stg-spiders" || presence.displayName !== "Spiders" || presence.roleLabel !== "Chief Agent") return false;
  if (!hasExactKeys(presence.workplace, ["id", "label", "relationship"])) return false;
  if (
    presence.workplace.id !== "stg-chief-agent-office" ||
    presence.workplace.label !== "Chief Agent Office" ||
    presence.workplace.relationship !== "designated"
  ) return false;
  if (!(["working", "blocked", "completed"] as DetachedValue[]).includes(presence.state)) return false;
  if (!(["live", "recent"] as DetachedValue[]).includes(presence.freshness) || presence.reason !== null) return false;
  if (!isCanonicalUtc(presence.stateChangedAt) || !isCanonicalUtc(presence.observedAt) || !isCanonicalUtc(presence.checkedAt)) return false;
  if (!hasExactKeys(presence.recordRef, ["href", "recordId"])) return false;
  if (typeof presence.recordRef.recordId !== "string" || !OPAQUE_ID.test(presence.recordRef.recordId)) return false;
  const expectedHref = `/api/private/tenants/${authority.tenantId}/records/${presence.recordRef.recordId}`;
  if (presence.recordRef.href !== expectedHref) return false;
  return presence.stateChangedAt <= presence.observedAt &&
    presence.observedAt <= presence.checkedAt &&
    presence.checkedAt <= value.generatedAt;
}

function readAuthoritySnapshot(value: unknown): Readonly<PrivateHostedPresenceAuthoritySnapshot> | null {
  try {
    if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return null;
    const keys = Reflect.ownKeys(value);
    if (keys.some((key) => typeof key !== "string")) return null;
    const stringKeys = keys as string[];
    if (stringKeys.slice().sort().join("\0") !== AUTHORITY_KEYS.join("\0")) return null;

    const snapshot: Record<string, unknown> = {};
    const descriptors = new Map<string, PropertyDescriptor>();
    for (const key of stringKeys) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) return null;
      descriptors.set(key, descriptor);
      snapshot[key] = descriptor.value;
    }
    const recheckedKeys = Reflect.ownKeys(value);
    if (recheckedKeys.length !== keys.length || recheckedKeys.some((key, index) => key !== keys[index])) return null;
    for (const key of stringKeys) {
      const before = descriptors.get(key);
      const after = Object.getOwnPropertyDescriptor(value, key);
      if (!before || !after || !("value" in before) || !("value" in after) ||
          before.enumerable !== after.enumerable || before.configurable !== after.configurable ||
          before.writable !== after.writable || !Object.is(before.value, after.value)) return null;
    }
    structuredClone(value);
    if (snapshot.schemaVersion !== "1.0") return null;
    if (typeof snapshot.tenantId !== "string" || !OPAQUE_ID.test(snapshot.tenantId)) return null;
    if (typeof snapshot.subjectId !== "string" || !OPAQUE_ID.test(snapshot.subjectId)) return null;
    if (typeof snapshot.sessionId !== "string" || !OPAQUE_ID.test(snapshot.sessionId)) return null;
    if (typeof snapshot.authorizationRef !== "string" || !OPAQUE_ID.test(snapshot.authorizationRef)) return null;
    if (
      !Number.isSafeInteger(snapshot.mappingRevision) ||
      Object.is(snapshot.mappingRevision, -0) ||
      (snapshot.mappingRevision as number) < 0
    ) return null;
    if (
      !Number.isSafeInteger(snapshot.policyRevision) ||
      Object.is(snapshot.policyRevision, -0) ||
      (snapshot.policyRevision as number) < 0
    ) return null;
    if (snapshot.membershipActive !== true || snapshot.canReadHostedAgentPresence !== true) return null;

    return Object.freeze(snapshot as unknown as PrivateHostedPresenceAuthoritySnapshot);
  } catch {
    return null;
  }
}

function sameAuthority(
  left: Readonly<PrivateHostedPresenceAuthoritySnapshot>,
  right: Readonly<PrivateHostedPresenceAuthoritySnapshot>
): boolean {
  const membershipKeys: Array<keyof PrivateHostedPresenceAuthoritySnapshot> = [
    "schemaVersion",
    "tenantId",
    "subjectId",
    "sessionId",
    "authorizationRef",
    "mappingRevision",
    "policyRevision",
    "membershipActive",
    "canReadHostedAgentPresence"
  ];
  return membershipKeys.every((key) =>
    left[key as keyof PrivateHostedPresenceAuthoritySnapshot] ===
      right[key as keyof PrivateHostedPresenceAuthoritySnapshot]
  );
}

export function createPrivateHostedAgentPresenceController(
  dependencies: PrivateHostedAgentPresenceControllerDependencies
): PrivateHostedAgentPresenceController {
  let acceptedPresence: unknown | null = null;
  let acceptedAuthority: Readonly<PrivateHostedPresenceAuthoritySnapshot> | null = null;
  let generation = 0;

  function clear(): null {
    acceptedPresence = null;
    acceptedAuthority = null;
    return null;
  }

  function trustedAuthority(): Readonly<PrivateHostedPresenceAuthoritySnapshot> | null {
    try {
      return readAuthoritySnapshot(dependencies.getTrustedAuthoritySnapshot());
    } catch {
      return null;
    }
  }

  return Object.freeze({
    async refresh(): Promise<unknown | null> {
      const requestGeneration = ++generation;
      const before = trustedAuthority();
      if (before === null) return clear();

      let loaded: unknown;
      try {
        loaded = await dependencies.loadPrivatePresence();
      } catch {
        const afterRejection = trustedAuthority();
        if (requestGeneration !== generation) {
          if (afterRejection !== null && acceptedAuthority !== null && sameAuthority(acceptedAuthority, afterRejection)) return null;
          return clear();
        }
        if (afterRejection === null || !sameAuthority(before, afterRejection)) return clear();
        return clear();
      }

      const afterAwait = trustedAuthority();
      if (requestGeneration !== generation) {
        if (afterAwait !== null && acceptedAuthority !== null && sameAuthority(acceptedAuthority, afterAwait)) return null;
        return clear();
      }
      if (afterAwait === null || !sameAuthority(before, afterAwait)) return clear();

      const detached = detachAndFreeze(loaded);
      if (detached === undefined || !isAcceptedPrivateResponse(detached, before)) return clear();
      const beforePublish = trustedAuthority();
      if (beforePublish === null || !sameAuthority(before, beforePublish)) return clear();
      if (requestGeneration !== generation) return null;
      acceptedPresence = detached;
      acceptedAuthority = beforePublish;
      return acceptedPresence;
    },
    getAcceptedPresence(): unknown | null {
      return acceptedPresence;
    }
  });
}
