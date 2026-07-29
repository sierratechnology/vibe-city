type TrustedPrivateRecordsSession = Readonly<{
  kind: "trusted_authenticated_session";
  subjectId: string;
  tenantId: string;
  authorizationRef: string;
  policyRevision: number;
  active: boolean;
}>;

type AuthorizedTraceState = "available" | "unavailable" | "withdrawn" | "stale" | "historical" | "missing" | "not_authorized";
type WorkRecordLifecycle = "proposed" | "authorized" | "ready" | "active" | "blocked" | "review" | "completed" | "archived" | "deleted_tombstone";
type RecordFreshness = "live" | "recent" | "historical" | "stale" | "degraded" | "unavailable";

type AuthorizedTraceEdge = Readonly<{
  link: string;
  state: AuthorizedTraceState;
  decision: Readonly<{ allowed: boolean; code: string }>;
  value?: unknown;
}>;

type AuthorizedPrivateRecordsModel = Readonly<{
  schemaVersion: "1.0";
  tenantId: string;
  recordId: string;
  title: string;
  lifecycle: WorkRecordLifecycle;
  freshness: RecordFreshness;
  historical: boolean;
  edges: readonly AuthorizedTraceEdge[];
}>;

type SnapshotTraceEdge = Readonly<{
  link: string;
  state: AuthorizedTraceState;
  decision: Readonly<{ allowed: boolean; code: "allowed" | "not_authorized" }>;
  valueLabel: string | null;
}>;

type SnapshotPrivateRecordsModel = Readonly<{
  schemaVersion: "1.0";
  tenantId: string;
  recordId: string;
  title: string;
  lifecycle: WorkRecordLifecycle;
  freshness: RecordFreshness;
  historical: boolean;
  edges: readonly SnapshotTraceEdge[];
}>;

type PrivateRecordsInterfaceElements = {
  dialog: HTMLDialogElement;
  status: HTMLElement;
  summary: HTMLElement;
  trace: HTMLElement;
  refresh: HTMLButtonElement;
  close: HTMLButtonElement;
};

type PrivateRecordsInterfaceAdapter = {
  getTrustedSession: () => TrustedPrivateRecordsSession | null;
  readAuthorizedModel: (session: TrustedPrivateRecordsSession) => Promise<AuthorizedPrivateRecordsModel>;
};

const LOCKED_MESSAGE = "Private records locked. Authenticated tenant access is required.";
const TRACE_ORDER = ["direction", "authorization", "assignment", "activity", "evidence", "outcome"] as const;
const MAX_OPAQUE_SCALAR_LENGTH = 128; // Implementation safety bound, not a retention or publication policy.
const MAX_PRIVATE_TITLE_LENGTH = 256; // Implementation safety bound, not a retention or publication policy.
const MAX_PRIVATE_LABEL_LENGTH = 256; // Implementation safety bound, not a retention or publication policy.
const MAX_RAW_TRACE_EDGES = TRACE_ORDER.length; // Implementation safety bound, not a retention or publication policy.
const WORK_RECORD_LIFECYCLES = new Set<WorkRecordLifecycle>([
  "proposed", "authorized", "ready", "active", "blocked", "review", "completed", "archived", "deleted_tombstone"
]);
const RECORD_FRESHNESS_VALUES = new Set<RecordFreshness>([
  "live", "recent", "historical", "stale", "degraded", "unavailable"
]);
const TRACE_STATES = new Set<AuthorizedTraceState>([
  "available", "unavailable", "withdrawn", "stale", "historical", "missing", "not_authorized"
]);

function displayToken(value: string): string {
  return value.split("_").map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" ");
}

function edgeLabel(edge: SnapshotTraceEdge): string {
  if (!edge.decision.allowed || edge.state === "not_authorized") return "Not authorized";
  if (edge.state === "missing") return "Missing / not recorded";
  return displayToken(edge.state);
}

