const ROOT_KEYS = ["schemaVersion", "generatedAt", "components"] as const;
const COMPONENT_KEYS = [
  "id",
  "label",
  "configured",
  "administrativeState",
  "freshness",
  "observedAt",
  "evidenceCode",
  "blockedReasonCode",
  "lastKnown"
] as const;
const LAST_KNOWN_KEYS = ["observedAt", "evidenceCode"] as const;
const MAX_OWN_KEYS = 17;
const MAX_DESCRIPTORS = 212;
const MAX_VISITED_VALUES = 213;
const MAX_STRING_BYTES = 8192;
const MAX_KEY_BYTES = 32;
const MAX_DEPTH = 3;
const TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const ID_PATTERN = /^syn-[a-z0-9](?:[a-z0-9_-]{0,59}[a-z0-9])?$/;
const LABEL_PATTERN = /^[A-Za-z0-9][A-Za-z0-9 ._()-]{0,79}$/;

type ServiceConditionSnapshotInput = {
  schemaVersion: "1.0";
  generatedAt: string;
  components: readonly ServiceConditionComponentInput[];
};

type ServiceConditionComponentInput = {
  id: string;
  label: string;
  configured: boolean;
  administrativeState: "required" | "optional" | "retired";
  freshness: "live" | "recent" | "historical" | "stale" | "degraded" | "unavailable";
  observedAt: string | null;
  evidenceCode: "none" | "positive" | "partial_function" | "complete_failure";
  blockedReasonCode: null | "dependency" | "decision" | "access" | "security_design";
  lastKnown: null | {
    observedAt: string;
    evidenceCode: "positive" | "partial_function" | "complete_failure";
  };
};

type ClassifiedComponent = {
  kind: "classified";
  id: string;
  label: string;
  condition: "working" | "degraded" | "blocked" | "broken" | "not_configured" | "optional" | "retired";
  freshness: "live" | "recent" | "historical" | "stale" | "degraded" | "unavailable";
  evidenceCode: "none" | "positive" | "partial_function" | "complete_failure"
    | "last_known_positive" | "last_known_partial_function" | "last_known_complete_failure";
  reasonCode: "configured_positive" | "configured_partial_function" | "configured_complete_failure"
    | "not_configured" | "optional" | "retired" | "blocked_dependency" | "blocked_decision"
    | "blocked_access" | "blocked_security_design" | "last_known_positive"
    | "last_known_partial_function" | "last_known_complete_failure";
  reason: string;
  observedAt: string | null;
};

type ConditionUnavailableComponent = {
  kind: "condition_unavailable";
  id: string;
  label: string;
  freshness: "stale" | "unavailable";
  evidenceCode: "none";
  reasonCode: "condition_unknown_no_validated_last_known";
  reason: "Current condition unavailable; no validated last-known condition.";
  observedAt: null;
};

type ServiceConditionSnapshotSuccess = {
  ok: true;
  schemaVersion: "1.0";
  generatedAt: string;
  components: readonly (ClassifiedComponent | ConditionUnavailableComponent)[];
  counts: Readonly<Record<
    "working" | "degraded" | "blocked" | "broken" | "not_configured" | "optional" | "retired",
    number
  >>;
  total: number;
  classifiedTotal: number;
  conditionUnavailableTotal: number;
  hasLocalizedImpairment: boolean;
};

export type ServiceConditionSnapshotResult = ServiceConditionSnapshotSuccess | {
  ok: false;
  error: {
    code: "invalid_service_condition_snapshot";
    reason: "Service condition snapshot is unavailable.";
  };
};

