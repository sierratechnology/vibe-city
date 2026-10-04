import assert from 'node:assert/strict';
import test from 'node:test';

const MODULE_PATH = '../server/managedCustomerIdentityDomain.mjs';
const ACCOUNT_ID = 'account_0000000000000001';
const ORGANIZATION_ID = 'organization_0000000000000002';

async function loadDomain() {
  return import(MODULE_PATH).catch(() => ({}));
}

function fixture(overrides = {}) {
  const value = {
    schemaVersion: 'managed-customer-identity/1',
    account: {
      accountId: ACCOUNT_ID,
      displayLabel: 'Synthetic Account',
      lifecycle: 'active',
    },
    organization: {
      organizationId: ORGANIZATION_ID,
      displayLabel: 'Synthetic Organization',
      lifecycle: 'active',
    },
    membership: {
      accountId: ACCOUNT_ID,
      organizationId: ORGANIZATION_ID,
      roleLabel: 'member',
      lifecycle: 'active',
    },
  };
  return Object.assign(value, overrides);
}

test('T1 constructs one detached frozen active identity domain with an exact tenant binding', async () => {
  const domain = await loadDomain();
  assert.equal(typeof domain.createManagedCustomerIdentityDomain, 'function');
  const input = fixture();
  const result = domain.createManagedCustomerIdentityDomain(input);

  assert.equal(Object.getPrototypeOf(result), null);
  assert.deepEqual(Object.keys(result), [
    'schemaVersion', 'account', 'organization', 'membership', 'tenantBinding',
  ]);
  assert.deepEqual({
    ...result,
    account: { ...result.account },
    organization: { ...result.organization },
    membership: { ...result.membership },
    tenantBinding: { ...result.tenantBinding },
  }, {
    schemaVersion: 'managed-customer-identity/1',
    account: {
      accountId: ACCOUNT_ID,
      displayLabel: 'Synthetic Account',
      lifecycle: 'active',
    },
    organization: {
      organizationId: ORGANIZATION_ID,
      displayLabel: 'Synthetic Organization',
      lifecycle: 'active',
    },
    membership: {
      accountId: ACCOUNT_ID,
      organizationId: ORGANIZATION_ID,
      roleLabel: 'member',
      lifecycle: 'active',
    },
    tenantBinding: {
      tenantId: 'tenant_0000000000000002',
      organizationId: ORGANIZATION_ID,
    },
  });
  for (const value of [
    result, result.account, result.organization, result.membership, result.tenantBinding,
  ]) {
    assert.equal(Object.getPrototypeOf(value), null);
    assert.equal(Object.isFrozen(value), true);
  }
  assert.notEqual(result.account, input.account);
  assert.notEqual(result.organization, input.organization);
  assert.notEqual(result.membership, input.membership);
  input.account.displayLabel = 'Mutated Account';
  input.organization.displayLabel = 'Mutated Organization';
  input.membership.roleLabel = 'tampered';
  assert.equal(result.account.displayLabel, 'Synthetic Account');
  assert.equal(result.organization.displayLabel, 'Synthetic Organization');
  assert.equal(result.membership.roleLabel, 'member');
});

test('T2 display-label changes preserve stable identity membership and tenant meaning', async () => {
  const domain = await loadDomain();
  const before = domain.createManagedCustomerIdentityDomain(fixture());
  const changed = fixture();
  changed.account.displayLabel = 'Renamed Synthetic Account';
  changed.organization.displayLabel = 'Renamed Synthetic Organization';
  const after = domain.createManagedCustomerIdentityDomain(changed);

  assert.notEqual(after.account.displayLabel, before.account.displayLabel);
  assert.notEqual(after.organization.displayLabel, before.organization.displayLabel);
  assert.equal(after.account.accountId, before.account.accountId);
  assert.equal(after.organization.organizationId, before.organization.organizationId);
  assert.deepEqual({ ...after.membership }, { ...before.membership });
  assert.deepEqual({ ...after.tenantBinding }, { ...before.tenantBinding });
});

test('T3a cross-organization membership substitution fails with the generic error', async () => {
  const domain = await loadDomain();
  const input = fixture();
  input.membership.organizationId = 'organization_ffffffffffffffff';
  assert.throws(
    () => domain.createManagedCustomerIdentityDomain(input),
    { name: 'TypeError', message: 'Invalid managed customer identity input' },
  );
});

test('T3b membership account mismatch fails with the same generic error', async () => {
  const domain = await loadDomain();
  const input = fixture();
  input.membership.accountId = 'account_ffffffffffffffff';
  assert.throws(
    () => domain.createManagedCustomerIdentityDomain(input),
    { name: 'TypeError', message: 'Invalid managed customer identity input' },
  );
});

