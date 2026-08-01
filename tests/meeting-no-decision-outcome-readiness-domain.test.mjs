import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

function transpile(source) {
  return ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 }
  }).outputText;
}

function moduleUrl(source, fragment) {
  return `data:text/javascript;base64,${Buffer.from(transpile(source)).toString("base64")}#${fragment}`;
}

async function loadMeetingNoDecisionOutcomeReadinessModule(fragment) {
  const [source, sessionSource, meetingSource, invitationSource, participationSource] = await Promise.all([
    readFile(new URL("../src/domain/meetingNoDecisionOutcomeReadiness.ts", import.meta.url), "utf8").catch(() => ""),
    readFile(new URL("../src/domain/meetingSessionStartEvent.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/domain/meetingReadiness.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/domain/meetingInvitationReadiness.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/domain/meetingParticipationReadiness.ts", import.meta.url), "utf8")
  ]);
  const meetingUrl = moduleUrl(meetingSource, `${fragment}-meeting`);
  const invitationUrl = moduleUrl(invitationSource, `${fragment}-invitation`);
  const linkedParticipation = transpile(participationSource)
    .replace('"./meetingReadiness"', JSON.stringify(meetingUrl))
    .replace('"./meetingInvitationReadiness"', JSON.stringify(invitationUrl));
  const participationUrl = `data:text/javascript;base64,${Buffer.from(linkedParticipation).toString("base64")}#${fragment}-participation`;
  const linkedSession = transpile(sessionSource)
    .replace('"./meetingReadiness"', JSON.stringify(meetingUrl))
    .replace('"./meetingInvitationReadiness"', JSON.stringify(invitationUrl))
    .replace('"./meetingParticipationReadiness"', JSON.stringify(participationUrl));
  const sessionUrl = `data:text/javascript;base64,${Buffer.from(linkedSession).toString("base64")}#${fragment}-session`;
  const linkedSource = transpile(source)
    .replace('"./meetingSessionStartEvent"', JSON.stringify(sessionUrl));
  return import(`data:text/javascript;base64,${Buffer.from(linkedSource).toString("base64")}#${fragment}`);
}

async function loadWithSyntheticSessionValidator(fragment, authorityField, authorityValue) {
  const source = await readFile(
    new URL("../src/domain/meetingNoDecisionOutcomeReadiness.ts", import.meta.url),
    "utf8"
  );
  const sessionValue = {
    schemaVersion: "session-start-event/1",
    eventReference: "syn-session-start-event-01",
    occurredAt: "2000-01-01T00:01:30.000Z",
    purposeReference: "syn-purpose-01",
    participantReference: "syn-participant-01",
    participationAuthorizationReference: "syn-participation-authorization-01",
    materialReferences: ["syn-material-01"],
    trustState: "unverified",
    grantsStart: false,
    grantsAccess: false,
    grantsOccupancy: false,
    [authorityField]: authorityValue
  };
  const sessionSource = `export function validateMeetingSessionStartEvent() { return ${JSON.stringify(sessionValue)}; }`;
  const sessionUrl = moduleUrl(sessionSource, `${fragment}-synthetic-session-validator`);
  const linkedSource = transpile(source)
    .replace('"./meetingSessionStartEvent"', JSON.stringify(sessionUrl));
  return import(`data:text/javascript;base64,${Buffer.from(linkedSource).toString("base64")}#${fragment}`);
}

function meetingCandidate() {
  return {
    schemaVersion: "readiness/1",
    purpose: {
      reference: "syn-purpose-01",
      summary: "Synthetic no-decision outcome readiness exercise"
    },
    participants: [{
      participantReference: "syn-participant-01",
      authorizationReference: "syn-participation-authorization-01",
      attendanceAuthority: "readiness-only"
    }],
    materials: [{
      materialReference: "syn-material-01",
      evidenceReference: "syn-evidence-01"
    }],
    lifecycle: {
      state: "ready",
      preparedAt: "2000-01-01T00:00:00.000Z",
      readyAt: "2000-01-01T00:01:00.000Z"
    },
    outcome: {
      state: "no-outcome-yet",
      provenanceReference: "syn-provenance-01"
    }
  };
}

