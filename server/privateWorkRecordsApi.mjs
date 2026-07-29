import { createHash } from "node:crypto";

const MAX_BODY_BYTES = 32_768;
const CREATE_AUTHORIZATION_ACTION = "create";
const REQUEST_ID = /^id_[a-f0-9]{16,64}$/;
const MUTATION_SOURCE_STATES = Object.freeze({
  rename: new Set(["proposed", "authorized", "ready", "active", "blocked", "review", "completed"]),
  reassign: new Set(["proposed", "authorized", "ready", "active", "blocked", "review", "completed"]),
  block: new Set(["ready", "active", "blocked", "review"]),
  unblock: new Set(["blocked"]),
  archive: new Set(["ready", "active", "blocked", "review", "completed"]),
  tombstone: new Set(["proposed", "authorized", "ready", "active", "blocked", "review", "completed", "archived"]),
  restore: new Set(["archived", "deleted_tombstone"]),
  correct: new Set(["proposed", "authorized", "ready", "active", "blocked", "review", "completed"]),
  mark_source_unavailable: new Set(["proposed", "authorized", "ready", "active", "blocked", "review", "completed"])
});
const PRIVATE_CACHE_HEADERS = Object.freeze({
  "cache-control": "private, no-store",
  "content-type": "application/json; charset=utf-8",
  "vary": "authorization",
  "x-content-type-options": "nosniff"
});

function sendJson(response, status, body) {
  const payload = JSON.stringify(body);
  response.writeHead(status, {
    ...PRIVATE_CACHE_HEADERS,
    "content-length": Buffer.byteLength(payload)
  });
  response.end(payload);
}

