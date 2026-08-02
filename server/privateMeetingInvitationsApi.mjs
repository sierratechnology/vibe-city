import { isProxy } from "node:util/types";

const bufferByteLength = Buffer.byteLength.bind(Buffer);
const bufferConcat = Buffer.concat.bind(Buffer);
const bufferToString = Function.call.bind(Buffer.prototype.toString);
const arrayIsArray = Array.isArray;
const arrayPush = Function.call.bind(Array.prototype.push);
const jsonParse = JSON.parse.bind(JSON);
const jsonStringify = JSON.stringify.bind(JSON);
const numberIsSafeInteger = Number.isSafeInteger;
const objectCreate = Object.create;
const objectDefineProperty = Object.defineProperty;
const objectFreeze = Object.freeze;
const objectGetOwnPropertyDescriptors = Object.getOwnPropertyDescriptors;
const objectGetPrototypeOf = Object.getPrototypeOf;
const objectIs = Object.is;
const reflectOwnKeys = Reflect.ownKeys;
const regexpExec = Function.call.bind(RegExp.prototype.exec);
const regexpTest = Function.call.bind(RegExp.prototype.test);
const stringIncludes = Function.call.bind(String.prototype.includes);
const stringSlice = Function.call.bind(String.prototype.slice);
const stringToLowerCase = Function.call.bind(String.prototype.toLowerCase);

const MAX_BODY_BYTES = 16_384;
const PRIVATE_HEADERS = objectFreeze({
  "Cache-Control": "private, no-store",
  "Content-Type": "application/json; charset=utf-8",
  "Vary": "Authorization",
  "X-Content-Type-Options": "nosniff"
});
const NOT_FOUND = objectFreeze({ error: "not_found" });
const TENANT = /^syn-tenant-[a-z0-9]+(?:-[a-z0-9]+)*$/;
const REFERENCE = /^syn-[a-z0-9]+(?:-[a-z0-9]+)*--[a-z0-9]+(?:-[a-z0-9]+)*$/;
const BEARER = /^Bearer [A-Za-z0-9._~+/-]+=*$/;
const DECIMAL = /^(?:0|[1-9]\d*)$/;
const OPTIONS_KEYS = objectFreeze([
  "repository", "now", "resolveTrustedSession", "resolveTrustedMembership", "evaluatePolicy"
]);
const SESSION_KEYS = objectFreeze(["authenticated", "sessionId", "subjectId"]);
const MEMBERSHIP_KEYS = objectFreeze([
  "active", "tenantId", "subjectId", "actionGrants", "authorizationReference", "policyRevision"
]);
const ISSUE_KEYS = objectFreeze([
  "invitationId", "intendedRecipientSubjectId", "purposeReference", "materialReferences",
  "validFrom", "expiresAt", "revocationAuthoritySubjectId", "sourceReference", "expectedRevision"
]);
const REVISION_KEYS = objectFreeze(["expectedRevision"]);

function sameKeys(keys, expected) {
  if (keys.length !== expected.length) return false;
  for (let index = 0; index < expected.length; index += 1) {
    let found = false;
    for (let candidate = 0; candidate < keys.length; candidate += 1) {
      if (keys[candidate] === expected[index]) found = true;
    }
    if (!found) return false;
  }
  return true;
}

function snapshotObject(value, expected) {
  if (value === null || typeof value !== "object" || isProxy(value)) return null;
  const prototype = objectGetPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return null;
  const descriptors = objectGetOwnPropertyDescriptors(value);
  const keys = reflectOwnKeys(value);
  if (!sameKeys(keys, expected)) return null;
  const copy = objectCreate(null);
  for (let index = 0; index < expected.length; index += 1) {
    const key = expected[index];
    const descriptor = descriptors[key];
    if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) return null;
    objectDefineProperty(copy, key, {
      configurable: true, enumerable: true, value: descriptor.value, writable: true
    });
  }
  return copy;
}

