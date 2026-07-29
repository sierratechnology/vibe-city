import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { copyFileSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { backup } from "node:sqlite";
import test from "node:test";
import ts from "typescript";

const TENANT_A = "id_1111111111111111";
const TENANT_B = "id_2222222222222222";
const SUBJECT_A = "id_3333333333333333";
const SUBJECT_B = "id_4444444444444444";
const SOURCE_ID = "id_5555555555555555";
const AUTHORIZATION_ID = "id_6666666666666666";
const REQUEST_ID = "id_9999999999999999";
const NOW = "2026-07-29T01:00:00.000Z";
const OCCURRED_AT = "2026-07-29T00:58:00.000Z";
const OBSERVED_AT = "2026-07-29T00:59:00.000Z";

async function loadDomain() {
  const source = await readFile(new URL("../src/domain/workRecords.ts", import.meta.url), "utf8");
  const transpiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 }
  }).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(transpiled).toString("base64")}`);
}

function facts({
  tenantId = TENANT_A,
  subjectId = SUBJECT_A,
  active = true,
  permissions = ["read", "create"],
  authorizationRef = AUTHORIZATION_ID,
  policyRevision = 1
} = {}) {
  return {
    authentication: { authenticated: true, subjectId },
    membership: { active, tenantId },
    permissions,
    decisionAuthorities: [],
    authorizationRef,
    policyRevision
  };
}

function createBody(overrides = {}) {
  return {
    expectedRevision: 0,
    requestId: REQUEST_ID,
    record: {
      schemaVersion: "1.0",
      recordType: "work_item",
      title: "Synthetic private work record",
      owner: { tenantId: TENANT_A, subjectId: SUBJECT_A },
      assignees: [],
      state: "proposed",
      freshness: "stale",
      blockReason: null,
      evidenceLinks: [],
      source: {
        tenantId: TENANT_A,
        sourceId: SOURCE_ID,
        sourceRecordId: "synthetic-source-record",
        sourceEventId: null,
        contractVersion: "1.0",
        occurredAt: OCCURRED_AT,
        observedAt: OBSERVED_AT
      },
      sensitivity: "tenant_private",
      stateChangedAt: null,
      completedAt: null,
      archivedAt: null,
      deletedAt: null,
      supersedes: null,
      ...overrides
    }
  };
}

function mutationBody(action, expectedRevision, changes, requestId = "id_aaaaaaaaaaaaaaaa") {
  return { action, expectedRevision, requestId, changes };
}

function traceBody(recordId, overrides = {}) {
  const evidence = {
    evidenceId: "id_cccccccccccccccc", tenantId: TENANT_A, relation: "result",
    locator: "internal:synthetic-result", label: "Synthetic result", sensitivity: "tenant_private",
    integrity: null, sourceOccurredAt: OCCURRED_AT, observedAt: OBSERVED_AT,
    recordedAt: NOW, availability: "available"
  };
  return {
    expectedRevision: 1,
    requestId: "id_bbbbbbbbbbbbbbbb",
    trace: {
      tenantId: TENANT_A,
      recordId,
      direction: {
        directionId: "id_dddddddddddddddd", tenantId: TENANT_A,
        directingSubject: { tenantId: TENANT_A, subjectId: SUBJECT_A },
        source: createBody().record.source, occurredAt: OCCURRED_AT, sensitivity: "tenant_private"
      },
      authorization: {
        authorizationId: AUTHORIZATION_ID, tenantId: TENANT_A, directionId: "id_dddddddddddddddd",
        action: "assign", scope: recordId,
        authorizer: { tenantId: TENANT_A, subjectId: SUBJECT_A },
        beneficiary: { tenantId: TENANT_A, subjectId: SUBJECT_B },
        constraints: ["synthetic-only"], policyRevision: 1, effectiveAt: OBSERVED_AT
      },
      assignment: {
        tenantId: TENANT_A, recordId, authorizationId: AUTHORIZATION_ID,
        owner: { tenantId: TENANT_A, subjectId: SUBJECT_A },
        assignees: [{ tenantId: TENANT_A, subjectId: SUBJECT_B }], acceptedRevision: 1,
        source: createBody().record.source, occurredAt: NOW
      },
      activities: [{
        activityId: "id_eeeeeeeeeeeeeeee", tenantId: TENANT_A, recordId,
        actor: { tenantId: TENANT_A, subjectId: SUBJECT_B }, source: createBody().record.source,
        eventKind: "work_performed", occurredAt: OCCURRED_AT, observedAt: OBSERVED_AT, recordedAt: NOW
      }],
      evidence: [evidence],
      outcome: {
        outcomeId: "id_ffffffffffffffff", tenantId: TENANT_A, recordId,
        acceptanceActor: { tenantId: TENANT_A, subjectId: SUBJECT_A },
        acceptanceAuthorizationId: AUTHORIZATION_ID, requiredEvidenceIds: [evidence.evidenceId], acceptedAt: NOW
      },
      ...overrides
    }
  };
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) =>
      `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function seedLifecycleStateForTest(store, tenantId, recordId, state) {
  const record = store.read(tenantId, recordId);
  const seeded = {
    ...record,
    state,
    stateChangedAt: NOW,
    completedAt: state === "completed" ? NOW : record.completedAt,
    updatedAt: NOW
  };
  store.database.prepare(`
    UPDATE private_work_records SET record_json = ?
    WHERE tenant_id = ? AND record_id = ?
  `).run(JSON.stringify(seeded), tenantId, recordId);
}

async function fixture({
  identities = {}, ids, resolveTrustedReferences, resolveTracePolicy, transformValidatedMutationAudit
} = {}) {
  const [{ createPrivateWorkRecordsApiHandler }, { PrivateWorkRecordsStore }, domain] = await Promise.all([
    import("../server/privateWorkRecordsApi.mjs"),
    import("../server/privateWorkRecordsStore.mjs"),
    loadDomain()
  ]);
  const directory = mkdtempSync(join(tmpdir(), "vibe-private-records-"));
  const databasePath = join(directory, "records.sqlite");
  const store = new PrivateWorkRecordsStore(databasePath);
  let sequence = 0;
  const generateId = ids ?? ((kind) => `id_${(kind === "record" ? 7 : 8).toString().repeat(15)}${sequence++ % 10}`);
  const handlerDomain = typeof transformValidatedMutationAudit === "function" ? {
    ...domain,
    validateMaterialAuditEvent(value, ...args) {
      const validation = domain.validateMaterialAuditEvent(value, ...args);
      return validation.ok
        ? { ok: true, value: transformValidatedMutationAudit(structuredClone(validation.value)) }
        : validation;
    }
  } : domain;
  const handler = createPrivateWorkRecordsApiHandler({
    store,
    domain: handlerDomain,
    now: () => Date.parse(NOW),
    generateId,
    resolveTrustedIdentity: async (request) => identities[request.headers.authorization] ?? null,
    resolveTrustedReferences: resolveTrustedReferences ?? (async ({ tenantId, record }) =>
      record.owner.tenantId === tenantId &&
      record.owner.subjectId === (tenantId === TENANT_A ? SUBJECT_A : SUBJECT_B) &&
      record.assignees.length === 0 && record.evidenceLinks.length === 0 &&
      record.source.tenantId === tenantId && record.source.sourceId === SOURCE_ID &&
      record.supersedes === null),
    resolveTracePolicy: resolveTracePolicy ?? (async () => true)
  });
  const server = createServer(handler);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  return {
    base: `http://127.0.0.1:${address.port}`,
    databasePath,
    directory,
    store,
    async close({ remove = true } = {}) {
      await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
      store.close();
      if (remove) rmSync(directory, { recursive: true, force: true });
    }
  };
}

async function json(response) {
  const resolved = await response;
  return { status: resolved.status, headers: Object.fromEntries(resolved.headers), body: await resolved.json() };
}

test("authorized trace completion atomically persists all six links and returns a policy decision for every edge", async () => {
  const policyCalls = [];
  const context = await fixture({
    identities: { "Bearer tracer": facts({
      permissions: ["read", "create", "write_trace", "read_trace", "resolve_evidence"]
    }) },
    resolveTracePolicy: async (input) => { policyCalls.push(input); return true; }
  });
  try {
    const created = await json(fetch(`${context.base}/api/private/tenants/${TENANT_A}/records`, {
      method: "POST",
      headers: { authorization: "Bearer tracer", "content-type": "application/json" },
      body: JSON.stringify(createBody())
    }));
    const recordId = created.body.record.recordId;
    const completed = await json(fetch(
      `${context.base}/api/private/tenants/${TENANT_A}/records/${recordId}/trace`,
      {
        method: "POST",
        headers: { authorization: "Bearer tracer", "content-type": "application/json" },
        body: JSON.stringify(traceBody(recordId))
      }
    ));
    assert.equal(completed.status, 201);
    assert.equal(completed.body.record.state, "completed");
    assert.equal(completed.body.record.revision, 2);
    assert.equal(context.store.countTraces(TENANT_A), 1);
    assert.equal(context.store.countAudits(TENANT_A), 2);

    const traversed = await json(fetch(
      `${context.base}/api/private/tenants/${TENANT_A}/records/${recordId}/trace`,
      { headers: { authorization: "Bearer tracer" } }
    ));
    assert.equal(traversed.status, 200);
    assert.deepEqual(traversed.body.trace.edges.map(({ link, decision }) => [link, decision]), [
      ["direction", { allowed: true, code: "allowed" }],
      ["authorization", { allowed: true, code: "allowed" }],
      ["assignment", { allowed: true, code: "allowed" }],
      ["activity", { allowed: true, code: "allowed" }],
      ["evidence", { allowed: true, code: "allowed" }],
      ["outcome", { allowed: true, code: "allowed" }]
    ]);
    assert.equal(traversed.headers["cache-control"], "private, no-store");
    const evidenceReadPolicy = policyCalls.find(({ action, link }) => action === "read" && link === "evidence");
    assert.deepEqual(evidenceReadPolicy, {
      tenantId: TENANT_A,
      principalId: SUBJECT_A,
      policyRevision: 1,
      action: "read",
      link: "evidence",
      value: traceBody(recordId).trace.evidence[0],
      recordSensitivity: "tenant_private",
      authorizationScope: recordId,
      evidenceSensitivity: "tenant_private",
      locatorClass: "internal_object",
      availability: "available",
      relation: "result"
    });
    const evidenceWritePolicy = policyCalls.find(({ action, link }) => action === "write" && link === "evidence");
    assert.deepEqual(evidenceWritePolicy, {
      tenantId: TENANT_A,
      principalId: SUBJECT_A,
      policyRevision: 1,
      action: "write",
      link: "evidence",
      value: traceBody(recordId).trace.evidence[0],
      recordSensitivity: "tenant_private",
      authorizationScope: recordId,
      evidenceSensitivity: "tenant_private",
      locatorClass: "internal_object",
      availability: "available",
      relation: "result"
    });
    console.log(`TRACE_FIXTURE ${JSON.stringify(traversed.body)}`);
  } finally {
    await context.close();
  }
});

test("trace and acceptance audit survive clean restart and isolated SQLite restore", async () => {
  const context = await fixture({
    identities: { "Bearer tracer": facts({ permissions: ["read", "create", "write_trace"] }) }
  });
  let contextClosed = false;
  let reopened;
  let restored;
  try {
    const created = await json(fetch(`${context.base}/api/private/tenants/${TENANT_A}/records`, {
      method: "POST",
      headers: { authorization: "Bearer tracer", "content-type": "application/json" },
      body: JSON.stringify(createBody())
    }));
    const recordId = created.body.record.recordId;
    const completion = traceBody(recordId);
    assert.equal((await json(fetch(
      `${context.base}/api/private/tenants/${TENANT_A}/records/${recordId}/trace`,
      {
        method: "POST",
        headers: { authorization: "Bearer tracer", "content-type": "application/json" },
        body: JSON.stringify(completion)
      }
    ))).status, 201);
    const expectedRecord = context.store.read(TENANT_A, recordId);
    const expectedHistory = context.store.history(TENANT_A, recordId);
    await context.close({ remove: false });
    contextClosed = true;

    const { PrivateWorkRecordsStore } = await import("../server/privateWorkRecordsStore.mjs");
    const databasePath = join(context.directory, "records.sqlite");
    reopened = new PrivateWorkRecordsStore(databasePath);
    assert.deepEqual(reopened.read(TENANT_A, recordId), expectedRecord);
    assert.deepEqual(reopened.readTrace(TENANT_A, recordId), completion.trace);
    assert.deepEqual(reopened.history(TENANT_A, recordId), expectedHistory);

    const restoredPath = join(context.directory, "restored.sqlite");
    await backup(reopened.database, restoredPath);
    restored = new PrivateWorkRecordsStore(restoredPath);
    assert.deepEqual(restored.read(TENANT_A, recordId), expectedRecord);
    assert.deepEqual(restored.readTrace(TENANT_A, recordId), completion.trace);
    assert.deepEqual(restored.history(TENANT_A, recordId), expectedHistory);
  } finally {
    restored?.close();
    reopened?.close();
    if (!contextClosed) await context.close({ remove: false });
    rmSync(context.directory, { recursive: true, force: true });
  }
});

