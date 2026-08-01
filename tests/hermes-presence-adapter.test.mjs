import assert from "node:assert/strict";
import test from "node:test";

import * as presenceAdapter from "../server/hermesPresenceAdapter.mjs";

const { resolveReviewedHostedIdentityMapping } = presenceAdapter;

const EVALUATED_AT = "2026-07-29T12:06:00.000Z";

function mapping(overrides = {}) {
  return {
    schemaVersion: "1.0",
    tenantId: "id_1111111111111111",
    subjectId: "id_2222222222222222",
    identityId: "stg-spiders",
    profileName: "synthetic_profile",
    registryRevision: 7,
    synchronizedAt: "2026-07-29T12:00:00.000Z",
    status: "active",
    ...overrides
  };
}

function validateMapping(value, evaluatedAt) {
  const expectedKeys = [
    "identityId", "profileName", "registryRevision", "schemaVersion", "status", "subjectId", "synchronizedAt",
    "tenantId"
  ];
  try {
    if (value === null || typeof value !== "object" || Array.isArray(value) ||
        Object.keys(value).sort().join("|") !== expectedKeys.join("|") ||
        value.schemaVersion !== "1.0" || !/^id_[a-f0-9]{16,64}$/.test(value.tenantId) ||
        !/^id_[a-f0-9]{16,64}$/.test(value.subjectId) || value.identityId !== "stg-spiders" ||
        !/^[a-z][a-z0-9_-]{0,63}$/.test(value.profileName) ||
        !Number.isSafeInteger(value.registryRevision) || value.registryRevision < 0 ||
        !["active", "revoked", "retired"].includes(value.status) ||
        new Date(value.synchronizedAt).toISOString() !== value.synchronizedAt ||
        Date.parse(value.synchronizedAt) > Date.parse(evaluatedAt)) {
      return { ok: false, code: "invalid_hosted_agent_presence" };
    }
    return { ok: true, value: Object.freeze({ ...value }) };
  } catch {
    return { ok: false, code: "invalid_hosted_agent_presence" };
  }
}

function resolve(mappingCandidates, installedProfileNames) {
  return resolveReviewedHostedIdentityMapping({
    mappingCandidates,
    installedProfileNames,
    evaluatedAt: EVALUATED_AT,
    validateMapping
  });
}

function assertRejected(result) {
  assert.deepEqual(result, { ok: false, code: "invalid_hosted_agent_mapping" });
  assert.equal("value" in result, false);
  assert.equal(JSON.stringify(result).includes("synthetic_profile"), false);
}

function runningSource(overrides = {}) {
  return {
    taskId: "t_aaaaaaaa",
    runId: 41,
    runStatus: "running",
    outcome: null,
    claimCurrent: true,
    spawnedEventPresent: true,
    pid: 4242,
    heartbeatAt: "2026-07-29T12:05:00.000Z",
    heartbeatHealth: "fresh",
    startedAt: "2026-07-29T12:00:00.000Z",
    endedAt: null,
    decisiveEvent: {
      eventId: 91,
      runId: 41,
      kind: "heartbeat",
      occurredAt: "2026-07-29T12:05:00.000Z"
    },
    ...overrides
  };
}

test("PID and heartbeat disagreement never derives working offline or completed", () => {
  const privateFacts = [
    { source: runningSource({ heartbeatHealth: "stale" }), liveness: "alive" },
    { source: runningSource({ pid: 4343 }), liveness: "dead" }
  ];

  for (const { source, liveness } of privateFacts) {
    const capturedLogs = [];
    const result = presenceAdapter.normalizeHermesPresenceObservation?.({
      profileName: "synthetic_profile",
      observedAt: EVALUATED_AT,
      runCandidates: [source],
      resolvePidLiveness(pid) {
        assert.equal(pid, source.pid);
        return liveness;
      },
      log(value) {
        capturedLogs.push(value);
      }
    });

    assert.deepEqual(result, {
      schemaVersion: "1.0",
      profileName: "synthetic_profile",
      observedAt: EVALUATED_AT,
      sourceStatus: "degraded",
      reason: "pid_heartbeat_disagreement",
      currentRun: {
        taskId: "t_aaaaaaaa",
        runId: 41,
        runStatus: "running",
        outcome: null,
        claimCurrent: true,
        spawnedEventPresent: true,
        pidLiveness: liveness,
        heartbeatAt: "2026-07-29T12:05:00.000Z",
        startedAt: "2026-07-29T12:00:00.000Z",
        endedAt: null
      },
      decisiveEvent: {
        eventId: 91,
        kind: "heartbeat",
        occurredAt: "2026-07-29T12:05:00.000Z"
      }
    });
    const serialized = JSON.stringify({ result, capturedLogs });
    assert.equal(serialized.includes(String(source.pid)), false);
    for (const forbidden of ["working", "offline", "completed"]) {
      assert.equal(serialized.includes(forbidden), false);
    }
  }
});

