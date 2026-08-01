export interface AcceptedPrivateHostedAgentPresence {
  readonly schemaVersion: "1.0";
  readonly tenantId: string;
  readonly generatedAt: string;
  readonly presence: {
    readonly identityId: "stg-spiders";
    readonly displayName: "Spiders";
    readonly roleLabel: "Chief Agent";
    readonly workplace: {
      readonly id: "stg-chief-agent-office";
      readonly label: "Chief Agent Office";
      readonly relationship: "designated";
    };
    readonly state: "working" | "blocked" | "completed";
    readonly freshness: "live" | "recent";
    readonly reason: null;
    readonly stateChangedAt: string;
    readonly observedAt: string;
    readonly checkedAt: string;
    readonly recordRef: {
      readonly recordId: string;
      readonly href: string;
    };
  };
}

export interface PrivateHostedAgentSemanticPresence {
  readonly identity: string;
  readonly role: string;
  readonly state: string;
  readonly freshness: string;
  readonly asOf: string | null;
  readonly recordHref: string | null;
}

export interface PrivateHostedAgentPresencePresentation {
  readonly isolation: {
    readonly visibility: "private";
    readonly publicProjection: "unchanged";
    readonly publicHostedAgentDelta: 0;
  };
  readonly world: {
    readonly occupancyCount: 0 | 1;
    readonly anchor: {
      readonly id: "stg-chief-agent-office";
      readonly label: "Chief Agent Office";
    } | null;
    readonly stationary: true;
    readonly semanticPresence: PrivateHostedAgentSemanticPresence;
  };
  readonly nonSpatial: {
    readonly semanticPresence: PrivateHostedAgentSemanticPresence;
    readonly operation: {
      readonly inputModes: readonly ["keyboard", "touch"];
      readonly requiresPreciseMovement: false;
      readonly requiresHover: false;
      readonly colorOnlyMeaning: false;
    };
    readonly controls: readonly Readonly<Record<string, string | number>>[];
    readonly parity: {
      readonly modes: readonly ["desktop", "mobile-touch", "zoom-200", "reduced-motion", "kiosk-pi"];
      readonly semanticFields: readonly ["identity", "role", "state", "freshness", "asOf", "recordHref"];
      readonly essentialControls: readonly ["open", "refresh-request", "record-link", "close"];
      readonly reflowsAtZoom200: true;
      readonly motion: "none";
      readonly kioskDecoration: "reduced";
    };
  };
}

const CHIEF_AGENT_OFFICE_ANCHOR = Object.freeze({
  id: "stg-chief-agent-office" as const,
  label: "Chief Agent Office" as const
});

const PRIVATE_ISOLATION_CONTRACT = Object.freeze({
  visibility: "private" as const,
  publicProjection: "unchanged" as const,
  publicHostedAgentDelta: 0 as const
});

const OPERATION_CONTRACT = Object.freeze({
  inputModes: Object.freeze(["keyboard", "touch"] as const),
  requiresPreciseMovement: false as const,
  requiresHover: false as const,
  colorOnlyMeaning: false as const
});

const PARITY_CONTRACT = Object.freeze({
  modes: Object.freeze(["desktop", "mobile-touch", "zoom-200", "reduced-motion", "kiosk-pi"] as const),
  semanticFields: Object.freeze(["identity", "role", "state", "freshness", "asOf", "recordHref"] as const),
  essentialControls: Object.freeze(["open", "refresh-request", "record-link", "close"] as const),
  reflowsAtZoom200: true as const,
  motion: "none" as const,
  kioskDecoration: "reduced" as const
});

const OPAQUE_ID = /^id_[a-f0-9]{16,64}$/;
const SNAPSHOT_MAX_DEPTH = 8;
const SNAPSHOT_MAX_KEYS_PER_OBJECT = 16;
const SNAPSHOT_MAX_NODES = 32;

type DetachedValue = null | boolean | number | string | DetachedObject;

interface DetachedObject {
  readonly [key: string]: DetachedValue;
}

