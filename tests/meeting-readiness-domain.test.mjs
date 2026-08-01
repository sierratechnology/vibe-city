import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

async function loadMeetingReadinessModule(fragment) {
  const source = await readFile(new URL("../src/domain/meetingReadiness.ts", import.meta.url), "utf8").catch(() => "");
  const transpiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 }
  }).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(transpiled).toString("base64")}#${fragment}`);
}

function completeCandidate() {
  return {
    schemaVersion: "readiness/1",
    purpose: {
      reference: "syn-purpose-01",
      summary: "Synthetic readiness exercise"
    },
    participants: [{
      participantReference: "syn-participant-01",
      authorizationReference: "syn-authorization-01",
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

test("meeting readiness rejects any session candidate lacking closed purpose participant material lifecycle and outcome provenance without projecting a meeting or occupancy", async () => {
  const module = await loadMeetingReadinessModule("required-categories");
  assert.equal(typeof module.validateMeetingReadiness, "function");

  const incompleteCandidates = [undefined, null, {}, ...[
    "schemaVersion",
    "purpose",
    "participants",
    "materials",
    "lifecycle",
    "outcome"
  ].map((missingKey) => {
    const candidate = completeCandidate();
    delete candidate[missingKey];
    return candidate;
  })];

  for (const candidate of incompleteCandidates) {
    const input = candidate !== null && typeof candidate === "object"
      ? JSON.stringify(candidate)
      : candidate;
    assert.equal(module.validateMeetingReadiness(input), null);
  }
});

test("meeting readiness accepts one detached recursively frozen closed synthetic value without meeting occupancy or authority claims", async () => {
  const module = await loadMeetingReadinessModule("complete-candidate");
  const candidate = completeCandidate();
  const serialized = JSON.stringify(candidate);
  const accepted = module.validateMeetingReadiness(serialized);

  assert.deepEqual(accepted, candidate);
  assert.notEqual(accepted, candidate);
  assert.notEqual(accepted.purpose, candidate.purpose);
  assert.notEqual(accepted.participants, candidate.participants);
  assert.notEqual(accepted.participants[0], candidate.participants[0]);
  assert.notEqual(accepted.materials, candidate.materials);
  assert.notEqual(accepted.lifecycle, candidate.lifecycle);
  assert.notEqual(accepted.outcome, candidate.outcome);

  const stack = [accepted];
  while (stack.length > 0) {
    const value = stack.pop();
    assert.equal(Object.isFrozen(value), true);
    for (const child of Object.values(value)) {
      if (child !== null && typeof child === "object") stack.push(child);
    }
  }

  assert.equal(JSON.stringify(accepted).includes("meeting"), false);
  assert.equal(JSON.stringify(accepted).includes("occup"), false);
  assert.equal(JSON.stringify(accepted).includes("decision"), false);
  assert.equal(JSON.stringify(accepted).includes("completed"), false);
});

test("meeting readiness rejects over-limit serialized input before parsing", async () => {
  const module = await loadMeetingReadinessModule("over-limit-input");
  const originalParse = JSON.parse;
  let parseCalls = 0;
  JSON.parse = (...args) => {
    parseCalls += 1;
    return originalParse(...args);
  };

  try {
    assert.equal(module.validateMeetingReadiness("x".repeat(8193)), null);
  } finally {
    JSON.parse = originalParse;
  }
  assert.equal(parseCalls, 0);
});

test("meeting readiness rejects duplicate keys and noncanonical serialized forms", async () => {
  const module = await loadMeetingReadinessModule("canonical-input");
  const candidate = completeCandidate();
  const canonical = JSON.stringify(candidate);
  const duplicateKey = canonical.replace(
    '{"schemaVersion":"readiness/1",',
    '{"schemaVersion":"readiness/1","schemaVersion":"readiness/1",'
  );
  const reordered = JSON.stringify({
    purpose: candidate.purpose,
    schemaVersion: candidate.schemaVersion,
    participants: candidate.participants,
    materials: candidate.materials,
    lifecycle: candidate.lifecycle,
    outcome: candidate.outcome
  });

  for (const serialized of [`${canonical}\n`, duplicateKey, reordered, `${canonical}null`]) {
    assert.equal(module.validateMeetingReadiness(serialized), null);
  }
});

test("meeting readiness rejects malformed JSON without throwing", async () => {
  const module = await loadMeetingReadinessModule("malformed-json");
  for (const serialized of ["{", "undefined", '{"schemaVersion":', "[] trailing"]) {
    assert.doesNotThrow(() => {
      assert.equal(module.validateMeetingReadiness(serialized), null);
    });
  }
});

test("meeting readiness rejects malformed closed contract values and forbidden claims", async () => {
  const module = await loadMeetingReadinessModule("closed-contract");
  const malformedCandidates = [];
  const change = (mutate) => {
    const candidate = completeCandidate();
    mutate(candidate);
    malformedCandidates.push(candidate);
  };

  change((value) => { value.unknown = true; });
  change((value) => { value.purpose.unknown = true; });
  change((value) => { value.participants[0].unknown = true; });
  change((value) => { value.materials[0].unknown = true; });
  change((value) => { value.lifecycle.unknown = true; });
  change((value) => { value.outcome.unknown = true; });
  change((value) => { value.schemaVersion = 1; });
  change((value) => { value.schemaVersion = "readiness/2"; });
  change((value) => { value.purpose.reference = "real-person"; });
  change((value) => { value.purpose.reference = "syn-UPPER"; });
  change((value) => { value.purpose.summary = "   "; });
  change((value) => { value.purpose.summary = `Synthetic\u0000text`; });
  change((value) => { value.purpose.summary = `Synthetic\ud800text`; });
  change((value) => { value.purpose.summary = "x".repeat(201); });
  change((value) => { value.participants = []; });
  change((value) => { value.participants = Array(1); });
  change((value) => { value.participants = Array.from({ length: 17 }, (_, index) => ({
    participantReference: `syn-participant-${index}`,
    authorizationReference: `syn-authorization-${index}`,
    attendanceAuthority: "readiness-only"
  })); });
  change((value) => { value.participants.push({ ...value.participants[0] }); });
  change((value) => { value.participants[0].attendanceAuthority = "decision-authorized"; });
  change((value) => { value.participants[0].authorizationReference = 1; });
  change((value) => { value.materials = []; });
  change((value) => { value.materials = Array(1); });
  change((value) => { value.materials.push({ ...value.materials[0] }); });
  change((value) => { value.materials[0].evidenceReference = "https://synthetic.invalid/evidence"; });
  change((value) => { value.lifecycle.state = "active"; });
  change((value) => { value.lifecycle.state = "completed"; });
  change((value) => { value.lifecycle.preparedAt = "2000-01-01T00:00:00Z"; });
  change((value) => { value.lifecycle.readyAt = "2000-01-01T00:00:00.000Z"; });
  change((value) => { value.lifecycle.readyAt = "1999-12-31T23:59:59.999Z"; });
  change((value) => { value.outcome.state = "decision"; });
  change((value) => { value.outcome.state = "completed"; });
  change((value) => { value.outcome.provenanceReference = null; });

  for (const candidate of malformedCandidates) {
    assert.equal(module.validateMeetingReadiness(JSON.stringify(candidate)), null);
  }
});

test("meeting readiness rejects cross-object mutation that would create a whole-graph hybrid", async () => {
  const module = await loadMeetingReadinessModule("cross-object-mutation");
  const candidate = completeCandidate();
  candidate.purpose.summary = "Synthetic old purpose";
  candidate.materials[0].evidenceReference = "syn-evidence-old";

  let prototypeReads = 0;
  candidate.participants[0] = new Proxy(candidate.participants[0], {
    getPrototypeOf(target) {
      prototypeReads += 1;
      if (prototypeReads === 1) {
        candidate.purpose.summary = "Synthetic new purpose";
        candidate.materials[0].evidenceReference = "syn-evidence-new";
      }
      return Reflect.getPrototypeOf(target);
    }
  });

  assert.equal(module.validateMeetingReadiness(candidate), null);
});

test("meeting readiness rejects root-reset participant-advance proxy schedule", async () => {
  const module = await loadMeetingReadinessModule("root-reset-participant-advance");
  const candidate = completeCandidate();
  candidate.purpose.summary = "Synthetic old purpose";
  candidate.materials[0].evidenceReference = "syn-evidence-old";

  let participantPrototypeReads = 0;
  candidate.participants[0] = new Proxy(candidate.participants[0], {
    getPrototypeOf(target) {
      participantPrototypeReads += 1;
      candidate.purpose.summary = "Synthetic new purpose";
      candidate.materials[0].evidenceReference = "syn-evidence-new";
      return Reflect.getPrototypeOf(target);
    }
  });

  let rootPrototypeReads = 0;
  const root = new Proxy(candidate, {
    getPrototypeOf(target) {
      rootPrototypeReads += 1;
      candidate.purpose.summary = "Synthetic old purpose";
      candidate.materials[0].evidenceReference = "syn-evidence-old";
      return Reflect.getPrototypeOf(target);
    }
  });

  const accepted = module.validateMeetingReadiness(root);
  assert.equal(accepted, null);
  assert.equal(rootPrototypeReads, 0);
  assert.equal(participantPrototypeReads, 0);
  assert.notDeepEqual(accepted && {
    purposeSummary: accepted.purpose.summary,
    evidenceReference: accepted.materials[0].evidenceReference
  }, {
    purposeSummary: "Synthetic old purpose",
    evidenceReference: "syn-evidence-new"
  });
});

test("meeting readiness rejects non-string values without object traps and preserves parser-owned detachment", async () => {
  const module = await loadMeetingReadinessModule("primitive-boundary");
  let trapCalls = 0;
  const proxy = new Proxy(completeCandidate(), {
    get() {
      trapCalls += 1;
      throw new Error("rejected value must not be read");
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

  for (const candidate of [
    undefined,
    null,
    false,
    1,
    1n,
    Symbol("readiness"),
    completeCandidate(),
    [],
    new String(JSON.stringify(completeCandidate())),
    proxy
  ]) {
    assert.equal(module.validateMeetingReadiness(candidate), null);
  }
  assert.equal(trapCalls, 0);

  const mutableInput = completeCandidate();
  const accepted = module.validateMeetingReadiness(JSON.stringify(mutableInput));
  mutableInput.purpose.summary = "Synthetic changed input";
  mutableInput.participants[0].participantReference = "syn-participant-changed";
  mutableInput.participants.push({ ...mutableInput.participants[0] });
  assert.equal(accepted.purpose.summary, "Synthetic readiness exercise");
  assert.equal(accepted.participants[0].participantReference, "syn-participant-01");
  assert.equal(accepted.participants.length, 1);
});