test("PID and heartbeat disagreement fails closed for unknown missing and absent spawn evidence", () => {
  const cases = [
    {
      source: runningSource({ heartbeatHealth: "fresh" }),
      resolvePidLiveness: () => "unknown",
      expectedLiveness: "unknown"
    },
    {
      source: runningSource({ heartbeatAt: null, heartbeatHealth: "missing" }),
      resolvePidLiveness: () => "alive",
      expectedLiveness: "alive"
    },
    {
      source: runningSource({ spawnedEventPresent: false }),
      resolvePidLiveness() {
        assert.fail("PID liveness must not be read without trusted spawn evidence");
      },
      expectedLiveness: "unknown"
    }
  ];

  for (const { source, resolvePidLiveness, expectedLiveness } of cases) {
    const result = presenceAdapter.normalizeHermesPresenceObservation({
      profileName: "synthetic_profile",
      observedAt: EVALUATED_AT,
      runCandidates: [source],
      resolvePidLiveness
    });

    assert.equal(result.sourceStatus, "degraded");
    assert.equal(result.reason, "pid_heartbeat_disagreement");
    assert.equal(result.currentRun.pidLiveness, expectedLiveness);
    assert.equal(result.currentRun.spawnedEventPresent, source.spawnedEventPresent);
    assert.equal(JSON.stringify(result).includes(String(source.pid)), false);
  }
});

test("PID and heartbeat disagreement reads raw PID only after running spawn authority", () => {
  const cases = [
    {
      source: runningSource({ spawnedEventPresent: false, pid: null }),
      expectedStatus: "degraded",
      expectedReason: "pid_heartbeat_disagreement",
      expectedLiveness: "unknown"
    },
    {
      source: runningSource({
        runStatus: "done",
        outcome: "completed",
        claimCurrent: false,
        pid: null,
        endedAt: "2026-07-29T12:05:30.000Z",
        decisiveEvent: {
          eventId: 92,
          runId: 41,
          kind: "completed",
          occurredAt: "2026-07-29T12:05:30.000Z"
        }
      }),
      expectedStatus: "available",
      expectedReason: null,
      expectedLiveness: "not_applicable"
    }
  ];

  const pidDescriptorReads = [];
  let resolverCalls = 0;
  for (const { source, expectedStatus, expectedReason, expectedLiveness } of cases) {
    let descriptorReads = 0;
    const observedSource = new Proxy(source, {
      getOwnPropertyDescriptor(target, key) {
        if (key === "pid") descriptorReads += 1;
        return Reflect.getOwnPropertyDescriptor(target, key);
      }
    });
    const result = presenceAdapter.normalizeHermesPresenceObservation({
      profileName: "synthetic_profile",
      observedAt: EVALUATED_AT,
      runCandidates: [observedSource],
      resolvePidLiveness() {
        resolverCalls += 1;
        return "alive";
      }
    });

    assert.equal(result.sourceStatus, expectedStatus);
    assert.equal(result.reason, expectedReason);
    assert.equal(result.currentRun.pidLiveness, expectedLiveness);
    pidDescriptorReads.push(descriptorReads);
  }
  assert.deepEqual(pidDescriptorReads, [0, 0]);
  assert.equal(resolverCalls, 0);

  let trustedDescriptorReads = 0;
  const trustedSource = new Proxy(runningSource(), {
    getOwnPropertyDescriptor(target, key) {
      if (key === "pid") trustedDescriptorReads += 1;
      return Reflect.getOwnPropertyDescriptor(target, key);
    }
  });
  const trusted = presenceAdapter.normalizeHermesPresenceObservation({
    profileName: "synthetic_profile",
    observedAt: EVALUATED_AT,
    runCandidates: [trustedSource],
    resolvePidLiveness(pid) {
      resolverCalls += 1;
      assert.equal(pid, 4242);
      return "alive";
    }
  });
  assert.equal(trusted.sourceStatus, "available");
  assert.equal(trustedDescriptorReads, 2);
  assert.equal(resolverCalls, 1);
  assert.equal(JSON.stringify(trusted).includes("4242"), false);
});

