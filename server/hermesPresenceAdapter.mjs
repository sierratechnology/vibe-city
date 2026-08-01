const INVALID = Object.freeze({ ok: false, code: "invalid_hosted_agent_mapping" });
const MAX_RESOLUTION_CANDIDATES = 2;
const REVIEWED_MAPPING_KEYS = Object.freeze([
  "identityId", "profileName", "registryRevision", "schemaVersion", "status", "subjectId",
  "synchronizedAt", "tenantId"
]);
const OPAQUE_ID = /^id_[a-f0-9]{16,64}$/;
const PROFILE_NAME = /^[a-z][a-z0-9_-]{0,63}$/;
const CANONICAL_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const TASK_ID = /^t_[a-f0-9]{8}$/;
const INVALID_PID_LIVENESS = Symbol("invalid_pid_liveness");
const RUN_SOURCE_KEYS = Object.freeze([
  "claimCurrent", "decisiveEvent", "endedAt", "heartbeatAt", "heartbeatHealth", "outcome", "pid",
  "runId", "runStatus", "spawnedEventPresent", "startedAt", "taskId"
]);
const EVENT_SOURCE_KEYS = Object.freeze(["eventId", "kind", "occurredAt", "runId"]);
const REQUIRED_ADAPTER_OPTION_KEYS = Object.freeze([
  "observedAt", "profileName", "resolvePidLiveness", "runCandidates"
]);
const ADAPTER_OPTION_KEYS_WITH_LOG = Object.freeze([...REQUIRED_ADAPTER_OPTION_KEYS, "log"].sort());

function closedObservation(profileName, observedAt) {
  return Object.freeze({
    schemaVersion: "1.0",
    profileName,
    observedAt,
    sourceStatus: "unavailable",
    reason: "invalid_source",
    currentRun: null,
    decisiveEvent: null
  });
}

function ambiguousObservation(profileName, observedAt) {
  return Object.freeze({
    schemaVersion: "1.0",
    profileName,
    observedAt,
    sourceStatus: "degraded",
    reason: "ambiguous_run",
    currentRun: null,
    decisiveEvent: null
  });
}

function snapshotExactObject(value, expectedKeys, excludedKey = null) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  const prototype = Reflect.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return null;
  const keys = Reflect.ownKeys(value);
  if (keys.length !== expectedKeys.length || keys.some((key) => typeof key !== "string") ||
      keys.slice().sort().some((key, index) => key !== expectedKeys[index])) return null;
  const descriptors = new Map();
  const values = Object.create(null);
  for (const key of expectedKeys) {
    if (key === excludedKey) continue;
    const descriptor = Reflect.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !descriptor.enumerable || !("value" in descriptor) ||
        descriptor.get !== undefined || descriptor.set !== undefined) return null;
    descriptors.set(key, descriptor);
    values[key] = descriptor.value;
  }
  const secondKeys = Reflect.ownKeys(value);
  if (Reflect.getPrototypeOf(value) !== prototype || secondKeys.length !== keys.length ||
      secondKeys.some((key, index) => key !== keys[index])) return null;
  for (const [key, descriptor] of descriptors) {
    if (!sameDescriptor(descriptor, Reflect.getOwnPropertyDescriptor(value, key))) return null;
  }
  return Object.freeze({ value, prototype, keys: Object.freeze(keys), descriptors, values: Object.freeze(values) });
}

function unchangedExactObject(snapshot) {
  const currentKeys = Reflect.ownKeys(snapshot.value);
  if (Reflect.getPrototypeOf(snapshot.value) !== snapshot.prototype ||
      currentKeys.length !== snapshot.keys.length ||
      currentKeys.some((key, index) => key !== snapshot.keys[index])) return false;
  for (const [key, descriptor] of snapshot.descriptors) {
    if (!sameDescriptor(descriptor, Reflect.getOwnPropertyDescriptor(snapshot.value, key))) return false;
  }
  return true;
}

function positiveSafeInteger(value) {
  return Number.isSafeInteger(value) && value > 0 && !Object.is(value, -0);
}

