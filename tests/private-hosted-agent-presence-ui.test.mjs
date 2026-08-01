import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

async function loadClient(fragment) {
  const source = await readFile(
    new URL("../src/agents/privateHostedAgentPresence.ts", import.meta.url),
    "utf8"
  ).catch(() => "");
  const transpiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 }
  }).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(transpiled).toString("base64")}#${fragment}`);
}

async function loadView(fragment) {
  const source = await readFile(
    new URL("../src/agents/privateHostedAgentPresenceView.ts", import.meta.url),
    "utf8"
  ).catch(() => "");
  const transpiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 }
  }).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(transpiled).toString("base64")}#${fragment}`);
}

async function loadWorldOperationsSnapshot(fragment) {
  const source = await readFile(
    new URL("../src/operations/worldOperationsSnapshot.ts", import.meta.url),
    "utf8"
  );
  const transpiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 }
  }).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(transpiled).toString("base64")}#${fragment}`);
}

const TENANT_ID = "id_1111111111111111";
const SUBJECT_ID = "id_2222222222222222";
const SESSION_ID = "id_3333333333333333";
const AUTHORIZATION_REF = "id_4444444444444444";
const RECORD_ID = "id_5555555555555555";

function authority(overrides = {}) {
  return {
    schemaVersion: "1.0",
    tenantId: TENANT_ID,
    subjectId: SUBJECT_ID,
    sessionId: SESSION_ID,
    mappingRevision: 7,
    policyRevision: 11,
    authorizationRef: AUTHORIZATION_REF,
    membershipActive: true,
    canReadHostedAgentPresence: true,
    ...overrides
  };
}

function acceptedResponse(overrides = {}) {
  return {
    schemaVersion: "1.0",
    tenantId: TENANT_ID,
    generatedAt: "2026-07-29T12:05:00.000Z",
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
      stateChangedAt: "2026-07-29T12:01:00.000Z",
      observedAt: "2026-07-29T12:03:00.000Z",
      checkedAt: "2026-07-29T12:04:00.000Z",
      recordRef: {
        recordId: RECORD_ID,
        href: `/api/private/tenants/${TENANT_ID}/records/${RECORD_ID}`
      }
    },
    ...overrides
  };
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function assertDeeplyFrozen(value) {
  if (value === null || typeof value !== "object") return;
  assert.equal(Object.isFrozen(value), true);
  for (const nested of Object.values(value)) assertDeeplyFrozen(nested);
}

const absentBoundary = () => ({
  refresh: async () => null,
  getAcceptedPresence: () => null
});

test("one stationary private Spiders presence shares meaning across world non-spatial mobile zoom reduced motion and kiosk while public output stays zero", async () => {
  const module = await loadView("stationary-shared-meaning");
  assert.equal(typeof module.createPrivateHostedAgentPresencePresentation, "function");

  const presentation = module.createPrivateHostedAgentPresencePresentation(acceptedResponse());
  const expectedSemanticPresence = {
    identity: "Spiders",
    role: "Chief Agent",
    state: "working",
    freshness: "live",
    asOf: "2026-07-29T12:03:00.000Z",
    recordHref: `/api/private/tenants/${TENANT_ID}/records/${RECORD_ID}`
  };

  assert.equal(presentation.world.occupancyCount, 1);
  assert.deepEqual(presentation.world.anchor, {
    id: "stg-chief-agent-office",
    label: "Chief Agent Office"
  });
  assert.equal(presentation.world.stationary, true);
  assert.deepEqual(presentation.world.semanticPresence, expectedSemanticPresence);
  assert.equal(
    presentation.world.semanticPresence,
    presentation.nonSpatial.semanticPresence,
    "world and non-spatial output must share one semantic model"
  );
  assertDeeplyFrozen(presentation);
});

test("no accepted private response presents locked unavailable without hosted occupancy", async () => {
  const module = await loadView("locked-unavailable");
  const presentation = module.createPrivateHostedAgentPresencePresentation(null);

  assert.equal(presentation.world.occupancyCount, 0);
  assert.equal(presentation.world.anchor, null);
  assert.equal(presentation.world.stationary, true);
  assert.deepEqual(presentation.world.semanticPresence, {
    identity: "Private hosted presence",
    role: "Authorized session required",
    state: "unavailable",
    freshness: "unavailable",
    asOf: null,
    recordHref: null
  });
  assert.equal(presentation.world.semanticPresence, presentation.nonSpatial.semanticPresence);
  assert.equal(JSON.stringify(presentation).includes("Spiders"), false, "a static plaque cannot imply hosted state");
  assertDeeplyFrozen(presentation);
});

