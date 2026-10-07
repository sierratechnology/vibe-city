// @ts-expect-error Server-owned JavaScript authenticates results at runtime.
import { createManagedCustomerIdentityDomain } from '../../server/managedCustomerIdentityDomain.mjs';
// @ts-expect-error Node's runtime builtin is intentionally not added as an application dependency.
import { isProxy } from 'node:util/types';

const objectCreate = Object.create;
const objectFreeze = Object.freeze;
const getDescriptor = Object.getOwnPropertyDescriptor;
const getPrototype = Object.getPrototypeOf;
const reflectOwnKeys = Reflect.ownKeys;
const hasOwn = Function.call.bind(Object.prototype.hasOwnProperty) as (
  value: object, key: PropertyKey,
) => boolean;
const stringCharCodeAt = Function.call.bind(String.prototype.charCodeAt) as (
  value: string, index: number,
) => number;
const stringSlice = Function.call.bind(String.prototype.slice) as (
  value: string, start: number, end?: number,
) => string;
const weakSetAdd = Function.call.bind(WeakSet.prototype.add) as (
  set: WeakSet<object>, value: object,
) => WeakSet<object>;
const weakSetHas = Function.call.bind(WeakSet.prototype.has) as (
  set: WeakSet<object>, value: object,
) => boolean;
const authenticSharedSpaces = new WeakSet<object>();
const isAuthenticIdentity = createManagedCustomerIdentityDomain.isAuthenticResult;
const TypeErrorIntrinsic = TypeError;
const INVALID_INPUT = 'Invalid Agent Commons shared-space definition input';
const INVALID_ACTIVITY_INPUT = 'Invalid Agent Commons activity definition input';
const ObjectPrototype = Object.prototype;
const INPUT_KEYS = objectFreeze([
  'schemaVersion', 'spaceId', 'displayName', 'purpose', 'definedAt', 'recordedAt',
]);
const ACTIVITY_INPUT_KEYS = objectFreeze([
  'schemaVersion', 'activityId', 'activityKind', 'definedAt', 'recordedAt',
]);

type ManagedIdentity = Readonly<{
  account: Readonly<{ accountId: string }>;
  tenantBinding: Readonly<{ tenantId: string }>;
}>;

type SharedSpaceInput = Readonly<{
  schemaVersion: 'agent-commons-shared-space/1';
  spaceId: string;
  displayName: 'Agent Commons';
  purpose: 'voluntary_social_creative_recreation';
  definedAt: string;
  recordedAt: string;
}>;

type ActivityInput = Readonly<{
  schemaVersion: 'agent-commons-activity-definition/1';
  activityId: string;
  activityKind: 'social' | 'creative' | 'recreation';
  definedAt: string;
  recordedAt: string;
}>;

export type AgentCommonsSharedSpaceDefinition = Readonly<{
  schemaVersion: 'agent-commons-shared-space/1';
  spaceId: string;
  tenantId: string;
  accountId: string;
  displayName: 'Agent Commons';
  purpose: 'voluntary_social_creative_recreation';
  accessBoundary: 'tenant_private';
  participationStatus: 'not_activated';
  occupancyStatus: 'unavailable';
  costPolicy: 'no_incremental_spend';
  privacy: 'tenant_private';
  definedAt: string;
  recordedAt: string;
}>;

export type AgentCommonsActivityDefinition = Readonly<{
  schemaVersion: 'agent-commons-activity-definition/1';
  activityId: string;
  spaceId: string;
  tenantId: string;
  accountId: string;
  activityKind: 'social' | 'creative' | 'recreation';
  participation: 'voluntary';
  activationStatus: 'not_activated';
  availability: 'unavailable';
  accessBoundary: 'tenant_private';
  privacy: 'tenant_private';
  costPolicy: 'no_incremental_spend';
  interruptionPolicy: 'return_to_assigned_state';
  definedAt: string;
  recordedAt: string;
}>;

function invalid(): never {
  throw new TypeErrorIntrinsic(INVALID_INPUT);
}

function invalidActivity(): never {
  throw new TypeErrorIntrinsic(INVALID_ACTIVITY_INPUT);
}

function record(
  value: unknown,
  expectedKeys: readonly string[] = INPUT_KEYS,
  reject: () => never = invalid,
): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || isProxy(value)) reject();
  const prototype = getPrototype(value);
  if (prototype !== ObjectPrototype && prototype !== null) reject();
  const keys = reflectOwnKeys(value);
  if (keys.length !== expectedKeys.length) reject();
  const copy = objectCreate(null) as Record<string, unknown>;
  for (let expectedIndex = 0; expectedIndex < expectedKeys.length; expectedIndex += 1) {
    const expectedKey = expectedKeys[expectedIndex];
    let found = false;
    for (let keyIndex = 0; keyIndex < keys.length; keyIndex += 1) {
      if (typeof keys[keyIndex] !== 'string') reject();
      if (keys[keyIndex] === expectedKey) found = true;
    }
    if (!found) reject();
    const descriptor = getDescriptor(value, expectedKey);
    if (!descriptor || !hasOwn(descriptor, 'value') || descriptor.enumerable !== true) reject();
    copy[expectedKey] = descriptor.value;
  }
  return copy;
}

function validSpaceId(value: unknown): value is string {
  if (typeof value !== 'string' || value.length < 22 || value.length > 70
      || stringSlice(value, 0, 6) !== 'space_') return false;
  for (let index = 6; index < value.length; index += 1) {
    const code = stringCharCodeAt(value, index);
    if (!(code >= 0x30 && code <= 0x39) && !(code >= 0x61 && code <= 0x66)) return false;
  }
  return true;
}

