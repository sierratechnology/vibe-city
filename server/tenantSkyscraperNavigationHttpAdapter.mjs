import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import { isProxy } from 'node:util/types';
import { TextDecoder } from 'node:util';

const arrayIsArray = Array.isArray;
const arrayIncludes = Function.call.bind(Array.prototype.includes);
const arrayPush = Function.call.bind(Array.prototype.push);
const bufferByteLength = Buffer.byteLength.bind(Buffer);
const bufferConcat = Buffer.concat.bind(Buffer);
const bufferFrom = Buffer.from.bind(Buffer);
const bufferIsBuffer = Buffer.isBuffer;
const DateIntrinsic = Date;
const dateParse = Date.parse.bind(Date);
const dateToISOString = Function.call.bind(Date.prototype.toISOString);
const eventEmitterOn = Function.call.bind(EventEmitter.prototype.on);
const eventEmitterRemoveListener = Function.call.bind(EventEmitter.prototype.removeListener);
const jsonParse = JSON.parse.bind(JSON);
const jsonStringify = JSON.stringify.bind(JSON);
const numberIsFinite = Number.isFinite;
const numberIsSafeInteger = Number.isSafeInteger;
const objectAssign = Object.assign;
const objectCreate = Object.create;
const objectFreeze = Object.freeze;
const objectIsFrozen = Object.isFrozen;
const objectIsPrototypeOf = Function.call.bind(Object.prototype.isPrototypeOf);
const objectSetPrototypeOf = Object.setPrototypeOf;
const getDescriptor = Object.getOwnPropertyDescriptor;
const getPrototype = Object.getPrototypeOf;
const ObjectPrototype = Object.prototype;
const queueMicrotaskIntrinsic = queueMicrotask;
const reflectApply = Reflect.apply;
const reflectOwnKeys = Reflect.ownKeys;
const regexpTest = Function.call.bind(RegExp.prototype.test);
const readableOn = Function.call.bind(Readable.prototype.on);
const SetIntrinsic = Set;
const setAdd = Function.call.bind(Set.prototype.add);
const setHas = Function.call.bind(Set.prototype.has);
const stringCharCodeAt = Function.call.bind(String.prototype.charCodeAt);
const stringSlice = Function.call.bind(String.prototype.slice);
const stringToLowerCase = Function.call.bind(String.prototype.toLowerCase);
const utf8Decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: false });

const ROUTE = '/api/private/skyscraper-navigation/decision';
const MAX_RAW_HEADER_ELEMENTS = 128;
const CREDENTIAL = /^Bearer session_[A-Za-z0-9._~-]{16,256}$/;
const ID = /^id_[a-f0-9]{16,64}$/;
const TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const CHANNELS = objectFreeze(['door', 'elevator', 'direct', 'alternative']);
const REQUEST_EVENTS = objectFreeze(['data', 'end', 'aborted', 'error']);
const REGISTRATION_EVENTS = objectFreeze(['newListener', 'removeListener']);
const BODY_KEYS = objectFreeze(['schemaVersion', 'navigation']);
const NAVIGATION_KEYS = objectFreeze([
  'schemaVersion', 'channel', 'buildingId', 'floorId', 'elevatorStopId', 'destinationId',
]);
const RESULT_KEYS = objectFreeze(['ok', 'decision']);
const DECISION_KEYS = objectFreeze([
  'allowed', 'code', 'schemaVersion', 'channel', 'buildingId', 'floorId',
  'elevatorStopId', 'destinationId', 'destinationKind', 'accessState', 'subjectId',
  'tenantId', 'authorizationReference', 'policyRevision', 'evaluatedAt', 'validUntil',
]);
const DENIAL = bufferFrom('{"ok":false,"code":"not_found"}', 'utf8');
const RESPONSE_HEADERS = objectFreeze(objectAssign(objectCreate(null), {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'private, no-store',
  'x-content-type-options': 'nosniff',
  vary: 'Authorization',
}));

