import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { MessageChannel, MessagePort } from "node:worker_threads";

const CLASSIFIER_PATH = new URL("../src/domain/serviceCondition.ts", import.meta.url);
const DECODER_PATH = new URL("../src/domain/serviceConditionDecoder.ts", import.meta.url);
const ADAPTER_PATH = new URL("../src/domain/serviceConditionSourceAdapter.ts", import.meta.url);
const TRANSPORT_FAILURE = {
  kind: "transport_unavailable",
  error: {
    code: "service_condition_transport_unavailable",
    reason: "Service condition source transport is unavailable."
  }
};
const TIMEOUT = {
  kind: "timeout",
  error: {
    code: "service_condition_source_timeout",
    reason: "Service condition source did not complete before the deadline."
  }
};
const RESPONSE_TOO_LARGE = {
  kind: "response_too_large",
  error: {
    code: "service_condition_response_too_large",
    reason: "Service condition source response exceeds the accepted size."
  }
};
let loadSequence = 0;

async function transpile(source) {
  return ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 }
  }).outputText;
}

async function loadAdapterModule(fragment, {
  observeListener = false,
  observeOwnKeys = false,
  observePost = false,
  observeDecoder = false,
  observeCopy = false,
  throwOnCopy = false,
  throwOnPortCancel = false,
  throwOnRemove = false,
  throwOnClose = false
} = {}) {
  const classifierSource = await readFile(CLASSIFIER_PATH, "utf8");
  const classifierUrl = `data:text/javascript;base64,${Buffer.from(await transpile(classifierSource)).toString("base64")}#classifier-${fragment}-${loadSequence}`;
  const decoderSource = await readFile(DECODER_PATH, "utf8");
  const decoderPattern = /from "\.\/serviceCondition\.ts";/g;
  assert.equal((decoderSource.match(decoderPattern) ?? []).length, 1);
  const decoderUrl = `data:text/javascript;base64,${Buffer.from(await transpile(decoderSource.replace(decoderPattern, `from "${classifierUrl}";`))).toString("base64")}#decoder-${fragment}-${loadSequence}`;
  let adapterSource = await readFile(ADAPTER_PATH, "utf8").catch(() => "export {};\n");
  const adapterPattern = /from "\.\/serviceConditionDecoder\.ts";/g;
  const matches = adapterSource.match(adapterPattern) ?? [];
  assert.equal(matches.length, adapterSource.includes("serviceConditionDecoder") ? 1 : 0);
  adapterSource = adapterSource.replace(adapterPattern, `from "${decoderUrl}";`);
  let listenerInstalled;
  if (observeListener) {
    const marker = "applyReflect(addPortListener, ownedPort, [\"message\", onMessage]);";
    assert.equal(adapterSource.split(marker).length - 1, 1);
    adapterSource = `let __resolveListenerInstalled;\nexport const __listenerInstalled = new Promise(resolve => { __resolveListenerInstalled = resolve; });\n${adapterSource}`
      .replace(marker, `${marker}\n    __resolveListenerInstalled(ownedPort);`);
  }
  if (observeOwnKeys) {
    const marker = "applyReflect(ownKeysReflect, Reflect, [data])";
    assert.equal(adapterSource.split(marker).length - 1, 1);
    adapterSource = `let __observedOwnKeyCount = 0;\nconst __observeOwnKeys = value => { __observedOwnKeyCount = value.length; return value; };\nexport const __getObservedOwnKeyCount = () => __observedOwnKeyCount;\n${adapterSource}`
      .replace(marker, `__observeOwnKeys(${marker})`);
  }
  if (observePost) {
    const marker = "applyReflect(postPort, ownedPort, [startCommand])";
    const matches = adapterSource.split(marker).length - 1;
    assert.ok(matches === 0 || matches === 1);
    adapterSource = `export const __postedValues = [];\n${adapterSource}`;
    if (matches === 1) adapterSource = adapterSource.replace(marker, `(__postedValues.push(startCommand), ${marker})`);
  }
  if (observeDecoder) {
    const marker = "const snapshot = decodeServiceConditionSnapshotJson(input);";
    assert.equal(adapterSource.split(marker).length - 1, 1);
    adapterSource = `let __decoderCalls = 0;\nexport let __decoderInput;\nexport const __getDecoderCalls = () => __decoderCalls;\n${adapterSource}`
      .replace(marker, "__decoderCalls += 1;\n    __decoderInput = input;\n    const snapshot = decodeServiceConditionSnapshotJson(input);");
  }
  if (observeCopy) {
    const marker = "applyReflect(setUint8Array, body, [chunk, bodyLength]);";
    assert.equal(adapterSource.split(marker).length - 1, 1);
    adapterSource = `let __copyAttempts = 0;\nexport const __getCopyAttempts = () => __copyAttempts;\n${adapterSource}`
      .replace(marker, `__copyAttempts += 1;\n            ${marker}`);
  }
  if (throwOnCopy) {
    const marker = "applyReflect(setUint8Array, body, [chunk, bodyLength]);";
    assert.equal(adapterSource.split(marker).length - 1, 1);
    adapterSource = adapterSource.replace(marker, "(() => { throw new Error(\"syn-private-copy-failure\"); })();");
  }
  for (const [enabled, marker, message] of [
    [throwOnPortCancel, "applyReflect(postPort, ownedPort, [cancelCommand]);", "syn-private-port-cancel-failure"],
    [throwOnRemove, "applyReflect(removePortListener, ownedPort, [\"message\", onMessage]);", "syn-private-remove-failure"],
    [throwOnClose, "applyReflect(closePort, ownedPort, []);", "syn-private-close-failure"]
  ]) {
    if (!enabled) continue;
    assert.equal(adapterSource.split(marker).length - 1, 1);
    adapterSource = adapterSource.replace(marker, `(() => { throw new Error(\"${message}\"); })();`);
  }
  loadSequence += 1;
  const adapterUrl = `data:text/javascript;base64,${Buffer.from(await transpile(adapterSource)).toString("base64")}#adapter-${fragment}-${loadSequence}`;
  const module = await import(adapterUrl);
  if (observeListener) listenerInstalled = module.__listenerInstalled;
  return { module, listenerInstalled };
}

function inertClock() {
  return Object.freeze({
    nowMilliseconds: () => 0,
    schedule: () => "syn-inert-handle",
    cancel: () => {}
  });
}

function assertRecursivelyFrozen(value) {
  const pending = [value];
  while (pending.length > 0) {
    const current = pending.pop();
    assert.equal(Object.isFrozen(current), true);
    for (const child of Object.values(current)) {
      if (child !== null && typeof child === "object") pending.push(child);
    }
  }
}

async function rejectsWithoutUnhandled(work) {
  const reasons = [];
  const handler = reason => reasons.push(reason);
  process.on("unhandledRejection", handler);
  try {
    const result = await work();
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(reasons, []);
    return result;
  } finally {
    process.off("unhandledRejection", handler);
  }
}

function assertFreshFrozenTransport(first, second) {
  assert.deepEqual(first, TRANSPORT_FAILURE);
  assert.deepEqual(second, TRANSPORT_FAILURE);
  assert.notEqual(first, second);
  assert.notEqual(first.error, second.error);
  assertRecursivelyFrozen(first);
  assertRecursivelyFrozen(second);
}

test("exports_only_the_source_adapter_and_establishes_the_code_owned_transferred_port_boundary", async () => {
  const { module } = await loadAdapterModule("boundary-export");
  assert.deepEqual(Object.keys(module), ["retrieveServiceConditionSnapshot"]);
  assert.equal(typeof module.retrieveServiceConditionSnapshot, "function");
  const first = await module.retrieveServiceConditionSnapshot(() => {}, inertClock());
  const second = await module.retrieveServiceConditionSnapshot(() => {}, inertClock());
  assertFreshFrozenTransport(first, second);
});

test("denies_legacy_callback_capturing_first_read_constructor_throwing_rejected_promise", async () => {
  const { module } = await loadAdapterModule("constructor-denial");
  let callbackCalls = 0;
  let constructorReads = 0;
  const rejected = Promise.reject(new Error("syn-private-rejection"));
  rejected.catch(() => {});
  Object.defineProperty(rejected, "constructor", { get() { constructorReads += 1; throw new Error("syn-private-constructor"); } });
  const callback = () => { callbackCalls += 1; return rejected; };
  const first = await rejectsWithoutUnhandled(() => module.retrieveServiceConditionSnapshot(callback, inertClock()));
  const second = await rejectsWithoutUnhandled(() => module.retrieveServiceConditionSnapshot(callback, inertClock()));
  assertFreshFrozenTransport(first, second);
  assert.equal(callbackCalls, 0);
  assert.equal(constructorReads, 0);
  assert.doesNotMatch(JSON.stringify(first), /syn-private/);
});

test("denies_legacy_callback_capturing_species_throwing_rejected_promise", async () => {
  const { module } = await loadAdapterModule("species-denial");
  let callbackCalls = 0;
  let speciesReads = 0;
  const rejected = Promise.reject(new Error("syn-private-rejection"));
  rejected.catch(() => {});
  function Constructor() {}
  Object.defineProperty(Constructor, Symbol.species, { get() { speciesReads += 1; throw new Error("syn-private-species"); } });
  Object.defineProperty(rejected, "constructor", { value: Constructor });
  const callback = () => { callbackCalls += 1; return rejected; };
  const first = await rejectsWithoutUnhandled(() => module.retrieveServiceConditionSnapshot(callback, inertClock()));
  const second = await rejectsWithoutUnhandled(() => module.retrieveServiceConditionSnapshot(callback, inertClock()));
  assertFreshFrozenTransport(first, second);
  assert.equal(callbackCalls, 0);
  assert.equal(speciesReads, 0);
  assert.doesNotMatch(JSON.stringify(first), /syn-private/);
});

