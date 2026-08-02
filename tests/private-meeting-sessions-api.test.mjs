import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import http from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createPrivateMeetingSessionsRepository } from "../server/privateMeetingSessions.mjs";

const testJsonParse = JSON.parse.bind(JSON);

const TENANT_A = "syn-tenant-a";
const TENANT_B = "syn-tenant-b";
const SUBJECT_A = "syn-tenant-a--subject-a";
const SUBJECT_B = "syn-tenant-a--subject-b";
const SESSION_A = "syn-tenant-a--session-a";
const SESSION_B = "syn-tenant-b--session-b";
const STARTED_AT = "2000-01-01T00:01:30.000Z";
const ENDED_AT = "2000-01-01T00:01:45.000Z";
const NOW = "2000-01-01T00:02:00.000Z";
const AUTHORIZATION = "syn-tenant-a--authorization-a";
const BEARER = "Bearer synthetic-active";

async function loadApi() {
  return import("../server/privateMeetingSessionsApi.mjs").catch(() => ({}));
}

function authorityState(action) {
  return {
    session: { authenticated: true, sessionId: "synthetic-session", subjectId: SUBJECT_A },
    membership: {
      active: true,
      tenantId: TENANT_A,
      subjectId: SUBJECT_A,
      actionGrants: [action],
      authorizationReference: AUTHORIZATION,
      policyRevision: 1
    }
  };
}

function createBody(overrides = {}) {
  return {
    sessionId: SESSION_A,
    purposeReference: "syn-tenant-a--purpose-a",
    participantSubjectIds: [SUBJECT_A, "syn-tenant-a--subject-b"],
    materialReferences: ["syn-tenant-a--material-a", "syn-tenant-a--material-b"],
    startedAt: STARTED_AT,
    sourceReference: "syn-tenant-a--source-a",
    expectedRevision: 0,
    ...overrides
  };
}

function endBody(overrides = {}) {
  return {
    endedAt: ENDED_AT,
    expectedRevision: 1,
    outcomeReference: "syn-tenant-a--no-decision-a",
    ...overrides
  };
}

function setAuthority(state, action, {
  subjectId = SUBJECT_A,
  authorizationReference = AUTHORIZATION,
  policyRevision = 1
} = {}) {
  state.session = { authenticated: true, sessionId: "synthetic-session", subjectId };
  state.membership = {
    active: true,
    tenantId: TENANT_A,
    subjectId,
    actionGrants: [action],
    authorizationReference,
    policyRevision
  };
}

function makeHandler(factory, repository, state) {
  return factory({
    repository,
    now: () => NOW,
    resolveTrustedSession(request) {
      return request.headers.authorization === BEARER ? state.session : null;
    },
    resolveTrustedMembership({ session }) {
      assert.equal(session, state.session);
      return state.membership;
    },
    evaluatePolicy({ action, tenantId, subjectId }) {
      return action === state.membership.actionGrants[0] &&
        tenantId === state.membership.tenantId && subjectId === state.membership.subjectId;
    }
  });
}

async function startServer(handler) {
  const server = http.createServer(handler);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return server;
}