function snapshotAuthorizedPrivateRecordsModel(value: unknown): SnapshotPrivateRecordsModel | null {
  try {
    if (value === null || typeof value !== "object") return null;
    const model = value as Record<string, unknown>;
    const schemaVersion = model.schemaVersion;
    const tenantId = model.tenantId;
    const recordId = model.recordId;
    const title = model.title;
    const lifecycle = model.lifecycle;
    const freshness = model.freshness;
    const historical = model.historical;
    const rawEdges = model.edges;
    const rawEdgeArray: unknown[] | null = Array.isArray(rawEdges) ? rawEdges : null;
    const rawEdgeCount = rawEdgeArray === null ? null : rawEdgeArray.length;
    if (
      schemaVersion !== "1.0" ||
      typeof tenantId !== "string" || tenantId.length === 0 || tenantId.length > MAX_OPAQUE_SCALAR_LENGTH ||
      typeof recordId !== "string" || recordId.length === 0 || recordId.length > MAX_OPAQUE_SCALAR_LENGTH ||
      typeof title !== "string" || title.length === 0 || title.length > MAX_PRIVATE_TITLE_LENGTH ||
      typeof lifecycle !== "string" || !WORK_RECORD_LIFECYCLES.has(lifecycle as WorkRecordLifecycle) ||
      typeof freshness !== "string" || !RECORD_FRESHNESS_VALUES.has(freshness as RecordFreshness) ||
      typeof historical !== "boolean" ||
      rawEdgeArray === null || rawEdgeCount === null || !Number.isSafeInteger(rawEdgeCount) ||
      rawEdgeCount < 0 || rawEdgeCount > MAX_RAW_TRACE_EDGES
    ) return null;

    const rawEdgeSnapshot: unknown[] = [];
    for (let index = 0; index < rawEdgeCount; index += 1) rawEdgeSnapshot.push(rawEdgeArray[index]);
    if (rawEdgeArray.length !== rawEdgeCount) return null;

    const edges: SnapshotTraceEdge[] = [];
    for (const value of rawEdgeSnapshot) {
      if (value === null || typeof value !== "object") return null;
      const edge = value as Record<string, unknown>;
      const link = edge.link;
      const state = edge.state;
      const rawDecision = edge.decision;
      const rawValue = edge.value;
      if (typeof link !== "string" || typeof state !== "string" || !TRACE_STATES.has(state as AuthorizedTraceState)) return null;
      if (rawDecision === null || typeof rawDecision !== "object") return null;
      const decision = rawDecision as Record<string, unknown>;
      const allowed = decision.allowed;
      const code = decision.code;
      if (typeof allowed !== "boolean" || typeof code !== "string") return null;
      if (state === "not_authorized"
        ? allowed !== false || code !== "not_authorized"
        : allowed !== true || code !== "allowed") return null;

      let valueLabel: string | null = null;
      if (allowed && state !== "missing" && state !== "not_authorized" && rawValue !== null && typeof rawValue === "object") {
        const label = (rawValue as Record<string, unknown>).label;
        if (typeof label === "string" && label.length > MAX_PRIVATE_LABEL_LENGTH) return null;
        valueLabel = typeof label === "string" && label.length > 0 ? label : null;
      }
      edges.push(Object.freeze({
        link,
        state: state as AuthorizedTraceState,
        decision: Object.freeze({ allowed, code: code as "allowed" | "not_authorized" }),
        valueLabel
      }));
    }
    return Object.freeze({
      schemaVersion,
      tenantId,
      recordId,
      title,
      lifecycle: lifecycle as WorkRecordLifecycle,
      freshness: freshness as RecordFreshness,
      historical,
      edges: Object.freeze(edges)
    });
  } catch {
    return null;
  }
}

function canonicalTraceEdges(edges: readonly SnapshotTraceEdge[]): readonly SnapshotTraceEdge[] | null {
  const canonicalLinks = new Set<string>(TRACE_ORDER);
  const byLink = new Map<string, SnapshotTraceEdge>();
  for (const edge of edges) {
    if (!canonicalLinks.has(edge.link) || byLink.has(edge.link)) return null;
    byLink.set(edge.link, edge);
  }
  return TRACE_ORDER.map((link) => byLink.get(link) ?? Object.freeze({
    link,
    state: "missing" as const,
    decision: Object.freeze({ allowed: true, code: "allowed" as const }),
    valueLabel: null
  }));
}

function renderTrace(elements: PrivateRecordsInterfaceElements, edges: readonly SnapshotTraceEdge[]): void {
  const order = new Map<string, number>(TRACE_ORDER.map((link, index) => [link, index]));
  const orderedEdges = [...edges]
    .filter((edge) => order.has(edge.link))
    .sort((left, right) => order.get(left.link)! - order.get(right.link)!);
  const items = orderedEdges.map((edge) => {
    const item = document.createElement("li");
    item.dataset.link = edge.link;
    const valueLabel = edge.valueLabel;
    item.textContent = `${displayToken(edge.link)}: ${edgeLabel(edge)}${valueLabel === null ? "" : ` — ${valueLabel}`}`;
    const inspectable = edge.decision.allowed && ["available", "stale", "historical"].includes(edge.state);
    if (inspectable) {
      const inspect = document.createElement("button");
      inspect.type = "button";
      inspect.textContent = `Inspect ${displayToken(edge.link)}`;
      inspect.setAttribute("aria-label", `Inspect authorized ${edge.link} link`);
      inspect.addEventListener("click", () => {
        elements.status.textContent = `${displayToken(edge.link)} link selected. ${edgeLabel(edge)}.`;
      });
      item.append(inspect);
    }
    return item;
  });
  elements.trace.replaceChildren(...items);
}

