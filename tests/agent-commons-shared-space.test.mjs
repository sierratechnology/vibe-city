import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

import { createManagedCustomerIdentityDomain } from '../server/managedCustomerIdentityDomain.mjs';

const moduleUrl = new URL('../src/domain/agentCommonsSharedSpace.ts', import.meta.url);
const identityModuleUrl = new URL('../server/managedCustomerIdentityDomain.mjs', import.meta.url);
const ACCOUNT_ID = 'account_0000000000000001';
const ORGANIZATION_ID = 'organization_0000000000000002';
const TENANT_ID = 'tenant_0000000000000002';
const SPACE_ID = 'space_0000000000000003';
const INVALID = { name: 'TypeError', message: 'Invalid Agent Commons shared-space definition input' };

async function loadDomain(tag) {
  let source;
  try {
    source = await readFile(moduleUrl, 'utf8');
  } catch (error) {
    if (error?.code === 'ENOENT') return {};
    throw error;
  }
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText.replace(
    /['"]\.\.\/\.\.\/server\/managedCustomerIdentityDomain\.mjs['"]/,
    JSON.stringify(identityModuleUrl.href),
  );
  return import(`data:text/javascript;base64,${Buffer.from(output).toString('base64')}#${tag}`);
}

function identityInput() {
  return {
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
}

function authenticIdentity() {
  return createManagedCustomerIdentityDomain(identityInput());
}

function definitionInput(overrides = {}) {
  return {
    schemaVersion: 'agent-commons-shared-space/1',
    spaceId: SPACE_ID,
    displayName: 'Agent Commons',
    purpose: 'voluntary_social_creative_recreation',
    definedAt: '2026-10-05T12:00:00.000Z',
    recordedAt: '2026-10-05T12:00:00.000Z',
    ...overrides,
  };
}

test('T1 authentic managed identity creates the exact dormant shared-space definition', async () => {
  const domain = await loadDomain('t1');
  assert.equal(typeof domain.createAgentCommonsSharedSpaceDefinition, 'function');
  const result = domain.createAgentCommonsSharedSpaceDefinition(
    authenticIdentity(), definitionInput(),
  );
  assert.equal(Object.getPrototypeOf(result), null);
  assert.equal(Object.isFrozen(result), true);
  assert.deepEqual(Object.keys(result), [
    'schemaVersion', 'spaceId', 'tenantId', 'accountId', 'displayName', 'purpose',
    'accessBoundary', 'participationStatus', 'occupancyStatus', 'costPolicy', 'privacy',
    'definedAt', 'recordedAt',
  ]);
  assert.deepEqual({ ...result }, {
    schemaVersion: 'agent-commons-shared-space/1',
    spaceId: SPACE_ID,
    tenantId: TENANT_ID,
    accountId: ACCOUNT_ID,
    displayName: 'Agent Commons',
    purpose: 'voluntary_social_creative_recreation',
    accessBoundary: 'tenant_private',
    participationStatus: 'not_activated',
    occupancyStatus: 'unavailable',
    costPolicy: 'no_incremental_spend',
    privacy: 'tenant_private',
    definedAt: '2026-10-05T12:00:00.000Z',
    recordedAt: '2026-10-05T12:00:00.000Z',
  });
});

test('T2 exact provenance and arity reject hostile values before processing', async () => {
  const domain = await loadDomain('t2');
  const factory = domain.createAgentCommonsSharedSpaceDefinition;
  const identity = authenticIdentity();
  const foreignModule = await import(`../server/managedCustomerIdentityDomain.mjs?foreign=${Date.now()}`);
  const foreignIdentity = foreignModule.createManagedCustomerIdentityDomain(identityInput());
  let hooks = 0;
  const hostile = new Proxy(Object.create(null), {
    get() { hooks += 1; throw new Error('must not read'); },
    getPrototypeOf() { hooks += 1; throw new Error('must not inspect'); },
    ownKeys() { hooks += 1; throw new Error('must not enumerate'); },
  });

  assert.equal(factory.length, 2);
  for (const candidate of [
    null, { ...identity }, JSON.parse(JSON.stringify(identity)), Object.create(identity),
    new Proxy(identity, {
      get() { hooks += 1; throw new Error('must not read'); },
      getPrototypeOf() { hooks += 1; throw new Error('must not inspect'); },
      ownKeys() { hooks += 1; throw new Error('must not enumerate'); },
    }),
    foreignIdentity,
  ]) assert.throws(() => factory(candidate, definitionInput()), INVALID);
  assert.throws(() => factory(), INVALID);
  assert.throws(() => factory(identity), INVALID);
  assert.throws(() => factory(identity, definitionInput(), hostile), INVALID);
  assert.equal(hooks, 0);
});

test('T3 accepts only the exact closed schema and bounded scalar meanings', async () => {
  const domain = await loadDomain('t3');
  const factory = domain.createAgentCommonsSharedSpaceDefinition;
  const identity = authenticIdentity();
  const nullPrototype = Object.assign(Object.create(null), definitionInput());
  assert.equal(factory(identity, nullPrototype).spaceId, SPACE_ID);
  for (const spaceId of [`space_${'0'.repeat(16)}`, `space_${'abcdef0123456789'.repeat(4)}`]) {
    assert.equal(factory(identity, definitionInput({ spaceId })).spaceId, spaceId);
  }
  const extra = definitionInput();
  extra.participant = 'someone';
  const missing = definitionInput();
  delete missing.purpose;
  const symbolic = definitionInput();
  symbolic[Symbol('authority')] = true;
  const nonEnumerable = definitionInput();
  Object.defineProperty(nonEnumerable, 'purpose', {
    value: nonEnumerable.purpose,
    enumerable: false,
  });
  for (const candidate of [
    extra, missing, symbolic, nonEnumerable, [], null,
    definitionInput({ schemaVersion: 'agent-commons-shared-space/2' }),
    definitionInput({ spaceId: `space_${'0'.repeat(15)}` }),
    definitionInput({ spaceId: `space_${'0'.repeat(65)}` }),
    definitionInput({ spaceId: 'space_000000000000000G' }),
    definitionInput({ spaceId: 'id_0000000000000001' }),
    definitionInput({ displayName: 'Commons' }),
    definitionInput({ purpose: 'working' }),
    definitionInput({ spaceId: new String(SPACE_ID) }),
  ]) assert.throws(() => factory(identity, candidate), INVALID);
});

test('T4 canonical UTC chronology requires recordedAt at or after definedAt', async () => {
  const domain = await loadDomain('t4');
  const factory = domain.createAgentCommonsSharedSpaceDefinition;
  const identity = authenticIdentity();
  const later = factory(identity, definitionInput({
    definedAt: '2024-02-29T23:59:59.999Z',
    recordedAt: '2024-03-01T00:00:00.000Z',
  }));
  assert.deepEqual([later.definedAt, later.recordedAt], [
    '2024-02-29T23:59:59.999Z', '2024-03-01T00:00:00.000Z',
  ]);
  for (const overrides of [
    { definedAt: '2026-10-05T12:00:00Z' },
    { definedAt: '2026-02-29T12:00:00.000Z' },
    { definedAt: '2026-13-01T12:00:00.000Z' },
    { definedAt: '2026-10-05t12:00:00.000Z' },
    { definedAt: new String('2026-10-05T12:00:00.000Z') },
    { recordedAt: '2026-10-05T11:59:59.999Z' },
    { recordedAt: null },
  ]) assert.throws(() => factory(identity, definitionInput(overrides)), INVALID);
});

test('T5 characterization: hostile definitions fail closed with zero attacker hooks', async () => {
  const domain = await loadDomain('t5');
  const factory = domain.createAgentCommonsSharedSpaceDefinition;
  const identity = authenticIdentity();
  let hooks = 0;
  const accessor = definitionInput();
  Object.defineProperty(accessor, 'spaceId', {
    enumerable: true,
    get() { hooks += 1; return SPACE_ID; },
  });
  const proxy = new Proxy(definitionInput(), {
    get() { hooks += 1; throw new Error('must not read'); },
    getPrototypeOf() { hooks += 1; throw new Error('must not inspect'); },
    ownKeys() { hooks += 1; throw new Error('must not enumerate'); },
  });
  const inherited = Object.assign(Object.create({ authority: 'approved' }), definitionInput());
  const coercible = Object.freeze({
    toString() { hooks += 1; return SPACE_ID; },
    valueOf() { hooks += 1; return 0; },
  });
  for (const candidate of [
    accessor, proxy, inherited,
    definitionInput({ schemaVersion: coercible }),
    definitionInput({ spaceId: coercible }),
    definitionInput({ displayName: coercible }),
    definitionInput({ purpose: coercible }),
    definitionInput({ definedAt: coercible }),
    definitionInput({ recordedAt: coercible }),
  ]) assert.throws(() => factory(identity, candidate), INVALID);
  assert.equal(hooks, 0);
});

test('T6 characterization: output is detached recursively frozen plain data', async () => {
  const domain = await loadDomain('t6');
  const input = definitionInput();
  const result = domain.createAgentCommonsSharedSpaceDefinition(authenticIdentity(), input);
  assert.notEqual(result, input);
  assert.equal(Object.getPrototypeOf(result), null);
  assert.equal(Object.isFrozen(result), true);
  for (const value of Object.values(result)) {
    if (value !== null && typeof value === 'object') assert.equal(Object.isFrozen(value), true);
    assert.notEqual(typeof value, 'function');
  }
  input.spaceId = 'space_ffffffffffffffff';
  input.recordedAt = '2026-10-06T12:00:00.000Z';
  assert.equal(result.spaceId, SPACE_ID);
  assert.equal(result.recordedAt, '2026-10-05T12:00:00.000Z');
});

test('T7 characterization: captured intrinsics survive hostile ambient replacement', async () => {
  const domain = await loadDomain('t7');
  const identity = authenticIdentity();
  const NativeTypeError = globalThis.TypeError;
  const replacements = [
    [Object, 'create'], [Object, 'freeze'], [Object, 'getOwnPropertyDescriptor'],
    [Object, 'getPrototypeOf'], [Reflect, 'ownKeys'],
    [String.prototype, 'charCodeAt'], [String.prototype, 'slice'],
    [Object.prototype, 'hasOwnProperty'],
  ];
  for (let index = 0; index < replacements.length; index += 1) {
    replacements[index][2] = replacements[index][0][replacements[index][1]];
  }
  let hooks = 0;
  const hostile = () => { hooks += 1; throw new Error('ambient hook ran'); };
  let result;
  let denial;
  try {
    globalThis.TypeError = function HostileTypeError() { hooks += 1; return new Error('wrong'); };
    for (let index = 0; index < replacements.length; index += 1) {
      replacements[index][0][replacements[index][1]] = hostile;
    }
    result = domain.createAgentCommonsSharedSpaceDefinition(identity, definitionInput());
    try {
      domain.createAgentCommonsSharedSpaceDefinition(identity, definitionInput({ spaceId: 'invalid' }));
    } catch (error) {
      denial = error;
    }
  } finally {
    for (let index = 0; index < replacements.length; index += 1) {
      replacements[index][0][replacements[index][1]] = replacements[index][2];
    }
    globalThis.TypeError = NativeTypeError;
  }
  assert.equal(hooks, 0);
  assert.equal(result.spaceId, SPACE_ID);
  assert.equal(Object.getPrototypeOf(denial), NativeTypeError.prototype);
  assert.equal(denial.message, INVALID.message);
});

test('T8 characterization: definition is dormant private data without runtime or authority claims', async () => {
  const domain = await loadDomain('t8');
  assert.deepEqual(Object.keys(domain), ['createAgentCommonsSharedSpaceDefinition']);
  const result = domain.createAgentCommonsSharedSpaceDefinition(
    authenticIdentity(), definitionInput(),
  );
  for (const forbidden of [
    'participant', 'identity', 'invitation', 'attendance', 'occupancyCount',
    'activityEvent', 'workState', 'permission', 'authority', 'quietHoursEnforced',
    'proposalApproved', 'provider', 'route', 'persistence', 'publicProjection',
    'pricing', 'credential', 'tenantLabel', 'customerClaim', 'hostedAgentClaim',
    'friendship', 'productivity', 'productionStatus',
  ]) assert.equal(forbidden in result, false, `forbidden field: ${forbidden}`);

  const source = await readFile(moduleUrl, 'utf8');
  const imports = Array.from(
    source.matchAll(/\bfrom\s+['"]([^'"]+)['"];?/g),
    (match) => match[1],
  );
  assert.deepEqual(imports, [
    '../../server/managedCustomerIdentityDomain.mjs',
    'node:util/types',
  ]);
  const importers = [];
  const moduleFilePattern = /\.(?:[cm]?ts|tsx|[cm]?js|jsx)$/;
  assert.match('runtime/importer.mts', moduleFilePattern);
  assert.match('runtime/importer.cts', moduleFilePattern);
  for (const root of ['../src', '../server']) {
    const paths = await readdir(new URL(root, import.meta.url), { recursive: true });
    for (const path of paths) {
      if (!moduleFilePattern.test(path)
          || root === '../src' && path === 'domain/agentCommonsSharedSpace.ts') continue;
      const candidate = await readFile(new URL(`${root}/${path}`, import.meta.url), 'utf8');
      if (/agentCommonsSharedSpace/.test(candidate)) importers.push(`${root}/${path}`);
    }
  }
  assert.deepEqual(importers, []);
  assert.doesNotMatch(source, /\b(?:fetch|XMLHttpRequest|WebSocket|setTimeout|setInterval|process|document|window|localStorage|sessionStorage|console|eval)\b/);
  assert.doesNotMatch(source, /\bnew\s+Function\b/);
  assert.doesNotMatch(source, /(?:route|database|filesystem|storage|payment|price|balance|attendance|friendship|productivity)/i);
});
