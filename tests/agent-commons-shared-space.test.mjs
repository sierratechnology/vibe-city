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
const ACTIVITY_ID = 'activity_0000000000000004';
const INVALID = { name: 'TypeError', message: 'Invalid Agent Commons shared-space definition input' };
const INVALID_ACTIVITY = { name: 'TypeError', message: 'Invalid Agent Commons activity definition input' };

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

function activityInput(overrides = {}) {
  return {
    schemaVersion: 'agent-commons-activity-definition/1',
    activityId: ACTIVITY_ID,
    activityKind: 'creative',
    definedAt: '2026-10-05T12:01:00.000Z',
    recordedAt: '2026-10-05T12:01:00.000Z',
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

test('T8 characterization: definitions remain dormant private data without runtime or authority claims', async () => {
  const domain = await loadDomain('t8');
  assert.deepEqual(Object.keys(domain), [
    'createAgentCommonsActivityDefinition',
    'createAgentCommonsSharedSpaceDefinition',
  ]);
  const space = domain.createAgentCommonsSharedSpaceDefinition(
    authenticIdentity(), definitionInput(),
  );
  const input = activityInput();
  const activity = domain.createAgentCommonsActivityDefinition(space, input);
  for (const forbidden of [
    'participant', 'identity', 'invitation', 'attendance', 'occupancyCount',
    'activityEvent', 'workState', 'permission', 'authority', 'quietHoursEnforced',
    'proposalApproved', 'provider', 'route', 'persistence', 'publicProjection',
    'pricing', 'credential', 'tenantLabel', 'customerClaim', 'hostedAgentClaim',
    'friendship', 'productivity', 'productionStatus',
  ]) {
    assert.equal(forbidden in space, false, `forbidden shared-space field: ${forbidden}`);
    assert.equal(forbidden in activity, false, `forbidden activity field: ${forbidden}`);
  }
  assert.notEqual(activity, input);
  assert.equal(Object.getPrototypeOf(activity), null);
  assert.equal(Object.isFrozen(activity), true);
  for (const value of Object.values(activity)) {
    if (value !== null && typeof value === 'object') assert.equal(Object.isFrozen(value), true);
    assert.notEqual(typeof value, 'function');
  }
  input.activityId = 'activity_ffffffffffffffff';
  input.recordedAt = '2026-10-06T12:01:00.000Z';
  assert.equal(activity.activityId, ACTIVITY_ID);
  assert.equal(activity.recordedAt, '2026-10-05T12:01:00.000Z');

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

test('T9 authentic same-module space creates the exact dormant activity definition', async () => {
  const domain = await loadDomain('t9');
  const space = domain.createAgentCommonsSharedSpaceDefinition(
    authenticIdentity(), definitionInput(),
  );
  assert.equal(typeof domain.createAgentCommonsActivityDefinition, 'function');
  const result = domain.createAgentCommonsActivityDefinition(space, activityInput());
  assert.equal(Object.getPrototypeOf(result), null);
  assert.equal(Object.isFrozen(result), true);
  assert.deepEqual(Object.keys(result), [
    'schemaVersion', 'activityId', 'spaceId', 'tenantId', 'accountId', 'activityKind',
    'participation', 'activationStatus', 'availability', 'accessBoundary', 'privacy',
    'costPolicy', 'interruptionPolicy', 'definedAt', 'recordedAt',
  ]);
  assert.deepEqual({ ...result }, {
    schemaVersion: 'agent-commons-activity-definition/1',
    activityId: ACTIVITY_ID,
    spaceId: SPACE_ID,
    tenantId: TENANT_ID,
    accountId: ACCOUNT_ID,
    activityKind: 'creative',
    participation: 'voluntary',
    activationStatus: 'not_activated',
    availability: 'unavailable',
    accessBoundary: 'tenant_private',
    privacy: 'tenant_private',
    costPolicy: 'no_incremental_spend',
    interruptionPolicy: 'return_to_assigned_state',
    definedAt: '2026-10-05T12:01:00.000Z',
    recordedAt: '2026-10-05T12:01:00.000Z',
  });
});

test('T10 activity factory rejects wrong arity before hostile input processing', async () => {
  const domain = await loadDomain('t10');
  const factory = domain.createAgentCommonsActivityDefinition;
  const space = domain.createAgentCommonsSharedSpaceDefinition(
    authenticIdentity(), definitionInput(),
  );
  let hooks = 0;
  const hostile = new Proxy(Object.create(null), {
    get() { hooks += 1; throw new Error('must not read'); },
    getPrototypeOf() { hooks += 1; throw new Error('must not inspect'); },
    ownKeys() { hooks += 1; throw new Error('must not enumerate'); },
  });
  assert.equal(factory.length, 2);
  assert.throws(() => factory(), INVALID_ACTIVITY);
  assert.throws(() => factory(space), INVALID_ACTIVITY);
  assert.throws(() => factory(space, activityInput(), hostile), INVALID_ACTIVITY);
  assert.equal(hooks, 0);
});

test('T11 activity input accepts only the exact closed schema and bounded meanings', async () => {
  const domain = await loadDomain('t11');
  const factory = domain.createAgentCommonsActivityDefinition;
  const space = domain.createAgentCommonsSharedSpaceDefinition(
    authenticIdentity(), definitionInput(),
  );
  const nullPrototype = Object.assign(Object.create(null), activityInput());
  assert.equal(factory(space, nullPrototype).activityId, ACTIVITY_ID);
  for (const activityKind of ['social', 'creative', 'recreation']) {
    assert.equal(factory(space, activityInput({ activityKind })).activityKind, activityKind);
  }
  for (const activityId of [
    `activity_${'0'.repeat(16)}`, `activity_${'abcdef0123456789'.repeat(4)}`,
  ]) assert.equal(factory(space, activityInput({ activityId })).activityId, activityId);

  const extra = activityInput();
  extra.participant = 'someone';
  const missing = activityInput();
  delete missing.activityKind;
  const symbolic = activityInput();
  symbolic[Symbol('authority')] = true;
  const nonEnumerable = activityInput();
  Object.defineProperty(nonEnumerable, 'activityKind', {
    value: nonEnumerable.activityKind,
    enumerable: false,
  });
  for (const candidate of [
    extra, missing, symbolic, nonEnumerable, [], null,
    activityInput({ schemaVersion: 'agent-commons-activity-definition/2' }),
    activityInput({ activityId: `activity_${'0'.repeat(15)}` }),
    activityInput({ activityId: `activity_${'0'.repeat(65)}` }),
    activityInput({ activityId: 'activity_000000000000000G' }),
    activityInput({ activityId: 'event_0000000000000001' }),
    activityInput({ activityId: new String(ACTIVITY_ID) }),
    activityInput({ activityKind: 'work' }),
    activityInput({ activityKind: new String('creative') }),
  ]) assert.throws(() => factory(space, candidate), INVALID_ACTIVITY);
});

test('T12 activity binding rejects copied, wrapped, proxied, and foreign spaces without hooks', async () => {
  const domain = await loadDomain('t12');
  const foreignDomain = await loadDomain('t12-foreign');
  const factory = domain.createAgentCommonsActivityDefinition;
  const space = domain.createAgentCommonsSharedSpaceDefinition(
    authenticIdentity(), definitionInput(),
  );
  const foreignSpace = foreignDomain.createAgentCommonsSharedSpaceDefinition(
    authenticIdentity(), definitionInput(),
  );
  let hooks = 0;
  const proxy = new Proxy(space, {
    get() { hooks += 1; throw new Error('must not read'); },
    getPrototypeOf() { hooks += 1; throw new Error('must not inspect'); },
    ownKeys() { hooks += 1; throw new Error('must not enumerate'); },
  });
  for (const candidate of [
    { ...space },
    JSON.parse(JSON.stringify(space)),
    Object.create(space),
    Object.freeze({ value: space }),
    proxy,
    foreignSpace,
  ]) assert.throws(() => factory(candidate, activityInput()), INVALID_ACTIVITY);
  assert.equal(hooks, 0);
});

test('T13 hostile activity records and coercible scalars fail closed without hooks', async () => {
  const domain = await loadDomain('t13');
  const factory = domain.createAgentCommonsActivityDefinition;
  const space = domain.createAgentCommonsSharedSpaceDefinition(
    authenticIdentity(), definitionInput(),
  );
  let hooks = 0;
  const accessor = activityInput();
  Object.defineProperty(accessor, 'activityId', {
    enumerable: true,
    get() { hooks += 1; accessor.recordedAt = '2099-01-01T00:00:00.000Z'; return ACTIVITY_ID; },
  });
  const proxy = new Proxy(activityInput(), {
    get() { hooks += 1; throw new Error('must not read'); },
    getPrototypeOf() { hooks += 1; throw new Error('must not inspect'); },
    ownKeys() { hooks += 1; throw new Error('must not enumerate'); },
  });
  const inherited = Object.assign(Object.create({ authority: 'approved' }), activityInput());
  const coercible = Object.freeze({
    toString() { hooks += 1; return 'creative'; },
    valueOf() { hooks += 1; return 0; },
  });
  for (const candidate of [
    accessor,
    proxy,
    inherited,
    activityInput({ schemaVersion: coercible }),
    activityInput({ activityId: coercible }),
    activityInput({ activityKind: coercible }),
    activityInput({ definedAt: coercible }),
    activityInput({ recordedAt: coercible }),
  ]) assert.throws(() => factory(space, candidate), INVALID_ACTIVITY);
  assert.equal(hooks, 0);
});

test('T14 activity canonical UTC chronology requires recordedAt at or after definedAt', async () => {
  const domain = await loadDomain('t14');
  const factory = domain.createAgentCommonsActivityDefinition;
  const space = domain.createAgentCommonsSharedSpaceDefinition(
    authenticIdentity(), definitionInput(),
  );
  const later = factory(space, activityInput({
    definedAt: '2024-02-29T23:59:59.999Z',
    recordedAt: '2024-03-01T00:00:00.000Z',
  }));
  assert.deepEqual([later.definedAt, later.recordedAt], [
    '2024-02-29T23:59:59.999Z', '2024-03-01T00:00:00.000Z',
  ]);
  for (const overrides of [
    { definedAt: '2026-10-05T12:01:00Z' },
    { definedAt: '2026-02-29T12:01:00.000Z' },
    { definedAt: '2026-13-01T12:01:00.000Z' },
    { definedAt: '2026-10-05t12:01:00.000Z' },
    { recordedAt: '2026-10-05T12:00:59.999Z' },
    { recordedAt: null },
  ]) assert.throws(() => factory(space, activityInput(overrides)), INVALID_ACTIVITY);
});

test('T15 captured provenance intrinsics survive hostile ambient replacement', async () => {
  const domain = await loadDomain('t15');
  const identity = authenticIdentity();
  const nativeAdd = WeakSet.prototype.add;
  const nativeHas = WeakSet.prototype.has;
  let hooks = 0;
  const hostile = () => { hooks += 1; throw new Error('ambient hook ran'); };
  let result;
  try {
    WeakSet.prototype.add = hostile;
    WeakSet.prototype.has = hostile;
    const space = domain.createAgentCommonsSharedSpaceDefinition(identity, definitionInput());
    result = domain.createAgentCommonsActivityDefinition(space, activityInput());
  } finally {
    WeakSet.prototype.add = nativeAdd;
    WeakSet.prototype.has = nativeHas;
  }
  assert.equal(hooks, 0);
  assert.equal(result.activityId, ACTIVITY_ID);
});