test("evidence resolution distinguishes unavailable withdrawn missing and not-authorized without locator bypass", async () => {
  let denyEvidenceRead = false;
  const context = await fixture({
    identities: {
      "Bearer tracer": facts({
        permissions: [
          "read", "create", "write_trace", "read_trace", "resolve_evidence", "update_evidence_availability"
        ]
      }),
      "Bearer locator-holder": facts({ permissions: ["read", "read_trace"] })
    },
    resolveTracePolicy: async ({ action, link }) => !(action === "read" && link === "evidence" && denyEvidenceRead)
  });
  try {
    const created = await json(fetch(`${context.base}/api/private/tenants/${TENANT_A}/records`, {
      method: "POST",
      headers: { authorization: "Bearer tracer", "content-type": "application/json" },
      body: JSON.stringify(createBody())
    }));
    const recordId = created.body.record.recordId;
    const completion = traceBody(recordId);
    const secondEvidence = {
      ...completion.trace.evidence[0],
      evidenceId: "id_bbbbbbbbbbbbbbbb",
      locator: "internal:second-result",
      label: "Second synthetic result"
    };
    completion.trace = {
      ...completion.trace,
      evidence: [...completion.trace.evidence, secondEvidence],
      outcome: {
        ...completion.trace.outcome,
        requiredEvidenceIds: [...completion.trace.outcome.requiredEvidenceIds, secondEvidence.evidenceId]
      }
    };
    assert.equal((await json(fetch(`${context.base}/api/private/tenants/${TENANT_A}/records/${recordId}/trace`, {
      method: "POST",
      headers: { authorization: "Bearer tracer", "content-type": "application/json" },
      body: JSON.stringify(completion)
    }))).status, 201);
    const evidenceId = completion.trace.evidence[0].evidenceId;
    const evidenceUrl = `${context.base}/api/private/tenants/${TENANT_A}/records/${recordId}/evidence/${evidenceId}`;

    const available = await json(fetch(evidenceUrl, { headers: { authorization: "Bearer tracer" } }));
    assert.equal(available.status, 200);
    assert.equal(available.body.state, "available");
    assert.equal(available.body.inspectable, true);
    assert.equal(available.body.evidence.locator, "internal:synthetic-result");

    denyEvidenceRead = true;
    const traceDenied = await json(fetch(
      `${context.base}/api/private/tenants/${TENANT_A}/records/${recordId}/trace`,
      { headers: { authorization: "Bearer tracer" } }
    ));
    const deniedEdge = traceDenied.body.trace.edges.find(({ link }) => link === "evidence");
    assert.deepEqual(deniedEdge, {
      link: "evidence", state: "not_authorized", decision: { allowed: false, code: "not_authorized" }
    });
    assert.equal((await json(fetch(evidenceUrl, {
      headers: { authorization: "Bearer locator-holder" }
    }))).status, 404);
    denyEvidenceRead = false;

    const patchAvailability = (availability, revision, requestId) => json(fetch(evidenceUrl, {
      method: "PATCH",
      headers: { authorization: "Bearer tracer", "content-type": "application/json" },
      body: JSON.stringify({ availability, expectedRevision: revision, requestId })
    }));
    assert.equal((await patchAvailability("unavailable", 2, "id_1111111111111111")).status, 200);
    const unavailable = await json(fetch(evidenceUrl, { headers: { authorization: "Bearer tracer" } }));
    assert.equal(unavailable.body.state, "unavailable");
    assert.equal(unavailable.body.inspectable, false);
    assert.equal(Object.hasOwn(unavailable.body.evidence, "locator"), false);
    const unavailableTrace = await json(fetch(
      `${context.base}/api/private/tenants/${TENANT_A}/records/${recordId}/trace`,
      { headers: { authorization: "Bearer tracer" } }
    ));
    const evidenceEdges = unavailableTrace.body.trace.edges.filter(({ link }) => link === "evidence");
    assert.equal(evidenceEdges.length, 2);
    assert.equal(evidenceEdges[0].state, "unavailable");
    assert.equal(evidenceEdges[0].value.availability, "unavailable");
    assert.equal(Object.hasOwn(evidenceEdges[0].value, "locator"), false);
    assert.equal(evidenceEdges[1].state, "available");
    assert.equal(evidenceEdges[1].value.locator, "internal:second-result");
    assert.equal((await patchAvailability("withdrawn", 3, "id_2222222222222222")).status, 200);
    const withdrawn = await json(fetch(evidenceUrl, { headers: { authorization: "Bearer tracer" } }));
    assert.equal(withdrawn.body.state, "withdrawn");
    assert.equal(withdrawn.body.inspectable, false);
    assert.equal(context.store.history(TENANT_A, recordId).length, 4);
    assert.equal(context.store.readTrace(TENANT_A, recordId).evidence[0].locator, "internal:synthetic-result");

    const missing = await json(fetch(
      `${context.base}/api/private/tenants/${TENANT_A}/records/${recordId}/evidence/id_aaaaaaaaaaaaaaaa`,
      { headers: { authorization: "Bearer tracer" } }
    ));
    assert.equal(missing.status, 404);
    assert.equal((await json(fetch(
      `${context.base}/api/private/tenants/${TENANT_B}/records/${recordId}/evidence/${evidenceId}`,
      { headers: { authorization: "Bearer tracer" } }
    ))).status, 404);
    console.log(`EVIDENCE_STATE_MATRIX ${JSON.stringify({
      available: available.body, notAuthorized: deniedEdge, unavailable: unavailable.body,
      withdrawn: withdrawn.body, missing: missing.body
    })}`);
  } finally {
    await context.close();
  }
});

test("evidence GET and PATCH policy receive only the canonical record authorization scope", async () => {
  const policyCalls = [];
  let requiredScope = null;
  const context = await fixture({
    identities: { "Bearer tracer": facts({
      permissions: ["read", "create", "write_trace", "resolve_evidence", "update_evidence_availability"]
    }) },
    resolveTracePolicy: async (input) => {
      policyCalls.push(input);
      return requiredScope === null || input.authorizationScope === requiredScope;
    }
  });
  try {
    const created = await json(fetch(`${context.base}/api/private/tenants/${TENANT_A}/records`, {
      method: "POST",
      headers: { authorization: "Bearer tracer", "content-type": "application/json" },
      body: JSON.stringify(createBody())
    }));
    const recordId = created.body.record.recordId;
    const completion = traceBody(recordId);
    assert.equal((await json(fetch(
      `${context.base}/api/private/tenants/${TENANT_A}/records/${recordId}/trace`,
      {
        method: "POST",
        headers: { authorization: "Bearer tracer", "content-type": "application/json" },
        body: JSON.stringify(completion)
      }
    ))).status, 201);
    const evidenceId = completion.trace.evidence[0].evidenceId;
    const evidenceUrl = `${context.base}/api/private/tenants/${TENANT_A}/records/${recordId}/evidence/${evidenceId}`;

    policyCalls.length = 0;
    requiredScope = recordId;
    assert.equal((await json(fetch(evidenceUrl, {
      headers: { authorization: "Bearer tracer" }
    }))).status, 200);
    assert.equal(policyCalls.length, 1);
    assert.equal(policyCalls[0].action, "read");
    assert.equal(policyCalls[0].authorizationScope, recordId);
    assert.notEqual(policyCalls[0].authorizationScope, evidenceId);

    policyCalls.length = 0;
    requiredScope = evidenceId;
    const substitutedScopeDenied = await json(fetch(evidenceUrl, {
      headers: { authorization: "Bearer tracer" }
    }));
    assert.equal(substitutedScopeDenied.status, 404);
    assert.deepEqual(substitutedScopeDenied.body, { error: "not_found" });
    assert.equal(policyCalls.length, 1);
    assert.equal(policyCalls[0].authorizationScope, recordId);

    policyCalls.length = 0;
    requiredScope = recordId;
    assert.equal((await json(fetch(evidenceUrl, {
      method: "PATCH",
      headers: { authorization: "Bearer tracer", "content-type": "application/json" },
      body: JSON.stringify({
        availability: "unavailable", expectedRevision: 2, requestId: "id_1111111111111111"
      })
    }))).status, 200);
    assert.equal(policyCalls.length, 1);
    assert.equal(policyCalls[0].action, "write");
    assert.equal(policyCalls[0].authorizationScope, recordId);
    assert.notEqual(policyCalls[0].authorizationScope, evidenceId);
  } finally {
    await context.close();
  }
});

test("trace attack matrix leaves canonical record trace audit and replay unchanged on every rejected or failed completion", async () => {
  const context = await fixture({
    identities: { "Bearer tracer": facts({
      permissions: ["read", "create", "write_trace", "read_trace", "resolve_evidence"]
    }) }
  });
  const postTrace = (recordId, body) => json(fetch(
    `${context.base}/api/private/tenants/${TENANT_A}/records/${recordId}/trace`,
    {
      method: "POST",
      headers: { authorization: "Bearer tracer", "content-type": "application/json" },
      body: JSON.stringify(body)
    }
  ));
  const replayCount = () => Number(context.store.database.prepare(
    "SELECT COUNT(*) AS count FROM private_mutation_requests"
  ).get().count);
  try {
    const created = await json(fetch(`${context.base}/api/private/tenants/${TENANT_A}/records`, {
      method: "POST",
      headers: { authorization: "Bearer tracer", "content-type": "application/json" },
      body: JSON.stringify(createBody())
    }));
    const recordId = created.body.record.recordId;
    const base = traceBody(recordId);
    const foreignSubject = { tenantId: TENANT_B, subjectId: SUBJECT_B };
    const attacks = [
      ["assignment-without-authorization", { ...base.trace, authorization: null }],
      ["activity-without-actor", {
        ...base.trace, activities: [{ ...base.trace.activities[0], actor: null }]
      }],
      ["activity-without-source", {
        ...base.trace, activities: [{ ...base.trace.activities[0], source: null }]
      }],
      ["completion-without-outcome", { ...base.trace, outcome: null }],
      ["completion-without-evidence", { ...base.trace, evidence: [] }],
      ["foreign-direction", {
        ...base.trace,
        direction: { ...base.trace.direction, tenantId: TENANT_B, directingSubject: foreignSubject }
      }],
      ["foreign-authorization", {
        ...base.trace,
        authorization: { ...base.trace.authorization, tenantId: TENANT_B, authorizer: foreignSubject }
      }],
      ["foreign-activity", {
        ...base.trace,
        activities: [{ ...base.trace.activities[0], tenantId: TENANT_B, actor: foreignSubject }]
      }],
      ["foreign-evidence", {
        ...base.trace,
        evidence: [{ ...base.trace.evidence[0], tenantId: TENANT_B }]
      }],
      ["foreign-outcome", {
        ...base.trace,
        outcome: { ...base.trace.outcome, tenantId: TENANT_B, acceptanceActor: foreignSubject }
      }]
    ];
    const matrix = [];
    for (let index = 0; index < attacks.length; index += 1) {
      const [name, trace] = attacks[index];
      const result = await postTrace(recordId, {
        ...base, requestId: `id_${String(index + 1).repeat(16)}`, trace
      });
      matrix.push({ name, status: result.status, body: result.body });
      assert.equal(result.status, 404, name);
      assert.deepEqual(context.store.read(TENANT_A, recordId), created.body.record);
      assert.equal(context.store.countAudits(TENANT_A), 1);
      assert.equal(context.store.countTraces(TENANT_A), 0);
      assert.equal(replayCount(), 0);
    }
    assert.equal((await postTrace(recordId, {
      ...base,
      expectedRevision: 2,
      trace: { ...base.trace, assignment: { ...base.trace.assignment, acceptedRevision: 2 } }
    })).status, 409);
    assert.equal(context.store.countAudits(TENANT_A), 1);
    assert.equal(context.store.countTraces(TENANT_A), 0);
    assert.equal(replayCount(), 0);

    const accepted = await postTrace(recordId, base);
    assert.equal(accepted.status, 201);
    assert.deepEqual((await postTrace(recordId, base)).body, accepted.body);
    const conflicting = await postTrace(recordId, {
      ...base,
      trace: { ...base.trace, direction: { ...base.trace.direction, occurredAt: OBSERVED_AT } }
    });
    assert.equal(conflicting.status, 409);
    assert.equal(context.store.countAudits(TENANT_A), 2);
    assert.equal(context.store.countTraces(TENANT_A), 1);
    assert.equal(replayCount(), 1);

    const second = await json(fetch(`${context.base}/api/private/tenants/${TENANT_A}/records`, {
      method: "POST",
      headers: { authorization: "Bearer tracer", "content-type": "application/json" },
      body: JSON.stringify({ ...createBody({ title: "Storage failure target" }), requestId: "id_aaaaaaaaaaaaaaaa" })
    }));
    const beforeSecond = structuredClone(second.body.record);
    const originalRun = context.store.insertTraceStatement.run.bind(context.store.insertTraceStatement);
    context.store.insertTraceStatement.run = () => { throw new Error("synthetic trace storage failure"); };
    const failed = await postTrace(second.body.record.recordId, {
      ...traceBody(second.body.record.recordId), requestId: "id_cccccccccccccccc"
    });
    context.store.insertTraceStatement.run = originalRun;
    assert.equal(failed.status, 500);
    assert.deepEqual(context.store.read(TENANT_A, second.body.record.recordId), beforeSecond);
    assert.equal(context.store.readTrace(TENANT_A, second.body.record.recordId), null);
    assert.equal(context.store.history(TENANT_A, second.body.record.recordId).length, 1);
    assert.equal(replayCount(), 1);
    console.log(`TRACE_ATTACK_MATRIX ${JSON.stringify(matrix)}`);
  } finally {
    await context.close();
  }
});

