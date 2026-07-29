import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const [main, html, css] = await Promise.all([
  readFile(new URL("../src/main.ts", import.meta.url), "utf8"),
  readFile(new URL("../index.html", import.meta.url), "utf8"),
  readFile(new URL("../src/styles.css", import.meta.url), "utf8")
]);

test("production world does not project seeded agents without an authorized registry", () => {
  assert.doesNotMatch(main, /const citizens\s*=\s*createCitizens\(\)/);
  assert.doesNotMatch(main, /seedCitizenKnowledge\(citizens\)/);
  assert.match(main, /projectAuthorizedAgents(?:<[^>]+>)?\(/);
});

test("agent projection rejects runtime records without authorized provenance", async () => {
  const source = await readFile(new URL("../src/world/agentProjection.ts", import.meta.url), "utf8");
  const transpiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 }
  }).outputText;
  const module = await import(`data:text/javascript;base64,${Buffer.from(transpiled).toString("base64")}`);
  const projected = module.projectAuthorizedAgents({
    status: "ready",
    agents: [{ agent: { id: "fake" }, source: "seeded", sourceId: "seed-1", synchronizedAt: "2026-07-28T00:00:00Z" }]
  });
  assert.deepEqual(projected, []);
  const validAgent = { id: "authorized" };
  const malformedProjection = module.projectAuthorizedAgents({
    status: "ready",
    agents: [
      null,
      undefined,
      42,
      "not-a-record",
      {},
      { agent: { id: "missing-source" } },
      { agent: validAgent, source: "authorized_registry", sourceId: "registry-1", synchronizedAt: "2026-07-28T00:00:00Z" }
    ]
  });
  assert.deepEqual(malformedProjection, [validAgent]);
  assert.deepEqual(module.projectAuthorizedAgents({ status: "ready", agents: null }), []);
  assert.deepEqual(module.projectAuthorizedAgents(null), []);
});

test("truthful records terminal is accessible and separate from the legacy interface", () => {
  const legacyEnd = html.indexOf("<!-- End legacy interface -->");
  const terminal = html.slice(legacyEnd);
  assert.match(terminal, /<dialog id="records-terminal-dialog"[^>]*aria-labelledby="records-terminal-title"/);
  assert.match(terminal, /id="records-terminal-state"[^>]*aria-live="polite"/);
  assert.match(terminal, /id="records-terminal-source"[^>]*target="_blank"[^>]*rel="noreferrer"/);
  assert.match(terminal, /id="records-terminal-close"/);
  assert.doesNotMatch(terminal, /id="records-access"/);
  assert.doesNotMatch(css, /#records-access/);
  assert.doesNotMatch(main, /\.innerHTML\b/);
});

test("public project record adapter pins its source without credential handling", async () => {
  const source = await readFile(new URL("../src/records/publicProjectRecord.ts", import.meta.url), "utf8").catch(() => "");
  assert.match(source, /https:\/\/api\.github\.com\/repos\/sierratechnology\/vibe-city\/commits\?per_page=1/);
  assert.match(source, /application\/vnd\.github\+json/);
  assert.doesNotMatch(source, /Authorization|token|secret|password/i);
  assert.match(source, /export (?:async )?function loadLatestPublicProjectRecord/);
});

test("public project record adapter rejects a durable-source URL that does not exactly match the SHA", async () => {
  const source = await readFile(new URL("../src/records/publicProjectRecord.ts", import.meta.url), "utf8");
  const transpiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 }
  }).outputText;
  const module = await import(`data:text/javascript;base64,${Buffer.from(transpiled).toString("base64")}#malicious-url`);
  const sha = "a".repeat(40);
  const state = await module.loadLatestPublicProjectRecord({
    force: true,
    now: () => Date.parse("2026-07-28T01:00:00Z"),
    fetcher: async () => new Response(JSON.stringify([{
      sha,
      html_url: `https://github.com/sierratechnology/vibe-city/commit/${sha}/../../issues/1`,
      commit: { message: "Untrusted link", committer: { date: "2026-07-28T00:30:00Z" } }
    }]), { status: 200 })
  });
  assert.deepEqual(state, {
    status: "unavailable",
    freshness: "unavailable",
    reason: "invalid_record",
    checkedAt: "2026-07-28T01:00:00.000Z"
  });
});

test("public project record adapter rejects a source timestamp later than its observation", async () => {
  const source = await readFile(new URL("../src/records/publicProjectRecord.ts", import.meta.url), "utf8");
  const transpiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 }
  }).outputText;
  const module = await import(`data:text/javascript;base64,${Buffer.from(transpiled).toString("base64")}#future-source-time`);
  const sha = "d".repeat(40);
  const state = await module.loadLatestPublicProjectRecord({
    force: true,
    now: () => Date.parse("2026-07-28T14:00:00Z"),
    fetcher: async () => new Response(JSON.stringify([{
      sha,
      html_url: `https://github.com/sierratechnology/vibe-city/commit/${sha}`,
      commit: { message: "Future source", committer: { date: "2026-07-28T15:00:00Z" } }
    }]), { status: 200 })
  });
  assert.deepEqual(state, {
    status: "unavailable",
    freshness: "unavailable",
    reason: "invalid_record",
    checkedAt: "2026-07-28T14:00:00.000Z"
  });
});

