import { resolveReviewedHostedIdentityMapping } from "./hermesPresenceAdapter.mjs";

const TENANT_ID = /^id_[a-f0-9]{16,64}$/;
const CANONICAL_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const SESSION_KEYS = Object.freeze(["authenticated", "sessionId", "subjectId"]);
const MEMBERSHIP_KEYS = Object.freeze([
  "active", "authorizationRef", "permissions", "policyRevision", "subjectId", "tenantId"
]);
const PRIVATE_HEADERS = Object.freeze({
  "Cache-Control": "private, no-store",
  "Content-Type": "application/json; charset=utf-8",
  "Vary": "Authorization",
  "X-Content-Type-Options": "nosniff"
});
const NOT_FOUND = Object.freeze({ error: "not_found" });
const CACHE_KEYS = Object.freeze([
  "action", "authorizationRef", "mappingRevision", "policyRevision", "projection", "recordId", "schemaVersion",
  "subjectId", "tenantId"
]);
const RESPONSE_KEYS = Object.freeze(["generatedAt", "presence", "schemaVersion", "tenantId"]);
const PRESENCE_KEYS = Object.freeze([
  "checkedAt", "displayName", "freshness", "identityId", "observedAt", "reason", "recordRef", "roleLabel",
  "state", "stateChangedAt", "workplace"
]);
const WORKPLACE_KEYS = Object.freeze(["id", "label", "relationship"]);
const RECORD_REF_KEYS = Object.freeze(["href", "recordId"]);
const POLICY_VERDICT_KEYS = Object.freeze(["policyRevision", "verdict"]);

function sendJson(response, status, body) {
  const payload = JSON.stringify(body);
  response.writeHead(status, {
    ...PRIVATE_HEADERS,
    "Content-Length": Buffer.byteLength(payload)
  });
  response.end(payload);
}

function deny(response) {
  sendJson(response, 404, NOT_FOUND);
}

function parseRoute(rawUrl) {
  if (typeof rawUrl !== "string" || rawUrl.includes("?") || rawUrl.includes("#")) return null;
  const match = /^\/api\/private\/tenants\/([^/]+)\/hosted-agent-presence$/.exec(rawUrl);
  if (match === null || !TENANT_ID.test(match[1])) return null;
  return Object.freeze({ tenantId: match[1] });
}

function hasSingleBearerAuthorization(rawHeaders) {
  if (!Array.isArray(rawHeaders) || rawHeaders.length > 128 || rawHeaders.length % 2 !== 0) return false;
  let authorization = null;
  for (let index = 0; index < rawHeaders.length; index += 2) {
    const name = rawHeaders[index];
    const value = rawHeaders[index + 1];
    if (typeof name !== "string" || typeof value !== "string") return false;
    if (name.toLowerCase() !== "authorization") continue;
    if (authorization !== null) return false;
    authorization = value;
  }
  return authorization !== null && /^Bearer [A-Za-z0-9._~+/-]+=*$/.test(authorization);
}

function hasZeroBody(rawHeaders) {
  let contentLength = null;
  for (let index = 0; index < rawHeaders.length; index += 2) {
    const name = rawHeaders[index].toLowerCase();
    const value = rawHeaders[index + 1];
    if (name === "transfer-encoding") return false;
    if (name !== "content-length") continue;
    if (contentLength !== null) return false;
    contentLength = value;
  }
  return contentLength === null || contentLength === "0";
}

function snapshotObject(value, expectedKeys) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  const prototype = Reflect.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return null;
  const firstKeys = Reflect.ownKeys(value);
  const sorted = firstKeys.slice().sort();
  if (firstKeys.some((key) => typeof key !== "string") || sorted.length !== expectedKeys.length ||
      sorted.some((key, index) => key !== expectedKeys[index])) return null;
  const descriptors = new Map();
  const snapshot = {};
  for (const key of expectedKeys) {
    const descriptor = Reflect.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !descriptor.enumerable || !("value" in descriptor) ||
        descriptor.get !== undefined || descriptor.set !== undefined) return null;
    descriptors.set(key, descriptor);
    snapshot[key] = descriptor.value;
  }
  const secondKeys = Reflect.ownKeys(value).slice().sort();
  if (Reflect.getPrototypeOf(value) !== prototype || secondKeys.length !== expectedKeys.length ||
      secondKeys.some((key, index) => key !== expectedKeys[index])) return null;
  for (const [key, descriptor] of descriptors) {
    const current = Reflect.getOwnPropertyDescriptor(value, key);
    if (!current || current.enumerable !== descriptor.enumerable ||
        current.configurable !== descriptor.configurable || current.writable !== descriptor.writable ||
        !("value" in current) || !Object.is(current.value, descriptor.value)) return null;
  }
  return Object.freeze(snapshot);
}

