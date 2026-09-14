import { decodeServiceConditionSnapshotJson } from "./serviceConditionDecoder.ts";
import type { ServiceConditionSnapshotResult } from "./serviceCondition.ts";

export type ServiceConditionSourceAdapterResult =
  | Readonly<{ kind: "received"; snapshot: ServiceConditionSnapshotResult }>
  | Readonly<{ kind: "timeout"; error: Readonly<{
      code: "service_condition_source_timeout";
      reason: "Service condition source did not complete before the deadline.";
    }> }>
  | Readonly<{ kind: "transport_unavailable"; error: Readonly<{
      code: "service_condition_transport_unavailable";
      reason: "Service condition source transport is unavailable.";
    }> }>
  | Readonly<{ kind: "response_too_large"; error: Readonly<{
      code: "service_condition_response_too_large";
      reason: "Service condition source response exceeds the accepted size.";
    }> }>;
const freezeObject: typeof Object.freeze = Object.freeze;
const applyReflect: typeof Reflect.apply = Reflect.apply;
const ownKeysReflect: typeof Reflect.ownKeys = Reflect.ownKeys;
const getPrototypeOf: typeof Object.getPrototypeOf = Object.getPrototypeOf;
const getOwnPropertyDescriptor: typeof Object.getOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const isFiniteNumber: typeof Number.isFinite = Number.isFinite;
const isSafeIntegerNumber: typeof Number.isSafeInteger = Number.isSafeInteger;
const notANumber = Number.NaN;
const uint8ArrayPrototype = Uint8Array.prototype;
const typedArrayPrototype = getPrototypeOf(uint8ArrayPrototype);
const typedArrayByteLengthGetter = getOwnPropertyDescriptor(typedArrayPrototype, "byteLength")?.get;
const typedArrayBufferGetter = getOwnPropertyDescriptor(typedArrayPrototype, "buffer")?.get;
const arrayBufferPrototype = ArrayBuffer.prototype;
const arrayBufferByteLengthGetter = getOwnPropertyDescriptor(arrayBufferPrototype, "byteLength")?.get;
const atUint8Array = Uint8Array.prototype.at;
const setUint8Array = Uint8Array.prototype.set;
const cloneStructured: typeof structuredClone = structuredClone;
const messagePortPrototype = MessagePort.prototype;
const addPortListener = MessagePort.prototype.addEventListener;
const removePortListener = MessagePort.prototype.removeEventListener;
const startPort = MessagePort.prototype.start;
const postPort = MessagePort.prototype.postMessage;
const closePort = MessagePort.prototype.close;

function transportUnavailable(): ServiceConditionSourceAdapterResult {
  const error = freezeObject({
    code: "service_condition_transport_unavailable" as const,
    reason: "Service condition source transport is unavailable." as const
  });
  return freezeObject({ kind: "transport_unavailable" as const, error });
}

function timeoutResult(): ServiceConditionSourceAdapterResult {
  const error = freezeObject({
    code: "service_condition_source_timeout" as const,
    reason: "Service condition source did not complete before the deadline." as const
  });
  return freezeObject({ kind: "timeout" as const, error });
}

function responseTooLarge(): ServiceConditionSourceAdapterResult {
  const error = freezeObject({
    code: "service_condition_response_too_large" as const,
    reason: "Service condition source response exceeds the accepted size." as const
  });
  return freezeObject({ kind: "response_too_large" as const, error });
}

