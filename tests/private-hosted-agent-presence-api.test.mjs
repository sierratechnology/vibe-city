import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";

import { createPrivateHostedAgentPresenceApiHandler } from "../server/privateHostedAgentPresenceApi.mjs";

const TENANT_A = "id_1111111111111111";
const TENANT_B = "id_2222222222222222";
const SUBJECT_A = "id_3333333333333333";
const RECORD_A = "id_4444444444444444";
const STATE_CHANGED_AT = "2026-07-29T12:01:00.000Z";
const OBSERVED_AT = "2026-07-29T12:03:00.000Z";
const PRIOR_CHECKED_AT = "2026-07-29T12:04:00.000Z";
const GENERATED_AT = "2026-07-29T12:05:00.000Z";
const LATER_GENERATED_AT = "2026-07-29T12:05:01.000Z";

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
  resolveSession,
  resolveMembership,
  readMappingCandidates = () => [reviewedMapping()],
  now = () => GENERATED_AT,
  ...presenceDependencies
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
    now,
    resolveTrustedSession: resolveSession ?? (() => session),
    resolveTrustedMembership: resolveMembership ?? (() => membership),
    readMappingCandidates,
    installedProfileNames: ["synthetic_profile"],
    validateMapping,
    ...presenceDependencies
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

function unavailablePresence(reason, checkedAt = GENERATED_AT) {
  return {
    identityId: "stg-spiders",
    displayName: "Spiders",
    roleLabel: "Chief Agent",
    workplace: {
      id: "stg-chief-agent-office",
      label: "Chief Agent Office",
      relationship: "designated"
    },
    state: "unavailable",
    freshness: "unavailable",
    reason,
    stateChangedAt: null,
    observedAt: null,
    checkedAt,
    recordRef: null
  };
}

function workingResponse() {
  return {
    schemaVersion: "1.0",
    tenantId: TENANT_A,
    generatedAt: PRIOR_CHECKED_AT,
    presence: {
      identityId: "stg-spiders",
      displayName: "Spiders",
      roleLabel: "Chief Agent",
      workplace: {
        id: "stg-chief-agent-office",
        label: "Chief Agent Office",
        relationship: "designated"
      },
      state: "working",
      freshness: "live",
      reason: null,
      stateChangedAt: STATE_CHANGED_AT,
      observedAt: OBSERVED_AT,
      checkedAt: PRIOR_CHECKED_AT,
      recordRef: {
        recordId: RECORD_A,
        href: `/api/private/tenants/${TENANT_A}/records/${RECORD_A}`
      }
    }
  };
}

function retainedCache(overrides = {}) {
  return {
    schemaVersion: "1.0",
    tenantId: TENANT_A,
    subjectId: SUBJECT_A,
    mappingRevision: 7,
    recordId: RECORD_A,
    action: "read_hosted_agent_presence",
    authorizationRef: "synthetic_authorization",
    policyRevision: 1,
    projection: workingResponse(),
    ...overrides
  };
}

test("strictly increasing trusted clock samples use checkedAt before generatedAt on the fresh path", async () => {
  let clockReads = 0;
  let sourceReads = 0;
  const freshProjection = {
    ...workingResponse(),
    generatedAt: LATER_GENERATED_AT,
    presence: { ...workingResponse().presence, checkedAt: GENERATED_AT }
  };
  const result = await directRequest(boundary({
    now() {
      clockReads += 1;
      return clockReads === 1 ? GENERATED_AT : LATER_GENERATED_AT;
    },
    readCurrentPresence(facts) {
      sourceReads += 1;
      assert.deepEqual(facts, {
        tenantId: TENANT_A,
        subjectId: SUBJECT_A,
        mappingRevision: 7,
        checkedAt: GENERATED_AT,
        generatedAt: LATER_GENERATED_AT
      });
      return freshProjection;
    },
    authorizeRetainedPresence: () => true
  }));

  assert.equal(result.status, 200);
  assert.deepEqual(result.body, freshProjection);
  assert.deepEqual({ clockReads, sourceReads }, { clockReads: 2, sourceReads: 1 });
  assert.equal(result.body.presence.state, "working");
  assert.equal(result.body.presence.freshness, "live");
  assert.equal(result.body.presence.reason, null);
});

