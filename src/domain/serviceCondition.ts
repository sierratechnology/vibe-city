// @ts-expect-error -- this dormant Node-only boundary intentionally has no Node type package.
import { types } from 'node:util';

const OPAQUE_ID = /^id_[a-f0-9]{16,64}$/;
const GENERIC_ERROR = 'Invalid service condition observation';
const GENERIC_PROJECTION_ERROR = 'Invalid service condition projection';
// Inclusive ages: live <= 1 minute, recent <= 5 minutes, historical <= 24 hours.
const LIVE_MAX_AGE_MS = 60_000;
const RECENT_MAX_AGE_MS = 5 * 60_000;
const HISTORICAL_MAX_AGE_MS = 24 * 60 * 60_000;
const MODULE_CONDITIONS = new WeakSet<object>();
const INPUT_KEYS = [
  'tenantId', 'serviceId', 'sourceObservationId', 'observedAt', 'evaluatedAt',
  'sourceAvailability', 'lifecycle', 'required', 'configured', 'healthEvidence',
  'blockReason',
] as const;

type UnknownRecord = Record<string, unknown>;

function fail(): never {
  throw new TypeError(GENERIC_ERROR);
}

function requireInput(value: unknown): UnknownRecord {
  if (value === null || typeof value !== 'object') fail();
  if (types.isProxy(value) || Array.isArray(value)) fail();
  const object = value as UnknownRecord;
  const prototype = Object.getPrototypeOf(object);
  if (prototype !== Object.prototype || Object.getPrototypeOf(object) !== prototype) fail();
  const keys = Reflect.ownKeys(object);
  const repeatedKeys = Reflect.ownKeys(object);
  if (keys.length !== INPUT_KEYS.length || repeatedKeys.length !== keys.length
    || keys.some((key, index) => key !== repeatedKeys[index])
    || keys.some((key) => typeof key !== 'string'
      || !(INPUT_KEYS as readonly string[]).includes(key))) fail();
  const snapshot = Object.create(null) as UnknownRecord;
  for (let index = 0; index < keys.length; index += 1) {
    const key = keys[index] as string;
    const descriptor = Object.getOwnPropertyDescriptor(object, key);
    const repeated = Object.getOwnPropertyDescriptor(object, key);
    if (!descriptor || !repeated
      || !Object.prototype.hasOwnProperty.call(descriptor, 'value')
      || !Object.prototype.hasOwnProperty.call(repeated, 'value')
      || !Object.is(descriptor.value, repeated.value)
      || descriptor.enumerable !== true || repeated.enumerable !== true
      || descriptor.configurable !== repeated.configurable
      || descriptor.writable !== repeated.writable) fail();
    Object.defineProperty(snapshot, key, {
      value: descriptor.value, enumerable: true, configurable: false, writable: false,
    });
  }
  if (INPUT_KEYS.some((key) => !Object.hasOwn(snapshot, key))) fail();
  return snapshot;
}

function requireId(value: unknown): string {
  if (typeof value !== 'string' || !OPAQUE_ID.test(value)) fail();
  return value;
}

function requireTimestamp(value: unknown): readonly [string, number] {
  if (typeof value !== 'string') fail();
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== value) fail();
  return [value, parsed.getTime()];
}