test("malformed server-authored trace audit is rejected before record trace audit or replay persistence", async () => {
  const context = await fixture({
    identities: { "Bearer tracer": facts({ permissions: ["read", "create", "write_trace"] }) },
    transformValidatedMutationAudit: (audit) => ({
      ...audit,
      actor: { tenantId: TENANT_A, subjectId: SUBJECT_B }
    })
  });
  try {
    const created = await json(fetch(`${context.base}/api/private/tenants/${TENANT_A}/records`, {
      method: "POST",
      headers: { authorization: "Bearer tracer", "content-type": "application/json" },
      body: JSON.stringify(createBody())
    }));
    const denied = await json(fetch(
      `${context.base}/api/private/tenants/${TENANT_A}/records/${created.body.record.recordId}/trace`,
      {
        method: "POST",
        headers: { authorization: "Bearer tracer", "content-type": "application/json" },
        body: JSON.stringify(traceBody(created.body.record.recordId))
      }
    ));
    assert.equal(denied.status, 404);
    assert.deepEqual(context.store.read(TENANT_A, created.body.record.recordId), created.body.record);
    assert.equal(context.store.countTraces(TENANT_A), 0);
    assert.equal(context.store.countAudits(TENANT_A), 1);
    assert.equal(Number(context.store.database.prepare(
      "SELECT COUNT(*) AS count FROM private_mutation_requests"
    ).get().count), 0);
  } finally {
    await context.close();
  }
});

test("evidence-detach audit binding rejects every transformed actor authority scope revision and delta atomically", async () => {
  const transforms = [
    ["actor-subject", (audit) => ({
      ...audit, actor: { tenantId: TENANT_A, subjectId: SUBJECT_B }
    })],
    ["actor-tenant", (audit) => ({
      ...audit, actor: { tenantId: TENANT_B, subjectId: SUBJECT_A }
    })],
    ["authorization-ref", (audit) => ({ ...audit, authorizationRef: "id_aaaaaaaaaaaaaaaa" })],
    ["policy-revision", (audit) => ({ ...audit, policyRevision: 2 })],
    ["event-kind", (audit) => ({ ...audit, eventKind: "state_transition" })],
    ["tenant-id", (audit) => ({ ...audit, tenantId: TENANT_B })],
    ["record-id", (audit) => ({ ...audit, recordId: "id_aaaaaaaaaaaaaaaa" })],
    ["prior-revision", (audit) => ({ ...audit, priorRevision: 1 })],
    ["new-revision", (audit) => ({ ...audit, newRevision: 4 })],
    ["before-delta", (audit) => ({
      ...audit,
      changedFields: [{ ...audit.changedFields[0], before: canonicalJson([]) }]
    })],
    ["after-delta", (audit) => ({
      ...audit,
      changedFields: [{ ...audit.changedFields[0], after: canonicalJson([]) }]
    })]
  ];
  let transformIndex = 0;
  const context = await fixture({
    identities: { "Bearer tracer": facts({
      permissions: ["read", "create", "write_trace", "update_evidence_availability"]
    }) },
    transformValidatedMutationAudit: (audit) => audit.eventKind === "evidence_detach"
      ? transforms[transformIndex++][1](audit)
      : audit
  });
  try {
    const created = await json(fetch(`${context.base}/api/private/tenants/${TENANT_A}/records`, {
      method: "POST",
      headers: { authorization: "Bearer tracer", "content-type": "application/json" },
      body: JSON.stringify(createBody())
    }));
    const recordId = created.body.record.recordId;
    const completion = traceBody(recordId);
    assert.equal((await json(fetch(
      `${context.base}/api/private/tenants/${TENANT_A}/records/${recordId}/trace`,
      {
        method: "POST",
        headers: { authorization: "Bearer tracer", "content-type": "application/json" },
        body: JSON.stringify(completion)
      }
    ))).status, 201);
    const evidenceId = completion.trace.evidence[0].evidenceId;
    const evidenceUrl = `${context.base}/api/private/tenants/${TENANT_A}/records/${recordId}/evidence/${evidenceId}`;
    const beforeRecord = structuredClone(context.store.read(TENANT_A, recordId));
    const beforeTrace = structuredClone(context.store.readTrace(TENANT_A, recordId));
    const beforeHistory = structuredClone(context.store.history(TENANT_A, recordId));
    const replayCount = () => Number(context.store.database.prepare(
      "SELECT COUNT(*) AS count FROM private_mutation_requests"
    ).get().count);
    const beforeReplay = replayCount();

    for (let index = 0; index < transforms.length; index += 1) {
      const [name] = transforms[index];
      const denied = await json(fetch(evidenceUrl, {
        method: "PATCH",
        headers: { authorization: "Bearer tracer", "content-type": "application/json" },
        body: JSON.stringify({
          availability: "unavailable",
          expectedRevision: 2,
          requestId: `id_${String(index + 1).repeat(16)}`
        })
      }));
      assert.equal(denied.status, 404, name);
      assert.deepEqual(denied.body, { error: "not_found" }, name);
      assert.deepEqual(context.store.read(TENANT_A, recordId), beforeRecord, name);
      assert.deepEqual(context.store.readTrace(TENANT_A, recordId), beforeTrace, name);
      assert.deepEqual(context.store.history(TENANT_A, recordId), beforeHistory, name);
      assert.equal(replayCount(), beforeReplay, name);
    }
  } finally {
    await context.close();
  }
});

test("private routes deny unauthenticated and malformed trusted identity contexts without enumeration", async () => {
  const context = await fixture({ identities: { "Bearer malformed": { authentication: {} } } });
  try {
    for (const authorization of [undefined, "Bearer malformed"]) {
      const response = await fetch(`${context.base}/api/private/tenants/${TENANT_A}/records`, {
        headers: authorization ? { authorization } : {}
      });
      const result = await json(response);
      assert.equal(result.status, 404);
      assert.equal(result.headers["cache-control"], "private, no-store");
      assert.deepEqual(result.body, { error: "not_found" });
    }
    assert.equal(context.store.countRecords(TENANT_A), 0);
    assert.equal(context.store.countAudits(TENANT_A), 0);
  } finally {
    await context.close();
  }
});

test("create denies invented same-tenant references unless the trusted backend resolver authorizes them", async () => {
  const resolverCalls = [];
  const context = await fixture({
    identities: { "Bearer writer": facts() },
    resolveTrustedReferences: async (scope) => {
      resolverCalls.push(scope);
      return false;
    }
  });
  try {
    const response = await json(fetch(`${context.base}/api/private/tenants/${TENANT_A}/records`, {
      method: "POST",
      headers: { authorization: "Bearer writer", "content-type": "application/json" },
      body: JSON.stringify(createBody({
        owner: { tenantId: TENANT_A, subjectId: "id_aaaaaaaaaaaaaaaa" },
        assignees: [{ tenantId: TENANT_A, subjectId: "id_bbbbbbbbbbbbbbbb" }],
        evidenceLinks: [{
          evidenceId: "id_cccccccccccccccc",
          tenantId: TENANT_A,
          relation: "supports",
          locator: "internal:invented",
          label: "Invented evidence",
          sensitivity: "tenant_private",
          integrity: null,
          sourceOccurredAt: OCCURRED_AT,
          observedAt: OBSERVED_AT,
          recordedAt: NOW,
          availability: "available"
        }],
        source: { ...createBody().record.source, sourceId: "id_dddddddddddddddd" },
        supersedes: { tenantId: TENANT_A, recordId: "id_eeeeeeeeeeeeeeee" }
      }))
    }));
    assert.equal(response.status, 404);
    assert.deepEqual(response.body, { error: "not_found" });
    assert.equal(context.store.countRecords(TENANT_A), 0);
    assert.equal(context.store.countAudits(TENANT_A), 0);
    assert.equal(resolverCalls.length, 1);
    assert.equal(resolverCalls[0].tenantId, TENANT_A);
    assert.equal(resolverCalls[0].principalId, SUBJECT_A);
    assert.equal(resolverCalls[0].authorizationRef, AUTHORIZATION_ID);
    assert.equal(resolverCalls[0].policyRevision, 1);
  } finally {
    await context.close();
  }
});

test("create accepts same-tenant references resolved by the scoped trusted backend boundary", async () => {
  const context = await fixture({
    identities: { "Bearer writer": facts() },
    resolveTrustedReferences: async (scope) =>
      scope.tenantId === TENANT_A && scope.principalId === SUBJECT_A &&
      scope.authorizationRef === AUTHORIZATION_ID && scope.policyRevision === 1 &&
      scope.record.owner.subjectId === "id_aaaaaaaaaaaaaaaa" &&
      scope.record.assignees[0]?.subjectId === "id_bbbbbbbbbbbbbbbb" &&
      scope.record.evidenceLinks[0]?.evidenceId === "id_cccccccccccccccc" &&
      scope.record.source.sourceId === "id_dddddddddddddddd" &&
      scope.record.supersedes?.recordId === "id_eeeeeeeeeeeeeeee"
  });
  try {
    const response = await json(fetch(`${context.base}/api/private/tenants/${TENANT_A}/records`, {
      method: "POST",
      headers: { authorization: "Bearer writer", "content-type": "application/json" },
      body: JSON.stringify(createBody({
        owner: { tenantId: TENANT_A, subjectId: "id_aaaaaaaaaaaaaaaa" },
        assignees: [{ tenantId: TENANT_A, subjectId: "id_bbbbbbbbbbbbbbbb" }],
        evidenceLinks: [{
          evidenceId: "id_cccccccccccccccc",
          tenantId: TENANT_A,
          relation: "supports",
          locator: "internal:resolved",
          label: "Resolved evidence",
          sensitivity: "tenant_private",
          integrity: null,
          sourceOccurredAt: OCCURRED_AT,
          observedAt: OBSERVED_AT,
          recordedAt: NOW,
          availability: "available"
        }],
        source: { ...createBody().record.source, sourceId: "id_dddddddddddddddd" },
        supersedes: { tenantId: TENANT_A, recordId: "id_eeeeeeeeeeeeeeee" }
      }))
    }));
    assert.equal(response.status, 201);
    assert.equal(context.store.countRecords(TENANT_A), 1);
    assert.equal(context.store.countAudits(TENANT_A), 1);
  } finally {
    await context.close();
  }
});

test("create permission is distinct from update permission", async () => {
  const context = await fixture({
    identities: {
      "Bearer creator": facts({ permissions: ["read", "create"] }),
      "Bearer updater": facts({ permissions: ["read", "update"] })
    }
  });
  const post = (authorization, title) => json(fetch(
    `${context.base}/api/private/tenants/${TENANT_A}/records`,
    {
      method: "POST",
      headers: { authorization, "content-type": "application/json" },
      body: JSON.stringify(createBody({ title }))
    }
  ));
  try {
    const created = await post("Bearer creator", "Create-only authority");
    assert.equal(created.status, 201);
    const denied = await post("Bearer updater", "Update-only authority");
    assert.equal(denied.status, 404);
    assert.deepEqual(denied.body, { error: "not_found" });
    assert.equal(context.store.countRecords(TENANT_A), 1);
    assert.equal(context.store.countAudits(TENANT_A), 1);
  } finally {
    await context.close();
  }
});

