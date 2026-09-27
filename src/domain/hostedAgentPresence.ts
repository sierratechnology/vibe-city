const OPAQUE_ID = /^id_[a-f0-9]{16,64}$/;
const PROFILE_NAME = /^[a-z][a-z0-9_-]{0,63}$/;
const SKILL_NAME = /^[a-z][a-z0-9-]{0,63}$/;
const GENERIC_ERROR = 'Invalid hosted agent presence input';
const SOURCE_REASONS = Object.freeze({
  available: 'source_available',
  degraded: 'heartbeat_delayed',
  unavailable: 'source_unavailable',
} as const);
const BLOCK_REASONS = Object.freeze({
  dependency: true,
  needs_input: true,
  capability: true,
  transient: true,
} as const);
const ACTIVITY_STATES = Object.freeze({
  reviewing: Object.freeze({ state: 'reviewing', reason: 'review_activity' }),
  researching: Object.freeze({ state: 'researching', reason: 'research_activity' }),
  meeting: Object.freeze({ state: 'meeting', reason: 'meeting_activity' }),
} as const);
const WORKPLACE_LABELS = Object.freeze({
  'Chief Agent Office': true,
  'Executive Office': true,
} as const);
const TRUSTED_MAPPINGS = new WeakSet<object>();
const REQUEST_PROVENANCE = new WeakMap<object, object>();
const OBSERVATION_PROVENANCE = new WeakMap<object, Readonly<{
  mapping: object;
  request: object;
}>>();

type UnknownRecord = Record<string, unknown>;
type SourceActivity = keyof typeof ACTIVITY_STATES;

function fail(): never {
  throw new TypeError(GENERIC_ERROR);
}

function requireClosedObject(
  value: unknown,
  requiredKeys: readonly string[],
  optionalKeys: readonly string[] = [],
): UnknownRecord {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) fail();
  const object = value as UnknownRecord;
  const prototype = Object.getPrototypeOf(object);
  if ((prototype !== Object.prototype && prototype !== null)
    || Object.getPrototypeOf(object) !== prototype) fail();
  const allowed = new Set([...requiredKeys, ...optionalKeys]);
  const keys = Reflect.ownKeys(object);
  const repeatedKeys = Reflect.ownKeys(object);
  if (keys.length !== repeatedKeys.length
    || keys.some((key, index) => key !== repeatedKeys[index])) fail();
  if (keys.length > allowed.size) fail();
  const snapshot: UnknownRecord = {};
  for (const key of keys) {
    if (typeof key !== 'string' || !allowed.has(key)) fail();
    const descriptor = Object.getOwnPropertyDescriptor(object, key);
    const repeated = Object.getOwnPropertyDescriptor(object, key);
    if (!descriptor || !repeated
      || !Object.prototype.hasOwnProperty.call(descriptor, 'value')
      || !Object.prototype.hasOwnProperty.call(repeated, 'value')
      || !Object.is(descriptor.value, repeated.value)
      || descriptor.enumerable !== repeated.enumerable
      || descriptor.configurable !== repeated.configurable
      || descriptor.writable !== repeated.writable) fail();
    Object.defineProperty(snapshot, key, {
      value: descriptor.value, enumerable: true, configurable: false, writable: false,
    });
  }
  for (const key of requiredKeys) {
    if (!Object.hasOwn(snapshot, key)) fail();
  }
  return snapshot;
}

function requireExactString<const Expected extends string>(
  value: unknown,
  expected: Expected,
): Expected {
  if (value !== expected) fail();
  return expected;
}

function requireWorkplaceLabel(value: unknown): keyof typeof WORKPLACE_LABELS {
  if (typeof value !== 'string' || !Object.hasOwn(WORKPLACE_LABELS, value)) fail();
  return value as keyof typeof WORKPLACE_LABELS;
}

function requireOpaqueId(value: unknown): string {
  if (typeof value !== 'string' || !OPAQUE_ID.test(value)) fail();
  return value;
}

function requireCanonicalTimestamp(value: unknown): string {
  if (typeof value !== 'string') fail();
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== value) fail();
  return value;
}

function requirePositiveInteger(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) <= 0 || Object.is(value, -0)) fail();
  return value as number;
}