function deny(response) {
  sendJson(response, 404, { error: "not_found" });
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasExactKeys(value, expected) {
  if (!isObject(value)) return false;
  const keys = Object.keys(value).sort();
  const sorted = [...expected].sort();
  return keys.length === sorted.length && keys.every((key, index) => key === sorted[index]);
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (isObject(value)) {
    return `{${Object.keys(value).sort().map((key) =>
      `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

async function readJsonBody(request) {
  let size = 0;
  const chunks = [];
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) return null;
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    return null;
  }
}

function parseRoute(rawUrl) {
  const url = new URL(rawUrl ?? "/", "http://private.invalid");
  if (url.searchParams.size !== 0) return null;
  const parts = url.pathname.split("/").filter(Boolean);
  if (![5, 6, 7, 8].includes(parts.length)) return null;
  if (parts[0] !== "api" || parts[1] !== "private" || parts[2] !== "tenants" || parts[4] !== "records") return null;
  if (parts.length === 7 && !new Set(["history", "trace"]).has(parts[6])) return null;
  if (parts.length === 8 && !new Set(["history", "evidence"]).has(parts[6])) return null;
  return {
    tenantId: parts[3],
    recordId: parts[5] ?? null,
    mode: parts.length === 5 ? "collection" : parts.length === 6 ? "record" :
      parts.length === 7 ? parts[6] : parts[6] === "history" ? "audit" : "evidence",
    auditEventId: parts[6] === "history" ? parts[7] ?? null : null,
    evidenceId: parts[6] === "evidence" ? parts[7] ?? null : null
  };
}

function createRecord(body, tenantId, recordId, recordedAt) {
  if (!hasExactKeys(body, ["expectedRevision", "record", "requestId"]) ||
      typeof body.requestId !== "string" || !REQUEST_ID.test(body.requestId) || !isObject(body.record) ||
      ["tenantId", "recordId", "recordedAt", "updatedAt", "revision"].some((key) => Object.hasOwn(body.record, key))) {
    return null;
  }
  return {
    ...body.record,
    recordId,
    tenantId,
    recordedAt,
    updatedAt: recordedAt,
    revision: 1
  };
}

function creationAudit(record, authorization, auditEventId) {
  return {
    auditEventId,
    tenantId: record.tenantId,
    recordId: record.recordId,
    eventKind: "creation",
    actor: { tenantId: record.tenantId, subjectId: authorization.authentication.subjectId },
    onBehalfOf: null,
    authorizationRef: authorization.authorizationRef,
    policyRevision: authorization.policyRevision,
    occurredAt: record.recordedAt,
    recordedAt: record.recordedAt,
    priorRevision: 0,
    newRevision: 1,
    changedFields: [{ field: "recordId", before: null, after: record.recordId }],
    reasonRef: null,
    source: record.source
  };
}

function validMutationRequestShape(body) {
  if (!hasExactKeys(body, ["action", "changes", "expectedRevision", "requestId"]) ||
      !REQUEST_ID.test(body.requestId) || !Number.isSafeInteger(body.expectedRevision)) {
    return false;
  }
  if (body.action === "rename") {
    return hasExactKeys(body.changes, ["title"]) && typeof body.changes.title === "string";
  }
  if (body.action === "reassign") {
    return hasExactKeys(body.changes, ["assignees"]) && Array.isArray(body.changes.assignees);
  }
  if (body.action === "block") return hasExactKeys(body.changes, ["blockReason"]);
  if (new Set(["unblock", "archive", "tombstone", "restore"]).has(body.action)) {
    return hasExactKeys(body.changes, []);
  }
  if (body.action === "correct") return hasExactKeys(body.changes, ["supersedes"]);
  return body.action === "mark_source_unavailable" &&
    hasExactKeys(body.changes, ["availability"]) && body.changes.availability === "unavailable";
}

function lifecycleAllowsMutation(action, sourceState) {
  return MUTATION_SOURCE_STATES[action]?.has(sourceState) === true;
}

function materialAuditValue(value) {
  if (value === null) return null;
  return typeof value === "string" ? value : canonicalJson(value);
}

function expectedMutationAudit(action, current, next) {
  const contracts = {
    rename: ["rename", ["title"]],
    reassign: ["reassignment", ["assignees"]],
    block: ["block", ["state", "stateChangedAt", "blockReason"]],
    unblock: ["unblock", ["state", "stateChangedAt", "blockReason"]],
    archive: ["archive", ["state", "stateChangedAt", "archivedAt", "blockReason"]],
    tombstone: ["delete_tombstone", ["state", "stateChangedAt", "deletedAt", "blockReason"]],
    restore: ["state_transition", ["state", "stateChangedAt", "archivedAt", "deletedAt", "blockReason"]],
    correct: ["correction", ["supersedes"]],
    mark_source_unavailable: ["state_transition", ["freshness"]]
  };
  const contract = contracts[action];
  if (!contract) return null;
  const changedFields = contract[1].flatMap((field) => {
    const before = materialAuditValue(current[field]);
    const after = materialAuditValue(next[field]);
    return before === after ? [] : [{ field, before, after }];
  });
  if (action === "tombstone") {
    changedFields.push({
      field: "priorRevisionDigest",
      before: `sha256:${createHash("sha256").update(canonicalJson(current)).digest("hex")}`,
      after: null
    });
  }
  return changedFields.length === 0 ? null : [contract[0], changedFields];
}

export function validateActionSpecificMutationAudit(audit, action, current, next, authorization) {
  const expected = expectedMutationAudit(action, current, next);
  return expected !== null && audit.tenantId === current.tenantId && audit.recordId === current.recordId &&
    audit.actor?.tenantId === current.tenantId &&
    audit.actor?.subjectId === authorization.authentication.subjectId &&
    audit.authorizationRef === authorization.authorizationRef &&
    audit.policyRevision === authorization.policyRevision &&
    audit.priorRevision === current.revision && audit.newRevision === next.revision &&
    audit.eventKind === expected[0] && canonicalJson(audit.changedFields) === canonicalJson(expected[1]);
}

export function validateTraceCompletionAudit(audit, current, next, trace, authorization) {
  const expectedChanges = [
    { field: "assignees", before: canonicalJson(current.assignees), after: canonicalJson(next.assignees) },
    { field: "evidenceLinks", before: canonicalJson(current.evidenceLinks), after: canonicalJson(next.evidenceLinks) },
    { field: "state", before: current.state, after: "completed" },
    { field: "completedAt", before: current.completedAt, after: next.completedAt }
  ];
  return audit.tenantId === current.tenantId && audit.recordId === current.recordId &&
    audit.eventKind === "outcome_acceptance" && audit.actor?.tenantId === current.tenantId &&
    audit.actor?.subjectId === authorization.authentication.subjectId && audit.onBehalfOf === null &&
    audit.authorizationRef === authorization.authorizationRef &&
    audit.policyRevision === authorization.policyRevision && audit.priorRevision === current.revision &&
    audit.newRevision === next.revision && audit.occurredAt === trace.outcome.acceptedAt &&
    audit.recordedAt === next.updatedAt && audit.reasonRef === trace.direction.directionId &&
    canonicalJson(audit.source) === canonicalJson(trace.assignment.source) &&
    canonicalJson(audit.changedFields) === canonicalJson(expectedChanges);
}

export function validateEvidenceAvailabilityAudit(audit, current, next, authorization) {
  const expectedChanges = [{
    field: "evidenceLinks",
    before: canonicalJson(current.evidenceLinks),
    after: canonicalJson(next.evidenceLinks)
  }];
  return audit.tenantId === current.tenantId && audit.recordId === current.recordId &&
    audit.eventKind === "evidence_detach" && audit.actor?.tenantId === current.tenantId &&
    audit.actor?.subjectId === authorization.authentication.subjectId && audit.onBehalfOf === null &&
    audit.authorizationRef === authorization.authorizationRef &&
    audit.policyRevision === authorization.policyRevision && audit.priorRevision === current.revision &&
    audit.newRevision === next.revision && audit.occurredAt === next.updatedAt &&
    audit.recordedAt === next.updatedAt && audit.reasonRef === null &&
    canonicalJson(audit.source) === canonicalJson(current.source) &&
    canonicalJson(audit.changedFields) === canonicalJson(expectedChanges);
}

function materialMutation(body, record, authorization, recordedAt, auditEventId) {
  if (!validMutationRequestShape(body)) return null;
  let eventKind;
  let changedFields;
  let changedRecord;
  if (body.action === "rename" && hasExactKeys(body.changes, ["title"]) &&
      typeof body.changes.title === "string") {
    eventKind = "rename";
    changedFields = [{ field: "title", before: record.title, after: body.changes.title }];
    changedRecord = { ...record, title: body.changes.title };
  } else if (body.action === "reassign" && hasExactKeys(body.changes, ["assignees"]) &&
      Array.isArray(body.changes.assignees)) {
    eventKind = "reassignment";
    changedFields = [{
      field: "assignees",
      before: JSON.stringify(record.assignees),
      after: JSON.stringify(body.changes.assignees)
    }];
    changedRecord = { ...record, assignees: body.changes.assignees };
  } else if (body.action === "block" && hasExactKeys(body.changes, ["blockReason"]) &&
      record.state !== "blocked") {
    eventKind = "block";
    changedFields = [
      { field: "state", before: record.state, after: "blocked" },
      { field: "blockReason", before: null, after: JSON.stringify(body.changes.blockReason) }
    ];
    changedRecord = {
      ...record,
      state: "blocked",
      stateChangedAt: recordedAt,
      blockReason: body.changes.blockReason
    };
  } else if (body.action === "unblock" && hasExactKeys(body.changes, []) && record.state === "blocked") {
    eventKind = "unblock";
    changedFields = [
      { field: "state", before: "blocked", after: "active" },
      { field: "blockReason", before: JSON.stringify(record.blockReason), after: null }
    ];
    changedRecord = {
      ...record,
      state: "active",
      stateChangedAt: recordedAt,
      blockReason: null
    };
  } else if (body.action === "archive" && hasExactKeys(body.changes, []) &&
      !new Set(["archived", "deleted_tombstone"]).has(record.state)) {
    eventKind = "archive";
    changedFields = [{ field: "state", before: record.state, after: "archived" }];
    changedRecord = {
      ...record,
      state: "archived",
      stateChangedAt: recordedAt,
      archivedAt: recordedAt,
      blockReason: null
    };
  } else if (body.action === "tombstone" && hasExactKeys(body.changes, []) &&
      record.state !== "deleted_tombstone") {
    const priorRevisionDigest = `sha256:${createHash("sha256")
      .update(canonicalJson(record)).digest("hex")}`;
    eventKind = "delete_tombstone";
    changedFields = [
      { field: "state", before: record.state, after: "deleted_tombstone" },
      {
        field: "priorRevisionDigest",
        before: priorRevisionDigest,
        after: null
      }
    ];
    changedRecord = {
      ...record,
      state: "deleted_tombstone",
      stateChangedAt: recordedAt,
      deletedAt: recordedAt,
      blockReason: null
    };
  } else if (body.action === "restore" && hasExactKeys(body.changes, []) &&
      new Set(["archived", "deleted_tombstone"]).has(record.state)) {
    const restoredState = record.completedAt === null ? "active" : "completed";
    eventKind = "state_transition";
    changedFields = [
      { field: "state", before: record.state, after: restoredState },
      { field: "archivedAt", before: record.archivedAt, after: null },
      { field: "deletedAt", before: record.deletedAt, after: null }
    ];
    changedRecord = {
      ...record,
      state: restoredState,
      stateChangedAt: recordedAt,
      archivedAt: null,
      deletedAt: null,
      blockReason: null
    };
  } else if (body.action === "correct" && hasExactKeys(body.changes, ["supersedes"])) {
    eventKind = "correction";
    changedFields = [{
      field: "supersedes",
      before: record.supersedes === null ? null : JSON.stringify(record.supersedes),
      after: JSON.stringify(body.changes.supersedes)
    }];
    changedRecord = { ...record, supersedes: body.changes.supersedes };
  } else if (body.action === "mark_source_unavailable" &&
      hasExactKeys(body.changes, ["availability"]) && body.changes.availability === "unavailable") {
    eventKind = "state_transition";
    changedFields = [{ field: "freshness", before: record.freshness, after: "unavailable" }];
    changedRecord = { ...record, freshness: "unavailable" };
  } else {
    return null;
  }
  const nextRecord = {
    ...changedRecord,
    updatedAt: recordedAt,
    revision: record.revision + 1
  };
  const expectedAudit = expectedMutationAudit(body.action, record, nextRecord);
  if (expectedAudit === null) return null;
  [eventKind, changedFields] = expectedAudit;
  return {
    nextRecord,
    auditEvent: {
      auditEventId,
      tenantId: record.tenantId,
      recordId: record.recordId,
      eventKind,
      actor: { tenantId: record.tenantId, subjectId: authorization.authentication.subjectId },
      onBehalfOf: null,
      authorizationRef: authorization.authorizationRef,
      policyRevision: authorization.policyRevision,
      occurredAt: recordedAt,
      recordedAt,
      priorRevision: record.revision,
      newRevision: record.revision + 1,
      changedFields,
      reasonRef: null,
      source: record.source
    }
  };
}

export function createPrivateWorkRecordsApiHandler({
  store,
  domain,
  resolveTrustedIdentity,
  resolveTrustedReferences,
  resolveTracePolicy,
  now = Date.now,
  generateId
}) {
  if (!store || !domain || typeof resolveTrustedIdentity !== "function" ||
      typeof resolveTrustedReferences !== "function" || typeof resolveTracePolicy !== "function" ||
      typeof generateId !== "function") {
    throw new TypeError("private work-record dependencies are required");
  }
  return async function privateWorkRecordsApiHandler(request, response) {
    try {
      const route = parseRoute(request.url);
      if (route === null) return deny(response);
      const facts = await resolveTrustedIdentity(request);
      const trusted = domain.createTrustedAuthorizationContext(facts);
      if (!trusted.ok || !trusted.value.authentication.authenticated || !trusted.value.membership.active ||
          trusted.value.membership.tenantId !== route.tenantId) {
        return deny(response);
      }
      const authorization = trusted.value;

      if (route.mode === "evidence" && request.method === "GET") {
        const record = store.read(route.tenantId, route.recordId);
        const trace = store.readTrace(route.tenantId, route.recordId);
        const evidence = trace?.evidence.find((item) => item.evidenceId === route.evidenceId);
        if (record === null || trace === null || evidence === undefined) return deny(response);
        const decision = domain.authorizeAction({
          authorization, action: "resolve_evidence", tenantId: route.tenantId, record
        });
        if (!decision.allowed || await resolveTracePolicy({
          tenantId: route.tenantId, principalId: authorization.authentication.subjectId,
          policyRevision: authorization.policyRevision, action: "read", link: "evidence", value: evidence,
          recordSensitivity: record.sensitivity, authorizationScope: record.recordId,
          evidenceSensitivity: evidence.sensitivity,
          locatorClass: evidence.locator.startsWith("internal:") ? "internal_object" : "https_repository_artifact",
          availability: evidence.availability, relation: evidence.relation
        }) !== true) return deny(response);
        const inspectable = new Set(["available", "stale"]).has(evidence.availability);
        if (inspectable) {
          return sendJson(response, 200, {
            state: evidence.availability, inspectable: true,
            decision: { allowed: true, code: "allowed" }, evidence
          });
        }
        const { locator: _hiddenLocator, ...citation } = evidence;
        return sendJson(response, 200, {
          state: evidence.availability, inspectable: false,
          decision: { allowed: true, code: "allowed" }, evidence: citation
        });
      }

      if (route.mode === "evidence" && request.method === "PATCH") {
        if (request.headers["content-type"]?.split(";", 1)[0].trim().toLowerCase() !== "application/json") {
          return deny(response);
        }
        const current = store.read(route.tenantId, route.recordId);
        const trace = store.readTrace(route.tenantId, route.recordId);
        if (current === null || trace === null) return deny(response);
        const body = await readJsonBody(request);
        if (!hasExactKeys(body, ["availability", "expectedRevision", "requestId"]) ||
            !new Set(["unavailable", "withdrawn"]).has(body.availability) ||
            !Number.isSafeInteger(body.expectedRevision) || !REQUEST_ID.test(body.requestId)) return deny(response);
        const decision = domain.authorizeAction({
          authorization, action: "update_evidence_availability", tenantId: route.tenantId, record: current
        });
        if (!decision.allowed) return deny(response);
        const requestIdentity = {
          tenantId: route.tenantId, recordId: route.recordId,
          principalId: authorization.authentication.subjectId,
          authorizationRef: authorization.authorizationRef, policyRevision: authorization.policyRevision,
          requestId: body.requestId,
          requestSemantics: canonicalJson({
            recordId: route.recordId, evidenceId: route.evidenceId,
            availability: body.availability, expectedRevision: body.expectedRevision
          })
        };
        const replay = store.replayMutation(requestIdentity);
        if (replay !== null) {
          if (!replay.ok) return sendJson(response, 409, { error: "conflict" });
          return sendJson(response, 200, { record: replay.record });
        }
        const evidenceIndex = trace.evidence.findIndex((item) => item.evidenceId === route.evidenceId);
        if (evidenceIndex < 0) return deny(response);
        const currentEvidence = trace.evidence[evidenceIndex];
        if (currentEvidence.availability === body.availability ||
            (currentEvidence.availability === "withdrawn" && body.availability === "unavailable")) return deny(response);
        if (await resolveTracePolicy({
          tenantId: route.tenantId, principalId: authorization.authentication.subjectId,
          policyRevision: authorization.policyRevision, action: "write", link: "evidence", value: currentEvidence,
          recordSensitivity: current.sensitivity, authorizationScope: current.recordId,
          evidenceSensitivity: currentEvidence.sensitivity,
          locatorClass: currentEvidence.locator.startsWith("internal:") ? "internal_object" : "https_repository_artifact",
          availability: currentEvidence.availability, relation: currentEvidence.relation
        }) !== true) return deny(response);
        let recordedAt;
        try {
          const timestamp = now();
          if (!Number.isFinite(timestamp)) return deny(response);
          recordedAt = new Date(timestamp).toISOString();
        } catch {
          return deny(response);
        }
        const nextEvidence = { ...currentEvidence, availability: body.availability };
        const nextEvidenceLinks = current.evidenceLinks.map((item) =>
          item.evidenceId === route.evidenceId ? nextEvidence : item);
        const nextTrace = {
          ...trace,
          evidence: trace.evidence.map((item) => item.evidenceId === route.evidenceId ? nextEvidence : item)
        };
        const nextRecord = {
          ...current, evidenceLinks: nextEvidenceLinks, updatedAt: recordedAt, revision: current.revision + 1
        };
        const recordValidation = domain.validateWorkRecord(nextRecord);
        if (!recordValidation.ok) return deny(response);
        const auditEvent = {
          auditEventId: generateId("audit"), tenantId: route.tenantId, recordId: route.recordId,
          eventKind: "evidence_detach",
          actor: { tenantId: route.tenantId, subjectId: authorization.authentication.subjectId },
          onBehalfOf: null, authorizationRef: authorization.authorizationRef,
          policyRevision: authorization.policyRevision, occurredAt: recordedAt, recordedAt,
          priorRevision: current.revision, newRevision: current.revision + 1,
          changedFields: [{
            field: "evidenceLinks", before: canonicalJson(current.evidenceLinks), after: canonicalJson(nextEvidenceLinks)
          }],
          reasonRef: null, source: current.source
        };
        const auditValidation = domain.validateMaterialAuditEvent(auditEvent, current, authorization);
        if (!auditValidation.ok || !validateEvidenceAvailabilityAudit(
          auditValidation.value, current, recordValidation.value, authorization
        )) return deny(response);
        const result = store.mutateEvidence(
          recordValidation.value, auditValidation.value, nextTrace, body.expectedRevision, requestIdentity
        );
        if (!result.ok) return sendJson(response, 409, { error: "conflict" });
        return sendJson(response, 200, { record: result.record });
      }

      if (route.mode === "trace" && request.method === "POST") {
        if (request.headers["content-type"]?.split(";", 1)[0].trim().toLowerCase() !== "application/json") {
          return deny(response);
        }
        const current = store.read(route.tenantId, route.recordId);
        if (current === null) return deny(response);
        const decision = domain.authorizeAction({
          authorization, action: "write_trace", tenantId: route.tenantId, record: current
        });
        if (!decision.allowed) return deny(response);
        const body = await readJsonBody(request);
        if (!hasExactKeys(body, ["expectedRevision", "requestId", "trace"]) ||
            !Number.isSafeInteger(body.expectedRevision) || !REQUEST_ID.test(body.requestId)) return deny(response);
        const requestIdentity = {
          tenantId: route.tenantId, recordId: route.recordId,
          principalId: authorization.authentication.subjectId,
          authorizationRef: authorization.authorizationRef, policyRevision: authorization.policyRevision,
          requestId: body.requestId,
          requestSemantics: canonicalJson({ recordId: route.recordId, trace: body.trace, expectedRevision: body.expectedRevision })
        };
        const replay = store.replayMutation(requestIdentity);
        if (replay !== null) {
          if (!replay.ok) return sendJson(response, 409, { error: "conflict" });
          return sendJson(response, 200, { record: replay.record });
        }
        if (new Set(["archived", "deleted_tombstone", "completed"]).has(current.state)) return deny(response);
        const traceValidation = domain.validateTraceBundle(body.trace);
        if (!traceValidation.ok || traceValidation.value.tenantId !== route.tenantId ||
            traceValidation.value.recordId !== route.recordId ||
            traceValidation.value.assignment.acceptedRevision !== body.expectedRevision ||
            traceValidation.value.assignment.owner.subjectId !== current.owner.subjectId ||
            traceValidation.value.outcome.acceptanceActor.subjectId !== authorization.authentication.subjectId ||
            traceValidation.value.authorization.authorizationId !== authorization.authorizationRef ||
            traceValidation.value.authorization.policyRevision !== authorization.policyRevision) return deny(response);
        for (const [link, value] of [
          ["direction", traceValidation.value.direction],
          ["authorization", traceValidation.value.authorization],
          ["assignment", traceValidation.value.assignment],
          ["activity", traceValidation.value.activities],
          ...traceValidation.value.evidence.map((evidence) => ["evidence", evidence]),
          ["outcome", traceValidation.value.outcome]
        ]) {
          const evidenceInputs = link === "evidence" ? {
            evidenceSensitivity: value.sensitivity,
            locatorClass: value.locator.startsWith("internal:")
              ? "internal_object" : "https_repository_artifact",
            availability: value.availability,
            relation: value.relation
          } : {};
          if (await resolveTracePolicy({
            tenantId: route.tenantId, principalId: authorization.authentication.subjectId,
            policyRevision: authorization.policyRevision, action: "write", link, value,
            recordSensitivity: current.sensitivity, authorizationScope: current.recordId,
            ...evidenceInputs
          }) !== true) return deny(response);
        }
        let recordedAt;
        try {
          const timestamp = now();
          if (!Number.isFinite(timestamp)) return deny(response);
          recordedAt = new Date(timestamp).toISOString();
        } catch {
          return deny(response);
        }
        const nextRecord = {
          ...current,
          assignees: traceValidation.value.assignment.assignees,
          evidenceLinks: traceValidation.value.evidence,
          state: "completed",
          stateChangedAt: recordedAt,
          completedAt: recordedAt,
          updatedAt: recordedAt,
          revision: current.revision + 1
        };
        const nextValidation = domain.validateWorkRecord(nextRecord);
        if (!nextValidation.ok) return deny(response);
        const auditEvent = {
          auditEventId: generateId("audit"), tenantId: route.tenantId, recordId: route.recordId,
          eventKind: "outcome_acceptance",
          actor: { tenantId: route.tenantId, subjectId: authorization.authentication.subjectId },
          onBehalfOf: null, authorizationRef: authorization.authorizationRef,
          policyRevision: authorization.policyRevision, occurredAt: traceValidation.value.outcome.acceptedAt,
          recordedAt, priorRevision: current.revision, newRevision: current.revision + 1,
          changedFields: [
            { field: "assignees", before: canonicalJson(current.assignees), after: canonicalJson(nextRecord.assignees) },
            { field: "evidenceLinks", before: canonicalJson(current.evidenceLinks), after: canonicalJson(nextRecord.evidenceLinks) },
            { field: "state", before: current.state, after: "completed" },
            { field: "completedAt", before: current.completedAt, after: recordedAt }
          ],
          reasonRef: traceValidation.value.direction.directionId,
          source: traceValidation.value.assignment.source
        };
        const auditValidation = domain.validateMaterialAuditEvent(auditEvent, current, authorization);
        if (!auditValidation.ok || !validateTraceCompletionAudit(
          auditValidation.value, current, nextValidation.value, traceValidation.value, authorization
        )) return deny(response);
        const result = store.completeTrace(
          nextValidation.value, auditValidation.value, traceValidation.value, body.expectedRevision, requestIdentity
        );
        if (!result.ok) return sendJson(response, 409, { error: "conflict" });
        return sendJson(response, result.replayed ? 200 : 201, { record: result.record });
      }

      if (route.mode === "trace" && request.method === "GET") {
        const record = store.read(route.tenantId, route.recordId);
        const trace = store.readTrace(route.tenantId, route.recordId);
        if (record === null || trace === null) return deny(response);
        const decision = domain.authorizeAction({
          authorization, action: "read_trace", tenantId: route.tenantId, record
        });
        if (!decision.allowed) return deny(response);
        const edges = [];
        for (const [link, value] of [
          ["direction", trace.direction], ["authorization", trace.authorization],
          ["assignment", trace.assignment], ["activity", trace.activities],
          ...trace.evidence.map((evidence) => ["evidence", evidence]), ["outcome", trace.outcome]
        ]) {
          const evidenceInputs = link === "evidence" ? {
            evidenceSensitivity: value.sensitivity,
            locatorClass: value.locator.startsWith("internal:")
              ? "internal_object" : "https_repository_artifact",
            availability: value.availability,
            relation: value.relation
          } : {};
          const allowed = await resolveTracePolicy({
            tenantId: route.tenantId, principalId: authorization.authentication.subjectId,
            policyRevision: authorization.policyRevision, action: "read", link, value,
            recordSensitivity: record.sensitivity, authorizationScope: record.recordId,
            ...evidenceInputs
          }) === true;
          const state = link === "evidence" ? value.availability : "available";
          const projectedValue = link === "evidence"
            ? (() => {
              if (new Set(["available", "stale"]).has(value.availability)) return value;
              const { locator: _hiddenLocator, ...citation } = value;
              return citation;
            })()
            : value;
          edges.push(allowed
            ? { link, state, decision: { allowed: true, code: "allowed" }, value: projectedValue }
            : { link, state: "not_authorized", decision: { allowed: false, code: "not_authorized" } });
        }
        return sendJson(response, 200, {
          trace: { tenantId: route.tenantId, recordId: route.recordId, edges }
        });
      }

      if (request.method === "GET" && (route.mode === "history" || route.mode === "audit")) {
        const record = store.read(route.tenantId, route.recordId);
        if (record === null) return deny(response);
        const decision = domain.authorizeAction({
          authorization,
          action: "read_history",
          tenantId: route.tenantId,
          record
        });
        if (!decision.allowed) return deny(response);
        if (route.mode === "audit") {
          const event = store.readAudit(route.tenantId, route.recordId, route.auditEventId);
          return event === null ? deny(response) : sendJson(response, 200, { event });
        }
        return sendJson(response, 200, {
          record: {
            tenantId: record.tenantId,
            recordId: record.recordId,
            recordType: record.recordType,
            state: record.state,
            revision: record.revision
          },
          events: store.history(route.tenantId, route.recordId)
        });
      }

      if (request.method === "PATCH" && route.mode === "record") {
        if (request.headers["content-type"]?.split(";", 1)[0].trim().toLowerCase() !== "application/json") {
          return deny(response);
        }
        const current = store.read(route.tenantId, route.recordId);
        if (current === null) return deny(response);
        const body = await readJsonBody(request);
        const decision = domain.authorizeAction({
          authorization,
          action: body?.action === "reassign" ? "assign" :
            body?.action === "archive" ? "archive" :
              body?.action === "tombstone" ? "delete" :
                new Set(["block", "unblock", "restore"]).has(body?.action) ? "transition" : "update",
          tenantId: route.tenantId,
          record: current
        });
        if (!decision.allowed) return deny(response);
        if (!validMutationRequestShape(body)) return deny(response);
        if (!lifecycleAllowsMutation(body.action, current.state)) return deny(response);
        const requestIdentity = {
          tenantId: route.tenantId,
          recordId: route.recordId,
          principalId: authorization.authentication.subjectId,
          authorizationRef: authorization.authorizationRef,
          policyRevision: authorization.policyRevision,
          requestId: body.requestId,
          requestSemantics: canonicalJson({ recordId: route.recordId, mutation: body })
        };
        const replay = store.replayMutation(requestIdentity);
        if (replay !== null) {
          if (!replay.ok) return sendJson(response, 409, { error: "conflict" });
          return sendJson(response, 200, { record: replay.record });
        }
        let recordedAt;
        try {
          const timestamp = now();
          if (!Number.isFinite(timestamp)) return deny(response);
          recordedAt = new Date(timestamp).toISOString();
        } catch {
          return deny(response);
        }
        const mutation = materialMutation(body, current, authorization, recordedAt, generateId("audit"));
        if (mutation === null) return deny(response);
        const recordValidation = domain.validateWorkRecord(mutation.nextRecord);
        if (!recordValidation.ok) return deny(response);
        const referencesAllowed = await resolveTrustedReferences({
          tenantId: route.tenantId,
          principalId: authorization.authentication.subjectId,
          authorizationRef: authorization.authorizationRef,
          policyRevision: authorization.policyRevision,
          record: recordValidation.value
        });
        if (referencesAllowed !== true) return deny(response);
        const auditValidation = domain.validateMaterialAuditEvent(mutation.auditEvent, current, authorization);
        if (!auditValidation.ok) return deny(response);
        if (!validateActionSpecificMutationAudit(
          auditValidation.value, body.action, current, recordValidation.value, authorization
        )) return deny(response);
        const result = store.mutate(
          recordValidation.value,
          auditValidation.value,
          body.expectedRevision,
          requestIdentity
        );
        if (!result.ok) return sendJson(response, 409, { error: "conflict" });
        return sendJson(response, 200, { record: result.record });
      }

      if (request.method === "POST" && route.mode === "collection") {
        if (request.headers["content-type"]?.split(";", 1)[0].trim().toLowerCase() !== "application/json") {
          return deny(response);
        }
        const body = await readJsonBody(request);
        let recordedAt;
        try {
          const timestamp = now();
          if (!Number.isFinite(timestamp)) return deny(response);
          recordedAt = new Date(timestamp).toISOString();
        } catch {
          return deny(response);
        }
        const record = createRecord(body, route.tenantId, generateId("record"), recordedAt);
        if (record === null) return deny(response);
        const validation = domain.validateWorkRecord(record);
        if (!validation.ok) return deny(response);
        const referencesAllowed = await resolveTrustedReferences({
          tenantId: route.tenantId,
          principalId: authorization.authentication.subjectId,
          authorizationRef: authorization.authorizationRef,
          policyRevision: authorization.policyRevision,
          record: validation.value
        });
        if (referencesAllowed !== true) return deny(response);
        const decision = domain.authorizeAction({
          authorization,
          action: CREATE_AUTHORIZATION_ACTION,
          tenantId: route.tenantId,
          record: validation.value
        });
        if (!decision.allowed) return deny(response);
        const auditValidation = domain.validateCreationAuditEvent(
          creationAudit(validation.value, authorization, generateId("audit")),
          validation.value,
          authorization
        );
        if (!auditValidation.ok) return deny(response);
        const result = store.create(
          validation.value,
          auditValidation.value,
          body.expectedRevision,
          {
            tenantId: route.tenantId,
            principalId: authorization.authentication.subjectId,
            authorizationRef: authorization.authorizationRef,
            policyRevision: authorization.policyRevision,
            requestId: body.requestId,
            requestSemantics: canonicalJson({ expectedRevision: body.expectedRevision, record: body.record })
          }
        );
        if (!result.ok) return sendJson(response, 409, { error: "conflict" });
        if (result.replayed) return sendJson(response, 200, { record: result.record });
        return sendJson(response, 201, { record: validation.value });
      }

      if (request.method === "GET" && route.mode === "record") {
        const record = store.read(route.tenantId, route.recordId);
        if (record === null || record.state === "deleted_tombstone") return deny(response);
        const decision = domain.authorizeAction({
          authorization,
          action: "read",
          tenantId: route.tenantId,
          record
        });
        if (!decision.allowed) return deny(response);
        return sendJson(response, 200, { record });
      }

      if (request.method === "GET" && route.mode === "collection") {
        if (!authorization.permissions.includes("read")) return deny(response);
        const records = store.list(route.tenantId, 50);
        for (const record of records) {
          const decision = domain.authorizeAction({
            authorization,
            action: "read",
            tenantId: route.tenantId,
            record
          });
          if (!decision.allowed) return deny(response);
        }
        return sendJson(response, 200, { records, count: records.length, cursor: null });
      }

      return deny(response);
    } catch {
      if (!response.headersSent) sendJson(response, 500, { error: "internal_error" });
      else response.destroy();
    }
  };
}
