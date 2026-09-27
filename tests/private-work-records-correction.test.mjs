import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import ts from 'typescript';

const TENANT_A = 'id_1111111111111111';
const TENANT_B = 'id_2222222222222222';
const ACTOR = 'id_3333333333333333';
const SOURCE = 'id_4444444444444444';
const AUTHORIZATION = 'id_5555555555555555';
const ORIGINAL = 'id_6666666666666666';
const CORRECTION = 'id_7777777777777777';
const AUDIT = 'id_8888888888888888';
const REQUEST = 'id_9999999999999999';
const CREATED = '2026-09-26T12:00:00.000Z';
const CORRECTED = '2026-09-26T12:04:00.000Z';
const RECORDED = '2026-09-26T12:05:00.000Z';

async function loadDomain() {
  const source = await readFile(new URL('../src/domain/workRecords.ts', import.meta.url), 'utf8');
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(output).toString('base64')}`);
}

function identity(permissions, { tenantId = TENANT_A, active = true } = {}) {
  return {
    authorizationId: AUTHORIZATION,
    actorSubjectId: ACTOR,
    authenticated: true,
    memberships: [{ tenantId, status: active ? 'active' : 'inactive', role: 'member' }],
    permissions,
    decisionAuthorities: [],
    policyRevision: 'policy-1',
  };
}

function originalRecord({ tenantId = TENANT_A, recordId = ORIGINAL } = {}) {
  return {
    tenantId, recordId, title: 'Original synthetic claim',
    owner: { tenantId, subjectId: ACTOR }, assignees: [], lifecycle: 'open',
    freshness: 'unknown', sensitivity: 'tenant_private', revision: 1,
    createdAt: CREATED, updatedAt: CREATED,
    source: {
      tenantId, sourceId: SOURCE,
      occurredAt: '2026-09-26T11:58:00.000Z',
      observedAt: '2026-09-26T11:59:00.000Z', recordedAt: CREATED,
    },
    evidence: [], supersedes: null, correctionOf: null,
    archivedAt: null, deletedAt: null,
  };
}

function creationAudit(record) {
  return {
    auditId: 'id_aaaaaaaaaaaaaaaa', tenantId: record.tenantId, recordId: record.recordId,
    actorSubjectId: ACTOR, authorizationId: AUTHORIZATION, policyRevision: 'policy-1',
    sourceId: SOURCE, priorRevision: 0, newRevision: 1,
    occurredAt: CREATED, recordedAt: CREATED, changedFields: ['recordId'],
  };
}

function correctionBody(overrides = {}) {
  return {
    expectedRevision: 1,
    requestId: REQUEST,
    occurredAt: CORRECTED,
    reasonRef: 'direction-synthetic-correction',
    record: {
      title: 'Corrected synthetic claim',
      owner: { tenantId: TENANT_A, subjectId: ACTOR },
      assignees: [], lifecycle: 'open', freshness: 'unknown',
      source: {
        tenantId: TENANT_A, sourceId: SOURCE,
        occurredAt: '2026-09-26T12:01:00.000Z',
        observedAt: '2026-09-26T12:02:00.000Z',
        recordedAt: '2026-09-26T12:03:00.000Z',
      },
      evidence: [], supersedes: null, archivedAt: null, deletedAt: null,
    },
    ...overrides,
  };
}

async function fixture({
  identities = { 'Bearer corrector': identity(['record.correct']) },
  resolveTrustedReferences = async () => true,
  ids = [CORRECTION, AUDIT],
  seedRecord = originalRecord(),
  seed = true,
  databasePath,
  now = Date.parse(RECORDED),
} = {}) {
  const [{ createPrivateWorkRecordsApiHandler }, { PrivateWorkRecordsStore }, domain] = await Promise.all([
    import('../server/privateWorkRecordsApi.mjs'),
    import('../server/privateWorkRecordsStore.mjs'),
    loadDomain(),
  ]);
  const directory = databasePath ? null : mkdtempSync(join(tmpdir(), 'office-private-correction-'));
  const path = databasePath ?? join(directory, 'records.sqlite');
  const store = new PrivateWorkRecordsStore(path);
  const original = seedRecord;
  if (seed) {
    assert.deepEqual(store.create(original, creationAudit(original), 0), { ok: true, replayed: false });
  }
  let sequence = 0;
  const server = createServer(createPrivateWorkRecordsApiHandler({
    store, domain,
    resolveTrustedIdentity: async (request) => identities[request.headers.authorization] ?? null,
    resolveTrustedReferences,
    now: () => now,
    generateId: () => ids[sequence++],
  }));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    base: `http://127.0.0.1:${server.address().port}`, store, original,
    async close() {
      await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
      store.close();
      if (directory !== null) rmSync(directory, { recursive: true, force: true });
    },
  };
}

