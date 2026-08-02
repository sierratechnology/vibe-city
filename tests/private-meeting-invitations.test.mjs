import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

const TENANT_A = "syn-tenant-a";
const TENANT_B = "syn-tenant-b";
const ISSUER = "syn-tenant-a--subject-issuer";
const RECIPIENT = "syn-tenant-a--subject-recipient";
const REVOKER = "syn-tenant-a--subject-revoker";
const INVITATION = "syn-tenant-a--invitation-a";
const ISSUED_AT = "2000-01-01T00:00:00.000Z";
const VALID_FROM = "2000-01-01T00:01:00.000Z";
const EXPIRES_AT = "2000-01-01T01:01:00.000Z";
const ACCEPTED_AT = "2000-01-01T00:02:00.000Z";

function context(action, overrides = {}) {
  const subjectId = overrides.authenticatedSubjectId ?? ISSUER;
  return {
    kind: "trusted-server-context",
    authenticatedSubjectId: subjectId,
    authenticatedSessionId: "syn-tenant-a--auth-session-a",
    activeTenantMembership: { tenantId: TENANT_A, subjectId, active: true },
    actionGrants: [action],
    authorizationReference: "syn-tenant-a--authorization-a",
    policyRevision: 1,
    ...overrides
  };
}

function issueInput(overrides = {}) {
  return {
    tenantId: TENANT_A,
    invitationId: INVITATION,
    intendedRecipientSubjectId: RECIPIENT,
    purposeReference: "syn-tenant-a--purpose-a",
    materialReferences: ["syn-tenant-a--material-a", "syn-tenant-a--material-b"],
    validFrom: VALID_FROM,
    expiresAt: EXPIRES_AT,
    revocationAuthoritySubjectId: REVOKER,
    issuedAt: ISSUED_AT,
    sourceReference: "syn-tenant-a--source-a",
    expectedRevision: 0,
    ...overrides
  };
}

function recipientContext(action = "accept_private_meeting_invitation", overrides = {}) {
  const subjectId = overrides.authenticatedSubjectId ?? RECIPIENT;
  return context(action, {
    authenticatedSubjectId: subjectId,
    activeTenantMembership: { tenantId: TENANT_A, subjectId, active: true },
    authorizationReference: "syn-tenant-a--authorization-recipient",
    ...overrides
  });
}

function acceptInput(overrides = {}) {
  return {
    tenantId: TENANT_A,
    invitationId: INVITATION,
    acceptedAt: ACCEPTED_AT,
    expectedRevision: 1,
    ...overrides
  };
}

async function loadRepository() {
  return import("../server/privateMeetingInvitations.mjs").catch(() => ({}));
}