function snapshotArray(value, maximum = 32) {
  if (!arrayIsArray(value) || isProxy(value) || value.length < 1 || value.length > maximum) return null;
  const descriptors = objectGetOwnPropertyDescriptors(value);
  const keys = reflectOwnKeys(value);
  if (keys.length !== value.length + 1 || keys[keys.length - 1] !== "length") return null;
  const copy = [];
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = descriptors[String(index)];
    if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) return null;
    copy.push(descriptor.value);
  }
  return copy;
}

function isTenant(value) {
  return typeof value === "string" && value.length <= 128 && regexpTest(TENANT, value);
}

function isScopedReference(value, tenantId) {
  return typeof value === "string" && value.length <= 128 && regexpTest(REFERENCE, value) &&
    stringSlice(value, 0, tenantId.length + 2) === `${tenantId}--`;
}

function parseRoute(rawUrl) {
  if (typeof rawUrl !== "string" || rawUrl.length > 512 ||
      stringIncludes(rawUrl, "?") || stringIncludes(rawUrl, "#")) return null;
  let match = regexpExec(/^\/api\/private\/tenants\/([^/]+)\/meeting-invitations$/, rawUrl);
  if (match && isTenant(match[1])) return objectFreeze({ tenantId: match[1], invitationId: null, mode: "collection" });
  match = regexpExec(/^\/api\/private\/tenants\/([^/]+)\/meeting-invitations\/([^/]+)$/, rawUrl);
  if (match && isTenant(match[1]) && isScopedReference(match[2], match[1])) {
    return objectFreeze({ tenantId: match[1], invitationId: match[2], mode: "invitation" });
  }
  match = regexpExec(
    /^\/api\/private\/tenants\/([^/]+)\/meeting-invitations\/([^/]+)\/(accept|revoke|audit)$/,
    rawUrl
  );
  if (match && isTenant(match[1]) && isScopedReference(match[2], match[1])) {
    return objectFreeze({ tenantId: match[1], invitationId: match[2], mode: match[3] });
  }
  return null;
}

function inspectHeaders(rawHeaders, wantsBody) {
  const headers = snapshotArray(rawHeaders, 128);
  if (!headers || headers.length % 2 !== 0) return null;
  let authorization = null;
  let contentLength = null;
  let contentType = null;
  for (let index = 0; index < headers.length; index += 2) {
    const name = headers[index];
    const value = headers[index + 1];
    if (typeof name !== "string" || typeof value !== "string") return null;
    const lower = stringToLowerCase(name);
    if (lower === "transfer-encoding") return null;
    if (lower === "authorization") {
      if (authorization !== null) return null;
      authorization = value;
    } else if (lower === "content-length") {
      if (contentLength !== null || !regexpTest(DECIMAL, value)) return null;
      contentLength = Number(value);
    } else if (lower === "content-type") {
      if (contentType !== null) return null;
      contentType = stringToLowerCase(value);
    }
  }
  if (authorization === null || !regexpTest(BEARER, authorization)) return null;
  if (wantsBody) {
    if (!numberIsSafeInteger(contentLength) || contentLength < 2 || contentLength > MAX_BODY_BYTES ||
        contentType !== "application/json") return null;
  } else if ((contentLength !== null && contentLength !== 0) || contentType !== null) return null;
  return objectFreeze({ authorization, contentLength: contentLength ?? 0 });
}

function hasDuplicateJsonKeys(text) {
  const matches = text.matchAll(/"((?:[^"\\]|\\.)*)"\s*:/g);
  const keys = new Set();
  for (const match of matches) {
    const key = jsonParse(`"${match[1]}"`);
    if (keys.has(key)) return true;
    keys.add(key);
  }
  return false;
}

