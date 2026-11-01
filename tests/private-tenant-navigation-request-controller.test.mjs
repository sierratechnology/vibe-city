import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const MODULE_URL = new URL("../src/navigation/privateTenantNavigationRequestController.ts", import.meta.url);
const DECISION_URL = new URL("../src/navigation/privateTenantNavigationDecision.ts", import.meta.url);
let loadSequence = 0;
async function loadController() {
  const [source, decisionSource] = await Promise.all([
    readFile(MODULE_URL, "utf8").catch((error) => error?.code === "ENOENT" ? "" : Promise.reject(error)),
    readFile(DECISION_URL, "utf8")
  ]);
  const options = { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } };
  const decisionJavaScript = ts.transpileModule(decisionSource, options).outputText;
  const decisionDataUrl = `data:text/javascript;base64,${Buffer.from(decisionJavaScript).toString("base64")}`;
  const javascript = ts.transpileModule(source, options).outputText
    .replace('"./privateTenantNavigationDecision"', `"${decisionDataUrl}"`);
  loadSequence += 1;
  return import(`data:text/javascript;base64,${Buffer.from(javascript).toString("base64")}#controller-${loadSequence}`);
}
async function loadDecision() {
  const source = await readFile(DECISION_URL, "utf8");
  const javascript = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 }
  }).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(javascript).toString("base64")}#direct-decision`);
}

const SELECTED_ID = process.env.M7T4B_SELECTED_ID || "";
const REGISTRATION_MANIFEST = process.env.M7T4B_REGISTRATION_MANIFEST === "1";
const PRIMARY_PROBE_ID = process.env.M7T4B_PRIMARY_PROBE_ID || "";
const TOP_LEVEL_REGISTRATIONS = [];
const selectedTest = (id, title, implementation) => {
  TOP_LEVEL_REGISTRATIONS.push(Object.freeze({ id, title, implementation }));
};
const PRIMARY_PROBES = [
  ["C001", "export is exactly one fresh hardened request controller", "factory_topology"],
  ["C002", "canonical door/public asynchronous completion settles through Tracer 4A after owned cleanup", "parity_door_public"],
  ["C003", "synchronous completion is deferred until transport returns and cleanup finishes", "synchronous_completion_deferral"],
  ["C004", "callback then start throw overrides provisional completion", "callback_then_start_throw_override"],
  ["C005", "acquisition and release returns never assimilate hostile thenables", "hostile_thenable_non_assimilation"],
  ["C006", "one pending request makes every concurrent call generically busy without observation", "single_flight_busy"],
  ["C007", "timeout is first terminal and contains late completion", "timeout_terminal"],
  ["C008", "pre-cancel settles before timer or transport acquisition", "pre_cancel_terminal"],
  ["C009", "active cancellation is first terminal and contains late work", "active_cancel_terminal"],
  ["C010", "duplicate completions decode settle and clean exactly once", "duplicate_completion_inert"],
  ["C011", "post-response clock failure is contained", "clock_failure_containment"],
  ["C012", "subscription acquisition throw is contained", "subscribe_throw_containment"],
  ["C013", "initial cancellation check throw is contained", "cancellation_check_throw_containment"],
  ["C014", "timeout acquisition throw is contained", "schedule_throw_containment"],
  ["C015", "transport acquisition throw is contained", "start_throw_containment"],
  ["C016", "transport release throw downgrades and cleanup continues", "cancel_transport_throw_containment"],
  ["C017", "timeout release throw downgrades and cleanup continues", "cancel_timeout_throw_containment"],
  ["C018", "cancellation release throw downgrades without rejection", "unsubscribe_throw_containment"],
  ["C019", "captured intrinsics resist post-import replacement", "captured_intrinsic_resistance"],
  ["C020", "cleanup reentrancy remains busy and reactions see idle", "cleanup_reentrancy_busy"],
  ["C021", "completion before timeout keeps completion", "completion_before_timeout"],
  ["C022", "timeout before completion keeps timeout", "timeout_before_completion"],
  ["C023", "completion before cancellation keeps completion", "completion_before_cancel"],
  ["C024", "cancellation before completion keeps cancellation", "cancel_before_completion"],
  ["C025", "timeout before cancellation keeps timeout", "timeout_before_cancel"],
  ["C026", "cancellation before timeout keeps cancellation", "cancel_before_timeout"],
  ["C027", "door channel preserves tenant access through the complete asynchronous lifecycle", "parity_door_tenant"],
  ["C028", "door channel preserves invited access through the complete asynchronous lifecycle", "parity_door_invited"],
  ["C029", "door channel preserves private access through the complete asynchronous lifecycle", "parity_door_private"],
  ["C030", "door channel preserves restricted access through the complete asynchronous lifecycle", "parity_door_restricted"],
  ["C031", "elevator channel preserves public access through the complete asynchronous lifecycle", "parity_elevator_public"],
  ["C032", "elevator channel preserves tenant access through the complete asynchronous lifecycle", "parity_elevator_tenant"],
  ["C033", "elevator channel preserves invited access through the complete asynchronous lifecycle", "parity_elevator_invited"],
  ["C034", "elevator channel preserves private access through the complete asynchronous lifecycle", "parity_elevator_private"],
  ["C035", "elevator channel preserves restricted access through the complete asynchronous lifecycle", "parity_elevator_restricted"],
  ["C036", "direct channel preserves public access through the complete asynchronous lifecycle", "parity_direct_public"],
  ["C037", "direct channel preserves tenant access through the complete asynchronous lifecycle", "parity_direct_tenant"],
  ["C038", "direct channel preserves invited access through the complete asynchronous lifecycle", "parity_direct_invited"],
  ["C039", "direct channel preserves private access through the complete asynchronous lifecycle", "parity_direct_private"],
  ["C040", "direct channel preserves restricted access through the complete asynchronous lifecycle", "parity_direct_restricted"],
  ["C041", "alternative channel preserves public access through the complete asynchronous lifecycle", "parity_alternative_public"],
  ["C042", "alternative channel preserves tenant access through the complete asynchronous lifecycle", "parity_alternative_tenant"],
  ["C043", "alternative channel preserves invited access through the complete asynchronous lifecycle", "parity_alternative_invited"],
  ["C044", "alternative channel preserves private access through the complete asynchronous lifecycle", "parity_alternative_private"],
  ["C045", "alternative channel preserves restricted access through the complete asynchronous lifecycle", "parity_alternative_restricted"],
  ["C046", "malformed transport wrappers converge through unchanged Tracer 4A delegation", "malformed_wrapper_delegation"]
].map(([id, title, primary]) => Object.freeze({ id, title, primary }));
const exactUnavailable = (value) => {
  assert.deepEqual(Reflect.ownKeys(value), ["status"]);
  assert.equal(value.status, "unavailable");
  assert.equal(Object.getPrototypeOf(value), null);
  assert.equal(Object.isFrozen(value), true);
};
const exactAvailable = (value, accessState) => {
  assert.deepEqual(Reflect.ownKeys(value), ["status", "accessState"]);
  assert.equal(value.status, "available");
  assert.equal(value.accessState, accessState);
  assert.equal(Object.getPrototypeOf(value), null);
  assert.equal(Object.isFrozen(value), true);
};
const id = (value) => `id_${value.repeat(16)}`;
const BASE_EXPECTATION = {
  schemaVersion: "1.0", channel: "door", buildingId: id("1"), floorId: id("2"),
  elevatorStopId: id("3"), destinationId: id("4")
};
const BASE_AUTHORITY = {
  subjectId: id("5"), tenantId: id("6"), authorizationReference: id("7"), policyRevision: 7, active: true
};
const TRUSTED_MS = Date.parse("2000-01-01T00:30:00.000Z");
const decisionFor = (channel = "door", accessState = "public") => ({
  schemaVersion: "1.0", allowed: true, code: "allowed", ...BASE_EXPECTATION, channel,
  destinationKind: "suite", accessState, subjectId: BASE_AUTHORITY.subjectId,
  tenantId: accessState === "public" ? null : BASE_AUTHORITY.tenantId,
  authorizationReference: BASE_AUTHORITY.authorizationReference, policyRevision: 7,
  evaluatedAt: "2000-01-01T00:30:00.000Z",
  validUntil: accessState === "invited" ? "2000-01-01T00:30:01.000Z" : null
});
const responseFor = (channel = "door", accessState = "public") => {
  const bodyText = JSON.stringify({ decision: decisionFor(channel, accessState) });
  return { status: 200, contentType: "application/json; charset=utf-8", contentLength: Buffer.byteLength(bodyText), bodyText };
};
const responseForDecision = (decision) => {
  const bodyText = JSON.stringify({ decision });
  return { status: 200, contentType: "application/json; charset=utf-8", contentLength: Buffer.byteLength(bodyText), bodyText };
};
function createFixture(overrides = {}) {
  const calls = [];
  const owned = { transport: new Set(), timeout: new Set(), cancellation: new Set() };
  const state = { complete: null, timeout: null, cancel: null, starts: 0, clocks: 0 };
  const dependencies = {
    startTransport(snapshot, complete, token) {
      calls.push("startTransport"); state.starts += 1; state.snapshot = snapshot; state.complete = complete;
      state.token = token; owned.transport.add(token); return undefined;
    },
    cancelTransport(token) { calls.push("cancelTransport"); owned.transport.delete(token); },
    scheduleTimeout(token, timeoutMs, timeout) {
      calls.push("scheduleTimeout"); state.timeoutMs = timeoutMs; state.timeout = timeout; owned.timeout.add(token);
    },
    cancelTimeout(token) { calls.push("cancelTimeout"); owned.timeout.delete(token); },
    subscribeCancellation(cancellation, token, cancel) {
      calls.push("subscribeCancellation"); state.cancellation = cancellation; state.cancel = cancel; owned.cancellation.add(token);
    },
    unsubscribeCancellation(token) { calls.push("unsubscribeCancellation"); owned.cancellation.delete(token); },
    isCancellationRequested() { calls.push("isCancellationRequested"); return false; },
    readPostResponseTime() { calls.push("readPostResponseTime"); state.clocks += 1; return TRUSTED_MS; },
    timeoutMs: 1000,
    ...overrides
  };
  const controller = controllerModule.createPrivateTenantNavigationRequestController(dependencies);
  return { calls, owned, state, dependencies, controller };
}
const ownedCount = (owned) => owned.transport.size + owned.timeout.size + owned.cancellation.size;
const controllerModule = REGISTRATION_MANIFEST ? null : await loadController();
const decisionModule = REGISTRATION_MANIFEST ? null : await loadDecision();

selectedTest("C001", "export is exactly one fresh hardened request controller", () => {
  if (typeof controllerModule.createPrivateTenantNavigationRequestController !== "function") {
    throw new Error("M7T4B_MISSING_C001_FACTORY_TOPOLOGY");
  }
  return (async () => {
  assert.deepEqual(Object.keys(controllerModule), ["createPrivateTenantNavigationRequestController"]);
  const first = controllerModule.createPrivateTenantNavigationRequestController();
  const second = controllerModule.createPrivateTenantNavigationRequestController();
  assert.deepEqual(Reflect.ownKeys(first), ["request"]);
  assert.equal(Object.getPrototypeOf(first), null);
  assert.equal(Object.isFrozen(first), true);
  assert.equal(typeof first.request, "function");
  assert.equal(Object.isFrozen(first.request), true);
  assert.notEqual(first, second);
  assert.notEqual(first.request, second.request);
  const firstResult = await first.request();
  const secondResult = await first.request();
  exactUnavailable(firstResult);
  exactUnavailable(secondResult);
  assert.notEqual(firstResult, secondResult);
  })();
});

selectedTest("V001", "malformed dependency envelopes remain inert", async () => {
  const create = controllerModule.createPrivateTenantNavigationRequestController;
  const trap = () => { throw new Error("request argument observed"); };
  const expectation = new Proxy({}, { get: trap, getPrototypeOf: trap, ownKeys: trap, getOwnPropertyDescriptor: trap });
  class CustomDependencies {}
  const malformed = [undefined, null, false, true, "x", 1, 1n, Symbol("dependencies"),
    () => {}, [], new Number(1), new String("x"), new CustomDependencies(), Object.create({ custom: true }),
    new Proxy({}, { getPrototypeOf: trap, ownKeys: trap, getOwnPropertyDescriptor: trap, get: trap })];
  const results = [];
  for (const dependencies of malformed) results.push(await create(dependencies).request(expectation, expectation, expectation));
  results.forEach(exactUnavailable);
  assert.equal(new Set(results).size, results.length);
});

selectedTest("V002", "malformed expectation and authority never acquire resources", async () => {
  let calls = 0;
  const observed = () => { calls += 1; throw new Error("resource acquired"); };
  const dependencies = {
    startTransport: observed, cancelTransport: observed, scheduleTimeout: observed, cancelTimeout: observed,
    subscribeCancellation: observed, unsubscribeCancellation: observed, isCancellationRequested: observed,
    readPostResponseTime: observed, timeoutMs: 1
  };
  const trap = () => { throw new Error("malformed record observed"); };
  const hostile = new Proxy({}, { get: trap, getPrototypeOf: trap, ownKeys: trap, getOwnPropertyDescriptor: trap });
  const controller = controllerModule.createPrivateTenantNavigationRequestController(dependencies);
  for (const [expectation, authority] of [[hostile, {}], [{}, hostile], [null, {}], [{}, null], [[], {}], [{}, []]]) {
    exactUnavailable(await controller.request(expectation, authority, hostile));
  }
  assert.equal(calls, 0);
});

