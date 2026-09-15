import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const MODULE_URL = new URL("../src/navigation/privateTenantNavigationDecision.ts", import.meta.url);
let loadSequence = 0;
async function loadDecision() {
  const source = await readFile(MODULE_URL, "utf8").catch((error) => {
    if (error?.code === "ENOENT") return "";
    throw error;
  });
  const javascript = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 }
  }).outputText;
  loadSequence += 1;
  return import(`data:text/javascript;base64,${Buffer.from(javascript).toString("base64")}#decision-${loadSequence}`);
}

const id = (value) => `id_${value.repeat(16)}`;
const BASE_EXPECTATION = {
  schemaVersion: "1.0", channel: "door", buildingId: id("1"), floorId: id("2"),
  elevatorStopId: id("3"), destinationId: id("4")
};
const BASE_AUTHORITY = {
  subjectId: id("5"), tenantId: id("6"), authorizationReference: id("7"),
  policyRevision: 7, active: true
};
const BASE_DECISION = {
  schemaVersion: "1.0", allowed: true, code: "allowed", ...BASE_EXPECTATION,
  destinationKind: "suite", accessState: "public", subjectId: BASE_AUTHORITY.subjectId,
  tenantId: null, authorizationReference: BASE_AUTHORITY.authorizationReference,
  policyRevision: 7, evaluatedAt: "2000-01-01T00:30:00.000Z", validUntil: null
};
const TRUSTED_MS = Date.parse(BASE_DECISION.evaluatedAt);
const responseFor = (decision = BASE_DECISION, bodyTransform = (value) => value) => {
  const bodyText = bodyTransform(JSON.stringify({ decision }));
  return { status: 200, contentType: "application/json; charset=utf-8", contentLength: Buffer.byteLength(bodyText), bodyText };
};
const copy = (value) => structuredClone(value);
const nullRecord = (value) => Object.assign(Object.create(null), value);
async function createDecoder(expectation = copy(BASE_EXPECTATION), authority = copy(BASE_AUTHORITY)) {
  const { createPrivateTenantNavigationDecisionDecoder: create } = await loadDecision();
  return create(expectation, authority);
}
const exactUnavailable = (value) => {
  assert.deepEqual(Object.keys(value), ["status"]);
  assert.equal(value.status, "unavailable");
  assert.equal(Object.getPrototypeOf(value), null);
  assert.equal(Object.isFrozen(value), true);
};
const exactAvailable = (value, accessState) => {
  assert.deepEqual(Object.keys(value), ["status", "accessState"]);
  assert.equal(value.status, "available");
  assert.equal(value.accessState, accessState);
  assert.equal(Object.getPrototypeOf(value), null);
  assert.equal(Object.isFrozen(value), true);
};

test("C001 export is exactly createPrivateTenantNavigationDecisionDecoder", async () => {
  const module = await loadDecision();
  assert.deepEqual(Object.keys(module), ["createPrivateTenantNavigationDecisionDecoder"]);
});

test("C002 valid construction returns fresh exact decoder topology", async () => {
  const { createPrivateTenantNavigationDecisionDecoder: create } = await loadDecision();
  const first = create({}, {});
  const second = create({}, {});
  assert.deepEqual(Object.keys(first), ["decode"]);
  assert.equal(typeof first.decode, "function");
  assert.notEqual(first, second);
  assert.notEqual(first.decode, second.decode);
});

test("C003 decoder topology is null prototype and recursively frozen", async () => {
  const { createPrivateTenantNavigationDecisionDecoder: create } = await loadDecision();
  const decoder = create({}, {});
  assert.equal(Object.getPrototypeOf(decoder), null);
  assert.equal(Object.isFrozen(decoder), true);
  assert.equal(Object.isFrozen(decoder.decode), true);
});

test("C004 decode returns fresh exact generic unavailable record", async () => {
  const { createPrivateTenantNavigationDecisionDecoder: create } = await loadDecision();
  const decode = create({}, {}).decode;
  const first = decode({}, 0);
  const second = decode({}, 0);
  assert.deepEqual({ ...first }, { status: "unavailable" });
  assert.deepEqual(Object.keys(first), ["status"]);
  assert.equal(Object.getPrototypeOf(first), null);
  assert.equal(Object.isFrozen(first), true);
  assert.notEqual(first, second);
});

test("C005 canonical public door decision succeeds end to end", async () => {
  const decoder = await createDecoder();
  exactAvailable(decoder.decode(responseFor(), TRUSTED_MS), "public");
});

test("C006 null prototype caller records are valid", async () => {
  const decoder = await createDecoder(nullRecord(BASE_EXPECTATION), nullRecord(BASE_AUTHORITY));
  exactAvailable(decoder.decode(nullRecord(responseFor()), TRUSTED_MS), "public");
});

test("C007 independent valid NavigationId values satisfy the closed grammar", async () => {
  for (const buildingId of [id("a"), `id_${"b".repeat(64)}`]) {
    const decoder = await createDecoder({ ...BASE_EXPECTATION, buildingId });
    exactAvailable(decoder.decode(responseFor({ ...BASE_DECISION, buildingId }), TRUSTED_MS), "public");
  }
});

test("C008 policy revision endpoints are valid", async () => {
  for (const policyRevision of [1, 2147483647]) {
    const decoder = await createDecoder(copy(BASE_EXPECTATION), { ...BASE_AUTHORITY, policyRevision });
    exactAvailable(decoder.decode(responseFor({ ...BASE_DECISION, policyRevision }), TRUSTED_MS), "public");
  }
});

