import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

async function loadTypeScriptModule(path, fragment) {
  const source = await readFile(new URL(path, import.meta.url), "utf8").catch(() => "");
  const transpiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 }
  }).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(transpiled).toString("base64")}#${fragment}`);
}

const EVENT = {
  version: "1.0",
  eventId: "evt_44444444444444444444444444444444",
  sourceType: "hermes_kanban",
  workRef: "public-a92cfe6086ac4f34",
  profileId: "ariadne",
  eventKind: "task_started",
  status: "running",
  occurredAt: "2026-07-28T22:00:00.000Z",
  observedAt: "2026-07-28T22:00:05.000Z",
  summary: "Work is in progress."
};
const PAYLOAD = {
  schemaVersion: "1.0",
  generatedAt: "2026-07-28T22:00:05.000Z",
  freshness: "recent",
  source: {
    type: "authenticated_local_work_events",
    eventCount: 1,
    newestOccurredAt: EVENT.occurredAt,
    newestObservedAt: EVENT.observedAt
  },
  events: [EVENT]
};

function element() {
  return {
    textContent: "",
    hidden: false,
    children: [],
    replaceChildren(...children) { this.children = children; }
  };
}

test("work-event client validates the bounded projection and fails malformed or offline responses closed", async () => {
  const module = await loadTypeScriptModule("../src/records/workEventRecords.ts", "loader");
  const available = await module.loadWorkEventRecords({
    now: () => Date.parse(PAYLOAD.generatedAt),
    fetcher: async () => new Response(JSON.stringify(PAYLOAD), { status: 200 })
  });
  assert.deepEqual(available, { status: "available", checkedAt: PAYLOAD.generatedAt, ...PAYLOAD });

  const emptyPayload = {
    ...PAYLOAD,
    freshness: "empty",
    source: { ...PAYLOAD.source, eventCount: 0, newestOccurredAt: null, newestObservedAt: null },
    events: []
  };
  const empty = await module.loadWorkEventRecords({
    now: () => Date.parse(PAYLOAD.generatedAt),
    fetcher: async () => new Response(JSON.stringify(emptyPayload), { status: 200 })
  });
  assert.equal(empty.status, "empty");

  for (const fetcher of [
    async () => { throw new Error("offline private detail"); },
    async () => new Response(JSON.stringify({ ...PAYLOAD, credentials: "unsafe" }), { status: 200 }),
    async () => new Response(JSON.stringify({ ...PAYLOAD, events: [{ ...EVENT, summary: "private@example.com" }] }), { status: 200 }),
    async () => new Response(JSON.stringify({ ...PAYLOAD, events: [{ ...EVENT, eventKind: "blocked", status: "blocked" }] }), { status: 200 }),
    async () => new Response(JSON.stringify({ ...PAYLOAD, freshness: "stale" }), { status: 200 })
  ]) {
    const state = await module.loadWorkEventRecords({ now: () => Date.parse(PAYLOAD.generatedAt), fetcher });
    assert.equal(state.status, "unavailable");
    assert.equal(JSON.stringify(state).includes("offline private detail"), false);
    assert.equal(JSON.stringify(state).includes("private@example.com"), false);
  }
});

test("work-event client checks server generation against the post-response observation time", async () => {
  const module = await loadTypeScriptModule("../src/records/workEventRecords.ts", "response-chronology");
  let responseReceived = false;
  const state = await module.loadWorkEventRecords({
    now: () => Date.parse(responseReceived ? "2026-07-28T22:00:06.000Z" : "2026-07-28T22:00:04.000Z"),
    fetcher: async () => {
      responseReceived = true;
      return new Response(JSON.stringify(PAYLOAD), { status: 200 });
    }
  });
  assert.equal(state.status, "available");
  assert.equal(state.checkedAt, "2026-07-28T22:00:06.000Z");
});

test("authenticated source event renders through the Records interface with explicit fresh, stale, empty, and error states", async () => {
  const [loader, panel] = await Promise.all([
    loadTypeScriptModule("../src/records/workEventRecords.ts", "integration-loader"),
    loadTypeScriptModule("../src/records/workRecordsPanel.ts", "integration-panel")
  ]);
  globalThis.document = {
    createElement(tagName) {
      return { tagName, textContent: "", className: "" };
    }
  };
  const elements = { state: element(), freshness: element(), source: element(), list: element() };
  const controller = panel.createWorkRecordsPanelController(elements, (options) => loader.loadWorkEventRecords({
    ...options,
    now: () => Date.parse(PAYLOAD.generatedAt),
    fetcher: async () => new Response(JSON.stringify(PAYLOAD), { status: 200 })
  }));
  const state = await controller.load();
  assert.equal(state.status, "available");
  assert.equal(elements.state.textContent, "1 authenticated local work event.");
  assert.equal(elements.freshness.textContent, "Recent");
  assert.equal(elements.source.textContent, "Authenticated local Hermes/Kanban ingestion");
  assert.equal(elements.list.children.length, 1);
  assert.match(elements.list.children[0].textContent, /Ariadne · Running · Work is in progress\./);

  controller.render({ ...state, freshness: "stale" });
  assert.match(elements.state.textContent, /stale/i);
  controller.render({ ...state, status: "empty", freshness: "empty", events: [], source: { ...state.source, eventCount: 0 } });
  assert.match(elements.state.textContent, /No authenticated work events/);
  controller.render({ status: "unavailable", reason: "network", checkedAt: PAYLOAD.generatedAt });
  assert.match(elements.state.textContent, /offline/i);
  assert.equal(elements.list.children.length, 0);

  const rejectedElements = { state: element(), freshness: element(), source: element(), list: element() };
  const rejected = panel.createWorkRecordsPanelController(rejectedElements, async () => {
    throw new Error("private runtime failure");
  });
  const rejectedState = await rejected.load();
  assert.deepEqual(rejectedState, { status: "unavailable", reason: "network", checkedAt: rejectedState.checkedAt });
  assert.match(rejectedElements.state.textContent, /offline/i);
  assert.equal(JSON.stringify(rejectedState).includes("private runtime failure"), false);
  delete globalThis.document;
});

test("Records Terminal loads authenticated work records only on open or refresh and preserves the public repository record", async () => {
  const [html, main, terminal] = await Promise.all([
    readFile(new URL("../index.html", import.meta.url), "utf8"),
    readFile(new URL("../src/main.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/records/recordsTerminal.ts", import.meta.url), "utf8")
  ]);
  const recordsDialog = html.slice(html.indexOf('<dialog id="records-terminal-dialog"'), html.indexOf("</dialog>", html.indexOf('<dialog id="records-terminal-dialog"')));
  assert.match(recordsDialog, /id="work-records-state"[^>]*aria-live="polite"/);
  assert.match(recordsDialog, /id="work-records-freshness"/);
  assert.match(recordsDialog, /id="work-records-source"/);
  assert.match(recordsDialog, /id="work-records-list"/);
  assert.match(recordsDialog, /id="records-terminal-source"/);
  assert.match(main, /createWorkRecordsPanelController\(/);
  assert.match(main, /loadWorkEventRecords/);
  assert.match(terminal, /loadWorkRecords\(\{ force \}\)/);
  assert.doesNotMatch(main, /VIBE_WORK_RECORD_TOKEN/);
});