export function deriveServiceCondition(input: unknown) {
  try {
    const object = requireInput(input);
    const tenantId = requireId(object.tenantId);
    const serviceId = requireId(object.serviceId);
    const sourceObservationId = requireId(object.sourceObservationId);
    if (tenantId === serviceId || tenantId === sourceObservationId
      || serviceId === sourceObservationId) fail();
    const observedTimestamp = requireTimestamp(object.observedAt);
    const observedAt = observedTimestamp[0];
    const observedInstant = observedTimestamp[1];
    const evaluatedTimestamp = requireTimestamp(object.evaluatedAt);
    const evaluatedAt = evaluatedTimestamp[0];
    const evaluatedInstant = evaluatedTimestamp[1];
    if (observedInstant > evaluatedInstant
      || typeof object.sourceAvailability !== 'string'
      || !['available', 'degraded', 'unavailable'].includes(object.sourceAvailability)) fail();
    const age = evaluatedInstant - observedInstant;
    let classification: string;
    let reasonCode: string;
    if (object.lifecycle === 'retired' && object.required === false
      && object.configured === false && object.healthEvidence === 'none'
      && object.sourceAvailability === 'available' && object.blockReason === null) {
      classification = 'retired';
      reasonCode = 'service_retired';
    } else if (object.lifecycle === 'active' && object.required === false
      && object.configured === false && object.healthEvidence === 'none'
      && object.blockReason === null) {
      classification = 'optional';
      reasonCode = 'service_optional';
    } else if (object.lifecycle === 'active' && object.required === true
      && object.configured === false && object.healthEvidence === 'none'
      && object.blockReason === null) {
      classification = 'not_configured';
      reasonCode = 'service_not_configured';
    } else if (object.lifecycle === 'active' && object.required === true
      && object.configured === true && object.healthEvidence === 'affirmative'
      && object.sourceAvailability === 'available' && object.blockReason === null) {
      classification = 'working';
      reasonCode = 'source_healthy';
    } else if (object.lifecycle === 'active' && object.required === true
      && object.configured === true && object.healthEvidence === 'impaired'
      && object.sourceAvailability === 'degraded' && object.blockReason === null) {
      classification = 'degraded';
      reasonCode = 'source_impaired';
    } else if (object.lifecycle === 'active' && object.required === true
      && object.configured === true && object.healthEvidence === 'none'
      && object.sourceAvailability === 'available'
      && (object.blockReason === 'dependency_missing'
        || object.blockReason === 'decision_required')) {
      classification = 'blocked';
      reasonCode = object.blockReason;
    } else if (object.lifecycle === 'active' && object.required === true
      && object.configured === true && object.healthEvidence === 'failure'
      && object.sourceAvailability === 'unavailable' && object.blockReason === null) {
      classification = 'broken';
      reasonCode = 'source_failure';
    } else {
      fail();
    }
    const freshness = object.sourceAvailability === 'degraded' ? 'degraded'
      : object.sourceAvailability === 'unavailable' ? 'unavailable'
        : age <= LIVE_MAX_AGE_MS ? 'live'
          : age <= RECENT_MAX_AGE_MS ? 'recent'
            : age <= HISTORICAL_MAX_AGE_MS ? 'historical' : 'stale';
    if (classification === 'working' && (freshness === 'historical' || freshness === 'stale')) {
      classification = 'degraded';
      reasonCode = 'stale_observation';
    }
    const result = Object.create(null) as UnknownRecord;
    const resultEntries = [
      ['tenantId', tenantId], ['serviceId', serviceId],
      ['sourceObservationId', sourceObservationId], ['classification', classification],
      ['freshness', freshness], ['observedAt', observedAt], ['evaluatedAt', evaluatedAt],
      ['reasonCode', reasonCode],
    ] as const;
    for (let index = 0; index < resultEntries.length; index += 1) {
      const entry = resultEntries[index];
      Object.defineProperty(result, entry[0], {
        value: entry[1], enumerable: true, configurable: false, writable: false,
      });
    }
    MODULE_CONDITIONS.add(result);
    return Object.freeze(result);
  } catch {
    throw new TypeError(GENERIC_ERROR);
  }
}

export function projectPrivateServiceCondition(condition: UnknownRecord, _expectedTenantId: unknown) {
  try {
    if (types.isProxy(condition) || !MODULE_CONDITIONS.has(condition)
      || typeof _expectedTenantId !== 'string' || !OPAQUE_ID.test(_expectedTenantId)
      || condition.tenantId !== _expectedTenantId) {
      throw new TypeError(GENERIC_PROJECTION_ERROR);
    }
    const result = Object.create(null) as UnknownRecord;
    for (const key of [
      'serviceId', 'classification', 'freshness', 'observedAt', 'evaluatedAt', 'reasonCode',
    ]) {
      Object.defineProperty(result, key, {
        value: condition[key], enumerable: true, configurable: false, writable: false,
      });
    }
    return Object.freeze(result);
  } catch {
    throw new TypeError(GENERIC_PROJECTION_ERROR);
  }
}