test("C009 trusted time lower success endpoint is available", async () => {
  const decoder = await createDecoder();
  exactAvailable(decoder.decode(responseFor({ ...BASE_DECISION, evaluatedAt: "1970-01-01T00:00:00.000Z" }), 0), "public");
});

test("C010 harmless JSON whitespace is admitted", async () => {
  const decoder = await createDecoder();
  exactAvailable(decoder.decode(responseFor(BASE_DECISION, (body) => ` \n${body.replace(":{", ": { ")}\n`), TRUSTED_MS), "public");
});

test("C011 equivalent ASCII JSON string escapes are admitted", async () => {
  const decoder = await createDecoder();
  exactAvailable(decoder.decode(responseFor(BASE_DECISION, (body) => body.replace('"allowed"', '"\\u0061llowed"')), TRUSTED_MS), "public");
});

test("C012 bounded maximum JSON frame is admitted", async () => {
  const decoder = await createDecoder();
  exactAvailable(decoder.decode(responseFor(BASE_DECISION, (body) => body + " ".repeat(2048 - Buffer.byteLength(body))), TRUSTED_MS), "public");
});

test("C013 exact wrapper and decision parse variants are admitted", async () => {
  const decoder = await createDecoder();
  exactAvailable(decoder.decode(responseFor(BASE_DECISION, (body) => body.replace('"decision"', '"\\u0064ecision"')), TRUSTED_MS), "public");
});

test("C014 evaluated time accepts the exact 5000 millisecond lower window boundary", async () => {
  const decoder = await createDecoder();
  exactAvailable(decoder.decode(responseFor({ ...BASE_DECISION, evaluatedAt: "2000-01-01T00:29:55.000Z" }), TRUSTED_MS), "public");
});

test("C015 shared space destination kind preserves display meaning", async () => {
  const decoder = await createDecoder();
  exactAvailable(decoder.decode(responseFor({ ...BASE_DECISION, destinationKind: "shared_space" }), TRUSTED_MS), "public");
});

test("C016 tenant state requires exact tenant and null validity", async () => {
  const decoder = await createDecoder();
  const decision = { ...BASE_DECISION, accessState: "tenant", tenantId: BASE_AUTHORITY.tenantId };
  exactAvailable(decoder.decode(responseFor(decision), TRUSTED_MS), "tenant");
});

test("C017 invited state requires exact tenant and future expiry", async () => {
  const decoder = await createDecoder();
  const decision = { ...BASE_DECISION, accessState: "invited", tenantId: BASE_AUTHORITY.tenantId, validUntil: "2000-01-01T00:30:01.000Z" };
  exactAvailable(decoder.decode(responseFor(decision), TRUSTED_MS), "invited");
});

test("C018 private state requires exact tenant and null validity", async () => {
  const decoder = await createDecoder();
  const decision = { ...BASE_DECISION, accessState: "private", tenantId: BASE_AUTHORITY.tenantId };
  exactAvailable(decoder.decode(responseFor(decision), TRUSTED_MS), "private");
});

test("C019 restricted state requires exact tenant and null validity", async () => {
  const decoder = await createDecoder();
  const decision = { ...BASE_DECISION, accessState: "restricted", tenantId: BASE_AUTHORITY.tenantId };
  exactAvailable(decoder.decode(responseFor(decision), TRUSTED_MS), "restricted");
});

test("C020 elevator direct and alternative channels preserve echo parity", async () => {
  for (const channel of ["elevator", "direct", "alternative"]) {
    const expectation = { ...BASE_EXPECTATION, channel };
    const decoder = await createDecoder(expectation);
    exactAvailable(decoder.decode(responseFor({ ...BASE_DECISION, channel }), TRUSTED_MS), "public");
  }
});

test("C021 captured reflection intrinsics resist replacement", async () => {
  const { createPrivateTenantNavigationDecisionDecoder: create } = await loadDecision();
  const originals = [Reflect.ownKeys, Object.keys, Object.getPrototypeOf, Object.getOwnPropertyDescriptor, Object.is];
  try {
    Reflect.ownKeys = Object.keys = Object.getPrototypeOf = Object.getOwnPropertyDescriptor = Object.is = () => { throw new Error("hostile reflection"); };
    const result = create(copy(BASE_EXPECTATION), copy(BASE_AUTHORITY)).decode(responseFor(), TRUSTED_MS);
    assert.equal(result.status, "available");
  } finally {
    [Reflect.ownKeys, Object.keys, Object.getPrototypeOf, Object.getOwnPropertyDescriptor, Object.is] = originals;
  }
  const originalIsArray = Array.isArray;
  let unavailableResult;
  try {
    Array.isArray = () => { throw new Error("hostile Array.isArray"); };
    unavailableResult = create(copy(BASE_EXPECTATION), copy(BASE_AUTHORITY)).decode();
  } finally {
    Array.isArray = originalIsArray;
  }
  exactUnavailable(unavailableResult);
  const originalCreate = Object.create;
  try {
    Object.create = () => { throw new Error("hostile Object.create"); };
    unavailableResult = create(copy(BASE_EXPECTATION), copy(BASE_AUTHORITY)).decode();
  } finally {
    Object.create = originalCreate;
  }
  exactUnavailable(unavailableResult);
});

