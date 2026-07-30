const INVALID = Object.freeze({ ok: false, code: "invalid_hosted_agent_mapping" });
const MAX_RESOLUTION_CANDIDATES = 2;
const REVIEWED_MAPPING_KEYS = Object.freeze([
  "identityId", "profileName", "registryRevision", "schemaVersion", "status", "subjectId",
  "synchronizedAt", "tenantId"
]);
const OPAQUE_ID = /^id_[a-f0-9]{16,64}$/;
const PROFILE_NAME = /^[a-z][a-z0-9_-]{0,63}$/;
const CANONICAL_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

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