test("private presentation rejects undefined and missing nested objects without throwing or leaking", async () => {
  const module = await loadView("missing-presentation-structure");
  const rejectedValues = [undefined, {}, { presence: {} }, { ...acceptedResponse(), presence: { ...acceptedResponse().presence, workplace: undefined } }];

  for (const rejected of rejectedValues) {
    const presentation = module.createPrivateHostedAgentPresencePresentation(rejected);
    assert.equal(presentation.world.occupancyCount, 0);
    assert.equal(presentation.world.semanticPresence.recordHref, null);
    assert.doesNotMatch(JSON.stringify(presentation), /undefined|PRIVATE_/);
  }
});

test("private presentation catches throwing accessors at every accepted nested path without leaking exception text", async () => {
  const module = await loadView("throwing-presentation-accessors");
  const paths = [
    ["schemaVersion"], ["tenantId"], ["generatedAt"], ["presence"],
    ...["identityId", "displayName", "roleLabel", "workplace", "state", "freshness", "reason", "stateChangedAt", "observedAt", "checkedAt", "recordRef"].map((key) => ["presence", key]),
    ...["id", "label", "relationship"].map((key) => ["presence", "workplace", key]),
    ...["recordId", "href"].map((key) => ["presence", "recordRef", key])
  ];

  for (const path of paths) {
    const rejected = acceptedResponse();
    const parent = path.slice(0, -1).reduce((value, key) => value[key], rejected);
    Object.defineProperty(parent, path.at(-1), {
      enumerable: true,
      get() { throw new Error("PRIVATE_EXCEPTION_TEXT"); }
    });
    const presentation = module.createPrivateHostedAgentPresencePresentation(rejected);
    assert.equal(presentation.world.occupancyCount, 0, path.join("."));
    assert.equal(presentation.world.semanticPresence.recordHref, null);
    assert.doesNotMatch(JSON.stringify(presentation), /PRIVATE_EXCEPTION_TEXT/);
  }
});

test("private presentation rejects transparent and mutating proxies before validation can render private text", async () => {
  const module = await loadView("mutating-presentation-proxies");
  const transparentTarget = acceptedResponse();
  const transparent = new Proxy(transparentTarget, {
    ownKeys: (target) => Reflect.ownKeys(target),
    getOwnPropertyDescriptor: (target, property) => Reflect.getOwnPropertyDescriptor(target, property),
    getPrototypeOf: (target) => Reflect.getPrototypeOf(target)
  });
  const unstableTarget = acceptedResponse();
  let displayNameDescriptorReads = 0;
  unstableTarget.presence = new Proxy(unstableTarget.presence, {
    getOwnPropertyDescriptor(target, property) {
      const descriptor = Reflect.getOwnPropertyDescriptor(target, property);
      if (property === "displayName") {
        displayNameDescriptorReads += 1;
        return { ...descriptor, value: displayNameDescriptorReads === 1 ? "Spiders" : "PRIVATE_LEAK" };
      }
      return descriptor;
    }
  });
  const keyTarget = acceptedResponse();
  let keyReads = 0;
  const unstableKeys = new Proxy(keyTarget, {
    ownKeys(target) {
      keyReads += 1;
      return keyReads === 1 ? Reflect.ownKeys(target) : [...Reflect.ownKeys(target), "PRIVATE_LEAK"];
    }
  });

  for (const rejected of [transparent, unstableTarget, unstableKeys]) {
    const presentation = module.createPrivateHostedAgentPresencePresentation(rejected);
    assert.equal(presentation.world.occupancyCount, 0);
    assert.equal(presentation.world.semanticPresence.recordHref, null);
    assert.doesNotMatch(JSON.stringify(presentation), /PRIVATE_LEAK/);
  }
});

