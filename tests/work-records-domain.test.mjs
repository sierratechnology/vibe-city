import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

async function loadDomain() {
  const source = await readFile(new URL("../src/domain/workRecords.ts", import.meta.url), "utf8");
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022
    }
  }).outputText;
  const domain = await import(`data:text/javascript;base64,${Buffer.from(transpiled).toString("base64")}`);
  trustedAuthorizationFactory = domain.createTrustedAuthorizationContext;
  return domain;
}

let trustedAuthorizationFactory;

const TENANT_ID = "id_1111111111111111";
const FOREIGN_TENANT_ID = "id_2222222222222222";
const SUBJECT_ID = "id_3333333333333333";
const ASSIGNEE_ID = "id_4444444444444444";
const RECORD_ID = "id_5555555555555555";
const SOURCE_ID = "id_6666666666666666";
const EVIDENCE_ID = "id_7777777777777777";
const AUDIT_ID = "id_8888888888888888";
const AUTHORIZATION_ID = "id_9999999999999999";
const OCCURRED_AT = "2026-07-28T20:00:00.000Z";
const OBSERVED_AT = "2026-07-28T20:01:00.000Z";
const RECORDED_AT = "2026-07-28T20:02:00.000Z";
const UPDATED_AT = "2026-07-28T20:03:00.000Z";
const MUTATION_AT = "2026-07-28T20:04:00.000Z";

function subject(subjectId = SUBJECT_ID, tenantId = TENANT_ID) {
  return { tenantId, subjectId };
}

function source(tenantId = TENANT_ID) {
  return {
    tenantId,
    sourceId: SOURCE_ID,
    sourceRecordId: "opaque-source-record",
    sourceEventId: "opaque-source-event",
    contractVersion: "1.0",
    occurredAt: OCCURRED_AT,
    observedAt: OBSERVED_AT
  };
}

function evidence(tenantId = TENANT_ID) {
  return {
    evidenceId: EVIDENCE_ID,
    tenantId,
    relation: "supports",
    locator: "internal:opaque-evidence-object",
    label: "Synthetic evidence",
    sensitivity: "tenant_private",
    integrity: null,
    sourceOccurredAt: OCCURRED_AT,
    observedAt: OBSERVED_AT,
    recordedAt: RECORDED_AT,
    availability: "available"
  };
}

function record(overrides = {}) {
  return {
    schemaVersion: "1.0",
    recordId: RECORD_ID,
    tenantId: TENANT_ID,
    recordType: "work_item",
    title: "Synthetic work record",
    owner: subject(),
    assignees: [subject(ASSIGNEE_ID)],
    state: "active",
    freshness: "stale",
    blockReason: null,
    evidenceLinks: [evidence()],
    source: source(),
    sensitivity: "tenant_private",
    recordedAt: RECORDED_AT,
    updatedAt: UPDATED_AT,
    stateChangedAt: UPDATED_AT,
    completedAt: null,
    archivedAt: null,
    deletedAt: null,
    revision: 3,
    supersedes: null,
    ...overrides
  };
}

function authorization(overrides = {}) {
  const facts = {
    authentication: { authenticated: true, subjectId: SUBJECT_ID },
    membership: { active: true, tenantId: TENANT_ID },
    permissions: ["read"],
    decisionAuthorities: [],
    authorizationRef: AUTHORIZATION_ID,
    policyRevision: 7,
    ...overrides
  };
  delete facts.provenance;
  const result = trustedAuthorizationFactory?.(facts);
  return result?.ok ? result.value : { provenance: "backend_trusted", ...facts };
}

function auditEvent(overrides = {}) {
  return {
    auditEventId: AUDIT_ID,
    tenantId: TENANT_ID,
    recordId: RECORD_ID,
    eventKind: "state_transition",
    actor: subject(),
    onBehalfOf: null,
    authorizationRef: AUTHORIZATION_ID,
    policyRevision: 7,
    occurredAt: UPDATED_AT,
    recordedAt: UPDATED_AT,
    priorRevision: 3,
    newRevision: 4,
    changedFields: [{ field: "state", before: "active", after: "review" }],
    reasonRef: null,
    source: source(),
    ...overrides
  };
}

function initialRecord(overrides = {}) {
  return record({
    state: "proposed",
    revision: 1,
    recordedAt: RECORDED_AT,
    updatedAt: RECORDED_AT,
    stateChangedAt: null,
    ...overrides
  });
}

function creationAuditEvent(overrides = {}) {
  return auditEvent({
    eventKind: "creation",
    occurredAt: RECORDED_AT,
    recordedAt: RECORDED_AT,
    priorRevision: 0,
    newRevision: 1,
    changedFields: [fieldChange("recordId", null, RECORD_ID)],
    ...overrides
  });
}

function fieldChange(field, before, after) {
  return { field, before, after };
}

function blockReason(overrides = {}) {
  return {
    category: "dependency",
    summary: "Synthetic dependency is unavailable.",
    resolutionAuthority: subject(),
    blockedAt: UPDATED_AT,
    ...overrides
  };
}