test("denies_the_former_stateful_second_read_promise_path_before_callback_invocation", async () => {
  const { module } = await loadAdapterModule("stateful-denial");
  let callbackCalls = 0;
  let constructorReads = 0;
  const callback = () => { callbackCalls += 1; };
  Object.defineProperty(callback, "constructor", { get() { constructorReads += 1; return constructorReads === 1 ? Function : Promise; } });
  const first = await module.retrieveServiceConditionSnapshot(callback, inertClock());
  const second = await module.retrieveServiceConditionSnapshot(callback, inertClock());
  assertFreshFrozenTransport(first, second);
  assert.equal(callbackCalls, 0);
  assert.equal(constructorReads, 0);
});

test("detaches_the_caller_wrapper_and_denies_direct_dispatch_identity_injection", async () => {
  const { module, listenerInstalled } = await loadAdapterModule("direct-dispatch-denial", { observeListener: true });
  const { port1: sourcePort, port2: peerPort } = new MessageChannel();
  let hostileReads = 0;
  const rejected = Promise.reject(new Error("syn-private-promise"));
  rejected.catch(() => {});
  const proxy = new Proxy({}, {
    getPrototypeOf() { hostileReads += 1; return Object.prototype; },
    ownKeys() { hostileReads += 1; return []; },
    getOwnPropertyDescriptor() { hostileReads += 1; return undefined; },
    get() { hostileReads += 1; return undefined; }
  });
  const accessor = Object.defineProperty({}, "syn", { enumerable: true, get() { hostileReads += 1; return "private"; } });
  const oversized = Object.defineProperty({ nested: new Array(20_000).fill(null) }, "fringe", { enumerable: true, get() { hostileReads += 1; return "private"; } });
  const resultPromise = module.retrieveServiceConditionSnapshot(sourcePort, inertClock());
  const ownedPort = await listenerInstalled;
  assert.notEqual(ownedPort, sourcePort);
  assert.equal(Object.getPrototypeOf(ownedPort), MessagePort.prototype);
  let settled = false;
  resultPromise.then(() => { settled = true; });
  await Promise.resolve();
  assert.equal(settled, false);
  for (const data of [rejected, proxy, accessor, oversized]) {
    sourcePort.dispatchEvent(new MessageEvent("message", { data }));
  }
  await Promise.resolve();
  assert.equal(settled, false);
  assert.equal(hostileReads, 0);
  peerPort.postMessage({ kind: "transport_unavailable" });
  const first = await resultPromise;
  const { port1: secondSource, port2: secondPeer } = new MessageChannel();
  const secondPromise = module.retrieveServiceConditionSnapshot(secondSource, inertClock());
  await listenerInstalled.catch(() => {});
  secondPeer.postMessage({ kind: "transport_unavailable" });
  const second = await secondPromise;
  assertFreshFrozenTransport(first, second);
  assert.doesNotMatch(JSON.stringify(first), /private|promise/);
  peerPort.close();
  secondPeer.close();
});

test("skips_start_after_synchronous_initial_timeout_callback", async t => {
  const { module } = await loadAdapterModule("sync-initial-timeout");
  const { port1: sourcePort, port2: peerPort } = new MessageChannel();
  t.after(() => peerPort.close());
  let nowCalls = 0;
  let scheduleCalls = 0;
  let startPosts = 0;
  peerPort.on("message", () => { startPosts += 1; });
  const clock = {
    nowMilliseconds() { nowCalls += 1; return nowCalls === 1 ? 0 : 5_000; },
    schedule(callback, delay) {
      scheduleCalls += 1;
      assert.equal(delay, 5_000);
      callback();
      return "syn-handle-initial";
    },
    cancel() {}
  };
  const pending = module.retrieveServiceConditionSnapshot(sourcePort, clock);
  const result = await Promise.race([pending, new Promise(resolve => setImmediate(() => resolve("syn-pending")))]);
  assert.deepEqual(result, TIMEOUT);
  assert.equal(scheduleCalls, 1);
  assert.equal(nowCalls, 2);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(startPosts, 0);
  assertRecursivelyFrozen(result);
});

test("cancels_initial_handle_returned_after_synchronous_timeout_exactly_once", async t => {
  const { module } = await loadAdapterModule("sync-timeout-stale-handle");
  const { port1: sourcePort, port2: peerPort } = new MessageChannel();
  t.after(() => peerPort.close());
  const handle = { id: "syn-initial-timeout-handle" };
  const cancellations = [];
  let nowCalls = 0;
  const clock = {
    nowMilliseconds() { nowCalls += 1; return nowCalls === 1 ? 0 : 5_000; },
    schedule(callback) { callback(); return handle; },
    cancel(candidate) { cancellations.push(candidate); }
  };

  const result = await module.retrieveServiceConditionSnapshot(sourcePort, clock);

  assert.deepEqual(result, TIMEOUT);
  assert.deepEqual(cancellations, [handle]);
});

test("replaces_a_synchronous_early_initial_callback_with_a_new_generation", async t => {
  const { module } = await loadAdapterModule("sync-early-replacement");
  const { port1: sourcePort, port2: peerPort } = new MessageChannel();
  t.after(() => peerPort.close());
  const delays = [];
  let nowCalls = 0;
  const clock = {
    nowMilliseconds() { nowCalls += 1; return nowCalls === 1 ? 0 : 1_000; },
    schedule(callback, delay) {
      delays.push(delay);
      if (delays.length === 1) callback();
      return `syn-generation-${delays.length}`;
    },
    cancel() {}
  };
  const pending = module.retrieveServiceConditionSnapshot(sourcePort, clock);
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(delays, [5_000, 4_000]);
  peerPort.postMessage({ kind: "transport_unavailable" });
  assert.deepEqual(await pending, TRANSPORT_FAILURE);
});

test("cancels_initial_handle_returned_after_synchronous_early_replacement_exactly_once", async t => {
  const { module } = await loadAdapterModule("sync-early-stale-handle");
  const { port1: sourcePort, port2: peerPort } = new MessageChannel();
  t.after(() => peerPort.close());
  const initialHandle = { id: "syn-initial-early" };
  const replacementHandle = { id: "syn-replacement" };
  const cancellations = [];
  let nowCalls = 0;
  let schedules = 0;
  const clock = {
    nowMilliseconds() { nowCalls += 1; return nowCalls === 1 ? 0 : 1_000; },
    schedule(callback) {
      schedules += 1;
      const thisSchedule = schedules;
      if (thisSchedule === 1) callback();
      return thisSchedule === 1 ? initialHandle : replacementHandle;
    },
    cancel(handle) { cancellations.push(handle); }
  };
  const pending = module.retrieveServiceConditionSnapshot(sourcePort, clock);
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(cancellations, [initialHandle]);
  peerPort.postMessage({ kind: "transport_unavailable" });
  await pending;
  assert.deepEqual(cancellations, [initialHandle, replacementHandle]);
});

test("guards_an_already_returned_early_initial_timer_callback_against_hostile_cancel_reentry", async t => {
  const { module } = await loadAdapterModule("timer-cancel-reentry");
  const { port1: sourcePort, port2: peerPort } = new MessageChannel();
  t.after(() => peerPort.close());
  const callbacks = [];
  const handles = [];
  const cancellations = [];
  let nowCalls = 0;
  const clock = {
    nowMilliseconds() { nowCalls += 1; return nowCalls === 1 ? 0 : 1_000; },
    schedule(callback) {
      callbacks.push(callback);
      const handle = { id: `syn-handle-${callbacks.length}` };
      handles.push(handle);
      return handle;
    },
    cancel(handle) {
      cancellations.push(handle);
      if (handle === handles[0]) callbacks[0]();
    }
  };
  const pending = module.retrieveServiceConditionSnapshot(sourcePort, clock);
  let settled = false;
  pending.then(() => { settled = true; });

  callbacks[0]();
  await Promise.resolve();
  const observed = {
    scheduleCalls: callbacks.length,
    generation: callbacks.length,
    replacementRegistrations: callbacks.length - 1,
    cancellationAttempts: cancellations.length,
    clockReadsAfterStart: nowCalls - 1,
    terminalUnset: !settled
  };
  peerPort.postMessage({ kind: "transport_unavailable" });
  await pending;

  assert.deepEqual(observed, {
    scheduleCalls: 2,
    generation: 2,
    replacementRegistrations: 1,
    cancellationAttempts: 1,
    clockReadsAfterStart: 1,
    terminalUnset: true
  });
  assert.equal(cancellations[0], handles[0]);
});