async function json(responsePromise) {
  const response = await responsePromise;
  return { status: response.status, body: await response.json() };
}

function correct(base, authorization = 'Bearer corrector', body = correctionBody(),
  recordId = ORIGINAL, tenantId = TENANT_A) {
  return json(fetch(`${base}/api/private/tenants/${tenantId}/records/${recordId}/correction`, {
    method: 'POST',
    headers: { authorization, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }));
}

async function rawCorrect(base, path, body, contentType = 'application/json') {
  const response = await fetch(`${base}${path}`, {
    method: 'POST',
    headers: { authorization: 'Bearer corrector', 'content-type': contentType },
    body,
  });
  const text = await response.text();
  return { status: response.status, body: JSON.parse(text), headers: response.headers, text };
}

function requestRows(store) {
  return store.database.prepare(`
    SELECT operation, request_id, request_semantics, record_json
    FROM private_mutation_requests ORDER BY rowid
  `).all();
}

test('authorized correction creates one linked private record while original record and history stay byte-identical', async () => {
  const context = await fixture();
  try {
    const originalBytes = JSON.stringify(context.store.read(TENANT_A, ORIGINAL));
    const originalHistoryBytes = JSON.stringify(context.store.readHistory(TENANT_A, ORIGINAL, 50));
    const result = await correct(context.base);

    assert.equal(result.status, 201);
    assert.deepEqual(result.body.record, {
      ...correctionBody().record,
      tenantId: TENANT_A,
      recordId: CORRECTION,
      sensitivity: 'tenant_private',
      correctionOf: { tenantId: TENANT_A, recordId: ORIGINAL },
      revision: 1,
      createdAt: RECORDED,
      updatedAt: RECORDED,
    });
    assert.equal(JSON.stringify(context.store.read(TENANT_A, ORIGINAL)), originalBytes);
    assert.equal(JSON.stringify(context.store.readHistory(TENANT_A, ORIGINAL, 50)), originalHistoryBytes);
    assert.deepEqual(context.store.read(TENANT_A, CORRECTION), result.body.record);
    assert.deepEqual(context.store.readHistory(TENANT_A, CORRECTION, 50), [{
      auditId: AUDIT, tenantId: TENANT_A, recordId: CORRECTION,
      eventKind: 'correction', actorSubjectId: ACTOR,
      authorizationId: AUTHORIZATION, policyRevision: 'policy-1', sourceId: SOURCE,
      reasonRef: 'direction-synthetic-correction', priorRevision: 0, newRevision: 1,
      occurredAt: CORRECTED, recordedAt: RECORDED,
      changedFields: {
        recordId: { prior: null, next: CORRECTION },
        correctionOf: { prior: null, next: { tenantId: TENANT_A, recordId: ORIGINAL } },
      },
    }]);
    assert.deepEqual(requestRows(context.store).map((row) => ({
      operation: row.operation, requestId: row.request_id,
    })), [{ operation: 'correction', requestId: REQUEST }]);
    assert.equal(context.store.countRecords(TENANT_A), 2);
    assert.equal(context.store.countAudits(TENANT_A), 2);
  } finally {
    await context.close();
  }
});

test('correction authority and active route-tenant membership precede lookup and reference resolution', async () => {
  const otherPermissions = [
    'record.create', 'record.read', 'record.rename', 'record.reassign', 'record.block',
    'record.unblock', 'record.history.read', 'record.transition', 'record.archive',
    'record.delete', 'record.restore', 'record.supersede',
  ];
  let referenceCalls = 0;
  const context = await fixture({
    identities: {
      ...Object.fromEntries(otherPermissions.map((permission) => [
        `Bearer ${permission}`, identity([permission]),
      ])),
      'Bearer inactive': identity(['record.correct'], { active: false }),
      'Bearer foreign': identity(['record.correct'], { tenantId: TENANT_B }),
    },
    resolveTrustedReferences: async () => { referenceCalls += 1; return true; },
  });
  const baseline = {
    record: context.store.read(TENANT_A, ORIGINAL),
    history: context.store.readHistory(TENANT_A, ORIGINAL, 50),
    requests: requestRows(context.store),
  };
  let reads = 0;
  const originalRead = context.store.read.bind(context.store);
  context.store.read = (...args) => { reads += 1; return originalRead(...args); };
  try {
    for (const authorization of [
      'Bearer missing', ...otherPermissions.map((permission) => `Bearer ${permission}`),
      'Bearer inactive', 'Bearer foreign',
    ]) {
      assert.deepEqual(await correct(context.base, authorization), {
        status: 404, body: { error: 'not_found' },
      });
    }
    assert.equal(reads, 0);
    assert.equal(referenceCalls, 0);
    assert.deepEqual({
      record: originalRead(TENANT_A, ORIGINAL),
      history: context.store.readHistory(TENANT_A, ORIGINAL, 50),
      requests: requestRows(context.store),
    }, baseline);
  } finally {
    await context.close();
  }
});

test('correction rejects extending an existing correction chain with zero durable delta', async () => {
  const context = await fixture();
  context.store.database.prepare(`
    UPDATE private_work_records SET record_json = ?
    WHERE tenant_id = ? AND record_id = ?
  `).run(JSON.stringify({
    ...context.original,
    correctionOf: { tenantId: TENANT_A, recordId: 'id_bbbbbbbbbbbbbbbb' },
  }), TENANT_A, ORIGINAL);
  const baseline = {
    records: context.store.countRecords(TENANT_A),
    audits: context.store.countAudits(TENANT_A),
    original: context.store.read(TENANT_A, ORIGINAL),
    history: context.store.readHistory(TENANT_A, ORIGINAL, 50),
    requests: requestRows(context.store),
  };
  try {
    assert.deepEqual(await correct(context.base), {
      status: 404, body: { error: 'not_found' },
    });
    assert.deepEqual({
      records: context.store.countRecords(TENANT_A),
      audits: context.store.countAudits(TENANT_A),
      original: context.store.read(TENANT_A, ORIGINAL),
      history: context.store.readHistory(TENANT_A, ORIGINAL, 50),
      requests: requestRows(context.store),
    }, baseline);
  } finally {
    await context.close();
  }
});

test('correction replay is idempotent while conflicting and stale request identities are atomic', async () => {
  const context = await fixture();
  try {
    const accepted = await correct(context.base);
    assert.equal(accepted.status, 201);
    const afterAccepted = {
      records: context.store.countRecords(TENANT_A),
      audits: context.store.countAudits(TENANT_A),
      correction: context.store.read(TENANT_A, CORRECTION),
      correctionHistory: context.store.readHistory(TENANT_A, CORRECTION, 50),
      original: context.store.read(TENANT_A, ORIGINAL),
      originalHistory: context.store.readHistory(TENANT_A, ORIGINAL, 50),
      requests: requestRows(context.store),
    };
    assert.deepEqual(await correct(context.base), { status: 200, body: accepted.body });
    assert.deepEqual(await correct(context.base, 'Bearer corrector', correctionBody({
      reasonRef: 'conflicting-correction-reason',
    })), { status: 409, body: { error: 'conflict' } });
    assert.deepEqual(await correct(context.base, 'Bearer corrector', correctionBody({
      requestId: 'id_cccccccccccccccc', expectedRevision: 2,
    })), { status: 409, body: { error: 'conflict' } });
    assert.deepEqual({
      records: context.store.countRecords(TENANT_A),
      audits: context.store.countAudits(TENANT_A),
      correction: context.store.read(TENANT_A, CORRECTION),
      correctionHistory: context.store.readHistory(TENANT_A, CORRECTION, 50),
      original: context.store.read(TENANT_A, ORIGINAL),
      originalHistory: context.store.readHistory(TENANT_A, ORIGINAL, 50),
      requests: requestRows(context.store),
    }, afterAccepted);
  } finally {
    await context.close();
  }
});

test('correction malformed chronology tenant and alternate-route matrix fails closed with zero delta', async () => {
  const context = await fixture();
  const canonical = `/api/private/tenants/${TENANT_A}/records/${ORIGINAL}/correction`;
  const baseline = {
    records: context.store.countRecords(TENANT_A),
    audits: context.store.countAudits(TENANT_A),
    original: context.store.read(TENANT_A, ORIGINAL),
    history: context.store.readHistory(TENANT_A, ORIGINAL, 50),
    requests: requestRows(context.store),
  };
  try {
    const results = [
      await rawCorrect(context.base, canonical, '{'),
      await rawCorrect(context.base, canonical, JSON.stringify(correctionBody()), 'text/plain'),
      await rawCorrect(context.base, canonical, JSON.stringify(correctionBody()).padEnd(40_000, ' ')),
      await correct(context.base, 'Bearer corrector', { ...correctionBody(), tenantId: TENANT_B }),
      await correct(context.base, 'Bearer corrector', correctionBody({ expectedRevision: '1' })),
      await correct(context.base, 'Bearer corrector', correctionBody({ requestId: 9 })),
      await correct(context.base, 'Bearer corrector', correctionBody({ reasonRef: 9 })),
      await correct(context.base, 'Bearer corrector', correctionBody({ occurredAt: 'not-a-time' })),
      await correct(context.base, 'Bearer corrector', correctionBody({
        occurredAt: '2026-09-26T11:59:59.000Z',
      })),
      await correct(context.base, 'Bearer corrector', correctionBody({
        occurredAt: '2026-09-26T12:06:00.000Z',
      })),
      await correct(context.base, 'Bearer corrector', correctionBody({
        record: { ...correctionBody().record, tenantId: TENANT_B },
      })),
      await correct(context.base, 'Bearer corrector', correctionBody({
        record: { ...correctionBody().record, correctionOf: { tenantId: TENANT_A, recordId: ORIGINAL } },
      })),
      await correct(context.base, 'Bearer corrector', correctionBody({
        record: { ...correctionBody().record, supersedes: { tenantId: TENANT_A, recordId: ORIGINAL } },
      })),
      await correct(context.base, 'Bearer corrector', correctionBody({
        record: {
          ...correctionBody().record,
          owner: { tenantId: TENANT_B, subjectId: ACTOR },
        },
      })),
      await correct(context.base, 'Bearer corrector', correctionBody({
        record: { ...correctionBody().record, lifecycle: 1 },
      })),
      await correct(context.base, 'Bearer corrector', correctionBody({
        record: {
          ...correctionBody().record,
          evidence: [{
            tenantId: TENANT_B, evidenceId: 'id_cccccccccccccccc',
            locator: 'urn:stg:evidence:foreign', recordedAt: CREATED,
          }],
        },
      })),
      await correct(context.base, 'Bearer corrector', correctionBody({
        record: {
          ...correctionBody().record,
          source: {
            ...correctionBody().record.source,
            occurredAt: '2026-09-26T12:03:00.000Z',
            observedAt: '2026-09-26T12:02:00.000Z',
          },
        },
      })),
      await correct(context.base, 'Bearer corrector', correctionBody(), ORIGINAL, TENANT_B),
      await correct(context.base, 'Bearer corrector', correctionBody(), 'id_bbbbbbbbbbbbbbbb'),
      await rawCorrect(context.base, `${canonical}/`, JSON.stringify(correctionBody())),
      await rawCorrect(context.base, `${canonical}?force=true`, JSON.stringify(correctionBody())),
      await rawCorrect(context.base, `/api/private/records/${ORIGINAL}/correction`, JSON.stringify(correctionBody())),
      await rawCorrect(context.base,
        `/api/private/tenants/${TENANT_A}/records/${ORIGINAL}/correct`,
        JSON.stringify(correctionBody())),
    ];
    for (const result of results) {
      assert.deepEqual({ status: result.status, body: result.body }, {
        status: 404, body: { error: 'not_found' },
      });
    }
    assert.equal(results[0].headers.get('cache-control'), 'private, no-store');
    assert.equal(results[0].headers.get('vary'), 'authorization');
    assert.equal(results[0].headers.get('x-content-type-options'), 'nosniff');
    assert.deepEqual({
      records: context.store.countRecords(TENANT_A),
      audits: context.store.countAudits(TENANT_A),
      original: context.store.read(TENANT_A, ORIGINAL),
      history: context.store.readHistory(TENANT_A, ORIGINAL, 50),
      requests: requestRows(context.store),
    }, baseline);
  } finally {
    await context.close();
  }
});

test('correction rolls back record audit and request identity at every insert boundary', async (t) => {
  const boundaries = [
    ['correction-record', 'BEFORE INSERT ON private_work_records'],
    ['audit-append', 'BEFORE INSERT ON private_material_audit_events'],
    ['request-identity', 'BEFORE INSERT ON private_mutation_requests'],
  ];
  for (const [name, clause] of boundaries) {
    await t.test(name, async () => {
      const context = await fixture();
      const baseline = {
        records: context.store.countRecords(TENANT_A),
        audits: context.store.countAudits(TENANT_A),
        original: context.store.read(TENANT_A, ORIGINAL),
        history: context.store.readHistory(TENANT_A, ORIGINAL, 50),
        requests: requestRows(context.store),
      };
      try {
        context.store.database.exec(`
          CREATE TRIGGER fail_correction_boundary ${clause}
          BEGIN SELECT RAISE(ABORT, 'synthetic correction failure'); END;
        `);
        assert.deepEqual(await correct(context.base), {
          status: 409, body: { error: 'conflict' },
        });
        assert.deepEqual({
          records: context.store.countRecords(TENANT_A),
          audits: context.store.countAudits(TENANT_A),
          original: context.store.read(TENANT_A, ORIGINAL),
          history: context.store.readHistory(TENANT_A, ORIGINAL, 50),
          requests: requestRows(context.store),
        }, baseline);
      } finally {
        await context.close();
      }
    });
  }
});

test('correction record link audit and replay survive restart with authorized read list and history', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'office-private-correction-restart-'));
  const databasePath = join(directory, 'records.sqlite');
  const identities = {
    'Bearer operator': identity(['record.correct', 'record.read', 'record.history.read']),
  };
  let context;
  try {
    context = await fixture({ identities, databasePath });
    const originalBytes = JSON.stringify(context.store.read(TENANT_A, ORIGINAL));
    const originalHistoryBytes = JSON.stringify(context.store.readHistory(TENANT_A, ORIGINAL, 50));
    const accepted = await correct(context.base, 'Bearer operator');
    assert.equal(accepted.status, 201);
    await context.close();
    context = null;

    context = await fixture({ identities, databasePath, seed: false });
    const root = `${context.base}/api/private/tenants/${TENANT_A}/records`;
    assert.equal(JSON.stringify(context.store.read(TENANT_A, ORIGINAL)), originalBytes);
    assert.equal(JSON.stringify(context.store.readHistory(TENANT_A, ORIGINAL, 50)), originalHistoryBytes);
    assert.deepEqual(await json(fetch(`${root}/${CORRECTION}`, {
      headers: { authorization: 'Bearer operator' },
    })), { status: 200, body: accepted.body });
    const listed = await json(fetch(root, { headers: { authorization: 'Bearer operator' } }));
    assert.equal(listed.status, 200);
    assert.deepEqual(listed.body.records.map((record) => record.recordId), [CORRECTION, ORIGINAL]);
    assert.deepEqual(listed.body.records[0].correctionOf, {
      tenantId: TENANT_A, recordId: ORIGINAL,
    });
    const correctionHistory = await json(fetch(`${root}/${CORRECTION}/history`, {
      headers: { authorization: 'Bearer operator' },
    }));
    assert.equal(correctionHistory.status, 200);
    assert.deepEqual(correctionHistory.body.history.map((event) => event.eventKind), ['correction']);
    assert.deepEqual(await json(fetch(
      `${context.base}/api/private/tenants/${TENANT_B}/records/${CORRECTION}`,
      { headers: { authorization: 'Bearer operator' } },
    )), { status: 404, body: { error: 'not_found' } });
    const beforeReplay = {
      records: context.store.countRecords(TENANT_A),
      audits: context.store.countAudits(TENANT_A),
      requests: requestRows(context.store),
    };
    assert.deepEqual(await correct(context.base, 'Bearer operator'), {
      status: 200, body: accepted.body,
    });
    assert.deepEqual({
      records: context.store.countRecords(TENANT_A),
      audits: context.store.countAudits(TENANT_A),
      requests: requestRows(context.store),
    }, beforeReplay);
  } finally {
    if (context) await context.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('correction rejects generated identity collisions and unresolved references atomically', async (t) => {
  await t.test('generated self-reference', async () => {
    const context = await fixture({ ids: [ORIGINAL, AUDIT] });
    const baseline = {
      records: context.store.countRecords(TENANT_A), audits: context.store.countAudits(TENANT_A),
      original: context.store.read(TENANT_A, ORIGINAL), requests: requestRows(context.store),
    };
    try {
      assert.deepEqual(await correct(context.base), {
        status: 404, body: { error: 'not_found' },
      });
      assert.deepEqual({
        records: context.store.countRecords(TENANT_A), audits: context.store.countAudits(TENANT_A),
        original: context.store.read(TENANT_A, ORIGINAL), requests: requestRows(context.store),
      }, baseline);
    } finally {
      await context.close();
    }
  });

  await t.test('duplicate generated record ID', async () => {
    const context = await fixture();
    const existing = originalRecord({ recordId: CORRECTION });
    assert.deepEqual(context.store.create(existing, {
      ...creationAudit(existing), auditId: 'id_dddddddddddddddd',
    }, 0), { ok: true, replayed: false });
    const baseline = {
      records: context.store.countRecords(TENANT_A), audits: context.store.countAudits(TENANT_A),
      original: context.store.read(TENANT_A, ORIGINAL), existing: context.store.read(TENANT_A, CORRECTION),
      requests: requestRows(context.store),
    };
    try {
      assert.deepEqual(await correct(context.base), {
        status: 409, body: { error: 'conflict' },
      });
      assert.deepEqual({
        records: context.store.countRecords(TENANT_A), audits: context.store.countAudits(TENANT_A),
        original: context.store.read(TENANT_A, ORIGINAL), existing: context.store.read(TENANT_A, CORRECTION),
        requests: requestRows(context.store),
      }, baseline);
    } finally {
      await context.close();
    }
  });

  await t.test('trusted reference rejection', async () => {
    let calls = 0;
    const context = await fixture({
      resolveTrustedReferences: async () => { calls += 1; return false; },
    });
    const baseline = {
      records: context.store.countRecords(TENANT_A), audits: context.store.countAudits(TENANT_A),
      original: context.store.read(TENANT_A, ORIGINAL), requests: requestRows(context.store),
    };
    try {
      assert.deepEqual(await correct(context.base), {
        status: 404, body: { error: 'not_found' },
      });
      assert.equal(calls, 1);
      assert.deepEqual({
        records: context.store.countRecords(TENANT_A), audits: context.store.countAudits(TENANT_A),
        original: context.store.read(TENANT_A, ORIGINAL), requests: requestRows(context.store),
      }, baseline);
    } finally {
      await context.close();
    }
  });
});

test('correction rejects a malformed server-generated audit identity with zero durable delta', async () => {
  const context = await fixture({ ids: [CORRECTION, 'malformed-audit-id'] });
  const baseline = {
    records: context.store.countRecords(TENANT_A), audits: context.store.countAudits(TENANT_A),
    original: context.store.read(TENANT_A, ORIGINAL),
    history: context.store.readHistory(TENANT_A, ORIGINAL, 50),
    requests: requestRows(context.store),
  };
  try {
    assert.deepEqual(await correct(context.base), {
      status: 404, body: { error: 'not_found' },
    });
    assert.deepEqual({
      records: context.store.countRecords(TENANT_A), audits: context.store.countAudits(TENANT_A),
      original: context.store.read(TENANT_A, ORIGINAL),
      history: context.store.readHistory(TENANT_A, ORIGINAL, 50),
      requests: requestRows(context.store),
    }, baseline);
  } finally {
    await context.close();
  }
});