function blockReasonAuditValue(reason) {
  return JSON.stringify({
    category: reason.category,
    summary: reason.summary,
    resolutionAuthority: reason.resolutionAuthority,
    blockedAt: reason.blockedAt
  });
}

function tenantIdentity(overrides = {}) {
  return {
    tenantId: TENANT_ID,
    displayName: "Synthetic tenant",
    lifecycle: "active",
    recordedAt: RECORDED_AT,
    updatedAt: UPDATED_AT,
    archivedAt: null,
    deletedAt: null,
    ...overrides
  };
}

test("work record validation rejects missing or mismatched tenant, owner, source, sensitivity, and durable timestamps", async () => {
  const { validateWorkRecord } = await loadDomain();
  const cases = [
    [{ ...record(), tenantId: undefined }, "invalid_tenant"],
    [{ ...record(), owner: subject(SUBJECT_ID, FOREIGN_TENANT_ID) }, "foreign_owner"],
    [{ ...record(), source: source(FOREIGN_TENANT_ID) }, "foreign_source"],
    [{ ...record(), sensitivity: undefined }, "invalid_sensitivity"],
    [{ ...record(), recordedAt: undefined }, "invalid_timestamp"],
    [{ ...record(), updatedAt: RECORDED_AT, recordedAt: UPDATED_AT }, "invalid_chronology"]
  ];

  for (const [candidate, code] of cases) {
    assert.deepEqual(validateWorkRecord(candidate), { ok: false, code });
  }
});

test("authorization rejects client-asserted tenant, membership, role, permission, or authority", async () => {
  const { authorizeAction } = await loadDomain();
  for (const clientAssertions of [
    { tenantId: TENANT_ID },
    { membership: "active" },
    { role: "administrator" },
    { permission: "delete" },
    { authority: "publication" }
  ]) {
    assert.deepEqual(authorizeAction({
      authorization: authorization(),
      clientAssertions,
      action: "read",
      tenantId: TENANT_ID,
      record: record()
    }), { allowed: false, code: "untrusted_client_claim" });
  }
});

test("authentication without active tenant membership is denied", async () => {
  const { authorizeAction } = await loadDomain();
  assert.deepEqual(authorizeAction({
    authorization: authorization({ membership: { active: false, tenantId: TENANT_ID } }),
    action: "read",
    tenantId: TENANT_ID,
    record: record()
  }), { allowed: false, code: "inactive_membership" });
});

test("read permission does not grant assignment, transition, archive, delete, or publication", async () => {
  const { authorizeAction } = await loadDomain();
  assert.deepEqual(authorizeAction({
    authorization: authorization(),
    action: "read",
    tenantId: TENANT_ID,
    record: record()
  }), { allowed: true, code: "allowed" });

  for (const action of ["assign", "transition", "archive", "delete", "project_public"]) {
    assert.deepEqual(authorizeAction({
      authorization: authorization(),
      action,
      tenantId: TENANT_ID,
      record: record()
    }), { allowed: false, code: "missing_permission" });
  }
});

test("create authorization is distinct from update authorization", async () => {
  const { authorizeAction } = await loadDomain();
  assert.deepEqual(authorizeAction({
    authorization: authorization({ permissions: ["create"] }),
    action: "create",
    tenantId: TENANT_ID,
    record: initialRecord()
  }), { allowed: true, code: "allowed" });
  assert.deepEqual(authorizeAction({
    authorization: authorization({ permissions: ["update"] }),
    action: "create",
    tenantId: TENANT_ID,
    record: initialRecord()
  }), { allowed: false, code: "missing_permission" });
});

test("creation audit contract binds actor authority source chronology and zero-to-one revision", async () => {
  const { validateCreationAuditEvent, validateMaterialAuditEvent } = await loadDomain();
  const trusted = authorization({ permissions: ["create"] });
  assert.equal(validateCreationAuditEvent(creationAuditEvent(), initialRecord(), trusted).ok, true);
  assert.deepEqual(validateMaterialAuditEvent(creationAuditEvent(), initialRecord(), trusted), {
    ok: false,
    code: "invalid_audit_revision"
  });
  const malformed = [
    creationAuditEvent({ actor: subject(ASSIGNEE_ID) }),
    creationAuditEvent({ authorizationRef: "id_aaaaaaaaaaaaaaaa" }),
    creationAuditEvent({ policyRevision: 8 }),
    creationAuditEvent({ source: { ...source(), sourceRecordId: "substituted" } }),
    creationAuditEvent({ occurredAt: OCCURRED_AT }),
    creationAuditEvent({ priorRevision: 1 }),
    creationAuditEvent({ changedFields: [fieldChange("title", null, "fabricated")] })
  ];
  for (const candidate of malformed) {
    assert.equal(validateCreationAuditEvent(candidate, initialRecord(), trusted).ok, false);
  }
});