test("settles_timeout_when_replacement_callback_runs_before_replacement_handle_return", async t => {
  const { module } = await loadAdapterModule("sync-replacement-timeout");
  const { port1: sourcePort, port2: peerPort } = new MessageChannel();
  t.after(() => peerPort.close());
  const handles = [{ id: "syn-initial" }, { id: "syn-replacement" }];
  const cancellations = [];
  let nowCalls = 0;
  let schedules = 0;
  const clock = {
    nowMilliseconds() { nowCalls += 1; return [0, 1_000, 5_000][nowCalls - 1]; },
    schedule(callback) {
      const index = schedules;
      schedules += 1;
      callback();
      return handles[index];
    },
    cancel(handle) { cancellations.push(handle); }
  };
  const pending = module.retrieveServiceConditionSnapshot(sourcePort, clock);
  const result = await Promise.race([
    pending,
    new Promise(resolve => setImmediate(() => resolve("syn-pending")))
  ]);
  if (result === "syn-pending") {
    peerPort.postMessage({ kind: "transport_unavailable" });
    await pending;
  }
  assert.deepEqual(result, TIMEOUT);
  assert.equal(schedules, 2);
  assert.deepEqual(cancellations, [handles[1], handles[0]]);
});

test("settles_transport_failure_when_replacement_callback_is_synchronously_early", async t => {
  const { module } = await loadAdapterModule("sync-replacement-early");
  const { port1: sourcePort, port2: peerPort } = new MessageChannel();
  t.after(() => peerPort.close());
  const handles = [{ id: "syn-initial" }, { id: "syn-replacement" }];
  const cancellations = [];
  let nowCalls = 0;
  let schedules = 0;
  const clock = {
    nowMilliseconds() { nowCalls += 1; return [0, 1_000, 2_000][nowCalls - 1]; },
    schedule(callback) {
      const index = schedules;
      schedules += 1;
      callback();
      return handles[index];
    },
    cancel(handle) { cancellations.push(handle); }
  };
  const pending = module.retrieveServiceConditionSnapshot(sourcePort, clock);
  const result = await Promise.race([
    pending,
    new Promise(resolve => setImmediate(() => resolve("syn-pending")))
  ]);
  if (result === "syn-pending") {
    peerPort.postMessage({ kind: "transport_unavailable" });
    await pending;
  }
  assert.deepEqual(result, TRANSPORT_FAILURE);
  assert.equal(schedules, 2);
  assert.deepEqual(cancellations, [handles[1], handles[0]]);
});

test("preserves_timeout_when_initial_schedule_calls_back_then_throws", async t => {
  const { module } = await loadAdapterModule("initial-timeout-then-throw");
  const { port1: sourcePort, port2: peerPort } = new MessageChannel();
  t.after(() => peerPort.close());
  let nowCalls = 0;
  let cancelCalls = 0;
  const clock = {
    nowMilliseconds() { nowCalls += 1; return nowCalls === 1 ? 0 : 5_000; },
    schedule(callback) { callback(); throw new Error("syn-schedule-after-timeout"); },
    cancel() { cancelCalls += 1; }
  };
  const result = await module.retrieveServiceConditionSnapshot(sourcePort, clock);
  assert.deepEqual(result, TIMEOUT);
  assert.equal(cancelCalls, 0);
});

test("maps_initial_early_callback_then_original_schedule_throw_to_transport_failure", async t => {
  const { module } = await loadAdapterModule("initial-early-then-throw");
  const { port1: sourcePort, port2: peerPort } = new MessageChannel();
  t.after(() => peerPort.close());
  const replacementHandle = { id: "syn-replacement-after-early" };
  const cancellations = [];
  let nowCalls = 0;
  let schedules = 0;
  const clock = {
    nowMilliseconds() { nowCalls += 1; return nowCalls === 1 ? 0 : 1_000; },
    schedule(callback) {
      schedules += 1;
      if (schedules === 1) {
        callback();
        throw new Error("syn-original-schedule-after-early");
      }
      return replacementHandle;
    },
    cancel(handle) { cancellations.push(handle); }
  };
  const result = await module.retrieveServiceConditionSnapshot(sourcePort, clock);
  assert.deepEqual(result, TRANSPORT_FAILURE);
  assert.equal(schedules, 2);
  assert.deepEqual(cancellations, [replacementHandle]);
});

test("preserves_replacement_terminal_result_when_replacement_schedule_calls_back_then_throws", async t => {
  const { module } = await loadAdapterModule("replacement-timeout-then-throw");
  const { port1: sourcePort, port2: peerPort } = new MessageChannel();
  t.after(() => peerPort.close());
  let nowCalls = 0;
  let schedules = 0;
  let cancelCalls = 0;
  const clock = {
    nowMilliseconds() { nowCalls += 1; return [0, 1_000, 5_000][nowCalls - 1]; },
    schedule(callback) {
      schedules += 1;
      callback();
      if (schedules === 2) throw new Error("syn-replacement-schedule-after-timeout");
      return "syn-initial-handle";
    },
    cancel() { cancelCalls += 1; }
  };
  const result = await module.retrieveServiceConditionSnapshot(sourcePort, clock);
  assert.deepEqual(result, TIMEOUT);
  assert.equal(schedules, 2);
  assert.equal(cancelCalls, 0);
});

test("ignores_old_generation_callback_after_replacement_before_clock_access", async t => {
  const { module } = await loadAdapterModule("old-generation-replay");
  const { port1: sourcePort, port2: peerPort } = new MessageChannel();
  t.after(() => peerPort.close());
  const callbacks = [];
  const cancellations = [];
  let nowCalls = 0;
  const clock = {
    nowMilliseconds() { nowCalls += 1; return nowCalls === 1 ? 0 : 1_000; },
    schedule(callback) { callbacks.push(callback); return `syn-generation-${callbacks.length}`; },
    cancel(handle) { cancellations.push(handle); }
  };
  const pending = module.retrieveServiceConditionSnapshot(sourcePort, clock);
  callbacks[0]();
  const beforeReplay = { schedules: callbacks.length, nowCalls, cancellations: cancellations.length };
  callbacks[0]();
  assert.deepEqual(
    { schedules: callbacks.length, nowCalls, cancellations: cancellations.length },
    beforeReplay
  );
  peerPort.postMessage({ kind: "transport_unavailable" });
  assert.deepEqual(await pending, TRANSPORT_FAILURE);
});

test("cancels_equal_handle_values_once_per_successful_schedule_occurrence", async t => {
  const { module } = await loadAdapterModule("equal-handle-occurrences");
  const { port1: sourcePort, port2: peerPort } = new MessageChannel();
  t.after(() => peerPort.close());
  const sharedHandle = { id: "syn-equal-handle" };
  const cancellations = [];
  let nowCalls = 0;
  let schedules = 0;
  const clock = {
    nowMilliseconds() { nowCalls += 1; return nowCalls === 1 ? 0 : 1_000; },
    schedule(callback) {
      schedules += 1;
      if (schedules === 1) callback();
      return sharedHandle;
    },
    cancel(handle) { cancellations.push(handle); }
  };
  const pending = module.retrieveServiceConditionSnapshot(sourcePort, clock);
  peerPort.postMessage({ kind: "transport_unavailable" });
  assert.deepEqual(await pending, TRANSPORT_FAILURE);
  assert.equal(schedules, 2);
  assert.deepEqual(cancellations, [sharedHandle, sharedHandle]);
});

test("cancels_the_live_timely_completion_handle_once", async t => {
  const { module } = await loadAdapterModule("timely-complete-live-handle");
  const { port1: sourcePort, port2: peerPort } = new MessageChannel();
  t.after(() => peerPort.close());
  const handle = { id: "syn-live-completion-handle" };
  const cancellations = [];
  const clock = {
    nowMilliseconds: () => 0,
    schedule: () => handle,
    cancel(candidate) { cancellations.push(candidate); }
  };
  const pending = module.retrieveServiceConditionSnapshot(sourcePort, clock);
  peerPort.postMessage({ kind: "complete" });
  await pending;
  assert.deepEqual(cancellations, [handle]);
});

test("records_the_platform_clone_denial_and_malicious_peer_trust_boundary", async t => {
  const unhandled = [];
  const onUnhandled = reason => unhandled.push(reason);
  process.on("unhandledRejection", onUnhandled);
  t.after(() => process.off("unhandledRejection", onUnhandled));

  const firstLoaded = await loadAdapterModule("platform-clone-denial");
  const firstChannel = new MessageChannel();
  t.after(() => firstChannel.port2.close());
  const rejected = Promise.reject(new Error("syn-private-promise"));
  rejected.catch(() => {});
  const firstPending = firstLoaded.module.retrieveServiceConditionSnapshot(firstChannel.port1, inertClock());
  assert.throws(() => firstChannel.port2.postMessage(rejected), { name: "DataCloneError" });
  firstChannel.port2.postMessage({ kind: "transport_unavailable" });
  assert.deepEqual(await firstPending, TRANSPORT_FAILURE);

  const secondLoaded = await loadAdapterModule("malicious-peer-cardinality", { observeOwnKeys: true });
  const secondChannel = new MessageChannel();
  t.after(() => secondChannel.port2.close());
  const wideRecord = { kind: "transport_unavailable" };
  for (let index = 0; index < 20_000; index += 1) wideRecord[`syn-extra-${index}`] = index;
  const secondPending = secondLoaded.module.retrieveServiceConditionSnapshot(secondChannel.port1, inertClock());
  secondChannel.port2.postMessage(wideRecord);
  const secondResult = await secondPending;
  assert.equal(secondLoaded.module.__getObservedOwnKeyCount(), 20_001);
  assert.deepEqual(secondResult, TRANSPORT_FAILURE);
  assert.doesNotMatch(JSON.stringify(secondResult), /syn-extra|private/);
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(unhandled, []);
});

