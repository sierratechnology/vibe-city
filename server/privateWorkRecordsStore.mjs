import { chmodSync, closeSync, openSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

export class PrivateWorkRecordsStore {
  constructor(databasePath) {
    if (databasePath !== ":memory:") {
      closeSync(openSync(databasePath, "a", 0o600));
      chmodSync(databasePath, 0o600);
    }
    this.database = new DatabaseSync(databasePath);
    try {
      this.database.exec(`
        PRAGMA foreign_keys = ON;
        PRAGMA journal_mode = WAL;
        CREATE TABLE IF NOT EXISTS private_work_records (
          tenant_id TEXT NOT NULL,
          record_id TEXT NOT NULL,
          revision INTEGER NOT NULL CHECK (revision >= 1),
          record_json TEXT NOT NULL,
          recorded_at TEXT NOT NULL,
          PRIMARY KEY (tenant_id, record_id)
        ) STRICT;
        CREATE TABLE IF NOT EXISTS private_material_audit_events (
          tenant_id TEXT NOT NULL,
          audit_event_id TEXT NOT NULL,
          record_id TEXT NOT NULL,
          prior_revision INTEGER NOT NULL,
          new_revision INTEGER NOT NULL,
          event_json TEXT NOT NULL,
          recorded_at TEXT NOT NULL,
          PRIMARY KEY (tenant_id, audit_event_id),
          FOREIGN KEY (tenant_id, record_id)
            REFERENCES private_work_records (tenant_id, record_id)
        ) STRICT;
        CREATE TABLE IF NOT EXISTS private_create_requests (
          tenant_id TEXT NOT NULL,
          principal_id TEXT NOT NULL,
          authorization_ref TEXT NOT NULL,
          policy_revision INTEGER NOT NULL,
          request_id TEXT NOT NULL,
          request_semantics TEXT NOT NULL,
          record_json TEXT NOT NULL,
          PRIMARY KEY (tenant_id, principal_id, authorization_ref, policy_revision, request_id)
        ) STRICT;
        CREATE TABLE IF NOT EXISTS private_mutation_requests (
          tenant_id TEXT NOT NULL,
          record_id TEXT NOT NULL,
          principal_id TEXT NOT NULL,
          authorization_ref TEXT NOT NULL,
          policy_revision INTEGER NOT NULL,
          request_id TEXT NOT NULL,
          request_semantics TEXT NOT NULL,
          result_json TEXT NOT NULL,
          PRIMARY KEY (tenant_id, record_id, principal_id, authorization_ref, policy_revision, request_id),
          UNIQUE (tenant_id, principal_id, authorization_ref, policy_revision, request_id),
          FOREIGN KEY (tenant_id, record_id)
            REFERENCES private_work_records (tenant_id, record_id)
        ) STRICT;
        CREATE TABLE IF NOT EXISTS private_tombstone_digests (
          tenant_id TEXT NOT NULL,
          record_id TEXT NOT NULL,
          prior_revision INTEGER NOT NULL CHECK (prior_revision >= 1),
          digest TEXT NOT NULL,
          PRIMARY KEY (tenant_id, record_id, prior_revision),
          FOREIGN KEY (tenant_id, record_id)
            REFERENCES private_work_records (tenant_id, record_id)
        ) STRICT;
        CREATE INDEX IF NOT EXISTS private_work_records_tenant_order
          ON private_work_records (tenant_id, recorded_at DESC, record_id DESC);
      `);
      this.readStatement = this.database.prepare(`
        SELECT record_json FROM private_work_records
        WHERE tenant_id = ? AND record_id = ?
      `);
      this.listStatement = this.database.prepare(`
        SELECT record_json FROM private_work_records
        WHERE tenant_id = ?
          AND json_extract(record_json, '$.state') NOT IN ('archived', 'deleted_tombstone')
        ORDER BY recorded_at DESC, record_id DESC LIMIT ?
      `);
      this.recordCountStatement = this.database.prepare(
        "SELECT COUNT(*) AS count FROM private_work_records WHERE tenant_id = ?"
      );
      this.auditCountStatement = this.database.prepare(
        "SELECT COUNT(*) AS count FROM private_material_audit_events WHERE tenant_id = ?"
      );
      this.insertRecordStatement = this.database.prepare(`
        INSERT INTO private_work_records
          (tenant_id, record_id, revision, record_json, recorded_at)
        VALUES (?, ?, ?, ?, ?)
      `);
      this.insertAuditStatement = this.database.prepare(`
        INSERT INTO private_material_audit_events
          (tenant_id, audit_event_id, record_id, prior_revision, new_revision, event_json, recorded_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `);
      this.readCreateRequestStatement = this.database.prepare(`
        SELECT request_semantics, record_json FROM private_create_requests
        WHERE tenant_id = ? AND principal_id = ? AND authorization_ref = ?
          AND policy_revision = ? AND request_id = ?
      `);
      this.insertCreateRequestStatement = this.database.prepare(`
        INSERT INTO private_create_requests
          (tenant_id, principal_id, authorization_ref, policy_revision, request_id, request_semantics, record_json)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `);
      this.readMutationRequestStatement = this.database.prepare(`
        SELECT record_id, request_semantics, result_json FROM private_mutation_requests
        WHERE tenant_id = ? AND principal_id = ? AND authorization_ref = ?
          AND policy_revision = ? AND request_id = ?
      `);
      this.insertMutationRequestStatement = this.database.prepare(`
        INSERT INTO private_mutation_requests
          (tenant_id, record_id, principal_id, authorization_ref, policy_revision, request_id, request_semantics, result_json)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);
      this.updateRecordStatement = this.database.prepare(`
        UPDATE private_work_records SET revision = ?, record_json = ?
        WHERE tenant_id = ? AND record_id = ? AND revision = ?
      `);
      this.historyStatement = this.database.prepare(`
        SELECT event_json FROM private_material_audit_events
        WHERE tenant_id = ? AND record_id = ?
        ORDER BY new_revision ASC, recorded_at ASC, audit_event_id ASC
      `);
      this.readAuditStatement = this.database.prepare(`
        SELECT event_json FROM private_material_audit_events
        WHERE tenant_id = ? AND record_id = ? AND audit_event_id = ?
      `);
      this.insertTombstoneDigestStatement = this.database.prepare(`
        INSERT INTO private_tombstone_digests (tenant_id, record_id, prior_revision, digest)
        VALUES (?, ?, ?, ?)
      `);
      this.readTombstoneDigestStatement = this.database.prepare(`
        SELECT prior_revision, digest FROM private_tombstone_digests
        WHERE tenant_id = ? AND record_id = ?
        ORDER BY prior_revision DESC LIMIT 1
      `);
    } catch (error) {
      try { this.database.close(); } catch { /* preserve initialization failure */ }
      throw error;
    }
  }

  create(record, auditEvent, expectedRevision, requestIdentity) {
    if (expectedRevision !== 0 || record.revision !== 1 ||
        auditEvent.priorRevision !== 0 || auditEvent.newRevision !== 1) {
      return { ok: false, code: "stale_revision" };
    }
    try {
      this.database.exec("BEGIN IMMEDIATE");
      const requestParameters = [
        requestIdentity.tenantId,
        requestIdentity.principalId,
        requestIdentity.authorizationRef,
        requestIdentity.policyRevision,
        requestIdentity.requestId
      ];
      const existingRequest = this.readCreateRequestStatement.get(...requestParameters);
      if (existingRequest) {
        this.database.exec("COMMIT");
        return existingRequest.request_semantics === requestIdentity.requestSemantics
          ? { ok: true, replayed: true, record: JSON.parse(existingRequest.record_json) }
          : { ok: false, code: "idempotency_conflict" };
      }
      this.insertRecordStatement.run(
        record.tenantId,
        record.recordId,
        record.revision,
        JSON.stringify(record),
        record.recordedAt
      );
      this.insertAuditStatement.run(
        auditEvent.tenantId,
        auditEvent.auditEventId,
        auditEvent.recordId,
        auditEvent.priorRevision,
        auditEvent.newRevision,
        JSON.stringify(auditEvent),
        auditEvent.recordedAt
      );
      this.insertCreateRequestStatement.run(
        ...requestParameters,
        requestIdentity.requestSemantics,
        JSON.stringify(record)
      );
      this.database.exec("COMMIT");
      return { ok: true, replayed: false };
    } catch (error) {
      try { this.database.exec("ROLLBACK"); } catch { /* no active transaction */ }
      if (Number.isInteger(error?.errcode) && (error.errcode & 0xff) === 19) {
        return { ok: false, code: "duplicate" };
      }
      throw error;
    }
  }

  read(tenantId, recordId) {
    const row = this.readStatement.get(tenantId, recordId);
    return row ? JSON.parse(row.record_json) : null;
  }

  replayMutation(requestIdentity) {
    const row = this.readMutationRequestStatement.get(
      requestIdentity.tenantId,
      requestIdentity.principalId,
      requestIdentity.authorizationRef,
      requestIdentity.policyRevision,
      requestIdentity.requestId
    );
    if (!row) return null;
    return row.record_id === requestIdentity.recordId &&
      row.request_semantics === requestIdentity.requestSemantics
      ? { ok: true, replayed: true, record: JSON.parse(row.result_json) }
      : { ok: false, code: "idempotency_conflict" };
  }

  mutate(record, auditEvent, expectedRevision, requestIdentity) {
    try {
      this.database.exec("BEGIN IMMEDIATE");
      const requestParameters = [
        requestIdentity.tenantId,
        requestIdentity.principalId,
        requestIdentity.authorizationRef,
        requestIdentity.policyRevision,
        requestIdentity.requestId
      ];
      const existingRequest = this.readMutationRequestStatement.get(...requestParameters);
      if (existingRequest) {
        this.database.exec("COMMIT");
        return existingRequest.record_id === requestIdentity.recordId &&
          existingRequest.request_semantics === requestIdentity.requestSemantics
          ? { ok: true, replayed: true, record: JSON.parse(existingRequest.result_json) }
          : { ok: false, code: "idempotency_conflict" };
      }
      const update = this.updateRecordStatement.run(
        record.revision,
        JSON.stringify(record),
        record.tenantId,
        record.recordId,
        expectedRevision
      );
      if (Number(update.changes) !== 1) {
        this.database.exec("ROLLBACK");
        return { ok: false, code: "stale_revision" };
      }
      this.insertAuditStatement.run(
        auditEvent.tenantId,
        auditEvent.auditEventId,
        auditEvent.recordId,
        auditEvent.priorRevision,
        auditEvent.newRevision,
        JSON.stringify(auditEvent),
        auditEvent.recordedAt
      );
      if (auditEvent.eventKind === "delete_tombstone") {
        const digestChange = auditEvent.changedFields.find(
          ({ field }) => field === "priorRevisionDigest"
        );
        this.insertTombstoneDigestStatement.run(
          auditEvent.tenantId,
          auditEvent.recordId,
          auditEvent.priorRevision,
          digestChange.before
        );
      }
      this.insertMutationRequestStatement.run(
        requestIdentity.tenantId,
        requestIdentity.recordId,
        requestIdentity.principalId,
        requestIdentity.authorizationRef,
        requestIdentity.policyRevision,
        requestIdentity.requestId,
        requestIdentity.requestSemantics,
        JSON.stringify(record)
      );
      this.database.exec("COMMIT");
      return { ok: true, replayed: false, record };
    } catch (error) {
      try { this.database.exec("ROLLBACK"); } catch { /* no active transaction */ }
      if (Number.isInteger(error?.errcode) && (error.errcode & 0xff) === 19) {
        return { ok: false, code: "duplicate" };
      }
      throw error;
    }
  }

  history(tenantId, recordId) {
    return this.historyStatement.all(tenantId, recordId).map((row) => JSON.parse(row.event_json));
  }

  readAudit(tenantId, recordId, auditEventId) {
    const row = this.readAuditStatement.get(tenantId, recordId, auditEventId);
    return row ? JSON.parse(row.event_json) : null;
  }

  readTombstoneDigest(tenantId, recordId) {
    const row = this.readTombstoneDigestStatement.get(tenantId, recordId);
    return row ? { priorRevision: Number(row.prior_revision), digest: row.digest } : null;
  }

  list(tenantId, limit) {
    return this.listStatement.all(tenantId, limit).map((row) => JSON.parse(row.record_json));
  }

  countRecords(tenantId) {
    return Number(this.recordCountStatement.get(tenantId).count);
  }

  countAudits(tenantId) {
    return Number(this.auditCountStatement.get(tenantId).count);
  }

  close() {
    this.database.close();
  }
}