test("identical accepted create request idempotently replays without a second record or audit", async () => {
  const context = await fixture({ identities: { "Bearer creator": facts() } });
  const request = { ...createBody(), requestId: REQUEST_ID };
  const post = () => json(fetch(`${context.base}/api/private/tenants/${TENANT_A}/records`, {
    method: "POST",
    headers: { authorization: "Bearer creator", "content-type": "application/json" },
    body: JSON.stringify(request)
  }));
  try {
    const accepted = await post();
    assert.equal(accepted.status, 201);
    const replayed = await post();
    assert.equal(replayed.status, 200);
    assert.deepEqual(replayed.body, accepted.body);
    assert.equal(context.store.countRecords(TENANT_A), 1);
    assert.equal(context.store.countAudits(TENANT_A), 1);
  } finally {
    await context.close();
  }
});

test("idempotency identity rejects substitution and is scoped to trusted principal policy context", async () => {
  const context = await fixture({
    identities: {
      "Bearer creator-a": facts(),
      "Bearer creator-b": facts({ subjectId: SUBJECT_B }),
      "Bearer creator-policy": facts({ policyRevision: 2 })
    }
  });
  const post = (authorization, body) => json(fetch(
    `${context.base}/api/private/tenants/${TENANT_A}/records`,
    {
      method: "POST",
      headers: { authorization, "content-type": "application/json" },
      body: JSON.stringify(body)
    }
  ));
  try {
    assert.equal((await post("Bearer creator-a", createBody())).status, 201);
    const conflict = await post("Bearer creator-a", createBody({ title: "Substituted semantics" }));
    assert.equal(conflict.status, 409);
    assert.deepEqual(conflict.body, { error: "conflict" });
    assert.equal(context.store.countRecords(TENANT_A), 1);
    assert.equal(context.store.countAudits(TENANT_A), 1);

    assert.equal((await post("Bearer creator-b", createBody())).status, 201);
    assert.equal((await post("Bearer creator-policy", createBody())).status, 201);
    const malformed = await post("Bearer creator-a", { ...createBody(), requestId: "caller-key" });
    assert.equal(malformed.status, 404);
    assert.deepEqual(malformed.body, { error: "not_found" });
    const { requestId: omittedRequestId, ...missingRequestId } = createBody();
    assert.equal(typeof omittedRequestId, "string");
    assert.equal((await post("Bearer creator-a", missingRequestId)).status, 404);
    assert.equal(context.store.countRecords(TENANT_A), 3);
    assert.equal(context.store.countAudits(TENANT_A), 3);
  } finally {
    await context.close();
  }
});

test("malformed server-authored creation audit fails domain validation before persistence", async () => {
  const context = await fixture({
    identities: { "Bearer creator": facts() },
    ids: (kind) => kind === "record" ? "id_aaaaaaaaaaaaaaaa" : "malformed-audit-id"
  });
  try {
    const response = await json(fetch(`${context.base}/api/private/tenants/${TENANT_A}/records`, {
      method: "POST",
      headers: { authorization: "Bearer creator", "content-type": "application/json" },
      body: JSON.stringify(createBody())
    }));
    assert.equal(response.status, 404);
    assert.deepEqual(response.body, { error: "not_found" });
    assert.equal(context.store.countRecords(TENANT_A), 0);
    assert.equal(context.store.countAudits(TENANT_A), 0);
  } finally {
    await context.close();
  }
});

test("authorized create atomically appends one canonical record and one material audit then read and list stay private", async () => {
  const context = await fixture({ identities: { "Bearer writer": facts() } });
  const headers = { authorization: "Bearer writer", "content-type": "application/json" };
  try {
    const created = await fetch(`${context.base}/api/private/tenants/${TENANT_A}/records`, {
      method: "POST",
      headers,
      body: JSON.stringify(createBody())
    });
    const creation = await json(created);
    assert.equal(creation.status, 201);
    assert.equal(creation.headers["cache-control"], "private, no-store");
    assert.equal(creation.headers.vary, "authorization");
    assert.deepEqual(Object.keys(creation.body).sort(), ["record"]);
    assert.equal(creation.body.record.tenantId, TENANT_A);
    assert.equal(creation.body.record.revision, 1);
    assert.equal(creation.body.record.recordedAt, NOW);
    assert.equal(context.store.countRecords(TENANT_A), 1);
    assert.equal(context.store.countAudits(TENANT_A), 1);
    const auditRow = context.store.database.prepare(`
      SELECT event_json FROM private_material_audit_events WHERE tenant_id = ?
    `).get(TENANT_A);
    const audit = JSON.parse(auditRow.event_json);
    assert.equal(audit.eventKind, "creation");
    assert.equal(audit.recordId, creation.body.record.recordId);
    assert.deepEqual(audit.actor, { tenantId: TENANT_A, subjectId: SUBJECT_A });
    assert.equal(audit.authorizationRef, AUTHORIZATION_ID);
    assert.equal(audit.priorRevision, 0);
    assert.equal(audit.newRevision, 1);

    const recordId = creation.body.record.recordId;
    const read = await json(await fetch(
      `${context.base}/api/private/tenants/${TENANT_A}/records/${recordId}`,
      { headers: { authorization: "Bearer writer" } }
    ));
    assert.equal(read.status, 200);
    assert.deepEqual(read.body, { record: creation.body.record });

    const listed = await json(await fetch(
      `${context.base}/api/private/tenants/${TENANT_A}/records`,
      { headers: { authorization: "Bearer writer" } }
    ));
    assert.equal(listed.status, 200);
    assert.deepEqual(listed.body, { records: [creation.body.record], count: 1, cursor: null });
  } finally {
    await context.close();
  }
});

test("active tenant list applies lifecycle visibility before the fifty-row storage limit", async () => {
  const context = await fixture({ identities: { "Bearer reader": facts() } });
  try {
    const created = await json(fetch(`${context.base}/api/private/tenants/${TENANT_A}/records`, {
      method: "POST",
      headers: { authorization: "Bearer reader", "content-type": "application/json" },
      body: JSON.stringify(createBody({ title: "Visible active record" }))
    }));
    const active = { ...created.body.record, state: "active", stateChangedAt: NOW };
    context.store.database.prepare(`
      UPDATE private_work_records SET record_json = ? WHERE tenant_id = ? AND record_id = ?
    `).run(JSON.stringify(active), TENANT_A, active.recordId);

    for (let index = 0; index < 51; index += 1) {
      const timestamp = new Date(Date.parse(NOW) + (index + 1) * 1000).toISOString();
      const state = index % 2 === 0 ? "archived" : "deleted_tombstone";
      const hidden = {
        ...active,
        recordId: `id_${(index + 100).toString(16).padStart(16, "0")}`,
        title: `Hidden historical record ${index}`,
        state,
        stateChangedAt: timestamp,
        archivedAt: state === "archived" ? timestamp : null,
        deletedAt: state === "deleted_tombstone" ? timestamp : null,
        recordedAt: timestamp,
        updatedAt: timestamp
      };
      context.store.insertRecordStatement.run(
        hidden.tenantId,
        hidden.recordId,
        hidden.revision,
        JSON.stringify(hidden),
        hidden.recordedAt
      );
    }

    const listed = await json(fetch(`${context.base}/api/private/tenants/${TENANT_A}/records`, {
      headers: { authorization: "Bearer reader" }
    }));
    assert.equal(listed.status, 200);
    assert.deepEqual(listed.body.records, [active]);
    assert.equal(listed.body.count, 1);
  } finally {
    await context.close();
  }
});

test("tenant attack matrix denies changed routes direct IDs body claims nested references revoked membership and read-only mutation", async () => {
  const identities = {
    "Bearer writer-a": facts(),
    "Bearer writer-b": facts({ tenantId: TENANT_B, subjectId: SUBJECT_B }),
    "Bearer revoked": facts({ active: false }),
    "Bearer reader": facts({ permissions: ["read"] })
  };
  const context = await fixture({ identities });
  const post = async (tenantId, authorization, body) => json(await fetch(
    `${context.base}/api/private/tenants/${tenantId}/records`,
    {
      method: "POST",
      headers: { authorization, "content-type": "application/json" },
      body: JSON.stringify(body)
    }
  ));
  const matrix = [];
  const capture = async (name, request) => {
    const before = [context.store.countRecords(TENANT_A), context.store.countAudits(TENANT_A)];
    const result = await request();
    const after = [context.store.countRecords(TENANT_A), context.store.countAudits(TENANT_A)];
    matrix.push({
      name,
      status: result.status,
      responseKeys: Object.keys(result.body).sort(),
      recordCountDelta: after[0] - before[0],
      auditCountDelta: after[1] - before[1]
    });
    return result;
  };
  try {
    const a = await post(TENANT_A, "Bearer writer-a", createBody());
    const bBody = createBody({
      owner: { tenantId: TENANT_B, subjectId: SUBJECT_B },
      source: { ...createBody().record.source, tenantId: TENANT_B }
    });
    const b = await post(TENANT_B, "Bearer writer-b", bBody);
    assert.equal(a.status, 201);
    assert.equal(b.status, 201);

    const denials = [
      await capture("changed-route-tenant", () => json(fetch(
        `${context.base}/api/private/tenants/${TENANT_B}/records/${b.body.record.recordId}`,
        { headers: { authorization: "Bearer writer-a" } }
      ))),
      await capture("authorized-route-foreign-record-id", () => json(fetch(
        `${context.base}/api/private/tenants/${TENANT_A}/records/${b.body.record.recordId}`,
        { headers: { authorization: "Bearer writer-a" } }
      ))),
      await capture("client-body-tenant", () => post(TENANT_A, "Bearer writer-a", {
        ...createBody(), record: { ...createBody().record, tenantId: TENANT_B }
      })),
      await capture("foreign-owner", () => post(TENANT_A, "Bearer writer-a", createBody({
        owner: { tenantId: TENANT_B, subjectId: SUBJECT_B }
      }))),
      await capture("foreign-assignee", () => post(TENANT_A, "Bearer writer-a", createBody({
        assignees: [{ tenantId: TENANT_B, subjectId: SUBJECT_B }]
      }))),
      await capture("foreign-evidence", () => post(TENANT_A, "Bearer writer-a", createBody({
        evidenceLinks: [{
          evidenceId: "id_aaaaaaaaaaaaaaaa",
          tenantId: TENANT_B,
          relation: "supports",
          locator: "internal:synthetic",
          label: "Synthetic evidence",
          sensitivity: "tenant_private",
          integrity: null,
          sourceOccurredAt: OCCURRED_AT,
          observedAt: OBSERVED_AT,
          recordedAt: NOW,
          availability: "available"
        }]
      }))),
      await capture("foreign-source", () => post(TENANT_A, "Bearer writer-a", createBody({
        source: { ...createBody().record.source, tenantId: TENANT_B }
      }))),
      await capture("foreign-supersession", () => post(TENANT_A, "Bearer writer-a", createBody({
        supersedes: { tenantId: TENANT_B, recordId: b.body.record.recordId }
      }))),
      await capture("revoked-membership", () => json(fetch(
        `${context.base}/api/private/tenants/${TENANT_A}/records`,
        { headers: { authorization: "Bearer revoked" } }
      ))),
      await capture("read-only-mutation", () => post(TENANT_A, "Bearer reader", createBody()))
    ];
    for (const denial of denials) {
      assert.equal(denial.status, 404);
      assert.deepEqual(denial.body, { error: "not_found" });
    }

    const list = await capture("tenant-bounded-list-count", () => json(fetch(
      `${context.base}/api/private/tenants/${TENANT_A}/records`,
      { headers: { authorization: "Bearer writer-a" } }
    )));
    assert.equal(list.status, 200);
    assert.equal(list.body.count, 1);
    assert.deepEqual(list.body.records.map((record) => record.tenantId), [TENANT_A]);

    for (const path of ["search", "count", "export", "batch", "history", "evidence"]) {
      const absent = await capture(`unsupported-${path}`, () => json(fetch(
        `${context.base}/api/private/tenants/${TENANT_A}/records/${path}`,
        { headers: { authorization: "Bearer writer-a" } }
      )));
      assert.equal(absent.status, 404);
      assert.deepEqual(absent.body, { error: "not_found" });
    }
    console.log(`ROUTE_POLICY_MATRIX ${JSON.stringify(matrix)}`);
  } finally {
    await context.close();
  }
});

