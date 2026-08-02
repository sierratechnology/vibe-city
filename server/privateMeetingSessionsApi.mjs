import { isProxy } from "node:util/types";

const arrayIsArray = Array.isArray;
const arrayPush = Function.call.bind(Array.prototype.push);
const bufferByteLength = Buffer.byteLength.bind(Buffer);
const bufferConcat = Buffer.concat.bind(Buffer);
const bufferToString = Function.call.bind(Buffer.prototype.toString);
const DateIntrinsic = Date;
const NumberIntrinsic = Number;
const StringIntrinsic = String;
const dateParse = Date.parse.bind(Date);
const dateToISOString = Function.call.bind(Date.prototype.toISOString);
const jsonParse = JSON.parse.bind(JSON);
const jsonStringify = JSON.stringify.bind(JSON);
const numberIsFinite = Number.isFinite;
const numberIsSafeInteger = Number.isSafeInteger;
const objectCreate = Object.create;
const objectDefineProperty = Object.defineProperty;
const objectFreeze = Object.freeze;
const objectGetOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const objectGetOwnPropertyDescriptors = Object.getOwnPropertyDescriptors;
const objectGetPrototypeOf = Object.getPrototypeOf;
const objectIs = Object.is;
const objectPrototype = Object.prototype;
const reflectOwnKeys = Reflect.ownKeys;
const regexpExec = Function.call.bind(RegExp.prototype.exec);
const regexpTest = Function.call.bind(RegExp.prototype.test);
const stringCharCodeAt = Function.call.bind(String.prototype.charCodeAt);
const stringIncludes = Function.call.bind(String.prototype.includes);
const stringSlice = Function.call.bind(String.prototype.slice);
const stringToLowerCase = Function.call.bind(String.prototype.toLowerCase);
const stringToString = Function.call.bind(String.prototype.toString);
const SetIntrinsic = Set;
const setAdd = Function.call.bind(Set.prototype.add);
const setHas = Function.call.bind(Set.prototype.has);

const MAX_BODY_BYTES = 16_384;
const TENANT = /^syn-tenant-[a-z0-9]+(?:-[a-z0-9]+)*$/;
const REFERENCE = /^syn-[a-z0-9]+(?:-[a-z0-9]+)*--[a-z0-9]+(?:-[a-z0-9]+)*$/;
const CANONICAL_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const BEARER = /^Bearer [A-Za-z0-9._~+/-]+=*$/;
const DECIMAL = /^(?:0|[1-9]\d*)$/;
const PRIVATE_HEADERS = objectFreeze({
  "Cache-Control": "private, no-store",
  "Content-Type": "application/json; charset=utf-8",
  "Vary": "Authorization",
  "X-Content-Type-Options": "nosniff"
});
const NOT_FOUND = objectFreeze({ error: "not_found" });
const SESSION_KEYS = objectFreeze(["authenticated", "sessionId", "subjectId"]);
const MEMBERSHIP_KEYS = objectFreeze([
  "active", "tenantId", "subjectId", "actionGrants", "authorizationReference", "policyRevision"
]);
const CREATE_KEYS = objectFreeze([
  "sessionId", "purposeReference", "participantSubjectIds", "materialReferences",
  "startedAt", "sourceReference", "expectedRevision"
]);
const END_KEYS = objectFreeze(["endedAt", "expectedRevision", "outcomeReference"]);
const ACTIVE_SESSION_KEYS = objectFreeze([
  "privacy", "tenantId", "sessionId", "revision", "purposeReference",
  "participantSubjectIds", "materialReferences", "startedAt", "endedAt", "lifecycle",
  "outcome", "sourceReference", "createdBySubjectId", "authorizationReference", "policyRevision"
]);
const ENDED_SESSION_KEYS = objectFreeze([
  ...ACTIVE_SESSION_KEYS,
  "endedBySubjectId", "endAuthorizationReference", "endPolicyRevision"
]);
const OUTCOME_KEYS = objectFreeze(["resultState", "outcomeReference"]);
const CREATED_EVENT_KEYS = objectFreeze([
  "privacy", "tenantId", "sessionId", "eventId", "eventKind", "priorRevision",
  "newRevision", "occurredAt", "actorSubjectId", "authorizationReference", "policyRevision"
]);
const ENDED_EVENT_KEYS = objectFreeze([
  ...CREATED_EVENT_KEYS, "outcomeReference", "resultState"
]);