const reflectOwnKeys: typeof Reflect.ownKeys = Reflect.ownKeys;
const getOwnPropertyDescriptor: typeof Object.getOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const getPrototypeOf: typeof Object.getPrototypeOf = Object.getPrototypeOf;
const hasOwn: typeof Object.hasOwn = Object.hasOwn;
const freezeObject: typeof Object.freeze = Object.freeze;
const parseTimestamp: (value: string) => number = Date.parse;
const DateConstructor = Date;
const timestampToISOString = Date.prototype.toISOString.call.bind(
  Date.prototype.toISOString
) as (value: Date) => string;
const testRegExp = RegExp.prototype.test.call.bind(RegExp.prototype.test) as (
  pattern: RegExp,
  value: string
) => boolean;

type TraversalContext = {
  descriptors: number;
  visitedValues: number;
  stringBytes: number;
  identities: WeakSet<object>;
};

type InspectedContainer = ReadonlyMap<string, PropertyDescriptor>;

function utf8ByteLength(value: string): number | null {
  let bytes = 0;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x7f) bytes += 1;
    else if (code <= 0x7ff) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (next < 0xdc00 || next > 0xdfff) return null;
      bytes += 4;
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) return null;
    else bytes += 3;
  }
  return bytes;
}

function consumeString(context: TraversalContext, value: string, individualLimit: number): boolean {
  const bytes = utf8ByteLength(value);
  if (bytes === null || bytes > individualLimit) return false;
  context.stringBytes += bytes;
  return context.stringBytes <= MAX_STRING_BYTES;
}

function inspectContainer(
  context: TraversalContext,
  value: unknown,
  depth: number,
  expectedKeys: readonly string[] | null,
  array: boolean
): InspectedContainer | null {
  if (depth > MAX_DEPTH || value === null || typeof value !== "object") return null;
  if (array ? !Array.isArray(value) : Array.isArray(value)) return null;

  const keys = reflectOwnKeys(value);
  if (keys.length > MAX_OWN_KEYS) return null;
  context.descriptors += keys.length;
  if (context.descriptors > MAX_DESCRIPTORS) return null;
  for (const key of keys) {
    if (typeof key !== "string" || !consumeString(context, key, MAX_KEY_BYTES)) return null;
  }

  const descriptors = new Map<string, PropertyDescriptor>();
  for (const key of keys) {
    if (typeof key !== "string") return null;
    const descriptor = getOwnPropertyDescriptor(value, key);
    if (descriptor === undefined || !("value" in descriptor) || descriptor.get !== undefined || descriptor.set !== undefined) {
      return null;
    }
    if (key === "length" && array) {
      if (descriptor.writable !== true
        || descriptor.enumerable !== false
        || descriptor.configurable !== false) return null;
    } else if (descriptor.enumerable !== true
      || array && (descriptor.writable !== true || descriptor.configurable !== true)) return null;
    descriptors.set(key, descriptor);
  }

  if (array) {
    const length = descriptors.get("length")?.value;
    if (!Number.isInteger(length) || length < 0 || length > 16 || keys.length !== length + 1) return null;
    for (let index = 0; index < length; index += 1) {
      if (!descriptors.has(String(index))) return null;
    }
  } else {
    if (expectedKeys === null || keys.length !== expectedKeys.length) return null;
    for (const key of expectedKeys) {
      if (!descriptors.has(key)) return null;
    }
  }

  context.visitedValues += keys.length;
  if (context.visitedValues > MAX_VISITED_VALUES) return null;
  for (const descriptor of descriptors.values()) {
    if (typeof descriptor.value === "string"
      && !consumeString(context, descriptor.value, MAX_STRING_BYTES)) return null;
  }

  const prototype = getPrototypeOf(value);
  if (array ? prototype !== Array.prototype : prototype !== Object.prototype && prototype !== null) return null;
  if (context.identities.has(value)) return null;
  context.identities.add(value);
  return descriptors;
}

function isCanonicalTimestamp(value: unknown): value is string {
  if (typeof value !== "string" || utf8ByteLength(value) !== 24 || !testRegExp(TIMESTAMP_PATTERN, value)) {
    return false;
  }
  const parsed = parseTimestamp(value);
  return Number.isFinite(parsed) && timestampToISOString(new DateConstructor(parsed)) === value;
}

