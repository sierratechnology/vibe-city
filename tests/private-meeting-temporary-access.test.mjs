import assert from "node:assert/strict";
import test from "node:test";

import { createPrivateMeetingInvitationsRepository } from "../server/privateMeetingInvitations.mjs";

const TENANT = "syn-tenant-a";
const INVITATION = "syn-tenant-a--invitation-a";
const ISSUER = "syn-tenant-a--subject-issuer";
const RECIPIENT = "syn-tenant-a--subject-recipient";
const REVOKER = "syn-tenant-a--subject-revoker";
const NOW = "2000-01-01T00:03:00.000Z";

function context(action, subjectId, policyRevision = 1) {
  return {
    kind: "trusted-server-context",
    authenticatedSubjectId: subjectId,
    authenticatedSessionId: "syn-tenant-a--auth-session-a",
    activeTenantMembership: { tenantId: TENANT, subjectId, active: true },
    actionGrants: [action],
    authorizationReference: `syn-tenant-a--authorization-${policyRevision}`,
    policyRevision
  };
}

function acceptedRepository() {
  const repository = createPrivateMeetingInvitationsRepository(":memory:");
  assert.equal(repository.issueInvitation(
    context("issue_private_meeting_invitation", ISSUER),
    {
      tenantId: TENANT,
      invitationId: INVITATION,
      intendedRecipientSubjectId: RECIPIENT,
      purposeReference: "syn-tenant-a--purpose-a",
      materialReferences: ["syn-tenant-a--material-a"],
      validFrom: "2000-01-01T00:01:00.000Z",
      expiresAt: "2000-01-01T01:01:00.000Z",
      revocationAuthoritySubjectId: REVOKER,
      issuedAt: "2000-01-01T00:00:00.000Z",
      sourceReference: "syn-tenant-a--source-a",
      expectedRevision: 0
    }
  ).ok, true);
  assert.equal(repository.acceptInvitation(
    context("accept_private_meeting_invitation", RECIPIENT),
    {
      tenantId: TENANT,
      invitationId: INVITATION,
      acceptedAt: "2000-01-01T00:02:00.000Z",
      expectedRevision: 1
    }
  ).ok, true);
  return repository;
}

async function loadEvaluator() {
  return import("../server/privateMeetingTemporaryAccess.mjs").catch(() => ({}));
}

test("accepted invitation yields only current policy-scoped temporary access and stale decisions deny", async () => {
  const module = await loadEvaluator();
  assert.equal(typeof module.createPrivateMeetingTemporaryAccessEvaluator, "function");
  const repository = acceptedRepository();
  let currentPolicyRevision = 1;
  let policyAllowed = true;
  try {
    const evaluator = module.createPrivateMeetingTemporaryAccessEvaluator({
      repository,
      now: () => NOW,
      evaluatePolicy(facts) {
        return policyAllowed && facts.action === "enter_private_meeting_temporarily" &&
          facts.tenantId === TENANT && facts.invitationId === INVITATION &&
          facts.subjectId === RECIPIENT && facts.policyRevision === currentPolicyRevision;
      }
    });
    const authority = context("enter_private_meeting_temporarily", RECIPIENT);
    const granted = evaluator.evaluateTemporaryAccess(authority, {
      tenantId: TENANT,
      invitationId: INVITATION
    });
    assert.equal(granted.ok, true);
    assert.deepEqual(Object.keys(granted.decision), [
      "allowed", "accessKind", "privacy", "tenantId", "invitationId", "subjectId",
      "purposeReference", "materialReferences", "invitationRevision", "policyRevision",
      "authorizationReference", "evaluatedAt", "validUntil", "grantsPermanentMembership",
      "grantsOccupancy"
    ]);
    assert.equal(granted.decision.allowed, true);
    assert.equal(granted.decision.accessKind, "temporary-private-meeting");
    assert.equal(granted.decision.invitationRevision, 2);
    assert.equal(granted.decision.policyRevision, 1);
    assert.equal(granted.decision.grantsPermanentMembership, false);
    assert.equal(granted.decision.grantsOccupancy, false);
    assert.equal(evaluator.validateTemporaryAccessDecision(authority, granted.decision).ok, true);
    currentPolicyRevision = 2;
    assert.deepEqual(
      evaluator.validateTemporaryAccessDecision(
        context("enter_private_meeting_temporarily", RECIPIENT, 2), granted.decision
      ),
      { ok: false, code: "not_found" }
    );
    policyAllowed = false;
    assert.deepEqual(
      evaluator.evaluateTemporaryAccess(
        context("enter_private_meeting_temporarily", RECIPIENT, 2),
        { tenantId: TENANT, invitationId: INVITATION }
      ),
      { ok: false, code: "not_found" }
    );
  } finally {
    repository.close();
  }
});

test("revocation during policy evaluation denies temporary access without a stale decision", async () => {
  const module = await loadEvaluator();
  const repository = acceptedRepository();
  try {
    const evaluator = module.createPrivateMeetingTemporaryAccessEvaluator({
      repository,
      now: () => NOW,
      evaluatePolicy() {
        const revoked = repository.revokeInvitation(
          context("revoke_private_meeting_invitation", REVOKER),
          {
            tenantId: TENANT,
            invitationId: INVITATION,
            revokedAt: NOW,
            expectedRevision: 2
          }
        );
        assert.equal(revoked.ok, true);
        return true;
      }
    });

    const result = evaluator.evaluateTemporaryAccess(
      context("enter_private_meeting_temporarily", RECIPIENT),
      { tenantId: TENANT, invitationId: INVITATION }
    );

    assert.deepEqual(result, { ok: false, code: "not_found" });
    assert.equal("decision" in result, false);
  } finally {
    repository.close();
  }
});