function requireArraySnapshot(value: unknown, maximum: number): unknown[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) fail();
  const keys = Reflect.ownKeys(value);
  const repeatedKeys = Reflect.ownKeys(value);
  if (keys.length !== repeatedKeys.length
    || keys.some((key, index) => key !== repeatedKeys[index])) fail();
  const lengthDescriptor = Object.getOwnPropertyDescriptor(value, 'length');
  if (!lengthDescriptor || !Object.prototype.hasOwnProperty.call(lengthDescriptor, 'value')
    || !Number.isSafeInteger(lengthDescriptor.value)
    || lengthDescriptor.value < 0 || lengthDescriptor.value > maximum
    || keys.length !== lengthDescriptor.value + 1) fail();
  const snapshot: unknown[] = [];
  for (let index = 0; index < lengthDescriptor.value; index += 1) {
    const key = String(index);
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    const repeated = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !repeated
      || !Object.prototype.hasOwnProperty.call(descriptor, 'value')
      || !Object.prototype.hasOwnProperty.call(repeated, 'value')
      || !Object.is(descriptor.value, repeated.value)) fail();
    snapshot.push(descriptor.value);
  }
  return snapshot;
}

function requireEmptyArray(value: unknown): readonly never[] {
  if (requireArraySnapshot(value, 0).length !== 0) fail();
  return Object.freeze([]) as readonly never[];
}

function requireSkills(value: unknown): readonly string[] {
  const skills = requireArraySnapshot(value, 16).map((skill) => {
    if (typeof skill !== 'string' || !SKILL_NAME.test(skill)) fail();
    return skill;
  });
  if (new Set(skills).size !== skills.length) fail();
  return Object.freeze(skills);
}

export type ReviewedHostedIdentityMapping = Readonly<{
  tenantId: string;
  subjectId: string;
  identityId: 'stg-spiders';
  displayName: 'Spiders';
  profileName: string;
  registryRevision: number;
  synchronizedAt: string;
  status: 'active' | 'revoked' | 'retired';
  roleLabel: 'Chief Agent';
  workplaceLabel: keyof typeof WORKPLACE_LABELS;
  skills: readonly string[];
  permissions: readonly never[];
  actionAuthorities: readonly never[];
}>;

export function createReviewedHostedIdentityMapping(input: unknown): ReviewedHostedIdentityMapping {
  try {
    const object = requireClosedObject(input, [
      'tenantId', 'subjectId', 'identityId', 'displayName', 'profileName',
      'registryRevision', 'synchronizedAt', 'status', 'roleLabel', 'workplaceLabel',
      'skills', 'permissions', 'actionAuthorities',
    ]);
    const profileName = object.profileName;
    if (typeof profileName !== 'string' || !PROFILE_NAME.test(profileName)) fail();
    if (!['active', 'revoked', 'retired'].includes(object.status as string)) fail();
    const accepted = Object.freeze({
      tenantId: requireOpaqueId(object.tenantId),
      subjectId: requireOpaqueId(object.subjectId),
      identityId: requireExactString(object.identityId, 'stg-spiders'),
      displayName: requireExactString(object.displayName, 'Spiders'),
      profileName,
      registryRevision: requirePositiveInteger(object.registryRevision),
      synchronizedAt: requireCanonicalTimestamp(object.synchronizedAt),
      status: object.status as ReviewedHostedIdentityMapping['status'],
      roleLabel: requireExactString(object.roleLabel, 'Chief Agent'),
      workplaceLabel: requireWorkplaceLabel(object.workplaceLabel),
      skills: requireSkills(object.skills),
      permissions: requireEmptyArray(object.permissions),
      actionAuthorities: requireEmptyArray(object.actionAuthorities),
    });
    TRUSTED_MAPPINGS.add(accepted);
    return accepted;
  } catch {
    throw new TypeError(GENERIC_ERROR);
  }
}

export function requireReviewedHostedIdentityMapping(
  value: unknown,
): ReviewedHostedIdentityMapping {
  if (value === null || typeof value !== 'object' || !TRUSTED_MAPPINGS.has(value)) fail();
  return value as ReviewedHostedIdentityMapping;
}

export type HostedPresenceRequest = Readonly<{
  boardScope: 'default';
  profileName: string;
  mappingRevision: number;
  evaluatedAt: string;
}>;

