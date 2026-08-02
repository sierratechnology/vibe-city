import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

async function loadModule(fragment) {
  const source = await readFile(new URL("../src/meetings/privateMeetingSessionInterface.ts", import.meta.url), "utf8").catch(() => "");
  const transpiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 }
  }).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(transpiled).toString("base64")}#${fragment}`);
}

function eventTarget(extra = {}) {
  const listeners = new Map();
  return {
    textContent: "",
    open: false,
    addEventListener(type, listener) { listeners.set(type, listener); },
    dispatch(type, event = {}) { listeners.get(type)?.(event); },
    showModal() { this.open = true; },
    close() { this.open = false; this.dispatch("close"); },
    ...extra
  };
}

function elements() {
  return {
    dialog: eventTarget(),
    status: eventTarget(),
    purpose: eventTarget(),
    participants: eventTarget(),
    materials: eventTarget(),
    lifecycle: eventTarget(),
    startedAt: eventTarget(),
    endedAt: eventTarget(),
    outcome: eventTarget(),
    occupancy: eventTarget(),
    refresh: eventTarget(),
    close: eventTarget()
  };
}

const TENANT = "syn-tenant-a";
const MEETING = "syn-tenant-a--session-a";
const TRUSTED_SESSION = Object.freeze({
  kind: "trusted_authenticated_session",
  subjectId: "syn-tenant-a--subject-a",
  tenantId: TENANT,
  authorizationRef: "syn-tenant-a--authorization-a",
  policyRevision: 1,
  active: true
});

const ACTIVE_MEETING = Object.freeze({
  privacy: "tenant-private",
  tenantId: TENANT,
  sessionId: MEETING,
  revision: 1,
  purposeReference: "syn-tenant-a--purpose-a",
  participantSubjectIds: Object.freeze([
    "syn-tenant-a--subject-a",
    "syn-tenant-a--subject-b"
  ]),
  materialReferences: Object.freeze([
    "syn-tenant-a--material-a",
    "syn-tenant-a--material-b"
  ]),
  startedAt: "2000-01-01T00:01:30.000Z",
  endedAt: null,
  lifecycle: "active",
  outcome: null,
  sourceReference: "syn-tenant-a--source-a",
  createdBySubjectId: "syn-tenant-a--subject-a",
  authorizationReference: "syn-tenant-a--authorization-a",
  policyRevision: 1
});

const ENDED_MEETING = Object.freeze({
  ...ACTIVE_MEETING,
  revision: 2,
  endedAt: "2000-01-01T00:01:45.000Z",
  lifecycle: "ended",
  outcome: Object.freeze({
    resultState: "no-decision",
    outcomeReference: "syn-tenant-a--no-decision-a"
  }),
  endedBySubjectId: "syn-tenant-a--subject-b",
  endAuthorizationReference: "syn-tenant-a--authorization-end",
  endPolicyRevision: 2
});

function privateText(ui) {
  return [ui.purpose, ui.participants, ui.materials, ui.lifecycle, ui.startedAt, ui.endedAt, ui.outcome, ui.occupancy]
    .map((element) => element.textContent);
}

test("private meeting construction performs zero reads and open fails closed without matching active authority", async () => {
  const module = await loadModule("locked-open");
  let trustedSession = null;
  let reads = 0;
  const ui = elements();
  const controller = module.createPrivateMeetingSessionInterfaceController(ui, {
    getTrustedSession: () => trustedSession,
    readAuthorizedMeetingSession: async () => { reads += 1; return {}; }
  });

  assert.equal(reads, 0);
  await controller.open(eventTarget({ focus() {} }), TENANT, MEETING);
  assert.equal(reads, 0);
  assert.equal(ui.status.textContent, "Private meeting unavailable. Authorized tenant session required.");
  assert.deepEqual(privateText(ui), ["", "", "", "", "", "", "", ""]);

  trustedSession = { ...TRUSTED_SESSION, active: false };
  await controller.open(eventTarget({ focus() {} }), TENANT, MEETING);
  assert.equal(reads, 0);

  trustedSession = TRUSTED_SESSION;
  await controller.open(eventTarget({ focus() {} }), "syn-tenant-b", MEETING);
  assert.equal(reads, 0);
});