export function createPrivateRecordsInterfaceController(
  elements: PrivateRecordsInterfaceElements,
  adapter: PrivateRecordsInterfaceAdapter
): {
  open: (invoker: HTMLElement, tenantId: string) => Promise<void>;
  refresh: () => Promise<void>;
  close: () => void;
} {
  let activeInvoker: HTMLElement | null = null;
  let requestedTenantId: string | null = null;
  let requestGeneration = 0;

  function clearPrivateFields(): void {
    elements.summary.textContent = "";
    elements.trace.replaceChildren();
  }

  function trustedSessionFor(tenantId: string): TrustedPrivateRecordsSession | null {
    try {
      const value: unknown = adapter.getTrustedSession();
      if (value === null || typeof value !== "object") return null;
      const session = value as Record<string, unknown>;
      const kind = session.kind;
      const subjectId = session.subjectId;
      const acceptedTenantId = session.tenantId;
      const authorizationRef = session.authorizationRef;
      const policyRevision = session.policyRevision;
      const active = session.active;
      if (
        kind !== "trusted_authenticated_session" ||
        typeof subjectId !== "string" || subjectId.length === 0 || subjectId.length > MAX_OPAQUE_SCALAR_LENGTH ||
        typeof acceptedTenantId !== "string" || acceptedTenantId.length === 0 || acceptedTenantId.length > MAX_OPAQUE_SCALAR_LENGTH ||
        acceptedTenantId !== tenantId ||
        typeof authorizationRef !== "string" || authorizationRef.length === 0 || authorizationRef.length > MAX_OPAQUE_SCALAR_LENGTH ||
        typeof policyRevision !== "number" || !Number.isSafeInteger(policyRevision) || policyRevision < 0 ||
        active !== true
      ) return null;
      return Object.freeze({
        kind,
        subjectId,
        tenantId: acceptedTenantId,
        authorizationRef,
        policyRevision,
        active
      });
    } catch {
      return null;
    }
  }

  function sameAuthority(
    current: TrustedPrivateRecordsSession | null,
    accepted: TrustedPrivateRecordsSession
  ): boolean {
    return current !== null &&
      current.kind === accepted.kind &&
      current.subjectId === accepted.subjectId &&
      current.tenantId === accepted.tenantId &&
      current.authorizationRef === accepted.authorizationRef &&
      current.policyRevision === accepted.policyRevision &&
      current.active === accepted.active;
  }

  async function load(): Promise<void> {
    const generation = ++requestGeneration;
    clearPrivateFields();
    const authoritySnapshot = requestedTenantId === null ? null : trustedSessionFor(requestedTenantId);
    if (authoritySnapshot === null) {
      elements.status.textContent = LOCKED_MESSAGE;
      return;
    }
    let model: unknown;
    try {
      model = await adapter.readAuthorizedModel(authoritySnapshot);
    } catch {
      if (generation !== requestGeneration || !elements.dialog.open) return;
      clearPrivateFields();
      elements.status.textContent = "Private records unavailable. No private fields were retained.";
      return;
    }
    if (generation !== requestGeneration || !elements.dialog.open) return;
    const currentSession = trustedSessionFor(authoritySnapshot.tenantId);
    if (!sameAuthority(currentSession, authoritySnapshot)) {
      clearPrivateFields();
      elements.status.textContent = LOCKED_MESSAGE;
      return;
    }
    try {
      const snapshot = snapshotAuthorizedPrivateRecordsModel(model);
      if (snapshot === null) {
        clearPrivateFields();
        elements.status.textContent = "Private records unavailable. No private fields were retained.";
        return;
      }
      const canonicalEdges = canonicalTraceEdges(snapshot.edges);
      if (canonicalEdges === null) {
        clearPrivateFields();
        elements.status.textContent = "Private records unavailable. No private fields were retained.";
        return;
      }
      if (snapshot.tenantId !== authoritySnapshot.tenantId) {
        clearPrivateFields();
        elements.status.textContent = LOCKED_MESSAGE;
        return;
      }
      const finalSession = trustedSessionFor(authoritySnapshot.tenantId);
      if (!sameAuthority(finalSession, authoritySnapshot)) {
        clearPrivateFields();
        elements.status.textContent = LOCKED_MESSAGE;
        return;
      }
      const summary = `${snapshot.title}. Lifecycle: ${snapshot.lifecycle}. Freshness: ${snapshot.freshness}. ${snapshot.historical ? "Historical record." : "Current record."}`;
      renderTrace(elements, canonicalEdges);
      elements.summary.textContent = summary;
      elements.status.textContent = "Authorized private record loaded.";
    } catch {
      clearPrivateFields();
      elements.status.textContent = "Private records unavailable. No private fields were retained.";
    }
  }

  async function open(invoker: HTMLElement, tenantId: string): Promise<void> {
    activeInvoker = invoker;
    requestedTenantId = tenantId;
    if (!elements.dialog.open) elements.dialog.showModal();
    await load();
  }

  async function refresh(): Promise<void> {
    await load();
  }

  function close(): void {
    if (elements.dialog.open) elements.dialog.close();
  }

  elements.refresh.addEventListener("click", () => void refresh());
  elements.close.addEventListener("click", close);
  elements.dialog.addEventListener("close", () => {
    requestGeneration += 1;
    clearPrivateFields();
    elements.status.textContent = LOCKED_MESSAGE;
    requestedTenantId = null;
    activeInvoker?.focus();
    activeInvoker = null;
  });

  return { open, refresh, close };
}