export function createHostedPresenceRequest(
  mappingInput: unknown,
  input: unknown,
): HostedPresenceRequest {
  try {
    const mapping = requireReviewedHostedIdentityMapping(mappingInput);
    const object = requireClosedObject(input, [
      'boardScope', 'profileName', 'mappingRevision', 'evaluatedAt',
    ]);
    const evaluatedAt = requireCanonicalTimestamp(object.evaluatedAt);
    if (object.boardScope !== 'default'
      || object.profileName !== mapping.profileName
      || object.mappingRevision !== mapping.registryRevision
      || evaluatedAt < mapping.synchronizedAt) fail();
    const accepted = Object.freeze({
      boardScope: 'default',
      profileName: mapping.profileName,
      mappingRevision: mapping.registryRevision,
      evaluatedAt,
    });
    REQUEST_PROVENANCE.set(accepted, mapping);
    return accepted;
  } catch {
    throw new TypeError(GENERIC_ERROR);
  }
}

function requireReason(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-z][a-z0-9_]{0,79}$/.test(value)) fail();
  return value;
}

function requireCurrentRun(value: unknown, observedAt: string): Readonly<UnknownRecord> {
  const run = requireClosedObject(value, [
    'runId', 'taskId', 'status', 'outcome', 'claimedAt', 'spawnedAt',
    'pid', 'pidLive', 'heartbeatAt',
  ]);
  const claimedAt = requireCanonicalTimestamp(run.claimedAt);
  const spawnedAt = requireCanonicalTimestamp(run.spawnedAt);
  const heartbeatAt = requireCanonicalTimestamp(run.heartbeatAt);
  if (run.status !== 'running' || run.outcome !== null || run.pidLive !== true
    || claimedAt > spawnedAt || spawnedAt > heartbeatAt || heartbeatAt > observedAt) fail();
  return Object.freeze({
    runId: requireOpaqueId(run.runId), taskId: requireOpaqueId(run.taskId),
    status: 'running', outcome: null, claimedAt, spawnedAt,
    pid: requirePositiveInteger(run.pid), pidLive: true, heartbeatAt,
  });
}

function requireCurrentActivity(
  value: unknown,
  run: Readonly<UnknownRecord>,
): Readonly<UnknownRecord> {
  const activity = requireClosedObject(value, [
    'runId', 'taskId', 'activity', 'occurredAt',
  ]);
  const runId = requireOpaqueId(activity.runId);
  const taskId = requireOpaqueId(activity.taskId);
  const occurredAt = requireCanonicalTimestamp(activity.occurredAt);
  const activityName = activity.activity;
  if (runId !== run.runId || taskId !== run.taskId
    || typeof activityName !== 'string' || !Object.hasOwn(ACTIVITY_STATES, activityName)
    || occurredAt < (run.spawnedAt as string)
    || occurredAt > (run.heartbeatAt as string)) fail();
  return Object.freeze({ runId, taskId, activity: activityName as SourceActivity, occurredAt });
}

function requireActivityEvent(
  value: unknown,
  activity: Readonly<UnknownRecord>,
): Readonly<UnknownRecord> {
  const event = requireClosedObject(value, [
    'eventId', 'runId', 'taskId', 'activity', 'occurredAt',
  ]);
  const runId = requireOpaqueId(event.runId);
  const taskId = requireOpaqueId(event.taskId);
  const occurredAt = requireCanonicalTimestamp(event.occurredAt);
  if (runId !== activity.runId || taskId !== activity.taskId
    || event.activity !== activity.activity || occurredAt !== activity.occurredAt) fail();
  return Object.freeze({
    eventId: requireOpaqueId(event.eventId), runId, taskId,
    activity: activity.activity as SourceActivity, occurredAt,
  });
}

function requireRecentRun(
  value: unknown,
  synchronizedAt: string,
  observedAt: string,
): Readonly<UnknownRecord> {
  const baseKeys = [
    'runId', 'taskId', 'status', 'outcome', 'claimedAt', 'spawnedAt', 'endedAt',
  ];
  const run = requireClosedObject(value, baseKeys, ['blockReason']);
  const blocked = run.status === 'blocked';
  const claimedAt = requireCanonicalTimestamp(run.claimedAt);
  const spawnedAt = requireCanonicalTimestamp(run.spawnedAt);
  const endedAt = requireCanonicalTimestamp(run.endedAt);
  const completed = run.status === 'completed';
  const blockReason = blocked ? run.blockReason : undefined;
  if ((!blocked && !completed) || run.outcome !== run.status
    || Object.hasOwn(run, 'blockReason') !== blocked
    || (blocked && (typeof blockReason !== 'string'
      || !Object.hasOwn(BLOCK_REASONS, blockReason)))
    || claimedAt < synchronizedAt || claimedAt > spawnedAt
    || spawnedAt > endedAt || endedAt > observedAt) fail();
  return Object.freeze({
    runId: requireOpaqueId(run.runId), taskId: requireOpaqueId(run.taskId),
    status: blocked ? 'blocked' : 'completed',
    outcome: blocked ? 'blocked' : 'completed',
    claimedAt, spawnedAt, endedAt,
    ...(blocked ? { blockReason } : {}),
  });
}