async function readJsonBody(request, expectedLength) {
  try {
    let size = 0;
    const chunks = [];
    for await (const chunk of request) {
      if (!(chunk instanceof Uint8Array)) return null;
      size += chunk.byteLength;
      if (size > expectedLength || size > MAX_BODY_BYTES) return null;
      arrayPush(chunks, chunk);
    }
    if (request.aborted === true || size !== expectedLength) return null;
    const text = bufferToString(bufferConcat(chunks, size), "utf8");
    if (hasDuplicateJsonKeys(text)) return null;
    return jsonParse(text);
  } catch { return null; }
}

function snapshotSession(value) {
  const session = snapshotObject(value, SESSION_KEYS);
  return session && session.authenticated === true && typeof session.sessionId === "string" &&
    typeof session.subjectId === "string" ? session : null;
}

function snapshotMembership(value) {
  const membership = snapshotObject(value, MEMBERSHIP_KEYS);
  if (!membership || membership.active !== true || !isTenant(membership.tenantId) ||
      !isScopedReference(membership.subjectId, membership.tenantId) ||
      !isScopedReference(membership.authorizationReference, membership.tenantId) ||
      !numberIsSafeInteger(membership.policyRevision) || objectIs(membership.policyRevision, -0) ||
      membership.policyRevision < 1) return null;
  membership.actionGrants = snapshotArray(membership.actionGrants, 1);
  return membership.actionGrants ? membership : null;
}

function sameSession(left, right) {
  return left && right && left.authenticated === right.authenticated &&
    left.sessionId === right.sessionId && left.subjectId === right.subjectId;
}

function sameMembership(left, right) {
  return left && right && left.active === right.active && left.tenantId === right.tenantId &&
    left.subjectId === right.subjectId && left.authorizationReference === right.authorizationReference &&
    left.policyRevision === right.policyRevision && left.actionGrants[0] === right.actionGrants[0];
}

function send(response, status, payload) {
  if (response.headersSent) return;
  response.writeHead(status, PRIVATE_HEADERS);
  response.end(jsonStringify(payload));
}

function actionFor(route, method) {
  if (route.mode === "collection" && method === "POST") return "issue_private_meeting_invitation";
  if (route.mode === "invitation" && method === "GET") return "read_private_meeting_invitation";
  if (route.mode === "accept" && method === "POST") return "accept_private_meeting_invitation";
  if (route.mode === "revoke" && method === "POST") return "revoke_private_meeting_invitation";
  if (route.mode === "audit" && method === "GET") return "read_private_meeting_invitation_audit";
  return null;
}

