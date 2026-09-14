import { isProxy } from "node:util/types";

const DOMAIN_MODULE_PATH = "./tenantSkyscraperNavigation" + "Domain.mjs";
const { createTenantSkyscraperNavigationAuthorizer } = await import(DOMAIN_MODULE_PATH);

const arrayIsArray = Array.isArray;
const arrayIncludes = Function.call.bind(Array.prototype.includes);
const arrayPush = Function.call.bind(Array.prototype.push);
const bufferByteLength = Buffer.byteLength.bind(Buffer);
const bufferConcat = Buffer.concat.bind(Buffer);
const DateIntrinsic = Date;
const dateParse = Date.parse.bind(Date);
const dateToISOString = Function.call.bind(Date.prototype.toISOString);
const jsonParse = JSON.parse.bind(JSON);
const jsonStringify = JSON.stringify.bind(JSON);
const NumberIntrinsic = Number;
const numberIsFinite = Number.isFinite;
const numberIsSafeInteger = Number.isSafeInteger;
const objectAssign = Object.assign;
const objectCreate = Object.create;
const objectDefineProperty = Object.defineProperty;
const objectFreeze = Object.freeze;
const objectGetOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const objectGetPrototypeOf = Object.getPrototypeOf;
const objectIs = Object.is;
const objectIsExtensible = Object.isExtensible;
const objectPrototype = Object.prototype;
const reflectOwnKeys = Reflect.ownKeys;
const regexpExec = Function.call.bind(RegExp.prototype.exec);
const regexpTest = (pattern, value) => regexpExec(pattern, value) !== null;
const stringCharCodeAt = Function.call.bind(String.prototype.charCodeAt);
const stringSlice = Function.call.bind(String.prototype.slice);
const stringToLowerCase = Function.call.bind(String.prototype.toLowerCase);
const StringIntrinsic = String;
const SetIntrinsic = Set;
const setAdd = Function.call.bind(Set.prototype.add);
const setHas = Function.call.bind(Set.prototype.has);
const TextDecoderIntrinsic = TextDecoder;
const textDecoderDecode = Function.call.bind(TextDecoder.prototype.decode);
const Uint8ArrayIntrinsic = Uint8Array;
const WeakSetIntrinsic = WeakSet;
const weakSetAdd = Function.call.bind(WeakSet.prototype.add);
const weakSetHas = Function.call.bind(WeakSet.prototype.has);