test("invalid first trusted clock sample closes presence before source reads", async () => {
  let accessorReads = 0;
  let coercionReads = 0;
  const mutatingClock = {
    [Symbol.toPrimitive]() {
      coercionReads += 1;
      this.rejected = GENERATED_AT;
      throw new Error("sensitive mutating clock text");
    }
  };
  const cases = [
    ["throwing", () => { throw new Error("sensitive first clock text"); }],
    ["non-string", () => 0],
    ["noncanonical", () => "2026-07-29T12:05:00Z"],
    ["impossible", () => "2026-02-30T12:05:00.000Z"],
    ["accessor-backed", () => Object.defineProperty({}, "value", {
      get() {
        accessorReads += 1;
        return GENERATED_AT;
      }
    })],
    ["mutating-object", () => mutatingClock]
  ];

  for (const [name, invalidClock] of cases) {
    let clockReads = 0;
    let sourceReads = 0;
    const result = await directRequest(boundary({
      now() {
        clockReads += 1;
        return clockReads === 1 ? invalidClock() : GENERATED_AT;
      },
      readCurrentPresence() {
        sourceReads += 1;
        throw new Error("source must not run after invalid first clock sample");
      }
    }));

    assert.equal(result.status, 200, name);
    assert.deepEqual(result.body, {
      schemaVersion: "1.0",
      tenantId: TENANT_A,
      generatedAt: GENERATED_AT,
      presence: unavailablePresence("clock_invalid")
    }, name);
    assert.deepEqual({ clockReads, sourceReads }, { clockReads: 2, sourceReads: 0 }, name);
    const serialized = JSON.stringify(result);
    assert.equal(serialized.includes("sensitive"), false, name);
    assert.equal(serialized.includes("2026-02-30"), false, name);
    assert.equal(serialized.includes("1970-01-01"), false, name);
  }
  assert.deepEqual({ accessorReads, coercionReads }, { accessorReads: 0, coercionReads: 0 });
  assert.equal(Object.hasOwn(mutatingClock, "rejected"), false);
});

test("invalid first trusted clock sample denies authority changes during canonical closure", async () => {
  for (const authorityChange of ["membership", "policy", "session", "mapping"]) {
    const session = { authenticated: true, subjectId: SUBJECT_A, sessionId: "synthetic_session" };
    const membership = {
      active: true,
      tenantId: TENANT_A,
      subjectId: SUBJECT_A,
      permissions: ["read_hosted_agent_presence"],
      authorizationRef: "synthetic_authorization",
      policyRevision: 1
    };
    let mappingRevision = 7;
    let clockReads = 0;
    let mappingReads = 0;
    let sourceReads = 0;
    const result = await directRequest(boundary({
      session,
      resolveMembership: () => membership,
      readMappingCandidates() {
        mappingReads += 1;
        return [reviewedMapping({ registryRevision: mappingRevision })];
      },
      now() {
        clockReads += 1;
        if (clockReads === 1) return "sensitive rejected first clock value";
        if (authorityChange === "membership") membership.active = false;
        if (authorityChange === "policy") membership.policyRevision = 2;
        if (authorityChange === "session") session.sessionId = "revoked_session";
        if (authorityChange === "mapping") mappingRevision = 8;
        return GENERATED_AT;
      },
      readCurrentPresence() {
        sourceReads += 1;
        throw new Error("sensitive source exception");
      }
    }));

    assert.equal(result.status, 404, authorityChange);
    assert.deepEqual(result.body, { error: "not_found" }, authorityChange);
    assert.deepEqual({ clockReads, mappingReads, sourceReads }, {
      clockReads: 2,
      mappingReads: 2,
      sourceReads: 0
    }, authorityChange);
    const serialized = JSON.stringify(result);
    for (const rejectedField of [
      TENANT_A,
      "Spiders",
      RECORD_A,
      "synthetic_profile",
      "sensitive rejected first clock value",
      "sensitive source exception",
      "task",
      "run",
      "pid",
      "model",
      "provider"
    ]) assert.equal(serialized.includes(rejectedField), false, `${authorityChange}:${rejectedField}`);
  }
});

