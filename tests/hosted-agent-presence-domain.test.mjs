import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

async function loadDomain() {
  const source = await readFile(new URL("../src/domain/hostedAgentPresence.ts", import.meta.url), "utf8");
  const transpiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 }
  }).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(transpiled).toString("base64")}`);
}

const TENANT_ID = "id_1111111111111111";
const SUBJECT_ID = "id_2222222222222222";
const RECORD_ID = "id_3333333333333333";
const SYNCHRONIZED_AT = "2026-07-29T12:00:00.000Z";
const STARTED_AT = "2026-07-29T12:01:00.000Z";
const HEARTBEAT_AT = "2026-07-29T12:02:00.000Z";
const OBSERVED_AT = "2026-07-29T12:03:00.000Z";
const CHECKED_AT = "2026-07-29T12:04:00.000Z";
const GENERATED_AT = "2026-07-29T12:05:00.000Z";
const EVALUATED_AT = "2026-07-29T12:06:00.000Z";

function mapping(overrides = {}) {
  return {
    schemaVersion: "1.0",
    tenantId: TENANT_ID,
    subjectId: SUBJECT_ID,
    identityId: "stg-spiders",
    profileName: "synthetic_profile",
    registryRevision: 7,
    synchronizedAt: SYNCHRONIZED_AT,
    status: "active",
    ...overrides
  };
}

function request(overrides = {}) {
  return {
    schemaVersion: "1.0",
    boardScope: "synthetic_board",
    profileName: "synthetic_profile",
    evaluatedAt: EVALUATED_AT,
    mappingRevision: 7,
    ...overrides
  };
}

function observation(overrides = {}) {
  return {
    schemaVersion: "1.0",
    profileName: "synthetic_profile",
    observedAt: OBSERVED_AT,
    sourceStatus: "available",
    reason: null,
    currentRun: {
      taskId: "t_a1b2c3d4",
      runId: 11,
      runStatus: "running",
      outcome: null,
      claimCurrent: true,
      spawnedEventPresent: true,
      pidLiveness: "alive",
      heartbeatAt: HEARTBEAT_AT,
      startedAt: STARTED_AT,
      endedAt: null
    },
    decisiveEvent: {
      eventId: 12,
      kind: "heartbeat",
      occurredAt: HEARTBEAT_AT
    },
    ...overrides
  };
}

function response(overrides = {}) {
  return {
    schemaVersion: "1.0",
    tenantId: TENANT_ID,
    generatedAt: GENERATED_AT,
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
      stateChangedAt: STARTED_AT,
      observedAt: OBSERVED_AT,
      checkedAt: CHECKED_AT,
      recordRef: {
        recordId: RECORD_ID,
        href: `/api/private/tenants/${TENANT_ID}/records/${RECORD_ID}`
      }
    },
    ...overrides
  };
}

function changedPresence(changes) {
  return response({ presence: { ...response().presence, ...changes } });
}

function changedRun(changes) {
  return observation({ currentRun: { ...observation().currentRun, ...changes } });
}

function assertRejected(result) {
  assert.deepEqual(result, { ok: false, code: "invalid_hosted_agent_presence" });
  assert.equal("value" in result, false);
  assert.equal(JSON.stringify(result).includes(TENANT_ID), false);
}

function assertAccepted(result) {
  assert.equal(result.ok, true);
}

function workingDerivationInput(overrides = {}) {
  const source = {
    tenantId: TENANT_ID,
    sourceId: "id_4444444444444444",
    sourceRecordId: "t_a1b2c3d4",
    sourceEventId: "11",
    contractVersion: "1.0",
    occurredAt: STARTED_AT,
    observedAt: OBSERVED_AT
  };
  const assignee = { tenantId: TENANT_ID, subjectId: SUBJECT_ID };
  return {
    schemaVersion: "1.0",
    mapping: mapping(),
    record: {
      schemaVersion: "1.0",
      tenantId: TENANT_ID,
      recordId: RECORD_ID,
      state: "active",
      freshness: "live",
      assignees: [assignee],
      revision: 4,
      stateChangedAt: STARTED_AT,
      recordedAt: OBSERVED_AT
    },
    assignment: {
      tenantId: TENANT_ID,
      recordId: RECORD_ID,
      authorizationId: "id_5555555555555555",
      acceptedRevision: 4,
      assignees: [assignee],
      source
    },
    activity: {
      activityId: "id_6666666666666666",
      tenantId: TENANT_ID,
      recordId: RECORD_ID,
      actor: assignee,
      eventKind: "work_started",
      source,
      occurredAt: STARTED_AT,
      observedAt: OBSERVED_AT,
      recordedAt: OBSERVED_AT
    },
    trace: {
      tenantId: TENANT_ID,
      recordId: RECORD_ID,
      recordRevision: 4,
      assignmentAuthorizationId: "id_5555555555555555",
      activityId: "id_6666666666666666",
      hermesTaskId: "t_a1b2c3d4",
      hermesRunId: 11,
      hermesEventId: 12,
      mappingRevision: 7,
      policyRevision: 9
    },
    audit: {
      tenantId: TENANT_ID,
      recordId: RECORD_ID,
      eventKind: "assignment",
      authorizationRef: "id_7777777777777777",
      policyRevision: 9,
      newRevision: 4,
      occurredAt: STARTED_AT,
      recordedAt: OBSERVED_AT,
      source
    },
    authorization: {
      tenantId: TENANT_ID,
      authorizationId: "id_5555555555555555",
      action: "assign",
      scope: RECORD_ID,
      beneficiary: assignee,
      authorizationRef: "id_7777777777777777",
      policyRevision: 9,
      allowed: true
    },
    observation: observation(),
    checkedAt: CHECKED_AT,
    generatedAt: GENERATED_AT,
    ...overrides
  };
}

test("working requires active M3 assignment accepted activity and one correlated current Hermes run", async () => {
  const { derivePrivateHostedAgentWorkingPresence } = await loadDomain();

  assert.equal(typeof derivePrivateHostedAgentWorkingPresence, "function");
  const result = derivePrivateHostedAgentWorkingPresence(workingDerivationInput());
  assertAccepted(result);
  assert.deepEqual(result.value, response());

  const mismatchedActivityTime = workingDerivationInput();
  mismatchedActivityTime.activity.observedAt = HEARTBEAT_AT;
  const mismatchResult = derivePrivateHostedAgentWorkingPresence(mismatchedActivityTime);
  assertAccepted(mismatchResult);
  assert.equal(mismatchResult.value.presence.state, "unavailable");
  assert.equal(mismatchResult.value.presence.recordRef, null);
  assert.equal(Object.isFrozen(mismatchResult.value), true);
  assert.equal(Object.isFrozen(mismatchResult.value.presence), true);

  const OTHER_SUBJECT_ID = "id_8888888888888888";
  const OTHER_TENANT_ID = "id_9999999999999999";
  const cases = [
    ["mapping revoked", (input) => { input.mapping.status = "revoked"; }],
    ["mapped subject mismatch", (input) => { input.mapping.subjectId = OTHER_SUBJECT_ID; }],
    ["mapped profile mismatch", (input) => { input.mapping.profileName = "other_profile"; }],
    ["mapping revision mismatch", (input) => { input.trace.mappingRevision = 8; }],
    ["record omitted", (input) => { delete input.record; }],
    ["record inactive", (input) => { input.record.state = "ready"; }],
    ["record freshness unsupported", (input) => { input.record.freshness = "stale"; }],
    ["record assignee omitted", (input) => { input.record.assignees = []; }],
    ["record assignee mismatch", (input) => {
      input.record.assignees = [{ tenantId: TENANT_ID, subjectId: OTHER_SUBJECT_ID }];
    }],
    ["record tenant mismatch", (input) => {
      input.record.tenantId = OTHER_TENANT_ID;
      input.record.assignees = [{ tenantId: OTHER_TENANT_ID, subjectId: SUBJECT_ID }];
    }],
    ["assignment omitted", (input) => { delete input.assignment; }],
    ["assignment assignee omitted", (input) => { input.assignment.assignees = []; }],
    ["assignment revision mismatch", (input) => { input.assignment.acceptedRevision = 3; }],
    ["assignment authorization mismatch", (input) => {
      input.assignment.authorizationId = "id_aaaaaaaaaaaaaaaa";
    }],
    ["assignment source mismatch", (input) => { input.assignment.source.sourceRecordId = "t_b1b2c3d4"; }],
    ["activity omitted", (input) => { delete input.activity; }],
    ["activity actor mismatch", (input) => { input.activity.actor.subjectId = OTHER_SUBJECT_ID; }],
    ["activity lifecycle unsupported", (input) => { input.activity.eventKind = "review_requested"; }],
    ["activity trace mismatch", (input) => { input.activity.activityId = "id_aaaaaaaaaaaaaaaa"; }],
    ["activity source mismatch", (input) => { input.activity.source.sourceEventId = "99"; }],
    ["trace omitted", (input) => { delete input.trace; }],
    ["trace record revision mismatch", (input) => { input.trace.recordRevision = 3; }],
    ["trace task mismatch", (input) => { input.trace.hermesTaskId = "t_b1b2c3d4"; }],
    ["trace run mismatch", (input) => { input.trace.hermesRunId = 99; }],
    ["trace event mismatch", (input) => { input.trace.hermesEventId = 99; }],
    ["audit omitted", (input) => { delete input.audit; }],
    ["audit kind mismatch", (input) => { input.audit.eventKind = "block"; }],
    ["audit authorization mismatch", (input) => {
      input.audit.authorizationRef = "id_aaaaaaaaaaaaaaaa";
    }],
    ["audit policy mismatch", (input) => { input.audit.policyRevision = 10; }],
    ["audit revision mismatch", (input) => { input.audit.newRevision = 3; }],
    ["audit source mismatch", (input) => { input.audit.source.sourceEventId = "99"; }],
    ["authorization omitted", (input) => { delete input.authorization; }],
    ["authorization denied", (input) => { input.authorization.allowed = false; }],
    ["authorization subject mismatch", (input) => { input.authorization.subjectId = OTHER_SUBJECT_ID; }],
    ["authorization policy mismatch", (input) => { input.authorization.policyRevision = 10; }],
    ["observation omitted", (input) => { delete input.observation; }],
    ["observation degraded", (input) => {
      input.observation.sourceStatus = "degraded";
      input.observation.reason = "ambiguous_run";
    }],
    ["current run omitted", (input) => {
      input.observation.currentRun = null;
      input.observation.decisiveEvent = null;
    }],
    ["terminal run", (input) => {
      Object.assign(input.observation.currentRun, {
        runStatus: "done", outcome: "completed", claimCurrent: false,
        pidLiveness: "not_applicable", endedAt: OBSERVED_AT
      });
      Object.assign(input.observation.decisiveEvent, { kind: "completed", occurredAt: OBSERVED_AT });
    }],
    ["non-current claim", (input) => { input.observation.currentRun.claimCurrent = false; }],
    ["spawn omitted", (input) => {
      input.observation.currentRun.spawnedEventPresent = false;
      input.observation.currentRun.pidLiveness = "unknown";
    }],
    ["contradictory dead liveness", (input) => { input.observation.currentRun.pidLiveness = "dead"; }],
    ["future activity recording", (input) => { input.activity.recordedAt = EVALUATED_AT; }],
    ["duplicate assignee", (input) => { input.record.assignees.push(input.record.assignees[0]); }],
    ["unknown task text", (input) => { input.record.title = "must not derive state"; }],
    ["raw PID", (input) => { input.observation.currentRun.pid = 1234; }],
    ["provider metadata", (input) => { input.provider = "synthetic-provider"; }],
    ["ambiguous mapping", (input) => { input.mapping = [input.mapping, mapping()]; }],
    ["ambiguous run", (input) => {
      input.observation.currentRun = [input.observation.currentRun, { ...input.observation.currentRun }];
    }]
  ];

  for (const [name, mutate] of cases) {
    const input = workingDerivationInput();
    mutate(input);
    const rejected = derivePrivateHostedAgentWorkingPresence(input);
    if (!rejected.ok) {
      assertRejected(rejected);
      continue;
    }
    assert.equal(rejected.value.presence?.state, "unavailable", name);
    assert.equal(rejected.value.presence?.recordRef, null, name);
    assert.deepEqual(Object.keys(rejected.value).sort(), ["generatedAt", "presence", "schemaVersion", "tenantId"]);
    assert.deepEqual(Object.keys(rejected.value.presence).sort(), [
      "checkedAt", "displayName", "freshness", "identityId", "observedAt", "reason", "recordRef", "roleLabel",
      "state", "stateChangedAt", "workplace"
    ]);
    const serialized = JSON.stringify(rejected.value);
    for (const forbidden of [
      "t_a1b2c3d4", "synthetic_profile", "id_4444444444444444", "id_5555555555555555",
      "id_6666666666666666", "id_7777777777777777", "must not derive state", "synthetic-provider",
      "\"pid\"", "\"provider\"", "credential"
    ]) {
      assert.equal(serialized.includes(forbidden), false, `${name} leaked ${forbidden}`);
    }
  }

  const accessorInput = workingDerivationInput();
  Object.defineProperty(accessorInput, "checkedAt", {
    enumerable: true,
    get() { throw new Error("private accessor text"); }
  });
  assertRejected(derivePrivateHostedAgentWorkingPresence(accessorInput));
  const throwingInput = new Proxy(workingDerivationInput(), {
    ownKeys() { throw new Error("private proxy text"); }
  });
  assertRejected(derivePrivateHostedAgentWorkingPresence(throwingInput));
});

test("working rejects a paired assignment and trace authorization mutation disconnected from accepted authority", async () => {
  const { derivePrivateHostedAgentWorkingPresence } = await loadDomain();
  const input = workingDerivationInput();
  input.assignment.authorizationId = "id_aaaaaaaaaaaaaaaa";
  input.trace.assignmentAuthorizationId = "id_aaaaaaaaaaaaaaaa";

  const result = derivePrivateHostedAgentWorkingPresence(input);

  assertAccepted(result);
  assert.equal(result.value.presence.state, "unavailable");
  assert.equal(result.value.presence.recordRef, null);
});

test("working consumes a closed M3 assignment authorization fact without authority leakage", async () => {
  const { derivePrivateHostedAgentWorkingPresence } = await loadDomain();
  const OTHER_TENANT_ID = "id_9999999999999999";
  const OTHER_SUBJECT_ID = "id_8888888888888888";
  const cases = [
    ["omitted", (input) => { delete input.authorization; }],
    ["malformed id", (input) => { input.authorization.authorizationId = "id_short"; }],
    ["wrong action", (input) => { input.authorization.action = "read"; }],
    ["foreign tenant", (input) => {
      input.authorization.tenantId = OTHER_TENANT_ID;
      input.authorization.beneficiary.tenantId = OTHER_TENANT_ID;
    }],
    ["foreign record scope", (input) => { input.authorization.scope = "id_aaaaaaaaaaaaaaaa"; }],
    ["foreign beneficiary", (input) => { input.authorization.beneficiary.subjectId = OTHER_SUBJECT_ID; }],
    ["policy revision mismatch", (input) => { input.authorization.policyRevision = 10; }],
    ["unknown key", (input) => { input.authorization.rawAuthority = "private authority text"; }]
  ];

  for (const [name, mutate] of cases) {
    const input = workingDerivationInput();
    mutate(input);
    const result = derivePrivateHostedAgentWorkingPresence(input);
    if (!result.ok) {
      assertRejected(result);
    } else {
      assert.equal(result.value.presence.state, "unavailable", name);
      assert.equal(result.value.presence.recordRef, null, name);
    }
    const serialized = JSON.stringify(result);
    assert.equal(serialized.includes("id_5555555555555555"), false, `${name} leaked authorization id`);
    assert.equal(serialized.includes("private authority text"), false, `${name} leaked rejected authority`);
  }

  const accessorInput = workingDerivationInput();
  Object.defineProperty(accessorInput.authorization, "authorizationId", {
    enumerable: true,
    get() { throw new Error("private authorization accessor text"); }
  });
  assertRejected(derivePrivateHostedAgentWorkingPresence(accessorInput));

  const proxyInput = workingDerivationInput();
  proxyInput.authorization = new Proxy(proxyInput.authorization, {
    ownKeys() { throw new Error("private authorization proxy text"); }
  });
  assertRejected(derivePrivateHostedAgentWorkingPresence(proxyInput));

  const mutationInput = workingDerivationInput();
  let ownKeyReads = 0;
  mutationInput.authorization = new Proxy(mutationInput.authorization, {
    ownKeys(target) {
      ownKeyReads += 1;
      if (ownKeyReads > 1) target.authorizationId = "id_aaaaaaaaaaaaaaaa";
      return Reflect.ownKeys(target);
    }
  });
  assertRejected(derivePrivateHostedAgentWorkingPresence(mutationInput));
});

test("working rejects a record state change later than the emitted observation", async () => {
  const {
    derivePrivateHostedAgentWorkingPresence,
    validatePrivateHostedAgentPresenceResponse
  } = await loadDomain();
  const input = workingDerivationInput();
  input.record.stateChangedAt = CHECKED_AT;
  input.record.recordedAt = CHECKED_AT;

  const result = derivePrivateHostedAgentWorkingPresence(input);

  assertAccepted(result);
  assert.equal(result.value.presence.state, "unavailable");
  assertAccepted(validatePrivateHostedAgentPresenceResponse(result.value, EVALUATED_AT));
});

test("hosted presence rejects every noncanonical scalar cross-field contradiction mutation and future value without projecting an agent", async () => {
  const {
    validateReviewedHostedIdentityMapping,
    validateHermesPresenceReadRequest,
    validateHermesPresenceObservation,
    validatePrivateHostedAgentPresenceResponse
  } = await loadDomain();

  assertAccepted(validateReviewedHostedIdentityMapping(mapping(), EVALUATED_AT));
  assertAccepted(validateHermesPresenceReadRequest(request(), mapping(), EVALUATED_AT));
  assertAccepted(validateHermesPresenceObservation(observation(), request()));
  assertAccepted(validatePrivateHostedAgentPresenceResponse(response(), EVALUATED_AT));
  assertAccepted(validatePrivateHostedAgentPresenceResponse(
    response({ presence: null }),
    EVALUATED_AT
  ));

  const mappingCases = [
    null, [], { ...mapping(), extra: true }, { ...mapping(), tenantId: "ID_1111111111111111" },
    { ...mapping(), subjectId: "id_short" }, { ...mapping(), identityId: "Spiders" },
    { ...mapping(), profileName: "../synthetic" }, { ...mapping(), profileName: "a".repeat(65) },
    { ...mapping(), registryRevision: -0 }, { ...mapping(), registryRevision: 1.5 },
    { ...mapping(), registryRevision: Number.MAX_SAFE_INTEGER + 1 },
    { ...mapping(), synchronizedAt: "2026-07-29T12:00:00Z" },
    { ...mapping(), synchronizedAt: "2026-02-30T12:00:00.000Z" },
    { ...mapping(), synchronizedAt: "2026-07-29T12:07:00.000Z" },
    { ...mapping(), status: "future" }
  ];
  for (const value of mappingCases) {
    assertRejected(validateReviewedHostedIdentityMapping(value, EVALUATED_AT));
  }

  const requestCases = [
    { ...request(), unknown: null }, { ...request(), schemaVersion: "2.0" },
    { ...request(), boardScope: "https://opaque.invalid" }, { ...request(), profileName: "other_profile" },
    { ...request(), mappingRevision: 8 }, { ...request(), mappingRevision: NaN },
    { ...request(), evaluatedAt: "2026-07-29T11:59:59.999Z" },
    { ...request(), evaluatedAt: "2026-07-29T12:07:00.000Z" }
  ];
  for (const value of requestCases) {
    assertRejected(validateHermesPresenceReadRequest(value, mapping(), EVALUATED_AT));
  }

  const observationCases = [
    { ...observation(), extra: true }, { ...observation(), profileName: "wrong_profile" },
    { ...observation(), observedAt: "2026-07-29T12:07:00.000Z" },
    { ...observation(), sourceStatus: "available", reason: "invalid_source" },
    { ...observation(), sourceStatus: "degraded", reason: "board_unavailable" },
    { ...observation(), sourceStatus: "unavailable", reason: "ambiguous_run" },
    { ...observation(), currentRun: null }, { ...observation(), decisiveEvent: null },
    changedRun({ taskId: "T_a1b2c3d4" }), changedRun({ runId: 0 }),
    changedRun({ runId: 1.5 }), changedRun({ runStatus: "future" }),
    changedRun({ outcome: "completed" }), changedRun({ claimCurrent: false }),
    changedRun({ spawnedEventPresent: false, pidLiveness: "alive" }),
    changedRun({ pidLiveness: "not_applicable" }),
    changedRun({ startedAt: "2026-07-29T12:04:00.000Z" }),
    changedRun({ heartbeatAt: "2026-07-29T12:00:00.000Z" }),
    changedRun({ endedAt: GENERATED_AT }),
    observation({ decisiveEvent: { ...observation().decisiveEvent, eventId: 0 } }),
    observation({ decisiveEvent: { ...observation().decisiveEvent, kind: "completed" } }),
    observation({ decisiveEvent: { ...observation().decisiveEvent, occurredAt: GENERATED_AT } }),
    changedRun({ runStatus: "done", outcome: "completed", claimCurrent: false,
      pidLiveness: "not_applicable", endedAt: CHECKED_AT })
  ];
  for (const value of observationCases) {
    assertRejected(validateHermesPresenceObservation(value, request()));
  }

  const unavailable = changedPresence({
    state: "unavailable",
    freshness: "degraded",
    reason: "source_unavailable",
    stateChangedAt: null,
    observedAt: null,
    recordRef: null
  });
  assertAccepted(validatePrivateHostedAgentPresenceResponse(unavailable, EVALUATED_AT));

  const responseCases = [
    undefined, [], { ...response(), extra: true }, { ...response(), schemaVersion: "1.1" },
    { ...response(), tenantId: "id_ABCDEFABCDEFABCD" },
    { ...response(), generatedAt: "2026-07-29T12:07:00.000Z" },
    changedPresence({ identityId: "future-agent" }), changedPresence({ displayName: "spiders" }),
    changedPresence({ roleLabel: "Agent" }),
    changedPresence({ workplace: { ...response().presence.workplace, relationship: "future" } }),
    changedPresence({ state: "future" }), changedPresence({ freshness: "degraded" }),
    changedPresence({ reason: "source_stale" }), changedPresence({ stateChangedAt: null }),
    changedPresence({ observedAt: null }), changedPresence({ recordRef: null }),
    changedPresence({ checkedAt: "2026-07-29T12:02:00.000Z" }),
    changedPresence({ stateChangedAt: CHECKED_AT }),
    changedPresence({ recordRef: { recordId: RECORD_ID, href: `https://opaque.invalid/${RECORD_ID}` } }),
    changedPresence({ recordRef: { recordId: RECORD_ID, href: `/api/private/tenants/${TENANT_ID}/records/../${RECORD_ID}` } }),
    changedPresence({ recordRef: { recordId: RECORD_ID, href: `/api/private/tenants/${TENANT_ID}/records/${RECORD_ID}?x=1` } }),
    changedPresence({ recordRef: { recordId: "id_4444444444444444", href: response().presence.recordRef.href } }),
    response({ presence: { ...unavailable.presence, freshness: "live" } }),
    response({ presence: { ...unavailable.presence, reason: null } }),
    response({ presence: { ...unavailable.presence, recordRef: response().presence.recordRef } })
  ];
  for (const value of responseCases) {
    assertRejected(validatePrivateHostedAgentPresenceResponse(value, EVALUATED_AT));
  }

  const getterPayload = response();
  Object.defineProperty(getterPayload, "generatedAt", {
    enumerable: true,
    get() { throw new Error("sensitive thrown text"); }
  });
  const symbolPayload = response();
  symbolPayload[Symbol("hidden")] = true;
  const nonEnumerablePayload = response();
  Object.defineProperty(nonEnumerablePayload, "hidden", { value: true });
  const inheritedPayload = Object.assign(Object.create({ hidden: true }), response());
  const throwingProxy = new Proxy(response(), {
    ownKeys() { throw new Error("sensitive proxy text"); }
  });
  let ownKeyReads = 0;
  const mutatingProxy = new Proxy(response(), {
    ownKeys(target) {
      ownKeyReads += 1;
      if (ownKeyReads > 1) target.generatedAt = EVALUATED_AT;
      return Reflect.ownKeys(target);
    }
  });
  for (const value of [getterPayload, symbolPayload, nonEnumerablePayload, inheritedPayload,
    throwingProxy, mutatingProxy, new String("not primitive")]) {
    assertRejected(validatePrivateHostedAgentPresenceResponse(value, EVALUATED_AT));
  }
});