test('T3c inactive identity facts fail closed without fabricating deletion or history', async () => {
  const domain = await loadDomain();
  for (const path of [
    ['account', 'lifecycle'],
    ['organization', 'lifecycle'],
    ['membership', 'lifecycle'],
  ]) {
    const input = fixture();
    input[path[0]][path[1]] = 'inactive';
    assert.throws(
      () => domain.createManagedCustomerIdentityDomain(input),
      { name: 'TypeError', message: 'Invalid managed customer identity input' },
    );
  }
});

test('T3d an ambiguous membership role fails with the generic error', async () => {
  const domain = await loadDomain();
  const input = fixture();
  input.membership.roleLabel = 'admin-or-member';
  assert.throws(
    () => domain.createManagedCustomerIdentityDomain(input),
    { name: 'TypeError', message: 'Invalid managed customer identity input' },
  );
});

test('T4a only exact closed canonical plain-data schemas and primitive scalars are accepted', async () => {
  const domain = await loadDomain();
  const invalid = [];
  invalid.push(null, [], { ...fixture(), extra: true });
  const extraAccount = fixture();
  extraAccount.account.email = 'private@example.invalid';
  invalid.push(extraAccount);
  const extraOrganization = fixture();
  extraOrganization.organization.tenantId = 'tenant_0000000000000002';
  invalid.push(extraOrganization);
  const extraMembership = fixture();
  extraMembership.membership.authority = 'owner';
  invalid.push(extraMembership);
  const inherited = Object.assign(Object.create({ inherited: true }), fixture());
  invalid.push(inherited);
  const symbol = fixture();
  symbol.account[Symbol('hidden')] = true;
  invalid.push(symbol);
  for (const [field, value] of [
    ['schemaVersion', new String('managed-customer-identity/1')],
    ['accountId', 'account_not-canonical'],
    ['organizationId', 'organization_not-canonical'],
    ['displayLabel', ''],
    ['displayLabel', `Synthetic ${'x'.repeat(80)}`],
  ]) {
    const input = fixture();
    if (field === 'schemaVersion') input.schemaVersion = value;
    else if (field === 'organizationId') {
      input.organization.organizationId = value;
      input.membership.organizationId = value;
    } else input.account[field] = value;
    invalid.push(input);
  }
  for (const input of invalid) {
    assert.throws(
      () => domain.createManagedCustomerIdentityDomain(input),
      { name: 'TypeError', message: 'Invalid managed customer identity input' },
    );
  }
});

test('T4b accessors proxies cycles and shared identities fail closed without hostile hook execution', async () => {
  const domain = await loadDomain();
  let hooks = 0;
  const accessor = fixture();
  Object.defineProperty(accessor.account, 'displayLabel', {
    enumerable: true,
    get() { hooks += 1; return 'Synthetic Account'; },
  });
  const proxied = fixture();
  proxied.organization = new Proxy(proxied.organization, {
    get() { hooks += 1; throw new Error('must not read'); },
    getPrototypeOf() { hooks += 1; throw new Error('must not inspect'); },
    ownKeys() { hooks += 1; throw new Error('must not enumerate'); },
  });
  const cyclic = fixture();
  cyclic.account.displayLabel = cyclic;
  const shared = fixture();
  shared.membership = shared.account;
  for (const input of [accessor, proxied, cyclic, shared]) {
    assert.throws(
      () => domain.createManagedCustomerIdentityDomain(input),
      { name: 'TypeError', message: 'Invalid managed customer identity input' },
    );
  }
  assert.equal(hooks, 0);
});

test('T4c valid construction executes no replaceable ambient intrinsic hooks', async () => {
  const domain = await loadDomain();
  const input = fixture();
  let hooks = 0;
  const originals = {
    iterator: Array.prototype[Symbol.iterator],
    descriptor: Object.getOwnPropertyDescriptor,
    prototype: Object.getPrototypeOf,
    ownKeys: Reflect.ownKeys,
    regexpTest: RegExp.prototype.test,
    charCodeAt: String.prototype.charCodeAt,
  };
  let result;
  try {
    Array.prototype[Symbol.iterator] = function hostileIterator(...args) {
      hooks += 1;
      return originals.iterator.apply(this, args);
    };
    Object.getOwnPropertyDescriptor = (...args) => {
      hooks += 1;
      return originals.descriptor(...args);
    };
    Object.getPrototypeOf = (...args) => {
      hooks += 1;
      return originals.prototype(...args);
    };
    Reflect.ownKeys = (...args) => {
      hooks += 1;
      return originals.ownKeys(...args);
    };
    RegExp.prototype.test = function hostileTest(...args) {
      hooks += 1;
      return originals.regexpTest.apply(this, args);
    };
    String.prototype.charCodeAt = function hostileCharCodeAt(...args) {
      hooks += 1;
      return originals.charCodeAt.apply(this, args);
    };
    result = domain.createManagedCustomerIdentityDomain(input);
  } finally {
    Array.prototype[Symbol.iterator] = originals.iterator;
    Object.getOwnPropertyDescriptor = originals.descriptor;
    Object.getPrototypeOf = originals.prototype;
    Reflect.ownKeys = originals.ownKeys;
    RegExp.prototype.test = originals.regexpTest;
    String.prototype.charCodeAt = originals.charCodeAt;
  }
  assert.equal(result.account.accountId, ACCOUNT_ID);
  assert.equal(hooks, 0);
});

