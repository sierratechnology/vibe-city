import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

async function loadSnapshotModule(fragment) {
  const source = await readFile(new URL("../src/operations/worldOperationsSnapshot.ts", import.meta.url), "utf8").catch(() => "");
  const transpiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 }
  }).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(transpiled).toString("base64")}#${fragment}`);
}

test("operations directory is an accessible public-safe equivalent outside the retired legacy interface", async () => {
  const [html, main, controller] = await Promise.all([
    readFile(new URL("../index.html", import.meta.url), "utf8"),
    readFile(new URL("../src/main.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/operations/operationsDirectory.ts", import.meta.url), "utf8").catch(() => "")
  ]);
  const publicShell = html.slice(html.indexOf("<!-- End legacy interface -->"));
  assert.match(publicShell, /id="operations-directory-access"/);
  assert.match(publicShell, /<dialog id="operations-directory-dialog"[^>]*aria-labelledby="operations-directory-title"/);
  assert.match(publicShell, /id="operations-directory-state"[^>]*aria-live="polite"/);
  assert.match(publicShell, /id="operations-directory-services"/);
  assert.match(publicShell, /id="operations-directory-record"/);
  assert.match(publicShell, /id="operations-directory-identity"/);
  assert.match(publicShell, /id="operations-directory-authority"/);
  assert.match(controller, /export function createOperationsDirectoryController/);
  assert.match(controller, /textContent/);
  assert.doesNotMatch(controller, /innerHTML/);
  assert.doesNotMatch(controller, /fetch\s*\(/);
  assert.match(main, /createOperationsDirectoryController\(/);
});

test("operations directory blocks world input, hides touch controls, and has bounded responsive styles", async () => {
  const [main, css] = await Promise.all([
    readFile(new URL("../src/main.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/styles.css", import.meta.url), "utf8")
  ]);
  assert.match(main, /interactionBlocked:\s*recordsTerminalDialog\.open\s*\|\|\s*operationsDirectoryDialog\.open/);
  assert.match(main, /sceneState\.transitioning\s*\|\|\s*recordsTerminalDialog\.open\s*\|\|\s*operationsDirectoryDialog\.open/);
  assert.match(main, /if\s*\(!cityEntered\s*\|\|\s*recordsTerminalDialog\.open\s*\|\|\s*operationsDirectoryDialog\.open\)\s*return/);
  assert.match(css, /body:not\(\.city-entered\)\s+\.operations-directory-access/);
  assert.doesNotMatch(css, /operations-directory-access:not\(:focus-visible\)[\s\S]*clip-path:\s*inset\(50%\)/);
  assert.match(css, /body\.city-entered \.operations-directory-access[\s\S]*min-height:\s*56px/);
  assert.match(css, /#operations-directory-dialog[\s\S]*box-sizing:\s*border-box/);
  assert.match(css, /#operations-directory-dialog[\s\S]*max-height:\s*calc\(100vh - 2rem\)/);
  assert.match(css, /@media \(max-width: 520px\)[\s\S]*#operations-directory-dialog/);
});

test("Headquarters exposes contextual Reception, Spiders identity, and Executive authority objects", async () => {
  const main = await readFile(new URL("../src/main.ts", import.meta.url), "utf8");
  assert.match(main, /\["Chief Agent Office", -6\.4, 4\.1\]/);
  assert.doesNotMatch(main, /\["Assistant Office", -6\.4, 4\.1\]/);
  assert.match(main, /const OPERATIONS_FIXTURES/);
  assert.match(main, /const RECEPTION_STATUS_INTERACTION_POSITION/);
  assert.match(main, /const CHIEF_AGENT_IDENTITY_INTERACTION_POSITION/);
  assert.match(main, /const EXECUTIVE_AUTHORITY_INTERACTION_POSITION/);
  assert.match(main, /label: "Reception Status"[\s\S]*position: RECEPTION_STATUS_INTERACTION_POSITION/);
  assert.match(main, /label: "Spiders Identity"[\s\S]*position: CHIEF_AGENT_IDENTITY_INTERACTION_POSITION/);
  assert.match(main, /label: "Executive Authority"[\s\S]*position: EXECUTIVE_AUTHORITY_INTERACTION_POSITION/);
  assert.match(main, /contextActionStatus\.textContent\s*=\s*contextStatusState\.text/);
  assert.doesNotMatch(main, /createLabelSprite\(fixture\.label/);
  assert.match(main, /for \(const fixture of OPERATIONS_FIXTURES\)[\s\S]*addCollider\(/);
  assert.match(main, /"inspect_reception_status"/);
  assert.match(main, /"inspect_chief_identity"/);
  assert.match(main, /"inspect_executive_authority"/);
  assert.match(main, /operationsDirectory\.open\(opener\)/);
  assert.match(main, /touchActionButton\.textContent\s*=\s*contextActionLabel/);
});

test("Reception reuses the validated Records lifecycle without loading the source again", async () => {
  const [main, recordsController] = await Promise.all([
    readFile(new URL("../src/main.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/records/recordsTerminal.ts", import.meta.url), "utf8")
  ]);
  assert.match(recordsController, /onStateChange\?: \(state: PublicProjectRecordState\) => void/);
  assert.match(recordsController, /elements\.onStateChange\?\.\(state\)/);
  assert.match(main, /let recordsObservation: RecordsObservation = \{ state: "not_checked", asOf: null \}/);
  assert.match(main, /records: recordsObservation/);
  assert.match(main, /onStateChange: \(state\) =>/);
});

test("public operations snapshot separates static Spiders identity from hosted-agent state", async () => {
  const module = await loadSnapshotModule("identity");
  assert.equal(typeof module.createWorldOperationsSnapshot, "function");

  const snapshot = module.createWorldOperationsSnapshot({
    now: () => Date.parse("2026-07-28T14:00:00Z")
  });

  assert.equal(snapshot.schemaVersion, "1.0");
  assert.deepEqual(snapshot.source, {
    id: "vibe-city-public-world-operations",
    label: "Vibe City public operations snapshot",
    visibility: "public"
  });
  assert.equal(snapshot.generatedAt, "2026-07-28T14:00:00.000Z");
  assert.deepEqual(snapshot.hostedAgents, {
    registryStatus: "not_configured",
    projectedCount: 0,
    reason: "not_configured"
  });
  assert.deepEqual(snapshot.approvedPublicRecords, []);
  assert.deepEqual(snapshot.publicIdentities, [{
    identityId: "stg-spiders",
    kind: "static_identity",
    displayName: "Spiders",
    roleLabel: "Chief Agent",
    workplace: {
      id: "stg-chief-agent-office",
      label: "Chief Agent Office",
      relationship: "designated"
    },
    representation: "plaque_only",
    temporality: "static",
    availability: "not_claimed",
    currentWork: null,
    source: "checked_in_public_identity",
    authority: {
      scope: "coordination_and_synthesis_support",
      mayApproveConsequentialActions: false,
      humanApprovalRequired: true
    }
  }]);
  assert.equal("assignments" in snapshot.publicIdentities[0], false);
  assert.equal("permissions" in snapshot.publicIdentities[0], false);
  assert.equal("tools" in snapshot.publicIdentities[0], false);
  assert.equal("projects" in snapshot.publicIdentities[0], false);
  assert.equal("devices" in snapshot.publicIdentities[0], false);
});

test("public operations snapshot maps truthful Reception and human-authority state and fails malformed observations closed", async () => {
  const module = await loadSnapshotModule("services");
  const observed = module.createWorldOperationsSnapshot({
    now: () => Date.parse("2026-07-28T14:05:00Z"),
    services: {
      coreWorld: "working",
      realtime: "realtime_unavailable",
      records: { state: "not_checked", asOf: null }
    }
  });
  const reception = Object.fromEntries(observed.reception.map((item) => [item.id, item]));
  assert.deepEqual(reception["world-zero"], {
    id: "world-zero",
    label: "World Zero entry and movement",
    status: "working",
    summary: "Public World Zero entry and movement are available.",
    freshness: "live",
    asOf: "2026-07-28T14:05:00.000Z",
    reason: null
  });
  assert.equal(reception["public-records-terminal"].status, "working");
  assert.equal(reception["public-record-source"].status, "unavailable");
  assert.equal(reception["public-record-source"].freshness, "unavailable");
  assert.equal(reception["spiders-identity"].summary, "Static role identity published; live availability is not claimed.");
  assert.deepEqual(reception["hosted-agent-registry"], {
    id: "hosted-agent-registry",
    label: "Hosted-agent registry",
    status: "not_configured",
    summary: "No authorized hosted-agent registry is configured. Projected hosted agents: 0.",
    freshness: "unavailable",
    asOf: null,
    reason: "not_configured"
  });
  assert.equal(reception["multiplayer-realtime"].status, "degraded");
  assert.equal(reception["private-work-state"].status, "private");
  assert.equal(reception["private-work-state"].summary, "Private Hermes and Kanban work state is not published on the public site.");
  assert.equal(reception["executive-authority"].status, "working");
  assert.deepEqual(observed.executiveAuthority, {
    personLabel: "Devon",
    roleLabel: "Human owner / executive authority",
    reservedActions: ["spending", "external_communication", "irreversible_changes", "protected_releases"],
    delegationPolicy: "explicit_approved_policy_required",
    isApprovalControl: false
  });

  const malformed = module.createWorldOperationsSnapshot({
    now: () => Date.parse("2026-07-28T14:06:00Z"),
    services: {
      coreWorld: { status: "working", privateError: "do-not-leak" },
      realtime: "definitely_working_trust_me",
      records: { state: "fresh", asOf: "not-a-time" }
    }
  });
  const malformedReception = Object.fromEntries(malformed.reception.map((item) => [item.id, item]));
  assert.equal(malformedReception["world-zero"].status, "unavailable");
  assert.equal(malformedReception["multiplayer-realtime"].status, "unavailable");
  assert.equal(malformedReception["public-record-source"].status, "unavailable");
  assert.equal(JSON.stringify(malformed).includes("do-not-leak"), false);
  assert.equal(JSON.stringify(malformed).includes("definitely_working_trust_me"), false);
  for (const forbidden of ["token", "secret", "password", "credential", "authorization", "cookie", "transcript", "prompt", "privateTask", "email", "phone", "coordinates", "wallet", "balance", "apiKey", "rawError", "stack"]) {
    assert.equal(JSON.stringify(malformed).toLowerCase().includes(`\"${forbidden.toLowerCase()}\"`), false, forbidden);
  }
});

test("snapshot projects a validated public record with complete evidence and preserves stale truth", async () => {
  const module = await loadSnapshotModule("records-projection");
  const sha = "a".repeat(40);
  const record = {
    title: "Truthful operations milestone",
    source: "GitHub public repository",
    sourceId: sha,
    sourceUpdatedAt: "2026-07-28T14:00:00.000Z",
    observedAt: "2026-07-28T14:01:00.000Z",
    checkedAt: "2026-07-28T14:02:00.000Z",
    url: `https://github.com/sierratechnology/vibe-city/commit/${sha}`
  };
  const fresh = module.createWorldOperationsSnapshot({
    now: () => Date.parse("2026-07-28T14:03:00Z"),
    services: { coreWorld: "working", realtime: "missing_configuration", records: { state: "fresh", asOf: record.observedAt, failure: null, record: { ...record, checkedAt: record.observedAt } } }
  });
  assert.deepEqual(fresh.approvedPublicRecords, [{ ...record, checkedAt: record.observedAt, freshness: "fresh", failureReason: null }]);

  const stale = module.createWorldOperationsSnapshot({
    now: () => Date.parse("2026-07-28T14:04:00Z"),
    services: { coreWorld: "working", realtime: "missing_configuration", records: { state: "stale", asOf: record.observedAt, failure: "network", record } }
  });
  assert.deepEqual(stale.approvedPublicRecords, [{ ...record, freshness: "stale", failureReason: "network" }]);
  assert.equal(stale.reception.find((item) => item.id === "public-record-source").asOf, record.observedAt);

  const invalid = module.createWorldOperationsSnapshot({
    now: () => Date.parse("2026-07-28T14:05:00Z"),
    services: {
      coreWorld: "working",
      realtime: "missing_configuration",
      records: { state: "fresh", asOf: record.observedAt, failure: null, record: { ...record, url: `https://github.com/sierratechnology/vibe-city/commit/${"b".repeat(40)}` } }
    }
  });
  assert.deepEqual(invalid.approvedPublicRecords, []);
  assert.equal(invalid.reception.find((item) => item.id === "public-record-source").status, "unavailable");

  for (const contradictory of [
    { state: "fresh", asOf: record.observedAt, failure: "network", record },
    { state: "stale", asOf: record.observedAt, failure: null, record },
    { state: "fresh", asOf: record.observedAt, failure: "unknown_failure", record }
  ]) {
    const snapshot = module.createWorldOperationsSnapshot({
      now: () => Date.parse("2026-07-28T14:06:00Z"),
      services: { coreWorld: "working", realtime: "missing_configuration", records: contradictory }
    });
    assert.deepEqual(snapshot.approvedPublicRecords, []);
    assert.equal(snapshot.reception.find((item) => item.id === "public-record-source").status, "unavailable");
  }

  for (const contradictoryRecord of [
    { ...record, sourceUpdatedAt: "2026-07-28T15:00:00.000Z" },
    { ...record, checkedAt: "2026-07-28T13:00:00.000Z" },
    { ...record, checkedAt: "2026-07-28T15:00:00.000Z" }
  ]) {
    const snapshot = module.createWorldOperationsSnapshot({
      now: () => Date.parse("2026-07-28T14:06:00Z"),
      services: { coreWorld: "working", realtime: "missing_configuration", records: { state: "stale", asOf: record.observedAt, failure: "network", record: contradictoryRecord } }
    });
    assert.deepEqual(snapshot.approvedPublicRecords, []);
    assert.equal(snapshot.reception.find((item) => item.id === "public-record-source").status, "unavailable");
  }
});

test("snapshot never throws for malformed top-level options or time providers", async () => {
  const module = await loadSnapshotModule("top-level-fail-closed");
  const malformedInputs = [
    null,
    17,
    [],
    { now: () => Number.NaN, services: { coreWorld: "working" } },
    { now: () => { throw new Error("private runtime failure"); }, services: { coreWorld: "working" } },
    Object.defineProperty({}, "now", { get() { throw new Error("private now getter"); } }),
    Object.defineProperty({ now: () => Date.parse("2026-07-28T14:06:00Z") }, "services", { get() { throw new Error("private services getter"); } }),
    new Proxy({}, { get() { throw new Error("private proxy failure"); } })
  ];
  for (const input of malformedInputs) {
    let snapshot;
    assert.doesNotThrow(() => { snapshot = module.createWorldOperationsSnapshot(input); });
    assert.equal(snapshot.generatedAt, "1970-01-01T00:00:00.000Z");
    assert.equal(snapshot.hostedAgents.projectedCount, 0);
    assert.deepEqual(snapshot.approvedPublicRecords, []);
    assert.equal(snapshot.reception.find((item) => item.id === "world-zero").status, "unavailable");
    assert.equal(JSON.stringify(snapshot).includes("private runtime failure"), false);
    assert.equal(JSON.stringify(snapshot).includes("private now getter"), false);
    assert.equal(JSON.stringify(snapshot).includes("private services getter"), false);
    assert.equal(JSON.stringify(snapshot).includes("private proxy failure"), false);
  }
});

test("Realtime working requires a subscribed channel rather than transport alone", async () => {
  const module = await loadSnapshotModule("realtime-readiness");
  assert.equal(module.deriveRealtimeObservation({ envConfigured: true, websocketConnected: true, channelStatus: "subscribed" }), "working");
  assert.equal(module.deriveRealtimeObservation({ envConfigured: true, websocketConnected: true, channelStatus: "connecting" }), "realtime_unavailable");
  assert.equal(module.deriveRealtimeObservation({ envConfigured: true, websocketConnected: true, channelStatus: "CHANNEL_ERROR" }), "realtime_unavailable");
  assert.equal(module.deriveRealtimeObservation({ envConfigured: false, websocketConnected: false, channelStatus: "closed" }), "missing_configuration");
  assert.equal(module.deriveRealtimeObservation(new Proxy({}, { get() { throw new Error("private realtime getter"); } })), "realtime_unavailable");
});
