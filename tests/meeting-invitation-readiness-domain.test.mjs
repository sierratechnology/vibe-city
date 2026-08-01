import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

async function loadMeetingInvitationReadinessModule(fragment) {
  const source = await readFile(new URL("../src/domain/meetingInvitationReadiness.ts", import.meta.url), "utf8").catch(() => "");
  const transpiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 }
  }).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(transpiled).toString("base64")}#${fragment}`);
}

function completeCandidate() {
  return {
    schemaVersion: "invitation-readiness/1",
    invitationReference: "syn-invitation-01",
    issuer: {
      subjectReference: "syn-issuer-01",
      issuanceAuthorizationReference: "syn-issuance-authorization-01"
    },
    recipient: {
      subjectReference: "syn-recipient-01",
      participationAuthorizationReference: "syn-participation-authorization-01"
    },
    purpose: {
      reference: "syn-purpose-01"
    },
    materials: [{
      materialReference: "syn-material-01",
      evidenceReference: "syn-evidence-01"
    }],
    access: {
      scope: "readiness-only",
      grantsAccess: false
    },
    lifecycle: {
      state: "prepared"
    },
    validity: {
      preparedAt: "2000-01-01T00:00:00.000Z",
      validFrom: "2000-01-01T00:01:00.000Z",
      expiresAt: "2000-01-01T00:02:00.000Z"
    },
    revocation: {
      state: "not-revoked-yet",
      authorityReference: "syn-revocation-authority-01"
    }
  };
}

test("meeting invitation readiness rejects any candidate lacking closed issuer recipient purpose material access lifecycle validity and revocation provenance without granting invitation access or projecting a meeting", async () => {
  const module = await loadMeetingInvitationReadinessModule("required-categories");
  assert.equal(typeof module.validateMeetingInvitationReadiness, "function");

  for (const missingKey of [
    "issuer",
    "recipient",
    "purpose",
    "materials",
    "access",
    "lifecycle",
    "validity",
    "revocation"
  ]) {
    const candidate = completeCandidate();
    delete candidate[missingKey];
    const accepted = module.validateMeetingInvitationReadiness(JSON.stringify(candidate));
    assert.equal(accepted, null);
    assert.equal(accepted?.access?.grantsAccess ?? false, false);
    assert.equal(accepted?.meeting ?? null, null);
  }
});

test("meeting invitation readiness accepts one detached deeply frozen exact synthetic value with access explicitly denied", async () => {
  const module = await loadMeetingInvitationReadinessModule("complete-candidate");
  const candidate = completeCandidate();
  const accepted = module.validateMeetingInvitationReadiness(JSON.stringify(candidate));

  assert.deepEqual(accepted, candidate);
  assert.notEqual(accepted, candidate);
  assert.equal(accepted.access.grantsAccess, false);

  const stack = [accepted];
  while (stack.length > 0) {
    const value = stack.pop();
    assert.equal(Object.isFrozen(value), true);
    for (const child of Object.values(value)) {
      if (child !== null && typeof child === "object") stack.push(child);
    }
  }

  assert.equal(JSON.stringify(accepted), JSON.stringify(candidate));
  assert.equal("meeting" in accepted, false);
  assert.equal("participant" in accepted, false);
  assert.equal("attendance" in accepted, false);
  assert.equal("outcome" in accepted, false);
});

test("meeting invitation readiness remains deeply frozen after Object freeze replacement", async () => {
  const module = await loadMeetingInvitationReadinessModule("captured-object-freeze");
  const originalFreeze = Object.freeze;
  let accepted;

  Object.freeze = (value) => value;
  try {
    accepted = module.validateMeetingInvitationReadiness(JSON.stringify(completeCandidate()));
  } finally {
    Object.freeze = originalFreeze;
  }

  assert.notEqual(accepted, null);
  const stack = [accepted];
  while (stack.length > 0) {
    const value = stack.pop();
    assert.equal(Object.isFrozen(value), true);
    for (const child of Object.values(value)) {
      if (child !== null && typeof child === "object") stack.push(child);
    }
  }
  assert.throws(() => { accepted.access.grantsAccess = true; }, TypeError);
  assert.equal(accepted.access.grantsAccess, false);
});

