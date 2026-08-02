import { isProxy } from "node:util/types";

const DateIntrinsic = Date;
const arrayIsArray = Array.isArray;
const dateParse = Date.parse.bind(Date);
const dateToISOString = Function.call.bind(Date.prototype.toISOString);
const numberIsFinite = Number.isFinite;
const numberIsSafeInteger = Number.isSafeInteger;
const objectCreate = Object.create;
const objectDefineProperty = Object.defineProperty;
const objectFreeze = Object.freeze;
const objectGetOwnPropertyDescriptors = Object.getOwnPropertyDescriptors;
const objectGetPrototypeOf = Object.getPrototypeOf;
const objectIs = Object.is;
const reflectOwnKeys = Reflect.ownKeys;
const regexpTest = Function.call.bind(RegExp.prototype.test);
const stringSlice = Function.call.bind(String.prototype.slice);

const DENIED = objectFreeze({ ok: false, code: "not_found" });
const ACTION = "enter_private_meeting_temporarily";
const TENANT = /^syn-tenant-[a-z0-9]+(?:-[a-z0-9]+)*$/;
const REFERENCE = /^syn-[a-z0-9]+(?:-[a-z0-9]+)*--[a-z0-9]+(?:-[a-z0-9]+)*$/;
const CANONICAL_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const OPTIONS_KEYS = objectFreeze(["repository", "now", "evaluatePolicy"]);
const CONTEXT_KEYS = objectFreeze([
  "kind", "authenticatedSubjectId", "authenticatedSessionId", "activeTenantMembership",
  "actionGrants", "authorizationReference", "policyRevision"
]);
const MEMBERSHIP_KEYS = objectFreeze(["tenantId", "subjectId", "active"]);
const SCOPE_KEYS = objectFreeze(["tenantId", "invitationId"]);
const DECISION_KEYS = objectFreeze([
  "allowed", "accessKind", "privacy", "tenantId", "invitationId", "subjectId",
  "purposeReference", "materialReferences", "invitationRevision", "policyRevision",
  "authorizationReference", "evaluatedAt", "validUntil", "grantsPermanentMembership",
  "grantsOccupancy"
]);

function sameKeys(keys, expected) {
  if (keys.length !== expected.length) return false;
  for (let index = 0; index < expected.length; index += 1) {
    let found = false;
    for (let candidate = 0; candidate < keys.length; candidate += 1) {
      if (keys[candidate] === expected[index]) found = true;
    }
    if (!found) return false;
  }
  return true;
}

function snapshotObject(value, expected) {
  if (value === null || typeof value !== "object" || isProxy(value)) return null;
  const prototype = objectGetPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return null;
  const descriptors = objectGetOwnPropertyDescriptors(value);
  const keys = reflectOwnKeys(value);
  if (!sameKeys(keys, expected)) return null;
  const copy = objectCreate(null);
  for (let index = 0; index < expected.length; index += 1) {
    const key = expected[index];
    const descriptor = descriptors[key];
    if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) return null;
    objectDefineProperty(copy, key, {
      configurable: true, enumerable: true, value: descriptor.value, writable: true
    });
  }
  return copy;
}

function snapshotArray(value, maximum = 32) {
  if (!arrayIsArray(value) || isProxy(value) || value.length < 1 || value.length > maximum) return null;
  const descriptors = objectGetOwnPropertyDescriptors(value);
  const keys = reflectOwnKeys(value);
  if (keys.length !== value.length + 1 || keys[keys.length - 1] !== "length") return null;
  const copy = [];
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = descriptors[String(index)];
    if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) return null;
    copy.push(descriptor.value);
  }
  return copy;
}

function isTenant(value) {
  return typeof value === "string" && value.length <= 128 && regexpTest(TENANT, value);
}

function isScopedReference(value, tenantId) {
  return typeof value === "string" && value.length <= 128 && regexpTest(REFERENCE, value) &&
    stringSlice(value, 0, tenantId.length + 2) === `${tenantId}--`;
}