function requireDecisiveEvent(
  value: unknown,
  run: Readonly<UnknownRecord>,
): Readonly<UnknownRecord> {
  const blocked = run.status === 'blocked';
  const completed = run.status === 'completed';
  const event = requireClosedObject(
    value,
    ['eventId', 'runId', 'kind', 'occurredAt', ...(blocked ? ['blockReason'] : [])],
  );
  const occurredAt = requireCanonicalTimestamp(event.occurredAt);
  if (event.runId !== run.runId
    || (blocked
      ? event.kind !== 'blocked' || occurredAt !== run.endedAt
        || event.blockReason !== run.blockReason
      : completed
        ? event.kind !== 'completed' || occurredAt !== run.endedAt
        : event.kind !== 'heartbeat' || occurredAt !== run.heartbeatAt)) fail();
  return Object.freeze({
    eventId: requireOpaqueId(event.eventId), runId: requireOpaqueId(event.runId),
    kind: blocked ? 'blocked' : completed ? 'completed' : 'heartbeat', occurredAt,
    ...(blocked ? { blockReason: event.blockReason as string } : {}),
  });
}

export type HermesPresenceObservation = Readonly<{
  profileName: string;
  mappingRevision: number;
  observedAt: string;
  status: 'available' | 'degraded' | 'unavailable';
  reason: string;
  currentRun: unknown;
  currentActivity?: unknown;
  activityEvent?: unknown;
  recentRun?: unknown;
  decisiveEvent: unknown;
}>;

export function createHermesPresenceObservation(
  mappingInput: unknown,
  requestInput: unknown,
  input: unknown,
): HermesPresenceObservation {
  try {
    if (mappingInput === null || typeof mappingInput !== 'object'
      || !TRUSTED_MAPPINGS.has(mappingInput)
      || requestInput === null || typeof requestInput !== 'object'
      || REQUEST_PROVENANCE.get(requestInput) !== mappingInput) fail();
    const mapping = mappingInput as ReviewedHostedIdentityMapping;
    const request = requestInput as HostedPresenceRequest;
    const object = requireClosedObject(input, [
      'profileName', 'mappingRevision', 'observedAt', 'status', 'reason',
      'currentRun', 'decisiveEvent',
    ], ['recentRun', 'currentActivity', 'activityEvent']);
    const observedAt = requireCanonicalTimestamp(object.observedAt);
    const reason = requireReason(object.reason);
    const status = object.status;
    if (typeof status !== 'string' || !Object.hasOwn(SOURCE_REASONS, status)) fail();
    const sourceStatus = status as keyof typeof SOURCE_REASONS;
    if (object.profileName !== mapping.profileName
      || object.mappingRevision !== mapping.registryRevision
      || observedAt < mapping.synchronizedAt
      || observedAt > request.evaluatedAt
      || SOURCE_REASONS[sourceStatus] !== reason
      || (mapping.status !== 'active' && sourceStatus === 'available')) fail();
    let currentRun: Readonly<UnknownRecord> | null = null;
    let currentActivity: Readonly<UnknownRecord> | undefined;
    let activityEvent: Readonly<UnknownRecord> | undefined;
    let recentRun: Readonly<UnknownRecord> | undefined;
    let decisiveEvent: Readonly<UnknownRecord> | null = null;
    if (Object.hasOwn(object, 'recentRun')) {
      if (sourceStatus !== 'available' || mapping.status !== 'active'
        || object.currentRun !== null || object.recentRun === null) fail();
      recentRun = requireRecentRun(object.recentRun, mapping.synchronizedAt, observedAt);
    }
    if (object.currentRun !== null) {
      if (sourceStatus !== 'available' || recentRun !== undefined
        || object.decisiveEvent === null) fail();
      currentRun = requireCurrentRun(object.currentRun, observedAt);
      decisiveEvent = requireDecisiveEvent(object.decisiveEvent, currentRun);
    } else if (object.decisiveEvent !== null) {
      if (sourceStatus !== 'available' || recentRun === undefined) fail();
      decisiveEvent = requireDecisiveEvent(object.decisiveEvent, recentRun);
    }
    const hasCurrentActivity = Object.hasOwn(object, 'currentActivity');
    const hasActivityEvent = Object.hasOwn(object, 'activityEvent');
    if (hasCurrentActivity !== hasActivityEvent
      || ((hasCurrentActivity || hasActivityEvent) && currentRun === null)) fail();
    if (hasCurrentActivity && hasActivityEvent && currentRun !== null) {
      currentActivity = requireCurrentActivity(object.currentActivity, currentRun);
      activityEvent = requireActivityEvent(object.activityEvent, currentActivity);
    }
    const accepted = Object.freeze({
      profileName: mapping.profileName,
      mappingRevision: mapping.registryRevision,
      observedAt,
      status: sourceStatus,
      reason,
      currentRun,
      ...(currentActivity === undefined ? {} : { currentActivity, activityEvent }),
      ...(recentRun === undefined ? {} : { recentRun }),
      decisiveEvent,
    });
    OBSERVATION_PROVENANCE.set(accepted, { mapping, request });
    return accepted;
  } catch {
    throw new TypeError(GENERIC_ERROR);
  }
}

