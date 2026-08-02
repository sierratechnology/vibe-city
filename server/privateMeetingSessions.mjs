import { chmodSync, closeSync, openSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { isProxy } from "node:util/types";

const DateIntrinsic = Date;
const dateParse = Date.parse.bind(Date);
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
const arrayIsArray = Array.isArray;

const regexpTest = Function.call.bind(RegExp.prototype.test);
const stringStartsWith = Function.call.bind(String.prototype.startsWith);
const jsonParse = JSON.parse.bind(JSON);
const jsonStringify = JSON.stringify.bind(JSON);
const dateToISOString = Function.call.bind(Date.prototype.toISOString);
const DENIED = objectFreeze({ ok: false, code: "not_found" });
const REFERENCE = /^syn-[a-z0-9]+(?:-[a-z0-9]+)*--[a-z0-9]+(?:-[a-z0-9]+)*$/;
const TENANT = /^syn-tenant-[a-z0-9]+(?:-[a-z0-9]+)*$/;
const ACTIONS = objectFreeze({
  create: "create_private_meeting_session",
  read: "read_private_meeting_session",
  end: "end_private_meeting_session"
});

const CONTEXT_KEYS = objectFreeze([
  "kind", "authenticatedSubjectId", "activeTenantMembership", "actionGrants",
  "authorizationReference", "policyRevision"
]);
const MEMBERSHIP_KEYS = objectFreeze(["tenantId", "subjectId", "active"]);
const CREATE_KEYS = objectFreeze([
  "tenantId", "sessionId", "purposeReference", "participantSubjectIds",
  "materialReferences", "startedAt", "sourceReference", "expectedRevision"
]);
const END_KEYS = objectFreeze([
  "tenantId", "sessionId", "endedAt", "expectedRevision", "outcomeReference",
  "actorSubjectId", "authorizationReference", "policyRevision"
]);
const SCOPE_KEYS = objectFreeze(["tenantId", "sessionId"]);
const OPTIONS_KEYS = objectFreeze(["beforeAuditWrite"]);
const ACTIVE_SESSION_KEYS = objectFreeze([
  "privacy", "tenantId", "sessionId", "revision", "purposeReference",
  "participantSubjectIds", "materialReferences", "startedAt", "endedAt", "lifecycle",
  "outcome", "sourceReference", "createdBySubjectId", "authorizationReference", "policyRevision"
]);
const ENDED_SESSION_KEYS = objectFreeze([
  "privacy", "tenantId", "sessionId", "revision", "purposeReference",
  "participantSubjectIds", "materialReferences", "startedAt", "endedAt", "lifecycle",
  "outcome", "sourceReference", "createdBySubjectId", "authorizationReference", "policyRevision",
  "endedBySubjectId", "endAuthorizationReference", "endPolicyRevision"
]);
const OUTCOME_KEYS = objectFreeze(["resultState", "outcomeReference"]);
const CREATED_EVENT_KEYS = objectFreeze([
  "privacy", "tenantId", "sessionId", "eventId", "eventKind", "priorRevision",
  "newRevision", "occurredAt", "actorSubjectId", "authorizationReference", "policyRevision"
]);
const ENDED_EVENT_KEYS = objectFreeze([
  "privacy", "tenantId", "sessionId", "eventId", "eventKind", "priorRevision",
  "newRevision", "occurredAt", "actorSubjectId", "authorizationReference", "policyRevision",
  "outcomeReference", "resultState"
]);

function snapshotArray(value) {
  if (!arrayIsArray(value) || isProxy(value)) return null;
  const descriptors = objectGetOwnPropertyDescriptors(value);
  const keys = reflectOwnKeys(value);
  if (keys.length !== value.length + 1 || keys[keys.length - 1] !== "length") return null;
  const copy = [];
  for (let index = 0; index < value.length; index += 1) {
    const key = String(index);
    if (keys[index] !== key || !descriptors[key] || !("value" in descriptors[key])) return null;
    objectDefineProperty(copy, key, {
      configurable: true,
      enumerable: true,
      value: descriptors[key].value,
      writable: true
    });
  }
  return copy;
}

function snapshotObject(value, expectedKeys, arrayKeys = null, objectKeys = null) {
  if (value === null || typeof value !== "object" || isProxy(value)) return null;
  const prototype = objectGetPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return null;
  const descriptors = objectGetOwnPropertyDescriptors(value);
  const keys = reflectOwnKeys(value);
  if (keys.length !== expectedKeys.length) return null;
  const copy = {};
  for (let index = 0; index < expectedKeys.length; index += 1) {
    const key = expectedKeys[index];
    const descriptor = descriptors[key];
    if (keys[index] !== key || !descriptor || !("value" in descriptor)) return null;
    let item = descriptor.value;
    if (arrayKeys && arrayKeys[key]) {
      item = snapshotArray(item);
      if (!item) return null;
    } else if (objectKeys && objectKeys[key]) {
      item = snapshotObject(item, objectKeys[key]);
      if (!item) return null;
    }
    objectDefineProperty(copy, key, {
      configurable: true,
      enumerable: true,
      value: item,
      writable: true
    });
  }
  return copy;
}

function snapshotContext(value) {
  return snapshotObject(value, CONTEXT_KEYS, { actionGrants: true }, {
    activeTenantMembership: MEMBERSHIP_KEYS
  });
}

function snapshotCreateInput(value) {
  return snapshotObject(value, CREATE_KEYS, {
    participantSubjectIds: true,
    materialReferences: true
  });
}

function snapshotEndInput(value) {
  return snapshotObject(value, END_KEYS);
}

function snapshotScope(value) {
  return snapshotObject(value, SCOPE_KEYS);
}

function isTenant(value) {
  return typeof value === "string" && value.length <= 128 && regexpTest(TENANT, value);
}

function isScopedReference(value, tenantId) {
  return typeof value === "string" && value.length <= 128 &&
    regexpTest(REFERENCE, value) && stringStartsWith(value, `${tenantId}--`);
}

function isCanonicalTimestamp(value) {
  if (typeof value !== "string" || !regexpTest(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/, value)) return false;
  const milliseconds = dateParse(value);
  return numberIsFinite(milliseconds) && dateToISOString(new DateIntrinsic(milliseconds)) === value;
}

function isOrderedUniqueReferences(values, tenantId, maximum) {
  if (!arrayIsArray(values) || values.length < 1 || values.length > maximum) return false;
  for (let index = 0; index < values.length; index += 1) {
    if (!isScopedReference(values[index], tenantId)) return false;
    for (let prior = 0; prior < index; prior += 1) {
      if (values[prior] === values[index]) return false;
    }
  }
  return true;
}

function isReferencePresent(values, expected) {
  for (let index = 0; index < values.length; index += 1) {
    if (values[index] === expected) return true;
  }
  return false;
}

function authorize(context, tenantId, action) {
  const membership = context.activeTenantMembership;
  if (context.kind !== "trusted-server-context" || membership.active !== true ||
      !isTenant(tenantId) || membership.tenantId !== tenantId ||
      context.authenticatedSubjectId !== membership.subjectId ||
      !isScopedReference(context.authenticatedSubjectId, tenantId) ||
      !isScopedReference(context.authorizationReference, tenantId) ||
      !numberIsSafeInteger(context.policyRevision) || objectIs(context.policyRevision, -0) ||
      context.policyRevision < 1 || context.actionGrants.length !== 1 ||
      context.actionGrants[0] !== action) return null;
  return {
    actorSubjectId: context.authenticatedSubjectId,
    authorizationReference: context.authorizationReference,
    policyRevision: context.policyRevision
  };
}

function parseJson(value) {
  return jsonParse(value);
}

function detachedFrozen(value, depth = 0) {
  if (depth > 8) throw new TypeError("invalid material value");
  if (arrayIsArray(value)) {
    if (value.length > 64) throw new TypeError("invalid material value");
    const copy = [];
    for (let index = 0; index < value.length; index += 1) {
      objectDefineProperty(copy, String(index), {
        configurable: true,
        enumerable: true,
        value: detachedFrozen(value[index], depth + 1),
        writable: true
      });
    }
    return objectFreeze(copy);
  }
  if (value !== null && typeof value === "object") {
    const keys = reflectOwnKeys(value);
    if (keys.length > 64) throw new TypeError("invalid material value");
    const copy = {};
    for (let index = 0; index < keys.length; index += 1) {
      const key = keys[index];
      if (typeof key !== "string") throw new TypeError("invalid material value");
      objectDefineProperty(copy, key, {
        configurable: true,
        enumerable: true,
        value: detachedFrozen(value[key], depth + 1),
        writable: true
      });
    }
    return objectFreeze(copy);
  }
  return value;
}

function createRecord(input, authority) {
  return {
    privacy: "tenant-private",
    tenantId: input.tenantId,
    sessionId: input.sessionId,
    revision: 1,
    purposeReference: input.purposeReference,
    participantSubjectIds: input.participantSubjectIds,
    materialReferences: input.materialReferences,
    startedAt: input.startedAt,
    endedAt: null,
    lifecycle: "active",
    outcome: null,
    sourceReference: input.sourceReference,
    createdBySubjectId: authority.actorSubjectId,
    authorizationReference: authority.authorizationReference,
    policyRevision: authority.policyRevision
  };
}

function createdEvent(record) {
  return {
    privacy: "tenant-private",
    tenantId: record.tenantId,
    sessionId: record.sessionId,
    eventId: record.sourceReference,
    eventKind: "private_meeting_session_created",
    priorRevision: 0,
    newRevision: 1,
    occurredAt: record.startedAt,
    actorSubjectId: record.createdBySubjectId,
    authorizationReference: record.authorizationReference,
    policyRevision: record.policyRevision
  };
}

function endedRecord(record, input) {
  return {
    privacy: record.privacy,
    tenantId: record.tenantId,
    sessionId: record.sessionId,
    revision: 2,
    purposeReference: record.purposeReference,
    participantSubjectIds: record.participantSubjectIds,
    materialReferences: record.materialReferences,
    startedAt: record.startedAt,
    endedAt: input.endedAt,
    lifecycle: "ended",
    outcome: { resultState: "no-decision", outcomeReference: input.outcomeReference },
    sourceReference: record.sourceReference,
    createdBySubjectId: record.createdBySubjectId,
    authorizationReference: record.authorizationReference,
    policyRevision: record.policyRevision,
    endedBySubjectId: input.actorSubjectId,
    endAuthorizationReference: input.authorizationReference,
    endPolicyRevision: input.policyRevision
  };
}

function endedEvent(record, input) {
  return {
    privacy: "tenant-private",
    tenantId: record.tenantId,
    sessionId: record.sessionId,
    eventId: input.outcomeReference,
    eventKind: "private_meeting_session_ended_no_decision",
    priorRevision: 1,
    newRevision: 2,
    occurredAt: input.endedAt,
    actorSubjectId: input.actorSubjectId,
    authorizationReference: input.authorizationReference,
    policyRevision: input.policyRevision,
    outcomeReference: input.outcomeReference,
    resultState: "no-decision"
  };
}

function validateSessionRow(row) {
  if (!row || typeof row.session_json !== "string") return null;
  const parsed = parseJson(row.session_json);
  if (jsonStringify(parsed) !== row.session_json) return null;
  const sessionKeys = parsed && parsed.revision === 2 ? ENDED_SESSION_KEYS : ACTIVE_SESSION_KEYS;
  const session = snapshotObject(parsed, sessionKeys, {
    participantSubjectIds: true,
    materialReferences: true
  });
  if (!session || session.privacy !== "tenant-private" ||
      session.tenantId !== row.tenant_id || session.sessionId !== row.session_id ||
      session.revision !== row.revision || !numberIsSafeInteger(session.revision) ||
      !isTenant(session.tenantId) || !isScopedReference(session.sessionId, session.tenantId) ||
      !isScopedReference(session.purposeReference, session.tenantId) ||
      !isOrderedUniqueReferences(session.participantSubjectIds, session.tenantId, 32) ||
      !isOrderedUniqueReferences(session.materialReferences, session.tenantId, 32) ||
      !isCanonicalTimestamp(session.startedAt) ||
      !isScopedReference(session.sourceReference, session.tenantId) ||
      !isScopedReference(session.createdBySubjectId, session.tenantId) ||
      !isReferencePresent(session.participantSubjectIds, session.createdBySubjectId) ||
      !isScopedReference(session.authorizationReference, session.tenantId) ||
      !numberIsSafeInteger(session.policyRevision) || session.policyRevision < 1) return null;
  if (session.revision === 1) {
    if (session.lifecycle !== "active" || session.endedAt !== null || session.outcome !== null) return null;
  } else if (session.revision === 2) {
    const outcome = snapshotObject(session.outcome, OUTCOME_KEYS);
    if (!outcome || session.lifecycle !== "ended" || !isCanonicalTimestamp(session.endedAt) ||
        dateParse(session.endedAt) <= dateParse(session.startedAt) ||
        outcome.resultState !== "no-decision" ||
        !isScopedReference(outcome.outcomeReference, session.tenantId) ||
        !isScopedReference(session.endedBySubjectId, session.tenantId) ||
        !isReferencePresent(session.participantSubjectIds, session.endedBySubjectId) ||
        !isScopedReference(session.endAuthorizationReference, session.tenantId) ||
        !numberIsSafeInteger(session.endPolicyRevision) || session.endPolicyRevision < 1) return null;
    session.outcome = outcome;
  } else {
    return null;
  }
  return session;
}

function validateEventRow(row, session) {
  if (!row || typeof row.event_json !== "string") return null;
  const parsed = parseJson(row.event_json);
  if (jsonStringify(parsed) !== row.event_json) return null;
  const keys = parsed && parsed.eventKind === "private_meeting_session_created"
    ? CREATED_EVENT_KEYS
    : ENDED_EVENT_KEYS;
  const event = snapshotObject(parsed, keys);
  if (!event || event.privacy !== "tenant-private" ||
      event.tenantId !== row.tenant_id || event.sessionId !== row.session_id ||
      event.eventId !== row.event_id ||
      event.priorRevision !== row.prior_revision || event.newRevision !== row.new_revision ||
      event.tenantId !== session.tenantId || event.sessionId !== session.sessionId ||
      !isCanonicalTimestamp(event.occurredAt) ||
      !isScopedReference(event.eventId, event.tenantId)) return null;
  if (event.eventKind === "private_meeting_session_created") {
    if (event.priorRevision !== 0 || event.newRevision !== 1 ||
        event.eventId !== session.sourceReference || event.occurredAt !== session.startedAt ||
        event.actorSubjectId !== session.createdBySubjectId ||
        event.authorizationReference !== session.authorizationReference ||
        event.policyRevision !== session.policyRevision) return null;
  } else if (event.eventKind === "private_meeting_session_ended_no_decision") {
    if (session.revision !== 2 || event.priorRevision !== 1 || event.newRevision !== 2 ||
        event.occurredAt !== session.endedAt || event.resultState !== "no-decision" ||
        event.outcomeReference !== session.outcome.outcomeReference ||
        event.eventId !== session.outcome.outcomeReference ||
        event.actorSubjectId !== session.endedBySubjectId ||
        event.authorizationReference !== session.endAuthorizationReference ||
        event.policyRevision !== session.endPolicyRevision) return null;
  } else {
    return null;
  }
  return event;
}

function validateHistoryRows(rows, session) {
  if (!arrayIsArray(rows) || rows.length !== session.revision) return null;
  const events = [];
  for (let index = 0; index < rows.length; index += 1) {
    const event = validateEventRow(rows[index], session);
    if (!event || event.newRevision !== index + 1) return null;
    objectDefineProperty(events, String(index), {
      configurable: true,
      enumerable: true,
      value: event,
      writable: true
    });
  }
  return events;
}

function openPrivateMeetingSessionsRepository(databasePath, options) {
  if (typeof databasePath !== "string" || databasePath.length === 0) {
    throw new TypeError("repository unavailable");
  }
  const emptyOptions = snapshotObject(options, []);
  const hookOptions = emptyOptions ? null : snapshotObject(options, OPTIONS_KEYS);
  if (!emptyOptions && (!hookOptions || typeof hookOptions.beforeAuditWrite !== "function")) {
    throw new TypeError("repository unavailable");
  }
  const beforeAuditWrite = hookOptions ? hookOptions.beforeAuditWrite : (() => {});
  if (databasePath !== ":memory:") {
    closeSync(openSync(databasePath, "a", 0o600));
    chmodSync(databasePath, 0o600);
  }
  const database = new DatabaseSync(databasePath);
  database.exec(`
    PRAGMA foreign_keys = ON;
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS private_meeting_sessions (
      tenant_id TEXT NOT NULL,
      session_id TEXT NOT NULL,
      revision INTEGER NOT NULL CHECK (revision >= 1),
      session_json TEXT NOT NULL,
      PRIMARY KEY (tenant_id, session_id)
    ) STRICT;
    CREATE TABLE IF NOT EXISTS private_meeting_session_audit_events (
      tenant_id TEXT NOT NULL,
      session_id TEXT NOT NULL,
      event_id TEXT NOT NULL,
      prior_revision INTEGER NOT NULL CHECK (prior_revision >= 0),
      new_revision INTEGER NOT NULL CHECK (new_revision >= 1),
      event_json TEXT NOT NULL,
      PRIMARY KEY (tenant_id, event_id),
      FOREIGN KEY (tenant_id, session_id)
        REFERENCES private_meeting_sessions (tenant_id, session_id)
    ) STRICT;
  `);
  const insertSession = database.prepare(`
    INSERT INTO private_meeting_sessions (tenant_id, session_id, revision, session_json)
    VALUES (?, ?, ?, ?)
  `);
  const insertAudit = database.prepare(`
    INSERT INTO private_meeting_session_audit_events
      (tenant_id, session_id, event_id, prior_revision, new_revision, event_json)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  const readSessionStatement = database.prepare(`
    SELECT tenant_id, session_id, revision, session_json
    FROM private_meeting_sessions WHERE tenant_id = ? AND session_id = ?
  `);
  const historyStatement = database.prepare(`
    SELECT tenant_id, session_id, event_id, prior_revision, new_revision, event_json
    FROM private_meeting_session_audit_events
    WHERE tenant_id = ? AND session_id = ?
    ORDER BY new_revision ASC, event_id ASC
  `);
  const updateSession = database.prepare(`
    UPDATE private_meeting_sessions SET revision = ?, session_json = ?
    WHERE tenant_id = ? AND session_id = ? AND revision = ?
  `);
  let closed = false;

  return objectFreeze(objectAssign(objectCreate(null), {
    createSession(context, input) {
      try {
        context = snapshotContext(context);
        input = snapshotCreateInput(input);
        if (!context || !input) return DENIED;
        const authority = authorize(context, input.tenantId, ACTIONS.create);
        if (!authority) return DENIED;
        if (input.expectedRevision !== 0 || objectIs(input.expectedRevision, -0) ||
            !isScopedReference(input.sessionId, input.tenantId) ||
            !isScopedReference(input.purposeReference, input.tenantId) ||
            !isOrderedUniqueReferences(input.participantSubjectIds, input.tenantId, 32) ||
            !isReferencePresent(input.participantSubjectIds, authority.actorSubjectId) ||
            !isOrderedUniqueReferences(input.materialReferences, input.tenantId, 32) ||
            !isCanonicalTimestamp(input.startedAt) ||
            !isScopedReference(input.sourceReference, input.tenantId)) return DENIED;
        const record = createRecord(input, authority);
        const event = createdEvent(record);
        database.exec("BEGIN IMMEDIATE");
        try {
          insertSession.run(record.tenantId, record.sessionId, record.revision, jsonStringify(record));
          beforeAuditWrite(detachedFrozen(event));
          insertAudit.run(
            event.tenantId, event.sessionId, event.eventId, event.priorRevision,
            event.newRevision, jsonStringify(event)
          );
          database.exec("COMMIT");
          return detachedFrozen({ ok: true, session: record });
        } catch {
          try { database.exec("ROLLBACK"); } catch { /* no active transaction */ }
          return DENIED;
        }
      } catch {
        return DENIED;
      }
    },

    endWithNoDecision(context, input) {
      try {
        context = snapshotContext(context);
        input = snapshotEndInput(input);
        if (!context || !input) return DENIED;
        const authority = authorize(context, input.tenantId, ACTIONS.end);
        if (!authority || input.expectedRevision !== 1 || objectIs(input.expectedRevision, -0) ||
            !numberIsSafeInteger(input.policyRevision) || objectIs(input.policyRevision, -0) ||
            input.actorSubjectId !== authority.actorSubjectId ||
            input.authorizationReference !== authority.authorizationReference ||
            input.policyRevision !== authority.policyRevision ||
            !isScopedReference(input.sessionId, input.tenantId) ||
            !isScopedReference(input.outcomeReference, input.tenantId) ||
            !isCanonicalTimestamp(input.endedAt)) return DENIED;
        database.exec("BEGIN IMMEDIATE");
        try {
          const row = readSessionStatement.get(input.tenantId, input.sessionId);
          if (!row) {
            database.exec("ROLLBACK");
            return DENIED;
          }
          const current = validateSessionRow(row);
          const currentHistory = current
            ? validateHistoryRows(historyStatement.all(input.tenantId, input.sessionId), current)
            : null;
          if (!current || !currentHistory || current.revision !== input.expectedRevision ||
              current.lifecycle !== "active" ||
              !isReferencePresent(current.participantSubjectIds, authority.actorSubjectId) ||
              dateParse(input.endedAt) <= dateParse(current.startedAt)) {
            database.exec("ROLLBACK");
            return DENIED;
          }
          const record = endedRecord(current, input);
          const event = endedEvent(record, input);
          const update = updateSession.run(
            record.revision, jsonStringify(record), record.tenantId,
            record.sessionId, input.expectedRevision
          );
          if (update.changes !== 1) {
            database.exec("ROLLBACK");
            return DENIED;
          }
          beforeAuditWrite(detachedFrozen(event));
          insertAudit.run(
            event.tenantId, event.sessionId, event.eventId, event.priorRevision,
            event.newRevision, jsonStringify(event)
          );
          database.exec("COMMIT");
          return detachedFrozen({ ok: true, session: record });
        } catch {
          try { database.exec("ROLLBACK"); } catch { /* no active transaction */ }
          return DENIED;
        }
      } catch {
        return DENIED;
      }
    },

    readSession(context, scope) {
      try {
        context = snapshotContext(context);
        scope = snapshotScope(scope);
        if (!context || !scope ||
            !authorize(context, scope.tenantId, ACTIONS.read) ||
            !isScopedReference(scope.sessionId, scope.tenantId)) return DENIED;
        const row = readSessionStatement.get(scope.tenantId, scope.sessionId);
        const session = validateSessionRow(row);
        const history = session
          ? validateHistoryRows(historyStatement.all(scope.tenantId, scope.sessionId), session)
          : null;
        return session && history ? detachedFrozen({ ok: true, session }) : DENIED;
      } catch {
        return DENIED;
      }
    },

    readAuditHistory(context, scope) {
      try {
        context = snapshotContext(context);
        scope = snapshotScope(scope);
        if (!context || !scope ||
            !authorize(context, scope.tenantId, ACTIONS.read) ||
            !isScopedReference(scope.sessionId, scope.tenantId)) return DENIED;
        const session = validateSessionRow(readSessionStatement.get(scope.tenantId, scope.sessionId));
        if (!session) return DENIED;
        const events = validateHistoryRows(
          historyStatement.all(scope.tenantId, scope.sessionId), session
        );
        return events ? detachedFrozen({ ok: true, events }) : DENIED;
      } catch {
        return DENIED;
      }
    },

    close() {
      if (closed) return detachedFrozen({ ok: true });
      try {
        database.close();
        closed = true;
        return detachedFrozen({ ok: true });
      } catch {
        return DENIED;
      }
    }
  }));
}

export function createPrivateMeetingSessionsRepository(databasePath, options = {}) {
  try {
    return openPrivateMeetingSessionsRepository(databasePath, options);
  } catch {
    throw new Error("repository unavailable");
  }
}