function detachedSnapshot(value: unknown): DetachedValue | undefined {
  let nodes = 0;
  const observations: Array<{
    candidate: object;
    keys: string[];
    descriptors: Map<string, PropertyDescriptor>;
  }> = [];

  function isStable(observation: typeof observations[number]): boolean {
    const recheckedKeys = Reflect.ownKeys(observation.candidate);
    if (
      recheckedKeys.length !== observation.keys.length ||
      recheckedKeys.some((key, index) => key !== observation.keys[index])
    ) return false;
    for (const key of observation.keys) {
      const before = observation.descriptors.get(key);
      const after = Object.getOwnPropertyDescriptor(observation.candidate, key);
      if (
        !before || !after || !("value" in before) || !("value" in after) ||
        before.enumerable !== after.enumerable || before.configurable !== after.configurable ||
        before.writable !== after.writable || !Object.is(before.value, after.value)
      ) return false;
    }
    return true;
  }

  function visit(candidate: unknown, depth: number): DetachedValue | undefined {
    if (candidate === null || typeof candidate === "boolean" || typeof candidate === "string") return candidate;
    if (typeof candidate === "number" && Number.isFinite(candidate)) return candidate;
    if (typeof candidate !== "object" || Array.isArray(candidate) || depth > SNAPSHOT_MAX_DEPTH) return undefined;
    if (++nodes > SNAPSHOT_MAX_NODES) return undefined;
    const prototype = Object.getPrototypeOf(candidate);
    if (prototype !== Object.prototype && prototype !== null) return undefined;
    const keys = Reflect.ownKeys(candidate);
    if (keys.length > SNAPSHOT_MAX_KEYS_PER_OBJECT || keys.some((key) => typeof key !== "string")) return undefined;
    const descriptors = new Map<string, PropertyDescriptor>();
    const copy: Record<string, DetachedValue> = {};
    for (const key of keys as string[]) {
      const descriptor = Object.getOwnPropertyDescriptor(candidate, key);
      if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) return undefined;
      descriptors.set(key, descriptor);
      const nested = visit(descriptor.value, depth + 1);
      if (nested === undefined) return undefined;
      copy[key] = nested;
    }
    const observation = { candidate, keys: keys as string[], descriptors };
    observations.push(observation);
    if (!isStable(observation)) return undefined;
    return Object.freeze(copy);
  }

  try {
    const detached = visit(value, 0);
    if (detached === undefined || observations.some((observation) => !isStable(observation))) return undefined;
    structuredClone(value);
    if (observations.some((observation) => !isStable(observation))) return undefined;
    return detached;
  } catch {
    return undefined;
  }
}

function hasExactKeys(value: DetachedValue, expected: string[]): value is DetachedObject {
  return value !== null && typeof value === "object" &&
    Object.keys(value).slice().sort().join("\0") === expected.join("\0");
}

const UTC_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

function isCanonicalUtc(value: DetachedValue): value is string {
  if (typeof value !== "string" || !UTC_INSTANT.test(value)) return false;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value;
}

function isPresentationSafeAccepted(value: DetachedValue): boolean {
  if (!hasExactKeys(value, ["generatedAt", "presence", "schemaVersion", "tenantId"])) return false;
  if (
    value.schemaVersion !== "1.0" || typeof value.tenantId !== "string" || !OPAQUE_ID.test(value.tenantId) ||
    !isCanonicalUtc(value.generatedAt)
  ) return false;
  const presence = value.presence;
  if (!hasExactKeys(presence, [
    "checkedAt", "displayName", "freshness", "identityId", "observedAt", "reason", "recordRef", "roleLabel",
    "state", "stateChangedAt", "workplace"
  ])) return false;
  if (
    presence.identityId !== "stg-spiders" || presence.displayName !== "Spiders" || presence.roleLabel !== "Chief Agent" ||
    !(["working", "blocked", "completed"] as DetachedValue[]).includes(presence.state) ||
    !(["live", "recent"] as DetachedValue[]).includes(presence.freshness) || presence.reason !== null ||
    !isCanonicalUtc(presence.stateChangedAt) || !isCanonicalUtc(presence.observedAt) || !isCanonicalUtc(presence.checkedAt)
  ) return false;
  if (!hasExactKeys(presence.workplace, ["id", "label", "relationship"])) return false;
  if (
    presence.workplace.id !== "stg-chief-agent-office" || presence.workplace.label !== "Chief Agent Office" ||
    presence.workplace.relationship !== "designated"
  ) return false;
  if (!hasExactKeys(presence.recordRef, ["href", "recordId"])) return false;
  if (typeof presence.recordRef.recordId !== "string" || !OPAQUE_ID.test(presence.recordRef.recordId)) return false;
  if (
    presence.recordRef.href !== `/api/private/tenants/${value.tenantId}/records/${presence.recordRef.recordId}`
  ) return false;
  return presence.stateChangedAt <= presence.observedAt && presence.observedAt <= presence.checkedAt &&
    presence.checkedAt <= value.generatedAt;
}

