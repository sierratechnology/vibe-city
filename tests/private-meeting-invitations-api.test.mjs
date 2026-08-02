import assert from "node:assert/strict";
import test from "node:test";

import { createPrivateMeetingInvitationsRepository } from "../server/privateMeetingInvitations.mjs";

const TENANT = "syn-tenant-a";
const INVITATION = "syn-tenant-a--invitation-a";
const ISSUER = "syn-tenant-a--subject-issuer";
const RECIPIENT = "syn-tenant-a--subject-recipient";
const REVOKER = "syn-tenant-a--subject-revoker";
const BEARER = "Bearer synthetic-active";

async function loadApi() {
  return import("../server/privateMeetingInvitationsApi.mjs").catch(() => ({}));
}

function issueBody() {
  return {
    invitationId: INVITATION,
    intendedRecipientSubjectId: RECIPIENT,
    purposeReference: "syn-tenant-a--purpose-a",
    materialReferences: ["syn-tenant-a--material-a"],
    validFrom: "2000-01-01T00:01:00.000Z",
    expiresAt: "2000-01-01T01:01:00.000Z",
    revocationAuthoritySubjectId: REVOKER,
    sourceReference: "syn-tenant-a--source-a",
    expectedRevision: 0
  };
}

async function directRequest(handler, method, path, body, rawHeaders) {
  const payload = body === undefined ? undefined : JSON.stringify(body);
  let status;
  let headers;
  let serialized = "";
  const request = {
    method,
    url: path,
    headers: { authorization: BEARER },
    rawHeaders: rawHeaders ?? ["Authorization", BEARER, ...(payload === undefined ? [] : [
      "Content-Type", "application/json", "Content-Length", String(Buffer.byteLength(payload))
    ])],
    aborted: false,
    async *[Symbol.asyncIterator]() {
      if (payload !== undefined) yield Buffer.from(payload);
    }
  };
  const response = {
    headersSent: false,
    writeHead(nextStatus, nextHeaders) {
      status = nextStatus;
      headers = Object.fromEntries(Object.entries(nextHeaders).map(([key, value]) => [key.toLowerCase(), value]));
      this.headersSent = true;
    },
    end(chunk) { serialized += chunk ?? ""; },
    destroy() {}
  };
  await handler(request, response);
  return { status, headers, body: JSON.parse(serialized) };
}

test("tenant-private API closes issue read accept revoke and alternate-route isolation under current injected authority", async () => {
  const api = await loadApi();
  assert.equal(typeof api.createPrivateMeetingInvitationsApiHandler, "function");
  let now = "2000-01-01T00:00:00.000Z";
  const repository = createPrivateMeetingInvitationsRepository(":memory:", { now: () => now });
  const state = {
    subjectId: ISSUER,
    action: "issue_private_meeting_invitation",
    policyRevision: 1,
    active: true
  };
  let resolverCalls = 0;
  try {
    const handler = api.createPrivateMeetingInvitationsApiHandler({
      repository,
      now: () => now,
      resolveTrustedSession(request) {
        resolverCalls += 1;
        return request.headers.authorization === BEARER
          ? { authenticated: true, sessionId: "syn-tenant-a--auth-session-a", subjectId: state.subjectId }
          : null;
      },
      resolveTrustedMembership() {
        return {
          active: state.active,
          tenantId: TENANT,
          subjectId: state.subjectId,
          actionGrants: [state.action],
          authorizationReference: `syn-tenant-a--authorization-${state.policyRevision}`,
          policyRevision: state.policyRevision
        };
      },
      evaluatePolicy(facts) {
        return state.active && facts.action === state.action && facts.tenantId === TENANT &&
          facts.subjectId === state.subjectId && facts.policyRevision === state.policyRevision;
      }
    });
    const collection = `/api/private/tenants/${TENANT}/meeting-invitations`;
    const item = `${collection}/${INVITATION}`;
    const issued = await directRequest(handler, "POST", collection, issueBody());
    assert.equal(issued.status, 201);
    assert.equal(issued.headers["cache-control"], "private, no-store");
    assert.equal(issued.body.invitation.lifecycle, "issued");
    assert.equal(issued.body.invitation.grantsAccess, false);

    state.subjectId = RECIPIENT;
    state.action = "read_private_meeting_invitation";
    const read = await directRequest(handler, "GET", item);
    assert.equal(read.status, 200);
    assert.equal(read.body.invitation.invitationId, INVITATION);

    state.action = "accept_private_meeting_invitation";
    now = "2000-01-01T00:02:00.000Z";
    const accepted = await directRequest(handler, "POST", `${item}/accept`, { expectedRevision: 1 });
    assert.equal(accepted.status, 200);
    assert.equal(accepted.body.invitation.lifecycle, "accepted");

    state.subjectId = REVOKER;
    state.action = "revoke_private_meeting_invitation";
    now = "2000-01-01T00:03:00.000Z";
    const revoked = await directRequest(handler, "POST", `${item}/revoke`, { expectedRevision: 2 });
    assert.equal(revoked.status, 200);
    assert.equal(revoked.body.invitation.lifecycle, "revoked");

    const beforeAlternate = resolverCalls;
    const alternate = await directRequest(
      handler, "GET", `/api/private/meeting-invitations/${INVITATION}`
    );
    assert.equal(alternate.status, 404);
    assert.deepEqual(alternate.body, { error: "not_found" });
    assert.equal(resolverCalls, beforeAlternate, "malformed namespace denies before private resolution");
    const foreign = await directRequest(
      handler, "GET", `/api/private/tenants/syn-tenant-b/meeting-invitations/syn-tenant-b--invitation-a`
    );
    assert.equal(foreign.status, 404);
    assert.deepEqual(foreign.body, { error: "not_found" });
    assert.equal(JSON.stringify([alternate, foreign]).includes(INVITATION), false);
  } finally {
    repository.close();
  }
});