const DEPENDENCY_KEYS = objectFreeze([
  "now", "resolveTrustedSession", "resolveTrustedNavigationFacts", "ownsListenerRequest"
]);
const PRIVATE_HEADERS = objectFreeze({
  "Cache-Control": "private, no-store",
  "Content-Type": "application/json; charset=utf-8",
  "Vary": "Authorization",
  "X-Content-Type-Options": "nosniff"
});
const NOT_FOUND_PAYLOAD = '{"error":"not_found"}';
const ROUTE = /^\/api\/private\/tenants\/(id_[a-f0-9]{16,64})\/skyscraper-navigation\/decision$/;
const HEADER_NAME = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;
const BEARER = /^Bearer [A-Za-z0-9._~+/-]+=*$/;
const DECIMAL = /^(?:0|[1-9]\d*)$/;
const ID = /^id_[a-f0-9]{16,64}$/;
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const REQUEST_KEYS = objectFreeze([
  "schemaVersion", "channel", "buildingId", "floorId", "elevatorStopId", "destinationId"
]);
const CHANNELS = new SetIntrinsic(["door", "elevator", "direct", "alternative"]);
const DESTINATION_KINDS = new SetIntrinsic(["suite", "shared_space"]);
const ACCESS_STATES = new SetIntrinsic(["public", "tenant", "invited", "private", "restricted"]);
const SESSION_KEYS = objectFreeze(["authenticated", "sessionId", "subjectId"]);
const FACT_KEYS = objectFreeze([
  "catalog", "activeTenantMembership", "ownerTenantLifecycles", "invitation",
  "privateDestinationGrants", "restrictedDestinationAuthorities",
  "authorizationReference", "policyRevision"
]);
const MEMBERSHIP_KEYS = objectFreeze(["tenantId", "subjectId", "active"]);
const CATALOG_KEYS = objectFreeze(["schemaVersion", "building"]);
const BUILDING_KEYS = objectFreeze(["buildingId", "displayName", "lifecycle", "floors"]);
const BUILDING_SCALAR_KEYS = objectFreeze(["buildingId", "displayName", "lifecycle"]);
const FLOOR_KEYS = objectFreeze([
  "floorId", "buildingId", "displayName", "lifecycle", "floorKind", "elevatorStopId", "destinations"
]);
const FLOOR_SCALAR_KEYS = objectFreeze([
  "floorId", "buildingId", "displayName", "lifecycle", "floorKind", "elevatorStopId"
]);
const DESTINATION_KEYS = objectFreeze([
  "destinationId", "floorId", "displayName", "lifecycle", "destinationKind", "accessState",
  "ownerTenantId", "sharedSpacePolicy"
]);
const OWNER_KEYS = objectFreeze(["tenantId", "lifecycle"]);
const SCOPE_KEYS = objectFreeze(["tenantId", "subjectId", "destinationId"]);
const INVITATION_KEYS = objectFreeze([
  "tenantId", "invitationId", "subjectId", "destinationId", "lifecycle", "revision", "validFrom", "expiresAt"
]);
const DECISION_KEYS = objectFreeze([
  "schemaVersion", "allowed", "code", "channel", "buildingId", "floorId",
  "elevatorStopId", "destinationId", "destinationKind", "accessState", "subjectId",
  "tenantId", "authorizationReference", "policyRevision", "evaluatedAt", "validUntil"
]);
const RESULT_KEYS = objectFreeze(["ok", "decision"]);

function exactDependencies(value) {
  if (value === null || typeof value !== "object" || isProxy(value)) return null;
  const prototype = objectGetPrototypeOf(value);
  if (prototype !== objectPrototype && prototype !== null) return null;
  const keys = reflectOwnKeys(value);
  if (keys.length !== DEPENDENCY_KEYS.length) return null;
  const result = objectCreate(null);
  for (let index = 0; index < DEPENDENCY_KEYS.length; index += 1) {
    const key = DEPENDENCY_KEYS[index];
    const descriptor = objectGetOwnPropertyDescriptor(value, key);
    if (!descriptor || !("value" in descriptor) || descriptor.enumerable !== true ||
        typeof descriptor.value !== "function") return null;
    result[key] = descriptor.value;
  }
  return result;
}

function sendJson(response, status, payload) {
  response.writeHead(status, {
    ...PRIVATE_HEADERS,
    "Content-Length": bufferByteLength(payload)
  });
  response.end(payload);
}

function deny(response) {
  sendJson(response, 404, NOT_FOUND_PAYLOAD);
}

function findTrustedDestination(facts, request) {
  const floors = facts.catalog.building.floors;
  for (let floorIndex = 0; floorIndex < floors.length; floorIndex += 1) {
    const destinations = floors[floorIndex].destinations;
    for (let destinationIndex = 0; destinationIndex < destinations.length; destinationIndex += 1) {
      if (destinations[destinationIndex].destinationId === request.destinationId) {
        return destinations[destinationIndex];
      }
    }
  }
  return null;
}

function exactSuccessDecision(result) {
  if (result === null || typeof result !== "object" || isProxy(result) ||
      objectIsExtensible(result) || objectGetPrototypeOf(result) !== null ||
      !sameKeySet(reflectOwnKeys(result), RESULT_KEYS)) return null;
  const ok = objectGetOwnPropertyDescriptor(result, "ok");
  const decision = objectGetOwnPropertyDescriptor(result, "decision");
  if (!ok || !("value" in ok) || ok.value !== true || ok.enumerable !== true || ok.writable !== false ||
      ok.configurable !== false || !decision || !("value" in decision) || decision.enumerable !== true ||
      decision.writable !== false || decision.configurable !== false) return null;
  return decision.value;
}

