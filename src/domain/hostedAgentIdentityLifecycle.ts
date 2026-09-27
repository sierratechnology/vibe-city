import {
  createHostedPresenceRequest,
  type ReviewedHostedIdentityMapping,
} from './hostedAgentPresence';

const GENERIC_ERROR = 'Invalid hosted agent presence input';
const EVENT_KEYS = Object.freeze([
  'tenantId', 'subjectId', 'identityId', 'oldProfileName', 'newProfileName',
  'priorRevision', 'nextRevision', 'occurredAt',
]);

type UnknownRecord = Record<string, unknown>;

export type HostedIdentityProfileRenameHistory = Readonly<{
  tenantId: string;
  subjectId: string;
  identityId: 'stg-spiders';
  oldProfileName: string;
  newProfileName: string;
  priorRevision: number;
  nextRevision: number;
  occurredAt: string;
  reason: 'profile_renamed';
}>;

function fail(): never {
  throw new TypeError(GENERIC_ERROR);
}

function requireTrustedMapping(value: unknown): ReviewedHostedIdentityMapping {
  if (value === null || typeof value !== 'object') fail();
  const mapping = value as ReviewedHostedIdentityMapping;
  createHostedPresenceRequest(mapping, {
    boardScope: 'default',
    profileName: mapping.profileName,
    mappingRevision: mapping.registryRevision,
    evaluatedAt: mapping.synchronizedAt,
  });
  return mapping;
}

function requireClosedEvent(value: unknown): UnknownRecord {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) fail();
  const object = value as UnknownRecord;
  const prototype = Object.getPrototypeOf(object);
  if ((prototype !== Object.prototype && prototype !== null)
    || Object.getPrototypeOf(object) !== prototype) fail();
  const keys = Reflect.ownKeys(object);
  const repeatedKeys = Reflect.ownKeys(object);
  if (keys.length !== EVENT_KEYS.length || keys.length !== repeatedKeys.length
    || keys.some((key, index) => key !== repeatedKeys[index])) fail();
  const snapshot: UnknownRecord = {};
  for (const key of keys) {
    if (typeof key !== 'string' || !EVENT_KEYS.includes(key)) fail();
    const descriptor = Object.getOwnPropertyDescriptor(object, key);
    const repeated = Object.getOwnPropertyDescriptor(object, key);
    if (!descriptor || !repeated
      || !Object.prototype.hasOwnProperty.call(descriptor, 'value')
      || !Object.prototype.hasOwnProperty.call(repeated, 'value')
      || !Object.is(descriptor.value, repeated.value)
      || descriptor.enumerable !== repeated.enumerable
      || descriptor.configurable !== repeated.configurable
      || descriptor.writable !== repeated.writable) fail();
    Object.defineProperty(snapshot, key, {
      value: descriptor.value, enumerable: true, configurable: false, writable: false,
    });
  }
  if (EVENT_KEYS.some((key) => !Object.hasOwn(snapshot, key))) fail();
  try {
    structuredClone(value);
  } catch {
    fail();
  }
  return snapshot;
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function requireCanonicalTimestamp(value: unknown): string {
  if (typeof value !== 'string') fail();
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== value) fail();
  return value;
}

export function createHostedIdentityProfileRenameHistory(
  beforeInput: unknown,
  afterInput: unknown,
  eventInput: unknown,
): HostedIdentityProfileRenameHistory {
  try {
    const before = requireTrustedMapping(beforeInput);
    const after = requireTrustedMapping(afterInput);
    const event = requireClosedEvent(eventInput);
    if (before.status !== 'active' || after.status !== 'active'
      || before.profileName === after.profileName
      || after.registryRevision !== before.registryRevision + 1
      || after.synchronizedAt <= before.synchronizedAt
      || before.tenantId !== after.tenantId
      || before.subjectId !== after.subjectId
      || before.identityId !== after.identityId
      || before.displayName !== after.displayName
      || before.roleLabel !== after.roleLabel
      || before.workplaceLabel !== after.workplaceLabel
      || !sameStrings(before.skills, after.skills)
      || !sameStrings(before.permissions, after.permissions)
      || !sameStrings(before.actionAuthorities, after.actionAuthorities)) fail();
    const occurredAt = requireCanonicalTimestamp(event.occurredAt);
    if (event.tenantId !== before.tenantId
      || event.subjectId !== before.subjectId
      || event.identityId !== before.identityId
      || event.oldProfileName !== before.profileName
      || event.newProfileName !== after.profileName
      || event.priorRevision !== before.registryRevision
      || event.nextRevision !== after.registryRevision
      || occurredAt < before.synchronizedAt
      || occurredAt > after.synchronizedAt) fail();
    return Object.freeze({
      tenantId: before.tenantId,
      subjectId: before.subjectId,
      identityId: before.identityId,
      oldProfileName: before.profileName,
      newProfileName: after.profileName,
      priorRevision: before.registryRevision,
      nextRevision: after.registryRevision,
      occurredAt,
      reason: 'profile_renamed',
    });
  } catch {
    throw new TypeError(GENERIC_ERROR);
  }
}