test("tenant validation rejects foreign owner, assignee, evidence, source, supersession, and audit references", async () => {
  const { validateMaterialAuditEvent, validateWorkRecord } = await loadDomain();
  const cases = [
    [record({ owner: subject(SUBJECT_ID, FOREIGN_TENANT_ID) }), "foreign_owner"],
    [record({ assignees: [subject(ASSIGNEE_ID, FOREIGN_TENANT_ID)] }), "foreign_assignee"],
    [record({ evidenceLinks: [evidence(FOREIGN_TENANT_ID)] }), "foreign_evidence"],
    [record({ source: source(FOREIGN_TENANT_ID) }), "foreign_source"],
    [record({ supersedes: { tenantId: FOREIGN_TENANT_ID, recordId: "id_aaaaaaaaaaaaaaaa" } }), "foreign_supersession"]
  ];
  for (const [candidate, code] of cases) {
    assert.deepEqual(validateWorkRecord(candidate), { ok: false, code });
  }
  assert.deepEqual(
    validateMaterialAuditEvent(auditEvent({ tenantId: FOREIGN_TENANT_ID }), record()),
    { ok: false, code: "foreign_audit_reference" }
  );
});

test("state transition rejects invalid lifecycle edges and invalid block-state reason pairing", async () => {
  const { transitionWorkRecord, validateWorkRecord } = await loadDomain();
  assert.deepEqual(transitionWorkRecord({
    record: record(),
    nextState: "proposed",
    blockReason: null,
    expectedRevision: 3,
    auditEvent: auditEvent(),
    authorization: authorization({ permissions: ["transition"] })
  }), { ok: false, code: "invalid_transition" });

  assert.deepEqual(validateWorkRecord(record({ state: "blocked", blockReason: null })), {
    ok: false,
    code: "invalid_block_reason"
  });
  assert.deepEqual(validateWorkRecord(record({ state: "active", blockReason: blockReason() })), {
    ok: false,
    code: "invalid_block_reason"
  });
});

test("material transition rejects stale expected revision or missing audit event", async () => {
  const { transitionWorkRecord } = await loadDomain();
  const base = {
    record: record(),
    nextState: "review",
    blockReason: null,
    expectedRevision: 3,
    auditEvent: auditEvent(),
    authorization: authorization({ permissions: ["transition"] })
  };
  assert.deepEqual(transitionWorkRecord({ ...base, expectedRevision: 2 }), {
    ok: false,
    code: "stale_revision"
  });
  assert.deepEqual(transitionWorkRecord({ ...base, auditEvent: null }), {
    ok: false,
    code: "missing_audit_event"
  });
});

test("sensitivity downgrade requires explicit publication decision authority", async () => {
  const { changeWorkRecordSensitivity } = await loadDomain();
  const base = {
    record: record({ sensitivity: "tenant_restricted" }),
    nextSensitivity: "tenant_private",
    expectedRevision: 3,
    auditEvent: auditEvent({
      eventKind: "sensitivity_change",
      changedFields: [fieldChange("sensitivity", "tenant_restricted", "tenant_private")]
    }),
    authorization: authorization({ permissions: ["update"], decisionAuthorities: [] })
  };
  assert.deepEqual(changeWorkRecordSensitivity(base), {
    ok: false,
    code: "missing_publication_authority"
  });
});

test("lifecycle state and freshness are validated as separate facts", async () => {
  const { validateWorkRecord } = await loadDomain();
  assert.deepEqual(validateWorkRecord(record({ state: "stale" })), {
    ok: false,
    code: "invalid_lifecycle"
  });
  assert.deepEqual(validateWorkRecord(record({ freshness: "active" })), {
    ok: false,
    code: "invalid_freshness"
  });
  assert.equal(validateWorkRecord(record({ state: "active", freshness: "stale" })).ok, true);
  assert.equal(validateWorkRecord(record({
    state: "completed",
    freshness: "stale",
    completedAt: UPDATED_AT
  })).ok, true);
});

test("durable timestamp semantics use recordedAt without an ambiguous createdAt alias", async () => {
  const { DURABLE_TIMESTAMP_SEMANTICS, validateWorkRecord } = await loadDomain();
  assert.equal(
    DURABLE_TIMESTAMP_SEMANTICS,
    "recordedAt is durable system acceptance; occurredAt and observedAt preserve source timing"
  );
  assert.deepEqual(validateWorkRecord(record({ createdAt: RECORDED_AT })), {
    ok: false,
    code: "ambiguous_durable_timestamp"
  });
});

test("tenant identity validation preserves immutable opaque tenant scope", async () => {
  const { updateTenantIdentity, validateTenantIdentity } = await loadDomain();
  assert.equal(validateTenantIdentity(tenantIdentity()).ok, true);
  assert.deepEqual(updateTenantIdentity({
    tenant: tenantIdentity(),
    changes: { tenantId: FOREIGN_TENANT_ID, displayName: "Renamed tenant" },
    updatedAt: MUTATION_AT
  }), { ok: false, code: "immutable_tenant_scope" });
});