test("meeting invitation readiness remains deeply frozen after Array iterator replacement", async () => {
  const module = await loadMeetingInvitationReadinessModule("captured-array-iterator-freeze");
  const serialized = JSON.stringify(completeCandidate());
  const originalIterator = Array.prototype[Symbol.iterator];
  let materialIterations = 0;
  let accepted;

  Array.prototype[Symbol.iterator] = function () {
    if (this.length === 1
      && this[0] !== null
      && typeof this[0] === "object"
      && "materialReference" in this[0]) {
      materialIterations += 1;
      if (materialIterations === 2) return originalIterator.call([]);
    }
    return originalIterator.call(this);
  };
  try {
    accepted = module.validateMeetingInvitationReadiness(serialized);
  } finally {
    Array.prototype[Symbol.iterator] = originalIterator;
  }

  assert.notEqual(accepted, null);
  assert.equal(materialIterations > 0, true);
  assert.equal(Object.isFrozen(accepted.materials[0]), true);
});

test("meeting invitation readiness rejects impossible timestamps after Date intrinsic replacement", async () => {
  const module = await loadMeetingInvitationReadinessModule("captured-date-intrinsics");
  const candidate = completeCandidate();
  candidate.validity = {
    preparedAt: "2000-02-30T00:00:00.000Z",
    validFrom: "2000-02-30T00:01:00.000Z",
    expiresAt: "2000-02-30T00:02:00.000Z"
  };
  const timestamps = Object.values(candidate.validity);
  const originalParse = Date.parse;
  const originalToISOString = Date.prototype.toISOString;

  Date.parse = (value) => timestamps.indexOf(value);
  Date.prototype.toISOString = function () {
    return timestamps[this.getTime()];
  };
  try {
    assert.equal(
      module.validateMeetingInvitationReadiness(JSON.stringify(candidate)),
      null
    );
  } finally {
    Date.parse = originalParse;
    Date.prototype.toISOString = originalToISOString;
  }
});

test("meeting invitation readiness rejects duplicate references after Set replacement", async () => {
  const module = await loadMeetingInvitationReadinessModule("captured-set-intrinsics");
  const candidate = completeCandidate();
  candidate.issuer.issuanceAuthorizationReference = candidate.issuer.subjectReference;
  const OriginalSet = globalThis.Set;

  globalThis.Set = class {
    get size() { return 7; }
    has() { return false; }
    add() { return this; }
  };
  try {
    assert.equal(
      module.validateMeetingInvitationReadiness(JSON.stringify(candidate)),
      null
    );
  } finally {
    globalThis.Set = OriginalSet;
  }
});

test("meeting invitation readiness rejects duplicate references after Array iterator replacement", async () => {
  const module = await loadMeetingInvitationReadinessModule("captured-array-iterator");
  const candidate = completeCandidate();
  candidate.issuer.issuanceAuthorizationReference = candidate.issuer.subjectReference;
  const serialized = JSON.stringify(candidate);
  const originalIterator = Array.prototype[Symbol.iterator];

  Array.prototype[Symbol.iterator] = function () {
    if (this.length === 7 && this.every((value) => typeof value === "string")) {
      return originalIterator.call([
        "syn-probe-1",
        "syn-probe-2",
        "syn-probe-3",
        "syn-probe-4",
        "syn-probe-5",
        "syn-probe-6",
        "syn-probe-7"
      ]);
    }
    return originalIterator.call(this);
  };
  try {
    assert.equal(module.validateMeetingInvitationReadiness(serialized), null);
  } finally {
    Array.prototype[Symbol.iterator] = originalIterator;
  }
});

