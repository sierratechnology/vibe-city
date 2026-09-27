import {
  requireReviewedHostedIdentityMapping,
  type ReviewedHostedIdentityMapping,
} from './hostedAgent\u0050resence';

const GENERIC_ERROR = 'Invalid meeting readiness input';
const OPAQUE_ID = /^id_[a-f0-9]{16,64}$/;

type UnknownRecord = Record<string, unknown>;

export type MeetingReadiness = Readonly<{
  schemaVersion: 'meeting-readiness/1';
  tenantId: string;
  purpose: Readonly<{ purposeId: string; summary: string }>;
  participants: readonly Readonly<{
    subjectId: string;
    identityId: 'stg-spiders';
    profileName: string;
    displayName: 'Spiders';
    roleLabel: 'Chief Agent';
    workplaceLabel: ReviewedHostedIdentityMapping['workplaceLabel'];
    participationState: 'not_invited';
    authorityState: 'not_granted';
  }>[];
  materials: readonly string[];
  lifecycle: Readonly<{
    state: 'readiness_only';
    preparedAt: string;
    readyAt: string;
  }>;
  outcome: Readonly<{
    sessionState: 'no_session';
    outcomeState: 'no_outcome_yet';
  }>;
}>;

function fail(): never {
  throw new TypeError(GENERIC_ERROR);
}

function requireClosedObject(value: unknown, requiredKeys: readonly string[]): UnknownRecord {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) fail();
  const object = value as UnknownRecord;
  const prototype = Object.getPrototypeOf(object);
  if ((prototype !== Object.prototype && prototype !== null)
    || Object.getPrototypeOf(object) !== prototype) fail();
  const keys = Reflect.ownKeys(object);
  const repeatedKeys = Reflect.ownKeys(object);
  if (keys.length !== requiredKeys.length || keys.length !== repeatedKeys.length
    || keys.some((key, index) => key !== repeatedKeys[index])) fail();
  const snapshot: UnknownRecord = {};
  for (const key of keys) {
    if (typeof key !== 'string' || !requiredKeys.includes(key)) fail();
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
  for (const key of requiredKeys) if (!Object.hasOwn(snapshot, key)) fail();
  return snapshot;
}

function requireCanonicalTimestamp(value: unknown): string {
  if (typeof value !== 'string') fail();
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== value) fail();
  return value;
}

function requireOpaqueId(value: unknown): string {
  if (typeof value !== 'string' || !OPAQUE_ID.test(value)) fail();
  return value;
}

function requirePurposeSummary(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 200
    || value.trim().length === 0 || /[\u0000-\u001f\u007f-\u009f]/.test(value)) fail();
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (next < 0xdc00 || next > 0xdfff) fail();
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) fail();
  }
  return value;
}

function requireMaterialRefs(value: unknown): readonly string[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) fail();
  const keys = Reflect.ownKeys(value);
  const repeatedKeys = Reflect.ownKeys(value);
  if (keys.length !== repeatedKeys.length
    || keys.some((key, index) => key !== repeatedKeys[index])) fail();
  const lengthDescriptor = Object.getOwnPropertyDescriptor(value, 'length');
  if (!lengthDescriptor || !Object.prototype.hasOwnProperty.call(lengthDescriptor, 'value')
    || !Number.isSafeInteger(lengthDescriptor.value)
    || lengthDescriptor.value < 1 || lengthDescriptor.value > 16
    || keys.length !== lengthDescriptor.value + 1) fail();
  const materials: string[] = [];
  for (let index = 0; index < lengthDescriptor.value; index += 1) {
    const key = String(index);
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    const repeated = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !repeated
      || !Object.prototype.hasOwnProperty.call(descriptor, 'value')
      || !Object.prototype.hasOwnProperty.call(repeated, 'value')
      || !Object.is(descriptor.value, repeated.value)
      || descriptor.enumerable !== true || repeated.enumerable !== true) fail();
    materials.push(requireOpaqueId(descriptor.value));
  }
  if (new Set(materials).size !== materials.length) fail();
  return Object.freeze(materials);
}

export function createMeetingReadiness(
  mappingInput: unknown,
  input: unknown,
): MeetingReadiness {
  try {
    const mapping = requireReviewedHostedIdentityMapping(mappingInput);
    if (mapping.status !== 'active') fail();
    const object = requireClosedObject(input, [
      'purposeId', 'purposeSummary', 'materialRefs', 'preparedAt', 'readyAt',
    ]);
    const purposeId = requireOpaqueId(object.purposeId);
    const purposeSummary = requirePurposeSummary(object.purposeSummary);
    const materials = requireMaterialRefs(object.materialRefs);
    const preparedAt = requireCanonicalTimestamp(object.preparedAt);
    const readyAt = requireCanonicalTimestamp(object.readyAt);
    if (new Date(preparedAt).getTime() < new Date(mapping.synchronizedAt).getTime()
      || new Date(readyAt).getTime() <= new Date(preparedAt).getTime()) fail();
    const participant = Object.freeze({
      subjectId: mapping.subjectId,
      identityId: mapping.identityId,
      profileName: mapping.profileName,
      displayName: mapping.displayName,
      roleLabel: mapping.roleLabel,
      workplaceLabel: mapping.workplaceLabel,
      participationState: 'not_invited' as const,
      authorityState: 'not_granted' as const,
    });
    return Object.freeze({
      schemaVersion: 'meeting-readiness/1',
      tenantId: mapping.tenantId,
      purpose: Object.freeze({
        purposeId,
        summary: purposeSummary,
      }),
      participants: Object.freeze([participant]),
      materials,
      lifecycle: Object.freeze({
        state: 'readiness_only' as const,
        preparedAt,
        readyAt,
      }),
      outcome: Object.freeze({
        sessionState: 'no_session' as const,
        outcomeState: 'no_outcome_yet' as const,
      }),
    });
  } catch {
    throw new TypeError(GENERIC_ERROR);
  }
}