test("authorization fails closed when trusted membership, requested tenant, and record scope differ", async () => {
  const { authorizeAction } = await loadDomain();
  const cases = [
    { authorization: authorization(), tenantId: FOREIGN_TENANT_ID, record: record() },
    { authorization: authorization(), tenantId: TENANT_ID, record: record({ tenantId: FOREIGN_TENANT_ID }) },
    {
      authorization: authorization({ membership: { active: true, tenantId: FOREIGN_TENANT_ID } }),
      tenantId: TENANT_ID,
      record: record()
    }
  ];
  for (const candidate of cases) {
    assert.deepEqual(authorizeAction({ ...candidate, action: "read" }), {
      allowed: false,
      code: "tenant_scope_mismatch"
    });
  }
});

test("authorized state transition returns one revised record with its material audit event", async () => {
  const { transitionWorkRecord } = await loadDomain();
  const materialEvent = auditEvent({
    eventKind: "block",
    occurredAt: MUTATION_AT,
    recordedAt: MUTATION_AT,
    changedFields: [
      fieldChange("state", "active", "blocked"),
      fieldChange("blockReason", null, blockReasonAuditValue(blockReason({ blockedAt: MUTATION_AT })))
    ]
  });
  const result = transitionWorkRecord({
    record: record(),
    nextState: "blocked",
    blockReason: blockReason({ blockedAt: MUTATION_AT }),
    expectedRevision: 3,
    auditEvent: materialEvent,
    authorization: authorization({ permissions: ["transition"] })
  });
  assert.equal(result.ok, true);
  assert.equal(result.value.record.tenantId, TENANT_ID);
  assert.equal(result.value.record.state, "blocked");
  assert.equal(result.value.record.freshness, "stale");
  assert.equal(result.value.record.revision, 4);
  assert.equal(result.value.record.updatedAt, MUTATION_AT);
  assert.deepEqual(result.value.auditEvent, materialEvent);
});

test("publication-authorized sensitivity downgrade returns one audited revision", async () => {
  const { changeWorkRecordSensitivity } = await loadDomain();
  const materialEvent = auditEvent({
    eventKind: "sensitivity_change",
    occurredAt: MUTATION_AT,
    recordedAt: MUTATION_AT,
    changedFields: [fieldChange("sensitivity", "tenant_restricted", "tenant_private")]
  });
  const result = changeWorkRecordSensitivity({
    record: record({ sensitivity: "tenant_restricted" }),
    nextSensitivity: "tenant_private",
    expectedRevision: 3,
    auditEvent: materialEvent,
    authorization: authorization({
      permissions: ["update"],
      decisionAuthorities: ["publication"]
    })
  });
  assert.equal(result.ok, true);
  assert.equal(result.value.record.sensitivity, "tenant_private");
  assert.equal(result.value.record.revision, 4);
  assert.equal(result.value.record.updatedAt, MUTATION_AT);
  assert.deepEqual(result.value.auditEvent, materialEvent);
});

test("source lineage and evidence validators reject malformed identity, sensitivity, and timestamp chronology", async () => {
  const { validateEvidenceReference, validateSourceReference } = await loadDomain();
  assert.deepEqual(validateSourceReference({ ...source(), sourceId: undefined }, TENANT_ID), {
    ok: false,
    code: "invalid_source"
  });
  assert.deepEqual(validateSourceReference({
    ...source(),
    occurredAt: OBSERVED_AT,
    observedAt: OCCURRED_AT
  }, TENANT_ID), { ok: false, code: "invalid_source_chronology" });
  assert.deepEqual(validateEvidenceReference({ ...evidence(), sensitivity: undefined }, TENANT_ID), {
    ok: false,
    code: "invalid_evidence_sensitivity"
  });
  assert.deepEqual(validateEvidenceReference({ ...evidence(), recordedAt: OCCURRED_AT }, TENANT_ID), {
    ok: false,
    code: "invalid_evidence_chronology"
  });
});

test("work record validation applies nested source and evidence contracts", async () => {
  const { validateWorkRecord } = await loadDomain();
  assert.deepEqual(validateWorkRecord(record({ source: { ...source(), sourceId: undefined } })), {
    ok: false,
    code: "invalid_source"
  });
  assert.deepEqual(validateWorkRecord(record({
    evidenceLinks: [{ ...evidence(), recordedAt: OCCURRED_AT }]
  })), { ok: false, code: "invalid_evidence_chronology" });
});