test("C022 captured structured clone resists replacement", async () => {
  const expectation = copy(BASE_EXPECTATION);
  const authority = copy(BASE_AUTHORITY);
  const response = responseFor();
  const { createPrivateTenantNavigationDecisionDecoder: create } = await loadDecision();
  const original = globalThis.structuredClone;
  try {
    globalThis.structuredClone = () => { throw new Error("hostile clone"); };
    assert.equal(create(expectation, authority).decode(response, TRUSTED_MS).status, "available");
  } finally {
    globalThis.structuredClone = original;
  }
});

test("C023 captured number intrinsics resist replacement", async () => {
  const expectation = copy(BASE_EXPECTATION);
  const authority = copy(BASE_AUTHORITY);
  const response = responseFor();
  const { createPrivateTenantNavigationDecisionDecoder: create } = await loadDecision();
  const originals = [Number.isFinite, Number.isSafeInteger];
  try {
    Number.isFinite = Number.isSafeInteger = () => false;
    assert.equal(create(expectation, authority).decode(response, TRUSTED_MS).status, "available");
  } finally {
    [Number.isFinite, Number.isSafeInteger] = originals;
  }
  const OriginalNumber = globalThis.Number;
  let unavailableResult;
  try {
    globalThis.Number = () => { throw new Error("hostile Number"); };
    unavailableResult = create(copy(BASE_EXPECTATION), copy(BASE_AUTHORITY)).decode();
  } finally {
    globalThis.Number = OriginalNumber;
  }
  exactUnavailable(unavailableResult);
});

test("C024 captured regexp intrinsic resists replacement", async () => {
  const expectation = copy(BASE_EXPECTATION);
  const authority = copy(BASE_AUTHORITY);
  const response = responseFor();
  const { createPrivateTenantNavigationDecisionDecoder: create } = await loadDecision();
  const original = RegExp.prototype.test;
  let result;
  try {
    RegExp.prototype.test = () => false;
    result = create(expectation, authority).decode(response, TRUSTED_MS);
  } finally {
    RegExp.prototype.test = original;
  }
  assert.equal(result.status, "available");
});

test("C025 captured text encoding intrinsic resists replacement", async () => {
  const expectation = copy(BASE_EXPECTATION);
  const authority = copy(BASE_AUTHORITY);
  const response = responseFor();
  const { createPrivateTenantNavigationDecisionDecoder: create } = await loadDecision();
  const OriginalTextEncoder = globalThis.TextEncoder;
  const originalEncode = OriginalTextEncoder.prototype.encode;
  let result;
  try {
    globalThis.TextEncoder = class { constructor() { throw new Error("hostile encoder"); } };
    OriginalTextEncoder.prototype.encode = () => { throw new Error("hostile encode"); };
    result = create(expectation, authority).decode(response, TRUSTED_MS);
  } finally {
    globalThis.TextEncoder = OriginalTextEncoder;
    OriginalTextEncoder.prototype.encode = originalEncode;
  }
  assert.equal(result.status, "available");
});

test("C026 captured JSON parse intrinsic resists replacement", async () => {
  const expectation = copy(BASE_EXPECTATION);
  const authority = copy(BASE_AUTHORITY);
  const response = responseFor();
  const { createPrivateTenantNavigationDecisionDecoder: create } = await loadDecision();
  const original = JSON.parse;
  let result;
  try {
    JSON.parse = () => { throw new Error("hostile parse"); };
    result = create(expectation, authority).decode(response, TRUSTED_MS);
  } finally {
    JSON.parse = original;
  }
  assert.equal(result.status, "available");
});

test("C027 captured date intrinsics resist replacement", async () => {
  const expectation = copy(BASE_EXPECTATION);
  const authority = copy(BASE_AUTHORITY);
  const response = responseFor();
  const { createPrivateTenantNavigationDecisionDecoder: create } = await loadDecision();
  const originals = [Date.parse, Date.prototype.toISOString];
  let result;
  try {
    Date.parse = () => NaN;
    Date.prototype.toISOString = () => { throw new Error("hostile date"); };
    result = create(expectation, authority).decode(response, TRUSTED_MS);
  } finally {
    [Date.parse, Date.prototype.toISOString] = originals;
  }
  assert.equal(result.status, "available");
});

test("C028 captured freeze intrinsic resists replacement", async () => {
  const expectation = copy(BASE_EXPECTATION);
  const authority = copy(BASE_AUTHORITY);
  const response = responseFor();
  const { createPrivateTenantNavigationDecisionDecoder: create } = await loadDecision();
  const original = Object.freeze;
  let decoder;
  let result;
  try {
    Object.freeze = () => { throw new Error("hostile freeze"); };
    decoder = create(expectation, authority);
    result = decoder.decode(response, TRUSTED_MS);
  } finally {
    Object.freeze = original;
  }
  exactAvailable(result, "public");
  assert.equal(Object.isFrozen(decoder), true);
  assert.equal(Object.isFrozen(decoder.decode), true);
});