function sendDecision(response, source, request, session, facts, evaluatedAt) {
  if (source === null || typeof source !== "object" || isProxy(source) ||
      objectIsExtensible(source) || objectGetPrototypeOf(source) !== null ||
      !sameKeySet(reflectOwnKeys(source), DECISION_KEYS)) {
    throw new TypeError("invalid decision");
  }
  const decision = objectCreate(null);
  for (let index = 0; index < DECISION_KEYS.length; index += 1) {
    const key = DECISION_KEYS[index];
    const descriptor = objectGetOwnPropertyDescriptor(source, key);
    const valueType = descriptor && typeof descriptor.value;
    if (!descriptor || !("value" in descriptor) || descriptor.enumerable !== true ||
        descriptor.writable !== false || descriptor.configurable !== false || (descriptor.value !== null &&
        valueType !== "string" && valueType !== "boolean" && valueType !== "number")) {
      throw new TypeError("invalid decision");
    }
    decision[key] = descriptor.value;
  }
  const destination = findTrustedDestination(facts, request);
  const expectedValidUntil = decision.accessState === "invited" ? facts.invitation?.expiresAt : null;
  if (decision.schemaVersion !== "1.0" || decision.allowed !== true || decision.code !== "allowed" ||
      decision.channel !== request.channel || decision.buildingId !== request.buildingId ||
      decision.floorId !== request.floorId || decision.elevatorStopId !== request.elevatorStopId ||
      decision.destinationId !== request.destinationId || !setHas(DESTINATION_KINDS, decision.destinationKind) ||
      !setHas(ACCESS_STATES, decision.accessState) || decision.subjectId !== session.subjectId ||
      decision.authorizationReference !== facts.authorizationReference ||
      decision.policyRevision !== facts.policyRevision || decision.evaluatedAt !== evaluatedAt ||
      destination === null || decision.destinationKind !== destination.destinationKind ||
      decision.accessState !== destination.accessState || decision.tenantId !== destination.ownerTenantId ||
      decision.validUntil !== expectedValidUntil) throw new TypeError("invalid decision");
  objectFreeze(decision);
  const wrapper = objectFreeze(objectAssign(objectCreate(null), { decision }));
  const payload = jsonStringify(wrapper);
  if (bufferByteLength(payload) > 2048) throw new TypeError("invalid decision");
  sendJson(response, 200, payload);
}

function parseRoute(rawUrl) {
  if (typeof rawUrl !== "string" || bufferByteLength(rawUrl, "utf8") > 256) return null;
  const match = regexpExec(ROUTE, rawUrl);
  return match === null ? null : objectFreeze({ tenantId: match[1] });
}

function utf8ByteLength(value) {
  let bytes = 0;
  for (let index = 0; index < value.length; index += 1) {
    const code = stringCharCodeAt(value, index);
    if (code <= 0x7f) bytes += 1;
    else if (code <= 0x7ff) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff) {
      const next = stringCharCodeAt(value, index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return null;
      bytes += 4;
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) return null;
    else bytes += 3;
  }
  return bytes;
}

function timestampMilliseconds(value) {
  if (typeof value !== "string" || !regexpTest(TIMESTAMP, value)) return null;
  const milliseconds = dateParse(value);
  if (!numberIsFinite(milliseconds) || dateToISOString(new DateIntrinsic(milliseconds)) !== value) return null;
  return milliseconds;
}

function validHeaderValue(value) {
  for (let index = 0; index < value.length; index += 1) {
    const code = stringCharCodeAt(value, index);
    if ((code < 32 && code !== 9) || code === 127) return false;
  }
  return utf8ByteLength(value) !== null;
}

