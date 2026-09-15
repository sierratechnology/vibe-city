type RecordValue = Record<string, unknown>;

const EXPECTATION_KEYS = ["schemaVersion", "channel", "buildingId", "floorId", "elevatorStopId", "destinationId"];
const AUTHORITY_KEYS = ["subjectId", "tenantId", "authorizationReference", "policyRevision", "active"];
const RESPONSE_KEYS = ["status", "contentType", "contentLength", "bodyText"];
const DECISION_KEYS = ["schemaVersion", "allowed", "code", "channel", "buildingId", "floorId", "elevatorStopId", "destinationId", "destinationKind", "accessState", "subjectId", "tenantId", "authorizationReference", "policyRevision", "evaluatedAt", "validUntil"];
const ID = /^id_[a-f0-9]{16,64}$/;
const CANONICAL_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const FOUR_HEX = /^[a-fA-F0-9]{4}$/;
const regexpTest = Function.call.bind(RegExp.prototype.test) as (expression: RegExp, value: string) => boolean;
const reflectOwnKeys = Reflect.ownKeys;
const objectGetPrototypeOf = Object.getPrototypeOf;
const objectGetOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const objectIs = Object.is;
const objectCreate = Object.create;
const arrayIsArray = Array.isArray;
const objectPrototype = Object.prototype;
const cloneRecord = structuredClone;
const numberIsFinite = Number.isFinite;
const numberIsSafeInteger = Number.isSafeInteger;
const textEncoder = new TextEncoder();
const encodeText = textEncoder.encode.bind(textEncoder);
const parseJson = JSON.parse;
const dateParse = Date.parse;
const dateToISOString = Function.call.bind(Date.prototype.toISOString) as (date: Date) => string;
const freeze = Object.freeze;

function unavailable() {
  const result = objectCreate(null);
  result.status = "unavailable";
  return freeze(result);
}

function available(accessState: string) {
  const result = objectCreate(null);
  result.status = "available";
  result.accessState = accessState;
  return freeze(result);
}

function exactRecord(value: unknown, keys: string[], allowNullPrototype = false): RecordValue | null {
  if (value === null || typeof value !== "object" || arrayIsArray(value)) return null;
  try {
    const prototype = objectGetPrototypeOf(value);
    if (prototype !== objectPrototype && !(allowNullPrototype && prototype === null)) return null;
    const ownKeys = reflectOwnKeys(value);
    if (!objectIs(ownKeys.length, keys.length)) return null;
    const descriptors = [];
    for (let index = 0; index < keys.length; index += 1) {
      if (ownKeys[index] !== keys[index]) return null;
      const descriptor = objectGetOwnPropertyDescriptor(value, keys[index]);
      if (!descriptor || !("value" in descriptor) || descriptor.enumerable !== true) return null;
      descriptors.push(descriptor);
    }
    cloneRecord(value);
    if (objectGetPrototypeOf(value) !== prototype) return null;
    const recheckedKeys = reflectOwnKeys(value);
    if (recheckedKeys.length !== ownKeys.length) return null;
    for (let index = 0; index < ownKeys.length; index += 1) {
      if (recheckedKeys[index] !== ownKeys[index]) return null;
      const before = descriptors[index];
      const after = objectGetOwnPropertyDescriptor(value, keys[index]);
      if (!after || !("value" in after) || after.enumerable !== before.enumerable ||
          after.configurable !== before.configurable || after.writable !== before.writable ||
          !objectIs(after.value, before.value)) return null;
    }
    return value as RecordValue;
  } catch {
    return null;
  }
}

function normalizeJsonSpelling(value: string) {
  let result = "";
  let token = "";
  let quoted = false;
  let escaped = false;
  for (const character of value) {
    if (quoted) {
      token += character;
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') {
        quoted = false;
        result += JSON.stringify(parseJson(token));
        token = "";
      }
    } else if (character === '"') {
      quoted = true;
      token = character;
    } else if (character !== " " && character !== "\t" && character !== "\r" && character !== "\n") {
      result += character;
    }
  }
  return result;
}