type DerivedPresenceBase = Readonly<{
  identityId: 'stg-spiders';
  subjectId: string;
  profileName: string;
  observedAt: string;
}>;

export type DerivedHostedAgentPresenceState =
  | (DerivedPresenceBase & Readonly<{
    state: 'working';
    reason: 'heartbeat';
    taskId: string;
    runId: string;
  }>)
  | (DerivedPresenceBase & Readonly<{
    state: 'reviewing';
    reason: 'review_activity';
    taskId: string;
    runId: string;
  }>)
  | (DerivedPresenceBase & Readonly<{
    state: 'researching';
    reason: 'research_activity';
    taskId: string;
    runId: string;
  }>)
  | (DerivedPresenceBase & Readonly<{
    state: 'meeting';
    reason: 'meeting_activity';
    taskId: string;
    runId: string;
  }>)
  | (DerivedPresenceBase & Readonly<{
    state: 'blocked';
    reason: 'run_blocked';
    taskId: string;
    runId: string;
  }>)
  | (DerivedPresenceBase & Readonly<{
    state: 'completed';
    reason: 'run_completed';
    taskId: string;
    runId: string;
  }>)
  | (DerivedPresenceBase & Readonly<{
    state: 'idle' | 'offline' | 'not_derived';
    reason: 'source_available' | 'source_unavailable' | 'heartbeat_delayed';
  }>);