function isIdentifier(value: unknown): value is string {
  const bytes = typeof value === "string" ? utf8ByteLength(value) : null;
  return typeof value === "string" && bytes !== null && bytes <= 64 && testRegExp(ID_PATTERN, value);
}

function isLabel(value: unknown): value is string {
  const bytes = typeof value === "string" ? utf8ByteLength(value) : null;
  return typeof value === "string" && bytes !== null && bytes <= 80 && testRegExp(LABEL_PATTERN, value);
}

const DENIED_LABEL_SEQUENCES = [
  ["api", "token"],
  ["access", "token"],
  ["auth", "token"],
  ["secret", "value"],
  ["client", "secret"],
  ["login", "credential"],
  ["login", "password"],
  ["connection", "string"],
  ["provider", "error"],
  ["provider", "internal"],
  ["stack", "trace"],
  ["private", "identifier"],
  ["account", "id"],
  ["tenant", "id"],
  ["private", "repository"],
  ["execute", "code"],
  ["script", "payload"]
] as const;

function hasDeniedLabelSequence(label: string): boolean {
  let folded = "";
  for (let index = 0; index < label.length; index += 1) {
    const code = label.charCodeAt(index);
    folded += code >= 65 && code <= 90 ? String.fromCharCode(code + 32) : label[index];
  }
  const tokens: string[] = [];
  let token = "";
  for (let index = 0; index < folded.length; index += 1) {
    const code = folded.charCodeAt(index);
    if (code >= 97 && code <= 122 || code >= 48 && code <= 57) token += folded[index];
    else if (token.length > 0) {
      tokens.push(token);
      token = "";
    }
  }
  if (token.length > 0) tokens.push(token);
  for (const sequence of DENIED_LABEL_SEQUENCES) {
    for (let start = 0; start <= tokens.length - sequence.length; start += 1) {
      let matches = true;
      for (let offset = 0; offset < sequence.length; offset += 1) {
        if (tokens[start + offset] !== sequence[offset]) {
          matches = false;
          break;
        }
      }
      if (matches) return true;
    }
  }
  return false;
}

function frozenFailure(): ServiceConditionSnapshotResult {
  const error = freezeObject({
    code: "invalid_service_condition_snapshot" as const,
    reason: "Service condition snapshot is unavailable." as const
  });
  return freezeObject({ ok: false as const, error });
}

const CURRENT_EVIDENCE = {
  positive: {
    condition: "working",
    reasonCode: "configured_positive",
    reason: "Validated evidence indicates the component is working."
  },
  partial_function: {
    condition: "degraded",
    reasonCode: "configured_partial_function",
    reason: "Validated evidence indicates partial component function."
  },
  complete_failure: {
    condition: "broken",
    reasonCode: "configured_complete_failure",
    reason: "Validated evidence indicates complete component failure."
  }
} as const;

const LAST_KNOWN_EVIDENCE = {
  positive: {
    condition: "working",
    evidenceCode: "last_known_positive",
    reasonCode: "last_known_positive",
    reason: "Last validated evidence indicated the component was working."
  },
  partial_function: {
    condition: "degraded",
    evidenceCode: "last_known_partial_function",
    reasonCode: "last_known_partial_function",
    reason: "Last validated evidence indicated partial component function."
  },
  complete_failure: {
    condition: "broken",
    evidenceCode: "last_known_complete_failure",
    reasonCode: "last_known_complete_failure",
    reason: "Last validated evidence indicated complete component failure."
  }
} as const;

const BLOCKED_REASONS = {
  dependency: {
    reasonCode: "blocked_dependency",
    reason: "Component activation is blocked by a dependency."
  },
  decision: {
    reasonCode: "blocked_decision",
    reason: "Component activation is blocked by a required decision."
  },
  access: {
    reasonCode: "blocked_access",
    reason: "Component activation is blocked by required access."
  },
  security_design: {
    reasonCode: "blocked_security_design",
    reason: "Component activation is blocked by security design."
  }
} as const;

