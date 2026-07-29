import { timingSafeEqual } from "node:crypto";
import { chmodSync, closeSync, openSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

const SCHEMA_VERSION = "1.0";
const EVENT_KEYS = Object.freeze([
  "eventId",
  "eventKind",
  "observedAt",
  "occurredAt",
  "profileId",
  "sourceType",
  "status",
  "summary",
  "version",
  "workRef"
]);
const EVENT_KINDS = new Set(["task_assigned", "task_started", "status_changed", "blocked", "completed", "review_requested"]);
const STATUSES = new Set(["ready", "running", "blocked", "done"]);
const PUBLIC_PROFILES = new Set(["ariadne", "spiders"]);
const PUBLIC_SUMMARIES = new Map([
  ["task_assigned:ready", "Assigned work is ready."],
  ["task_started:running", "Work is in progress."],
  ["status_changed:ready", "Assigned work is ready."],
  ["status_changed:running", "Work is in progress."],
  ["status_changed:blocked", "Work is blocked pending input."],
  ["status_changed:done", "Work is complete."],
  ["blocked:blocked", "Work is blocked pending input."],
  ["completed:done", "Work is complete."],
  ["review_requested:running", "Work is ready for review."]
]);
const STALE_AFTER_MS = 15 * 60 * 1000;

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isCanonicalIso(value) {
  return typeof value === "string" && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
}

function isSafeSummary(value) {
  return typeof value === "string" && value === value.trim() && value.length >= 1 && value.length <= 240 &&
    !/[\u0000-\u001f\u007f]/.test(value) &&
    !/(?:https?:\/\/|www\.|\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b|\/(?:Users|home|var|private|tmp)\/|[A-Z]:\\)/i.test(value);
}

export function validateWorkEvent(value, { now = Date.now } = {}) {
  if (!isRecord(value)) return { ok: false, code: "invalid_record" };
  let keys;
  try {
    keys = Object.keys(value).sort();
  } catch {
    return { ok: false, code: "invalid_record" };
  }
  if (keys.length !== EVENT_KEYS.length || keys.some((key, index) => key !== EVENT_KEYS[index])) {
    return { ok: false, code: "unknown_or_missing_field" };
  }
  if (value.version !== SCHEMA_VERSION) return { ok: false, code: "unsupported_version" };
  if (value.sourceType !== "hermes_kanban") return { ok: false, code: "unsupported_source" };
  if (!/^evt_[a-f0-9]{32,64}$/.test(value.eventId) || !/^public-[a-f0-9]{16,64}$/.test(value.workRef) || !PUBLIC_PROFILES.has(value.profileId)) {
    return { ok: false, code: "invalid_identifier" };
  }
  if (!EVENT_KINDS.has(value.eventKind) || !STATUSES.has(value.status)) return { ok: false, code: "invalid_state" };
  if (!isCanonicalIso(value.occurredAt) || !isCanonicalIso(value.observedAt)) return { ok: false, code: "invalid_timestamp" };
  const occurred = Date.parse(value.occurredAt);
  const observed = Date.parse(value.observedAt);
  let current;
  try {
    current = now();
  } catch {
    return { ok: false, code: "invalid_clock" };
  }
  if (!Number.isFinite(current) || occurred > observed || observed > current) return { ok: false, code: "invalid_chronology" };
  const expectedSummary = PUBLIC_SUMMARIES.get(`${value.eventKind}:${value.status}`);
  if (!isSafeSummary(value.summary) || value.summary !== expectedSummary) return { ok: false, code: "unsafe_summary" };
  return { ok: true, event: Object.fromEntries(EVENT_KEYS.map((key) => [key, value[key]])) };
}

export class WorkRecordStore {
  constructor(databasePath) {
    if (databasePath !== ":memory:") {
      closeSync(openSync(databasePath, "a", 0o600));
      chmodSync(databasePath, 0o600);
    }
    this.database = new DatabaseSync(databasePath);
    this.database.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");
    const version = this.database.prepare("PRAGMA user_version").get().user_version;
    if (version === 0) {
      this.database.exec(`
        BEGIN;
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
        COMMIT;
      `);
    } else if (version !== 1) {
      this.database.close();
      throw new Error("Unsupported work-record database schema");
    }
    this.insertStatement = this.database.prepare(`
      INSERT OR IGNORE INTO work_events (
        event_id, version, source_type, work_ref, profile_id, event_kind, status, occurred_at, observed_at, summary
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    this.listStatement = this.database.prepare(`
      SELECT event_id, version, source_type, work_ref, profile_id, event_kind, status, occurred_at, observed_at, summary
      FROM work_events ORDER BY observed_at DESC, occurred_at DESC, event_id DESC LIMIT ?
    `);
    this.countStatement = this.database.prepare("SELECT COUNT(*) AS count FROM work_events");
    this.boundsStatement = this.database.prepare("SELECT MAX(occurred_at) AS newest_occurred_at, MAX(observed_at) AS newest_observed_at FROM work_events");
  }

  insert(event) {
    const result = this.insertStatement.run(
      event.eventId,
      event.version,
      event.sourceType,
      event.workRef,
      event.profileId,
      event.eventKind,
      event.status,
      event.occurredAt,
      event.observedAt,
      event.summary
    );
    return result.changes === 1;
  }

  list(limit) {
    return this.listStatement.all(limit).map((row) => ({
      version: row.version,
      eventId: row.event_id,
      sourceType: row.source_type,
      workRef: row.work_ref,
      profileId: row.profile_id,
      eventKind: row.event_kind,
      status: row.status,
      occurredAt: row.occurred_at,
      observedAt: row.observed_at,
      summary: row.summary
    }));
  }

  count() {
    return Number(this.countStatement.get().count);
  }

  bounds() {
    const row = this.boundsStatement.get();
    return {
      newestOccurredAt: row.newest_occurred_at ?? null,
      newestObservedAt: row.newest_observed_at ?? null
    };
  }

  close() {
    this.database.close();
  }
}

export function isWorkRecordsAuthorizationValid(authorization, expectedToken) {
  if (typeof expectedToken !== "string" || expectedToken.length < 16) return false;
  if (typeof authorization !== "string" || !authorization.startsWith("Bearer ")) return false;
  const supplied = authorization.slice("Bearer ".length);
  if (supplied.length !== expectedToken.length) return false;
  const suppliedBytes = Buffer.from(supplied, "utf8");
  const expectedBytes = Buffer.from(expectedToken, "utf8");
  return suppliedBytes.length === expectedBytes.length && timingSafeEqual(suppliedBytes, expectedBytes);
}

export function ingestWorkEvent({ authorization, expectedToken, body, store, now = Date.now }) {
  if (!isWorkRecordsAuthorizationValid(authorization, expectedToken)) return { status: 401, body: { accepted: false, error: "unauthorized" } };
  const validation = validateWorkEvent(body, { now });
  if (!validation.ok) return { status: 400, body: { accepted: false, error: validation.code } };
  if (!store.insert(validation.event)) return { status: 409, body: { accepted: false, error: "duplicate_event" } };
  return { status: 201, body: { accepted: true, eventId: validation.event.eventId } };
}

export function readWorkEvents({ store, now = Date.now, limit = 20 }) {
  const boundedLimit = Number.isSafeInteger(limit) ? Math.min(Math.max(limit, 1), 50) : 20;
  const generatedAt = new Date(now()).toISOString();
  const events = store.list(boundedLimit);
  const validatedEvents = [];
  for (const event of events) {
    const validation = validateWorkEvent(event, { now: () => Date.parse(generatedAt) });
    if (!validation.ok) return { status: 500, body: { error: "invalid_persisted_record" } };
    validatedEvents.push(validation.event);
  }
  const sourceBounds = store.bounds();
  const eventCount = store.count();
  const emptyBounds = sourceBounds.newestOccurredAt === null && sourceBounds.newestObservedAt === null;
  const populatedBounds = isCanonicalIso(sourceBounds.newestOccurredAt) && isCanonicalIso(sourceBounds.newestObservedAt) &&
    Date.parse(sourceBounds.newestOccurredAt) <= Date.parse(sourceBounds.newestObservedAt) &&
    Date.parse(sourceBounds.newestObservedAt) <= Date.parse(generatedAt);
  if (!Number.isSafeInteger(eventCount) || eventCount < 0 ||
    (eventCount === 0 && (!emptyBounds || validatedEvents.length !== 0)) ||
    (eventCount > 0 && (!populatedBounds || validatedEvents.length === 0))) {
    return { status: 500, body: { error: "invalid_persisted_record" } };
  }
  return {
    status: 200,
    body: {
      schemaVersion: SCHEMA_VERSION,
      generatedAt,
      freshness: sourceBounds.newestObservedAt ? (Date.parse(generatedAt) - Date.parse(sourceBounds.newestObservedAt) <= STALE_AFTER_MS ? "recent" : "stale") : "empty",
      source: {
        type: "authenticated_local_work_events",
        eventCount,
        newestOccurredAt: sourceBounds.newestOccurredAt,
        newestObservedAt: sourceBounds.newestObservedAt
      },
      events: validatedEvents
    }
  };
}