test("publication permission and publication decision authority are distinct requirements", async () => {
  const { authorizeAction } = await loadDomain();
  for (const sensitivity of ["tenant_private", "tenant_restricted"]) {
    assert.deepEqual(authorizeAction({
      action: "project_public",
      tenantId: TENANT_ID,
      record: record({ sensitivity }),
      authorization: authorization({
        permissions: ["project_public"],
        decisionAuthorities: ["publication"]
      })
    }), { allowed: false, code: "non_public_sensitivity" });
  }
  const request = {
    action: "project_public",
    tenantId: TENANT_ID,
    record: record({
      sensitivity: "public_approved",
      evidenceLinks: [{ ...evidence(), sensitivity: "public_approved" }]
    })
  };
  assert.deepEqual(authorizeAction({
    ...request,
    authorization: authorization({ permissions: ["project_public"] })
  }), { allowed: false, code: "missing_decision_authority" });
  assert.deepEqual(authorizeAction({
    ...request,
    authorization: authorization({
      permissions: ["project_public"],
      decisionAuthorities: ["publication"]
    })
  }), { allowed: true, code: "allowed" });
});

test("tenant rename changes only mutable identity facts", async () => {
  const { updateTenantIdentity } = await loadDomain();
  const result = updateTenantIdentity({
    tenant: tenantIdentity(),
    changes: { displayName: "Renamed synthetic tenant" },
    updatedAt: MUTATION_AT
  });
  assert.deepEqual(result, {
    ok: true,
    value: tenantIdentity({ displayName: "Renamed synthetic tenant", updatedAt: MUTATION_AT })
  });
});

test("work record validation rejects unknown fields, non-opaque identities, duplicate assignees, and invalid revisions", async () => {
  const { validateWorkRecord } = await loadDomain();
  const cases = [
    [record({ unexpectedClientField: true }), "unknown_or_missing_field"],
    [record({ recordId: "readable-record-id" }), "invalid_identifier"],
    [record({ owner: subject("readable-subject-id") }), "invalid_identifier"],
    [record({ assignees: [subject(ASSIGNEE_ID), subject(ASSIGNEE_ID)] }), "duplicate_assignee"],
    [record({ revision: 0 }), "invalid_revision"]
  ];
  for (const [candidate, code] of cases) {
    assert.deepEqual(validateWorkRecord(candidate), { ok: false, code });
  }
});

test("work record lifecycle timestamps match state and durable chronology", async () => {
  const { validateWorkRecord } = await loadDomain();
  const cases = [
    [record({ state: "completed", completedAt: null }), "invalid_lifecycle_timestamp"],
    [record({ state: "active", completedAt: MUTATION_AT }), "invalid_lifecycle_timestamp"],
    [record({ state: "archived", archivedAt: null }), "invalid_lifecycle_timestamp"],
    [record({ state: "deleted_tombstone", deletedAt: null }), "invalid_lifecycle_timestamp"],
    [record({ stateChangedAt: undefined }), "invalid_state_changed_at"],
    [record({ stateChangedAt: OBSERVED_AT }), "invalid_chronology"]
  ];
  for (const [candidate, code] of cases) {
    assert.deepEqual(validateWorkRecord(candidate), { ok: false, code });
  }
});

test("authorization fails closed for malformed unconstructed context and unknown actions", async () => {
  const { authorizeAction } = await loadDomain();
  const request = { tenantId: TENANT_ID, record: record(), action: "read" };
  for (const malformed of [
    authorization({ authentication: { authenticated: true, subjectId: null } }),
    authorization({ permissions: null }),
    authorization({ authorizationRef: "readable-reference" }),
    authorization({ policyRevision: 0 })
  ]) {
    assert.deepEqual(authorizeAction({ ...request, authorization: malformed }), {
      allowed: false,
      code: "untrusted_authorization_input"
    });
  }
  assert.deepEqual(authorizeAction({
    ...request,
    action: "unknown_action",
    authorization: authorization({ permissions: ["unknown_action"] })
  }), { allowed: false, code: "unknown_action" });
});

test("material transitions reject audit actor impersonation and backward durable append times", async () => {
  const { transitionWorkRecord } = await loadDomain();
  const base = {
    record: record(),
    nextState: "review",
    blockReason: null,
    expectedRevision: 3,
    authorization: authorization({ permissions: ["transition"] })
  };
  assert.deepEqual(transitionWorkRecord({
    ...base,
    auditEvent: auditEvent({ actor: subject(ASSIGNEE_ID) })
  }), { ok: false, code: "audit_actor_mismatch" });
  assert.deepEqual(transitionWorkRecord({
    ...base,
    auditEvent: auditEvent({ occurredAt: RECORDED_AT, recordedAt: RECORDED_AT })
  }), { ok: false, code: "invalid_audit_timestamp" });
});

test("evidence validation rejects unsafe locators and malformed closed metadata", async () => {
  const { validateEvidenceReference } = await loadDomain();
  const cases = [
    [{ ...evidence(), relation: "unknown" }, "invalid_evidence_relation"],
    [{ ...evidence(), availability: "unknown" }, "invalid_evidence_availability"],
    [{ ...evidence(), locator: "javascript:alert(1)" }, "invalid_evidence_locator"],
    [{ ...evidence(), integrity: { algorithm: "md5", digest: "abc" } }, "invalid_evidence_integrity"],
    [{ ...evidence(), integrity: { algorithm: "sha256", digest: "a".repeat(64) } }, null]
  ];
  for (const [candidate, code] of cases) {
    const result = validateEvidenceReference(candidate, TENANT_ID);
    if (code === null) assert.equal(result.ok, true);
    else assert.deepEqual(result, { ok: false, code });
  }
});