test("PID-only mutation during trusted liveness resolution fails closed", () => {
  const source = runningSource();
  const runCandidates = Object.freeze([source]);
  const capturedLogs = [];
  let resolverCalls = 0;

  const result = presenceAdapter.normalizeHermesPresenceObservation({
    profileName: "synthetic_profile",
    observedAt: EVALUATED_AT,
    runCandidates,
    resolvePidLiveness(pid) {
      resolverCalls += 1;
      assert.equal(pid, 4242);
      source.pid = 9999;
      return "alive";
    },
    log(value) {
      capturedLogs.push(value);
    }
  });

  assert.deepEqual(result, {
    schemaVersion: "1.0",
    profileName: "synthetic_profile",
    observedAt: EVALUATED_AT,
    sourceStatus: "unavailable",
    reason: "invalid_source",
    currentRun: null,
    decisiveEvent: null
  });
  assert.equal(resolverCalls, 1);
  assert.equal(runCandidates[0], source);
  assert.equal(source.pid, 9999);
  const serialized = JSON.stringify({ result, capturedLogs });
  assert.equal(serialized.includes("4242"), false);
  assert.equal(serialized.includes("9999"), false);
});

test("PID and heartbeat disagreement rejects terminal row contradictions before liveness inspection", () => {
  const cases = [
    runningSource({
      runStatus: "done",
      outcome: "completed",
      claimCurrent: false,
      endedAt: "2026-07-29T12:05:30.000Z",
      decisiveEvent: {
        eventId: 92,
        runId: 41,
        kind: "heartbeat",
        occurredAt: "2026-07-29T12:05:00.000Z"
      }
    }),
    runningSource({
      decisiveEvent: {
        eventId: 93,
        runId: 41,
        kind: "completed",
        occurredAt: "2026-07-29T12:05:00.000Z"
      }
    }),
    runningSource({
      runStatus: "done",
      outcome: "completed",
      decisiveEvent: {
        eventId: 94,
        runId: 41,
        kind: "completed",
        occurredAt: "2026-07-29T12:05:00.000Z"
      }
    })
  ];

  for (const source of cases) {
    const result = presenceAdapter.normalizeHermesPresenceObservation({
      profileName: "synthetic_profile",
      observedAt: EVALUATED_AT,
      runCandidates: [source],
      resolvePidLiveness() {
        assert.fail("contradictory terminal authority must fail before PID inspection");
      }
    });
    assert.deepEqual(result, {
      schemaVersion: "1.0",
      profileName: "synthetic_profile",
      observedAt: EVALUATED_AT,
      sourceStatus: "unavailable",
      reason: "invalid_source",
      currentRun: null,
      decisiveEvent: null
    });
    assert.equal(JSON.stringify(result).includes(String(source.pid)), false);
  }
});

test("PID and heartbeat disagreement closes malformed future and ambiguous source combinations generically", () => {
  const forbiddenValues = [
    "private-host.invalid",
    "claim-secret",
    "private task title",
    "private task body",
    "private summary",
    "private-model",
    "private-provider",
    "/private/path",
    "rejected-secret",
    "private exception text"
  ];
  const malformed = [
    runningSource({ heartbeatAt: "2026-07-29T12:07:00.000Z" }),
    runningSource({ heartbeatAt: "2026-07-29T12:05:00Z" }),
    runningSource({ runId: 0 }),
    runningSource({ pid: -1 }),
    runningSource({ heartbeatHealth: "future" }),
    runningSource({ extra: forbiddenValues })
  ];

  for (const source of malformed) {
    const capturedLogs = [];
    const result = presenceAdapter.normalizeHermesPresenceObservation({
      profileName: "synthetic_profile",
      observedAt: EVALUATED_AT,
      runCandidates: [source],
      resolvePidLiveness: () => "alive",
      log(value) {
        capturedLogs.push(value);
      }
    });
    assert.deepEqual(result, {
      schemaVersion: "1.0",
      profileName: "synthetic_profile",
      observedAt: EVALUATED_AT,
      sourceStatus: "unavailable",
      reason: "invalid_source",
      currentRun: null,
      decisiveEvent: null
    });
    const serialized = JSON.stringify({ result, capturedLogs });
    for (const forbidden of forbiddenValues) assert.equal(serialized.includes(forbidden), false);
  }

  for (const runCandidates of [[], [runningSource(), runningSource({ runId: 42 })]]) {
    const result = presenceAdapter.normalizeHermesPresenceObservation({
      profileName: "synthetic_profile",
      observedAt: EVALUATED_AT,
      runCandidates,
      resolvePidLiveness: () => "alive"
    });
    assert.equal(result.sourceStatus, runCandidates.length === 0 ? "unavailable" : "degraded");
    assert.equal(result.reason, runCandidates.length === 0 ? "invalid_source" : "ambiguous_run");
    assert.equal(result.currentRun, null);
    assert.equal(result.decisiveEvent, null);
  }
});