function exactRecord(value, expectedKeys, frozenNull = false) {
  if (value === null || typeof value !== 'object' || arrayIsArray(value) || isProxy(value)) return null;
  const prototype = getPrototype(value);
  if (frozenNull ? prototype !== null || !objectIsFrozen(value)
    : prototype !== ObjectPrototype && prototype !== null) return null;
  const keys = reflectOwnKeys(value);
  if (keys.length !== expectedKeys.length) return null;
  const copy = objectCreate(null);
  for (let index = 0; index < expectedKeys.length; index += 1) {
    const key = expectedKeys[index];
    const descriptor = getDescriptor(value, key);
    if (!arrayIncludes(keys, key) || !descriptor || !('value' in descriptor)
        || descriptor.enumerable !== true
        || (frozenNull && (descriptor.writable !== false || descriptor.configurable !== false))) {
      return null;
    }
    copy[key] = descriptor.value;
  }
  return copy;
}

function timestampMillis(value) {
  if (typeof value !== 'string' || !regexpTest(TIME, value)) return null;
  const milliseconds = dateParse(value);
  if (!numberIsFinite(milliseconds)
      || dateToISOString(new DateIntrinsic(milliseconds)) !== value) return null;
  return milliseconds;
}

function rawHeaderValues(rawHeaders) {
  if (!arrayIsArray(rawHeaders) || isProxy(rawHeaders)) return null;
  const lengthDescriptor = getDescriptor(rawHeaders, 'length');
  if (!lengthDescriptor || !('value' in lengthDescriptor)
      || !numberIsSafeInteger(lengthDescriptor.value) || lengthDescriptor.value % 2 !== 0
      || lengthDescriptor.value > MAX_RAW_HEADER_ELEMENTS) return null;
  let authorizationCount = 0;
  let authorization = null;
  let contentTypeCount = 0;
  let contentType = null;
  for (let index = 0; index < lengthDescriptor.value; index += 2) {
    const nameDescriptor = getDescriptor(rawHeaders, `${index}`);
    const valueDescriptor = getDescriptor(rawHeaders, `${index + 1}`);
    if (!nameDescriptor || !('value' in nameDescriptor)
        || !valueDescriptor || !('value' in valueDescriptor)) return null;
    const name = nameDescriptor.value;
    const value = valueDescriptor.value;
    if (typeof name !== 'string') return null;
    const normalizedName = stringToLowerCase(name);
    if (normalizedName === 'authorization') {
      if (typeof value !== 'string') return null;
      authorizationCount += 1;
      authorization = value;
    } else if (normalizedName === 'content-type') {
      if (typeof value !== 'string') return null;
      contentTypeCount += 1;
      contentType = value;
    }
  }
  return objectAssign(objectCreate(null), {
    authorization: authorizationCount === 1 ? authorization : null,
    contentType: contentTypeCount === 1 ? contentType : null,
  });
}

function requestState(request) {
  const aborted = getDescriptor(request, 'aborted');
  const complete = getDescriptor(request, 'complete');
  const destroyed = getDescriptor(request, 'destroyed');
  if (!aborted || !('value' in aborted) || typeof aborted.value !== 'boolean'
      || !complete || !('value' in complete) || typeof complete.value !== 'boolean'
      || (destroyed && (!('value' in destroyed) || typeof destroyed.value !== 'boolean'))) return null;
  return objectAssign(objectCreate(null), {
    aborted: aborted.value,
    complete: complete.value,
    destroyed: destroyed ? destroyed.value : false,
  });
}

function requestSnapshot(request) {
  if (!request || typeof request !== 'object' || isProxy(request)) return null;
  const method = getDescriptor(request, 'method');
  const url = getDescriptor(request, 'url');
  const headers = getDescriptor(request, 'headers');
  const rawHeaders = getDescriptor(request, 'rawHeaders');
  const state = requestState(request);
  if (!method || !('value' in method) || typeof method.value !== 'string'
      || !url || !('value' in url) || typeof url.value !== 'string'
      || (headers && (!('value' in headers) || !headers.value
        || typeof headers.value !== 'object' || isProxy(headers.value)))
      || !rawHeaders || !('value' in rawHeaders) || !state) return null;
  return objectAssign(objectCreate(null), {
    method: method.value,
    url: url.value,
    rawHeaders: rawHeaders.value,
  });
}

function authorizationHeader(value) {
  return typeof value === 'string' && regexpTest(CREDENTIAL, value)
    ? stringSlice(value, 7) : null;
}