test("stale validation and duplicate audit failures are atomic while owner-only SQLite survives a clean restart", async () => {
  let recordIndex = 0;
  const recordSuffixes = ["0", "1", "2", "3", "2"];
  const ids = (kind) => kind === "record"
    ? `id_${"c".repeat(15)}${recordSuffixes[recordIndex++]}`
    : `id_${"d".repeat(16)}`;
  const context = await fixture({ identities: { "Bearer writer": facts() }, ids });
  const post = (body) => json(fetch(`${context.base}/api/private/tenants/${TENANT_A}/records`, {
    method: "POST",
    headers: { authorization: "Bearer writer", "content-type": "application/json" },
    body: JSON.stringify(body)
  }));
  let reopened;
  try {
    assert.equal(statSync(context.databasePath).mode & 0o777, 0o600);

    const validationFailure = await post(createBody({ title: "" }));
    assert.equal(validationFailure.status, 404);
    assert.equal(context.store.countRecords(TENANT_A), 0);
    assert.equal(context.store.countAudits(TENANT_A), 0);

    const stale = await post({ ...createBody(), expectedRevision: 1 });
    assert.equal(stale.status, 409);
    assert.deepEqual(stale.body, { error: "conflict" });
    assert.equal(context.store.countRecords(TENANT_A), 0);
    assert.equal(context.store.countAudits(TENANT_A), 0);

    const accepted = await post(createBody());
    assert.equal(accepted.status, 201);
    assert.equal(context.store.countRecords(TENANT_A), 1);
    assert.equal(context.store.countAudits(TENANT_A), 1);

    const duplicateAudit = await post({
      ...createBody({ title: "Synthetic replay collision" }),
      requestId: "id_aaaaaaaaaaaaaaaa"
    });
    assert.equal(duplicateAudit.status, 409);
    assert.deepEqual(duplicateAudit.body, { error: "conflict" });
    assert.equal(context.store.countRecords(TENANT_A), 1);
    assert.equal(context.store.countAudits(TENANT_A), 1);

    const replay = await post(createBody());
    assert.equal(replay.status, 200);
    assert.deepEqual(replay.body, accepted.body);
    assert.equal(context.store.countRecords(TENANT_A), 1);
    assert.equal(context.store.countAudits(TENANT_A), 1);

    await context.close({ remove: false });
    const { PrivateWorkRecordsStore } = await import("../server/privateWorkRecordsStore.mjs");
    reopened = new PrivateWorkRecordsStore(context.databasePath);
    assert.equal(reopened.countRecords(TENANT_A), 1);
    assert.equal(reopened.countAudits(TENANT_A), 1);
    assert.deepEqual(reopened.read(TENANT_A, accepted.body.record.recordId), accepted.body.record);
  } finally {
    if (reopened) reopened.close();
    else await context.close({ remove: false });
    rmSync(context.directory, { recursive: true, force: true });
  }
});

test("authorized rename preserves stable identity and appends bounded old and new title snapshots", async () => {
  const context = await fixture({
    identities: { "Bearer editor": facts({ permissions: ["read", "create", "update", "read_history"] }) }
  });
  try {
    const created = await json(fetch(`${context.base}/api/private/tenants/${TENANT_A}/records`, {
      method: "POST",
      headers: { authorization: "Bearer editor", "content-type": "application/json" },
      body: JSON.stringify(createBody())
    }));
    const recordId = created.body.record.recordId;
    const renamed = await json(fetch(`${context.base}/api/private/tenants/${TENANT_A}/records/${recordId}`, {
      method: "PATCH",
      headers: { authorization: "Bearer editor", "content-type": "application/json" },
      body: JSON.stringify(mutationBody("rename", 1, { title: "Renamed synthetic record" }))
    }));
    assert.equal(renamed.status, 200);
    assert.equal(renamed.body.record.recordId, recordId);
    assert.equal(renamed.body.record.tenantId, TENANT_A);
    assert.equal(renamed.body.record.title, "Renamed synthetic record");
    assert.equal(renamed.body.record.revision, 2);
    const history = context.store.history(TENANT_A, recordId);
    assert.equal(history.length, 2);
    assert.deepEqual(history[1].changedFields, [{
      field: "title",
      before: "Synthetic private work record",
      after: "Renamed synthetic record"
    }]);
  } finally {
    await context.close();
  }
});

test("reassignment preserves prior assignee snapshots and rejects unresolved subjects without mutation", async () => {
  const context = await fixture({
    identities: { "Bearer assigner": facts({ permissions: ["read", "read_history", "create", "assign"] }) },
    resolveTrustedReferences: async ({ record }) =>
      record.assignees.every(({ subjectId }) => subjectId === SUBJECT_B)
  });
  try {
    const created = await json(fetch(`${context.base}/api/private/tenants/${TENANT_A}/records`, {
      method: "POST",
      headers: { authorization: "Bearer assigner", "content-type": "application/json" },
      body: JSON.stringify(createBody())
    }));
    const recordId = created.body.record.recordId;
    const reassigned = await json(fetch(`${context.base}/api/private/tenants/${TENANT_A}/records/${recordId}`, {
      method: "PATCH",
      headers: { authorization: "Bearer assigner", "content-type": "application/json" },
      body: JSON.stringify(mutationBody("reassign", 1, {
        assignees: [{ tenantId: TENANT_A, subjectId: SUBJECT_B }]
      }))
    }));
    assert.equal(reassigned.status, 200);
    assert.deepEqual(reassigned.body.record.assignees, [{ tenantId: TENANT_A, subjectId: SUBJECT_B }]);
    assert.deepEqual(context.store.history(TENANT_A, recordId)[1].changedFields, [{
      field: "assignees",
      before: "[]",
      after: canonicalJson([{ tenantId: TENANT_A, subjectId: SUBJECT_B }])
    }]);
    const denied = await json(fetch(`${context.base}/api/private/tenants/${TENANT_A}/records/${recordId}`, {
      method: "PATCH",
      headers: { authorization: "Bearer assigner", "content-type": "application/json" },
      body: JSON.stringify(mutationBody("reassign", 2, {
        assignees: [{ tenantId: TENANT_B, subjectId: SUBJECT_B }]
      }, "id_bbbbbbbbbbbbbbbb"))
    }));
    assert.equal(denied.status, 404);
    assert.equal(context.store.read(TENANT_A, recordId).revision, 2);
    assert.equal(context.store.history(TENANT_A, recordId).length, 2);
    const afterSubjectLoss = await json(fetch(
      `${context.base}/api/private/tenants/${TENANT_A}/records/${recordId}/history`,
      { headers: { authorization: "Bearer assigner" } }
    ));
    assert.equal(afterSubjectLoss.status, 200);
    assert.equal(afterSubjectLoss.body.events[1].changedFields[0].after,
      canonicalJson([{ tenantId: TENANT_A, subjectId: SUBJECT_B }]));
  } finally {
    await context.close();
  }
});

test("block requires a resolved structured reason and unblock preserves the cleared reason historically", async () => {
  const context = await fixture({
    identities: { "Bearer transitioner": facts({ permissions: ["read", "create", "transition"] }) },
    resolveTrustedReferences: async ({ record }) =>
      record.blockReason === null || record.blockReason.resolutionAuthority?.subjectId === SUBJECT_A
  });
  const patchRecord = (recordId, body) => json(fetch(
    `${context.base}/api/private/tenants/${TENANT_A}/records/${recordId}`,
    {
      method: "PATCH",
      headers: { authorization: "Bearer transitioner", "content-type": "application/json" },
      body: JSON.stringify(body)
    }
  ));
  try {
    const created = await json(fetch(`${context.base}/api/private/tenants/${TENANT_A}/records`, {
      method: "POST",
      headers: { authorization: "Bearer transitioner", "content-type": "application/json" },
      body: JSON.stringify(createBody())
    }));
    const recordId = created.body.record.recordId;
    seedLifecycleStateForTest(context.store, TENANT_A, recordId, "ready");
    assert.equal((await patchRecord(recordId, mutationBody("block", 1, {}))).status, 404);
    const reason = {
      category: "dependency",
      summary: "Synthetic dependency unavailable",
      resolutionAuthority: { tenantId: TENANT_A, subjectId: SUBJECT_A },
      blockedAt: NOW
    };
    const blockRequest = mutationBody("block", 1, { blockReason: reason });
    const blocked = await patchRecord(recordId, blockRequest);
    assert.equal(blocked.status, 200);
    assert.equal(blocked.body.record.state, "blocked");
    const replayedBlock = await patchRecord(recordId, blockRequest);
    replayedBlock.headers.date = new Date(Date.parse(blocked.headers.date) + 1_000).toUTCString();
    const { date: blockedDate, ...blockedHeaders } = blocked.headers;
    const { date: replayedDate, ...replayedHeaders } = replayedBlock.headers;
    assert.notEqual(replayedDate, blockedDate);
    assert.deepEqual(
      { ...replayedBlock, headers: replayedHeaders },
      { ...blocked, headers: blockedHeaders }
    );
    assert.equal(context.store.history(TENANT_A, recordId).length, 2);
    const unblocked = await patchRecord(recordId, mutationBody("unblock", 2, {}, "id_bbbbbbbbbbbbbbbb"));
    assert.equal(unblocked.status, 200);
    assert.equal(unblocked.body.record.state, "active");
    assert.equal(unblocked.body.record.blockReason, null);
    const history = context.store.history(TENANT_A, recordId);
    assert.equal(history[1].eventKind, "block");
    assert.equal(history[2].eventKind, "unblock");
    assert.equal(history[2].changedFields[1].before, canonicalJson(reason));
    assert.equal(history[2].changedFields[1].after, null);
  } finally {
    await context.close();
  }
});

test("closed lifecycle policy rejects proposed block and archive without record audit or replay state", async () => {
  const context = await fixture({
    identities: { "Bearer custodian": facts({
      permissions: ["read", "create", "transition", "archive"]
    }) }
  });
  const patchRecord = (recordId, body) => json(fetch(
    `${context.base}/api/private/tenants/${TENANT_A}/records/${recordId}`,
    {
      method: "PATCH",
      headers: { authorization: "Bearer custodian", "content-type": "application/json" },
      body: JSON.stringify(body)
    }
  ));
  try {
    const created = await json(fetch(`${context.base}/api/private/tenants/${TENANT_A}/records`, {
      method: "POST",
      headers: { authorization: "Bearer custodian", "content-type": "application/json" },
      body: JSON.stringify(createBody())
    }));
    const recordId = created.body.record.recordId;
    const reason = {
      category: "dependency",
      summary: "Synthetic dependency unavailable",
      resolutionAuthority: { tenantId: TENANT_A, subjectId: SUBJECT_A },
      blockedAt: NOW
    };
    for (const request of [
      mutationBody("block", 1, { blockReason: reason }),
      mutationBody("archive", 1, {}, "id_bbbbbbbbbbbbbbbb")
    ]) {
      const denied = await patchRecord(recordId, request);
      assert.equal(denied.status, 404);
      assert.deepEqual(denied.body, { error: "not_found" });
    }
    assert.equal(context.store.read(TENANT_A, recordId).state, "proposed");
    assert.equal(context.store.read(TENANT_A, recordId).revision, 1);
    assert.equal(context.store.countAudits(TENANT_A), 1);
    assert.equal(Number(context.store.database.prepare(
      "SELECT COUNT(*) AS count FROM private_mutation_requests"
    ).get().count), 0);
  } finally {
    await context.close();
  }
});

test("archived and tombstoned records reject every ordinary action before replay or mutation", async () => {
  const context = await fixture({
    identities: { "Bearer custodian": facts({
      permissions: ["read", "create", "update", "assign", "transition", "archive", "delete"]
    }) }
  });
  const patchRecord = (recordId, body) => json(fetch(
    `${context.base}/api/private/tenants/${TENANT_A}/records/${recordId}`,
    {
      method: "PATCH",
      headers: { authorization: "Bearer custodian", "content-type": "application/json" },
      body: JSON.stringify(body)
    }
  ));
  try {
    const first = await json(fetch(`${context.base}/api/private/tenants/${TENANT_A}/records`, {
      method: "POST",
      headers: { authorization: "Bearer custodian", "content-type": "application/json" },
      body: JSON.stringify(createBody())
    }));
    const second = await json(fetch(`${context.base}/api/private/tenants/${TENANT_A}/records`, {
      method: "POST",
      headers: { authorization: "Bearer custodian", "content-type": "application/json" },
      body: JSON.stringify({ ...createBody({ title: "Second lifecycle target" }), requestId: "id_bbbbbbbbbbbbbbbb" })
    }));
    const archivedId = first.body.record.recordId;
    const tombstonedId = second.body.record.recordId;
    seedLifecycleStateForTest(context.store, TENANT_A, archivedId, "ready");
    const replayCandidate = mutationBody("rename", 1, { title: "Accepted before archive" });
    assert.equal((await patchRecord(archivedId, replayCandidate)).status, 200);
    assert.equal((await patchRecord(archivedId,
      mutationBody("archive", 2, {}, "id_cccccccccccccccc"))).status, 200);
    assert.equal((await patchRecord(tombstonedId,
      mutationBody("tombstone", 1, {}, "id_dddddddddddddddd"))).status, 200);

    const attacks = [
      ["rename", { title: "Forbidden rename" }],
      ["reassign", { assignees: [] }],
      ["correct", { supersedes: { tenantId: TENANT_A, recordId: "id_eeeeeeeeeeeeeeee" } }],
      ["mark_source_unavailable", { availability: "unavailable" }],
      ["block", { blockReason: {
        category: "dependency", summary: "Forbidden block",
        resolutionAuthority: { tenantId: TENANT_A, subjectId: SUBJECT_A }, blockedAt: NOW
      } }],
      ["archive", {}],
      ["update", {}]
    ];
    for (const [recordId, revision] of [[archivedId, 3], [tombstonedId, 2]]) {
      const beforeRecord = structuredClone(context.store.read(TENANT_A, recordId));
      const beforeHistory = structuredClone(context.store.history(TENANT_A, recordId));
      const beforeRequests = Number(context.store.database.prepare(
        "SELECT COUNT(*) AS count FROM private_mutation_requests"
      ).get().count);
      for (let index = 0; index < attacks.length; index += 1) {
        const [action, changes] = attacks[index];
        const denied = await patchRecord(recordId, mutationBody(
          action, revision, changes, `id_${String(index + 1).repeat(16)}`
        ));
        assert.equal(denied.status, 404, `${beforeRecord.state} ${action}`);
        assert.deepEqual(denied.body, { error: "not_found" });
      }
      assert.deepEqual(context.store.read(TENANT_A, recordId), beforeRecord);
      assert.deepEqual(context.store.history(TENANT_A, recordId), beforeHistory);
      assert.equal(Number(context.store.database.prepare(
        "SELECT COUNT(*) AS count FROM private_mutation_requests"
      ).get().count), beforeRequests);
    }
    assert.equal((await patchRecord(archivedId, replayCandidate)).status, 404);
  } finally {
    await context.close();
  }
});

