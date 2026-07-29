import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

async function loadModule(fragment) {
  const source = await readFile(new URL("../src/records/privateRecordsInterface.ts", import.meta.url), "utf8").catch(() => "");
  const transpiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 }
  }).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(transpiled).toString("base64")}#${fragment}`);
}

function eventTarget(extra = {}) {
  const listeners = new Map();
  return {
    textContent: "",
    disabled: false,
    hidden: false,
    children: [],
    addEventListener(type, listener) { listeners.set(type, listener); },
    dispatch(type, event = {}) { listeners.get(type)?.(event); },
    append(...children) { this.children.push(...children); },
    setAttribute(name, value) { this[name] = value; },
    replaceChildren(...children) { this.children = children; },
    ...extra
  };
}

function elements() {
  const dialog = eventTarget({
    open: false,
    showModal() { this.open = true; },
    close() { this.open = false; this.dispatch("close"); }
  });
  return {
    dialog,
    status: eventTarget(),
    summary: eventTarget(),
    trace: eventTarget(),
    refresh: eventTarget(),
    close: eventTarget()
  };
}

function installDocumentStub() {
  globalThis.document = {
    createElement(tagName) {
      return eventTarget({ tagName, className: "", type: "", dataset: {} });
    }
  };
}

const TENANT = "id_1111111111111111";
const SESSION = Object.freeze({
  kind: "trusted_authenticated_session",
  subjectId: "id_2222222222222222",
  tenantId: TENANT,
  authorizationRef: "id_3333333333333333",
  policyRevision: 1,
  active: true
});

const MODEL = Object.freeze({
  schemaVersion: "1.0",
  tenantId: TENANT,
  recordId: "id_4444444444444444",
  title: "Synthetic bounded record",
  lifecycle: "completed",
  freshness: "recent",
  historical: true,
  edges: []
});

const TRACE_MODEL = Object.freeze({
  ...MODEL,
  edges: [
    { link: "direction", state: "available", decision: { allowed: true, code: "allowed" }, value: { label: "Synthetic direction" } },
    { link: "authorization", state: "not_authorized", decision: { allowed: false, code: "not_authorized" } },
    { link: "assignment", state: "missing", decision: { allowed: true, code: "allowed" } },
    { link: "activity", state: "stale", decision: { allowed: true, code: "allowed" }, value: { label: "Synthetic activity" } },
    { link: "evidence", state: "withdrawn", decision: { allowed: true, code: "allowed" }, value: { label: "Withdrawn evidence", locator: "internal:must-not-render" } },
    { link: "outcome", state: "historical", decision: { allowed: true, code: "allowed" }, value: { label: "Synthetic outcome" } }
  ]
});

test("private Records waits for authenticated open and fails closed for revoked or wrong-tenant context", async () => {
  const module = await loadModule("authenticated-open");
  installDocumentStub();
  const reads = [];
  let session = null;
  const ui = elements();
  const controller = module.createPrivateRecordsInterfaceController(ui, {
    getTrustedSession: () => session,
    readAuthorizedModel: async (trustedSession) => {
      reads.push(trustedSession);
      return MODEL;
    }
  });

  assert.equal(reads.length, 0, "construction and startup must not request private records");
  const invoker = eventTarget({ focus() {} });
  await controller.open(invoker, TENANT);
  assert.equal(reads.length, 0);
  assert.equal(ui.status.textContent, "Private records locked. Authenticated tenant access is required.");
  assert.equal(ui.summary.textContent, "");
  assert.equal(ui.trace.children.length, 0);

  session = { ...SESSION, active: false };
  await controller.open(invoker, TENANT);
  assert.equal(reads.length, 0);
  assert.equal(ui.summary.textContent, "");

  session = SESSION;
  await controller.open(invoker, "id_9999999999999999");
  assert.equal(reads.length, 0);
  assert.equal(ui.summary.textContent, "");

  await controller.open(invoker, TENANT);
  assert.equal(reads.length, 1);
  assert.notEqual(reads[0], SESSION, "the adapter must not receive the raw trusted-session object");
  assert.equal(Object.isFrozen(reads[0]), true);
  assert.deepEqual(reads[0], SESSION);
  assert.equal(ui.status.textContent, "Authorized private record loaded.");
  assert.match(ui.summary.textContent, /Synthetic bounded record/);
  delete globalThis.document;
});