test("posts_one_start_and_receives_one_bounded_synthetic_body", async t => {
  const { module } = await loadAdapterModule("start-and-body", { observePost: true });
  const { port1: sourcePort, port2: peerPort } = new MessageChannel();
  t.after(() => peerPort.close());
  const body = new TextEncoder().encode(JSON.stringify({
    schemaVersion: "1.0",
    generatedAt: "2026-09-13T00:00:00.000Z",
    components: []
  }));
  const peerStarts = [];
  let resolveStart;
  const startObserved = new Promise(resolve => { resolveStart = resolve; });
  peerPort.on("message", async record => {
    if (record?.kind !== "start") return;
    peerStarts.push(record);
    await new Promise(resolve => setTimeout(resolve, 50));
    resolveStart();
    peerPort.postMessage({ kind: "chunk", chunk: body });
    peerPort.postMessage({ kind: "complete" });
  });
  const pending = module.retrieveServiceConditionSnapshot(sourcePort, inertClock());
  await startObserved;
  const result = await pending;

  assert.equal(peerStarts.length, 1);
  assert.deepEqual(peerStarts[0], { kind: "start" });
  assert.equal(module.__postedValues.length, 1);
  assert.deepEqual(module.__postedValues[0], { kind: "start" });
  assert.notEqual(module.__postedValues[0], peerStarts[0]);
  assertRecursivelyFrozen(module.__postedValues[0]);
  assert.equal(result.kind, "received");
  assert.equal(result.snapshot.ok, true);
  assertRecursivelyFrozen(result);
});

test("maps_explicit_source_unavailable_record_to_generic_transport_failure", async t => {
  const { module } = await loadAdapterModule("explicit-source-unavailable");
  const { port1: sourcePort, port2: peerPort } = new MessageChannel();
  t.after(() => peerPort.close());
  const observed = [];
  peerPort.on("message", record => {
    observed.push(record);
    if (record?.kind === "start") peerPort.postMessage({ kind: "transport_unavailable" });
  });
  const result = await module.retrieveServiceConditionSnapshot(sourcePort, inertClock());
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.deepEqual(result, TRANSPORT_FAILURE);
  assert.deepEqual(observed.map(record => record.kind), ["start", "cancel"]);
  assert.doesNotMatch(JSON.stringify(result), /syn-/);
});

test("uses_first_terminal_order_for_multiple_and_reentrant_port_events", async t => {
  const body = new TextEncoder().encode(JSON.stringify({
    schemaVersion: "1.0",
    generatedAt: "2026-09-13T00:00:00.000Z",
    components: []
  }));

  const completeFirst = await loadAdapterModule("complete-first-reentrant", { observeListener: true });
  const firstChannel = new MessageChannel();
  t.after(() => firstChannel.port2.close());
  const firstPending = completeFirst.module.retrieveServiceConditionSnapshot(firstChannel.port1, inertClock());
  const firstOwnedPort = await completeFirst.listenerInstalled;
  firstOwnedPort.dispatchEvent(new MessageEvent("message", { data: { kind: "chunk", chunk: body } }));
  firstOwnedPort.dispatchEvent(new MessageEvent("message", { data: { kind: "complete" } }));
  firstOwnedPort.dispatchEvent(new MessageEvent("message", { data: { kind: "transport_unavailable" } }));
  const first = await firstPending;
  assert.equal(first.kind, "received");

  const unavailableFirst = await loadAdapterModule("unavailable-first-reentrant", { observeListener: true });
  const secondChannel = new MessageChannel();
  t.after(() => secondChannel.port2.close());
  const secondPending = unavailableFirst.module.retrieveServiceConditionSnapshot(secondChannel.port1, inertClock());
  const secondOwnedPort = await unavailableFirst.listenerInstalled;
  secondOwnedPort.dispatchEvent(new MessageEvent("message", { data: { kind: "transport_unavailable" } }));
  secondOwnedPort.dispatchEvent(new MessageEvent("message", { data: { kind: "complete" } }));
  assert.deepEqual(await secondPending, TRANSPORT_FAILURE);
});

test("suppresses_late_port_events_after_timeout_before_event_data_access", async t => {
  const { module, listenerInstalled } = await loadAdapterModule("late-event-after-timeout", { observeListener: true });
  const { port1: sourcePort, port2: peerPort } = new MessageChannel();
  t.after(() => peerPort.close());
  let scheduledCallback;
  let nowCalls = 0;
  const clock = {
    nowMilliseconds() { nowCalls += 1; return nowCalls === 1 ? 0 : 5_000; },
    schedule(callback) { scheduledCallback = callback; return "syn-timeout-handle"; },
    cancel() {}
  };
  const pending = module.retrieveServiceConditionSnapshot(sourcePort, clock);
  const ownedPort = await listenerInstalled;
  scheduledCallback();
  const result = await pending;
  let dataReads = 0;
  const lateEvent = new MessageEvent("message");
  Object.defineProperty(lateEvent, "data", {
    get() { dataReads += 1; return { kind: "syn-private-late" }; }
  });
  ownedPort.dispatchEvent(lateEvent);
  assert.deepEqual(result, TIMEOUT);
  assert.equal(dataReads, 0);
  assert.doesNotMatch(JSON.stringify(result), /syn-private/);
});

test("rejects_unchanged_buffer_carrier_before_copy_or_decoder", async t => {
  const { module, listenerInstalled } = await loadAdapterModule("unchanged-buffer", {
    observeListener: true,
    observeDecoder: true
  });
  const { port1: sourcePort, port2: peerPort } = new MessageChannel();
  t.after(() => peerPort.close());
  const pending = module.retrieveServiceConditionSnapshot(sourcePort, inertClock());
  const ownedPort = await listenerInstalled;
  const unchangedBuffer = Buffer.from(JSON.stringify({
    schemaVersion: "1.0",
    generatedAt: "2026-09-13T00:00:00.000Z",
    components: []
  }));
  assert.notEqual(Object.getPrototypeOf(unchangedBuffer), Uint8Array.prototype);
  ownedPort.dispatchEvent(new MessageEvent("message", {
    data: { kind: "chunk", chunk: unchangedBuffer }
  }));
  ownedPort.dispatchEvent(new MessageEvent("message", { data: { kind: "complete" } }));
  const result = await pending;
  assert.deepEqual(result, TRANSPORT_FAILURE);
  assert.equal(module.__getDecoderCalls(), 0);
});

test("rejects_unchanged_uint8array_subclass_before_copy_or_decoder", async t => {
  class SyntheticBytes extends Uint8Array {}
  const { module, listenerInstalled } = await loadAdapterModule("unchanged-subclass", {
    observeListener: true,
    observeDecoder: true
  });
  const { port1: sourcePort, port2: peerPort } = new MessageChannel();
  t.after(() => peerPort.close());
  const pending = module.retrieveServiceConditionSnapshot(sourcePort, inertClock());
  const ownedPort = await listenerInstalled;
  const chunk = new SyntheticBytes([123, 125]);
  assert.notEqual(Object.getPrototypeOf(chunk), Uint8Array.prototype);
  ownedPort.dispatchEvent(new MessageEvent("message", { data: { kind: "chunk", chunk } }));
  assert.deepEqual(await pending, TRANSPORT_FAILURE);
  assert.equal(module.__getDecoderCalls(), 0);
});

test("rejects_unchanged_cross_realm_uint8array_before_copy_or_decoder", async t => {
  const { module, listenerInstalled } = await loadAdapterModule("unchanged-cross-realm", {
    observeListener: true,
    observeDecoder: true
  });
  const { port1: sourcePort, port2: peerPort } = new MessageChannel();
  t.after(() => peerPort.close());
  const pending = module.retrieveServiceConditionSnapshot(sourcePort, inertClock());
  const ownedPort = await listenerInstalled;
  const chunk = vm.runInNewContext("new Uint8Array([123, 125])");
  assert.notEqual(Object.getPrototypeOf(chunk), Uint8Array.prototype);
  ownedPort.dispatchEvent(new MessageEvent("message", { data: { kind: "chunk", chunk } }));
  assert.deepEqual(await pending, TRANSPORT_FAILURE);
  assert.equal(module.__getDecoderCalls(), 0);
});

test("rejects_proxy_carrier_with_captured_brand_getters", async t => {
  const { module, listenerInstalled } = await loadAdapterModule("proxy-carrier", {
    observeListener: true,
    observeDecoder: true
  });
  const { port1: sourcePort, port2: peerPort } = new MessageChannel();
  t.after(() => peerPort.close());
  let hostileReads = 0;
  const chunk = new Proxy(new Uint8Array([123, 125]), {
    getPrototypeOf() { hostileReads += 1; return Uint8Array.prototype; },
    get(target, property, receiver) {
      hostileReads += 1;
      return Reflect.get(target, property, receiver);
    }
  });
  const pending = module.retrieveServiceConditionSnapshot(sourcePort, inertClock());
  const ownedPort = await listenerInstalled;
  ownedPort.dispatchEvent(new MessageEvent("message", { data: { kind: "chunk", chunk } }));
  assert.deepEqual(await pending, TRANSPORT_FAILURE);
  assert.equal(hostileReads, 1);
  assert.equal(module.__getDecoderCalls(), 0);
});