test("PID and heartbeat disagreement fails closed on getters proxies mutations exceptions and unknown values", () => {
  let getterReads = 0;
  let coercionReads = 0;
  const accessorRun = runningSource();
  Object.defineProperty(accessorRun, "pid", {
    enumerable: true,
    get() {
      getterReads += 1;
      return 4242;
    }
  });
  const throwingRun = new Proxy(runningSource(), {
    ownKeys() {
      throw new Error("private proxy exception text");
    }
  });
  const mutatingRun = runningSource();
  const mutatingCandidates = [mutatingRun];
  const cases = [
    {
      runCandidates: [accessorRun],
      resolvePidLiveness: () => "alive"
    },
    {
      runCandidates: [throwingRun],
      resolvePidLiveness: () => "alive"
    },
    {
      runCandidates: mutatingCandidates,
      resolvePidLiveness() {
        mutatingRun.pid = 9999;
        mutatingCandidates[0] = runningSource({ pid: 9999 });
        return "alive";
      }
    },
    {
      runCandidates: [runningSource()],
      resolvePidLiveness: () => new String("alive")
    },
    {
      runCandidates: [runningSource({
        taskId: {
          toString() {
            coercionReads += 1;
            return "t_aaaaaaaa";
          }
        }
      })],
      resolvePidLiveness: () => "alive"
    },
    {
      runCandidates: [runningSource()],
      resolvePidLiveness() {
        throw new Error("private liveness exception text");
      }
    }
  ];

  for (const value of cases) {
    const capturedLogs = [];
    const result = presenceAdapter.normalizeHermesPresenceObservation({
      profileName: "synthetic_profile",
      observedAt: EVALUATED_AT,
      ...value,
      log(entry) {
        capturedLogs.push(entry);
      }
    });
    assert.deepEqual(result, {
      schemaVersion: "1.0",
      profileName: "synthetic_profile",
      observedAt: EVALUATED_AT,
      sourceStatus: "unavailable",
      reason: "invalid_source",
      currentRun: null,
      decisiveEvent: null
    });
    const serialized = JSON.stringify({ result, capturedLogs });
    for (const forbidden of ["9999", "private proxy exception text", "private liveness exception text"]) {
      assert.equal(serialized.includes(forbidden), false);
    }
  }
  assert.equal(getterReads, 0);
  assert.equal(coercionReads, 0);

  const accessorOptions = {
    observedAt: EVALUATED_AT,
    runCandidates: [runningSource()],
    resolvePidLiveness: () => "alive"
  };
  Object.defineProperty(accessorOptions, "profileName", {
    enumerable: true,
    get() {
      getterReads += 1;
      return "synthetic_profile";
    }
  });
  assert.equal(presenceAdapter.normalizeHermesPresenceObservation(accessorOptions), null);
  assert.equal(getterReads, 0);
});

test("resolver rejects a reviewed mapping with an extra private field generically", () => {
  const result = resolveReviewedHostedIdentityMapping({
    mappingCandidates: [mapping()],
    installedProfileNames: ["synthetic_profile"],
    evaluatedAt: EVALUATED_AT,
    validateMapping() {
      return { ok: true, value: mapping({ privateToken: "must-not-escape" }) };
    }
  });

  assertRejected(result);
  assert.equal(JSON.stringify(result).includes("must-not-escape"), false);
});