test("invalid first clock closure denies authority revoked by the final mapping read", async () => {
  for (const authorityChange of ["membership", "policy", "session"]) {
    const session = { authenticated: true, subjectId: SUBJECT_A, sessionId: "synthetic_session" };
    const membership = {
      active: true,
      tenantId: TENANT_A,
      subjectId: SUBJECT_A,
      permissions: ["read_hosted_agent_presence"],
      authorizationRef: "synthetic_authorization",
      policyRevision: 1
    };
    let clockReads = 0;
    let mappingReads = 0;
    let sourceReads = 0;
    const result = await directRequest(boundary({
      session,
      resolveMembership: () => membership,
      readMappingCandidates() {
        mappingReads += 1;
        if (mappingReads === 2) {
          if (authorityChange === "membership") membership.active = false;
          if (authorityChange === "policy") membership.policyRevision = 2;
          if (authorityChange === "session") session.sessionId = "revoked_session";
        }
        return [reviewedMapping()];
      },
      now() {
        clockReads += 1;
        return clockReads === 1 ? "sensitive rejected first clock value" : GENERATED_AT;
      },
      readCurrentPresence() {
        sourceReads += 1;
        throw new Error("sensitive source exception");
      }
    }));

    assert.equal(result.status, 404, authorityChange);
    assert.deepEqual(result.body, { error: "not_found" }, authorityChange);
    assert.deepEqual({ clockReads, mappingReads, sourceReads }, {
      clockReads: 2,
      mappingReads: 2,
      sourceReads: 0
    }, authorityChange);
    const serialized = JSON.stringify(result);
    for (const forbiddenField of [
      TENANT_A,
      SUBJECT_A,
      RECORD_A,
      "Spiders",
      "synthetic_profile",
      "synthetic_session",
      "synthetic_authorization",
      "sensitive rejected first clock value",
      "sensitive source exception",
      "task",
      "run",
      "pid",
      "model",
      "provider"
    ]) assert.equal(serialized.includes(forbiddenField), false, `${authorityChange}:${forbiddenField}`);
  }
});

test("invalid second trusted clock sample denies authority changes before clock-invalid serialization", async () => {
  for (const authorityChange of ["membership", "policy", "session", "mapping"]) {
    const session = { authenticated: true, subjectId: SUBJECT_A, sessionId: "synthetic_session" };
    const membership = {
      active: true,
      tenantId: TENANT_A,
      subjectId: SUBJECT_A,
      permissions: ["read_hosted_agent_presence"],
      authorizationRef: "synthetic_authorization",
      policyRevision: 1
    };
    let mappingRevision = 7;
    let clockReads = 0;
    let sourceReads = 0;
    const result = await directRequest(boundary({
      session,
      resolveMembership: () => membership,
      readMappingCandidates: () => [reviewedMapping({ registryRevision: mappingRevision })],
      now() {
        clockReads += 1;
        if (clockReads === 1) return GENERATED_AT;
        if (authorityChange === "membership") membership.active = false;
        if (authorityChange === "policy") membership.policyRevision = 2;
        if (authorityChange === "session") session.sessionId = "revoked_session";
        if (authorityChange === "mapping") mappingRevision = 8;
        return "noncanonical rejected clock value";
      },
      readCurrentPresence() {
        sourceReads += 1;
        throw new Error("source must not run after invalid second clock sample");
      }
    }));

    assert.equal(result.status, 404, authorityChange);
    assert.deepEqual(result.body, { error: "not_found" }, authorityChange);
    assert.deepEqual({ clockReads, sourceReads }, { clockReads: 2, sourceReads: 0 }, authorityChange);
    const serialized = JSON.stringify(result);
    assert.equal(serialized.includes(TENANT_A), false, authorityChange);
    assert.equal(serialized.includes("Spiders"), false, authorityChange);
    assert.equal(serialized.includes(RECORD_A), false, authorityChange);
    assert.equal(serialized.includes("noncanonical rejected clock value"), false, authorityChange);
    assert.equal(serialized.includes("task"), false, authorityChange);
    assert.equal(serialized.includes("provider"), false, authorityChange);
  }
});