function addRequestListener(request, eventName, listener) {
  if (objectIsPrototypeOf(Readable.prototype, request)) {
    readableOn(request, eventName, listener);
  } else {
    eventEmitterOn(request, eventName, listener);
  }
}

function safeListenerBoundary(request) {
  if (!objectIsPrototypeOf(EventEmitter.prototype, request)) return false;
  const eventsDescriptor = getDescriptor(request, '_events');
  const maxListenersDescriptor = getDescriptor(request, '_maxListeners');
  const readableStateDescriptor = getDescriptor(request, '_readableState');
  if (!eventsDescriptor || !('value' in eventsDescriptor)
      || !eventsDescriptor.value || typeof eventsDescriptor.value !== 'object'
      || isProxy(eventsDescriptor.value)
      || !maxListenersDescriptor || !('value' in maxListenersDescriptor)) return false;
  if (readableStateDescriptor
      && (!('value' in readableStateDescriptor) || !readableStateDescriptor.value
        || typeof readableStateDescriptor.value !== 'object'
        || isProxy(readableStateDescriptor.value))) return false;
  const eventsPrototype = getPrototype(eventsDescriptor.value);
  if (eventsPrototype !== null) {
    const dataDescriptor = getDescriptor(eventsDescriptor.value, 'data');
    const endDescriptor = getDescriptor(eventsDescriptor.value, 'end');
    const errorDescriptor = getDescriptor(eventsDescriptor.value, 'error');
    if (eventsPrototype !== ObjectPrototype
        || !objectIsPrototypeOf(Readable.prototype, request)
        || !dataDescriptor || !('value' in dataDescriptor) || dataDescriptor.writable !== true
        || !endDescriptor || !('value' in endDescriptor) || endDescriptor.writable !== true
        || !errorDescriptor || !('value' in errorDescriptor) || errorDescriptor.writable !== true) {
      return false;
    }
    objectSetPrototypeOf(eventsDescriptor.value, null);
  }
  for (let index = 0; index < REGISTRATION_EVENTS.length; index += 1) {
    const descriptor = getDescriptor(eventsDescriptor.value, REGISTRATION_EVENTS[index]);
    if (descriptor && (!('value' in descriptor) || descriptor.value !== undefined)) return false;
  }
  for (let index = 0; index < REQUEST_EVENTS.length; index += 1) {
    const descriptor = getDescriptor(eventsDescriptor.value, REQUEST_EVENTS[index]);
    if (descriptor && (!('value' in descriptor) || descriptor.writable !== true
      || (descriptor.value !== undefined && typeof descriptor.value !== 'function'))) return false;
  }
  return true;
}

function removeRequestListeners(request, listeners, start, end) {
  for (let index = start; index < end; index += 1) {
    try {
      eventEmitterRemoveListener(request, listeners[index][0], listeners[index][1]);
    } catch { /* preflight makes cleanup non-callbacking; still fail closed */ }
  }
}

function readBody(request) {
  if (!safeListenerBoundary(request)) throw new TypeError('invalid body');
  return new Promise((resolve, reject) => {
    const chunks = [];
    let bytes = 0;
    let events = 0;
    let settled = false;
    let listeners;
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      removeRequestListeners(request, listeners, 0, 3);
      queueMicrotaskIntrinsic(() => {
        removeRequestListeners(request, listeners, 3, 4);
      });
      if (error) reject(error);
      else resolve(value);
    };
    const onData = (chunk) => {
      events += 1;
      if (events > 1024 || !bufferIsBuffer(chunk)) {
        finish(new TypeError('invalid body'));
        return;
      }
      bytes += chunk.length;
      if (bytes > 8192) {
        finish(new TypeError('invalid body'));
        return;
      }
      arrayPush(chunks, chunk);
    };
    const onEnd = () => {
      events += 1;
      const state = requestState(request);
      if (events > 1024 || !state || state.aborted || (state.destroyed && !state.complete)) {
        finish(new TypeError('invalid body'));
        return;
      }
      finish(null, bufferConcat(chunks, bytes));
    };
    const onAborted = () => finish(new TypeError('invalid body'));
    const onError = () => finish(new TypeError('invalid body'));
    listeners = [
      ['data', onData],
      ['end', onEnd],
      ['aborted', onAborted],
      ['error', onError],
    ];
    const attached = [];
    try {
      for (let index = 0; index < listeners.length; index += 1) {
        addRequestListener(request, listeners[index][0], listeners[index][1]);
        arrayPush(attached, listeners[index]);
      }
    } catch (error) {
      removeRequestListeners(request, attached, 0, attached.length);
      throw error;
    }
    const state = requestState(request);
    if (!state || state.aborted || (state.destroyed && !state.complete)) {
      finish(new TypeError('invalid body'));
    }
  });
}

