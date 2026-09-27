import { chmodSync, closeSync, existsSync, openSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

export class PrivateWorkRecordsStore {
  constructor(databasePath) {
    if (databasePath !== ':memory:') {
      closeSync(openSync(databasePath, 'a', 0o600));
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
          authorization_id TEXT NOT NULL,
          policy_revision TEXT NOT NULL,
          request_id TEXT NOT NULL,
          request_semantics TEXT NOT NULL,
          record_json TEXT NOT NULL,
          PRIMARY KEY (tenant_id, principal_id, authorization_id, policy_revision, request_id)
        ) STRICT;
        CREATE TABLE IF NOT EXISTS private_mutation_requests (
          tenant_id TEXT NOT NULL,
          principal_id TEXT NOT NULL,
          authorization_id TEXT NOT NULL,
          policy_revision TEXT NOT NULL,
          operation TEXT NOT NULL,
          request_id TEXT NOT NULL,
          request_semantics TEXT NOT NULL,
          record_json TEXT NOT NULL,
          PRIMARY KEY (
            tenant_id, principal_id, authorization_id, policy_revision, operation, request_id
          )
        ) STRICT;
      `);
      if (databasePath !== ':memory:') {
        for (const path of [databasePath, `${databasePath}-wal`, `${databasePath}-shm`]) {
          if (existsSync(path)) chmodSync(path, 0o600);
        }
      }
      this.readStatement = this.database.prepare(`
        SELECT record_json FROM private_work_records
        WHERE tenant_id = ? AND record_id = ?
      `);
      this.listStatement = this.database.prepare(`
        SELECT record_json FROM private_work_records
        WHERE tenant_id = ?
          AND json_extract(record_json, '$.lifecycle') NOT IN ('archived', 'deleted')
        ORDER BY recorded_at DESC, record_id DESC LIMIT ?
      `);
      this.recordCountStatement = this.database.prepare(
        'SELECT COUNT(*) AS count FROM private_work_records WHERE tenant_id = ?',
      );
      this.auditCountStatement = this.database.prepare(
        'SELECT COUNT(*) AS count FROM private_material_audit_events WHERE tenant_id = ?',
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
      this.readHistoryStatement = this.database.prepare(`
        SELECT event_json FROM private_material_audit_events
        WHERE tenant_id = ? AND record_id = ? ORDER BY rowid ASC LIMIT ?
      `);
      this.readLatestBlockStatement = this.database.prepare(`
        SELECT event_json FROM private_material_audit_events
        WHERE tenant_id = ? AND record_id = ?
          AND json_extract(event_json, '$.eventKind') = 'block'
        ORDER BY rowid DESC LIMIT 1
      `);
      this.readLatestArchiveStatement = this.database.prepare(`
        SELECT audit.event_json
        FROM private_material_audit_events AS audit
        JOIN private_work_records AS record
          ON record.tenant_id = audit.tenant_id AND record.record_id = audit.record_id
        WHERE audit.tenant_id = ? AND audit.record_id = ?
          AND audit.prior_revision = record.revision - 1
          AND audit.new_revision = record.revision
          AND json_extract(audit.event_json, '$.eventKind') = 'archive'
        ORDER BY audit.rowid DESC LIMIT 2
      `);
      this.updateRecordStatement = this.database.prepare(`
        UPDATE private_work_records
        SET revision = ?, record_json = ?, recorded_at = ?
        WHERE tenant_id = ? AND record_id = ? AND revision = ?
      `);
      this.readCreateRequestStatement = this.database.prepare(`
        SELECT request_semantics, record_json FROM private_create_requests
        WHERE tenant_id = ? AND principal_id = ? AND authorization_id = ?
          AND policy_revision = ? AND request_id = ?
      `);
      this.insertCreateRequestStatement = this.database.prepare(`
        INSERT INTO private_create_requests
          (tenant_id, principal_id, authorization_id, policy_revision, request_id,
           request_semantics, record_json)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `);
      this.readMutationRequestStatement = this.database.prepare(`
        SELECT request_semantics, record_json FROM private_mutation_requests
        WHERE tenant_id = ? AND principal_id = ? AND authorization_id = ?
          AND policy_revision = ? AND operation = ? AND request_id = ?
      `);
      this.insertMutationRequestStatement = this.database.prepare(`
        INSERT INTO private_mutation_requests
          (tenant_id, principal_id, authorization_id, policy_revision, operation, request_id,
           request_semantics, record_json)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);
    } catch (error) {
      try { this.database.close(); } catch { /* preserve initialization failure */ }
      throw error;
    }
  }

  create(record, auditEvent, expectedRevision, requestIdentity = null) {
    if (expectedRevision !== 0 || record.revision !== 1
      || auditEvent.priorRevision !== 0 || auditEvent.newRevision !== 1) {
      return { ok: false, code: 'stale_revision' };
    }
    try {
      this.database.exec('BEGIN IMMEDIATE');
      const requestParameters = requestIdentity === null ? null : [
        requestIdentity.tenantId,
        requestIdentity.principalId,
        requestIdentity.authorizationId,
        requestIdentity.policyRevision,
        requestIdentity.requestId,
      ];
      if (requestParameters !== null) {
        const existing = this.readCreateRequestStatement.get(...requestParameters);
        if (existing) {
          this.database.exec('COMMIT');
          return existing.request_semantics === requestIdentity.requestSemantics
            ? { ok: true, replayed: true, record: JSON.parse(existing.record_json) }
            : { ok: false, code: 'idempotency_conflict' };
        }
      }
      this.insertRecordStatement.run(
        record.tenantId, record.recordId, record.revision,
        JSON.stringify(record), record.updatedAt,
      );
      this.insertAuditStatement.run(
        auditEvent.tenantId, auditEvent.auditId, auditEvent.recordId,
        auditEvent.priorRevision, auditEvent.newRevision,
        JSON.stringify(auditEvent), auditEvent.recordedAt,
      );
      if (requestParameters !== null) {
        this.insertCreateRequestStatement.run(
          ...requestParameters, requestIdentity.requestSemantics, JSON.stringify(record),
        );
      }
      this.database.exec('COMMIT');
      return { ok: true, replayed: false };
    } catch (error) {
      try { this.database.exec('ROLLBACK'); } catch { /* no active transaction */ }
      if (Number.isInteger(error?.errcode) && (error.errcode & 0xff) === 19) {
        return { ok: false, code: 'duplicate' };
      }
      throw error;
    }
  }

  mutate(record, auditEvent, expectedRevision, requestIdentity = null) {
    try {
      this.database.exec('BEGIN IMMEDIATE');
      const requestParameters = requestIdentity === null ? null : [
        requestIdentity.tenantId, requestIdentity.principalId,
        requestIdentity.authorizationId, requestIdentity.policyRevision,
        requestIdentity.operation, requestIdentity.requestId,
      ];
      if (requestParameters !== null) {
        const existing = this.readMutationRequestStatement.get(...requestParameters);
        if (existing) {
          this.database.exec('COMMIT');
          return existing.request_semantics === requestIdentity.requestSemantics
            ? { ok: true, replayed: true, record: JSON.parse(existing.record_json) }
            : { ok: false, code: 'idempotency_conflict' };
        }
      }
      if (record.revision !== expectedRevision + 1
        || auditEvent.priorRevision !== expectedRevision
        || auditEvent.newRevision !== record.revision) {
        this.database.exec('ROLLBACK');
        return { ok: false, code: 'stale_revision' };
      }
      const updated = this.updateRecordStatement.run(
        record.revision, JSON.stringify(record), record.updatedAt,
        record.tenantId, record.recordId, expectedRevision,
      );
      if (Number(updated.changes) !== 1) {
        this.database.exec('ROLLBACK');
        return { ok: false, code: 'stale_revision' };
      }
      this.insertAuditStatement.run(
        auditEvent.tenantId, auditEvent.auditId, auditEvent.recordId,
        auditEvent.priorRevision, auditEvent.newRevision,
        JSON.stringify(auditEvent), auditEvent.recordedAt,
      );
      if (requestParameters !== null) {
        this.insertMutationRequestStatement.run(
          ...requestParameters, requestIdentity.requestSemantics, JSON.stringify(record),
        );
      }
      this.database.exec('COMMIT');
      return { ok: true, replayed: false };
    } catch (error) {
      try { this.database.exec('ROLLBACK'); } catch { /* no active transaction */ }
      if (Number.isInteger(error?.errcode) && (error.errcode & 0xff) === 19) {
        return { ok: false, code: 'duplicate' };
      }
      throw error;
    }
  }

  read(tenantId, recordId) {
    const row = this.readStatement.get(tenantId, recordId);
    return row ? JSON.parse(row.record_json) : null;
  }

  replayMutation(requestIdentity) {
    const existing = this.readMutationRequestStatement.get(
      requestIdentity.tenantId,
      requestIdentity.principalId,
      requestIdentity.authorizationId,
      requestIdentity.policyRevision,
      requestIdentity.operation,
      requestIdentity.requestId,
    );
    if (!existing) return null;
    return existing.request_semantics === requestIdentity.requestSemantics
      ? { ok: true, replayed: true, record: JSON.parse(existing.record_json) }
      : { ok: false, code: 'idempotency_conflict' };
  }

  list(tenantId, limit) {
    return this.listStatement.all(tenantId, limit).map((row) => JSON.parse(row.record_json));
  }

  readHistory(tenantId, recordId, limit) {
    return this.readHistoryStatement.all(tenantId, recordId, limit)
      .map((row) => JSON.parse(row.event_json));
  }

  readLatestBlock(tenantId, recordId) {
    const row = this.readLatestBlockStatement.get(tenantId, recordId);
    return row ? JSON.parse(row.event_json) : null;
  }

  readLatestArchive(tenantId, recordId) {
    const rows = this.readLatestArchiveStatement.all(tenantId, recordId);
    return rows.length === 1 ? JSON.parse(rows[0].event_json) : null;
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