export function deriveHostedAgentPresenceState(
  mappingInput: unknown,
  observationInput: unknown,
): DerivedHostedAgentPresenceState {
  try {
    if (mappingInput === null || typeof mappingInput !== 'object'
      || !TRUSTED_MAPPINGS.has(mappingInput)
      || observationInput === null || typeof observationInput !== 'object'
      || OBSERVATION_PROVENANCE.get(observationInput)?.mapping !== mappingInput) fail();
    const mapping = mappingInput as ReviewedHostedIdentityMapping;
    const observation = observationInput as HermesPresenceObservation;
    if (observation.currentRun !== null) {
      const run = observation.currentRun as Readonly<{ runId: string; taskId: string }>;
      if (observation.currentActivity !== undefined && observation.activityEvent !== undefined) {
        const activity = observation.currentActivity as Readonly<{ activity: SourceActivity }>;
        if (activity.activity === 'meeting') {
          return Object.freeze({
            identityId: mapping.identityId,
            subjectId: mapping.subjectId,
            profileName: mapping.profileName,
            state: 'meeting',
            reason: 'meeting_activity',
            observedAt: observation.observedAt,
            taskId: run.taskId,
            runId: run.runId,
          });
        }
        if (activity.activity === 'researching') {
          return Object.freeze({
            identityId: mapping.identityId,
            subjectId: mapping.subjectId,
            profileName: mapping.profileName,
            state: 'researching',
            reason: 'research_activity',
            observedAt: observation.observedAt,
            taskId: run.taskId,
            runId: run.runId,
          });
        }
        return Object.freeze({
          identityId: mapping.identityId,
          subjectId: mapping.subjectId,
          profileName: mapping.profileName,
          state: 'reviewing',
          reason: 'review_activity',
          observedAt: observation.observedAt,
          taskId: run.taskId,
          runId: run.runId,
        });
      }
      return Object.freeze({
        identityId: mapping.identityId,
        subjectId: mapping.subjectId,
        profileName: mapping.profileName,
        state: 'working',
        reason: 'heartbeat',
        observedAt: observation.observedAt,
        taskId: run.taskId,
        runId: run.runId,
      });
    }
    if (observation.recentRun !== undefined && observation.decisiveEvent !== null) {
      const run = observation.recentRun as Readonly<{
        runId: string;
        taskId: string;
        status: 'blocked' | 'completed';
      }>;
      if (run.status === 'completed') {
        return Object.freeze({
          identityId: mapping.identityId,
          subjectId: mapping.subjectId,
          profileName: mapping.profileName,
          state: 'completed',
          reason: 'run_completed',
          observedAt: observation.observedAt,
          taskId: run.taskId,
          runId: run.runId,
        });
      }
      return Object.freeze({
        identityId: mapping.identityId,
        subjectId: mapping.subjectId,
        profileName: mapping.profileName,
        state: 'blocked',
        reason: 'run_blocked',
        observedAt: observation.observedAt,
        taskId: run.taskId,
        runId: run.runId,
      });
    }
    if (observation.status === 'available') {
      return Object.freeze({
        identityId: mapping.identityId,
        subjectId: mapping.subjectId,
        profileName: mapping.profileName,
        state: 'idle',
        reason: 'source_available',
        observedAt: observation.observedAt,
      });
    }
    if (observation.status === 'unavailable') {
      return Object.freeze({
        identityId: mapping.identityId,
        subjectId: mapping.subjectId,
        profileName: mapping.profileName,
        state: 'offline',
        reason: 'source_unavailable',
        observedAt: observation.observedAt,
      });
    }
    return Object.freeze({
      identityId: mapping.identityId,
      subjectId: mapping.subjectId,
      profileName: mapping.profileName,
      state: 'not_derived',
      reason: 'heartbeat_delayed',
      observedAt: observation.observedAt,
    });
  } catch {
    throw new TypeError(GENERIC_ERROR);
  }
}

function requirePrivateRecord(
  value: unknown,
  mapping: ReviewedHostedIdentityMapping,
  observation: HermesPresenceObservation,
): Readonly<UnknownRecord> {
  const record = requireClosedObject(value, [
    'tenantId', 'subjectId', 'identityId', 'displayName', 'roleLabel',
    'workplaceLabel', 'state', 'freshness', 'reason', 'observedAt', 'recordRef',
  ]);
  const expectedPrefix = `/api/private/tenants/${mapping.tenantId}/records/`;
  if (record.tenantId !== mapping.tenantId || record.subjectId !== mapping.subjectId
    || record.identityId !== mapping.identityId || record.displayName !== mapping.displayName
    || record.roleLabel !== mapping.roleLabel || record.workplaceLabel !== mapping.workplaceLabel
    || record.state !== 'not_derived' || record.freshness !== 'recent'
    || record.reason !== observation.reason || record.observedAt !== observation.observedAt
    || typeof record.recordRef !== 'string' || !record.recordRef.startsWith(expectedPrefix)
    || !OPAQUE_ID.test(record.recordRef.slice(expectedPrefix.length))) fail();
  return Object.freeze({
    tenantId: mapping.tenantId, subjectId: mapping.subjectId,
    identityId: mapping.identityId, displayName: mapping.displayName,
    roleLabel: mapping.roleLabel, workplaceLabel: mapping.workplaceLabel,
    state: 'not_derived', freshness: 'recent', reason: observation.reason,
    observedAt: observation.observedAt, recordRef: record.recordRef,
  });
}