function isCanonicalUtc(value) {
  if (typeof value !== "string" || !regexpTest(CANONICAL_UTC, value)) return false;
  const milliseconds = dateParse(value);
  return numberIsFinite(milliseconds) && dateToISOString(new DateIntrinsic(milliseconds)) === value;
}

function snapshotContext(value) {
  const context = snapshotObject(value, CONTEXT_KEYS);
  if (!context) return null;
  const membership = snapshotObject(context.activeTenantMembership, MEMBERSHIP_KEYS);
  const grants = snapshotArray(context.actionGrants, 1);
  if (!membership || !grants || context.kind !== "trusted-server-context" ||
      membership.active !== true || context.authenticatedSubjectId !== membership.subjectId ||
      membership.tenantId === undefined || grants[0] !== ACTION ||
      !isTenant(membership.tenantId) || !isScopedReference(context.authenticatedSubjectId, membership.tenantId) ||
      !isScopedReference(context.authenticatedSessionId, membership.tenantId) ||
      !isScopedReference(context.authorizationReference, membership.tenantId) ||
      !numberIsSafeInteger(context.policyRevision) || objectIs(context.policyRevision, -0) ||
      context.policyRevision < 1) return null;
  context.activeTenantMembership = membership;
  context.actionGrants = grants;
  return context;
}

function frozenDecision(value) {
  value.materialReferences = objectFreeze([...value.materialReferences]);
  return objectFreeze(value);
}

function repositoryReadContext(context) {
  return objectFreeze({
    kind: context.kind,
    authenticatedSubjectId: context.authenticatedSubjectId,
    authenticatedSessionId: context.authenticatedSessionId,
    activeTenantMembership: objectFreeze({
      tenantId: context.activeTenantMembership.tenantId,
      subjectId: context.activeTenantMembership.subjectId,
      active: true
    }),
    actionGrants: objectFreeze(["read_private_meeting_invitation"]),
    authorizationReference: context.authorizationReference,
    policyRevision: context.policyRevision
  });
}

function isSameAcceptedInvitation(current, prior) {
  if (current.lifecycle !== "accepted" || current.tenantId !== prior.tenantId ||
      current.invitationId !== prior.invitationId || current.revision !== prior.revision ||
      current.issuerSubjectId !== prior.issuerSubjectId ||
      current.intendedRecipientSubjectId !== prior.intendedRecipientSubjectId ||
      current.purposeReference !== prior.purposeReference || current.validFrom !== prior.validFrom ||
      current.expiresAt !== prior.expiresAt ||
      current.revocationAuthoritySubjectId !== prior.revocationAuthoritySubjectId ||
      current.issuedAt !== prior.issuedAt || current.sourceReference !== prior.sourceReference ||
      current.issueAuthorizationReference !== prior.issueAuthorizationReference ||
      current.issuePolicyRevision !== prior.issuePolicyRevision ||
      current.acceptedAt !== prior.acceptedAt || current.acceptedBySubjectId !== prior.acceptedBySubjectId ||
      current.acceptAuthorizationReference !== prior.acceptAuthorizationReference ||
      current.acceptPolicyRevision !== prior.acceptPolicyRevision ||
      current.revokedAt !== null || current.revokedBySubjectId !== null ||
      current.revokeAuthorizationReference !== null || current.revokePolicyRevision !== null ||
      current.grantsAccess !== false || current.grantsOccupancy !== false ||
      current.grantsPermanentMembership !== false ||
      current.materialReferences.length !== prior.materialReferences.length) return false;
  for (let index = 0; index < current.materialReferences.length; index += 1) {
    if (current.materialReferences[index] !== prior.materialReferences[index]) return false;
  }
  return true;
}

