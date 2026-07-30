import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";

import { createPrivateHostedAgentPresenceApiHandler } from "../server/privateHostedAgentPresenceApi.mjs";

const TENANT_A = "id_1111111111111111";
const TENANT_B = "id_2222222222222222";
const SUBJECT_A = "id_3333333333333333";
const GENERATED_AT = "2026-07-29T12:05:00.000Z";

function reviewedMapping(overrides = {}) {
  return {
    schemaVersion: "1.0",
    tenantId: TENANT_A,
    subjectId: SUBJECT_A,
    identityId: "stg-spiders",
    profileName: "synthetic_profile",
    registryRevision: 7,
    synchronizedAt: "2026-07-29T12:00:00.000Z",
    status: "active",
    ...overrides
  };
}

function validateMapping(value) {
  return { ok: true, value: { ...value } };
}

function boundary({
  session = { authenticated: true, subjectId: SUBJECT_A, sessionId: "synthetic_session" },
  resolveMembership,
  readMappingCandidates = () => [reviewedMapping()]
}) {
  const membership = {
    active: true,
    tenantId: TENANT_A,
    subjectId: SUBJECT_A,
    permissions: ["read_hosted_agent_presence"],
    authorizationRef: "synthetic_authorization",
    policyRevision: 1
  };
  return createPrivateHostedAgentPresenceApiHandler({
    now: () => GENERATED_AT,
    resolveTrustedSession: () => session,
    resolveTrustedMembership: resolveMembership ?? (() => membership),
    readMappingCandidates,
    installedProfileNames: ["synthetic_profile"],
    validateMapping
  });
}

function request(server, path, options = {}) {
  const address = server.address();
  return new Promise((resolve, reject) => {
    const outgoing = http.request({
      host: "127.0.0.1",
      port: address.port,
      path,
      method: options.method ?? "GET",
      headers: options.headers ?? { authorization: "Bearer active" }
    }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => resolve({
        status: response.statusCode,
        headers: response.headers,
        body: JSON.parse(Buffer.concat(chunks).toString("utf8"))
      }));
    });
    outgoing.on("error", reject);
    if (options.body !== undefined) outgoing.write(options.body);
    outgoing.end();
  });
}

async function directRequest(handler, overrides = {}) {
  let status;
  let headers;
  let payload = "";
  const response = {
    writeHead(nextStatus, nextHeaders) {
      status = nextStatus;
      headers = Object.fromEntries(
        Object.entries(nextHeaders).map(([key, value]) => [key.toLowerCase(), value])
      );
    },
    end(chunk) {
      payload += chunk ?? "";
    }
  };
  await handler({
    method: "GET",
    url: `/api/private/tenants/${TENANT_A}/hosted-agent-presence`,
    headers: { authorization: "Bearer active" },
    rawHeaders: ["Authorization", "Bearer active"],
    ...overrides
  }, response);
  return { status, headers, body: JSON.parse(payload) };
}

async function fixture() {
  const counters = {
    mappingReads: 0,
    membershipReads: 0,
    providerReads: 0,
    recordReads: 0,
    sessionReads: 0
  };
  const handler = createPrivateHostedAgentPresenceApiHandler({
    now: () => GENERATED_AT,
    resolveTrustedSession(incoming) {
      counters.sessionReads += 1;
      const token = incoming.headers.authorization;
      if (token !== "Bearer active" && token !== "Bearer revoked") return null;
      return {
        authenticated: true,
        subjectId: SUBJECT_A,
        sessionId: token === "Bearer active" ? "synthetic_session" : "revoked_session"
      };
    },
    resolveTrustedMembership({ session }) {
      counters.membershipReads += 1;
      return {
        active: session.sessionId === "synthetic_session",
        tenantId: TENANT_A,
        subjectId: SUBJECT_A,
        permissions: ["read_hosted_agent_presence"],
        authorizationRef: "synthetic_authorization",
        policyRevision: 1
      };
    },
    readMappingCandidates() {
      counters.mappingReads += 1;
      return [];
    },
    installedProfileNames: ["synthetic_profile"],
    validateMapping() {
      throw new Error("mapping validation must not run for denied requests");
    }
  });
  const server = http.createServer(handler);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    counters,
    handler,
    server,
    close: () => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  };
}

