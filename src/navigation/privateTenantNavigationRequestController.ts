import { createPrivateTenantNavigationDecisionDecoder } from "./privateTenantNavigationDecision";

type UnknownRecord = Record<string, unknown>;

const DEPENDENCY_KEYS = ["startTransport", "cancelTransport", "scheduleTimeout", "cancelTimeout",
  "subscribeCancellation", "unsubscribeCancellation", "isCancellationRequested", "readPostResponseTime", "timeoutMs"];
const EXPECTATION_KEYS = ["schemaVersion", "channel", "buildingId", "floorId", "elevatorStopId", "destinationId"];
const AUTHORITY_KEYS = ["subjectId", "tenantId", "authorizationReference", "policyRevision", "active"];
const ID = /^id_[a-f0-9]{16,64}$/;

function unavailable() {
  const result = Object.create(null);
  result.status = "unavailable";
  return Object.freeze(result);
}

function exactRecord(value: unknown, keys: string[]): UnknownRecord | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  try {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return null;
    const ownKeys = Reflect.ownKeys(value);
    if (ownKeys.length !== keys.length) return null;
    const copy = Object.create(null);
    for (let index = 0; index < keys.length; index += 1) {
      const key = keys[index];
      if (ownKeys[index] !== key) return null;
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
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
  if (!request || !grant || request.schemaVersion !== "1.0" ||
      !["door", "elevator", "direct", "alternative"].includes(request.channel as string) ||
      ![request.buildingId, request.floorId, request.elevatorStopId, request.destinationId,
        grant.subjectId, grant.tenantId, grant.authorizationReference]
        .every((value) => typeof value === "string" && ID.test(value)) ||
      !Number.isSafeInteger(grant.policyRevision) || (grant.policyRevision as number) < 1 ||
      (grant.policyRevision as number) > 2147483647 || Object.is(grant.policyRevision, -0) || grant.active !== true) return null;
  return { request: Object.freeze(request), grant: Object.freeze(grant) };
}

function dependenciesOf(value: unknown) {
  const dependencies = exactRecord(value, DEPENDENCY_KEYS);
  if (!dependencies || DEPENDENCY_KEYS.slice(0, 8).some((key) => typeof dependencies[key] !== "function") ||
      !Number.isSafeInteger(dependencies.timeoutMs) || (dependencies.timeoutMs as number) < 1 ||
      (dependencies.timeoutMs as number) > 30000 || Object.is(dependencies.timeoutMs, -0)) return null;
  return dependencies;
}

export function createPrivateTenantNavigationRequestController(rawDependencies?: unknown) {
  const dependencies = dependenciesOf(rawDependencies);
  let active = false;
  const request = Object.freeze(function request(expectation?: unknown, authority?: unknown,
    cancellation: unknown = null): Promise<unknown> {
    if (active) return Promise.resolve(unavailable());
    const construction = dependencies && snapshots(expectation, authority);
    if (!dependencies || !construction) return Promise.resolve(unavailable());
    const decoder = createPrivateTenantNavigationDecisionDecoder(construction.request, construction.grant);
    const token = Object.freeze(Object.create(null));
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
    return new Promise((resolve) => {
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
          } else (dependencies.cancelTransport as (token: unknown) => unknown)(token);
        }
        if (timerAttempted) {
          if (containTimerAcquisitionCleanup || containTransportAcquisitionCleanup) {
            try { (dependencies.cancelTimeout as (token: unknown) => unknown)(token); }
            catch {}
          } else (dependencies.cancelTimeout as (token: unknown) => unknown)(token);
        }
        if (subscriptionAttempted) {
          if (containSubscriptionCleanup || containTimerAcquisitionCleanup || containTransportAcquisitionCleanup) {
            try { (dependencies.unsubscribeCancellation as (token: unknown) => unknown)(token); }
            catch {}
          } else (dependencies.unsubscribeCancellation as (token: unknown) => unknown)(token);
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
  const controller = Object.create(null);
  controller.request = request;
  return Object.freeze(controller);
}