export async function retrieveServiceConditionSnapshot(
  sourcePort: MessagePort,
  clock: Readonly<{
    nowMilliseconds: () => number;
    schedule: (callback: () => void, delayMilliseconds: number) => unknown;
    cancel: (handle: unknown) => void;
  }>
): Promise<ServiceConditionSourceAdapterResult> {
  let ownedPort: MessagePort | null = null;
  let listenerInstalled = false;
  let activated = false;
  let terminal = false;
  let cancelTimer: ((handle: unknown) => void) | null = null;
  let timerGeneration = 0;
  let earlyRescheduleAvailable = true;
  let nowMilliseconds: () => number = () => notANumber;
  let startedAt = 0;
  let deadline = 0;
  const body = new Uint8Array(16_384);
  let bodyLength = 0;
  let chunkCalls = 0;
  let startSent = false;
  let cancelPosted = false;
  let timerRecord: {
    retired: boolean;
    handlePresent: boolean;
    handle: unknown;
    cancellationAttempted: boolean;
  } | null = null;
  let resolveResult!: (result: ServiceConditionSourceAdapterResult) => void;
  const resultPromise = new Promise<ServiceConditionSourceAdapterResult>((resolve) => {
    resolveResult = resolve;
  });

  const retireTimer = (record = timerRecord) => {
    if (record === null) return;
    record.retired = true;
    if (record.handlePresent && !record.cancellationAttempted && cancelTimer !== null) {
      record.cancellationAttempted = true;
      try {
        applyReflect(cancelTimer, clock, [record.handle]);
      } catch {
        if (!terminal) settleTransportUnavailable();
      }
    }
  };
  const cleanup = () => {
    retireTimer();
    if (ownedPort === null) return;
    if (listenerInstalled) {
      listenerInstalled = false;
      try {
        applyReflect(removePortListener, ownedPort, ["message", onMessage]);
      } catch {}
    }
    if (activated) {
      activated = false;
      try {
        applyReflect(closePort, ownedPort, []);
      } catch {}
    }
  };
  const postCancel = () => {
    if (!startSent || cancelPosted || ownedPort === null) return;
    cancelPosted = true;
    const cancelCommand = freezeObject({ kind: "cancel" as const });
    try { applyReflect(postPort, ownedPort, [cancelCommand]); } catch {}
  };
  const settleTransportUnavailable = () => {
    if (terminal) return;
    terminal = true;
    postCancel();
    resolveResult(transportUnavailable());
    cleanup();
  };
  const settleTimeout = () => {
    if (terminal) return;
    terminal = true;
    postCancel();
    resolveResult(timeoutResult());
    cleanup();
  };
  const settleResponseTooLarge = () => {
    if (terminal) return;
    terminal = true;
    postCancel();
    resolveResult(responseTooLarge());
    cleanup();
  };
  const settleReceived = () => {
    if (terminal) return;
    const completedAt = applyReflect(nowMilliseconds, clock, []) as number;
    if (!isFiniteNumber(completedAt) || completedAt < startedAt) {
      settleTransportUnavailable();
      return;
    }
    if (completedAt >= deadline) {
      settleTimeout();
      return;
    }
    terminal = true;
    const input = new Uint8Array(bodyLength);
    for (let index = 0; index < bodyLength; index += 1) input[index] = body[index];
    const snapshot = decodeServiceConditionSnapshotJson(input);
    resolveResult(freezeObject({ kind: "received" as const, snapshot }));
    cleanup();
  };
  const onMessage = (event: MessageEvent<unknown>) => {
    if (terminal) return;
    try {
      const data = event.data;
      if (data !== null && typeof data === "object" && getPrototypeOf(data) === Object.prototype) {
        const keys = applyReflect(ownKeysReflect, Reflect, [data]) as PropertyKey[];
        const kind = (applyReflect(getOwnPropertyDescriptor, Object, [data, "kind"]) as PropertyDescriptor | undefined)?.value;
        if (keys.length === 1 && kind === "transport_unavailable") {
          settleTransportUnavailable();
          return;
        }
        if (keys.length === 2 && kind === "chunk") {
          if (chunkCalls >= 256) {
            settleTransportUnavailable();
            return;
          }
          chunkCalls += 1;
          const chunk = (applyReflect(getOwnPropertyDescriptor, Object, [data, "chunk"]) as PropertyDescriptor | undefined)?.value;
          if (getPrototypeOf(chunk) === uint8ArrayPrototype) {
            if (typedArrayByteLengthGetter === undefined
              || typedArrayBufferGetter === undefined
              || arrayBufferByteLengthGetter === undefined) {
              throw new TypeError();
            }
            const chunkByteLength = applyReflect(typedArrayByteLengthGetter, chunk, []) as number;
            const buffer = applyReflect(typedArrayBufferGetter, chunk, []) as unknown;
            if (getPrototypeOf(buffer) !== arrayBufferPrototype) throw new TypeError();
            applyReflect(arrayBufferByteLengthGetter, buffer, []);
            applyReflect(atUint8Array, chunk, [0]);
            if (chunkByteLength > 16_384) {
              settleResponseTooLarge();
              return;
            }
            if (bodyLength > 16_384 - chunkByteLength) {
              settleResponseTooLarge();
              return;
            }
            applyReflect(setUint8Array, body, [chunk, bodyLength]);
            bodyLength += chunkByteLength;
            return;
          }
        }
        if (keys.length === 1 && kind === "complete") {
          settleReceived();
          return;
        }
      }
    } catch {}
    settleTransportUnavailable();
  };

  try {
    if (sourcePort === null
      || typeof sourcePort !== "object"
      || getPrototypeOf(sourcePort) !== messagePortPrototype) {
      return transportUnavailable();
    }
    const transferOptions = { transfer: [sourcePort] };
    const transferred = applyReflect(cloneStructured, undefined, [sourcePort, transferOptions]) as unknown;
    if (transferred === null
      || typeof transferred !== "object"
      || transferred === sourcePort
      || getPrototypeOf(transferred) !== messagePortPrototype) {
      if (transferred !== null
        && typeof transferred === "object"
        && getPrototypeOf(transferred) === messagePortPrototype) {
        try { applyReflect(closePort, transferred, []); } catch {}
      }
      return transportUnavailable();
    }
    ownedPort = transferred as MessagePort;
    applyReflect(addPortListener, ownedPort, ["message", onMessage]);
    listenerInstalled = true;
    applyReflect(startPort, ownedPort, []);
    activated = true;
    nowMilliseconds = clock.nowMilliseconds;
    const schedule = clock.schedule;
    cancelTimer = clock.cancel;
    if (typeof nowMilliseconds !== "function" || typeof schedule !== "function" || typeof cancelTimer !== "function") {
      settleTransportUnavailable();
      return resultPromise;
    }
    startedAt = applyReflect(nowMilliseconds, clock, []) as number;
    deadline = startedAt + 5_000;
    if (!isFiniteNumber(startedAt) || startedAt < 0 || !isSafeIntegerNumber(deadline)) {
      settleTransportUnavailable();
      return resultPromise;
    }
    const register = (delayMilliseconds: number) => {
      timerGeneration += 1;
      const generation = timerGeneration;
      const record = {
        callbackFired: false,
        retired: false,
        handlePresent: false,
        handle: undefined as unknown,
        cancellationAttempted: false
      };
      timerRecord = record;
      const handle = applyReflect(schedule, clock, [() => {
        if (record.callbackFired) return;
        record.callbackFired = true;
        if (terminal || generation !== timerGeneration) return;
        const now = applyReflect(nowMilliseconds, clock, []) as number;
        if (!isFiniteNumber(now) || now < startedAt) settleTransportUnavailable();
        else if (now >= deadline) settleTimeout();
        else if (earlyRescheduleAvailable) {
          retireTimer();
          earlyRescheduleAvailable = false;
          register(deadline - now);
        } else settleTransportUnavailable();
      }, delayMilliseconds]);
      record.handle = handle;
      record.handlePresent = true;
      if (record.retired || terminal) retireTimer(record);
    };
    register(5_000);
    if (terminal) return resultPromise;
    const startCommand = freezeObject({ kind: "start" as const });
    applyReflect(postPort, ownedPort, [startCommand]);
    startSent = true;
  } catch {
    if (terminal) return resultPromise;
    cleanup();
    return transportUnavailable();
  }

  return resultPromise;
}
