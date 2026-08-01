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

async function loadMeetingParticipationReadinessModule(fragment) {
  const [source, meetingSource, invitationSource] = await Promise.all([
    readFile(new URL("../src/domain/meetingParticipationReadiness.ts", import.meta.url), "utf8").catch(() => ""),
    readFile(new URL("../src/domain/meetingReadiness.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/domain/meetingInvitationReadiness.ts", import.meta.url), "utf8")
  ]);
  const meetingUrl = moduleUrl(meetingSource, `${fragment}-meeting`);
  const invitationUrl = moduleUrl(invitationSource, `${fragment}-invitation`);
  const linkedSource = transpile(source)
    .replace('"./meetingReadiness"', JSON.stringify(meetingUrl))
    .replace('"./meetingInvitationReadiness"', JSON.stringify(invitationUrl));
  return import(`data:text/javascript;base64,${Buffer.from(linkedSource).toString("base64")}#${fragment}`);
}

function meetingCandidate() {
  return {
    schemaVersion: "readiness/1",
    purpose: {
      reference: "syn-purpose-01",
      summary: "Synthetic participation readiness exercise"
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
    access: {
      scope: "readiness-only",
      grantsAccess: false
    },
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

function participationSerializedWrapper(meetingReadiness, invitationReadiness, additions = {}) {
  return JSON.stringify({
    schemaVersion: "participation-readiness/1",
    meetingReadiness,
    invitationReadiness,
    ...additions
  });
}

function participationWrapper(meeting = meetingCandidate(), invitation = invitationCandidate()) {
  return participationSerializedWrapper(JSON.stringify(meeting), JSON.stringify(invitation));
}

test("participation readiness rejects recipient or participation authorization mismatches without granting access or occupancy", async () => {
  const module = await loadMeetingParticipationReadinessModule("participant-match");
  assert.equal(typeof module.validateMeetingParticipationReadiness, "function");

  for (const mismatch of ["recipient", "authorization"]) {
    const invitation = invitationCandidate();
    if (mismatch === "recipient") invitation.recipient.subjectReference = "syn-participant-02";
    if (mismatch === "authorization") {
      invitation.recipient.participationAuthorizationReference = "syn-participation-authorization-02";
    }
    const accepted = module.validateMeetingParticipationReadiness(
      participationWrapper(meetingCandidate(), invitation)
    );
    assert.equal(accepted, null);
    assert.equal(accepted?.grantsAccess ?? false, false);
    assert.equal(accepted?.grantsOccupancy ?? false, false);
  }
});

test("participation readiness accepts one exact synthetic join as a detached deeply frozen readiness-only value", async () => {
  const module = await loadMeetingParticipationReadinessModule("exact-match");
  const accepted = module.validateMeetingParticipationReadiness(participationWrapper());
  const expected = {
    schemaVersion: "participation-readiness/1",
    invitationReference: "syn-invitation-01",
    participantReference: "syn-participant-01",
    participationAuthorizationReference: "syn-participation-authorization-01",
    purposeReference: "syn-purpose-01",
    materialReferences: ["syn-material-01"],
    readiness: { state: "prepared" },
    grantsAccess: false,
    grantsOccupancy: false
  };

  assert.deepEqual(accepted, expected);
  assert.notEqual(accepted, expected);
  assert.notEqual(accepted.materialReferences, expected.materialReferences);
  assert.notEqual(accepted.readiness, expected.readiness);

  const stack = [accepted];
  while (stack.length > 0) {
    const value = stack.pop();
    assert.equal(Object.isFrozen(value), true);
    for (const child of Object.values(value)) {
      if (child !== null && typeof child === "object") stack.push(child);
    }
  }
  assert.equal(accepted.grantsAccess, false);
  assert.equal(accepted.grantsOccupancy, false);
});

test("participation readiness preserves exact material references after Array.prototype.push replacement", async () => {
  const module = await loadMeetingParticipationReadinessModule("mutable-push-integrity");
  const originalPush = Array.prototype.push;
  Array.prototype.push = function (...items) {
    return originalPush.apply(
      this,
      items.map((item) => item === "syn-material-01" ? "syn-material-forged" : item)
    );
  };
  try {
    const accepted = module.validateMeetingParticipationReadiness(participationWrapper());
    assert.notEqual(accepted, null);
    assert.deepEqual(accepted.materialReferences, ["syn-material-01"]);
  } finally {
    Array.prototype.push = originalPush;
  }
});

test("participation readiness never accepts a material reference replaced by an inherited numeric setter", async () => {
  const module = await loadMeetingParticipationReadinessModule("inherited-index-integrity");
  const candidate = participationWrapper();
  const priorDescriptor = Object.getOwnPropertyDescriptor(Array.prototype, "0");
  let accepted;

  Object.defineProperty(Array.prototype, "0", {
    configurable: true,
    set(value) {
      Object.defineProperty(this, "0", {
        configurable: true,
        enumerable: true,
        value: value === "syn-material-01" ? "syn-material-forged" : value,
        writable: true
      });
    }
  });
  try {
    accepted = module.validateMeetingParticipationReadiness(candidate);
  } finally {
    if (priorDescriptor === undefined) delete Array.prototype[0];
    else Object.defineProperty(Array.prototype, "0", priorDescriptor);
  }

  assert.ok(accepted === null || accepted.materialReferences[0] === "syn-material-01");
  assert.notEqual(accepted?.materialReferences[0], "syn-material-forged");
});

test("participation readiness rejects purpose material canonicality validity and authority-expanding join disagreements", async () => {
  const module = await loadMeetingParticipationReadinessModule("join-disagreements");
  const rejected = [];
  const change = (mutateMeeting, mutateInvitation) => {
    const meeting = meetingCandidate();
    const invitation = invitationCandidate();
    mutateMeeting?.(meeting);
    mutateInvitation?.(invitation);
    rejected.push(participationWrapper(meeting, invitation));
  };

  change(null, (value) => { value.purpose.reference = "syn-purpose-02"; });
  change(null, (value) => { value.materials[0].evidenceReference = "syn-evidence-02"; });
  change(
    (value) => value.materials.push({
      materialReference: "syn-material-02",
      evidenceReference: "syn-evidence-02"
    }),
    (value) => {
      value.materials.push({
        materialReference: "syn-material-02",
        evidenceReference: "syn-evidence-02"
      });
      value.materials.reverse();
    }
  );
  change(null, (value) => value.materials.push({
    materialReference: "syn-material-02",
    evidenceReference: "syn-evidence-02"
  }));
  change(null, (value) => { value.validity.validFrom = "2000-01-01T00:01:01.000Z"; });
  change(null, (value) => { value.validity.expiresAt = "2000-01-01T00:01:00.000Z"; });
  change(null, (value) => { value.access.grantsAccess = true; });
  change((value) => { value.participants[0].attendanceAuthority = "attendance-authorized"; }, null);
  change((value) => { value.lifecycle.state = "active"; }, null);
  change((value) => { value.outcome.state = "decision"; }, null);

  const meeting = JSON.stringify(meetingCandidate());
  const invitation = JSON.stringify(invitationCandidate());
  rejected.push(participationSerializedWrapper(`${meeting}\n`, invitation));
  rejected.push(participationSerializedWrapper(meeting, `${invitation}\n`));
  rejected.push(participationSerializedWrapper(meeting, invitation, { unknown: true }));
  rejected.push(JSON.stringify({
    schemaVersion: "participation-readiness/2",
    meetingReadiness: meeting,
    invitationReadiness: invitation
  }));

  for (const candidate of rejected) {
    assert.equal(module.validateMeetingParticipationReadiness(candidate), null);
  }
});

test("participation readiness rejects hostile non-string bounded malformed and noncanonical input while remaining detached", async () => {
  const module = await loadMeetingParticipationReadinessModule("primitive-boundary");
  let trapCalls = 0;
  const proxy = new Proxy({}, {
    get() {
      trapCalls += 1;
      throw new Error("rejected value must not be coerced");
    },
    getPrototypeOf() {
      trapCalls += 1;
      throw new Error("rejected value must not be inspected");
    },
    ownKeys() {
      trapCalls += 1;
      throw new Error("rejected value must not be enumerated");
    }
  });
  const canonical = participationWrapper();

  for (const candidate of [
    undefined,
    null,
    false,
    1,
    1n,
    Symbol("participation-readiness"),
    {},
    [],
    new String(canonical),
    proxy
  ]) {
    assert.equal(module.validateMeetingParticipationReadiness(candidate), null);
  }
  assert.equal(trapCalls, 0);

  const duplicateKey = canonical.replace(
    '{"schemaVersion":"participation-readiness/1",',
    '{"schemaVersion":"participation-readiness/1","schemaVersion":"participation-readiness/1",'
  );
  const parsed = JSON.parse(canonical);
  const reordered = JSON.stringify({
    meetingReadiness: parsed.meetingReadiness,
    schemaVersion: parsed.schemaVersion,
    invitationReadiness: parsed.invitationReadiness
  });
  for (const malformed of ["", "{", "undefined", `${canonical}\n`, duplicateKey, reordered, `${canonical}null`]) {
    assert.doesNotThrow(() => {
      assert.equal(module.validateMeetingParticipationReadiness(malformed), null);
    });
  }

  const meeting = meetingCandidate();
  const invitation = invitationCandidate();
  const accepted = module.validateMeetingParticipationReadiness(participationWrapper(meeting, invitation));
  meeting.participants[0].participantReference = "syn-participant-changed";
  meeting.materials[0].materialReference = "syn-material-changed";
  invitation.invitationReference = "syn-invitation-changed";
  invitation.materials[0].materialReference = "syn-material-changed";
  assert.equal(accepted.participantReference, "syn-participant-01");
  assert.equal(accepted.invitationReference, "syn-invitation-01");
  assert.deepEqual(accepted.materialReferences, ["syn-material-01"]);

  const originalParse = JSON.parse;
  let parseCalls = 0;
  JSON.parse = (...args) => {
    parseCalls += 1;
    return originalParse(...args);
  };
  try {
    const boundedModule = await loadMeetingParticipationReadinessModule("over-limit-boundary");
    assert.equal(boundedModule.validateMeetingParticipationReadiness("x".repeat(20_001)), null);
  } finally {
    JSON.parse = originalParse;
  }
  assert.equal(parseCalls, 0);
});
