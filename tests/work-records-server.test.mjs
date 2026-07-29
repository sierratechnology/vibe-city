import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

const FIXED_NOW = "2026-07-28T22:00:05.000Z";
const EVENT = Object.freeze({
  version: "1.0",
  eventId: "evt_11111111111111111111111111111111",
  sourceType: "hermes_kanban",
  workRef: "public-a92cfe6086ac4f34",
  profileId: "ariadne",
  eventKind: "task_started",
  status: "running",
  occurredAt: "2026-07-28T22:00:00.000Z",
  observedAt: FIXED_NOW,
  summary: "Work is in progress."
});

test("authenticated event traverses validation, durable storage, and public read projection", async () => {
  const { WorkRecordStore, ingestWorkEvent, readWorkEvents } = await import("../server/workRecords.mjs");
  const directory = mkdtempSync(join(tmpdir(), "vibe-work-records-"));
  const databasePath = join(directory, "records.sqlite");
  try {
    const store = new WorkRecordStore(databasePath);
    const accepted = ingestWorkEvent({
      authorization: "Bearer local-test-token",
      expectedToken: "local-test-token",
      body: EVENT,
      store
    });
    assert.deepEqual(accepted, { status: 201, body: { accepted: true, eventId: EVENT.eventId } });
    store.close();

    const restarted = new WorkRecordStore(databasePath);
    const projection = readWorkEvents({ store: restarted, now: () => Date.parse(FIXED_NOW), limit: 10 });
    assert.equal(projection.status, 200);
    assert.equal(projection.body.schemaVersion, "1.0");
    assert.equal(projection.body.source.type, "authenticated_local_work_events");
    assert.equal(projection.body.freshness, "recent");
    assert.deepEqual(projection.body.events, [EVENT]);
    restarted.close();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("ingestion fails closed for absent or invalid authentication", async () => {
  const { WorkRecordStore, ingestWorkEvent } = await import("../server/workRecords.mjs");
  const directory = mkdtempSync(join(tmpdir(), "vibe-work-auth-"));
  const store = new WorkRecordStore(join(directory, "records.sqlite"));
  try {
    for (const attempt of [
      { authorization: undefined, expectedToken: "local-test-token" },
      { authorization: "Bearer wrong-test-token", expectedToken: "local-test-token" },
      { authorization: "Bearer local-test-token", expectedToken: undefined }
    ]) {
      assert.deepEqual(ingestWorkEvent({ ...attempt, body: EVENT, store }), {
        status: 401,
        body: { accepted: false, error: "unauthorized" }
      });
    }
    assert.equal(store.count(), 0);
  } finally {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("contract rejects unknown fields, unsafe summaries, unsupported versions, and invalid chronology", async () => {
  const { validateWorkEvent } = await import("../server/workRecords.mjs");
  const now = () => Date.parse(FIXED_NOW);
  const cases = [
    [{ ...EVENT, privateTaskBody: "do not publish" }, "unknown_or_missing_field"],
    [{ ...EVENT, summary: "Contact private@example.com" }, "unsafe_summary"],
    [{ ...EVENT, summary: "Read /Users/devon/private.txt" }, "unsafe_summary"],
    [{ ...EVENT, summary: "Arbitrary public-looking detail." }, "unsafe_summary"],
    [{ ...EVENT, eventId: "raw-task-reference" }, "invalid_identifier"],
    [{ ...EVENT, workRef: "public-raw-task-reference" }, "invalid_identifier"],
    [{ ...EVENT, profileId: "unknown-worker" }, "invalid_identifier"],
    [{ ...EVENT, version: "2.0" }, "unsupported_version"],
    [{ ...EVENT, occurredAt: "2026-07-28T22:00:06.000Z" }, "invalid_chronology"],
    [{ ...EVENT, observedAt: "2026-07-28T22:00:06.000Z" }, "invalid_chronology"]
  ];
  for (const [candidate, code] of cases) {
    assert.deepEqual(validateWorkEvent(candidate, { now }), { ok: false, code });
  }
  const safe = validateWorkEvent(EVENT, { now });
  assert.equal(safe.ok, true);
  assert.deepEqual(Object.keys(safe.event).sort(), [
    "eventId", "eventKind", "observedAt", "occurredAt", "profileId",
    "sourceType", "status", "summary", "version", "workRef"
  ]);
});

test("duplicate IDs fail closed without changing the durable record", async () => {
  const { WorkRecordStore, ingestWorkEvent } = await import("../server/workRecords.mjs");
  const directory = mkdtempSync(join(tmpdir(), "vibe-work-dedupe-"));
  const store = new WorkRecordStore(join(directory, "records.sqlite"));
  const request = {
    authorization: "Bearer local-test-token",
    expectedToken: "local-test-token",
    body: EVENT,
    store,
    now: () => Date.parse(FIXED_NOW)
  };
  try {
    assert.equal(ingestWorkEvent(request).status, 201);
    assert.deepEqual(ingestWorkEvent({ ...request, body: { ...EVENT, occurredAt: "2026-07-28T21:59:59.000Z" } }), {
      status: 409,
      body: { accepted: false, error: "duplicate_event" }
    });
    assert.equal(store.count(), 1);
    assert.equal(store.list(10)[0].summary, EVENT.summary);
  } finally {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("read projection is bounded and reports empty and stale source truth", async () => {
  const { WorkRecordStore, readWorkEvents } = await import("../server/workRecords.mjs");
  const directory = mkdtempSync(join(tmpdir(), "vibe-work-read-"));
  const store = new WorkRecordStore(join(directory, "records.sqlite"));
  try {
    const empty = readWorkEvents({ store, now: () => Date.parse(FIXED_NOW), limit: 999 });
    assert.equal(empty.body.freshness, "empty");
    assert.equal(empty.body.source.eventCount, 0);
    assert.deepEqual(empty.body.events, []);
    store.insert(EVENT);
    const stale = readWorkEvents({
      store,
      now: () => Date.parse("2026-07-28T22:16:00.000Z"),
      limit: 999
    });
    assert.equal(stale.body.freshness, "stale");
    assert.equal(stale.body.events.length, 1);
    assert.deepEqual(Object.keys(stale.body.events[0]).sort(), [
      "eventId", "eventKind", "observedAt", "occurredAt", "profileId",
      "sourceType", "status", "summary", "version", "workRef"
    ]);
    assert.equal(JSON.stringify(stale).includes("authorization"), false);
    assert.equal(JSON.stringify(stale).includes("privateTaskBody"), false);

    store.insert({
      ...EVENT,
      eventId: "evt_22222222222222222222222222222222",
      occurredAt: "2026-07-28T21:00:00.000Z",
      observedAt: "2026-07-28T22:15:00.000Z"
    });
    const recentlyObserved = readWorkEvents({
      store,
      now: () => Date.parse("2026-07-28T22:16:00.000Z"),
      limit: 999
    });
    assert.equal(recentlyObserved.body.freshness, "recent");
    assert.equal(recentlyObserved.body.source.newestObservedAt, "2026-07-28T22:15:00.000Z");
    assert.equal(recentlyObserved.body.source.newestOccurredAt, EVENT.occurredAt);
    assert.equal(recentlyObserved.body.events[0].eventId, "evt_22222222222222222222222222222222");
  } finally {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("read projection fails closed when persisted rows are no longer valid public events", async () => {
  const { WorkRecordStore, readWorkEvents } = await import("../server/workRecords.mjs");
  const directory = mkdtempSync(join(tmpdir(), "vibe-work-tampered-"));
  const store = new WorkRecordStore(join(directory, "records.sqlite"));
  try {
    store.insert({ ...EVENT, summary: "secret@example.com /Users/devon/private" });
    const projection = readWorkEvents({ store, now: () => Date.parse(FIXED_NOW), limit: 20 });
    assert.deepEqual(projection, {
      status: 500,
      body: { error: "invalid_persisted_record" }
    });
    assert.equal(JSON.stringify(projection).includes("secret@example.com"), false);
    assert.equal(JSON.stringify(projection).includes("/Users/devon/private"), false);
  } finally {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("read projection fails closed when an invalid persisted row is outside the returned window", async () => {
  const { WorkRecordStore, readWorkEvents } = await import("../server/workRecords.mjs");
  const directory = mkdtempSync(join(tmpdir(), "vibe-work-hidden-tamper-"));
  const store = new WorkRecordStore(join(directory, "records.sqlite"));
  try {
    for (let index = 0; index < 21; index += 1) {
      const second = String(20 - index).padStart(2, "0");
      store.insert({
        ...EVENT,
        eventId: `evt_${String(index + 1).padStart(32, "0")}`,
        occurredAt: `2026-07-28T21:59:${second}.000Z`,
        observedAt: FIXED_NOW
      });
    }
    store.insert({
      ...EVENT,
      eventId: "evt_ffffffffffffffffffffffffffffffff",
      occurredAt: "2026-07-28T20:00:00.000Z",
      observedAt: "2026-07-28T20:00:05.000Z",
      summary: "secret@example.com /Users/devon/private"
    });
    const projection = readWorkEvents({ store, now: () => Date.parse(FIXED_NOW), limit: 20 });
    assert.deepEqual(projection, {
      status: 500,
      body: { error: "invalid_persisted_record" }
    });
    assert.equal(JSON.stringify(projection).includes("secret@example.com"), false);
  } finally {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("store creates schema version two and rejects unsupported future database versions", async () => {
  const { WorkRecordStore } = await import("../server/workRecords.mjs");
  const directory = mkdtempSync(join(tmpdir(), "vibe-work-schema-"));
  const databasePath = join(directory, "records.sqlite");
  try {
    const initial = new WorkRecordStore(databasePath);
    initial.close();
    assert.equal(statSync(databasePath).mode & 0o777, 0o600);
    const database = new DatabaseSync(databasePath);
    assert.equal(database.prepare("PRAGMA user_version").get().user_version, 2);
    database.exec("PRAGMA user_version = 99");
    database.close();
    assert.throws(() => new WorkRecordStore(databasePath), /Unsupported work-record database schema/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("failed schema migration closes all database descriptors before rethrowing", async () => {
  const { WorkRecordStore } = await import("../server/workRecords.mjs");
  const directory = mkdtempSync(join(tmpdir(), "vibe-work-migration-failure-"));
  const databasePath = join(directory, "records.sqlite");
  const countOpenDescriptors = () => readdirSync("/dev/fd").length;
  try {
    const malformed = new DatabaseSync(databasePath);
    malformed.exec(`
      CREATE TABLE work_events (event_id TEXT PRIMARY KEY) STRICT;
      PRAGMA user_version = 1;
    `);
    malformed.close();

    const descriptorsBefore = countOpenDescriptors();
    for (let attempt = 0; attempt < 20; attempt += 1) {
      assert.throws(() => new WorkRecordStore(databasePath));
    }
    const descriptorsAfter = countOpenDescriptors();

    assert.ok(
      descriptorsAfter <= descriptorsBefore + 2,
      `failed migrations leaked ${descriptorsAfter - descriptorsBefore} descriptors`
    );
    const verified = new DatabaseSync(databasePath);
    assert.equal(verified.prepare("PRAGMA user_version").get().user_version, 1);
    assert.deepEqual(
      verified.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all().map((row) => row.name),
      ["work_events"]
    );
    verified.close();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("store transactionally migrates a version-one database without losing accepted events", async () => {
  const { WorkRecordStore, readWorkEvents } = await import("../server/workRecords.mjs");
  const directory = mkdtempSync(join(tmpdir(), "vibe-work-migration-"));
  const databasePath = join(directory, "records.sqlite");
  try {
    const legacy = new DatabaseSync(databasePath);
    legacy.exec(`
      CREATE TABLE work_events (
        event_id TEXT PRIMARY KEY,
        version TEXT NOT NULL,
        source_type TEXT NOT NULL,
        work_ref TEXT NOT NULL,
        profile_id TEXT NOT NULL,
        event_kind TEXT NOT NULL,
        status TEXT NOT NULL,
        occurred_at TEXT NOT NULL,
        observed_at TEXT NOT NULL,
        summary TEXT NOT NULL
      ) STRICT;
      CREATE INDEX work_events_occurred_at ON work_events(occurred_at DESC, event_id DESC);
      PRAGMA user_version = 1;
    `);
    legacy.prepare(`
      INSERT INTO work_events (
        event_id, version, source_type, work_ref, profile_id, event_kind, status, occurred_at, observed_at, summary
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      EVENT.eventId, EVENT.version, EVENT.sourceType, EVENT.workRef, EVENT.profileId,
      EVENT.eventKind, EVENT.status, EVENT.occurredAt, EVENT.observedAt, EVENT.summary
    );
    legacy.close();

    const migrated = new WorkRecordStore(databasePath);
    const projection = readWorkEvents({ store: migrated, now: () => Date.parse(FIXED_NOW), limit: 20 });
    migrated.close();
    assert.equal(projection.status, 200);
    assert.deepEqual(projection.body.events, [EVENT]);

    const verified = new DatabaseSync(databasePath);
    assert.equal(verified.prepare("PRAGMA user_version").get().user_version, 2);
    const row = verified.prepare("SELECT accepted_at FROM work_events WHERE event_id = ?").get(EVENT.eventId);
    assert.equal(row.accepted_at, EVENT.observedAt);
    verified.close();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