const customPrototype = () => Object.create({ custom: true });
const throwingProxy = () => new Proxy({}, {
  getPrototypeOf() { throw new Error("hostile prototype trap"); },
  ownKeys() { throw new Error("hostile ownKeys trap"); },
  getOwnPropertyDescriptor() { throw new Error("hostile descriptor trap"); },
  get() { throw new Error("hostile get trap"); }
});
async function createWithCloneMutation(target, mutate) {
  const originalClone = globalThis.structuredClone;
  let create;
  try {
    globalThis.structuredClone = (value) => {
      const cloned = originalClone(value);
      if (value === target) mutate(value);
      return cloned;
    };
    ({ createPrivateTenantNavigationDecisionDecoder: create } = await loadDecision());
  } finally {
    globalThis.structuredClone = originalClone;
  }
  return create;
}
function observedArguments() {
  let observations = 0;
  const trap = () => { observations += 1; throw new Error("decode argument observed"); };
  return {
    response: new Proxy({}, { get: trap, getPrototypeOf: trap, ownKeys: trap, getOwnPropertyDescriptor: trap }),
    trusted: new Proxy({}, { get: trap, getPrototypeOf: trap }),
    count: () => observations
  };
}
function assertInertConstruction(create, expectation, authority) {
  const observed = observedArguments();
  const decoder = create(expectation, authority);
  const first = decoder.decode(observed.response, observed.trusted);
  const second = decoder.decode(observed.response, observed.trusted);
  exactUnavailable(first);
  exactUnavailable(second);
  assert.notEqual(first, second);
  assert.equal(observed.count(), 0);
}
const framed = (bodyText, changes = {}) => ({
  status: 200, contentType: "application/json; charset=utf-8",
  contentLength: Buffer.byteLength(bodyText), bodyText, ...changes
});

test("V001 malformed expectation envelope stays inert", async () => {
  const { createPrivateTenantNavigationDecisionDecoder: create } = await loadDecision();
  class CustomExpectation {}
  assertInertConstruction(create);
  assertInertConstruction(create, undefined, copy(BASE_AUTHORITY));
  for (const value of [null, false, true, "x", 1, 1n, Symbol("expectation"), () => {}, [],
    new Number(1), new String("x"), new CustomExpectation(), customPrototype(), throwingProxy()]) {
    assertInertConstruction(create, value, copy(BASE_AUTHORITY));
  }
});

test("V002 malformed expectation shape and stability stay inert", async () => {
  for (const key of Object.keys(BASE_EXPECTATION)) {
    const value = copy(BASE_EXPECTATION);
    delete value[key];
    exactUnavailable((await createDecoder(value)).decode(responseFor(), TRUSTED_MS));
  }
  for (const mutate of [
    (value) => { value.extra = true; },
    (value) => { value[Symbol("extra")] = true; },
    (value) => { Object.defineProperty(value, "extra", { value: true }); },
    (value) => { Object.defineProperty(value, "channel", { enumerable: true, get() { throw new Error("accessor invoked"); } }); },
    (value) => { const schemaVersion = value.schemaVersion; delete value.schemaVersion; value.schemaVersion = schemaVersion; }
  ]) {
    const value = copy(BASE_EXPECTATION);
    mutate(value);
    exactUnavailable((await createDecoder(value)).decode(responseFor(), TRUSTED_MS));
  }
  for (const mutate of [
    (value) => { value.channel = "elevator"; },
    (value) => { value.extra = true; },
    (value) => { Object.defineProperty(value, "channel", { value: value.channel, enumerable: true, configurable: true, writable: false }); },
    (value) => { Object.setPrototypeOf(value, null); }
  ]) {
    const value = copy(BASE_EXPECTATION);
    const create = await createWithCloneMutation(value, mutate);
    exactUnavailable(create(value, copy(BASE_AUTHORITY)).decode(responseFor(), TRUSTED_MS));
  }
  exactUnavailable((await createDecoder(throwingProxy())).decode(responseFor(), TRUSTED_MS));
});

test("V003 malformed expectation scalar values stay inert", async () => {
  const wrongIds = [undefined, null, false, 1, 1n, Symbol("id"), {}, [], () => {}, new String(BASE_EXPECTATION.buildingId),
    "id_", `id_${"a".repeat(15)}`, `id_${"a".repeat(65)}`, `id_${"A".repeat(16)}`, "id_éééééééééééééééé"];
  for (const changes of [{ schemaVersion: "2.0" }, { channel: "air" },
    ...Object.keys(BASE_EXPECTATION).filter((key) => key.endsWith("Id")).flatMap((key) => wrongIds.map((value) => ({ [key]: value })))]) {
    const expectation = { ...BASE_EXPECTATION, ...changes };
    const before = Reflect.ownKeys(expectation).map((key) => [key, Object.getOwnPropertyDescriptor(expectation, key)]);
    exactUnavailable((await createDecoder(expectation)).decode(responseFor(), TRUSTED_MS));
    assert.equal(Object.isFrozen(expectation), false);
    assert.deepEqual(Reflect.ownKeys(expectation).map((key) => [key, Object.getOwnPropertyDescriptor(expectation, key)]), before);
  }
  const { createPrivateTenantNavigationDecisionDecoder: create } = await loadDecision();
  const originalString = globalThis.String;
  let coercions = 0;
  let decoder;
  try {
    globalThis.String = (...values) => { coercions += 1; return originalString(...values); };
    decoder = create({ ...BASE_EXPECTATION, buildingId: new originalString(BASE_EXPECTATION.buildingId) }, copy(BASE_AUTHORITY));
  } finally {
    globalThis.String = originalString;
  }
  const observed = observedArguments();
  exactUnavailable(decoder.decode(observed.response, observed.trusted));
  assert.equal(coercions, 0);
  assert.equal(observed.count(), 0);
});

