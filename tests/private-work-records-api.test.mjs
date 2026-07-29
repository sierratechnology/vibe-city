import assert from "node:assert/strict";
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
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

async function fixture({ identities = {}, ids, resolveTrustedReferences } = {}) {
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
  const handler = createPrivateWorkRecordsApiHandler({
    store,
    domain,
    now: () => Date.parse(NOW),
    generateId,
    resolveTrustedIdentity: async (request) => identities[request.headers.authorization] ?? null,
    resolveTrustedReferences: resolveTrustedReferences ?? (async ({ tenantId, record }) =>
      record.owner.tenantId === tenantId &&
      record.owner.subjectId === (tenantId === TENANT_A ? SUBJECT_A : SUBJECT_B) &&
      record.assignees.length === 0 && record.evidenceLinks.length === 0 &&
      record.source.tenantId === tenantId && record.source.sourceId === SOURCE_ID &&
      record.supersedes === null)
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