test("private presentation rejects unknown structure malformed scalars chronology and record paths", async () => {
  const module = await loadView("closed-presentation-schema");
  const withPresence = (overrides) => acceptedResponse({ presence: { ...acceptedResponse().presence, ...overrides } });
  const inherited = Object.assign(Object.create({ future: "PRIVATE_LEAK" }), acceptedResponse());
  const symbolValue = acceptedResponse();
  symbolValue[Symbol("PRIVATE_LEAK")] = true;
  const tooManyKeys = acceptedResponse();
  for (let index = 0; index < 20; index += 1) tooManyKeys[`future${index}`] = index;
  const rejectedValues = [
    { ...acceptedResponse(), future: "PRIVATE_LEAK" },
    withPresence({ future: "PRIVATE_LEAK" }),
    withPresence({ workplace: { ...acceptedResponse().presence.workplace, future: "PRIVATE_LEAK" } }),
    withPresence({ recordRef: { ...acceptedResponse().presence.recordRef, future: "PRIVATE_LEAK" } }),
    [], withPresence({ workplace: [] }), withPresence({ recordRef: [] }),
    symbolValue, inherited, new Date(), tooManyKeys,
    { ...acceptedResponse(), schemaVersion: "2.0" },
    { ...acceptedResponse(), tenantId: "id_UPPERCASE000000" },
    { ...acceptedResponse(), generatedAt: "2026-07-29T12:05:00Z" },
    withPresence({ stateChangedAt: "not-a-time" }),
    withPresence({ observedAt: "2026-07-29T12:06:00.000Z" }),
    withPresence({ checkedAt: "2026-07-29T12:02:00.000Z" }),
    withPresence({ identityId: "stg-private-leak" }),
    withPresence({ state: "meeting" }),
    withPresence({ freshness: "stale" }),
    withPresence({ reason: "PRIVATE_LEAK" }),
    withPresence({ recordRef: { recordId: "id_bad", href: "PRIVATE_LEAK" } }),
    withPresence({ recordRef: { recordId: RECORD_ID, href: "https://PRIVATE_LEAK.invalid" } }),
    withPresence({ recordRef: { recordId: RECORD_ID, href: `/api/private/tenants/id_9999999999999999/records/${RECORD_ID}` } })
  ];

  for (const rejected of rejectedValues) {
    const presentation = module.createPrivateHostedAgentPresencePresentation(rejected);
    assert.equal(presentation.world.occupancyCount, 0);
    assert.equal(presentation.world.semanticPresence.recordHref, null);
    assert.doesNotMatch(JSON.stringify(presentation), /PRIVATE_LEAK/);
  }
});

test("private presence state updates change semantics without movement or time-driven paths", async () => {
  const module = await loadView("stationary-state-update");
  assert.equal(typeof module.createPrivateHostedAgentPresenceViewController, "function");
  const controller = module.createPrivateHostedAgentPresenceViewController(null);

  const unavailable = controller.getPresentation();
  const working = controller.updateAcceptedPresence(acceptedResponse());
  const blocked = controller.updateAcceptedPresence(acceptedResponse({
    presence: { ...acceptedResponse().presence, state: "blocked", freshness: "recent" }
  }));

  assert.equal(unavailable.world.occupancyCount, 0);
  assert.equal(working.world.anchor, blocked.world.anchor, "every accepted state uses the one fixed office anchor");
  assert.equal(working.world.semanticPresence.state, "working");
  assert.equal(blocked.world.semanticPresence.state, "blocked");
  assert.deepEqual(Object.keys(blocked.world).sort(), ["anchor", "occupancyCount", "semanticPresence", "stationary"]);
  assert.doesNotMatch(
    JSON.stringify(blocked),
    /"(?:animation|celebration|interpolation|position|random|timer)"\s*:/i
  );
});

test("private presentation controls are keyboard and touch addressable without hover precise movement or color-only meaning", async () => {
  const module = await loadView("essential-controls");
  const presentation = module.createPrivateHostedAgentPresencePresentation(acceptedResponse());

  assert.deepEqual(presentation.nonSpatial.operation, {
    inputModes: ["keyboard", "touch"],
    requiresPreciseMovement: false,
    requiresHover: false,
    colorOnlyMeaning: false
  });
  assert.deepEqual(presentation.nonSpatial.controls, [
    { intent: "open", elementId: "private-hosted-presence-open", kind: "button", minimumTargetCssPixels: 44 },
    { intent: "refresh-request", elementId: "private-hosted-presence-refresh", kind: "button", minimumTargetCssPixels: 44 },
    {
      intent: "record-link",
      elementId: "private-hosted-presence-record",
      kind: "link",
      minimumTargetCssPixels: 44,
      href: `/api/private/tenants/${TENANT_ID}/records/${RECORD_ID}`
    },
    { intent: "close", elementId: "private-hosted-presence-close", kind: "button", minimumTargetCssPixels: 44 }
  ]);
  assertDeeplyFrozen(presentation.nonSpatial.operation);
  assertDeeplyFrozen(presentation.nonSpatial.controls);
});

