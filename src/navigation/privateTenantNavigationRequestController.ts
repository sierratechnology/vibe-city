import { createPrivateTenantNavigationDecisionDecoder } from "./privateTenantNavigationDecision";

type UnknownRecord = Record<string, unknown>;

const DEPENDENCY_KEYS = ["startTransport", "cancelTransport", "scheduleTimeout", "cancelTimeout",
  "subscribeCancellation", "unsubscribeCancellation", "isCancellationRequested", "readPostResponseTime", "timeoutMs"];
const EXPECTATION_KEYS = ["schemaVersion", "channel", "buildingId", "floorId", "elevatorStopId", "destinationId"];
const AUTHORITY_KEYS = ["subjectId", "tenantId", "authorizationReference", "policyRevision", "active"];
const ID = /^id_[a-f0-9]{16,64}$/;
const regexpTest = Function.call.bind(RegExp.prototype.test) as (expression: RegExp, value: string) => boolean;
const arrayIncludes = Function.call.bind(Array.prototype.includes) as (values: unknown[], value: unknown) => boolean;
const arrayEvery = Function.call.bind(Array.prototype.every) as
  (values: unknown[], predicate: (value: unknown) => boolean) => boolean;
const arraySome = Function.call.bind(Array.prototype.some) as
  (values: unknown[], predicate: (value: unknown) => boolean) => boolean;
const arraySlice = Function.call.bind(Array.prototype.slice) as (values: unknown[], start: number, end?: number) => unknown[];
const arrayIsArray = Array.isArray;
const numberIsSafeInteger = Number.isSafeInteger;
const objectCreate = Object.create;
const objectFreeze = Object.freeze;
const objectGetPrototypeOf = Object.getPrototypeOf;
const objectGetOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const objectIs = Object.is;
const objectPrototype = Object.prototype;
const reflectOwnKeys = Reflect.ownKeys;
const promiseConstructor = Promise;
const promiseResolve = Promise.resolve.bind(Promise);

function unavailable() {
  const result = objectCreate(null);
  result.status = "unavailable";
  return objectFreeze(result);
}

function exactRecord(value: unknown, keys: string[]): UnknownRecord | null {
  if (value === null || typeof value !== "object" || arrayIsArray(value)) return null;
  try {
    const prototype = objectGetPrototypeOf(value);
    if (prototype !== objectPrototype && prototype !== null) return null;
    const ownKeys = reflectOwnKeys(value);
    if (ownKeys.length !== keys.length) return null;
    const copy = objectCreate(null);
    for (let index = 0; index < keys.length; index += 1) {
      const key = keys[index];
      if (ownKeys[index] !== key) return null;
      const descriptor = objectGetOwnPropertyDescriptor(value, key);
      if (!descriptor || !("value" in descriptor) || descriptor.enumerable !== true) return null;
      copy[key] = descriptor.value;
    }
    return copy;
  } catch {
    return null;
  }
}

function snapshots(expectation: unknown, authority: unknown) {
  const request = exactRecord(expectation, EXPECTATION_KEYS);
  const grant = exactRecord(authority, AUTHORITY_KEYS);
  const identityValues = request && grant && [request.buildingId, request.floorId, request.elevatorStopId,
    request.destinationId, grant.subjectId, grant.tenantId, grant.authorizationReference];
  if (!request || !grant || request.schemaVersion !== "1.0" ||
      !arrayIncludes(["door", "elevator", "direct", "alternative"], request.channel) ||
      !identityValues || !arrayEvery(identityValues,
        (value) => typeof value === "string" && regexpTest(ID, value)) ||
      !numberIsSafeInteger(grant.policyRevision) || (grant.policyRevision as number) < 1 ||
      (grant.policyRevision as number) > 2147483647 || objectIs(grant.policyRevision, -0) || grant.active !== true) return null;
  return { request: objectFreeze(request), grant: objectFreeze(grant) };
}

function dependenciesOf(value: unknown) {
  const dependencies = exactRecord(value, DEPENDENCY_KEYS);
  if (!dependencies || arraySome(arraySlice(DEPENDENCY_KEYS, 0, 8),
      (key) => typeof dependencies[key as string] !== "function") ||
      !numberIsSafeInteger(dependencies.timeoutMs) || (dependencies.timeoutMs as number) < 1 ||
      (dependencies.timeoutMs as number) > 30000 || objectIs(dependencies.timeoutMs, -0)) return null;
  return dependencies;
}