function denialMatrixEntry(name, result) {
  return {
    name,
    status: result.status,
    cacheControl: result.headers["cache-control"],
    vary: result.headers.vary,
    responseKeys: Object.keys(result.body).sort(),
    body: result.body
  };
}

test("private presence route denies wrong tenant direct ID alternate route and revoked membership identically", async () => {
  const context = await fixture();
  try {
    const cases = [
      ["wrong-tenant", `/api/private/tenants/${TENANT_B}/hosted-agent-presence`, {}],
      ["foreign-direct-id", `/api/private/tenants/${TENANT_A}/hosted-agent-presence/id_4444444444444444`, {}],
      ["alternate-route", `/api/private/tenants/${TENANT_A}/hosted-agents`, {}],
      ["revoked-membership", `/api/private/tenants/${TENANT_A}/hosted-agent-presence`, {
        headers: { authorization: "Bearer revoked" }
      }]
    ];
    const matrix = [];
    for (const [name, path, options] of cases) {
      const result = await request(context.server, path, options);
      matrix.push(denialMatrixEntry(name, result));
    }

    const expected = {
      status: 404,
      cacheControl: "private, no-store",
      vary: "Authorization",
      responseKeys: ["error"],
      body: { error: "not_found" }
    };
    for (const { name: _name, ...entry } of matrix) assert.deepEqual(entry, expected);
    assert.equal(context.counters.mappingReads, 0);
    assert.equal(context.counters.recordReads, 0);
    assert.equal(context.counters.providerReads, 0);
    assert.equal(JSON.stringify(matrix).includes(TENANT_B), false);
    assert.equal(JSON.stringify(matrix).includes("id_4444444444444444"), false);
    console.log(`PRIVATE_PRESENCE_DENIAL_MATRIX ${JSON.stringify(matrix)}`);
  } finally {
    await context.close();
  }
});

test("private presence route rejects missing malformed and duplicate authorization before trusted reads", async () => {
  const context = await fixture();
  try {
    const path = `/api/private/tenants/${TENANT_A}/hosted-agent-presence`;
    const cases = [
      await request(context.server, path, { headers: {} }),
      await request(context.server, path, { headers: { authorization: "Basic synthetic" } }),
      await directRequest(context.handler, {
        rawHeaders: ["Authorization", "Bearer active", "Authorization", "Bearer active"]
      })
    ];
    for (const result of cases) {
      assert.deepEqual(denialMatrixEntry("authorization", result), {
        name: "authorization",
        status: 404,
        cacheControl: "private, no-store",
        vary: "Authorization",
        responseKeys: ["error"],
        body: { error: "not_found" }
      });
    }
    assert.deepEqual(context.counters, {
      mappingReads: 0,
      membershipReads: 0,
      providerReads: 0,
      recordReads: 0,
      sessionReads: 0
    });
  } finally {
    await context.close();
  }
});

test("authorized private presence scopes the exact mapping lookup and reauthorizes before serialization", async () => {
  const calls = { mapping: [], memberships: 0 };
  const session = { authenticated: true, subjectId: SUBJECT_A, sessionId: "synthetic_session" };
  const membership = {
    active: true,
    tenantId: TENANT_A,
    subjectId: SUBJECT_A,
    permissions: ["read_hosted_agent_presence"],
    authorizationRef: "synthetic_authorization",
    policyRevision: 1
  };
  const handler = createPrivateHostedAgentPresenceApiHandler({
    now: () => GENERATED_AT,
    resolveTrustedSession: () => session,
    resolveTrustedMembership(input) {
      calls.memberships += 1;
      assert.equal(input.session, session);
      return membership;
    },
    readMappingCandidates(scope) {
      calls.mapping.push(scope);
      return [reviewedMapping()];
    },
    installedProfileNames: ["synthetic_profile"],
    validateMapping
  });

  const result = await directRequest(handler);

  assert.equal(result.status, 200);
  assert.equal(result.headers["cache-control"], "private, no-store");
  assert.equal(result.headers.vary, "Authorization");
  assert.deepEqual(result.body, {
    schemaVersion: "1.0",
    tenantId: TENANT_A,
    generatedAt: GENERATED_AT,
    presence: null
  });
  assert.deepEqual(calls.mapping, [{ tenantId: TENANT_A, identityId: "stg-spiders" }]);
  assert.equal(calls.memberships, 2);
});