test("fresh presence denies revocation during final awaited authorization", async () => {
  const membership = {
    active: true,
    tenantId: TENANT_A,
    subjectId: SUBJECT_A,
    permissions: ["read_hosted_agent_presence"],
    authorizationRef: "synthetic_authorization",
    policyRevision: 1
  };
  let authorizationReads = 0;
  const freshProjection = {
    ...workingResponse(),
    generatedAt: GENERATED_AT,
    presence: { ...workingResponse().presence, checkedAt: GENERATED_AT }
  };
  const result = await directRequest(boundary({
    resolveMembership: () => membership,
    readCurrentPresence: () => freshProjection,
    authorizeRetainedPresence() {
      authorizationReads += 1;
      if (authorizationReads === 2) {
        membership.active = false;
        membership.policyRevision = 2;
      }
      return true;
    }
  }));

  assert.equal(result.status, 404);
  assert.deepEqual(result.body, { error: "not_found" });
  assert.equal(authorizationReads, 2);
  assert.equal(JSON.stringify(result).includes(RECORD_A), false);
  assert.equal(JSON.stringify(result).includes("working"), false);
});

test("malformed current-source completion denies authority changes before stale recovery", async () => {
  for (const authorityChange of ["membership", "policy", "session", "mapping"]) {
    const session = { authenticated: true, subjectId: SUBJECT_A, sessionId: "synthetic_session" };
    const membership = {
      active: true,
      tenantId: TENANT_A,
      subjectId: SUBJECT_A,
      permissions: ["read_hosted_agent_presence"],
      authorizationRef: "synthetic_authorization",
      policyRevision: 1
    };
    let mappingRevision = 7;
    let resolveSource;
    let cacheReads = 0;
    const pending = directRequest(boundary({
      session,
      resolveMembership: () => membership,
      readMappingCandidates: () => [reviewedMapping({ registryRevision: mappingRevision })],
      readCurrentPresence: () => new Promise((resolve) => { resolveSource = resolve; }),
      readLastValidatedPresence() {
        cacheReads += 1;
        return retainedCache();
      },
      authorizeRetainedPresence: () => true,
      evaluateStaleRetention: () => ({ verdict: "retain", policyRevision: 1 })
    }));
    assert.equal(typeof resolveSource, "function", authorityChange);
    if (authorityChange === "membership") membership.active = false;
    if (authorityChange === "policy") membership.policyRevision = 2;
    if (authorityChange === "session") session.sessionId = "revoked_session";
    if (authorityChange === "mapping") mappingRevision = 8;
    resolveSource({});

    const result = await pending;
    assert.equal(result.status, 404, authorityChange);
    assert.deepEqual(result.body, { error: "not_found" }, authorityChange);
    assert.equal(cacheReads, 0, authorityChange);
    assert.equal(JSON.stringify(result).includes(TENANT_A), false, authorityChange);
    assert.equal(JSON.stringify(result).includes("Spiders"), false, authorityChange);
    assert.equal(JSON.stringify(result).includes(RECORD_A), false, authorityChange);
  }
});