test("trusted authority policy revision zero fails closed before any private read", async () => {
  const module = await loadModule("trusted-policy-revision-zero");
  let reads = 0;
  const ui = elements();
  const controller = module.createPrivateMeetingSessionInterfaceController(ui, {
    getTrustedSession: () => ({ ...TRUSTED_SESSION, policyRevision: 0 }),
    readAuthorizedMeetingSession: async () => { reads += 1; return ACTIVE_MEETING; }
  });

  await controller.open(eventTarget({ focus() {} }), TENANT, MEETING);

  assert.equal(reads, 0);
  assert.equal(ui.status.textContent, "Private meeting unavailable. Authorized tenant session required.");
  assert.deepEqual(privateText(ui), ["", "", "", "", "", "", "", ""]);
});

test("authorized active meeting with no materials fails closed and clears every private field", async () => {
  const module = await loadModule("empty-material-references");
  const ui = elements();
  const controller = module.createPrivateMeetingSessionInterfaceController(ui, {
    getTrustedSession: () => TRUSTED_SESSION,
    readAuthorizedMeetingSession: async () => Object.freeze({
      ...ACTIVE_MEETING,
      materialReferences: Object.freeze([])
    })
  });

  await controller.open(eventTarget({ focus() {} }), TENANT, MEETING);

  assert.equal(ui.status.textContent, "Private meeting unavailable. Authorized tenant session required.");
  assert.deepEqual(privateText(ui), ["", "", "", "", "", "", "", ""]);
});

test("symbol-bearing projection fails closed after Array.prototype.some replacement", async () => {
  const module = await loadModule("symbol-key-replaced-some");
  const ui = elements();
  const projection = Object.freeze({
    ...ACTIVE_MEETING,
    [Symbol("unexpected-private-field")]: "must-be-rejected-by-exact-closed-schema"
  });
  const controller = module.createPrivateMeetingSessionInterfaceController(ui, {
    getTrustedSession: () => TRUSTED_SESSION,
    readAuthorizedMeetingSession: async () => projection
  });
  const originalSome = Array.prototype.some;

  try {
    Array.prototype.some = () => false;
    await controller.open(eventTarget({ focus() {} }), TENANT, MEETING);
  } finally {
    Array.prototype.some = originalSome;
  }

  assert.equal(ui.status.textContent, "Private meeting unavailable. Authorized tenant session required.");
  assert.deepEqual(privateText(ui), ["", "", "", "", "", "", "", ""]);
});

test("authorized active meeting renders bounded ordered facts and membership-derived occupancy", async () => {
  const module = await loadModule("active-meeting");
  const ui = elements();
  let adapterAuthority;
  let adapterMeetingId;
  const controller = module.createPrivateMeetingSessionInterfaceController(ui, {
    getTrustedSession: () => TRUSTED_SESSION,
    readAuthorizedMeetingSession: async (authority, meetingId) => {
      adapterAuthority = authority;
      adapterMeetingId = meetingId;
      return ACTIVE_MEETING;
    }
  });

  await controller.open(eventTarget({ focus() {} }), TENANT, MEETING);

  assert.notEqual(adapterAuthority, TRUSTED_SESSION);
  assert.equal(Object.isFrozen(adapterAuthority), true);
  assert.deepEqual(adapterAuthority, TRUSTED_SESSION);
  assert.equal(adapterMeetingId, MEETING);
  assert.equal(ui.status.textContent, "Authorized private meeting loaded.");
  assert.equal(ui.purpose.textContent, "Purpose: syn-tenant-a--purpose-a");
  assert.equal(ui.participants.textContent, "Participants: syn-tenant-a--subject-a\nsyn-tenant-a--subject-b");
  assert.equal(ui.materials.textContent, "Materials: syn-tenant-a--material-a\nsyn-tenant-a--material-b");
  assert.equal(ui.lifecycle.textContent, "Lifecycle: Active");
  assert.equal(ui.startedAt.textContent, "Started: 2000-01-01T00:01:30.000Z");
  assert.equal(ui.endedAt.textContent, "");
  assert.equal(ui.outcome.textContent, "Outcome: Pending");
  assert.equal(ui.occupancy.textContent, "Current room occupancy: 2 participants");
});

