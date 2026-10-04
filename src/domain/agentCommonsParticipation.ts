import {
  requireReviewedHostedIdentityMapping,
  type ReviewedHostedIdentityMapping,
} from './hostedAgentPresence';

const GENERIC_ERROR = 'Invalid agent commons participation input';
const TypeErrorConstructor = TypeError;
const objectCreate = Object.create;
const objectFreeze = Object.freeze;
const DateConstructor = Date;
const dateGetTime = Function.prototype.call.bind(Date.prototype.getTime) as (value: Date) => number;
const dateToISOString = Function.prototype.call.bind(Date.prototype.toISOString) as (value: Date) => string;
const stringCharCodeAt = Function.prototype.call.bind(String.prototype.charCodeAt) as (
  value: string, index: number,
) => number;
const weakSetAdd = Function.prototype.call.bind(WeakSet.prototype.add) as (
  set: WeakSet<object>, value: object,
) => WeakSet<object>;
const weakSetHas = Function.prototype.call.bind(WeakSet.prototype.has) as (
  set: WeakSet<object>, value: object,
) => boolean;
const weakMapGet = Function.prototype.call.bind(WeakMap.prototype.get) as (
  map: WeakMap<object, ReviewedHostedIdentityMapping>, value: object,
) => ReviewedHostedIdentityMapping | undefined;
const weakMapSet = Function.prototype.call.bind(WeakMap.prototype.set) as (
  map: WeakMap<object, ReviewedHostedIdentityMapping>, key: object,
  value: ReviewedHostedIdentityMapping,
) => WeakMap<object, ReviewedHostedIdentityMapping>;
const numberIsFinite = Number.isFinite;
const locallyReviewedActiveMappings = new WeakSet<object>();
const authenticDrafts = new WeakSet<object>();
const draftMappings = new WeakMap<object, ReviewedHostedIdentityMapping>();

type ActivityKind = 'social' | 'creative' | 'recreation';
type ParticipationLifecycle = 'active' | 'ended';

export type AgentCommonsParticipation = Readonly<{
  schemaVersion: 'agent-commons-participation/1';
  eventId: string;
  tenantId: string;
  identityId: 'stg-spiders';
  activityKind: ActivityKind;
  participation: 'voluntary';
  privacy: 'tenant_private';
  costPolicy: 'no_incremental_spend';
  interruptionPolicy: 'return_to_assigned_state';
  lifecycle: ParticipationLifecycle;
  startedAt: string;
  endedAt: string | null;
  recordedAt: string;
  sourceIdentityRevision: number;
}>;

export type AgentCommonsParticipationDraft = Readonly<
  Omit<AgentCommonsParticipation, 'sourceIdentityRevision'>
>;

function requireCanonicalTimestamp(value: unknown): string {
  if (typeof value !== 'string') throw new TypeErrorConstructor(GENERIC_ERROR);
  const parsed = new DateConstructor(value);
  if (!numberIsFinite(dateGetTime(parsed)) || dateToISOString(parsed) !== value) {
    throw new TypeErrorConstructor(GENERIC_ERROR);
  }
  return value;
}

function requireOpaqueId(value: unknown): string {
  if (typeof value !== 'string' || value.length < 19 || value.length > 67
    || value[0] !== 'i' || value[1] !== 'd' || value[2] !== '_') {
    throw new TypeErrorConstructor(GENERIC_ERROR);
  }
  for (let index = 3; index < value.length; index += 1) {
    const code = stringCharCodeAt(value, index);
    if (!((code >= 48 && code <= 57) || (code >= 97 && code <= 102))) {
      throw new TypeErrorConstructor(GENERIC_ERROR);
    }
  }
  return value;
}

function createRecord(
  mapping: ReviewedHostedIdentityMapping,
  input: AgentCommonsParticipationDraft,
): AgentCommonsParticipation {
  const record = objectCreate(null) as Record<string, unknown>;
  record.schemaVersion = input.schemaVersion;
  record.eventId = input.eventId;
  record.tenantId = input.tenantId;
  record.identityId = input.identityId;
  record.activityKind = input.activityKind;
  record.participation = input.participation;
  record.privacy = input.privacy;
  record.costPolicy = input.costPolicy;
  record.interruptionPolicy = input.interruptionPolicy;
  record.lifecycle = input.lifecycle;
  record.startedAt = input.startedAt;
  record.endedAt = input.endedAt;
  record.recordedAt = input.recordedAt;
  record.sourceIdentityRevision = mapping.registryRevision;
  return objectFreeze(record) as AgentCommonsParticipation;
}

