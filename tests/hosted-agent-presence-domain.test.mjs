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

function blockedDerivationInput(overrides = {}) {
  const source = {
    tenantId: TENANT_ID,
    sourceId: "id_4444444444444444",
    sourceRecordId: "synthetic-record-source",
    sourceEventId: "synthetic-block-event",
    contractVersion: "1.0",
    occurredAt: STARTED_AT,
    observedAt: HEARTBEAT_AT
  };
  const assignee = { tenantId: TENANT_ID, subjectId: SUBJECT_ID };
  const blockReason = {
    category: "synthetic-dependency",
    summary: "Synthetic prerequisite is unavailable.",
    resolutionAuthority: assignee,
    blockedAt: CHECKED_AT
  };
  return {
    schemaVersion: "1.0",
    profileName: "synthetic_profile",
    mapping: mapping(),
    record: {
      schemaVersion: "1.0",
      tenantId: TENANT_ID,
      recordId: RECORD_ID,
      state: "blocked",
      freshness: "live",
      assignees: [assignee],
      revision: 4,
      stateChangedAt: GENERATED_AT,
      recordedAt: OBSERVED_AT,
      blockReason,
      source
    },
    assignment: {
      tenantId: TENANT_ID,
      recordId: RECORD_ID,
      authorizationId: "id_5555555555555555",
      acceptedRevision: 3,
      assignees: [assignee],
      source
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
      auditEventId: "id_8888888888888888",
      tenantId: TENANT_ID,
      recordId: RECORD_ID,
      eventKind: "block",
      actor: assignee,
      onBehalfOf: null,
      authorizationRef: "id_7777777777777777",
      policyRevision: 9,
      occurredAt: CHECKED_AT,
      recordedAt: GENERATED_AT,
      priorRevision: 3,
      newRevision: 4,
      changedFields: [
        { field: "state", before: "active", after: "blocked" },
        { field: "blockReason", before: null, after: JSON.stringify(blockReason) }
      ],
      reasonRef: null,
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
    blockAuthorization: {
      provenance: "backend_trusted",
      auditEventId: "id_8888888888888888",
      authentication: { authenticated: true, subjectId: SUBJECT_ID },
      membership: { active: true, tenantId: TENANT_ID },
      permissions: ["transition"],
      decisionAuthorities: [],
      onBehalfOf: null,
      action: "transition",
      scope: RECORD_ID,
      authorizationRef: "id_7777777777777777",
      policyRevision: 9
    },
    checkedAt: EVALUATED_AT,
    generatedAt: EVALUATED_AT,
    ...overrides
  };
}

function constructTrustedBlockAuthorization(createContext, input) {
  const result = maybeConstructTrustedBlockAuthorization(createContext, input);
  assertAccepted(result);
  return input;
}

function maybeConstructTrustedBlockAuthorization(createContext, input) {
  if (input.blockAuthorization === null || typeof input.blockAuthorization !== "object" ||
      Array.isArray(input.blockAuthorization) || input.blockAuthorization.provenance !== "backend_trusted") {
    return { ok: false, code: "invalid_hosted_agent_presence" };
  }
  const { provenance: _provenance, ...facts } = input.blockAuthorization;
  const result = createContext(facts);
  if (result.ok) input.blockAuthorization = result.value;
  return result;
}

test("blocked accepts M3 durable transition chronology without collapsing source and append times", async () => {
  const {
    createTrustedBlockTransitionAuthorizationContext,
    derivePrivateHostedAgentBlockedPresence
  } = await loadDomain();
  const input = constructTrustedBlockAuthorization(
    createTrustedBlockTransitionAuthorizationContext,
    blockedDerivationInput()
  );

  const result = derivePrivateHostedAgentBlockedPresence(input);

  assertAccepted(result);
  assert.equal(result.value.presence.state, "blocked");
  assert.equal(result.value.presence.stateChangedAt, GENERATED_AT);
  assert.equal(result.value.presence.observedAt, GENERATED_AT);
});

test("blocked rejects paired unanchored assignment and audit authorization references", async () => {
  const {
    createTrustedBlockTransitionAuthorizationContext,
    derivePrivateHostedAgentBlockedPresence
  } = await loadDomain();
  const input = blockedDerivationInput();
  input.audit.authorizationRef = "id_aaaaaaaaaaaaaaaa";
  input.authorization.authorizationRef = "id_aaaaaaaaaaaaaaaa";
  constructTrustedBlockAuthorization(createTrustedBlockTransitionAuthorizationContext, input);

  const result = derivePrivateHostedAgentBlockedPresence(input);

  assertAccepted(result);
  assert.equal(result.value.presence.state, "unavailable");
  assert.equal(result.value.presence.recordRef, null);
});

test("blocked rejects three paired caller-authored authorization references", async () => {
  const { derivePrivateHostedAgentBlockedPresence } = await loadDomain();
  const input = JSON.parse(JSON.stringify(blockedDerivationInput()));
  input.audit.authorizationRef = "id_aaaaaaaaaaaaaaaa";
  input.authorization.authorizationRef = "id_aaaaaaaaaaaaaaaa";
  input.blockAuthorization.authorizationRef = "id_aaaaaaaaaaaaaaaa";

  const result = derivePrivateHostedAgentBlockedPresence(input);

  assertAccepted(result);
  assert.equal(result.value.presence.state, "unavailable");
  assert.equal(result.value.presence.recordRef, null);
});

test("blocked rejects policy revision zero across all coupled M3 facts", async () => {
  const {
    createTrustedBlockTransitionAuthorizationContext,
    derivePrivateHostedAgentBlockedPresence
  } = await loadDomain();
  const input = blockedDerivationInput();
  input.trace.policyRevision = 0;
  input.audit.policyRevision = 0;
  input.authorization.policyRevision = 0;
  input.blockAuthorization.policyRevision = 0;
  const construction = maybeConstructTrustedBlockAuthorization(
    createTrustedBlockTransitionAuthorizationContext,
    input
  );

  if (!construction.ok) assertRejected(construction);

  const result = derivePrivateHostedAgentBlockedPresence(input);

  assertAccepted(result);
  assert.equal(result.value.presence.state, "unavailable");
  assert.equal(result.value.presence.recordRef, null);
});

test("blocked trusts only the original backend-constructed authorization identity", async () => {
  const {
    createTrustedBlockTransitionAuthorizationContext,
    derivePrivateHostedAgentBlockedPresence
  } = await loadDomain();
  const trustedInput = constructTrustedBlockAuthorization(
    createTrustedBlockTransitionAuthorizationContext,
    blockedDerivationInput()
  );
  const trusted = trustedInput.blockAuthorization;
  const copiedContexts = [
    JSON.parse(JSON.stringify(trusted)),
    { ...trusted },
    structuredClone(trusted),
    new Proxy(trusted, {})
  ];

  for (const blockAuthorization of copiedContexts) {
    const input = blockedDerivationInput({ blockAuthorization });
    const result = derivePrivateHostedAgentBlockedPresence(input);
    if (!result.ok) {
      assertRejected(result);
    } else {
      assert.equal(result.value.presence.state, "unavailable");
      assert.equal(result.value.presence.recordRef, null);
    }
  }

  const accessorInput = blockedDerivationInput();
  Object.defineProperty(accessorInput, "blockAuthorization", {
    enumerable: true,
    get() { return trusted; }
  });
  assertRejected(derivePrivateHostedAgentBlockedPresence(accessorInput));
});

test("blocked rejects an audit actor different from the trusted block actor", async () => {
  const {
    createTrustedBlockTransitionAuthorizationContext,
    derivePrivateHostedAgentBlockedPresence
  } = await loadDomain();
  const input = blockedDerivationInput();
  input.blockAuthorization.authentication.subjectId = "id_cccccccccccccccc";
  constructTrustedBlockAuthorization(createTrustedBlockTransitionAuthorizationContext, input);

  const result = derivePrivateHostedAgentBlockedPresence(input);

  assertAccepted(result);
  assert.equal(result.value.presence.state, "unavailable");
  assert.equal(result.value.presence.recordRef, null);
});

test("blocked authority anchors the accepted material audit identity", async () => {
  const {
    createTrustedBlockTransitionAuthorizationContext,
    derivePrivateHostedAgentBlockedPresence
  } = await loadDomain();
  const input = constructTrustedBlockAuthorization(
    createTrustedBlockTransitionAuthorizationContext,
    blockedDerivationInput()
  );

  const result = derivePrivateHostedAgentBlockedPresence(input);

  assertAccepted(result);
  assert.equal(result.value.presence.state, "blocked");
});

test("blocked accepts a null M3 resolution authority", async () => {
  const {
    createTrustedBlockTransitionAuthorizationContext,
    derivePrivateHostedAgentBlockedPresence
  } = await loadDomain();
  const input = blockedDerivationInput();
  input.record.blockReason.resolutionAuthority = null;
  input.audit.changedFields[1].after = JSON.stringify(input.record.blockReason);
  constructTrustedBlockAuthorization(createTrustedBlockTransitionAuthorizationContext, input);

  const result = derivePrivateHostedAgentBlockedPresence(input);

  assertAccepted(result);
  assert.equal(result.value.presence.state, "blocked");
});

test("blocked accepts a same-tenant M3 resolution authority distinct from the assignee", async () => {
  const {
    createTrustedBlockTransitionAuthorizationContext,
    derivePrivateHostedAgentBlockedPresence
  } = await loadDomain();
  const input = blockedDerivationInput();
  input.record.blockReason.resolutionAuthority = {
    tenantId: TENANT_ID,
    subjectId: "id_cccccccccccccccc"
  };
  input.audit.changedFields[1].after = JSON.stringify(input.record.blockReason);
  constructTrustedBlockAuthorization(createTrustedBlockTransitionAuthorizationContext, input);

  const result = derivePrivateHostedAgentBlockedPresence(input);

  assertAccepted(result);
  assert.equal(result.value.presence.state, "blocked");
});

test("blocked accepts same-tenant on-behalf-of when coupled to trusted block authority", async () => {
  const {
    createTrustedBlockTransitionAuthorizationContext,
    derivePrivateHostedAgentBlockedPresence
  } = await loadDomain();
  const input = blockedDerivationInput();
  const onBehalfOf = { tenantId: TENANT_ID, subjectId: "id_cccccccccccccccc" };
  input.audit.onBehalfOf = onBehalfOf;
  input.blockAuthorization.onBehalfOf = onBehalfOf;
  constructTrustedBlockAuthorization(createTrustedBlockTransitionAuthorizationContext, input);

  const result = derivePrivateHostedAgentBlockedPresence(input);

  assertAccepted(result);
  assert.equal(result.value.presence.state, "blocked");
});

test("blocked requires current blocked record and matching material block audit without block text", async () => {
  const {
    createTrustedBlockTransitionAuthorizationContext,
    derivePrivateHostedAgentBlockedPresence
  } = await loadDomain();

  assert.equal(typeof derivePrivateHostedAgentBlockedPresence, "function");
  const result = derivePrivateHostedAgentBlockedPresence(constructTrustedBlockAuthorization(
    createTrustedBlockTransitionAuthorizationContext,
    blockedDerivationInput()
  ));
  assertAccepted(result);
  assert.equal(result.value.presence.state, "blocked");
  assert.equal(result.value.presence.freshness, "live");
  assert.equal(result.value.presence.stateChangedAt, GENERATED_AT);
  assert.equal(result.value.presence.observedAt, GENERATED_AT);
  assert.equal(result.value.presence.checkedAt, EVALUATED_AT);
  assert.deepEqual(result.value.presence.recordRef, response().presence.recordRef);

  assert.deepEqual(Object.keys(result.value).sort(), ["generatedAt", "presence", "schemaVersion", "tenantId"]);
  assert.deepEqual(Object.keys(result.value.presence).sort(), [
    "checkedAt", "displayName", "freshness", "identityId", "observedAt", "reason", "recordRef", "roleLabel",
    "state", "stateChangedAt", "workplace"
  ]);
  const serialized = JSON.stringify(result.value);
  for (const forbidden of [
    "synthetic-dependency", "Synthetic prerequisite is unavailable.", "resolutionAuthority", "auditEventId",
    "id_8888888888888888", "actor", "onBehalfOf", "authorizationRef", "blockAuthorization",
    "backend_trusted", "id_7777777777777777", "sourceId",
    "id_4444444444444444", "changedFields", "blockReason", "t_a1b2c3d4", "\"pid\"", "\"provider\"", "credential"
  ]) {
    assert.equal(serialized.includes(forbidden), false, `serialized blocked response leaked ${forbidden}`);
  }

  const OTHER_TENANT_ID = "id_aaaaaaaaaaaaaaaa";
  const OTHER_RECORD_ID = "id_bbbbbbbbbbbbbbbb";
  const OTHER_SUBJECT_ID = "id_cccccccccccccccc";
  const cases = [
    ["mapping omitted", (input) => { delete input.mapping; }],
    ["mapping ambiguous", (input) => { input.mapping = [input.mapping, mapping()]; }],
    ["mapping subject mismatch", (input) => { input.mapping.subjectId = OTHER_SUBJECT_ID; }],
    ["mapping profile mismatch", (input) => { input.mapping.profileName = "other_profile"; }],
    ["mapping revision mismatch", (input) => { input.trace.mappingRevision = 8; }],
    ["record omitted", (input) => { delete input.record; }],
    ["record state only", (input) => { delete input.audit; }],
    ["record state mismatch", (input) => { input.record.state = "active"; }],
    ["record subject omitted", (input) => { input.record.assignees = []; }],
    ["record subject mismatch", (input) => {
      input.record.assignees = [{ tenantId: TENANT_ID, subjectId: OTHER_SUBJECT_ID }];
    }],
    ["record tenant mismatch", (input) => {
      input.record.tenantId = OTHER_TENANT_ID;
      input.record.assignees = [{ tenantId: OTHER_TENANT_ID, subjectId: SUBJECT_ID }];
      input.record.blockReason.resolutionAuthority = { tenantId: OTHER_TENANT_ID, subjectId: SUBJECT_ID };
      input.record.source = { ...input.record.source, tenantId: OTHER_TENANT_ID };
    }],
    ["block reason omitted", (input) => { delete input.record.blockReason; }],
    ["block reason malformed", (input) => { input.record.blockReason.summary = ""; }],
    ["block reason changed without matching audit delta", (input) => {
      input.record.blockReason.resolutionAuthority = { tenantId: TENANT_ID, subjectId: OTHER_SUBJECT_ID };
    }],
    ["block reason foreign authority", (input) => {
      input.record.blockReason.resolutionAuthority = { tenantId: OTHER_TENANT_ID, subjectId: OTHER_SUBJECT_ID };
      input.audit.changedFields[1].after = JSON.stringify(input.record.blockReason);
    }],
    ["block reason malformed authority", (input) => {
      input.record.blockReason.resolutionAuthority = { tenantId: TENANT_ID, subjectId: "id_short" };
      input.audit.changedFields[1].after = JSON.stringify(input.record.blockReason);
    }],
    ["assignment omitted", (input) => { delete input.assignment; }],
    ["assignment revision mismatch", (input) => { input.assignment.acceptedRevision = 2; }],
    ["assignment authorization mismatch", (input) => {
      input.assignment.authorizationId = "id_dddddddddddddddd";
    }],
    ["trace omitted", (input) => { delete input.trace; }],
    ["trace record revision mismatch", (input) => { input.trace.recordRevision = 3; }],
    ["audit omitted", (input) => { delete input.audit; }],
    ["audit stale prior revision", (input) => { input.audit.priorRevision = 2; }],
    ["audit stale current revision", (input) => { input.audit.newRevision = 3; }],
    ["audit event kind mismatch", (input) => { input.audit.eventKind = "state_transition"; }],
    ["audit foreign tenant", (input) => {
      input.audit.tenantId = OTHER_TENANT_ID;
      input.audit.actor = { tenantId: OTHER_TENANT_ID, subjectId: SUBJECT_ID };
      input.audit.source = { ...input.audit.source, tenantId: OTHER_TENANT_ID };
    }],
    ["audit foreign record", (input) => { input.audit.recordId = OTHER_RECORD_ID; }],
    ["audit actor mismatch", (input) => {
      input.audit.actor = { tenantId: TENANT_ID, subjectId: OTHER_SUBJECT_ID };
    }],
    ["audit authorization mismatch", (input) => {
      input.audit.authorizationRef = "id_dddddddddddddddd";
    }],
    ["audit policy mismatch", (input) => { input.audit.policyRevision = 10; }],
    ["audit source mismatch", (input) => {
      input.audit.source = { ...input.audit.source, sourceEventId: "other-block-event" };
    }],
    ["audit fabricated state delta", (input) => { input.audit.changedFields[0].before = "ready"; }],
    ["audit fabricated block delta", (input) => { input.audit.changedFields[1].after = "fabricated"; }],
    ["audit duplicate delta", (input) => {
      input.audit.changedFields = [input.audit.changedFields[0], { ...input.audit.changedFields[0] }];
    }],
    ["audit unknown key", (input) => { input.audit.privateText = "rejected private audit text"; }],
    ["authorization omitted", (input) => { delete input.authorization; }],
    ["authorization denied", (input) => { input.authorization.allowed = false; }],
    ["authorization policy mismatch", (input) => { input.authorization.policyRevision = 10; }],
    ["authorization source subject mismatch", (input) => {
      input.authorization.beneficiary = { tenantId: TENANT_ID, subjectId: OTHER_SUBJECT_ID };
    }],
    ["block authority omitted", (input) => { delete input.blockAuthorization; }],
    ["block authority duplicate", (input) => {
      input.blockAuthorization = [input.blockAuthorization, { ...input.blockAuthorization }];
    }],
    ["block authority malformed reference", (input) => {
      input.blockAuthorization.authorizationRef = "id_short";
    }],
    ["block authority audit identity mismatch", (input) => {
      input.blockAuthorization.auditEventId = "id_dddddddddddddddd";
    }],
    ["block authority untrusted provenance", (input) => {
      input.blockAuthorization.provenance = "caller_supplied";
    }],
    ["block authority wrong action", (input) => { input.blockAuthorization.action = "assign"; }],
    ["block authority missing permission", (input) => { input.blockAuthorization.permissions = []; }],
    ["block authority inactive authentication", (input) => {
      input.blockAuthorization.authentication.authenticated = false;
    }],
    ["block authority inactive membership", (input) => {
      input.blockAuthorization.membership.active = false;
    }],
    ["block authority foreign tenant", (input) => {
      input.blockAuthorization.membership.tenantId = OTHER_TENANT_ID;
    }],
    ["block authority foreign record scope", (input) => {
      input.blockAuthorization.scope = OTHER_RECORD_ID;
    }],
    ["block authority reference mismatch", (input) => {
      input.blockAuthorization.authorizationRef = "id_dddddddddddddddd";
    }],
    ["block authority policy mismatch", (input) => { input.blockAuthorization.policyRevision = 10; }],
    ["block authority unknown key", (input) => {
      input.blockAuthorization.privateAuthority = "rejected private authority text";
    }],
    ["audit foreign on-behalf-of", (input) => {
      input.audit.onBehalfOf = { tenantId: OTHER_TENANT_ID, subjectId: OTHER_SUBJECT_ID };
      input.blockAuthorization.onBehalfOf = input.audit.onBehalfOf;
    }],
    ["audit on-behalf-of authority mismatch", (input) => {
      input.audit.onBehalfOf = { tenantId: TENANT_ID, subjectId: OTHER_SUBJECT_ID };
    }],
    ["invalid block chronology", (input) => { input.audit.occurredAt = EVALUATED_AT; }],
    ["future record chronology", (input) => { input.record.recordedAt = EVALUATED_AT; }],
    ["task status only claim", (input) => { input.taskStatus = "blocked"; }],
    ["task text only claim", (input) => { input.taskBody = "Synthetic prerequisite is unavailable."; }],
    ["raw provider claim", (input) => { input.provider = "synthetic-provider"; }]
  ];

  for (const [name, mutate] of cases) {
    const input = blockedDerivationInput();
    mutate(input);
    maybeConstructTrustedBlockAuthorization(createTrustedBlockTransitionAuthorizationContext, input);
    const closed = derivePrivateHostedAgentBlockedPresence(input);
    if (!closed.ok) {
      assertRejected(closed);
    } else {
      assert.equal(closed.value.presence.state, "unavailable", name);
      assert.equal(closed.value.presence.recordRef, null, name);
    }
    const closedSerialized = JSON.stringify(closed);
    for (const forbidden of [
      "Synthetic prerequisite is unavailable.", "rejected private audit text", "synthetic-provider",
      "rejected private authority text", "synthetic-block-event", "other-block-event", "\"taskStatus\"",
      "\"taskBody\""
    ]) {
      assert.equal(closedSerialized.includes(forbidden), false, `${name} leaked ${forbidden}`);
    }
  }

  const accessorInput = blockedDerivationInput();
  Object.defineProperty(accessorInput.record.blockReason, "summary", {
    enumerable: true,
    get() { throw new Error("private block accessor text"); }
  });
  constructTrustedBlockAuthorization(createTrustedBlockTransitionAuthorizationContext, accessorInput);
  assertRejected(derivePrivateHostedAgentBlockedPresence(accessorInput));

  const proxyInput = blockedDerivationInput();
  proxyInput.audit = new Proxy(proxyInput.audit, {
    ownKeys() { throw new Error("private audit proxy text"); }
  });
  constructTrustedBlockAuthorization(createTrustedBlockTransitionAuthorizationContext, proxyInput);
  assertRejected(derivePrivateHostedAgentBlockedPresence(proxyInput));

  const mutationInput = blockedDerivationInput();
  let ownKeyReads = 0;
  mutationInput.audit = new Proxy(mutationInput.audit, {
    ownKeys(target) {
      ownKeyReads += 1;
      if (ownKeyReads > 1) target.newRevision = 3;
      return Reflect.ownKeys(target);
    }
  });
  constructTrustedBlockAuthorization(createTrustedBlockTransitionAuthorizationContext, mutationInput);
  assertRejected(derivePrivateHostedAgentBlockedPresence(mutationInput));
});

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