test("material audit validation enforces closed events exact deltas and source chronology", async () => {
  const { transitionWorkRecord, validateMaterialAuditEvent } = await loadDomain();
  assert.deepEqual(validateMaterialAuditEvent(auditEvent({ eventKind: "invented" }), record()), {
    ok: false,
    code: "invalid_audit_event_kind"
  });
  assert.deepEqual(validateMaterialAuditEvent(auditEvent({
    changedFields: [fieldChange("state", "active", "review"), fieldChange("state", "active", "review")]
  }), record()), {
    ok: false,
    code: "invalid_audit_changed_fields"
  });
  assert.deepEqual(validateMaterialAuditEvent(auditEvent({
    occurredAt: OBSERVED_AT,
    source: { ...source(), observedAt: RECORDED_AT }
  }), record()), { ok: false, code: "invalid_audit_source_chronology" });
  assert.deepEqual(transitionWorkRecord({
    record: record(),
    nextState: "review",
    blockReason: null,
    expectedRevision: 3,
    auditEvent: auditEvent({
      eventKind: "sensitivity_change",
      changedFields: [fieldChange("state", "active", "review")]
    }),
    authorization: authorization({ permissions: ["transition"] })
  }), { ok: false, code: "invalid_audit_contract" });
});

test("work record validation rejects malformed block and supersession references", async () => {
  const { validateWorkRecord } = await loadDomain();
  const cases = [
    [record({ state: "blocked", blockReason: { ...blockReason(), summary: "" } }), "invalid_block_reason"],
    [record({ state: "blocked", blockReason: blockReason({
      resolutionAuthority: subject(SUBJECT_ID, FOREIGN_TENANT_ID)
    }) }), "foreign_block_authority"],
    [record({ state: "blocked", blockReason: blockReason({ blockedAt: OCCURRED_AT }) }), "invalid_block_timestamp"],
    [record({ supersedes: { tenantId: TENANT_ID, recordId: "readable-id" } }), "invalid_supersession"],
    [record({ supersedes: { tenantId: TENANT_ID, recordId: RECORD_ID } }), "self_supersession"]
  ];
  for (const [candidate, code] of cases) {
    assert.deepEqual(validateWorkRecord(candidate), { ok: false, code });
  }
});

test("work record and source validation enforce closed bounded core values", async () => {
  const { validateSourceReference, validateWorkRecord } = await loadDomain();
  const cases = [
    [record({ schemaVersion: "2.0" }), "invalid_schema_version"],
    [record({ recordType: "unknown" }), "invalid_record_type"],
    [record({ title: "   " }), "invalid_title"],
    [record({ title: "x".repeat(201) }), "invalid_title"]
  ];
  for (const [candidate, code] of cases) {
    assert.deepEqual(validateWorkRecord(candidate), { ok: false, code });
  }
  assert.deepEqual(validateSourceReference({ ...source(), sourceEventId: 42 }, TENANT_ID), {
    ok: false,
    code: "invalid_source"
  });
  assert.equal(validateSourceReference({ ...source(), sourceEventId: null }, TENANT_ID).ok, true);
});

test("tenant identity lifecycle requires consistent durable timestamps", async () => {
  const { validateTenantIdentity } = await loadDomain();
  const cases = [
    [tenantIdentity({ lifecycle: "unknown" }), "invalid_tenant_lifecycle"],
    [tenantIdentity({ lifecycle: "active", archivedAt: MUTATION_AT }), "invalid_tenant_lifecycle_timestamp"],
    [tenantIdentity({ lifecycle: "archived", archivedAt: null }), "invalid_tenant_lifecycle_timestamp"],
    [tenantIdentity({ lifecycle: "deleted_tombstone", deletedAt: null }), "invalid_tenant_lifecycle_timestamp"],
    [tenantIdentity({ lifecycle: "archived", archivedAt: OCCURRED_AT }), "invalid_tenant_chronology"]
  ];
  for (const [candidate, code] of cases) {
    assert.deepEqual(validateTenantIdentity(candidate), { ok: false, code });
  }
  assert.equal(validateTenantIdentity(tenantIdentity({
    lifecycle: "archived",
    archivedAt: UPDATED_AT
  })).ok, true);
});

