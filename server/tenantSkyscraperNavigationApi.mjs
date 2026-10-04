import { isProxy } from 'node:util/types';
import { createTenantSkyscraperNavigationAuthorizer } from './tenantSkyscraperNavigationDomain.mjs';

const ArrayPrototype = Array.prototype;
const arrayIsArray = Array.isArray;
const arrayIncludes = Function.call.bind(Array.prototype.includes);
const arrayPush = Function.call.bind(Array.prototype.push);
const numberIsFinite = Number.isFinite;
const objectAssign = Object.assign;
const objectCreate = Object.create;
const objectFreeze = Object.freeze;
const objectIsFrozen = Object.isFrozen;
const getDescriptor = Object.getOwnPropertyDescriptor;
const getPrototype = Object.getPrototypeOf;
const ObjectPrototype = Object.prototype;
const objectIs = Object.is;
const reflectOwnKeys = Reflect.ownKeys;
const regexpTest = Function.call.bind(RegExp.prototype.test);
const StringIntrinsic = String;
const stringCharCodeAt = Function.call.bind(String.prototype.charCodeAt);
const WeakSetIntrinsic = WeakSet;
const weakSetAdd = Function.call.bind(WeakSet.prototype.add);
const weakSetHas = Function.call.bind(WeakSet.prototype.has);

const DEPENDENCY_KEYS = objectFreeze([
  'authenticate', 'resolveTrustedNavigationState',
]);
const ENVELOPE_KEYS = objectFreeze(['schemaVersion', 'sessionCredential', 'navigation']);
const NAVIGATION_KEYS = objectFreeze([
  'schemaVersion', 'channel', 'buildingId', 'floorId', 'elevatorStopId', 'destinationId',
]);
const SESSION_KEYS = objectFreeze(['authenticated', 'sessionId', 'subjectId']);
const RESULT_KEYS = objectFreeze(['ok', 'decision']);
const DECISION_KEYS = objectFreeze([
  'allowed', 'code', 'schemaVersion', 'channel', 'buildingId', 'floorId',
  'elevatorStopId', 'destinationId', 'destinationKind', 'accessState', 'subjectId',
  'tenantId', 'authorizationReference', 'policyRevision', 'evaluatedAt', 'validUntil',
]);
const ID = /^id_[a-f0-9]{16,64}$/;
const CREDENTIAL = /^session_[A-Za-z0-9._~-]{16,256}$/;
const CHANNELS = objectFreeze(['door', 'elevator', 'direct', 'alternative']);

function denied() {
  return objectFreeze(objectAssign(objectCreate(null), { ok: false, code: 'not_found' }));
}

function exactRecord(value, expectedKeys) {
  if (value === null || typeof value !== 'object' || arrayIsArray(value) || isProxy(value)) return null;
  const prototype = getPrototype(value);
  if (prototype !== ObjectPrototype && prototype !== null) return null;
  const keys = reflectOwnKeys(value);
  if (keys.length !== expectedKeys.length) return null;
  const copy = objectCreate(null);
  for (let index = 0; index < expectedKeys.length; index += 1) {
    const key = expectedKeys[index];
    const descriptor = getDescriptor(value, key);
    if (!descriptor || !('value' in descriptor) || descriptor.enumerable !== true
        || !arrayIncludes(keys, key)) return null;
    copy[key] = descriptor.value;
  }
  return copy;
}

function snapshotEnvelope(raw) {
  const envelope = exactRecord(raw, ENVELOPE_KEYS);
  const navigation = envelope && exactRecord(envelope.navigation, NAVIGATION_KEYS);
  if (!envelope || envelope.schemaVersion !== '1.0'
      || typeof envelope.sessionCredential !== 'string'
      || !regexpTest(CREDENTIAL, envelope.sessionCredential)
      || !navigation || navigation.schemaVersion !== '1.0'
      || !arrayIncludes(CHANNELS, navigation.channel)) return null;
  for (let index = 2; index < NAVIGATION_KEYS.length; index += 1) {
    if (!regexpTest(ID, navigation[NAVIGATION_KEYS[index]])) return null;
  }
  return objectFreeze(objectAssign(objectCreate(null), {
    schemaVersion: envelope.schemaVersion,
    sessionCredential: envelope.sessionCredential,
    navigation: objectFreeze(navigation),
  }));
}

function exactDependencies(raw) {
  const dependencies = exactRecord(raw, DEPENDENCY_KEYS);
  if (!dependencies) return null;
  for (let index = 0; index < DEPENDENCY_KEYS.length; index += 1) {
    if (typeof dependencies[DEPENDENCY_KEYS[index]] !== 'function') return null;
  }
  return dependencies;
}