test("authorized ended meeting preserves historical facts and renders explicit no-decision with no current occupancy", async () => {
  const module = await loadModule("ended-meeting");
  const ui = elements();
  const controller = module.createPrivateMeetingSessionInterfaceController(ui, {
    getTrustedSession: () => TRUSTED_SESSION,
    readAuthorizedMeetingSession: async () => ENDED_MEETING
  });

  await controller.open(eventTarget({ focus() {} }), TENANT, MEETING);

  assert.equal(ui.status.textContent, "Authorized private meeting loaded.");
  assert.equal(ui.purpose.textContent, "Purpose: syn-tenant-a--purpose-a");
  assert.equal(ui.participants.textContent, "Participants: syn-tenant-a--subject-a\nsyn-tenant-a--subject-b");
  assert.equal(ui.materials.textContent, "Materials: syn-tenant-a--material-a\nsyn-tenant-a--material-b");
  assert.equal(ui.lifecycle.textContent, "Lifecycle: Ended");
  assert.equal(ui.startedAt.textContent, "Started: 2000-01-01T00:01:30.000Z");
  assert.equal(ui.endedAt.textContent, "Ended: 2000-01-01T00:01:45.000Z");
  assert.equal(ui.outcome.textContent, "Outcome: No decision");
  assert.equal(ui.occupancy.textContent, "Current room occupancy: None");
});

test("invalid or failed authorized projections clear private fields behind one generic status", async () => {
  const module = await loadModule("invalid-projections");
  const rejected = [
    { ...ACTIVE_MEETING, storagePath: "/synthetic/private/session.sqlite" },
    Object.fromEntries(Object.entries(ACTIVE_MEETING).reverse()),
    { ...ACTIVE_MEETING, tenantId: "syn-tenant-b" },
    { ...ACTIVE_MEETING, sessionId: "syn-tenant-a--session-private-rejected" },
    { ...ACTIVE_MEETING, revision: 2 },
    { ...ACTIVE_MEETING, revision: 999 },
    { ...ACTIVE_MEETING, policyRevision: 0 },
    { ...ACTIVE_MEETING, purposeReference: "p".repeat(129) },
    { ...ACTIVE_MEETING, purposeReference: "syn-tenant-a--purpose-a\nLifecycle: Ended" },
    { ...ACTIVE_MEETING, participantSubjectIds: [
      "syn-tenant-a--subject-a", "syn-tenant-a--subject-b\nLifecycle: Ended"
    ] },
    { ...ACTIVE_MEETING, materialReferences: ["syn-tenant-a--material-a\nLifecycle: Ended"] },
    { ...ACTIVE_MEETING, sourceReference: "syn-tenant-a--source-a\nLifecycle: Ended" },
    {
      ...ACTIVE_MEETING,
      participantSubjectIds: ["syn-tenant-a--subject-a\nLifecycle: Ended"],
      createdBySubjectId: "syn-tenant-a--subject-a\nLifecycle: Ended"
    },
    { ...ACTIVE_MEETING, authorizationReference: "syn-tenant-a--authorization-a\nLifecycle: Ended" },
    { ...ENDED_MEETING, endedAt: ACTIVE_MEETING.startedAt },
    { ...ENDED_MEETING, revision: 1 },
    { ...ENDED_MEETING, revision: 999 },
    { ...ENDED_MEETING, endPolicyRevision: 0 },
    {
      ...ENDED_MEETING,
      outcome: { resultState: "no-decision", outcomeReference: "syn-tenant-a--no-decision-a\nLifecycle: Active" }
    },
    {
      ...ENDED_MEETING,
      participantSubjectIds: ["syn-tenant-a--subject-a", "syn-tenant-a--subject-b\nLifecycle: Active"],
      endedBySubjectId: "syn-tenant-a--subject-b\nLifecycle: Active"
    },
    { ...ENDED_MEETING, endAuthorizationReference: "syn-tenant-a--authorization-end\nLifecycle: Active" },
    { ...ACTIVE_MEETING, outcome: { resultState: "no-decision", outcomeReference: "syn-tenant-a--no-decision-rejected" } },
    { ...ENDED_MEETING, outcome: null },
    { ...ACTIVE_MEETING, participantSubjectIds: ["syn-tenant-a--subject-a", "syn-tenant-a--subject-a"] },
    { ...ACTIVE_MEETING, materialReferences: ["syn-tenant-b--material-private-rejected"] },
    { ...ACTIVE_MEETING, lifecycle: "future-private-lifecycle" }
  ];
  let response = ACTIVE_MEETING;
  let trustedSession = TRUSTED_SESSION;
  let reads = 0;
  const ui = elements();
  const controller = module.createPrivateMeetingSessionInterfaceController(ui, {
    getTrustedSession: () => trustedSession,
    readAuthorizedMeetingSession: async () => {
      reads += 1;
      if (response instanceof Error) throw response;
      return response;
    }
  });
  await controller.open(eventTarget({ focus() {} }), TENANT, MEETING);
  assert.equal(ui.status.textContent, "Authorized private meeting loaded.");

  for (const invalid of [...rejected, new Error("synthetic private adapter exception detail")]) {
    response = invalid;
    await assert.doesNotReject(controller.refresh());
    assert.deepEqual(privateText(ui), ["", "", "", "", "", "", "", ""]);
    assert.equal(ui.status.textContent, "Private meeting unavailable. Authorized tenant session required.");
    assert.equal(ui.status.textContent.includes("synthetic"), false);
    assert.equal(ui.status.textContent.includes("exception"), false);
  }

  const readsBeforeMalformedInputs = reads;
  trustedSession = {
    ...TRUSTED_SESSION,
    subjectId: "syn-tenant-a\n--subject-a",
    tenantId: "syn-tenant-a\n",
    authorizationRef: "syn-tenant-a\n--authorization-a"
  };
  await controller.open(eventTarget({ focus() {} }), "syn-tenant-a\n", "syn-tenant-a\n--session-a");
  trustedSession = TRUSTED_SESSION;
  await controller.open(eventTarget({ focus() {} }), TENANT, "syn-tenant-a--session-a\nLifecycle: Ended");
  assert.equal(reads, readsBeforeMalformedInputs);
  assert.deepEqual(privateText(ui), ["", "", "", "", "", "", "", ""]);
  assert.equal(ui.status.textContent, "Private meeting unavailable. Authorized tenant session required.");
});

