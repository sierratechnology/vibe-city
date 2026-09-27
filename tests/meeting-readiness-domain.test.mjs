import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const presenceUrl = new URL('../src/domain/hostedAgentPresence.ts', import.meta.url);
const readinessUrl = new URL('../src/domain/meetingReadiness.ts', import.meta.url);

async function transpile(url) {
  const source = await readFile(url, 'utf8');
  return ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText;
}

async function loadDomain(fragment) {
  const presenceOutput = await transpile(presenceUrl);
  const presenceModuleUrl = `data:text/javascript;base64,${Buffer.from(presenceOutput).toString('base64')}#presence-${fragment}`;
  let readinessOutput;
  try {
    readinessOutput = await transpile(readinessUrl);
  } catch (error) {
    if (error?.code === 'ENOENT') return import(presenceModuleUrl);
    throw error;
  }
  readinessOutput = readinessOutput
    .replaceAll('./hostedAgentPresence', presenceModuleUrl)
    .replaceAll('./hostedAgent\\u0050resence', presenceModuleUrl);
  const readinessModuleUrl = `data:text/javascript;base64,${Buffer.from(readinessOutput).toString('base64')}#readiness-${fragment}`;
  return { ...await import(presenceModuleUrl), ...await import(readinessModuleUrl) };
}

const IDS = Object.freeze({
  tenant: 'id_1111111111111111',
  subject: 'id_2222222222222222',
  purpose: 'id_3333333333333333',
  materialA: 'id_4444444444444444',
  materialB: 'id_5555555555555555',
});

function mappingFixture(overrides = {}) {
  return {
    tenantId: IDS.tenant,
    subjectId: IDS.subject,
    identityId: 'stg-spiders',
    displayName: 'Spiders',
    profileName: 'spiders',
    registryRevision: 7,
    synchronizedAt: '2026-09-27T10:00:00.000Z',
    status: 'active',
    roleLabel: 'Chief Agent',
    workplaceLabel: 'Chief Agent Office',
    skills: ['project-coordination'],
    permissions: [],
    actionAuthorities: [],
    ...overrides,
  };
}

function readinessFixture(overrides = {}) {
  return {
    purposeId: IDS.purpose,
    purposeSummary: 'Review bounded synthetic planning materials',
    materialRefs: [IDS.materialA, IDS.materialB],
    preparedAt: '2026-09-27T10:00:00.000Z',
    readyAt: '2026-09-27T10:01:00.000Z',
    ...overrides,
  };
}

const genericError = { name: 'TypeError', message: 'Invalid meeting readiness input' };

function assertRecursivelyFrozen(value) {
  const pending = [value];
  while (pending.length > 0) {
    const current = pending.pop();
    assert.equal(Object.isFrozen(current), true);
    for (const child of Object.values(current)) {
      if (child !== null && typeof child === 'object') pending.push(child);
    }
  }
}

test('active exact reviewed identity produces dormant readiness without attendance or authority', async () => {
  const domain = await loadDomain('active-success');
  assert.equal(typeof domain.createMeetingReadiness, 'function');
  const mapping = domain.createReviewedHostedIdentityMapping(mappingFixture());

  assert.deepEqual(domain.createMeetingReadiness(mapping, readinessFixture()), {
    schemaVersion: 'meeting-readiness/1',
    tenantId: IDS.tenant,
    purpose: {
      purposeId: IDS.purpose,
      summary: 'Review bounded synthetic planning materials',
    },
    participants: [{
      subjectId: IDS.subject,
      identityId: 'stg-spiders',
      profileName: 'spiders',
      displayName: 'Spiders',
      roleLabel: 'Chief Agent',
      workplaceLabel: 'Chief Agent Office',
      participationState: 'not_invited',
      authorityState: 'not_granted',
    }],
    materials: [IDS.materialA, IDS.materialB],
    lifecycle: {
      state: 'readiness_only',
      preparedAt: '2026-09-27T10:00:00.000Z',
      readyAt: '2026-09-27T10:01:00.000Z',
    },
    outcome: {
      sessionState: 'no_session',
      outcomeState: 'no_outcome_yet',
    },
  });
});

test('readiness chronology starts no earlier than identity synchronization and advances strictly', async () => {
  const domain = await loadDomain('chronology');
  const mapping = domain.createReviewedHostedIdentityMapping(mappingFixture());
  assert.doesNotThrow(() => domain.createMeetingReadiness(mapping, readinessFixture()));

  for (const input of [
    readinessFixture({ preparedAt: '2026-09-27T09:59:59.999Z' }),
    readinessFixture({ readyAt: '2026-09-27T10:00:00.000Z' }),
    readinessFixture({ readyAt: '2026-09-27T09:59:59.999Z' }),
    readinessFixture({ preparedAt: '2026-09-27T10:00:00Z' }),
    readinessFixture({ readyAt: 'not-a-timestamp' }),
  ]) {
    assert.throws(() => domain.createMeetingReadiness(mapping, input), genericError);
  }
});