function snapshotSession(raw) {
  const session = exactRecord(raw, SESSION_KEYS);
  if (!session || session.authenticated !== true
      || !regexpTest(ID, session.sessionId) || !regexpTest(ID, session.subjectId)) return null;
  return objectFreeze(session);
}

function sameSession(first, second) {
  return first.sessionId === second.sessionId && first.subjectId === second.subjectId;
}

function sourceContext(session, navigation) {
  return objectFreeze(objectAssign(objectCreate(null), { session, navigation }));
}

function utf8Bytes(value) {
  let bytes = 0;
  for (let index = 0; index < value.length; index += 1) {
    const code = stringCharCodeAt(value, index);
    if (code <= 0x7f) bytes += 1;
    else if (code <= 0x7ff) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff) {
      const next = stringCharCodeAt(value, index + 1);
      if (next < 0xdc00 || next > 0xdfff) return null;
      bytes += 4;
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) return null;
    else bytes += 3;
  }
  return bytes;
}

function cloneClosed(value, budget, depth = 0) {
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const bytes = utf8Bytes(value);
    if (bytes === null) throw new TypeError('invalid trusted state');
    budget.bytes += bytes;
    if (budget.bytes > 524288) throw new TypeError('invalid trusted state');
    return value;
  }
  if (typeof value === 'number') {
    if (!numberIsFinite(value) || objectIs(value, -0)) throw new TypeError('invalid trusted state');
    return value;
  }
  if (typeof value !== 'object' || depth > 6 || isProxy(value)
      || weakSetHas(budget.identities, value)) throw new TypeError('invalid trusted state');
  weakSetAdd(budget.identities, value);
  budget.containers += 1;
  if (budget.containers > 1250) throw new TypeError('invalid trusted state');
  const isArray = arrayIsArray(value);
  const prototype = getPrototype(value);
  if (isArray ? prototype !== ArrayPrototype : prototype !== ObjectPrototype && prototype !== null) {
    throw new TypeError('invalid trusted state');
  }
  const keys = reflectOwnKeys(value);
  const itemCount = isArray ? keys.length - 1 : keys.length;
  if ((isArray && (keys[keys.length - 1] !== 'length' || itemCount > 512))
      || (!isArray && itemCount > 16)) throw new TypeError('invalid trusted state');
  budget.keys += keys.length;
  if (budget.keys > 7500) throw new TypeError('invalid trusted state');
  const copy = isArray ? [] : objectCreate(null);
  for (let index = 0; index < itemCount; index += 1) {
    const key = keys[index];
    if (typeof key !== 'string' || (isArray && key !== StringIntrinsic(index))) {
      throw new TypeError('invalid trusted state');
    }
    const keyBytes = utf8Bytes(key);
    if (keyBytes === null || keyBytes > 64) throw new TypeError('invalid trusted state');
    budget.bytes += keyBytes;
    const descriptor = getDescriptor(value, key);
    if (!descriptor || !('value' in descriptor) || descriptor.enumerable !== true) {
      throw new TypeError('invalid trusted state');
    }
    const cloned = cloneClosed(descriptor.value, budget, depth + 1);
    if (isArray) arrayPush(copy, cloned);
    else copy[key] = cloned;
  }
  if (isArray) {
    const length = getDescriptor(value, 'length');
    if (!length || !('value' in length) || length.value !== itemCount) {
      throw new TypeError('invalid trusted state');
    }
  }
  return copy;
}

function snapshotTrustedState(raw) {
  return cloneClosed(raw, {
    bytes: 0, containers: 0, keys: 0, identities: new WeakSetIntrinsic(),
  });
}

function sameGraph(first, second) {
  if (first === null || second === null || typeof first !== 'object' || typeof second !== 'object') {
    return objectIs(first, second);
  }
  const firstArray = arrayIsArray(first);
  if (firstArray !== arrayIsArray(second)) return false;
  const firstKeys = reflectOwnKeys(first);
  const secondKeys = reflectOwnKeys(second);
  if (firstKeys.length !== secondKeys.length) return false;
  for (let index = 0; index < firstKeys.length; index += 1) {
    const key = firstKeys[index];
    if (key !== secondKeys[index]) return false;
    if (key !== 'length' && !sameGraph(first[key], second[key])) return false;
  }
  return true;
}