test("private Records renders only policy-approved trace links in canonical order with explicit states", async () => {
  const module = await loadModule("trace-meaning");
  globalThis.document = {
    createElement(tagName) {
      return eventTarget({ tagName, className: "", type: "", dataset: {} });
    }
  };
  const ui = elements();
  const controller = module.createPrivateRecordsInterfaceController(ui, {
    getTrustedSession: () => SESSION,
    readAuthorizedModel: async () => TRACE_MODEL
  });

  await controller.open(eventTarget({ focus() {} }), TENANT);

  assert.deepEqual(ui.trace.children.map((item) => item.dataset.link), [
    "direction", "authorization", "assignment", "activity", "evidence", "outcome"
  ]);
  assert.match(ui.trace.children[0].textContent, /Direction: Available — Synthetic direction/);
  assert.equal(ui.trace.children[0].children[0].disabled, false);
  ui.trace.children[0].children[0].dispatch("click");
  assert.equal(ui.status.textContent, "Direction link selected. Available.");
  assert.equal(ui.trace.children[1].textContent, "Authorization: Not authorized");
  assert.equal(ui.trace.children[1].children.length, 0);
  assert.equal(ui.trace.children[2].textContent, "Assignment: Missing / not recorded");
  assert.match(ui.trace.children[3].textContent, /Activity: Stale/);
  assert.equal(ui.trace.children[4].textContent.includes("internal:must-not-render"), false);
  assert.equal(ui.trace.children[4].textContent, "Evidence: Withdrawn — Withdrawn evidence");
  assert.match(ui.trace.children[5].textContent, /Outcome: Historical/);
  delete globalThis.document;
});

test("private Records never renders denied or missing edge values and locators", async () => {
  const module = await loadModule("denied-missing-values");
  globalThis.document = {
    createElement(tagName) {
      return eventTarget({ tagName, className: "", type: "", dataset: {} });
    }
  };
  const deniedLabel = "Synthetic denied private value";
  const missingLabel = "Synthetic missing private value";
  const model = {
    ...TRACE_MODEL,
    edges: TRACE_MODEL.edges.map((edge) => {
      if (edge.link === "authorization") {
        return { ...edge, value: { label: deniedLabel, locator: "private:denied" } };
      }
      if (edge.link === "assignment") {
        return { ...edge, value: { label: missingLabel, locator: "private:missing" } };
      }
      return edge;
    })
  };
  const ui = elements();
  const controller = module.createPrivateRecordsInterfaceController(ui, {
    getTrustedSession: () => SESSION,
    readAuthorizedModel: async () => model
  });

  await controller.open(eventTarget({ focus() {} }), TENANT);

  const renderedTrace = ui.trace.children.map((item) => item.textContent).join(" ");
  assert.equal(renderedTrace.includes(deniedLabel), false);
  assert.equal(renderedTrace.includes(missingLabel), false);
  assert.equal(renderedTrace.includes("private:denied"), false);
  assert.equal(renderedTrace.includes("private:missing"), false);
  assert.equal(ui.trace.children[1].textContent, "Authorization: Not authorized");
  assert.equal(ui.trace.children[2].textContent, "Assignment: Missing / not recorded");
  delete globalThis.document;
});

test("private Records renders exactly six truthful canonical links or fails closed", async () => {
  const module = await loadModule("canonical-six-links");
  globalThis.document = {
    createElement(tagName) {
      return eventTarget({ tagName, className: "", type: "", dataset: {} });
    }
  };
  const canonicalLinks = ["direction", "authorization", "assignment", "activity", "evidence", "outcome"];

  const omittedUi = elements();
  const omittedController = module.createPrivateRecordsInterfaceController(omittedUi, {
    getTrustedSession: () => SESSION,
    readAuthorizedModel: async () => ({
      ...MODEL,
      edges: [
        TRACE_MODEL.edges[0],
        { link: "outcome", state: "missing", decision: { allowed: true, code: "allowed" }, value: { label: "Synthetic missing outcome", locator: "private:missing-outcome" } }
      ]
    })
  });
  await omittedController.open(eventTarget({ focus() {} }), TENANT);
  assert.deepEqual(omittedUi.trace.children.map((item) => item.dataset.link), canonicalLinks);
  assert.equal(omittedUi.trace.children[1].textContent, "Authorization: Missing / not recorded");
  assert.equal(omittedUi.trace.children[5].textContent, "Outcome: Missing / not recorded");
  assert.equal(omittedUi.trace.children.some((item) => item.textContent.includes("Synthetic missing outcome")), false);
  assert.equal(omittedUi.trace.children.some((item) => item.textContent.includes("private:missing-outcome")), false);

  const outOfOrderUi = elements();
  const outOfOrderController = module.createPrivateRecordsInterfaceController(outOfOrderUi, {
    getTrustedSession: () => SESSION,
    readAuthorizedModel: async () => ({ ...TRACE_MODEL, edges: [...TRACE_MODEL.edges].reverse() })
  });
  await outOfOrderController.open(eventTarget({ focus() {} }), TENANT);
  assert.deepEqual(outOfOrderUi.trace.children.map((item) => item.dataset.link), canonicalLinks);

  const rejectedModels = [
    { ...TRACE_MODEL, edges: [...TRACE_MODEL.edges, TRACE_MODEL.edges[0]] },
    { ...TRACE_MODEL, edges: [...TRACE_MODEL.edges, { link: "unknown", state: "available", decision: { allowed: true, code: "allowed" }, value: { label: "Synthetic unknown private value" } }] },
    { ...TRACE_MODEL, edges: [{ link: "direction", state: null, decision: { allowed: true, code: "allowed" } }] }
  ];
  for (const rejectedModel of rejectedModels) {
    const ui = elements();
    ui.summary.textContent = "Previously authorized private summary";
    ui.trace.children = [eventTarget({ textContent: "Previously authorized private trace" })];
    const controller = module.createPrivateRecordsInterfaceController(ui, {
      getTrustedSession: () => SESSION,
      readAuthorizedModel: async () => rejectedModel
    });
    await assert.doesNotReject(controller.open(eventTarget({ focus() {} }), TENANT));
    assert.equal(ui.summary.textContent, "");
    assert.equal(ui.trace.children.length, 0);
    assert.equal(ui.status.textContent, "Private records unavailable. No private fields were retained.");
  }
  delete globalThis.document;
});