test("V004 malformed authority envelope stays inert", async () => {
  const { createPrivateTenantNavigationDecisionDecoder: create } = await loadDecision();
  class CustomAuthority {}
  assertInertConstruction(create, copy(BASE_EXPECTATION));
  assertInertConstruction(create, copy(BASE_EXPECTATION), undefined);
  for (const value of [null, false, true, "x", 1, 1n, Symbol("authority"), () => {}, [],
    new Number(1), new String("x"), new CustomAuthority(), customPrototype(), throwingProxy(), { ...BASE_AUTHORITY, active: false }]) {
    assertInertConstruction(create, copy(BASE_EXPECTATION), value);
  }
});

test("V005 malformed authority shape values and stability stay inert", async () => {
  for (const key of Object.keys(BASE_AUTHORITY)) {
    const value = copy(BASE_AUTHORITY);
    delete value[key];
    exactUnavailable((await createDecoder(copy(BASE_EXPECTATION), value)).decode(responseFor(), TRUSTED_MS));
  }
  for (const mutate of [
    (value) => { value.extra = true; },
    (value) => { value[Symbol("extra")] = true; },
    (value) => { Object.defineProperty(value, "extra", { value: true }); },
    (value) => { Object.defineProperty(value, "active", { enumerable: true, get() { throw new Error("accessor invoked"); } }); },
    (value) => { const subjectId = value.subjectId; delete value.subjectId; value.subjectId = subjectId; }
  ]) {
    const value = copy(BASE_AUTHORITY);
    mutate(value);
    exactUnavailable((await createDecoder(copy(BASE_EXPECTATION), value)).decode(responseFor(), TRUSTED_MS));
  }
  const wrongIds = [undefined, null, false, 1, 1n, Symbol("id"), {}, [], () => {}, new String(BASE_AUTHORITY.subjectId),
    "bad", `id_${"a".repeat(15)}`, `id_${"a".repeat(65)}`, `id_${"A".repeat(16)}`, "id_éééééééééééééééé"];
  const changes = [
    ...["subjectId", "tenantId", "authorizationReference"].flatMap((key) => wrongIds.map((value) => ({ [key]: value }))),
    ...[undefined, null, false, "7", 1n, Symbol("revision"), {}, [], () => {}, NaN, Infinity, -Infinity, -0, 0, 0.5, 2147483648, Number.MAX_SAFE_INTEGER + 1]
      .map((policyRevision) => ({ policyRevision })),
    { active: false }, { active: 1 }, { active: "true" }
  ];
  for (const change of changes) {
    const authority = { ...BASE_AUTHORITY, ...change };
    const before = Reflect.ownKeys(authority).map((key) => [key, Object.getOwnPropertyDescriptor(authority, key)]);
    exactUnavailable((await createDecoder(copy(BASE_EXPECTATION), authority)).decode(responseFor(), TRUSTED_MS));
    assert.equal(Object.isFrozen(authority), false);
    assert.deepEqual(Reflect.ownKeys(authority).map((key) => [key, Object.getOwnPropertyDescriptor(authority, key)]), before);
  }
  for (const mutate of [
    (value) => { value.policyRevision = 8; },
    (value) => { value.extra = true; },
    (value) => { Object.defineProperty(value, "active", { value: true, enumerable: true, configurable: true, writable: false }); },
    (value) => { Object.setPrototypeOf(value, null); }
  ]) {
    const authority = copy(BASE_AUTHORITY);
    const create = await createWithCloneMutation(authority, mutate);
    exactUnavailable(create(copy(BASE_EXPECTATION), authority).decode(responseFor(), TRUSTED_MS));
  }
  exactUnavailable((await createDecoder(copy(BASE_EXPECTATION), throwingProxy())).decode(responseFor(), TRUSTED_MS));
});

test("V006 inert decoder never observes response or trusted time", async () => {
  const { createPrivateTenantNavigationDecisionDecoder: create } = await loadDecision();
  class CustomRecord {}
  for (const [expectation, authority] of [
    [undefined, copy(BASE_AUTHORITY)], [null, copy(BASE_AUTHORITY)], [[], copy(BASE_AUTHORITY)],
    [new CustomRecord(), copy(BASE_AUTHORITY)], [throwingProxy(), copy(BASE_AUTHORITY)],
    [{ ...BASE_EXPECTATION, extra: true }, copy(BASE_AUTHORITY)], [{ ...BASE_EXPECTATION, buildingId: "bad" }, copy(BASE_AUTHORITY)],
    [copy(BASE_EXPECTATION), undefined], [copy(BASE_EXPECTATION), null], [copy(BASE_EXPECTATION), []],
    [copy(BASE_EXPECTATION), new CustomRecord()], [copy(BASE_EXPECTATION), throwingProxy()],
    [copy(BASE_EXPECTATION), { ...BASE_AUTHORITY, extra: true }], [copy(BASE_EXPECTATION), { ...BASE_AUTHORITY, active: false }]
  ]) assertInertConstruction(create, expectation, authority);
});