function sameKeySet(keys, expected) {
  if (keys.length !== expected.length) return false;
  for (let index = 0; index < keys.length; index += 1) {
    if (typeof keys[index] !== "string") return false;
    let present = false;
    for (let expectedIndex = 0; expectedIndex < expected.length; expectedIndex += 1) {
      if (keys[index] === expected[expectedIndex]) present = true;
    }
    if (!present) return false;
  }
  return true;
}

function snapshotArray(value, maximum = 32) {
  if (!arrayIsArray(value) || isProxy(value)) return null;
  const descriptors = objectGetOwnPropertyDescriptors(value);
  const keys = reflectOwnKeys(value);
  const lengthDescriptor = descriptors.length;
  if (!lengthDescriptor || !("value" in lengthDescriptor) ||
      !numberIsSafeInteger(lengthDescriptor.value) || lengthDescriptor.value < 0 ||
      lengthDescriptor.value > maximum || keys.length !== lengthDescriptor.value + 1) return null;
  const copy = [];
  for (let index = 0; index < lengthDescriptor.value; index += 1) {
    const key = StringIntrinsic(index);
    const descriptor = descriptors[key];
    if (!descriptor || !("value" in descriptor) || !descriptor.enumerable || keys[index] !== key) return null;
    objectDefineProperty(copy, key, {
      configurable: true,
      enumerable: true,
      value: descriptor.value,
      writable: true
    });
  }
  const after = objectGetOwnPropertyDescriptors(value);
  const afterKeys = reflectOwnKeys(value);
  if (afterKeys.length !== keys.length) return null;
  for (let index = 0; index < keys.length; index += 1) {
    const key = keys[index];
    const before = descriptors[key];
    const current = after[key];
    if (afterKeys[index] !== key || !current || !("value" in current) ||
        !objectIs(before.value, current.value) || before.enumerable !== current.enumerable ||
        before.configurable !== current.configurable || before.writable !== current.writable) return null;
  }
  return copy;
}

function snapshotObject(value, expectedKeys) {
  if (value === null || typeof value !== "object" || isProxy(value)) return null;
  const prototype = objectGetPrototypeOf(value);
  if (prototype !== objectPrototype && prototype !== null) return null;
  const descriptors = objectGetOwnPropertyDescriptors(value);
  const keys = reflectOwnKeys(value);
  if (!sameKeySet(keys, expectedKeys)) return null;
  const copy = objectCreate(null);
  for (let index = 0; index < expectedKeys.length; index += 1) {
    const key = expectedKeys[index];
    const descriptor = descriptors[key];
    if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) return null;
    objectDefineProperty(copy, key, {
      configurable: true,
      enumerable: true,
      value: descriptor.value,
      writable: true
    });
  }
  const after = objectGetOwnPropertyDescriptors(value);
  const afterKeys = reflectOwnKeys(value);
  if (!sameKeySet(afterKeys, expectedKeys) || objectGetPrototypeOf(value) !== prototype) return null;
  for (let index = 0; index < expectedKeys.length; index += 1) {
    const key = expectedKeys[index];
    const before = descriptors[key];
    const current = after[key];
    if (!current || !("value" in current) || !objectIs(before.value, current.value) ||
        before.enumerable !== current.enumerable || before.configurable !== current.configurable ||
        before.writable !== current.writable) return null;
  }
  return copy;
}

function hasInheritedThenDescriptor(value) {
  const prototype = objectGetPrototypeOf(value);
  return prototype !== null && objectGetOwnPropertyDescriptor(prototype, "then") !== undefined;
}

function isTenant(value) {
  return typeof value === "string" && value.length <= 128 && regexpTest(TENANT, value);
}

function isScopedReference(value, tenantId) {
  return typeof value === "string" && value.length <= 128 && regexpTest(REFERENCE, value) &&
    value.length > tenantId.length + 2 &&
    stringSlice(value, 0, tenantId.length + 2) === `${tenantId}--`;
}

function isCanonicalUtc(value) {
  if (typeof value !== "string" || !regexpTest(CANONICAL_UTC, value)) return false;
  const milliseconds = dateParse(value);
  return numberIsFinite(milliseconds) && dateToISOString(new DateIntrinsic(milliseconds)) === value;
}

function hasExactKeys(value, expected) {
  return value !== null && typeof value === "object" &&
    sameKeySet(reflectOwnKeys(value), expected);
}