test("missing and malformed cache completion deny authority changes before policy evaluation", async () => {
  for (const [cacheOutcome, cacheValue] of [["missing", null], ["malformed", {}]]) {
    for (const authorityChange of ["membership", "policy", "session", "mapping"]) {
      const session = { authenticated: true, subjectId: SUBJECT_A, sessionId: "synthetic_session" };
      const membership = {
        active: true,
        tenantId: TENANT_A,
        subjectId: SUBJECT_A,
        permissions: ["read_hosted_agent_presence"],
        authorizationRef: "synthetic_authorization",
        policyRevision: 1
      };
      let mappingRevision = 7;
      let resolveCache;
      let policyReads = 0;
      const pending = directRequest(boundary({
        session,
        resolveMembership: () => membership,
        readMappingCandidates: () => [reviewedMapping({ registryRevision: mappingRevision })],
        readCurrentPresence() {
          throw new Error("synthetic source outage");
        },
        readLastValidatedPresence: () => new Promise((resolve) => { resolveCache = resolve; }),
        authorizeRetainedPresence: () => true,
        evaluateStaleRetention() {
          policyReads += 1;
          return { verdict: "retain", policyRevision: 1 };
        }
      }));
      const label = `${cacheOutcome}:${authorityChange}`;
      assert.equal(typeof resolveCache, "function", label);
      if (authorityChange === "membership") membership.active = false;
      if (authorityChange === "policy") membership.policyRevision = 2;
      if (authorityChange === "session") session.sessionId = "revoked_session";
      if (authorityChange === "mapping") mappingRevision = 8;
      resolveCache(cacheValue);

      const result = await pending;
      assert.equal(result.status, 404, label);
      assert.deepEqual(result.body, { error: "not_found" }, label);
      assert.equal(policyReads, 0, label);
      assert.equal(JSON.stringify(result).includes(TENANT_A), false, label);
      assert.equal(JSON.stringify(result).includes("Spiders"), false, label);
      assert.equal(JSON.stringify(result).includes(RECORD_A), false, label);
    }
  }
});

test("malformed closed and rejected stale-policy completion deny authority changes", async () => {
  for (const policyOutcome of ["malformed", "closed", "rejected"]) {
    for (const authorityChange of ["membership", "policy", "session", "mapping"]) {
      const session = { authenticated: true, subjectId: SUBJECT_A, sessionId: "synthetic_session" };
      const membership = {
        active: true,
        tenantId: TENANT_A,
        subjectId: SUBJECT_A,
        permissions: ["read_hosted_agent_presence"],
        authorizationRef: "synthetic_authorization",
        policyRevision: 1
      };
      let mappingRevision = 7;
      let settlePolicy;
      let signalPolicyStarted;
      const policyStarted = new Promise((resolve) => { signalPolicyStarted = resolve; });
      let sessionReads = 0;
      let membershipReads = 0;
      const pending = directRequest(boundary({
        resolveSession() {
          sessionReads += 1;
          return session;
        },
        resolveMembership() {
          membershipReads += 1;
          return membership;
        },
        readMappingCandidates: () => [reviewedMapping({ registryRevision: mappingRevision })],
        readCurrentPresence() {
          throw new Error("synthetic source outage");
        },
        readLastValidatedPresence: () => retainedCache(),
        authorizeRetainedPresence: () => true,
        evaluateStaleRetention: () => new Promise((resolve, reject) => {
          settlePolicy = policyOutcome === "rejected" ? reject : resolve;
          signalPolicyStarted();
        })
      }));
      const label = `${policyOutcome}:${authorityChange}`;
      await policyStarted;
      assert.equal(typeof settlePolicy, "function", label);
      const sessionReadsBeforeCompletion = sessionReads;
      const readsBeforeCompletion = membershipReads;
      if (authorityChange === "membership") membership.active = false;
      if (authorityChange === "policy") membership.policyRevision = 2;
      if (authorityChange === "session") session.sessionId = "revoked_session";
      if (authorityChange === "mapping") mappingRevision = 8;
      if (policyOutcome === "malformed") settlePolicy({});
      if (policyOutcome === "closed") settlePolicy({ verdict: "closed", policyRevision: 1 });
      if (policyOutcome === "rejected") settlePolicy(new Error("sensitive stale-policy rejection"));

      const result = await pending;
      assert.equal(result.status, 404, label);
      assert.deepEqual(result.body, { error: "not_found" }, label);
      assert.equal(sessionReads > sessionReadsBeforeCompletion, true, label);
      if (authorityChange !== "session") assert.equal(membershipReads > readsBeforeCompletion, true, label);
      assert.equal(JSON.stringify(result).includes(TENANT_A), false, label);
      assert.equal(JSON.stringify(result).includes("Spiders"), false, label);
      assert.equal(JSON.stringify(result).includes(RECORD_A), false, label);
      assert.equal(JSON.stringify(result).includes("sensitive"), false, label);
    }
  }
});