async function closeServer(server) {
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

function request(server, path, { method = "GET", body, headers = {} } = {}) {
  const payload = body === undefined ? undefined : JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const outgoing = http.request({
      host: "127.0.0.1",
      port: server.address().port,
      path,
      method,
      headers: {
        authorization: BEARER,
        ...(payload === undefined ? {} : {
          "content-type": "application/json",
          "content-length": String(Buffer.byteLength(payload))
        }),
        ...headers
      }
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
    if (payload !== undefined) outgoing.end(payload);
    else outgoing.end();
  });
}

async function directRequest(handler, { method, path, payload, rawHeaders, aborted = false }) {
  let status;
  let headers;
  let serialized = "";
  const bytes = payload === undefined ? 0 : Buffer.byteLength(payload);
  const request = {
    method,
    url: path,
    headers: { authorization: BEARER },
    rawHeaders: rawHeaders ?? ["Authorization", BEARER, ...(payload === undefined ? [] : [
      "Content-Type", "application/json", "Content-Length", String(bytes)
    ])],
    aborted,
    async *[Symbol.asyncIterator]() {
      if (payload !== undefined) yield Buffer.from(payload);
    }
  };
  const response = {
    headersSent: false,
    writeHead(nextStatus, nextHeaders) {
      status = nextStatus;
      headers = Object.fromEntries(
        Object.entries(nextHeaders).map(([key, value]) => [key.toLowerCase(), value])
      );
      this.headersSent = true;
    },
    end(chunk) {
      serialized += chunk ?? "";
    },
    destroy() {}
  };
  await handler(request, response);
  return { status, headers, body: testJsonParse(serialized) };
}

test("supported synchronous create commits one row and audit event before returning a stable-authority projection", async () => {
  const api = await loadApi();
  assert.equal(typeof api.createPrivateMeetingSessionsApiHandler, "function");
  const directory = await mkdtemp(join(tmpdir(), "vibe-city-private-meeting-api-"));
  const databasePath = join(directory, "sessions.sqlite");
  try {
    const createState = authorityState("create_private_meeting_session");
    const repository = createPrivateMeetingSessionsRepository(databasePath);
    const server = await startServer(makeHandler(
      api.createPrivateMeetingSessionsApiHandler, repository, createState
    ));
    const created = await request(server, `/api/private/tenants/${TENANT_A}/meeting-sessions`, {
      method: "POST",
      body: createBody()
    });
    assert.equal(created.status, 201);
    assert.equal(created.headers["cache-control"], "private, no-store");
    assert.equal(created.headers.vary, "Authorization");
    assert.equal(created.body.session.revision, 1);
    assert.equal(created.body.session.lifecycle, "active");
    assert.equal(repository.readAuditHistory({
      kind: "trusted-server-context",
      authenticatedSubjectId: SUBJECT_A,
      activeTenantMembership: { tenantId: TENANT_A, subjectId: SUBJECT_A, active: true },
      actionGrants: ["read_private_meeting_session"],
      authorizationReference: AUTHORIZATION,
      policyRevision: 1
    }, { tenantId: TENANT_A, sessionId: SESSION_A }).events.length, 1);
    await closeServer(server);
    repository.close();

    const readState = authorityState("read_private_meeting_session");
    const reopened = createPrivateMeetingSessionsRepository(databasePath);
    const readServer = await startServer(makeHandler(
      api.createPrivateMeetingSessionsApiHandler, reopened, readState
    ));
    const read = await request(
      readServer,
      `/api/private/tenants/${TENANT_A}/meeting-sessions/${SESSION_A}`
    );
    assert.equal(read.status, 200);
    assert.deepEqual(read.body, created.body);
    await closeServer(readServer);
    reopened.close();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("supported synchronous end commits one transition and audit event before returning a stable-authority projection", async () => {
  const api = await loadApi();
  const directory = await mkdtemp(join(tmpdir(), "vibe-city-private-meeting-api-end-"));
  const databasePath = join(directory, "sessions.sqlite");
  try {
    const state = authorityState("create_private_meeting_session");
    const repository = createPrivateMeetingSessionsRepository(databasePath);
    const server = await startServer(makeHandler(
      api.createPrivateMeetingSessionsApiHandler, repository, state
    ));
    assert.equal((await request(server, `/api/private/tenants/${TENANT_A}/meeting-sessions`, {
      method: "POST",
      body: createBody()
    })).status, 201);

    setAuthority(state, "end_private_meeting_session", {
      subjectId: SUBJECT_B,
      authorizationReference: "syn-tenant-a--authorization-end",
      policyRevision: 2
    });
    const ended = await request(
      server,
      `/api/private/tenants/${TENANT_A}/meeting-sessions/${SESSION_A}/end`,
      { method: "POST", body: endBody() }
    );
    assert.equal(ended.status, 200);
    assert.equal(ended.body.session.revision, 2);
    assert.equal(ended.body.session.lifecycle, "ended");
    assert.equal(ended.body.session.createdBySubjectId, SUBJECT_A);
    assert.equal(ended.body.session.authorizationReference, AUTHORIZATION);
    assert.equal(ended.body.session.policyRevision, 1);
    assert.equal(ended.body.session.endedBySubjectId, SUBJECT_B);
    assert.equal(ended.body.session.endAuthorizationReference, "syn-tenant-a--authorization-end");
    assert.equal(ended.body.session.endPolicyRevision, 2);
    await closeServer(server);
    repository.close();

    const reopened = createPrivateMeetingSessionsRepository(databasePath);
    const readState = authorityState("read_private_meeting_session");
    const readServer = await startServer(makeHandler(
      api.createPrivateMeetingSessionsApiHandler, reopened, readState
    ));
    const direct = await request(
      readServer,
      `/api/private/tenants/${TENANT_A}/meeting-sessions/${SESSION_A}`
    );
    assert.deepEqual(direct.body, ended.body);
    setAuthority(readState, "read_private_meeting_session_history");
    const history = await request(
      readServer,
      `/api/private/tenants/${TENANT_A}/meeting-sessions/${SESSION_A}/history`
    );
    assert.equal(history.status, 200);
    assert.equal(history.body.events.length, 2);
    assert.deepEqual(history.body.events.map((event) => ({
      actorSubjectId: event.actorSubjectId,
      authorizationReference: event.authorizationReference,
      policyRevision: event.policyRevision
    })), [
      { actorSubjectId: SUBJECT_A, authorizationReference: AUTHORIZATION, policyRevision: 1 },
      {
        actorSubjectId: SUBJECT_B,
        authorizationReference: "syn-tenant-a--authorization-end",
        policyRevision: 2
      }
    ]);
    await closeServer(readServer);
    reopened.close();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("tenant route body and client authority substitutions deny identically without mutation or leakage", async () => {
  const api = await loadApi();
  const directory = await mkdtemp(join(tmpdir(), "vibe-city-private-meeting-api-scope-"));
  const databasePath = join(directory, "sessions.sqlite");
  let server;
  const repository = createPrivateMeetingSessionsRepository(databasePath);
  try {
    const state = authorityState("create_private_meeting_session");
    const handler = api.createPrivateMeetingSessionsApiHandler({
      repository,
      now: () => NOW,
      resolveTrustedSession: () => state.session,
      resolveTrustedMembership: () => state.membership,
      evaluatePolicy: ({ action, tenantId, sessionId, subjectId }) =>
        action === state.membership.actionGrants[0] && tenantId === TENANT_A &&
        sessionId === SESSION_A && subjectId === state.membership.subjectId
    });
    server = await startServer(handler);
    const created = await request(server, `/api/private/tenants/${TENANT_A}/meeting-sessions`, {
      method: "POST",
      body: createBody()
    });
    assert.equal(created.status, 201, "trusted policy must receive the proposed scoped session ID");

    const cases = [
      await request(server, `/api/private/tenants/${TENANT_B}/meeting-sessions`, {
        method: "POST",
        body: createBody({ sessionId: SESSION_B, sourceReference: "syn-tenant-b--source-b" })
      }),
      await request(server, `/api/private/tenants/${TENANT_A}/meeting-sessions`, {
        method: "POST",
        body: createBody({ sessionId: SESSION_B, sourceReference: "syn-tenant-a--source-foreign-session" })
      }),
      await request(server, `/api/private/tenants/${TENANT_A}/meeting-sessions`, {
        method: "POST",
        body: createBody({
          sessionId: "syn-tenant-a--session-client-authority",
          sourceReference: "syn-tenant-a--source-client-authority",
          tenantId: TENANT_A,
          actorSubjectId: SUBJECT_A,
          actionGrants: ["create_private_meeting_session"],
          authorizationReference: AUTHORIZATION,
          policyRevision: 1
        })
      }),
      await request(server, `/api/private/tenants/${TENANT_A}/meeting-sessions/${SESSION_B}`)
    ];
    for (const denied of cases) {
      assert.equal(denied.status, 404);
      assert.equal(denied.headers["cache-control"], "private, no-store");
      assert.equal(denied.headers.vary, "Authorization");
      assert.deepEqual(denied.body, { error: "not_found" });
    }
    setAuthority(state, "read_private_meeting_session_history");
    const history = await request(server, `/api/private/tenants/${TENANT_A}/meeting-sessions/${SESSION_A}/history`);
    assert.equal(history.body.events.length, 1);
    const serialized = JSON.stringify(cases);
    assert.equal(serialized.includes(TENANT_B), false);
    assert.equal(serialized.includes(SESSION_B), false);
    assert.equal(serialized.includes("client-authority"), false);
  } finally {
    if (server) await closeServer(server);
    repository.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("mid-request policy revocation denies before create with zero durable mutation", async () => {
  const api = await loadApi();
  const directory = await mkdtemp(join(tmpdir(), "vibe-city-private-meeting-api-revoke-"));
  const databasePath = join(directory, "sessions.sqlite");
  const repository = createPrivateMeetingSessionsRepository(databasePath);
  let server;
  try {
    const state = authorityState("create_private_meeting_session");
    let policyReads = 0;
    const handler = api.createPrivateMeetingSessionsApiHandler({
      repository,
      now: () => NOW,
      resolveTrustedSession: () => state.session,
      resolveTrustedMembership: () => state.membership,
      evaluatePolicy() {
        policyReads += 1;
        if (policyReads === 2) {
          state.membership.active = false;
          return false;
        }
        return true;
      }
    });
    server = await startServer(handler);
    const denied = await request(server, `/api/private/tenants/${TENANT_A}/meeting-sessions`, {
      method: "POST",
      body: createBody()
    });
    assert.equal(denied.status, 404);
    assert.deepEqual(denied.body, { error: "not_found" });
    assert.equal(policyReads, 2);

    state.membership.active = true;
    policyReads = 10;
    const created = await request(server, `/api/private/tenants/${TENANT_A}/meeting-sessions`, {
      method: "POST",
      body: createBody()
    });
    assert.equal(created.status, 201, "revoked request must not have inserted a row or audit event");
    setAuthority(state, "read_private_meeting_session_history");
    const history = await request(server, `/api/private/tenants/${TENANT_A}/meeting-sessions/${SESSION_A}/history`);
    assert.equal(history.status, 200);
    assert.equal(history.body.events.length, 1);
  } finally {
    if (server) await closeServer(server);
    repository.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("captured validation intrinsics preserve authorized create after post-import replacement", async () => {
  const api = await loadApi();
  const directory = await mkdtemp(join(tmpdir(), "vibe-city-private-meeting-api-intrinsics-"));
  const databasePath = join(directory, "sessions.sqlite");
  const repository = createPrivateMeetingSessionsRepository(databasePath);
  const state = authorityState("create_private_meeting_session");
  const handler = makeHandler(api.createPrivateMeetingSessionsApiHandler, repository, state);
  const payload = JSON.stringify(createBody());
  const originals = {
    arrayPush: Array.prototype.push,
    Date: globalThis.Date,
    Number: globalThis.Number,
    descriptors: Object.getOwnPropertyDescriptors,
    freeze: Object.freeze,
    prototype: Object.getPrototypeOf,
    ownKeys: Reflect.ownKeys,
    parse: JSON.parse,
    stringify: JSON.stringify,
    test: RegExp.prototype.test,
    charCodeAt: String.prototype.charCodeAt,
    includes: String.prototype.includes,
    slice: String.prototype.slice,
    toLowerCase: String.prototype.toLowerCase
  };
  let result;
  try {
    Array.prototype.push = () => { throw new Error("replaced array push"); };
    globalThis.Date = class ForgedDate {};
    globalThis.Number = () => 0;
    Object.getOwnPropertyDescriptors = () => { throw new Error("replaced descriptors"); };
    Object.freeze = (value) => value;
    Object.getPrototypeOf = () => null;
    Reflect.ownKeys = () => [];
    JSON.parse = () => { throw new Error("replaced parse"); };
    JSON.stringify = () => { throw new Error("replaced stringify"); };
    RegExp.prototype.test = () => false;
    String.prototype.charCodeAt = () => 0;
    String.prototype.includes = () => true;
    String.prototype.slice = () => "forged";
    String.prototype.toLowerCase = () => "forged";
    result = await directRequest(handler, {
      method: "POST",
      path: `/api/private/tenants/${TENANT_A}/meeting-sessions`,
      payload
    });
  } finally {
    Array.prototype.push = originals.arrayPush;
    globalThis.Date = originals.Date;
    globalThis.Number = originals.Number;
    Object.getOwnPropertyDescriptors = originals.descriptors;
    Object.freeze = originals.freeze;
    Object.getPrototypeOf = originals.prototype;
    Reflect.ownKeys = originals.ownKeys;
    JSON.parse = originals.parse;
    JSON.stringify = originals.stringify;
    RegExp.prototype.test = originals.test;
    String.prototype.charCodeAt = originals.charCodeAt;
    String.prototype.includes = originals.includes;
    String.prototype.slice = originals.slice;
    String.prototype.toLowerCase = originals.toLowerCase;
  }
  try {
    assert.equal(result.status, 201);
    assert.equal(result.body.session.revision, 1);
  } finally {
    repository.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("trusted clock rollback between authorization checks denies direct read without leakage", async () => {
  const api = await loadApi();
  const directory = await mkdtemp(join(tmpdir(), "vibe-city-private-meeting-api-clock-"));
  const databasePath = join(directory, "sessions.sqlite");
  const repository = createPrivateMeetingSessionsRepository(databasePath);
  try {
    assert.equal(repository.createSession({
      kind: "trusted-server-context",
      authenticatedSubjectId: SUBJECT_A,
      activeTenantMembership: { tenantId: TENANT_A, subjectId: SUBJECT_A, active: true },
      actionGrants: ["create_private_meeting_session"],
      authorizationReference: AUTHORIZATION,
      policyRevision: 1
    }, { tenantId: TENANT_A, ...createBody() }).ok, true);
    const state = authorityState("read_private_meeting_session");
    let clockReads = 0;
    const handler = api.createPrivateMeetingSessionsApiHandler({
      repository,
      now() {
        clockReads += 1;
        return clockReads === 1 ? NOW : "2000-01-01T00:01:00.000Z";
      },
      resolveTrustedSession: () => state.session,
      resolveTrustedMembership: () => state.membership,
      evaluatePolicy: () => true
    });
    const denied = await directRequest(handler, {
      method: "GET",
      path: `/api/private/tenants/${TENANT_A}/meeting-sessions/${SESSION_A}`
    });
    assert.equal(denied.status, 404);
    assert.deepEqual(denied.body, { error: "not_found" });
    assert.equal(clockReads, 2);
    assert.equal(JSON.stringify(denied).includes(SESSION_A), false);
  } finally {
    repository.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("action grants remain exact and participant membership never substitutes end authority", async () => {
  const api = await loadApi();
  const directory = await mkdtemp(join(tmpdir(), "vibe-city-private-meeting-api-grants-"));
  const databasePath = join(directory, "sessions.sqlite");
  const repository = createPrivateMeetingSessionsRepository(databasePath);
  let server;
  try {
    assert.equal(repository.createSession({
      kind: "trusted-server-context",
      authenticatedSubjectId: SUBJECT_A,
      activeTenantMembership: { tenantId: TENANT_A, subjectId: SUBJECT_A, active: true },
      actionGrants: ["create_private_meeting_session"],
      authorizationReference: AUTHORIZATION,
      policyRevision: 1
    }, { tenantId: TENANT_A, ...createBody() }).ok, true);
    const state = authorityState("read_private_meeting_session");
    server = await startServer(makeHandler(api.createPrivateMeetingSessionsApiHandler, repository, state));
    const read = await request(server, `/api/private/tenants/${TENANT_A}/meeting-sessions/${SESSION_A}`);
    assert.equal(read.status, 200);
    const denied = [
      await request(server, `/api/private/tenants/${TENANT_A}/meeting-sessions`, {
        method: "POST",
        body: createBody({
          sessionId: "syn-tenant-a--session-read-cannot-create",
          sourceReference: "syn-tenant-a--source-read-cannot-create"
        })
      }),
      await request(server, `/api/private/tenants/${TENANT_A}/meeting-sessions/${SESSION_A}/history`),
      await request(server, `/api/private/tenants/${TENANT_A}/meeting-sessions/${SESSION_A}/end`, {
        method: "POST",
        body: endBody()
      })
    ];
    setAuthority(state, "end_private_meeting_session", {
      subjectId: "syn-tenant-a--subject-outsider",
      authorizationReference: "syn-tenant-a--authorization-outsider",
      policyRevision: 2
    });
    denied.push(await request(server, `/api/private/tenants/${TENANT_A}/meeting-sessions/${SESSION_A}/end`, {
      method: "POST",
      body: endBody()
    }));
    for (const result of denied) assert.deepEqual(result.body, { error: "not_found" });
    setAuthority(state, "read_private_meeting_session_history");
    const history = await request(server, `/api/private/tenants/${TENANT_A}/meeting-sessions/${SESSION_A}/history`);
    assert.equal(history.status, 200);
    assert.equal(history.body.events.length, 1);
  } finally {
    if (server) await closeServer(server);
    repository.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("header body parser revision and unsupported path failures share one non-mutating denial", async () => {
  const api = await loadApi();
  const directory = await mkdtemp(join(tmpdir(), "vibe-city-private-meeting-api-parser-"));
  const databasePath = join(directory, "sessions.sqlite");
  const repository = createPrivateMeetingSessionsRepository(databasePath);
  try {
    const state = authorityState("create_private_meeting_session");
    const handler = makeHandler(api.createPrivateMeetingSessionsApiHandler, repository, state);
    const valid = JSON.stringify(createBody());
    const duplicate = valid.replace("{", `{"sessionId":"${SESSION_A}",`);
    const negativeZero = valid.replace('"expectedRevision":0', '"expectedRevision":-0');
    const postPath = `/api/private/tenants/${TENANT_A}/meeting-sessions`;
    const getPath = `/api/private/tenants/${TENANT_A}/meeting-sessions/${SESSION_A}`;
    const postHeaders = [
      "Authorization", BEARER,
      "Content-Type", "application/json",
      "Content-Length", String(Buffer.byteLength(valid))
    ];
    const cases = [
      await directRequest(handler, { method: "POST", path: postPath, payload: duplicate }),
      await directRequest(handler, { method: "POST", path: postPath, payload: "{" }),
      await directRequest(handler, {
        method: "POST", path: postPath, payload: JSON.stringify(createBody({ unknown: true }))
      }),
      await directRequest(handler, { method: "POST", path: postPath, payload: negativeZero }),
      await directRequest(handler, { method: "POST", path: postPath, payload: valid, aborted: true }),
      await directRequest(handler, { method: "POST", path: postPath, payload: `{"padding":"${"x".repeat(17_000)}"}` }),
      await directRequest(handler, {
        method: "POST", path: postPath, payload: valid,
        rawHeaders: [...postHeaders, "Authorization", BEARER]
      }),
      await directRequest(handler, {
        method: "POST", path: postPath, payload: valid,
        rawHeaders: ["Authorization", "Basic synthetic", ...postHeaders.slice(2)]
      }),
      await directRequest(handler, {
        method: "POST", path: postPath, payload: valid,
        rawHeaders: [...postHeaders, "Transfer-Encoding", "chunked"]
      }),
      await directRequest(handler, {
        method: "POST", path: postPath, payload: valid,
        rawHeaders: [...postHeaders, "Content-Length", String(Buffer.byteLength(valid))]
      }),
      await directRequest(handler, { method: "GET", path: `${getPath}?history=true` }),
      await directRequest(handler, { method: "GET", path: `${getPath}#history` }),
      await directRequest(handler, { method: "DELETE", path: getPath }),
      await directRequest(handler, { method: "GET", path: `${postPath}/search` }),
      await directRequest(handler, { method: "GET", path: `${postPath}/batch` }),
      await directRequest(handler, {
        method: "GET", path: getPath,
        rawHeaders: new Proxy(["Authorization", BEARER], {})
      })
    ];
    for (const result of cases) {
      assert.equal(result.status, 404);
      assert.equal(result.headers["cache-control"], "private, no-store");
      assert.equal(result.headers.vary, "Authorization");
      assert.deepEqual(result.body, { error: "not_found" });
      assert.equal(JSON.stringify(result).includes("padding"), false);
      assert.equal(JSON.stringify(result).includes("synthetic"), false);
    }
    const created = await directRequest(handler, { method: "POST", path: postPath, payload: valid });
    assert.equal(created.status, 201, "all denied parser cases must leave row and audit state empty");
    setAuthority(state, "read_private_meeting_session_history");
    const history = await directRequest(handler, { method: "GET", path: `${getPath}/history` });
    assert.equal(history.status, 200);
    assert.equal(history.body.events.length, 1);
  } finally {
    repository.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("accessor-backed repository results deny without evaluation or private-field leakage", async () => {
  const api = await loadApi();
  const state = authorityState("read_private_meeting_session");
  let accessorReads = 0;
  const result = { ok: true };
  Object.defineProperty(result, "session", {
    enumerable: true,
    get() {
      accessorReads += 1;
      return { tenantId: TENANT_B, storagePath: "/private/sessions.sqlite" };
    }
  });
  const repository = {
    createSession: () => ({ ok: false }),
    endWithNoDecision: () => ({ ok: false }),
    readAuditHistory: () => ({ ok: false }),
    readSession: () => result
  };
  const handler = makeHandler(api.createPrivateMeetingSessionsApiHandler, repository, state);
  const denied = await directRequest(handler, {
    method: "GET",
    path: `/api/private/tenants/${TENANT_A}/meeting-sessions/${SESSION_A}`
  });
  assert.equal(denied.status, 404);
  assert.deepEqual(denied.body, { error: "not_found" });
  assert.equal(accessorReads, 0);
  assert.equal(JSON.stringify(denied).includes(TENANT_B), false);
  assert.equal(JSON.stringify(denied).includes("sessions.sqlite"), false);
});

test("unknown repository response fields deny instead of expanding the private schema", async () => {
  const api = await loadApi();
  const state = authorityState("read_private_meeting_session");
  const repository = {
    createSession: () => ({ ok: false }),
    endWithNoDecision: () => ({ ok: false }),
    readAuditHistory: () => ({ ok: false }),
    readSession: () => ({
      ok: true,
      session: {
        tenantId: TENANT_A,
        sessionId: SESSION_A,
        storagePath: "/private/sessions.sqlite"
      }
    })
  };
  const handler = makeHandler(api.createPrivateMeetingSessionsApiHandler, repository, state);
  const denied = await directRequest(handler, {
    method: "GET",
    path: `/api/private/tenants/${TENANT_A}/meeting-sessions/${SESSION_A}`
  });
  assert.equal(denied.status, 404);
  assert.deepEqual(denied.body, { error: "not_found" });
  assert.equal(JSON.stringify(denied).includes("storagePath"), false);
  assert.equal(JSON.stringify(denied).includes("sessions.sqlite"), false);
});

test("repository-time membership revocation denies direct read before private serialization", async () => {
  const api = await loadApi();
  const directory = await mkdtemp(join(tmpdir(), "vibe-city-private-meeting-api-final-read-auth-"));
  const databasePath = join(directory, "sessions.sqlite");
  const durableRepository = createPrivateMeetingSessionsRepository(databasePath);
  try {
    const createContext = {
      kind: "trusted-server-context",
      authenticatedSubjectId: SUBJECT_A,
      activeTenantMembership: { tenantId: TENANT_A, subjectId: SUBJECT_A, active: true },
      actionGrants: ["create_private_meeting_session"],
      authorizationReference: AUTHORIZATION,
      policyRevision: 1
    };
    assert.equal(durableRepository.createSession(
      createContext,
      { tenantId: TENANT_A, ...createBody() }
    ).ok, true);
    const readContext = { ...createContext, actionGrants: ["read_private_meeting_session"] };
    const before = durableRepository.readAuditHistory(
      readContext,
      { tenantId: TENANT_A, sessionId: SESSION_A }
    );
    const state = authorityState("read_private_meeting_session");
    let readCalls = 0;
    const repository = {
      createSession: (...args) => durableRepository.createSession(...args),
      endWithNoDecision: (...args) => durableRepository.endWithNoDecision(...args),
      readAuditHistory: (...args) => durableRepository.readAuditHistory(...args),
      readSession(...args) {
        readCalls += 1;
        const result = durableRepository.readSession(...args);
        state.membership.active = false;
        return result;
      }
    };
    const handler = makeHandler(api.createPrivateMeetingSessionsApiHandler, repository, state);
    const denied = await directRequest(handler, {
      method: "GET",
      path: `/api/private/tenants/${TENANT_A}/meeting-sessions/${SESSION_A}`
    });
    assert.equal(denied.status, 404);
    assert.equal(denied.headers["cache-control"], "private, no-store");
    assert.deepEqual(denied.body, { error: "not_found" });
    assert.equal(JSON.stringify(denied).includes(SESSION_A), false);
    assert.equal(readCalls, 1);
    assert.deepEqual(durableRepository.readAuditHistory(
      readContext,
      { tenantId: TENANT_A, sessionId: SESSION_A }
    ), before);
  } finally {
    durableRepository.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("post-import Buffer toString replacement cannot forge malformed create wire bytes", async () => {
  const api = await loadApi();
  const directory = await mkdtemp(join(tmpdir(), "vibe-city-private-meeting-api-buffer-decode-"));
  const databasePath = join(directory, "sessions.sqlite");
  const durableRepository = createPrivateMeetingSessionsRepository(databasePath);
  const originalToString = Buffer.prototype.toString;
  try {
    let mutationCalls = 0;
    const repository = {
      createSession(...args) {
        mutationCalls += 1;
        return durableRepository.createSession(...args);
      },
      endWithNoDecision: (...args) => durableRepository.endWithNoDecision(...args),
      readAuditHistory: (...args) => durableRepository.readAuditHistory(...args),
      readSession: (...args) => durableRepository.readSession(...args)
    };
    const state = authorityState("create_private_meeting_session");
    const handler = makeHandler(api.createPrivateMeetingSessionsApiHandler, repository, state);
    const forgedBody = JSON.stringify(createBody());
    let denied;
    try {
      Buffer.prototype.toString = () => forgedBody;
      denied = await directRequest(handler, {
        method: "POST",
        path: `/api/private/tenants/${TENANT_A}/meeting-sessions`,
        payload: "{}"
      });
    } finally {
      Buffer.prototype.toString = originalToString;
    }
    assert.equal(denied.status, 404);
    assert.equal(denied.headers["cache-control"], "private, no-store");
    assert.deepEqual(denied.body, { error: "not_found" });
    assert.equal(mutationCalls, 0);

    const context = {
      kind: "trusted-server-context",
      authenticatedSubjectId: SUBJECT_A,
      activeTenantMembership: { tenantId: TENANT_A, subjectId: SUBJECT_A, active: true },
      actionGrants: ["create_private_meeting_session"],
      authorizationReference: AUTHORIZATION,
      policyRevision: 1
    };
    assert.equal(durableRepository.createSession(
      context,
      { tenantId: TENANT_A, ...createBody() }
    ).ok, true, "denied malformed bytes must not insert a session or audit event");
    const history = durableRepository.readAuditHistory(
      { ...context, actionGrants: ["read_private_meeting_session"] },
      { tenantId: TENANT_A, sessionId: SESSION_A }
    );
    assert.equal(history.events.length, 1);
  } finally {
    Buffer.prototype.toString = originalToString;
    durableRepository.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("async history revocation reaches final authorization before private serialization", async () => {
  const api = await loadApi();
  const directory = await mkdtemp(join(tmpdir(), "vibe-city-private-meeting-api-final-history-auth-"));
  const databasePath = join(directory, "sessions.sqlite");
  const durableRepository = createPrivateMeetingSessionsRepository(databasePath);
  try {
    const createContext = {
      kind: "trusted-server-context",
      authenticatedSubjectId: SUBJECT_A,
      activeTenantMembership: { tenantId: TENANT_A, subjectId: SUBJECT_A, active: true },
      actionGrants: ["create_private_meeting_session"],
      authorizationReference: AUTHORIZATION,
      policyRevision: 1
    };
    assert.equal(durableRepository.createSession(
      createContext,
      { tenantId: TENANT_A, ...createBody() }
    ).ok, true);
    const state = authorityState("read_private_meeting_session_history");
    let sessionReads = 0;
    let historyReads = 0;
    const repository = {
      createSession: (...args) => durableRepository.createSession(...args),
      endWithNoDecision: (...args) => durableRepository.endWithNoDecision(...args),
      readSession: (...args) => durableRepository.readSession(...args),
      async readAuditHistory(...args) {
        historyReads += 1;
        state.membership.active = false;
        await Promise.resolve();
        return durableRepository.readAuditHistory(...args);
      }
    };
    const handler = api.createPrivateMeetingSessionsApiHandler({
      repository,
      now: () => NOW,
      resolveTrustedSession() {
        sessionReads += 1;
        return state.session;
      },
      resolveTrustedMembership: () => state.membership,
      evaluatePolicy: () => true
    });
    const denied = await directRequest(handler, {
      method: "GET",
      path: `/api/private/tenants/${TENANT_A}/meeting-sessions/${SESSION_A}/history`
    });
    assert.equal(denied.status, 404);
    assert.deepEqual(denied.body, { error: "not_found" });
    assert.equal(JSON.stringify(denied).includes(SESSION_A), false);
    assert.equal(historyReads, 1);
    assert.equal(sessionReads, 5, "final authorization must run after the async repository result resolves");
    assert.equal(durableRepository.readAuditHistory(
      { ...createContext, actionGrants: ["read_private_meeting_session"] },
      { tenantId: TENANT_A, sessionId: SESSION_A }
    ).events.length, 1);
  } finally {
    durableRepository.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("create rejects an async mutator result because the repository contract is synchronous atomic", async () => {
  const api = await loadApi();
  const state = authorityState("create_private_meeting_session");
  let createEntries = 0;
  const repository = {
    async createSession() {
      createEntries += 1;
      await Promise.resolve();
      return {
        ok: true,
        session: {
          privacy: "tenant-private",
          tenantId: TENANT_A,
          sessionId: SESSION_A,
          revision: 1,
          purposeReference: "syn-tenant-a--purpose-a",
          participantSubjectIds: [SUBJECT_A, SUBJECT_B],
          materialReferences: ["syn-tenant-a--material-a", "syn-tenant-a--material-b"],
          startedAt: STARTED_AT,
          endedAt: null,
          lifecycle: "active",
          outcome: null,
          sourceReference: "syn-tenant-a--source-a",
          createdBySubjectId: SUBJECT_A,
          authorizationReference: AUTHORIZATION,
          policyRevision: 1
        }
      };
    },
    readSession: () => ({ ok: false }),
    readAuditHistory: () => ({ ok: false }),
    endWithNoDecision: () => ({ ok: false })
  };
  const handler = api.createPrivateMeetingSessionsApiHandler({
    repository,
    now: () => NOW,
    resolveTrustedSession: () => state.session,
    resolveTrustedMembership: () => state.membership,
    evaluatePolicy: () => true
  });
  const denied = await directRequest(handler, {
    method: "POST",
    path: `/api/private/tenants/${TENANT_A}/meeting-sessions`,
    payload: JSON.stringify(createBody())
  });
  assert.equal(denied.status, 404);
  assert.deepEqual(denied.body, { error: "not_found" });
  assert.equal(JSON.stringify(denied).includes(SESSION_A), false);
  assert.equal(createEntries, 1);
});

test("end rejects an async mutator result because the repository contract is synchronous atomic", async () => {
  const api = await loadApi();
  const state = authorityState("end_private_meeting_session");
  let endEntries = 0;
  const repository = {
    createSession: () => ({ ok: false }),
    readSession: () => ({ ok: false }),
    readAuditHistory: () => ({ ok: false }),
    async endWithNoDecision() {
      endEntries += 1;
      await Promise.resolve();
      return {
        ok: true,
        session: {
          privacy: "tenant-private",
          tenantId: TENANT_A,
          sessionId: SESSION_A,
          revision: 2,
          purposeReference: "syn-tenant-a--purpose-a",
          participantSubjectIds: [SUBJECT_A, SUBJECT_B],
          materialReferences: ["syn-tenant-a--material-a", "syn-tenant-a--material-b"],
          startedAt: STARTED_AT,
          endedAt: ENDED_AT,
          lifecycle: "ended",
          outcome: {
            resultState: "no-decision",
            outcomeReference: "syn-tenant-a--no-decision-a"
          },
          sourceReference: "syn-tenant-a--source-a",
          createdBySubjectId: SUBJECT_A,
          authorizationReference: AUTHORIZATION,
          policyRevision: 1,
          endedBySubjectId: SUBJECT_A,
          endAuthorizationReference: AUTHORIZATION,
          endPolicyRevision: 1
        }
      };
    }
  };
  const handler = api.createPrivateMeetingSessionsApiHandler({
    repository,
    now: () => NOW,
    resolveTrustedSession: () => state.session,
    resolveTrustedMembership: () => state.membership,
    evaluatePolicy: () => true
  });
  const denied = await directRequest(handler, {
    method: "POST",
    path: `/api/private/tenants/${TENANT_A}/meeting-sessions/${SESSION_A}/end`,
    payload: JSON.stringify(endBody())
  });
  assert.equal(denied.status, 404);
  assert.deepEqual(denied.body, { error: "not_found" });
  assert.equal(JSON.stringify(denied).includes(SESSION_A), false);
  assert.equal(endEntries, 1);
});

test("create rejects an inherited then getter without invoking it", async () => {
  const api = await loadApi();
  const state = authorityState("create_private_meeting_session");
  let repositoryResult;
  let resultThenReads = 0;
  const repository = {
    createSession() {
      repositoryResult = {
        ok: true,
        session: {
          privacy: "tenant-private",
          tenantId: TENANT_A,
          sessionId: SESSION_A,
          revision: 1,
          purposeReference: "syn-tenant-a--purpose-a",
          participantSubjectIds: [SUBJECT_A, SUBJECT_B],
          materialReferences: ["syn-tenant-a--material-a", "syn-tenant-a--material-b"],
          startedAt: STARTED_AT,
          endedAt: null,
          lifecycle: "active",
          outcome: null,
          sourceReference: "syn-tenant-a--source-a",
          createdBySubjectId: SUBJECT_A,
          authorizationReference: AUTHORIZATION,
          policyRevision: 1
        }
      };
      return repositoryResult;
    },
    readSession: () => ({ ok: false }),
    readAuditHistory: () => ({ ok: false }),
    endWithNoDecision: () => ({ ok: false })
  };
  const handler = api.createPrivateMeetingSessionsApiHandler({
    repository,
    now: () => NOW,
    resolveTrustedSession: () => state.session,
    resolveTrustedMembership: () => state.membership,
    evaluatePolicy: () => true
  });
  const priorGetOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
  const priorThen = priorGetOwnPropertyDescriptor(Object.prototype, "then");
  let denied;
  try {
    Object.defineProperty(Object.prototype, "then", {
      configurable: true,
      enumerable: false,
      get() {
        if (this === repositoryResult) {
          resultThenReads += 1;
          return () => {};
        }
        return undefined;
      }
    });
    Object.getOwnPropertyDescriptor = () => undefined;
    denied = await directRequest(handler, {
      method: "POST",
      path: `/api/private/tenants/${TENANT_A}/meeting-sessions`,
      payload: JSON.stringify(createBody())
    });
  } finally {
    Object.getOwnPropertyDescriptor = priorGetOwnPropertyDescriptor;
    if (priorThen === undefined) delete Object.prototype.then;
    else Object.defineProperty(Object.prototype, "then", priorThen);
  }
  assert.equal(denied.status, 404);
  assert.deepEqual(denied.body, { error: "not_found" });
  assert.equal(JSON.stringify(denied).includes(SESSION_A), false);
  assert.equal(resultThenReads, 0);
});

test("end rejects an inherited then getter without invoking it", async () => {
  const api = await loadApi();
  const state = authorityState("end_private_meeting_session");
  let repositoryResult;
  let resultThenReads = 0;
  const repository = {
    createSession: () => ({ ok: false }),
    readSession: () => ({ ok: false }),
    readAuditHistory: () => ({ ok: false }),
    endWithNoDecision() {
      repositoryResult = {
        ok: true,
        session: {
          privacy: "tenant-private",
          tenantId: TENANT_A,
          sessionId: SESSION_A,
          revision: 2,
          purposeReference: "syn-tenant-a--purpose-a",
          participantSubjectIds: [SUBJECT_A, SUBJECT_B],
          materialReferences: ["syn-tenant-a--material-a", "syn-tenant-a--material-b"],
          startedAt: STARTED_AT,
          endedAt: ENDED_AT,
          lifecycle: "ended",
          outcome: {
            resultState: "no-decision",
            outcomeReference: "syn-tenant-a--no-decision-a"
          },
          sourceReference: "syn-tenant-a--source-a",
          createdBySubjectId: SUBJECT_A,
          authorizationReference: AUTHORIZATION,
          policyRevision: 1,
          endedBySubjectId: SUBJECT_A,
          endAuthorizationReference: AUTHORIZATION,
          endPolicyRevision: 1
        }
      };
      return repositoryResult;
    }
  };
  const handler = api.createPrivateMeetingSessionsApiHandler({
    repository,
    now: () => NOW,
    resolveTrustedSession: () => state.session,
    resolveTrustedMembership: () => state.membership,
    evaluatePolicy: () => true
  });
  const priorThen = Object.getOwnPropertyDescriptor(Object.prototype, "then");
  try {
    Object.defineProperty(Object.prototype, "then", {
      configurable: true,
      enumerable: false,
      get() {
        if (this === repositoryResult) {
          resultThenReads += 1;
          return () => {};
        }
        return undefined;
      }
    });
    const denied = await directRequest(handler, {
      method: "POST",
      path: `/api/private/tenants/${TENANT_A}/meeting-sessions/${SESSION_A}/end`,
      payload: JSON.stringify(endBody())
    });
    assert.equal(denied.status, 404);
    assert.deepEqual(denied.body, { error: "not_found" });
    assert.equal(JSON.stringify(denied).includes(SESSION_A), false);
    assert.equal(resultThenReads, 0);
  } finally {
    if (priorThen === undefined) delete Object.prototype.then;
    else Object.defineProperty(Object.prototype, "then", priorThen);
  }
});