export function classifyServiceConditionSnapshot(value: unknown): ServiceConditionSnapshotResult {
  try {
    const context: TraversalContext = {
      descriptors: 0,
      visitedValues: 1,
      stringBytes: 0,
      identities: new WeakSet<object>()
    };
    const root = inspectContainer(context, value, 0, ROOT_KEYS, false);
    if (root === null) return frozenFailure();

    const schemaVersion = root.get("schemaVersion")!.value;
    const generatedAt = root.get("generatedAt")!.value;
    const componentsValue = root.get("components")!.value;
    if (schemaVersion !== "1.0" || !isCanonicalTimestamp(generatedAt)) return frozenFailure();
    const generatedAtTime = parseTimestamp(generatedAt);

    const componentArray = inspectContainer(context, componentsValue, 1, null, true);
    if (componentArray === null) return frozenFailure();

    const acceptedComponents: (ClassifiedComponent | ConditionUnavailableComponent)[] = [];
    const identifiers = new Set<string>();
    const length = componentArray.get("length")!.value as number;
    for (let index = 0; index < length; index += 1) {
      const inspected = inspectContainer(
        context,
        componentArray.get(String(index))!.value,
        2,
        COMPONENT_KEYS,
        false
      );
      if (inspected === null) return frozenFailure();
      const id = inspected.get("id")!.value;
      const label = inspected.get("label")!.value;
      const administrativeState = inspected.get("administrativeState")!.value;
      if (!isIdentifier(id)
        || !isLabel(label)
        || hasDeniedLabelSequence(label)
        || identifiers.has(id)
        || administrativeState !== "required"
          && administrativeState !== "optional"
          && administrativeState !== "retired") return frozenFailure();
      identifiers.add(id);

      const configured = inspected.get("configured")!.value;
      const freshness = inspected.get("freshness")!.value;
      const observedAt = inspected.get("observedAt")!.value;
      const evidenceCode = inspected.get("evidenceCode")!.value;
      const blockedReasonCode = inspected.get("blockedReasonCode")!.value;
      const lastKnownValue = inspected.get("lastKnown")!.value;

      if (administrativeState === "optional" || administrativeState === "retired") {
        if (configured !== false
          || freshness !== "unavailable"
          || observedAt !== null
          || evidenceCode !== "none"
          || blockedReasonCode !== null
          || lastKnownValue !== null) return frozenFailure();
        acceptedComponents.push(freezeObject({
          kind: "classified" as const,
          id,
          label,
          condition: administrativeState,
          freshness: "unavailable" as const,
          evidenceCode: "none" as const,
          reasonCode: administrativeState,
          reason: administrativeState === "optional"
            ? "Component is optional." as const
            : "Component is retired." as const,
          observedAt: null
        }));
        continue;
      }

      if (configured === false
        && freshness === "unavailable"
        && observedAt === null
        && evidenceCode === "none"
        && blockedReasonCode === null
        && lastKnownValue === null) {
        acceptedComponents.push(freezeObject({
          kind: "classified" as const,
          id,
          label,
          condition: "not_configured" as const,
          freshness: "unavailable" as const,
          evidenceCode: "none" as const,
          reasonCode: "not_configured" as const,
          reason: "Component is not configured." as const,
          observedAt: null
        }));
        continue;
      }

      if (configured !== true) return frozenFailure();
      if (typeof blockedReasonCode === "string" && hasOwn(BLOCKED_REASONS, blockedReasonCode)) {
        if (freshness !== "unavailable"
          || observedAt !== null
          || evidenceCode !== "none"
          || lastKnownValue !== null) return frozenFailure();
        const mapping = BLOCKED_REASONS[blockedReasonCode as keyof typeof BLOCKED_REASONS];
        acceptedComponents.push(freezeObject({
          kind: "classified" as const,
          id,
          label,
          condition: "blocked" as const,
          freshness: "unavailable" as const,
          evidenceCode: "none" as const,
          reasonCode: mapping.reasonCode,
          reason: mapping.reason,
          observedAt: null
        }));
        continue;
      }
      if (blockedReasonCode !== null) return frozenFailure();
      if ((freshness === "live"
        || freshness === "recent"
        || freshness === "historical"
        || freshness === "degraded")
        && isCanonicalTimestamp(observedAt)
        && parseTimestamp(observedAt) <= generatedAtTime
        && lastKnownValue === null
        && typeof evidenceCode === "string"
        && hasOwn(CURRENT_EVIDENCE, evidenceCode)) {
        const mapping = CURRENT_EVIDENCE[evidenceCode as keyof typeof CURRENT_EVIDENCE];
        acceptedComponents.push(freezeObject({
          kind: "classified" as const,
          id,
          label,
          condition: mapping.condition,
          freshness,
          evidenceCode: evidenceCode as keyof typeof CURRENT_EVIDENCE,
          reasonCode: mapping.reasonCode,
          reason: mapping.reason,
          observedAt
        }));
        continue;
      }

      if ((freshness === "stale" || freshness === "unavailable")
        && observedAt === null
        && evidenceCode === "none") {
        if (lastKnownValue === null) {
          acceptedComponents.push(freezeObject({
            kind: "condition_unavailable" as const,
            id,
            label,
            freshness,
            evidenceCode: "none" as const,
            reasonCode: "condition_unknown_no_validated_last_known" as const,
            reason: "Current condition unavailable; no validated last-known condition." as const,
            observedAt: null
          }));
          continue;
        }
        const lastKnown = inspectContainer(context, lastKnownValue, 3, LAST_KNOWN_KEYS, false);
        if (lastKnown === null) return frozenFailure();
        const lastObservedAt = lastKnown.get("observedAt")!.value;
        const lastEvidenceCode = lastKnown.get("evidenceCode")!.value;
        if (!isCanonicalTimestamp(lastObservedAt)
          || parseTimestamp(lastObservedAt) > generatedAtTime
          || typeof lastEvidenceCode !== "string"
          || !hasOwn(LAST_KNOWN_EVIDENCE, lastEvidenceCode)) return frozenFailure();
        const mapping = LAST_KNOWN_EVIDENCE[lastEvidenceCode as keyof typeof LAST_KNOWN_EVIDENCE];
        acceptedComponents.push(freezeObject({
          kind: "classified" as const,
          id,
          label,
          condition: mapping.condition,
          freshness,
          evidenceCode: mapping.evidenceCode,
          reasonCode: mapping.reasonCode,
          reason: mapping.reason,
          observedAt: lastObservedAt
        }));
        continue;
      }
      return frozenFailure();
    }

    const detachedComponents = freezeObject(acceptedComponents);
    const mutableCounts = {
      working: 0,
      degraded: 0,
      blocked: 0,
      broken: 0,
      not_configured: 0,
      optional: 0,
      retired: 0
    };
    let conditionUnavailableTotal = 0;
    let hasLocalizedImpairment = false;
    for (const component of acceptedComponents) {
      if (component.kind === "condition_unavailable") {
        conditionUnavailableTotal += 1;
        hasLocalizedImpairment = true;
      } else {
        mutableCounts[component.condition] += 1;
        if (component.condition === "degraded"
          || component.condition === "blocked"
          || component.condition === "broken") hasLocalizedImpairment = true;
      }
    }
    const counts = freezeObject(mutableCounts);
    const classifiedTotal = length - conditionUnavailableTotal;
    return freezeObject({
      ok: true as const,
      schemaVersion: "1.0" as const,
      generatedAt,
      components: detachedComponents,
      counts,
      total: length,
      classifiedTotal,
      conditionUnavailableTotal,
      hasLocalizedImpairment
    });
  } catch {
    return frozenFailure();
  }
}