test("retained and expired presence deny authority changes during final awaited authorization", async () => {
  for (const verdict of ["retain", "expired"]) {
    for (const authorityChange of ["membership", "policy", "session", "mapping"]) {
      const session = { authenticated: true, subjectId: SUBJECT_A, sessionId: "synthetic_session" };
      const membership = {
        active: true,
        tenantId: TENANT_A,
        subjectId: SUBJECT_A,
        permissions: ["read_hosted_agent_presence"],
        authorizationRef: "synthetic_authorization",
        policyRevision: 1
      };
      let mappingRevision = 7;
      let authorizationReads = 0;
      const result = await directRequest(boundary({
        session,
        resolveMembership: () => membership,
        readMappingCandidates: () => [reviewedMapping({ registryRevision: mappingRevision })],
        readCurrentPresence() {
          throw new Error("synthetic source outage");
        },
        readLastValidatedPresence: () => retainedCache(),
        authorizeRetainedPresence() {
          authorizationReads += 1;
          if (authorizationReads === 2) {
            if (authorityChange === "membership") membership.active = false;
            if (authorityChange === "policy") membership.policyRevision = 2;
            if (authorityChange === "session") session.sessionId = "revoked_session";
            if (authorityChange === "mapping") mappingRevision = 8;
          }
          return true;
        },
        evaluateStaleRetention: () => ({ verdict, policyRevision: 1 })
      }));

      assert.equal(result.status, 404, `${verdict}:${authorityChange}`);
      assert.deepEqual(result.body, { error: "not_found" }, `${verdict}:${authorityChange}`);
      assert.equal(authorizationReads, 2, `${verdict}:${authorityChange}`);
      assert.equal(JSON.stringify(result).includes(RECORD_A), false, `${verdict}:${authorityChange}`);
      assert.equal(JSON.stringify(result).includes("working"), false, `${verdict}:${authorityChange}`);
    }
  }
});

