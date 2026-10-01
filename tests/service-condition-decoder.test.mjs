import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const decoderUrl = new URL('../src/domain/serviceConditionDecoder.ts', import.meta.url);
const serviceConditionUrl = new URL('../src/domain/serviceCondition.ts', import.meta.url);

async function loadDecoder() {
  let decoderSource;
  try {
    decoderSource = await readFile(decoderUrl, 'utf8');
  } catch (error) {
    if (error?.code === 'ENOENT') return {};
    throw error;
  }
  const serviceSource = await readFile(serviceConditionUrl, 'utf8');
  const transpile = (source) => ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const serviceDataUrl = `data:text/javascript;base64,${Buffer.from(transpile(serviceSource)).toString('base64')}`;
  const decoderOutput = transpile(decoderSource).replace(
    /(['"])\.\/serviceCondition\.ts\1/,
    JSON.stringify(serviceDataUrl),
  );
  return import(`data:text/javascript;base64,${Buffer.from(decoderOutput).toString('base64')}`);
}

const smallestWorkingObservation = Object.freeze({
  tenantId: 'id_1111111111111111',
  serviceId: 'id_2222222222222222',
  sourceObservationId: 'id_3333333333333333',
  observedAt: '2026-09-30T12:00:00.000Z',
  evaluatedAt: '2026-09-30T12:00:30.000Z',
  sourceAvailability: 'available',
  lifecycle: 'active',
  required: true,
  configured: true,
  healthEvidence: 'affirmative',
  blockReason: null,
});

function encode(value) {
  return new TextEncoder().encode(JSON.stringify(value));
}

function encodeText(value) {
  return new TextEncoder().encode(value);
}

function assertFailure(result) {
  assert.deepEqual({ ...result }, {
    ok: false,
    error: 'invalid_service_condition_observation',
  });
}

test('exact Uint8Array carrying one valid observation delegates successfully', async () => {
  const decoder = await loadDecoder();
  assert.equal(typeof decoder.decodeServiceConditionObservation, 'function');

  const result = decoder.decodeServiceConditionObservation(encode(smallestWorkingObservation));

  assert.deepEqual({ ...result, condition: { ...result.condition } }, {
    ok: true,
    condition: {
      tenantId: 'id_1111111111111111',
      serviceId: 'id_2222222222222222',
      sourceObservationId: 'id_3333333333333333',
      classification: 'working',
      freshness: 'live',
      observedAt: '2026-09-30T12:00:00.000Z',
      evaluatedAt: '2026-09-30T12:00:30.000Z',
      reasonCode: 'source_healthy',
    },
  });
});

test('closed document rejects unknown and duplicate decoded keys', async () => {
  const { decodeServiceConditionObservation: decode } = await loadDecoder();
  const json = JSON.stringify(smallestWorkingObservation);
  assertFailure(decode(encode({ ...smallestWorkingObservation, unknown: true })));
  assertFailure(decode(encodeText(json.replace(
    '{',
    '{"tenantId":"id_1111111111111111",',
  ))));
  assertFailure(decode(encodeText(json.replace(
    '"tenantId"',
    '"tenantId":"id_1111111111111111","tenant\\u0049d"',
  ))));
});

test('carrier is exact bounded copied UTF-8 without caller hooks or unsafe backing', async () => {
  const { decodeServiceConditionObservation: decode } = await loadDecoder();
  const valid = encode(smallestWorkingObservation);
  class DerivedBytes extends Uint8Array {}
  let proxyHooks = 0;
  const proxy = new Proxy(valid, {
    getPrototypeOf(target) {
      proxyHooks += 1;
      return Reflect.getPrototypeOf(target);
    },
  });
  const offset = new Uint8Array(valid.length + 1);
  offset.set(valid, 1);
  const shared = new Uint8Array(new SharedArrayBuffer(valid.length));
  shared.set(valid);
  const detached = new Uint8Array(8);
  structuredClone(detached.buffer, { transfer: [detached.buffer] });
  for (const input of [
    Buffer.from(valid), new DerivedBytes(valid), proxy, offset.subarray(1), shared, detached,
    new Uint8Array(), new Uint8Array(16_385),
    Uint8Array.from([0xef, 0xbb, 0xbf, ...valid]), Uint8Array.from([0xc3, 0x28]),
  ]) assertFailure(decode(input));
  assert.equal(proxyHooks, 0);

  const originalDecode = TextDecoder.prototype.decode;
  const racing = valid.slice();
  TextDecoder.prototype.decode = function decodeAndMutate(bytes, options) {
    racing.fill(0);
    return Reflect.apply(originalDecode, this, [bytes, options]);
  };
  try {
    assert.equal(decode(racing).ok, true);
  } finally {
    TextDecoder.prototype.decode = originalDecode;
  }
});

test('grammar is bounded canonical scalar JSON with no trailing content', async () => {
  const { decodeServiceConditionObservation: decode } = await loadDecoder();
  const json = JSON.stringify(smallestWorkingObservation);
  for (const document of [
    `${json} null`, `/*comment*/${json}`, json.replace('null', '0'),
    json.replace('null', '{}'), json.replace('null', '[]'),
    json.replace('"tenantId"', `"${'x'.repeat(33)}"`),
    json.replace('id_1111111111111111', `id_${'1'.repeat(129)}`),
    json.replace('id_1111111111111111', 'id_\\u0031' + '1'.repeat(15)),
  ]) assertFailure(decode(encodeText(document)));
});

test('all seven classifications come from the accepted domain without decoder drift', async () => {
  const { decodeServiceConditionObservation: decode } = await loadDecoder();
  const cases = [
    [{}, 'working'],
    [{ sourceAvailability: 'degraded', healthEvidence: 'impaired' }, 'degraded'],
    [{ healthEvidence: 'none', blockReason: 'dependency_missing' }, 'blocked'],
    [{ sourceAvailability: 'unavailable', healthEvidence: 'failure' }, 'broken'],
    [{ configured: false, healthEvidence: 'none' }, 'not_configured'],
    [{ required: false, configured: false, healthEvidence: 'none' }, 'optional'],
    [{ lifecycle: 'retired', required: false, configured: false,
      healthEvidence: 'none' }, 'retired'],
  ];
  assert.deepEqual(cases.map(([overrides]) => decode(encode({
    ...smallestWorkingObservation,
    ...overrides,
  })).condition.classification), cases.map(([, classification]) => classification));
});

test('parser uses captured string intrinsics after module load', async () => {
  const { decodeServiceConditionObservation: decode } = await loadDecoder();
  const valid = encode(smallestWorkingObservation);
  const invalid = encode({ ...smallestWorkingObservation, required: 0 });
  const originalCharCodeAt = String.prototype.charCodeAt;
  const originalStartsWith = String.prototype.startsWith;
  let charCodeAtCalls = 0;
  let startsWithCalls = 0;
  let charCodeAtResult;
  let startsWithResult;
  let invalidResult;

  String.prototype.charCodeAt = function replacedCharCodeAt() {
    charCodeAtCalls += 1;
    throw new Error('attacker charCodeAt hook');
  };
  try {
    charCodeAtResult = decode(valid);
  } finally {
    String.prototype.charCodeAt = originalCharCodeAt;
  }

  String.prototype.startsWith = function replacedStartsWith() {
    startsWithCalls += 1;
    throw new Error('attacker startsWith hook');
  };
  try {
    startsWithResult = decode(valid);
    invalidResult = decode(invalid);
  } finally {
    String.prototype.startsWith = originalStartsWith;
  }

  assert.deepEqual({ charCodeAtCalls, startsWithCalls }, {
    charCodeAtCalls: 0,
    startsWithCalls: 0,
  });
  assert.equal(charCodeAtResult.ok, true);
  assert.equal(startsWithResult.ok, true);
  assertFailure(invalidResult);
});

test('parser does not execute replaced Array iterator for scalar-token dispatch', async () => {
  const { decodeServiceConditionObservation: decode } = await loadDecoder();
  const valid = encode(smallestWorkingObservation);
  const invalidScalar = encodeText(JSON.stringify(smallestWorkingObservation).replace(
    '"required":true',
    '"required":truX',
  ));
  const originalIterator = Array.prototype[Symbol.iterator];
  let iteratorCalls = 0;
  let validResult;
  let invalidResult;
  Array.prototype[Symbol.iterator] = function replacedIterator() {
    iteratorCalls += 1;
    throw new Error('attacker Array iterator hook');
  };
  try {
    validResult = decode(valid);
    invalidResult = decode(invalidScalar);
  } finally {
    Array.prototype[Symbol.iterator] = originalIterator;
  }

  assert.equal(iteratorCalls, 0);
  assert.equal(validResult.ok, true);
  assertFailure(invalidResult);
});

test('every failure is fresh generic data and executes no replaced parser hook', async () => {
  const { decodeServiceConditionObservation: decode } = await loadDecoder();
  const privateDocument = encode({
    ...smallestWorkingObservation,
    tenantId: 'private-tenant-secret',
  });
  const first = decode(privateDocument);
  const second = decode(privateDocument);
  assertFailure(first);
  assertFailure(second);
  assert.notEqual(first, second);
  assert.doesNotMatch(JSON.stringify(first), /private|tenant|secret|position|reason/i);

  const originalHas = Set.prototype.has;
  let hookCalls = 0;
  Set.prototype.has = function replacedHas() {
    hookCalls += 1;
    throw new Error('private parser detail');
  };
  try {
    assert.equal(decode(encode(smallestWorkingObservation)).ok, true);
  } finally {
    Set.prototype.has = originalHas;
  }
  assert.equal(hookCalls, 0);

  const originalCreate = Object.create;
  Object.create = function replacedCreate() {
    hookCalls += 1;
    throw new Error('private construction detail');
  };
  try {
    assertFailure(decode(Uint8Array.from([0xff])));
  } finally {
    Object.create = originalCreate;
  }
  assert.equal(hookCalls, 0);
});

test('success and failure are detached recursively frozen null-prototype minimal data', async () => {
  const { decodeServiceConditionObservation: decode } = await loadDecoder();
  const input = encode(smallestWorkingObservation);
  const success = decode(input);
  const rejected = decode(Uint8Array.from([0xff]));
  for (const result of [success, rejected]) {
    assert.equal(Object.getPrototypeOf(result), null);
    assert.equal(Object.isFrozen(result), true);
  }
  assert.deepEqual(Reflect.ownKeys(success), ['ok', 'condition']);
  assert.equal(Object.getPrototypeOf(success.condition), null);
  assert.equal(Object.isFrozen(success.condition), true);
  assert.deepEqual(Reflect.ownKeys(rejected), ['ok', 'error']);
  input.fill(0);
  assert.equal(success.condition.tenantId, smallestWorkingObservation.tenantId);
  assert.equal(success.condition.classification, 'working');
  for (const forbidden of [
    'membership', 'authority', 'role', 'skill', 'permission', 'providerAccess',
    'spending', 'externalCommunication', 'protectedRelease', 'publication', 'decisionAuthority',
  ]) assert.equal(Object.hasOwn(success, forbidden), false);
});

test('decoder remains a dormant side-effect-free domain boundary', async () => {
  const [source, main] = await Promise.all([
    readFile(decoderUrl, 'utf8'),
    readFile(new URL('../src/main.ts', import.meta.url), 'utf8'),
  ]);
  assert.deepEqual(
    [...source.matchAll(/\bfrom\s+['"]([^'"]+)['"]/gs)].map((match) => match[1]),
    ['node:util', './serviceCondition.ts'],
  );
  assert.doesNotMatch(source, /\b(fetch|XMLHttpRequest|WebSocket|setTimeout|setInterval|Date\.now|process|localStorage|sessionStorage|document|window|navigator|indexedDB)\b/);
  assert.doesNotMatch(source, /\b(route|server|provider|database|filesystem|renderer|animation|occupancy|hermes|sqlite)\b/i);
  assert.doesNotMatch(main, /serviceConditionDecoder|decodeServiceConditionObservation/);
});