function createPrivateMeetingTemporaryAccessEvaluator(options) {
  options = snapshotObject(options, OPTIONS_KEYS);
  if (!options || !options.repository || typeof options.repository.readInvitation !== "function" ||
      typeof options.now !== "function" || typeof options.evaluatePolicy !== "function") {
    throw new TypeError("temporary access unavailable");
  }

  function evaluateTemporaryAccess(rawContext, rawScope) {
    try {
      const context = snapshotContext(rawContext);
      const scope = snapshotObject(rawScope, SCOPE_KEYS);
      if (!context || !scope || scope.tenantId !== context.activeTenantMembership.tenantId ||
          !isScopedReference(scope.invitationId, scope.tenantId)) return DENIED;
      const evaluatedAt = options.now();
      if (!isCanonicalUtc(evaluatedAt)) return DENIED;
      const read = options.repository.readInvitation(repositoryReadContext(context), scope);
      if (!read || read.ok !== true) return DENIED;
      const invitation = read.invitation;
      if (invitation.lifecycle !== "accepted" || invitation.revision < 2 ||
          invitation.intendedRecipientSubjectId !== context.authenticatedSubjectId ||
          dateParse(evaluatedAt) < dateParse(invitation.validFrom) ||
          dateParse(evaluatedAt) >= dateParse(invitation.expiresAt)) return DENIED;
      const facts = objectFreeze({
        action: ACTION,
        tenantId: scope.tenantId,
        invitationId: scope.invitationId,
        subjectId: context.authenticatedSubjectId,
        invitationRevision: invitation.revision,
        policyRevision: context.policyRevision,
        authorizationReference: context.authorizationReference,
        evaluatedAt
      });
      if (options.evaluatePolicy(facts) !== true) return DENIED;
      const currentRead = options.repository.readInvitation(repositoryReadContext(context), scope);
      if (!currentRead || currentRead.ok !== true ||
          !isSameAcceptedInvitation(currentRead.invitation, invitation) ||
          dateParse(evaluatedAt) < dateParse(currentRead.invitation.validFrom) ||
          dateParse(evaluatedAt) >= dateParse(currentRead.invitation.expiresAt)) return DENIED;
      const currentInvitation = currentRead.invitation;
      const decision = frozenDecision({
        allowed: true,
        accessKind: "temporary-private-meeting",
        privacy: "tenant-private",
        tenantId: scope.tenantId,
        invitationId: scope.invitationId,
        subjectId: context.authenticatedSubjectId,
        purposeReference: currentInvitation.purposeReference,
        materialReferences: currentInvitation.materialReferences,
        invitationRevision: currentInvitation.revision,
        policyRevision: context.policyRevision,
        authorizationReference: context.authorizationReference,
        evaluatedAt,
        validUntil: currentInvitation.expiresAt,
        grantsPermanentMembership: false,
        grantsOccupancy: false
      });
      return objectFreeze({ ok: true, decision });
    } catch { return DENIED; }
  }

  return objectFreeze({
    evaluateTemporaryAccess,
    validateTemporaryAccessDecision(context, decision) {
      try {
        const snapshot = snapshotObject(decision, DECISION_KEYS);
        if (!snapshot || snapshot.allowed !== true || snapshot.accessKind !== "temporary-private-meeting" ||
            snapshot.privacy !== "tenant-private") return DENIED;
        snapshot.materialReferences = snapshotArray(snapshot.materialReferences);
        if (!snapshot.materialReferences) return DENIED;
        const current = evaluateTemporaryAccess(context, {
          tenantId: snapshot.tenantId,
          invitationId: snapshot.invitationId
        });
        if (current.ok !== true) return DENIED;
        const fresh = current.decision;
        for (let index = 0; index < DECISION_KEYS.length; index += 1) {
          const key = DECISION_KEYS[index];
          if (key === "materialReferences") continue;
          if (!objectIs(snapshot[key], fresh[key])) return DENIED;
        }
        if (snapshot.materialReferences.length !== fresh.materialReferences.length) return DENIED;
        for (let index = 0; index < snapshot.materialReferences.length; index += 1) {
          if (snapshot.materialReferences[index] !== fresh.materialReferences[index]) return DENIED;
        }
        return objectFreeze({ ok: true, decision: fresh });
      } catch { return DENIED; }
    }
  });
}

export { createPrivateMeetingTemporaryAccessEvaluator };