function snapshotRawHeaders(value) {
  if (!arrayIsArray(value) || isProxy(value) || objectGetPrototypeOf(value) !== Array.prototype) return null;
  const keys = reflectOwnKeys(value);
  const lengthDescriptor = objectGetOwnPropertyDescriptor(value, "length");
  if (!lengthDescriptor || !("value" in lengthDescriptor) || lengthDescriptor.value > 128 ||
      lengthDescriptor.value % 2 !== 0 || keys.length !== lengthDescriptor.value + 1 ||
      keys[keys.length - 1] !== "length") return null;
  const copy = [];
  let bytes = 0;
  for (let index = 0; index < lengthDescriptor.value; index += 1) {
    const key = String(index);
    const descriptor = objectGetOwnPropertyDescriptor(value, key);
    if (keys[index] !== key || !descriptor || !("value" in descriptor) ||
        descriptor.enumerable !== true || typeof descriptor.value !== "string") return null;
    const itemBytes = utf8ByteLength(descriptor.value);
    if (itemBytes === null || (index % 2 === 0
      ? !regexpTest(HEADER_NAME, descriptor.value)
      : !validHeaderValue(descriptor.value))) return null;
    bytes += itemBytes;
    if (bytes > 16_384) return null;
    arrayPush(copy, descriptor.value);
  }
  return copy;
}

function inspectHeaders(headers) {
  let authorization = null;
  let contentLength = null;
  let contentType = null;
  for (let index = 0; index < headers.length; index += 2) {
    const name = stringToLowerCase(headers[index]);
    if (name === "transfer-encoding") return null;
    if (name === "authorization") {
      if (authorization !== null) return null;
      authorization = headers[index + 1];
    } else if (name === "content-length") {
      if (contentLength !== null || !regexpTest(DECIMAL, headers[index + 1])) return null;
      contentLength = NumberIntrinsic(headers[index + 1]);
    } else if (name === "content-type") {
      if (contentType !== null) return null;
      contentType = stringToLowerCase(headers[index + 1]);
    }
  }
  if (authorization === null || !regexpTest(BEARER, authorization)) return null;
  const credentialBytes = utf8ByteLength(stringSlice(authorization, 7));
  if (credentialBytes === null || credentialBytes < 1 || credentialBytes > 256 ||
      !numberIsSafeInteger(contentLength) || contentLength < 2 || contentLength > 2048 ||
      contentType !== "application/json") return null;
  return objectFreeze({ contentLength });
}