test("archive and tombstone retain audit continuity while restore preserves historical intervals", async () => {
  const context = await fixture({
    identities: { "Bearer custodian": facts({
      permissions: ["read", "create", "archive", "delete", "transition", "read_history"]
    }) }
  });
  const patchRecord = (recordId, action, revision, requestId) => json(fetch(
    `${context.base}/api/private/tenants/${TENANT_A}/records/${recordId}`,
    {
      method: "PATCH",
      headers: { authorization: "Bearer custodian", "content-type": "application/json" },
      body: JSON.stringify(mutationBody(action, revision, {}, requestId))
    }
  ));
  try {
    const created = await json(fetch(`${context.base}/api/private/tenants/${TENANT_A}/records`, {
      method: "POST",
      headers: { authorization: "Bearer custodian", "content-type": "application/json" },
      body: JSON.stringify(createBody())
    }));
    const recordId = created.body.record.recordId;
    seedLifecycleStateForTest(context.store, TENANT_A, recordId, "ready");
    assert.equal((await patchRecord(recordId, "archive", 1, "id_aaaaaaaaaaaaaaaa")).status, 200);
    assert.equal((await patchRecord(recordId, "restore", 2, "id_bbbbbbbbbbbbbbbb")).status, 200);
    assert.equal((await patchRecord(recordId, "tombstone", 3, "id_cccccccccccccccc")).status, 200);
    const hidden = await json(fetch(
      `${context.base}/api/private/tenants/${TENANT_A}/records/${recordId}`,
      { headers: { authorization: "Bearer custodian" } }
    ));
    assert.equal(hidden.status, 404);
    const listed = await json(fetch(
      `${context.base}/api/private/tenants/${TENANT_A}/records`,
      { headers: { authorization: "Bearer custodian" } }
    ));
    assert.deepEqual(listed.body.records, []);
    assert.equal(context.store.history(TENANT_A, recordId).length, 4);
    const restored = await patchRecord(recordId, "restore", 4, "id_dddddddddddddddd");
    assert.equal(restored.status, 200);
    assert.equal(restored.body.record.state, "active");
    assert.deepEqual(context.store.history(TENANT_A, recordId).map((event) => event.eventKind), [
      "creation", "archive", "state_transition", "delete_tombstone", "state_transition"
    ]);
    assert.deepEqual(context.store.history(TENANT_A, recordId).map((event) => [
      event.priorRevision, event.newRevision
    ]), [[0, 1], [1, 2], [2, 3], [3, 4], [4, 5]]);
  } finally {
    await context.close();
  }
});

test("completed-derived archive and tombstone restore to completed with truthful audit intervals", async () => {
  const context = await fixture({
    identities: { "Bearer custodian": facts({
      permissions: ["read", "create", "archive", "delete", "transition", "read_history"]
    }) }
  });
  const patchRecord = (recordId, action, revision, requestId) => json(fetch(
    `${context.base}/api/private/tenants/${TENANT_A}/records/${recordId}`,
    {
      method: "PATCH",
      headers: { authorization: "Bearer custodian", "content-type": "application/json" },
      body: JSON.stringify(mutationBody(action, revision, {}, requestId))
    }
  ));
  try {
    const archivedCreated = await json(fetch(`${context.base}/api/private/tenants/${TENANT_A}/records`, {
      method: "POST",
      headers: { authorization: "Bearer custodian", "content-type": "application/json" },
      body: JSON.stringify(createBody())
    }));
    const tombstonedCreated = await json(fetch(`${context.base}/api/private/tenants/${TENANT_A}/records`, {
      method: "POST",
      headers: { authorization: "Bearer custodian", "content-type": "application/json" },
      body: JSON.stringify({
        ...createBody({ title: "Completed tombstone restore target" }),
        requestId: "id_bbbbbbbbbbbbbbbb"
      })
    }));
    assert.equal(archivedCreated.status, 201);
    assert.equal(tombstonedCreated.status, 201);
    const archivedId = archivedCreated.body.record.recordId;
    const tombstonedId = tombstonedCreated.body.record.recordId;
    seedLifecycleStateForTest(context.store, TENANT_A, archivedId, "completed");
    seedLifecycleStateForTest(context.store, TENANT_A, tombstonedId, "completed");

    const archived = await patchRecord(archivedId, "archive", 1, "id_cccccccccccccccc");
    assert.equal(archived.status, 200);
    assert.equal(archived.body.record.state, "archived");
    assert.equal(archived.body.record.completedAt, NOW);
    assert.deepEqual(context.store.history(TENANT_A, archivedId)[1].changedFields, [
      { field: "state", before: "completed", after: "archived" },
      { field: "archivedAt", before: null, after: NOW }
    ]);
    const restoredArchive = await patchRecord(archivedId, "restore", 2, "id_dddddddddddddddd");
    assert.equal(restoredArchive.status, 200);
    assert.equal(restoredArchive.body.record.state, "completed");
    assert.equal(restoredArchive.body.record.completedAt, NOW);
    assert.equal(restoredArchive.body.record.archivedAt, null);
    assert.equal(restoredArchive.body.record.deletedAt, null);
    const archiveHistory = context.store.history(TENANT_A, archivedId);
    assert.deepEqual(archiveHistory.map(({ eventKind }) => eventKind), [
      "creation", "archive", "state_transition"
    ]);
    assert.deepEqual(archiveHistory[2].changedFields, [
      { field: "state", before: "archived", after: "completed" },
      { field: "archivedAt", before: NOW, after: null }
    ]);
    assert.deepEqual(archiveHistory[1].changedFields[1], {
      field: "archivedAt", before: null, after: NOW
    });

    const priorTombstoneRecord = structuredClone(context.store.read(TENANT_A, tombstonedId));
    const priorRevisionDigest = `sha256:${createHash("sha256")
      .update(canonicalJson(priorTombstoneRecord)).digest("hex")}`;
    const tombstoned = await patchRecord(tombstonedId, "tombstone", 1, "id_eeeeeeeeeeeeeeee");
    assert.equal(tombstoned.status, 200);
    assert.equal(tombstoned.body.record.state, "deleted_tombstone");
    assert.equal(tombstoned.body.record.completedAt, NOW);
    assert.deepEqual(context.store.history(TENANT_A, tombstonedId)[1].changedFields, [
      { field: "state", before: "completed", after: "deleted_tombstone" },
      { field: "deletedAt", before: null, after: NOW },
      { field: "priorRevisionDigest", before: priorRevisionDigest, after: null }
    ]);
    const restoredTombstone = await patchRecord(tombstonedId, "restore", 2, "id_ffffffffffffffff");
    assert.equal(restoredTombstone.status, 200);
    assert.equal(restoredTombstone.body.record.state, "completed");
    assert.equal(restoredTombstone.body.record.completedAt, NOW);
    assert.equal(restoredTombstone.body.record.archivedAt, null);
    assert.equal(restoredTombstone.body.record.deletedAt, null);
    const tombstoneHistory = context.store.history(TENANT_A, tombstonedId);
    assert.deepEqual(tombstoneHistory.map(({ eventKind }) => eventKind), [
      "creation", "delete_tombstone", "state_transition"
    ]);
    assert.deepEqual(tombstoneHistory[2].changedFields, [
      { field: "state", before: "deleted_tombstone", after: "completed" },
      { field: "deletedAt", before: NOW, after: null }
    ]);
    assert.deepEqual(tombstoneHistory[1].changedFields[1], {
      field: "deletedAt", before: null, after: NOW
    });
  } finally {
    await context.close();
  }
});

test("tombstone stores and audits a digest of the complete canonical prior revision", async () => {
  const context = await fixture({
    identities: { "Bearer custodian": facts({ permissions: ["read", "create", "delete", "read_history"] }) }
  });
  try {
    const created = await json(fetch(`${context.base}/api/private/tenants/${TENANT_A}/records`, {
      method: "POST",
      headers: { authorization: "Bearer custodian", "content-type": "application/json" },
      body: JSON.stringify(createBody({
        title: "Private title excluded from active tombstone projection"
      }))
    }));
    const recordId = created.body.record.recordId;
    const priorRevision = structuredClone(context.store.read(TENANT_A, recordId));
    const expectedDigest = `sha256:${createHash("sha256").update(canonicalJson(priorRevision)).digest("hex")}`;
    const deleted = await json(fetch(
      `${context.base}/api/private/tenants/${TENANT_A}/records/${recordId}`,
      {
        method: "PATCH",
        headers: { authorization: "Bearer custodian", "content-type": "application/json" },
        body: JSON.stringify(mutationBody("tombstone", 1, {}))
      }
    ));
    assert.equal(deleted.status, 200);
    const deletionEvent = context.store.history(TENANT_A, recordId).at(-1);
    assert.deepEqual(deletionEvent.changedFields.find(({ field }) => field === "priorRevisionDigest"), {
      field: "priorRevisionDigest",
      before: expectedDigest,
      after: null
    });
    assert.deepEqual(context.store.readTombstoneDigest(TENANT_A, recordId), {
      priorRevision: 1,
      digest: expectedDigest
    });
    const hidden = await json(fetch(
      `${context.base}/api/private/tenants/${TENANT_A}/records/${recordId}`,
      { headers: { authorization: "Bearer custodian" } }
    ));
    const listed = await json(fetch(
      `${context.base}/api/private/tenants/${TENANT_A}/records`,
      { headers: { authorization: "Bearer custodian" } }
    ));
    assert.deepEqual(hidden, {
      status: 404,
      headers: hidden.headers,
      body: { error: "not_found" }
    });
    assert.deepEqual(listed.body.records, []);
    assert.equal(JSON.stringify(hidden.body).includes(priorRevision.title), false);
    assert.equal(JSON.stringify(listed.body).includes(priorRevision.title), false);
  } finally {
    await context.close();
  }
});