function resolveTrustedPidLiveness(source, resolvePidLiveness) {
  const descriptor = Reflect.getOwnPropertyDescriptor(source, "pid");
  if (!descriptor || !descriptor.enumerable || !("value" in descriptor) ||
      descriptor.get !== undefined || descriptor.set !== undefined ||
      !positiveSafeInteger(descriptor.value)) return INVALID_PID_LIVENESS;
  const liveness = resolvePidLiveness(descriptor.value);
  if (!sameDescriptor(descriptor, Reflect.getOwnPropertyDescriptor(source, "pid"))) {
    return INVALID_PID_LIVENESS;
  }
  return liveness;
}

function hasValidSourceScalars(run, event, observedAt) {
  if (typeof run.taskId !== "string" || !TASK_ID.test(run.taskId) ||
      !positiveSafeInteger(run.runId) || !positiveSafeInteger(event.eventId) ||
      !positiveSafeInteger(event.runId) ||
      typeof run.claimCurrent !== "boolean" || typeof run.spawnedEventPresent !== "boolean" ||
      !["fresh", "stale", "unknown", "missing"].includes(run.heartbeatHealth) ||
      !isCanonicalUtc(run.startedAt) || !isCanonicalUtc(observedAt) || !isCanonicalUtc(event.occurredAt)) return false;
  if (Date.parse(run.startedAt) > Date.parse(event.occurredAt) ||
      Date.parse(event.occurredAt) > Date.parse(observedAt)) return false;
  if (run.heartbeatHealth === "missing") {
    if (run.heartbeatAt !== null) return false;
  } else if (!isCanonicalUtc(run.heartbeatAt) || Date.parse(run.heartbeatAt) < Date.parse(run.startedAt) ||
      Date.parse(run.heartbeatAt) > Date.parse(observedAt)) return false;
  if (run.endedAt !== null && (!isCanonicalUtc(run.endedAt) ||
      Date.parse(run.endedAt) < Date.parse(run.startedAt) || Date.parse(run.endedAt) > Date.parse(observedAt) ||
      Date.parse(event.occurredAt) > Date.parse(run.endedAt) ||
      (run.heartbeatAt !== null && Date.parse(run.heartbeatAt) > Date.parse(run.endedAt)))) return false;
  return true;
}

function hasConsistentRunAuthority(run) {
  const event = run.decisiveEvent;
  if (event.runId !== run.runId) return false;
  if (run.runStatus === "running") {
    return run.outcome === null && run.claimCurrent === true && run.endedAt === null &&
      ["spawned", "heartbeat"].includes(event.kind);
  }
  const terminal = {
    blocked: ["blocked", "blocked"],
    done: ["completed", "completed"],
    failed: ["failed", "failed"],
    stale: ["stale", "stale"],
    timed_out: ["timed_out", "timed_out"],
    crashed: ["crashed", "crashed"]
  }[run.runStatus];
  return terminal !== undefined && run.outcome === terminal[0] && run.claimCurrent === false &&
    typeof run.endedAt === "string" && event.kind === terminal[1];
}