test("review adversarial paths fail closed without mutation-authority or nested-schema bypasses", async () => {
  const { authorizeAction, transitionWorkRecord, validateEvidenceReference, validateWorkRecord } = await loadDomain();
  const archiveEvent = auditEvent({
    eventKind: "archive",
    changedFields: [fieldChange("state", "active", "archived")]
  });
  assert.deepEqual(transitionWorkRecord({
    record: record(), nextState: "archived", blockReason: null, expectedRevision: 3,
    auditEvent: archiveEvent, authorization: authorization({ permissions: ["transition"] })
  }), { ok: false, code: "missing_permission" });
  assert.doesNotThrow(() => validateWorkRecord(null));
  assert.deepEqual(validateWorkRecord(null), { ok: false, code: "invalid_tenant" });
  assert.deepEqual(validateEvidenceReference({ ...evidence(), locator: "https://unapproved.example/item" }, TENANT_ID), {
    ok: false,
    code: "invalid_evidence_locator"
  });
  assert.deepEqual(validateEvidenceReference({ ...evidence(), credential: "synthetic-secret" }, TENANT_ID), {
    ok: false,
    code: "unknown_evidence_field"
  });
  assert.deepEqual(authorizeAction({
    authorization: authorization({ permissions: ["project_public"], decisionAuthorities: ["publication"] }),
    action: "project_public",
    tenantId: TENANT_ID,
    record: record({
      sensitivity: "public_approved",
      evidenceLinks: [evidence(TENANT_ID)]
    })
  }), { allowed: false, code: "nested_sensitivity_not_public" });
});

test("second review adversarial cases bind exact schemas timestamps records and policy revision", async () => {
  const { authorizeAction, updateTenantIdentity, validateMaterialAuditEvent, validateWorkRecord } = await loadDomain();
  assert.deepEqual(validateWorkRecord(record({ owner: { ...subject(), credential: "synthetic" } })), {
    ok: false,
    code: "invalid_owner"
  });
  assert.deepEqual(validateWorkRecord(record({ completedAt: 42 })), {
    ok: false,
    code: "invalid_timestamp"
  });
  assert.doesNotThrow(() => updateTenantIdentity(null));
  assert.deepEqual(updateTenantIdentity(null), { ok: false, code: "invalid_tenant_update" });
  assert.deepEqual(validateMaterialAuditEvent(auditEvent({ policyRevision: 8 }), record(), authorization()), {
    ok: false,
    code: "audit_policy_revision_mismatch"
  });
  assert.deepEqual(authorizeAction({
    authorization: authorization({ permissions: ["project_public"], decisionAuthorities: ["publication"] }),
    action: "project_public",
    tenantId: TENANT_ID,
    record: { ...record({
      sensitivity: "public_approved",
      evidenceLinks: [{ ...evidence(), sensitivity: "public_approved" }]
    }), privatePayload: "synthetic" }
  }), { allowed: false, code: "invalid_record" });
});

test("plain caller-authored authorization provenance is never trusted", async () => {
  const { authorizeAction } = await loadDomain();
  assert.deepEqual(authorizeAction({
    authorization: { ...authorization(), role: "synthetic-administrator" },
    action: "read",
    tenantId: TENANT_ID,
    record: record()
  }), { allowed: false, code: "untrusted_authorization_input" });
});

test("record-bound authorization requires a complete validated record", async () => {
  const { authorizeAction } = await loadDomain();
  for (const candidate of [undefined, { tenantId: TENANT_ID }]) {
    assert.deepEqual(authorizeAction({
      authorization: authorization({ permissions: ["read"] }),
      action: "read",
      tenantId: TENANT_ID,
      record: candidate
    }), { allowed: false, code: "invalid_record" });
  }
});

test("block transition rejects a fabricated block reason audit delta", async () => {
  const { transitionWorkRecord } = await loadDomain();
  assert.deepEqual(transitionWorkRecord({
    record: record(),
    nextState: "blocked",
    blockReason: blockReason({ blockedAt: MUTATION_AT }),
    expectedRevision: 3,
    auditEvent: auditEvent({
      eventKind: "block",
      occurredAt: MUTATION_AT,
      recordedAt: MUTATION_AT,
      changedFields: [
        fieldChange("state", "active", "blocked"),
        fieldChange("blockReason", "fabricated-before", "fabricated-after")
      ]
    }),
    authorization: authorization({ permissions: ["transition"] })
  }), { ok: false, code: "invalid_audit_contract" });
});

test("structured domain inputs reject unknown fields at every nested boundary", async () => {
  const { createTrustedAuthorizationContext, validateEvidenceReference, validateTenantIdentity, validateWorkRecord } = await loadDomain();
  const candidates = [
    validateTenantIdentity(tenantIdentity({ clientAuthority: true })),
    validateWorkRecord(record({
      state: "blocked",
      blockReason: { ...blockReason(), clientAuthority: true }
    })),
    validateWorkRecord(record({
      state: "blocked",
      blockReason: blockReason({ resolutionAuthority: { ...subject(), clientAuthority: true } })
    })),
    validateWorkRecord(record({
      supersedes: { tenantId: TENANT_ID, recordId: "id_aaaaaaaaaaaaaaaa", clientAuthority: true }
    })),
    validateEvidenceReference({
      ...evidence(),
      integrity: { algorithm: "sha256", digest: "a".repeat(64), clientAuthority: true }
    }, TENANT_ID),
    createTrustedAuthorizationContext({
      authentication: { authenticated: true, subjectId: SUBJECT_ID, role: "synthetic" },
      membership: { active: true, tenantId: TENANT_ID },
      permissions: ["read"],
      decisionAuthorities: [],
      authorizationRef: AUTHORIZATION_ID,
      policyRevision: 7
    })
  ];
  for (const result of candidates) assert.equal(result.ok, false);
});