function invitationCandidate() {
  return {
    schemaVersion: "invitation-readiness/1",
    invitationReference: "syn-invitation-01",
    issuer: {
      subjectReference: "syn-issuer-01",
      issuanceAuthorizationReference: "syn-issuance-authorization-01"
    },
    recipient: {
      subjectReference: "syn-participant-01",
      participationAuthorizationReference: "syn-participation-authorization-01"
    },
    purpose: { reference: "syn-purpose-01" },
    materials: [{
      materialReference: "syn-material-01",
      evidenceReference: "syn-evidence-01"
    }],
    access: { scope: "readiness-only", grantsAccess: false },
    lifecycle: { state: "prepared" },
    validity: {
      preparedAt: "2000-01-01T00:00:00.000Z",
      validFrom: "2000-01-01T00:00:30.000Z",
      expiresAt: "2000-01-01T00:02:00.000Z"
    },
    revocation: {
      state: "not-revoked-yet",
      authorityReference: "syn-revocation-authority-01"
    }
  };
}

function participationWrapper(meeting = meetingCandidate(), invitation = invitationCandidate()) {
  return JSON.stringify({
    schemaVersion: "participation-readiness/1",
    meetingReadiness: JSON.stringify(meeting),
    invitationReadiness: JSON.stringify(invitation)
  });
}

function sessionStartEventWrapper({
  meeting = meetingCandidate(),
  participation = participationWrapper(meeting),
  eventReference = "syn-session-start-event-01",
  occurredAt = "2000-01-01T00:01:30.000Z",
  additions = {}
} = {}) {
  return JSON.stringify({
    schemaVersion: "session-start-event/1",
    eventReference,
    occurredAt,
    meetingReadiness: JSON.stringify(meeting),
    participationReadiness: participation,
    ...additions
  });
}

function outcomeWrapper({
  outcomeReference = "syn-no-decision-outcome-01",
  endedAt = "2000-01-01T00:01:45.000Z",
  sessionStartEvent = sessionStartEventWrapper(),
  additions = {}
} = {}) {
  return JSON.stringify({
    schemaVersion: "no-decision-outcome-readiness/1",
    outcomeReference,
    endedAt,
    sessionStartEvent,
    resultState: "no-decision",
    ...additions
  });
}

test("no-decision outcome readiness rejects malformed nested session start and non-increasing chronology without granting completion access or occupancy", async () => {
  const module = await loadMeetingNoDecisionOutcomeReadinessModule("first-tracer");
  const validate = module.validateMeetingNoDecisionOutcomeReadiness;

  for (const candidate of [
    outcomeWrapper({ sessionStartEvent: "{}" }),
    outcomeWrapper({ endedAt: "2000-01-01T00:01:30.000Z" }),
    outcomeWrapper({ endedAt: "2000-01-01T00:01:29.999Z" })
  ]) {
    const accepted = typeof validate === "function" ? validate(candidate) : "validator-missing";
    assert.equal(accepted, null);
    assert.equal(accepted?.grantsCompletion ?? false, false);
    assert.equal(accepted?.grantsAccess ?? false, false);
    assert.equal(accepted?.grantsOccupancy ?? false, false);
  }
});

test("no-decision outcome readiness accepts one exact synthetic candidate as a detached deeply frozen unverified value with no recorded outcome or grants", async () => {
  const module = await loadMeetingNoDecisionOutcomeReadinessModule("exact-candidate");
  const accepted = module.validateMeetingNoDecisionOutcomeReadiness(outcomeWrapper());
  const expected = {
    schemaVersion: "no-decision-outcome-readiness/1",
    outcomeReference: "syn-no-decision-outcome-01",
    endedAt: "2000-01-01T00:01:45.000Z",
    purposeReference: "syn-purpose-01",
    participantReference: "syn-participant-01",
    participationAuthorizationReference: "syn-participation-authorization-01",
    materialReferences: ["syn-material-01"],
    resultState: "no-decision",
    trustState: "unverified",
    recordsOutcome: false,
    grantsCompletion: false,
    grantsAccess: false,
    grantsOccupancy: false
  };

  assert.deepEqual(accepted, expected);
  assert.notEqual(accepted, expected);
  assert.notEqual(accepted.materialReferences, expected.materialReferences);
  const stack = [accepted];
  while (stack.length > 0) {
    const value = stack.pop();
    assert.equal(Object.isFrozen(value), true);
    for (const child of Object.values(value)) {
      if (child !== null && typeof child === "object") stack.push(child);
    }
  }
  assert.equal(JSON.stringify(accepted), JSON.stringify(expected));
  assert.equal(accepted.trustState, "unverified");
  assert.equal(accepted.recordsOutcome, false);
  assert.equal(accepted.grantsCompletion, false);
  assert.equal(accepted.grantsAccess, false);
  assert.equal(accepted.grantsOccupancy, false);
  assert.equal("sessionStartEvent" in accepted, false);
  assert.equal("meeting" in accepted, false);
  assert.equal("outcome" in accepted, false);
});