export function normalizeHermesPresenceObservation(options) {
  let safeProfileName = null;
  let safeObservedAt = null;
  try {
    if (options === null || typeof options !== "object" || Array.isArray(options)) return null;
    const optionKeys = Reflect.ownKeys(options);
    if (optionKeys.some((key) => typeof key !== "string")) return null;
    const expectedOptionKeys = optionKeys.includes("log")
      ? ADAPTER_OPTION_KEYS_WITH_LOG
      : REQUIRED_ADAPTER_OPTION_KEYS;
    const optionsSnapshot = snapshotExactObject(options, expectedOptionKeys);
    if (optionsSnapshot === null) return null;
    const { profileName, observedAt, resolvePidLiveness, runCandidates } = optionsSnapshot.values;
    if (typeof profileName !== "string" || !PROFILE_NAME.test(profileName) || !isCanonicalUtc(observedAt) ||
        typeof resolvePidLiveness !== "function") return null;
    safeProfileName = profileName;
    safeObservedAt = observedAt;
    const candidates = snapshotCollection(runCandidates);
    if (candidates === null || candidates.length === 0) return closedObservation(profileName, observedAt);
    if (candidates.length !== 1) return ambiguousObservation(profileName, observedAt);
    const runSnapshot = snapshotExactObject(candidates[0], RUN_SOURCE_KEYS, "pid");
    if (runSnapshot === null) return closedObservation(profileName, observedAt);
    const eventSnapshot = snapshotExactObject(runSnapshot.values.decisiveEvent, EVENT_SOURCE_KEYS);
    if (eventSnapshot === null) return closedObservation(profileName, observedAt);
    const event = eventSnapshot.values;
    const run = Object.freeze({ ...runSnapshot.values, decisiveEvent: event });
    if (!hasValidSourceScalars(run, event, observedAt)) return closedObservation(profileName, observedAt);
    if (!hasConsistentRunAuthority(run)) {
      return closedObservation(profileName, observedAt);
    }
    let pidLiveness = "not_applicable";
    if (run.runStatus === "running") {
      pidLiveness = "unknown";
      if (run.spawnedEventPresent) {
        pidLiveness = resolveTrustedPidLiveness(runSnapshot.value, resolvePidLiveness);
        if (pidLiveness === INVALID_PID_LIVENESS) return closedObservation(profileName, observedAt);
      }
    }
    if (!["alive", "dead", "unknown", "not_applicable"].includes(pidLiveness) ||
        !unchangedExactObject(optionsSnapshot) || !unchangedCollection(runCandidates, candidates) ||
        !unchangedExactObject(runSnapshot) ||
        !unchangedExactObject(eventSnapshot)) return closedObservation(profileName, observedAt);
    const disagrees = run.runStatus === "running" &&
      (!run.spawnedEventPresent || pidLiveness !== "alive" || run.heartbeatHealth !== "fresh");

    return Object.freeze({
      schemaVersion: "1.0",
      profileName,
      observedAt,
      sourceStatus: disagrees ? "degraded" : "available",
      reason: disagrees ? "pid_heartbeat_disagreement" : null,
      currentRun: Object.freeze({
        taskId: run.taskId,
        runId: run.runId,
        runStatus: run.runStatus,
        outcome: run.outcome,
        claimCurrent: run.claimCurrent,
        spawnedEventPresent: run.spawnedEventPresent,
        pidLiveness,
        heartbeatAt: run.heartbeatAt,
        startedAt: run.startedAt,
        endedAt: run.endedAt
      }),
      decisiveEvent: Object.freeze({
        eventId: event.eventId,
        kind: event.kind,
        occurredAt: event.occurredAt
      })
    });
  } catch {
    return safeProfileName === null ? null : closedObservation(safeProfileName, safeObservedAt);
  }
}

function sameDescriptor(before, after) {
  return Boolean(before && after &&
    before.enumerable === after.enumerable &&
    before.configurable === after.configurable &&
    before.writable === after.writable &&
    "value" in before && "value" in after &&
    Object.is(before.value, after.value));
}

function snapshotCollection(value) {
  try {
    if (!Array.isArray(value)) return null;
    const lengthDescriptor = Reflect.getOwnPropertyDescriptor(value, "length");
    if (!lengthDescriptor || !("value" in lengthDescriptor) ||
        !Number.isSafeInteger(lengthDescriptor.value) || lengthDescriptor.value < 0 ||
        lengthDescriptor.value > MAX_RESOLUTION_CANDIDATES) return null;

    const length = lengthDescriptor.value;
    const firstKeys = Reflect.ownKeys(value);
    if (firstKeys.some((key) => typeof key !== "string") || firstKeys.length !== length + 1 ||
        !firstKeys.includes("length")) return null;

    const descriptors = new Map([["length", lengthDescriptor]]);
    const values = [];
    for (let index = 0; index < length; index += 1) {
      const key = String(index);
      if (!firstKeys.includes(key)) return null;
      const descriptor = Reflect.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !descriptor.enumerable || !("value" in descriptor) ||
          descriptor.get !== undefined || descriptor.set !== undefined) return null;
      descriptors.set(key, descriptor);
      values.push(descriptor.value);
    }

    const secondKeys = Reflect.ownKeys(value);
    if (secondKeys.length !== firstKeys.length ||
        secondKeys.some((key, index) => key !== firstKeys[index])) return null;
    for (const [key, before] of descriptors) {
      if (!sameDescriptor(before, Reflect.getOwnPropertyDescriptor(value, key))) return null;
    }
    return Object.freeze(values);
  } catch {
    return null;
  }
}