test("rejects_shared_backed_carrier_before_copy_or_decoder", async t => {
  const { module, listenerInstalled } = await loadAdapterModule("shared-backed", {
    observeListener: true,
    observeDecoder: true
  });
  const { port1: sourcePort, port2: peerPort } = new MessageChannel();
  t.after(() => peerPort.close());
  const pending = module.retrieveServiceConditionSnapshot(sourcePort, inertClock());
  const ownedPort = await listenerInstalled;
  const chunk = new Uint8Array(new SharedArrayBuffer(2));
  chunk.set([123, 125]);
  ownedPort.dispatchEvent(new MessageEvent("message", { data: { kind: "chunk", chunk } }));
  ownedPort.dispatchEvent(new MessageEvent("message", { data: { kind: "complete" } }));
  assert.deepEqual(await pending, TRANSPORT_FAILURE);
  assert.equal(module.__getDecoderCalls(), 0);
});

test("rejects_detached_carrier_including_zero_length_detachment", async t => {
  const { module, listenerInstalled } = await loadAdapterModule("detached-zero", {
    observeListener: true,
    observeDecoder: true,
    observeCopy: true
  });
  const { port1: sourcePort, port2: peerPort } = new MessageChannel();
  t.after(() => peerPort.close());
  const chunk = new Uint8Array(0);
  structuredClone(chunk.buffer, { transfer: [chunk.buffer] });
  const pending = module.retrieveServiceConditionSnapshot(sourcePort, inertClock());
  const ownedPort = await listenerInstalled;
  ownedPort.dispatchEvent(new MessageEvent("message", { data: { kind: "chunk", chunk } }));
  assert.deepEqual(await pending, TRANSPORT_FAILURE);
  assert.equal(module.__getCopyAttempts(), 0);
  assert.equal(module.__getDecoderCalls(), 0);
});

test("admits_genuinely_branded_prototype_normalized_buffer", async t => {
  const { module, listenerInstalled } = await loadAdapterModule("normalized-buffer", {
    observeListener: true,
    observeDecoder: true
  });
  const { port1: sourcePort, port2: peerPort } = new MessageChannel();
  t.after(() => peerPort.close());
  const chunk = Buffer.from(JSON.stringify({ schemaVersion: "1.0", generatedAt: "2026-09-13T00:00:00.000Z", components: [] }));
  Object.setPrototypeOf(chunk, Uint8Array.prototype);
  const pending = module.retrieveServiceConditionSnapshot(sourcePort, inertClock());
  const ownedPort = await listenerInstalled;
  ownedPort.dispatchEvent(new MessageEvent("message", { data: { kind: "chunk", chunk } }));
  ownedPort.dispatchEvent(new MessageEvent("message", { data: { kind: "complete" } }));
  const result = await pending;
  assert.equal(result.kind, "received");
  assert.equal(result.snapshot.ok, true);
  assert.equal(module.__getDecoderCalls(), 1);
});

test("admits_genuinely_branded_prototype_normalized_subclass", async t => {
  class SyntheticBytes extends Uint8Array {}
  const { module, listenerInstalled } = await loadAdapterModule("normalized-subclass", {
    observeListener: true,
    observeDecoder: true
  });
  const { port1: sourcePort, port2: peerPort } = new MessageChannel();
  t.after(() => peerPort.close());
  const chunk = new SyntheticBytes(new TextEncoder().encode(JSON.stringify({ schemaVersion: "1.0", generatedAt: "2026-09-13T00:00:00.000Z", components: [] })));
  Object.setPrototypeOf(chunk, Uint8Array.prototype);
  const pending = module.retrieveServiceConditionSnapshot(sourcePort, inertClock());
  const ownedPort = await listenerInstalled;
  ownedPort.dispatchEvent(new MessageEvent("message", { data: { kind: "chunk", chunk } }));
  ownedPort.dispatchEvent(new MessageEvent("message", { data: { kind: "complete" } }));
  const result = await pending;
  assert.equal(result.kind, "received");
  assert.equal(result.snapshot.ok, true);
  assert.equal(module.__getDecoderCalls(), 1);
});

test("admits_genuinely_branded_prototype_normalized_cross_realm_carrier", async t => {
  const { module, listenerInstalled } = await loadAdapterModule("normalized-cross-realm", {
    observeListener: true,
    observeDecoder: true
  });
  const { port1: sourcePort, port2: peerPort } = new MessageChannel();
  t.after(() => peerPort.close());
  const bytes = [...new TextEncoder().encode(JSON.stringify({ schemaVersion: "1.0", generatedAt: "2026-09-13T00:00:00.000Z", components: [] }))];
  const chunk = vm.runInNewContext(`new Uint8Array(${JSON.stringify(bytes)})`);
  Object.setPrototypeOf(chunk.buffer, ArrayBuffer.prototype);
  Object.setPrototypeOf(chunk, Uint8Array.prototype);
  const pending = module.retrieveServiceConditionSnapshot(sourcePort, inertClock());
  const ownedPort = await listenerInstalled;
  ownedPort.dispatchEvent(new MessageEvent("message", { data: { kind: "chunk", chunk } }));
  ownedPort.dispatchEvent(new MessageEvent("message", { data: { kind: "complete" } }));
  const result = await pending;
  assert.equal(result.kind, "received");
  assert.equal(result.snapshot.ok, true);
  assert.equal(module.__getDecoderCalls(), 1);
});

test("receives_one_bounded_synthetic_body_and_delegates_exactly_once", async t => {
  const { module, listenerInstalled } = await loadAdapterModule("detached-decoder-delegation", {
    observeListener: true,
    observeDecoder: true
  });
  const { port1: sourcePort, port2: peerPort } = new MessageChannel();
  t.after(() => peerPort.close());
  const chunk = new TextEncoder().encode(JSON.stringify({ schemaVersion: "1.0", generatedAt: "2026-09-13T00:00:00.000Z", components: [] }));
  const original = new Uint8Array(chunk);
  const pending = module.retrieveServiceConditionSnapshot(sourcePort, inertClock());
  const ownedPort = await listenerInstalled;
  ownedPort.dispatchEvent(new MessageEvent("message", { data: { kind: "chunk", chunk } }));
  chunk.fill(0);
  ownedPort.dispatchEvent(new MessageEvent("message", { data: { kind: "complete" } }));
  const result = await pending;
  assert.equal(result.kind, "received");
  assert.equal(result.snapshot.ok, true);
  assert.equal(module.__getDecoderCalls(), 1);
  assert.notEqual(module.__decoderInput, chunk);
  assert.deepEqual(module.__decoderInput, original);
  assert.equal(Object.getPrototypeOf(module.__decoderInput), Uint8Array.prototype);
  assert.equal(Object.getPrototypeOf(module.__decoderInput.buffer), ArrayBuffer.prototype);
});

test("accepts_ordered_positive_chunks", async t => {
  const { module, listenerInstalled } = await loadAdapterModule("ordered-positive-chunks", {
    observeListener: true,
    observeDecoder: true
  });
  const { port1: sourcePort, port2: peerPort } = new MessageChannel();
  t.after(() => peerPort.close());
  const bytes = new TextEncoder().encode(JSON.stringify({ schemaVersion: "1.0", generatedAt: "2026-09-13T00:00:00.000Z", components: [] }));
  const split = Math.floor(bytes.length / 2);
  const pending = module.retrieveServiceConditionSnapshot(sourcePort, inertClock());
  const ownedPort = await listenerInstalled;
  ownedPort.dispatchEvent(new MessageEvent("message", { data: { kind: "chunk", chunk: bytes.slice(0, split) } }));
  ownedPort.dispatchEvent(new MessageEvent("message", { data: { kind: "chunk", chunk: bytes.slice(split) } }));
  ownedPort.dispatchEvent(new MessageEvent("message", { data: { kind: "complete" } }));
  const result = await pending;
  assert.equal(result.kind, "received");
  assert.equal(result.snapshot.ok, true);
  assert.equal(module.__getDecoderCalls(), 1);
  assert.deepEqual(module.__decoderInput, bytes);
});

test("accepts_live_zero_chunks_and_zero_total_without_semantic_collapse", async t => {
  const { module, listenerInstalled } = await loadAdapterModule("live-zero-chunk", {
    observeListener: true,
    observeDecoder: true
  });
  const { port1: sourcePort, port2: peerPort } = new MessageChannel();
  t.after(() => peerPort.close());
  const pending = module.retrieveServiceConditionSnapshot(sourcePort, inertClock());
  const ownedPort = await listenerInstalled;
  ownedPort.dispatchEvent(new MessageEvent("message", { data: { kind: "chunk", chunk: new Uint8Array(0) } }));
  ownedPort.dispatchEvent(new MessageEvent("message", { data: { kind: "complete" } }));
  const result = await pending;
  assert.equal(result.kind, "received");
  assert.equal(result.snapshot.ok, false);
  assert.equal(module.__getDecoderCalls(), 1);
  assert.equal(module.__decoderInput.byteLength, 0);
});