function exactFrozenNullRecord(raw, expectedKeys) {
  if (raw === null || typeof raw !== 'object' || isProxy(raw)
      || getPrototype(raw) !== null || !objectIsFrozen(raw)) return null;
  const keys = reflectOwnKeys(raw);
  if (keys.length !== expectedKeys.length) return null;
  const copy = objectCreate(null);
  for (let index = 0; index < expectedKeys.length; index += 1) {
    const key = expectedKeys[index];
    const descriptor = getDescriptor(raw, key);
    if (!arrayIncludes(keys, key) || !descriptor || !('value' in descriptor)
        || descriptor.enumerable !== true || descriptor.writable !== false
        || descriptor.configurable !== false) return null;
    copy[key] = descriptor.value;
  }
  return copy;
}

function findDestination(state, navigation) {
  const floors = state.catalog && state.catalog.building && state.catalog.building.floors;
  if (!arrayIsArray(floors)) return null;
  for (let floorIndex = 0; floorIndex < floors.length; floorIndex += 1) {
    const floor = floors[floorIndex];
    if (floor.floorId !== navigation.floorId || !arrayIsArray(floor.destinations)) continue;
    for (let index = 0; index < floor.destinations.length; index += 1) {
      if (floor.destinations[index].destinationId === navigation.destinationId) {
        return floor.destinations[index];
      }
    }
  }
  return null;
}

function projectAcceptedResult(raw, navigation, session, state) {
  const result = exactFrozenNullRecord(raw, RESULT_KEYS);
  const decision = result && exactFrozenNullRecord(result.decision, DECISION_KEYS);
  const authorization = state.authorization;
  const destination = findDestination(state, navigation);
  const invitation = authorization && authorization.invitation;
  const validUntil = destination && destination.accessState === 'invited'
    ? invitation && invitation.expiresAt : null;
  if (!result || result.ok !== true || !decision || !authorization || !destination
      || decision.allowed !== true || decision.code !== 'allowed'
      || decision.schemaVersion !== '1.0' || decision.channel !== navigation.channel
      || decision.buildingId !== navigation.buildingId || decision.floorId !== navigation.floorId
      || decision.elevatorStopId !== navigation.elevatorStopId
      || decision.destinationId !== navigation.destinationId
      || decision.destinationKind !== destination.destinationKind
      || decision.accessState !== destination.accessState
      || decision.subjectId !== session.subjectId
      || decision.subjectId !== authorization.authenticatedSubjectId
      || authorization.authenticatedSessionId !== session.sessionId
      || decision.tenantId !== destination.ownerTenantId
      || decision.authorizationReference !== authorization.authorizationReference
      || decision.policyRevision !== authorization.policyRevision
      || decision.evaluatedAt !== state.evaluatedAt || decision.validUntil !== validUntil) return null;
  const projectedDecision = objectFreeze(objectAssign(objectCreate(null), decision));
  return objectFreeze(objectAssign(objectCreate(null), { ok: true, decision: projectedDecision }));
}

export function createTenantSkyscraperNavigationApiHandler(rawDependencies) {
  const dependencies = exactDependencies(rawDependencies);
  if (!dependencies) throw new TypeError('private navigation dependencies are required');
  return objectFreeze(async function tenantSkyscraperNavigationApiHandler(rawEnvelope) {
    try {
      const envelope = snapshotEnvelope(rawEnvelope);
      if (!envelope) return denied();
      const session = snapshotSession(await dependencies.authenticate(envelope.sessionCredential));
      if (!session) return denied();
      const state = snapshotTrustedState(await dependencies.resolveTrustedNavigationState(
        sourceContext(session, envelope.navigation),
      ));
      const initial = createTenantSkyscraperNavigationAuthorizer(state)
        .decideNavigation(envelope.navigation);
      if (!projectAcceptedResult(initial, envelope.navigation, session, state)) return denied();
      const finalSession = snapshotSession(
        await dependencies.authenticate(envelope.sessionCredential),
      );
      if (!finalSession || !sameSession(session, finalSession)) return denied();
      const finalState = snapshotTrustedState(await dependencies.resolveTrustedNavigationState(
        sourceContext(finalSession, envelope.navigation),
      ));
      if (!sameGraph(state.catalog, finalState.catalog)
          || !sameGraph(state.authorization, finalState.authorization)
          || typeof state.evaluatedAt !== 'string' || typeof finalState.evaluatedAt !== 'string'
          || finalState.evaluatedAt < state.evaluatedAt) return denied();
      const finalResult = createTenantSkyscraperNavigationAuthorizer(finalState)
        .decideNavigation(envelope.navigation);
      return projectAcceptedResult(
        finalResult, envelope.navigation, finalSession, finalState,
      ) ?? denied();
    } catch {
      return denied();
    }
  });
}