function uniqueJsonKeys(text) {
  let index = 0;
  let tokens = 0;
  const skipWhitespace = () => {
    while (index < text.length) {
      const code = stringCharCodeAt(text, index);
      if (code !== 0x20 && code !== 0x09 && code !== 0x0a && code !== 0x0d) break;
      index += 1;
    }
  };
  const parseString = () => {
    const start = index;
    index += 1;
    while (index < text.length) {
      const code = stringCharCodeAt(text, index);
      index += 1;
      if (code === 0x22) return jsonParse(stringSlice(text, start, index));
      if (code === 0x5c) {
        if (stringCharCodeAt(text, index) === 0x75) index += 5;
        else index += 1;
      }
    }
    throw new TypeError('invalid JSON');
  };
  const parseValue = (depth) => {
    tokens += 1;
    if (tokens > 2048 || depth > 16) throw new TypeError('invalid JSON');
    skipWhitespace();
    const code = stringCharCodeAt(text, index);
    if (code === 0x7b) {
      index += 1;
      const keys = new SetIntrinsic();
      skipWhitespace();
      if (stringCharCodeAt(text, index) === 0x7d) { index += 1; return; }
      for (;;) {
        skipWhitespace();
        if (stringCharCodeAt(text, index) !== 0x22) throw new TypeError('invalid JSON');
        const key = parseString();
        if (setHas(keys, key)) throw new TypeError('duplicate JSON key');
        setAdd(keys, key);
        skipWhitespace();
        if (stringCharCodeAt(text, index) !== 0x3a) throw new TypeError('invalid JSON');
        index += 1;
        parseValue(depth + 1);
        skipWhitespace();
        const delimiter = stringCharCodeAt(text, index);
        index += 1;
        if (delimiter === 0x7d) return;
        if (delimiter !== 0x2c) throw new TypeError('invalid JSON');
      }
    }
    if (code === 0x5b) {
      index += 1;
      skipWhitespace();
      if (stringCharCodeAt(text, index) === 0x5d) { index += 1; return; }
      for (;;) {
        parseValue(depth + 1);
        skipWhitespace();
        const delimiter = stringCharCodeAt(text, index);
        index += 1;
        if (delimiter === 0x5d) return;
        if (delimiter !== 0x2c) throw new TypeError('invalid JSON');
      }
    }
    if (code === 0x22) { parseString(); return; }
    while (index < text.length) {
      const valueCode = stringCharCodeAt(text, index);
      if (valueCode === 0x2c || valueCode === 0x5d || valueCode === 0x7d
          || valueCode === 0x20 || valueCode === 0x09 || valueCode === 0x0a
          || valueCode === 0x0d) return;
      index += 1;
    }
  };
  parseValue(0);
  skipWhitespace();
  return index === text.length;
}

function envelopeFrom(body, sessionCredential) {
  if (body.length === 0 || body.length > 8192) return null;
  let decoded;
  let parsed;
  try {
    decoded = utf8Decoder.decode(body);
    parsed = jsonParse(decoded);
    if (!uniqueJsonKeys(decoded)) return null;
  } catch {
    return null;
  }
  const outer = exactRecord(parsed, BODY_KEYS);
  const navigation = outer && exactRecord(outer.navigation, NAVIGATION_KEYS);
  if (!outer || outer.schemaVersion !== '1.0' || !navigation
      || navigation.schemaVersion !== '1.0' || !arrayIncludes(CHANNELS, navigation.channel)) return null;
  for (let index = 2; index < NAVIGATION_KEYS.length; index += 1) {
    if (typeof navigation[NAVIGATION_KEYS[index]] !== 'string'
        || !regexpTest(ID, navigation[NAVIGATION_KEYS[index]])) return null;
  }
  const detachedNavigation = objectFreeze(objectAssign(objectCreate(null), navigation));
  return objectFreeze(objectAssign(objectCreate(null), {
    schemaVersion: outer.schemaVersion,
    sessionCredential,
    navigation: detachedNavigation,
  }));
}

