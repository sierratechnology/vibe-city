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

async function loadMeetingSessionStartEventModule(fragment) {
  const [source, meetingSource, invitationSource, participationSource] = await Promise.all([
    readFile(new URL("../src/domain/meetingSessionStartEvent.ts", import.meta.url), "utf8").catch(() => ""),
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
  const linkedSource = transpile(source)
    .replace('"./meetingReadiness"', JSON.stringify(meetingUrl))
    .replace('"./meetingInvitationReadiness"', JSON.stringify(invitationUrl))
    .replace('"./meetingParticipationReadiness"', JSON.stringify(participationUrl));
  return import(`data:text/javascript;base64,${Buffer.from(linkedSource).toString("base64")}#${fragment}`);
}

function meetingCandidate() {
  return {
    schemaVersion: "readiness/1",
    purpose: {
      reference: "syn-purpose-01",
      summary: "Synthetic session-start readiness exercise"
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

function eventWrapper({
  meeting = meetingCandidate(),
  participation = participationWrapper(),
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

test("session-start event rejects recipient authorization purpose or material mismatches without granting start access or occupancy", async () => {
  const module = await loadMeetingSessionStartEventModule("join-mismatches");
  assert.equal(typeof module.validateMeetingSessionStartEvent, "function");

  const mismatches = [];
  for (const field of ["recipient", "authorization", "purpose", "material"]) {
    const meeting = meetingCandidate();
    if (field === "recipient") meeting.participants[0].participantReference = "syn-participant-02";
    if (field === "authorization") {
      meeting.participants[0].authorizationReference = "syn-participation-authorization-02";
    }
    if (field === "purpose") meeting.purpose.reference = "syn-purpose-02";
    if (field === "material") meeting.materials[0].materialReference = "syn-material-02";
    mismatches.push(eventWrapper({ meeting }));
  }

  for (const candidate of mismatches) {
    const accepted = module.validateMeetingSessionStartEvent(candidate);
    assert.equal(accepted, null);
    assert.equal(accepted?.grantsStart ?? false, false);
    assert.equal(accepted?.grantsAccess ?? false, false);
    assert.equal(accepted?.grantsOccupancy ?? false, false);
  }
});

test("session-start event accepts one exact synthetic candidate as a detached deeply frozen unverified value with every grant false", async () => {
  const module = await loadMeetingSessionStartEventModule("exact-candidate");
  const accepted = module.validateMeetingSessionStartEvent(eventWrapper());
  const expected = {
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
  assert.equal(accepted.trustState, "unverified");
  assert.equal(accepted.grantsStart, false);
  assert.equal(accepted.grantsAccess, false);
  assert.equal(accepted.grantsOccupancy, false);
  assert.equal("meeting" in accepted, false);
  assert.equal("outcome" in accepted, false);
  assert.equal("activeMeeting" in accepted, false);
});

test("session-start event rejects invalid chronology noncanonical duplicate malformed unknown-key and authority-expanding candidates", async () => {
  const module = await loadMeetingSessionStartEventModule("closed-contract");
  const canonical = eventWrapper();
  const parsed = JSON.parse(canonical);
  const invitation = invitationCandidate();
  invitation.access.grantsAccess = true;
  const authorityExpandingParticipation = participationWrapper(meetingCandidate(), invitation);
  const provenanceCollisionMeeting = meetingCandidate();
  provenanceCollisionMeeting.outcome.provenanceReference = "syn-session-start-event-01";
  const duplicateKey = canonical.replace(
    '{"schemaVersion":"session-start-event/1",',
    '{"schemaVersion":"session-start-event/1","schemaVersion":"session-start-event/1",'
  );
  const reordered = JSON.stringify({
    eventReference: parsed.eventReference,
    schemaVersion: parsed.schemaVersion,
    occurredAt: parsed.occurredAt,
    meetingReadiness: parsed.meetingReadiness,
    participationReadiness: parsed.participationReadiness
  });

  for (const candidate of [
    eventWrapper({ occurredAt: "2000-01-01T00:00:59.999Z" }),
    eventWrapper({ occurredAt: "2000-01-01T00:02:00.000Z" }),
    eventWrapper({ occurredAt: "2000-01-01T00:01:30Z" }),
    eventWrapper({ occurredAt: "2000-02-30T00:01:30.000Z" }),
    eventWrapper({ eventReference: "syn-purpose-01" }),
    eventWrapper({ eventReference: "syn-invitation-01" }),
    eventWrapper({
      meeting: provenanceCollisionMeeting,
      participation: participationWrapper(provenanceCollisionMeeting)
    }),
    eventWrapper({ eventReference: "real-session-start-event" }),
    eventWrapper({ additions: { unknown: true } }),
    eventWrapper({ additions: { grantsStart: true } }),
    eventWrapper({ participation: `${participationWrapper()}\n` }),
    eventWrapper({ participation: authorityExpandingParticipation }),
    `${canonical}\n`,
    duplicateKey,
    reordered,
    `${canonical}null`,
    "{"
  ]) {
    assert.doesNotThrow(() => {
      assert.equal(module.validateMeetingSessionStartEvent(candidate), null);
    });
  }

  const atReady = module.validateMeetingSessionStartEvent(eventWrapper({
    occurredAt: "2000-01-01T00:01:00.000Z"
  }));
  assert.equal(atReady?.occurredAt, "2000-01-01T00:01:00.000Z");
  assert.equal(atReady?.grantsStart, false);
});

test("session-start event rejects primitive traps and over-limit input before parse while captured intrinsics preserve validation and output integrity", async () => {
  const module = await loadMeetingSessionStartEventModule("hostile-boundary");
  const canonical = eventWrapper();
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
    undefined,
    null,
    false,
    1,
    1n,
    Symbol("session-start-event"),
    {},
    [],
    new String(canonical),
    proxy
  ]) {
    assert.equal(module.validateMeetingSessionStartEvent(candidate), null);
  }
  assert.equal(trapCalls, 0);

  const originalParse = JSON.parse;
  let parseCalls = 0;
  JSON.parse = (...args) => {
    parseCalls += 1;
    return originalParse(...args);
  };
  try {
    assert.equal(module.validateMeetingSessionStartEvent("x".repeat(32_769)), null);
  } finally {
    JSON.parse = originalParse;
  }
  assert.equal(parseCalls, 0);

  const originalTest = RegExp.prototype.test;
  RegExp.prototype.test = () => true;
  try {
    assert.equal(module.validateMeetingSessionStartEvent(eventWrapper({
      eventReference: "real-session-start-event"
    })), null);
  } finally {
    RegExp.prototype.test = originalTest;
  }

  const originalFreeze = Object.freeze;
  const originalDefineProperty = Object.defineProperty;
  const originalPush = Array.prototype.push;
  let accepted;
  Object.freeze = (value) => value;
  Object.defineProperty = function (target, property, descriptor) {
    if (descriptor?.value === "syn-material-01") descriptor.value = "syn-material-forged";
    return originalDefineProperty(target, property, descriptor);
  };
  Array.prototype.push = function (...items) {
    return originalPush.apply(
      this,
      items.map((item) => item === "syn-material-01" ? "syn-material-forged" : item)
    );
  };
  try {
    accepted = module.validateMeetingSessionStartEvent(canonical);
  } finally {
    Object.freeze = originalFreeze;
    Object.defineProperty = originalDefineProperty;
    Array.prototype.push = originalPush;
  }
  assert.notEqual(accepted, null);
  assert.deepEqual(accepted.materialReferences, ["syn-material-01"]);
  assert.equal(Object.isFrozen(accepted.materialReferences), true);
  assert.equal(Object.isFrozen(accepted), true);
  assert.equal(accepted.grantsStart, false);

  const meeting = meetingCandidate();
  const participation = participationWrapper();
  const detached = module.validateMeetingSessionStartEvent(eventWrapper({ meeting, participation }));
  meeting.purpose.reference = "syn-purpose-changed";
  meeting.materials[0].materialReference = "syn-material-changed";
  assert.equal(detached.purposeReference, "syn-purpose-01");
  assert.deepEqual(detached.materialReferences, ["syn-material-01"]);
});

test("session-start event rejects forbidden nested meeting provenance after targeted RegExp test replacement", async () => {
  const module = await loadMeetingSessionStartEventModule("nested-meeting-regexp-integrity");
  const meeting = meetingCandidate();
  meeting.outcome.provenanceReference = "real-provenance";
  const candidate = eventWrapper({
    meeting,
    participation: participationWrapper(meeting)
  });
  const originalTest = RegExp.prototype.test;
  RegExp.prototype.test = function (value) {
    if (this.source === "^syn-[a-z0-9]+(?:-[a-z0-9]+)*$") return true;
    return originalTest.call(this, value);
  };
  try {
    assert.equal(module.validateMeetingSessionStartEvent(candidate), null);
  } finally {
    RegExp.prototype.test = originalTest;
  }
});