test("V007 malformed response shell stays unavailable", async () => {
  const decoder = await createDecoder();
  class CustomResponse {}
  for (const value of [undefined, null, false, true, "x", 1, 1n, Symbol("response"), () => {}, [],
    new Number(1), new String("x"), new CustomResponse(), customPrototype(), throwingProxy()]) {
    exactUnavailable(decoder.decode(value, TRUSTED_MS));
  }
  for (const key of Object.keys(responseFor())) {
    const value = responseFor();
    delete value[key];
    exactUnavailable(decoder.decode(value, TRUSTED_MS));
  }
  for (const mutate of [
    (value) => { value.extra = true; },
    (value) => { value[Symbol("extra")] = true; },
    (value) => { Object.defineProperty(value, "extra", { value: true }); },
    (value) => { Object.defineProperty(value, "status", { enumerable: true, get() { throw new Error("accessor invoked"); } }); },
    (value) => { const status = value.status; delete value.status; value.status = status; }
  ]) {
    const value = responseFor();
    mutate(value);
    exactUnavailable(decoder.decode(value, TRUSTED_MS));
  }
  for (const changes of [
    { status: 199 }, { status: 201 }, { status: "200" },
    { contentType: "application/json" }, { contentType: "Application/JSON; charset=utf-8" }, { contentType: 1 },
    { contentLength: 1 }, { contentLength: 2049 }, { contentLength: -0 }, { contentLength: 0.5 },
    { contentLength: "2" }, { contentLength: Number.MAX_SAFE_INTEGER + 1 }, { contentLength: responseFor().contentLength + 1 },
    { bodyText: null }, { bodyText: {} }, { bodyText: "" }
  ]) exactUnavailable(decoder.decode({ ...responseFor(), ...changes }, TRUSTED_MS));
  for (const mutate of [
    (value) => { value.status = 500; },
    (value) => { value.extra = true; },
    (value) => { Object.defineProperty(value, "status", { value: 200, enumerable: true, configurable: true, writable: false }); },
    (value) => { Object.setPrototypeOf(value, null); }
  ]) {
    const response = responseFor();
    const create = await createWithCloneMutation(response, mutate);
    exactUnavailable(create(copy(BASE_EXPECTATION), copy(BASE_AUTHORITY)).decode(response, TRUSTED_MS));
  }
});

test("V008 invalid or success-ineligible trusted time classes stay unavailable", async () => {
  const decoder = await createDecoder();
  for (const value of [undefined, null, false, true, "0", 1n, Symbol("time"), () => {}, {}, [],
    NaN, Infinity, -Infinity, -0, -1, 0.5, Number.MAX_SAFE_INTEGER + 1,
    8640000000005001, Number.MAX_SAFE_INTEGER]) {
    const first = decoder.decode(responseFor(), value);
    const second = decoder.decode(responseFor(), value);
    exactUnavailable(first);
    exactUnavailable(second);
    assert.notEqual(first, second);
    assert.equal(JSON.stringify(first), '{"status":"unavailable"}');
  }
});

test("V009 framed JSON parser and traversal bounds fail closed", async () => {
  const originalParse = JSON.parse;
  let parseCalls = 0;
  let create;
  try {
    JSON.parse = (...values) => { parseCalls += 1; return originalParse(...values); };
    ({ createPrivateTenantNavigationDecisionDecoder: create } = await loadDecision());
  } finally {
    JSON.parse = originalParse;
  }
  const decoder = create(copy(BASE_EXPECTATION), copy(BASE_AUTHORITY));
  const decisionText = JSON.stringify(BASE_DECISION);
  const overEntries = JSON.stringify({ decision: { ...BASE_DECISION, extra: true } });
  const traversalSentinel = `{${Array.from({ length: 17 }, (_, index) => `"${String.fromCharCode(97 + index)}":0`).join(",")},"r":${"9".repeat(1900)}}`;
  for (const bodyText of [
    "{", '{"decision":}', '{"decision":01}', '{"decision":-}', '{"decision":1.}', '{"decision":1e}',
    "[]", '{"decision":null} trailing', `{"decision":${decisionText},"decision":${decisionText}}`,
    `{"decision":${decisionText},"\\u0064ecision":${decisionText}}`, '{"decision":{"x":{"y":1}}}',
    '{"decision":{},"extra":{}}', overEntries, traversalSentinel, " ".repeat(2049)
  ]) {
    parseCalls = 0;
    const started = performance.now();
    exactUnavailable(decoder.decode(framed(bodyText), TRUSTED_MS));
    assert.ok(performance.now() - started <= 25, bodyText.slice(0, 80));
    assert.equal(parseCalls, 0, bodyText.slice(0, 80));
  }
  const maximum = responseFor(BASE_DECISION, (body) => body + " ".repeat(2048 - Buffer.byteLength(body)));
  const maxStarted = performance.now();
  exactAvailable(decoder.decode(maximum, TRUSTED_MS), "public");
  assert.ok(performance.now() - maxStarted <= 25);
});

