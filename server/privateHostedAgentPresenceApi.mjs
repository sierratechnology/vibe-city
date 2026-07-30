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

export function createPrivateHostedAgentPresenceApiHandler({
  now,
  resolveTrustedSession,
  resolveTrustedMembership,
  readMappingCandidates,
  installedProfileNames,
  validateMapping
}) {
  if (typeof now !== "function" || typeof resolveTrustedSession !== "function" ||
      typeof resolveTrustedMembership !== "function" || typeof readMappingCandidates !== "function" ||
      !Array.isArray(installedProfileNames) || typeof validateMapping !== "function" ||
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

      const generatedAt = now();
      if (!isCanonicalUtc(generatedAt)) return deny(response);
      const mapping = resolveReviewedHostedIdentityMapping({
        mappingCandidates: readMappingCandidates({ tenantId: membership.tenantId, identityId: "stg-spiders" }),
        installedProfileNames,
        evaluatedAt: generatedAt,
        validateMapping
      });
      if (!mapping.ok || mapping.value.tenantId !== membership.tenantId ||
          mapping.value.subjectId !== membership.subjectId) return deny(response);

      const reauthorizedSessionSource = resolveTrustedSession(request);
      const reauthorizedSession = snapshotSession(reauthorizedSessionSource);
      if (!sameSession(session, reauthorizedSession)) return deny(response);
      const reauthorized = snapshotMembership(resolveTrustedMembership({ session: reauthorizedSessionSource }));
      if (!sameAuthorization(membership, reauthorized)) return deny(response);
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