function snapshotPermissions(value) {
  if (!Array.isArray(value)) return null;
  const lengthDescriptor = Reflect.getOwnPropertyDescriptor(value, "length");
  if (!lengthDescriptor || !("value" in lengthDescriptor) ||
      !Number.isSafeInteger(lengthDescriptor.value) || lengthDescriptor.value < 1 ||
      lengthDescriptor.value > 32) return null;
  const length = lengthDescriptor.value;
  const firstKeys = Reflect.ownKeys(value);
  if (firstKeys.some((key) => typeof key !== "string") || firstKeys.length !== length + 1 ||
      !firstKeys.includes("length")) return null;
  const permissions = [];
  const descriptors = new Map([["length", lengthDescriptor]]);
  for (let index = 0; index < length; index += 1) {
    const descriptor = Reflect.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor || !descriptor.enumerable || !("value" in descriptor) ||
        typeof descriptor.value !== "string") return null;
    descriptors.set(String(index), descriptor);
    permissions.push(descriptor.value);
  }
  const secondKeys = Reflect.ownKeys(value);
  if (secondKeys.length !== firstKeys.length ||
      secondKeys.some((key, index) => key !== firstKeys[index])) return null;
  for (const [key, descriptor] of descriptors) {
    const current = Reflect.getOwnPropertyDescriptor(value, key);
    if (!current || current.enumerable !== descriptor.enumerable ||
        current.configurable !== descriptor.configurable || current.writable !== descriptor.writable ||
        !("value" in current) || !Object.is(current.value, descriptor.value)) return null;
  }
  if (new Set(permissions).size !== permissions.length) return null;
  return Object.freeze(permissions);
}

function snapshotSession(value) {
  const session = snapshotObject(value, SESSION_KEYS);
  return session && session.authenticated === true && typeof session.subjectId === "string" &&
    TENANT_ID.test(session.subjectId) &&
    typeof session.sessionId === "string" && session.sessionId.length > 0 && session.sessionId.length <= 128
    ? session : null;
}

function snapshotMembership(value) {
  const membership = snapshotObject(value, MEMBERSHIP_KEYS);
  if (!membership || membership.active !== true || typeof membership.tenantId !== "string" ||
      typeof membership.subjectId !== "string" || !TENANT_ID.test(membership.tenantId) ||
      !TENANT_ID.test(membership.subjectId) || typeof membership.authorizationRef !== "string" ||
      membership.authorizationRef.length < 1 || membership.authorizationRef.length > 128 ||
      !Number.isSafeInteger(membership.policyRevision) || Object.is(membership.policyRevision, -0) ||
      membership.policyRevision < 0) return null;
  const permissions = snapshotPermissions(membership.permissions);
  return permissions === null ? null : Object.freeze({ ...membership, permissions });
}

function sameAuthorization(left, right) {
  return left !== null && right !== null && left.active === right.active &&
    left.tenantId === right.tenantId && left.subjectId === right.subjectId &&
    left.authorizationRef === right.authorizationRef && left.policyRevision === right.policyRevision &&
    left.permissions.length === right.permissions.length &&
    left.permissions.every((permission, index) => permission === right.permissions[index]);
}

function sameSession(left, right) {
  return left !== null && right !== null && left.authenticated === right.authenticated &&
    left.sessionId === right.sessionId && left.subjectId === right.subjectId;
}

function isCanonicalUtc(value) {
  if (typeof value !== "string" || !CANONICAL_UTC.test(value)) return false;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value;
}

function sameKeys(value, expected) {
  const keys = Object.keys(value).sort();
  return keys.length === expected.length && keys.every((key, index) => key === expected[index]);
}