test("private hosted presence rejects duplicate JSON keys before parsing", async () => {
  const { parsePrivateHostedAgentPresenceResponseJson } = await loadDomain();
  const valid = JSON.stringify(response({ presence: null }));
  assertAccepted(parsePrivateHostedAgentPresenceResponseJson(valid, EVALUATED_AT));

  const duplicate = valid.replace(
    '"schemaVersion":"1.0"',
    '"schemaVersion":"1.0","schemaVersion":"1.0"'
  );
  assertRejected(parsePrivateHostedAgentPresenceResponseJson(duplicate, EVALUATED_AT));
  assertRejected(parsePrivateHostedAgentPresenceResponseJson('{"tenantId":"sensitive",', EVALUATED_AT));
});

test("hosted presence observation rejects a malformed request board scope", async () => {
  const { validateHermesPresenceObservation } = await loadDomain();

  assertRejected(validateHermesPresenceObservation(observation(), request({ boardScope: "../invalid" })));
});

test("hosted presence observation rejects invalid request mapping revisions", async () => {
  const { validateHermesPresenceObservation } = await loadDomain();

  for (const mappingRevision of [-1, -0, 1.5, NaN, Number.MAX_SAFE_INTEGER + 1]) {
    assertRejected(validateHermesPresenceObservation(observation(), request({ mappingRevision })));
  }
});

