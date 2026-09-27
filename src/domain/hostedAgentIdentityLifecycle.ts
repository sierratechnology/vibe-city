import {
  createHostedPresenceRequest,
  requireReviewedHostedIdentityMapping,
  type ReviewedHostedIdentityMapping,
} from './hostedAgentPresence';

const GENERIC_ERROR = 'Invalid hosted agent presence input';
const OPAQUE_ID = /^id_[a-f0-9]{16,64}$/;
const PROFILE_NAME = /^[a-z][a-z0-9_-]{0,63}$/;
const reviewedProfileRenameEvents = new WeakSet<object>();
const reviewedWorkplaceReassignmentEvents = new WeakSet<object>();
const reviewedRetirementEvents = new WeakSet<object>();

type UnknownRecord = Record<string, unknown>;

export type HostedIdentityProfileRenameHistory = Readonly<{
  tenantId: string;
  subjectId: string;
  identityId: 'stg-spiders';
  oldProfileName: string;
  newProfileName: string;
  priorRevision: number;
  nextRevision: number;
  occurredAt: string;
  reason: 'profile_renamed';
}>;

export type ReviewedHostedIdentityProfileRenameEvent = Readonly<{
  tenantId: string;
  subjectId: string;
  identityId: 'stg-spiders';
  oldProfileName: string;
  newProfileName: string;
  priorRevision: number;
  nextRevision: number;
  occurredAt: string;
}>;

export type HostedIdentityWorkplaceReassignmentHistory = Readonly<{
  tenantId: string;
  subjectId: string;
  identityId: 'stg-spiders';
  profileName: string;
  oldWorkplaceLabel: ReviewedHostedIdentityMapping['workplaceLabel'];
  newWorkplaceLabel: ReviewedHostedIdentityMapping['workplaceLabel'];
  priorRevision: number;
  nextRevision: number;
  occurredAt: string;
  reason: 'workplace_reassigned';
}>;

export type ReviewedHostedIdentityWorkplaceReassignmentEvent = Readonly<{
  tenantId: string;
  subjectId: string;
  identityId: 'stg-spiders';
  profileName: string;
  oldWorkplaceLabel: ReviewedHostedIdentityMapping['workplaceLabel'];
  newWorkplaceLabel: ReviewedHostedIdentityMapping['workplaceLabel'];
  priorRevision: number;
  nextRevision: number;
  occurredAt: string;
}>;

export type HostedIdentityRetirementHistory = Readonly<{
  tenantId: string;
  subjectId: string;
  identityId: 'stg-spiders';
  profileName: string;
  priorRevision: number;
  nextRevision: number;
  occurredAt: string;
  priorStatus: 'active';
  nextStatus: 'retired';
  reason: 'identity_retired';
}>;

export type ReviewedHostedIdentityRetirementEvent = Readonly<{
  tenantId: string;
  subjectId: string;
  identityId: 'stg-spiders';
  profileName: string;
  priorRevision: number;
  nextRevision: number;
  occurredAt: string;
}>;

function fail(): never {
  throw new TypeError(GENERIC_ERROR);
}

function requireTrustedMapping(value: unknown): ReviewedHostedIdentityMapping {
  const mapping = requireReviewedHostedIdentityMapping(value);
  createHostedPresenceRequest(mapping, {
    boardScope: 'default',
    profileName: mapping.profileName,
    mappingRevision: mapping.registryRevision,
    evaluatedAt: mapping.synchronizedAt,
  });
  return mapping;
}

function requireClosedEvent(value: unknown, reviewedEvents: WeakSet<object>): UnknownRecord {
  if (value === null || typeof value !== 'object' || !reviewedEvents.has(value)) fail();
  return value as UnknownRecord;
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function requireCanonicalTimestamp(value: unknown): string {
  if (typeof value !== 'string') fail();
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== value) fail();
  return value;
}

function timestampEpoch(value: string): number {
  return new Date(value).getTime();
}

export function createHostedIdentityProfileRenameEvent(
  tenantId: unknown,
  subjectId: unknown,
  identityId: unknown,
  oldProfileName: unknown,
  newProfileName: unknown,
  priorRevision: unknown,
  nextRevision: unknown,
  occurredAtInput: unknown,
): ReviewedHostedIdentityProfileRenameEvent {
  try {
    if (typeof tenantId !== 'string' || typeof subjectId !== 'string'
      || identityId !== 'stg-spiders' || typeof oldProfileName !== 'string'
      || typeof newProfileName !== 'string'
      || !Number.isSafeInteger(priorRevision) || !Number.isSafeInteger(nextRevision)
      || (priorRevision as number) <= 0 || (nextRevision as number) <= 0) fail();
    const occurredAt = requireCanonicalTimestamp(occurredAtInput);
    const event = Object.freeze({
      tenantId,
      subjectId,
      identityId,
      oldProfileName,
      newProfileName,
      priorRevision: priorRevision as number,
      nextRevision: nextRevision as number,
      occurredAt,
    });
    reviewedProfileRenameEvents.add(event);
    return event;
  } catch {
    throw new TypeError(GENERIC_ERROR);
  }
}