test("accepts_exactly_16384_bytes", async t => {
  const { module, listenerInstalled } = await loadAdapterModule("exact-size-boundary", {
    observeListener: true,
    observeDecoder: true
  });
  const { port1: sourcePort, port2: peerPort } = new MessageChannel();
  t.after(() => peerPort.close());
  const document = JSON.stringify({ schemaVersion: "1.0", generatedAt: "2026-09-13T00:00:00.000Z", components: [] });
  const chunk = new TextEncoder().encode(document + " ".repeat(16_384 - document.length));
  assert.equal(chunk.byteLength, 16_384);
  const pending = module.retrieveServiceConditionSnapshot(sourcePort, inertClock());
  const ownedPort = await listenerInstalled;
  ownedPort.dispatchEvent(new MessageEvent("message", { data: { kind: "chunk", chunk } }));
  ownedPort.dispatchEvent(new MessageEvent("message", { data: { kind: "complete" } }));
  const result = await pending;
  assert.equal(result.kind, "received");
  assert.equal(result.snapshot.ok, true);
  assert.equal(module.__getDecoderCalls(), 1);
  assert.equal(module.__decoderInput.byteLength, 16_384);
});

test("rejects_a_single_16385_byte_chunk_before_copy", async t => {
  const { module, listenerInstalled } = await loadAdapterModule("single-oversize", {
    observeListener: true,
    observeDecoder: true,
    observeCopy: true
  });
  const { port1: sourcePort, port2: peerPort } = new MessageChannel();
  t.after(() => peerPort.close());
  const pending = module.retrieveServiceConditionSnapshot(sourcePort, inertClock());
  const ownedPort = await listenerInstalled;
  ownedPort.dispatchEvent(new MessageEvent("message", { data: { kind: "chunk", chunk: new Uint8Array(16_385) } }));
  assert.deepEqual(await pending, RESPONSE_TOO_LARGE);
  assert.equal(module.__getCopyAttempts(), 0);
  assert.equal(module.__getDecoderCalls(), 0);
});

test("rejects_the_first_aggregate_over_ceiling_chunk_before_copying_it", async t => {
  const { module, listenerInstalled } = await loadAdapterModule("aggregate-oversize", {
    observeListener: true,
    observeDecoder: true,
    observeCopy: true
  });
  const { port1: sourcePort, port2: peerPort } = new MessageChannel();
  t.after(() => peerPort.close());
  const pending = module.retrieveServiceConditionSnapshot(sourcePort, inertClock());
  const ownedPort = await listenerInstalled;
  for (const chunk of [new Uint8Array(16_383), new Uint8Array(1), new Uint8Array(1)]) {
    ownedPort.dispatchEvent(new MessageEvent("message", { data: { kind: "chunk", chunk } }));
  }
  assert.deepEqual(await pending, RESPONSE_TOO_LARGE);
  assert.equal(module.__getCopyAttempts(), 2);
  assert.equal(module.__getDecoderCalls(), 0);
});

test("allows_sink_calls_one_through_256", async t => {
  const { module, listenerInstalled } = await loadAdapterModule("sink-call-equality", {
    observeListener: true,
    observeDecoder: true
  });
  const { port1: sourcePort, port2: peerPort } = new MessageChannel();
  t.after(() => peerPort.close());
  const pending = module.retrieveServiceConditionSnapshot(sourcePort, inertClock());
  const ownedPort = await listenerInstalled;
  for (let call = 1; call <= 256; call += 1) {
    ownedPort.dispatchEvent(new MessageEvent("message", { data: { kind: "chunk", chunk: new Uint8Array(0) } }));
  }
  ownedPort.dispatchEvent(new MessageEvent("message", { data: { kind: "complete" } }));
  const result = await pending;
  assert.equal(result.kind, "received");
  assert.equal(module.__getDecoderCalls(), 1);
});

test("rejects_sink_call_257_before_hostile_input_touch", async t => {
  const { module, listenerInstalled } = await loadAdapterModule("sink-call-overflow", {
    observeListener: true,
    observeDecoder: true
  });
  const { port1: sourcePort, port2: peerPort } = new MessageChannel();
  t.after(() => peerPort.close());
  const pending = module.retrieveServiceConditionSnapshot(sourcePort, inertClock());
  const ownedPort = await listenerInstalled;
  for (let call = 1; call <= 256; call += 1) {
    ownedPort.dispatchEvent(new MessageEvent("message", { data: { kind: "chunk", chunk: new Uint8Array(0) } }));
  }
  let hostileReads = 0;
  const hostile = new Proxy(new Uint8Array(0), {
    getPrototypeOf() { hostileReads += 1; return Uint8Array.prototype; }
  });
  ownedPort.dispatchEvent(new MessageEvent("message", { data: { kind: "chunk", chunk: hostile } }));
  assert.deepEqual(await pending, TRANSPORT_FAILURE);
  assert.equal(hostileReads, 0);
  assert.equal(module.__getDecoderCalls(), 0);
});

test("times_out_at_completion_time_equality_when_callback_is_delayed", async t => {
  const { module, listenerInstalled } = await loadAdapterModule("completion-deadline-equality", {
    observeListener: true,
    observeDecoder: true
  });
  const { port1: sourcePort, port2: peerPort } = new MessageChannel();
  t.after(() => peerPort.close());
  let nowCalls = 0;
  const clock = {
    nowMilliseconds() { nowCalls += 1; return nowCalls === 1 ? 0 : 5_000; },
    schedule: () => "syn-delayed-handle",
    cancel: () => {}
  };
  const pending = module.retrieveServiceConditionSnapshot(sourcePort, clock);
  const ownedPort = await listenerInstalled;
  ownedPort.dispatchEvent(new MessageEvent("message", { data: { kind: "complete" } }));
  assert.deepEqual(await pending, TIMEOUT);
  assert.equal(nowCalls, 2);
  assert.equal(module.__getDecoderCalls(), 0);
});

test("suppresses_late_chunks_after_terminal_before_input_touch", async t => {
  const { module, listenerInstalled } = await loadAdapterModule("late-chunk", {
    observeListener: true,
    observeDecoder: true
  });
  const { port1: sourcePort, port2: peerPort } = new MessageChannel();
  t.after(() => peerPort.close());
  const pending = module.retrieveServiceConditionSnapshot(sourcePort, inertClock());
  const ownedPort = await listenerInstalled;
  ownedPort.dispatchEvent(new MessageEvent("message", { data: { kind: "transport_unavailable" } }));
  assert.deepEqual(await pending, TRANSPORT_FAILURE);
  let dataReads = 0;
  const late = new MessageEvent("message");
  Object.defineProperty(late, "data", { get() { dataReads += 1; return { kind: "chunk", chunk: new Uint8Array(0) }; } });
  ownedPort.dispatchEvent(late);
  assert.equal(dataReads, 0);
  assert.equal(module.__getDecoderCalls(), 0);
});

test("suppresses_late_complete_and_unavailable_records_without_result_change", async t => {
  const { module, listenerInstalled } = await loadAdapterModule("late-terminal-records", {
    observeListener: true,
    observeDecoder: true
  });
  const { port1: sourcePort, port2: peerPort } = new MessageChannel();
  t.after(() => peerPort.close());
  const chunk = new TextEncoder().encode(JSON.stringify({ schemaVersion: "1.0", generatedAt: "2026-09-13T00:00:00.000Z", components: [] }));
  const pending = module.retrieveServiceConditionSnapshot(sourcePort, inertClock());
  const ownedPort = await listenerInstalled;
  ownedPort.dispatchEvent(new MessageEvent("message", { data: { kind: "chunk", chunk } }));
  ownedPort.dispatchEvent(new MessageEvent("message", { data: { kind: "complete" } }));
  const result = await pending;
  ownedPort.dispatchEvent(new MessageEvent("message", { data: { kind: "complete" } }));
  ownedPort.dispatchEvent(new MessageEvent("message", { data: { kind: "transport_unavailable" } }));
  assert.equal(result.kind, "received");
  assert.equal(result.snapshot.ok, true);
  assert.equal(module.__getDecoderCalls(), 1);
});

test("maps_regressing_completion_clock_to_transport_failure", async t => {
  const { module, listenerInstalled } = await loadAdapterModule("regressing-clock", {
    observeListener: true,
    observeDecoder: true
  });
  const { port1: sourcePort, port2: peerPort } = new MessageChannel();
  t.after(() => peerPort.close());
  let nowCalls = 0;
  const clock = {
    nowMilliseconds() { nowCalls += 1; return nowCalls === 1 ? 10 : 9; },
    schedule: () => "regressing-handle",
    cancel: () => {}
  };
  const pending = module.retrieveServiceConditionSnapshot(sourcePort, clock);
  const ownedPort = await listenerInstalled;
  ownedPort.dispatchEvent(new MessageEvent("message", { data: { kind: "complete" } }));
  assert.deepEqual(await pending, TRANSPORT_FAILURE);
  assert.equal(module.__getDecoderCalls(), 0);
});

test("maps_initial_scheduler_throw_before_start_to_transport_failure", async t => {
  const { module } = await loadAdapterModule("initial-scheduler-throw", {
    observePost: true,
    observeDecoder: true
  });
  const { port1: sourcePort, port2: peerPort } = new MessageChannel();
  t.after(() => peerPort.close());
  const clock = {
    nowMilliseconds: () => 0,
    schedule() { throw new Error("synthetic scheduler failure"); },
    cancel: () => {}
  };
  assert.deepEqual(await module.retrieveServiceConditionSnapshot(sourcePort, clock), TRANSPORT_FAILURE);
  assert.equal(module.__postedValues.length, 0);
  assert.equal(module.__getDecoderCalls(), 0);
});

