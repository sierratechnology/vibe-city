import { isProxy } from 'node:util/types';

import { createManagedCustomerIdentityDomain } from './managedCustomerIdentityDomain.mjs';
import { createManagedSuiteSelectionPresentation } from './managedSuiteSelectionPresentation.mjs';

const arrayIsArray = Array.isArray;
const ArrayPrototype = Array.prototype;
const objectCreate = Object.create;
const objectFreeze = Object.freeze;
const defineProperty = Object.defineProperty;
const getDescriptor = Object.getOwnPropertyDescriptor;
const getPrototype = Object.getPrototypeOf;
const mathFloor = Math.floor;
const reflectOwnKeys = Reflect.ownKeys;
const stringCharCodeAt = Function.call.bind(String.prototype.charCodeAt);
const ObjectPrototype = Object.prototype;
const TypeErrorIntrinsic = TypeError;
const weakSetAdd = Function.call.bind(WeakSet.prototype.add);
const weakSetHas = Function.call.bind(WeakSet.prototype.has);
const authenticResults = new WeakSet();
const isAuthenticIdentity = createManagedCustomerIdentityDomain.isAuthenticResult;
const isAuthenticPresentation = createManagedSuiteSelectionPresentation.isAuthenticResult;
const INVALID_INPUT = 'Invalid managed starter agent readiness input';
const GATE_NAMES = objectFreeze([
  'suite_commitment',
  'hosted_identity',
  'provider_selection',
  'credential_issuance',
  'authority_policy',
  'workplace_assignment',
]);
const INPUT_KEYS = objectFreeze([
  'schemaVersion', 'tenantId', 'accountId', 'organizationId', 'evaluatedAt', 'gates',
]);
const GATE_KEYS = objectFreeze(['name', 'state', 'sourceRef', 'observedAt']);

function invalid() {
  throw new TypeErrorIntrinsic(INVALID_INPUT);
}

function plainRecord(value, expectedKeys) {
  if (value === null || typeof value !== 'object' || isProxy(value)) invalid();
  const prototype = getPrototype(value);
  if (prototype !== ObjectPrototype && prototype !== null) invalid();
  const ownKeys = reflectOwnKeys(value);
  if (ownKeys.length !== expectedKeys.length) invalid();
  const copy = objectCreate(null);
  for (let expectedIndex = 0; expectedIndex < expectedKeys.length; expectedIndex += 1) {
    const expectedKey = expectedKeys[expectedIndex];
    let found = false;
    for (let keyIndex = 0; keyIndex < ownKeys.length; keyIndex += 1) {
      if (typeof ownKeys[keyIndex] !== 'string') invalid();
      if (ownKeys[keyIndex] === expectedKey) found = true;
    }
    if (!found) invalid();
    const descriptor = getDescriptor(value, expectedKey);
    if (!descriptor || !('value' in descriptor) || descriptor.enumerable !== true) invalid();
    copy[expectedKey] = descriptor.value;
  }
  return copy;
}

function gateArray(value) {
  if (value === null || typeof value !== 'object' || isProxy(value)
      || !arrayIsArray(value) || getPrototype(value) !== ArrayPrototype) invalid();
  const ownKeys = reflectOwnKeys(value);
  if (ownKeys.length !== GATE_NAMES.length + 1) invalid();
  const lengthDescriptor = getDescriptor(value, 'length');
  if (!lengthDescriptor || !('value' in lengthDescriptor)
      || lengthDescriptor.value !== GATE_NAMES.length) invalid();
  const copy = [];
  for (let index = 0; index < GATE_NAMES.length; index += 1) {
    const key = `${index}`;
    let found = false;
    for (let keyIndex = 0; keyIndex < ownKeys.length; keyIndex += 1) {
      if (typeof ownKeys[keyIndex] !== 'string') invalid();
      if (ownKeys[keyIndex] === key) found = true;
    }
    if (!found) invalid();
    const descriptor = getDescriptor(value, key);
    if (!descriptor || !('value' in descriptor) || descriptor.enumerable !== true) invalid();
    defineProperty(copy, key, {
      configurable: true,
      enumerable: true,
      value: descriptor.value,
      writable: true,
    });
  }
  return copy;
}

function opaqueSourceRef(value) {
  if (typeof value !== 'string' || value.length < 16 || value.length > 64) return false;
  for (let index = 0; index < value.length; index += 1) {
    const code = stringCharCodeAt(value, index);
    if (!(code >= 0x30 && code <= 0x39) && !(code >= 0x61 && code <= 0x66)) return false;
  }
  return true;
}

function digit(value, index) {
  const code = stringCharCodeAt(value, index);
  return code >= 0x30 && code <= 0x39 ? code - 0x30 : -1;
}