test("hosted presence snapshot bounds wide and aggregate object traversal", async () => {
  const { validatePrivateHostedAgentPresenceResponse } = await loadDomain();
  const wideTarget = Object.fromEntries(
    Array.from({ length: 5_000 }, (_, index) => [`field_${index}`, index])
  );
  let descriptorReads = 0;
  const wideProxy = new Proxy(wideTarget, {
    getOwnPropertyDescriptor(target, key) {
      descriptorReads += 1;
      return Reflect.getOwnPropertyDescriptor(target, key);
    }
  });

  assertRejected(validatePrivateHostedAgentPresenceResponse(wideProxy, EVALUATED_AT));
  assert.ok(descriptorReads <= 128, `descriptor traversal was not bounded: ${descriptorReads}`);

  let ownKeyReads = 0;
  const bushyProxy = (depth) => new Proxy(depth === 0 ? {} : {
    left: bushyProxy(depth - 1),
    middle: bushyProxy(depth - 1),
    right: bushyProxy(depth - 1)
  }, {
    ownKeys(target) {
      ownKeyReads += 1;
      return Reflect.ownKeys(target);
    }
  });
  assertRejected(validatePrivateHostedAgentPresenceResponse(bushyProxy(6), EVALUATED_AT));
  assert.ok(ownKeyReads <= 128, `aggregate object traversal was not bounded: ${ownKeyReads}`);
});