test("maps_preterminal_copy_or_cancellation_throw_to_generic_transport_failure", async t => {
  const copyLoaded = await loadAdapterModule("preterminal-copy-throw", {
    observeListener: true,
    observeDecoder: true,
    throwOnCopy: true
  });
  const copyChannel = new MessageChannel();
  t.after(() => copyChannel.port2.close());
  const copyPending = copyLoaded.module.retrieveServiceConditionSnapshot(copyChannel.port1, inertClock());
  const copyOwnedPort = await copyLoaded.listenerInstalled;
  copyOwnedPort.dispatchEvent(new MessageEvent("message", {
    data: { kind: "chunk", chunk: new Uint8Array([123, 125]) }
  }));
  const copyResult = await copyPending;
  assert.deepEqual(copyResult, TRANSPORT_FAILURE);
  assertRecursivelyFrozen(copyResult);
  assert.equal(copyLoaded.module.__getDecoderCalls(), 0);
  assert.doesNotMatch(JSON.stringify(copyResult), /syn-private/);

  const cancellationLoaded = await loadAdapterModule("preterminal-cancellation-throw");
  const cancellationChannel = new MessageChannel();
  t.after(() => cancellationChannel.port2.close());
  let nowCalls = 0;
  let scheduleCalls = 0;
  let cancelCalls = 0;
  const cancellationPending = cancellationLoaded.module.retrieveServiceConditionSnapshot(cancellationChannel.port1, {
    nowMilliseconds() { nowCalls += 1; return nowCalls === 1 ? 0 : 1_000; },
    schedule(callback) {
      scheduleCalls += 1;
      if (scheduleCalls === 1) callback();
      return `syn-retired-handle-${scheduleCalls}`;
    },
    cancel() {
      cancelCalls += 1;
      throw new Error("syn-private-cancellation-failure");
    }
  });
  const cancellationResult = await Promise.race([
    cancellationPending,
    new Promise(resolve => setImmediate(() => resolve("syn-pending")))
  ]);

  assert.deepEqual(cancellationResult, TRANSPORT_FAILURE);
  assert.notEqual(cancellationResult, copyResult);
  assert.notEqual(cancellationResult.error, copyResult.error);
  assertRecursivelyFrozen(cancellationResult);
  assert.doesNotMatch(JSON.stringify(cancellationResult), /syn-private/);
  assert.deepEqual({ nowCalls, scheduleCalls, cancelCalls }, {
    nowCalls: 2,
    scheduleCalls: 2,
    cancelCalls: 2
  });
});

test("does_not_replace_stronger_terminal_result_when_port_cancel_timer_cancel_remove_or_close_throws", async t => {
  const timeoutLoaded = await loadAdapterModule("terminal-timeout-port-cancel-throw", {
    throwOnPortCancel: true
  });
  const timeoutChannel = new MessageChannel();
  t.after(() => timeoutChannel.port2.close());
  let timeoutCallback;
  let timeoutNowCalls = 0;
  const timeoutPending = timeoutLoaded.module.retrieveServiceConditionSnapshot(timeoutChannel.port1, {
    nowMilliseconds() { timeoutNowCalls += 1; return timeoutNowCalls === 1 ? 0 : 5_000; },
    schedule(callback) { timeoutCallback = callback; return "syn-timeout-handle"; },
    cancel() {}
  });
  await new Promise(resolve => setImmediate(resolve));
  timeoutCallback();
  assert.deepEqual(await timeoutPending, TIMEOUT);

  const oversizeLoaded = await loadAdapterModule("terminal-oversize-timer-cancel-throw", {
    observeListener: true
  });
  const oversizeChannel = new MessageChannel();
  t.after(() => oversizeChannel.port2.close());
  const oversizePending = oversizeLoaded.module.retrieveServiceConditionSnapshot(oversizeChannel.port1, {
    nowMilliseconds: () => 0,
    schedule: () => "syn-oversize-handle",
    cancel() { throw new Error("syn-private-timer-cancel-failure"); }
  });
  const oversizeOwnedPort = await oversizeLoaded.listenerInstalled;
  oversizeOwnedPort.dispatchEvent(new MessageEvent("message", {
    data: { kind: "chunk", chunk: new Uint8Array(16_385) }
  }));
  assert.deepEqual(await oversizePending, RESPONSE_TOO_LARGE);

  const transportLoaded = await loadAdapterModule("terminal-transport-remove-throw", {
    observeListener: true,
    throwOnRemove: true
  });
  const transportChannel = new MessageChannel();
  t.after(() => transportChannel.port2.close());
  const transportPending = transportLoaded.module.retrieveServiceConditionSnapshot(transportChannel.port1, inertClock());
  const transportOwnedPort = await transportLoaded.listenerInstalled;
  transportOwnedPort.dispatchEvent(new MessageEvent("message", { data: { kind: "transport_unavailable" } }));
  assert.deepEqual(await transportPending, TRANSPORT_FAILURE);

  const receivedLoaded = await loadAdapterModule("terminal-received-close-throw", {
    observeListener: true,
    throwOnClose: true
  });
  const receivedChannel = new MessageChannel();
  t.after(() => receivedChannel.port2.close());
  const receivedPending = receivedLoaded.module.retrieveServiceConditionSnapshot(receivedChannel.port1, inertClock());
  const receivedOwnedPort = await receivedLoaded.listenerInstalled;
  receivedOwnedPort.dispatchEvent(new MessageEvent("message", { data: { kind: "complete" } }));
  const received = await receivedPending;
  assert.equal(received.kind, "received");
  assert.equal(received.snapshot.ok, false);

  for (const result of [await timeoutPending, await oversizePending, await transportPending, received]) {
    assertRecursivelyFrozen(result);
    assert.doesNotMatch(JSON.stringify(result), /syn-private/);
  }
});

