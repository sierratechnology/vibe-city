import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";
import { MessagePort } from "node:worker_threads";
import ts from "typescript";

const SHIM_PATH = new URL("../src/domain/serviceConditionTrustedSourceShim.ts", import.meta.url);
const TRANSPORT_FAILURE = Object.freeze({
  kind: "transport_unavailable",
  error: Object.freeze({
    code: "service_condition_transport_unavailable",
    reason: "Service condition source transport is unavailable."
  })
});
let loadSequence = 0;

async function transpile(source) {
  return ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 }
  }).outputText;
}

async function loadShimModule(fragment, {
  observeConstruction = false,
  observeTransfer = false,
  driveProtocol = false,
  cancelBeforeStart = false,
  duplicateStart = false,
  throwOnSetup = false,
  throwOnChunkPost = false,
  throwOnClose = false
} = {}) {
  const observationKey = `__serviceConditionShim_${fragment}_${loadSequence}`;
  globalThis[observationKey] = { ports: [], controllers: [], records: [], transferredByteLengths: [] };
  const adapterSource = `
    export function retrieveServiceConditionObservation(port) {
      globalThis[${JSON.stringify(observationKey)}].ports.push(port);
      if (${JSON.stringify(cancelBeforeStart)}) {
        port.postMessage({ kind: "cancel" });
        return new Promise(resolve => setImmediate(() => resolve(Object.freeze({ kind: "syn-adapter-result" }))));
      }
      if (${JSON.stringify(driveProtocol)}) {
        return new Promise(resolve => {
          port.addEventListener("message", event => {
            globalThis[${JSON.stringify(observationKey)}].records.push(event.data);
            if (event.data?.kind === "complete" || event.data?.kind === "transport_unavailable") {
              resolve(event.data.kind === "transport_unavailable"
                ? ${JSON.stringify(TRANSPORT_FAILURE)}
                : Object.freeze({ kind: "syn-adapter-result" }));
            }
          });
          port.start();
          setImmediate(() => {
            port.postMessage({ kind: "start" });
            if (${JSON.stringify(duplicateStart)}) port.postMessage({ kind: "start" });
          });
        });
      }
      return Promise.resolve(Object.freeze({ kind: "syn-adapter-result" }));
    }
  `;
  const adapterUrl = `data:text/javascript;base64,${Buffer.from(adapterSource).toString("base64")}#adapter-${fragment}-${loadSequence}`;
  let shimSource = await readFile(SHIM_PATH, "utf8").catch(() => "export {};\n");
  const adapterPattern = /from (["'])\.\/serviceConditionSourceAdapter\.ts\1;/g;
  const matches = shimSource.match(adapterPattern) ?? [];
  assert.equal(matches.length, shimSource.includes("serviceConditionSourceAdapter") ? 1 : 0);
  shimSource = shimSource.replace(adapterPattern, `from "${adapterUrl}";`);
  if (observeConstruction) {
    const marker = "controller = new AbortControllerConstructor();";
    assert.equal(shimSource.split(marker).length - 1, shimSource.includes("AbortController") ? 1 : 0);
    shimSource = shimSource.replace(marker, `${marker}\n  globalThis[${JSON.stringify(observationKey)}].controllers.push(controller);`);
  }
  if (observeTransfer) {
    const marker = "applyReflect(postPort, sourcePeer, [freezeObject({ kind: \"chunk\" as const, chunk }), [chunk.buffer]]);";
    assert.equal(shimSource.split(marker).length - 1, 1);
    shimSource = shimSource.replace(marker, `${marker}\n        globalThis[${JSON.stringify(observationKey)}].transferredByteLengths.push(chunk.byteLength);`);
  }
  for (const [enabled, marker, replacement] of [
    [throwOnSetup, "new MessageChannel()", "(() => { throw new Error(\"syn-private-setup\"); })()"],
    [throwOnChunkPost, "applyReflect(postPort, sourcePeer, [freezeObject({ kind: \"chunk\" as const, chunk }), [chunk.buffer]]);", "(() => { throw new Error(\"syn-private-transfer-post\"); })();"],
    [throwOnClose, "applyReflect(closePort, sourcePeer, []);", "(() => { throw new Error(\"syn-private-close\"); })();"]
  ]) {
    if (!enabled) continue;
    assert.equal(shimSource.split(marker).length - 1, 1);
    shimSource = shimSource.replace(marker, replacement);
  }
  loadSequence += 1;
  const shimUrl = `data:text/javascript;base64,${Buffer.from(await transpile(shimSource)).toString("base64")}#shim-${fragment}-${loadSequence}`;
  return { module: await import(shimUrl), observations: globalThis[observationKey] };
}

function inertClock() {
  return Object.freeze({
    nowMilliseconds: () => 0,
    schedule: () => "syn-inert-handle",
    cancel: () => {}
  });
}

test("exports_only_the_trusted_source_shim_and_constructs_fresh_real_boundaries_per_call", async () => {
  const { module, observations } = await loadShimModule("fresh-boundaries", { observeConstruction: true });
  assert.deepEqual(Object.keys(module), ["retrieveTrustedServiceConditionObservation"]);

  const source = () => 0;
  await module.retrieveTrustedServiceConditionObservation(source, inertClock());
  await module.retrieveTrustedServiceConditionObservation(source, inertClock());

  assert.equal(observations.ports.length, 2);
  assert.equal(Object.getPrototypeOf(observations.ports[0]), MessagePort.prototype);
  assert.equal(Object.getPrototypeOf(observations.ports[1]), MessagePort.prototype);
  assert.notEqual(observations.ports[0], observations.ports[1]);
  assert.equal(observations.controllers.length, 2);
  assert.equal(Object.getPrototypeOf(observations.controllers[0]), AbortController.prototype);
  assert.equal(Object.getPrototypeOf(observations.controllers[1]), AbortController.prototype);
  assert.notEqual(observations.controllers[0], observations.controllers[1]);
});

test("starts_the_source_once_only_after_exact_start_with_a_fresh_bounded_destination_and_owned_signal", async () => {
  const { module, observations } = await loadShimModule("bounded-start", { driveProtocol: true });
  const calls = [];
  const source = (destination, signal) => {
    calls.push({ destination, signal, abortedAtCall: signal.aborted });
    return 0;
  };

  const firstPending = module.retrieveTrustedServiceConditionObservation(source, inertClock());
  assert.equal(calls.length, 0);
  const firstResult = await Promise.race([
    firstPending,
    new Promise(resolve => setTimeout(() => resolve("syn-source-not-started"), 50))
  ]);
  if (firstResult === "syn-source-not-started") {
    for (const port of observations.ports) port.close();
  }
  assert.notEqual(firstResult, "syn-source-not-started");
  const secondPending = module.retrieveTrustedServiceConditionObservation(source, inertClock());
  assert.equal(calls.length, 1);
  await secondPending;

  assert.equal(calls.length, 2);
  for (const call of calls) {
    assert.equal(Object.getPrototypeOf(call.destination), Uint8Array.prototype);
    assert.equal(call.destination.byteLength, 16_384);
    assert.equal(call.destination.every(byte => byte === 0), true);
    assert.equal(Object.getPrototypeOf(call.signal), AbortSignal.prototype);
    assert.equal(call.abortedAtCall, false);
  }
  assert.notEqual(calls[0].destination, calls[1].destination);
  assert.notEqual(calls[0].signal, calls[1].signal);
  assert.deepEqual(observations.records, [
    { kind: "chunk", chunk: new Uint8Array() },
    { kind: "complete" },
    { kind: "chunk", chunk: new Uint8Array() },
    { kind: "complete" }
  ]);
});

test("accepts_only_exact_safe_bounded_scalar_counts_without_assimilating_or_traversing_hostile_returns", async () => {
  const { module, observations } = await loadShimModule("scalar-count", { driveProtocol: true });
  const invoke = async value => {
    const recordStart = observations.records.length;
    await module.retrieveTrustedServiceConditionObservation(destination => {
      destination[0] = 11;
      destination[1] = 22;
      destination[2] = 33;
      return value;
    }, inertClock());
    return observations.records.slice(recordStart);
  };

  for (const count of [0, 3, 16_384]) {
    const records = await invoke(count);
    assert.equal(records.length, 2);
    assert.equal(records[0].kind, "chunk");
    assert.equal(records[0].chunk.byteLength, count);
    assert.deepEqual([...records[0].chunk.slice(0, 3)], [11, 22, 33].slice(0, count));
    assert.deepEqual(records[1], { kind: "complete" });
  }

  let hooks = 0;
  const rejected = Promise.reject(new Error("syn-private-rejection"));
  rejected.catch(() => {});
  const hostileValues = [
    -1,
    1.5,
    16_385,
    Number.MAX_SAFE_INTEGER + 1,
    rejected,
    Object.defineProperty({}, "then", { get() { hooks += 1; throw new Error("syn-private-then"); } }),
    Object.defineProperty({}, Symbol.iterator, { get() { hooks += 1; throw new Error("syn-private-iterator"); } }),
    new Proxy({}, {
      getPrototypeOf() { hooks += 1; throw new Error("syn-private-proxy"); },
      get() { hooks += 1; throw new Error("syn-private-proxy"); }
    }),
    new Number(3)
  ];
  for (const value of hostileValues) {
    assert.deepEqual(await invoke(value), [{ kind: "transport_unavailable" }]);
  }
  assert.equal(hooks, 0);
});

test("copies_only_the_accepted_prefix_into_fresh_transfer_custody_and_detaches_the_sender_buffer", async () => {
  const { module, observations } = await loadShimModule("transfer-custody", {
    driveProtocol: true,
    observeTransfer: true
  });
  let callerDestination;
  const pending = module.retrieveTrustedServiceConditionObservation(destination => {
    callerDestination = destination;
    destination.set([7, 8, 9, 10]);
    return 3;
  }, inertClock());
  const result = await pending;
  callerDestination.fill(99);

  assert.deepEqual(result, { kind: "syn-adapter-result" });
  assert.equal(observations.records.length, 2);
  assert.deepEqual([...observations.records[0].chunk], [7, 8, 9]);
  assert.notEqual(observations.records[0].chunk.buffer, callerDestination.buffer);
  assert.deepEqual(observations.transferredByteLengths, [0]);
  assert.deepEqual(observations.records[1], { kind: "complete" });
});

test("rejects_a_source_that_detaches_the_owned_destination_before_returning_a_positive_count", async () => {
  const { module, observations } = await loadShimModule("detached-destination", { driveProtocol: true });
  let sourceCalls = 0;
  const pending = module.retrieveTrustedServiceConditionObservation(destination => {
    sourceCalls += 1;
    destination.set([7, 8, 9]);
    structuredClone(destination.buffer, { transfer: [destination.buffer] });
    return 3;
  }, inertClock()).catch(error => ({ kind: "syn-thrown", detail: String(error) }));
  const result = await Promise.race([
    pending,
    new Promise(resolve => setTimeout(() => resolve("syn-source-hung"), 50))
  ]);

  assert.deepEqual(observations.records, [{ kind: "transport_unavailable" }]);
  assert.deepEqual(result, TRANSPORT_FAILURE);
  assert.equal(sourceCalls, 1);
  assert.doesNotMatch(JSON.stringify(result), /syn-private/);
});

test("bounds_valid_execution_to_one_source_read_one_chunk_and_one_first_terminal_in_order", async () => {
  const { module, observations } = await loadShimModule("exact-counters", {
    driveProtocol: true,
    duplicateStart: true
  });
  let sourceCalls = 0;
  await module.retrieveTrustedServiceConditionObservation(destination => {
    sourceCalls += 1;
    destination[0] = 41;
    return 1;
  }, inertClock());
  await new Promise(resolve => setImmediate(resolve));

  assert.equal(sourceCalls, 1);
  assert.equal(observations.records.length, 2);
  assert.deepEqual([...observations.records[0].chunk], [41]);
  assert.deepEqual(observations.records.map(record => record.kind), ["chunk", "complete"]);
});

test("honors_terminal_cancellation_through_the_owned_signal_without_source_or_post_terminal_work", async () => {
  const { module, observations } = await loadShimModule("terminal-cancel", {
    observeConstruction: true,
    cancelBeforeStart: true
  });
  let sourceCalls = 0;
  const result = await module.retrieveTrustedServiceConditionObservation(() => {
    sourceCalls += 1;
    return 0;
  }, inertClock());
  await new Promise(resolve => setImmediate(resolve));

  assert.deepEqual(result, { kind: "syn-adapter-result" });
  assert.equal(sourceCalls, 0);
  assert.deepEqual(observations.records, []);
  assert.equal(observations.controllers.length, 1);
  assert.equal(observations.controllers[0].signal.aborted, true);
});

test("maps_setup_source_transfer_post_and_cleanup_faults_to_generic_transport_semantics_without_private_detail", async () => {
  const cases = [
    {
      fragment: "setup-fault",
      options: { throwOnSetup: true },
      source: () => 0
    },
    {
      fragment: "source-fault",
      options: { driveProtocol: true },
      source: () => { throw new Error("syn-private-source"); }
    },
    {
      fragment: "transfer-post-fault",
      options: { driveProtocol: true, throwOnChunkPost: true },
      source: destination => { destination[0] = 5; return 1; }
    },
    {
      fragment: "cleanup-fault",
      options: { driveProtocol: true, throwOnClose: true },
      source: () => 0
    }
  ];

  for (const entry of cases) {
    const { module, observations } = await loadShimModule(entry.fragment, entry.options);
    const result = await module.retrieveTrustedServiceConditionObservation(entry.source, inertClock())
      .catch(error => ({ kind: "syn-thrown", detail: String(error) }));
    for (const port of observations.ports) port.close();
    assert.deepEqual(result, TRANSPORT_FAILURE);
    assert.doesNotMatch(JSON.stringify(result), /syn-private/);
  }
});

test("keeps_the_shim_dormant_with_zero_runtime_importers_and_zero_provider_side_effect_surface", async () => {
  const sourceRoot = new URL("../src/", import.meta.url);
  const paths = await readdir(sourceRoot, { recursive: true });
  const runtimeSources = paths.filter(path => /\.(?:ts|js|html)$/.test(path)
    && path !== "domain/serviceConditionTrustedSourceShim.ts");
  for (const path of runtimeSources) {
    const source = await readFile(new URL(path, sourceRoot), "utf8");
    assert.doesNotMatch(source, /serviceConditionTrustedSourceShim|retrieveTrustedServiceConditionObservation/);
  }

  const shimSource = await readFile(SHIM_PATH, "utf8");
  assert.doesNotMatch(shimSource, /\b(?:fetch|WebSocket|EventSource|XMLHttpRequest|setTimeout|setInterval)\b|https?:|supabase|provider|process\.|console\./i);
  assert.equal((shimSource.match(/^export (?!type)/gm) ?? []).length, 1);
});