test("accessor proxy mutating and post-import intrinsic hazards fail closed or preserve bounded valid data", async () => {
  const module = await loadModule("snapshot-hazards");
  const invoker = eventTarget({ focus() {} });
  let response;
  let accessorReads = 0;
  const accessorMeeting = { ...ACTIVE_MEETING };
  Object.defineProperty(accessorMeeting, "purposeReference", {
    enumerable: true,
    get() {
      accessorReads += 1;
      return "syn-tenant-a--purpose-private-getter";
    }
  });
  response = accessorMeeting;
  const ui = elements();
  const controller = module.createPrivateMeetingSessionInterfaceController(ui, {
    getTrustedSession: () => TRUSTED_SESSION,
    readAuthorizedMeetingSession: async () => response
  });

  await assert.doesNotReject(controller.open(invoker, TENANT, MEETING));
  assert.equal(accessorReads, 0);
  assert.deepEqual(privateText(ui), ["", "", "", "", "", "", "", ""]);

  response = new Proxy({ ...ACTIVE_MEETING }, {});
  await controller.refresh();
  assert.deepEqual(privateText(ui), ["", "", "", "", "", "", "", ""]);

  let indexedReads = 0;
  const oversizedParticipants = new Array(33);
  Object.defineProperty(oversizedParticipants, 0, {
    enumerable: true,
    get() { indexedReads += 1; return "syn-tenant-a--subject-private"; }
  });
  response = { ...ACTIVE_MEETING, participantSubjectIds: oversizedParticipants };
  await controller.refresh();
  assert.equal(indexedReads, 0);

  const originals = {
    arrayIsArray: Array.isArray,
    objectKeys: Object.keys,
    safeInteger: Number.isSafeInteger,
    startsWith: String.prototype.startsWith
  };
  response = ACTIVE_MEETING;
  try {
    Array.isArray = () => false;
    Object.keys = () => { throw new Error("synthetic replaced keys"); };
    Number.isSafeInteger = () => false;
    String.prototype.startsWith = () => false;
    await controller.refresh();
  } finally {
    Array.isArray = originals.arrayIsArray;
    Object.keys = originals.objectKeys;
    Number.isSafeInteger = originals.safeInteger;
    String.prototype.startsWith = originals.startsWith;
  }
  assert.equal(ui.status.textContent, "Authorized private meeting loaded.");
  assert.equal(ui.purpose.textContent, "Purpose: syn-tenant-a--purpose-a");
});