test("no-decision outcome readiness rejects noncanonical duplicate unknown reordered omitted and authority-shaped outer keys", async () => {
  const module = await loadMeetingNoDecisionOutcomeReadinessModule("canonical-outer-contract");
  const canonical = outcomeWrapper();
  const parsed = JSON.parse(canonical);
  const duplicate = canonical.replace(
    '{"schemaVersion":"no-decision-outcome-readiness/1",',
    '{"schemaVersion":"no-decision-outcome-readiness/1","schemaVersion":"no-decision-outcome-readiness/1",'
  );
  const reordered = JSON.stringify({
    outcomeReference: parsed.outcomeReference,
    schemaVersion: parsed.schemaVersion,
    endedAt: parsed.endedAt,
    sessionStartEvent: parsed.sessionStartEvent,
    resultState: parsed.resultState
  });
  const omitted = JSON.stringify({
    schemaVersion: parsed.schemaVersion,
    outcomeReference: parsed.outcomeReference,
    endedAt: parsed.endedAt,
    sessionStartEvent: parsed.sessionStartEvent
  });

  for (const candidate of [
    `${canonical}\n`,
    `${canonical}null`,
    duplicate,
    reordered,
    omitted,
    outcomeWrapper({ additions: { unknown: true } }),
    outcomeWrapper({ additions: { recordsOutcome: true } }),
    outcomeWrapper({ additions: { grantsCompletion: true } }),
    outcomeWrapper({ additions: { grantsAccess: true } }),
    outcomeWrapper({ additions: { grantsOccupancy: true } })
  ]) {
    assert.equal(module.validateMeetingNoDecisionOutcomeReadiness(candidate), null);
  }
});

test("no-decision outcome readiness rejects malformed outcome identifiers and collisions with every exposed nested reference", async () => {
  const module = await loadMeetingNoDecisionOutcomeReadinessModule("outcome-reference-contract");

  for (const outcomeReference of [
    "real-outcome-01",
    "syn-No-Decision-01",
    "syn-no-decision-01-",
    `syn-${"a".repeat(61)}`,
    "syn-session-start-event-01",
    "syn-purpose-01",
    "syn-participant-01",
    "syn-participation-authorization-01",
    "syn-material-01"
  ]) {
    assert.equal(
      module.validateMeetingNoDecisionOutcomeReadiness(outcomeWrapper({ outcomeReference })),
      null
    );
  }
});

test("no-decision outcome readiness rejects malformed and noncanonical end timestamps", async () => {
  const module = await loadMeetingNoDecisionOutcomeReadinessModule("ended-at-contract");

  for (const endedAt of [
    "2000-01-01T00:01:45Z",
    "2000-01-01T00:01:45.000+00:00",
    "2000-02-30T00:01:45.000Z",
    "not-a-timestamp"
  ]) {
    assert.equal(
      module.validateMeetingNoDecisionOutcomeReadiness(outcomeWrapper({ endedAt })),
      null
    );
  }
});

test("no-decision outcome readiness rejects authority-expanded accepted nested session values", async () => {
  for (const [field, value] of [
    ["trustState", "verified"],
    ["grantsStart", true],
    ["grantsAccess", true],
    ["grantsOccupancy", true]
  ]) {
    const module = await loadWithSyntheticSessionValidator(
      `nested-authority-${field}`,
      field,
      value
    );
    assert.equal(module.validateMeetingNoDecisionOutcomeReadiness(outcomeWrapper()), null);
  }
});

test("no-decision outcome readiness rejects impossible nested timestamps after global Date replacement", async () => {
  const module = await loadMeetingNoDecisionOutcomeReadinessModule("forged-global-date");
  const originalDate = globalThis.Date;
  const impossiblePreparedAt = "2000-01-01T00:00:60.000Z";
  const impossibleReadyAt = "2000-01-01T00:01:60.000Z";
  const forgedTimestamps = new Map([
    [impossiblePreparedAt, 1],
    [impossibleReadyAt, 2]
  ]);
  const forgedCanonicalTimestamps = new Map([
    [1, impossiblePreparedAt],
    [2, impossibleReadyAt]
  ]);

  class ForgedDate extends originalDate {
    static parse(value) {
      return forgedTimestamps.get(value) ?? originalDate.parse(value);
    }

    toISOString() {
      return forgedCanonicalTimestamps.get(this.getTime()) ?? super.toISOString();
    }
  }

  const meeting = meetingCandidate();
  meeting.lifecycle.preparedAt = impossiblePreparedAt;
  meeting.lifecycle.readyAt = impossibleReadyAt;
  let accepted;
  globalThis.Date = ForgedDate;
  try {
    accepted = module.validateMeetingNoDecisionOutcomeReadiness(outcomeWrapper({
      sessionStartEvent: sessionStartEventWrapper({ meeting })
    }));
  } finally {
    globalThis.Date = originalDate;
  }

  assert.equal(accepted, null);
  assert.equal(accepted?.grantsCompletion ?? false, false);
  assert.equal(accepted?.grantsAccess ?? false, false);
  assert.equal(accepted?.grantsOccupancy ?? false, false);
});