test('T4c2 canonical ID validation never dispatches through hostile RegExp exec', async () => {
  const domain = await loadDomain();
  const OriginalTypeError = globalThis.TypeError;
  const originalExecDescriptor = Object.getOwnPropertyDescriptor(RegExp.prototype, 'exec');
  let hooks = 0;
  let result;
  let validError;
  let invalidError;
  try {
    Object.defineProperty(RegExp.prototype, 'exec', {
      ...originalExecDescriptor,
      value() {
        hooks += 1;
        throw new Error('HOSTILE_EXEC_RAN');
      },
    });
    try {
      result = domain.createManagedCustomerIdentityDomain(fixture());
    } catch (error) {
      validError = error;
    }
    const invalid = fixture();
    invalid.account.accountId = 'account_not-canonical';
    invalid.membership.accountId = invalid.account.accountId;
    try {
      domain.createManagedCustomerIdentityDomain(invalid);
    } catch (error) {
      invalidError = error;
    }
  } finally {
    Object.defineProperty(RegExp.prototype, 'exec', originalExecDescriptor);
  }
  assert.equal(hooks, 0);
  assert.equal(validError, undefined);
  assert.equal(result?.account.accountId, ACCOUNT_ID);
  assert.equal(Object.getPrototypeOf(invalidError), OriginalTypeError.prototype);
  assert.equal(invalidError?.message, 'Invalid managed customer identity input');
});

test('T4d generic rejection does not resolve a hostile ambient TypeError constructor', async () => {
  const domain = await loadDomain();
  const OriginalTypeError = globalThis.TypeError;
  let hooks = 0;
  let observed;
  try {
    globalThis.TypeError = function HostileTypeError(...args) {
      hooks += 1;
      return new OriginalTypeError(...args);
    };
    try {
      domain.createManagedCustomerIdentityDomain(null);
    } catch (error) {
      observed = error;
    }
  } finally {
    globalThis.TypeError = OriginalTypeError;
  }
  assert.equal(hooks, 0);
  assert.equal(observed?.name, 'TypeError');
  assert.equal(observed?.message, 'Invalid managed customer identity input');
});

test('T3e unknown and ambiguous lifecycle labels use the same generic rejection', async () => {
  const domain = await loadDomain();
  for (const lifecycle of ['unknown', 'active-or-inactive', null, new String('active')]) {
    const input = fixture();
    input.membership.lifecycle = lifecycle;
    assert.throws(
      () => domain.createManagedCustomerIdentityDomain(input),
      { name: 'TypeError', message: 'Invalid managed customer identity input' },
    );
  }
});

test('T4e the dormant module and result expose no authority private data history or executable methods', async () => {
  const domain = await loadDomain();
  assert.deepEqual(Object.keys(domain), ['createManagedCustomerIdentityDomain']);
  const result = domain.createManagedCustomerIdentityDomain(fixture());
  const serialized = JSON.stringify(result);
  for (const forbidden of [
    'email', 'credential', 'legalName', 'billing', 'price', 'payment', 'lease',
    'capacity', 'provider', 'repository', 'task', 'permission',
    'authority', 'owner', 'neighbor', 'deleted', 'history',
  ]) assert.equal(serialized.includes(forbidden), false, `forbidden result field: ${forbidden}`);
  for (const value of Object.values(result)) assert.notEqual(typeof value, 'function');
});

test('T4f display labels use bounded well-formed UTF-8 and oversized containers fail closed', async () => {
  const domain = await loadDomain();
  const bounded = fixture();
  bounded.account.displayLabel = 'é'.repeat(40);
  assert.equal(domain.createManagedCustomerIdentityDomain(bounded).account.displayLabel, 'é'.repeat(40));
  for (const displayLabel of ['é'.repeat(41), '\ud800', ' Synthetic', 'Synthetic\nAccount']) {
    const input = fixture();
    input.account.displayLabel = displayLabel;
    assert.throws(
      () => domain.createManagedCustomerIdentityDomain(input),
      { name: 'TypeError', message: 'Invalid managed customer identity input' },
    );
  }
  const oversized = fixture();
  for (let index = 0; index < 1000; index += 1) oversized[`extra${index}`] = index;
  assert.throws(
    () => domain.createManagedCustomerIdentityDomain(oversized),
    { name: 'TypeError', message: 'Invalid managed customer identity input' },
  );
});