test("mobile zoom reduced motion and kiosk preserve semantic fields and essential controls", async () => {
  const module = await loadView("device-parity");
  const presentation = module.createPrivateHostedAgentPresencePresentation(acceptedResponse());
  assert.deepEqual(presentation.nonSpatial.parity, {
    modes: ["desktop", "mobile-touch", "zoom-200", "reduced-motion", "kiosk-pi"],
    semanticFields: ["identity", "role", "state", "freshness", "asOf", "recordHref"],
    essentialControls: ["open", "refresh-request", "record-link", "close"],
    reflowsAtZoom200: true,
    motion: "none",
    kioskDecoration: "reduced"
  });

  const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
  for (const id of [
    "private-hosted-presence-open",
    "private-hosted-presence-dialog",
    "private-hosted-presence-identity",
    "private-hosted-presence-role",
    "private-hosted-presence-state",
    "private-hosted-presence-freshness",
    "private-hosted-presence-as-of",
    "private-hosted-presence-record",
    "private-hosted-presence-refresh",
    "private-hosted-presence-close"
  ]) assert.match(html, new RegExp(`id="${id}"`), `${id} must remain in the semantic DOM contract`);
  assert.match(html, /<dialog id="private-hosted-presence-dialog"[^>]*aria-labelledby=/);
  assert.match(html, /id="private-hosted-presence-refresh" type="button"/);
  assert.match(html, /id="private-hosted-presence-close" type="button"/);

  const css = await readFile(new URL("../src/styles.css", import.meta.url), "utf8");
  assert.match(css, /#private-hosted-presence-dialog\s*\{[^}]*max-height:[^}]*overflow:\s*auto/s);
  assert.match(css, /#private-hosted-presence-dialog[^}]*overflow-wrap:\s*anywhere/s);
  assert.match(css, /#private-hosted-presence-dialog[^}]*min-height:\s*44px/s);
  assert.match(css, /@media \(max-width: 640px\)[\s\S]*#private-hosted-presence-dialog/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)[\s\S]*#private-hosted-presence-dialog[\s\S]*animation:\s*none/);
  assert.match(css, /data-presentation-mode="kiosk-pi"/);
});

test("private presentation fails closed rather than exposing rejected text or external record links", async () => {
  const module = await loadView("safe-text-and-link");
  const rejected = acceptedResponse({
    presence: {
      ...acceptedResponse().presence,
      displayName: "<img src=x onerror=alert(1)>",
      recordRef: { recordId: RECORD_ID, href: "https://untrusted.invalid/private" }
    }
  });
  const presentation = module.createPrivateHostedAgentPresencePresentation(rejected);

  assert.equal(presentation.world.occupancyCount, 0);
  assert.equal(presentation.nonSpatial.semanticPresence.recordHref, null);
  assert.doesNotMatch(JSON.stringify(presentation), /img|onerror|untrusted\.invalid/);
  const source = await readFile(
    new URL("../src/agents/privateHostedAgentPresenceView.ts", import.meta.url),
    "utf8"
  );
  assert.doesNotMatch(source, /\.innerHTML\b|insertAdjacentHTML|eval\s*\(|new Function/);
});

test("private presentation leaves the public snapshot plaque-only with zero projected hosted agents", async () => {
  const [viewModule, worldModule] = await Promise.all([
    loadView("public-isolation"),
    loadWorldOperationsSnapshot("public-isolation")
  ]);
  const publicSnapshot = worldModule.createWorldOperationsSnapshot({ now: () => 0 });
  const before = JSON.stringify(publicSnapshot);
  const presentation = viewModule.createPrivateHostedAgentPresencePresentation(acceptedResponse());

  assert.deepEqual(presentation.isolation, {
    visibility: "private",
    publicProjection: "unchanged",
    publicHostedAgentDelta: 0
  });
  assert.equal(JSON.stringify(publicSnapshot), before);
  assert.deepEqual(publicSnapshot.hostedAgents, {
    registryStatus: "not_configured",
    projectedCount: 0,
    reason: "not_configured"
  });
  const publicSpiders = publicSnapshot.publicIdentities.find(({ identityId }) => identityId === "stg-spiders");
  assert.deepEqual({
    representation: publicSpiders.representation,
    temporality: publicSpiders.temporality,
    availability: publicSpiders.availability,
    currentWork: publicSpiders.currentWork
  }, {
    representation: "plaque_only",
    temporality: "static",
    availability: "not_claimed",
    currentWork: null
  });
});

test("private presence rejects non-primitive authority IDs and negative-zero revisions before loading", async () => {
  const module = await loadClient("primitive-authority-scalars");
  const createController = module.createPrivateHostedAgentPresenceController ?? absentBoundary;
  const malformedAuthorities = [
    ...["tenantId", "subjectId", "sessionId", "authorizationRef"].map((field) =>
      authority({ [field]: { toString: () => authority()[field] } })
    ),
    authority({ mappingRevision: -0 }),
    authority({ policyRevision: -0 })
  ];

  for (const trustedAuthority of malformedAuthorities) {
    let loadCount = 0;
    const controller = createController({
      getTrustedAuthoritySnapshot: () => trustedAuthority,
      loadPrivatePresence: async () => {
        loadCount += 1;
        return acceptedResponse();
      }
    });

    assert.equal(await controller.refresh(), null);
    assert.equal(loadCount, 0, "malformed authority must not begin a private load");
    assert.equal(controller.getAcceptedPresence(), null);
  }
});

test("private presence preserves newer acceptance after stale rejection unless authority is revoked", async () => {
  const module = await loadClient("stale-rejection");
  const createController = module.createPrivateHostedAgentPresenceController ?? absentBoundary;

  async function runOverlap(revokeBeforeOlderReject) {
    const olderPending = deferred();
    let trustedAuthority = authority();
    let loadCount = 0;
    const newerAccepted = acceptedResponse({
      presence: { ...acceptedResponse().presence, state: "blocked", freshness: "recent" }
    });
    const controller = createController({
      getTrustedAuthoritySnapshot: () => trustedAuthority,
      loadPrivatePresence: () => {
        loadCount += 1;
        return loadCount === 1 ? olderPending.promise : Promise.resolve(newerAccepted);
      }
    });

    const olderRefresh = controller.refresh();
    const newerResult = await controller.refresh();
    assert.deepEqual(newerResult, newerAccepted);
    if (revokeBeforeOlderReject) trustedAuthority = authority({ membershipActive: false });
    olderPending.reject(new Error("private rejected value must not leak"));
    assert.equal(await olderRefresh, null);
    return { controller, newerResult };
  }

  const unchanged = await runOverlap(false);
  assert.equal(
    unchanged.controller.getAcceptedPresence(),
    unchanged.newerResult,
    "a stale rejection cannot erase a newer accepted result under unchanged authority"
  );

  const revoked = await runOverlap(true);
  assert.equal(revoked.controller.getAcceptedPresence(), null, "genuine revocation must clear the newer accepted result");
});

test("private presence preserves authority-B acceptance after older authority-A resolution", async () => {
  const module = await loadClient("stale-resolution-after-authority-advance");
  const createController = module.createPrivateHostedAgentPresenceController ?? absentBoundary;
  const olderPending = deferred();
  let trustedAuthority = authority();
  let loadCount = 0;
  const newerAccepted = acceptedResponse({
    presence: { ...acceptedResponse().presence, state: "blocked", freshness: "recent" }
  });
  const controller = createController({
    getTrustedAuthoritySnapshot: () => trustedAuthority,
    loadPrivatePresence: () => {
      loadCount += 1;
      return loadCount === 1 ? olderPending.promise : Promise.resolve(newerAccepted);
    }
  });

  const olderRefresh = controller.refresh();
  trustedAuthority = authority({ mappingRevision: 8 });
  const newerResult = await controller.refresh();
  assert.deepEqual(newerResult, newerAccepted);
  assert.equal(controller.getAcceptedPresence(), newerResult);

  olderPending.resolve(acceptedResponse());
  assert.equal(await olderRefresh, null);
  assert.equal(
    controller.getAcceptedPresence(),
    newerResult,
    "an older authority-A resolution cannot erase a newer result accepted under current authority B"
  );
});

test("private presence preserves authority-B acceptance after older authority-A rejection", async () => {
  const module = await loadClient("stale-rejection-after-authority-advance");
  const createController = module.createPrivateHostedAgentPresenceController ?? absentBoundary;
  const olderPending = deferred();
  let trustedAuthority = authority();
  let loadCount = 0;
  const newerAccepted = acceptedResponse({
    presence: { ...acceptedResponse().presence, state: "blocked", freshness: "recent" }
  });
  const controller = createController({
    getTrustedAuthoritySnapshot: () => trustedAuthority,
    loadPrivatePresence: () => {
      loadCount += 1;
      return loadCount === 1 ? olderPending.promise : Promise.resolve(newerAccepted);
    }
  });

  const olderRefresh = controller.refresh();
  trustedAuthority = authority({ mappingRevision: 8 });
  const newerResult = await controller.refresh();
  assert.deepEqual(newerResult, newerAccepted);
  assert.equal(controller.getAcceptedPresence(), newerResult);

  olderPending.reject(new Error("private rejected value must not leak"));
  assert.equal(await olderRefresh, null);
  assert.equal(
    controller.getAcceptedPresence(),
    newerResult,
    "an older authority-A rejection cannot erase a newer result accepted under current authority B"
  );
});

test("private presence rejects sibling-induced deep mutation during whole-graph snapshot", async () => {
  const module = await loadClient("whole-graph-snapshot");
  const createController = module.createPrivateHostedAgentPresenceController ?? absentBoundary;
  const mutatingResponse = acceptedResponse();
  const recordRef = mutatingResponse.presence.recordRef;
  let sourceMutated = false;
  mutatingResponse.presence.recordRef = new Proxy(recordRef, {
    ownKeys(target) {
      sourceMutated = true;
      mutatingResponse.presence.workplace.label = "MUTATED_DURING_SNAPSHOT";
      return Reflect.ownKeys(target);
    }
  });
  let loadCount = 0;
  const controller = createController({
    getTrustedAuthoritySnapshot: () => authority(),
    loadPrivatePresence: async () => {
      loadCount += 1;
      return loadCount === 1 ? acceptedResponse() : mutatingResponse;
    }
  });

  assert.notEqual(await controller.refresh(), null, "fixture setup must accept");
  assert.equal(await controller.refresh(), null, "mutation anywhere in the source graph must reject the whole value");
  assert.equal(sourceMutated, true);
  assert.equal(controller.getAcceptedPresence(), null, "mutation rejection must clear previously accepted state");
});

test("private presence rejects mutation triggered during final whole-graph verification", async () => {
  const module = await loadClient("final-whole-graph-verification");
  const createController = module.createPrivateHostedAgentPresenceController ?? absentBoundary;
  const mutatingResponse = acceptedResponse();
  const recordRef = mutatingResponse.presence.recordRef;
  let ownKeysCalls = 0;
  mutatingResponse.presence.recordRef = new Proxy(recordRef, {
    ownKeys(target) {
      ownKeysCalls += 1;
      if (ownKeysCalls === 3) {
        mutatingResponse.presence.workplace.label = "MUTATED_ON_FINAL_RECHECK";
      }
      return Reflect.ownKeys(target);
    }
  });
  let loadCount = 0;
  const controller = createController({
    getTrustedAuthoritySnapshot: () => authority(),
    loadPrivatePresence: async () => {
      loadCount += 1;
      return loadCount === 1 ? acceptedResponse() : mutatingResponse;
    }
  });

  assert.notEqual(await controller.refresh(), null, "fixture setup must accept");
  const result = await controller.refresh();
  assert.deepEqual({
    ownKeysCalls,
    sourceLabel: mutatingResponse.presence.workplace.label,
    resultAccepted: result !== null,
    resultLabel: result?.presence?.workplace?.label ?? null,
    cacheAccepted: controller.getAcceptedPresence() !== null
  }, {
    ownKeysCalls: 3,
    sourceLabel: "MUTATED_ON_FINAL_RECHECK",
    resultAccepted: false,
    resultLabel: null,
    cacheAccepted: false
  });
});

test("private presence rejects a transparent top-level authority proxy before loading", async () => {
  const module = await loadClient("transparent-authority-proxy");
  const createController = module.createPrivateHostedAgentPresenceController ?? absentBoundary;
  let trustedAuthority = authority();
  let loadCount = 0;
  const controller = createController({
    getTrustedAuthoritySnapshot: () => trustedAuthority,
    loadPrivatePresence: async () => {
      loadCount += 1;
      return acceptedResponse();
    }
  });

  assert.notEqual(await controller.refresh(), null, "fixture setup must accept");
  assert.equal(loadCount, 1);
  const target = authority();
  trustedAuthority = new Proxy(target, {
    ownKeys: (candidate) => Reflect.ownKeys(candidate),
    getOwnPropertyDescriptor: (candidate, property) =>
      Reflect.getOwnPropertyDescriptor(candidate, property)
  });

  assert.equal(await controller.refresh(), null);
  assert.equal(loadCount, 1, "transparent authority proxy must begin zero private loads");
  assert.equal(controller.getAcceptedPresence(), null, "proxy rejection must clear all prior accepted fields");
  assert.equal(JSON.stringify(controller.getAcceptedPresence()), "null");
});

test("private presence clears accepted fields when membership mapping or policy is revoked after await", async () => {
  const module = await loadClient("membership-revocation");
  const createController = module.createPrivateHostedAgentPresenceController ?? absentBoundary;
  const pending = deferred();
  let trustedAuthority = authority();
  let loadCount = 0;
  const controller = createController({
    getTrustedAuthoritySnapshot: () => trustedAuthority,
    loadPrivatePresence: () => {
      loadCount += 1;
      return pending.promise;
    }
  });

  const refresh = controller.refresh();
  assert.equal(loadCount, 1, "an authorized refresh must begin exactly one private load");
  trustedAuthority = authority({ membershipActive: false });
  pending.resolve(acceptedResponse());

  assert.equal(await refresh, null);
  assert.equal(controller.getAcceptedPresence(), null);
  assert.equal(JSON.stringify(controller.getAcceptedPresence()), "null");

  const mappingPending = deferred();
  trustedAuthority = authority();
  const mappingController = createController({
    getTrustedAuthoritySnapshot: () => trustedAuthority,
    loadPrivatePresence: () => mappingPending.promise
  });
  const mappingRefresh = mappingController.refresh();
  trustedAuthority = authority({ mappingRevision: 8 });
  mappingPending.resolve(acceptedResponse());

  assert.equal(await mappingRefresh, null, "a changed reviewed mapping revision must revoke the in-flight result");
  assert.equal(mappingController.getAcceptedPresence(), null);
  assert.equal(JSON.stringify(mappingController.getAcceptedPresence()), "null");

  const policyPending = deferred();
  trustedAuthority = authority();
  const policyController = createController({
    getTrustedAuthoritySnapshot: () => trustedAuthority,
    loadPrivatePresence: () => policyPending.promise
  });
  const policyRefresh = policyController.refresh();
  trustedAuthority = authority({ policyRevision: 12 });
  policyPending.resolve(acceptedResponse());

  assert.equal(await policyRefresh, null, "a changed policy revision must revoke the in-flight result");
  assert.equal(policyController.getAcceptedPresence(), null);
  assert.equal(JSON.stringify(policyController.getAcceptedPresence()), "null");

  trustedAuthority = authority();
  const accepted = acceptedResponse();
  const revokedRefreshPending = deferred();
  let acceptedLoadCount = 0;
  const retainingController = createController({
    getTrustedAuthoritySnapshot: () => trustedAuthority,
    loadPrivatePresence: () => {
      acceptedLoadCount += 1;
      return acceptedLoadCount === 1 ? Promise.resolve(accepted) : revokedRefreshPending.promise;
    }
  });
  const detached = await retainingController.refresh();
  assert.deepEqual(detached, accepted);
  assert.notEqual(detached, accepted, "accepted state must be detached from the transport value");
  assertDeeplyFrozen(detached);
  assert.equal(retainingController.getAcceptedPresence(), detached);

  const revokedRefresh = retainingController.refresh();
  trustedAuthority = authority({ membershipActive: false });
  revokedRefreshPending.resolve(acceptedResponse());
  assert.equal(await revokedRefresh, null);
  assert.equal(retainingController.getAcceptedPresence(), null, "revocation must clear the prior accepted cache");
  assert.equal(JSON.stringify(retainingController.getAcceptedPresence()), "null");

  async function assertRejectedAfterAccepted(rejectedLoader, label) {
    trustedAuthority = authority();
    let loads = 0;
    const rejectingController = createController({
      getTrustedAuthoritySnapshot: () => trustedAuthority,
      loadPrivatePresence: () => {
        loads += 1;
        return loads === 1 ? Promise.resolve(acceptedResponse()) : rejectedLoader();
      }
    });
    assert.notEqual(await rejectingController.refresh(), null, `${label}: fixture setup must accept`);
    assert.equal(await rejectingController.refresh(), null, label);
    assert.equal(rejectingController.getAcceptedPresence(), null, `${label}: prior fields must be cleared`);
    assert.equal(JSON.stringify(rejectingController.getAcceptedPresence()), "null");
  }

  await assertRejectedAfterAccepted(
    () => Promise.resolve({ ...acceptedResponse(), privateSource: "must-not-survive" }),
    "unknown response keys fail closed"
  );
  await assertRejectedAfterAccepted(
    () => Promise.resolve({
      ...acceptedResponse(),
      presence: { ...acceptedResponse().presence, state: "meeting" }
    }),
    "malformed response values fail closed"
  );
  await assertRejectedAfterAccepted(
    () => { throw new Error("private rejected value must not leak"); },
    "synchronous loader exceptions fail closed"
  );
  await assertRejectedAfterAccepted(
    () => Promise.reject(new Error("private rejected value must not leak")),
    "asynchronous loader exceptions fail closed"
  );

  const accessorResponse = acceptedResponse();
  Object.defineProperty(accessorResponse, "generatedAt", {
    enumerable: true,
    get() { throw new Error("private accessor text must not leak"); }
  });
  await assertRejectedAfterAccepted(
    () => Promise.resolve(accessorResponse),
    "accessor-backed responses fail closed"
  );

  const proxyTarget = acceptedResponse();
  let proxyMutated = false;
  const mutatingProxy = new Proxy(proxyTarget, {
    getOwnPropertyDescriptor(target, property) {
      if (!proxyMutated) {
        proxyMutated = true;
        target.privateSource = "must-not-survive";
      }
      return Reflect.getOwnPropertyDescriptor(target, property);
    }
  });
  await assertRejectedAfterAccepted(
    () => Promise.resolve(mutatingProxy),
    "proxy-mutating responses fail closed"
  );

  const descriptorTarget = acceptedResponse();
  let descriptorMutated = false;
  const descriptorMutatingProxy = new Proxy(descriptorTarget, {
    getOwnPropertyDescriptor(target, property) {
      if (property === "tenantId" && !descriptorMutated) {
        descriptorMutated = true;
        target.schemaVersion = "2.0";
      }
      return Reflect.getOwnPropertyDescriptor(target, property);
    }
  });
  await assertRejectedAfterAccepted(
    () => Promise.resolve(descriptorMutatingProxy),
    "descriptor value mutation during response snapshot fails closed"
  );

  const authorityTarget = authority();
  let authorityMutated = false;
  const mutatingAuthority = new Proxy(authorityTarget, {
    getOwnPropertyDescriptor(target, property) {
      if (!authorityMutated) {
        authorityMutated = true;
        target.privateSource = "must-not-survive";
      }
      return Reflect.getOwnPropertyDescriptor(target, property);
    }
  });
  let authorityProxyLoads = 0;
  const authorityProxyController = createController({
    getTrustedAuthoritySnapshot: () => mutatingAuthority,
    loadPrivatePresence: async () => {
      authorityProxyLoads += 1;
      return acceptedResponse();
    }
  });
  assert.equal(await authorityProxyController.refresh(), null, "proxy-mutating authority snapshots fail closed");
  assert.equal(authorityProxyLoads, 0, "invalid authority must not begin a private load");

  const authorityDescriptorTarget = authority();
  let schemaDescriptorReads = 0;
  const authorityDescriptorProxy = new Proxy(authorityDescriptorTarget, {
    getOwnPropertyDescriptor(target, property) {
      const descriptor = Reflect.getOwnPropertyDescriptor(target, property);
      if (property === "schemaVersion") {
        schemaDescriptorReads += 1;
        if (schemaDescriptorReads > 1) return { ...descriptor, writable: false };
      }
      return descriptor;
    }
  });
  let authorityDescriptorLoads = 0;
  const authorityDescriptorController = createController({
    getTrustedAuthoritySnapshot: () => authorityDescriptorProxy,
    loadPrivatePresence: async () => {
      authorityDescriptorLoads += 1;
      return acceptedResponse();
    }
  });
  assert.equal(await authorityDescriptorController.refresh(), null, "authority descriptor mutation fails closed");
  assert.equal(authorityDescriptorLoads, 0);

  let publishAuthorityReads = 0;
  const publishRevocationController = createController({
    getTrustedAuthoritySnapshot: () => {
      publishAuthorityReads += 1;
      return publishAuthorityReads < 3 ? authority() : authority({ membershipActive: false });
    },
    loadPrivatePresence: async () => acceptedResponse()
  });
  assert.equal(
    await publishRevocationController.refresh(),
    null,
    "authority revoked after response normalization and immediately before publish must clear"
  );
  assert.equal(publishAuthorityReads, 3);

  const olderPending = deferred();
  const newerPending = deferred();
  let overlapLoads = 0;
  trustedAuthority = authority();
  const overlapController = createController({
    getTrustedAuthoritySnapshot: () => trustedAuthority,
    loadPrivatePresence: () => {
      overlapLoads += 1;
      return overlapLoads === 1 ? olderPending.promise : newerPending.promise;
    }
  });
  const olderRefresh = overlapController.refresh();
  const newerRefresh = overlapController.refresh();
  const newerAccepted = acceptedResponse({
    presence: { ...acceptedResponse().presence, state: "blocked", freshness: "recent" }
  });
  newerPending.resolve(newerAccepted);
  const newerResult = await newerRefresh;
  assert.deepEqual(newerResult, newerAccepted);
  olderPending.resolve(acceptedResponse());
  assert.equal(await olderRefresh, null, "an older completion must be rejected as stale-generation");
  assert.equal(overlapController.getAcceptedPresence(), newerResult, "an older completion cannot replace or clear the newer result");
});