function unchangedCollection(value, snapshot) {
  const current = snapshotCollection(value);
  return current !== null && current.length === snapshot.length &&
    current.every((entry, index) => Object.is(entry, snapshot[index]));
}

function snapshotReviewedMapping(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  const prototype = Reflect.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return null;

  const firstKeys = Reflect.ownKeys(value);
  if (firstKeys.length !== REVIEWED_MAPPING_KEYS.length ||
      firstKeys.some((key) => typeof key !== "string") ||
      firstKeys.slice().sort().some((key, index) => key !== REVIEWED_MAPPING_KEYS[index])) return null;

  const descriptors = new Map();
  const values = new Map();
  for (const key of REVIEWED_MAPPING_KEYS) {
    const descriptor = Reflect.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !descriptor.enumerable || !("value" in descriptor) ||
        descriptor.get !== undefined || descriptor.set !== undefined) return null;
    descriptors.set(key, descriptor);
    values.set(key, descriptor.value);
  }

  const secondKeys = Reflect.ownKeys(value);
  if (Reflect.getPrototypeOf(value) !== prototype || secondKeys.length !== firstKeys.length ||
      secondKeys.some((key) => typeof key !== "string") ||
      secondKeys.slice().sort().some((key, index) => key !== REVIEWED_MAPPING_KEYS[index])) return null;
  for (const [key, before] of descriptors) {
    if (!sameDescriptor(before, Reflect.getOwnPropertyDescriptor(value, key))) return null;
  }

  return Object.freeze({
    schemaVersion: values.get("schemaVersion"),
    tenantId: values.get("tenantId"),
    subjectId: values.get("subjectId"),
    identityId: values.get("identityId"),
    profileName: values.get("profileName"),
    registryRevision: values.get("registryRevision"),
    synchronizedAt: values.get("synchronizedAt"),
    status: values.get("status")
  });
}

function isCanonicalUtc(value) {
  if (typeof value !== "string" || !CANONICAL_UTC.test(value)) return false;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value;
}

function hasValidReviewedMappingScalars(value, evaluatedAt) {
  return value.schemaVersion === "1.0" &&
    typeof value.tenantId === "string" && OPAQUE_ID.test(value.tenantId) &&
    typeof value.subjectId === "string" && OPAQUE_ID.test(value.subjectId) &&
    value.identityId === "stg-spiders" &&
    typeof value.profileName === "string" && PROFILE_NAME.test(value.profileName) &&
    Number.isSafeInteger(value.registryRevision) && value.registryRevision >= 0 &&
    !Object.is(value.registryRevision, -0) &&
    isCanonicalUtc(value.synchronizedAt) && isCanonicalUtc(evaluatedAt) &&
    Date.parse(value.synchronizedAt) <= Date.parse(evaluatedAt) &&
    ["active", "revoked", "retired"].includes(value.status);
}

export function resolveReviewedHostedIdentityMapping(options) {
  try {
    if (options === null || typeof options !== "object") return INVALID;
    const mappingCandidates = options.mappingCandidates;
    const installedProfileNames = options.installedProfileNames;
    const evaluatedAt = options.evaluatedAt;
    const validateMapping = options.validateMapping;
    if (typeof validateMapping !== "function") return INVALID;

    const mappings = snapshotCollection(mappingCandidates);
    const profiles = snapshotCollection(installedProfileNames);
    if (!mappings || !profiles || mappings.length !== 1 || profiles.length !== 1) return INVALID;

    const reviewed = validateMapping(mappings[0], evaluatedAt);
    const reviewedValue = reviewed !== null && typeof reviewed === "object" && reviewed.ok === true
      ? snapshotReviewedMapping(reviewed.value)
      : null;
    if (!unchangedCollection(mappingCandidates, mappings) ||
        !unchangedCollection(installedProfileNames, profiles) ||
        reviewedValue === null || !hasValidReviewedMappingScalars(reviewedValue, evaluatedAt) ||
        reviewedValue.status !== "active" ||
        reviewedValue.identityId !== "stg-spiders" || profiles[0] !== reviewedValue.profileName) return INVALID;

    return Object.freeze({ ok: true, value: reviewedValue });
  } catch {
    return INVALID;
  }
}