test("public project record adapter deduplicates concurrent loads", async () => {
  const source = await readFile(new URL("../src/records/publicProjectRecord.ts", import.meta.url), "utf8");
  const transpiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 }
  }).outputText;
  const module = await import(`data:text/javascript;base64,${Buffer.from(transpiled).toString("base64")}#dedupe`);
  const sha = "b".repeat(40);
  let calls = 0;
  const fetcher = async () => {
    calls += 1;
    await new Promise((resolve) => setTimeout(resolve, 20));
    return new Response(JSON.stringify([{
      sha,
      html_url: `https://github.com/sierratechnology/vibe-city/commit/${sha}`,
      commit: { message: "Verified record", committer: { date: "2026-07-28T00:30:00Z" } }
    }]), { status: 200 });
  };
  const options = { fetcher, now: () => Date.parse("2026-07-28T01:00:00Z") };
  const [first, second] = await Promise.all([
    module.loadLatestPublicProjectRecord(options),
    module.loadLatestPublicProjectRecord(options)
  ]);
  assert.equal(calls, 1);
  assert.deepEqual(first, second);
  assert.equal(first.freshness, "fresh");
});

test("public project record adapter preserves last-known data as stale after a failed refresh", async () => {
  const source = await readFile(new URL("../src/records/publicProjectRecord.ts", import.meta.url), "utf8");
  const transpiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 }
  }).outputText;
  const module = await import(`data:text/javascript;base64,${Buffer.from(transpiled).toString("base64")}#stale`);
  const sha = "c".repeat(40);
  let request;
  const first = await module.loadLatestPublicProjectRecord({
    force: true,
    now: () => Date.parse("2026-07-28T01:00:00Z"),
    fetcher: async (url, init) => {
      request = { url, init };
      return new Response(JSON.stringify([{
        sha,
        html_url: `https://github.com/sierratechnology/vibe-city/commit/${sha}`,
        commit: { message: "Verified\nbody", committer: { date: "2026-07-28T00:30:00Z" } }
      }]), { status: 200 });
    }
  });
  const stale = await module.loadLatestPublicProjectRecord({
    force: true,
    now: () => Date.parse("2026-07-28T01:00:30Z"),
    fetcher: async () => { throw new Error("offline"); }
  });
  assert.equal(request.url, "https://api.github.com/repos/sierratechnology/vibe-city/commits?per_page=1");
  assert.deepEqual(request.init.headers, { Accept: "application/vnd.github+json" });
  assert.equal(first.freshness, "fresh");
  assert.equal(first.title, "Verified");
  assert.equal(stale.freshness, "stale");
  assert.equal(stale.staleReason, "network");
  assert.equal(stale.sourceId, sha);
  assert.equal(stale.observedAt, first.observedAt);
  assert.equal(stale.checkedAt, "2026-07-28T01:00:30.000Z");
  let cachedFetchCalls = 0;
  const cachedReopen = await module.loadLatestPublicProjectRecord({
    now: () => Date.parse("2026-07-28T01:00:45Z"),
    fetcher: async () => {
      cachedFetchCalls += 1;
      throw new Error("cache should not revalidate yet");
    }
  });
  assert.equal(cachedFetchCalls, 0);
  assert.equal(cachedReopen.freshness, "stale");
  assert.equal(cachedReopen.staleReason, "network");
  assert.equal(cachedReopen.checkedAt, stale.checkedAt);
  let recoveryCalls = 0;
  const recovered = await module.loadLatestPublicProjectRecord({
    force: true,
    now: () => Date.parse("2026-07-28T01:02:00Z"),
    fetcher: async () => {
      recoveryCalls += 1;
      return new Response(JSON.stringify([{
        sha,
        html_url: `https://github.com/sierratechnology/vibe-city/commit/${sha}`,
        commit: { message: "Recovered source", committer: { date: "2026-07-28T00:45:00Z" } }
      }]), { status: 200 });
    }
  });
  assert.equal(recoveryCalls, 1);
  assert.equal(recovered.freshness, "fresh");
  assert.equal(recovered.title, "Recovered source");
  assert.equal(recovered.checkedAt, "2026-07-28T01:02:00.000Z");
  assert.equal(recovered.staleReason, undefined);
});

test("records terminal controller loads only from an explicit open or refresh action", async () => {
  const source = await readFile(new URL("../src/records/recordsTerminal.ts", import.meta.url), "utf8").catch(() => "");
  assert.match(source, /export function createRecordsTerminalController/);
  assert.match(source, /showModal\(\)/);
  assert.match(source, /textContent/);
  assert.doesNotMatch(source, /innerHTML/);
  assert.match(source, /async function open/);
  assert.match(source, /async function refresh/);
  assert.match(source, /state\.status === "unavailable"/);
  assert.match(source, /No record is being claimed/);
  assert.match(source, /elements\.source\.hidden = true/);
  assert.doesNotMatch(source, /elements\.access|access:\s*HTMLButtonElement/);
  assert.match(main, /createRecordsTerminalController\(/);
});

test("Projects & Updates contains a physical contextual records terminal", () => {
  assert.match(main, /const RECORDS_TERMINAL_INTERACTION_POSITION/);
  assert.match(main, /addBox\(headquartersGroup, 1\.35, 0\.88, 0\.18, 6\.4, 0\.82, 2\.55, recordsTerminalMaterial\)/);
  assert.match(main, /function canInspectRecordsTerminal\(\): boolean/);
  assert.match(main, /computeContextActionStatusState\(\{/);
  assert.doesNotMatch(main, /createLabelSprite\("Records Terminal"/);
  assert.match(main, /"inspect_records"/);
  assert.match(main, /recordsTerminal\.open\(\)/);
  assert.match(main, /activeContextAction/);
});