test("authority revocation or revision drift before final render clears the authorized projection", async () => {
  const module = await loadModule("authority-drift");
  const mutations = [
    ["active", false],
    ["policyRevision", 2],
    ["authorizationRef", "syn-tenant-a--authorization-drift"],
    ["subjectId", "syn-tenant-a--subject-drift"],
    ["tenantId", "syn-tenant-b"]
  ];

  for (const [field, replacement] of mutations) {
    const authority = { ...TRUSTED_SESSION };
    const ui = elements();
    const controller = module.createPrivateMeetingSessionInterfaceController(ui, {
      getTrustedSession: () => authority,
      readAuthorizedMeetingSession: async () => {
        authority[field] = replacement;
        return ACTIVE_MEETING;
      }
    });

    await assert.doesNotReject(controller.open(eventTarget({ focus() {} }), TENANT, MEETING));
    assert.deepEqual(privateText(ui), ["", "", "", "", "", "", "", ""], field);
    assert.equal(ui.status.textContent, "Private meeting unavailable. Authorized tenant session required.");
  }
});

test("refresh denial wins over an older authorized response and never restores stale private content", async () => {
  const module = await loadModule("refresh-generation");
  let authority = { ...TRUSTED_SESSION };
  let mode = "immediate";
  let resolveSlow;
  const ui = elements();
  const controller = module.createPrivateMeetingSessionInterfaceController(ui, {
    getTrustedSession: () => authority,
    readAuthorizedMeetingSession: async () => {
      if (mode === "slow") return new Promise((resolve) => { resolveSlow = resolve; });
      return ACTIVE_MEETING;
    }
  });
  await controller.open(eventTarget({ focus() {} }), TENANT, MEETING);
  assert.equal(ui.status.textContent, "Authorized private meeting loaded.");

  mode = "slow";
  const staleRefresh = controller.refresh();
  authority = { ...TRUSTED_SESSION, active: false };
  await controller.refresh();
  assert.deepEqual(privateText(ui), ["", "", "", "", "", "", "", ""]);

  authority = { ...TRUSTED_SESSION };
  resolveSlow(ACTIVE_MEETING);
  await staleRefresh;
  assert.deepEqual(privateText(ui), ["", "", "", "", "", "", "", ""]);
  assert.equal(ui.status.textContent, "Private meeting unavailable. Authorized tenant session required.");
});

test("close clears private fields rejects pending responses and restores the exact invoker", async () => {
  const module = await loadModule("close-focus");
  let mode = "immediate";
  let resolveSlow;
  const focus = { first: 0, second: 0 };
  const firstInvoker = eventTarget({ focus() { focus.first += 1; } });
  const secondInvoker = eventTarget({ focus() { focus.second += 1; } });
  const ui = elements();
  const controller = module.createPrivateMeetingSessionInterfaceController(ui, {
    getTrustedSession: () => TRUSTED_SESSION,
    readAuthorizedMeetingSession: async () => {
      if (mode === "slow") return new Promise((resolve) => { resolveSlow = resolve; });
      return ACTIVE_MEETING;
    }
  });

  await controller.open(firstInvoker, TENANT, MEETING);
  ui.close.dispatch("click");
  assert.equal(ui.dialog.open, false);
  assert.deepEqual(privateText(ui), ["", "", "", "", "", "", "", ""]);
  assert.deepEqual(focus, { first: 1, second: 0 });

  mode = "slow";
  const pending = controller.open(secondInvoker, TENANT, MEETING);
  ui.dialog.close();
  resolveSlow(ACTIVE_MEETING);
  await pending;
  assert.deepEqual(privateText(ui), ["", "", "", "", "", "", "", ""]);
  assert.deepEqual(focus, { first: 1, second: 1 });
  assert.equal(ui.status.textContent, "Private meeting unavailable. Authorized tenant session required.");
});