export function createHostedIdentityWorkplaceReassignmentEvent(
  tenantId: unknown,
  subjectId: unknown,
  identityId: unknown,
  profileName: unknown,
  oldWorkplaceLabel: unknown,
  newWorkplaceLabel: unknown,
  priorRevision: unknown,
  nextRevision: unknown,
  occurredAtInput: unknown,
): ReviewedHostedIdentityWorkplaceReassignmentEvent {
  try {
    if (typeof tenantId !== 'string' || typeof subjectId !== 'string'
      || identityId !== 'stg-spiders' || typeof profileName !== 'string'
      || (oldWorkplaceLabel !== 'Chief Agent Office' && oldWorkplaceLabel !== 'Executive Office')
      || (newWorkplaceLabel !== 'Chief Agent Office' && newWorkplaceLabel !== 'Executive Office')
      || !Number.isSafeInteger(priorRevision) || !Number.isSafeInteger(nextRevision)
      || (priorRevision as number) <= 0 || (nextRevision as number) <= 0) fail();
    const occurredAt = requireCanonicalTimestamp(occurredAtInput);
    const event = Object.freeze({
      tenantId,
      subjectId,
      identityId,
      profileName,
      oldWorkplaceLabel,
      newWorkplaceLabel,
      priorRevision: priorRevision as number,
      nextRevision: nextRevision as number,
      occurredAt,
    });
    reviewedWorkplaceReassignmentEvents.add(event);
    return event;
  } catch {
    throw new TypeError(GENERIC_ERROR);
  }
}

export function createHostedIdentityRetirementEvent(
  tenantId: unknown,
  subjectId: unknown,
  identityId: unknown,
  profileName: unknown,
  priorRevision: unknown,
  nextRevision: unknown,
  occurredAtInput: unknown,
): ReviewedHostedIdentityRetirementEvent {
  try {
    if (typeof tenantId !== 'string' || !OPAQUE_ID.test(tenantId)
      || typeof subjectId !== 'string' || !OPAQUE_ID.test(subjectId)
      || identityId !== 'stg-spiders'
      || typeof profileName !== 'string' || !PROFILE_NAME.test(profileName)
      || !Number.isSafeInteger(priorRevision) || (priorRevision as number) <= 0
      || Object.is(priorRevision, -0)
      || !Number.isSafeInteger(nextRevision) || (nextRevision as number) <= 0
      || Object.is(nextRevision, -0)) fail();
    const occurredAt = requireCanonicalTimestamp(occurredAtInput);
    const event = Object.freeze({
      tenantId,
      subjectId,
      identityId,
      profileName,
      priorRevision: priorRevision as number,
      nextRevision: nextRevision as number,
      occurredAt,
    });
    reviewedRetirementEvents.add(event);
    return event;
  } catch {
    throw new TypeError(GENERIC_ERROR);
  }
}

export function createHostedIdentityRetirementHistory(
  beforeInput: unknown,
  afterInput: unknown,
  eventInput: unknown,
): HostedIdentityRetirementHistory {
  try {
    const before = requireTrustedMapping(beforeInput);
    const after = requireTrustedMapping(afterInput);
    const event = requireClosedEvent(eventInput, reviewedRetirementEvents);
    if (before.status !== 'active' || after.status !== 'retired'
      || after.registryRevision !== before.registryRevision + 1
      || timestampEpoch(after.synchronizedAt) <= timestampEpoch(before.synchronizedAt)
      || before.tenantId !== after.tenantId
      || before.subjectId !== after.subjectId
      || before.identityId !== after.identityId
      || before.displayName !== after.displayName
      || before.profileName !== after.profileName
      || before.roleLabel !== after.roleLabel
      || before.workplaceLabel !== after.workplaceLabel
      || !sameStrings(before.skills, after.skills)
      || !sameStrings(before.permissions, after.permissions)
      || !sameStrings(before.actionAuthorities, after.actionAuthorities)) fail();
    const occurredAt = requireCanonicalTimestamp(event.occurredAt);
    if (event.tenantId !== before.tenantId
      || event.subjectId !== before.subjectId
      || event.identityId !== before.identityId
      || event.profileName !== before.profileName
      || event.priorRevision !== before.registryRevision
      || event.nextRevision !== after.registryRevision
      || timestampEpoch(occurredAt) < timestampEpoch(before.synchronizedAt)
      || timestampEpoch(occurredAt) > timestampEpoch(after.synchronizedAt)) fail();
    return Object.freeze({
      tenantId: before.tenantId,
      subjectId: before.subjectId,
      identityId: before.identityId,
      profileName: before.profileName,
      priorRevision: before.registryRevision,
      nextRevision: after.registryRevision,
      occurredAt,
      priorStatus: 'active',
      nextStatus: 'retired',
      reason: 'identity_retired',
    });
  } catch {
    throw new TypeError(GENERIC_ERROR);
  }
}