export function createPrivateTenantNavigationRequestController(rawDependencies?: unknown) {
  const dependencies = dependenciesOf(rawDependencies);
  let active = false;
  const request = objectFreeze(function request(expectation?: unknown, authority?: unknown,
    cancellation: unknown = null): Promise<unknown> {
    if (active) return promiseResolve(unavailable());
    const construction = dependencies && snapshots(expectation, authority);
    if (!dependencies || !construction) return promiseResolve(unavailable());
    const decoder = createPrivateTenantNavigationDecisionDecoder(construction.request, construction.grant);
    const token = objectFreeze(objectCreate(null));
    active = true;
    let settled = false;
    let subscriptionAttempted = false;
    let subscriptionAcquiring = false;
    let timerAttempted = false;
    let timerAcquiring = false;
    let transportAttempted = false;
    let transportStarting = false;
    let synchronousCompletion = false;
    let synchronousResponse: unknown;
    return new promiseConstructor((resolve) => {
      const finish = (response: unknown, accepted: boolean, containSubscriptionCleanup = false,
        containTimerAcquisitionCleanup = false, containTransportAcquisitionCleanup = false) => {
        if (settled) return;
        settled = true;
        let result = unavailable();
        if (accepted) {
          try { result = decoder.decode(response, (dependencies.readPostResponseTime as () => unknown)()); }
          catch { result = unavailable(); }
        }
        if (transportAttempted) {
          if (containTransportAcquisitionCleanup) {
            try { (dependencies.cancelTransport as (token: unknown) => unknown)(token); }
            catch {}
          } else {
            try { (dependencies.cancelTransport as (token: unknown) => unknown)(token); }
            catch { result = unavailable(); }
          }
        }
        if (timerAttempted) {
          if (containTimerAcquisitionCleanup || containTransportAcquisitionCleanup) {
            try { (dependencies.cancelTimeout as (token: unknown) => unknown)(token); }
            catch {}
          } else {
            try { (dependencies.cancelTimeout as (token: unknown) => unknown)(token); }
            catch { result = unavailable(); }
          }
        }
        if (subscriptionAttempted) {
          if (containSubscriptionCleanup || containTimerAcquisitionCleanup || containTransportAcquisitionCleanup) {
            try { (dependencies.unsubscribeCancellation as (token: unknown) => unknown)(token); }
            catch {}
          } else {
            try { (dependencies.unsubscribeCancellation as (token: unknown) => unknown)(token); }
            catch { result = unavailable(); }
          }
        }
        active = false;
        resolve(result);
      };
      try {
        if (cancellation !== null) {
          subscriptionAttempted = true;
          subscriptionAcquiring = true;
          (dependencies.subscribeCancellation as
            (cancellation: unknown, token: unknown, cancel: () => void) => unknown)
            (cancellation, token, () => {
              if (transportStarting && synchronousCompletion) return;
              finish(undefined, false, subscriptionAcquiring);
            });
          subscriptionAcquiring = false;
          if (settled) return;
          if ((dependencies.isCancellationRequested as (cancellation: unknown) => unknown)(cancellation)) {
            finish(undefined, false);
            return;
          }
        }
        timerAttempted = true;
        timerAcquiring = true;
        (dependencies.scheduleTimeout as (token: unknown, milliseconds: unknown, timeout: () => void) => unknown)
          (token, dependencies.timeoutMs, () => finish(undefined, false));
        timerAcquiring = false;
        if (settled) return;
        transportAttempted = true;
        transportStarting = true;
        (dependencies.startTransport as (snapshot: unknown, complete: (response: unknown) => void, token: unknown) => unknown)
          (construction.request, (response) => {
            if (transportStarting) {
              if (!synchronousCompletion) {
                synchronousCompletion = true;
                synchronousResponse = response;
              }
              return;
            }
            finish(response, true);
          }, token);
        transportStarting = false;
        if (synchronousCompletion) finish(synchronousResponse, true);
      } catch {
        const transportAcquisitionThrew = transportStarting;
        transportStarting = false;
        const subscriptionAcquisitionThrew = subscriptionAcquiring;
        const timerAcquisitionThrew = timerAcquiring;
        subscriptionAcquiring = false;
        timerAcquiring = false;
        finish(undefined, false, subscriptionAcquisitionThrew, timerAcquisitionThrew, transportAcquisitionThrew);
      }
    });
  });
  const controller = objectCreate(null);
  controller.request = request;
  return objectFreeze(controller);
}