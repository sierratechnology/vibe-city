import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const CLASSIFIER_PATH = new URL("../src/domain/serviceCondition.ts", import.meta.url);
const DECODER_PATH = new URL("../src/domain/serviceConditionDecoder.ts", import.meta.url);
const ADAPTER_PATH = new URL("../src/domain/serviceConditionSourceAdapter.ts", import.meta.url);
const SHIM_PATH = new URL("../src/domain/serviceConditionTrustedSourceShim.ts", import.meta.url);
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
let loadSequence = 0;
const loadedAdapters = new WeakMap();

async function transpile(source) {
  return ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 }
  }).outputText;
}

async function loadShimModule(fragment, transform = source => source, transformAdapter = source => source) {
  const classifierSource = await readFile(CLASSIFIER_PATH, "utf8");
  const classifierUrl = `data:text/javascript;base64,${Buffer.from(await transpile(classifierSource)).toString("base64")}#classifier-${fragment}-${loadSequence}`;
  const decoderSource = await readFile(DECODER_PATH, "utf8");
  const decoderPattern = /from "\.\/serviceCondition\.ts";/g;
  assert.equal((decoderSource.match(decoderPattern) ?? []).length, 1);
  const decoderUrl = `data:text/javascript;base64,${Buffer.from(await transpile(decoderSource.replace(decoderPattern, `from "${classifierUrl}";`))).toString("base64")}#decoder-${fragment}-${loadSequence}`;
  let adapterSource = await readFile(ADAPTER_PATH, "utf8");
  const adapterPattern = /from "\.\/serviceConditionDecoder\.ts";/g;
  assert.equal((adapterSource.match(adapterPattern) ?? []).length, 1);
  adapterSource = transformAdapter(adapterSource.replace(adapterPattern, `from "${decoderUrl}";`));
  const adapterUrl = `data:text/javascript;base64,${Buffer.from(await transpile(adapterSource)).toString("base64")}#adapter-${fragment}-${loadSequence}`;
  let shimSource = await readFile(SHIM_PATH, "utf8");
  const shimPattern = /from "\.\/serviceConditionSourceAdapter\.ts";/g;
  assert.equal((shimSource.match(shimPattern) ?? []).length, 1);
  shimSource = transform(shimSource.replace(shimPattern, `from "${adapterUrl}";`));
  loadSequence += 1;
  const adapterModule = await import(adapterUrl);
  const shimModule = await import(`data:text/javascript;base64,${Buffer.from(await transpile(shimSource)).toString("base64")}#shim-${fragment}-${loadSequence}`);
  loadedAdapters.set(shimModule, adapterModule);
  return shimModule;
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

test("exports_only_the_trusted_source_shim_and_keeps_fresh_real_peer_custody", async () => {
  const module = await loadShimModule("boundary");
  assert.deepEqual(Object.keys(module), ["retrieveTrustedServiceConditionSnapshot"]);
  let sourceCalls = 0;
  const source = () => { sourceCalls += 1; return {}; };
  const first = await module.retrieveTrustedServiceConditionSnapshot(source, inertClock());
  const second = await module.retrieveTrustedServiceConditionSnapshot(source, inertClock());
  assert.deepEqual(first, TRANSPORT_FAILURE);
  assert.deepEqual(second, TRANSPORT_FAILURE);
  assert.notEqual(first, second);
  assert.notEqual(first.error, second.error);
  assertRecursivelyFrozen(first);
  assertRecursivelyFrozen(second);
  assert.equal(sourceCalls, 2);
  assert.equal(Object.getOwnPropertySymbols(source).length, 0);
  assert.deepEqual(Object.keys(source), []);
});

test("rejects_nonfunctions_before_channel_construction_or_candidate_traversal", async () => {
  const marker = "const MessageChannelConstructor: typeof MessageChannel = MessageChannel;";
  const module = await loadShimModule("nonfunction-preflight", source => {
    assert.equal(source.split(marker).length - 1, 1);
    return source.replace(marker, `let __channelConstructions = 0;\nconst __OriginalMessageChannel = MessageChannel;\nconst MessageChannelConstructor: typeof MessageChannel = class extends __OriginalMessageChannel { constructor() { __channelConstructions += 1; super(); } };\nexport const __getChannelConstructions = () => __channelConstructions;`);
  });
  let hostileReads = 0;
  const proxy = new Proxy({}, {
    getPrototypeOf() { hostileReads += 1; return Object.prototype; },
    ownKeys() { hostileReads += 1; return []; },
    getOwnPropertyDescriptor() { hostileReads += 1; return undefined; },
    get() { hostileReads += 1; return undefined; }
  });
  const accessor = Object.defineProperty({}, "then", { get() { hostileReads += 1; return () => {}; } });
  const candidates = [null, undefined, 0, "syn-source", Promise.resolve(0), proxy, accessor, { read() {} }];
  for (const candidate of candidates) {
    const result = await module.retrieveTrustedServiceConditionSnapshot(candidate, inertClock());
    assert.deepEqual(result, TRANSPORT_FAILURE);
    assertRecursivelyFrozen(result);
  }
  assert.equal(module.__getChannelConstructions(), 0);
  assert.equal(hostileReads, 0);
});

test("calls_the_synchronous_source_once_after_start_with_fresh_destination_and_signal", async () => {
  const module = await loadShimModule("one-source-call");
  const destinations = [];
  const signals = [];
  let returned = false;
  const source = (destination, signal) => {
    assert.equal(returned, true);
    assert.equal(Object.getPrototypeOf(destination), Uint8Array.prototype);
    assert.equal(destination.byteLength, 16_384);
    assert.equal(Object.getPrototypeOf(destination.buffer), ArrayBuffer.prototype);
    assert.equal(signal instanceof AbortSignal, true);
    destinations.push(destination);
    signals.push(signal);
    return {};
  };
  const firstPending = module.retrieveTrustedServiceConditionSnapshot(source, inertClock());
  returned = true;
  assert.equal(destinations.length, 0);
  assert.deepEqual(await firstPending, TRANSPORT_FAILURE);
  assert.deepEqual(await module.retrieveTrustedServiceConditionSnapshot(source, inertClock()), TRANSPORT_FAILURE);
  assert.equal(destinations.length, 2);
  assert.notEqual(destinations[0], destinations[1]);
  assert.notEqual(destinations[0].buffer, destinations[1].buffer);
  assert.notEqual(signals[0], signals[1]);
});

test("maps_a_synchronous_source_throw_to_one_generic_terminal", async () => {
  const module = await loadShimModule("source-throw");
  let calls = 0;
  const pending = module.retrieveTrustedServiceConditionSnapshot(() => {
    calls += 1;
    throw new Error("syn-private-source-failure");
  }, inertClock());
  const result = await Promise.race([
    pending,
    new Promise(resolve => setTimeout(() => resolve("syn-pending"), 50))
  ]);
  assert.deepEqual(result, TRANSPORT_FAILURE);
  assert.equal(calls, 1);
  assertRecursivelyFrozen(result);
  assert.doesNotMatch(JSON.stringify(result), /syn-private/);
});

test("rejects_a_nonscalar_source_return_without_promise_assimilation", async () => {
  const module = await loadShimModule("nonscalar-return");
  let thenReads = 0;
  const returned = Object.defineProperty({}, "then", {
    get() { thenReads += 1; throw new Error("syn-private-then"); }
  });
  const result = await module.retrieveTrustedServiceConditionSnapshot(() => returned, inertClock());
  assert.deepEqual(result, TRANSPORT_FAILURE);
  assert.equal(thenReads, 0);
  assert.doesNotMatch(JSON.stringify(result), /syn-private/);
});

test("rejects_hostile_promise_foreign_thenable_proxy_accessor_and_stream_shapes_without_reads", async t => {
  const module = await loadShimModule("hostile-return-shapes");
  const unhandled = [];
  const onUnhandled = reason => unhandled.push(reason);
  process.on("unhandledRejection", onUnhandled);
  t.after(() => process.off("unhandledRejection", onUnhandled));
  let hostileReads = 0;
  const ownConstructor = Promise.reject(new Error("syn-private-native"));
  ownConstructor.catch(() => {});
  Object.defineProperty(ownConstructor, "constructor", {
    get() { hostileReads += 1; throw new Error("syn-private-constructor"); }
  });
  const hostileSpecies = Promise.reject(new Error("syn-private-species-rejection"));
  hostileSpecies.catch(() => {});
  function SpeciesConstructor() {}
  Object.defineProperty(SpeciesConstructor, Symbol.species, {
    get() { hostileReads += 1; throw new Error("syn-private-species"); }
  });
  Object.defineProperty(hostileSpecies, "constructor", { value: SpeciesConstructor });
  const foreign = vm.runInNewContext("Promise.reject(new Error('syn-private-foreign'))");
  foreign.catch(() => {});
  Object.defineProperty(foreign, "constructor", {
    get() { hostileReads += 1; throw new Error("syn-private-foreign-constructor"); }
  });
  const thenable = Object.defineProperty({}, "then", {
    get() { hostileReads += 1; throw new Error("syn-private-then"); }
  });
  const proxy = new Proxy({}, {
    getPrototypeOf() { hostileReads += 1; return Object.prototype; },
    ownKeys() { hostileReads += 1; return []; },
    getOwnPropertyDescriptor() { hostileReads += 1; return undefined; },
    get() { hostileReads += 1; return undefined; }
  });
  const accessor = Object.defineProperty({}, "data", {
    get() { hostileReads += 1; return "syn-private-data"; }
  });
  const streamLike = {
    getReader() { hostileReads += 1; throw new Error("syn-private-reader"); },
    [Symbol.iterator]() { hostileReads += 1; throw new Error("syn-private-iterator"); },
    [Symbol.asyncIterator]() { hostileReads += 1; throw new Error("syn-private-async-iterator"); }
  };
  const responseLike = Object.defineProperties({}, {
    body: { get() { hostileReads += 1; return streamLike; } },
    data: { get() { hostileReads += 1; return "syn-private-sdk"; } }
  });
  const deepWide = { nested: new Array(20_000).fill({ child: { value: "syn-private" } }) };

  for (const candidate of [ownConstructor, hostileSpecies, foreign, thenable, proxy, accessor, streamLike, responseLike, deepWide]) {
    const result = await module.retrieveTrustedServiceConditionSnapshot(() => candidate, inertClock());
    assert.deepEqual(result, TRANSPORT_FAILURE);
    assert.doesNotMatch(JSON.stringify(result), /syn-private/);
  }
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(hostileReads, 0);
  assert.deepEqual(unhandled, []);
});

test("admits_zero_and_rejects_out_of_range_or_noninteger_numeric_counts", async () => {
  const module = await loadShimModule("numeric-admission");
  const zero = await module.retrieveTrustedServiceConditionSnapshot(() => 0, inertClock());
  assert.equal(zero.kind, "received");
  assert.equal(zero.snapshot.ok, false);
  for (const count of [-1, 16_385, 0.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1]) {
    const result = await module.retrieveTrustedServiceConditionSnapshot(() => count, inertClock());
    assert.deepEqual(result, TRANSPORT_FAILURE);
  }
});

test("copies_exactly_the_admitted_prefix_and_accepts_the_16384_byte_boundary", async () => {
  const module = await loadShimModule("exact-copy-boundary");
  const document = JSON.stringify({
    schemaVersion: "1.0",
    generatedAt: "2026-09-13T00:00:00.000Z",
    components: []
  });
  const bytes = new TextEncoder().encode(document + " ".repeat(16_384 - document.length));
  let destinationAlias;
  const result = await module.retrieveTrustedServiceConditionSnapshot(destination => {
    destinationAlias = destination;
    destination.set(bytes);
    setImmediate(() => destination.fill(0));
    return 16_384;
  }, inertClock());
  assert.equal(result.kind, "received");
  assert.equal(result.snapshot.ok, true);
  assert.equal(destinationAlias.byteLength, 16_384);
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(destinationAlias, new Uint8Array(16_384));
});

test("copies_with_captured_branded_operations_after_source_tampers_with_destination_methods", async () => {
  const module = await loadShimModule("captured-copy-operations");
  const bytes = new TextEncoder().encode(JSON.stringify({
    schemaVersion: "1.0",
    generatedAt: "2026-09-13T00:00:00.000Z",
    components: []
  }));
  let hostileCalls = 0;
  const result = await module.retrieveTrustedServiceConditionSnapshot(destination => {
    destination.set(bytes);
    destination.subarray = () => {
      hostileCalls += 1;
      throw new Error("syn-private-subarray");
    };
    return bytes.byteLength;
  }, inertClock());
  assert.equal(result.kind, "received");
  assert.equal(result.snapshot.ok, true);
  assert.equal(hostileCalls, 0);
});

test("allocates_the_sender_copy_with_the_captured_current_realm_constructor", async () => {
  const module = await loadShimModule("captured-copy-constructor");
  const bytes = new TextEncoder().encode(JSON.stringify({
    schemaVersion: "1.0",
    generatedAt: "2026-09-13T00:00:00.000Z",
    components: []
  }));
  const OriginalUint8Array = Uint8Array;
  let hostileConstructions = 0;
  const result = await module.retrieveTrustedServiceConditionSnapshot(destination => {
    destination.set(bytes);
    globalThis.Uint8Array = function () {
      hostileConstructions += 1;
      globalThis.Uint8Array = OriginalUint8Array;
      throw new Error("syn-private-constructor");
    };
    queueMicrotask(() => { globalThis.Uint8Array = OriginalUint8Array; });
    return bytes.byteLength;
  }, inertClock());
  globalThis.Uint8Array = OriginalUint8Array;
  assert.equal(result.kind, "received");
  assert.equal(result.snapshot.ok, true);
  assert.equal(hostileConstructions, 0);
});

test("captures_the_branded_sender_buffer_before_a_source_replaces_the_ambient_accessor", async t => {
  const postMarker = "const postPort = MessagePort.prototype.postMessage;";
  const copyMarker = "const copy = new Uint8ArrayConstructor(count);";
  const dataMarker = "const data = event.data;";
  const module = await loadShimModule("captured-sender-buffer", source => {
    assert.equal(source.split(postMarker).length - 1, 1);
    assert.equal(source.split(copyMarker).length - 1, 1);
    return source
      .replace(postMarker, `export let __senderCopy;\nexport const __postEvidence = [];\nconst __originalPostPort = MessagePort.prototype.postMessage;\nconst postPort = function (...args: unknown[]) { const result = applyReflect(__originalPostPort, this, args); __postEvidence.push({ record: args[0], transfer: args[1], senderByteLength: __senderCopy?.byteLength }); return result; };`)
      .replace(copyMarker, `${copyMarker}\n          __senderCopy = copy;`);
  }, source => {
    assert.equal(source.split(dataMarker).length - 1, 1);
    return `export let __receivedChunk;\n${source}`.replace(dataMarker, `${dataMarker}\n      if (data?.kind === "chunk") __receivedChunk = data.chunk;`);
  });
  const bytes = new TextEncoder().encode(JSON.stringify({
    schemaVersion: "1.0",
    generatedAt: "2026-09-13T00:00:00.000Z",
    components: []
  }));
  const typedArrayPrototype = Object.getPrototypeOf(Uint8Array.prototype);
  const originalDescriptor = Object.getOwnPropertyDescriptor(typedArrayPrototype, "buffer");
  assert.equal(typeof originalDescriptor?.get, "function");
  let hostileGetterCalls = 0;
  let hostileAccessorInstalled = false;
  let sourceDestination;
  let sourceBuffer;
  const restore = () => {
    if (!hostileAccessorInstalled) return;
    Object.defineProperty(typedArrayPrototype, "buffer", originalDescriptor);
    hostileAccessorInstalled = false;
  };
  t.after(restore);

  let result;
  try {
    result = await module.retrieveTrustedServiceConditionSnapshot(destination => {
      sourceDestination = destination;
      sourceBuffer = Reflect.apply(originalDescriptor.get, destination, []);
      destination.set(bytes);
      Object.defineProperty(typedArrayPrototype, "buffer", {
        ...originalDescriptor,
        get() {
          hostileGetterCalls += 1;
          return sourceBuffer;
        }
      });
      hostileAccessorInstalled = true;
      queueMicrotask(restore);
      return bytes.byteLength;
    }, inertClock());
  } finally {
    restore();
  }

  assert.equal(result.kind, "received");
  assert.equal(result.snapshot.ok, true);
  assert.equal(hostileGetterCalls, 0);
  assert.equal(sourceDestination.byteLength, 16_384);
  assert.equal(sourceBuffer.byteLength, 16_384);
  assert.equal(module.__postEvidence.length, 2);
  const chunkPost = module.__postEvidence[0];
  assert.equal(chunkPost.record.kind, "chunk");
  assert.equal(chunkPost.transfer.length, 1);
  const senderBuffer = Reflect.apply(originalDescriptor.get, module.__senderCopy, []);
  assert.equal(chunkPost.transfer[0], senderBuffer);
  assert.notEqual(senderBuffer, sourceBuffer);
  assert.equal(chunkPost.senderByteLength, 0);
  assert.equal(module.__senderCopy.byteLength, 0);
  assert.equal(senderBuffer.byteLength, 0);
  const receiver = loadedAdapters.get(module).__receivedChunk;
  assert.deepEqual(receiver, bytes);
  assert.notEqual(receiver, sourceDestination);
  assert.notEqual(receiver.buffer, sourceBuffer);
  assert.notEqual(receiver.buffer, senderBuffer);
});

test("freezes_the_chunk_shell_and_transfers_the_exact_fresh_sender_buffer_synchronously", async () => {
  const marker = "applyReflect(postPort, peerPort, [chunk, [senderBuffer]]);";
  const module = await loadShimModule("transfer-custody", source => {
    assert.equal(source.split(marker).length - 1, 1);
    return `export const __postEvidence = [];\n${source}`.replace(marker, `const __transfer = [senderBuffer];\n          applyReflect(postPort, peerPort, [chunk, __transfer]);\n          __postEvidence.push({ shell: chunk, sender: copy, buffer: __transfer[0], transfer: __transfer, shellFrozen: Object.isFrozen(chunk) });`);
  });
  const bytes = new TextEncoder().encode(JSON.stringify({
    schemaVersion: "1.0",
    generatedAt: "2026-09-13T00:00:00.000Z",
    components: []
  }));
  let sourceDestination;
  const result = await module.retrieveTrustedServiceConditionSnapshot(destination => {
    sourceDestination = destination;
    destination.set(bytes);
    return bytes.byteLength;
  }, inertClock());
  assert.equal(result.kind, "received");
  assert.equal(module.__postEvidence.length, 1);
  const evidence = module.__postEvidence[0];
  assert.equal(evidence.shellFrozen, true);
  assert.deepEqual(Reflect.ownKeys(evidence.shell), ["kind", "chunk"]);
  assert.notEqual(evidence.sender, sourceDestination);
  assert.notEqual(evidence.buffer, sourceDestination.buffer);
  assert.equal(Object.isFrozen(evidence.sender), false);
  assert.equal(evidence.transfer.length, 1);
  assert.equal(evidence.transfer[0], evidence.buffer);
  assert.equal(evidence.sender.byteLength, 0);
  assert.equal(evidence.buffer.byteLength, 0);
});

test("cancel_before_start_prevents_source_work_and_posts_nothing", async () => {
  const postMarker = "const postPort = MessagePort.prototype.postMessage;";
  const startMarker = "applyReflect(postPort, ownedPort, [startCommand]);";
  const module = await loadShimModule("cancel-before-start", source => {
    assert.equal(source.split(postMarker).length - 1, 1);
    return source.replace(postMarker, `let __postCalls = 0;\nconst __originalPostPort = MessagePort.prototype.postMessage;\nconst postPort = function (...args: unknown[]) { __postCalls += 1; return applyReflect(__originalPostPort, this, args); };\nexport const __getPostCalls = () => __postCalls;`);
  }, source => {
    assert.equal(source.split(startMarker).length - 1, 1);
    return source.replace(startMarker, `applyReflect(postPort, ownedPort, [freezeObject({ kind: "cancel" as const })]);`);
  });
  let scheduled;
  let nowCalls = 0;
  const clock = {
    nowMilliseconds() { nowCalls += 1; return nowCalls === 1 ? 0 : 5_000; },
    schedule(callback) { scheduled = callback; return "syn-cancel-before-start"; },
    cancel() {}
  };
  let sourceCalls = 0;
  const pending = module.retrieveTrustedServiceConditionSnapshot(() => { sourceCalls += 1; return 0; }, clock);
  await new Promise(resolve => setTimeout(resolve, 25));
  assert.equal(sourceCalls, 0);
  assert.equal(module.__getPostCalls(), 0);
  scheduled();
  assert.deepEqual(await pending, TIMEOUT);
});

test("maintains_explicit_one_read_two_record_bounds_before_posting", async () => {
  const source = await readFile(SHIM_PATH, "utf8");
  for (const declaration of [
    "let sourceCalls = 0;",
    "let readCalls = 0;",
    "let chunkPosts = 0;",
    "let terminalPosts = 0;",
    "let recordPosts = 0;"
  ]) assert.equal(source.includes(declaration), true, declaration);
  assert.match(source, /sourceCalls <= 1/);
  assert.match(source, /readCalls <= 1/);
  assert.match(source, /chunkPosts <= 1/);
  assert.match(source, /terminalPosts <= 1/);
  assert.match(source, /recordPosts <= 2/);
});

test("maps_a_complete_post_fault_to_generic_failure_without_reposting_the_chunk", async () => {
  const marker = "const postPort = MessagePort.prototype.postMessage;";
  const module = await loadShimModule("complete-post-fault", source => {
    assert.equal(source.split(marker).length - 1, 1);
    return source.replace(marker, `let __postAttempts = 0;\nconst __originalPostPort = MessagePort.prototype.postMessage;\nconst postPort = function (...args: unknown[]) { __postAttempts += 1; if (__postAttempts === 2) throw new Error("syn-complete-post"); return applyReflect(__originalPostPort, this, args); };\nexport const __getPostAttempts = () => __postAttempts;`);
  });
  let scheduled;
  let nowCalls = 0;
  const clock = {
    nowMilliseconds() { nowCalls += 1; return nowCalls === 1 ? 0 : 5_000; },
    schedule(callback) { scheduled = callback; return "syn-complete-post-fault"; },
    cancel() {}
  };
  const pending = module.retrieveTrustedServiceConditionSnapshot(() => 0, clock);
  const observed = await Promise.race([
    pending,
    new Promise(resolve => setTimeout(() => resolve("syn-pending"), 50))
  ]);
  if (observed === "syn-pending") {
    scheduled();
    await pending;
  }
  assert.deepEqual(observed, TRANSPORT_FAILURE);
  assert.equal(module.__getPostAttempts(), 3);
});

test("preserves_success_across_listener_remove_and_peer_close_cleanup_faults", async () => {
  const module = await loadShimModule("cleanup-faults", source => source
    .replace("const removePortListener = MessagePort.prototype.removeEventListener;", "const removePortListener = function () { throw new Error(\"syn-remove\"); };")
    .replace("const closePort = MessagePort.prototype.close;", "const closePort = function () { throw new Error(\"syn-close\"); };"));
  const result = await module.retrieveTrustedServiceConditionSnapshot(() => 0, inertClock());
  assert.equal(result.kind, "received");
  assert.equal(result.snapshot.ok, false);
});

test("duplicate_start_is_ignored_before_a_second_source_call", async () => {
  const marker = "applyReflect(postPort, ownedPort, [startCommand]);";
  const module = await loadShimModule("duplicate-start", source => source, source => {
    assert.equal(source.split(marker).length - 1, 1);
    return source.replace(marker, `${marker}\n    ${marker}`);
  });
  let sourceCalls = 0;
  const result = await module.retrieveTrustedServiceConditionSnapshot(() => { sourceCalls += 1; return 0; }, inertClock());
  assert.equal(result.kind, "received");
  assert.equal(sourceCalls, 1);
});

test("suppresses_a_queued_cancel_after_the_first_terminal_without_extra_posts_or_abort", async () => {
  const postMarker = "const postPort = MessagePort.prototype.postMessage;";
  const abortMarker = "const abortController = AbortController.prototype.abort;";
  const startMarker = "applyReflect(postPort, ownedPort, [startCommand]);";
  const module = await loadShimModule("late-cancel", source => {
    assert.equal(source.split(postMarker).length - 1, 1);
    assert.equal(source.split(abortMarker).length - 1, 1);
    return source
      .replace(postMarker, `let __postCalls = 0;\nconst __originalPostPort = MessagePort.prototype.postMessage;\nconst postPort = function (...args: unknown[]) { __postCalls += 1; return applyReflect(__originalPostPort, this, args); };\nexport const __getPostCalls = () => __postCalls;`)
      .replace(abortMarker, `let __abortCalls = 0;\nconst __originalAbortController = AbortController.prototype.abort;\nconst abortController = function (...args: unknown[]) { __abortCalls += 1; return applyReflect(__originalAbortController, this, args); };\nexport const __getAbortCalls = () => __abortCalls;`);
  }, source => {
    assert.equal(source.split(startMarker).length - 1, 1);
    return source.replace(startMarker, `${startMarker}\n    applyReflect(postPort, ownedPort, [freezeObject({ kind: "cancel" as const })]);`);
  });
  let sourceCalls = 0;
  const result = await module.retrieveTrustedServiceConditionSnapshot(() => {
    sourceCalls += 1;
    return 0;
  }, inertClock());
  assert.equal(result.kind, "received");
  assert.equal(sourceCalls, 1);
  assert.equal(module.__getPostCalls(), 2);
  assert.equal(module.__getAbortCalls(), 0);
});

test("receiver_gets_the_exact_transferred_bytes_in_a_distinct_ordinary_carrier", async () => {
  const dataMarker = "const data = event.data;";
  const postMarker = "const postPort = MessagePort.prototype.postMessage;";
  const module = await loadShimModule("receiver-identity", source => {
    assert.equal(source.split(postMarker).length - 1, 1);
    return source.replace(postMarker, `export const __sentRecords = [];\nconst __originalPostPort = MessagePort.prototype.postMessage;\nconst postPort = function (...args: unknown[]) { const result = applyReflect(__originalPostPort, this, args); __sentRecords.push(args[0]); return result; };`);
  }, source => {
    assert.equal(source.split(dataMarker).length - 1, 1);
    return `export let __receivedChunk;\n${source}`.replace(dataMarker, `${dataMarker}\n      if (data?.kind === "chunk") __receivedChunk = data.chunk;`);
  });
  const bytes = new TextEncoder().encode(JSON.stringify({
    schemaVersion: "1.0",
    generatedAt: "2026-09-13T00:00:00.000Z",
    components: []
  }));
  let sourceDestination;
  const result = await module.retrieveTrustedServiceConditionSnapshot(destination => {
    sourceDestination = destination;
    destination.set(bytes);
    return bytes.byteLength;
  }, inertClock());
  assert.equal(result.kind, "received");
  assert.deepEqual(module.__sentRecords.map(record => record.kind), ["chunk", "complete"]);
  const receiver = loadedAdapters.get(module).__receivedChunk;
  assert.deepEqual(receiver, bytes);
  assert.equal(Object.getPrototypeOf(receiver), Uint8Array.prototype);
  assert.equal(Object.getPrototypeOf(receiver.buffer), ArrayBuffer.prototype);
  assert.notEqual(receiver, sourceDestination);
  assert.notEqual(receiver.buffer, sourceDestination.buffer);
  assert.equal(Object.isFrozen(receiver), false);
});

test("contains_message_channel_construction_failure_as_generic_unavailability", async () => {
  const marker = "const MessageChannelConstructor: typeof MessageChannel = MessageChannel;";
  const module = await loadShimModule("channel-construction-fault", source => {
    assert.equal(source.split(marker).length - 1, 1);
    return source.replace(marker, "const MessageChannelConstructor: typeof MessageChannel = class { constructor() { throw new Error(\"syn-channel\"); } } as typeof MessageChannel;");
  });
  const result = await module.retrieveTrustedServiceConditionSnapshot(() => 0, inertClock());
  assert.deepEqual(result, TRANSPORT_FAILURE);
  assert.doesNotMatch(JSON.stringify(result), /syn-channel/);
});

test("contains_listener_installation_and_activation_failures_before_adapter_handoff", async t => {
  const cases = [
    ["listener", "const addPortListener = MessagePort.prototype.addEventListener;", "const addPortListener = function () { throw new Error(\"syn-listener\"); };"],
    ["activation", "const startPort = MessagePort.prototype.start;", "const startPort = function () { throw new Error(\"syn-activation\"); };"]
  ];
  for (const [name, marker, replacement] of cases) {
    await t.test(name, async () => {
      const module = await loadShimModule(`setup-${name}-fault`, source => {
        assert.equal(source.split(marker).length - 1, 1);
        return source.replace(marker, replacement);
      });
      let sourceCalls = 0;
      const pending = module.retrieveTrustedServiceConditionSnapshot(() => { sourceCalls += 1; return 0; }, inertClock());
      const result = await Promise.race([
        pending,
        new Promise(resolve => setTimeout(() => resolve("syn-pending"), 50))
      ]);
      assert.deepEqual(result, TRANSPORT_FAILURE);
      assert.equal(sourceCalls, 0);
      assert.doesNotMatch(JSON.stringify(result), /syn-(listener|activation)/);
    });
  }
});