function snapshotClosedValue(value, budget = { nodes: 0 }, depth = 0) {
  try {
    if (value === null || typeof value !== "object") return value;
    if (Array.isArray(value) || depth > 8 || ++budget.nodes > 32) return undefined;
    const prototype = Reflect.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return undefined;
    const keys = Reflect.ownKeys(value);
    if (keys.length > 32 || keys.some((key) => typeof key !== "string")) return undefined;
    const descriptors = new Map();
    for (const key of keys) {
      const descriptor = Reflect.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !descriptor.enumerable || !("value" in descriptor) ||
          descriptor.get !== undefined || descriptor.set !== undefined) return undefined;
      descriptors.set(key, descriptor);
    }
    const snapshot = {};
    for (const key of keys) {
      const field = descriptors.get(key).value;
      const detached = snapshotClosedValue(field, budget, depth + 1);
      if (detached === undefined) return undefined;
      snapshot[key] = detached;
    }
    const finalKeys = Reflect.ownKeys(value);
    if (finalKeys.length !== keys.length || finalKeys.some((key, index) => key !== keys[index])) return undefined;
    for (const key of keys) {
      const before = descriptors.get(key);
      const after = Reflect.getOwnPropertyDescriptor(value, key);
      if (!after || !("value" in after) || before.enumerable !== after.enumerable ||
          before.configurable !== after.configurable || before.writable !== after.writable ||
          !Object.is(before.value, after.value)) return undefined;
    }
    return Object.freeze(snapshot);
  } catch {
    return undefined;
  }
}

function validCurrentProjection(value, tenantId, evaluatedAt) {
  const response = snapshotClosedValue(value);
  if (!response || typeof response !== "object" || !sameKeys(response, RESPONSE_KEYS) ||
      response.schemaVersion !== "1.0" || response.tenantId !== tenantId ||
      !isCanonicalUtc(response.generatedAt) || Date.parse(response.generatedAt) > Date.parse(evaluatedAt) ||
      !response.presence || typeof response.presence !== "object") return null;
  const presence = response.presence;
  if (!sameKeys(presence, PRESENCE_KEYS) || presence.identityId !== "stg-spiders" ||
      presence.displayName !== "Spiders" || presence.roleLabel !== "Chief Agent" ||
      !presence.workplace || typeof presence.workplace !== "object" ||
      !sameKeys(presence.workplace, WORKPLACE_KEYS) || presence.workplace.id !== "stg-chief-agent-office" ||
      presence.workplace.label !== "Chief Agent Office" || presence.workplace.relationship !== "designated" ||
      !["working", "blocked", "completed"].includes(presence.state) ||
      !["live", "recent"].includes(presence.freshness) || presence.reason !== null ||
      !isCanonicalUtc(presence.stateChangedAt) || !isCanonicalUtc(presence.observedAt) ||
      !isCanonicalUtc(presence.checkedAt) || Date.parse(presence.stateChangedAt) > Date.parse(presence.observedAt) ||
      Date.parse(presence.observedAt) > Date.parse(presence.checkedAt) ||
      Date.parse(presence.checkedAt) > Date.parse(response.generatedAt) ||
      !presence.recordRef || typeof presence.recordRef !== "object" ||
      !sameKeys(presence.recordRef, RECORD_REF_KEYS) || !TENANT_ID.test(presence.recordRef.recordId) ||
      presence.recordRef.href !== `/api/private/tenants/${tenantId}/records/${presence.recordRef.recordId}`) return null;
  return response;
}

function retainedAuthorizationFacts(cache) {
  return Object.freeze({
    tenantId: cache.tenantId,
    subjectId: cache.subjectId,
    mappingRevision: cache.mappingRevision,
    recordId: cache.recordId,
    action: cache.action,
    authorizationRef: cache.authorizationRef,
    policyRevision: cache.policyRevision
  });
}

function sameMapping(left, right) {
  return left && right && left.schemaVersion === right.schemaVersion && left.tenantId === right.tenantId &&
    left.subjectId === right.subjectId && left.identityId === right.identityId && left.profileName === right.profileName &&
    left.registryRevision === right.registryRevision && left.synchronizedAt === right.synchronizedAt &&
    left.status === right.status;
}

