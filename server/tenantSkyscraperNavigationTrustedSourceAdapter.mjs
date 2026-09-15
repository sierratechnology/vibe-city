import { isProxy } from "node:util/types";

const objectCreate = Object.create;
const objectFreeze = Object.freeze;
const objectGetOwnPropertyDescriptors = Object.getOwnPropertyDescriptors;
const objectGetPrototypeOf = Object.getPrototypeOf;
const objectPrototype = Object.prototype;
const reflectApply = Reflect.apply;
const reflectOwnKeys = Reflect.ownKeys;
const SOURCE_KEYS = objectFreeze([
  "now", "resolveTrustedSession", "resolveTrustedNavigationFacts"
]);

export function createTenantSkyscraperNavigationTrustedSourceAdapter(source) {
  try {
    if (source === null || typeof source !== "object" || isProxy(source)) return null;
    const prototype = objectGetPrototypeOf(source);
    if (prototype !== objectPrototype && prototype !== null) return null;
    const sourceKeys = reflectOwnKeys(source);
    if (sourceKeys.length !== SOURCE_KEYS.length) return null;
    const descriptors = objectGetOwnPropertyDescriptors(source);
    for (const key of SOURCE_KEYS) {
      const descriptor = descriptors[key];
      if (!descriptor || !("value" in descriptor) || descriptor.enumerable !== true ||
          typeof descriptor.value !== "function") return null;
    }
    const capturedNow = descriptors.now.value;
    const capturedResolveTrustedSession = descriptors.resolveTrustedSession.value;
    const capturedResolveTrustedNavigationFacts = descriptors.resolveTrustedNavigationFacts.value;
    const adapter = objectCreate(null);
    adapter.now = objectFreeze(() => reflectApply(capturedNow, undefined, []));
    adapter.resolveTrustedSession = objectFreeze((request) =>
      reflectApply(capturedResolveTrustedSession, undefined, [request]));
    adapter.resolveTrustedNavigationFacts = objectFreeze((factsInput) =>
      reflectApply(capturedResolveTrustedNavigationFacts, undefined, [factsInput]));
    return objectFreeze(adapter);
  } catch {
    return null;
  }
}