function requireActiveMapping(mappingInput: unknown): ReviewedHostedIdentityMapping {
  if (mappingInput === null || typeof mappingInput !== 'object') {
    throw new TypeErrorConstructor(GENERIC_ERROR);
  }
  if (weakSetHas(locallyReviewedActiveMappings, mappingInput)) {
    return mappingInput as ReviewedHostedIdentityMapping;
  }
  const mapping = requireReviewedHostedIdentityMapping(mappingInput);
  if (mapping.status !== 'active') throw new TypeErrorConstructor(GENERIC_ERROR);
  weakSetAdd(locallyReviewedActiveMappings, mapping);
  return mapping;
}

export function createAgentCommonsParticipationDraft(
  mappingInput: unknown,
  eventId: unknown,
  activityKind: unknown,
  lifecycle: unknown,
  startedAtInput: unknown,
  endedAtInput: unknown,
  recordedAtInput: unknown,
): AgentCommonsParticipationDraft {
  try {
    if (arguments.length !== 7) throw new TypeErrorConstructor(GENERIC_ERROR);
    const mapping = requireActiveMapping(mappingInput);
    requireOpaqueId(eventId);
    if (activityKind !== 'social' && activityKind !== 'creative' && activityKind !== 'recreation') {
      throw new TypeErrorConstructor(GENERIC_ERROR);
    }
    if (lifecycle !== 'active' && lifecycle !== 'ended') throw new TypeErrorConstructor(GENERIC_ERROR);
    const startedAt = requireCanonicalTimestamp(startedAtInput);
    const recordedAt = requireCanonicalTimestamp(recordedAtInput);
    let endedAt: string | null;
    if (lifecycle === 'active') {
      if (endedAtInput !== null || recordedAt < startedAt) throw new TypeErrorConstructor(GENERIC_ERROR);
      endedAt = null;
    } else {
      endedAt = requireCanonicalTimestamp(endedAtInput);
      if (endedAt < startedAt || recordedAt < endedAt) throw new TypeErrorConstructor(GENERIC_ERROR);
    }
    const draft = objectCreate(null) as Record<string, unknown>;
    draft.schemaVersion = 'agent-commons-participation/1';
    draft.eventId = eventId;
    draft.tenantId = mapping.tenantId;
    draft.identityId = mapping.identityId;
    draft.activityKind = activityKind;
    draft.participation = 'voluntary';
    draft.privacy = 'tenant_private';
    draft.costPolicy = 'no_incremental_spend';
    draft.interruptionPolicy = 'return_to_assigned_state';
    draft.lifecycle = lifecycle;
    draft.startedAt = startedAt;
    draft.endedAt = endedAt;
    draft.recordedAt = recordedAt;
    objectFreeze(draft);
    weakSetAdd(authenticDrafts, draft);
    weakMapSet(draftMappings, draft, mapping);
    return draft as AgentCommonsParticipationDraft;
  } catch {
    throw new TypeErrorConstructor(GENERIC_ERROR);
  }
}

export function createAgentCommonsParticipation(
  mappingInput: unknown,
  draftInput: unknown,
): AgentCommonsParticipation {
  try {
    if (arguments.length !== 2) throw new TypeErrorConstructor(GENERIC_ERROR);
    const mapping = requireActiveMapping(mappingInput);
    if (draftInput === null || typeof draftInput !== 'object'
      || !weakSetHas(authenticDrafts, draftInput)
      || weakMapGet(draftMappings, draftInput) !== mapping) throw new TypeErrorConstructor(GENERIC_ERROR);
    return createRecord(mapping, draftInput as AgentCommonsParticipationDraft);
  } catch {
    throw new TypeErrorConstructor(GENERIC_ERROR);
  }
}