test("valid issue accepts content length before content type in raw header order", async () => {
  const api = await loadApi();
  const now = "2000-01-01T00:00:00.000Z";
  const repository = createPrivateMeetingInvitationsRepository(":memory:", { now: () => now });
  try {
    const handler = api.createPrivateMeetingInvitationsApiHandler({
      repository,
      now: () => now,
      resolveTrustedSession: () => ({
        authenticated: true,
        sessionId: "syn-tenant-a--auth-session-a",
        subjectId: ISSUER
      }),
      resolveTrustedMembership: () => ({
        active: true,
        tenantId: TENANT,
        subjectId: ISSUER,
        actionGrants: ["issue_private_meeting_invitation"],
        authorizationReference: "syn-tenant-a--authorization-1",
        policyRevision: 1
      }),
      evaluatePolicy: () => true
    });
    const body = issueBody();
    const payload = JSON.stringify(body);
    const issued = await directRequest(
      handler,
      "POST",
      `/api/private/tenants/${TENANT}/meeting-invitations`,
      body,
      [
        "Authorization", BEARER,
        "Content-Length", String(Buffer.byteLength(payload)),
        "Content-Type", "application/json"
      ]
    );
    assert.equal(issued.status, 201);
    assert.equal(issued.body.invitation.lifecycle, "issued");
  } finally {
    repository.close();
  }
});

test("mid-request authority revocation after policy evaluation denies with zero invitation mutation", async () => {
  const api = await loadApi();
  const now = "2000-01-01T00:00:00.000Z";
  const repository = createPrivateMeetingInvitationsRepository(":memory:", { now: () => now });
  const state = { active: true };
  let policyCalls = 0;
  let revokeDuringPolicy = true;
  try {
    const handler = api.createPrivateMeetingInvitationsApiHandler({
      repository,
      now: () => now,
      resolveTrustedSession: () => ({
        authenticated: true,
        sessionId: "syn-tenant-a--auth-session-a",
        subjectId: ISSUER
      }),
      resolveTrustedMembership: () => ({
        active: state.active,
        tenantId: TENANT,
        subjectId: ISSUER,
        actionGrants: ["issue_private_meeting_invitation"],
        authorizationReference: "syn-tenant-a--authorization-1",
        policyRevision: 1
      }),
      evaluatePolicy() {
        policyCalls += 1;
        if (revokeDuringPolicy && policyCalls === 2) state.active = false;
        return true;
      }
    });
    const collection = `/api/private/tenants/${TENANT}/meeting-invitations`;
    const denied = await directRequest(handler, "POST", collection, issueBody());
    assert.equal(denied.status, 404);
    assert.deepEqual(denied.body, { error: "not_found" });

    state.active = true;
    revokeDuringPolicy = false;
    const created = await directRequest(handler, "POST", collection, issueBody());
    assert.equal(created.status, 201, "denied attempt must leave no invitation mutation");
  } finally {
    repository.close();
  }
});
