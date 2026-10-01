// @ts-expect-error -- this dormant Node-only boundary intentionally has no Node type package.
import { MessageChannel } from "node:worker_threads";
// @ts-expect-error -- this dormant Node-only boundary intentionally has no Node type package.
import { types } from "node:util";
import { retrieveServiceConditionObservation } from "./serviceConditionSourceAdapter.ts";

const freezeObject: typeof Object.freeze = Object.freeze;
const isProxy: typeof types.isProxy = types.isProxy;
const applyReflect: typeof Reflect.apply = Reflect.apply;
const ownKeysReflect: typeof Reflect.ownKeys = Reflect.ownKeys;
const getPrototypeOf: typeof Object.getPrototypeOf = Object.getPrototypeOf;
const getOwnPropertyDescriptor: typeof Object.getOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const isSafeIntegerNumber: typeof Number.isSafeInteger = Number.isSafeInteger;
const objectPrototype = Object.prototype;
const Uint8ArrayConstructor = Uint8Array;
const AbortControllerConstructor = AbortController;
const abortController = AbortController.prototype.abort;
const abortSignalGetter = getOwnPropertyDescriptor(AbortController.prototype, "signal")?.get;
const messageEventDataGetter = getOwnPropertyDescriptor(MessageEvent.prototype, "data")?.get;
const addPortListener = MessagePort.prototype.addEventListener;
const removePortListener = MessagePort.prototype.removeEventListener;
const startPort = MessagePort.prototype.start;
const postPort = MessagePort.prototype.postMessage;
const closePort = MessagePort.prototype.close;
const typedArrayPrototype = getPrototypeOf(Uint8Array.prototype);
const typedArrayByteLengthGetter = getOwnPropertyDescriptor(typedArrayPrototype, "byteLength")?.get;

type TrustedServiceConditionByteSource = (
  destination: Uint8Array,
  signal: AbortSignal
) => number;

type ServiceConditionSourceClock = Readonly<{
  nowMilliseconds: () => number;
  schedule: (callback: () => void, delayMilliseconds: number) => unknown;
  cancel: (handle: unknown) => void;
}>;

function transportUnavailable() {
  const error = freezeObject({
    code: "service_condition_transport_unavailable" as const,
    reason: "Service condition source transport is unavailable." as const
  });
  return freezeObject({ kind: "transport_unavailable" as const, error });
}

export async function retrieveTrustedServiceConditionObservation(
  source: TrustedServiceConditionByteSource,
  clock: ServiceConditionSourceClock
) {
  let sourcePeer: MessagePort | null = null;
  let controller: AbortController | null = null;
  let sourceStarted = false;
  let terminal = false;
  let listenerInstalled = false;
  let cleanupFailed = false;

  const abort = () => {
    if (controller === null) return;
    try {
      applyReflect(abortController, controller, []);
    } catch {
      cleanupFailed = true;
    }
  };
  const postTerminal = (kind: "complete" | "transport_unavailable") => {
    if (terminal || sourcePeer === null) return;
    const record = freezeObject({ kind });
    try {
      applyReflect(postPort, sourcePeer, [record]);
    } catch {
      cleanupFailed = true;
      if (kind === "complete") {
        try {
          applyReflect(postPort, sourcePeer, [freezeObject({ kind: "transport_unavailable" as const })]);
        } catch {}
      }
    } finally {
      terminal = true;
    }
  };
  const failTransport = () => postTerminal("transport_unavailable");
  const onMessage = (event: MessageEvent<unknown>) => {
    if (terminal || sourcePeer === null || controller === null) return;
    try {
      if (messageEventDataGetter === undefined) throw new TypeError();
      const data = applyReflect(messageEventDataGetter, event, []) as unknown;
      if (data === null || typeof data !== "object" || isProxy(data) || getPrototypeOf(data) !== objectPrototype) {
        failTransport();
        return;
      }
      const keys = applyReflect(ownKeysReflect, Reflect, [data]) as PropertyKey[];
      const descriptor = applyReflect(getOwnPropertyDescriptor, Object, [data, "kind"]) as PropertyDescriptor | undefined;
      const kind = descriptor !== undefined && "value" in descriptor ? descriptor.value : undefined;
      if (keys.length !== 1 || keys[0] !== "kind" || (kind !== "start" && kind !== "cancel")) {
        failTransport();
        return;
      }
      if (kind === "cancel") {
        terminal = true;
        abort();
        return;
      }
      if (sourceStarted || abortSignalGetter === undefined || typedArrayByteLengthGetter === undefined) {
        failTransport();
        return;
      }
      sourceStarted = true;
      const destination = new Uint8ArrayConstructor(16_384);
      const signal = applyReflect(abortSignalGetter, controller, []) as AbortSignal;
      const byteCount = applyReflect(source, undefined, [destination, signal]) as unknown;
      if (typeof byteCount !== "number"
        || !isSafeIntegerNumber(byteCount)
        || byteCount < 0
        || byteCount > 16_384) {
        failTransport();
        return;
      }
      const destinationByteLength = applyReflect(typedArrayByteLengthGetter, destination, []) as number;
      if (destinationByteLength !== 16_384) {
        failTransport();
        return;
      }
      const chunk = new Uint8ArrayConstructor(byteCount);
      for (let index = 0; index < byteCount; index += 1) chunk[index] = destination[index];
      try {
        applyReflect(postPort, sourcePeer, [freezeObject({ kind: "chunk" as const, chunk }), [chunk.buffer]]);
        const remainingByteLength = applyReflect(typedArrayByteLengthGetter, chunk, []) as number;
        if (remainingByteLength !== 0) {
          failTransport();
          return;
        }
      } catch {
        failTransport();
        return;
      }
      postTerminal("complete");
    } catch {
      failTransport();
    }
  };

  let result: Awaited<ReturnType<typeof retrieveServiceConditionObservation>>;
  try {
    if (typeof source !== "function" || isProxy(source)) return transportUnavailable();
    const { port1: sourcePort, port2 } = new MessageChannel();
    sourcePeer = port2;
    controller = new AbortControllerConstructor();
    applyReflect(addPortListener, sourcePeer, ["message", onMessage]);
    listenerInstalled = true;
    applyReflect(startPort, sourcePeer, []);
    result = await applyReflect(retrieveServiceConditionObservation, undefined, [sourcePort, clock]);
  } catch {
    result = transportUnavailable();
  }

  try {
    terminal = true;
    abort();
    if (sourcePeer !== null && listenerInstalled) {
      listenerInstalled = false;
      try {
        applyReflect(removePortListener, sourcePeer, ["message", onMessage]);
      } catch {
        cleanupFailed = true;
      }
    }
    if (sourcePeer !== null) {
      try {
        applyReflect(closePort, sourcePeer, []);
      } catch {
        cleanupFailed = true;
      }
    }
  } catch {
    cleanupFailed = true;
  }
  return cleanupFailed ? transportUnavailable() : result;
}
