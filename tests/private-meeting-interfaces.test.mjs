import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

async function loadModule(fragment) {
  const source = await readFile(new URL("../src/meetings/privateMeetingInterfaces.ts", import.meta.url), "utf8").catch(() => "");
  const transpiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 }
  }).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(transpiled).toString("base64")}#${fragment}`);
}

async function loadControllerModule(fragment) {
  const source = await readFile(new URL("../src/meetings/privateMeetingSessionInterface.ts", import.meta.url), "utf8");
  const transpiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 }
  }).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(transpiled).toString("base64")}#${fragment}`);
}

function eventTarget(extra = {}) {
  const listeners = new Map();
  return {
    textContent: "",
    hidden: false,
    disabled: false,
    open: false,
    addEventListener(type, listener) {
      const entries = listeners.get(type) ?? [];
      entries.push(listener);
      listeners.set(type, entries);
    },
    dispatch(type, event = {}) {
      for (const listener of listeners.get(type) ?? []) listener(event);
    },
    showModal() { this.open = true; },
    close() { this.open = false; this.dispatch("close"); },
    focus() {},
    ...extra
  };
}

function elements() {
  return {
    worldEntry: eventTarget(),
    nonSpatialEntry: eventTarget(),
    dialog: eventTarget(),
    status: eventTarget({ textContent: "Private meetings are not configured in this runtime." }),
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

function privateText(ui) {
  return [ui.purpose, ui.participants, ui.materials, ui.lifecycle, ui.startedAt, ui.endedAt, ui.outcome, ui.occupancy]
    .map((element) => element.textContent);
}

async function assertRevocationBeforeOpenClears(module, controllerModule, path) {
  const ui = elements();
  const validTarget = Object.freeze({
    kind: "trusted_authorized_meeting_target",
    tenantId: "syn-tenant-a",
    meetingSessionId: "syn-tenant-a--session-a",
    active: true
  });
  const changedTarget = Object.freeze({
    kind: "trusted_authorized_meeting_target",
    tenantId: "syn-tenant-b",
    meetingSessionId: "syn-tenant-b--session-b",
    active: true
  });
  const rejectedTarget = {
    ...validTarget,
    [Symbol("extra-authority")]: true
  };
  const faultingTarget = new Proxy(validTarget, {
    ownKeys() { throw new Error("private fault detail"); }
  });
  const trustedSession = Object.freeze({
    kind: "trusted_authenticated_session",
    subjectId: "syn-tenant-a--subject-a",
    tenantId: "syn-tenant-a",
    authorizationRef: "syn-tenant-a--authorization-a",
    policyRevision: 1,
    active: true
  });
  const activeMeeting = Object.freeze({
    privacy: "tenant-private",
    tenantId: "syn-tenant-a",
    sessionId: "syn-tenant-a--session-a",
    revision: 1,
    purposeReference: "syn-tenant-a--purpose-a",
    participantSubjectIds: Object.freeze(["syn-tenant-a--subject-a"]),
    materialReferences: Object.freeze(["syn-tenant-a--material-a"]),
    startedAt: "2000-01-01T00:01:30.000Z",
    endedAt: null,
    lifecycle: "active",
    outcome: null,
    sourceReference: "syn-tenant-a--source-a",
    createdBySubjectId: "syn-tenant-a--subject-a",
    authorizationReference: "syn-tenant-a--authorization-a",
    policyRevision: 1
  });
  let target = validTarget;
  let reads = 0;
  const composition = module.createPrivateMeetingInterfaces(ui, {
    getTrustedMeetingTarget: () => target,
    getTrustedSession: () => trustedSession,
    readAuthorizedMeetingSession: async () => { reads += 1; return activeMeeting; }
  }, controllerModule.createPrivateMeetingSessionInterfaceController);

  for (const revokedTarget of [null, changedTarget, rejectedTarget, faultingTarget]) {
    target = validTarget;
    await composition[path]();
    assert.equal(ui.purpose.textContent, "Purpose: syn-tenant-a--purpose-a");
    const readsBeforeRevocation = reads;

    target = revokedTarget;
    await composition[path]();

    assert.equal(reads, readsBeforeRevocation);
    assert.deepEqual(privateText(ui), ["", "", "", "", "", "", "", ""]);
    assert.equal(ui.worldEntry.hidden, true);
    assert.equal(ui.worldEntry.disabled, true);
    assert.equal(ui.nonSpatialEntry.hidden, true);
    assert.equal(ui.nonSpatialEntry.disabled, true);
    const rendered = Object.values(ui).map((element) => element.textContent).join(" ");
    assert.equal(rendered.includes("purpose-a"), false);
    assert.equal(rendered.includes("private fault detail"), false);
  }
}

test("default public meeting composition keeps both paths unavailable with zero private reads", async () => {
  const module = await loadModule("default-public-zero");
  const ui = elements();
  let reads = 0;

  module.createPrivateMeetingInterfaces(ui, {
    getTrustedMeetingTarget: () => null,
    getTrustedSession: () => null,
    readAuthorizedMeetingSession: async () => { reads += 1; return {}; }
  }, () => ({
    open: async () => {},
    refresh: async () => {},
    close: () => {}
  }));

  assert.equal(ui.worldEntry.hidden, true);
  assert.equal(ui.worldEntry.disabled, true);
  assert.equal(ui.nonSpatialEntry.hidden, true);
  assert.equal(ui.nonSpatialEntry.disabled, true);
  assert.equal(reads, 0);
  assert.equal(ui.status.textContent, "Private meetings are not configured in this runtime.");
  assert.deepEqual(privateText(ui), ["", "", "", "", "", "", "", ""]);
  const publicText = Object.values(ui).map((element) => element.textContent).join(" ");
  assert.equal(publicText.includes("syn-tenant"), false);
  assert.equal(publicText.includes("session-"), false);
});

test("both entry paths resolve one shared trusted target immediately before opening one controller", async () => {
  const module = await loadModule("shared-trusted-target");
  const ui = elements();
  ui.worldEntry.dataset = { tenantId: "client-tenant", meetingSessionId: "client-meeting" };
  ui.nonSpatialEntry.dataset = { tenantId: "query-tenant", meetingSessionId: "query-meeting" };
  const target = Object.freeze({
    kind: "trusted_authorized_meeting_target",
    tenantId: "syn-tenant-a",
    meetingSessionId: "syn-tenant-a--session-a",
    active: true
  });
  const opens = [];
  const controller = {
    open: async (...args) => { opens.push(args); },
    refresh: async () => {},
    close: () => {}
  };
  let resolutions = 0;

  const composition = module.createPrivateMeetingInterfaces(ui, {
    getTrustedMeetingTarget: () => { resolutions += 1; return target; },
    getTrustedSession: () => ({}),
    readAuthorizedMeetingSession: async () => ({})
  }, () => controller);

  composition.refreshAvailability();
  assert.equal(ui.worldEntry.hidden, false);
  assert.equal(ui.worldEntry.disabled, false);
  assert.equal(ui.nonSpatialEntry.hidden, false);
  assert.equal(ui.nonSpatialEntry.disabled, false);

  const beforeWorld = resolutions;
  ui.worldEntry.dispatch("click");
  await Promise.resolve();
  assert.ok(resolutions > beforeWorld);
  const beforeNonSpatial = resolutions;
  ui.nonSpatialEntry.dispatch("click");
  await Promise.resolve();
  assert.ok(resolutions > beforeNonSpatial);
  assert.equal(composition.controller, controller);
  assert.deepEqual(opens, [
    [ui.worldEntry, "syn-tenant-a", "syn-tenant-a--session-a"],
    [ui.nonSpatialEntry, "syn-tenant-a", "syn-tenant-a--session-a"]
  ]);
});

test("world and non-spatial paths render identical ended meeting meaning through the shared dialog", async () => {
  const module = await loadModule("meaning-parity");
  const controllerModule = await loadControllerModule("meaning-parity-controller");
  const ui = elements();
  const target = Object.freeze({
    kind: "trusted_authorized_meeting_target",
    tenantId: "syn-tenant-a",
    meetingSessionId: "syn-tenant-a--session-a",
    active: true
  });
  const trustedSession = Object.freeze({
    kind: "trusted_authenticated_session",
    subjectId: "syn-tenant-a--subject-a",
    tenantId: "syn-tenant-a",
    authorizationRef: "syn-tenant-a--authorization-a",
    policyRevision: 1,
    active: true
  });
  const endedMeeting = Object.freeze({
    privacy: "tenant-private",
    tenantId: "syn-tenant-a",
    sessionId: "syn-tenant-a--session-a",
    revision: 2,
    purposeReference: "syn-tenant-a--purpose-a",
    participantSubjectIds: Object.freeze(["syn-tenant-a--subject-a", "syn-tenant-a--subject-b"]),
    materialReferences: Object.freeze(["syn-tenant-a--material-a"]),
    startedAt: "2000-01-01T00:01:30.000Z",
    endedAt: "2000-01-01T00:01:45.000Z",
    lifecycle: "ended",
    outcome: Object.freeze({ resultState: "no-decision", outcomeReference: "syn-tenant-a--no-decision-a" }),
    sourceReference: "syn-tenant-a--source-a",
    createdBySubjectId: "syn-tenant-a--subject-a",
    authorizationReference: "syn-tenant-a--authorization-a",
    policyRevision: 1,
    endedBySubjectId: "syn-tenant-a--subject-b",
    endAuthorizationReference: "syn-tenant-a--authorization-end",
    endPolicyRevision: 2
  });
  const composition = module.createPrivateMeetingInterfaces(ui, {
    getTrustedMeetingTarget: () => target,
    getTrustedSession: () => trustedSession,
    readAuthorizedMeetingSession: async () => endedMeeting
  }, controllerModule.createPrivateMeetingSessionInterfaceController);

  await composition.openWorld();
  const worldMeaning = [ui.status.textContent, ...privateText(ui)];
  composition.controller.close();
  await composition.openNonSpatial();
  const nonSpatialMeaning = [ui.status.textContent, ...privateText(ui)];

  assert.deepEqual(nonSpatialMeaning, worldMeaning);
  assert.deepEqual(worldMeaning, [
    "Authorized private meeting loaded.",
    "Purpose: syn-tenant-a--purpose-a",
    "Participants: syn-tenant-a--subject-a\nsyn-tenant-a--subject-b",
    "Materials: syn-tenant-a--material-a",
    "Lifecycle: Ended",
    "Started: 2000-01-01T00:01:30.000Z",
    "Ended: 2000-01-01T00:01:45.000Z",
    "Outcome: No decision",
    "Current room occupancy: None"
  ]);
});

test("trusted target revocation before refresh clears stale fields disables both paths and performs no stale read", async () => {
  const module = await loadModule("target-revocation");
  const controllerModule = await loadControllerModule("target-revocation-controller");
  const ui = elements();
  let target = Object.freeze({
    kind: "trusted_authorized_meeting_target",
    tenantId: "syn-tenant-a",
    meetingSessionId: "syn-tenant-a--session-a",
    active: true
  });
  const trustedSession = Object.freeze({
    kind: "trusted_authenticated_session",
    subjectId: "syn-tenant-a--subject-a",
    tenantId: "syn-tenant-a",
    authorizationRef: "syn-tenant-a--authorization-a",
    policyRevision: 1,
    active: true
  });
  const activeMeeting = Object.freeze({
    privacy: "tenant-private",
    tenantId: "syn-tenant-a",
    sessionId: "syn-tenant-a--session-a",
    revision: 1,
    purposeReference: "syn-tenant-a--purpose-a",
    participantSubjectIds: Object.freeze(["syn-tenant-a--subject-a"]),
    materialReferences: Object.freeze(["syn-tenant-a--material-a"]),
    startedAt: "2000-01-01T00:01:30.000Z",
    endedAt: null,
    lifecycle: "active",
    outcome: null,
    sourceReference: "syn-tenant-a--source-a",
    createdBySubjectId: "syn-tenant-a--subject-a",
    authorizationReference: "syn-tenant-a--authorization-a",
    policyRevision: 1
  });
  let reads = 0;
  const composition = module.createPrivateMeetingInterfaces(ui, {
    getTrustedMeetingTarget: () => target,
    getTrustedSession: () => trustedSession,
    readAuthorizedMeetingSession: async () => { reads += 1; return activeMeeting; }
  }, controllerModule.createPrivateMeetingSessionInterfaceController);

  await composition.openWorld();
  assert.equal(reads, 1);
  assert.equal(ui.purpose.textContent, "Purpose: syn-tenant-a--purpose-a");

  target = null;
  await composition.controller.refresh();

  assert.equal(reads, 1);
  assert.deepEqual(privateText(ui), ["", "", "", "", "", "", "", ""]);
  assert.equal(ui.worldEntry.hidden, true);
  assert.equal(ui.worldEntry.disabled, true);
  assert.equal(ui.nonSpatialEntry.hidden, true);
  assert.equal(ui.nonSpatialEntry.disabled, true);
  assert.equal(Object.values(ui).map((element) => element.textContent).join(" ").includes("purpose-a"), false);
});

test("proxy accessor and faulting trusted targets fail closed before enabling or opening", async () => {
  const module = await loadModule("target-proxy-accessor-fault");
  const ui = elements();
  const validTarget = {
    kind: "trusted_authorized_meeting_target",
    tenantId: "syn-tenant-a",
    meetingSessionId: "syn-tenant-a--session-a",
    active: true
  };
  const accessorTarget = {
    kind: "trusted_authorized_meeting_target",
    get tenantId() { return "syn-tenant-a"; },
    meetingSessionId: "syn-tenant-a--session-a",
    active: true
  };
  const faultingTarget = new Proxy(validTarget, {
    ownKeys() { throw new Error("rejected target details"); }
  });
  const rejectedTargets = [new Proxy(validTarget, {}), accessorTarget, faultingTarget];
  let currentTarget = rejectedTargets[0];
  let opens = 0;
  const composition = module.createPrivateMeetingInterfaces(ui, {
    getTrustedMeetingTarget: () => currentTarget,
    getTrustedSession: () => ({}),
    readAuthorizedMeetingSession: async () => ({})
  }, () => ({
    open: async () => { opens += 1; },
    refresh: async () => {},
    close: () => {}
  }));

  for (const target of rejectedTargets) {
    currentTarget = target;
    composition.refreshAvailability();
    await composition.openWorld();
    assert.equal(ui.worldEntry.disabled, true);
    assert.equal(ui.nonSpatialEntry.disabled, true);
  }

  assert.equal(opens, 0);
  assert.equal(Object.values(ui).map((element) => element.textContent).join(" ").includes("rejected target details"), false);
});

test("symbol extra-key and non-plain prototype trusted targets fail closed", async () => {
  const module = await loadModule("target-exact-plain");
  const ui = elements();
  const symbolTarget = {
    kind: "trusted_authorized_meeting_target",
    tenantId: "syn-tenant-a",
    meetingSessionId: "syn-tenant-a--session-a",
    active: true,
    [Symbol("extra-authority")]: true
  };
  const nonPlainTarget = Object.assign(Object.create({ inheritedAuthority: true }), {
    kind: "trusted_authorized_meeting_target",
    tenantId: "syn-tenant-a",
    meetingSessionId: "syn-tenant-a--session-a",
    active: true
  });
  let currentTarget = symbolTarget;
  let opens = 0;
  const composition = module.createPrivateMeetingInterfaces(ui, {
    getTrustedMeetingTarget: () => currentTarget,
    getTrustedSession: () => ({}),
    readAuthorizedMeetingSession: async () => ({})
  }, () => ({
    open: async () => { opens += 1; },
    refresh: async () => {},
    close: () => {}
  }));

  for (const target of [symbolTarget, nonPlainTarget]) {
    currentTarget = target;
    composition.refreshAvailability();
    await composition.openNonSpatial();
    assert.equal(ui.worldEntry.disabled, true);
    assert.equal(ui.nonSpatialEntry.disabled, true);
  }

  assert.equal(opens, 0);
});

test("trusted target identifiers are bounded and malformed values remain rejected after ambient intrinsic mutation", async () => {
  const module = await loadModule("target-bounds-intrinsics");
  const ui = elements();
  const longTenantId = `syn-tenant-${"a".repeat(5000)}`;
  const overlongTarget = {
    kind: "trusted_authorized_meeting_target",
    tenantId: longTenantId,
    meetingSessionId: `${longTenantId}--session-a`,
    active: true
  };
  const malformedTarget = {
    kind: "trusted_authorized_meeting_target",
    tenantId: "malformed-private-value",
    meetingSessionId: "also-malformed-private-value",
    active: true
  };
  let currentTarget = overlongTarget;
  let opens = 0;
  const composition = module.createPrivateMeetingInterfaces(ui, {
    getTrustedMeetingTarget: () => currentTarget,
    getTrustedSession: () => ({}),
    readAuthorizedMeetingSession: async () => ({})
  }, () => ({
    open: async () => { opens += 1; },
    refresh: async () => {},
    close: () => {}
  }));

  await composition.openWorld();
  currentTarget = malformedTarget;
  const originalRegExpTest = RegExp.prototype.test;
  const originalStartsWith = String.prototype.startsWith;
  try {
    RegExp.prototype.test = () => true;
    String.prototype.startsWith = () => true;
    await composition.openNonSpatial();
  } finally {
    RegExp.prototype.test = originalRegExpTest;
    String.prototype.startsWith = originalStartsWith;
  }

  assert.equal(opens, 0);
  assert.equal(ui.worldEntry.disabled, true);
  assert.equal(ui.nonSpatialEntry.disabled, true);
  assert.equal(Object.values(ui).map((element) => element.textContent).join(" ").includes("malformed-private-value"), false);
});

test("Map get mutation after import keeps both entry paths closed to malformed trusted targets", async () => {
  const module = await loadModule("target-map-get-intrinsic");
  const ui = elements();
  const malformedTarget = {
    kind: "trusted_authorized_meeting_target",
    tenantId: "malformed-private-value",
    meetingSessionId: "also-malformed-private-value",
    active: true
  };
  const originalMapGet = Map.prototype.get;
  const descriptorReads = new WeakMap();
  let opens = 0;

  try {
    Map.prototype.get = function (key) {
      const reads = (descriptorReads.get(this) ?? 0) + 1;
      descriptorReads.set(this, reads);
      if (reads > 8 && key === "tenantId") return { value: "syn-tenant-a" };
      if (reads > 8 && key === "meetingSessionId") return { value: "syn-tenant-a--session-a" };
      return Reflect.apply(originalMapGet, this, [key]);
    };

    const composition = module.createPrivateMeetingInterfaces(ui, {
      getTrustedMeetingTarget: () => malformedTarget,
      getTrustedSession: () => ({}),
      readAuthorizedMeetingSession: async () => ({})
    }, () => ({
      open: async () => { opens += 1; },
      refresh: async () => {},
      close: () => {}
    }));

    await composition.openWorld();
    await composition.openNonSpatial();
  } finally {
    Map.prototype.get = originalMapGet;
  }

  assert.equal(opens, 0);
  assert.equal(ui.worldEntry.hidden, true);
  assert.equal(ui.worldEntry.disabled, true);
  assert.equal(ui.nonSpatialEntry.hidden, true);
  assert.equal(ui.nonSpatialEntry.disabled, true);
  assert.equal(Object.values(ui).map((element) => element.textContent).join(" ").includes("malformed-private-value"), false);
});

test("unstable target resolution prevents both entry paths from opening and disables both paths", async () => {
  const module = await loadModule("target-open-toctou");
  const targetA = Object.freeze({
    kind: "trusted_authorized_meeting_target",
    tenantId: "syn-tenant-a",
    meetingSessionId: "syn-tenant-a--session-a",
    active: true
  });
  const targetB = Object.freeze({
    kind: "trusted_authorized_meeting_target",
    tenantId: "syn-tenant-b",
    meetingSessionId: "syn-tenant-b--session-b",
    active: true
  });

  for (const path of ["openWorld", "openNonSpatial"]) {
    const ui = elements();
    const opens = [];
    let resolutions = 0;
    const composition = module.createPrivateMeetingInterfaces(ui, {
      getTrustedMeetingTarget: () => {
        resolutions += 1;
        return resolutions <= 2 ? targetA : targetB;
      },
      getTrustedSession: () => ({}),
      readAuthorizedMeetingSession: async () => ({})
    }, () => ({
      open: async (...args) => { opens.push(args); },
      refresh: async () => {},
      close: () => {}
    }));

    await composition[path]();

    assert.deepEqual(opens, []);
    assert.equal(ui.worldEntry.disabled, true);
    assert.equal(ui.nonSpatialEntry.disabled, true);
  }
});

test("world entry clears every private field without a stale read when its trusted target is revoked before open", async () => {
  const module = await loadModule("world-open-revocation");
  const controllerModule = await loadControllerModule("world-open-revocation-controller");

  await assertRevocationBeforeOpenClears(module, controllerModule, "openWorld");
});

test("non-spatial entry clears every private field without a stale read when its trusted target is revoked before open", async () => {
  const module = await loadModule("non-spatial-open-revocation");
  const controllerModule = await loadControllerModule("non-spatial-open-revocation-controller");

  await assertRevocationBeforeOpenClears(module, controllerModule, "openNonSpatial");
});

test("meeting entry and shared dialog markup preserve keyboard touch zoom reduced-motion and non-color meaning", async () => {
  const [html, main, styles] = await Promise.all([
    readFile(new URL("../index.html", import.meta.url), "utf8"),
    readFile(new URL("../src/main.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/styles.css", import.meta.url), "utf8")
  ]);

  assert.match(html, /id="private-meeting-world-open"[^>]*type="button"[^>]*hidden[^>]*disabled/);
  assert.match(html, /id="private-meeting-access"[^>]*type="button"[^>]*hidden[^>]*disabled/);
  assert.match(html, /<dialog id="private-meeting-dialog" aria-labelledby="private-meeting-title" aria-describedby="private-meeting-status">/);
  assert.match(html, /id="private-meeting-status" role="status" aria-live="polite"/);
  for (const id of ["purpose", "participants", "materials", "lifecycle", "started", "ended", "outcome", "occupancy"]) {
    assert.match(html, new RegExp(`id="private-meeting-${id}"`));
  }
  assert.match(html, /id="private-meeting-refresh"[^>]*type="button"/);
  assert.match(html, /id="private-meeting-close"[^>]*type="button"/);
  assert.match(html, /Private meetings are not configured in this runtime\./);

  assert.match(main, /createPrivateMeetingInterfaces/);
  assert.match(main, /createPrivateMeetingSessionInterfaceController/);
  assert.match(main, /getTrustedMeetingTarget:\s*\(\) => null/);
  assert.match(main, /getTrustedSession:\s*\(\) => null/);
  assert.doesNotMatch(main, /privateMeeting[^\n]*(URLSearchParams|dataset|location\.search)/);

  assert.match(styles, /#private-meeting-dialog[\s\S]*width:\s*min\([^;]*calc\(100vw - 2rem\)/);
  assert.match(styles, /#private-meeting-dialog[\s\S]*max-height:\s*calc\(100vh - 2rem\)/);
  assert.match(styles, /#private-meeting-dialog[\s\S]*overflow:\s*auto/);
  assert.match(styles, /#private-meeting-dialog button[\s\S]*min-height:\s*44px/);
  assert.match(styles, /@media \(prefers-reduced-motion: reduce\)[\s\S]*#private-meeting-dialog[\s\S]*transition:\s*none/);
});

test("authorized boardroom context uses the shared world entry path for keyboard and touch navigation", async () => {
  const main = await readFile(new URL("../src/main.ts", import.meta.url), "utf8");

  assert.match(main, /"inspect_private_meeting"/);
  assert.match(main, /PRIVATE_MEETING_INTERACTION_POSITION/);
  assert.match(main, /canInspectPrivateMeeting/);
  assert.match(main, /activeContextAction === "inspect_private_meeting"[\s\S]*privateMeetingInterfaces\.openWorld/);
  assert.match(main, /touchActionButton\.addEventListener\("click", handleNavigationAction\)/);
  assert.match(main, /code === "keye"[\s\S]*handleNavigationAction/);
});

test("world context opening preserves the exact keyboard or touch invoker for focus restoration", async () => {
  const module = await loadModule("world-exact-invoker");
  const ui = elements();
  const target = Object.freeze({
    kind: "trusted_authorized_meeting_target",
    tenantId: "syn-tenant-a",
    meetingSessionId: "syn-tenant-a--session-a",
    active: true
  });
  let receivedInvoker;
  const composition = module.createPrivateMeetingInterfaces(ui, {
    getTrustedMeetingTarget: () => target,
    getTrustedSession: () => ({}),
    readAuthorizedMeetingSession: async () => ({})
  }, () => ({
    open: async (invoker) => { receivedInvoker = invoker; },
    refresh: async () => {},
    close: () => {}
  }));
  const touchInvoker = eventTarget();

  await composition.openWorld(touchInvoker);

  assert.equal(receivedInvoker, touchInvoker);
});