function isOrderedUniqueReferences(values, tenantId, maximum) {
  if (!arrayIsArray(values) || values.length < 1 || values.length > maximum) return false;
  for (let index = 0; index < values.length; index += 1) {
    if (!isScopedReference(values[index], tenantId)) return false;
    for (let prior = 0; prior < index; prior += 1) {
      if (values[prior] === values[index]) return false;
    }
  }
  return true;
}

function includesReference(values, expected) {
  for (let index = 0; index < values.length; index += 1) {
    if (values[index] === expected) return true;
  }
  return false;
}

function validSessionProjection(session, tenantId, sessionId) {
  if (!session || !numberIsSafeInteger(session.revision) || objectIs(session.revision, -0)) return false;
  const keys = session.revision === 1 ? ACTIVE_SESSION_KEYS :
    session.revision === 2 ? ENDED_SESSION_KEYS : null;
  if (keys === null || !hasExactKeys(session, keys) || session.privacy !== "tenant-private" ||
      session.tenantId !== tenantId || session.sessionId !== sessionId ||
      !isScopedReference(session.sessionId, tenantId) ||
      !isScopedReference(session.purposeReference, tenantId) ||
      !isOrderedUniqueReferences(session.participantSubjectIds, tenantId, 32) ||
      !isOrderedUniqueReferences(session.materialReferences, tenantId, 32) ||
      !isCanonicalUtc(session.startedAt) || !isScopedReference(session.sourceReference, tenantId) ||
      !isScopedReference(session.createdBySubjectId, tenantId) ||
      !includesReference(session.participantSubjectIds, session.createdBySubjectId) ||
      !isScopedReference(session.authorizationReference, tenantId) ||
      !numberIsSafeInteger(session.policyRevision) || objectIs(session.policyRevision, -0) ||
      session.policyRevision < 1) return false;
  if (session.revision === 1) {
    return session.lifecycle === "active" && session.endedAt === null && session.outcome === null;
  }
  return session.lifecycle === "ended" && isCanonicalUtc(session.endedAt) &&
    dateParse(session.endedAt) > dateParse(session.startedAt) &&
    hasExactKeys(session.outcome, OUTCOME_KEYS) && session.outcome.resultState === "no-decision" &&
    isScopedReference(session.outcome.outcomeReference, tenantId) &&
    isScopedReference(session.endedBySubjectId, tenantId) &&
    includesReference(session.participantSubjectIds, session.endedBySubjectId) &&
    isScopedReference(session.endAuthorizationReference, tenantId) &&
    numberIsSafeInteger(session.endPolicyRevision) && !objectIs(session.endPolicyRevision, -0) &&
    session.endPolicyRevision >= 1;
}

function validHistoryProjection(events, tenantId, sessionId) {
  if (!arrayIsArray(events) || events.length < 1 || events.length > 2) return false;
  for (let index = 0; index < events.length; index += 1) {
    const event = events[index];
    const created = index === 0;
    if (!event || !hasExactKeys(event, created ? CREATED_EVENT_KEYS : ENDED_EVENT_KEYS) ||
        event.privacy !== "tenant-private" || event.tenantId !== tenantId ||
        event.sessionId !== sessionId || !isScopedReference(event.eventId, tenantId) ||
        !isCanonicalUtc(event.occurredAt) || !isScopedReference(event.actorSubjectId, tenantId) ||
        !isScopedReference(event.authorizationReference, tenantId) ||
        !numberIsSafeInteger(event.policyRevision) || objectIs(event.policyRevision, -0) ||
        event.policyRevision < 1 || event.priorRevision !== index || event.newRevision !== index + 1) return false;
    if (created) {
      if (event.eventKind !== "private_meeting_session_created") return false;
    } else if (event.eventKind !== "private_meeting_session_ended_no_decision" ||
        event.resultState !== "no-decision" || event.outcomeReference !== event.eventId ||
        dateParse(event.occurredAt) <= dateParse(events[0].occurredAt)) return false;
  }
  return true;
}