function controls(recordHref: string | null) {
  const values: Array<Readonly<Record<string, string | number>>> = [
    Object.freeze({ intent: "open", elementId: "private-hosted-presence-open", kind: "button", minimumTargetCssPixels: 44 }),
    Object.freeze({ intent: "refresh-request", elementId: "private-hosted-presence-refresh", kind: "button", minimumTargetCssPixels: 44 })
  ];
  if (recordHref !== null) {
    values.push(Object.freeze({
      intent: "record-link",
      elementId: "private-hosted-presence-record",
      kind: "link",
      minimumTargetCssPixels: 44,
      href: recordHref
    }));
  }
  values.push(Object.freeze({ intent: "close", elementId: "private-hosted-presence-close", kind: "button", minimumTargetCssPixels: 44 }));
  return Object.freeze(values);
}

function unavailablePresentation(): PrivateHostedAgentPresencePresentation {
  const semanticPresence = Object.freeze({
    identity: "Private hosted presence",
    role: "Authorized session required",
    state: "unavailable",
    freshness: "unavailable",
    asOf: null,
    recordHref: null
  });
  const world = Object.freeze({
    occupancyCount: 0 as const,
    anchor: null,
    stationary: true as const,
    semanticPresence
  });
  const nonSpatial = Object.freeze({
    semanticPresence,
    operation: OPERATION_CONTRACT,
    controls: controls(null),
    parity: PARITY_CONTRACT
  });
  return Object.freeze({ isolation: PRIVATE_ISOLATION_CONTRACT, world, nonSpatial });
}

export function createPrivateHostedAgentPresencePresentation(
  accepted: unknown
): PrivateHostedAgentPresencePresentation {
  try {
    const snapshot = detachedSnapshot(accepted);
    if (snapshot === undefined || !isPresentationSafeAccepted(snapshot)) return unavailablePresentation();
    const acceptedSnapshot = snapshot as unknown as AcceptedPrivateHostedAgentPresence;
    const semanticPresence = Object.freeze({
      identity: acceptedSnapshot.presence.displayName,
      role: acceptedSnapshot.presence.roleLabel,
      state: acceptedSnapshot.presence.state,
      freshness: acceptedSnapshot.presence.freshness,
      asOf: acceptedSnapshot.presence.observedAt,
      recordHref: acceptedSnapshot.presence.recordRef.href
    });
    const world = Object.freeze({
      occupancyCount: 1 as const,
      anchor: CHIEF_AGENT_OFFICE_ANCHOR,
      stationary: true as const,
      semanticPresence
    });
    const nonSpatial = Object.freeze({
      semanticPresence,
      operation: OPERATION_CONTRACT,
      controls: controls(semanticPresence.recordHref),
      parity: PARITY_CONTRACT
    });
    return Object.freeze({ isolation: PRIVATE_ISOLATION_CONTRACT, world, nonSpatial });
  } catch {
    return unavailablePresentation();
  }
}

export function createPrivateHostedAgentPresenceViewController(
  initialAcceptedPresence: unknown
) {
  let presentation = createPrivateHostedAgentPresencePresentation(initialAcceptedPresence);
  return Object.freeze({
    getPresentation: () => presentation,
    updateAcceptedPresence(accepted: unknown) {
      presentation = createPrivateHostedAgentPresencePresentation(accepted);
      return presentation;
    }
  });
}
