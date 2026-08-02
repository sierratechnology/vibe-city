import { chmodSync, closeSync, openSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { isProxy } from "node:util/types";

const DateIntrinsic = Date;
const arrayIsArray = Array.isArray;
const dateParse = Date.parse.bind(Date);
const dateToISOString = Function.call.bind(Date.prototype.toISOString);
const jsonParse = JSON.parse.bind(JSON);
const jsonStringify = JSON.stringify.bind(JSON);
const numberIsFinite = Number.isFinite;
const numberIsSafeInteger = Number.isSafeInteger;
const objectAssign = Object.assign;
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
const TENANT = /^syn-tenant-[a-z0-9]+(?:-[a-z0-9]+)*$/;
const REFERENCE = /^syn-[a-z0-9]+(?:-[a-z0-9]+)*--[a-z0-9]+(?:-[a-z0-9]+)*$/;
const CANONICAL_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const ACTIONS = objectFreeze({
  issue: "issue_private_meeting_invitation",
  read: "read_private_meeting_invitation",
  accept: "accept_private_meeting_invitation",
  revoke: "revoke_private_meeting_invitation",
  audit: "read_private_meeting_invitation_audit"
});
const CONTEXT_KEYS = objectFreeze([
  "kind", "authenticatedSubjectId", "authenticatedSessionId", "activeTenantMembership",
  "actionGrants", "authorizationReference", "policyRevision"
]);
const MEMBERSHIP_KEYS = objectFreeze(["tenantId", "subjectId", "active"]);
const ISSUE_KEYS = objectFreeze([
  "tenantId", "invitationId", "intendedRecipientSubjectId", "purposeReference",
  "materialReferences", "validFrom", "expiresAt", "revocationAuthoritySubjectId",
  "issuedAt", "sourceReference", "expectedRevision"
]);
const SCOPE_KEYS = objectFreeze(["tenantId", "invitationId"]);
const ACCEPT_KEYS = objectFreeze(["tenantId", "invitationId", "acceptedAt", "expectedRevision"]);
const REVOKE_KEYS = objectFreeze(["tenantId", "invitationId", "revokedAt", "expectedRevision"]);
const OPTIONS_KEYS = objectFreeze(["now"]);
const INVITATION_KEYS = objectFreeze([
  "privacy", "tenantId", "invitationId", "revision", "lifecycle", "issuerSubjectId",
  "intendedRecipientSubjectId", "purposeReference", "materialReferences", "validFrom",
  "expiresAt", "revocationAuthoritySubjectId", "issuedAt", "sourceReference",
  "issueAuthorizationReference", "issuePolicyRevision", "acceptedAt", "acceptedBySubjectId",
  "acceptAuthorizationReference", "acceptPolicyRevision", "revokedAt", "revokedBySubjectId",
  "revokeAuthorizationReference", "revokePolicyRevision", "grantsAccess", "grantsOccupancy",
  "grantsPermanentMembership"
]);
const EVENT_KEYS = objectFreeze([
  "privacy", "tenantId", "invitationId", "eventId", "eventKind", "priorRevision",
  "newRevision", "occurredAt", "actorSubjectId", "authorizationReference", "policyRevision"
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

function snapshotObject(value, expectedKeys) {
  if (value === null || typeof value !== "object" || isProxy(value)) return null;
  const prototype = objectGetPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return null;
  const descriptors = objectGetOwnPropertyDescriptors(value);
  const keys = reflectOwnKeys(value);
  if (!sameKeys(keys, expectedKeys)) return null;
  const copy = objectCreate(null);
  for (let index = 0; index < expectedKeys.length; index += 1) {
    const key = expectedKeys[index];
    const descriptor = descriptors[key];
    if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) return null;
    objectDefineProperty(copy, key, {
      configurable: true, enumerable: true, value: descriptor.value, writable: true
    });
  }
  const after = objectGetOwnPropertyDescriptors(value);
  const afterKeys = reflectOwnKeys(value);
  if (!sameKeys(afterKeys, expectedKeys) || objectGetPrototypeOf(value) !== prototype) return null;
  for (let index = 0; index < expectedKeys.length; index += 1) {
    const key = expectedKeys[index];
    if (!after[key] || !("value" in after[key]) || !objectIs(after[key].value, descriptors[key].value)) return null;
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
    const key = String(index);
    const descriptor = descriptors[key];
    if (keys[index] !== key || !descriptor || !("value" in descriptor) || !descriptor.enumerable) return null;
    objectDefineProperty(copy, key, {
      configurable: true, enumerable: true, value: descriptor.value, writable: true
    });
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

function isOrderedUniqueReferences(values, tenantId) {
  if (!values) return false;
  for (let index = 0; index < values.length; index += 1) {
    if (!isScopedReference(values[index], tenantId)) return false;
    for (let prior = 0; prior < index; prior += 1) {
      if (values[prior] === values[index]) return false;
    }
  }
  return true;
}

function snapshotContext(value) {
  const context = snapshotObject(value, CONTEXT_KEYS);
  if (!context) return null;
  const membership = snapshotObject(context.activeTenantMembership, MEMBERSHIP_KEYS);
  const grants = snapshotArray(context.actionGrants, 1);
  if (!membership || !grants) return null;
  context.activeTenantMembership = membership;
  context.actionGrants = grants;
  return context;
}

function authorize(context, tenantId, action) {
  const membership = context.activeTenantMembership;
  if (context.kind !== "trusted-server-context" || membership.active !== true ||
      !isTenant(tenantId) || membership.tenantId !== tenantId ||
      context.authenticatedSubjectId !== membership.subjectId ||
      !isScopedReference(context.authenticatedSubjectId, tenantId) ||
      !isScopedReference(context.authenticatedSessionId, tenantId) ||
      context.actionGrants.length !== 1 || context.actionGrants[0] !== action ||
      !isScopedReference(context.authorizationReference, tenantId) ||
      !numberIsSafeInteger(context.policyRevision) || objectIs(context.policyRevision, -0) ||
      context.policyRevision < 1) return null;
  return objectFreeze({
    actorSubjectId: context.authenticatedSubjectId,
    authorizationReference: context.authorizationReference,
    policyRevision: context.policyRevision
  });
}

function detachedFrozen(value) {
  if (arrayIsArray(value)) {
    const copy = [];
    for (let index = 0; index < value.length; index += 1) {
      objectDefineProperty(copy, String(index), {
        configurable: false,
        enumerable: true,
        value: detachedFrozen(value[index]),
        writable: false
      });
    }
    return objectFreeze(copy);
  }
  if (value !== null && typeof value === "object") {
    const copy = objectCreate(null);
    const keys = reflectOwnKeys(value);
    for (let index = 0; index < keys.length; index += 1) {
      const key = keys[index];
      objectDefineProperty(copy, key, {
        configurable: false, enumerable: true, value: detachedFrozen(value[key]), writable: false
      });
    }
    return objectFreeze(copy);
  }
  return value;
}

function issuedRecord(input, authority) {
  return {
    privacy: "tenant-private",
    tenantId: input.tenantId,
    invitationId: input.invitationId,
    revision: 1,
    lifecycle: "issued",
    issuerSubjectId: authority.actorSubjectId,
    intendedRecipientSubjectId: input.intendedRecipientSubjectId,
    purposeReference: input.purposeReference,
    materialReferences: input.materialReferences,
    validFrom: input.validFrom,
    expiresAt: input.expiresAt,
    revocationAuthoritySubjectId: input.revocationAuthoritySubjectId,
    issuedAt: input.issuedAt,
    sourceReference: input.sourceReference,
    issueAuthorizationReference: authority.authorizationReference,
    issuePolicyRevision: authority.policyRevision,
    acceptedAt: null,
    acceptedBySubjectId: null,
    acceptAuthorizationReference: null,
    acceptPolicyRevision: null,
    revokedAt: null,
    revokedBySubjectId: null,
    revokeAuthorizationReference: null,
    revokePolicyRevision: null,
    grantsAccess: false,
    grantsOccupancy: false,
    grantsPermanentMembership: false
  };
}

function issuedEvent(record) {
  return {
    privacy: "tenant-private",
    tenantId: record.tenantId,
    invitationId: record.invitationId,
    eventId: record.sourceReference,
    eventKind: "private_meeting_invitation_issued",
    priorRevision: 0,
    newRevision: 1,
    occurredAt: record.issuedAt,
    actorSubjectId: record.issuerSubjectId,
    authorizationReference: record.issueAuthorizationReference,
    policyRevision: record.issuePolicyRevision
  };
}

function acceptedRecord(record, input, authority) {
  return {
    ...record,
    revision: 2,
    lifecycle: "accepted",
    acceptedAt: input.acceptedAt,
    acceptedBySubjectId: authority.actorSubjectId,
    acceptAuthorizationReference: authority.authorizationReference,
    acceptPolicyRevision: authority.policyRevision
  };
}

function acceptedEvent(record) {
  return {
    privacy: "tenant-private",
    tenantId: record.tenantId,
    invitationId: record.invitationId,
    eventId: `${record.invitationId}-accepted`,
    eventKind: "private_meeting_invitation_accepted",
    priorRevision: 1,
    newRevision: 2,
    occurredAt: record.acceptedAt,
    actorSubjectId: record.acceptedBySubjectId,
    authorizationReference: record.acceptAuthorizationReference,
    policyRevision: record.acceptPolicyRevision
  };
}

function revokedRecord(record, input, authority) {
  return {
    ...record,
    revision: record.revision + 1,
    lifecycle: "revoked",
    revokedAt: input.revokedAt,
    revokedBySubjectId: authority.actorSubjectId,
    revokeAuthorizationReference: authority.authorizationReference,
    revokePolicyRevision: authority.policyRevision
  };
}

function revokedEvent(record) {
  return {
    privacy: "tenant-private",
    tenantId: record.tenantId,
    invitationId: record.invitationId,
    eventId: `${record.invitationId}-revoked`,
    eventKind: "private_meeting_invitation_revoked",
    priorRevision: record.revision - 1,
    newRevision: record.revision,
    occurredAt: record.revokedAt,
    actorSubjectId: record.revokedBySubjectId,
    authorizationReference: record.revokeAuthorizationReference,
    policyRevision: record.revokePolicyRevision
  };
}

function validateStoredInvitation(row) {
  if (!row || typeof row.invitation_json !== "string") return null;
  const parsed = jsonParse(row.invitation_json);
  if (jsonStringify(parsed) !== row.invitation_json) return null;
  const invitation = snapshotObject(parsed, INVITATION_KEYS);
  if (!invitation || invitation.tenantId !== row.tenant_id || invitation.invitationId !== row.invitation_id ||
      invitation.revision !== row.revision || invitation.privacy !== "tenant-private" ||
      !isTenant(invitation.tenantId) || !isScopedReference(invitation.invitationId, invitation.tenantId) ||
      !isScopedReference(invitation.issuerSubjectId, invitation.tenantId) ||
      !isScopedReference(invitation.intendedRecipientSubjectId, invitation.tenantId) ||
      !isScopedReference(invitation.purposeReference, invitation.tenantId) ||
      !isScopedReference(invitation.revocationAuthoritySubjectId, invitation.tenantId) ||
      !isCanonicalUtc(invitation.issuedAt) || !isCanonicalUtc(invitation.validFrom) ||
      !isCanonicalUtc(invitation.expiresAt) ||
      dateParse(invitation.issuedAt) > dateParse(invitation.validFrom) ||
      dateParse(invitation.validFrom) >= dateParse(invitation.expiresAt) ||
      !isScopedReference(invitation.sourceReference, invitation.tenantId) ||
      !isScopedReference(invitation.issueAuthorizationReference, invitation.tenantId) ||
      !numberIsSafeInteger(invitation.issuePolicyRevision) || invitation.issuePolicyRevision < 1 ||
      invitation.grantsAccess !== false || invitation.grantsOccupancy !== false ||
      invitation.grantsPermanentMembership !== false) return null;
  invitation.materialReferences = snapshotArray(invitation.materialReferences);
  if (!isOrderedUniqueReferences(invitation.materialReferences, invitation.tenantId)) return null;
  const accepted = invitation.acceptedAt !== null || invitation.acceptedBySubjectId !== null ||
    invitation.acceptAuthorizationReference !== null || invitation.acceptPolicyRevision !== null;
  const revoked = invitation.revokedAt !== null || invitation.revokedBySubjectId !== null ||
    invitation.revokeAuthorizationReference !== null || invitation.revokePolicyRevision !== null;
  if (accepted && (!isCanonicalUtc(invitation.acceptedAt) ||
      dateParse(invitation.acceptedAt) < dateParse(invitation.validFrom) ||
      dateParse(invitation.acceptedAt) >= dateParse(invitation.expiresAt) ||
      invitation.acceptedBySubjectId !== invitation.intendedRecipientSubjectId ||
      !isScopedReference(invitation.acceptAuthorizationReference, invitation.tenantId) ||
      !numberIsSafeInteger(invitation.acceptPolicyRevision) || invitation.acceptPolicyRevision < 1)) return null;
  if (revoked && (!isCanonicalUtc(invitation.revokedAt) ||
      dateParse(invitation.revokedAt) < dateParse(invitation.issuedAt) ||
      (accepted && dateParse(invitation.revokedAt) < dateParse(invitation.acceptedAt)) ||
      invitation.revokedBySubjectId !== invitation.revocationAuthoritySubjectId ||
      !isScopedReference(invitation.revokeAuthorizationReference, invitation.tenantId) ||
      !numberIsSafeInteger(invitation.revokePolicyRevision) || invitation.revokePolicyRevision < 1)) return null;
  if (invitation.lifecycle === "issued") {
    return invitation.revision === 1 && !accepted && !revoked ? invitation : null;
  }
  if (invitation.lifecycle === "accepted") {
    return invitation.revision === 2 && accepted && !revoked ? invitation : null;
  }
  if (invitation.lifecycle === "revoked") {
    return revoked && ((!accepted && invitation.revision === 2) ||
      (accepted && invitation.revision === 3)) ? invitation : null;
  }
  return null;
}

function validateStoredAuditEvent(row, invitation, index, previousOccurredAt) {
  if (!row || typeof row.event_json !== "string") return null;
  const parsed = jsonParse(row.event_json);
  if (jsonStringify(parsed) !== row.event_json) return null;
  const event = snapshotObject(parsed, EVENT_KEYS);
  if (!event) return null;

  let expected;
  if (index === 0) {
    expected = {
      eventId: invitation.sourceReference,
      eventKind: "private_meeting_invitation_issued",
      occurredAt: invitation.issuedAt,
      actorSubjectId: invitation.issuerSubjectId,
      authorizationReference: invitation.issueAuthorizationReference,
      policyRevision: invitation.issuePolicyRevision
    };
  } else if (index === 1 && invitation.acceptedAt !== null) {
    expected = {
      eventId: `${invitation.invitationId}-accepted`,
      eventKind: "private_meeting_invitation_accepted",
      occurredAt: invitation.acceptedAt,
      actorSubjectId: invitation.acceptedBySubjectId,
      authorizationReference: invitation.acceptAuthorizationReference,
      policyRevision: invitation.acceptPolicyRevision
    };
  } else if ((index === 1 && invitation.acceptedAt === null) || index === 2) {
    expected = {
      eventId: `${invitation.invitationId}-revoked`,
      eventKind: "private_meeting_invitation_revoked",
      occurredAt: invitation.revokedAt,
      actorSubjectId: invitation.revokedBySubjectId,
      authorizationReference: invitation.revokeAuthorizationReference,
      policyRevision: invitation.revokePolicyRevision
    };
  } else {
    return null;
  }

  if (event.privacy !== "tenant-private" || event.tenantId !== invitation.tenantId ||
      event.invitationId !== invitation.invitationId || event.eventId !== expected.eventId ||
      event.eventKind !== expected.eventKind || event.priorRevision !== index ||
      event.newRevision !== index + 1 || event.occurredAt !== expected.occurredAt ||
      event.actorSubjectId !== expected.actorSubjectId ||
      event.authorizationReference !== expected.authorizationReference ||
      event.policyRevision !== expected.policyRevision || !isCanonicalUtc(event.occurredAt) ||
      !isScopedReference(event.eventId, invitation.tenantId) ||
      !isScopedReference(event.actorSubjectId, invitation.tenantId) ||
      !isScopedReference(event.authorizationReference, invitation.tenantId) ||
      !numberIsSafeInteger(event.policyRevision) || objectIs(event.policyRevision, -0) ||
      event.policyRevision < 1 || (previousOccurredAt !== null &&
      dateParse(event.occurredAt) < dateParse(previousOccurredAt)) ||
      row.tenant_id !== event.tenantId || row.invitation_id !== event.invitationId ||
      row.event_id !== event.eventId || row.prior_revision !== event.priorRevision ||
      row.new_revision !== event.newRevision) return null;
  return event;
}

function createPrivateMeetingInvitationsRepository(databasePath, options = {}) {
  if (typeof databasePath !== "string" || databasePath.length === 0) throw new TypeError("repository unavailable");
  const emptyOptions = snapshotObject(options, []);
  const clockOptions = emptyOptions ? null : snapshotObject(options, OPTIONS_KEYS);
  if (!emptyOptions && (!clockOptions || typeof clockOptions.now !== "function")) {
    throw new TypeError("repository unavailable");
  }
  const now = clockOptions ? clockOptions.now : null;
  function currentTime() {
    if (now === null) return null;
    const value = now();
    return isCanonicalUtc(value) ? value : undefined;
  }
  if (databasePath !== ":memory:") {
    closeSync(openSync(databasePath, "a", 0o600));
    chmodSync(databasePath, 0o600);
  }
  const database = new DatabaseSync(databasePath);
  database.exec(`
    PRAGMA foreign_keys = ON;
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS private_meeting_invitations (
      tenant_id TEXT NOT NULL,
      invitation_id TEXT NOT NULL,
      revision INTEGER NOT NULL CHECK (revision >= 1),
      invitation_json TEXT NOT NULL,
      PRIMARY KEY (tenant_id, invitation_id)
    ) STRICT;
    CREATE TABLE IF NOT EXISTS private_meeting_invitation_audit_events (
      tenant_id TEXT NOT NULL,
      invitation_id TEXT NOT NULL,
      event_id TEXT NOT NULL,
      prior_revision INTEGER NOT NULL,
      new_revision INTEGER NOT NULL,
      event_json TEXT NOT NULL,
      PRIMARY KEY (tenant_id, event_id),
      FOREIGN KEY (tenant_id, invitation_id)
        REFERENCES private_meeting_invitations (tenant_id, invitation_id)
    ) STRICT;
  `);
  const insertInvitation = database.prepare(`
    INSERT INTO private_meeting_invitations (tenant_id, invitation_id, revision, invitation_json)
    VALUES (?, ?, ?, ?)
  `);
  const insertAudit = database.prepare(`
    INSERT INTO private_meeting_invitation_audit_events
      (tenant_id, invitation_id, event_id, prior_revision, new_revision, event_json)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  const readInvitation = database.prepare(`
    SELECT tenant_id, invitation_id, revision, invitation_json
    FROM private_meeting_invitations WHERE tenant_id = ? AND invitation_id = ?
  `);
  const readHistory = database.prepare(`
    SELECT tenant_id, invitation_id, event_id, prior_revision, new_revision, event_json
    FROM private_meeting_invitation_audit_events
    WHERE tenant_id = ? AND invitation_id = ? ORDER BY new_revision ASC
  `);
  const updateInvitation = database.prepare(`
    UPDATE private_meeting_invitations SET revision = ?, invitation_json = ?
    WHERE tenant_id = ? AND invitation_id = ? AND revision = ?
  `);
  let closed = false;
  return objectFreeze(objectAssign(objectCreate(null), {
    issueInvitation(context, input) {
      try {
        context = snapshotContext(context);
        input = snapshotObject(input, ISSUE_KEYS);
        if (!context || !input) return DENIED;
        input.materialReferences = snapshotArray(input.materialReferences);
        const authority = authorize(context, input.tenantId, ACTIONS.issue);
        if (!authority || !input.materialReferences || input.expectedRevision !== 0 ||
            objectIs(input.expectedRevision, -0) || !isScopedReference(input.invitationId, input.tenantId) ||
            !isScopedReference(input.intendedRecipientSubjectId, input.tenantId) ||
            !isScopedReference(input.purposeReference, input.tenantId) ||
            !isOrderedUniqueReferences(input.materialReferences, input.tenantId) ||
            !isScopedReference(input.revocationAuthoritySubjectId, input.tenantId) ||
            !isCanonicalUtc(input.issuedAt) || !isCanonicalUtc(input.validFrom) ||
            !isCanonicalUtc(input.expiresAt) || dateParse(input.issuedAt) > dateParse(input.validFrom) ||
            dateParse(input.validFrom) >= dateParse(input.expiresAt) ||
            !isScopedReference(input.sourceReference, input.tenantId)) return DENIED;
        const record = issuedRecord(input, authority);
        const event = issuedEvent(record);
        database.exec("BEGIN IMMEDIATE");
        try {
          insertInvitation.run(record.tenantId, record.invitationId, 1, jsonStringify(record));
          insertAudit.run(record.tenantId, record.invitationId, event.eventId, 0, 1, jsonStringify(event));
          database.exec("COMMIT");
          return detachedFrozen({ ok: true, invitation: record });
        } catch {
          try { database.exec("ROLLBACK"); } catch { /* no active transaction */ }
          return DENIED;
        }
      } catch { return DENIED; }
    },
    acceptInvitation(context, input) {
      try {
        context = snapshotContext(context);
        input = snapshotObject(input, ACCEPT_KEYS);
        if (!context || !input) return DENIED;
        const authority = authorize(context, input.tenantId, ACTIONS.accept);
        const evaluatedAt = currentTime();
        if (!authority || !isScopedReference(input.invitationId, input.tenantId) ||
            !isCanonicalUtc(input.acceptedAt) || input.expectedRevision !== 1 ||
            objectIs(input.expectedRevision, -0) || evaluatedAt === undefined ||
            (evaluatedAt !== null && evaluatedAt !== input.acceptedAt)) return DENIED;
        const record = validateStoredInvitation(readInvitation.get(input.tenantId, input.invitationId));
        if (!record || record.intendedRecipientSubjectId !== authority.actorSubjectId) return DENIED;
        if (record.revision === 2) {
          return record.lifecycle === "accepted" && record.acceptedAt === input.acceptedAt &&
            record.acceptedBySubjectId === authority.actorSubjectId &&
            record.acceptAuthorizationReference === authority.authorizationReference &&
            record.acceptPolicyRevision === authority.policyRevision
            ? detachedFrozen({ ok: true, invitation: record }) : DENIED;
        }
        if (record.revision !== 1 || record.lifecycle !== "issued" ||
            dateParse(input.acceptedAt) < dateParse(record.validFrom) ||
            dateParse(input.acceptedAt) >= dateParse(record.expiresAt)) return DENIED;
        const accepted = acceptedRecord(record, input, authority);
        const event = acceptedEvent(accepted);
        database.exec("BEGIN IMMEDIATE");
        try {
          const update = updateInvitation.run(
            2, jsonStringify(accepted), accepted.tenantId, accepted.invitationId, 1
          );
          if (update.changes !== 1) throw new Error("stale invitation");
          insertAudit.run(
            event.tenantId, event.invitationId, event.eventId, 1, 2, jsonStringify(event)
          );
          database.exec("COMMIT");
          return detachedFrozen({ ok: true, invitation: accepted });
        } catch {
          try { database.exec("ROLLBACK"); } catch { /* no active transaction */ }
          return DENIED;
        }
      } catch { return DENIED; }
    },
    revokeInvitation(context, input) {
      try {
        context = snapshotContext(context);
        input = snapshotObject(input, REVOKE_KEYS);
        if (!context || !input) return DENIED;
        const authority = authorize(context, input.tenantId, ACTIONS.revoke);
        const evaluatedAt = currentTime();
        if (!authority || !isScopedReference(input.invitationId, input.tenantId) ||
            !isCanonicalUtc(input.revokedAt) || !numberIsSafeInteger(input.expectedRevision) ||
            objectIs(input.expectedRevision, -0) || input.expectedRevision < 1 ||
            evaluatedAt === undefined || (evaluatedAt !== null && evaluatedAt !== input.revokedAt)) return DENIED;
        const record = validateStoredInvitation(readInvitation.get(input.tenantId, input.invitationId));
        if (!record || record.revocationAuthoritySubjectId !== authority.actorSubjectId) return DENIED;
        if (record.lifecycle === "revoked") {
          return record.revision === input.expectedRevision + 1 && record.revokedAt === input.revokedAt &&
            record.revokedBySubjectId === authority.actorSubjectId &&
            record.revokeAuthorizationReference === authority.authorizationReference &&
            record.revokePolicyRevision === authority.policyRevision
            ? detachedFrozen({ ok: true, invitation: record }) : DENIED;
        }
        if ((record.lifecycle !== "issued" && record.lifecycle !== "accepted") ||
            record.revision !== input.expectedRevision ||
            dateParse(input.revokedAt) < dateParse(record.issuedAt) ||
            (record.acceptedAt !== null &&
              dateParse(input.revokedAt) < dateParse(record.acceptedAt))) return DENIED;
        const revoked = revokedRecord(record, input, authority);
        const event = revokedEvent(revoked);
        database.exec("BEGIN IMMEDIATE");
        try {
          const update = updateInvitation.run(
            revoked.revision, jsonStringify(revoked), revoked.tenantId,
            revoked.invitationId, input.expectedRevision
          );
          if (update.changes !== 1) throw new Error("stale invitation");
          insertAudit.run(
            event.tenantId, event.invitationId, event.eventId,
            event.priorRevision, event.newRevision, jsonStringify(event)
          );
          database.exec("COMMIT");
          return detachedFrozen({ ok: true, invitation: revoked });
        } catch {
          try { database.exec("ROLLBACK"); } catch { /* no active transaction */ }
          return DENIED;
        }
      } catch { return DENIED; }
    },
    readInvitation(context, scope) {
      try {
        context = snapshotContext(context);
        scope = snapshotObject(scope, SCOPE_KEYS);
        if (!context || !scope || !authorize(context, scope.tenantId, ACTIONS.read) ||
            !isScopedReference(scope.invitationId, scope.tenantId)) return DENIED;
        const invitation = validateStoredInvitation(readInvitation.get(scope.tenantId, scope.invitationId));
        if (!invitation || (context.authenticatedSubjectId !== invitation.issuerSubjectId &&
            context.authenticatedSubjectId !== invitation.intendedRecipientSubjectId &&
            context.authenticatedSubjectId !== invitation.revocationAuthoritySubjectId) ||
            invitation.lifecycle === "revoked") return DENIED;
        const evaluatedAt = currentTime();
        if (evaluatedAt === undefined || (evaluatedAt !== null &&
            dateParse(evaluatedAt) >= dateParse(invitation.expiresAt))) return DENIED;
        return detachedFrozen({ ok: true, invitation });
      } catch { return DENIED; }
    },
    readAuditHistory(context, scope) {
      try {
        context = snapshotContext(context);
        scope = snapshotObject(scope, SCOPE_KEYS);
        if (!context || !scope || !authorize(context, scope.tenantId, ACTIONS.audit) ||
            !isScopedReference(scope.invitationId, scope.tenantId)) return DENIED;
        const invitation = validateStoredInvitation(readInvitation.get(scope.tenantId, scope.invitationId));
        if (!invitation) return DENIED;
        const rows = readHistory.all(scope.tenantId, scope.invitationId);
        if (rows.length !== invitation.revision) return DENIED;
        const events = [];
        let previousOccurredAt = null;
        for (let index = 0; index < rows.length; index += 1) {
          const event = validateStoredAuditEvent(rows[index], invitation, index, previousOccurredAt);
          if (!event) return DENIED;
          events.push(event);
          previousOccurredAt = event.occurredAt;
        }
        return detachedFrozen({ ok: true, events });
      } catch { return DENIED; }
    },
    close() {
      if (closed) return;
      closed = true;
      database.close();
    }
  }));
}

export { createPrivateMeetingInvitationsRepository };