test("evidence labels and locators enforce reviewed length boundaries", async () => {
  const { validateEvidenceReference } = await loadDomain();
  assert.equal(validateEvidenceReference({ ...evidence(), label: "x".repeat(200) }, TENANT_ID).ok, true);
  assert.equal(validateEvidenceReference({ ...evidence(), locator: `internal:${"x".repeat(491)}` }, TENANT_ID).ok, true);
  assert.deepEqual(validateEvidenceReference({ ...evidence(), label: "x".repeat(201) }, TENANT_ID), {
    ok: false,
    code: "invalid_evidence"
  });
  assert.deepEqual(validateEvidenceReference({
    ...evidence(), locator: `internal:${"x".repeat(492)}`
  }, TENANT_ID), { ok: false, code: "invalid_evidence" });
});

test("freshness is derived from exact trusted source health facts", async () => {
  const { deriveFreshnessFromSourceFacts, validateWorkRecord } = await loadDomain();
  const facts = {
    sourceAvailability: "active",
    activeSessionHealthy: true,
    observedAt: OBSERVED_AT,
    evaluatedAt: UPDATED_AT,
    liveHealthWindowMs: 120_000,
    recentWindowMs: 86_400_000
  };
  assert.deepEqual(deriveFreshnessFromSourceFacts(facts), { ok: true, value: "live" });
  assert.deepEqual(deriveFreshnessFromSourceFacts({ ...facts, activeSessionHealthy: false }), {
    ok: true,
    value: "recent"
  });
  assert.equal(deriveFreshnessFromSourceFacts({ ...facts, callerSelected: "live" }).ok, false);
  assert.deepEqual(validateWorkRecord(record({ freshness: "live" })), {
    ok: false,
    code: "unsubstantiated_freshness"
  });
  assert.deepEqual(validateWorkRecord(record({ freshness: "recent" })), {
    ok: false,
    code: "unsubstantiated_freshness"
  });
});

test("stateChangedAt is null only for the initial proposed revision", async () => {
  const { validateWorkRecord } = await loadDomain();
  assert.equal(validateWorkRecord(record({
    state: "proposed",
    revision: 1,
    stateChangedAt: null,
    updatedAt: RECORDED_AT
  })).ok, true);
  assert.deepEqual(validateWorkRecord(record({ stateChangedAt: null })), {
    ok: false,
    code: "invalid_state_changed_at"
  });
});

test("transition request rejects clientAuthority and other unknown top-level fields", async () => {
  const { transitionWorkRecord } = await loadDomain();
  const request = {
    record: record(),
    nextState: "review",
    blockReason: null,
    expectedRevision: 3,
    auditEvent: auditEvent({
      occurredAt: MUTATION_AT,
      recordedAt: MUTATION_AT
    }),
    authorization: authorization({ permissions: ["transition"] })
  };
  for (const unknownField of ["clientAuthority", "unexpectedTopLevelField"]) {
    assert.deepEqual(transitionWorkRecord({ ...request, [unknownField]: true }), {
      ok: false,
      code: "invalid_transition_input"
    });
  }
});

test("sensitivity request rejects clientAuthority and other unknown top-level fields", async () => {
  const { changeWorkRecordSensitivity } = await loadDomain();
  const request = {
    record: record({ sensitivity: "tenant_restricted" }),
    nextSensitivity: "tenant_private",
    expectedRevision: 3,
    auditEvent: auditEvent({
      eventKind: "sensitivity_change",
      occurredAt: MUTATION_AT,
      recordedAt: MUTATION_AT,
      changedFields: [fieldChange("sensitivity", "tenant_restricted", "tenant_private")]
    }),
    authorization: authorization({
      permissions: ["update"],
      decisionAuthorities: ["publication"]
    })
  };
  for (const unknownField of ["clientAuthority", "unexpectedTopLevelField"]) {
    assert.deepEqual(changeWorkRecordSensitivity({ ...request, [unknownField]: true }), {
      ok: false,
      code: "invalid_sensitivity_input"
    });
  }
});

test("tenant update request rejects clientAuthority and other unknown top-level fields", async () => {
  const { updateTenantIdentity } = await loadDomain();
  const request = {
    tenant: tenantIdentity(),
    changes: { displayName: "Renamed synthetic tenant" },
    updatedAt: MUTATION_AT
  };
  for (const unknownField of ["clientAuthority", "unexpectedTopLevelField"]) {
    assert.deepEqual(updateTenantIdentity({ ...request, [unknownField]: true }), {
      ok: false,
      code: "invalid_tenant_update"
    });
  }
});