async function withRepository(run, options = {}) {
  const directory = await mkdtemp(join(tmpdir(), "vibe-city-invitations-"));
  try {
    const module = await loadRepository();
    const repository = module.createPrivateMeetingInvitationsRepository(
      join(directory, "invitations.sqlite"), options
    );
    try { await run(repository, module); } finally { repository.close(); }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test("authorized issue persists the exact immutable invitation schema without granting access", async () => {
  const module = await loadRepository();
  assert.equal(typeof module.createPrivateMeetingInvitationsRepository, "function");
  await withRepository(async (repository) => {
    const issued = repository.issueInvitation(
      context("issue_private_meeting_invitation"), issueInput()
    );
    assert.equal(issued.ok, true);
    assert.deepEqual(Object.keys(issued.invitation), [
      "privacy", "tenantId", "invitationId", "revision", "lifecycle", "issuerSubjectId",
      "intendedRecipientSubjectId", "purposeReference", "materialReferences", "validFrom",
      "expiresAt", "revocationAuthoritySubjectId", "issuedAt", "sourceReference",
      "issueAuthorizationReference", "issuePolicyRevision", "acceptedAt", "acceptedBySubjectId",
      "acceptAuthorizationReference", "acceptPolicyRevision", "revokedAt", "revokedBySubjectId",
      "revokeAuthorizationReference", "revokePolicyRevision", "grantsAccess", "grantsOccupancy",
      "grantsPermanentMembership"
    ]);
    assert.equal(issued.invitation.lifecycle, "issued");
    assert.equal(issued.invitation.issuerSubjectId, ISSUER);
    assert.equal(issued.invitation.intendedRecipientSubjectId, RECIPIENT);
    assert.deepEqual(issued.invitation.materialReferences, issueInput().materialReferences);
    assert.equal(issued.invitation.grantsAccess, false);
    assert.equal(issued.invitation.grantsOccupancy, false);
    assert.equal(issued.invitation.grantsPermanentMembership, false);
    assert.equal(Object.isFrozen(issued.invitation), true);
    assert.equal(Object.isFrozen(issued.invitation.materialReferences), true);

    const history = repository.readAuditHistory(
      context("read_private_meeting_invitation_audit"),
      { tenantId: TENANT_A, invitationId: INVITATION }
    );
    assert.equal(history.ok, true);
    assert.equal(history.events.length, 1);
    assert.equal(history.events[0].eventKind, "private_meeting_invitation_issued");
    assert.equal(history.events[0].actorSubjectId, ISSUER);
    assert.equal(history.events[0].authorizationReference, "syn-tenant-a--authorization-a");
    assert.equal(history.events[0].policyRevision, 1);
    assert.equal(Object.isFrozen(history.events[0]), true);
  });
});

test("only the intended current tenant recipient accepts once and hostile attempts deny without mutation", async () => {
  await withRepository(async (repository) => {
    assert.equal(repository.issueInvitation(
      context("issue_private_meeting_invitation"), issueInput()
    ).ok, true);

    const hostile = [
      repository.acceptInvitation(
        recipientContext("accept_private_meeting_invitation", {
          authenticatedSubjectId: "syn-tenant-a--subject-other",
          activeTenantMembership: {
            tenantId: TENANT_A, subjectId: "syn-tenant-a--subject-other", active: true
          }
        }), acceptInput()
      ),
      repository.acceptInvitation(
        recipientContext("accept_private_meeting_invitation", {
          activeTenantMembership: { tenantId: TENANT_B, subjectId: RECIPIENT, active: true }
        }), acceptInput()
      ),
      repository.acceptInvitation(recipientContext("read_private_meeting_invitation"), acceptInput()),
      repository.acceptInvitation(
        recipientContext("accept_private_meeting_invitation", { policyRevision: 2 }),
        acceptInput({ policyRevision: 999 })
      ),
      repository.acceptInvitation(
        recipientContext(), { ...acceptInput(), invitationId: "malformed" }
      )
    ];
    for (const denied of hostile) assert.deepEqual(denied, { ok: false, code: "not_found" });

    const accepted = repository.acceptInvitation(recipientContext(), acceptInput());
    assert.equal(accepted.ok, true);
    assert.equal(accepted.invitation.revision, 2);
    assert.equal(accepted.invitation.lifecycle, "accepted");
    assert.equal(accepted.invitation.acceptedBySubjectId, RECIPIENT);
    assert.equal(accepted.invitation.acceptAuthorizationReference,
      "syn-tenant-a--authorization-recipient");
    assert.equal(accepted.invitation.acceptPolicyRevision, 1);
    assert.equal(accepted.invitation.grantsAccess, false);
    assert.equal(accepted.invitation.grantsOccupancy, false);
    assert.equal(accepted.invitation.grantsPermanentMembership, false);

    assert.deepEqual(
      repository.acceptInvitation(recipientContext(), acceptInput()),
      accepted,
      "an identical accepted retry is idempotent"
    );
    assert.deepEqual(
      repository.acceptInvitation(recipientContext(), acceptInput({
        acceptedAt: "2000-01-01T00:03:00.000Z"
      })),
      { ok: false, code: "not_found" },
      "a changed replay is denied"
    );
    const read = repository.readInvitation(
      recipientContext("read_private_meeting_invitation"),
      { tenantId: TENANT_A, invitationId: INVITATION }
    );
    assert.deepEqual(read, accepted);
    const history = repository.readAuditHistory(
      recipientContext("read_private_meeting_invitation_audit"),
      { tenantId: TENANT_A, invitationId: INVITATION }
    );
    assert.equal(history.events.length, 2);
    assert.equal(history.events[1].eventKind, "private_meeting_invitation_accepted");
    assert.equal(JSON.stringify(hostile).includes("subject-other"), false);
  });
});

test("authorized revocation and injected-clock expiry deny later reads while preserving idempotent audit provenance", async () => {
  let now = ACCEPTED_AT;
  await withRepository(async (repository) => {
    assert.equal(repository.issueInvitation(
      context("issue_private_meeting_invitation"), issueInput()
    ).ok, true);
    assert.equal(repository.acceptInvitation(recipientContext(), acceptInput()).ok, true);

    const revoker = context("revoke_private_meeting_invitation", {
      authenticatedSubjectId: REVOKER,
      activeTenantMembership: { tenantId: TENANT_A, subjectId: REVOKER, active: true },
      authorizationReference: "syn-tenant-a--authorization-revoker"
    });
    now = "2000-01-01T00:04:00.000Z";
    const revokeInput = {
      tenantId: TENANT_A,
      invitationId: INVITATION,
      revokedAt: now,
      expectedRevision: 2
    };
    const revoked = repository.revokeInvitation(revoker, revokeInput);
    assert.equal(revoked.ok, true);
    assert.equal(revoked.invitation.lifecycle, "revoked");
    assert.equal(revoked.invitation.revision, 3);
    assert.deepEqual(repository.revokeInvitation(revoker, revokeInput), revoked);
    assert.deepEqual(
      repository.readInvitation(
        context("read_private_meeting_invitation"),
        { tenantId: TENANT_A, invitationId: INVITATION }
      ),
      { ok: false, code: "not_found" }
    );
    assert.deepEqual(
      repository.readAuditHistory(revoker, { tenantId: TENANT_A, invitationId: INVITATION }),
      { ok: false, code: "not_found" },
      "wrong action stays generic"
    );
    const audit = repository.readAuditHistory(
      context("read_private_meeting_invitation_audit"),
      { tenantId: TENANT_A, invitationId: INVITATION }
    );
    assert.equal(audit.events.length, 3);
    assert.deepEqual(audit.events.map((event) => event.eventKind), [
      "private_meeting_invitation_issued",
      "private_meeting_invitation_accepted",
      "private_meeting_invitation_revoked"
    ]);

    const expiringId = "syn-tenant-a--invitation-expiring";
    assert.equal(repository.issueInvitation(
      context("issue_private_meeting_invitation"),
      issueInput({ invitationId: expiringId, sourceReference: "syn-tenant-a--source-expiring" })
    ).ok, true);
    now = ACCEPTED_AT;
    assert.equal(repository.acceptInvitation(
      recipientContext(), acceptInput({ invitationId: expiringId })
    ).ok, true);
    now = EXPIRES_AT;
    assert.deepEqual(
      repository.readInvitation(
        recipientContext("read_private_meeting_invitation"),
        { tenantId: TENANT_A, invitationId: expiringId }
      ),
      { ok: false, code: "not_found" }
    );
  }, { now: () => now });
});

test("accepted invitation denies revocation before acceptance without mutating readable history", async () => {
  await withRepository(async (repository) => {
    assert.equal(repository.issueInvitation(
      context("issue_private_meeting_invitation"),
      issueInput({ validFrom: ISSUED_AT })
    ).ok, true);
    assert.equal(repository.acceptInvitation(
      recipientContext(),
      acceptInput({ acceptedAt: "2000-01-01T00:30:00.000Z" })
    ).ok, true);

    const auditContext = context("read_private_meeting_invitation_audit");
    const scope = { tenantId: TENANT_A, invitationId: INVITATION };
    const acceptedHistory = repository.readAuditHistory(auditContext, scope);
    assert.equal(acceptedHistory.ok, true);
    assert.equal(acceptedHistory.events.length, 2);

    const denied = repository.revokeInvitation(
      context("revoke_private_meeting_invitation", {
        authenticatedSubjectId: REVOKER,
        activeTenantMembership: { tenantId: TENANT_A, subjectId: REVOKER, active: true },
        authorizationReference: "syn-tenant-a--authorization-revoker"
      }),
      {
        tenantId: TENANT_A,
        invitationId: INVITATION,
        revokedAt: "2000-01-01T00:10:00.000Z",
        expectedRevision: 2
      }
    );

    assert.deepEqual(denied, { ok: false, code: "not_found" });
    assert.deepEqual(repository.readAuditHistory(auditContext, scope), acceptedHistory);
    const accepted = repository.readInvitation(
      recipientContext("read_private_meeting_invitation"), scope
    );
    assert.equal(accepted.ok, true);
    assert.equal(accepted.invitation.lifecycle, "accepted");
    assert.equal(accepted.invitation.revision, 2);
  });
});

test("hostile persisted lifecycle schema fails closed without leaking corrupted invitation values", async () => {
  const directory = await mkdtemp(join(tmpdir(), "vibe-city-invitation-corruption-"));
  const databasePath = join(directory, "invitations.sqlite");
  const module = await loadRepository();
  try {
    const repository = module.createPrivateMeetingInvitationsRepository(databasePath);
    assert.equal(repository.issueInvitation(
      context("issue_private_meeting_invitation"), issueInput()
    ).ok, true);
    repository.close();

    const database = new DatabaseSync(databasePath);
    const row = database.prepare(`
      SELECT invitation_json FROM private_meeting_invitations
      WHERE tenant_id = ? AND invitation_id = ?
    `).get(TENANT_A, INVITATION);
    const corrupted = JSON.parse(row.invitation_json);
    corrupted.lifecycle = "accepted";
    corrupted.acceptedAt = "synthetic-private-corruption-detail";
    database.prepare(`
      UPDATE private_meeting_invitations SET invitation_json = ?
      WHERE tenant_id = ? AND invitation_id = ?
    `).run(JSON.stringify(corrupted), TENANT_A, INVITATION);
    database.close();

    const reopened = module.createPrivateMeetingInvitationsRepository(databasePath);
    const denied = reopened.readInvitation(
      context("read_private_meeting_invitation"),
      { tenantId: TENANT_A, invitationId: INVITATION }
    );
    assert.deepEqual(denied, { ok: false, code: "not_found" });
    assert.equal(JSON.stringify(denied).includes("corruption-detail"), false);
    reopened.close();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("hostile persisted audit actor fails closed without disclosing the rejected value", async () => {
  const directory = await mkdtemp(join(tmpdir(), "vibe-city-audit-corruption-"));
  const databasePath = join(directory, "invitations.sqlite");
  const module = await loadRepository();
  try {
    const repository = module.createPrivateMeetingInvitationsRepository(databasePath);
    assert.equal(repository.issueInvitation(
      context("issue_private_meeting_invitation"), issueInput()
    ).ok, true);
    repository.close();

    const database = new DatabaseSync(databasePath);
    const row = database.prepare(`
      SELECT event_json FROM private_meeting_invitation_audit_events
      WHERE tenant_id = ? AND invitation_id = ?
    `).get(TENANT_A, INVITATION);
    const corrupted = JSON.parse(row.event_json);
    corrupted.actorSubjectId = "hostile-private-audit-marker";
    database.prepare(`
      UPDATE private_meeting_invitation_audit_events SET event_json = ?
      WHERE tenant_id = ? AND invitation_id = ?
    `).run(JSON.stringify(corrupted), TENANT_A, INVITATION);
    database.close();

    const reopened = module.createPrivateMeetingInvitationsRepository(databasePath);
    const denied = reopened.readAuditHistory(
      context("read_private_meeting_invitation_audit"),
      { tenantId: TENANT_A, invitationId: INVITATION }
    );
    assert.deepEqual(denied, { ok: false, code: "not_found" });
    assert.equal(JSON.stringify(denied).includes("hostile-private-audit-marker"), false);
    reopened.close();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("captured collection intrinsics preserve frozen issue output after ambient map replacement", async () => {
  const originalMap = Array.prototype.map;
  try {
    Array.prototype.map = () => { throw new Error("synthetic ambient map trap"); };
    await withRepository(async (repository) => {
      const issued = repository.issueInvitation(
        context("issue_private_meeting_invitation"), issueInput()
      );
      assert.equal(issued.ok, true);
      assert.deepEqual(issued.invitation.materialReferences, issueInput().materialReferences);
      assert.equal(Object.isFrozen(issued.invitation.materialReferences), true);
    });
  } finally {
    Array.prototype.map = originalMap;
  }
});