test("hosted presence snapshot explicitly bounds recursive depth", async () => {
  const { validatePrivateHostedAgentPresenceResponse } = await loadDomain();
  let ownKeyReads = 0;
  let deepProxy = {};
  for (let depth = 0; depth < 100; depth += 1) {
    deepProxy = new Proxy({ nested: deepProxy }, {
      ownKeys(target) {
        ownKeyReads += 1;
        return Reflect.ownKeys(target);
      }
    });
  }

  assertRejected(validatePrivateHostedAgentPresenceResponse(deepProxy, EVALUATED_AT));
  assert.ok(ownKeyReads <= 17, `recursive depth was not explicitly bounded: ${ownKeyReads}`);
});

test("accepted hosted presence is a detached recursively immutable snapshot", async () => {
  const { validatePrivateHostedAgentPresenceResponse } = await loadDomain();
  const source = response();
  const result = validatePrivateHostedAgentPresenceResponse(source, EVALUATED_AT);
  assertAccepted(result);
  source.presence.workplace.label = "mutated source";
  assert.equal(result.value.presence.workplace.label, "Chief Agent Office");
  assert.equal(Object.isFrozen(result.value), true);
  assert.equal(Object.isFrozen(result.value.presence), true);
  assert.equal(Object.isFrozen(result.value.presence.workplace), true);
  assert.equal(Object.isFrozen(result.value.presence.recordRef), true);
});