test("no-decision outcome readiness rejects primitive traps and over-limit input before parse while captured intrinsics preserve validation and output integrity", async () => {
  const canonical = outcomeWrapper();
  const malformedIdentifier = outcomeWrapper({ outcomeReference: "real-outcome-01" });
  const module = await loadMeetingNoDecisionOutcomeReadinessModule("hostile-boundary");
  let trapCalls = 0;
  const proxy = new Proxy({}, {
    get() {
      trapCalls += 1;
      throw new Error("non-string input must not be read");
    },
    getPrototypeOf() {
      trapCalls += 1;
      throw new Error("non-string input must not be inspected");
    },
    ownKeys() {
      trapCalls += 1;
      throw new Error("non-string input must not be enumerated");
    }
  });

  for (const candidate of [
    undefined, null, false, 1, 1n, Symbol("no-decision-outcome"),
    {}, [], new String(canonical), proxy
  ]) {
    assert.equal(module.validateMeetingNoDecisionOutcomeReadiness(candidate), null);
  }
  assert.equal(trapCalls, 0);

  const originalParse = JSON.parse;
  let overLimitParseCalls = 0;
  JSON.parse = (...args) => {
    overLimitParseCalls += 1;
    return originalParse(...args);
  };
  try {
    assert.equal(module.validateMeetingNoDecisionOutcomeReadiness("x".repeat(65_537)), null);
  } finally {
    JSON.parse = originalParse;
  }
  assert.equal(overLimitParseCalls, 0);

  const originals = {
    parse: JSON.parse,
    stringify: JSON.stringify,
    isArray: Array.isArray,
    freeze: Object.freeze,
    defineProperty: Object.defineProperty,
    parseTimestamp: Date.parse,
    isFinite: Number.isFinite,
    regexpTest: RegExp.prototype.test
  };
  const calls = {
    parse: 0, stringify: 0, isArray: 0, freeze: 0,
    defineProperty: 0, parseTimestamp: 0, isFinite: 0, regexpTest: 0
  };
  let malformedAccepted;
  let accepted;
  JSON.parse = (...args) => {
    calls.parse += 1;
    return originals.parse(...args);
  };
  JSON.stringify = (...args) => {
    calls.stringify += 1;
    return originals.stringify(...args);
  };
  Array.isArray = (...args) => {
    calls.isArray += 1;
    return originals.isArray(...args);
  };
  Object.freeze = (value) => {
    calls.freeze += 1;
    return value;
  };
  Object.defineProperty = (target, property, descriptor) => {
    calls.defineProperty += 1;
    if (descriptor?.value === "syn-material-01") descriptor.value = "syn-material-forged";
    return originals.defineProperty(target, property, descriptor);
  };
  Date.parse = (...args) => {
    calls.parseTimestamp += 1;
    return originals.parseTimestamp(...args);
  };
  Number.isFinite = (...args) => {
    calls.isFinite += 1;
    return originals.isFinite(...args);
  };
  RegExp.prototype.test = () => {
    calls.regexpTest += 1;
    return true;
  };
  try {
    malformedAccepted = module.validateMeetingNoDecisionOutcomeReadiness(malformedIdentifier);
    accepted = module.validateMeetingNoDecisionOutcomeReadiness(canonical);
  } finally {
    JSON.parse = originals.parse;
    JSON.stringify = originals.stringify;
    Array.isArray = originals.isArray;
    Object.freeze = originals.freeze;
    Object.defineProperty = originals.defineProperty;
    Date.parse = originals.parseTimestamp;
    Number.isFinite = originals.isFinite;
    RegExp.prototype.test = originals.regexpTest;
  }
  assert.equal(malformedAccepted, null);
  assert.notEqual(accepted, null);
  assert.deepEqual(accepted.materialReferences, ["syn-material-01"]);
  assert.equal(Object.isFrozen(accepted.materialReferences), true);
  assert.equal(Object.isFrozen(accepted), true);
  assert.equal(Object.values(calls).some((count) => count > 0), true);
});