function createPrivateMeetingInvitationsApiHandler(options) {
  options = snapshotObject(options, OPTIONS_KEYS);
  if (!options || !options.repository || typeof options.now !== "function" ||
      typeof options.resolveTrustedSession !== "function" ||
      typeof options.resolveTrustedMembership !== "function" || typeof options.evaluatePolicy !== "function") {
    throw new TypeError("invitation API unavailable");
  }
  return async function privateMeetingInvitationsApiHandler(request, response) {
    try {
      const route = parseRoute(request.url);
      const action = route ? actionFor(route, request.method) : null;
      if (!route || !action) return send(response, 404, NOT_FOUND);
      const wantsBody = request.method === "POST";
      const inspectedHeaders = inspectHeaders(request.rawHeaders, wantsBody);
      if (!inspectedHeaders) return send(response, 404, NOT_FOUND);
      let body = wantsBody ? await readJsonBody(request, inspectedHeaders.contentLength) : null;
      if (wantsBody && !body) return send(response, 404, NOT_FOUND);
      const firstSession = snapshotSession(options.resolveTrustedSession(request));
      const firstMembership = firstSession
        ? snapshotMembership(options.resolveTrustedMembership({ request, session: firstSession, tenantId: route.tenantId }))
        : null;
      if (!firstSession || !firstMembership || firstSession.subjectId !== firstMembership.subjectId ||
          firstMembership.tenantId !== route.tenantId || firstMembership.actionGrants[0] !== action) {
        return send(response, 404, NOT_FOUND);
      }
      const evaluatedAt = options.now();
      const facts = objectFreeze({
        action,
        tenantId: route.tenantId,
        invitationId: route.invitationId ?? (body && body.invitationId),
        subjectId: firstSession.subjectId,
        policyRevision: firstMembership.policyRevision,
        authorizationReference: firstMembership.authorizationReference,
        evaluatedAt
      });
      if (options.evaluatePolicy(facts) !== true) return send(response, 404, NOT_FOUND);
      const secondSession = snapshotSession(options.resolveTrustedSession(request));
      const secondMembership = secondSession
        ? snapshotMembership(options.resolveTrustedMembership({ request, session: secondSession, tenantId: route.tenantId }))
        : null;
      if (!sameSession(firstSession, secondSession) || !sameMembership(firstMembership, secondMembership) ||
          options.evaluatePolicy(facts) !== true) return send(response, 404, NOT_FOUND);
      const currentSession = snapshotSession(options.resolveTrustedSession(request));
      const currentMembership = currentSession
        ? snapshotMembership(options.resolveTrustedMembership({
          request, session: currentSession, tenantId: route.tenantId
        }))
        : null;
      if (!sameSession(secondSession, currentSession) ||
          !sameMembership(secondMembership, currentMembership)) return send(response, 404, NOT_FOUND);
      const repositoryContext = objectFreeze({
        kind: "trusted-server-context",
        authenticatedSubjectId: firstSession.subjectId,
        authenticatedSessionId: firstSession.sessionId,
        activeTenantMembership: objectFreeze({
          tenantId: firstMembership.tenantId,
          subjectId: firstMembership.subjectId,
          active: true
        }),
        actionGrants: objectFreeze([action]),
        authorizationReference: firstMembership.authorizationReference,
        policyRevision: firstMembership.policyRevision
      });
      let result;
      let successStatus = 200;
      if (route.mode === "collection") {
        body = snapshotObject(body, ISSUE_KEYS);
        if (!body) return send(response, 404, NOT_FOUND);
        body.materialReferences = snapshotArray(body.materialReferences);
        if (!body.materialReferences) return send(response, 404, NOT_FOUND);
        result = options.repository.issueInvitation(repositoryContext, {
          tenantId: route.tenantId,
          invitationId: body.invitationId,
          intendedRecipientSubjectId: body.intendedRecipientSubjectId,
          purposeReference: body.purposeReference,
          materialReferences: body.materialReferences,
          validFrom: body.validFrom,
          expiresAt: body.expiresAt,
          revocationAuthoritySubjectId: body.revocationAuthoritySubjectId,
          issuedAt: evaluatedAt,
          sourceReference: body.sourceReference,
          expectedRevision: body.expectedRevision
        });
        successStatus = 201;
      } else if (route.mode === "invitation") {
        result = options.repository.readInvitation(repositoryContext, {
          tenantId: route.tenantId, invitationId: route.invitationId
        });
      } else if (route.mode === "audit") {
        result = options.repository.readAuditHistory(repositoryContext, {
          tenantId: route.tenantId, invitationId: route.invitationId
        });
      } else {
        body = snapshotObject(body, REVISION_KEYS);
        if (!body) return send(response, 404, NOT_FOUND);
        result = route.mode === "accept"
          ? options.repository.acceptInvitation(repositoryContext, {
            tenantId: route.tenantId, invitationId: route.invitationId,
            acceptedAt: evaluatedAt, expectedRevision: body.expectedRevision
          })
          : options.repository.revokeInvitation(repositoryContext, {
            tenantId: route.tenantId, invitationId: route.invitationId,
            revokedAt: evaluatedAt, expectedRevision: body.expectedRevision
          });
      }
      return result && result.ok === true
        ? send(response, successStatus, result)
        : send(response, 404, NOT_FOUND);
    } catch {
      return send(response, 404, NOT_FOUND);
    }
  };
}

export { createPrivateMeetingInvitationsApiHandler };
