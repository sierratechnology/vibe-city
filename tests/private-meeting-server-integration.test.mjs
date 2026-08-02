import assert from "node:assert/strict";
import { access, mkdtemp, rm } from "node:fs/promises";
import http from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { startWorkRecordsServer } from "../server/index.mjs";

const TENANT = "syn-tenant-server";
const SESSION = "syn-tenant-server--session-a";
const SUBJECT = "syn-tenant-server--subject-a";
const AUTHORIZATION = "syn-tenant-server--authorization-a";
const NOW = "2000-01-01T00:02:00.000Z";

function request(server, path, { method = "GET", body, headers = {} } = {}) {
  const payload = body === undefined ? undefined : JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const outgoing = http.request({
      host: server.host,
      port: server.port,
      path,
      method,
      headers: {
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
        body: Buffer.concat(chunks).toString("utf8")
      }));
    });
    outgoing.on("error", reject);
    outgoing.end(payload);
  });
}

test("private meeting routes fail closed when meeting composition is absent", async () => {
  const directory = await mkdtemp(join(tmpdir(), "vibe-city-meeting-server-absent-"));
  let server;
  try {
    server = await startWorkRecordsServer({
      development: true,
      port: 0,
      databasePath: join(directory, "work-records.sqlite")
    });

    const response = await request(
      server,
      `/api/private/tenants/${TENANT}/meeting-sessions/${SESSION}`
    );

    assert.equal(response.status, 404);
    assert.equal(response.headers["cache-control"], "private, no-store");
    assert.equal(response.headers.vary, "Authorization");
    assert.equal(response.headers["content-type"], "application/json; charset=utf-8");
    assert.deepEqual(JSON.parse(response.body), { error: "not_found" });
  } finally {
    if (server) await server.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("malformed private meeting namespace paths never fall through to the SPA", async () => {
  const directory = await mkdtemp(join(tmpdir(), "vibe-city-meeting-server-namespace-"));
  let server;
  try {
    server = await startWorkRecordsServer({
      development: true,
      port: 0,
      databasePath: join(directory, "work-records.sqlite")
    });

    const paths = [
      `/api/private/tenants/${TENANT}/meeting-sessions/`,
      `/api/private/tenants/${TENANT}/meeting-sessions/${SESSION}/unknown`,
      `/api/private/tenants/${TENANT}/meeting-sessions/${SESSION}/history/extra`
    ];
    for (const path of paths) {
      const response = await request(server, path);
      assert.equal(response.status, 404, path);
      assert.equal(response.headers["cache-control"], "private, no-store", path);
      assert.equal(response.headers.vary, "Authorization", path);
      assert.equal(response.headers["content-type"], "application/json; charset=utf-8", path);
      assert.doesNotMatch(response.body, /<html/i, path);
      assert.deepEqual(JSON.parse(response.body), { error: "not_found" }, path);
    }
  } finally {
    if (server) await server.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("encoded private meeting namespace separators never fall through to the SPA", async () => {
  const directory = await mkdtemp(join(tmpdir(), "vibe-city-meeting-server-encoded-namespace-"));
  let server;
  try {
    server = await startWorkRecordsServer({
      development: true,
      port: 0,
      databasePath: join(directory, "work-records.sqlite")
    });

    const paths = [
      `/api/private/tenants/${TENANT}/meeting-sessions%2F`,
      `/api/private/tenants/${TENANT}/meeting-sessions%2fchild`,
      `/api/private/tenants/${TENANT}/meeting-sessions%2Fchild/extra`
    ];
    for (const path of paths) {
      const response = await request(server, path);
      assert.equal(response.status, 404, path);
      assert.equal(response.headers["cache-control"], "private, no-store", path);
      assert.equal(response.headers.vary, "Authorization", path);
      assert.equal(response.headers["content-type"], "application/json; charset=utf-8", path);
      assert.doesNotMatch(response.body, /<html/i, path);
      assert.deepEqual(JSON.parse(response.body), { error: "not_found" }, path);
    }
  } finally {
    if (server) await server.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("composed private meeting routes create read and persist one synthetic session", async () => {
  const directory = await mkdtemp(join(tmpdir(), "vibe-city-meeting-server-composed-"));
  const meetingDatabasePath = join(directory, "meeting-sessions.sqlite");
  const authority = {
    action: "create_private_meeting_session",
    session: { authenticated: true, sessionId: "synthetic-server-session", subjectId: SUBJECT }
  };
  let server;
  try {
    server = await startWorkRecordsServer({
      development: true,
      port: 0,
      databasePath: join(directory, "work-records.sqlite"),
      meetingSessions: {
        databasePath: meetingDatabasePath,
        now: () => NOW,
        resolveTrustedSession(request) {
          return request.headers.authorization === "Bearer synthetic-server-active"
            ? authority.session
            : null;
        },
        resolveTrustedMembership({ session }) {
          assert.equal(session, authority.session);
          return {
            active: true,
            tenantId: TENANT,
            subjectId: SUBJECT,
            actionGrants: [authority.action],
            authorizationReference: AUTHORIZATION,
            policyRevision: 1
          };
        },
        evaluatePolicy({ action, tenantId, sessionId, subjectId }) {
          return action === authority.action && tenantId === TENANT &&
            sessionId === SESSION && subjectId === SUBJECT;
        }
      }
    });

    const createBody = {
      sessionId: SESSION,
      purposeReference: "syn-tenant-server--purpose-a",
      participantSubjectIds: [SUBJECT],
      materialReferences: ["syn-tenant-server--material-a"],
      startedAt: "2000-01-01T00:01:30.000Z",
      sourceReference: "syn-tenant-server--source-a",
      expectedRevision: 0
    };
    const expectedSession = {
      privacy: "tenant-private",
      tenantId: TENANT,
      sessionId: SESSION,
      revision: 1,
      purposeReference: createBody.purposeReference,
      participantSubjectIds: createBody.participantSubjectIds,
      materialReferences: createBody.materialReferences,
      startedAt: createBody.startedAt,
      endedAt: null,
      lifecycle: "active",
      outcome: null,
      sourceReference: createBody.sourceReference,
      createdBySubjectId: SUBJECT,
      authorizationReference: AUTHORIZATION,
      policyRevision: 1
    };
    const created = await request(server, `/api/private/tenants/${TENANT}/meeting-sessions`, {
      method: "POST",
      body: createBody,
      headers: { authorization: "Bearer synthetic-server-active" }
    });
    assert.equal(created.status, 201);
    assert.equal(created.headers["cache-control"], "private, no-store");
    assert.deepEqual(JSON.parse(created.body), { session: expectedSession });

    const database = new DatabaseSync(meetingDatabasePath, { readOnly: true });
    assert.equal(database.prepare("SELECT count(*) AS count FROM private_meeting_sessions").get().count, 1);
    assert.equal(database.prepare("SELECT count(*) AS count FROM private_meeting_session_audit_events").get().count, 1);
    database.close();

    authority.action = "read_private_meeting_session";
    const read = await request(
      server,
      `/api/private/tenants/${TENANT}/meeting-sessions/${SESSION}`,
      { headers: { authorization: "Bearer synthetic-server-active" } }
    );
    assert.equal(read.status, 200);
    assert.deepEqual(JSON.parse(read.body), { session: expectedSession });
  } finally {
    if (server) await server.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("malformed meeting composition stays unavailable without creating meeting storage", async () => {
  const directory = await mkdtemp(join(tmpdir(), "vibe-city-meeting-server-malformed-"));
  const meetingDatabasePath = join(directory, "must-not-exist.sqlite");
  const malformedComposition = new Proxy({
    databasePath: meetingDatabasePath,
    now: () => NOW,
    resolveTrustedSession: () => null,
    resolveTrustedMembership: () => null,
    evaluatePolicy: () => false
  }, {
    ownKeys() {
      throw new Error("synthetic dependency inspection failure");
    }
  });
  let server;
  try {
    server = await startWorkRecordsServer({
      development: true,
      port: 0,
      databasePath: join(directory, "work-records.sqlite"),
      meetingSessions: malformedComposition
    });

    const response = await request(
      server,
      `/api/private/tenants/${TENANT}/meeting-sessions/${SESSION}`
    );
    assert.equal(response.status, 404);
    assert.equal(response.headers["cache-control"], "private, no-store");
    assert.deepEqual(JSON.parse(response.body), { error: "not_found" });
    await assert.rejects(access(meetingDatabasePath), { code: "ENOENT" });
  } finally {
    if (server) await server.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("proxy meeting composition is rejected before hostile inspection or storage creation", async () => {
  const directory = await mkdtemp(join(tmpdir(), "vibe-city-meeting-server-proxy-"));
  const meetingDatabasePath = join(directory, "must-not-exist.sqlite");
  const trapCalls = { getOwnPropertyDescriptor: 0, getPrototypeOf: 0, ownKeys: 0 };
  const proxyComposition = new Proxy({
    databasePath: meetingDatabasePath,
    now: () => NOW,
    resolveTrustedSession: () => null,
    resolveTrustedMembership: () => null,
    evaluatePolicy: () => false
  }, {
    getOwnPropertyDescriptor(target, key) {
      trapCalls.getOwnPropertyDescriptor += 1;
      return Reflect.getOwnPropertyDescriptor(target, key);
    },
    getPrototypeOf(target) {
      trapCalls.getPrototypeOf += 1;
      return Reflect.getPrototypeOf(target);
    },
    ownKeys(target) {
      trapCalls.ownKeys += 1;
      return Reflect.ownKeys(target);
    }
  });
  let server;
  try {
    server = await startWorkRecordsServer({
      development: true,
      port: 0,
      databasePath: join(directory, "work-records.sqlite"),
      meetingSessions: proxyComposition
    });

    const response = await request(
      server,
      `/api/private/tenants/${TENANT}/meeting-sessions/${SESSION}`
    );
    assert.equal(response.status, 404);
    assert.equal(response.headers["cache-control"], "private, no-store");
    assert.equal(response.headers.vary, "Authorization");
    assert.deepEqual(JSON.parse(response.body), { error: "not_found" });
    await assert.rejects(access(meetingDatabasePath), { code: "ENOENT" });
    assert.deepEqual(trapCalls, { getOwnPropertyDescriptor: 0, getPrototypeOf: 0, ownKeys: 0 });
  } finally {
    if (server) await server.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("inherited meeting composition stays unavailable after reflection intrinsic replacement", async () => {
  const directory = await mkdtemp(join(tmpdir(), "vibe-city-meeting-server-intrinsics-"));
  const meetingDatabasePath = join(directory, "must-not-exist.sqlite");
  const validComposition = {
    databasePath: meetingDatabasePath,
    now: () => NOW,
    resolveTrustedSession: () => null,
    resolveTrustedMembership: () => null,
    evaluatePolicy: () => false
  };
  const inheritedComposition = Object.create(validComposition);
  const originalGetPrototypeOf = Object.getPrototypeOf;
  const originalGetOwnPropertyDescriptors = Object.getOwnPropertyDescriptors;
  const originalOwnKeys = Reflect.ownKeys;
  let server;
  try {
    Object.getPrototypeOf = (candidate) => candidate === inheritedComposition
      ? Object.prototype
      : originalGetPrototypeOf(candidate);
    Object.getOwnPropertyDescriptors = (candidate) => candidate === inheritedComposition
      ? originalGetOwnPropertyDescriptors(validComposition)
      : originalGetOwnPropertyDescriptors(candidate);
    Reflect.ownKeys = (candidate) => candidate === inheritedComposition
      ? originalOwnKeys(validComposition)
      : originalOwnKeys(candidate);

    server = await startWorkRecordsServer({
      development: true,
      port: 0,
      databasePath: join(directory, "work-records.sqlite"),
      meetingSessions: inheritedComposition
    });

    const response = await request(
      server,
      `/api/private/tenants/${TENANT}/meeting-sessions/${SESSION}`
    );
    assert.equal(response.status, 404);
    assert.equal(response.headers["cache-control"], "private, no-store");
    assert.equal(response.headers.vary, "Authorization");
    assert.deepEqual(JSON.parse(response.body), { error: "not_found" });
    await assert.rejects(access(meetingDatabasePath), { code: "ENOENT" });
  } finally {
    Object.getPrototypeOf = originalGetPrototypeOf;
    Object.getOwnPropertyDescriptors = originalGetOwnPropertyDescriptors;
    Reflect.ownKeys = originalOwnKeys;
    if (server) await server.close();
    await rm(directory, { recursive: true, force: true });
  }
});