test("private Records accepts only the closed trace state and decision vocabulary", async () => {
  const module = await loadModule("closed-trace-vocabulary");
  installDocumentStub();
  const privateLabel = "Synthetic unknown-state private value";
  const privateLocator = "private:unknown-state";
  const rejectedEdges = [
    { link: "direction", state: "future_private_state", decision: { allowed: true, code: "allowed" }, value: { label: privateLabel, locator: privateLocator } },
    { link: "direction", state: "available", decision: { allowed: false, code: "not_authorized" }, value: { label: privateLabel, locator: privateLocator } },
    { link: "direction", state: "not_authorized", decision: { allowed: true, code: "allowed" }, value: { label: privateLabel, locator: privateLocator } },
    { link: "direction", state: "missing", decision: { allowed: true, code: "future_decision" }, value: { label: privateLabel, locator: privateLocator } }
  ];

  for (const edge of rejectedEdges) {
    const ui = elements();
    ui.summary.textContent = "Previously authorized private summary";
    ui.trace.children = [eventTarget({ textContent: `${privateLabel} ${privateLocator}` })];
    const controller = module.createPrivateRecordsInterfaceController(ui, {
      getTrustedSession: () => SESSION,
      readAuthorizedModel: async () => ({ ...MODEL, edges: [edge] })
    });

    await assert.doesNotReject(controller.open(eventTarget({ focus() {} }), TENANT));
    assert.equal(ui.summary.textContent, "");
    assert.equal(ui.trace.children.length, 0);
    assert.equal(ui.status.textContent, "Private records unavailable. No private fields were retained.");
    assert.equal(ui.status.textContent.includes(privateLabel), false);
    assert.equal(ui.status.textContent.includes(privateLocator), false);
  }

  const supportedEdges = [
    { link: "direction", state: "available", decision: { allowed: true, code: "allowed" } },
    { link: "authorization", state: "not_authorized", decision: { allowed: false, code: "not_authorized" } },
    { link: "assignment", state: "missing", decision: { allowed: true, code: "allowed" } },
    { link: "activity", state: "stale", decision: { allowed: true, code: "allowed" } },
    { link: "evidence", state: "withdrawn", decision: { allowed: true, code: "allowed" } },
    { link: "outcome", state: "historical", decision: { allowed: true, code: "allowed" } }
  ];
  const ui = elements();
  const controller = module.createPrivateRecordsInterfaceController(ui, {
    getTrustedSession: () => SESSION,
    readAuthorizedModel: async () => ({ ...MODEL, edges: supportedEdges })
  });
  await controller.open(eventTarget({ focus() {} }), TENANT);
  assert.equal(ui.status.textContent, "Authorized private record loaded.");
  assert.deepEqual(ui.trace.children.map((item) => item.dataset.link), [
    "direction", "authorization", "assignment", "activity", "evidence", "outcome"
  ]);

  const unavailableUi = elements();
  const unavailableController = module.createPrivateRecordsInterfaceController(unavailableUi, {
    getTrustedSession: () => SESSION,
    readAuthorizedModel: async () => ({
      ...MODEL,
      edges: [{ link: "direction", state: "unavailable", decision: { allowed: true, code: "allowed" } }]
    })
  });
  await unavailableController.open(eventTarget({ focus() {} }), TENANT);
  assert.equal(unavailableUi.status.textContent, "Authorized private record loaded.");
  assert.equal(unavailableUi.trace.children[0].textContent, "Direction: Unavailable");
  delete globalThis.document;
});