test("resolver rejects a reviewed mapping with a missing required field generically", () => {
  const incomplete = mapping();
  delete incomplete.tenantId;
  const result = resolveReviewedHostedIdentityMapping({
    mappingCandidates: [mapping()],
    installedProfileNames: ["synthetic_profile"],
    evaluatedAt: EVALUATED_AT,
    validateMapping() {
      return { ok: true, value: incomplete };
    }
  });

  assertRejected(result);
});

test("resolver rejects a reviewed mapping with a malformed scalar generically", () => {
  const cases = [
    mapping({ schemaVersion: new String("1.0") }),
    mapping({ tenantId: "id_111111111111111G" }),
    mapping({ subjectId: "id_2222222222222222/path" }),
    mapping({ identityId: new String("stg-spiders") }),
    mapping({ profileName: new String("synthetic_profile") }),
    mapping({ registryRevision: -1 }),
    mapping({ registryRevision: -0 }),
    mapping({ registryRevision: 1.5 }),
    mapping({ registryRevision: Number.MAX_SAFE_INTEGER + 1 }),
    mapping({ synchronizedAt: new Date("2026-07-29T12:00:00.000Z") }),
    mapping({ synchronizedAt: "2026-07-29T12:00:00Z" }),
    mapping({ synchronizedAt: "2026-07-29T12:07:00.000Z" }),
    mapping({ status: new String("active") }),
    mapping({ status: "unknown" })
  ];

  for (const value of cases) {
    const result = resolveReviewedHostedIdentityMapping({
      mappingCandidates: [mapping()],
      installedProfileNames: ["synthetic_profile"],
      evaluatedAt: EVALUATED_AT,
      validateMapping() {
        return { ok: true, value };
      }
    });
    assertRejected(result);
  }
});

test("resolver rejects reviewed mappings with own symbols or accessors without invoking getters", () => {
  const symbolMapping = mapping();
  symbolMapping[Symbol("private")] = "must-not-escape";
  let getterReads = 0;
  const accessorMapping = mapping();
  Object.defineProperty(accessorMapping, "tenantId", {
    enumerable: true,
    get() {
      getterReads += 1;
      return "id_1111111111111111";
    }
  });
  const nonEnumerableMapping = mapping();
  Object.defineProperty(nonEnumerableMapping, "tenantId", { enumerable: false });
  const inheritedMapping = mapping();
  Object.setPrototypeOf(inheritedMapping, { privateToken: "must-not-escape" });

  for (const value of [symbolMapping, accessorMapping, nonEnumerableMapping, inheritedMapping]) {
    const result = resolveReviewedHostedIdentityMapping({
      mappingCandidates: [mapping()],
      installedProfileNames: ["synthetic_profile"],
      evaluatedAt: EVALUATED_AT,
      validateMapping() {
        return { ok: true, value };
      }
    });
    assertRejected(result);
  }
  assert.equal(getterReads, 0);
});

test("resolver rejects a reviewed mapping with a nested mutable value generically", () => {
  const nested = { privateToken: "must-not-escape" };
  const result = resolveReviewedHostedIdentityMapping({
    mappingCandidates: [mapping()],
    installedProfileNames: ["synthetic_profile"],
    evaluatedAt: EVALUATED_AT,
    validateMapping() {
      return { ok: true, value: mapping({ tenantId: nested }) };
    }
  });

  assertRejected(result);
  assert.equal(JSON.stringify(result).includes("must-not-escape"), false);
});

test("presence requires exactly one active reviewed stg-spiders profile mapping", () => {
  const reviewedSource = mapping();
  const result = resolveReviewedHostedIdentityMapping({
    mappingCandidates: [mapping()],
    installedProfileNames: ["synthetic_profile"],
    evaluatedAt: EVALUATED_AT,
    validateMapping() {
      return { ok: true, value: reviewedSource };
    }
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.value, mapping());
  assert.notEqual(result.value, reviewedSource);
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.value), true);
  reviewedSource.registryRevision = 8;
  assert.equal(result.value.registryRevision, 7);
});