function parseRoute(rawUrl) {
  if (typeof rawUrl !== "string" || rawUrl.length > 512 ||
      stringIncludes(rawUrl, "?") || stringIncludes(rawUrl, "#")) {
    return null;
  }
  let match = regexpExec(/^\/api\/private\/tenants\/([^/]+)\/meeting-sessions$/, rawUrl);
  if (match !== null && isTenant(match[1])) return objectFreeze({ tenantId: match[1], sessionId: null, mode: "collection" });
  match = regexpExec(/^\/api\/private\/tenants\/([^/]+)\/meeting-sessions\/([^/]+)$/, rawUrl);
  if (match !== null && isTenant(match[1]) && isScopedReference(match[2], match[1])) {
    return objectFreeze({ tenantId: match[1], sessionId: match[2], mode: "session" });
  }
  match = regexpExec(
    /^\/api\/private\/tenants\/([^/]+)\/meeting-sessions\/([^/]+)\/(history|end)$/,
    rawUrl
  );
  if (match !== null && isTenant(match[1]) && isScopedReference(match[2], match[1])) {
    return objectFreeze({ tenantId: match[1], sessionId: match[2], mode: match[3] });
  }
  return null;
}

function inspectHeaders(rawHeaders, wantsBody) {
  const headers = snapshotArray(rawHeaders, 128);
  if (headers === null || headers.length % 2 !== 0) return null;
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
      contentLength = NumberIntrinsic(value);
    } else if (lower === "content-type") {
      if (contentType !== null) return null;
      contentType = stringToLowerCase(value);
    }
  }
  if (authorization === null || !regexpTest(BEARER, authorization)) return null;
  if (wantsBody) {
    if (contentLength === null || !numberIsSafeInteger(contentLength) ||
        contentLength < 2 || contentLength > MAX_BODY_BYTES || contentType !== "application/json") return null;
  } else if ((contentLength !== null && contentLength !== 0) || contentType !== null) {
    return null;
  }
  return objectFreeze({ authorization, contentLength: contentLength ?? 0 });
}

function parseStringToken(text, cursor) {
  if (text[cursor.index] !== '"') return null;
  const start = cursor.index;
  cursor.index += 1;
  while (cursor.index < text.length) {
    const code = stringCharCodeAt(text, cursor.index);
    if (code === 34) {
      cursor.index += 1;
      try { return jsonParse(stringSlice(text, start, cursor.index)); } catch { return null; }
    }
    if (code < 32) return null;
    if (code === 92) {
      cursor.index += 1;
      if (cursor.index >= text.length) return null;
      if (text[cursor.index] === "u") {
        for (let count = 0; count < 4; count += 1) {
          cursor.index += 1;
          if (cursor.index >= text.length || !regexpTest(/[0-9a-fA-F]/, text[cursor.index])) return null;
        }
      } else if (!stringIncludes('"\\/bfnrt', text[cursor.index])) return null;
    }
    cursor.index += 1;
  }
  return null;
}

function skipWhitespace(text, cursor) {
  while (cursor.index < text.length &&
      (text[cursor.index] === " " || text[cursor.index] === "\n" ||
       text[cursor.index] === "\r" || text[cursor.index] === "\t")) cursor.index += 1;
}