test("private Records snapshots accepted trace scalars and fails closed for throwing getters", async () => {
  const module = await loadModule("snapshot-trace-scalars");
  installDocumentStub();
  const accesses = new Map();
  function once(name, value) {
    return () => {
      const count = (accesses.get(name) ?? 0) + 1;
      accesses.set(name, count);
      if (count > 1) throw new Error(`synthetic repeated ${name} access`);
      return value;
    };
  }
  const decision = {};
  Object.defineProperties(decision, {
    allowed: { enumerable: true, get: once("decision.allowed", true) },
    code: { enumerable: true, get: once("decision.code", "allowed") }
  });
  const value = {};
  Object.defineProperty(value, "label", {
    enumerable: true,
    get: once("value.label", "Synthetic immutable direction")
  });
  const edge = {};
  Object.defineProperties(edge, {
    link: { enumerable: true, get: once("edge.link", "direction") },
    state: { enumerable: true, get: once("edge.state", "available") },
    decision: { enumerable: true, get: once("edge.decision", decision) },
    value: { enumerable: true, get: once("edge.value", value) }
  });
  const ui = elements();
  const controller = module.createPrivateRecordsInterfaceController(ui, {
    getTrustedSession: () => SESSION,
    readAuthorizedModel: async () => ({ ...MODEL, edges: [edge] })
  });

  await assert.doesNotReject(controller.open(eventTarget({ focus() {} }), TENANT));
  assert.equal(ui.status.textContent, "Authorized private record loaded.");
  assert.equal(ui.trace.children[0].textContent, "Direction: Available — Synthetic immutable direction");
  ui.trace.children[0].children[0].dispatch("click");
  assert.equal(ui.status.textContent, "Direction link selected. Available.");
  assert.deepEqual(Object.fromEntries(accesses), {
    "edge.link": 1,
    "edge.state": 1,
    "edge.decision": 1,
    "decision.allowed": 1,
    "decision.code": 1,
    "edge.value": 1,
    "value.label": 1
  });

  const throwingUi = elements();
  throwingUi.summary.textContent = "Previously authorized private summary";
  throwingUi.trace.children = [eventTarget({ textContent: "Previously authorized private trace" })];
  const throwingEdge = Object.defineProperty({}, "state", {
    get() { throw new Error("synthetic private edge getter detail"); }
  });
  const throwingController = module.createPrivateRecordsInterfaceController(throwingUi, {
    getTrustedSession: () => SESSION,
    readAuthorizedModel: async () => ({ ...MODEL, edges: [throwingEdge] })
  });
  await assert.doesNotReject(throwingController.open(eventTarget({ focus() {} }), TENANT));
  assert.equal(throwingUi.summary.textContent, "");
  assert.equal(throwingUi.trace.children.length, 0);
  assert.equal(throwingUi.status.textContent, "Private records unavailable. No private fields were retained.");
  assert.equal(throwingUi.status.textContent.includes("getter detail"), false);
  delete globalThis.document;
});

test("private Records open refresh and close controls work by activation and restore invoking focus", async () => {
  const module = await loadModule("controls-focus");
  installDocumentStub();
  let reads = 0;
  let focusReturns = 0;
  const ui = elements();
  const controller = module.createPrivateRecordsInterfaceController(ui, {
    getTrustedSession: () => SESSION,
    readAuthorizedModel: async () => { reads += 1; return MODEL; }
  });
  const invoker = eventTarget({ focus() { focusReturns += 1; } });

  await controller.open(invoker, TENANT);
  assert.equal(ui.dialog.open, true);
  assert.equal(reads, 1);
  ui.refresh.dispatch("click");
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(reads, 2, "the same activation path supports keyboard and touch-generated clicks");
  ui.close.dispatch("click");
  assert.equal(ui.dialog.open, false);
  assert.equal(focusReturns, 1);
  assert.equal(ui.summary.textContent, "");

  await controller.open(invoker, TENANT);
  ui.dialog.close();
  assert.equal(focusReturns, 2, "native Escape/dismissal close restores the invoking control");
  delete globalThis.document;
});