test("meeting invitation readiness rejects noncanonical malformed duplicate contradictory over-limit and authority-expanding claims", async () => {
  const module = await loadMeetingInvitationReadinessModule("closed-contract");
  const malformedCandidates = [];
  const change = (mutate) => {
    const candidate = completeCandidate();
    mutate(candidate);
    malformedCandidates.push(candidate);
  };

  change((value) => { value.unknown = true; });
  change((value) => { value.issuer.unknown = true; });
  change((value) => { value.recipient.unknown = true; });
  change((value) => { value.purpose.unknown = true; });
  change((value) => { value.materials[0].unknown = true; });
  change((value) => { value.access.unknown = true; });
  change((value) => { value.lifecycle.unknown = true; });
  change((value) => { value.validity.unknown = true; });
  change((value) => { value.revocation.unknown = true; });
  change((value) => { value.schemaVersion = "invitation-readiness/2"; });
  change((value) => { value.invitationReference = "real-invitation"; });
  change((value) => { value.invitationReference = "syn-UPPER"; });
  change((value) => { value.invitationReference = `syn-bad\u0000reference`; });
  change((value) => { value.invitationReference = `syn-bad\ud800reference`; });
  change((value) => { value.invitationReference = `syn-${"x".repeat(65)}`; });
  change((value) => { value.issuer.subjectReference = 1; });
  change((value) => { value.issuer.issuanceAuthorizationReference = "syn-issuer-01"; });
  change((value) => { value.recipient.subjectReference = "https://synthetic.invalid/recipient"; });
  change((value) => { value.recipient.participationAuthorizationReference = null; });
  change((value) => { value.purpose.reference = "Synthetic purpose text"; });
  change((value) => { value.materials = []; });
  change((value) => { value.materials = Array(1); });
  change((value) => { value.materials = Array.from({ length: 17 }, (_, index) => ({
    materialReference: `syn-material-${index}`,
    evidenceReference: `syn-evidence-${index}`
  })); });
  change((value) => { value.materials.push({ ...value.materials[0] }); });
  change((value) => { value.materials[0].evidenceReference = value.materials[0].materialReference; });
  change((value) => { value.materials[0].evidenceReference = "material access granted"; });
  change((value) => { value.access.scope = "meeting-access"; });
  change((value) => { value.access.grantsAccess = true; });
  change((value) => { value.access.roomAccess = true; });
  change((value) => { value.lifecycle.state = "issued"; });
  change((value) => { value.lifecycle.state = "accepted"; });
  change((value) => { value.lifecycle.state = "active"; });
  change((value) => { value.lifecycle.attendance = "attended"; });
  change((value) => { value.lifecycle.outcome = "completed"; });
  change((value) => { value.validity.preparedAt = "2000-01-01T00:00:00Z"; });
  change((value) => { value.validity.validFrom = "2000-02-30T00:00:00.000Z"; });
  change((value) => { value.validity.expiresAt = "2000-01-01T00:01:00.000Z"; });
  change((value) => { value.validity.validFrom = "1999-12-31T23:59:59.999Z"; });
  change((value) => { value.revocation.state = "revoked"; });
  change((value) => { value.revocation.state = "live-check-complete"; });
  change((value) => { value.revocation.authorityReference = ""; });

  for (const candidate of malformedCandidates) {
    assert.equal(module.validateMeetingInvitationReadiness(JSON.stringify(candidate)), null);
  }

  const canonical = JSON.stringify(completeCandidate());
  const duplicateKey = canonical.replace(
    '{"schemaVersion":"invitation-readiness/1",',
    '{"schemaVersion":"invitation-readiness/1","schemaVersion":"invitation-readiness/1",'
  );
  const reordered = JSON.stringify({
    invitationReference: completeCandidate().invitationReference,
    schemaVersion: "invitation-readiness/1",
    ...Object.fromEntries(Object.entries(completeCandidate()).slice(2))
  });
  const escaped = canonical.replace("syn-purpose-01", "syn-purpose-\\u0030\\u0031");
  for (const serialized of [`${canonical}\n`, duplicateKey, reordered, escaped, `${canonical}null`]) {
    assert.equal(module.validateMeetingInvitationReadiness(serialized), null);
  }

  const originalParse = JSON.parse;
  let parseCalls = 0;
  JSON.parse = (...args) => {
    parseCalls += 1;
    return originalParse(...args);
  };
  try {
    assert.equal(module.validateMeetingInvitationReadiness("x".repeat(8193)), null);
  } finally {
    JSON.parse = originalParse;
  }
  assert.equal(parseCalls, 0);
});