test("clock failure clears presence and source failure retains only authorized last-valid state until policy expiry", async () => {
  let clockReads = 0;
  let sourceReads = 0;
  const result = await directRequest(boundary({
    now() {
      clockReads += 1;
      if (clockReads === 1) return GENERATED_AT;
      throw new Error("sensitive clock failure text");
    },
    readCurrentPresence() {
      sourceReads += 1;
      throw new Error("source must not run after clock failure");
    }
  }));

  assert.equal(result.status, 200);
  assert.deepEqual(result.body, {
    schemaVersion: "1.0",
    tenantId: TENANT_A,
    generatedAt: GENERATED_AT,
    presence: unavailablePresence("clock_invalid")
  });
  assert.deepEqual({ clockReads, sourceReads }, { clockReads: 2, sourceReads: 0 });
  assert.equal(JSON.stringify(result).includes("sensitive clock failure text"), false);
  assert.equal(JSON.stringify(result).includes("1970-01-01"), false);

  const authorizationChecks = [];
  const policyChecks = [];
  const retained = await directRequest(boundary({
    readCurrentPresence() {
      throw new Error("sensitive source failure text");
    },
    readLastValidatedPresence: () => retainedCache(),
    authorizeRetainedPresence(facts) {
      authorizationChecks.push(facts);
      return true;
    },
    evaluateStaleRetention(facts) {
      policyChecks.push(facts);
      return { verdict: "retain", policyRevision: 1 };
    }
  }));

  assert.equal(retained.status, 200);
  assert.deepEqual(retained.body, {
    schemaVersion: "1.0",
    tenantId: TENANT_A,
    generatedAt: GENERATED_AT,
    presence: {
      ...workingResponse().presence,
      freshness: "stale",
      reason: "source_stale",
      checkedAt: GENERATED_AT
    }
  });
  assert.equal(authorizationChecks.length, 2);
  assert.deepEqual(authorizationChecks[0], {
    tenantId: TENANT_A,
    subjectId: SUBJECT_A,
    mappingRevision: 7,
    recordId: RECORD_A,
    action: "read_hosted_agent_presence",
    authorizationRef: "synthetic_authorization",
    policyRevision: 1
  });
  assert.deepEqual(policyChecks, [{
    verdictRequired: "closed",
    tenantId: TENANT_A,
    subjectId: SUBJECT_A,
    mappingRevision: 7,
    recordId: RECORD_A,
    action: "read_hosted_agent_presence",
    authorizationRef: "synthetic_authorization",
    policyRevision: 1,
    observedAt: OBSERVED_AT,
    stateChangedAt: STATE_CHANGED_AT,
    checkedAt: GENERATED_AT
  }]);
  assert.equal(JSON.stringify(retained).includes("sensitive source failure text"), false);

  let expiryAuthorizationChecks = 0;
  const expired = await directRequest(boundary({
    readCurrentPresence() {
      throw new Error("synthetic source outage");
    },
    readLastValidatedPresence: () => retainedCache(),
    authorizeRetainedPresence() {
      expiryAuthorizationChecks += 1;
      return true;
    },
    evaluateStaleRetention: () => ({ verdict: "expired", policyRevision: 1 })
  }));
  assert.equal(expired.status, 200);
  assert.deepEqual(expired.body, {
    schemaVersion: "1.0",
    tenantId: TENANT_A,
    generatedAt: GENERATED_AT,
    presence: unavailablePresence("source_stale")
  });
  assert.equal(expiryAuthorizationChecks, 2);
  assert.equal(JSON.stringify(expired).includes(RECORD_A), false);

  const recoveredProjection = {
    ...workingResponse(),
    generatedAt: GENERATED_AT,
    presence: { ...workingResponse().presence, checkedAt: GENERATED_AT }
  };
  const recovered = await directRequest(boundary({
    readCurrentPresence: () => recoveredProjection,
    readLastValidatedPresence: () => retainedCache({
      projection: {
        ...workingResponse(),
        presence: { ...workingResponse().presence, state: "blocked" }
      }
    }),
    authorizeRetainedPresence: () => true,
    evaluateStaleRetention: () => ({ verdict: "retain", policyRevision: 1 })
  }));
  assert.equal(recovered.status, 200);
  assert.deepEqual(recovered.body, recoveredProjection);
  assert.equal(recovered.body.presence.state, "working");
  assert.equal(recovered.body.presence.freshness, "live");

  let recoveryAuthorizationReads = 0;
  const failedRecoveryAuthorization = await directRequest(boundary({
    readCurrentPresence: () => recoveredProjection,
    readLastValidatedPresence: () => retainedCache(),
    authorizeRetainedPresence() {
      recoveryAuthorizationReads += 1;
      if (recoveryAuthorizationReads === 1) throw new Error("private recovery authorization failure");
      return true;
    },
    evaluateStaleRetention: () => ({ verdict: "retain", policyRevision: 1 })
  }));
  assert.equal(failedRecoveryAuthorization.status, 404);
  assert.deepEqual(failedRecoveryAuthorization.body, { error: "not_found" });
  assert.equal(recoveryAuthorizationReads, 1);

  let mappingReads = 0;
  const mappingDrift = await directRequest(boundary({
    readMappingCandidates() {
      mappingReads += 1;
      return [reviewedMapping({ registryRevision: mappingReads === 1 ? 7 : 8 })];
    },
    readCurrentPresence() {
      throw new Error("synthetic source outage");
    },
    readLastValidatedPresence: () => retainedCache(),
    authorizeRetainedPresence: () => true,
    evaluateStaleRetention: () => ({ verdict: "retain", policyRevision: 1 })
  }));
  assert.equal(mappingDrift.status, 404);
  assert.deepEqual(mappingDrift.body, { error: "not_found" });
  assert.equal(mappingReads, 2);

  const boundaryTable = [];
  for (const [name, invalidClock] of [
    ["clock-throw", () => { throw new Error("private clock throw"); }],
    ["clock-non-string", () => 0],
    ["clock-noncanonical", () => "2026-07-29T12:05:00Z"],
    ["clock-impossible", () => "2026-02-30T12:05:00.000Z"],
    ["clock-accessor-backed", () => Object.defineProperty({}, "value", { get: () => GENERATED_AT })]
  ]) {
    let reads = 0;
    const clockResult = await directRequest(boundary({
      now() {
        reads += 1;
        return reads === 1 ? GENERATED_AT : invalidClock();
      },
      readCurrentPresence() {
        throw new Error("must not read source");
      }
    }));
    assert.equal(clockResult.status, 200);
    assert.deepEqual(clockResult.body.presence, unavailablePresence("clock_invalid"));
    boundaryTable.push({ name, status: clockResult.status, reason: clockResult.body.presence.reason });
  }

  const closedCacheCases = [
    ["no-cache", null],
    ["unknown-cache-field", retainedCache({ sourceId: "private_source" })],
    ["chronology-contradiction", retainedCache({
      projection: {
        ...workingResponse(),
        presence: { ...workingResponse().presence, observedAt: "2026-07-29T12:00:00.000Z" }
      }
    })]
  ];
  let getterReads = 0;
  const getterCache = retainedCache();
  Object.defineProperty(getterCache, "projection", {
    enumerable: true,
    get() {
      getterReads += 1;
      return workingResponse();
    }
  });
  closedCacheCases.push(["accessor-cache", getterCache]);
  for (const [name, cache] of closedCacheCases) {
    const closed = await directRequest(boundary({
      readCurrentPresence() {
        throw new Error("private source failure");
      },
      readLastValidatedPresence: () => cache,
      authorizeRetainedPresence: () => true,
      evaluateStaleRetention: () => ({ verdict: "retain", policyRevision: 1 })
    }));
    assert.equal(closed.status, 200);
    assert.deepEqual(closed.body.presence, unavailablePresence("source_stale"));
    assert.equal(JSON.stringify(closed).includes("private_"), false);
    boundaryTable.push({ name, status: closed.status, reason: closed.body.presence.reason });
  }
  assert.equal(getterReads, 0);

  let policyMembershipReads = 0;
  const policyDrift = await directRequest(boundary({
    resolveMembership() {
      policyMembershipReads += 1;
      return {
        active: true,
        tenantId: TENANT_A,
        subjectId: SUBJECT_A,
        permissions: ["read_hosted_agent_presence"],
        authorizationRef: "synthetic_authorization",
        policyRevision: policyMembershipReads < 3 ? 1 : 2
      };
    },
    readCurrentPresence() {
      throw new Error("synthetic source outage");
    },
    readLastValidatedPresence: () => retainedCache(),
    authorizeRetainedPresence: () => true,
    evaluateStaleRetention: () => ({ verdict: "retain", policyRevision: 1 })
  }));
  assert.equal(policyDrift.status, 404);
  assert.deepEqual(policyDrift.body, { error: "not_found" });
  boundaryTable.push({ name: "policy-drift", status: policyDrift.status, reason: null });
  boundaryTable.push({ name: "mapping-drift", status: mappingDrift.status, reason: null });
  boundaryTable.push({ name: "authorized-retained", status: retained.status, reason: retained.body.presence.reason });
  boundaryTable.push({ name: "expired", status: expired.status, reason: expired.body.presence.reason });
  boundaryTable.push({ name: "recovery", status: recovered.status, reason: recovered.body.presence.reason });
  console.log(`PRIVATE_PRESENCE_CLOCK_STALE_BOUNDARY ${JSON.stringify(boundaryTable)}`);
});

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