test("world Records object and non-spatial access use one fail-closed private controller and read model", async () => {
  const [html, main] = await Promise.all([
    readFile(new URL("../index.html", import.meta.url), "utf8"),
    readFile(new URL("../src/main.ts", import.meta.url), "utf8")
  ]);
  assert.match(html, /id="private-records-access"/);
  assert.match(html, /id="private-records-world-open"/);
  assert.match(html, /<dialog id="private-records-dialog"/);
  assert.match(html, /id="private-records-status"[^>]*aria-live="polite"/);
  assert.match(html, /id="private-records-summary"/);
  assert.match(html, /id="private-records-trace"/);
  assert.match(html, /id="private-records-refresh"/);
  assert.match(main, /const privateRecords = createPrivateRecordsInterfaceController\(/);
  assert.equal((main.match(/createPrivateRecordsInterfaceController\(/g) ?? []).length, 1);
  assert.match(main, /privateRecords\.open\(privateRecordsWorldOpen/);
  assert.match(main, /privateRecords\.open\(privateRecordsAccess/);
  assert.doesNotMatch(main, /fetch\([^\n]*api\/private/);
  assert.match(html, /id="records-terminal-source"/);
});

test("private Records keeps explicit meaning and essential controls in zoom mobile reduced-motion and kiosk layouts", async () => {
  const [html, styles] = await Promise.all([
    readFile(new URL("../index.html", import.meta.url), "utf8"),
    readFile(new URL("../src/styles.css", import.meta.url), "utf8")
  ]);
  const dialog = html.slice(html.indexOf('<dialog id="private-records-dialog"'), html.indexOf("</dialog>", html.indexOf('<dialog id="private-records-dialog"')));
  assert.match(dialog, /Private records locked\. Authenticated tenant access is required\./);
  assert.match(dialog, /Authorized direction-to-outcome trace/);
  assert.match(dialog, /Refresh private record/);
  assert.match(dialog, /Close private Records/);
  assert.match(styles, /#private-records-dialog[\s\S]*overflow: auto/);
  assert.match(styles, /\.private-records-trace[\s\S]*list-style/);
  assert.match(styles, /@media \(max-width: 640px\)[\s\S]*#private-records-dialog/);
  assert.match(styles, /@media \(prefers-reduced-motion: reduce\)[\s\S]*#private-records-dialog/);
  assert.doesNotMatch(styles, /#private-records-dialog[^}]*display:\s*none/);
  assert.doesNotMatch(styles, /performance[^}]*\.private-records-(?:trace|actions)[^}]*display:\s*none/);
});

test("private Records clears authorized fields when access is revoked or the adapter becomes unavailable", async () => {
  const module = await loadModule("revocation-unavailable");
  installDocumentStub();
  let session = SESSION;
  let rejectRead = false;
  const ui = elements();
  const controller = module.createPrivateRecordsInterfaceController(ui, {
    getTrustedSession: () => session,
    readAuthorizedModel: async () => {
      if (rejectRead) throw new Error("synthetic private provider detail");
      return MODEL;
    }
  });
  await controller.open(eventTarget({ focus() {} }), TENANT);
  assert.match(ui.summary.textContent, /Synthetic bounded record/);

  session = { ...SESSION, active: false };
  await controller.refresh();
  assert.equal(ui.summary.textContent, "");
  assert.equal(ui.trace.children.length, 0);
  assert.equal(ui.status.textContent, "Private records locked. Authenticated tenant access is required.");

  session = SESSION;
  rejectRead = true;
  await assert.doesNotReject(controller.refresh());
  assert.equal(ui.summary.textContent, "");
  assert.equal(ui.trace.children.length, 0);
  assert.equal(ui.status.textContent, "Private records unavailable. No private fields were retained.");
  assert.equal(ui.status.textContent.includes("provider detail"), false);
  delete globalThis.document;
});

test("private Records fails closed without throwing when the initial trusted session read throws", async () => {
  const module = await loadModule("initial-session-throw");
  installDocumentStub();
  const ui = elements();
  ui.summary.textContent = "Previously authorized private summary";
  ui.trace.children = [eventTarget({ textContent: "Previously authorized private trace" })];
  const controller = module.createPrivateRecordsInterfaceController(ui, {
    getTrustedSession() { throw new Error("synthetic private session adapter detail"); },
    readAuthorizedModel: async () => MODEL
  });

  await assert.doesNotReject(controller.open(eventTarget({ focus() {} }), TENANT));
  assert.equal(ui.summary.textContent, "");
  assert.equal(ui.trace.children.length, 0);
  assert.equal(ui.status.textContent, "Private records locked. Authenticated tenant access is required.");
  assert.equal(ui.status.textContent.includes("adapter detail"), false);
  delete globalThis.document;
});

test("private Records discards a response when post-await trusted session revalidation throws", async () => {
  const module = await loadModule("post-await-session-throw");
  installDocumentStub();
  let sessionReads = 0;
  const ui = elements();
  const controller = module.createPrivateRecordsInterfaceController(ui, {
    getTrustedSession() {
      sessionReads += 1;
      if (sessionReads > 1) throw new Error("synthetic private revalidation detail");
      return SESSION;
    },
    readAuthorizedModel: async () => TRACE_MODEL
  });

  await assert.doesNotReject(controller.open(eventTarget({ focus() {} }), TENANT));
  assert.equal(sessionReads, 2);
  assert.equal(ui.summary.textContent, "");
  assert.equal(ui.trace.children.length, 0);
  assert.equal(ui.status.textContent, "Private records locked. Authenticated tenant access is required.");
  assert.equal(ui.status.textContent.includes("revalidation detail"), false);
  delete globalThis.document;
});

test("private Records clears all fields without throwing for malformed authorized models", async () => {
  const module = await loadModule("malformed-model");
  globalThis.document = {
    createElement(tagName) {
      return eventTarget({ tagName, className: "", type: "", dataset: {} });
    }
  };
  const malformedModels = [
    { ...MODEL, edges: null },
    null,
    { ...MODEL, edges: [{ link: "direction", state: "available", decision: null }] },
    Object.defineProperty({}, "schemaVersion", {
      get() { throw new Error("synthetic malformed getter detail"); }
    })
  ];

  for (const malformedModel of malformedModels) {
    const ui = elements();
    ui.summary.textContent = "Previously authorized private summary";
    ui.trace.children = [eventTarget({ textContent: "Previously authorized private trace" })];
    const controller = module.createPrivateRecordsInterfaceController(ui, {
      getTrustedSession: () => SESSION,
      readAuthorizedModel: async () => malformedModel
    });

    await assert.doesNotReject(controller.open(eventTarget({ focus() {} }), TENANT));
    assert.equal(ui.summary.textContent, "");
    assert.equal(ui.trace.children.length, 0);
    assert.equal(ui.status.textContent, "Private records unavailable. No private fields were retained.");
  }
  delete globalThis.document;
});

test("private Records discards an authorized response that arrives after close or session invalidation", async () => {
  const module = await loadModule("stale-response");
  let resolveRead;
  const ui = elements();
  const controller = module.createPrivateRecordsInterfaceController(ui, {
    getTrustedSession: () => SESSION,
    readAuthorizedModel: () => new Promise((resolve) => { resolveRead = resolve; })
  });
  const opening = controller.open(eventTarget({ focus() {} }), TENANT);
  ui.dialog.close();
  resolveRead(MODEL);
  await opening;

  assert.equal(ui.dialog.open, false);
  assert.equal(ui.summary.textContent, "");
  assert.equal(ui.trace.children.length, 0);
  assert.notEqual(ui.status.textContent, "Authorized private record loaded.");
});

test("private Records discards pending reads after in-place authority mutation", async () => {
  const module = await loadModule("in-place-authority-mutation");
  const mutations = [
    ["authorizationRef", "id_5555555555555555"],
    ["policyRevision", 2],
    ["subjectId", "id_6666666666666666"],
    ["active", false],
    ["tenantId", "id_7777777777777777"]
  ];

  for (const [field, replacement] of mutations) {
    const mutableSession = { ...SESSION };
    let resolveRead;
    const ui = elements();
    const controller = module.createPrivateRecordsInterfaceController(ui, {
      getTrustedSession: () => mutableSession,
      readAuthorizedModel: () => new Promise((resolve) => { resolveRead = resolve; })
    });
    const opening = controller.open(eventTarget({ focus() {} }), TENANT);
    mutableSession[field] = replacement;
    resolveRead({ ...MODEL, tenantId: mutableSession.tenantId });

    await opening;

    assert.equal(ui.summary.textContent, "", `${field} mutation must discard the response`);
    assert.equal(ui.trace.children.length, 0, `${field} mutation must clear the trace`);
    assert.equal(ui.status.textContent, "Private records locked. Authenticated tenant access is required.");
  }
});

test("private Records snapshots every trusted session scalar once and fails closed for getter faults", async () => {
  const module = await loadModule("bounded-session-snapshot");
  installDocumentStub();
  const invoker = eventTarget({ focus() {} });
  const scalarValues = {
    kind: "trusted_authenticated_session",
    subjectId: "id_2222222222222222",
    tenantId: TENANT,
    authorizationRef: "id_3333333333333333",
    policyRevision: 1,
    active: true
  };
  const accesses = new Map();
  const statefulSession = {};
  for (const [field, value] of Object.entries(scalarValues)) {
    Object.defineProperty(statefulSession, field, {
      enumerable: true,
      get() {
        const count = (accesses.get(field) ?? 0) + 1;
        accesses.set(field, count);
        if (field === "tenantId" && count > 1) return "id_9999999999999999";
        if (count > 1) throw new Error(`synthetic repeated ${field} getter detail`);
        return value;
      }
    });
  }
  const acceptedUi = elements();
  let adapterSession;
  let trustedReads = 0;
  const acceptedController = module.createPrivateRecordsInterfaceController(acceptedUi, {
    getTrustedSession: () => {
      trustedReads += 1;
      return trustedReads === 1 ? statefulSession : SESSION;
    },
    readAuthorizedModel: async (session) => {
      adapterSession = session;
      return MODEL;
    }
  });

  await assert.doesNotReject(acceptedController.open(invoker, TENANT));
  assert.equal(acceptedUi.status.textContent, "Authorized private record loaded.");
  assert.deepEqual(Object.fromEntries(accesses), {
    kind: 1,
    subjectId: 1,
    tenantId: 1,
    authorizationRef: 1,
    policyRevision: 1,
    active: 1
  });
  assert.notEqual(adapterSession, statefulSession);
  assert.equal(Object.isFrozen(adapterSession), true);
  assert.deepEqual(adapterSession, scalarValues);

  for (const field of Object.keys(scalarValues)) {
    const throwingSession = { ...scalarValues };
    Object.defineProperty(throwingSession, field, {
      get() { throw new Error(`synthetic first ${field} getter detail`); }
    });
    const ui = elements();
    ui.summary.textContent = "Previously authorized private summary";
    ui.trace.children = [eventTarget({ textContent: "Previously authorized private trace" })];
    const controller = module.createPrivateRecordsInterfaceController(ui, {
      getTrustedSession: () => throwingSession,
      readAuthorizedModel: async () => MODEL
    });
    await assert.doesNotReject(controller.open(invoker, TENANT));
    assert.equal(ui.summary.textContent, "", `${field} getter fault must clear the summary`);
    assert.equal(ui.trace.children.length, 0, `${field} getter fault must clear the trace`);
    assert.equal(ui.status.textContent, "Private records locked. Authenticated tenant access is required.");
    assert.equal(ui.status.textContent.includes("getter detail"), false);
  }

  const malformedSessions = [
    { ...scalarValues, kind: 1 },
    { ...scalarValues, subjectId: 1 },
    { ...scalarValues, tenantId: 1 },
    { ...scalarValues, authorizationRef: 1 },
    { ...scalarValues, policyRevision: "1" },
    { ...scalarValues, active: 1 }
  ];
  for (const malformedSession of malformedSessions) {
    const ui = elements();
    const controller = module.createPrivateRecordsInterfaceController(ui, {
      getTrustedSession: () => malformedSession,
      readAuthorizedModel: async () => MODEL
    });
    await assert.doesNotReject(controller.open(invoker, TENANT));
    assert.equal(ui.summary.textContent, "");
    assert.equal(ui.trace.children.length, 0);
    assert.equal(ui.status.textContent, "Private records locked. Authenticated tenant access is required.");
  }
  delete globalThis.document;
});

test("private Records revalidates every authority scalar after model normalization", async () => {
  const module = await loadModule("post-model-authority-revalidation");
  installDocumentStub();
  const mutations = [
    ["kind", "foreign_session_kind"],
    ["subjectId", "id_5555555555555555"],
    ["tenantId", "id_6666666666666666"],
    ["authorizationRef", "id_7777777777777777"],
    ["policyRevision", 2],
    ["active", false]
  ];

  for (const [field, replacement] of mutations) {
    const mutableSession = { ...SESSION };
    const model = { ...MODEL };
    Object.defineProperty(model, "title", {
      get() {
        mutableSession[field] = replacement;
        return MODEL.title;
      }
    });
    const ui = elements();
    ui.summary.textContent = "Previously authorized private summary";
    ui.trace.children = [eventTarget({ textContent: "Previously authorized private trace" })];
    const controller = module.createPrivateRecordsInterfaceController(ui, {
      getTrustedSession: () => mutableSession,
      readAuthorizedModel: async () => model
    });

    await assert.doesNotReject(controller.open(eventTarget({ focus() {} }), TENANT));
    assert.equal(ui.summary.textContent, "", `${field} drift during model normalization must discard the response`);
    assert.equal(ui.trace.children.length, 0, `${field} drift must clear the trace`);
    assert.equal(ui.status.textContent, "Private records locked. Authenticated tenant access is required.");
  }
  delete globalThis.document;
});

test("private Records fails closed for unknown lifecycle and freshness values", async () => {
  const module = await loadModule("closed-model-vocabularies");
  installDocumentStub();
  const rejectedModels = [
    { ...MODEL, lifecycle: "future_lifecycle" },
    { ...MODEL, freshness: "future_freshness" }
  ];

  for (const model of rejectedModels) {
    const ui = elements();
    ui.summary.textContent = "Previously authorized private summary";
    ui.trace.children = [eventTarget({ textContent: "Previously authorized private trace" })];
    const controller = module.createPrivateRecordsInterfaceController(ui, {
      getTrustedSession: () => SESSION,
      readAuthorizedModel: async () => model
    });

    await assert.doesNotReject(controller.open(eventTarget({ focus() {} }), TENANT));
    assert.equal(ui.summary.textContent, "");
    assert.equal(ui.trace.children.length, 0);
    assert.equal(ui.status.textContent, "Private records unavailable. No private fields were retained.");
    assert.equal(ui.status.textContent.includes("future_"), false);
  }
  delete globalThis.document;
});

test("private Records enforces technical bounds for private model and authority scalars", async () => {
  const module = await loadModule("private-scalar-bounds");
  installDocumentStub();
  const boundedTenant = "t".repeat(128);
  const boundedSession = {
    ...SESSION,
    tenantId: boundedTenant,
    subjectId: "s".repeat(128),
    authorizationRef: "a".repeat(128)
  };
  const boundedEdges = TRACE_MODEL.edges.map((edge, index) => index === 0
    ? { ...edge, value: { label: "l".repeat(256) } }
    : edge);
  const boundedModel = {
    ...MODEL,
    tenantId: boundedTenant,
    recordId: "r".repeat(128),
    title: "x".repeat(256),
    edges: boundedEdges
  };
  const acceptedUi = elements();
  const acceptedController = module.createPrivateRecordsInterfaceController(acceptedUi, {
    getTrustedSession: () => boundedSession,
    readAuthorizedModel: async () => boundedModel
  });
  await acceptedController.open(eventTarget({ focus() {} }), boundedTenant);
  assert.equal(acceptedUi.status.textContent, "Authorized private record loaded.");
  assert.match(acceptedUi.trace.children[0].textContent, new RegExp(`l{${256}}`));

  const rejectedCases = [
    { name: "title", session: SESSION, tenant: TENANT, model: { ...MODEL, title: "x".repeat(257) } },
    { name: "recordId", session: SESSION, tenant: TENANT, model: { ...MODEL, recordId: "r".repeat(129) } },
    { name: "model tenantId", session: SESSION, tenant: TENANT, model: { ...MODEL, tenantId: "t".repeat(129) } },
    { name: "label", session: SESSION, tenant: TENANT, model: { ...MODEL, edges: [{ ...TRACE_MODEL.edges[0], value: { label: "l".repeat(257) } }] } },
    { name: "subjectId", session: { ...SESSION, subjectId: "s".repeat(129) }, tenant: TENANT, model: MODEL },
    { name: "authorizationRef", session: { ...SESSION, authorizationRef: "a".repeat(129) }, tenant: TENANT, model: MODEL }
  ];
  for (const rejected of rejectedCases) {
    const ui = elements();
    const controller = module.createPrivateRecordsInterfaceController(ui, {
      getTrustedSession: () => rejected.session,
      readAuthorizedModel: async () => rejected.model
    });
    await assert.doesNotReject(controller.open(eventTarget({ focus() {} }), rejected.tenant));
    assert.equal(ui.summary.textContent, "", `${rejected.name} overflow must fail closed`);
    assert.equal(ui.trace.children.length, 0, `${rejected.name} overflow must clear the trace`);
    assert.notEqual(ui.status.textContent, "Authorized private record loaded.");
  }
  delete globalThis.document;
});

test("private Records rejects raw trace edge overflow before iterating input", async () => {
  const module = await loadModule("raw-edge-count-bound");
  installDocumentStub();
  const boundaryUi = elements();
  const boundaryController = module.createPrivateRecordsInterfaceController(boundaryUi, {
    getTrustedSession: () => SESSION,
    readAuthorizedModel: async () => TRACE_MODEL
  });
  await boundaryController.open(eventTarget({ focus() {} }), TENANT);
  assert.equal(boundaryUi.status.textContent, "Authorized private record loaded.");
  assert.equal(boundaryUi.trace.children.length, 6);

  let edgeAccesses = 0;
  const oversizedEdges = new Array(7);
  Object.defineProperty(oversizedEdges, 0, {
    get() {
      edgeAccesses += 1;
      return TRACE_MODEL.edges[0];
    }
  });
  const overflowUi = elements();
  const overflowController = module.createPrivateRecordsInterfaceController(overflowUi, {
    getTrustedSession: () => SESSION,
    readAuthorizedModel: async () => ({ ...MODEL, edges: oversizedEdges })
  });
  await assert.doesNotReject(overflowController.open(eventTarget({ focus() {} }), TENANT));
  assert.equal(edgeAccesses, 0, "oversized edge input must be rejected from length before element access");
  assert.equal(overflowUi.summary.textContent, "");
  assert.equal(overflowUi.trace.children.length, 0);
  assert.equal(overflowUi.status.textContent, "Private records unavailable. No private fields were retained.");
  delete globalThis.document;
});

test("private Records bounds indexed edge access when array length grows after the gate", async () => {
  const module = await loadModule("stateful-edge-length-bound");
  installDocumentStub();
  let lengthReads = 0;
  let indexedReads = 0;
  const rawEdges = new Proxy([], {
    get(target, property, receiver) {
      if (property === "length") {
        lengthReads += 1;
        return lengthReads === 1 ? 6 : 1000;
      }
      if (typeof property === "string" && /^\d+$/.test(property)) {
        indexedReads += 1;
        return TRACE_MODEL.edges[0];
      }
      return Reflect.get(target, property, receiver);
    }
  });
  const ui = elements();
  const controller = module.createPrivateRecordsInterfaceController(ui, {
    getTrustedSession: () => SESSION,
    readAuthorizedModel: async () => ({ ...MODEL, edges: rawEdges })
  });

  await assert.doesNotReject(controller.open(eventTarget({ focus() {} }), TENANT));

  assert.ok(indexedReads <= 6, `raw edge traversal exceeded its six-element cap: ${indexedReads}`);
  assert.equal(ui.summary.textContent, "");
  assert.equal(ui.trace.children.length, 0);
  assert.equal(ui.status.textContent, "Private records unavailable. No private fields were retained.");
  delete globalThis.document;
});