function acceptedResult(raw, expectedNavigation) {
  const result = exactRecord(raw, RESULT_KEYS, true);
  const decision = result && exactRecord(result.decision, DECISION_KEYS, true);
  const evaluatedAt = decision && timestampMillis(decision.evaluatedAt);
  const validUntil = decision && decision.validUntil !== null
    ? timestampMillis(decision.validUntil) : null;
  if (!result || result.ok !== true || !decision || decision.allowed !== true
      || decision.code !== 'allowed' || decision.schemaVersion !== '1.0'
      || decision.channel !== expectedNavigation.channel
      || decision.buildingId !== expectedNavigation.buildingId
      || decision.floorId !== expectedNavigation.floorId
      || decision.elevatorStopId !== expectedNavigation.elevatorStopId
      || decision.destinationId !== expectedNavigation.destinationId
      || !arrayIncludes(['suite', 'shared_space'], decision.destinationKind)
      || !arrayIncludes(['public', 'tenant', 'invited', 'private', 'restricted'], decision.accessState)
      || !regexpTest(ID, decision.subjectId)
      || ((decision.tenantId === null) !== (decision.accessState === 'public'))
      || (decision.tenantId !== null && !regexpTest(ID, decision.tenantId))
      || !regexpTest(ID, decision.authorizationReference)
      || (decision.destinationKind === 'suite'
        && !arrayIncludes(['tenant', 'private', 'restricted'], decision.accessState))
      || !numberIsSafeInteger(decision.policyRevision) || decision.policyRevision < 1
      || decision.policyRevision > 2147483647
      || evaluatedAt === null
      || (decision.validUntil !== null && validUntil === null)
      || ((decision.validUntil !== null) !== (decision.accessState === 'invited'))
      || (decision.accessState === 'invited' && validUntil <= evaluatedAt)) return null;
  return objectAssign(objectCreate(null), { ok: true, decision });
}

function respond(response, statusCode, body) {
  if (!response || response.destroyed || response.writableEnded || response.headersSent) return;
  try {
    response.writeHead(statusCode, objectAssign(objectCreate(null), RESPONSE_HEADERS, {
      'content-length': body.length,
    }));
    response.end(body);
  } catch {
    try { if (!response.destroyed) response.destroy(); } catch { /* fail closed */ }
  }
}

export function createTenantSkyscraperNavigationHttpAdapter(navigationApiHandler) {
  if (arguments.length !== 1 || typeof navigationApiHandler !== 'function'
      || isProxy(navigationApiHandler)) {
    throw new TypeError('private navigation API handler is required');
  }
  const capturedHandler = navigationApiHandler;
  return objectFreeze(async function tenantSkyscraperNavigationHttpAdapter(request, response) {
    try {
      const snapshot = requestSnapshot(request);
      const rawHeaders = snapshot && rawHeaderValues(snapshot.rawHeaders);
      if (!snapshot || snapshot.method !== 'POST' || snapshot.url !== ROUTE
          || !rawHeaders || rawHeaders.contentType !== 'application/json') {
        respond(response, 404, DENIAL);
        return;
      }
      const sessionCredential = authorizationHeader(rawHeaders.authorization);
      if (!sessionCredential) {
        respond(response, 404, DENIAL);
        return;
      }
      const envelope = envelopeFrom(await readBody(request), sessionCredential);
      if (!envelope) {
        respond(response, 404, DENIAL);
        return;
      }
      const accepted = acceptedResult(
        await reflectApply(capturedHandler, undefined, [envelope]), envelope.navigation,
      );
      if (!accepted) {
        respond(response, 404, DENIAL);
        return;
      }
      const success = bufferFrom(jsonStringify(accepted), 'utf8');
      if (success.length > 4096 || bufferByteLength(success) !== success.length) {
        respond(response, 404, DENIAL);
        return;
      }
      respond(response, 200, success);
    } catch {
      respond(response, 404, DENIAL);
    }
  });
}