test('readiness input is one closed plain own-data-property record', async () => {
  const domain = await loadDomain('closed-input');
  const mapping = domain.createReviewedHostedIdentityMapping(mappingFixture());
  const missing = readinessFixture();
  delete missing.purposeId;
  const inherited = Object.assign(Object.create({ inherited: true }), readinessFixture());
  const symbol = Object.assign(readinessFixture(), { [Symbol('hidden')]: true });
  const nonEnumerable = Object.defineProperty(readinessFixture(), 'hidden', { value: true });
  let getterCalls = 0;
  const accessor = Object.defineProperty(readinessFixture(), 'purposeSummary', {
    get() { getterCalls += 1; return 'must not run'; },
  });
  const setter = Object.defineProperty(readinessFixture(), 'purposeSummary', {
    set() { getterCalls += 1; },
  });

  for (const input of [
    null, [], new String('boxed'), missing, { ...readinessFixture(), unknown: true },
    inherited, symbol, nonEnumerable, accessor, setter,
  ]) {
    assert.throws(() => domain.createMeetingReadiness(mapping, input), genericError);
  }
  assert.equal(getterCalls, 0);
});

test('purpose facts require canonical opaque identity and bounded safe text without coercion', async () => {
  const domain = await loadDomain('purpose-facts');
  const mapping = domain.createReviewedHostedIdentityMapping(mappingFixture());
  let coercionCalls = 0;
  const coercible = {
    toString() { coercionCalls += 1; return IDS.purpose; },
    valueOf() { coercionCalls += 1; return IDS.purpose; },
    [Symbol.toPrimitive]() { coercionCalls += 1; return IDS.purpose; },
  };
  for (const input of [
    readinessFixture({ purposeId: 'purpose-plain' }),
    readinessFixture({ purposeId: 'id_ABCDEFABCDEFABCD' }),
    readinessFixture({ purposeId: coercible }),
    readinessFixture({ purposeSummary: '' }),
    readinessFixture({ purposeSummary: '   ' }),
    readinessFixture({ purposeSummary: 'unsafe\u0000text' }),
    readinessFixture({ purposeSummary: 'unsafe\ud800text' }),
    readinessFixture({ purposeSummary: 'x'.repeat(201) }),
    readinessFixture({ purposeSummary: coercible }),
  ]) {
    assert.throws(() => domain.createMeetingReadiness(mapping, input), genericError);
  }
  assert.equal(coercionCalls, 0);
});

test('material references are a bounded dense ordered deduplicated opaque-id array', async () => {
  const domain = await loadDomain('materials');
  const mapping = domain.createReviewedHostedIdentityMapping(mappingFixture());
  const sparse = Array(1);
  const accessor = Object.defineProperty([IDS.materialA], '0', {
    get() { throw new Error('getter must not execute'); },
  });
  let readTraps = 0;
  const proxied = new Proxy([IDS.materialA], {
    get() { readTraps += 1; throw new Error('get trap must not execute'); },
    ownKeys() { throw new Error('proxy must fail closed'); },
  });
  for (const materialRefs of [
    [], sparse, Array.from({ length: 17 }, (_, index) => `id_${index.toString(16).padStart(16, '0')}`),
    [IDS.materialA, IDS.materialA], ['material-plain'], [new String(IDS.materialA)],
    accessor, proxied, Object.assign([IDS.materialA], { extra: true }),
  ]) {
    assert.throws(
      () => domain.createMeetingReadiness(mapping, readinessFixture({ materialRefs })),
      genericError,
    );
  }
  assert.equal(readTraps, 0);
});

test('readiness requires exact active reviewed mapping provenance without Proxy traps', async () => {
  const domain = await loadDomain('mapping-provenance');
  const mapping = domain.createReviewedHostedIdentityMapping(mappingFixture());
  const retired = domain.createReviewedHostedIdentityMapping(mappingFixture({ status: 'retired' }));
  const revoked = domain.createReviewedHostedIdentityMapping(mappingFixture({ status: 'revoked' }));
  let traps = 0;
  const proxied = new Proxy(mapping, {
    get() { traps += 1; throw new Error('mapping must not be read'); },
    getPrototypeOf() { traps += 1; throw new Error('mapping must not be inspected'); },
    ownKeys() { traps += 1; throw new Error('mapping must not be enumerated'); },
  });

  for (const candidate of [
    { ...mapping }, Object.assign(Object.create(mapping), {}),
    JSON.parse(JSON.stringify(mapping)), structuredClone(mapping), Object.freeze({ ...mapping }),
    proxied, retired, revoked,
  ]) {
    assert.throws(() => domain.createMeetingReadiness(candidate, readinessFixture()), genericError);
  }
  assert.equal(traps, 0);
});

