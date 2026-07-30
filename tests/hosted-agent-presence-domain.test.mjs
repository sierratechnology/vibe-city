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