function scanJsonValue(text, cursor, depth = 0) {
  if (depth > 8) return false;
  skipWhitespace(text, cursor);
  if (text[cursor.index] === '"') return parseStringToken(text, cursor) !== null;
  if (text[cursor.index] === "{") {
    cursor.index += 1;
    skipWhitespace(text, cursor);
    const keys = new SetIntrinsic();
    if (text[cursor.index] === "}") { cursor.index += 1; return true; }
    for (;;) {
      const key = parseStringToken(text, cursor);
      if (key === null || setHas(keys, key)) return false;
      setAdd(keys, key);
      skipWhitespace(text, cursor);
      if (text[cursor.index] !== ":") return false;
      cursor.index += 1;
      if (!scanJsonValue(text, cursor, depth + 1)) return false;
      skipWhitespace(text, cursor);
      if (text[cursor.index] === "}") { cursor.index += 1; return true; }
      if (text[cursor.index] !== ",") return false;
      cursor.index += 1;
      skipWhitespace(text, cursor);
    }
  }
  if (text[cursor.index] === "[") {
    cursor.index += 1;
    skipWhitespace(text, cursor);
    if (text[cursor.index] === "]") { cursor.index += 1; return true; }
    for (;;) {
      if (!scanJsonValue(text, cursor, depth + 1)) return false;
      skipWhitespace(text, cursor);
      if (text[cursor.index] === "]") { cursor.index += 1; return true; }
      if (text[cursor.index] !== ",") return false;
      cursor.index += 1;
    }
  }
  const rest = stringSlice(text, cursor.index);
  const scalar = regexpExec(/^(?:true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/, rest);
  if (scalar === null) return false;
  cursor.index += scalar[0].length;
  return true;
}

function parseUnambiguousJson(text) {
  const cursor = { index: 0 };
  if (!scanJsonValue(text, cursor)) return null;
  skipWhitespace(text, cursor);
  if (cursor.index !== text.length) return null;
  try { return jsonParse(text); } catch { return null; }
}

async function readJsonBody(request, expectedLength) {
  try {
    let size = 0;
    const chunks = [];
    for await (const chunk of request) {
      if (!(chunk instanceof Uint8Array)) return null;
      size += chunk.byteLength;
      if (size > MAX_BODY_BYTES || size > expectedLength) return null;
      arrayPush(chunks, chunk);
    }
    if (request.aborted === true || size !== expectedLength) return null;
    return parseUnambiguousJson(bufferToString(bufferConcat(chunks, size), "utf8"));
  } catch {
    return null;
  }
}

function snapshotSession(value) {
  const session = snapshotObject(value, SESSION_KEYS);
  return session && session.authenticated === true &&
    typeof session.sessionId === "string" && session.sessionId.length > 0 && session.sessionId.length <= 128 &&
    typeof session.subjectId === "string" ? objectFreeze(session) : null;
}

function snapshotMembership(value) {
  const membership = snapshotObject(value, MEMBERSHIP_KEYS);
  if (!membership || membership.active !== true || !isTenant(membership.tenantId) ||
      !isScopedReference(membership.subjectId, membership.tenantId) ||
      !isScopedReference(membership.authorizationReference, membership.tenantId) ||
      !numberIsSafeInteger(membership.policyRevision) || objectIs(membership.policyRevision, -0) ||
      membership.policyRevision < 1) return null;
  const grants = snapshotArray(membership.actionGrants, 8);
  if (grants === null || grants.length !== 1 || typeof grants[0] !== "string") return null;
  membership.actionGrants = objectFreeze(grants);
  return objectFreeze(membership);
}

function sameSession(left, right) {
  return left && right && left.authenticated === right.authenticated &&
    left.sessionId === right.sessionId && left.subjectId === right.subjectId;
}

function sameMembership(left, right) {
  return left && right && left.active === right.active && left.tenantId === right.tenantId &&
    left.subjectId === right.subjectId && left.authorizationReference === right.authorizationReference &&
    left.policyRevision === right.policyRevision && left.actionGrants.length === right.actionGrants.length &&
    left.actionGrants[0] === right.actionGrants[0];
}

function policyFacts(route, action, session, membership, evaluatedAt) {
  return objectFreeze({
    tenantId: route.tenantId,
    sessionId: route.sessionId,
    subjectId: session.subjectId,
    action,
    authorizationReference: membership.authorizationReference,
    policyRevision: membership.policyRevision,
    evaluatedAt
  });
}

function repositoryContext(membership, repositoryAction) {
  return objectFreeze({
    kind: "trusted-server-context",
    authenticatedSubjectId: membership.subjectId,
    activeTenantMembership: objectFreeze({
      tenantId: membership.tenantId,
      subjectId: membership.subjectId,
      active: true
    }),
    actionGrants: objectFreeze([repositoryAction]),
    authorizationReference: membership.authorizationReference,
    policyRevision: membership.policyRevision
  });
}

function detachedFrozen(value, budget = { nodes: 0 }, depth = 0) {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!numberIsFinite(value) || objectIs(value, -0)) throw new TypeError("invalid response");
    return value;
  }
  if (typeof value !== "object" || isProxy(value) || depth > 8 || ++budget.nodes > 256) {
    throw new TypeError("invalid response");
  }
  if (arrayIsArray(value)) {
    const source = snapshotArray(value, 64);
    if (source === null) throw new TypeError("invalid response");
    const copy = [];
    for (let index = 0; index < source.length; index += 1) {
      objectDefineProperty(copy, String(index), {
        configurable: true, enumerable: true,
        value: detachedFrozen(source[index], budget, depth + 1), writable: true
      });
    }
    return objectFreeze(copy);
  }
  const prototype = objectGetPrototypeOf(value);
  if (prototype !== objectPrototype && prototype !== null) throw new TypeError("invalid response");
  const descriptors = objectGetOwnPropertyDescriptors(value);
  const keys = reflectOwnKeys(value);
  if (keys.length > 64) throw new TypeError("invalid response");
  const copy = objectCreate(null);
  for (let index = 0; index < keys.length; index += 1) {
    const key = keys[index];
    const descriptor = descriptors[key];
    if (typeof key !== "string" || !descriptor || !("value" in descriptor) || !descriptor.enumerable) {
      throw new TypeError("invalid response");
    }
    objectDefineProperty(copy, key, {
      configurable: true, enumerable: true,
      value: detachedFrozen(descriptor.value, budget, depth + 1), writable: true
    });
  }
  const after = objectGetOwnPropertyDescriptors(value);
  const afterKeys = reflectOwnKeys(value);
  if (afterKeys.length !== keys.length || objectGetPrototypeOf(value) !== prototype) throw new TypeError("invalid response");
  for (let index = 0; index < keys.length; index += 1) {
    const before = descriptors[keys[index]];
    const current = after[keys[index]];
    if (afterKeys[index] !== keys[index] || !current || !("value" in current) ||
        !objectIs(before.value, current.value)) throw new TypeError("invalid response");
  }
  return objectFreeze(copy);
}