test('accepted readiness is detached recursively frozen and remains non-authorizing after input mutation', async () => {
  const domain = await loadDomain('detached-frozen');
  const mappingInput = mappingFixture();
  const mapping = domain.createReviewedHostedIdentityMapping(mappingInput);
  const input = readinessFixture();
  const accepted = domain.createMeetingReadiness(mapping, input);

  input.purposeSummary = 'Mutated caller summary';
  input.materialRefs[0] = 'id_9999999999999999';
  input.materialRefs.push('id_aaaaaaaaaaaaaaaa');
  mappingInput.profileName = 'mutated-caller';

  assert.equal(accepted.purpose.summary, 'Review bounded synthetic planning materials');
  assert.deepEqual(accepted.materials, [IDS.materialA, IDS.materialB]);
  assert.equal(accepted.participants[0].profileName, 'spiders');
  assertRecursivelyFrozen(accepted);
  assert.deepEqual(Object.keys(accepted).sort(), [
    'lifecycle', 'materials', 'outcome', 'participants', 'purpose', 'schemaVersion', 'tenantId',
  ]);
  for (const forbidden of [
    'skills', 'permissions', 'actionAuthorities', 'attendance', 'decisionAuthority',
    'invitation', 'accepted', 'occupancy', 'movement', 'currentWork', 'provider', 'credentials',
  ]) {
    assert.equal(forbidden in accepted, false);
    assert.equal(forbidden in accepted.participants[0], false);
  }
});

test('readiness rejects mutation-racing root and material snapshots', async () => {
  const domain = await loadDomain('mutation-races');
  const mapping = domain.createReviewedHostedIdentityMapping(mappingFixture());
  const rootTarget = readinessFixture();
  let rootReads = 0;
  const racingRoot = new Proxy(rootTarget, {
    getOwnPropertyDescriptor(target, key) {
      if (key === 'purposeSummary') {
        rootReads += 1;
        return {
          value: rootReads % 2 === 1 ? 'First snapshot' : 'Second snapshot',
          enumerable: true, configurable: true, writable: true,
        };
      }
      return Reflect.getOwnPropertyDescriptor(target, key);
    },
  });
  const materialTarget = [IDS.materialA];
  let materialReads = 0;
  const racingMaterials = new Proxy(materialTarget, {
    getOwnPropertyDescriptor(target, key) {
      if (key === '0') {
        materialReads += 1;
        return {
          value: materialReads % 2 === 1 ? IDS.materialA : IDS.materialB,
          enumerable: true, configurable: true, writable: true,
        };
      }
      return Reflect.getOwnPropertyDescriptor(target, key);
    },
  });

  assert.throws(() => domain.createMeetingReadiness(mapping, racingRoot), genericError);
  assert.throws(
    () => domain.createMeetingReadiness(mapping, readinessFixture({ materialRefs: racingMaterials })),
    genericError,
  );
});

test('meeting readiness stays dormant with one reviewed-identity dependency and no runtime importer', async () => {
  const source = await readFile(readinessUrl, 'utf8');
  const ast = ts.createSourceFile(
    'meetingReadiness.ts', source, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS,
  );
  const imports = ast.statements
    .filter((statement) => ts.isImportDeclaration(statement))
    .map((statement) => statement.moduleSpecifier.text.replace('\\u0050', 'P'));
  assert.deepEqual(imports, ['./hostedAgentPresence']);
  assert.equal(/\b(fetch|WebSocket|EventSource|setTimeout|setInterval)\s*\(/.test(source), false);
  assert.equal(/\b(process(?:\.env)?|localStorage|sessionStorage|indexedDB|supabase|sqlite)\b/i.test(source), false);
  assert.equal(/Math\.random|Date\.now|JSON\.parse|innerHTML|eval\s*\(|Function\s*\(/.test(source), false);
  assert.equal(/main\.ts|public\/|client\/|server\/|api\/|provider|storage|network|hermes/i.test(source), false);

  const sourceRoot = new URL('../src/', import.meta.url);
  const entries = await readdir(sourceRoot, { recursive: true });
  for (const entry of entries.filter((name) => /\.(?:ts|js)$/.test(name))) {
    if (entry === 'domain/meetingReadiness.ts') continue;
    const content = await readFile(new URL(entry, sourceRoot), 'utf8');
    assert.equal(content.includes('meetingReadiness'), false, `unexpected runtime importer: ${entry}`);
  }
});