test("preserves_the_complete_source_adapter_semantic_freeze_without_provider_or_test_surface", async t => {
  const { module } = await loadAdapterModule("post-green-semantic-freeze");
  assert.deepEqual(Object.keys(module), ["retrieveServiceConditionSnapshot"]);

  const generatedAt = "2000-01-01T00:00:00.000Z";
  const observedAt = "1999-12-31T23:59:59.000Z";
  const baseComponent = {
    configured: true,
    administrativeState: "required",
    freshness: "unavailable",
    observedAt: null,
    evidenceCode: "none",
    blockedReasonCode: null,
    lastKnown: null
  };
  const components = [
    { ...baseComponent, id: "syn-live", label: "Synthetic Live", freshness: "live", observedAt, evidenceCode: "positive" },
    { ...baseComponent, id: "syn-recent", label: "Synthetic Recent", freshness: "recent", observedAt, evidenceCode: "partial_function" },
    { ...baseComponent, id: "syn-historical", label: "Synthetic Historical", freshness: "historical", observedAt, evidenceCode: "complete_failure" },
    { ...baseComponent, id: "syn-degraded", label: "Synthetic Degraded", freshness: "degraded", observedAt, evidenceCode: "positive" },
    { ...baseComponent, id: "syn-stale", label: "Synthetic Stale", freshness: "stale", lastKnown: { observedAt, evidenceCode: "partial_function" } },
    { ...baseComponent, id: "syn-unavailable", label: "Synthetic Unavailable" },
    { ...baseComponent, id: "syn-not-configured", label: "Synthetic Not Configured", configured: false },
    { ...baseComponent, id: "syn-blocked", label: "Synthetic Blocked", blockedReasonCode: "dependency" },
    { ...baseComponent, id: "syn-optional", label: "Synthetic Optional", configured: false, administrativeState: "optional" },
    { ...baseComponent, id: "syn-retired", label: "Synthetic Retired", configured: false, administrativeState: "retired" }
  ];
  const encoded = new TextEncoder().encode(JSON.stringify({ schemaVersion: "1.0", generatedAt, components }));
  const receive = async (chunk, afterChunkPosted = () => {}) => {
    const channel = new MessageChannel();
    t.after(() => channel.port2.close());
    const pending = module.retrieveServiceConditionSnapshot(channel.port1, inertClock());
    channel.port2.postMessage({ kind: "chunk", chunk });
    afterChunkPosted();
    channel.port2.postMessage({ kind: "complete" });
    return pending;
  };

  const firstInput = new Uint8Array(encoded);
  const first = await receive(firstInput, () => firstInput.fill(0));
  const second = await receive(new Uint8Array(encoded));
  assert.deepEqual(first, second);
  assert.notEqual(first, second);
  assert.notEqual(first.snapshot, second.snapshot);
  assert.notEqual(first.snapshot.components, second.snapshot.components);
  assertRecursivelyFrozen(first);
  assertRecursivelyFrozen(second);
  assert.equal(first.kind, "received");
  assert.equal(first.snapshot.ok, true);
  assert.deepEqual(first.snapshot.components.map(component => ({
    id: component.id,
    kind: component.kind,
    condition: component.condition,
    freshness: component.freshness,
    evidenceCode: component.evidenceCode,
    reasonCode: component.reasonCode,
    observedAt: component.observedAt
  })), [
    { id: "syn-live", kind: "classified", condition: "working", freshness: "live", evidenceCode: "positive", reasonCode: "configured_positive", observedAt },
    { id: "syn-recent", kind: "classified", condition: "degraded", freshness: "recent", evidenceCode: "partial_function", reasonCode: "configured_partial_function", observedAt },
    { id: "syn-historical", kind: "classified", condition: "broken", freshness: "historical", evidenceCode: "complete_failure", reasonCode: "configured_complete_failure", observedAt },
    { id: "syn-degraded", kind: "classified", condition: "working", freshness: "degraded", evidenceCode: "positive", reasonCode: "configured_positive", observedAt },
    { id: "syn-stale", kind: "classified", condition: "degraded", freshness: "stale", evidenceCode: "last_known_partial_function", reasonCode: "last_known_partial_function", observedAt },
    { id: "syn-unavailable", kind: "condition_unavailable", condition: undefined, freshness: "unavailable", evidenceCode: "none", reasonCode: "condition_unknown_no_validated_last_known", observedAt: null },
    { id: "syn-not-configured", kind: "classified", condition: "not_configured", freshness: "unavailable", evidenceCode: "none", reasonCode: "not_configured", observedAt: null },
    { id: "syn-blocked", kind: "classified", condition: "blocked", freshness: "unavailable", evidenceCode: "none", reasonCode: "blocked_dependency", observedAt: null },
    { id: "syn-optional", kind: "classified", condition: "optional", freshness: "unavailable", evidenceCode: "none", reasonCode: "optional", observedAt: null },
    { id: "syn-retired", kind: "classified", condition: "retired", freshness: "unavailable", evidenceCode: "none", reasonCode: "retired", observedAt: null }
  ]);
  assert.deepEqual(first.snapshot.counts, {
    working: 2,
    degraded: 2,
    blocked: 1,
    broken: 1,
    not_configured: 1,
    optional: 1,
    retired: 1
  });
  assert.deepEqual({
    total: first.snapshot.total,
    classifiedTotal: first.snapshot.classifiedTotal,
    conditionUnavailableTotal: first.snapshot.conditionUnavailableTotal,
    hasLocalizedImpairment: first.snapshot.hasLocalizedImpairment
  }, { total: 10, classifiedTotal: 9, conditionUnavailableTotal: 1, hasLocalizedImpairment: true });
  const broken = first.snapshot.components.filter(component => component.condition === "broken");
  assert.deepEqual(broken.map(component => component.evidenceCode), ["complete_failure"]);
  assert.equal(first.snapshot.components.find(component => component.id === "syn-not-configured").condition, "not_configured");

  const malformed = await receive(new Uint8Array([123]));
  assert.deepEqual(malformed, {
    kind: "received",
    snapshot: {
      ok: false,
      error: {
        code: "invalid_service_condition_snapshot",
        reason: "Service condition snapshot is unavailable."
      }
    }
  });
  assertRecursivelyFrozen(malformed);

  const transport = await module.retrieveServiceConditionSnapshot({}, inertClock());
  const timeoutChannel = new MessageChannel();
  t.after(() => timeoutChannel.port2.close());
  let timeoutNowCalls = 0;
  const timeout = await module.retrieveServiceConditionSnapshot(timeoutChannel.port1, {
    nowMilliseconds() { timeoutNowCalls += 1; return timeoutNowCalls === 1 ? 0 : 5_000; },
    schedule(callback) { callback(); return "syn-semantic-timeout"; },
    cancel() {}
  });
  const oversizeChannel = new MessageChannel();
  t.after(() => oversizeChannel.port2.close());
  const oversizePending = module.retrieveServiceConditionSnapshot(oversizeChannel.port1, inertClock());
  oversizeChannel.port2.postMessage({ kind: "chunk", chunk: new Uint8Array(16_385) });
  const oversize = await oversizePending;
  for (const outcome of [transport, timeout, oversize]) {
    assert.deepEqual(Object.keys(outcome).sort(), ["error", "kind"]);
    assert.equal("snapshot" in outcome, false);
    assert.equal("semantic" in outcome, false);
    assert.equal("provider" in outcome, false);
    assertRecursivelyFrozen(outcome);
  }

  const adapterSource = await readFile(ADAPTER_PATH, "utf8");
  assert.equal((adapterSource.match(/decodeServiceConditionSnapshotJson\(input\)/g) ?? []).length, 1);
  assert.doesNotMatch(adapterSource, /provider/i);
  assert.equal((adapterSource.match(/^export (?!type)/gm) ?? []).length, 1);
});

test("resists_deliberate_post_import_ambient_intrinsic_corruption", async t => {
  const { module, listenerInstalled } = await loadAdapterModule("intrinsic-corruption", {
    observeListener: true,
    observeDecoder: true
  });
  const { port1: sourcePort, port2: peerPort } = new MessageChannel();
  t.after(() => peerPort.close());
  const chunk = new TextEncoder().encode(JSON.stringify({ schemaVersion: "1.0", generatedAt: "2026-09-13T00:00:00.000Z", components: [] }));
  const pending = module.retrieveServiceConditionSnapshot(sourcePort, inertClock());
  const ownedPort = await listenerInstalled;
  const originals = {
    apply: Reflect.apply,
    ownKeys: Reflect.ownKeys,
    getPrototypeOf: Object.getPrototypeOf,
    getOwnPropertyDescriptor: Object.getOwnPropertyDescriptor,
    set: Uint8Array.prototype.set,
    at: Uint8Array.prototype.at
  };
  try {
    Reflect.apply = () => { throw new Error("corrupted apply"); };
    Reflect.ownKeys = () => { throw new Error("corrupted ownKeys"); };
    Object.getPrototypeOf = () => { throw new Error("corrupted getPrototypeOf"); };
    Object.getOwnPropertyDescriptor = () => { throw new Error("corrupted descriptor"); };
    Uint8Array.prototype.set = () => { throw new Error("corrupted set"); };
    Uint8Array.prototype.at = () => { throw new Error("corrupted at"); };
    ownedPort.dispatchEvent(new MessageEvent("message", { data: { kind: "chunk", chunk } }));
    ownedPort.dispatchEvent(new MessageEvent("message", { data: { kind: "complete" } }));
  } finally {
    Reflect.apply = originals.apply;
    Reflect.ownKeys = originals.ownKeys;
    Object.getPrototypeOf = originals.getPrototypeOf;
    Object.getOwnPropertyDescriptor = originals.getOwnPropertyDescriptor;
    Uint8Array.prototype.set = originals.set;
    Uint8Array.prototype.at = originals.at;
  }
  const result = await pending;
  assert.equal(result.kind, "received");
  assert.equal(result.snapshot.ok, true);
  assert.equal(module.__getDecoderCalls(), 1);
});

test("source_audit_forbids_raw_post_import_ambient_intrinsic_method_calls", async () => {
  const source = await readFile(ADAPTER_PATH, "utf8");
  const runtime = source.slice(source.indexOf("export async function retrieveServiceConditionSnapshot"));
  const forbidden = [
    /Reflect\.(?:apply|ownKeys)\(/,
    /Object\.(?:freeze|getPrototypeOf|getOwnPropertyDescriptor)\(/,
    /Number\.(?:isFinite|isSafeInteger)\(/,
    /\.(?:addEventListener|removeEventListener|postMessage|start|close|set|at)\(/
  ];
  for (const pattern of forbidden) assert.doesNotMatch(runtime, pattern);
});

test("preserves_the_exact_runtime_interface_and_frozen_terminal_result_literals", async t => {
  const { module } = await loadAdapterModule("exact-interface");
  assert.deepEqual(Object.keys(module), ["retrieveServiceConditionSnapshot"]);

  const transport = await module.retrieveServiceConditionSnapshot({}, inertClock());
  assert.deepEqual(transport, TRANSPORT_FAILURE);
  assert.equal(Object.isFrozen(transport), true);
  assert.equal(Object.isFrozen(transport.error), true);

  const { port1: timeoutSource, port2: timeoutPeer } = new MessageChannel();
  t.after(() => timeoutPeer.close());
  let timeoutNowCalls = 0;
  const timeout = await module.retrieveServiceConditionSnapshot(timeoutSource, {
    nowMilliseconds: () => timeoutNowCalls++ === 0 ? 0 : 5_000,
    schedule(callback) { callback(); return "exact-timeout-handle"; },
    cancel: () => {}
  });
  assert.deepEqual(timeout, TIMEOUT);
  assert.equal(Object.isFrozen(timeout), true);
  assert.equal(Object.isFrozen(timeout.error), true);

  const { port1: largeSource, port2: largePeer } = new MessageChannel();
  t.after(() => largePeer.close());
  const largePending = module.retrieveServiceConditionSnapshot(largeSource, inertClock());
  largePeer.postMessage({ kind: "chunk", chunk: new Uint8Array(16_385) });
  const large = await largePending;
  assert.deepEqual(large, RESPONSE_TOO_LARGE);
  assert.equal(Object.isFrozen(large), true);
  assert.equal(Object.isFrozen(large.error), true);

  const { port1: receivedSource, port2: receivedPeer } = new MessageChannel();
  t.after(() => receivedPeer.close());
  const receivedPending = module.retrieveServiceConditionSnapshot(receivedSource, inertClock());
  receivedPeer.postMessage({ kind: "complete" });
  const received = await receivedPending;
  assert.equal(received.kind, "received");
  assert.equal(Object.isFrozen(received), true);
});