function validActivityId(value: unknown): value is string {
  if (typeof value !== 'string' || value.length < 25 || value.length > 73
      || stringSlice(value, 0, 9) !== 'activity_') return false;
  for (let index = 9; index < value.length; index += 1) {
    const code = stringCharCodeAt(value, index);
    if (!(code >= 0x30 && code <= 0x39) && !(code >= 0x61 && code <= 0x66)) return false;
  }
  return true;
}

function digit(value: string, index: number): number {
  const code = stringCharCodeAt(value, index);
  return code >= 0x30 && code <= 0x39 ? code - 0x30 : -1;
}

function validTimestamp(value: unknown): value is string {
  if (typeof value !== 'string' || value.length !== 24
      || stringCharCodeAt(value, 4) !== 0x2d || stringCharCodeAt(value, 7) !== 0x2d
      || stringCharCodeAt(value, 10) !== 0x54 || stringCharCodeAt(value, 13) !== 0x3a
      || stringCharCodeAt(value, 16) !== 0x3a || stringCharCodeAt(value, 19) !== 0x2e
      || stringCharCodeAt(value, 23) !== 0x5a) return false;
  const positions = [0, 1, 2, 3, 5, 6, 8, 9, 11, 12, 14, 15, 17, 18, 20, 21, 22];
  for (let index = 0; index < positions.length; index += 1) {
    if (digit(value, positions[index]) < 0) return false;
  }
  const year = digit(value, 0) * 1000 + digit(value, 1) * 100
    + digit(value, 2) * 10 + digit(value, 3);
  const month = digit(value, 5) * 10 + digit(value, 6);
  const day = digit(value, 8) * 10 + digit(value, 9);
  const hour = digit(value, 11) * 10 + digit(value, 12);
  const minute = digit(value, 14) * 10 + digit(value, 15);
  const second = digit(value, 17) * 10 + digit(value, 18);
  if (month < 1 || month > 12 || hour > 23 || minute > 59 || second > 59) return false;
  let maxDay = 31;
  if (month === 4 || month === 6 || month === 9 || month === 11) maxDay = 30;
  else if (month === 2) {
    maxDay = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28;
  }
  return day >= 1 && day <= maxDay;
}

export function createAgentCommonsSharedSpaceDefinition(
  identity: unknown,
  input: unknown,
): AgentCommonsSharedSpaceDefinition {
  if (arguments.length !== 2) invalid();
  if (!isAuthenticIdentity(identity)) invalid();
  const authenticIdentity = identity as ManagedIdentity;
  const definition = record(input) as SharedSpaceInput;
  if (definition.schemaVersion !== 'agent-commons-shared-space/1'
      || !validSpaceId(definition.spaceId)
      || definition.displayName !== 'Agent Commons'
      || definition.purpose !== 'voluntary_social_creative_recreation'
      || !validTimestamp(definition.definedAt)
      || !validTimestamp(definition.recordedAt)
      || definition.recordedAt < definition.definedAt) invalid();
  const result = objectCreate(null) as Record<string, unknown>;
  result.schemaVersion = definition.schemaVersion;
  result.spaceId = definition.spaceId;
  result.tenantId = authenticIdentity.tenantBinding.tenantId;
  result.accountId = authenticIdentity.account.accountId;
  result.displayName = definition.displayName;
  result.purpose = definition.purpose;
  result.accessBoundary = 'tenant_private';
  result.participationStatus = 'not_activated';
  result.occupancyStatus = 'unavailable';
  result.costPolicy = 'no_incremental_spend';
  result.privacy = 'tenant_private';
  result.definedAt = definition.definedAt;
  result.recordedAt = definition.recordedAt;
  const frozenResult = objectFreeze(result) as AgentCommonsSharedSpaceDefinition;
  weakSetAdd(authenticSharedSpaces, frozenResult);
  return frozenResult;
}

export function createAgentCommonsActivityDefinition(
  space: unknown,
  input: unknown,
): AgentCommonsActivityDefinition {
  if (arguments.length !== 2) invalidActivity();
  if (space === null || typeof space !== 'object'
      || !weakSetHas(authenticSharedSpaces, space)) invalidActivity();
  const authenticSpace = space as AgentCommonsSharedSpaceDefinition;
  const definition = record(input, ACTIVITY_INPUT_KEYS, invalidActivity) as ActivityInput;
  if (definition.schemaVersion !== 'agent-commons-activity-definition/1'
      || !validActivityId(definition.activityId)
      || definition.activityKind !== 'social'
        && definition.activityKind !== 'creative'
        && definition.activityKind !== 'recreation'
      || !validTimestamp(definition.definedAt)
      || !validTimestamp(definition.recordedAt)
      || definition.recordedAt < definition.definedAt) invalidActivity();
  const result = objectCreate(null) as Record<string, unknown>;
  result.schemaVersion = definition.schemaVersion;
  result.activityId = definition.activityId;
  result.spaceId = authenticSpace.spaceId;
  result.tenantId = authenticSpace.tenantId;
  result.accountId = authenticSpace.accountId;
  result.activityKind = definition.activityKind;
  result.participation = 'voluntary';
  result.activationStatus = 'not_activated';
  result.availability = 'unavailable';
  result.accessBoundary = 'tenant_private';
  result.privacy = 'tenant_private';
  result.costPolicy = 'no_incremental_spend';
  result.interruptionPolicy = 'return_to_assigned_state';
  result.definedAt = definition.definedAt;
  result.recordedAt = definition.recordedAt;
  return objectFreeze(result) as AgentCommonsActivityDefinition;
}
