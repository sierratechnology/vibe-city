import { isProxy } from 'node:util/types';

const objectCreate = Object.create;
const defineProperty = Object.defineProperty;
const objectFreeze = Object.freeze;
const getDescriptor = Object.getOwnPropertyDescriptor;
const getPrototype = Object.getPrototypeOf;
const reflectOwnKeys = Reflect.ownKeys;
const stringCharCodeAt = Function.call.bind(String.prototype.charCodeAt);
const stringSlice = Function.call.bind(String.prototype.slice);
const ObjectPrototype = Object.prototype;
const TypeErrorIntrinsic = TypeError;
const weakSetAdd = Function.call.bind(WeakSet.prototype.add);
const weakSetHas = Function.call.bind(WeakSet.prototype.has);
const authenticResults = new WeakSet();

const INVALID_INPUT = 'Invalid managed customer identity input';
const ACCOUNT_ID_PREFIX = 'account_';
const ORGANIZATION_ID_PREFIX = 'organization_';
const KEYS = objectFreeze({
  input: objectFreeze(['schemaVersion', 'account', 'organization', 'membership']),
  account: objectFreeze(['accountId', 'displayLabel', 'lifecycle']),
  organization: objectFreeze(['organizationId', 'displayLabel', 'lifecycle']),
  membership: objectFreeze(['accountId', 'organizationId', 'roleLabel', 'lifecycle']),
});

function invalid() {
  throw new TypeErrorIntrinsic(INVALID_INPUT);
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
      if (keys[keyIndex] === expectedKey) found = true;
      if (typeof keys[keyIndex] !== 'string') invalid();
    }
    if (!found) invalid();
    const descriptor = getDescriptor(value, expectedKey);
    if (!descriptor || !('value' in descriptor) || descriptor.enumerable !== true) invalid();
    copy[expectedKey] = descriptor.value;
  }
  return copy;
}

function canonicalId(value, prefix) {
  if (typeof value !== 'string'
      || value.length < prefix.length + 16
      || value.length > prefix.length + 64
      || stringSlice(value, 0, prefix.length) !== prefix) return false;
  for (let index = prefix.length; index < value.length; index += 1) {
    const code = stringCharCodeAt(value, index);
    if (!(code >= 0x30 && code <= 0x39) && !(code >= 0x61 && code <= 0x66)) return false;
  }
  return true;
}

function displayLabel(value) {
  if (typeof value !== 'string' || value.length === 0 || value.length > 80) return false;
  let bytes = 0;
  for (let index = 0; index < value.length; index += 1) {
    const code = stringCharCodeAt(value, index);
    if (code <= 0x1f || code === 0x7f || code === 0x20 && (index === 0 || index === value.length - 1)) return false;
    if (code <= 0x7f) bytes += 1;
    else if (code <= 0x7ff) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff) {
      const next = stringCharCodeAt(value, index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
      bytes += 4;
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) return false;
    else bytes += 3;
    if (bytes > 80) return false;
  }
  return true;
}

function frozenRecord(entries) {
  const record = objectCreate(null);
  for (let index = 0; index < entries.length; index += 1) {
    record[entries[index][0]] = entries[index][1];
  }
  return objectFreeze(record);
}

export function createManagedCustomerIdentityDomain(input) {
  const definition = record(input, KEYS.input);
  const accountInput = record(definition.account, KEYS.account);
  const organizationInput = record(definition.organization, KEYS.organization);
  const membershipInput = record(definition.membership, KEYS.membership);
  if (definition.schemaVersion !== 'managed-customer-identity/1'
      || !canonicalId(accountInput.accountId, ACCOUNT_ID_PREFIX)
      || !canonicalId(organizationInput.organizationId, ORGANIZATION_ID_PREFIX)
      || !displayLabel(accountInput.displayLabel)
      || !displayLabel(organizationInput.displayLabel)
      || membershipInput.organizationId !== organizationInput.organizationId
      || membershipInput.accountId !== accountInput.accountId
      || accountInput.lifecycle !== 'active'
      || organizationInput.lifecycle !== 'active'
      || membershipInput.lifecycle !== 'active'
      || membershipInput.roleLabel !== 'member') invalid();
  const account = frozenRecord([
    ['accountId', accountInput.accountId],
    ['displayLabel', accountInput.displayLabel],
    ['lifecycle', accountInput.lifecycle],
  ]);
  const organization = frozenRecord([
    ['organizationId', organizationInput.organizationId],
    ['displayLabel', organizationInput.displayLabel],
    ['lifecycle', organizationInput.lifecycle],
  ]);
  const membership = frozenRecord([
    ['accountId', membershipInput.accountId],
    ['organizationId', membershipInput.organizationId],
    ['roleLabel', membershipInput.roleLabel],
    ['lifecycle', membershipInput.lifecycle],
  ]);
  const tenantBinding = frozenRecord([
    ['tenantId', `tenant_${stringSlice(organization.organizationId, 'organization_'.length)}`],
    ['organizationId', organization.organizationId],
  ]);
  const result = frozenRecord([
    ['schemaVersion', definition.schemaVersion],
    ['account', account],
    ['organization', organization],
    ['membership', membership],
    ['tenantBinding', tenantBinding],
  ]);
  weakSetAdd(authenticResults, result);
  return result;
}

defineProperty(createManagedCustomerIdentityDomain, 'isAuthenticResult', {
  configurable: false,
  enumerable: false,
  value(value) {
    return value !== null && typeof value === 'object' && weakSetHas(authenticResults, value);
  },
  writable: false,
});