async function readBody(request, expectedLength) {
  try {
    const chunks = [];
    let size = 0;
    for await (const chunk of request) {
      if (!(chunk instanceof Uint8ArrayIntrinsic)) return null;
      size += chunk.byteLength;
      if (size > expectedLength || size > 2048) return null;
      arrayPush(chunks, chunk);
    }
    if (request.aborted === true || size !== expectedLength) return null;
    const decoder = new TextDecoderIntrinsic("utf-8", { fatal: true });
    return textDecoderDecode(decoder, bufferConcat(chunks, size));
  } catch {
    return null;
  }
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
      } else if (!regexpTest(/["\\/bfnrt]/, text[cursor.index])) return null;
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

function scanJsonValue(text, cursor, budget, depth = 0) {
  if (depth > 2) return false;
  skipWhitespace(text, cursor);
  if (text[cursor.index] === '"') return parseStringToken(text, cursor) !== null;
  if (text[cursor.index] === "{") {
    budget.containers += 1;
    if (budget.containers > 8) return false;
    cursor.index += 1;
    skipWhitespace(text, cursor);
    const keys = new SetIntrinsic();
    if (text[cursor.index] === "}") { cursor.index += 1; return true; }
    for (;;) {
      const key = parseStringToken(text, cursor);
      if (key === null || utf8ByteLength(key) > 32 || setHas(keys, key)) return false;
      setAdd(keys, key);
      budget.entries += 1;
      if (budget.entries > 32) return false;
      skipWhitespace(text, cursor);
      if (text[cursor.index] !== ":") return false;
      cursor.index += 1;
      if (!scanJsonValue(text, cursor, budget, depth + 1)) return false;
      skipWhitespace(text, cursor);
      if (text[cursor.index] === "}") { cursor.index += 1; return true; }
      if (text[cursor.index] !== ",") return false;
      cursor.index += 1;
      skipWhitespace(text, cursor);
    }
  }
  if (text[cursor.index] === "[") {
    budget.containers += 1;
    if (budget.containers > 8) return false;
    cursor.index += 1;
    skipWhitespace(text, cursor);
    if (text[cursor.index] === "]") { cursor.index += 1; return true; }
    for (;;) {
      budget.entries += 1;
      if (budget.entries > 32 || !scanJsonValue(text, cursor, budget, depth + 1)) return false;
      skipWhitespace(text, cursor);
      if (text[cursor.index] === "]") { cursor.index += 1; return true; }
      if (text[cursor.index] !== ",") return false;
      cursor.index += 1;
    }
  }
  const scalar = regexpExec(/^(?:true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/,
    stringSlice(text, cursor.index));
  if (scalar === null) return false;
  cursor.index += scalar[0].length;
  return true;
}

function parseUnambiguousJson(text) {
  const cursor = { index: 0 };
  if (!scanJsonValue(text, cursor, { containers: 0, entries: 0 })) return null;
  skipWhitespace(text, cursor);
  if (cursor.index !== text.length) return null;
  try { return jsonParse(text); } catch { return null; }
}

function snapshotRequest(value) {
  if (value === null || typeof value !== "object" || arrayIsArray(value) || isProxy(value) ||
      objectGetPrototypeOf(value) !== objectPrototype) return null;
  const keys = reflectOwnKeys(value);
  if (keys.length !== REQUEST_KEYS.length) return null;
  const copy = objectCreate(null);
  for (let index = 0; index < REQUEST_KEYS.length; index += 1) {
    const key = REQUEST_KEYS[index];
    const descriptor = objectGetOwnPropertyDescriptor(value, key);
    if (!descriptor || !("value" in descriptor) || descriptor.enumerable !== true ||
        typeof descriptor.value !== "string") return null;
    copy[key] = descriptor.value;
  }
  if (copy.schemaVersion !== "1.0" || !setHas(CHANNELS, copy.channel) ||
      !regexpTest(ID, copy.buildingId) || !regexpTest(ID, copy.floorId) ||
      !regexpTest(ID, copy.elevatorStopId) || !regexpTest(ID, copy.destinationId)) return null;
  return objectFreeze(copy);
}

function sameKeySet(keys, expected) {
  if (keys.length !== expected.length) return false;
  for (let index = 0; index < keys.length; index += 1) {
    const key = keys[index];
    if (typeof key !== "string" || !arrayIncludes(expected, key)) return false;
  }
  return true;
}

function cloneClosedGraph(value, budget, depth = 0) {
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "string") {
    const bytes = utf8ByteLength(value);
    if (bytes === null) throw new TypeError("invalid graph");
    budget.bytes += bytes;
    if (budget.bytes > 524_288) throw new TypeError("invalid graph");
    return value;
  }
  if (typeof value === "number") {
    if (!numberIsFinite(value) || objectIs(value, -0)) throw new TypeError("invalid graph");
    return value;
  }
  if (typeof value !== "object" || isProxy(value) || depth > 6 || weakSetHas(budget.identities, value)) {
    throw new TypeError("invalid graph");
  }
  weakSetAdd(budget.identities, value);
  budget.containers += 1;
  if (budget.containers > 1250) throw new TypeError("invalid graph");
  const array = arrayIsArray(value);
  const prototype = objectGetPrototypeOf(value);
  if (array ? prototype !== Array.prototype : prototype !== objectPrototype && prototype !== null) {
    throw new TypeError("invalid graph");
  }
  const keys = reflectOwnKeys(value);
  if (array ? keys.length > 513 || keys[keys.length - 1] !== "length" : keys.length > 12) {
    throw new TypeError("invalid graph");
  }
  budget.entries += keys.length;
  if (budget.entries > 7500) throw new TypeError("invalid graph");
  const copy = array ? [] : objectCreate(null);
  const itemCount = array ? keys.length - 1 : keys.length;
  for (let index = 0; index < itemCount; index += 1) {
    const key = keys[index];
    if (typeof key !== "string" || (array && key !== StringIntrinsic(index))) throw new TypeError("invalid graph");
    const keyBytes = utf8ByteLength(key);
    if (keyBytes === null || keyBytes > 64) throw new TypeError("invalid graph");
    budget.bytes += keyBytes;
    const descriptor = objectGetOwnPropertyDescriptor(value, key);
    if (!descriptor || !("value" in descriptor) || descriptor.enumerable !== true) {
      throw new TypeError("invalid graph");
    }
    objectDefineProperty(copy, key, {
      configurable: true,
      enumerable: true,
      value: cloneClosedGraph(descriptor.value, budget, depth + 1),
      writable: true
    });
  }
  if (array) {
    const lengthDescriptor = objectGetOwnPropertyDescriptor(value, "length");
    if (!lengthDescriptor || !("value" in lengthDescriptor) ||
        lengthDescriptor.value !== itemCount || keys.length !== itemCount + 1) {
      throw new TypeError("invalid graph");
    }
  }
  return copy;
}

function cloneTrustedRecord(value, expectedKeys) {
  if (value === null || typeof value !== "object" || isProxy(value)) return null;
  const prototype = objectGetPrototypeOf(value);
  if (prototype !== objectPrototype && prototype !== null) return null;
  const keys = reflectOwnKeys(value);
  if (!sameKeySet(keys, expectedKeys)) return null;
  try {
    return cloneClosedGraph(value, {
      bytes: 0, containers: 0, entries: 0, identities: new WeakSetIntrinsic()
    });
  } catch {
    return null;
  }
}

function snapshotSession(value) {
  const session = cloneTrustedRecord(value, SESSION_KEYS);
  return session && session.authenticated === true && regexpTest(ID, session.sessionId) &&
    regexpTest(ID, session.subjectId) ? objectFreeze(session) : null;
}

function snapshotFacts(value, session, tenantId) {
  const facts = cloneTrustedRecord(value, FACT_KEYS);
  if (!facts || !sameKeySet(reflectOwnKeys(facts.activeTenantMembership ?? {}), MEMBERSHIP_KEYS) ||
      facts.activeTenantMembership.active !== true || facts.activeTenantMembership.tenantId !== tenantId ||
      facts.activeTenantMembership.subjectId !== session.subjectId ||
      !regexpTest(ID, facts.authorizationReference) || !numberIsSafeInteger(facts.policyRevision) ||
      objectIs(facts.policyRevision, -0) || facts.policyRevision < 1 || facts.policyRevision > 2147483647) return null;
  return facts;
}

function trustedOptions(facts, session, evaluatedAt) {
  return objectFreeze({
    catalog: facts.catalog,
    authorization: objectFreeze({
      kind: "trusted-server-context",
      authenticatedSubjectId: session.subjectId,
      authenticatedSessionId: session.sessionId,
      ownerTenantLifecycles: facts.ownerTenantLifecycles,
      activeTenantMembership: facts.activeTenantMembership,
      privateDestinationGrants: facts.privateDestinationGrants,
      invitation: facts.invitation,
      restrictedDestinationAuthorities: facts.restrictedDestinationAuthorities,
      authorizationReference: facts.authorizationReference,
      policyRevision: facts.policyRevision
    }),
    evaluatedAt
  });
}

function equalFields(left, right, keys) {
  for (let index = 0; index < keys.length; index += 1) {
    const key = keys[index];
    if (!objectIs(left[key], right[key])) return false;
  }
  return true;
}

function equalExactRecord(left, right, keys) {
  return sameKeySet(reflectOwnKeys(left), keys) && sameKeySet(reflectOwnKeys(right), keys) &&
    equalFields(left, right, keys);
}

function equalOrdered(left, right, compare) {
  if (!arrayIsArray(left) || !arrayIsArray(right) || left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) if (!compare(left[index], right[index])) return false;
  return true;
}

function equalDestination(left, right) {
  return equalExactRecord(left, right, DESTINATION_KEYS);
}

function equalFloor(left, right) {
  if (!sameKeySet(reflectOwnKeys(left), FLOOR_KEYS) || !sameKeySet(reflectOwnKeys(right), FLOOR_KEYS) ||
      !equalFields(left, right, FLOOR_SCALAR_KEYS)) return false;
  return equalOrdered(left.destinations, right.destinations, equalDestination);
}

function equalCatalog(left, right) {
  if (!sameKeySet(reflectOwnKeys(left), CATALOG_KEYS) || !sameKeySet(reflectOwnKeys(right), CATALOG_KEYS) ||
      left.schemaVersion !== right.schemaVersion ||
      !sameKeySet(reflectOwnKeys(left.building), BUILDING_KEYS) ||
      !sameKeySet(reflectOwnKeys(right.building), BUILDING_KEYS) ||
      !equalFields(left.building, right.building, BUILDING_SCALAR_KEYS)) return false;
  return equalOrdered(left.building.floors, right.building.floors, equalFloor);
}

function equalInvitation(left, right) {
  return left === null || right === null ? left === right : equalExactRecord(left, right, INVITATION_KEYS);
}

function equalFacts(left, right) {
  return sameKeySet(reflectOwnKeys(left), FACT_KEYS) && sameKeySet(reflectOwnKeys(right), FACT_KEYS) &&
    equalCatalog(left.catalog, right.catalog) &&
    equalExactRecord(left.activeTenantMembership, right.activeTenantMembership, MEMBERSHIP_KEYS) &&
    equalOrdered(left.ownerTenantLifecycles, right.ownerTenantLifecycles,
      (first, second) => equalExactRecord(first, second, OWNER_KEYS)) &&
    equalInvitation(left.invitation, right.invitation) &&
    equalOrdered(left.privateDestinationGrants, right.privateDestinationGrants,
      (first, second) => equalExactRecord(first, second, SCOPE_KEYS)) &&
    equalOrdered(left.restrictedDestinationAuthorities, right.restrictedDestinationAuthorities,
      (first, second) => equalExactRecord(first, second, SCOPE_KEYS)) &&
    objectIs(left.authorizationReference, right.authorizationReference) &&
    objectIs(left.policyRevision, right.policyRevision);
}

function requestSocket(request) {
  try {
    const descriptor = objectGetOwnPropertyDescriptor(request, "socket");
    if (!descriptor || !("value" in descriptor) || descriptor.writable !== true ||
        descriptor.enumerable !== true || descriptor.configurable !== true ||
        descriptor.value === null || typeof descriptor.value !== "object" || isProxy(descriptor.value) ||
        descriptor.value.destroyed !== false) return null;
    return descriptor.value;
  } catch {
    return null;
  }
}

function sameRequestShell(request, originalRequest, capturedSocket, ownsListenerRequest,
    rawUrl, method, rawHeadersSource, rawHeaders) {
  let descriptor;
  try {
    if (request !== originalRequest || ownsListenerRequest(request) !== true) return false;
    descriptor = objectGetOwnPropertyDescriptor(request, "socket");
  } catch {
    return false;
  }
  if (!descriptor || !("value" in descriptor) || descriptor.writable !== true ||
      descriptor.enumerable !== true || descriptor.configurable !== true ||
      descriptor.value !== capturedSocket || capturedSocket.destroyed !== false ||
      request.aborted !== false || request.complete !== true || request.readableEnded !== true ||
      request.readableAborted !== false || request.url !== rawUrl || request.method !== method ||
      request.rawHeaders !== rawHeadersSource) return false;
  const currentHeaders = snapshotRawHeaders(request.rawHeaders);
  if (currentHeaders === null || currentHeaders.length !== rawHeaders.length) return false;
  for (let index = 0; index < rawHeaders.length; index += 1) {
    if (currentHeaders[index] !== rawHeaders[index]) return false;
  }
  return true;
}

export function createTenantSkyscraperNavigationApiHandler(input) {
  const dependencies = exactDependencies(input);
  if (dependencies === null) {
    throw new TypeError("private navigation dependencies are required");
  }
  return objectFreeze(async function tenantSkyscraperNavigationApiHandler(request, response) {
    try {
      if (request === null || typeof request !== "object" || isProxy(request)) return deny(response);
      if (dependencies.ownsListenerRequest(request) !== true) return deny(response);
      const originalRequest = request;
      const capturedSocket = requestSocket(request);
      if (capturedSocket === null) return deny(response);
      const rawUrl = request.url;
      const method = request.method;
      const route = parseRoute(rawUrl);
      if (route !== null && method === "POST") {
        const rawHeadersSource = request.rawHeaders;
        const rawHeaders = snapshotRawHeaders(rawHeadersSource);
        const headers = rawHeaders === null ? null : inspectHeaders(rawHeaders);
        const bodyText = headers === null ? null : await readBody(request, headers.contentLength);
        const body = bodyText === null ? null : snapshotRequest(parseUnambiguousJson(bodyText));
        if (body !== null && sameRequestShell(request, originalRequest, capturedSocket,
            dependencies.ownsListenerRequest, rawUrl, method, rawHeadersSource, rawHeaders) &&
            sameRequestShell(request, originalRequest, capturedSocket,
              dependencies.ownsListenerRequest, rawUrl, method, rawHeadersSource, rawHeaders)) {
          const sourceSession = await dependencies.resolveTrustedSession(request);
          const session = snapshotSession(sourceSession);
          if (session !== null && sameRequestShell(request, originalRequest, capturedSocket,
              dependencies.ownsListenerRequest, rawUrl, method, rawHeadersSource, rawHeaders)) {
            const factsSource = await dependencies.resolveTrustedNavigationFacts(objectFreeze({
              session: sourceSession,
              tenantId: route.tenantId
            }));
            const facts = snapshotFacts(factsSource, session, route.tenantId);
            const destination = facts === null ? null : findTrustedDestination(facts, body);
            if (facts !== null && destination !== null &&
                (destination.accessState === "public"
                  ? destination.ownerTenantId === null
                  : destination.ownerTenantId === route.tenantId) &&
                sameRequestShell(request, originalRequest, capturedSocket,
                  dependencies.ownsListenerRequest, rawUrl, method, rawHeadersSource, rawHeaders)) {
              const evaluatedAt = dependencies.now();
              const evaluatedMilliseconds = timestampMilliseconds(evaluatedAt);
              if (evaluatedMilliseconds !== null) {
                const authorizer = createTenantSkyscraperNavigationAuthorizer(
                  trustedOptions(facts, session, evaluatedAt)
                );
                const result = authorizer.decideNavigation(body);
                const decision = exactSuccessDecision(result);
                if (decision !== null &&
                    sameRequestShell(request, originalRequest, capturedSocket,
                      dependencies.ownsListenerRequest, rawUrl, method, rawHeadersSource, rawHeaders)) {
                  const secondSourceSession = await dependencies.resolveTrustedSession(request);
                  const secondSession = snapshotSession(secondSourceSession);
                  if (secondSession !== null && equalExactRecord(session, secondSession, SESSION_KEYS) &&
                      sameRequestShell(request, originalRequest, capturedSocket,
                        dependencies.ownsListenerRequest, rawUrl, method, rawHeadersSource, rawHeaders)) {
                    const secondFactsSource = await dependencies.resolveTrustedNavigationFacts(objectFreeze({
                      session: secondSourceSession,
                      tenantId: route.tenantId
                    }));
                    const secondFacts = snapshotFacts(secondFactsSource, secondSession, route.tenantId);
                    const finalTime = dependencies.now();
                    const finalMilliseconds = timestampMilliseconds(finalTime);
                    const invitationExpiry = decision.accessState === "invited"
                      ? timestampMilliseconds(decision.validUntil) : null;
                    if (secondFacts !== null && equalFacts(facts, secondFacts) &&
                        sameRequestShell(request, originalRequest, capturedSocket,
                          dependencies.ownsListenerRequest, rawUrl, method, rawHeadersSource, rawHeaders) &&
                        finalMilliseconds !== null && finalMilliseconds >= evaluatedMilliseconds &&
                        (decision.accessState !== "invited" || invitationExpiry !== null && finalMilliseconds < invitationExpiry)) {
                      return sendDecision(response, decision, body, session, facts, evaluatedAt);
                    }
                  }
                }
              }
            }
          }
        }
      }
      deny(response);
    } catch {
      let headersSent = true;
      try { headersSent = response.headersSent === true; } catch { /* assume a partial write */ }
      if (!headersSent) {
        try {
          deny(response);
          return;
        } catch { /* fall through to connection destruction */ }
      }
      try { response.destroy(); } catch { /* response unavailable */ }
    }
  });
}