test("V010 parsed wrapper decision schema and values fail closed", async () => {
  const decoder = await createDecoder();
  const wrapperBodies = ["null", "false", "1", '"x"', "[]", "{}", '{"extra":1}', '{"decision":null,"extra":1}'];
  for (const bodyText of wrapperBodies) exactUnavailable(decoder.decode(framed(bodyText), TRUSTED_MS));
  const missing = Object.keys(BASE_DECISION).map((key) => {
    const value = copy(BASE_DECISION);
    delete value[key];
    return value;
  });
  const reordered = (() => {
    const { schemaVersion, ...rest } = BASE_DECISION;
    return { ...rest, schemaVersion };
  })();
  const wrong = [null, false, 1, "x", [], {}, reordered, { ...BASE_DECISION, extra: 1 },
    { ...BASE_DECISION, schemaVersion: "2.0" }, { ...BASE_DECISION, allowed: false }, { ...BASE_DECISION, code: "denied" },
    { ...BASE_DECISION, channel: "air" }, { ...BASE_DECISION, buildingId: id("a") }, { ...BASE_DECISION, floorId: id("a") },
    { ...BASE_DECISION, elevatorStopId: id("a") }, { ...BASE_DECISION, destinationId: id("a") },
    { ...BASE_DECISION, destinationKind: "room" }, { ...BASE_DECISION, accessState: "open" },
    { ...BASE_DECISION, subjectId: id("a") }, { ...BASE_DECISION, tenantId: BASE_AUTHORITY.tenantId },
    { ...BASE_DECISION, authorizationReference: id("a") }, { ...BASE_DECISION, policyRevision: 8 },
    { ...BASE_DECISION, evaluatedAt: "invalid" }, { ...BASE_DECISION, evaluatedAt: "2000-01-01T00:29:54.999Z" },
    { ...BASE_DECISION, evaluatedAt: "2000-01-01T00:30:00.001Z" }, { ...BASE_DECISION, validUntil: BASE_DECISION.evaluatedAt },
    { ...BASE_DECISION, accessState: "tenant", tenantId: null },
    { ...BASE_DECISION, accessState: "private", tenantId: BASE_AUTHORITY.tenantId, validUntil: "2000-01-01T00:30:01.000Z" },
    { ...BASE_DECISION, accessState: "invited", tenantId: BASE_AUTHORITY.tenantId, validUntil: null },
    { ...BASE_DECISION, accessState: "invited", tenantId: BASE_AUTHORITY.tenantId, validUntil: BASE_DECISION.evaluatedAt }
  ];
  for (const decision of [...missing, ...wrong]) exactUnavailable(decoder.decode(responseFor(decision), TRUSTED_MS));
});

test("V011 outputs remain exact generic detached and non enumerating", async () => {
  const decoder = await createDecoder();
  const response = responseFor();
  const successes = [decoder.decode(response, TRUSTED_MS), decoder.decode(response, TRUSTED_MS)];
  const failures = [
    (await createDecoder(null, null)).decode(responseFor(), TRUSTED_MS), decoder.decode(null, TRUSTED_MS),
    decoder.decode(throwingProxy(), TRUSTED_MS),
    decoder.decode(framed("{"), TRUSTED_MS), decoder.decode(responseFor({ ...BASE_DECISION, allowed: false }), TRUSTED_MS),
    decoder.decode(responseFor(), TRUSTED_MS + 5001), (await createDecoder(copy(BASE_EXPECTATION), { ...BASE_AUTHORITY, active: false })).decode()
  ];
  response.status = 500;
  successes.forEach((result) => {
    exactAvailable(result, "public");
    assert.deepEqual(Reflect.ownKeys(result), ["status", "accessState"]);
    for (const forbidden of ["tenant", "subject", "authority", "request", "time", "private", "error", "exception", "reason"]) {
      assert.equal(forbidden in result, false);
    }
  });
  failures.forEach((result) => {
    exactUnavailable(result);
    assert.equal(JSON.stringify(result), '{"status":"unavailable"}');
  });
  assert.notEqual(successes[0], successes[1]);
  assert.equal(successes[0].status, "available");
});