function isBoundedJsonObject(value: string) {
  let index = 0;
  let containers = 0;
  let entries = 0;
  const whitespace = () => {
    while (value[index] === " " || value[index] === "\t" || value[index] === "\r" || value[index] === "\n") index += 1;
  };
  const stringToken = (): string | undefined => {
    if (value[index] !== '"') return undefined;
    index += 1;
    let result = "";
    while (index < value.length) {
      const character = value[index];
      index += 1;
      if (character === '"') return result;
      if (character.charCodeAt(0) < 32) return undefined;
      if (character !== "\\") {
        result += character;
        continue;
      }
      const escape = value[index];
      index += 1;
      const escaped = { '"': '"', "\\": "\\", "/": "/", b: "\b", f: "\f", n: "\n", r: "\r", t: "\t" }[escape];
      if (escaped !== undefined) {
        result += escaped;
        continue;
      }
      if (escape !== "u") return undefined;
      const hexadecimal = value.slice(index, index + 4);
      if (!regexpTest(FOUR_HEX, hexadecimal)) return undefined;
      index += 4;
      const codeUnit = Number.parseInt(hexadecimal, 16);
      if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
        if (value.slice(index, index + 2) !== "\\u") return undefined;
        const lowHexadecimal = value.slice(index + 2, index + 6);
        if (!regexpTest(FOUR_HEX, lowHexadecimal)) return undefined;
        const lowCodeUnit = Number.parseInt(lowHexadecimal, 16);
        if (lowCodeUnit < 0xdc00 || lowCodeUnit > 0xdfff) return undefined;
        index += 6;
        result += String.fromCharCode(codeUnit, lowCodeUnit);
      } else {
        if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) return undefined;
        result += String.fromCharCode(codeUnit);
      }
    }
    return undefined;
  };
  const numberToken = () => {
    const start = index;
    if (value[index] === "-") index += 1;
    if (value[index] === "0") index += 1;
    else {
      if (value[index] < "1" || value[index] > "9") return false;
      while (value[index] >= "0" && value[index] <= "9") index += 1;
    }
    if (value[index] === ".") {
      index += 1;
      const fraction = index;
      while (value[index] >= "0" && value[index] <= "9") index += 1;
      if (index === fraction) return false;
    }
    if (value[index] === "e" || value[index] === "E") {
      index += 1;
      if (value[index] === "+" || value[index] === "-") index += 1;
      const exponent = index;
      while (value[index] >= "0" && value[index] <= "9") index += 1;
      if (index === exponent) return false;
    }
    return index > start;
  };
  let objectToken: (depth: number) => boolean;
  const token = (depth: number): boolean => {
    whitespace();
    if (value[index] === '"') return stringToken() !== undefined;
    if (value[index] === "{") return objectToken(depth + 1);
    if (value[index] === "[") return false;
    for (const literal of ["true", "false", "null"]) {
      if (value.slice(index, index + literal.length) === literal) {
        index += literal.length;
        return true;
      }
    }
    return numberToken();
  };
  objectToken = (depth: number) => {
    if (depth > 2 || value[index] !== "{" || ++containers > 2) return false;
    index += 1;
    whitespace();
    if (value[index] === "}") {
      index += 1;
      return true;
    }
    const keys = new Set<string>();
    while (index < value.length) {
      const key = stringToken();
      if (key === undefined || keys.has(key) || ++entries > 17) return false;
      keys.add(key);
      whitespace();
      if (value[index] !== ":") return false;
      index += 1;
      if (!token(depth)) return false;
      whitespace();
      if (value[index] === "}") {
        index += 1;
        return true;
      }
      if (value[index] !== ",") return false;
      index += 1;
      whitespace();
    }
    return false;
  };
  whitespace();
  if (!objectToken(1)) return false;
  whitespace();
  return index === value.length;
}

function parseCanonicalTimestamp(value: unknown) {
  if (typeof value !== "string" || !regexpTest(CANONICAL_TIMESTAMP, value)) return null;
  const milliseconds = dateParse(value);
  if (!numberIsSafeInteger(milliseconds) || dateToISOString(new Date(milliseconds)) !== value) return null;
  return milliseconds;
}

function validNavigationId(value: unknown): value is string {
  return typeof value === "string" && regexpTest(ID, value);
}

