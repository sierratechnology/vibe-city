import assert from "node:assert/strict";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

const TENANT_A = "syn-tenant-a";
const TENANT_B = "syn-tenant-b";
const SUBJECT_A = "syn-tenant-a--subject-a";
const SESSION_A = "syn-tenant-a--session-a";
const STARTED_AT = "2000-01-01T00:01:30.000Z";
const ENDED_AT = "2000-01-01T00:01:45.000Z";

function trustedContext(action, overrides = {}) {
  return {
    kind: "trusted-server-context",
    authenticatedSubjectId: SUBJECT_A,
    activeTenantMembership: {
      tenantId: TENANT_A,
      subjectId: SUBJECT_A,
      active: true
    },
    actionGrants: [action],
    authorizationReference: "syn-tenant-a--authorization-a",
    policyRevision: 1,
    ...overrides
  };
}

function createInput(overrides = {}) {
  return {
    tenantId: TENANT_A,
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

function endInput(overrides = {}) {
  return {
    tenantId: TENANT_A,
    sessionId: SESSION_A,
    endedAt: ENDED_AT,
    expectedRevision: 1,
    outcomeReference: "syn-tenant-a--no-decision-a",
    actorSubjectId: SUBJECT_A,
    authorizationReference: "syn-tenant-a--authorization-a",
    policyRevision: 1,
    ...overrides
  };
}

async function loadRepository() {
  return import("../server/privateMeetingSessions.mjs").catch(() => ({}));
}

async function withDatabase(run) {
  const directory = await mkdtemp(join(tmpdir(), "vibe-city-private-meeting-"));
  const databasePath = join(directory, "sessions.sqlite");
  try {
    await run(databasePath);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test("authorized create persists one private meeting session and one audit event across reopen", async () => {
  const module = await loadRepository();
  assert.equal(typeof module.createPrivateMeetingSessionsRepository, "function");

  await withDatabase(async (databasePath) => {
    const repository = module.createPrivateMeetingSessionsRepository(databasePath);
    const created = repository.createSession(
      trustedContext("create_private_meeting_session"),
      createInput()
    );
    assert.equal(created.ok, true);
    assert.equal(created.session.revision, 1);
    assert.equal(created.session.lifecycle, "active");
    repository.close();

    assert.equal((await stat(databasePath)).mode & 0o777, 0o600);
    const reopened = module.createPrivateMeetingSessionsRepository(databasePath);
    const read = reopened.readSession(
      trustedContext("read_private_meeting_session"),
      { tenantId: TENANT_A, sessionId: SESSION_A }
    );
    const history = reopened.readAuditHistory(
      trustedContext("read_private_meeting_session"),
      { tenantId: TENANT_A, sessionId: SESSION_A }
    );
    assert.equal(read.ok, true);
    assert.deepEqual(read.session, created.session);
    assert.equal(history.ok, true);
    assert.equal(history.events.length, 1);
    assert.equal(history.events[0].eventKind, "private_meeting_session_created");
    assert.equal(history.events[0].priorRevision, 0);
    assert.equal(history.events[0].newRevision, 1);
    assert.equal(JSON.stringify(read).includes(databasePath), false);
    reopened.close();
  });
});

test("authorized no-decision end preserves session facts and immutable create history across reopen", async () => {
  const module = await loadRepository();
  await withDatabase(async (databasePath) => {
    const repository = module.createPrivateMeetingSessionsRepository(databasePath);
    const created = repository.createSession(
      trustedContext("create_private_meeting_session"),
      createInput()
    );
    const scope = { tenantId: TENANT_A, sessionId: SESSION_A };
    const createHistory = repository.readAuditHistory(
      trustedContext("read_private_meeting_session"), scope
    ).events;

    const ended = repository.endWithNoDecision(
      trustedContext("end_private_meeting_session"),
      endInput()
    );

    assert.equal(ended.ok, true);
    assert.equal(ended.session.revision, 2);
    assert.equal(ended.session.lifecycle, "ended");
    assert.equal(ended.session.endedAt, ENDED_AT);
    assert.deepEqual(ended.session.outcome, {
      resultState: "no-decision",
      outcomeReference: "syn-tenant-a--no-decision-a"
    });
    for (const field of [
      "purposeReference", "participantSubjectIds", "materialReferences", "startedAt",
      "sourceReference", "createdBySubjectId"
    ]) assert.deepEqual(ended.session[field], created.session[field], field);
    repository.close();

    const reopened = module.createPrivateMeetingSessionsRepository(databasePath);
    const read = reopened.readSession(trustedContext("read_private_meeting_session"), scope);
    const history = reopened.readAuditHistory(trustedContext("read_private_meeting_session"), scope);
    assert.deepEqual(read.session, ended.session);
    assert.equal(history.events.length, 2);
    assert.deepEqual(history.events[0], createHistory[0]);
    assert.equal(history.events[1].eventKind, "private_meeting_session_ended_no_decision");
    assert.equal(history.events[1].priorRevision, 1);
    assert.equal(history.events[1].newRevision, 2);
    reopened.close();
  });
});

test("distinct authorized end authority remains durable without rewriting create provenance", async () => {
  const module = await loadRepository();
  await withDatabase(async (databasePath) => {
    const repository = module.createPrivateMeetingSessionsRepository(databasePath);
    const created = repository.createSession(
      trustedContext("create_private_meeting_session"),
      createInput()
    );
    assert.equal(created.ok, true);

    const endAuthority = {
      actorSubjectId: "syn-tenant-a--subject-b",
      authorizationReference: "syn-tenant-a--authorization-end",
      policyRevision: 2
    };
    const ended = repository.endWithNoDecision(
      trustedContext("end_private_meeting_session", {
        authenticatedSubjectId: endAuthority.actorSubjectId,
        activeTenantMembership: {
          tenantId: TENANT_A,
          subjectId: endAuthority.actorSubjectId,
          active: true
        },
        authorizationReference: endAuthority.authorizationReference,
        policyRevision: endAuthority.policyRevision
      }),
      endInput(endAuthority)
    );
    assert.equal(ended.ok, true);
    repository.close();

    const reopened = module.createPrivateMeetingSessionsRepository(databasePath);
    const scope = { tenantId: TENANT_A, sessionId: SESSION_A };
    const read = reopened.readSession(trustedContext("read_private_meeting_session"), scope);
    const history = reopened.readAuditHistory(trustedContext("read_private_meeting_session"), scope);
    assert.equal(read.ok, true);
    assert.equal(read.session.revision, 2);
    assert.equal(read.session.createdBySubjectId, SUBJECT_A);
    assert.equal(read.session.authorizationReference, "syn-tenant-a--authorization-a");
    assert.equal(read.session.policyRevision, 1);
    assert.equal(read.session.endedBySubjectId, endAuthority.actorSubjectId);
    assert.equal(read.session.endAuthorizationReference, endAuthority.authorizationReference);
    assert.equal(read.session.endPolicyRevision, endAuthority.policyRevision);
    assert.equal(history.ok, true);
    assert.equal(history.events.length, 2);
    assert.equal(history.events[0].actorSubjectId, SUBJECT_A);
    assert.equal(history.events[0].authorizationReference, "syn-tenant-a--authorization-a");
    assert.equal(history.events[0].policyRevision, 1);
    assert.equal(history.events[1].actorSubjectId, endAuthority.actorSubjectId);
    assert.equal(history.events[1].authorizationReference, endAuthority.authorizationReference);
    assert.equal(history.events[1].policyRevision, endAuthority.policyRevision);
    reopened.close();
  });
});

test("authorized tenant member outside the participant list cannot end the session", async () => {
  const module = await loadRepository();
  await withDatabase(async (databasePath) => {
    const repository = module.createPrivateMeetingSessionsRepository(databasePath);
    assert.equal(repository.createSession(
      trustedContext("create_private_meeting_session"), createInput()
    ).ok, true);

    const outsiderAuthority = {
      actorSubjectId: "syn-tenant-a--subject-c",
      authorizationReference: "syn-tenant-a--authorization-outsider",
      policyRevision: 3
    };
    const denied = repository.endWithNoDecision(
      trustedContext("end_private_meeting_session", {
        authenticatedSubjectId: outsiderAuthority.actorSubjectId,
        activeTenantMembership: {
          tenantId: TENANT_A,
          subjectId: outsiderAuthority.actorSubjectId,
          active: true
        },
        authorizationReference: outsiderAuthority.authorizationReference,
        policyRevision: outsiderAuthority.policyRevision
      }),
      endInput(outsiderAuthority)
    );
    assert.deepEqual(denied, { ok: false, code: "not_found" });

    const scope = { tenantId: TENANT_A, sessionId: SESSION_A };
    const read = repository.readSession(trustedContext("read_private_meeting_session"), scope);
    const history = repository.readAuditHistory(trustedContext("read_private_meeting_session"), scope);
    assert.equal(read.session.revision, 1);
    assert.equal(read.session.lifecycle, "active");
    assert.equal(history.events.length, 1);
    assert.equal(history.events[0].eventKind, "private_meeting_session_created");
    repository.close();

    const reopened = module.createPrivateMeetingSessionsRepository(databasePath);
    assert.deepEqual(
      reopened.readSession(trustedContext("read_private_meeting_session"), scope),
      read
    );
    assert.deepEqual(
      reopened.readAuditHistory(trustedContext("read_private_meeting_session"), scope),
      history
    );
    reopened.close();
  });
});

test("tenant direct-ID revoked missing-action and client-authority substitution deny identically without mutation", async () => {
  const module = await loadRepository();
  await withDatabase(async (databasePath) => {
    const repository = module.createPrivateMeetingSessionsRepository(databasePath);
    assert.equal(repository.createSession(
      trustedContext("create_private_meeting_session"), createInput()
    ).ok, true);
    const scope = { tenantId: TENANT_A, sessionId: SESSION_A };
    let authorityReads = 0;
    const statefulAuthorityContext = trustedContext("create_private_meeting_session");
    Object.defineProperty(statefulAuthorityContext, "authorizationReference", {
      enumerable: true,
      get() {
        authorityReads += 1;
        return authorityReads === 1
          ? "syn-tenant-a--authorization-a"
          : "syn-tenant-a--authorization-client";
      }
    });
    const denied = [
      repository.readSession(
        trustedContext("read_private_meeting_session", {
          activeTenantMembership: { tenantId: TENANT_A, subjectId: SUBJECT_A, active: false }
        }), scope
      ),
      repository.readSession({
        ...trustedContext("read_private_meeting_session"),
        authenticatedSubjectId: "syn-tenant-b--subject-a",
        activeTenantMembership: {
          tenantId: TENANT_B, subjectId: "syn-tenant-b--subject-a", active: true
        },
        authorizationReference: "syn-tenant-b--authorization-a"
      }, { tenantId: TENANT_B, sessionId: "syn-tenant-b--session-a" }),
      repository.readSession(
        trustedContext("read_private_meeting_session"),
        { tenantId: TENANT_A, sessionId: "syn-tenant-b--session-a" }
      ),
      repository.endWithNoDecision(trustedContext("read_private_meeting_session"), endInput()),
      repository.endWithNoDecision(
        trustedContext("end_private_meeting_session"),
        endInput({ authorizationReference: "syn-tenant-a--authorization-client" })
      ),
      repository.endWithNoDecision(
        trustedContext("end_private_meeting_session"),
        endInput({ actorSubjectId: "syn-tenant-a--subject-client", policyRevision: 999 })
      ),
      repository.createSession(
        trustedContext("create_private_meeting_session"),
        createInput({ clientRole: "owner", clientAuthority: true })
      ),
      repository.createSession(
        statefulAuthorityContext,
        createInput({
          sessionId: "syn-tenant-a--session-stateful",
          sourceReference: "syn-tenant-a--source-stateful"
        })
      )
    ];
    for (const result of denied) assert.deepEqual(result, { ok: false, code: "not_found" });
    const read = repository.readSession(trustedContext("read_private_meeting_session"), scope);
    const history = repository.readAuditHistory(trustedContext("read_private_meeting_session"), scope);
    assert.equal(read.session.revision, 1);
    assert.equal(read.session.lifecycle, "active");
    assert.equal(history.events.length, 1);
    assert.equal(authorityReads, 0, "accessor-backed authority must be rejected without evaluation");
    assert.equal(JSON.stringify(denied).includes(TENANT_B), false);
    repository.close();
  });
});

test("stale duplicate chronology reference and audit failures are atomic and non-mutating", async () => {
  const module = await loadRepository();
  await withDatabase(async (databasePath) => {
    const repository = module.createPrivateMeetingSessionsRepository(databasePath);
    assert.equal(repository.createSession(
      trustedContext("create_private_meeting_session"), createInput()
    ).ok, true);
    const denied = [
      repository.endWithNoDecision(
        trustedContext("end_private_meeting_session"), endInput({ expectedRevision: 0 })
      ),
      repository.endWithNoDecision(
        trustedContext("end_private_meeting_session"), endInput({ endedAt: STARTED_AT })
      ),
      repository.endWithNoDecision(
        trustedContext("end_private_meeting_session"), endInput({ outcomeReference: "malformed" })
      ),
      repository.createSession(
        trustedContext("create_private_meeting_session"),
        createInput({
          sessionId: "syn-tenant-a--session-duplicate-source",
          sourceReference: "syn-tenant-a--source-a"
        })
      ),
      repository.createSession(
        trustedContext("create_private_meeting_session"),
        createInput({
          sessionId: "syn-tenant-a--session-cross-participant",
          participantSubjectIds: [SUBJECT_A, "syn-tenant-b--subject-b"],
          sourceReference: "syn-tenant-a--source-cross-participant"
        })
      ),
      repository.createSession(
        trustedContext("create_private_meeting_session"),
        createInput({
          sessionId: "syn-tenant-a--session-cross-material",
          materialReferences: ["syn-tenant-b--material-b"],
          sourceReference: "syn-tenant-a--source-cross-material"
        })
      ),
      repository.createSession(
        trustedContext("create_private_meeting_session"),
        createInput({
          sessionId: "syn-tenant-a--session-cross-source",
          sourceReference: "syn-tenant-b--source-b"
        })
      )
    ];
    for (const result of denied) assert.deepEqual(result, { ok: false, code: "not_found" });
    repository.close();

    let injectedFailures = 0;
    const failingRepository = module.createPrivateMeetingSessionsRepository(databasePath, {
      beforeAuditWrite(event) {
        if (event.eventKind === "private_meeting_session_ended_no_decision") {
          injectedFailures += 1;
          throw new Error("synthetic audit failure detail");
        }
      }
    });
    const failedEnd = failingRepository.endWithNoDecision(
      trustedContext("end_private_meeting_session"), endInput()
    );
    assert.deepEqual(failedEnd, { ok: false, code: "not_found" });
    assert.equal(JSON.stringify(failedEnd).includes("audit failure detail"), false);
    assert.equal(injectedFailures, 1);
    failingRepository.close();

    const reopened = module.createPrivateMeetingSessionsRepository(databasePath);
    const scope = { tenantId: TENANT_A, sessionId: SESSION_A };
    const read = reopened.readSession(trustedContext("read_private_meeting_session"), scope);
    const history = reopened.readAuditHistory(trustedContext("read_private_meeting_session"), scope);
    assert.equal(read.session.revision, 1);
    assert.equal(read.session.lifecycle, "active");
    assert.equal(history.events.length, 1);
    reopened.close();
  });
});

test("repository exposes no aggregate alternative lookup or inherited operation surface", async () => {
  const module = await loadRepository();
  await withDatabase(async (databasePath) => {
    const repository = module.createPrivateMeetingSessionsRepository(databasePath);
    assert.equal(Object.getPrototypeOf(repository), null);
    for (const operation of [
      "listSessions", "countSessions", "readSessionBySourceReference", "toString", "constructor"
    ]) assert.equal(repository[operation], undefined, operation);
    repository.close();
  });
});

test("repository rejects impossible chronology after global Date replacement", async () => {
  const module = await loadRepository();
  const OriginalDate = globalThis.Date;
  const impossible = "2000-02-30T00:01:30.000Z";
  class ForgedDate extends OriginalDate {
    static parse(value) {
      return value === impossible ? 1 : OriginalDate.parse(value);
    }

    toISOString() {
      return this.getTime() === 1 ? impossible : super.toISOString();
    }
  }
  await withDatabase(async (databasePath) => {
    const repository = module.createPrivateMeetingSessionsRepository(databasePath);
    let result;
    globalThis.Date = ForgedDate;
    try {
      result = repository.createSession(
        trustedContext("create_private_meeting_session"),
        createInput({
          sessionId: "syn-tenant-a--session-impossible-date",
          sourceReference: "syn-tenant-a--source-impossible-date",
          startedAt: impossible
        })
      );
    } finally {
      globalThis.Date = OriginalDate;
    }
    assert.deepEqual(result, { ok: false, code: "not_found" });
    assert.deepEqual(repository.readSession(
      trustedContext("read_private_meeting_session"),
      { tenantId: TENANT_A, sessionId: "syn-tenant-a--session-impossible-date" }
    ), { ok: false, code: "not_found" });
    repository.close();
  });
});

test("captured startsWith denies a foreign material reference without mutation", async () => {
  const module = await loadRepository();
  await withDatabase(async (databasePath) => {
    const repository = module.createPrivateMeetingSessionsRepository(databasePath);
    const seedSessionId = "syn-tenant-a--session-scope-seed";
    assert.equal(repository.createSession(
      trustedContext("create_private_meeting_session"),
      createInput({
        sessionId: seedSessionId,
        sourceReference: "syn-tenant-a--source-scope-seed"
      })
    ).ok, true);

    const originalStartsWith = String.prototype.startsWith;
    const denials = [];
    String.prototype.startsWith = () => true;
    try {
      for (const [context, input] of [
        [trustedContext("create_private_meeting_session"),
          createInput({ materialReferences: ["syn-tenant-b--material-foreign"] })],
        [trustedContext("create_private_meeting_session"), createInput({
          sessionId: "syn-tenant-a--session-foreign-participant",
          participantSubjectIds: [SUBJECT_A, "syn-tenant-b--subject-foreign"],
          sourceReference: "syn-tenant-a--source-foreign-participant"
        })],
        [trustedContext("create_private_meeting_session"), createInput({
          sessionId: "syn-tenant-a--session-foreign-purpose",
          purposeReference: "syn-tenant-b--purpose-foreign",
          sourceReference: "syn-tenant-a--source-foreign-purpose"
        })],
        [trustedContext("create_private_meeting_session"), createInput({
          sessionId: "syn-tenant-a--session-foreign-source",
          sourceReference: "syn-tenant-b--source-foreign"
        })]
      ]) denials.push(repository.createSession(context, input));

      denials.push(repository.endWithNoDecision(
        trustedContext("end_private_meeting_session"),
        endInput({
          sessionId: seedSessionId,
          outcomeReference: "syn-tenant-b--outcome-foreign"
        })
      ));
      denials.push(repository.endWithNoDecision(
        trustedContext("end_private_meeting_session", {
          authenticatedSubjectId: "syn-tenant-b--subject-foreign",
          activeTenantMembership: {
            tenantId: TENANT_A,
            subjectId: "syn-tenant-b--subject-foreign",
            active: true
          }
        }),
        endInput({
          sessionId: seedSessionId,
          actorSubjectId: "syn-tenant-b--subject-foreign"
        })
      ));
      denials.push(repository.endWithNoDecision(
        trustedContext("end_private_meeting_session", {
          authorizationReference: "syn-tenant-b--authorization-foreign"
        }),
        endInput({
          sessionId: seedSessionId,
          authorizationReference: "syn-tenant-b--authorization-foreign"
        })
      ));
    } finally {
      String.prototype.startsWith = originalStartsWith;
    }

    for (const denied of denials) {
      assert.deepEqual(denied, { ok: false, code: "not_found" });
    }
    assert.equal(repository.readSession(
      trustedContext("read_private_meeting_session"),
      { tenantId: TENANT_A, sessionId: seedSessionId }
    ).session.revision, 1);
    const verification = new DatabaseSync(databasePath);
    assert.equal(verification.prepare("SELECT COUNT(*) AS count FROM private_meeting_sessions").get().count, 1);
    assert.equal(verification.prepare("SELECT COUNT(*) AS count FROM private_meeting_session_audit_events").get().count, 1);
    verification.close();
    repository.close();
  });
});

test("caller graphs are closed data-only snapshots and revisions reject negative zero", async () => {
  const module = await loadRepository();
  await withDatabase(async (databasePath) => {
    const repository = module.createPrivateMeetingSessionsRepository(databasePath);
    const deniedInputs = [];

    const symbolContext = trustedContext("create_private_meeting_session");
    symbolContext[Symbol("private")] = true;
    deniedInputs.push(repository.createSession(symbolContext, createInput()));

    const hiddenMembershipContext = trustedContext("create_private_meeting_session");
    Object.defineProperty(hiddenMembershipContext.activeTenantMembership, "private", { value: true });
    deniedInputs.push(repository.createSession(hiddenMembershipContext, createInput()));

    const symbolGrantContext = trustedContext("create_private_meeting_session");
    symbolGrantContext.actionGrants[Symbol("private")] = true;
    deniedInputs.push(repository.createSession(symbolGrantContext, createInput()));

    for (const input of [createInput(), endInput()]) {
      Object.defineProperty(input, "private", { value: true });
      deniedInputs.push(input.expectedRevision === 0
        ? repository.createSession(trustedContext("create_private_meeting_session"), input)
        : repository.endWithNoDecision(trustedContext("end_private_meeting_session"), input));
    }

    const hiddenScope = { tenantId: TENANT_A, sessionId: SESSION_A };
    Object.defineProperty(hiddenScope, "private", { value: true });
    deniedInputs.push(repository.readSession(trustedContext("read_private_meeting_session"), hiddenScope));

    let startedAtReads = 0;
    const accessorInput = createInput({
      sessionId: "syn-tenant-a--session-accessor",
      sourceReference: "syn-tenant-a--source-accessor"
    });
    Object.defineProperty(accessorInput, "startedAt", {
      enumerable: true,
      get() {
        startedAtReads += 1;
        return STARTED_AT;
      }
    });
    deniedInputs.push(repository.createSession(
      trustedContext("create_private_meeting_session"), accessorInput
    ));
    deniedInputs.push(repository.createSession(
      trustedContext("create_private_meeting_session"),
      createInput({
        sessionId: "syn-tenant-a--session-negative-zero",
        sourceReference: "syn-tenant-a--source-negative-zero",
        expectedRevision: -0
      })
    ));
    deniedInputs.push(repository.createSession(
      trustedContext("create_private_meeting_session", { policyRevision: -0 }),
      createInput({
        sessionId: "syn-tenant-a--session-policy-negative-zero",
        sourceReference: "syn-tenant-a--source-policy-negative-zero"
      })
    ));
    deniedInputs.push(repository.createSession(
      trustedContext("create_private_meeting_session"), new Proxy(createInput(), {})
    ));

    for (const result of deniedInputs) assert.deepEqual(result, { ok: false, code: "not_found" });
    assert.equal(startedAtReads, 0);
    repository.close();

    const hiddenOptions = {};
    Object.defineProperty(hiddenOptions, "private", { value: true });
    assert.throws(
      () => module.createPrivateMeetingSessionsRepository(databasePath, hiddenOptions),
      /repository unavailable/
    );
  });
});

test("captured scalar and collection intrinsics preserve validation after replacement", async () => {
  const module = await loadRepository();
  await withDatabase(async (databasePath) => {
    const repository = module.createPrivateMeetingSessionsRepository(databasePath);
    const originals = {
      safe: Number.isSafeInteger,
      Set: globalThis.Set,
      push: Array.prototype.push,
      includes: Array.prototype.includes,
      every: Array.prototype.every,
      iterator: Array.prototype[Symbol.iterator],
      test: RegExp.prototype.test,
      descriptors: Object.getOwnPropertyDescriptors,
      keys: Object.keys,
      prototype: Object.getPrototypeOf,
      freeze: Object.freeze,
      ownKeys: Reflect.ownKeys,
      parse: JSON.parse,
      stringify: JSON.stringify,
      Date: globalThis.Date
    };
    const replaced = () => { throw new Error("replaced intrinsic"); };
    let created;
    let unsafe;
    let duplicate;
    try {
      Number.isSafeInteger = () => true;
      globalThis.Set = class ForgedSet { get size() { return 1; } };
      Array.prototype.push = replaced;
      Array.prototype.includes = () => true;
      Array.prototype.every = () => true;
      Array.prototype[Symbol.iterator] = replaced;
      RegExp.prototype.test = () => true;
      Object.getOwnPropertyDescriptors = replaced;
      Object.keys = replaced;
      Object.getPrototypeOf = replaced;
      Object.freeze = (value) => value;
      Reflect.ownKeys = replaced;
      JSON.parse = replaced;
      JSON.stringify = replaced;
      globalThis.Date = class ForgedDate {};

      created = repository.createSession(
        trustedContext("create_private_meeting_session"), createInput()
      );
      unsafe = repository.createSession(
        trustedContext("create_private_meeting_session", { policyRevision: Number.MAX_VALUE }),
        createInput({
          sessionId: "syn-tenant-a--session-unsafe",
          sourceReference: "syn-tenant-a--source-unsafe"
        })
      );
      duplicate = repository.createSession(
        trustedContext("create_private_meeting_session"),
        createInput({
          sessionId: "syn-tenant-a--session-duplicate",
          participantSubjectIds: [SUBJECT_A, SUBJECT_A],
          sourceReference: "syn-tenant-a--source-duplicate"
        })
      );
    } finally {
      Number.isSafeInteger = originals.safe;
      globalThis.Set = originals.Set;
      Array.prototype.push = originals.push;
      Array.prototype.includes = originals.includes;
      Array.prototype.every = originals.every;
      Array.prototype[Symbol.iterator] = originals.iterator;
      RegExp.prototype.test = originals.test;
      Object.getOwnPropertyDescriptors = originals.descriptors;
      Object.keys = originals.keys;
      Object.getPrototypeOf = originals.prototype;
      Object.freeze = originals.freeze;
      Reflect.ownKeys = originals.ownKeys;
      JSON.parse = originals.parse;
      JSON.stringify = originals.stringify;
      globalThis.Date = originals.Date;
    }

    assert.equal(created.ok, true);
    assert.deepEqual(unsafe, { ok: false, code: "not_found" });
    assert.deepEqual(duplicate, { ok: false, code: "not_found" });
    assert.deepEqual(repository.readSession(
      trustedContext("read_private_meeting_session"),
      { tenantId: TENANT_A, sessionId: SESSION_A }
    ).session, created.session);
    repository.close();
  });
});

test("audit hook observes only a frozen copy and cannot rewrite material events", async () => {
  const module = await loadRepository();
  await withDatabase(async (databasePath) => {
    const observed = [];
    const repository = module.createPrivateMeetingSessionsRepository(databasePath, {
      beforeAuditWrite(event) {
        observed.push({
          frozen: Object.isFrozen(event),
          eventKind: event.eventKind,
          revision: event.newRevision
        });
        assert.equal(Reflect.set(event, "eventKind", "forged"), false);
        assert.equal(Reflect.set(event, "newRevision", 999), false);
        assert.equal(Reflect.set(event, "actorSubjectId", "syn-tenant-a--subject-forged"), false);
        assert.equal(Reflect.set(event, "authorizationReference", "syn-tenant-a--authorization-forged"), false);
        assert.equal(Reflect.set(event, "policyRevision", 999), false);
        assert.equal(Reflect.set(event, "occurredAt", "2999-01-01T00:00:00.000Z"), false);
        assert.equal(Reflect.set(event, "resultState", "forged"), false);
      }
    });

    assert.equal(repository.createSession(
      trustedContext("create_private_meeting_session"), createInput()
    ).ok, true);
    assert.equal(repository.endWithNoDecision(
      trustedContext("end_private_meeting_session"), endInput()
    ).ok, true);

    const history = repository.readAuditHistory(
      trustedContext("read_private_meeting_session"),
      { tenantId: TENANT_A, sessionId: SESSION_A }
    );
    assert.deepEqual(observed, [
      { frozen: true, eventKind: "private_meeting_session_created", revision: 1 },
      { frozen: true, eventKind: "private_meeting_session_ended_no_decision", revision: 2 }
    ]);
    assert.equal(history.events[0].eventKind, "private_meeting_session_created");
    assert.equal(history.events[0].newRevision, 1);
    assert.equal(history.events[1].eventKind, "private_meeting_session_ended_no_decision");
    assert.equal(history.events[1].newRevision, 2);
    assert.equal(history.events[1].resultState, "no-decision");
    repository.close();
  });
});

test("persisted rows are closed canonical identities and successful outputs are recursively frozen", async () => {
  const module = await loadRepository();
  const tamperCases = [
    ["session_json", (value) => ({ ...value, privateField: "private" })],
    ["session_json", (value) => ({ ...value, tenantId: TENANT_B })],
    ["session_json", (value) => ({ ...value, lifecycle: "forged" })],
    ["session_json", (value) => ({ ...value, participantSubjectIds: [SUBJECT_A, SUBJECT_A] })],
    ["session_json", (value) => ({ startedAt: value.startedAt, ...value })],
    ["event_json", (value) => ({ ...value, privateField: "private" })],
    ["event_json", (value) => ({ ...value, sessionId: "syn-tenant-a--session-forged" })],
    ["event_json", (value) => ({ ...value, newRevision: 9 })]
  ];

  for (const [column, mutate] of tamperCases) {
    await withDatabase(async (databasePath) => {
      const repository = module.createPrivateMeetingSessionsRepository(databasePath);
      assert.equal(repository.createSession(
        trustedContext("create_private_meeting_session"), createInput()
      ).ok, true);
      repository.close();

      const database = new DatabaseSync(databasePath);
      const table = column === "session_json"
        ? "private_meeting_sessions"
        : "private_meeting_session_audit_events";
      const original = database.prepare(`SELECT ${column} AS value FROM ${table}`).get().value;
      const tampered = JSON.stringify(mutate(JSON.parse(original)));
      database.prepare(`UPDATE ${table} SET ${column} = ?`).run(tampered);
      database.close();

      const reopened = module.createPrivateMeetingSessionsRepository(databasePath);
      const scope = { tenantId: TENANT_A, sessionId: SESSION_A };
      assert.deepEqual(reopened.readSession(
        trustedContext("read_private_meeting_session"), scope
      ), { ok: false, code: "not_found" });
      assert.deepEqual(reopened.readAuditHistory(
        trustedContext("read_private_meeting_session"), scope
      ), { ok: false, code: "not_found" });
      assert.deepEqual(reopened.endWithNoDecision(
        trustedContext("end_private_meeting_session"), endInput()
      ), { ok: false, code: "not_found" });
      reopened.close();

      const verification = new DatabaseSync(databasePath);
      assert.equal(verification.prepare(`SELECT ${column} AS value FROM ${table}`).get().value, tampered);
      verification.close();
    });
  }

  await withDatabase(async (databasePath) => {
    const repository = module.createPrivateMeetingSessionsRepository(databasePath);
    const created = repository.createSession(
      trustedContext("create_private_meeting_session"), createInput()
    );
    const ended = repository.endWithNoDecision(
      trustedContext("end_private_meeting_session"), endInput()
    );
    const scope = { tenantId: TENANT_A, sessionId: SESSION_A };
    const read = repository.readSession(trustedContext("read_private_meeting_session"), scope);
    const history = repository.readAuditHistory(trustedContext("read_private_meeting_session"), scope);
    for (const value of [
      created, created.session, created.session.participantSubjectIds,
      ended, ended.session, ended.session.outcome,
      read, read.session, read.session.materialReferences,
      history, history.events, history.events[0], history.events[1]
    ]) assert.equal(Object.isFrozen(value), true);
    assert.equal(Reflect.set(read.session, "lifecycle", "forged"), false);
    assert.throws(() => read.session.participantSubjectIds.push("syn-tenant-a--subject-forged"));
    assert.equal(repository.readSession(
      trustedContext("read_private_meeting_session"), scope
    ).session.lifecycle, "ended");
    assert.equal(repository.readAuditHistory(
      trustedContext("read_private_meeting_session"), scope
    ).events.length, 2);
    repository.close();
  });
});

test("factory and close contain filesystem and database errors behind stable generic results", async () => {
  const module = await loadRepository();
  const inaccessiblePath = join(
    tmpdir(), "vibe-city-missing-parent", "private-name", "sessions.sqlite"
  );
  assert.throws(
    () => module.createPrivateMeetingSessionsRepository(inaccessiblePath),
    (error) => error.message === "repository unavailable" &&
      !String(error).includes(inaccessiblePath) &&
      !String(error).includes("ENOENT")
  );

  await withDatabase(async (databasePath) => {
    const repository = module.createPrivateMeetingSessionsRepository(databasePath);
    assert.deepEqual(repository.close(), { ok: true });
    assert.deepEqual(repository.close(), { ok: true });
    assert.deepEqual(repository.readSession(
      trustedContext("read_private_meeting_session"),
      { tenantId: TENANT_A, sessionId: SESSION_A }
    ), { ok: false, code: "not_found" });
  });
});