test("meeting invitation readiness rejects malformed identifiers after RegExp test replacement", async () => {
  const module = await loadMeetingInvitationReadinessModule("captured-regexp-test");
  const candidate = completeCandidate();
  candidate.invitationReference = "real-invitation";
  const originalTest = RegExp.prototype.test;

  RegExp.prototype.test = () => true;
  try {
    assert.equal(
      module.validateMeetingInvitationReadiness(JSON.stringify(candidate)),
      null
    );
  } finally {
    RegExp.prototype.test = originalTest;
  }
});

test("meeting invitation readiness rejects non-string traps and validates only a parser-owned detached graph", async () => {
  const module = await loadMeetingInvitationReadinessModule("primitive-parser-boundary");
  let inputTrapCalls = 0;
  const rejectedProxy = new Proxy(completeCandidate(), {
    get() {
      inputTrapCalls += 1;
      throw new Error("rejected input must not be read");
    },
    getPrototypeOf() {
      inputTrapCalls += 1;
      throw new Error("rejected input must not be inspected");
    },
    ownKeys() {
      inputTrapCalls += 1;
      throw new Error("rejected input must not be enumerated");
    }
  });

  for (const candidate of [
    undefined,
    null,
    false,
    1,
    1n,
    Symbol("invitation-readiness"),
    completeCandidate(),
    [],
    new String(JSON.stringify(completeCandidate())),
    rejectedProxy
  ]) {
    assert.equal(module.validateMeetingInvitationReadiness(candidate), null);
  }
  assert.equal(inputTrapCalls, 0);

  for (const malformed of ["{", "undefined", "[] trailing", '{"schemaVersion":']) {
    assert.doesNotThrow(() => {
      assert.equal(module.validateMeetingInvitationReadiness(malformed), null);
    });
  }

  const mutableInput = completeCandidate();
  const accepted = module.validateMeetingInvitationReadiness(JSON.stringify(mutableInput));
  mutableInput.issuer.subjectReference = "syn-issuer-changed";
  mutableInput.materials[0].evidenceReference = "syn-evidence-changed";
  mutableInput.materials.push({ ...mutableInput.materials[0] });
  assert.equal(accepted.issuer.subjectReference, "syn-issuer-01");
  assert.equal(accepted.materials[0].evidenceReference, "syn-evidence-01");
  assert.equal(accepted.materials.length, 1);

  const originalParse = JSON.parse;
  let replacementGraphTrapCalls = 0;
  const replacementGraph = new Proxy(completeCandidate(), {
    get(target, property, receiver) {
      replacementGraphTrapCalls += 1;
      return Reflect.get(target, property, receiver);
    },
    getPrototypeOf(target) {
      replacementGraphTrapCalls += 1;
      return Reflect.getPrototypeOf(target);
    },
    ownKeys(target) {
      replacementGraphTrapCalls += 1;
      return Reflect.ownKeys(target);
    }
  });
  JSON.parse = () => replacementGraph;
  try {
    assert.deepEqual(
      module.validateMeetingInvitationReadiness(JSON.stringify(completeCandidate())),
      completeCandidate()
    );
  } finally {
    JSON.parse = originalParse;
  }
  assert.equal(replacementGraphTrapCalls, 0);
});