function validCanonicalConstruction(expectation: unknown, authority: unknown) {
  const request = exactRecord(expectation, EXPECTATION_KEYS, true);
  const grant = exactRecord(authority, AUTHORITY_KEYS, true);
  if (!request || !grant) return null;
  if (request.schemaVersion !== "1.0" ||
      (request.channel !== "door" && request.channel !== "elevator" &&
       request.channel !== "direct" && request.channel !== "alternative") ||
      !validNavigationId(request.buildingId) || !validNavigationId(request.floorId) ||
      !validNavigationId(request.elevatorStopId) || !validNavigationId(request.destinationId) ||
      !validNavigationId(grant.subjectId) || !validNavigationId(grant.tenantId) ||
      !validNavigationId(grant.authorizationReference) || typeof grant.policyRevision !== "number" ||
      !numberIsSafeInteger(grant.policyRevision) ||
      grant.policyRevision < 1 || grant.policyRevision > 2147483647 ||
      objectIs(grant.policyRevision, -0) || grant.active !== true) return null;
  return { request: { ...request }, grant: { ...grant } };
}

function decodeCanonical(construction: ReturnType<typeof validCanonicalConstruction>, response: unknown, trustedPostResponseMs: unknown) {
  if (!construction) return unavailable();
  const shell = exactRecord(response, RESPONSE_KEYS, true);
  if (!shell || typeof trustedPostResponseMs !== "number" || !numberIsFinite(trustedPostResponseMs) ||
      !numberIsSafeInteger(trustedPostResponseMs) || trustedPostResponseMs < 0 || objectIs(trustedPostResponseMs, -0) ||
      shell.status !== 200 ||
      shell.contentType !== "application/json; charset=utf-8" || typeof shell.bodyText !== "string" ||
      typeof shell.contentLength !== "number" || shell.contentLength < 2 || shell.contentLength > 2048 ||
      shell.contentLength !== encodeText(shell.bodyText).byteLength) return unavailable();
  try {
    if (!isBoundedJsonObject(shell.bodyText)) return unavailable();
    const parsed = parseJson(shell.bodyText) as unknown;
    const wrapper = exactRecord(parsed, ["decision"]);
    const decision = wrapper && exactRecord(wrapper.decision, DECISION_KEYS);
    const normalizedBody = normalizeJsonSpelling(shell.bodyText);
    if (!decision || normalizedBody !== JSON.stringify({ decision })) return unavailable();
    const request = construction.request;
    const grant = construction.grant;
    const evaluatedMs = parseCanonicalTimestamp(decision.evaluatedAt);
    const validUntilMs = decision.accessState === "invited" ? parseCanonicalTimestamp(decision.validUntil) : null;
    if (decision.schemaVersion !== "1.0" || decision.allowed !== true || decision.code !== "allowed" ||
        decision.channel !== request.channel || decision.buildingId !== request.buildingId ||
        decision.floorId !== request.floorId || decision.elevatorStopId !== request.elevatorStopId ||
        decision.destinationId !== request.destinationId ||
        (decision.destinationKind !== "suite" && decision.destinationKind !== "shared_space") ||
        (decision.accessState !== "public" && decision.accessState !== "tenant" && decision.accessState !== "invited" &&
         decision.accessState !== "private" && decision.accessState !== "restricted") ||
        decision.subjectId !== grant.subjectId ||
        decision.tenantId !== (decision.accessState === "public" ? null : grant.tenantId) ||
        decision.authorizationReference !== grant.authorizationReference || decision.policyRevision !== grant.policyRevision ||
        evaluatedMs === null || evaluatedMs > trustedPostResponseMs || evaluatedMs < trustedPostResponseMs - 5000 ||
        (decision.accessState === "invited"
          ? validUntilMs === null || validUntilMs <= trustedPostResponseMs
          : decision.validUntil !== null)) return unavailable();
    return available(decision.accessState as string);
  } catch {
    return unavailable();
  }
}

export function createPrivateTenantNavigationDecisionDecoder(expectation?: unknown, authority?: unknown) {
  const construction = validCanonicalConstruction(expectation, authority);
  const decode = freeze(function decode(response?: unknown, trustedPostResponseMs?: unknown) {
    return decodeCanonical(construction, response, trustedPostResponseMs);
  });
  const decoder = objectCreate(null);
  decoder.decode = decode;
  return freeze(decoder);
}