selectedTest("V003", "import construction and inert requests use no ambient effects", async () => {
  const names = ["fetch", "XMLHttpRequest", "WebSocket", "EventSource", "localStorage", "sessionStorage",
    "indexedDB", "document", "setTimeout", "setInterval", "addEventListener", "AbortController",
    "provider", "tenantProvider", "privateTenantProvider"];
  const before = new Map(names.map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  const consoleBefore = new Map(["log", "info", "warn", "error"].map((name) => [name, Object.getOwnPropertyDescriptor(console, name)]));
  let calls = 0;
  const forbidden = () => { calls += 1; throw new Error("ambient effect"); };
  let result;
  try {
    for (const name of names) Object.defineProperty(globalThis, name, { value: forbidden, writable: true, configurable: true });
    for (const name of consoleBefore.keys()) Object.defineProperty(console, name, { value: forbidden, writable: true, configurable: true });
    result = await controllerModule.createPrivateTenantNavigationRequestController().request();
  } finally {
    for (const [name, descriptor] of before) descriptor ? Object.defineProperty(globalThis, name, descriptor) : delete globalThis[name];
    for (const [name, descriptor] of consoleBefore) Object.defineProperty(console, name, descriptor);
  }
  exactUnavailable(result);
  assert.equal(calls, 0);
});

selectedTest("C002", "canonical door/public asynchronous completion settles through Tracer 4A after owned cleanup", () => {
  const fixture = createFixture();
  const expectation = structuredClone(BASE_EXPECTATION);
  const authority = structuredClone(BASE_AUTHORITY);
  const pending = fixture.controller.request(expectation, authority);
  if (typeof fixture.state.complete !== "function") {
    throw new Error("M7T4B_MISSING_C002_DOOR_PUBLIC_ASYNC_LIFECYCLE");
  }
  assert.notEqual(fixture.state.snapshot, expectation);
  assert.deepEqual({ ...fixture.state.snapshot }, expectation);
  assert.equal(Object.getPrototypeOf(fixture.state.snapshot), null);
  assert.equal(Object.isFrozen(fixture.state.snapshot), true);
  assert.equal(Object.getPrototypeOf(fixture.state.token), null);
  assert.equal(Object.isFrozen(fixture.state.token), true);
  expectation.channel = "direct";
  authority.active = false;
  fixture.state.complete(responseFor());
  return pending.then(async (result) => {
    exactAvailable(result, "public");
    assert.deepEqual(fixture.calls, ["scheduleTimeout", "startTransport", "readPostResponseTime", "cancelTransport", "cancelTimeout"]);
    assert.equal(fixture.state.clocks, 1);
    assert.equal(ownedCount(fixture.owned), 0);
    fixture.state.complete(null);
    fixture.state.timeout();
    assert.equal(fixture.state.clocks, 1);
    assert.equal(ownedCount(fixture.owned), 0);
    const recovered = fixture.controller.request(structuredClone(BASE_EXPECTATION), structuredClone(BASE_AUTHORITY));
    assert.equal(fixture.state.starts, 2);
    fixture.state.complete(responseFor());
    exactAvailable(await recovered, "public");
  });
});

selectedTest("C046", "malformed transport wrappers converge through unchanged Tracer 4A delegation", () => {
  const probe = createFixture();
  const probePending = probe.controller.request(structuredClone(BASE_EXPECTATION), structuredClone(BASE_AUTHORITY));
  probe.state.complete(undefined);
  if (probe.state.clocks !== 1) {
    throw new Error("M7T4B_MISSING_C046_MALFORMED_WRAPPER_DELEGATION");
  }
  return (async () => {
    exactUnavailable(await probePending);
    class CustomResponse {}
    const canonical = responseFor();
    const malformed = [undefined, null, false, true, "x", 1, 1n, Symbol("response"), () => {}, [],
      new Number(1), new String("x"), new CustomResponse(), Object.create({ custom: true })];
    for (const key of Object.keys(canonical)) {
      const value = { ...canonical }; delete value[key]; malformed.push(value);
    }
    const withSymbol = { ...canonical }; withSymbol[Symbol("extra")] = true;
    const withHidden = { ...canonical }; Object.defineProperty(withHidden, "extra", { value: true });
    const { status, ...rest } = canonical;
    const accessor = { ...canonical }; Object.defineProperty(accessor, "status", { enumerable: true, get() { throw new Error("accessor"); } });
    malformed.push({ ...canonical, extra: true }, withSymbol, withHidden, { ...rest, status }, accessor,
      Object.assign(Object.create({ custom: true }), canonical),
      ...[{ status: 199 }, { status: "200" }, { contentType: "application/json" }, { contentType: 1 },
        { contentLength: null }, { contentLength: 1.5 }, { contentLength: -1 }, { contentLength: -0 },
        { contentLength: canonical.contentLength + 1 }, { contentLength: 1 }, { contentLength: 2049 },
        { bodyText: null }, { bodyText: {} }].map((change) => ({ ...canonical, ...change })));
    const framed = (bodyText) => ({ ...canonical, contentLength: Buffer.byteLength(bodyText), bodyText });
    malformed.push(framed("{"), framed("[]"), framed("null"), framed('{"decision":null}'),
      framed('{"decision":{},"decision":{}}'), framed(`{"decision":{"nested":{"too":{"deep":1}}}}`),
      framed(" ".repeat(2049)), framed("{}"), framed('{"extra":1}'));
    const missingDecision = Object.keys(decisionFor()).map((key) => {
      const decision = decisionFor(); delete decision[key]; return responseForDecision(decision);
    });
    malformed.push(...missingDecision,
      responseForDecision({ ...decisionFor(), extra: true }),
      responseForDecision({ ...decisionFor(), allowed: false }),
      responseForDecision({ ...decisionFor(), channel: "air" }),
      responseForDecision({ ...decisionFor(), destinationId: id("f") }),
      responseForDecision({ ...decisionFor(), accessState: "open" }));
    const results = [];
    for (const value of malformed) {
      const fixture = createFixture();
      const pending = fixture.controller.request(structuredClone(BASE_EXPECTATION), structuredClone(BASE_AUTHORITY));
      const original = value;
      fixture.state.complete(original);
      const result = await pending;
      exactUnavailable(result);
      results.push(result);
      assert.equal(fixture.state.clocks, 1);
      assert.deepEqual(fixture.calls, ["scheduleTimeout", "startTransport", "readPostResponseTime", "cancelTransport", "cancelTimeout"]);
      fixture.state.complete(responseFor()); fixture.state.timeout();
      assert.equal(fixture.state.clocks, 1);
      assert.equal(ownedCount(fixture.owned), 0);
      const recovery = fixture.controller.request(structuredClone(BASE_EXPECTATION), structuredClone(BASE_AUTHORITY));
      fixture.state.complete(responseFor()); exactAvailable(await recovery, "public");
    }
    assert.equal(new Set(results).size, results.length);
    const transcript = [];
    const observedProxy = (label) => new Proxy(responseFor(), {
      getPrototypeOf(target) { transcript.push(`${label}:getPrototypeOf`); return Reflect.getPrototypeOf(target); },
      ownKeys(target) { transcript.push(`${label}:ownKeys`); return Reflect.ownKeys(target); },
      getOwnPropertyDescriptor(target, key) { transcript.push(`${label}:descriptor:${String(key)}`); return Reflect.getOwnPropertyDescriptor(target, key); },
      get(target, key, receiver) { transcript.push(`${label}:get:${String(key)}`); return Reflect.get(target, key, receiver); }
    });
    const direct = decisionModule.createPrivateTenantNavigationDecisionDecoder(structuredClone(BASE_EXPECTATION), structuredClone(BASE_AUTHORITY));
    exactUnavailable(direct.decode(observedProxy("direct"), TRUSTED_MS));
    const directTranscript = transcript.splice(0).map((entry) => entry.replace("direct", "same"));
    const fixture = createFixture();
    const pending = fixture.controller.request(structuredClone(BASE_EXPECTATION), structuredClone(BASE_AUTHORITY));
    fixture.state.complete(observedProxy("controller"));
    exactUnavailable(await pending);
    assert.deepEqual(transcript.map((entry) => entry.replace("controller", "same")), directTranscript);
  })();
});

async function parityLifecycle(channel, accessState) {
  const fixture = createFixture();
  const expectation = { ...BASE_EXPECTATION, channel };
  const pending = fixture.controller.request(expectation, structuredClone(BASE_AUTHORITY));
  fixture.state.complete(responseFor(channel, accessState));
  const result = await pending;
  exactAvailable(result, accessState);
  assert.deepEqual(fixture.calls, ["scheduleTimeout", "startTransport", "readPostResponseTime", "cancelTransport", "cancelTimeout"]);
  assert.equal(fixture.state.clocks, 1);
  assert.equal(ownedCount(fixture.owned), 0);
  fixture.state.complete(responseFor(channel, accessState));
  fixture.state.timeout();
  assert.equal(fixture.state.clocks, 1);
  assert.equal(ownedCount(fixture.owned), 0);
  const recovered = fixture.controller.request({ ...BASE_EXPECTATION, channel }, structuredClone(BASE_AUTHORITY));
  assert.equal(fixture.state.starts, 2);
  fixture.state.complete(responseFor(channel, accessState));
  exactAvailable(await recovered, accessState);
  assert.equal(ownedCount(fixture.owned), 0);
}

selectedTest("C027", "door channel preserves tenant access through the complete asynchronous lifecycle", async () => {
  await parityLifecycle("door", "tenant");
});

selectedTest("C028", "door channel preserves invited access through the complete asynchronous lifecycle", async () => {
  await parityLifecycle("door", "invited");
});

selectedTest("C029", "door channel preserves private access through the complete asynchronous lifecycle", async () => {
  await parityLifecycle("door", "private");
});

selectedTest("C030", "door channel preserves restricted access through the complete asynchronous lifecycle", async () => {
  await parityLifecycle("door", "restricted");
});

selectedTest("C031", "elevator channel preserves public access through the complete asynchronous lifecycle", async () => {
  await parityLifecycle("elevator", "public");
});

selectedTest("C032", "elevator channel preserves tenant access through the complete asynchronous lifecycle", async () => {
  await parityLifecycle("elevator", "tenant");
});

selectedTest("C033", "elevator channel preserves invited access through the complete asynchronous lifecycle", async () => {
  await parityLifecycle("elevator", "invited");
});

selectedTest("C034", "elevator channel preserves private access through the complete asynchronous lifecycle", async () => {
  await parityLifecycle("elevator", "private");
});

selectedTest("C035", "elevator channel preserves restricted access through the complete asynchronous lifecycle", async () => {
  await parityLifecycle("elevator", "restricted");
});

selectedTest("C036", "direct channel preserves public access through the complete asynchronous lifecycle", async () => {
  await parityLifecycle("direct", "public");
});

selectedTest("C037", "direct channel preserves tenant access through the complete asynchronous lifecycle", async () => {
  await parityLifecycle("direct", "tenant");
});

selectedTest("C038", "direct channel preserves invited access through the complete asynchronous lifecycle", async () => {
  await parityLifecycle("direct", "invited");
});

selectedTest("C039", "direct channel preserves private access through the complete asynchronous lifecycle", async () => {
  await parityLifecycle("direct", "private");
});

selectedTest("C040", "direct channel preserves restricted access through the complete asynchronous lifecycle", async () => {
  await parityLifecycle("direct", "restricted");
});

selectedTest("C041", "alternative channel preserves public access through the complete asynchronous lifecycle", async () => {
  await parityLifecycle("alternative", "public");
});

selectedTest("C042", "alternative channel preserves tenant access through the complete asynchronous lifecycle", async () => {
  await parityLifecycle("alternative", "tenant");
});

selectedTest("C043", "alternative channel preserves invited access through the complete asynchronous lifecycle", async () => {
  await parityLifecycle("alternative", "invited");
});

selectedTest("C044", "alternative channel preserves private access through the complete asynchronous lifecycle", async () => {
  await parityLifecycle("alternative", "private");
});

selectedTest("C045", "alternative channel preserves restricted access through the complete asynchronous lifecycle", async () => {
  await parityLifecycle("alternative", "restricted");
});

selectedTest("C010", "duplicate completions decode settle and clean exactly once", async () => {
  const fixture = createFixture();
  const pending = fixture.controller.request(structuredClone(BASE_EXPECTATION), structuredClone(BASE_AUTHORITY));
  let reactions = 0;
  const observed = pending.then((result) => {
    reactions += 1;
    return result;
  });
  fixture.state.complete(responseFor());
  fixture.state.complete(responseFor("door", "tenant"));
  fixture.state.complete(null);
  fixture.state.timeout();
  exactAvailable(await observed, "public");
  assert.equal(reactions, 1);
  assert.equal(fixture.state.clocks, 1);
  assert.deepEqual(fixture.calls, ["scheduleTimeout", "startTransport", "readPostResponseTime", "cancelTransport", "cancelTimeout"]);
  assert.equal(ownedCount(fixture.owned), 0);
  fixture.state.complete(responseFor("door", "private"));
  fixture.state.timeout();
  await Promise.resolve();
  assert.equal(reactions, 1);
  assert.equal(fixture.state.clocks, 1);
  assert.equal(ownedCount(fixture.owned), 0);
  const recovered = fixture.controller.request(structuredClone(BASE_EXPECTATION), structuredClone(BASE_AUTHORITY));
  assert.equal(fixture.state.starts, 2);
  fixture.state.complete(responseFor());
  exactAvailable(await recovered, "public");
  assert.equal(ownedCount(fixture.owned), 0);
});

selectedTest("C003", "synchronous completion is deferred until transport returns and cleanup finishes", async () => {
  let decoderEffects = 0;
  let fulfillmentReactions = 0;
  let duringStart;
  const fixture = createFixture({
    readPostResponseTime() {
      fixture.calls.push("readPostResponseTime");
      fixture.state.clocks += 1;
      decoderEffects += 1;
      return TRUSTED_MS;
    },
    startTransport(snapshot, complete, token) {
      fixture.calls.push("startTransport");
      fixture.state.starts += 1;
      fixture.state.snapshot = snapshot;
      fixture.state.complete = complete;
      fixture.state.token = token;
      fixture.owned.transport.add(token);
      complete(responseFor());
      duringStart = {
        calls: [...fixture.calls],
        clocks: fixture.state.clocks,
        decoderEffects,
        fulfillmentReactions,
        owned: ownedCount(fixture.owned)
      };
    }
  });
  const pending = fixture.controller.request(structuredClone(BASE_EXPECTATION), structuredClone(BASE_AUTHORITY));
  const observed = pending.then((result) => {
    fulfillmentReactions += 1;
    return result;
  });
  const deferredDuringStart = duringStart?.clocks === 0 && duringStart.decoderEffects === 0 &&
    duringStart.fulfillmentReactions === 0 && duringStart.owned === 2 &&
    JSON.stringify(duringStart.calls) === JSON.stringify(["scheduleTimeout", "startTransport"]);
  if (!deferredDuringStart) {
    throw new Error("M7T4B_MISSING_C003_SYNC_COMPLETION_DEFERRAL");
  }
  exactAvailable(await observed, "public");
  assert.equal(fulfillmentReactions, 1);
  assert.equal(fixture.state.clocks, 1);
  assert.equal(decoderEffects, 1);
  assert.deepEqual(fixture.calls, ["scheduleTimeout", "startTransport", "readPostResponseTime", "cancelTransport", "cancelTimeout"]);
  assert.equal(ownedCount(fixture.owned), 0);
  fixture.state.complete(responseFor("door", "tenant"));
  fixture.state.timeout();
  await Promise.resolve();
  assert.equal(fulfillmentReactions, 1);
  assert.equal(fixture.state.clocks, 1);
  assert.equal(ownedCount(fixture.owned), 0);
  const recovered = fixture.controller.request(structuredClone(BASE_EXPECTATION), structuredClone(BASE_AUTHORITY));
  assert.equal(fixture.state.starts, 2);
  exactAvailable(await recovered, "public");
  assert.equal(ownedCount(fixture.owned), 0);
});

selectedTest("C004", "callback then start throw overrides provisional completion", async () => {
  const fulfillment = [];
  const rejection = [];
  const secret = "start-throw-detail-must-not-leak";
  const fixture = createFixture({
    startTransport(snapshot, complete, token) {
      fixture.calls.push("startTransport");
      fixture.state.starts += 1;
      fixture.state.snapshot = snapshot;
      fixture.state.complete = complete;
      fixture.state.token = token;
      fixture.owned.transport.add(token);
      complete(responseFor());
      if (fixture.state.starts === 1) throw new Error(secret);
    }
  });
  const pending = fixture.controller.request(structuredClone(BASE_EXPECTATION), structuredClone(BASE_AUTHORITY));
  const observed = pending.then(
    (result) => { fulfillment.push(result); return result; },
    (error) => { rejection.push(error); return error; }
  );
  const result = await observed;
  const overridePresent = fulfillment.length === 1 && rejection.length === 0 &&
    fixture.state.clocks === 0 && ownedCount(fixture.owned) === 0 &&
    JSON.stringify(fixture.calls) === JSON.stringify([
      "scheduleTimeout", "startTransport", "cancelTransport", "cancelTimeout"
    ]);
  if (!overridePresent) {
    throw new Error("M7T4B_MISSING_C004_CALLBACK_THEN_START_THROW");
  }
  exactUnavailable(result);
  assert.notEqual(result, responseFor());
  assert.equal(JSON.stringify(result).includes(secret), false);
  fixture.state.complete(responseFor("door", "tenant"));
  fixture.state.timeout();
  await Promise.resolve();
  assert.equal(fulfillment.length, 1);
  assert.equal(rejection.length, 0);
  assert.equal(fixture.state.clocks, 0);
  assert.deepEqual(fixture.calls, ["scheduleTimeout", "startTransport", "cancelTransport", "cancelTimeout"]);
  assert.equal(ownedCount(fixture.owned), 0);
  const recovered = fixture.controller.request(structuredClone(BASE_EXPECTATION), structuredClone(BASE_AUTHORITY));
  assert.equal(fixture.state.starts, 2);
  exactAvailable(await recovered, "public");
  assert.equal(fixture.state.clocks, 1);
  assert.equal(ownedCount(fixture.owned), 0);
});

selectedTest("C005", "acquisition and release returns never assimilate hostile thenables", async () => {
  const returned = [];
  const thenGets = [];
  const thenCalls = [];
  const rejection = [];
  const unhandled = [];
  const labels = ["subscribeCancellation", "scheduleTimeout", "startTransport",
    "cancelTransport", "cancelTimeout", "unsubscribeCancellation"];
  const secret = "hostile-thenable-detail-must-not-leak";
  const onUnhandled = (reason) => { unhandled.push(reason); };
  const hostileReturn = (label) => {
    returned.push(label);
    return Object.defineProperty(Object.create(null), "then", {
      get() {
        thenGets.push(label);
        return (_resolve, reject) => {
          thenCalls.push(label);
          reject(new Error(secret));
        };
      }
    });
  };
  const fixture = createFixture({
    subscribeCancellation(cancellation, token, cancel) {
      fixture.calls.push("subscribeCancellation");
      fixture.state.cancellation = cancellation;
      fixture.state.cancel = cancel;
      fixture.owned.cancellation.add(token);
      return hostileReturn("subscribeCancellation");
    },
    scheduleTimeout(token, timeoutMs, timeout) {
      fixture.calls.push("scheduleTimeout");
      fixture.state.timeoutMs = timeoutMs;
      fixture.state.timeout = timeout;
      fixture.owned.timeout.add(token);
      return hostileReturn("scheduleTimeout");
    },
    startTransport(snapshot, complete, token) {
      fixture.calls.push("startTransport");
      fixture.state.starts += 1;
      fixture.state.snapshot = snapshot;
      fixture.state.complete = complete;
      fixture.state.token = token;
      fixture.owned.transport.add(token);
      complete(responseFor());
      return hostileReturn("startTransport");
    },
    cancelTransport(token) {
      fixture.calls.push("cancelTransport");
      fixture.owned.transport.delete(token);
      return hostileReturn("cancelTransport");
    },
    cancelTimeout(token) {
      fixture.calls.push("cancelTimeout");
      fixture.owned.timeout.delete(token);
      return hostileReturn("cancelTimeout");
    },
    unsubscribeCancellation(token) {
      fixture.calls.push("unsubscribeCancellation");
      fixture.owned.cancellation.delete(token);
      return hostileReturn("unsubscribeCancellation");
    }
  });
  process.on("unhandledRejection", onUnhandled);
  try {
    const cancellation = Object.freeze(Object.create(null));
    const pending = fixture.controller.request(
      structuredClone(BASE_EXPECTATION), structuredClone(BASE_AUTHORITY), cancellation
    );
    const observed = pending.then(
      (result) => result,
      (error) => { rejection.push(error); return error; }
    );
    const initialNonAssimilation = labels.every((label) => returned.filter((value) => value === label).length === 1) &&
      thenGets.length === 0 && thenCalls.length === 0 && unhandled.length === 0;
    if (!initialNonAssimilation) {
      throw new Error("M7T4B_MISSING_C005_HOSTILE_THENABLE_NON_ASSIMILATION");
    }
    const result = await observed;
    const firstCalls = [...fixture.calls];
    fixture.state.complete(responseFor("door", "tenant"));
    fixture.state.timeout();
    fixture.state.cancel?.();
    await Promise.resolve();
    const afterLateCalls = [...fixture.calls];
    const recovered = fixture.controller.request(
      structuredClone(BASE_EXPECTATION), structuredClone(BASE_AUTHORITY), cancellation
    );
    const recoveredResult = await recovered;
    await Promise.resolve();
    const nonAssimilationPresent = labels.every((label) => returned.filter((value) => value === label).length === 2) &&
      thenGets.length === 0 && thenCalls.length === 0 && unhandled.length === 0;
    if (!nonAssimilationPresent) {
      throw new Error("M7T4B_MISSING_C005_HOSTILE_THENABLE_NON_ASSIMILATION");
    }
    exactAvailable(result, "public");
    exactAvailable(recoveredResult, "public");
    assert.notEqual(result, recoveredResult);
    assert.equal(rejection.length, 0);
    assert.equal(JSON.stringify(result).includes(secret), false);
    assert.equal(JSON.stringify(recoveredResult).includes(secret), false);
    assert.deepEqual(firstCalls, ["subscribeCancellation", "isCancellationRequested", "scheduleTimeout", "startTransport",
      "readPostResponseTime", "cancelTransport", "cancelTimeout", "unsubscribeCancellation"]);
    assert.deepEqual(afterLateCalls, firstCalls);
    assert.deepEqual(fixture.calls, [...firstCalls, ...firstCalls]);
    assert.equal(fixture.state.clocks, 2);
    assert.equal(ownedCount(fixture.owned), 0);
  } finally {
    process.off("unhandledRejection", onUnhandled);
  }
});

selectedTest("C006", "one pending request makes every concurrent call generically busy without observation", async () => {
  const observations = [];
  const rejections = [];
  const fixture = createFixture();
  const expectation = structuredClone(BASE_EXPECTATION);
  const authority = structuredClone(BASE_AUTHORITY);
  const cancellation = Object.freeze(Object.create(null));
  const pending = fixture.controller.request(expectation, authority, cancellation);
  const completeOriginal = fixture.state.complete;
  const timeoutOriginal = fixture.state.timeout;
  const cancelOriginal = fixture.state.cancel;
  const baselineCalls = [...fixture.calls];
  const baselineOwned = ownedCount(fixture.owned);
  const observed = (label, value) => new Proxy(value, {
    getPrototypeOf(target) { observations.push(`${label}:getPrototypeOf`); return Reflect.getPrototypeOf(target); },
    ownKeys(target) { observations.push(`${label}:ownKeys`); return Reflect.ownKeys(target); },
    getOwnPropertyDescriptor(target, key) {
      observations.push(`${label}:descriptor:${String(key)}`);
      return Reflect.getOwnPropertyDescriptor(target, key);
    },
    get(target, key, receiver) {
      observations.push(`${label}:get:${String(key)}`);
      return Reflect.get(target, key, receiver);
    }
  });
  const trap = (label) => new Proxy({}, {
    getPrototypeOf() { observations.push(`${label}:getPrototypeOf`); throw new Error(label); },
    ownKeys() { observations.push(`${label}:ownKeys`); throw new Error(label); },
    getOwnPropertyDescriptor() { observations.push(`${label}:descriptor`); throw new Error(label); },
    get() { observations.push(`${label}:get`); throw new Error(label); }
  });
  const concurrent = [
    fixture.controller.request(),
    fixture.controller.request(trap("hostile-expectation"), trap("hostile-authority"), trap("hostile-cancellation")),
    fixture.controller.request(
      observed("valid-expectation", structuredClone(BASE_EXPECTATION)),
      observed("valid-authority", structuredClone(BASE_AUTHORITY)),
      trap("valid-cancellation")
    ),
    fixture.controller.request(structuredClone(BASE_EXPECTATION), structuredClone(BASE_AUTHORITY), cancellation)
  ];
  const busyGatePresent = observations.length === 0 &&
    JSON.stringify(fixture.calls) === JSON.stringify(baselineCalls) &&
    ownedCount(fixture.owned) === baselineOwned &&
    fixture.state.complete === completeOriginal && fixture.state.timeout === timeoutOriginal &&
    fixture.state.cancel === cancelOriginal;
  if (!busyGatePresent) {
    throw new Error("M7T4B_MISSING_C006_SINGLE_FLIGHT_BUSY");
  }
  const busyResults = await Promise.all(concurrent.map((result) => result.then(
    (value) => value,
    (error) => { rejections.push(error); return error; }
  )));
  assert.equal(rejections.length, 0);
  busyResults.forEach(exactUnavailable);
  assert.equal(new Set(busyResults).size, busyResults.length);
  assert.equal(observations.length, 0);
  assert.deepEqual(fixture.calls, baselineCalls);
  assert.equal(ownedCount(fixture.owned), baselineOwned);
  completeOriginal(responseFor());
  exactAvailable(await pending, "public");
  assert.deepEqual(fixture.calls, [...baselineCalls,
    "readPostResponseTime", "cancelTransport", "cancelTimeout", "unsubscribeCancellation"]);
  assert.equal(fixture.state.clocks, 1);
  assert.equal(ownedCount(fixture.owned), 0);
  completeOriginal(responseFor("door", "tenant"));
  timeoutOriginal();
  cancelOriginal();
  await Promise.resolve();
  assert.equal(fixture.state.clocks, 1);
  assert.equal(ownedCount(fixture.owned), 0);
  assert.deepEqual(expectation, BASE_EXPECTATION);
  assert.deepEqual(authority, BASE_AUTHORITY);
  const recovered = fixture.controller.request(structuredClone(BASE_EXPECTATION), structuredClone(BASE_AUTHORITY));
  assert.equal(fixture.state.starts, 2);
  fixture.state.complete(responseFor());
  exactAvailable(await recovered, "public");
  assert.equal(ownedCount(fixture.owned), 0);
});

selectedTest("C007", "timeout is first terminal and contains late completion", async () => {
  const rejections = [];
  const fixture = createFixture();
  const cancellation = Object.freeze(Object.create(null));
  const pending = fixture.controller.request(
    structuredClone(BASE_EXPECTATION), structuredClone(BASE_AUTHORITY), cancellation
  );
  const completeOriginal = fixture.state.complete;
  const timeoutOriginal = fixture.state.timeout;
  const cancelOriginal = fixture.state.cancel;
  timeoutOriginal();
  const timeoutTerminalPresent = fixture.state.clocks === 0 && ownedCount(fixture.owned) === 0 &&
    JSON.stringify(fixture.calls) === JSON.stringify([
      "subscribeCancellation", "isCancellationRequested", "scheduleTimeout", "startTransport",
      "cancelTransport", "cancelTimeout", "unsubscribeCancellation"
    ]);
  if (!timeoutTerminalPresent) {
    throw new Error("M7T4B_MISSING_C007_TIMEOUT_TERMINAL");
  }
  const result = await pending.then(
    (value) => value,
    (error) => { rejections.push(error); return error; }
  );
  exactUnavailable(result);
  assert.equal(rejections.length, 0);
  assert.equal(ownedCount(fixture.owned), 0);
  const callsAfterTimeout = [...fixture.calls];
  completeOriginal(responseFor("door", "private"));
  timeoutOriginal();
  cancelOriginal();
  await Promise.resolve();
  assert.deepEqual(fixture.calls, callsAfterTimeout);
  assert.equal(fixture.state.clocks, 0);
  assert.equal(ownedCount(fixture.owned), 0);
  const recovered = fixture.controller.request(structuredClone(BASE_EXPECTATION), structuredClone(BASE_AUTHORITY));
  assert.equal(fixture.state.starts, 2);
  fixture.state.complete(responseFor());
  const recoveredResult = await recovered;
  exactAvailable(recoveredResult, "public");
  assert.notEqual(result, recoveredResult);
  assert.equal(ownedCount(fixture.owned), 0);
});

selectedTest("C008", "pre-cancel settles before timer or transport acquisition", async () => {
  const rejections = [];
  const cancellation = Object.freeze(Object.create(null));
  const fixture = createFixture({
    isCancellationRequested(value) {
      fixture.calls.push("isCancellationRequested");
      assert.equal(value, cancellation);
      return true;
    }
  });
  const pending = fixture.controller.request(
    structuredClone(BASE_EXPECTATION), structuredClone(BASE_AUTHORITY), cancellation
  );
  const cancelOriginal = fixture.state.cancel;
  const preCancelTerminalPresent = fixture.state.starts === 0 && fixture.state.clocks === 0 &&
    fixture.state.complete === null && fixture.state.timeout === null && ownedCount(fixture.owned) === 0 &&
    JSON.stringify(fixture.calls) === JSON.stringify([
      "subscribeCancellation", "isCancellationRequested", "unsubscribeCancellation"
    ]);
  if (!preCancelTerminalPresent) {
    throw new Error("M7T4B_MISSING_C008_PRE_CANCEL_TERMINAL");
  }
  const result = await pending.then(
    (value) => value,
    (error) => { rejections.push(error); return error; }
  );
  exactUnavailable(result);
  assert.equal(rejections.length, 0);
  assert.equal(ownedCount(fixture.owned), 0);
  const callsAfterCancel = [...fixture.calls];
  cancelOriginal();
  await Promise.resolve();
  assert.deepEqual(fixture.calls, callsAfterCancel);
  assert.equal(fixture.state.clocks, 0);
  assert.equal(ownedCount(fixture.owned), 0);
  const recovered = fixture.controller.request(structuredClone(BASE_EXPECTATION), structuredClone(BASE_AUTHORITY));
  assert.equal(fixture.state.starts, 1);
  fixture.state.complete(responseFor());
  const recoveredResult = await recovered;
  exactAvailable(recoveredResult, "public");
  assert.notEqual(result, recoveredResult);
  assert.equal(ownedCount(fixture.owned), 0);
});

const activeCancellationTerminal = async () => {
  const rejections = [];
  const cancellation = Object.freeze(Object.create(null));
  const fixture = createFixture();
  const pending = fixture.controller.request(
    structuredClone(BASE_EXPECTATION), structuredClone(BASE_AUTHORITY), cancellation
  );
  const completeOriginal = fixture.state.complete;
  const timeoutOriginal = fixture.state.timeout;
  const cancelOriginal = fixture.state.cancel;
  cancelOriginal();
  const activeCancelTerminalPresent = fixture.state.clocks === 0 && ownedCount(fixture.owned) === 0 &&
    JSON.stringify(fixture.calls) === JSON.stringify([
      "subscribeCancellation", "isCancellationRequested", "scheduleTimeout", "startTransport",
      "cancelTransport", "cancelTimeout", "unsubscribeCancellation"
    ]);
  if (!activeCancelTerminalPresent) {
    throw new Error("M7T4B_MISSING_C009_ACTIVE_CANCEL_TERMINAL");
  }
  const callsAfterCancel = [...fixture.calls];
  completeOriginal(responseFor("door", "private"));
  timeoutOriginal();
  cancelOriginal();
  const result = await pending.then(
    (value) => value,
    (error) => { rejections.push(error); return error; }
  );
  exactUnavailable(result);
  assert.equal(rejections.length, 0);
  assert.deepEqual(fixture.calls, callsAfterCancel);
  assert.equal(fixture.state.clocks, 0);
  assert.equal(ownedCount(fixture.owned), 0);
  const recovered = fixture.controller.request(structuredClone(BASE_EXPECTATION), structuredClone(BASE_AUTHORITY));
  assert.equal(fixture.state.starts, 2);
  fixture.state.complete(responseFor());
  const recoveredResult = await recovered;
  exactAvailable(recoveredResult, "public");
  assert.notEqual(result, recoveredResult);
  assert.equal(ownedCount(fixture.owned), 0);
};

selectedTest("C009", "active cancellation is first terminal and contains late work", activeCancellationTerminal);

selectedTest("C021", "completion before timeout keeps completion", async () => {
  const rejections = [];
  const fixture = createFixture();
  const pending = fixture.controller.request(
    structuredClone(BASE_EXPECTATION), structuredClone(BASE_AUTHORITY)
  );
  const completeOriginal = fixture.state.complete;
  const timeoutOriginal = fixture.state.timeout;
  let recovered;
  const observed = pending.then(
    (result) => {
      exactAvailable(result, "public");
      assert.equal(ownedCount(fixture.owned), 0);
      recovered = fixture.controller.request(
        structuredClone(BASE_EXPECTATION), structuredClone(BASE_AUTHORITY)
      );
      assert.equal(fixture.state.starts, 2);
      return result;
    },
    (error) => { rejections.push(error); return error; }
  );
  completeOriginal(responseFor());
  const callsAfterCompletion = [...fixture.calls];
  assert.deepEqual(callsAfterCompletion, [
    "scheduleTimeout", "startTransport", "readPostResponseTime", "cancelTransport", "cancelTimeout"
  ]);
  assert.equal(fixture.state.clocks, 1);
  assert.equal(ownedCount(fixture.owned), 0);
  timeoutOriginal();
  completeOriginal(responseFor("door", "private"));
  assert.deepEqual(fixture.calls, callsAfterCompletion);
  assert.equal(fixture.state.clocks, 1);
  assert.equal(ownedCount(fixture.owned), 0);
  const result = await observed;
  exactAvailable(result, "public");
  assert.equal(rejections.length, 0);
  assert.deepEqual(fixture.calls, [...callsAfterCompletion, "scheduleTimeout", "startTransport"]);
  fixture.state.complete(responseFor());
  const recoveredResult = await recovered;
  exactAvailable(recoveredResult, "public");
  assert.notEqual(result, recoveredResult);
  assert.deepEqual(fixture.calls, [...callsAfterCompletion,
    "scheduleTimeout", "startTransport", "readPostResponseTime", "cancelTransport", "cancelTimeout"]);
  assert.equal(fixture.state.clocks, 2);
  assert.equal(ownedCount(fixture.owned), 0);
});

selectedTest("C022", "timeout before completion keeps timeout", async () => {
  const rejections = [];
  let fulfillments = 0;
  const fixture = createFixture();
  const pending = fixture.controller.request(
    structuredClone(BASE_EXPECTATION), structuredClone(BASE_AUTHORITY)
  );
  const completeOriginal = fixture.state.complete;
  const timeoutOriginal = fixture.state.timeout;
  let recovered;
  const observed = pending.then(
    (result) => {
      fulfillments += 1;
      exactUnavailable(result);
      assert.equal(ownedCount(fixture.owned), 0);
      recovered = fixture.controller.request(
        structuredClone(BASE_EXPECTATION), structuredClone(BASE_AUTHORITY)
      );
      assert.equal(fixture.state.starts, 2);
      return result;
    },
    (error) => { rejections.push(error); return error; }
  );
  timeoutOriginal();
  const callsAfterTimeout = [...fixture.calls];
  assert.deepEqual(callsAfterTimeout, [
    "scheduleTimeout", "startTransport", "cancelTransport", "cancelTimeout"
  ]);
  assert.equal(fixture.state.clocks, 0);
  assert.equal(ownedCount(fixture.owned), 0);
  completeOriginal(responseFor("door", "private"));
  timeoutOriginal();
  assert.deepEqual(fixture.calls, callsAfterTimeout);
  assert.equal(fixture.state.clocks, 0);
  assert.equal(ownedCount(fixture.owned), 0);
  const result = await observed;
  exactUnavailable(result);
  assert.equal(fulfillments, 1);
  assert.equal(rejections.length, 0);
  assert.deepEqual(fixture.calls, [...callsAfterTimeout, "scheduleTimeout", "startTransport"]);
  fixture.state.complete(responseFor());
  const recoveredResult = await recovered;
  exactAvailable(recoveredResult, "public");
  assert.notEqual(result, recoveredResult);
  assert.deepEqual(fixture.calls, [...callsAfterTimeout,
    "scheduleTimeout", "startTransport", "readPostResponseTime", "cancelTransport", "cancelTimeout"]);
  assert.equal(fixture.state.clocks, 1);
  assert.equal(ownedCount(fixture.owned), 0);
});

selectedTest("C024", "cancellation before completion keeps cancellation", async () => {
  const rejections = [];
  let fulfillments = 0;
  const cancellation = Object.freeze(Object.create(null));
  const fixture = createFixture();
  const pending = fixture.controller.request(
    structuredClone(BASE_EXPECTATION), structuredClone(BASE_AUTHORITY), cancellation
  );
  const completeOriginal = fixture.state.complete;
  const cancelOriginal = fixture.state.cancel;
  let recovered;
  const observed = pending.then(
    (result) => {
      fulfillments += 1;
      exactUnavailable(result);
      assert.equal(ownedCount(fixture.owned), 0);
      recovered = fixture.controller.request(
        structuredClone(BASE_EXPECTATION), structuredClone(BASE_AUTHORITY)
      );
      assert.equal(fixture.state.starts, 2);
      return result;
    },
    (error) => { rejections.push(error); return error; }
  );
  cancelOriginal();
  const callsAfterCancellation = [...fixture.calls];
  assert.deepEqual(callsAfterCancellation, [
    "subscribeCancellation", "isCancellationRequested", "scheduleTimeout", "startTransport",
    "cancelTransport", "cancelTimeout", "unsubscribeCancellation"
  ]);
  assert.equal(fixture.state.clocks, 0);
  assert.equal(ownedCount(fixture.owned), 0);
  completeOriginal(responseFor("door", "private"));
  cancelOriginal();
  assert.deepEqual(fixture.calls, callsAfterCancellation);
  assert.equal(fixture.state.clocks, 0);
  assert.equal(ownedCount(fixture.owned), 0);
  const result = await observed;
  exactUnavailable(result);
  assert.equal(fulfillments, 1);
  assert.equal(rejections.length, 0);
  assert.deepEqual(fixture.calls, [...callsAfterCancellation, "scheduleTimeout", "startTransport"]);
  fixture.state.complete(responseFor());
  const recoveredResult = await recovered;
  exactAvailable(recoveredResult, "public");
  assert.notEqual(result, recoveredResult);
  assert.deepEqual(fixture.calls, [...callsAfterCancellation,
    "scheduleTimeout", "startTransport", "readPostResponseTime", "cancelTransport", "cancelTimeout"]);
  assert.equal(fixture.state.clocks, 1);
  assert.equal(ownedCount(fixture.owned), 0);
});

selectedTest("C026", "cancellation before timeout keeps cancellation", async () => {
  const rejections = [];
  let fulfillments = 0;
  const cancellation = Object.freeze(Object.create(null));
  const fixture = createFixture();
  const pending = fixture.controller.request(
    structuredClone(BASE_EXPECTATION), structuredClone(BASE_AUTHORITY), cancellation
  );
  const timeoutOriginal = fixture.state.timeout;
  const cancelOriginal = fixture.state.cancel;
  let recovered;
  const observed = pending.then(
    (result) => {
      fulfillments += 1;
      exactUnavailable(result);
      assert.equal(ownedCount(fixture.owned), 0);
      recovered = fixture.controller.request(
        structuredClone(BASE_EXPECTATION), structuredClone(BASE_AUTHORITY)
      );
      assert.equal(fixture.state.starts, 2);
      return result;
    },
    (error) => { rejections.push(error); return error; }
  );
  cancelOriginal();
  const callsAfterCancellation = [...fixture.calls];
  assert.deepEqual(callsAfterCancellation, [
    "subscribeCancellation", "isCancellationRequested", "scheduleTimeout", "startTransport",
    "cancelTransport", "cancelTimeout", "unsubscribeCancellation"
  ]);
  assert.equal(fixture.state.clocks, 0);
  assert.equal(ownedCount(fixture.owned), 0);
  timeoutOriginal();
  cancelOriginal();
  assert.deepEqual(fixture.calls, callsAfterCancellation);
  assert.equal(fixture.state.clocks, 0);
  assert.equal(ownedCount(fixture.owned), 0);
  const result = await observed;
  exactUnavailable(result);
  assert.equal(fulfillments, 1);
  assert.equal(rejections.length, 0);
  assert.deepEqual(fixture.calls, [...callsAfterCancellation, "scheduleTimeout", "startTransport"]);
  fixture.state.complete(responseFor());
  const recoveredResult = await recovered;
  exactAvailable(recoveredResult, "public");
  assert.notEqual(result, recoveredResult);
  assert.deepEqual(fixture.calls, [...callsAfterCancellation,
    "scheduleTimeout", "startTransport", "readPostResponseTime", "cancelTransport", "cancelTimeout"]);
  assert.equal(fixture.state.clocks, 1);
  assert.equal(ownedCount(fixture.owned), 0);
});

selectedTest("C023", "completion before cancellation keeps completion", async () => {
  const rejections = [];
  let fulfillments = 0;
  const cancellation = Object.freeze(Object.create(null));
  let firstComplete;
  let firstCancel;
  let fixture;
  fixture = createFixture({
    startTransport(snapshot, complete, token) {
      fixture.calls.push("startTransport");
      fixture.state.starts += 1;
      fixture.state.snapshot = snapshot;
      fixture.state.complete = complete;
      fixture.state.token = token;
      fixture.owned.transport.add(token);
      if (fixture.state.starts === 1) {
        firstComplete = complete;
        firstCancel = fixture.state.cancel;
        complete(responseFor());
        firstCancel();
      }
    }
  });
  const pending = fixture.controller.request(
    structuredClone(BASE_EXPECTATION), structuredClone(BASE_AUTHORITY), cancellation
  );
  if (fixture.state.clocks !== 1) {
    throw new Error("M7T4B_MISSING_C023_COMPLETION_BEFORE_CANCEL");
  }
  const callsAfterCompletion = [...fixture.calls];
  let recovered;
  const observed = pending.then(
    (result) => {
      fulfillments += 1;
      exactAvailable(result, "public");
      assert.equal(ownedCount(fixture.owned), 0);
      recovered = fixture.controller.request(
        structuredClone(BASE_EXPECTATION), structuredClone(BASE_AUTHORITY)
      );
      assert.equal(fixture.state.starts, 2);
      return result;
    },
    (error) => { rejections.push(error); return error; }
  );
  firstCancel();
  firstComplete(responseFor("door", "private"));
  firstCancel();
  assert.deepEqual(fixture.calls, callsAfterCompletion);
  assert.equal(ownedCount(fixture.owned), 0);
  const result = await observed;
  exactAvailable(result, "public");
  assert.equal(fulfillments, 1);
  assert.equal(rejections.length, 0);
  assert.deepEqual(callsAfterCompletion, [
    "subscribeCancellation", "isCancellationRequested", "scheduleTimeout", "startTransport",
    "readPostResponseTime", "cancelTransport", "cancelTimeout", "unsubscribeCancellation"
  ]);
  assert.equal(fixture.state.clocks, 1);
  assert.deepEqual(fixture.calls, [...callsAfterCompletion, "scheduleTimeout", "startTransport"]);
  fixture.state.complete(responseFor());
  const recoveredResult = await recovered;
  exactAvailable(recoveredResult, "public");
  assert.notEqual(result, recoveredResult);
  assert.deepEqual(fixture.calls, [...callsAfterCompletion,
    "scheduleTimeout", "startTransport", "readPostResponseTime", "cancelTransport", "cancelTimeout"]);
  assert.equal(fixture.state.clocks, 2);
  assert.equal(ownedCount(fixture.owned), 0);
});

selectedTest("C025", "timeout before cancellation keeps timeout", async () => {
  const rejections = [];
  let fulfillments = 0;
  const cancellation = Object.freeze(Object.create(null));
  let firstSequence = true;
  let firstTimeout;
  let firstCancel;
  let fixture;
  fixture = createFixture({
    scheduleTimeout(token, timeoutMs, timeout) {
      fixture.calls.push("scheduleTimeout");
      fixture.state.timeoutMs = timeoutMs;
      fixture.state.timeout = timeout;
      fixture.owned.timeout.add(token);
      if (firstSequence) {
        firstSequence = false;
        firstTimeout = timeout;
        firstCancel = fixture.state.cancel;
        timeout();
        firstCancel();
      }
    }
  });
  const pending = fixture.controller.request(
    structuredClone(BASE_EXPECTATION), structuredClone(BASE_AUTHORITY), cancellation
  );
  const timeoutTerminalPresent = fixture.state.starts === 0 && fixture.state.complete === null &&
    fixture.state.clocks === 0 && ownedCount(fixture.owned) === 0 &&
    JSON.stringify(fixture.calls) === JSON.stringify([
      "subscribeCancellation", "isCancellationRequested", "scheduleTimeout",
      "cancelTimeout", "unsubscribeCancellation"
    ]);
  if (!timeoutTerminalPresent) {
    throw new Error("M7T4B_MISSING_C025_TIMEOUT_BEFORE_CANCEL");
  }
  const callsAfterTimeout = [...fixture.calls];
  let recovered;
  const observed = pending.then(
    (result) => {
      fulfillments += 1;
      exactUnavailable(result);
      assert.equal(ownedCount(fixture.owned), 0);
      recovered = fixture.controller.request(
        structuredClone(BASE_EXPECTATION), structuredClone(BASE_AUTHORITY)
      );
      assert.equal(fixture.state.starts, 1);
      return result;
    },
    (error) => { rejections.push(error); return error; }
  );
  firstCancel();
  firstTimeout();
  fixture.state.complete?.(responseFor("door", "private"));
  firstCancel();
  assert.deepEqual(fixture.calls, callsAfterTimeout);
  assert.equal(fixture.state.clocks, 0);
  assert.equal(ownedCount(fixture.owned), 0);
  const result = await observed;
  exactUnavailable(result);
  assert.equal(fulfillments, 1);
  assert.equal(rejections.length, 0);
  assert.deepEqual(fixture.calls, [...callsAfterTimeout, "scheduleTimeout", "startTransport"]);
  fixture.state.complete(responseFor());
  const recoveredResult = await recovered;
  exactAvailable(recoveredResult, "public");
  assert.notEqual(result, recoveredResult);
  assert.deepEqual(fixture.calls, [...callsAfterTimeout,
    "scheduleTimeout", "startTransport", "readPostResponseTime", "cancelTransport", "cancelTimeout"]);
  assert.equal(fixture.state.clocks, 1);
  assert.equal(ownedCount(fixture.owned), 0);
});

selectedTest("C011", "post-response clock failure is contained", async () => {
  const failureCases = [
    () => { throw new Error("clock route token tenant subject authority provider reason"); },
    () => Number.NaN
  ];
  const failureResults = [];
  const recoveryResults = [];
  for (const failClock of failureCases) {
    const cancellation = Object.freeze(Object.create(null));
    const responseObservations = [];
    const acceptedResponse = new Proxy(responseFor(), {
      getPrototypeOf(target) {
        responseObservations.push("getPrototypeOf");
        return Reflect.getPrototypeOf(target);
      },
      ownKeys(target) {
        responseObservations.push("ownKeys");
        return Reflect.ownKeys(target);
      },
      getOwnPropertyDescriptor(target, key) {
        responseObservations.push(`descriptor:${String(key)}`);
        return Reflect.getOwnPropertyDescriptor(target, key);
      },
      get(target, key, receiver) {
        responseObservations.push(`get:${String(key)}`);
        return Reflect.get(target, key, receiver);
      }
    });
    let firstClock = true;
    const fixture = createFixture({
      readPostResponseTime() {
        fixture.calls.push("readPostResponseTime");
        fixture.state.clocks += 1;
        if (firstClock) {
          firstClock = false;
          return failClock();
        }
        return TRUSTED_MS;
      }
    });
    const pending = fixture.controller.request(
      structuredClone(BASE_EXPECTATION), structuredClone(BASE_AUTHORITY), cancellation
    );
    const completeOriginal = fixture.state.complete;
    const timeoutOriginal = fixture.state.timeout;
    const cancelOriginal = fixture.state.cancel;
    let recovered;
    let terminalResponseObservations;
    const observedSettlement = pending.then(
      (result) => {
        assert.deepEqual(responseObservations, terminalResponseObservations);
        assert.equal(ownedCount(fixture.owned), 0);
        recovered = fixture.controller.request(
          structuredClone(BASE_EXPECTATION), structuredClone(BASE_AUTHORITY)
        );
        assert.equal(fixture.state.starts, 2);
        assert.deepEqual(responseObservations, terminalResponseObservations);
        return { kind: "fulfilled", result };
      },
      (error) => ({ kind: "rejected", error })
    );
    completeOriginal(acceptedResponse);
    const callsAfterFailure = [...fixture.calls];
    const ownedAfterFailure = ownedCount(fixture.owned);
    terminalResponseObservations = [...responseObservations];
    const settlement = await observedSettlement;
    const clockFailureContained = settlement.kind === "fulfilled" &&
      Reflect.ownKeys(settlement.result).length === 1 && settlement.result.status === "unavailable" &&
      Object.getPrototypeOf(settlement.result) === null && Object.isFrozen(settlement.result) &&
      JSON.stringify(callsAfterFailure) === JSON.stringify([
        "subscribeCancellation", "isCancellationRequested", "scheduleTimeout", "startTransport",
        "readPostResponseTime", "cancelTransport", "cancelTimeout", "unsubscribeCancellation"
      ]) && ownedAfterFailure === 0;
    if (!clockFailureContained) {
      throw new Error("M7T4B_MISSING_C011_CLOCK_FAILURE");
    }
    exactUnavailable(settlement.result);
    failureResults.push(settlement.result);
    const callsAfterReaction = [...fixture.calls];
    completeOriginal(responseFor("door", "private"));
    timeoutOriginal();
    cancelOriginal();
    assert.deepEqual(fixture.calls, callsAfterReaction);
    assert.deepEqual(responseObservations, terminalResponseObservations);
    assert.equal(fixture.state.clocks, 1);
    assert.equal(ownedCount(fixture.owned), 2);
    fixture.state.complete(responseFor());
    const recoveredResult = await recovered;
    exactAvailable(recoveredResult, "public");
    assert.notEqual(settlement.result, recoveredResult);
    recoveryResults.push(recoveredResult);
    assert.deepEqual(responseObservations, terminalResponseObservations);
    assert.deepEqual(fixture.calls, [...callsAfterFailure,
      "scheduleTimeout", "startTransport", "readPostResponseTime", "cancelTransport", "cancelTimeout"]);
    assert.equal(fixture.state.clocks, 2);
    assert.equal(ownedCount(fixture.owned), 0);
  }
  assert.notEqual(failureResults[0], failureResults[1]);
  assert.notEqual(recoveryResults[0], recoveryResults[1]);
});

selectedTest("C012", "subscription acquisition throw is contained", async () => {
  const subscribeSecret = "subscribe route token tenant subject authority provider reason";
  const cleanupSecret = "unsubscribe cleanup detail must not leak";
  const returningCancellation = Object.freeze(Object.create(null));
  const returningExpectation = structuredClone(BASE_EXPECTATION);
  const returningAuthority = structuredClone(BASE_AUTHORITY);
  let returningCancel;
  let returningUnsubscribeAttempts = 0;
  let returningTimerAttempts = 0;
  let returningTransportAttempts = 0;
  let returning;
  returning = createFixture({
    subscribeCancellation(value, token, cancel) {
      returning.calls.push("subscribeCancellation");
      returning.state.cancellation = value;
      returning.state.cancel = cancel;
      returning.owned.cancellation.add(token);
      returningCancel = cancel;
      cancel();
    },
    unsubscribeCancellation(token) {
      returning.calls.push("unsubscribeCancellation");
      returningUnsubscribeAttempts += 1;
      returning.owned.cancellation.delete(token);
      throw new Error(cleanupSecret);
    },
    scheduleTimeout(token, timeoutMs, timeout) {
      returningTimerAttempts += 1;
      returning.calls.push("scheduleTimeout");
      returning.state.timeoutMs = timeoutMs;
      returning.state.timeout = timeout;
      returning.owned.timeout.add(token);
    },
    startTransport(snapshot, complete, token) {
      returningTransportAttempts += 1;
      returning.calls.push("startTransport");
      returning.state.starts += 1;
      returning.state.snapshot = snapshot;
      returning.state.complete = complete;
      returning.state.token = token;
      returning.owned.transport.add(token);
    }
  });
  const returningPriorUnavailable = await returning.controller.request();
  const returningPending = returning.controller.request(
    returningExpectation, returningAuthority, returningCancellation
  );
  let returningRecovery;
  const returningSettlement = await returningPending.then(
    (result) => {
      const terminal = {
        calls: [...returning.calls],
        starts: returning.state.starts,
        clocks: returning.state.clocks,
        timeout: returning.state.timeout,
        complete: returning.state.complete,
        owned: ownedCount(returning.owned)
      };
      returningRecovery = returning.controller.request(
        structuredClone(BASE_EXPECTATION), structuredClone(BASE_AUTHORITY)
      );
      return {
        kind: "fulfilled", result, terminal, recoveryStarts: returning.state.starts,
        timerAttempts: returningTimerAttempts, transportAttempts: returningTransportAttempts,
        ownedAfterRecoveryAdmission: ownedCount(returning.owned)
      };
    },
    (error) => ({ kind: "rejected", error })
  );
  const returningPostTerminalContained = returningSettlement.kind === "fulfilled" &&
    JSON.stringify(returningSettlement.terminal.calls) === JSON.stringify([
      "subscribeCancellation", "unsubscribeCancellation"
    ]) && returningSettlement.terminal.starts === 0 && returningSettlement.terminal.clocks === 0 &&
    returningSettlement.terminal.timeout === null && returningSettlement.terminal.complete === null &&
    returningSettlement.terminal.owned === 0 && returningSettlement.recoveryStarts === 1 &&
    returningSettlement.timerAttempts === 1 && returningSettlement.transportAttempts === 1 &&
    returningSettlement.ownedAfterRecoveryAdmission === 2;
  if (!returningPostTerminalContained) {
    throw new Error("M7T4B_C012_POST_TERMINAL_ACQUISITION_LEAK");
  }
  exactUnavailable(returningSettlement.result);
  exactUnavailable(returningPriorUnavailable);
  assert.notEqual(returningSettlement.result, returningPriorUnavailable);
  assert.equal(returningUnsubscribeAttempts, 1);
  assert.equal(JSON.stringify(returningSettlement.result).includes(cleanupSecret), false);
  assert.deepEqual(returningExpectation, BASE_EXPECTATION);
  assert.deepEqual(returningAuthority, BASE_AUTHORITY);
  assert.deepEqual(Reflect.ownKeys(returningCancellation), []);
  const returningCallsAfterReaction = [...returning.calls];
  returningCancel();
  returningCancel();
  await Promise.resolve();
  assert.deepEqual(returning.calls, returningCallsAfterReaction);
  assert.equal(returningUnsubscribeAttempts, 1);
  assert.equal(ownedCount(returning.owned), 2);
  returning.state.complete(responseFor());
  const returningRecoveredResult = await returningRecovery;
  exactAvailable(returningRecoveredResult, "public");
  assert.notEqual(returningSettlement.result, returningRecoveredResult);
  assert.equal(ownedCount(returning.owned), 0);
  const compoundCancellation = Object.freeze(Object.create(null));
  const compoundExpectation = structuredClone(BASE_EXPECTATION);
  const compoundAuthority = structuredClone(BASE_AUTHORITY);
  let compoundCancel;
  let compoundUnsubscribeAttempts = 0;
  let compound;
  compound = createFixture({
    subscribeCancellation(value, token, cancel) {
      compound.calls.push("subscribeCancellation");
      compound.state.cancellation = value;
      compound.state.cancel = cancel;
      compound.owned.cancellation.add(token);
      compoundCancel = cancel;
      cancel();
      throw new Error(subscribeSecret);
    },
    unsubscribeCancellation(token) {
      compound.calls.push("unsubscribeCancellation");
      compoundUnsubscribeAttempts += 1;
      compound.owned.cancellation.delete(token);
      throw new Error(cleanupSecret);
    }
  });
  const compoundPriorUnavailable = await compound.controller.request();
  const compoundPending = compound.controller.request(
    compoundExpectation, compoundAuthority, compoundCancellation
  );
  let compoundSettlement;
  let compoundRecovery;
  const compoundObserved = compoundPending.then(
    (result) => {
      const terminal = {
        calls: [...compound.calls],
        starts: compound.state.starts,
        clocks: compound.state.clocks,
        timeout: compound.state.timeout,
        complete: compound.state.complete,
        owned: ownedCount(compound.owned)
      };
      compoundRecovery = compound.controller.request(
        structuredClone(BASE_EXPECTATION), structuredClone(BASE_AUTHORITY)
      );
      compoundSettlement = {
        kind: "fulfilled", result, terminal, recoveryStarts: compound.state.starts
      };
      return compoundSettlement;
    },
    (error) => {
      compoundSettlement = { kind: "rejected", error };
      return compoundSettlement;
    }
  );
  await Promise.resolve();
  if (compoundSettlement === undefined) {
    throw new Error("M7T4B_C012_COMPOUND_ACQUISITION_SETTLEMENT_PENDING");
  }
  const compoundResult = await compoundObserved;
  assert.equal(compoundResult.kind, "fulfilled");
  exactUnavailable(compoundResult.result);
  exactUnavailable(compoundPriorUnavailable);
  assert.notEqual(compoundResult.result, compoundPriorUnavailable);
  assert.deepEqual(compoundResult.terminal, {
    calls: ["subscribeCancellation", "unsubscribeCancellation"],
    starts: 0,
    clocks: 0,
    timeout: null,
    complete: null,
    owned: 0
  });
  assert.equal(compoundResult.recoveryStarts, 1);
  assert.equal(compoundUnsubscribeAttempts, 1);
  assert.equal(JSON.stringify(compoundResult.result).includes(subscribeSecret), false);
  assert.equal(JSON.stringify(compoundResult.result).includes(cleanupSecret), false);
  assert.deepEqual(compoundExpectation, BASE_EXPECTATION);
  assert.deepEqual(compoundAuthority, BASE_AUTHORITY);
  assert.deepEqual(Reflect.ownKeys(compoundCancellation), []);
  const compoundCallsAfterReaction = [...compound.calls];
  compoundCancel();
  compoundCancel();
  await Promise.resolve();
  assert.deepEqual(compound.calls, compoundCallsAfterReaction);
  assert.equal(compoundUnsubscribeAttempts, 1);
  assert.equal(ownedCount(compound.owned), 2);
  compound.state.complete(responseFor());
  const compoundRecoveredResult = await compoundRecovery;
  exactAvailable(compoundRecoveredResult, "public");
  assert.notEqual(compoundResult.result, compoundRecoveredResult);
  assert.equal(ownedCount(compound.owned), 0);
  const probeCancellation = Object.freeze(Object.create(null));
  let probe;
  probe = createFixture({
    subscribeCancellation(_value, token) {
      probe.calls.push("subscribeCancellation");
      probe.owned.cancellation.add(token);
      throw new Error(subscribeSecret);
    },
    unsubscribeCancellation(token) {
      probe.calls.push("unsubscribeCancellation");
      probe.owned.cancellation.delete(token);
      throw new Error(cleanupSecret);
    }
  });
  const probePending = probe.controller.request(
    structuredClone(BASE_EXPECTATION), structuredClone(BASE_AUTHORITY), probeCancellation
  );
  const probeSettlement = probePending.then(
    (result) => ({ kind: "fulfilled", result }),
    (error) => ({ kind: "rejected", error })
  );
  const probeRecovery = probe.controller.request(
    structuredClone(BASE_EXPECTATION), structuredClone(BASE_AUTHORITY)
  );
  const primaryPresent = probe.state.starts === 1 && ownedCount(probe.owned) === 2 &&
    JSON.stringify(probe.calls) === JSON.stringify([
      "subscribeCancellation", "unsubscribeCancellation", "scheduleTimeout", "startTransport"
    ]);
  if (!primaryPresent) {
    throw new Error("M7T4B_MISSING_C012_SUBSCRIBE_THROW");
  }
  const firstProbeSettlement = await probeSettlement;
  assert.equal(firstProbeSettlement.kind, "fulfilled");
  exactUnavailable(firstProbeSettlement.result);
  probe.state.complete(responseFor());
  exactAvailable(await probeRecovery, "public");
  assert.equal(ownedCount(probe.owned), 0);
  const cancellation = Object.freeze(Object.create(null));
  const expectation = structuredClone(BASE_EXPECTATION);
  const authority = structuredClone(BASE_AUTHORITY);
  let cancelOriginal;
  let unsubscribeAttempts = 0;
  let fixture;
  fixture = createFixture({
    subscribeCancellation(value, token, cancel) {
      fixture.calls.push("subscribeCancellation");
      fixture.state.cancellation = value;
      fixture.state.cancel = cancel;
      fixture.owned.cancellation.add(token);
      cancelOriginal = cancel;
      assert.equal(value, cancellation);
      throw new Error(subscribeSecret);
    },
    unsubscribeCancellation(token) {
      fixture.calls.push("unsubscribeCancellation");
      unsubscribeAttempts += 1;
      fixture.owned.cancellation.delete(token);
      throw new Error(cleanupSecret);
    }
  });
  const priorUnavailable = await fixture.controller.request();
  const pending = fixture.controller.request(expectation, authority, cancellation);
  let recovered;
  const settlement = await pending.then(
    (result) => {
      const terminal = {
        calls: [...fixture.calls],
        starts: fixture.state.starts,
        clocks: fixture.state.clocks,
        timeout: fixture.state.timeout,
        complete: fixture.state.complete,
        owned: ownedCount(fixture.owned)
      };
      recovered = fixture.controller.request(
        structuredClone(BASE_EXPECTATION), structuredClone(BASE_AUTHORITY)
      );
      return { kind: "fulfilled", result, terminal, recoveryStarts: fixture.state.starts };
    },
    (error) => ({ kind: "rejected", error })
  );
  const acquisitionThrowContained = settlement.kind === "fulfilled" &&
    JSON.stringify(settlement.terminal.calls) === JSON.stringify([
      "subscribeCancellation", "unsubscribeCancellation"
    ]) && settlement.terminal.starts === 0 && settlement.terminal.clocks === 0 &&
    settlement.terminal.timeout === null && settlement.terminal.complete === null &&
    settlement.terminal.owned === 0 && unsubscribeAttempts === 1 && settlement.recoveryStarts === 1;
  assert.equal(acquisitionThrowContained, true);
  exactUnavailable(settlement.result);
  exactUnavailable(priorUnavailable);
  assert.notEqual(settlement.result, priorUnavailable);
  assert.equal(JSON.stringify(settlement.result).includes(subscribeSecret), false);
  assert.equal(JSON.stringify(settlement.result).includes(cleanupSecret), false);
  assert.deepEqual(expectation, BASE_EXPECTATION);
  assert.deepEqual(authority, BASE_AUTHORITY);
  assert.deepEqual(Reflect.ownKeys(cancellation), []);
  const callsAfterReaction = [...fixture.calls];
  const ownedAfterReaction = ownedCount(fixture.owned);
  cancelOriginal();
  cancelOriginal();
  await Promise.resolve();
  assert.deepEqual(fixture.calls, callsAfterReaction);
  assert.equal(unsubscribeAttempts, 1);
  assert.equal(ownedCount(fixture.owned), ownedAfterReaction);
  fixture.state.complete(responseFor());
  const recoveredResult = await recovered;
  exactAvailable(recoveredResult, "public");
  assert.notEqual(settlement.result, recoveredResult);
  assert.deepEqual(fixture.calls, [
    "subscribeCancellation", "unsubscribeCancellation", "scheduleTimeout", "startTransport",
    "readPostResponseTime", "cancelTransport", "cancelTimeout"
  ]);
  assert.equal(fixture.state.clocks, 1);
  assert.equal(ownedCount(fixture.owned), 0);
});

selectedTest("C013", "initial cancellation check throw is contained", async () => {
  const cancellation = Object.freeze(Object.create(null));
  const expectation = structuredClone(BASE_EXPECTATION);
  const authority = structuredClone(BASE_AUTHORITY);
  const checkSecret = "cancellation check route token tenant subject authority provider reason";
  const rejections = [];
  let cancellationChecks = 0;
  let unsubscribeAttempts = 0;
  let timerAttempts = 0;
  let transportAttempts = 0;
  let cancelOriginal;
  let fixture;
  fixture = createFixture({
    subscribeCancellation(value, token, cancel) {
      fixture.calls.push("subscribeCancellation");
      fixture.state.cancellation = value;
      fixture.state.cancel = cancel;
      fixture.owned.cancellation.add(token);
      cancelOriginal = cancel;
    },
    isCancellationRequested(value) {
      fixture.calls.push("isCancellationRequested");
      cancellationChecks += 1;
      assert.equal(value, cancellation);
      assert.equal(fixture.owned.cancellation.size, 1);
      throw new Error(checkSecret);
    },
    unsubscribeCancellation(token) {
      fixture.calls.push("unsubscribeCancellation");
      unsubscribeAttempts += 1;
      fixture.owned.cancellation.delete(token);
    },
    scheduleTimeout(token, timeoutMs, timeout) {
      timerAttempts += 1;
      fixture.calls.push("scheduleTimeout");
      fixture.state.timeoutMs = timeoutMs;
      fixture.state.timeout = timeout;
      fixture.owned.timeout.add(token);
    },
    startTransport(snapshot, complete, token) {
      transportAttempts += 1;
      fixture.calls.push("startTransport");
      fixture.state.starts += 1;
      fixture.state.snapshot = snapshot;
      fixture.state.complete = complete;
      fixture.state.token = token;
      fixture.owned.transport.add(token);
    }
  });
  const priorUnavailable = await fixture.controller.request();
  const pending = fixture.controller.request(expectation, authority, cancellation);
  let recovered;
  const settlement = await pending.then(
    (result) => {
      const terminal = {
        calls: [...fixture.calls],
        starts: fixture.state.starts,
        clocks: fixture.state.clocks,
        timeout: fixture.state.timeout,
        complete: fixture.state.complete,
        owned: ownedCount(fixture.owned)
      };
      recovered = fixture.controller.request(
        structuredClone(BASE_EXPECTATION), structuredClone(BASE_AUTHORITY)
      );
      return {
        kind: "fulfilled", result, terminal, recoveryStarts: fixture.state.starts,
        timerAttempts, transportAttempts, ownedAfterRecoveryAdmission: ownedCount(fixture.owned)
      };
    },
    (error) => {
      rejections.push(error);
      return { kind: "rejected", error };
    }
  );
  const cancellationCheckThrowContained = settlement.kind === "fulfilled" &&
    JSON.stringify(settlement.terminal.calls) === JSON.stringify([
      "subscribeCancellation", "isCancellationRequested", "unsubscribeCancellation"
    ]) && settlement.terminal.starts === 0 && settlement.terminal.clocks === 0 &&
    settlement.terminal.timeout === null && settlement.terminal.complete === null &&
    settlement.terminal.owned === 0 && cancellationChecks === 1 && unsubscribeAttempts === 1 &&
    settlement.recoveryStarts === 1 && settlement.timerAttempts === 1 &&
    settlement.transportAttempts === 1 && settlement.ownedAfterRecoveryAdmission === 2;
  if (!cancellationCheckThrowContained) {
    throw new Error("M7T4B_MISSING_C013_CANCELLATION_CHECK_THROW");
  }
  exactUnavailable(settlement.result);
  exactUnavailable(priorUnavailable);
  assert.notEqual(settlement.result, priorUnavailable);
  assert.equal(rejections.length, 0);
  assert.equal(JSON.stringify(settlement.result).includes(checkSecret), false);
  assert.deepEqual(expectation, BASE_EXPECTATION);
  assert.deepEqual(authority, BASE_AUTHORITY);
  assert.deepEqual(Reflect.ownKeys(cancellation), []);
  const callsAfterReaction = [...fixture.calls];
  cancelOriginal();
  cancelOriginal();
  await Promise.resolve();
  assert.deepEqual(fixture.calls, callsAfterReaction);
  assert.equal(cancellationChecks, 1);
  assert.equal(unsubscribeAttempts, 1);
  assert.equal(ownedCount(fixture.owned), 2);
  fixture.state.complete(responseFor());
  const recoveredResult = await recovered;
  exactAvailable(recoveredResult, "public");
  assert.notEqual(settlement.result, recoveredResult);
  assert.deepEqual(fixture.calls, [
    "subscribeCancellation", "isCancellationRequested", "unsubscribeCancellation",
    "scheduleTimeout", "startTransport", "readPostResponseTime", "cancelTransport", "cancelTimeout"
  ]);
  assert.equal(fixture.state.clocks, 1);
  assert.equal(ownedCount(fixture.owned), 0);
});

selectedTest("C014", "timeout acquisition throw is contained", async () => {
  const cancellation = Object.freeze(Object.create(null));
  const expectation = structuredClone(BASE_EXPECTATION);
  const authority = structuredClone(BASE_AUTHORITY);
  const scheduleSecret = "timeout schedule route token tenant subject authority provider reason";
  const timeoutCleanupSecret = "timeout cleanup detail must not leak";
  const cancellationCleanupSecret = "cancellation cleanup detail must not leak";
  const rejections = [];
  let cancellationChecks = 0;
  let timeoutAttempts = 0;
  let timeoutCancelAttempts = 0;
  let unsubscribeAttempts = 0;
  let transportAttempts = 0;
  let cancelOriginal;
  let timeoutOriginal;
  let failedToken;
  let fixture;
  fixture = createFixture({
    subscribeCancellation(value, token, cancel) {
      fixture.calls.push("subscribeCancellation");
      fixture.state.cancellation = value;
      fixture.state.cancel = cancel;
      fixture.owned.cancellation.add(token);
      cancelOriginal = cancel;
    },
    isCancellationRequested(value) {
      fixture.calls.push("isCancellationRequested");
      cancellationChecks += 1;
      assert.equal(value, cancellation);
      assert.equal(fixture.owned.cancellation.size, 1);
      return false;
    },
    scheduleTimeout(token, timeoutMs, timeout) {
      timeoutAttempts += 1;
      fixture.calls.push("scheduleTimeout");
      fixture.state.timeoutMs = timeoutMs;
      fixture.state.timeout = timeout;
      fixture.owned.timeout.add(token);
      if (timeoutAttempts === 1) {
        failedToken = token;
        timeoutOriginal = timeout;
        throw new Error(scheduleSecret);
      }
    },
    cancelTimeout(token) {
      fixture.calls.push("cancelTimeout");
      fixture.owned.timeout.delete(token);
      if (token === failedToken) {
        timeoutCancelAttempts += 1;
        throw new Error(timeoutCleanupSecret);
      }
    },
    unsubscribeCancellation(token) {
      fixture.calls.push("unsubscribeCancellation");
      fixture.owned.cancellation.delete(token);
      if (token === failedToken) {
        unsubscribeAttempts += 1;
        throw new Error(cancellationCleanupSecret);
      }
    },
    startTransport(snapshot, complete, token) {
      transportAttempts += 1;
      fixture.calls.push("startTransport");
      fixture.state.starts += 1;
      fixture.state.snapshot = snapshot;
      fixture.state.complete = complete;
      fixture.state.token = token;
      fixture.owned.transport.add(token);
    }
  });
  let probe;
  probe = createFixture({
    subscribeCancellation(_value, token) {
      probe.calls.push("subscribeCancellation");
      probe.owned.cancellation.add(token);
    },
    isCancellationRequested() {
      probe.calls.push("isCancellationRequested");
      return false;
    },
    scheduleTimeout(token) {
      probe.calls.push("scheduleTimeout");
      probe.owned.timeout.add(token);
      throw new Error(scheduleSecret);
    },
    cancelTimeout(token) {
      probe.calls.push("cancelTimeout");
      probe.owned.timeout.delete(token);
      throw new Error(timeoutCleanupSecret);
    },
    unsubscribeCancellation(token) {
      probe.calls.push("unsubscribeCancellation");
      probe.owned.cancellation.delete(token);
      throw new Error(cancellationCleanupSecret);
    }
  });
  const probePending = probe.controller.request(
    structuredClone(BASE_EXPECTATION), structuredClone(BASE_AUTHORITY), Object.freeze(Object.create(null))
  );
  void probePending.catch(() => {});
  const primaryPresent = JSON.stringify(probe.calls) === JSON.stringify([
    "subscribeCancellation", "isCancellationRequested", "scheduleTimeout",
    "cancelTimeout", "unsubscribeCancellation"
  ]) && probe.state.starts === 0 && ownedCount(probe.owned) === 0;
  if (!primaryPresent) {
    throw new Error("M7T4B_MISSING_C014_SCHEDULE_THROW");
  }
  exactUnavailable(await probePending);
  const priorUnavailable = await fixture.controller.request();
  const pending = fixture.controller.request(expectation, authority, cancellation);
  let recovered;
  const settlement = await pending.then(
    (result) => {
      const terminal = {
        calls: [...fixture.calls],
        starts: fixture.state.starts,
        clocks: fixture.state.clocks,
        complete: fixture.state.complete,
        owned: ownedCount(fixture.owned)
      };
      recovered = fixture.controller.request(
        structuredClone(BASE_EXPECTATION), structuredClone(BASE_AUTHORITY)
      );
      return {
        kind: "fulfilled", result, terminal, recoveryStarts: fixture.state.starts,
        ownedAfterRecoveryAdmission: ownedCount(fixture.owned)
      };
    },
    (error) => {
      rejections.push(error);
      return { kind: "rejected", error };
    }
  );
  const scheduleThrowContained = settlement.kind === "fulfilled" &&
    JSON.stringify(settlement.terminal.calls) === JSON.stringify([
      "subscribeCancellation", "isCancellationRequested", "scheduleTimeout",
      "cancelTimeout", "unsubscribeCancellation"
    ]) && settlement.terminal.starts === 0 && settlement.terminal.clocks === 0 &&
    settlement.terminal.complete === null && settlement.terminal.owned === 0 &&
    cancellationChecks === 1 && timeoutAttempts === 2 && timeoutCancelAttempts === 1 &&
    unsubscribeAttempts === 1 && transportAttempts === 1 && settlement.recoveryStarts === 1 &&
    settlement.ownedAfterRecoveryAdmission === 2;
  if (!scheduleThrowContained) throw new Error("C014 timeout acquisition containment regression");
  exactUnavailable(settlement.result);
  exactUnavailable(priorUnavailable);
  assert.notEqual(settlement.result, priorUnavailable);
  assert.equal(rejections.length, 0);
  assert.equal(JSON.stringify(settlement.result).includes(scheduleSecret), false);
  assert.equal(JSON.stringify(settlement.result).includes(timeoutCleanupSecret), false);
  assert.equal(JSON.stringify(settlement.result).includes(cancellationCleanupSecret), false);
  assert.deepEqual(expectation, BASE_EXPECTATION);
  assert.deepEqual(authority, BASE_AUTHORITY);
  assert.deepEqual(Reflect.ownKeys(cancellation), []);
  const callsAfterReaction = [...fixture.calls];
  cancelOriginal();
  cancelOriginal();
  timeoutOriginal();
  timeoutOriginal();
  await Promise.resolve();
  assert.deepEqual(fixture.calls, callsAfterReaction);
  assert.equal(cancellationChecks, 1);
  assert.equal(timeoutCancelAttempts, 1);
  assert.equal(unsubscribeAttempts, 1);
  assert.equal(ownedCount(fixture.owned), 2);
  fixture.state.complete(responseFor());
  const recoveredResult = await recovered;
  exactAvailable(recoveredResult, "public");
  assert.notEqual(settlement.result, recoveredResult);
  assert.deepEqual(fixture.calls, [
    "subscribeCancellation", "isCancellationRequested", "scheduleTimeout",
    "cancelTimeout", "unsubscribeCancellation", "scheduleTimeout", "startTransport",
    "readPostResponseTime", "cancelTransport", "cancelTimeout"
  ]);
  assert.equal(fixture.state.clocks, 1);
  assert.equal(ownedCount(fixture.owned), 0);
});

selectedTest("C015", "transport acquisition throw is contained", async () => {
  const cancellation = Object.freeze(Object.create(null));
  const expectation = structuredClone(BASE_EXPECTATION);
  const authority = structuredClone(BASE_AUTHORITY);
  const startSecret = "transport start route token tenant subject authority provider reason";
  const transportCleanupSecret = "transport cleanup detail must not leak";
  const timeoutCleanupSecret = "timeout cleanup detail must not leak";
  const cancellationCleanupSecret = "cancellation cleanup detail must not leak";
  const rejections = [];
  let cancellationChecks = 0;
  let transportAttempts = 0;
  let transportCancelAttempts = 0;
  let timeoutCancelAttempts = 0;
  let unsubscribeAttempts = 0;
  let completeOriginal;
  let timeoutOriginal;
  let cancelOriginal;
  let failedToken;
  let fixture;
  fixture = createFixture({
    subscribeCancellation(value, token, cancel) {
      fixture.calls.push("subscribeCancellation");
      fixture.state.cancellation = value;
      fixture.state.cancel = cancel;
      fixture.owned.cancellation.add(token);
      cancelOriginal = cancel;
    },
    isCancellationRequested(value) {
      fixture.calls.push("isCancellationRequested");
      cancellationChecks += 1;
      assert.equal(value, cancellation);
      assert.equal(fixture.owned.cancellation.size, 1);
      return false;
    },
    scheduleTimeout(token, timeoutMs, timeout) {
      fixture.calls.push("scheduleTimeout");
      fixture.state.timeoutMs = timeoutMs;
      fixture.state.timeout = timeout;
      fixture.owned.timeout.add(token);
      if (timeoutOriginal === undefined) timeoutOriginal = timeout;
    },
    startTransport(snapshot, complete, token) {
      fixture.calls.push("startTransport");
      fixture.state.starts += 1;
      fixture.state.snapshot = snapshot;
      fixture.state.complete = complete;
      fixture.state.token = token;
      fixture.owned.transport.add(token);
      transportAttempts += 1;
      if (transportAttempts === 1) {
        failedToken = token;
        completeOriginal = complete;
        throw new Error(startSecret);
      }
    },
    cancelTransport(token) {
      fixture.calls.push("cancelTransport");
      fixture.owned.transport.delete(token);
      if (token === failedToken) {
        transportCancelAttempts += 1;
        throw new Error(transportCleanupSecret);
      }
    },
    cancelTimeout(token) {
      fixture.calls.push("cancelTimeout");
      fixture.owned.timeout.delete(token);
      if (token === failedToken) {
        timeoutCancelAttempts += 1;
        throw new Error(timeoutCleanupSecret);
      }
    },
    unsubscribeCancellation(token) {
      fixture.calls.push("unsubscribeCancellation");
      fixture.owned.cancellation.delete(token);
      if (token === failedToken) {
        unsubscribeAttempts += 1;
        throw new Error(cancellationCleanupSecret);
      }
    }
  });
  let probe;
  probe = createFixture({
    subscribeCancellation(_value, token) {
      probe.calls.push("subscribeCancellation");
      probe.owned.cancellation.add(token);
    },
    isCancellationRequested() {
      probe.calls.push("isCancellationRequested");
      return false;
    },
    scheduleTimeout(token, _timeoutMs, timeout) {
      probe.calls.push("scheduleTimeout");
      probe.state.timeout = timeout;
      probe.owned.timeout.add(token);
    },
    startTransport(_snapshot, complete, token) {
      probe.calls.push("startTransport");
      probe.state.complete = complete;
      probe.owned.transport.add(token);
      throw new Error(startSecret);
    },
    cancelTransport(token) {
      probe.calls.push("cancelTransport");
      probe.owned.transport.delete(token);
      throw new Error(transportCleanupSecret);
    },
    cancelTimeout(token) {
      probe.calls.push("cancelTimeout");
      probe.owned.timeout.delete(token);
      throw new Error(timeoutCleanupSecret);
    },
    unsubscribeCancellation(token) {
      probe.calls.push("unsubscribeCancellation");
      probe.owned.cancellation.delete(token);
      throw new Error(cancellationCleanupSecret);
    }
  });
  const probePending = probe.controller.request(
    structuredClone(BASE_EXPECTATION), structuredClone(BASE_AUTHORITY), Object.freeze(Object.create(null))
  );
  void probePending.catch(() => {});
  const primaryPresent = JSON.stringify(probe.calls) === JSON.stringify([
    "subscribeCancellation", "isCancellationRequested", "scheduleTimeout", "startTransport",
    "cancelTransport", "cancelTimeout", "unsubscribeCancellation"
  ]) && probe.state.clocks === 0 && ownedCount(probe.owned) === 0;
  if (!primaryPresent) {
    throw new Error("M7T4B_MISSING_C015_START_THROW");
  }
  exactUnavailable(await probePending);
  const priorUnavailable = await fixture.controller.request();
  const pending = fixture.controller.request(expectation, authority, cancellation);
  let recovered;
  const settlement = await pending.then(
    (result) => {
      const terminal = {
        calls: [...fixture.calls],
        clocks: fixture.state.clocks,
        owned: ownedCount(fixture.owned)
      };
      recovered = fixture.controller.request(
        structuredClone(BASE_EXPECTATION), structuredClone(BASE_AUTHORITY)
      );
      return {
        kind: "fulfilled", result, terminal, recoveryStarts: fixture.state.starts,
        ownedAfterRecoveryAdmission: ownedCount(fixture.owned)
      };
    },
    (error) => {
      rejections.push(error);
      return { kind: "rejected", error };
    }
  );
  const startThrowContained = settlement.kind === "fulfilled" &&
    JSON.stringify(settlement.terminal.calls) === JSON.stringify([
      "subscribeCancellation", "isCancellationRequested", "scheduleTimeout", "startTransport",
      "cancelTransport", "cancelTimeout", "unsubscribeCancellation"
    ]) && settlement.terminal.clocks === 0 && settlement.terminal.owned === 0 &&
    cancellationChecks === 1 && transportAttempts === 2 && transportCancelAttempts === 1 &&
    timeoutCancelAttempts === 1 && unsubscribeAttempts === 1 && settlement.recoveryStarts === 2 &&
    settlement.ownedAfterRecoveryAdmission === 2;
  if (!startThrowContained) throw new Error("C015 transport acquisition containment regression");
  exactUnavailable(settlement.result);
  exactUnavailable(priorUnavailable);
  assert.notEqual(settlement.result, priorUnavailable);
  assert.equal(rejections.length, 0);
  assert.equal(JSON.stringify(settlement.result).includes(startSecret), false);
  assert.equal(JSON.stringify(settlement.result).includes(transportCleanupSecret), false);
  assert.equal(JSON.stringify(settlement.result).includes(timeoutCleanupSecret), false);
  assert.equal(JSON.stringify(settlement.result).includes(cancellationCleanupSecret), false);
  assert.deepEqual(expectation, BASE_EXPECTATION);
  assert.deepEqual(authority, BASE_AUTHORITY);
  assert.deepEqual(Reflect.ownKeys(cancellation), []);
  const callsAfterReaction = [...fixture.calls];
  completeOriginal(responseFor("door", "private"));
  timeoutOriginal();
  cancelOriginal();
  await Promise.resolve();
  assert.deepEqual(fixture.calls, callsAfterReaction);
  assert.equal(fixture.state.clocks, 0);
  assert.equal(transportCancelAttempts, 1);
  assert.equal(timeoutCancelAttempts, 1);
  assert.equal(unsubscribeAttempts, 1);
  assert.equal(ownedCount(fixture.owned), 2);
  fixture.state.complete(responseFor());
  const recoveredResult = await recovered;
  exactAvailable(recoveredResult, "public");
  assert.notEqual(settlement.result, recoveredResult);
  assert.deepEqual(fixture.calls, [
    "subscribeCancellation", "isCancellationRequested", "scheduleTimeout", "startTransport",
    "cancelTransport", "cancelTimeout", "unsubscribeCancellation", "scheduleTimeout", "startTransport",
    "readPostResponseTime", "cancelTransport", "cancelTimeout"
  ]);
  assert.equal(fixture.state.clocks, 1);
  assert.equal(ownedCount(fixture.owned), 0);
});

selectedTest("C016", "transport release throw downgrades and cleanup continues", async () => {
  const cancellation = Object.freeze(Object.create(null));
  const expectation = structuredClone(BASE_EXPECTATION);
  const authority = structuredClone(BASE_AUTHORITY);
  const transportCleanupSecret = "transport release route token tenant subject authority provider reason";
  const rejections = [];
  let cancellationChecks = 0;
  let transportCancelAttempts = 0;
  let timeoutCancelAttempts = 0;
  let unsubscribeAttempts = 0;
  let completeOriginal;
  let timeoutOriginal;
  let cancelOriginal;
  let failedToken;
  let fixture;
  fixture = createFixture({
    subscribeCancellation(value, token, cancel) {
      fixture.calls.push("subscribeCancellation");
      fixture.state.cancellation = value;
      fixture.state.cancel = cancel;
      fixture.owned.cancellation.add(token);
      cancelOriginal = cancel;
    },
    isCancellationRequested(value) {
      fixture.calls.push("isCancellationRequested");
      cancellationChecks += 1;
      assert.equal(value, cancellation);
      return false;
    },
    scheduleTimeout(token, timeoutMs, timeout) {
      fixture.calls.push("scheduleTimeout");
      fixture.state.timeoutMs = timeoutMs;
      fixture.state.timeout = timeout;
      fixture.owned.timeout.add(token);
      if (timeoutOriginal === undefined) timeoutOriginal = timeout;
    },
    startTransport(snapshot, complete, token) {
      fixture.calls.push("startTransport");
      fixture.state.starts += 1;
      fixture.state.snapshot = snapshot;
      fixture.state.complete = complete;
      fixture.state.token = token;
      fixture.owned.transport.add(token);
      if (fixture.state.starts === 1) {
        completeOriginal = complete;
        failedToken = token;
      }
    },
    cancelTransport(token) {
      fixture.calls.push("cancelTransport");
      fixture.owned.transport.delete(token);
      if (token === failedToken) {
        transportCancelAttempts += 1;
        throw new Error(transportCleanupSecret);
      }
    },
    cancelTimeout(token) {
      fixture.calls.push("cancelTimeout");
      fixture.owned.timeout.delete(token);
      if (token === failedToken) timeoutCancelAttempts += 1;
    },
    unsubscribeCancellation(token) {
      fixture.calls.push("unsubscribeCancellation");
      fixture.owned.cancellation.delete(token);
      if (token === failedToken) unsubscribeAttempts += 1;
    }
  });
  const priorUnavailable = await fixture.controller.request();
  const pending = fixture.controller.request(expectation, authority, cancellation);
  let recovered;
  const observed = pending.then(
    (result) => {
      const terminal = {
        calls: [...fixture.calls], clocks: fixture.state.clocks, owned: ownedCount(fixture.owned)
      };
      recovered = fixture.controller.request(
        structuredClone(BASE_EXPECTATION), structuredClone(BASE_AUTHORITY)
      );
      return {
        kind: "fulfilled", result, terminal, recoveryStarts: fixture.state.starts,
        ownedAfterRecoveryAdmission: ownedCount(fixture.owned)
      };
    },
    (error) => {
      rejections.push(error);
      return { kind: "rejected", error };
    }
  );
  let completionError;
  try { completeOriginal(responseFor("door", "private")); }
  catch (error) { completionError = error; }
  const primaryPresent = completionError === undefined &&
    JSON.stringify(fixture.calls) === JSON.stringify([
      "subscribeCancellation", "isCancellationRequested", "scheduleTimeout", "startTransport",
      "readPostResponseTime", "cancelTransport", "cancelTimeout", "unsubscribeCancellation"
    ]) && fixture.state.clocks === 1 && ownedCount(fixture.owned) === 0 &&
    transportCancelAttempts === 1 && timeoutCancelAttempts === 1 && unsubscribeAttempts === 1;
  if (!primaryPresent) {
    void observed;
    throw new Error("M7T4B_MISSING_C016_CANCEL_TRANSPORT_THROW");
  }
  const settlement = await observed;
  assert.equal(settlement.kind, "fulfilled");
  exactUnavailable(settlement.result);
  exactUnavailable(priorUnavailable);
  assert.notEqual(settlement.result, priorUnavailable);
  assert.equal(rejections.length, 0);
  assert.equal(JSON.stringify(settlement.result).includes(transportCleanupSecret), false);
  assert.deepEqual(settlement.terminal, {
    calls: [
      "subscribeCancellation", "isCancellationRequested", "scheduleTimeout", "startTransport",
      "readPostResponseTime", "cancelTransport", "cancelTimeout", "unsubscribeCancellation"
    ],
    clocks: 1,
    owned: 0
  });
  assert.equal(cancellationChecks, 1);
  assert.equal(settlement.recoveryStarts, 2);
  assert.equal(settlement.ownedAfterRecoveryAdmission, 2);
  assert.deepEqual(expectation, BASE_EXPECTATION);
  assert.deepEqual(authority, BASE_AUTHORITY);
  assert.deepEqual(Reflect.ownKeys(cancellation), []);
  const callsAfterReaction = [...fixture.calls];
  completeOriginal(responseFor("door", "tenant"));
  timeoutOriginal();
  cancelOriginal();
  await Promise.resolve();
  assert.deepEqual(fixture.calls, callsAfterReaction);
  assert.equal(fixture.state.clocks, 1);
  assert.equal(transportCancelAttempts, 1);
  assert.equal(timeoutCancelAttempts, 1);
  assert.equal(unsubscribeAttempts, 1);
  assert.equal(ownedCount(fixture.owned), 2);
  fixture.state.complete(responseFor());
  const recoveredResult = await recovered;
  exactAvailable(recoveredResult, "public");
  assert.notEqual(settlement.result, recoveredResult);
  assert.deepEqual(fixture.calls, [
    "subscribeCancellation", "isCancellationRequested", "scheduleTimeout", "startTransport",
    "readPostResponseTime", "cancelTransport", "cancelTimeout", "unsubscribeCancellation",
    "scheduleTimeout", "startTransport", "readPostResponseTime", "cancelTransport", "cancelTimeout"
  ]);
  assert.equal(fixture.state.clocks, 2);
  assert.equal(ownedCount(fixture.owned), 0);
});

selectedTest("C017", "timeout release throw downgrades and cleanup continues", async () => {
  const cancellation = Object.freeze(Object.create(null));
  const expectation = structuredClone(BASE_EXPECTATION);
  const authority = structuredClone(BASE_AUTHORITY);
  const timeoutCleanupSecret = "timeout release route token tenant subject authority provider reason";
  const rejections = [];
  let cancellationChecks = 0;
  let transportCancelAttempts = 0;
  let timeoutCancelAttempts = 0;
  let unsubscribeAttempts = 0;
  let completeOriginal;
  let timeoutOriginal;
  let cancelOriginal;
  let failedToken;
  let fixture;
  fixture = createFixture({
    subscribeCancellation(value, token, cancel) {
      fixture.calls.push("subscribeCancellation");
      fixture.state.cancellation = value;
      fixture.state.cancel = cancel;
      fixture.owned.cancellation.add(token);
      cancelOriginal = cancel;
    },
    isCancellationRequested(value) {
      fixture.calls.push("isCancellationRequested");
      cancellationChecks += 1;
      assert.equal(value, cancellation);
      return false;
    },
    scheduleTimeout(token, timeoutMs, timeout) {
      fixture.calls.push("scheduleTimeout");
      fixture.state.timeoutMs = timeoutMs;
      fixture.state.timeout = timeout;
      fixture.owned.timeout.add(token);
      if (timeoutOriginal === undefined) timeoutOriginal = timeout;
    },
    startTransport(snapshot, complete, token) {
      fixture.calls.push("startTransport");
      fixture.state.starts += 1;
      fixture.state.snapshot = snapshot;
      fixture.state.complete = complete;
      fixture.state.token = token;
      fixture.owned.transport.add(token);
      if (fixture.state.starts === 1) {
        completeOriginal = complete;
        failedToken = token;
      }
    },
    cancelTransport(token) {
      fixture.calls.push("cancelTransport");
      fixture.owned.transport.delete(token);
      if (token === failedToken) transportCancelAttempts += 1;
    },
    cancelTimeout(token) {
      fixture.calls.push("cancelTimeout");
      fixture.owned.timeout.delete(token);
      if (token === failedToken) {
        timeoutCancelAttempts += 1;
        throw new Error(timeoutCleanupSecret);
      }
    },
    unsubscribeCancellation(token) {
      fixture.calls.push("unsubscribeCancellation");
      fixture.owned.cancellation.delete(token);
      if (token === failedToken) unsubscribeAttempts += 1;
    }
  });
  const priorUnavailable = await fixture.controller.request();
  const pending = fixture.controller.request(expectation, authority, cancellation);
  let recovered;
  const observed = pending.then(
    (result) => {
      const terminal = {
        calls: [...fixture.calls], clocks: fixture.state.clocks, owned: ownedCount(fixture.owned)
      };
      recovered = fixture.controller.request(
        structuredClone(BASE_EXPECTATION), structuredClone(BASE_AUTHORITY)
      );
      return {
        kind: "fulfilled", result, terminal, recoveryStarts: fixture.state.starts,
        ownedAfterRecoveryAdmission: ownedCount(fixture.owned)
      };
    },
    (error) => {
      rejections.push(error);
      return { kind: "rejected", error };
    }
  );
  let completionError;
  try { completeOriginal(responseFor("door", "private")); }
  catch (error) { completionError = error; }
  const primaryPresent = completionError === undefined &&
    JSON.stringify(fixture.calls) === JSON.stringify([
      "subscribeCancellation", "isCancellationRequested", "scheduleTimeout", "startTransport",
      "readPostResponseTime", "cancelTransport", "cancelTimeout", "unsubscribeCancellation"
    ]) && fixture.state.clocks === 1 && ownedCount(fixture.owned) === 0 &&
    transportCancelAttempts === 1 && timeoutCancelAttempts === 1 && unsubscribeAttempts === 1;
  if (!primaryPresent) {
    void observed;
    throw new Error("M7T4B_MISSING_C017_CANCEL_TIMEOUT_THROW");
  }
  const settlement = await observed;
  assert.equal(settlement.kind, "fulfilled");
  exactUnavailable(settlement.result);
  exactUnavailable(priorUnavailable);
  assert.notEqual(settlement.result, priorUnavailable);
  assert.equal(rejections.length, 0);
  assert.equal(JSON.stringify(settlement.result).includes(timeoutCleanupSecret), false);
  assert.deepEqual(settlement.terminal, {
    calls: [
      "subscribeCancellation", "isCancellationRequested", "scheduleTimeout", "startTransport",
      "readPostResponseTime", "cancelTransport", "cancelTimeout", "unsubscribeCancellation"
    ],
    clocks: 1,
    owned: 0
  });
  assert.equal(cancellationChecks, 1);
  assert.equal(settlement.recoveryStarts, 2);
  assert.equal(settlement.ownedAfterRecoveryAdmission, 2);
  assert.deepEqual(expectation, BASE_EXPECTATION);
  assert.deepEqual(authority, BASE_AUTHORITY);
  assert.deepEqual(Reflect.ownKeys(cancellation), []);
  const callsAfterReaction = [...fixture.calls];
  completeOriginal(responseFor("door", "tenant"));
  timeoutOriginal();
  cancelOriginal();
  await Promise.resolve();
  assert.deepEqual(fixture.calls, callsAfterReaction);
  assert.equal(fixture.state.clocks, 1);
  assert.equal(transportCancelAttempts, 1);
  assert.equal(timeoutCancelAttempts, 1);
  assert.equal(unsubscribeAttempts, 1);
  assert.equal(ownedCount(fixture.owned), 2);
  fixture.state.complete(responseFor());
  const recoveredResult = await recovered;
  exactAvailable(recoveredResult, "public");
  assert.notEqual(settlement.result, recoveredResult);
  assert.deepEqual(fixture.calls, [
    "subscribeCancellation", "isCancellationRequested", "scheduleTimeout", "startTransport",
    "readPostResponseTime", "cancelTransport", "cancelTimeout", "unsubscribeCancellation",
    "scheduleTimeout", "startTransport", "readPostResponseTime", "cancelTransport", "cancelTimeout"
  ]);
  assert.equal(fixture.state.clocks, 2);
  assert.equal(ownedCount(fixture.owned), 0);
});

selectedTest("C018", "cancellation release throw downgrades without rejection", async () => {
  const cancellation = Object.freeze(Object.create(null));
  const expectation = structuredClone(BASE_EXPECTATION);
  const authority = structuredClone(BASE_AUTHORITY);
  const cancellationCleanupSecret = "cancellation release route token tenant subject authority provider reason";
  const rejections = [];
  let cancellationChecks = 0;
  let transportCancelAttempts = 0;
  let timeoutCancelAttempts = 0;
  let unsubscribeAttempts = 0;
  let completeOriginal;
  let timeoutOriginal;
  let cancelOriginal;
  let failedToken;
  let fixture;
  fixture = createFixture({
    subscribeCancellation(value, token, cancel) {
      fixture.calls.push("subscribeCancellation");
      fixture.state.cancellation = value;
      fixture.state.cancel = cancel;
      fixture.owned.cancellation.add(token);
      cancelOriginal = cancel;
    },
    isCancellationRequested(value) {
      fixture.calls.push("isCancellationRequested");
      cancellationChecks += 1;
      assert.equal(value, cancellation);
      return false;
    },
    scheduleTimeout(token, timeoutMs, timeout) {
      fixture.calls.push("scheduleTimeout");
      fixture.state.timeoutMs = timeoutMs;
      fixture.state.timeout = timeout;
      fixture.owned.timeout.add(token);
      if (timeoutOriginal === undefined) timeoutOriginal = timeout;
    },
    startTransport(snapshot, complete, token) {
      fixture.calls.push("startTransport");
      fixture.state.starts += 1;
      fixture.state.snapshot = snapshot;
      fixture.state.complete = complete;
      fixture.state.token = token;
      fixture.owned.transport.add(token);
      if (fixture.state.starts === 1) {
        completeOriginal = complete;
        failedToken = token;
      }
    },
    cancelTransport(token) {
      fixture.calls.push("cancelTransport");
      fixture.owned.transport.delete(token);
      if (token === failedToken) transportCancelAttempts += 1;
    },
    cancelTimeout(token) {
      fixture.calls.push("cancelTimeout");
      fixture.owned.timeout.delete(token);
      if (token === failedToken) timeoutCancelAttempts += 1;
    },
    unsubscribeCancellation(token) {
      fixture.calls.push("unsubscribeCancellation");
      fixture.owned.cancellation.delete(token);
      if (token === failedToken) {
        unsubscribeAttempts += 1;
        throw new Error(cancellationCleanupSecret);
      }
    }
  });
  const priorUnavailable = await fixture.controller.request();
  const pending = fixture.controller.request(expectation, authority, cancellation);
  let recovered;
  const observed = pending.then(
    (result) => {
      const terminal = {
        calls: [...fixture.calls], clocks: fixture.state.clocks, owned: ownedCount(fixture.owned)
      };
      recovered = fixture.controller.request(
        structuredClone(BASE_EXPECTATION), structuredClone(BASE_AUTHORITY)
      );
      return {
        kind: "fulfilled", result, terminal, recoveryStarts: fixture.state.starts,
        ownedAfterRecoveryAdmission: ownedCount(fixture.owned)
      };
    },
    (error) => {
      rejections.push(error);
      return { kind: "rejected", error };
    }
  );
  let completionError;
  try { completeOriginal(responseFor("door", "private")); }
  catch (error) { completionError = error; }
  const primaryPresent = completionError === undefined &&
    JSON.stringify(fixture.calls) === JSON.stringify([
      "subscribeCancellation", "isCancellationRequested", "scheduleTimeout", "startTransport",
      "readPostResponseTime", "cancelTransport", "cancelTimeout", "unsubscribeCancellation"
    ]) && fixture.state.clocks === 1 && ownedCount(fixture.owned) === 0 &&
    transportCancelAttempts === 1 && timeoutCancelAttempts === 1 && unsubscribeAttempts === 1;
  if (!primaryPresent) {
    void observed;
    throw new Error("M7T4B_MISSING_C018_UNSUBSCRIBE_THROW");
  }
  const settlement = await observed;
  assert.equal(settlement.kind, "fulfilled");
  exactUnavailable(settlement.result);
  exactUnavailable(priorUnavailable);
  assert.notEqual(settlement.result, priorUnavailable);
  assert.equal(rejections.length, 0);
  assert.equal(JSON.stringify(settlement.result).includes(cancellationCleanupSecret), false);
  assert.deepEqual(settlement.terminal, {
    calls: [
      "subscribeCancellation", "isCancellationRequested", "scheduleTimeout", "startTransport",
      "readPostResponseTime", "cancelTransport", "cancelTimeout", "unsubscribeCancellation"
    ],
    clocks: 1,
    owned: 0
  });
  assert.equal(cancellationChecks, 1);
  assert.equal(settlement.recoveryStarts, 2);
  assert.equal(settlement.ownedAfterRecoveryAdmission, 2);
  assert.deepEqual(expectation, BASE_EXPECTATION);
  assert.deepEqual(authority, BASE_AUTHORITY);
  assert.deepEqual(Reflect.ownKeys(cancellation), []);
  const callsAfterReaction = [...fixture.calls];
  completeOriginal(responseFor("door", "tenant"));
  timeoutOriginal();
  cancelOriginal();
  await Promise.resolve();
  assert.deepEqual(fixture.calls, callsAfterReaction);
  assert.equal(fixture.state.clocks, 1);
  assert.equal(transportCancelAttempts, 1);
  assert.equal(timeoutCancelAttempts, 1);
  assert.equal(unsubscribeAttempts, 1);
  assert.equal(ownedCount(fixture.owned), 2);
  fixture.state.complete(responseFor());
  const recoveredResult = await recovered;
  exactAvailable(recoveredResult, "public");
  assert.notEqual(settlement.result, recoveredResult);
  assert.deepEqual(fixture.calls, [
    "subscribeCancellation", "isCancellationRequested", "scheduleTimeout", "startTransport",
    "readPostResponseTime", "cancelTransport", "cancelTimeout", "unsubscribeCancellation",
    "scheduleTimeout", "startTransport", "readPostResponseTime", "cancelTransport", "cancelTimeout"
  ]);
  assert.equal(fixture.state.clocks, 2);
  assert.equal(ownedCount(fixture.owned), 0);
});

selectedTest("C019", "captured intrinsics resist post-import replacement", async () => {
  const expectation = structuredClone(BASE_EXPECTATION);
  const authority = structuredClone(BASE_AUTHORITY);
  const recoveryExpectation = structuredClone(BASE_EXPECTATION);
  const recoveryAuthority = structuredClone(BASE_AUTHORITY);
  const cancellation = Object.freeze(Object.create(null));
  const nativeObject = Object;
  const nativeArray = Array;
  const nativeNumber = Number;
  const nativeReflect = Reflect;
  const nativeRegExp = RegExp;
  const nativePromise = Promise;
  const defineProperty = Object.defineProperty;
  const getDescriptor = Object.getOwnPropertyDescriptor;
  const replacements = [
    [nativeObject, "create"], [nativeObject, "freeze"], [nativeObject, "getPrototypeOf"],
    [nativeObject, "getOwnPropertyDescriptor"], [nativeObject, "is"],
    [nativeReflect, "ownKeys"], [nativeArray, "isArray"], [nativeNumber, "isSafeInteger"],
    [nativeRegExp.prototype, "test"], [nativeArray.prototype, "includes"],
    [nativeArray.prototype, "every"], [nativeArray.prototype, "some"],
    [nativeArray.prototype, "slice"], [nativePromise, "resolve"],
    [globalThis, "Object"], [globalThis, "Array"], [globalThis, "Number"],
    [globalThis, "Reflect"], [globalThis, "RegExp"], [globalThis, "Promise"]
  ].map(([target, key]) => [target, key, getDescriptor(target, key)]);
  let hostileObservations = 0;
  const hostile = () => {
    hostileObservations += 1;
    throw new Error("post-import intrinsic replacement observed");
  };
  let fixture;
  let priorUnavailable;
  let busyResult;
  let settlement;
  let recoveredResult;
  let completeOriginal;
  let timeoutOriginal;
  let cancelOriginal;
  let callsAfterReaction;
  let lifecycleError;
  try {
    for (const [target, key] of replacements) {
      defineProperty(target, key, { value: hostile, writable: true, configurable: true });
    }
    fixture = createFixture({
      subscribeCancellation(value, token, cancel) {
        fixture.calls.push("subscribeCancellation");
        fixture.state.cancellation = value;
        fixture.state.cancel = cancel;
        fixture.owned.cancellation.add(token);
        cancelOriginal = cancel;
      },
      isCancellationRequested(value) {
        fixture.calls.push("isCancellationRequested");
        assert.equal(value, cancellation);
        return false;
      },
      scheduleTimeout(token, timeoutMs, timeout) {
        fixture.calls.push("scheduleTimeout");
        fixture.state.timeoutMs = timeoutMs;
        fixture.state.timeout = timeout;
        fixture.owned.timeout.add(token);
        if (timeoutOriginal === undefined) timeoutOriginal = timeout;
      },
      startTransport(snapshot, complete, token) {
        fixture.calls.push("startTransport");
        fixture.state.starts += 1;
        fixture.state.snapshot = snapshot;
        fixture.state.complete = complete;
        fixture.state.token = token;
        fixture.owned.transport.add(token);
        if (fixture.state.starts === 1) completeOriginal = complete;
      }
    });
    priorUnavailable = await fixture.controller.request();
    const pending = fixture.controller.request(expectation, authority, cancellation);
    const busy = fixture.controller.request(expectation, authority, cancellation);
    let recovered;
    const observed = pending.then((result) => {
      const terminal = {
        calls: [...fixture.calls], clocks: fixture.state.clocks, owned: ownedCount(fixture.owned)
      };
      recovered = fixture.controller.request(recoveryExpectation, recoveryAuthority);
      return {
        result, terminal, recoveryStarts: fixture.state.starts,
        ownedAfterRecoveryAdmission: ownedCount(fixture.owned)
      };
    });
    completeOriginal(responseFor("door", "private"));
    busyResult = await busy;
    settlement = await observed;
    callsAfterReaction = [...fixture.calls];
    completeOriginal(responseFor("door", "tenant"));
    timeoutOriginal();
    cancelOriginal();
    fixture.state.complete(responseFor());
    recoveredResult = await recovered;
  } catch (error) {
    lifecycleError = error;
  } finally {
    for (let index = replacements.length - 1; index >= 0; index -= 1) {
      const [target, key, descriptor] = replacements[index];
      defineProperty(target, key, descriptor);
    }
  }
  const primaryPresent = lifecycleError === undefined && hostileObservations === 0 &&
    JSON.stringify(settlement?.terminal.calls) === JSON.stringify([
      "subscribeCancellation", "isCancellationRequested", "scheduleTimeout", "startTransport",
      "readPostResponseTime", "cancelTransport", "cancelTimeout", "unsubscribeCancellation"
    ]) && settlement?.terminal.clocks === 1 && settlement?.terminal.owned === 0;
  if (!primaryPresent) throw new Error("M7T4B_MISSING_C019_CAPTURED_INTRINSICS");
  exactUnavailable(priorUnavailable);
  exactUnavailable(busyResult);
  exactAvailable(settlement.result, "private");
  exactAvailable(recoveredResult, "public");
  assert.notEqual(priorUnavailable, busyResult);
  assert.notEqual(settlement.result, recoveredResult);
  assert.equal(settlement.recoveryStarts, 2);
  assert.equal(settlement.ownedAfterRecoveryAdmission, 2);
  assert.deepEqual(fixture.calls, [
    ...callsAfterReaction, "readPostResponseTime", "cancelTransport", "cancelTimeout"
  ]);
  assert.equal(fixture.state.clocks, 2);
  assert.equal(ownedCount(fixture.owned), 0);
  assert.deepEqual(expectation, BASE_EXPECTATION);
  assert.deepEqual(authority, BASE_AUTHORITY);
  assert.deepEqual(recoveryExpectation, BASE_EXPECTATION);
  assert.deepEqual(recoveryAuthority, BASE_AUTHORITY);
  assert.deepEqual(Reflect.ownKeys(cancellation), []);
});

selectedTest("C020", "cleanup reentrancy remains busy and reactions see idle", async () => {
  const scenarios = [null, "cancelTransport", "cancelTimeout", "unsubscribeCancellation"];
  const allResults = [];
  for (const throwAt of scenarios) {
    const expectation = structuredClone(BASE_EXPECTATION);
    const authority = structuredClone(BASE_AUTHORITY);
    const cancellation = Object.freeze(Object.create(null));
    const cleanupBusyPromises = [];
    const cleanupReactionStates = [];
    const rejections = [];
    let callerObservations = 0;
    let primaryToken;
    let completeOriginal;
    let timeoutOriginal;
    let cancelOriginal;
    let reactionRecovery;
    let reactionComplete;
    let fixture;
    const trap = () => {
      callerObservations += 1;
      throw new Error("cleanup reentrant caller argument observed");
    };
    const hostile = new Proxy({}, {
      get: trap, getPrototypeOf: trap, ownKeys: trap, getOwnPropertyDescriptor: trap
    });
    const reenter = (label) => {
      const busy = fixture.controller.request(hostile, hostile, hostile);
      cleanupBusyPromises.push(busy);
      busy.then((result) => {
        cleanupReactionStates.push({
          label, starts: fixture.state.starts, owned: ownedCount(fixture.owned)
        });
        if (reactionRecovery === undefined) {
          reactionRecovery = fixture.controller.request(
            structuredClone(BASE_EXPECTATION), structuredClone(BASE_AUTHORITY)
          );
          reactionComplete = fixture.state.complete;
        }
        return result;
      }, (error) => { rejections.push(error); });
    };
    fixture = createFixture({
      subscribeCancellation(value, token, cancel) {
        fixture.calls.push("subscribeCancellation");
        fixture.state.cancellation = value;
        fixture.state.cancel = cancel;
        fixture.owned.cancellation.add(token);
        if (primaryToken === undefined) cancelOriginal = cancel;
      },
      isCancellationRequested(value) {
        fixture.calls.push("isCancellationRequested");
        assert.equal(value, cancellation);
        return false;
      },
      scheduleTimeout(token, timeoutMs, timeout) {
        fixture.calls.push("scheduleTimeout");
        fixture.state.timeoutMs = timeoutMs;
        fixture.state.timeout = timeout;
        fixture.owned.timeout.add(token);
        if (primaryToken === undefined) timeoutOriginal = timeout;
      },
      startTransport(snapshot, complete, token) {
        fixture.calls.push("startTransport");
        fixture.state.starts += 1;
        fixture.state.snapshot = snapshot;
        fixture.state.complete = complete;
        fixture.state.token = token;
        fixture.owned.transport.add(token);
        if (primaryToken === undefined) {
          primaryToken = token;
          completeOriginal = complete;
        }
      },
      cancelTransport(token) {
        fixture.calls.push("cancelTransport");
        if (token === primaryToken) reenter("cancelTransport");
        fixture.owned.transport.delete(token);
        if (token === primaryToken && throwAt === "cancelTransport") throw new Error("transport cleanup");
      },
      cancelTimeout(token) {
        fixture.calls.push("cancelTimeout");
        if (token === primaryToken) reenter("cancelTimeout");
        fixture.owned.timeout.delete(token);
        if (token === primaryToken && throwAt === "cancelTimeout") throw new Error("timeout cleanup");
      },
      unsubscribeCancellation(token) {
        fixture.calls.push("unsubscribeCancellation");
        if (token === primaryToken) reenter("unsubscribeCancellation");
        fixture.owned.cancellation.delete(token);
        if (token === primaryToken && throwAt === "unsubscribeCancellation") {
          throw new Error("cancellation cleanup");
        }
      }
    });
    const pending = fixture.controller.request(expectation, authority, cancellation);
    pending.catch((error) => { rejections.push(error); });
    let completionError;
    try { completeOriginal(responseFor("door", "private")); }
    catch (error) { completionError = error; }
    const primaryPresent = completionError === undefined && cleanupBusyPromises.length === 3 &&
      callerObservations === 0 && fixture.state.starts === 1 && ownedCount(fixture.owned) === 0 &&
      JSON.stringify(fixture.calls) === JSON.stringify([
        "subscribeCancellation", "isCancellationRequested", "scheduleTimeout", "startTransport",
        "readPostResponseTime", "cancelTransport", "cancelTimeout", "unsubscribeCancellation"
      ]);
    if (!primaryPresent) {
      void Promise.all(cleanupBusyPromises);
      throw new Error("M7T4B_MISSING_C020_CLEANUP_REENTRANCY");
    }
    const primaryResult = await pending;
    await Promise.all(cleanupBusyPromises);
    assert.equal(cleanupReactionStates.length, 3);
    assert.deepEqual(cleanupReactionStates[0], { label: "cancelTransport", starts: 1, owned: 0 });
    assert.equal(reactionRecovery instanceof Promise, true);
    assert.equal(fixture.state.starts, 2);
    assert.equal(ownedCount(fixture.owned), 2);
    const busyResults = await Promise.all(cleanupBusyPromises);
    busyResults.forEach(exactUnavailable);
    assert.equal(new Set(busyResults).size, 3);
    if (throwAt === null) exactAvailable(primaryResult, "private");
    else exactUnavailable(primaryResult);
    assert.equal(new Set([...busyResults, primaryResult]).size, 4);
    assert.equal(rejections.length, 0);
    assert.equal(callerObservations, 0);
    assert.deepEqual(expectation, BASE_EXPECTATION);
    assert.deepEqual(authority, BASE_AUTHORITY);
    assert.deepEqual(Reflect.ownKeys(cancellation), []);
    const callsBeforeLateWork = [...fixture.calls];
    completeOriginal(responseFor("door", "tenant"));
    timeoutOriginal();
    cancelOriginal();
    await Promise.resolve();
    assert.deepEqual(fixture.calls, callsBeforeLateWork);
    assert.equal(ownedCount(fixture.owned), 2);
    reactionComplete(responseFor());
    const recoveredResult = await reactionRecovery;
    exactAvailable(recoveredResult, "public");
    assert.equal(new Set([...busyResults, primaryResult, recoveredResult]).size, 5);
    assert.equal(fixture.state.starts, 2);
    assert.equal(ownedCount(fixture.owned), 0);
    allResults.push(...busyResults, primaryResult, recoveredResult);
  }
  assert.equal(new Set(allResults).size, allResults.length);
});

selectedTest("R002", "every observable result is exact fresh frozen and private", async () => {
  const observed = new Map();
  const recoveries = [];
  const expectedIds = Array.from({ length: 46 }, (_, index) => `C${String(index + 1).padStart(3, "0")}`);
  const recursivelyFrozen = (value, seen = new Set()) => {
    if (value === null || typeof value !== "object" || seen.has(value)) return true;
    seen.add(value);
    return Object.isFrozen(value) && Reflect.ownKeys(value).every((key) => recursivelyFrozen(value[key], seen));
  };
  const record = (id, result, accessState = null) => {
    assert.equal(observed.has(id), false);
    if (accessState === null) exactUnavailable(result);
    else exactAvailable(result, accessState);
    assert.equal(recursivelyFrozen(result), true);
    observed.set(id, result);
    return result;
  };
  const request = (fixture, cancellation = null, expectation = BASE_EXPECTATION) =>
    fixture.controller.request(structuredClone(expectation), structuredClone(BASE_AUTHORITY), cancellation);
  const recover = async (fixture, accessState = "public") => {
    const pending = request(fixture);
    fixture.state.complete(responseFor("door", accessState));
    const result = await pending;
    exactAvailable(result, accessState);
    assert.equal(recursivelyFrozen(result), true);
    assert.equal(ownedCount(fixture.owned), 0);
    recoveries.push(result);
  };

  record("C001", await controllerModule.createPrivateTenantNavigationRequestController().request());

  const publicFixture = createFixture();
  const publicPending = request(publicFixture);
  publicFixture.state.complete(responseFor());
  record("C002", await publicPending, "public");

  const syncFixture = createFixture({
    startTransport(snapshot, complete, token) {
      syncFixture.calls.push("startTransport"); syncFixture.state.starts += 1;
      syncFixture.state.complete = complete; syncFixture.state.token = token;
      syncFixture.owned.transport.add(token); complete(responseFor());
    }
  });
  record("C003", await request(syncFixture), "public");

  const callbackThrowFixture = createFixture({
    startTransport(snapshot, complete, token) {
      callbackThrowFixture.calls.push("startTransport"); callbackThrowFixture.state.starts += 1;
      callbackThrowFixture.state.complete = complete; callbackThrowFixture.state.token = token;
      callbackThrowFixture.owned.transport.add(token); complete(responseFor()); throw new Error("start detail");
    }
  });
  record("C004", await request(callbackThrowFixture));

  const hostileThenable = Object.defineProperty({}, "then", { get() { throw new Error("assimilated"); } });
  const thenableFixture = createFixture({
    startTransport(snapshot, complete, token) {
      thenableFixture.calls.push("startTransport"); thenableFixture.state.starts += 1;
      thenableFixture.state.complete = complete; thenableFixture.state.token = token;
      thenableFixture.owned.transport.add(token); return hostileThenable;
    },
    cancelTransport(token) { thenableFixture.calls.push("cancelTransport"); thenableFixture.owned.transport.delete(token); return hostileThenable; },
    scheduleTimeout(token, timeoutMs, timeout) {
      thenableFixture.calls.push("scheduleTimeout"); thenableFixture.state.timeout = timeout;
      thenableFixture.owned.timeout.add(token); return hostileThenable;
    },
    cancelTimeout(token) { thenableFixture.calls.push("cancelTimeout"); thenableFixture.owned.timeout.delete(token); return hostileThenable; }
  });
  const thenablePending = request(thenableFixture);
  thenableFixture.state.complete(responseFor());
  record("C005", await thenablePending, "public");

  const busyFixture = createFixture();
  const busyPrimary = request(busyFixture);
  record("C006", await request(busyFixture));
  busyFixture.state.complete(responseFor());
  await busyPrimary;

  const timeoutFixture = createFixture();
  const timeoutPending = request(timeoutFixture);
  timeoutFixture.state.timeout();
  record("C007", await timeoutPending);

  const preCancel = Object.freeze(Object.create(null));
  const preCancelFixture = createFixture({ isCancellationRequested() { return true; } });
  record("C008", await request(preCancelFixture, preCancel));

  const activeCancel = Object.freeze(Object.create(null));
  const activeCancelFixture = createFixture();
  const activeCancelPending = request(activeCancelFixture, activeCancel);
  activeCancelFixture.state.cancel();
  record("C009", await activeCancelPending);

  const duplicateFixture = createFixture();
  const duplicatePending = request(duplicateFixture);
  duplicateFixture.state.complete(responseFor()); duplicateFixture.state.complete(null);
  record("C010", await duplicatePending, "public");

  const clockFixture = createFixture({ readPostResponseTime() { throw new Error("clock detail"); } });
  const clockPending = request(clockFixture); clockFixture.state.complete(responseFor());
  record("C011", await clockPending);

  const subscribeFixture = createFixture({ subscribeCancellation() { throw new Error("subscribe detail"); } });
  record("C012", await request(subscribeFixture, Object.freeze(Object.create(null))));
  const checkFixture = createFixture({ isCancellationRequested() { throw new Error("check detail"); } });
  record("C013", await request(checkFixture, Object.freeze(Object.create(null))));
  const scheduleFixture = createFixture({ scheduleTimeout() { throw new Error("schedule detail"); } });
  record("C014", await request(scheduleFixture));
  const startFixture = createFixture({ startTransport() { throw new Error("start detail"); } });
  record("C015", await request(startFixture));

  for (const [id, release] of [["C016", "cancelTransport"], ["C017", "cancelTimeout"], ["C018", "unsubscribeCancellation"]]) {
    let fixture;
    let releaseThrew = false;
    fixture = createFixture({ [release](token) {
      fixture.calls.push(release);
      fixture.owned[release === "cancelTransport" ? "transport" : release === "cancelTimeout" ? "timeout" : "cancellation"].delete(token);
      if (!releaseThrew) {
        releaseThrew = true;
        throw new Error(`${release} detail`);
      }
    } });
    const cancellation = release === "unsubscribeCancellation" ? Object.freeze(Object.create(null)) : null;
    const pending = request(fixture, cancellation); fixture.state.complete(responseFor("door", "private"));
    record(id, await pending);
    await recover(fixture);
  }

  const intrinsicFixture = createFixture();
  const intrinsicPending = request(intrinsicFixture);
  const freezeDescriptor = Object.getOwnPropertyDescriptor(Object, "freeze");
  try {
    Object.defineProperty(Object, "freeze", { value() { throw new Error("hostile freeze"); }, configurable: true });
    intrinsicFixture.state.complete(responseFor("door", "private"));
  } finally {
    Object.defineProperty(Object, "freeze", freezeDescriptor);
  }
  record("C019", await intrinsicPending, "private");

  let reentrantBusy;
  let cleanupFixture;
  cleanupFixture = createFixture({
    cancelTransport(token) {
      cleanupFixture.calls.push("cancelTransport");
      reentrantBusy = cleanupFixture.controller.request(new Proxy({}, { ownKeys() { throw new Error("observed"); } }));
      cleanupFixture.owned.transport.delete(token);
    }
  });
  const cleanupPending = request(cleanupFixture); cleanupFixture.state.complete(responseFor("door", "private"));
  await cleanupPending;
  record("C020", await reentrantBusy);
  await recover(cleanupFixture);

  const race = async (id, first, second, accessState = null) => {
    const cancellation = (first === "cancel" || second === "cancel") ? Object.freeze(Object.create(null)) : null;
    const fixture = createFixture();
    const pending = request(fixture, cancellation);
    const trigger = (name) => name === "complete" ? fixture.state.complete(responseFor()) :
      name === "timeout" ? fixture.state.timeout() : fixture.state.cancel();
    trigger(first); trigger(second);
    record(id, await pending, accessState);
    await recover(fixture);
  };
  await race("C021", "complete", "timeout", "public");
  await race("C022", "timeout", "complete");
  await race("C023", "complete", "cancel", "public");
  await race("C024", "cancel", "complete");
  await race("C025", "timeout", "cancel");
  await race("C026", "cancel", "timeout");

  const parity = [
    ["C027", "door", "tenant"], ["C028", "door", "invited"], ["C029", "door", "private"],
    ["C030", "door", "restricted"], ["C031", "elevator", "public"], ["C032", "elevator", "tenant"],
    ["C033", "elevator", "invited"], ["C034", "elevator", "private"], ["C035", "elevator", "restricted"],
    ["C036", "direct", "public"], ["C037", "direct", "tenant"], ["C038", "direct", "invited"],
    ["C039", "direct", "private"], ["C040", "direct", "restricted"], ["C041", "alternative", "public"],
    ["C042", "alternative", "tenant"], ["C043", "alternative", "invited"], ["C044", "alternative", "private"],
    ["C045", "alternative", "restricted"]
  ];
  for (const [id, channel, accessState] of parity) {
    const fixture = createFixture();
    const pending = request(fixture, null, { ...BASE_EXPECTATION, channel });
    fixture.state.complete(responseFor(channel, accessState));
    record(id, await pending, accessState);
  }

  const malformedFixture = createFixture();
  const malformedPending = request(malformedFixture); malformedFixture.state.complete(undefined);
  record("C046", await malformedPending);
  await recover(malformedFixture);

  assert.deepEqual([...observed.keys()].sort(), expectedIds);
  assert.equal(new Set(observed.values()).size, 46);
  assert.equal(new Set([...observed.values(), ...recoveries]).size, 46 + recoveries.length);
});

selectedTest("R003", "late work after every admitted lifecycle path is inert", async () => {
  const seen = new Set();
  const hostileResponseObservations = [];
  const cancellation = () => Object.freeze(Object.create(null));
  const request = (fixture, value = null, expectation = BASE_EXPECTATION) =>
    fixture.controller.request(structuredClone(expectation), structuredClone(BASE_AUTHORITY), value);
  const withHostileFreeze = (operation) => {
    const descriptor = Object.getOwnPropertyDescriptor(Object, "freeze");
    try {
      Object.defineProperty(Object, "freeze", {
        value() { throw new Error("late hostile replacement observed"); }, configurable: true
      });
      operation();
    } finally {
      Object.defineProperty(Object, "freeze", descriptor);
    }
  };
  const lateResponse = () => new Proxy(responseFor("door", "restricted"), {
    getPrototypeOf(target) { hostileResponseObservations.push("getPrototypeOf"); return Reflect.getPrototypeOf(target); },
    ownKeys(target) { hostileResponseObservations.push("ownKeys"); return Reflect.ownKeys(target); },
    getOwnPropertyDescriptor(target, key) {
      hostileResponseObservations.push(`descriptor:${String(key)}`);
      return Reflect.getOwnPropertyDescriptor(target, key);
    },
    get(target, key, receiver) {
      hostileResponseObservations.push(`get:${String(key)}`);
      return Reflect.get(target, key, receiver);
    }
  });
  const exercise = async ({ id, kind = "complete", accessState = null, channel = "door", release = null }) => {
    assert.equal(seen.has(id), false);
    const context = { busy: [], thenGets: 0 };
    let fixture;
    let first = true;
    const overrides = {};
    if (kind === "sync") {
      overrides.startTransport = (snapshot, complete, token) => {
        fixture.calls.push("startTransport"); fixture.state.starts += 1;
        fixture.state.snapshot = snapshot; fixture.state.complete = complete; fixture.state.token = token;
        fixture.owned.transport.add(token); complete(responseFor(channel, accessState ?? "public"));
      };
    } else if (kind === "callbackThrow") {
      overrides.startTransport = (snapshot, complete, token) => {
        fixture.calls.push("startTransport"); fixture.state.starts += 1;
        fixture.state.snapshot = snapshot; fixture.state.complete = complete; fixture.state.token = token;
        fixture.owned.transport.add(token);
        if (first) { first = false; complete(responseFor()); throw new Error("start detail must remain private"); }
      };
    } else if (kind === "thenable") {
      const hostileReturn = () => Object.defineProperty(Object.create(null), "then", {
        get() { context.thenGets += 1; throw new Error("late thenable assimilated"); }
      });
      overrides.subscribeCancellation = (value, token, cancel) => {
        fixture.calls.push("subscribeCancellation"); fixture.state.cancellation = value;
        fixture.state.cancel = cancel; fixture.owned.cancellation.add(token); return hostileReturn();
      };
      overrides.scheduleTimeout = (token, timeoutMs, timeout) => {
        fixture.calls.push("scheduleTimeout"); fixture.state.timeoutMs = timeoutMs;
        fixture.state.timeout = timeout; fixture.owned.timeout.add(token); return hostileReturn();
      };
      overrides.startTransport = (snapshot, complete, token) => {
        fixture.calls.push("startTransport"); fixture.state.starts += 1; fixture.state.snapshot = snapshot;
        fixture.state.complete = complete; fixture.state.token = token; fixture.owned.transport.add(token);
        return hostileReturn();
      };
      overrides.cancelTransport = (token) => {
        fixture.calls.push("cancelTransport"); fixture.owned.transport.delete(token); return hostileReturn();
      };
      overrides.cancelTimeout = (token) => {
        fixture.calls.push("cancelTimeout"); fixture.owned.timeout.delete(token); return hostileReturn();
      };
      overrides.unsubscribeCancellation = (token) => {
        fixture.calls.push("unsubscribeCancellation"); fixture.owned.cancellation.delete(token); return hostileReturn();
      };
    } else if (kind === "preCancel") {
      overrides.isCancellationRequested = () => { const result = first; first = false; return result; };
    } else if (kind === "clockThrow") {
      overrides.readPostResponseTime = () => {
        fixture.calls.push("readPostResponseTime"); fixture.state.clocks += 1;
        if (first) { first = false; throw new Error("clock detail must remain private"); }
        return TRUSTED_MS;
      };
    } else if (kind === "subscribeThrow") {
      overrides.subscribeCancellation = (value, token, cancel) => {
        fixture.calls.push("subscribeCancellation"); fixture.state.cancellation = value;
        fixture.state.cancel = cancel; fixture.owned.cancellation.add(token);
        if (first) { first = false; throw new Error("subscribe detail must remain private"); }
      };
    } else if (kind === "checkThrow") {
      overrides.isCancellationRequested = () => {
        if (first) { first = false; throw new Error("check detail must remain private"); }
        return false;
      };
    } else if (kind === "scheduleThrow") {
      overrides.scheduleTimeout = (token, timeoutMs, timeout) => {
        fixture.calls.push("scheduleTimeout"); fixture.state.timeoutMs = timeoutMs;
        fixture.state.timeout = timeout; fixture.owned.timeout.add(token);
        if (first) { first = false; throw new Error("schedule detail must remain private"); }
      };
    } else if (kind === "startThrow") {
      overrides.startTransport = (snapshot, complete, token) => {
        fixture.calls.push("startTransport"); fixture.state.starts += 1; fixture.state.snapshot = snapshot;
        fixture.state.complete = complete; fixture.state.token = token; fixture.owned.transport.add(token);
        if (first) { first = false; throw new Error("start detail must remain private"); }
      };
    } else if (kind === "releaseThrow") {
      overrides[release] = (token) => {
        fixture.calls.push(release);
        fixture.owned[release === "cancelTransport" ? "transport" : release === "cancelTimeout" ? "timeout" : "cancellation"].delete(token);
        if (first) { first = false; throw new Error(`${release} detail must remain private`); }
      };
    } else if (kind === "cleanupReentry") {
      overrides.cancelTransport = (token) => {
        fixture.calls.push("cancelTransport");
        if (first) {
          first = false;
          const trap = () => { throw new Error("cleanup late argument observed"); };
          const hostile = new Proxy({}, { get: trap, getPrototypeOf: trap, ownKeys: trap, getOwnPropertyDescriptor: trap });
          context.busy.push(fixture.controller.request(hostile, hostile, hostile));
        }
        fixture.owned.transport.delete(token);
      };
    }
    fixture = createFixture(overrides);
    const needsCancellation = !["complete", "sync", "callbackThrow", "clockThrow", "scheduleThrow",
      "startThrow", "timeout", "duplicate", "malformed", "hostile"].includes(kind) || release !== null;
    const pending = request(fixture, needsCancellation ? cancellation() : null, { ...BASE_EXPECTATION, channel });
    let settlements = 0;
    const rejections = [];
    const observed = pending.then(
      (result) => { settlements += 1; return result; },
      (error) => { rejections.push(error); return error; }
    );
    const originals = {
      complete: fixture.state.complete,
      timeout: fixture.state.timeout,
      cancel: fixture.state.cancel
    };
    if (kind === "busy") {
      let observations = 0;
      const trap = () => { observations += 1; throw new Error("busy arguments observed"); };
      const hostile = new Proxy({}, { get: trap, getPrototypeOf: trap, ownKeys: trap, getOwnPropertyDescriptor: trap });
      context.busy.push(fixture.controller.request(hostile, hostile, hostile));
      assert.equal(observations, 0);
      originals.complete(responseFor());
    } else if (kind === "timeout") originals.timeout();
    else if (kind === "cancel") originals.cancel();
    else if (kind === "duplicate") {
      originals.complete(responseFor()); originals.complete(responseFor("door", "tenant")); originals.timeout();
    } else if (kind === "raceCompleteTimeout") { originals.complete(responseFor()); originals.timeout(); }
    else if (kind === "raceTimeoutComplete") { originals.timeout(); originals.complete(responseFor()); }
    else if (kind === "raceCompleteCancel") { originals.complete(responseFor()); originals.cancel(); }
    else if (kind === "raceCancelComplete") { originals.cancel(); originals.complete(responseFor()); }
    else if (kind === "raceTimeoutCancel") { originals.timeout(); originals.cancel(); }
    else if (kind === "raceCancelTimeout") { originals.cancel(); originals.timeout(); }
    else if (kind === "malformed") originals.complete(undefined);
    else if (kind === "hostile") withHostileFreeze(() => originals.complete(responseFor("door", "private")));
    else if (!["sync", "callbackThrow", "preCancel", "subscribeThrow", "checkThrow", "scheduleThrow", "startThrow"].includes(kind)) {
      originals.complete(responseFor(channel, accessState ?? "public"));
    }
    const result = await observed;
    if (accessState === null) exactUnavailable(result); else exactAvailable(result, accessState);
    assert.equal(rejections.length, 0);
    assert.equal(settlements, 1);
    assert.equal(ownedCount(fixture.owned), 0);
    for (const busy of context.busy) exactUnavailable(await busy);
    assert.equal(context.thenGets, 0);
    const resultIdentity = result;
    const resultJson = JSON.stringify(result);
    const terminalCalls = [...fixture.calls];
    const terminalStarts = fixture.state.starts;
    const terminalClocks = fixture.state.clocks;
    const invokeLate = () => {
      originals.complete?.(lateResponse()); originals.complete?.(lateResponse());
      originals.timeout?.(); originals.timeout?.(); originals.cancel?.(); originals.cancel?.();
    };
    if (kind === "hostile") withHostileFreeze(invokeLate); else invokeLate();
    await Promise.resolve();
    assert.equal(settlements, 1);
    assert.equal(rejections.length, 0);
    assert.equal(result, resultIdentity);
    assert.equal(JSON.stringify(result), resultJson);
    assert.deepEqual(fixture.calls, terminalCalls);
    assert.equal(fixture.state.starts, terminalStarts);
    assert.equal(fixture.state.clocks, terminalClocks);
    assert.equal(ownedCount(fixture.owned), 0);
    assert.equal(hostileResponseObservations.length, 0);
    assert.equal(context.thenGets, 0);
    const recovery = request(fixture);
    const recoveryComplete = fixture.state.complete;
    const recoveryCalls = [...fixture.calls];
    const recoveryOwned = ownedCount(fixture.owned);
    invokeLate();
    await Promise.resolve();
    assert.deepEqual(fixture.calls, recoveryCalls);
    assert.equal(ownedCount(fixture.owned), recoveryOwned);
    recoveryComplete(responseFor());
    const recoveredResult = await recovery;
    exactAvailable(recoveredResult, "public");
    assert.notEqual(result, recoveredResult);
    assert.equal(ownedCount(fixture.owned), 0);
    assert.equal(hostileResponseObservations.length, 0);
    assert.equal(context.thenGets, 0);
    seen.add(id);
  };

  const scenarios = [
    ["C002", "complete", "public"], ["C003", "sync", "public"], ["C004", "callbackThrow", null],
    ["C005", "thenable", "public"], ["C006", "busy", "public"], ["C007", "timeout", null],
    ["C008", "preCancel", null], ["C009", "cancel", null], ["C010", "duplicate", "public"],
    ["C011", "clockThrow", null], ["C012", "subscribeThrow", null], ["C013", "checkThrow", null],
    ["C014", "scheduleThrow", null], ["C015", "startThrow", null],
    ["C016", "releaseThrow", null, "door", "cancelTransport"],
    ["C017", "releaseThrow", null, "door", "cancelTimeout"],
    ["C018", "releaseThrow", null, "door", "unsubscribeCancellation"],
    ["C019", "hostile", "private"], ["C020", "cleanupReentry", "private"],
    ["C021", "raceCompleteTimeout", "public"], ["C022", "raceTimeoutComplete", null],
    ["C023", "raceCompleteCancel", "public"], ["C024", "raceCancelComplete", null],
    ["C025", "raceTimeoutCancel", null], ["C026", "raceCancelTimeout", null]
  ];
  const parity = [
    ["C027", "door", "tenant"], ["C028", "door", "invited"], ["C029", "door", "private"],
    ["C030", "door", "restricted"], ["C031", "elevator", "public"], ["C032", "elevator", "tenant"],
    ["C033", "elevator", "invited"], ["C034", "elevator", "private"], ["C035", "elevator", "restricted"],
    ["C036", "direct", "public"], ["C037", "direct", "tenant"], ["C038", "direct", "invited"],
    ["C039", "direct", "private"], ["C040", "direct", "restricted"], ["C041", "alternative", "public"],
    ["C042", "alternative", "tenant"], ["C043", "alternative", "invited"], ["C044", "alternative", "private"],
    ["C045", "alternative", "restricted"]
  ];
  for (const [id, kind, accessState, channel = "door", release = null] of scenarios) {
    await exercise({ id, kind, accessState, channel, release });
  }
  for (const [id, channel, accessState] of parity) await exercise({ id, channel, accessState });
  await exercise({ id: "C046", kind: "malformed", accessState: null });
  assert.deepEqual([...seen].sort(), Array.from({ length: 45 }, (_, index) => `C${String(index + 2).padStart(3, "0")}`));
});

selectedTest("R004", "ownership returns to zero on every admitted path", async () => {
  const seen = new Set();
  const cancellation = () => Object.freeze(Object.create(null));
  const expectedIds = Array.from({ length: 45 }, (_, index) => `C${String(index + 2).padStart(3, "0")}`);
  const scenarios = [
    ["C002", "complete", "public"], ["C003", "sync", "public"], ["C004", "callbackThrow", null],
    ["C005", "thenable", "public"], ["C006", "busy", "public"], ["C007", "timeout", null],
    ["C008", "preCancel", null], ["C009", "cancel", null], ["C010", "duplicate", "public"],
    ["C011", "clockThrow", null], ["C012", "subscribeThrow", null], ["C013", "checkThrow", null],
    ["C014", "scheduleThrow", null], ["C015", "startThrow", null],
    ["C016", "releaseThrow", null, "door", "cancelTransport"],
    ["C017", "releaseThrow", null, "door", "cancelTimeout"],
    ["C018", "releaseThrow", null, "door", "unsubscribeCancellation"],
    ["C019", "hostile", "private"], ["C020", "cleanupReentry", "private"],
    ["C021", "raceCompleteTimeout", "public"], ["C022", "raceTimeoutComplete", null],
    ["C023", "raceCompleteCancel", "public"], ["C024", "raceCancelComplete", null],
    ["C025", "raceTimeoutCancel", null], ["C026", "raceCancelTimeout", null]
  ];
  const parity = [
    ["C027", "door", "tenant"], ["C028", "door", "invited"], ["C029", "door", "private"],
    ["C030", "door", "restricted"], ["C031", "elevator", "public"], ["C032", "elevator", "tenant"],
    ["C033", "elevator", "invited"], ["C034", "elevator", "private"], ["C035", "elevator", "restricted"],
    ["C036", "direct", "public"], ["C037", "direct", "tenant"], ["C038", "direct", "invited"],
    ["C039", "direct", "private"], ["C040", "direct", "restricted"], ["C041", "alternative", "public"],
    ["C042", "alternative", "tenant"], ["C043", "alternative", "invited"], ["C044", "alternative", "private"],
    ["C045", "alternative", "restricted"]
  ];

  const exercise = async ({ id, kind = "complete", accessState = null, channel = "door", release = null }) => {
    assert.equal(seen.has(id), false);
    const owned = { transport: new Set(), timeout: new Set(), cancellation: new Set() };
    const acquired = { transport: 0, timeout: 0, cancellation: 0 };
    const released = { transport: 0, timeout: 0, cancellation: 0 };
    const tokens = [];
    const snapshots = [];
    const callbacks = [];
    const doubleReleases = [];
    const duplicateAcquisitions = [];
    const reentrantBusy = [];
    const responseObservations = [];
    const lateResponseObservations = [];
    let thenGets = 0;
    let first = true;
    let primaryToken;
    let fixture;
    const resourceForRelease = {
      cancelTransport: "transport", cancelTimeout: "timeout", unsubscribeCancellation: "cancellation"
    };
    const acquire = (resource, token) => {
      acquired[resource] += 1;
      if (owned[resource].has(token)) duplicateAcquisitions.push(resource);
      owned[resource].add(token);
      if (!tokens.includes(token)) tokens.push(token);
      if (primaryToken === undefined) primaryToken = token;
    };
    const relinquish = (resource, token) => {
      released[resource] += 1;
      if (!owned[resource].delete(token)) doubleReleases.push(resource);
    };
    const observedResponse = (observations, state = accessState ?? "public") => {
      const response = responseFor(channel, state);
      if (observations === responseObservations) return response;
      return new Proxy(response, {
        getPrototypeOf(target) { observations.push("getPrototypeOf"); return Reflect.getPrototypeOf(target); },
        ownKeys(target) { observations.push("ownKeys"); return Reflect.ownKeys(target); },
        getOwnPropertyDescriptor(target, key) {
          observations.push(`descriptor:${String(key)}`);
          return Reflect.getOwnPropertyDescriptor(target, key);
        },
        get(target, key, receiver) { observations.push(`get:${String(key)}`); return Reflect.get(target, key, receiver); }
      });
    };
    const hostileReturn = () => Object.defineProperty(Object.create(null), "then", {
      get() { thenGets += 1; throw new Error("ownership return assimilated"); }
    });
    const operations = {
      subscribeCancellation(value, token, cancel) {
        callbacks.push(cancel); fixture.state.cancellation = value; fixture.state.cancel = cancel;
        acquire("cancellation", token);
        if (kind === "subscribeThrow" && first) { first = false; throw new Error("private subscribe detail"); }
        return kind === "thenable" ? hostileReturn() : undefined;
      },
      unsubscribeCancellation(token) {
        relinquish("cancellation", token);
        if (kind === "releaseThrow" && release === "unsubscribeCancellation" && first) {
          first = false; throw new Error("private cancellation release detail");
        }
        return kind === "thenable" ? hostileReturn() : undefined;
      },
      isCancellationRequested() {
        if (kind === "preCancel" && first) { first = false; return true; }
        if (kind === "checkThrow" && first) { first = false; throw new Error("private check detail"); }
        return false;
      },
      scheduleTimeout(token, timeoutMs, timeout) {
        fixture.state.timeoutMs = timeoutMs; fixture.state.timeout = timeout; callbacks.push(timeout);
        acquire("timeout", token);
        if (kind === "scheduleThrow" && first) { first = false; throw new Error("private schedule detail"); }
        return kind === "thenable" ? hostileReturn() : undefined;
      },
      cancelTimeout(token) {
        relinquish("timeout", token);
        if (kind === "releaseThrow" && release === "cancelTimeout" && first) {
          first = false; throw new Error("private timeout release detail");
        }
        return kind === "thenable" ? hostileReturn() : undefined;
      },
      startTransport(snapshot, complete, token) {
        fixture.state.starts += 1; fixture.state.snapshot = snapshot; fixture.state.complete = complete;
        fixture.state.token = token; callbacks.push(complete); snapshots.push(snapshot); acquire("transport", token);
        if (primaryToken === undefined) primaryToken = token;
        if (kind === "sync") complete(observedResponse(responseObservations));
        if (kind === "callbackThrow" && first) {
          first = false; complete(observedResponse(responseObservations)); throw new Error("private start detail");
        }
        if (kind === "startThrow" && first) { first = false; throw new Error("private start detail"); }
        return kind === "thenable" ? hostileReturn() : undefined;
      },
      cancelTransport(token) {
        if (kind === "cleanupReentry" && token === primaryToken) {
          const trap = () => { throw new Error("cleanup reentrant argument observed"); };
          const hostile = new Proxy({}, { get: trap, getPrototypeOf: trap, ownKeys: trap, getOwnPropertyDescriptor: trap });
          reentrantBusy.push(fixture.controller.request(hostile, hostile, hostile));
        }
        relinquish("transport", token);
        if (kind === "releaseThrow" && release === "cancelTransport" && first) {
          first = false; throw new Error("private transport release detail");
        }
        return kind === "thenable" ? hostileReturn() : undefined;
      },
      readPostResponseTime() {
        fixture.state.clocks += 1;
        if (kind === "clockThrow" && first) { first = false; throw new Error("private clock detail"); }
        return TRUSTED_MS;
      },
      timeoutMs: 1000
    };
    const dependencies = {
      startTransport: operations.startTransport,
      cancelTransport: operations.cancelTransport,
      scheduleTimeout: operations.scheduleTimeout,
      cancelTimeout: operations.cancelTimeout,
      subscribeCancellation: operations.subscribeCancellation,
      unsubscribeCancellation: operations.unsubscribeCancellation,
      isCancellationRequested: operations.isCancellationRequested,
      readPostResponseTime: operations.readPostResponseTime,
      timeoutMs: operations.timeoutMs
    };
    fixture = {
      state: { complete: null, timeout: null, cancel: null, starts: 0, clocks: 0 },
      controller: controllerModule.createPrivateTenantNavigationRequestController(dependencies)
    };
    const needsCancellation = !["complete", "sync", "callbackThrow", "clockThrow", "scheduleThrow",
      "startThrow", "timeout", "duplicate", "malformed", "hostile", "busy",
      "raceCompleteTimeout", "raceTimeoutComplete"].includes(kind) || release !== null;
    const expectation = { ...BASE_EXPECTATION, channel };
    const authority = structuredClone(BASE_AUTHORITY);
    const pending = fixture.controller.request(expectation, authority, needsCancellation ? cancellation() : null);
    let settlements = 0;
    const rejections = [];
    const observed = pending.then(
      (result) => { settlements += 1; return result; },
      (error) => { rejections.push(error); return error; }
    );
    const originals = {
      complete: fixture.state.complete, timeout: fixture.state.timeout, cancel: fixture.state.cancel
    };
    if (kind === "busy") {
      const before = { acquired: { ...acquired }, owned: ownedCount(owned), callbacks: callbacks.length };
      reentrantBusy.push(fixture.controller.request(structuredClone(BASE_EXPECTATION), structuredClone(BASE_AUTHORITY)));
      assert.deepEqual({ acquired: { ...acquired }, owned: ownedCount(owned), callbacks: callbacks.length }, before);
      originals.complete(observedResponse(responseObservations));
    } else if (kind === "timeout") originals.timeout();
    else if (kind === "cancel") originals.cancel();
    else if (kind === "duplicate") {
      originals.complete(observedResponse(responseObservations));
      originals.complete(observedResponse(lateResponseObservations, "tenant"));
      originals.timeout();
    } else if (kind === "raceCompleteTimeout") {
      originals.complete(observedResponse(responseObservations)); originals.timeout();
    } else if (kind === "raceTimeoutComplete") {
      originals.timeout(); originals.complete(observedResponse(lateResponseObservations));
    } else if (kind === "raceCompleteCancel") {
      originals.complete(observedResponse(responseObservations)); originals.cancel();
    } else if (kind === "raceCancelComplete") {
      originals.cancel(); originals.complete(observedResponse(lateResponseObservations));
    } else if (kind === "raceTimeoutCancel") { originals.timeout(); originals.cancel(); }
    else if (kind === "raceCancelTimeout") { originals.cancel(); originals.timeout(); }
    else if (kind === "malformed") originals.complete(undefined);
    else if (kind === "hostile") {
      const descriptor = Object.getOwnPropertyDescriptor(Object, "freeze");
      try {
        Object.defineProperty(Object, "freeze", {
          value() { throw new Error("hostile replacement observed"); }, configurable: true
        });
        originals.complete(observedResponse(responseObservations, "private"));
      } finally {
        Object.defineProperty(Object, "freeze", descriptor);
      }
    } else if (!["sync", "callbackThrow", "preCancel", "subscribeThrow", "checkThrow",
      "scheduleThrow", "startThrow"].includes(kind)) {
      originals.complete(observedResponse(responseObservations));
    }
    const result = await observed;
    if (accessState === null) exactUnavailable(result); else exactAvailable(result, accessState);
    assert.equal(settlements, 1);
    assert.equal(rejections.length, 0);
    assert.equal(ownedCount(owned), 0);
    assert.deepEqual(doubleReleases, []);
    assert.deepEqual(duplicateAcquisitions, []);
    for (const busy of reentrantBusy) exactUnavailable(await busy);
    assert.equal(thenGets, 0);
    const stableResult = JSON.stringify(result);
    const terminalLedger = {
      acquired: { ...acquired }, released: { ...released }, callbacks: callbacks.length,
      tokens: tokens.length, starts: fixture.state.starts, clocks: fixture.state.clocks
    };
    const staleResponse = observedResponse(lateResponseObservations, "restricted");
    originals.complete?.(staleResponse); originals.complete?.(staleResponse);
    originals.timeout?.(); originals.timeout?.(); originals.cancel?.(); originals.cancel?.();
    await Promise.resolve();
    assert.equal(settlements, 1);
    assert.equal(rejections.length, 0);
    assert.equal(JSON.stringify(result), stableResult);
    assert.equal(lateResponseObservations.length, 0);
    assert.equal(ownedCount(owned), 0);
    assert.deepEqual({
      acquired: { ...acquired }, released: { ...released }, callbacks: callbacks.length,
      tokens: tokens.length, starts: fixture.state.starts, clocks: fixture.state.clocks
    }, terminalLedger);

    const recovery = fixture.controller.request(structuredClone(BASE_EXPECTATION), structuredClone(BASE_AUTHORITY));
    const recoveryComplete = fixture.state.complete;
    const recoveryToken = fixture.state.token;
    const recoveryOwned = ownedCount(owned);
    const recoveryLedger = { acquired: { ...acquired }, released: { ...released }, callbacks: callbacks.length };
    originals.complete?.(staleResponse); originals.timeout?.(); originals.cancel?.();
    await Promise.resolve();
    assert.deepEqual({ acquired: { ...acquired }, released: { ...released }, callbacks: callbacks.length }, recoveryLedger);
    assert.equal(ownedCount(owned), recoveryOwned);
    assert.notEqual(recoveryToken, primaryToken);
    if (ownedCount(owned) !== 0) recoveryComplete(responseFor());
    const recoveredResult = await recovery;
    exactAvailable(recoveredResult, "public");
    assert.notEqual(result, recoveredResult);
    assert.equal(ownedCount(owned), 0);
    assert.deepEqual(doubleReleases, []);
    assert.deepEqual(duplicateAcquisitions, []);
    assert.deepEqual(released, acquired);
    assert.equal(thenGets, 0);
    assert.equal(settlements, 1);
    assert.equal(lateResponseObservations.length, 0);
    assert.equal(tokens.length, 2);
    for (const snapshot of snapshots) {
      assert.deepEqual(Reflect.ownKeys(snapshot), [
        "schemaVersion", "channel", "buildingId", "floorId", "elevatorStopId", "destinationId"
      ]);
      assert.equal(Object.getPrototypeOf(snapshot), null);
      assert.equal(Object.isFrozen(snapshot), true);
      assert.equal("subjectId" in snapshot, false);
      assert.equal("tenantId" in snapshot, false);
      assert.equal("authorizationReference" in snapshot, false);
    }
    assert.deepEqual(expectation, { ...BASE_EXPECTATION, channel });
    assert.deepEqual(authority, BASE_AUTHORITY);
    assert.equal(callbacks.length, acquired.transport + acquired.timeout + acquired.cancellation);
    assert.equal(resourceForRelease[release] ?? null, release === null ? null : resourceForRelease[release]);
    assert.equal(responseObservations.length, 0);
    seen.add(id);
  };

  for (const [id, kind, accessState, channel = "door", release = null] of scenarios) {
    await exercise({ id, kind, accessState, channel, release });
  }
  for (const [id, channel, accessState] of parity) await exercise({ id, channel, accessState });
  await exercise({ id: "C046", kind: "malformed", accessState: null });
  assert.deepEqual([...seen].sort(), expectedIds);
});

selectedTest("A001", "every released channel and access state preserves Tracer 4A meaning", async () => {
  const parity = [
    ["C002", "door", "public"], ["C027", "door", "tenant"], ["C028", "door", "invited"],
    ["C029", "door", "private"], ["C030", "door", "restricted"],
    ["C031", "elevator", "public"], ["C032", "elevator", "tenant"],
    ["C033", "elevator", "invited"], ["C034", "elevator", "private"],
    ["C035", "elevator", "restricted"], ["C036", "direct", "public"],
    ["C037", "direct", "tenant"], ["C038", "direct", "invited"],
    ["C039", "direct", "private"], ["C040", "direct", "restricted"],
    ["C041", "alternative", "public"], ["C042", "alternative", "tenant"],
    ["C043", "alternative", "invited"], ["C044", "alternative", "private"],
    ["C045", "alternative", "restricted"]
  ];
  const expectedIds = ["C002", ...Array.from({ length: 19 }, (_, index) => `C${String(index + 27).padStart(3, "0")}`)];
  const covered = new Set();
  const results = [];

  for (const [id, channel, accessState] of parity) {
    assert.equal(covered.has(id), false);
    const fixture = createFixture();
    const expectation = { ...BASE_EXPECTATION, channel };
    const authority = structuredClone(BASE_AUTHORITY);
    const response = responseFor(channel, accessState);
    const decoder = decisionModule.createPrivateTenantNavigationDecisionDecoder(
      structuredClone(expectation), structuredClone(authority)
    );
    const pending = fixture.controller.request(expectation, authority);
    let settlements = 0;
    const rejections = [];
    const observed = pending.then(
      (result) => { settlements += 1; return result; },
      (error) => { rejections.push(error); return error; }
    );
    let busyObservations = 0;
    const trap = () => { busyObservations += 1; throw new Error("aggregate busy input observed"); };
    const hostile = new Proxy({}, { get: trap, getPrototypeOf: trap, ownKeys: trap, getOwnPropertyDescriptor: trap });
    const busyResult = await fixture.controller.request(hostile, hostile, hostile);
    exactUnavailable(busyResult);
    assert.equal(busyObservations, 0);
    assert.deepEqual(Reflect.ownKeys(fixture.state.snapshot), [
      "schemaVersion", "channel", "buildingId", "floorId", "elevatorStopId", "destinationId"
    ]);
    assert.equal("subjectId" in fixture.state.snapshot, false);
    assert.equal("tenantId" in fixture.state.snapshot, false);
    assert.equal("authorizationReference" in fixture.state.snapshot, false);
    const lateComplete = fixture.state.complete;
    const lateTimeout = fixture.state.timeout;
    lateComplete(response);
    const result = await observed;
    const directResult = decoder.decode(response, TRUSTED_MS);
    exactAvailable(result, accessState);
    exactAvailable(directResult, accessState);
    assert.deepEqual(result, directResult);
    assert.notEqual(result, directResult);
    assert.equal(settlements, 1);
    assert.deepEqual(rejections, []);
    assert.equal(ownedCount(fixture.owned), 0);
    assert.deepEqual(fixture.calls, ["scheduleTimeout", "startTransport", "readPostResponseTime", "cancelTransport", "cancelTimeout"]);
    const terminalCalls = [...fixture.calls];
    const terminalClocks = fixture.state.clocks;
    const terminalResult = JSON.stringify(result);
    lateComplete(responseFor(channel, accessState === "restricted" ? "public" : "restricted"));
    lateTimeout();
    await Promise.resolve();
    assert.equal(settlements, 1);
    assert.deepEqual(rejections, []);
    assert.equal(JSON.stringify(result), terminalResult);
    assert.deepEqual(fixture.calls, terminalCalls);
    assert.equal(fixture.state.clocks, terminalClocks);
    assert.equal(ownedCount(fixture.owned), 0);
    assert.equal(terminalResult.includes(BASE_AUTHORITY.subjectId), false);
    assert.equal(terminalResult.includes(BASE_AUTHORITY.tenantId), false);
    assert.equal(terminalResult.includes(BASE_AUTHORITY.authorizationReference), false);
    const recovered = fixture.controller.request(
      structuredClone(expectation), structuredClone(authority)
    );
    const recoveryComplete = fixture.state.complete;
    const recoveryCalls = [...fixture.calls];
    const recoveryOwned = ownedCount(fixture.owned);
    lateComplete(responseFor(channel, "restricted"));
    lateTimeout();
    await Promise.resolve();
    assert.deepEqual(fixture.calls, recoveryCalls);
    assert.equal(ownedCount(fixture.owned), recoveryOwned);
    recoveryComplete(response);
    const recoveredResult = await recovered;
    exactAvailable(recoveredResult, accessState);
    assert.notEqual(result, recoveredResult);
    assert.equal(ownedCount(fixture.owned), 0);
    covered.add(id);
    results.push(result, busyResult, recoveredResult);
  }

  assert.deepEqual([...covered], expectedIds);
  assert.equal(new Set(results).size, results.length);
  assert.deepEqual([...new Set(parity.map(([, channel]) => channel))], ["door", "elevator", "direct", "alternative"]);
  for (const channel of ["door", "elevator", "direct", "alternative"]) {
    assert.deepEqual(parity.filter(([, value]) => value === channel).map(([, , accessState]) => accessState),
      ["public", "tenant", "invited", "private", "restricted"]);
  }
});

selectedTest("A002", "every admitted lifecycle converges once and recovers idle", async () => {
  const expectedIds = Array.from(
    { length: 45 }, (_, index) => `C${String(index + 2).padStart(3, "0")}`
  );
  const admitted = TOP_LEVEL_REGISTRATIONS.filter(({ id }) => /^C(?:00[2-9]|0[1-3][0-9]|04[0-6])$/.test(id));
  const ownershipAggregate = TOP_LEVEL_REGISTRATIONS.find(({ id }) => id === "R004");
  assert.deepEqual(admitted.map(({ id }) => id).sort(), expectedIds);
  assert.equal(ownershipAggregate?.title, "ownership returns to zero on every admitted path");

  const converged = [];
  for (const { id, implementation } of admitted) {
    await implementation();
    converged.push(id);
  }
  await ownershipAggregate.implementation();

  assert.deepEqual(converged.sort(), expectedIds);
});

selectedTest("A003", "adversarial lifecycle matrix leaves zero owned resources", async () => {
  const expectedIds = Array.from(
    { length: 45 }, (_, index) => `C${String(index + 2).padStart(3, "0")}`
  );
  const admitted = TOP_LEVEL_REGISTRATIONS.filter(({ id }) => /^C(?:00[2-9]|0[1-3][0-9]|04[0-6])$/.test(id));
  const ownershipAggregate = TOP_LEVEL_REGISTRATIONS.find(({ id }) => id === "R004");
  assert.deepEqual(admitted.map(({ id }) => id).sort(), expectedIds);
  assert.equal(ownershipAggregate?.title, "ownership returns to zero on every admitted path");

  const zeroOwned = [];
  for (const { id, implementation } of admitted) {
    await implementation();
    zeroOwned.push(id);
  }
  await ownershipAggregate.implementation();

  assert.deepEqual(zeroOwned.sort(), expectedIds);
});

const PROBE_IMPLEMENTATIONS = new Map([
  ["C024", activeCancellationTerminal],
  ["C026", activeCancellationTerminal],
  ["C021", async () => {
    const fixture = createFixture();
    const pending = fixture.controller.request(structuredClone(BASE_EXPECTATION), structuredClone(BASE_AUTHORITY));
    fixture.state.complete(responseFor());
    fixture.state.timeout();
    exactAvailable(await pending, "public");
    assert.equal(fixture.state.clocks, 1);
    assert.equal(ownedCount(fixture.owned), 0);
    const recovered = fixture.controller.request(structuredClone(BASE_EXPECTATION), structuredClone(BASE_AUTHORITY));
    fixture.state.complete(responseFor());
    exactAvailable(await recovered, "public");
  }],
  ["C022", async () => {
    const fixture = createFixture();
    const pending = fixture.controller.request(structuredClone(BASE_EXPECTATION), structuredClone(BASE_AUTHORITY));
    fixture.state.timeout();
    fixture.state.complete(responseFor());
    exactUnavailable(await pending);
    assert.equal(fixture.state.clocks, 0);
    assert.equal(ownedCount(fixture.owned), 0);
    const recovered = fixture.controller.request(structuredClone(BASE_EXPECTATION), structuredClone(BASE_AUTHORITY));
    fixture.state.complete(responseFor());
    exactAvailable(await recovered, "public");
  }]
]);

if (REGISTRATION_MANIFEST) {
  const source = await readFile(new URL(import.meta.url));
  const hash = createHash("sha256").update(source).digest("hex");
  console.log(`M7T4B_REGISTRATION_MANIFEST test_sha256=${hash} ids=${TOP_LEVEL_REGISTRATIONS.map(({ id }) => id).join(",")}`);
} else if (PRIMARY_PROBE_ID !== "") {
  const probe = PRIMARY_PROBES.find(({ id }) => id === PRIMARY_PROBE_ID);
  if (!probe) process.exitCode = 1;
  else {
    const registration = TOP_LEVEL_REGISTRATIONS.find(({ id }) => id === PRIMARY_PROBE_ID);
    const implementation = registration?.implementation ?? PROBE_IMPLEMENTATIONS.get(PRIMARY_PROBE_ID);
    let status = "FAIL";
    if (implementation) {
      try { await implementation(); status = "PASS"; } catch {}
    }
    console.log(`M7T4B_PRIMARY_PROBE id=${PRIMARY_PROBE_ID} status=${status} production_sha256=${process.env.M7T4B_PRODUCTION_SHA256}`);
  }
} else {
  for (const { id, title, implementation } of TOP_LEVEL_REGISTRATIONS) {
    if (SELECTED_ID === "" || SELECTED_ID === id) test(`${id} ${title}`, implementation);
  }
}
