import { createManagedCustomerIdentityDomain } from './managedCustomerIdentityDomain.mjs';
import { isProxy } from 'node:util/types';

const objectCreate = Object.create;
const objectFreeze = Object.freeze;
const objectIs = Object.is;
const getDescriptor = Object.getOwnPropertyDescriptor;
const getPrototype = Object.getPrototypeOf;
const numberIsInteger = Number.isInteger;
const reflectOwnKeys = Reflect.ownKeys;
const stringCharCodeAt = Function.call.bind(String.prototype.charCodeAt);
const stringSlice = Function.call.bind(String.prototype.slice);
const isAuthenticIdentity = createManagedCustomerIdentityDomain.isAuthenticResult;
const TypeErrorIntrinsic = TypeError;
const INVALID_INPUT = 'Invalid Agent Commons participation policy proposal input';
const ObjectPrototype = Object.prototype;
const KEYS = objectFreeze({
  input: objectFreeze([
    'schemaVersion', 'proposalId', 'participationMode', 'quietHours', 'proposedAt', 'recordedAt',
  ]),
  quietHours: objectFreeze(['mode', 'startMinuteUtc', 'endMinuteUtc']),
});

function invalid() {
  throw new TypeErrorIntrinsic(INVALID_INPUT);
}

function frozenRecord(entries) {
  const value = objectCreate(null);
  for (let index = 0; index < entries.length; index += 1) {
    value[entries[index][0]] = entries[index][1];
  }
  return objectFreeze(value);
}

function record(value, expected) {
  if (value === null || typeof value !== 'object' || isProxy(value)) invalid();
  const prototype = getPrototype(value);
  if (prototype !== ObjectPrototype && prototype !== null) invalid();
  const keys = reflectOwnKeys(value);
  if (keys.length !== expected.length) invalid();
  const copy = objectCreate(null);
  for (let expectedIndex = 0; expectedIndex < expected.length; expectedIndex += 1) {
    const expectedKey = expected[expectedIndex];
    let found = false;
    for (let keyIndex = 0; keyIndex < keys.length; keyIndex += 1) {
      if (typeof keys[keyIndex] !== 'string') invalid();
      if (keys[keyIndex] === expectedKey) found = true;
    }
    if (!found) invalid();
    const descriptor = getDescriptor(value, expectedKey);
    if (!descriptor || !('value' in descriptor) || descriptor.enumerable !== true) invalid();
    copy[expectedKey] = descriptor.value;
  }
  return copy;
}

function validMinute(value) {
  return numberIsInteger(value) && value >= 0 && value <= 1439 && !objectIs(value, -0);
}

function validProposalId(value) {
  if (typeof value !== 'string' || value.length < 25 || value.length > 73
      || stringSlice(value, 0, 9) !== 'proposal_') return false;
  for (let index = 9; index < value.length; index += 1) {
    const code = stringCharCodeAt(value, index);
    if (!(code >= 0x30 && code <= 0x39) && !(code >= 0x61 && code <= 0x66)) return false;
  }
  return true;
}

function digit(value, index) {
  const code = stringCharCodeAt(value, index);
  return code >= 0x30 && code <= 0x39 ? code - 0x30 : -1;
}

function validTimestamp(value) {
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

export function createAgentCommonsParticipationPolicyProposal(identity, input) {
  if (arguments.length !== 2) invalid();
  if (!isAuthenticIdentity(identity)) invalid();
  const definition = record(input, KEYS.input);
  const quietHoursInput = record(definition.quietHours, KEYS.quietHours);
  if (definition.schemaVersion !== 'agent-commons-participation-policy-proposal/1'
      || !validProposalId(definition.proposalId)) invalid();
  if (definition.participationMode !== 'enabled' && definition.participationMode !== 'paused') invalid();
  if (!validTimestamp(definition.proposedAt) || !validTimestamp(definition.recordedAt)
      || definition.recordedAt < definition.proposedAt) invalid();
  if (quietHoursInput.mode === 'disabled') {
    if (quietHoursInput.startMinuteUtc !== null || quietHoursInput.endMinuteUtc !== null) invalid();
  } else if (quietHoursInput.mode === 'daily_utc') {
    if (!validMinute(quietHoursInput.startMinuteUtc)
        || !validMinute(quietHoursInput.endMinuteUtc)
        || quietHoursInput.startMinuteUtc === quietHoursInput.endMinuteUtc) invalid();
  } else invalid();
  const quietHours = frozenRecord([
    ['mode', quietHoursInput.mode],
    ['startMinuteUtc', quietHoursInput.startMinuteUtc],
    ['endMinuteUtc', quietHoursInput.endMinuteUtc],
  ]);
  return frozenRecord([
    ['schemaVersion', definition.schemaVersion],
    ['proposalId', definition.proposalId],
    ['tenantId', identity.tenantBinding.tenantId],
    ['accountId', identity.account.accountId],
    ['participationMode', definition.participationMode],
    ['quietHours', quietHours],
    ['costPolicy', 'no_incremental_spend'],
    ['interruptionPolicy', 'return_to_assigned_state'],
    ['authorizationStatus', 'proposed_not_authorized'],
    ['proposedAt', definition.proposedAt],
    ['recordedAt', definition.recordedAt],
  ]);
}