function canonicalTimestamp(value) {
  if (typeof value !== 'string' || value.length !== 24
      || stringCharCodeAt(value, 4) !== 0x2d
      || stringCharCodeAt(value, 7) !== 0x2d
      || stringCharCodeAt(value, 10) !== 0x54
      || stringCharCodeAt(value, 13) !== 0x3a
      || stringCharCodeAt(value, 16) !== 0x3a
      || stringCharCodeAt(value, 19) !== 0x2e
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
    const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
    maxDay = leap ? 29 : 28;
  }
  return day >= 1 && day <= maxDay;
}

function timestampValue(value) {
  if (!canonicalTimestamp(value)) return undefined;
  const year = digit(value, 0) * 1000 + digit(value, 1) * 100
    + digit(value, 2) * 10 + digit(value, 3);
  const month = digit(value, 5) * 10 + digit(value, 6);
  const day = digit(value, 8) * 10 + digit(value, 9);
  const hour = digit(value, 11) * 10 + digit(value, 12);
  const minute = digit(value, 14) * 10 + digit(value, 15);
  const second = digit(value, 17) * 10 + digit(value, 18);
  const millisecond = digit(value, 20) * 100 + digit(value, 21) * 10 + digit(value, 22);
  const adjustedYear = month <= 2 ? year - 1 : year;
  const era = mathFloor(adjustedYear / 400);
  const yearOfEra = adjustedYear - era * 400;
  const adjustedMonth = month + (month > 2 ? -3 : 9);
  const dayOfYear = mathFloor((153 * adjustedMonth + 2) / 5) + day - 1;
  const dayOfEra = yearOfEra * 365 + mathFloor(yearOfEra / 4)
    - mathFloor(yearOfEra / 100) + dayOfYear;
  const days = era * 146097 + dayOfEra;
  return (((days * 24 + hour) * 60 + minute) * 60 + second) * 1000 + millisecond;
}

function frozenRecord(entries) {
  const value = objectCreate(null);
  for (let index = 0; index < entries.length; index += 1) {
    value[entries[index][0]] = entries[index][1];
  }
  return objectFreeze(value);
}

export function createManagedStarterAgentReadiness(identity, presentation, observation) {
  const definition = plainRecord(observation, INPUT_KEYS);
  const evaluatedValue = timestampValue(definition.evaluatedAt);
  if (!isAuthenticIdentity(identity) || !isAuthenticPresentation(presentation)) invalid();
  const presentationValue = timestampValue(presentation.evaluatedAt);
  if (identity.tenantBinding.tenantId !== presentation.tenantId
      || identity.account.accountId !== presentation.accountId
      || identity.organization.organizationId !== presentation.organizationId
      || definition.schemaVersion !== 'managed-starter-agent-readiness-observation/1'
      || definition.tenantId !== presentation.tenantId
      || definition.accountId !== presentation.accountId
      || definition.organizationId !== presentation.organizationId
      || evaluatedValue === undefined
      || presentationValue === undefined
      || presentationValue > evaluatedValue
      || evaluatedValue - presentationValue > 86_400_000
      || presentation.selectionStatus !== 'blocked'
      || presentation.canSelect !== false
      || presentation.canCommit !== false) invalid();
  const gateInputs = gateArray(definition.gates);
  const gates = [];
  for (let index = 0; index < GATE_NAMES.length; index += 1) {
    const gate = plainRecord(gateInputs[index], GATE_KEYS);
    const observedValue = timestampValue(gate.observedAt);
    if (gate.name !== GATE_NAMES[index]
        || gate.state !== 'blocked' && gate.state !== 'not_configured'
        || index === 0 && gate.state !== 'blocked'
        || !opaqueSourceRef(gate.sourceRef)
        || observedValue === undefined
        || observedValue > evaluatedValue
        || evaluatedValue - observedValue > 86_400_000) invalid();
    defineProperty(gates, `${index}`, {
      configurable: true,
      enumerable: true,
      value: frozenRecord([
        ['name', gate.name],
        ['state', gate.state],
      ]),
      writable: true,
    });
  }
  objectFreeze(gates);
  const result = frozenRecord([
    ['schemaVersion', 'managed-starter-agent-readiness/1'],
    ['tenantId', definition.tenantId],
    ['accountId', definition.accountId],
    ['organizationId', definition.organizationId],
    ['evaluatedAt', definition.evaluatedAt],
    ['introductionStatus', 'blocked'],
    ['canIntroduce', false],
    ['canActivate', false],
    ['gates', gates],
  ]);
  weakSetAdd(authenticResults, result);
  return result;
}

defineProperty(createManagedStarterAgentReadiness, 'isAuthenticResult', {
  configurable: false,
  enumerable: false,
  value(value) {
    return value !== null && typeof value === 'object' && weakSetHas(authenticResults, value);
  },
  writable: false,
});
