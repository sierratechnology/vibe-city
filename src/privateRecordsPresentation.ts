export const PRIVATE_RECORDS_LINK_KINDS = Object.freeze([
  'direction', 'authorization', 'assignment', 'activity', 'evidence', 'outcome',
] as const);

export const PRIVATE_RECORDS_LINK_STATES = Object.freeze([
  'available', 'unavailable', 'not_recorded', 'not_authorized',
] as const);

type LinkKind = typeof PRIVATE_RECORDS_LINK_KINDS[number];
type LinkState = typeof PRIVATE_RECORDS_LINK_STATES[number];

type PresentationLink = Readonly<{
  kind: LinkKind;
  label: string;
  state: LinkState;
  occurredAt: string | null;
  actionToken?: string;
}>;

export type PrivateRecordsPresentation = Readonly<{
  recordId: string;
  title: string;
  lifecycle: string;
  freshness: string;
  sourceObservedAt: string;
  links: readonly PresentationLink[];
}>;

export type PrivateRecordsSemanticView = Readonly<{
  recordId: string;
  title: string;
  stateText: string;
  freshnessText: string;
  links: readonly Readonly<{
    kind: LinkKind;
    label: string;
    state: LinkState;
    stateText: string;
    sequence: number;
    occurredAt: string | null;
    actionAvailable: boolean;
    actionToken?: string;
  }>[];
}>;

const ROOT_KEYS = new Set([
  'recordId', 'title', 'lifecycle', 'freshness', 'sourceObservedAt', 'links',
]);
const LINK_KEYS = new Set(['kind', 'label', 'state', 'occurredAt', 'actionToken']);
const LIFECYCLES = new Set([
  'proposed', 'authorized', 'ready', 'open', 'in_progress', 'active', 'blocked',
  'review', 'completed', 'archived', 'deleted', 'deleted_tombstone',
]);
const FRESHNESS = new Set([
  'live', 'fresh', 'recent', 'historical', 'stale', 'degraded', 'unavailable', 'unknown',
]);
const OPAQUE_ID = /^id_[A-Za-z0-9_-]{16,64}$/;
const ACTION_TOKEN = /^act_[A-Za-z0-9_-]{12,76}$/;
const acceptedPresentations = new WeakSet<object>();
const acceptedSemanticViews = new WeakSet<object>();

function invalid(): never {
  throw new TypeError('Invalid private records presentation input');
}

function assertPlainData(value: unknown, seen = new Set<object>(), depth = 0): void {
  if (depth > 3) invalid();
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value)) invalid();
    return;
  }
  if (typeof value !== 'object') invalid();
  if (seen.has(value)) invalid();
  seen.add(value);
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== Array.prototype) invalid();
  if (Object.getOwnPropertySymbols(value).length !== 0) invalid();
  for (const descriptor of Object.values(Object.getOwnPropertyDescriptors(value))) {
    if (!('value' in descriptor)) invalid();
    assertPlainData(descriptor.value, seen, depth + 1);
  }
  seen.delete(value);
}

function assertExactKeys(value: object, allowed: ReadonlySet<string>): void {
  for (const key of Object.keys(value)) if (!allowed.has(key)) invalid();
}

function boundedString(value: unknown, maximum: number): string {
  if (typeof value !== 'string' || value.length < 1 || value.length > maximum) invalid();
  if (/\u0000/.test(value)) invalid();
  return value;
}

function canonicalInstant(value: unknown, nullable = false): string | null {
  if (nullable && value === null) return null;
  const text = boundedString(value, 32);
  const time = Date.parse(text);
  if (!Number.isFinite(time) || new Date(time).toISOString() !== text) invalid();
  return text;
}

function deepFreeze<T>(value: T): Readonly<T> {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value as Readonly<T>;
}

export function createPrivateRecordsPresentation(input: unknown): PrivateRecordsPresentation {
  assertPlainData(input);
  if (!input || typeof input !== 'object' || Array.isArray(input)) invalid();
  assertExactKeys(input, ROOT_KEYS);
  const source = input as Record<string, unknown>;
  const recordId = boundedString(source.recordId, 67);
  if (!OPAQUE_ID.test(recordId)) invalid();
  const title = boundedString(source.title, 160);
  const lifecycle = boundedString(source.lifecycle, 32);
  const freshness = boundedString(source.freshness, 32);
  if (!LIFECYCLES.has(lifecycle) || !FRESHNESS.has(freshness)) invalid();
  const sourceObservedAt = canonicalInstant(source.sourceObservedAt) as string;
  const sourceObservedTime = Date.parse(sourceObservedAt);
  if (!Array.isArray(source.links) || source.links.length !== PRIVATE_RECORDS_LINK_KINDS.length) invalid();

  const links = source.links.map((candidate, index): PresentationLink => {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) invalid();
    assertExactKeys(candidate, LINK_KEYS);
    const link = candidate as Record<string, unknown>;
    const kind = boundedString(link.kind, 20) as LinkKind;
    const state = boundedString(link.state, 20) as LinkState;
    if (kind !== PRIVATE_RECORDS_LINK_KINDS[index] || !PRIVATE_RECORDS_LINK_STATES.includes(state)) invalid();
    const occurredAt = canonicalInstant(link.occurredAt, true);
    if (occurredAt !== null && Date.parse(occurredAt) > sourceObservedTime) invalid();
    if (state === 'available') {
      const actionToken = boundedString(link.actionToken, 80);
      if (!ACTION_TOKEN.test(actionToken)) invalid();
      return { kind, label: boundedString(link.label, 80), state, occurredAt, actionToken };
    }
    if (Object.hasOwn(link, 'actionToken')) invalid();
    return { kind, label: boundedString(link.label, 80), state, occurredAt };
  });

  const presentation = deepFreeze({
    recordId, title, lifecycle, freshness, sourceObservedAt, links,
  }) as PrivateRecordsPresentation;
  acceptedPresentations.add(presentation);
  return presentation;
}

export function createPrivateRecordsSemanticView(
  presentation: PrivateRecordsPresentation,
): PrivateRecordsSemanticView {
  if (!acceptedPresentations.has(presentation)) invalid();
  const links = presentation.links.map((link, index) => {
    const base = {
      kind: link.kind,
      label: link.label,
      state: link.state,
      stateText: `${link.label}: ${link.state.replace('_', ' ')}`,
      sequence: index + 1,
      occurredAt: link.occurredAt,
      actionAvailable: link.state === 'available',
    };
    return link.state === 'available' ? { ...base, actionToken: link.actionToken } : base;
  });
  const semantic = deepFreeze({
    recordId: presentation.recordId,
    title: presentation.title,
    stateText: `State: ${presentation.lifecycle.replace('_', ' ')}`,
    freshnessText: `Freshness: ${presentation.freshness}; observed ${presentation.sourceObservedAt}`,
    links,
  }) as PrivateRecordsSemanticView;
  acceptedSemanticViews.add(semantic);
  return semantic;
}

export function isPrivateRecordsSemanticView(value: unknown): value is PrivateRecordsSemanticView {
  return typeof value === 'object' && value !== null && acceptedSemanticViews.has(value);
}

export function adaptPrivateRecordsWorldPanel(semantic: PrivateRecordsSemanticView) {
  return Object.freeze({ surface: 'world-panel' as const, semantic });
}

export function adaptPrivateRecordsNonSpatial(semantic: PrivateRecordsSemanticView) {
  return Object.freeze({ surface: 'non-spatial' as const, semantic });
}