function sendJson(response, status, body) {
  const frozen = detachedFrozen(body);
  const payload = jsonStringify(frozen);
  response.writeHead(status, {
    ...PRIVATE_HEADERS,
    "Content-Length": bufferByteLength(payload)
  });
  response.end(payload);
}

function deny(response) {
  sendJson(response, 404, NOT_FOUND);
}

export function createPrivateMeetingSessionsApiHandler({
  repository,
  now,
  resolveTrustedSession,
  resolveTrustedMembership,
  evaluatePolicy
}) {
  if (!repository || typeof repository.createSession !== "function" ||
      typeof repository.readSession !== "function" ||
      typeof repository.readAuditHistory !== "function" ||
      typeof repository.endWithNoDecision !== "function" || typeof now !== "function" ||
      typeof resolveTrustedSession !== "function" || typeof resolveTrustedMembership !== "function" ||
      typeof evaluatePolicy !== "function") {
    throw new TypeError("private meeting-session dependencies are required");
  }

  async function resolveAuthority(request, route, action) {
    try {
      const sourceSession = await resolveTrustedSession(request);
      const session = snapshotSession(sourceSession);
      if (session === null) return null;
      const sourceMembership = await resolveTrustedMembership({ session: sourceSession });
      const membership = snapshotMembership(sourceMembership);
      if (membership === null || membership.tenantId !== route.tenantId ||
          membership.subjectId !== session.subjectId || membership.actionGrants[0] !== action) return null;
      const evaluatedAt = now();
      if (!isCanonicalUtc(evaluatedAt)) return null;
      if (await evaluatePolicy(policyFacts(route, action, session, membership, evaluatedAt)) !== true) return null;
      const currentSessionSource = await resolveTrustedSession(request);
      const currentSession = snapshotSession(currentSessionSource);
      if (!sameSession(session, currentSession)) return null;
      const currentMembership = snapshotMembership(
        await resolveTrustedMembership({ session: currentSessionSource })
      );
      if (!sameMembership(membership, currentMembership)) return null;
      return objectFreeze({ session, membership, evaluatedAt });
    } catch {
      return null;
    }
  }

  return async function privateMeetingSessionsApiHandler(request, response) {
    try {
      const method = request.method;
      const rawUrl = request.url;
      const route = parseRoute(rawUrl);
      const operation = route && method === "POST" && route.mode === "collection" ? "create" :
        route && method === "GET" && route.mode === "session" ? "read" :
          route && method === "GET" && route.mode === "history" ? "history" :
            route && method === "POST" && route.mode === "end" ? "end" : null;
      if (operation === null || request.method !== method || request.url !== rawUrl) return deny(response);
      const headers = inspectHeaders(request.rawHeaders, operation === "create" || operation === "end");
      if (headers === null) return deny(response);

      let body = null;
      if (operation === "create") {
        body = await readJsonBody(request, headers.contentLength);
        body = snapshotObject(body, CREATE_KEYS);
        if (body === null || body.expectedRevision !== 0 || objectIs(body.expectedRevision, -0) ||
            !isScopedReference(body.sessionId, route.tenantId) ||
            !isScopedReference(body.purposeReference, route.tenantId) ||
            !isScopedReference(body.sourceReference, route.tenantId) || !isCanonicalUtc(body.startedAt)) {
          return deny(response);
        }
        const participants = snapshotArray(body.participantSubjectIds, 32);
        const materials = snapshotArray(body.materialReferences, 32);
        if (participants === null || materials === null) return deny(response);
        body.participantSubjectIds = participants;
        body.materialReferences = materials;
      } else if (operation === "end") {
        body = await readJsonBody(request, headers.contentLength);
        body = snapshotObject(body, END_KEYS);
        if (body === null || body.expectedRevision !== 1 || objectIs(body.expectedRevision, -0) ||
            !isCanonicalUtc(body.endedAt) ||
            !isScopedReference(body.outcomeReference, route.tenantId)) return deny(response);
      }

      const action = operation === "create"
        ? "create_private_meeting_session" : operation === "end"
          ? "end_private_meeting_session" : operation === "history"
            ? "read_private_meeting_session_history" : "read_private_meeting_session";
      const authorizationRoute = operation === "create"
        ? objectFreeze({ ...route, sessionId: body.sessionId })
        : route;
      const authority = await resolveAuthority(request, authorizationRoute, action);
      if (authority === null || request.method !== method || request.url !== rawUrl) return deny(response);
      const currentAuthority = await resolveAuthority(request, authorizationRoute, action);
      if (currentAuthority === null || !sameSession(authority.session, currentAuthority.session) ||
          !sameMembership(authority.membership, currentAuthority.membership) ||
          dateParse(currentAuthority.evaluatedAt) < dateParse(authority.evaluatedAt) ||
          request.method !== method || request.url !== rawUrl) return deny(response);
      let result;
      if (operation === "create") {
        if (dateParse(body.startedAt) > dateParse(currentAuthority.evaluatedAt)) return deny(response);
        result = repository.createSession(
          repositoryContext(currentAuthority.membership, action),
          objectFreeze({ tenantId: route.tenantId, ...body })
        );
      } else if (operation === "end") {
        if (dateParse(body.endedAt) > dateParse(currentAuthority.evaluatedAt)) return deny(response);
        result = repository.endWithNoDecision(
          repositoryContext(currentAuthority.membership, "end_private_meeting_session"),
          objectFreeze({
            tenantId: route.tenantId,
            sessionId: route.sessionId,
            endedAt: body.endedAt,
            expectedRevision: body.expectedRevision,
            outcomeReference: body.outcomeReference,
            actorSubjectId: currentAuthority.membership.subjectId,
            authorizationReference: currentAuthority.membership.authorizationReference,
            policyRevision: currentAuthority.membership.policyRevision
          })
        );
      } else if (operation === "history") {
        result = await repository.readAuditHistory(
          repositoryContext(currentAuthority.membership, "read_private_meeting_session"),
          objectFreeze({ tenantId: route.tenantId, sessionId: route.sessionId })
        );
      } else {
        result = repository.readSession(
          repositoryContext(currentAuthority.membership, action),
          objectFreeze({ tenantId: route.tenantId, sessionId: route.sessionId })
        );
      }
      if ((operation === "create" || operation === "end") &&
          result !== null && typeof result === "object" && !isProxy(result) &&
          hasInheritedThenDescriptor(result)) return deny(response);
      const resultSnapshot = snapshotObject(
        result,
        operation === "history" ? ["ok", "events"] : ["ok", "session"]
      );
      if (resultSnapshot === null || resultSnapshot.ok !== true) return deny(response);
      const projection = detachedFrozen(
        operation === "history" ? resultSnapshot.events : resultSnapshot.session
      );
      if (operation === "history") {
        if (!validHistoryProjection(projection, route.tenantId, route.sessionId)) return deny(response);
      } else if (!validSessionProjection(
        projection, route.tenantId, authorizationRoute.sessionId
      )) return deny(response);
      const finalAuthority = await resolveAuthority(request, authorizationRoute, action);
      if (finalAuthority === null ||
          !sameSession(currentAuthority.session, finalAuthority.session) ||
          !sameMembership(currentAuthority.membership, finalAuthority.membership) ||
          dateParse(finalAuthority.evaluatedAt) < dateParse(currentAuthority.evaluatedAt) ||
          request.method !== method || request.url !== rawUrl) return deny(response);
      return sendJson(
        response,
        operation === "create" ? 201 : 200,
        operation === "history" ? { events: projection } : { session: projection }
      );
    } catch {
      if (!response.headersSent) {
        try { return deny(response); } catch { /* response failed closed */ }
      }
      try { response.destroy(); } catch { /* response already unavailable */ }
    }
  };
}