test("reviewed mapping rejects missing ambiguous inactive malformed and unresolved candidates generically", () => {
  const cases = [
    [[], ["synthetic_profile"]],
    [[mapping(), mapping({ registryRevision: 8 })], ["synthetic_profile"]],
    [[mapping({ status: "revoked" })], ["synthetic_profile"]],
    [[mapping({ status: "retired" })], ["synthetic_profile"]],
    [[mapping({ identityId: "other-agent" })], ["synthetic_profile"]],
    [[mapping({ extra: true })], ["synthetic_profile"]],
    [[mapping({ schemaVersion: "2.0" })], ["synthetic_profile"]],
    [[mapping({ registryRevision: 1.5 })], ["synthetic_profile"]],
    [[mapping({ synchronizedAt: "2026-07-29T12:07:00.000Z" })], ["synthetic_profile"]],
    [[mapping()], []],
    [[mapping()], ["synthetic_profile", "synthetic_profile"]],
    [[mapping()], ["renamed_profile"]]
  ];

  for (const [mappingCandidates, installedProfileNames] of cases) {
    assertRejected(resolve(mappingCandidates, installedProfileNames));
  }
});

test("reviewed mapping snapshots bounded candidate and profile collections without invoking accessors", () => {
  const sparseCandidates = new Array(1);
  const symbolCandidates = [mapping()];
  symbolCandidates[Symbol("hidden")] = true;
  let candidateGetterReads = 0;
  const accessorCandidates = [];
  Object.defineProperty(accessorCandidates, "0", {
    enumerable: true,
    get() {
      candidateGetterReads += 1;
      return mapping();
    }
  });
  accessorCandidates.length = 1;
  const throwingCandidates = new Proxy([mapping()], {
    ownKeys() { throw new Error("sensitive candidate trap"); }
  });
  let candidateKeyReads = 0;
  const mutatingCandidates = new Proxy([mapping()], {
    ownKeys(target) {
      candidateKeyReads += 1;
      if (candidateKeyReads > 1) target[0] = mapping({ registryRevision: 8 });
      return Reflect.ownKeys(target);
    }
  });

  const sparseProfiles = new Array(1);
  const symbolProfiles = ["synthetic_profile"];
  symbolProfiles[Symbol("hidden")] = true;
  let profileGetterReads = 0;
  const accessorProfiles = [];
  Object.defineProperty(accessorProfiles, "0", {
    enumerable: true,
    get() {
      profileGetterReads += 1;
      return "synthetic_profile";
    }
  });
  accessorProfiles.length = 1;
  const throwingProfiles = new Proxy(["synthetic_profile"], {
    ownKeys() { throw new Error("sensitive profile trap"); }
  });
  let profileKeyReads = 0;
  const mutatingProfiles = new Proxy(["synthetic_profile"], {
    ownKeys(target) {
      profileKeyReads += 1;
      if (profileKeyReads > 1) target[0] = "renamed_profile";
      return Reflect.ownKeys(target);
    }
  });

  for (const candidates of [sparseCandidates, symbolCandidates, accessorCandidates,
    throwingCandidates, mutatingCandidates]) {
    assertRejected(resolve(candidates, ["synthetic_profile"]));
  }
  for (const profiles of [sparseProfiles, symbolProfiles, accessorProfiles,
    throwingProfiles, mutatingProfiles]) {
    assertRejected(resolve([mapping()], profiles));
  }
  assert.equal(candidateGetterReads, 0);
  assert.equal(profileGetterReads, 0);

  let validationCalls = 0;
  const oversizedResult = resolveReviewedHostedIdentityMapping({
    mappingCandidates: [mapping(), mapping(), mapping()],
    installedProfileNames: ["synthetic_profile"],
    evaluatedAt: EVALUATED_AT,
    validateMapping() {
      validationCalls += 1;
      return { ok: true, value: mapping() };
    }
  });
  assertRejected(oversizedResult);
  assert.equal(validationCalls, 0);

  const candidatesMutatedDuringValidation = [mapping()];
  const mutationResult = resolveReviewedHostedIdentityMapping({
    mappingCandidates: candidatesMutatedDuringValidation,
    installedProfileNames: ["synthetic_profile"],
    evaluatedAt: EVALUATED_AT,
    validateMapping(value, evaluatedAt) {
      const result = validateMapping(value, evaluatedAt);
      candidatesMutatedDuringValidation[0] = mapping({ registryRevision: 8 });
      return result;
    }
  });
  assertRejected(mutationResult);
});