test("authorized history keeps correction and unavailable-source truth while tenant attacks do not enumerate", async () => {
  const identities = {
    "Bearer historian": facts({ permissions: ["read", "create", "update", "read_history"] }),
    "Bearer no-history": facts({ permissions: ["read"] })
  };
  const context = await fixture({
    identities,
    resolveTrustedReferences: async ({ tenantId, record }) =>
      record.supersedes === null || record.supersedes.tenantId === tenantId
  });
  try {
    const created = await json(fetch(`${context.base}/api/private/tenants/${TENANT_A}/records`, {
      method: "POST",
      headers: { authorization: "Bearer historian", "content-type": "application/json" },
      body: JSON.stringify(createBody())
    }));
    const recordId = created.body.record.recordId;
    const patchRecord = (body) => json(fetch(
      `${context.base}/api/private/tenants/${TENANT_A}/records/${recordId}`,
      {
        method: "PATCH",
        headers: { authorization: "Bearer historian", "content-type": "application/json" },
        body: JSON.stringify(body)
      }
    ));
    const corrected = await patchRecord(mutationBody("correct", 1, {
      supersedes: { tenantId: TENANT_A, recordId: "id_eeeeeeeeeeeeeeee" }
    }));
    assert.equal(corrected.status, 200);
    const priorEvent = structuredClone(context.store.history(TENANT_A, recordId)[0]);
    assert.equal((await patchRecord(mutationBody("correct", 2, {
      supersedes: { tenantId: TENANT_B, recordId: "id_ffffffffffffffff" }
    }, "id_bbbbbbbbbbbbbbbb"))).status, 404);
    const unavailable = await patchRecord(mutationBody(
      "mark_source_unavailable", 2, { availability: "unavailable" }, "id_cccccccccccccccc"
    ));
    assert.equal(unavailable.status, 200);
    assert.equal(unavailable.body.record.freshness, "unavailable");
    assert.equal(unavailable.body.record.source.sourceId, SOURCE_ID);
    assert.deepEqual(context.store.history(TENANT_A, recordId)[0], priorEvent);

    const history = await json(fetch(
      `${context.base}/api/private/tenants/${TENANT_A}/records/${recordId}/history`,
      { headers: { authorization: "Bearer historian" } }
    ));
    assert.equal(history.status, 200);
    assert.deepEqual(history.body.events.map((event) => event.eventKind), [
      "creation", "correction", "state_transition"
    ]);
    const directAudit = await json(fetch(
      `${context.base}/api/private/tenants/${TENANT_A}/records/${recordId}/history/${history.body.events[0].auditEventId}`,
      { headers: { authorization: "Bearer historian" } }
    ));
    assert.equal(directAudit.status, 200);
    assert.equal(directAudit.body.event.recordId, recordId);
    assert.equal(history.headers["cache-control"], "private, no-store");
    for (const [authorization, path] of [
      ["Bearer no-history", `/api/private/tenants/${TENANT_A}/records/${recordId}/history`],
      ["Bearer historian", `/api/private/tenants/${TENANT_B}/records/${recordId}/history`],
      ["Bearer historian", `/api/private/tenants/${TENANT_A}/records/${recordId}/history?cursor=foreign`],
      ["Bearer historian", `/api/private/tenants/${TENANT_A}/records/${recordId}/history/count`],
      ["Bearer historian", `/api/private/tenants/${TENANT_A}/records/${recordId}/history/id_ffffffffffffffff`]
    ]) {
      const denied = await json(fetch(`${context.base}${path}`, { headers: { authorization } }));
      assert.equal(denied.status, 404);
      assert.deepEqual(denied.body, { error: "not_found" });
    }
    console.log(`HISTORY_EVIDENCE ${JSON.stringify(history.body)}`);
  } finally {
    await context.close();
  }
});

test("mutation replay concurrency failure and restart preserve one atomic revision chain", async () => {
  const context = await fixture({
    identities: { "Bearer editor": facts({ permissions: ["read", "create", "update", "read_history"] }) }
  });
  const patchRecord = (recordId, body) => json(fetch(
    `${context.base}/api/private/tenants/${TENANT_A}/records/${recordId}`,
    {
      method: "PATCH",
      headers: { authorization: "Bearer editor", "content-type": "application/json" },
      body: JSON.stringify(body)
    }
  ));
  let reopened;
  try {
    const created = await json(fetch(`${context.base}/api/private/tenants/${TENANT_A}/records`, {
      method: "POST",
      headers: { authorization: "Bearer editor", "content-type": "application/json" },
      body: JSON.stringify(createBody())
    }));
    const recordId = created.body.record.recordId;
    const rename = mutationBody("rename", 1, { title: "First accepted rename" });
    const accepted = await patchRecord(recordId, rename);
    const replay = await patchRecord(recordId, rename);
    assert.equal(accepted.status, 200);
    assert.deepEqual(replay, accepted);
    const conflict = await patchRecord(recordId, mutationBody(
      "rename", 1, { title: "Conflicting request reuse" }
    ));
    assert.equal(conflict.status, 409);
    assert.equal(context.store.countAudits(TENANT_A), 2);

    const race = await Promise.all([
      patchRecord(recordId, mutationBody("rename", 2, { title: "Race winner A" }, "id_bbbbbbbbbbbbbbbb")),
      patchRecord(recordId, mutationBody("rename", 2, { title: "Race winner B" }, "id_cccccccccccccccc"))
    ]);
    assert.deepEqual(race.map(({ status }) => status).sort(), [200, 409]);
    assert.equal(context.store.countAudits(TENANT_A), 3);
    assert.equal(context.store.read(TENANT_A, recordId).revision, 3);

    const originalRun = context.store.insertAuditStatement.run.bind(context.store.insertAuditStatement);
    context.store.insertAuditStatement.run = () => { throw new Error("synthetic storage failure"); };
    const failed = await patchRecord(recordId, mutationBody(
      "rename", 3, { title: "Must roll back" }, "id_dddddddddddddddd"
    ));
    context.store.insertAuditStatement.run = originalRun;
    assert.equal(failed.status, 500);
    assert.equal(context.store.read(TENANT_A, recordId).revision, 3);
    assert.equal(context.store.countAudits(TENANT_A), 3);

    await context.close({ remove: false });
    const { PrivateWorkRecordsStore } = await import("../server/privateWorkRecordsStore.mjs");
    reopened = new PrivateWorkRecordsStore(context.databasePath);
    assert.deepEqual(reopened.history(TENANT_A, recordId).map((event) => event.newRevision), [1, 2, 3]);
    assert.equal(reopened.read(TENANT_A, recordId).revision, 3);
  } finally {
    if (reopened) reopened.close();
    else await context.close({ remove: false });
    rmSync(context.directory, { recursive: true, force: true });
  }
});

test("mutation request identity rejects cross-record reuse without leaking or mutating either record", async () => {
  const context = await fixture({
    identities: { "Bearer editor": facts({ permissions: ["read", "create", "update", "read_history"] }) }
  });
  const patchRecord = (recordId, body) => json(fetch(
    `${context.base}/api/private/tenants/${TENANT_A}/records/${recordId}`,
    {
      method: "PATCH",
      headers: { authorization: "Bearer editor", "content-type": "application/json" },
      body: JSON.stringify(body)
    }
  ));
  try {
    const first = await json(fetch(`${context.base}/api/private/tenants/${TENANT_A}/records`, {
      method: "POST",
      headers: { authorization: "Bearer editor", "content-type": "application/json" },
      body: JSON.stringify(createBody())
    }));
    const second = await json(fetch(`${context.base}/api/private/tenants/${TENANT_A}/records`, {
      method: "POST",
      headers: { authorization: "Bearer editor", "content-type": "application/json" },
      body: JSON.stringify({ ...createBody({ title: "Second synthetic record" }), requestId: "id_bbbbbbbbbbbbbbbb" })
    }));
    const request = mutationBody("rename", 1, { title: "Accepted only for first record" });
    assert.equal((await patchRecord(first.body.record.recordId, request)).status, 200);

    const beforeFirst = structuredClone(context.store.read(TENANT_A, first.body.record.recordId));
    const beforeSecond = structuredClone(context.store.read(TENANT_A, second.body.record.recordId));
    const beforeFirstHistory = structuredClone(context.store.history(TENANT_A, first.body.record.recordId));
    const beforeSecondHistory = structuredClone(context.store.history(TENANT_A, second.body.record.recordId));
    const beforeRequests = Number(context.store.database.prepare(
      "SELECT COUNT(*) AS count FROM private_mutation_requests"
    ).get().count);

    const denied = await patchRecord(second.body.record.recordId, request);
    assert.equal(denied.status, 409);
    assert.deepEqual(denied.body, { error: "conflict" });
    assert.equal(JSON.stringify(denied.body).includes(first.body.record.recordId), false);
    assert.deepEqual(context.store.read(TENANT_A, first.body.record.recordId), beforeFirst);
    assert.deepEqual(context.store.read(TENANT_A, second.body.record.recordId), beforeSecond);
    assert.deepEqual(context.store.history(TENANT_A, first.body.record.recordId), beforeFirstHistory);
    assert.deepEqual(context.store.history(TENANT_A, second.body.record.recordId), beforeSecondHistory);
    assert.equal(Number(context.store.database.prepare(
      "SELECT COUNT(*) AS count FROM private_mutation_requests"
    ).get().count), beforeRequests);

    const third = await json(fetch(`${context.base}/api/private/tenants/${TENANT_A}/records`, {
      method: "POST",
      headers: { authorization: "Bearer editor", "content-type": "application/json" },
      body: JSON.stringify({ ...createBody({ title: "Concurrent target three" }), requestId: "id_cccccccccccccccc" })
    }));
    const fourth = await json(fetch(`${context.base}/api/private/tenants/${TENANT_A}/records`, {
      method: "POST",
      headers: { authorization: "Bearer editor", "content-type": "application/json" },
      body: JSON.stringify({ ...createBody({ title: "Concurrent target four" }), requestId: "id_dddddddddddddddd" })
    }));
    const concurrentReuse = mutationBody(
      "rename", 1, { title: "One record only" }, "id_eeeeeeeeeeeeeeee"
    );
    const beforeConcurrentAudits = context.store.countAudits(TENANT_A);
    const concurrent = await Promise.all([
      patchRecord(third.body.record.recordId, concurrentReuse),
      patchRecord(fourth.body.record.recordId, concurrentReuse)
    ]);
    assert.deepEqual(concurrent.map(({ status }) => status).sort(), [200, 409]);
    assert.equal(context.store.countAudits(TENANT_A), beforeConcurrentAudits + 1);
    assert.equal([
      context.store.read(TENANT_A, third.body.record.recordId).revision,
      context.store.read(TENANT_A, fourth.body.record.recordId).revision
    ].sort().join(","), "1,2");
  } finally {
    await context.close();
  }
});

test("isolated SQLite backup restored to a new location preserves history and record-scoped replay state", async () => {
  const context = await fixture({
    identities: { "Bearer editor": facts({ permissions: ["read", "create", "update", "read_history"] }) }
  });
  const backupDirectory = mkdtempSync(join(tmpdir(), "vibe-private-records-backup-"));
  const restoreDirectory = mkdtempSync(join(tmpdir(), "vibe-private-records-restore-"));
  let restored;
  try {
    const created = await json(fetch(`${context.base}/api/private/tenants/${TENANT_A}/records`, {
      method: "POST",
      headers: { authorization: "Bearer editor", "content-type": "application/json" },
      body: JSON.stringify(createBody())
    }));
    const recordId = created.body.record.recordId;
    const mutation = mutationBody("rename", 1, { title: "Persisted through backup" });
    const renamed = await json(fetch(
      `${context.base}/api/private/tenants/${TENANT_A}/records/${recordId}`,
      {
        method: "PATCH",
        headers: { authorization: "Bearer editor", "content-type": "application/json" },
        body: JSON.stringify(mutation)
      }
    ));
    assert.equal(renamed.status, 200);
    const backupPath = join(backupDirectory, "records-backup.sqlite");
    await backup(context.store.database, backupPath);
    const restoredPath = join(restoreDirectory, "records-restored.sqlite");
    copyFileSync(backupPath, restoredPath);
    const { PrivateWorkRecordsStore } = await import("../server/privateWorkRecordsStore.mjs");
    restored = new PrivateWorkRecordsStore(restoredPath);
    assert.equal(statSync(restoredPath).mode & 0o777, 0o600);
    assert.equal(restored.read(TENANT_A, recordId).title, "Persisted through backup");
    assert.deepEqual(restored.history(TENANT_A, recordId).map(({ newRevision }) => newRevision), [1, 2]);
    assert.deepEqual(restored.replayMutation({
      tenantId: TENANT_A,
      recordId,
      principalId: SUBJECT_A,
      authorizationRef: AUTHORIZATION_ID,
      policyRevision: 1,
      requestId: mutation.requestId,
      requestSemantics: canonicalJson({ recordId, mutation })
    }), { ok: true, replayed: true, record: renamed.body.record });
  } finally {
    if (restored) restored.close();
    await context.close();
    rmSync(backupDirectory, { recursive: true, force: true });
    rmSync(restoreDirectory, { recursive: true, force: true });
  }
});

test("malformed server-authored mutation audit is rejected before record or history changes", async () => {
  let calls = 0;
  const context = await fixture({
    identities: { "Bearer editor": facts({ permissions: ["read", "create", "update"] }) },
    ids: (kind) => {
      calls += 1;
      if (calls === 1 && kind === "record") return "id_aaaaaaaaaaaaaaaa";
      if (calls === 2 && kind === "audit") return "id_bbbbbbbbbbbbbbbb";
      return "malformed-audit-id";
    }
  });
  try {
    const created = await json(fetch(`${context.base}/api/private/tenants/${TENANT_A}/records`, {
      method: "POST",
      headers: { authorization: "Bearer editor", "content-type": "application/json" },
      body: JSON.stringify(createBody())
    }));
    const denied = await json(fetch(
      `${context.base}/api/private/tenants/${TENANT_A}/records/${created.body.record.recordId}`,
      {
        method: "PATCH",
        headers: { authorization: "Bearer editor", "content-type": "application/json" },
        body: JSON.stringify(mutationBody("rename", 1, { title: "Must not persist" }))
      }
    ));
    assert.equal(denied.status, 404);
    assert.equal(context.store.read(TENANT_A, created.body.record.recordId).revision, 1);
    assert.equal(context.store.countAudits(TENANT_A), 1);
  } finally {
    await context.close();
  }
});