test("private presence route rejects a request body before trusted reads", async () => {
  const context = await fixture();
  try {
    const body = JSON.stringify({
      tenantId: TENANT_B,
      subjectId: TENANT_B,
      profileName: "foreign_profile",
      identityId: "foreign_identity",
      state: "working",
      policyRevision: 999,
      freshness: "live"
    });
    const result = await request(
      context.server,
      `/api/private/tenants/${TENANT_A}/hosted-agent-presence`,
      {
        headers: { authorization: "Bearer active", "content-length": String(Buffer.byteLength(body)) },
        body
      }
    );
    assert.equal(result.status, 404);
    assert.deepEqual(result.body, { error: "not_found" });
    assert.equal(JSON.stringify(result.body).includes("foreign_"), false);
    assert.equal(context.counters.sessionReads, 0);
    assert.equal(context.counters.membershipReads, 0);
    assert.equal(context.counters.mappingReads, 0);
  } finally {
    await context.close();
  }
});

test("private presence route rejects malformed tenant query wrong method encoded separator and alternate routes before trusted reads", async () => {
  const context = await fixture();
  try {
    const cases = [
      ["GET", "/api/private/tenants/id_short/hosted-agent-presence"],
      ["GET", `/api/private/tenants/${TENANT_A}/hosted-agent-presence?identityId=stg-spiders`],
      ["POST", `/api/private/tenants/${TENANT_A}/hosted-agent-presence`],
      ["GET", `/api/private/tenants/${TENANT_A}%2Fid_4444444444444444/hosted-agent-presence`],
      ["GET", `/api/private/tenants/${TENANT_A}/hosted-agent-presence/history`]
    ];
    for (const [method, path] of cases) {
      const result = await request(context.server, path, { method });
      assert.equal(result.status, 404);
      assert.deepEqual(result.body, { error: "not_found" });
    }
    assert.equal(context.counters.sessionReads, 0);
    assert.equal(context.counters.membershipReads, 0);
    assert.equal(context.counters.mappingReads, 0);
  } finally {
    await context.close();
  }
});

test("private presence route rejects inactive membership and missing permission before mapping reads", async () => {
  for (const changed of [
    { active: false },
    { permissions: ["future_permission"] }
  ]) {
    let mappingReads = 0;
    const membership = {
      active: true,
      tenantId: TENANT_A,
      subjectId: SUBJECT_A,
      permissions: ["read_hosted_agent_presence"],
      authorizationRef: "synthetic_authorization",
      policyRevision: 1,
      ...changed
    };
    const handler = boundary({
      resolveMembership: () => membership,
      readMappingCandidates() {
        mappingReads += 1;
        return [reviewedMapping()];
      }
    });
    const result = await directRequest(handler);
    assert.equal(result.status, 404);
    assert.deepEqual(result.body, { error: "not_found" });
    assert.equal(mappingReads, 0);
  }
});

test("private presence route rejects negative-zero membership policy revision before mapping reads", async () => {
  let mappingReads = 0;
  const handler = boundary({
    resolveMembership: () => ({
      active: true,
      tenantId: TENANT_A,
      subjectId: SUBJECT_A,
      permissions: ["read_hosted_agent_presence"],
      authorizationRef: "synthetic_authorization",
      policyRevision: -0
    }),
    readMappingCandidates() {
      mappingReads += 1;
      return [reviewedMapping()];
    }
  });

  const result = await directRequest(handler);

  assert.deepEqual(denialMatrixEntry("negative-zero-policy-revision", result), {
    name: "negative-zero-policy-revision",
    status: 404,
    cacheControl: "private, no-store",
    vary: "Authorization",
    responseKeys: ["error"],
    body: { error: "not_found" }
  });
  assert.equal(mappingReads, 0);
});

test("private presence route rejects coercible trusted subject IDs before mapping reads", async () => {
  let mappingReads = 0;
  let toStringReads = 0;
  const coercibleSubjectId = {
    toString() {
      toStringReads += 1;
      return SUBJECT_A;
    }
  };
  const handler = boundary({
    session: {
      authenticated: true,
      subjectId: coercibleSubjectId,
      sessionId: "synthetic_session"
    },
    resolveMembership: () => ({
      active: true,
      tenantId: TENANT_A,
      subjectId: coercibleSubjectId,
      permissions: ["read_hosted_agent_presence"],
      authorizationRef: "synthetic_authorization",
      policyRevision: 1
    }),
    readMappingCandidates() {
      mappingReads += 1;
      return [reviewedMapping()];
    }
  });

  const result = await directRequest(handler);

  assert.deepEqual(denialMatrixEntry("coercible-subject-id", result), {
    name: "coercible-subject-id",
    status: 404,
    cacheControl: "private, no-store",
    vary: "Authorization",
    responseKeys: ["error"],
    body: { error: "not_found" }
  });
  assert.deepEqual({ mappingReads, toStringReads }, { mappingReads: 0, toStringReads: 0 });
});

