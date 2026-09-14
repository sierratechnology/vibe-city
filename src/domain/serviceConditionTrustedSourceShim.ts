import {
  retrieveServiceConditionSnapshot,
  type ServiceConditionSourceAdapterResult
} from "./serviceConditionSourceAdapter.ts";

export type ServiceConditionByteSource = (
  destination: Uint8Array,
  signal: AbortSignal
) => number;

const MessageChannelConstructor: typeof MessageChannel = MessageChannel;
const AbortControllerConstructor: typeof AbortController = AbortController;
const applyReflect: typeof Reflect.apply = Reflect.apply;
const freezeObject: typeof Object.freeze = Object.freeze;
const getPrototypeOf: typeof Object.getPrototypeOf = Object.getPrototypeOf;
const ownKeysReflect: typeof Reflect.ownKeys = Reflect.ownKeys;
const getOwnPropertyDescriptor: typeof Object.getOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const isFiniteNumber: typeof Number.isFinite = Number.isFinite;
const isSafeIntegerNumber: typeof Number.isSafeInteger = Number.isSafeInteger;
const Uint8ArrayConstructor: typeof Uint8Array = Uint8Array;
const getTypedArrayBuffer = (applyReflect(
  getOwnPropertyDescriptor,
  Object,
  [getPrototypeOf(Uint8ArrayConstructor.prototype), "buffer"]
) as PropertyDescriptor).get as (this: Uint8Array) => ArrayBuffer;
const setUint8Array = Uint8Array.prototype.set;
const subarrayUint8Array = Uint8Array.prototype.subarray;
const abortController = AbortController.prototype.abort;
const messagePortPrototype = MessagePort.prototype;
const addPortListener = MessagePort.prototype.addEventListener;
const removePortListener = MessagePort.prototype.removeEventListener;
const startPort = MessagePort.prototype.start;
const postPort = MessagePort.prototype.postMessage;
const closePort = MessagePort.prototype.close;

export function retrieveTrustedServiceConditionSnapshot(
  source: ServiceConditionByteSource,
  clock: Readonly<{
    nowMilliseconds: () => number;
    schedule: (callback: () => void, delayMilliseconds: number) => unknown;
    cancel: (handle: unknown) => void;
  }>
): Promise<ServiceConditionSourceAdapterResult> {
  if (typeof source !== "function") {
    return retrieveServiceConditionSnapshot(null as unknown as MessagePort, clock);
  }
  let channel: MessageChannel;
  try {
    channel = new MessageChannelConstructor();
  } catch {
    return retrieveServiceConditionSnapshot(null as unknown as MessagePort, clock);
  }
  const adapterPort = channel.port1;
  const peerPort = channel.port2;
  let listenerInstalled = false;
  let activated = false;
  let terminal = false;
  let started = false;
  let cancelled = false;
  let controller: AbortController | null = null;
  let abortAttempted = false;
  let sourceCalls = 0;
  let readCalls = 0;
  let chunkPosts = 0;
  let terminalPosts = 0;
  let recordPosts = 0;
  let byteCount = 0;

  const withinLimits = () => sourceCalls <= 1
    && readCalls <= 1
    && chunkPosts <= 1
    && terminalPosts <= 1
    && recordPosts <= 2
    && byteCount <= 16_384;

  const cleanup = () => {
    if (listenerInstalled) {
      listenerInstalled = false;
      try { applyReflect(removePortListener, peerPort, ["message", onMessage]); } catch {}
    }
    if (activated) {
      activated = false;
      try { applyReflect(closePort, peerPort, []); } catch {}
    }
  };
  const postUnavailable = () => {
    if (terminal || cancelled) return;
    if (sourceCalls > 1 || readCalls > 1 || chunkPosts > 1
      || terminalPosts + 1 > 1 || recordPosts + 1 > 2 || byteCount > 16_384) return;
    terminal = true;
    const record = freezeObject({ kind: "transport_unavailable" as const });
    try {
      applyReflect(postPort, peerPort, [record]);
      terminalPosts += 1;
      recordPosts += 1;
    } catch {}
    cleanup();
  };
  const onMessage = (event: MessageEvent<unknown>) => {
    if (terminal) return;
    try {
      const data = event.data;
      if (data !== null && typeof data === "object"
        && (getPrototypeOf(data) === Object.prototype || getPrototypeOf(data) === null)) {
        const keys = applyReflect(ownKeysReflect, Reflect, [data]) as PropertyKey[];
        const descriptor = applyReflect(getOwnPropertyDescriptor, Object, [data, "kind"]) as PropertyDescriptor | undefined;
        if (keys.length === 1 && keys[0] === "kind" && descriptor?.enumerable === true
          && "value" in descriptor && descriptor.value === "cancel") {
          cancelled = true;
          terminal = true;
          if (controller !== null && !abortAttempted) {
            abortAttempted = true;
            try { applyReflect(abortController, controller, []); } catch {}
          }
          cleanup();
          return;
        }
        if (keys.length === 1 && keys[0] === "kind" && descriptor?.enumerable === true
          && "value" in descriptor && descriptor.value === "start") {
          if (started) return;
          started = true;
          const destination = new Uint8ArrayConstructor(16_384);
          controller = new AbortControllerConstructor();
          let count: unknown;
          sourceCalls += 1;
          readCalls += 1;
          if (!withinLimits()) {
            postUnavailable();
            return;
          }
          try { count = source(destination, controller.signal); } catch {
            postUnavailable();
            return;
          }
          if (typeof count !== "number" || !isFiniteNumber(count)
            || !isSafeIntegerNumber(count) || count < 0 || count > 16_384) {
            postUnavailable();
            return;
          }
          if (cancelled || terminal) return;
          const copy = new Uint8ArrayConstructor(count);
          const admitted = applyReflect(subarrayUint8Array, destination, [0, count]) as Uint8Array;
          applyReflect(setUint8Array, copy, [admitted]);
          const senderBuffer = applyReflect(getTypedArrayBuffer, copy, []) as ArrayBuffer;
          const chunk = freezeObject({ kind: "chunk" as const, chunk: copy });
          if (sourceCalls > 1 || readCalls > 1 || chunkPosts + 1 > 1
            || terminalPosts > 1 || recordPosts + 1 > 2 || count > 16_384) {
            postUnavailable();
            return;
          }
          applyReflect(postPort, peerPort, [chunk, [senderBuffer]]);
          chunkPosts += 1;
          recordPosts += 1;
          byteCount = count;
          if (sourceCalls > 1 || readCalls > 1 || chunkPosts > 1
            || terminalPosts + 1 > 1 || recordPosts + 1 > 2 || byteCount > 16_384) return;
          const complete = freezeObject({ kind: "complete" as const });
          try { applyReflect(postPort, peerPort, [complete]); } catch {
            postUnavailable();
            return;
          }
          terminalPosts += 1;
          recordPosts += 1;
          terminal = true;
          cleanup();
          return;
        }
      }
    } catch {}
    postUnavailable();
  };

  try {
    applyReflect(addPortListener, peerPort, ["message", onMessage]);
    listenerInstalled = true;
    applyReflect(startPort, peerPort, []);
    activated = true;
  } catch {
    cleanup();
    try { applyReflect(closePort, peerPort, []); } catch {}
    try { applyReflect(closePort, adapterPort, []); } catch {}
    return retrieveServiceConditionSnapshot(null as unknown as MessagePort, clock);
  }
  return retrieveServiceConditionSnapshot(adapterPort, clock);
}