test("action-specific mutation audit contract binds actor authority action scope revision and exact delta", async () => {
  const { validateActionSpecificMutationAudit } = await import("../server/privateWorkRecordsApi.mjs");
  const current = {
    ...createBody().record,
    tenantId: TENANT_A,
    recordId: "id_aaaaaaaaaaaaaaaa",
    recordedAt: NOW,
    updatedAt: NOW,
    revision: 1
  };
  const next = { ...current, title: "Bound rename", revision: 2 };
  const authorization = facts({ permissions: ["update"] });
  const audit = {
    auditEventId: "id_bbbbbbbbbbbbbbbb",
    tenantId: TENANT_A,
    recordId: current.recordId,
    eventKind: "rename",
    actor: { tenantId: TENANT_A, subjectId: SUBJECT_A },
    authorizationRef: AUTHORIZATION_ID,
    policyRevision: 1,
    priorRevision: 1,
    newRevision: 2,
    changedFields: [{ field: "title", before: current.title, after: next.title }]
  };
  assert.equal(validateActionSpecificMutationAudit(audit, "rename", current, next, authorization), true);
  for (const malformed of [
    { ...audit, actor: { tenantId: TENANT_A, subjectId: SUBJECT_B } },
    { ...audit, authorizationRef: "id_cccccccccccccccc" },
    { ...audit, eventKind: "reassignment" },
    { ...audit, tenantId: TENANT_B },
    { ...audit, recordId: "id_dddddddddddddddd" },
    { ...audit, priorRevision: 0 },
    { ...audit, newRevision: 3 },
    { ...audit, changedFields: [{ field: "title", before: "fabricated", after: next.title }] }
  ]) {
    assert.equal(validateActionSpecificMutationAudit(malformed, "rename", current, next, authorization), false);
  }
});

test("action-specific audit rejects omitted material lifecycle deltas and null-to-null restore claims", async () => {
  const { validateActionSpecificMutationAudit } = await import("../server/privateWorkRecordsApi.mjs");
  const authorization = facts({ permissions: ["archive", "delete", "transition"] });
  const blockReason = {
    category: "dependency",
    summary: "Synthetic dependency unavailable",
    resolutionAuthority: { tenantId: TENANT_A, subjectId: SUBJECT_A },
    blockedAt: NOW
  };
  const blocked = {
    ...createBody().record,
    tenantId: TENANT_A,
    recordId: "id_aaaaaaaaaaaaaaaa",
    state: "blocked",
    stateChangedAt: NOW,
    blockReason,
    recordedAt: NOW,
    updatedAt: NOW,
    revision: 1
  };
  const audit = (eventKind, changedFields) => ({
    auditEventId: "id_bbbbbbbbbbbbbbbb",
    tenantId: TENANT_A,
    recordId: blocked.recordId,
    eventKind,
    actor: { tenantId: TENANT_A, subjectId: SUBJECT_A },
    authorizationRef: AUTHORIZATION_ID,
    policyRevision: 1,
    priorRevision: 1,
    newRevision: 2,
    changedFields
  });

  const archived = {
    ...blocked,
    state: "archived",
    archivedAt: NOW,
    blockReason: null,
    revision: 2
  };
  assert.equal(validateActionSpecificMutationAudit(
    audit("archive", [{ field: "state", before: "blocked", after: "archived" }]),
    "archive", blocked, archived, authorization
  ), false);
  assert.equal(validateActionSpecificMutationAudit(
    audit("archive", [
      { field: "state", before: "blocked", after: "archived" },
      { field: "archivedAt", before: null, after: NOW },
      { field: "blockReason", before: canonicalJson(blockReason), after: null }
    ]),
    "archive", blocked, archived, authorization
  ), true);

  const tombstoned = {
    ...blocked,
    state: "deleted_tombstone",
    deletedAt: NOW,
    blockReason: null,
    revision: 2
  };
  const priorRevisionDigest = `sha256:${createHash("sha256").update(canonicalJson(blocked)).digest("hex")}`;
  assert.equal(validateActionSpecificMutationAudit(
    audit("delete_tombstone", [
      { field: "state", before: "blocked", after: "deleted_tombstone" },
      { field: "priorRevisionDigest", before: priorRevisionDigest, after: null }
    ]),
    "tombstone", blocked, tombstoned, authorization
  ), false);
  assert.equal(validateActionSpecificMutationAudit(
    audit("delete_tombstone", [
      { field: "state", before: "blocked", after: "deleted_tombstone" },
      { field: "deletedAt", before: null, after: NOW },
      { field: "blockReason", before: canonicalJson(blockReason), after: null },
      { field: "priorRevisionDigest", before: priorRevisionDigest, after: null }
    ]),
    "tombstone", blocked, tombstoned, authorization
  ), true);

  const archivedSource = { ...blocked, state: "archived", archivedAt: NOW, blockReason: null };
  const restored = { ...archivedSource, state: "active", archivedAt: null, revision: 2 };
  assert.equal(validateActionSpecificMutationAudit(
    audit("state_transition", [
      { field: "state", before: "archived", after: "active" },
      { field: "archivedAt", before: NOW, after: null },
      { field: "deletedAt", before: null, after: null }
    ]),
    "restore", archivedSource, restored, authorization
  ), false);
  assert.equal(validateActionSpecificMutationAudit(
    audit("state_transition", [
      { field: "state", before: "archived", after: "active" },
      { field: "archivedAt", before: NOW, after: null }
    ]),
    "restore", archivedSource, restored, authorization
  ), true);

  const tombstonedSource = {
    ...blocked,
    state: "deleted_tombstone",
    deletedAt: NOW,
    blockReason: null
  };
  const restoredTombstone = { ...tombstonedSource, state: "active", deletedAt: null, revision: 2 };
  assert.equal(validateActionSpecificMutationAudit(
    audit("state_transition", [
      { field: "state", before: "deleted_tombstone", after: "active" },
      { field: "deletedAt", before: NOW, after: null }
    ]),
    "restore", tombstonedSource, restoredTombstone, authorization
  ), true);
});

test("no-op rename reassignment correction and source-unavailable requests append no revision audit or replay", async () => {
  const context = await fixture({
    identities: { "Bearer editor": facts({ permissions: ["read", "create", "update", "assign"] }) }
  });
  try {
    const created = await json(fetch(`${context.base}/api/private/tenants/${TENANT_A}/records`, {
      method: "POST",
      headers: { authorization: "Bearer editor", "content-type": "application/json" },
      body: JSON.stringify(createBody({ freshness: "unavailable" }))
    }));
    const recordId = created.body.record.recordId;
    const requests = [
      mutationBody("rename", 1, { title: created.body.record.title }, "id_1111111111111111"),
      mutationBody("reassign", 1, { assignees: [] }, "id_2222222222222222"),
      mutationBody("correct", 1, { supersedes: null }, "id_3333333333333333"),
      mutationBody("mark_source_unavailable", 1, { availability: "unavailable" }, "id_4444444444444444")
    ];
    for (const request of requests) {
      const denied = await json(fetch(
        `${context.base}/api/private/tenants/${TENANT_A}/records/${recordId}`,
        {
          method: "PATCH",
          headers: { authorization: "Bearer editor", "content-type": "application/json" },
          body: JSON.stringify(request)
        }
      ));
      assert.equal(denied.status, 404, request.action);
      assert.deepEqual(denied.body, { error: "not_found" });
    }
    assert.deepEqual(context.store.read(TENANT_A, recordId), created.body.record);
    assert.equal(context.store.countAudits(TENANT_A), 1);
    assert.equal(Number(context.store.database.prepare(
      "SELECT COUNT(*) AS count FROM private_mutation_requests"
    ).get().count), 0);
  } finally {
    await context.close();
  }
});

test("structured reassignment and correction key-order no-ops leave record audit and replay unchanged", async () => {
  const assignee = { tenantId: TENANT_A, subjectId: SUBJECT_B };
  const supersedes = { tenantId: TENANT_A, recordId: "id_eeeeeeeeeeeeeeee" };
  const context = await fixture({
    identities: { "Bearer editor": facts({ permissions: ["read", "create", "update", "assign"] }) },
    resolveTrustedReferences: async () => true
  });
  try {
    const created = await json(fetch(`${context.base}/api/private/tenants/${TENANT_A}/records`, {
      method: "POST",
      headers: { authorization: "Bearer editor", "content-type": "application/json" },
      body: JSON.stringify(createBody({ assignees: [assignee], supersedes }))
    }));
    assert.equal(created.status, 201);
    const recordId = created.body.record.recordId;
    const beforeRecord = structuredClone(context.store.read(TENANT_A, recordId));
    const beforeHistory = structuredClone(context.store.history(TENANT_A, recordId));
    const beforeRequests = Number(context.store.database.prepare(
      "SELECT COUNT(*) AS count FROM private_mutation_requests"
    ).get().count);
    const requests = [
      mutationBody("reassign", 1, {
        assignees: [{ subjectId: SUBJECT_B, tenantId: TENANT_A }]
      }, "id_1111111111111111"),
      mutationBody("correct", 1, {
        supersedes: { recordId: supersedes.recordId, tenantId: TENANT_A }
      }, "id_2222222222222222")
    ];

    for (const request of requests) {
      const denied = await json(fetch(
        `${context.base}/api/private/tenants/${TENANT_A}/records/${recordId}`,
        {
          method: "PATCH",
          headers: { authorization: "Bearer editor", "content-type": "application/json" },
          body: JSON.stringify(request)
        }
      ));
      assert.equal(denied.status, 404, request.action);
      assert.deepEqual(denied.body, { error: "not_found" });
    }
    assert.deepEqual(context.store.read(TENANT_A, recordId), beforeRecord);
    assert.deepEqual(context.store.history(TENANT_A, recordId), beforeHistory);
    assert.equal(context.store.countAudits(TENANT_A), 1);
    assert.equal(Number(context.store.database.prepare(
      "SELECT COUNT(*) AS count FROM private_mutation_requests"
    ).get().count), beforeRequests);
  } finally {
    await context.close();
  }
});

test("action-specific malformed audit variants fail atomically before record audit or replay persistence", async () => {
  const transforms = [
    (audit) => ({ ...audit, actor: { tenantId: TENANT_A, subjectId: SUBJECT_B } }),
    (audit) => ({ ...audit, authorizationRef: "id_cccccccccccccccc" }),
    (audit) => ({ ...audit, eventKind: "reassignment" }),
    (audit) => ({ ...audit, tenantId: TENANT_B }),
    (audit) => ({ ...audit, recordId: "id_dddddddddddddddd" }),
    (audit) => ({ ...audit, priorRevision: 0 }),
    (audit) => ({ ...audit, newRevision: 3 }),
    (audit) => ({
      ...audit,
      changedFields: [{ field: "title", before: "fabricated", after: "Bound rename" }]
    })
  ];
  let transformIndex = 0;
  const context = await fixture({
    identities: { "Bearer editor": facts({ permissions: ["read", "create", "update"] }) },
    transformValidatedMutationAudit: (audit) => transforms[transformIndex++](audit)
  });
  try {
    const created = await json(fetch(`${context.base}/api/private/tenants/${TENANT_A}/records`, {
      method: "POST",
      headers: { authorization: "Bearer editor", "content-type": "application/json" },
      body: JSON.stringify(createBody())
    }));
    const recordId = created.body.record.recordId;
    for (let index = 0; index < transforms.length; index += 1) {
      const denied = await json(fetch(
        `${context.base}/api/private/tenants/${TENANT_A}/records/${recordId}`,
        {
          method: "PATCH",
          headers: { authorization: "Bearer editor", "content-type": "application/json" },
          body: JSON.stringify(mutationBody(
            "rename", 1, { title: "Bound rename" }, `id_${String(index + 1).repeat(16)}`
          ))
        }
      ));
      assert.equal(denied.status, 404);
      assert.deepEqual(denied.body, { error: "not_found" });
    }
    assert.equal(context.store.read(TENANT_A, recordId).revision, 1);
    assert.equal(context.store.countAudits(TENANT_A), 1);
    assert.equal(Number(context.store.database.prepare(
      "SELECT COUNT(*) AS count FROM private_mutation_requests"
    ).get().count), 0);
  } finally {
    await context.close();
  }
});