function unavailablePresence(reason, checkedAt) {
  return {
    identityId: "stg-spiders",
    displayName: "Spiders",
    roleLabel: "Chief Agent",
    workplace: {
      id: "stg-chief-agent-office",
      label: "Chief Agent Office",
      relationship: "designated"
    },
    state: "unavailable",
    freshness: "unavailable",
    reason,
    stateChangedAt: null,
    observedAt: null,
    checkedAt,
    recordRef: null
  };
}

export function createPrivateHostedAgentPresenceApiHandler({
  now,
  resolveTrustedSession,
  resolveTrustedMembership,
  readMappingCandidates,
  installedProfileNames,
  validateMapping,
  readCurrentPresence,
  readLastValidatedPresence,
  authorizeRetainedPresence,
  evaluateStaleRetention
}) {
  if (typeof now !== "function" || typeof resolveTrustedSession !== "function" ||
      typeof resolveTrustedMembership !== "function" || typeof readMappingCandidates !== "function" ||
      !Array.isArray(installedProfileNames) || typeof validateMapping !== "function" ||
      (readCurrentPresence !== undefined && typeof readCurrentPresence !== "function") ||
      (readLastValidatedPresence !== undefined && typeof readLastValidatedPresence !== "function") ||
      (authorizeRetainedPresence !== undefined && typeof authorizeRetainedPresence !== "function") ||
      (evaluateStaleRetention !== undefined && typeof evaluateStaleRetention !== "function") ||
      typeof resolveReviewedHostedIdentityMapping !== "function") {
    throw new TypeError("private hosted-presence dependencies are required");
  }

  return async function privateHostedAgentPresenceApiHandler(request, response) {
    try {
      const route = parseRoute(request.url);
      if (route === null || request.method !== "GET" ||
          !hasSingleBearerAuthorization(request.rawHeaders) ||
          !hasZeroBody(request.rawHeaders)) return deny(response);

      const sessionSource = resolveTrustedSession(request);
      const session = snapshotSession(sessionSource);
      if (session === null) return deny(response);
      const membership = snapshotMembership(resolveTrustedMembership({ session: sessionSource }));
      if (membership === null || membership.tenantId !== route.tenantId ||
          membership.subjectId !== session.subjectId ||
          !membership.permissions.includes("read_hosted_agent_presence")) {
        return deny(response);
      }

      let checkedAt;
      try {
        checkedAt = now();
      } catch {
        checkedAt = null;
      }
      if (!isCanonicalUtc(checkedAt)) {
        if (readCurrentPresence === undefined) return deny(response);
        const closureMappingCandidates = readMappingCandidates({
          tenantId: membership.tenantId,
          identityId: "stg-spiders"
        });
        let closedAt;
        try {
          closedAt = now();
        } catch {
          return deny(response);
        }
        if (!isCanonicalUtc(closedAt)) return deny(response);
        const closureMapping = resolveReviewedHostedIdentityMapping({
          mappingCandidates: closureMappingCandidates,
          installedProfileNames,
          evaluatedAt: closedAt,
          validateMapping
        });
        const currentClosureMapping = resolveReviewedHostedIdentityMapping({
          mappingCandidates: readMappingCandidates({
            tenantId: membership.tenantId,
            identityId: "stg-spiders"
          }),
          installedProfileNames,
          evaluatedAt: closedAt,
          validateMapping
        });
        const closureSessionSource = resolveTrustedSession(request);
        const closureSession = snapshotSession(closureSessionSource);
        const closureMembership = closureSession &&
          snapshotMembership(resolveTrustedMembership({ session: closureSessionSource }));
        if (!sameSession(session, closureSession) || !sameAuthorization(membership, closureMembership) ||
            !closureMapping.ok || closureMapping.value.tenantId !== membership.tenantId ||
            closureMapping.value.subjectId !== membership.subjectId || !currentClosureMapping.ok ||
            !sameMapping(closureMapping.value, currentClosureMapping.value)) return deny(response);
        return sendJson(response, 200, {
          schemaVersion: "1.0",
          tenantId: membership.tenantId,
          generatedAt: closedAt,
          presence: unavailablePresence("clock_invalid", closedAt)
        });
      }
      const mapping = resolveReviewedHostedIdentityMapping({
        mappingCandidates: readMappingCandidates({ tenantId: membership.tenantId, identityId: "stg-spiders" }),
        installedProfileNames,
        evaluatedAt: checkedAt,
        validateMapping
      });
      if (!mapping.ok || mapping.value.tenantId !== membership.tenantId ||
          mapping.value.subjectId !== membership.subjectId) return deny(response);
      const mappingStillCurrent = () => {
        const current = resolveReviewedHostedIdentityMapping({
          mappingCandidates: readMappingCandidates({ tenantId: membership.tenantId, identityId: "stg-spiders" }),
          installedProfileNames,
          evaluatedAt: generatedAt,
          validateMapping
        });
        return current.ok && sameMapping(mapping.value, current.value);
      };
      const authorityStillCurrent = () => {
        const currentSessionSource = resolveTrustedSession(request);
        const currentSession = snapshotSession(currentSessionSource);
        if (!sameSession(session, currentSession)) return false;
        const currentMembership = snapshotMembership(resolveTrustedMembership({ session: currentSessionSource }));
        return sameAuthorization(membership, currentMembership) && mappingStillCurrent();
      };

      let generatedAt = checkedAt;
      let clockValid = true;
      if (readCurrentPresence !== undefined) {
        try {
          const candidate = now();
          if (isCanonicalUtc(candidate) && Date.parse(checkedAt) <= Date.parse(candidate)) generatedAt = candidate;
          else clockValid = false;
        } catch {
          clockValid = false;
        }
      }

      const reauthorizedSessionSource = resolveTrustedSession(request);
      const reauthorizedSession = snapshotSession(reauthorizedSessionSource);
      if (!sameSession(session, reauthorizedSession)) return deny(response);
      const reauthorized = snapshotMembership(resolveTrustedMembership({ session: reauthorizedSessionSource }));
      if (!sameAuthorization(membership, reauthorized)) return deny(response);
      if (readCurrentPresence !== undefined && !mappingStillCurrent()) return deny(response);
      if (readCurrentPresence !== undefined && !clockValid) {
        return sendJson(response, 200, {
          schemaVersion: "1.0",
          tenantId: membership.tenantId,
          generatedAt,
          presence: unavailablePresence("clock_invalid", checkedAt)
        });
      }
      if (readCurrentPresence !== undefined) {
        let sourceReadCompleted = false;
        try {
          const current = await readCurrentPresence(Object.freeze({
            tenantId: membership.tenantId,
            subjectId: membership.subjectId,
            mappingRevision: mapping.value.registryRevision,
            checkedAt,
            generatedAt
          }));
          sourceReadCompleted = true;
          if (!authorityStillCurrent()) return deny(response);
          const fresh = validCurrentProjection(current, membership.tenantId, generatedAt);
          if (fresh === null || typeof authorizeRetainedPresence !== "function") {
            return sendJson(response, 200, {
              schemaVersion: "1.0",
              tenantId: membership.tenantId,
              generatedAt,
              presence: unavailablePresence("source_stale", checkedAt)
            });
          }
          const authorization = Object.freeze({
            tenantId: membership.tenantId,
            subjectId: membership.subjectId,
            mappingRevision: mapping.value.registryRevision,
            recordId: fresh.presence.recordRef.recordId,
            action: "read_hosted_agent_presence",
            authorizationRef: membership.authorizationRef,
            policyRevision: membership.policyRevision
          });
          if (await authorizeRetainedPresence(authorization) !== true) return deny(response);
          const finalSessionSource = resolveTrustedSession(request);
          const finalSession = snapshotSession(finalSessionSource);
          const finalMembership = finalSession && snapshotMembership(resolveTrustedMembership({ session: finalSessionSource }));
          if (!sameSession(session, finalSession) || !sameAuthorization(membership, finalMembership) ||
              !mappingStillCurrent() ||
              await authorizeRetainedPresence(authorization) !== true) return deny(response);
          const serializationSessionSource = resolveTrustedSession(request);
          const serializationSession = snapshotSession(serializationSessionSource);
          const serializationMembership = serializationSession &&
            snapshotMembership(resolveTrustedMembership({ session: serializationSessionSource }));
          if (!sameSession(session, serializationSession) ||
              !sameAuthorization(membership, serializationMembership) || !mappingStillCurrent()) return deny(response);
          return sendJson(response, 200, fresh);
        } catch {
          if (sourceReadCompleted) return deny(response);
          if (!authorityStillCurrent()) return deny(response);
          let cache;
          try {
            cache = snapshotClosedValue(await readLastValidatedPresence?.());
          } catch {
            cache = null;
          }
          if (!authorityStillCurrent()) return deny(response);
          const prior = cache && sameKeys(cache, CACHE_KEYS) && cache.schemaVersion === "1.0" &&
            cache.tenantId === membership.tenantId && cache.subjectId === membership.subjectId &&
            cache.mappingRevision === mapping.value.registryRevision && cache.action === "read_hosted_agent_presence" &&
            cache.authorizationRef === membership.authorizationRef && cache.policyRevision === membership.policyRevision &&
            TENANT_ID.test(cache.recordId) ? validCurrentProjection(cache.projection, membership.tenantId, checkedAt) : null;
          if (prior === null || prior.presence.recordRef.recordId !== cache.recordId ||
              typeof authorizeRetainedPresence !== "function" || typeof evaluateStaleRetention !== "function") {
            return sendJson(response, 200, {
              schemaVersion: "1.0",
              tenantId: membership.tenantId,
              generatedAt,
              presence: unavailablePresence("source_stale", checkedAt)
            });
          }
          const authorization = retainedAuthorizationFacts(cache);
          if (await authorizeRetainedPresence(authorization) !== true) return deny(response);
          let verdict;
          try {
            verdict = snapshotClosedValue(await evaluateStaleRetention(Object.freeze({
              verdictRequired: "closed",
              ...authorization,
              observedAt: prior.presence.observedAt,
              stateChangedAt: prior.presence.stateChangedAt,
              checkedAt
            })));
          } catch {
            authorityStillCurrent();
            return deny(response);
          }
          if (!authorityStillCurrent()) return deny(response);
          if (!verdict || !sameKeys(verdict, POLICY_VERDICT_KEYS) ||
              !["retain", "expired"].includes(verdict.verdict) ||
              verdict.policyRevision !== membership.policyRevision) {
            return sendJson(response, 200, {
              schemaVersion: "1.0",
              tenantId: membership.tenantId,
              generatedAt,
              presence: unavailablePresence("source_stale", checkedAt)
            });
          }
          const finalSessionSource = resolveTrustedSession(request);
          const finalSession = snapshotSession(finalSessionSource);
          const finalMembership = finalSession && snapshotMembership(resolveTrustedMembership({ session: finalSessionSource }));
          if (!sameSession(session, finalSession) || !sameAuthorization(membership, finalMembership) ||
              !mappingStillCurrent() ||
              await authorizeRetainedPresence(authorization) !== true) return deny(response);
          const serializationSessionSource = resolveTrustedSession(request);
          const serializationSession = snapshotSession(serializationSessionSource);
          const serializationMembership = serializationSession &&
            snapshotMembership(resolveTrustedMembership({ session: serializationSessionSource }));
          if (!sameSession(session, serializationSession) ||
              !sameAuthorization(membership, serializationMembership) || !mappingStillCurrent()) return deny(response);
          if (verdict.verdict === "expired") {
            return sendJson(response, 200, {
              schemaVersion: "1.0",
              tenantId: membership.tenantId,
              generatedAt,
              presence: unavailablePresence("source_stale", checkedAt)
            });
          }
          return sendJson(response, 200, {
            schemaVersion: "1.0",
            tenantId: membership.tenantId,
            generatedAt,
            presence: {
              ...prior.presence,
              freshness: "stale",
              reason: "source_stale",
              checkedAt
            }
          });
        }
      }
      return sendJson(response, 200, {
        schemaVersion: "1.0",
        tenantId: membership.tenantId,
        generatedAt,
        presence: null
      });
    } catch {
      return deny(response);
    }
  };
}