export function createHostedIdentityProfileRenameHistory(
  beforeInput: unknown,
  afterInput: unknown,
  eventInput: unknown,
): HostedIdentityProfileRenameHistory {
  try {
    const before = requireTrustedMapping(beforeInput);
    const after = requireTrustedMapping(afterInput);
    const event = requireClosedEvent(eventInput, reviewedProfileRenameEvents);
    if (before.status !== 'active' || after.status !== 'active'
      || before.profileName === after.profileName
      || after.registryRevision !== before.registryRevision + 1
      || timestampEpoch(after.synchronizedAt) <= timestampEpoch(before.synchronizedAt)
      || before.tenantId !== after.tenantId
      || before.subjectId !== after.subjectId
      || before.identityId !== after.identityId
      || before.displayName !== after.displayName
      || before.roleLabel !== after.roleLabel
      || before.workplaceLabel !== after.workplaceLabel
      || !sameStrings(before.skills, after.skills)
      || !sameStrings(before.permissions, after.permissions)
      || !sameStrings(before.actionAuthorities, after.actionAuthorities)) fail();
    const occurredAt = requireCanonicalTimestamp(event.occurredAt);
    if (event.tenantId !== before.tenantId
      || event.subjectId !== before.subjectId
      || event.identityId !== before.identityId
      || event.oldProfileName !== before.profileName
      || event.newProfileName !== after.profileName
      || event.priorRevision !== before.registryRevision
      || event.nextRevision !== after.registryRevision
      || timestampEpoch(occurredAt) < timestampEpoch(before.synchronizedAt)
      || timestampEpoch(occurredAt) > timestampEpoch(after.synchronizedAt)) fail();
    return Object.freeze({
      tenantId: before.tenantId,
      subjectId: before.subjectId,
      identityId: before.identityId,
      oldProfileName: before.profileName,
      newProfileName: after.profileName,
      priorRevision: before.registryRevision,
      nextRevision: after.registryRevision,
      occurredAt,
      reason: 'profile_renamed',
    });
  } catch {
    throw new TypeError(GENERIC_ERROR);
  }
}

export function createHostedIdentityWorkplaceReassignmentHistory(
  beforeInput: unknown,
  afterInput: unknown,
  eventInput: unknown,
): HostedIdentityWorkplaceReassignmentHistory {
  try {
    const before = requireTrustedMapping(beforeInput);
    const after = requireTrustedMapping(afterInput);
    const event = requireClosedEvent(eventInput, reviewedWorkplaceReassignmentEvents);
    if (before.status !== 'active' || after.status !== 'active'
      || before.workplaceLabel === after.workplaceLabel
      || after.registryRevision !== before.registryRevision + 1
      || timestampEpoch(after.synchronizedAt) <= timestampEpoch(before.synchronizedAt)
      || before.tenantId !== after.tenantId
      || before.subjectId !== after.subjectId
      || before.identityId !== after.identityId
      || before.displayName !== after.displayName
      || before.profileName !== after.profileName
      || before.roleLabel !== after.roleLabel
      || !sameStrings(before.skills, after.skills)
      || !sameStrings(before.permissions, after.permissions)
      || !sameStrings(before.actionAuthorities, after.actionAuthorities)) fail();
    const occurredAt = requireCanonicalTimestamp(event.occurredAt);
    if (event.tenantId !== before.tenantId
      || event.subjectId !== before.subjectId
      || event.identityId !== before.identityId
      || event.profileName !== before.profileName
      || event.oldWorkplaceLabel !== before.workplaceLabel
      || event.newWorkplaceLabel !== after.workplaceLabel
      || event.priorRevision !== before.registryRevision
      || event.nextRevision !== after.registryRevision
      || timestampEpoch(occurredAt) < timestampEpoch(before.synchronizedAt)
      || timestampEpoch(occurredAt) > timestampEpoch(after.synchronizedAt)) fail();
    return Object.freeze({
      tenantId: before.tenantId,
      subjectId: before.subjectId,
      identityId: before.identityId,
      profileName: before.profileName,
      oldWorkplaceLabel: before.workplaceLabel,
      newWorkplaceLabel: after.workplaceLabel,
      priorRevision: before.registryRevision,
      nextRevision: after.registryRevision,
      occurredAt,
      reason: 'workplace_reassigned',
    });
  } catch {
    throw new TypeError(GENERIC_ERROR);
  }
}