test("V012 import factory and decode remain pure and side effect free", async () => {
  const names = ["fetch", "XMLHttpRequest", "WebSocket", "EventSource", "localStorage", "sessionStorage", "indexedDB", "document",
    "setTimeout", "setInterval", "addEventListener", "AbortController", "provider", "tenantProvider", "privateTenantProvider"];
  void globalThis.fetch;
  Object.getOwnPropertyDescriptors(globalThis);
  const globalKeysBefore = Reflect.ownKeys(globalThis);
  const globalDescriptorsBefore = Object.getOwnPropertyDescriptors(globalThis);
  const before = new Map(names.map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  const consoleBefore = new Map(["log", "info", "warn", "error"].map((name) => [name, Object.getOwnPropertyDescriptor(console, name)]));
  let calls = 0;
  const observed = () => { calls += 1; throw new Error("forbidden side effect"); };
  try {
    for (const name of names) Object.defineProperty(globalThis, name, { value: observed, writable: true, configurable: true });
    for (const name of consoleBefore.keys()) Object.defineProperty(console, name, { value: observed, writable: true, configurable: true });
    const decoder = await createDecoder();
    exactAvailable(decoder.decode(responseFor(), TRUSTED_MS), "public");
  } finally {
    for (const [name, descriptor] of before) descriptor ? Object.defineProperty(globalThis, name, descriptor) : delete globalThis[name];
    for (const [name, descriptor] of consoleBefore) Object.defineProperty(console, name, descriptor);
  }
  assert.equal(calls, 0);
  assert.deepEqual(Reflect.ownKeys(globalThis), globalKeysBefore);
  assert.deepEqual(Object.getOwnPropertyDescriptors(globalThis), globalDescriptorsBefore);
  for (const [name, descriptor] of before) assert.deepEqual(Object.getOwnPropertyDescriptor(globalThis, name), descriptor);
});

test("V013 decoded non ASCII scalars remain rejected by the closed schema", async () => {
  const decoder = await createDecoder();
  const substitutions = [
    ["schemaVersion", "1.é"], ["code", "allowéd"], ["channel", "doör"], ["destinationKind", "suité"], ["accessState", "publíc"],
    ["buildingId", "id_éééééééééééééééé"], ["floorId", "id_éééééééééééééééé"],
    ["elevatorStopId", "id_éééééééééééééééé"], ["destinationId", "id_éééééééééééééééé"],
    ["subjectId", "id_éééééééééééééééé"], ["tenantId", "id_éééééééééééééééé"],
    ["authorizationReference", "id_éééééééééééééééé"],
    ["evaluatedAt", "2000-01-01T00:30:00.00éZ"], ["validUntil", "2000-01-01T00:30:01.00éZ"]
  ];
  for (const [key, scalar] of substitutions) {
    const decision = { ...BASE_DECISION, [key]: scalar };
    if (key === "tenantId") decision.accessState = "tenant";
    if (key === "validUntil") Object.assign(decision, { accessState: "invited", tenantId: BASE_AUTHORITY.tenantId });
    for (const response of [responseFor(decision), responseFor(decision, (body) => body.replaceAll("é", "\\u00e9"))]) {
      exactUnavailable(decoder.decode(response, TRUSTED_MS));
    }
  }
});

test("V014 Unicode framing and content length remain fail closed", async () => {
  const decoder = await createDecoder();
  const canonical = responseFor();
  for (const contentLength of [canonical.contentLength - 1, canonical.contentLength + 1]) {
    exactUnavailable(decoder.decode({ ...canonical, contentLength }, TRUSTED_MS));
  }
  for (const bodyText of ['{"decision":"\\ud800"}', '{"decision":"\\udc00"}', '{"decision":"\\ud800x"}', '{"decision":"\\ud800\\u0061"}']) {
    exactUnavailable(decoder.decode(framed(bodyText), TRUSTED_MS));
  }
  const bodyText = '{"decision":"é"}';
  for (const contentLength of [Buffer.byteLength(bodyText), bodyText.length]) {
    exactUnavailable(decoder.decode(framed(bodyText, { contentLength }), TRUSTED_MS));
  }
});

test("A001 all released access states and channels preserve exact meaning", async () => {
  for (const accessState of ["public", "tenant", "invited", "private", "restricted"]) {
    for (const channel of ["door", "elevator", "direct", "alternative"]) {
      for (const destinationKind of ["suite", "shared_space"]) {
        const expectation = { ...BASE_EXPECTATION, channel };
        const decision = { ...BASE_DECISION, channel, destinationKind, accessState,
          tenantId: accessState === "public" ? null : BASE_AUTHORITY.tenantId,
          validUntil: accessState === "invited" ? "2000-01-01T00:30:01.000Z" : null };
        exactAvailable((await createDecoder(expectation)).decode(responseFor(decision), TRUSTED_MS), accessState);
      }
    }
  }
});

test("A002 all rejection classes converge on one generic failure", async () => {
  const decoder = await createDecoder();
  const rejected = [
    (await createDecoder(null, null)).decode(responseFor(), TRUSTED_MS),
    decoder.decode({ ...responseFor(), status: 500 }, TRUSTED_MS),
    decoder.decode(responseFor({ ...BASE_DECISION, destinationId: id("f") }), TRUSTED_MS),
    decoder.decode(responseFor(), TRUSTED_MS + 5001),
    (await createDecoder(copy(BASE_EXPECTATION), { ...BASE_AUTHORITY, active: false })).decode(responseFor(), TRUSTED_MS)
  ];
  for (const result of rejected) {
    exactUnavailable(result);
    assert.equal(JSON.stringify(result), '{"status":"unavailable"}');
  }
});

test("A003 every observable result satisfies exact identity hardening", async () => {
  const decoder = await createDecoder();
  const successes = [decoder.decode(responseFor(), TRUSTED_MS), decoder.decode(responseFor(), TRUSTED_MS)];
  const failures = [decoder.decode(null, TRUSTED_MS), decoder.decode(null, TRUSTED_MS)];
  successes.forEach((result) => exactAvailable(result, "public"));
  failures.forEach(exactUnavailable);
  assert.notEqual(successes[0], successes[1]);
  assert.notEqual(failures[0], failures[1]);
});

test("A004 maximum bounded fixtures and focused runtime remain within ceilings", async () => {
  const decoder = await createDecoder();
  const maximum = responseFor(BASE_DECISION, (body) => body + " ".repeat(2048 - Buffer.byteLength(body)));
  const over = { ...maximum, contentLength: 2049, bodyText: `${maximum.bodyText} ` };
  const started = performance.now();
  exactAvailable(decoder.decode(maximum, TRUSTED_MS), "public");
  assert.ok(performance.now() - started <= 25);
  const rejectedAt = performance.now();
  exactUnavailable(decoder.decode(over, TRUSTED_MS));
  assert.ok(performance.now() - rejectedAt <= 25);
});

test("A005 trusted time and canonical Date success domains meet at exact endpoints", async () => {
  const decoder = await createDecoder();
  for (const [trusted, evaluatedAt] of [
    [0, "1970-01-01T00:00:00.000Z"],
    [946686600000, "2000-01-01T00:29:55.000Z"],
    [253402300804999, "9999-12-31T23:59:59.999Z"]
  ]) exactAvailable(decoder.decode(responseFor({ ...BASE_DECISION, evaluatedAt }), trusted), "public");
  for (const trusted of [8640000000005001, Number.MAX_SAFE_INTEGER]) exactUnavailable(decoder.decode(responseFor(), trusted));
});