export function createPrivateHostedPresenceResponse(
  mappingInput: unknown,
  observationInput: unknown,
  input: unknown,
): Readonly<UnknownRecord> {
  try {
    if (mappingInput === null || typeof mappingInput !== 'object'
      || !TRUSTED_MAPPINGS.has(mappingInput)) fail();
    const mapping = mappingInput as ReviewedHostedIdentityMapping;
    if (observationInput === null || typeof observationInput !== 'object'
      || OBSERVATION_PROVENANCE.get(observationInput)?.mapping !== mapping) fail();
    const observation = observationInput as HermesPresenceObservation;
    const object = requireClosedObject(input, ['tenantId', 'generatedAt', 'records']);
    const generatedAt = requireCanonicalTimestamp(object.generatedAt);
    if (object.tenantId !== mapping.tenantId || generatedAt < observation.observedAt) fail();
    const records = requireArraySnapshot(object.records, 1).map((record) =>
      requirePrivateRecord(record, mapping, observation));
    return Object.freeze({
      tenantId: mapping.tenantId,
      generatedAt,
      records: Object.freeze(records),
    });
  } catch {
    throw new TypeError(GENERIC_ERROR);
  }
}

export function parseHostedPresenceJson(text: unknown): unknown {
  try {
    if (typeof text !== 'string' || text.length === 0 || text.length > 16_384) fail();
    let cursor = 0;
    let nodes = 0;
    let keys = 0;
    const whitespace = () => {
      while (cursor < text.length && /[\t\n\r ]/.test(text[cursor])) cursor += 1;
    };
    const string = (): string => {
      if (text[cursor] !== '"') fail();
      cursor += 1;
      let result = '';
      while (cursor < text.length) {
        const character = text[cursor++];
        if (character === '"') {
          if (result.length > 1_024) fail();
          return result;
        }
        if (character.charCodeAt(0) < 0x20 || /[\uD800-\uDFFF]/.test(character)) fail();
        if (character !== '\\') { result += character; continue; }
        const escape = text[cursor++];
        const simple: Record<string, string> = {
          '"': '"', '\\': '\\', '/': '/', b: '\b', f: '\f', n: '\n', r: '\r', t: '\t',
        };
        if (Object.hasOwn(simple, escape)) result += simple[escape];
        else if (escape === 'u') {
          const hex = text.slice(cursor, cursor + 4);
          if (!/^[a-fA-F0-9]{4}$/.test(hex)) fail();
          const code = Number.parseInt(hex, 16);
          if (code >= 0xD800 && code <= 0xDFFF) fail();
          result += String.fromCharCode(code);
          cursor += 4;
        } else fail();
      }
      return fail();
    };
    const value = (depth: number): unknown => {
      if (depth > 10 || ++nodes > 256) fail();
      whitespace();
      if (text[cursor] === '"') return string();
      if (text[cursor] === '{') {
        cursor += 1;
        const object: UnknownRecord = {};
        const seen = new Set<string>();
        whitespace();
        if (text[cursor] === '}') { cursor += 1; return Object.freeze(object); }
        while (cursor < text.length) {
          whitespace();
          const key = string();
          if (++keys > 128 || seen.has(key)
            || ['__proto__', 'prototype', 'constructor'].includes(key)) fail();
          seen.add(key);
          whitespace();
          if (text[cursor++] !== ':') fail();
          Object.defineProperty(object, key, {
            value: value(depth + 1), enumerable: true, configurable: false, writable: false,
          });
          whitespace();
          const separator = text[cursor++];
          if (separator === '}') return Object.freeze(object);
          if (separator !== ',') fail();
        }
        return fail();
      }
      if (text[cursor] === '[') {
        cursor += 1;
        const array: unknown[] = [];
        whitespace();
        if (text[cursor] === ']') { cursor += 1; return Object.freeze(array); }
        while (cursor < text.length) {
          if (array.length >= 64) fail();
          array.push(value(depth + 1));
          whitespace();
          const separator = text[cursor++];
          if (separator === ']') return Object.freeze(array);
          if (separator !== ',') fail();
        }
        return fail();
      }
      for (const [literal, parsed] of [['true', true], ['false', false], ['null', null]] as const) {
        if (text.startsWith(literal, cursor)) { cursor += literal.length; return parsed; }
      }
      const number = text.slice(cursor).match(/^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/);
      if (!number) fail();
      cursor += number[0].length;
      const parsed = Number(number[0]);
      if (!Number.isFinite(parsed) || !Number.isSafeInteger(parsed) || Object.is(parsed, -0)) fail();
      return parsed;
    };
    const parsed = value(0);
    whitespace();
    if (cursor !== text.length) fail();
    return parsed;
  } catch {
    throw new TypeError(GENERIC_ERROR);
  }
}