test("private presence route fails closed on mutating and accessor-backed trusted dependency results", async () => {
  let lengthReads = 0;
  const permissions = new Proxy(["future_permission"], {
    get(target, key, receiver) {
      if (key === "length") {
        lengthReads += 1;
        if (lengthReads === 2) target[0] = "read_hosted_agent_presence";
      }
      return Reflect.get(target, key, receiver);
    }
  });
  let mappingReads = 0;
  const membership = {
    active: true,
    tenantId: TENANT_A,
    subjectId: SUBJECT_A,
    permissions,
    authorizationRef: "synthetic_authorization",
    policyRevision: 1
  };
  const handler = boundary({
    resolveMembership: () => membership,
    readMappingCandidates() {
      mappingReads += 1;
      return [reviewedMapping()];
    }
  });

  const result = await directRequest(handler);

  assert.equal(result.status, 404);
  assert.deepEqual(result.body, { error: "not_found" });
  assert.equal(mappingReads, 0);

  let getterReads = 0;
  const accessorMembership = { ...membership, permissions: ["read_hosted_agent_presence"] };
  Object.defineProperty(accessorMembership, "tenantId", {
    enumerable: true,
    get() {
      getterReads += 1;
      return TENANT_A;
    }
  });
  assert.equal((await directRequest(boundary({
    resolveMembership: () => accessorMembership
  }))).status, 404);
  assert.equal(getterReads, 0);
});

test("private presence route revalidates the trusted session and membership immediately before serialization", async () => {
  const session = { authenticated: true, subjectId: SUBJECT_A, sessionId: "synthetic_session" };
  const membership = {
    active: true,
    tenantId: TENANT_A,
    subjectId: SUBJECT_A,
    permissions: ["read_hosted_agent_presence"],
    authorizationRef: "synthetic_authorization",
    policyRevision: 1
  };
  let sessionReads = 0;
  let membershipReads = 0;
  const handler = createPrivateHostedAgentPresenceApiHandler({
    now: () => GENERATED_AT,
    resolveTrustedSession() {
      sessionReads += 1;
      return session;
    },
    resolveTrustedMembership() {
      membershipReads += 1;
      return membership;
    },
    readMappingCandidates() {
      session.subjectId = TENANT_B;
      return [reviewedMapping()];
    },
    installedProfileNames: ["synthetic_profile"],
    validateMapping
  });

  const result = await directRequest(handler);

  assert.equal(result.status, 404);
  assert.deepEqual(result.body, { error: "not_found" });
  assert.equal(sessionReads, 2);
  assert.equal(membershipReads, 1);
});

test("private presence route denies revocation at final reauthorization and omits thrown dependency text", async () => {
  let membershipReads = 0;
  const membership = {
    active: true,
    tenantId: TENANT_A,
    subjectId: SUBJECT_A,
    permissions: ["read_hosted_agent_presence"],
    authorizationRef: "synthetic_authorization",
    policyRevision: 1
  };
  const revoked = await directRequest(boundary({
    resolveMembership() {
      membershipReads += 1;
      return membershipReads === 1 ? membership : { ...membership, active: false };
    }
  }));
  assert.equal(revoked.status, 404);
  assert.deepEqual(revoked.body, { error: "not_found" });
  assert.equal(membershipReads, 2);

  const thrown = await directRequest(createPrivateHostedAgentPresenceApiHandler({
    now: () => GENERATED_AT,
    resolveTrustedSession() {
      throw new Error("sensitive dependency exception text");
    },
    resolveTrustedMembership: () => membership,
    readMappingCandidates: () => [reviewedMapping()],
    installedProfileNames: ["synthetic_profile"],
    validateMapping
  }));
  assert.equal(thrown.status, 404);
  assert.deepEqual(thrown.body, { error: "not_found" });
  assert.equal(JSON.stringify(thrown).includes("sensitive dependency exception text"), false);
});
