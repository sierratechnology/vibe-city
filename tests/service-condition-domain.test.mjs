import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const FOCUSED_PATH = new URL("../src/domain/serviceCondition.ts", import.meta.url);
const FAILURE = {
  ok: false,
  error: {
    code: "invalid_service_condition_snapshot",
    reason: "Service condition snapshot is unavailable."
  }
};
const GENERATED_AT = "2000-01-01T00:00:00.000Z";

async function loadServiceConditionModule(fragment) {
  const source = await readFile(FOCUSED_PATH, "utf8").catch(() => "");
  return loadServiceConditionSource(source, fragment);
}

async function loadServiceConditionSource(source, fragment) {
  const transpiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 }
  }).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(transpiled).toString("base64")}#${fragment}`);
}

function assertRecursivelyFrozen(value) {
  const pending = [value];
  while (pending.length > 0) {
    const current = pending.pop();
    assert.equal(Object.isFrozen(current), true);
    for (const child of Object.values(current)) {
      if (child !== null && typeof child === "object") pending.push(child);
    }
  }
}

function emptySnapshot() {
  return { schemaVersion: "1.0", generatedAt: GENERATED_AT, components: [] };
}

function component(overrides = {}) {
  return {
    id: "syn-component-01",
    label: "Synthetic Component 01",
    configured: false,
    administrativeState: "required",
    freshness: "unavailable",
    observedAt: null,
    evidenceCode: "none",
    blockedReasonCode: null,
    lastKnown: null,
    ...overrides
  };
}

function snapshot(components) {
  return { schemaVersion: "1.0", generatedAt: GENERATED_AT, components };
}

test("returns a safe fresh frozen failure and the smallest detached frozen empty success shell", async () => {
  const module = await loadServiceConditionModule("empty-shell");
  assert.equal(typeof module.classifyServiceConditionSnapshot, "function");

  const firstFailure = module.classifyServiceConditionSnapshot(null);
  const secondFailure = module.classifyServiceConditionSnapshot({});
  assert.deepEqual(firstFailure, FAILURE);
  assert.deepEqual(secondFailure, FAILURE);
  assert.notEqual(firstFailure, secondFailure);
  assert.notEqual(firstFailure.error, secondFailure.error);
  assertRecursivelyFrozen(firstFailure);
  assertRecursivelyFrozen(secondFailure);

  const input = emptySnapshot();
  const result = module.classifyServiceConditionSnapshot(input);
  assert.deepEqual(result, {
    ok: true,
    schemaVersion: "1.0",
    generatedAt: GENERATED_AT,
    components: [],
    counts: {
      working: 0,
      degraded: 0,
      blocked: 0,
      broken: 0,
      not_configured: 0,
      optional: 0,
      retired: 0
    },
    total: 0,
    classifiedTotal: 0,
    conditionUnavailableTotal: 0,
    hasLocalizedImpairment: false
  });
  assert.notEqual(result, input);
  assert.notEqual(result.components, input.components);
  assertRecursivelyFrozen(result);

  const nullPrototype = Object.assign(Object.create(null), emptySnapshot());
  assert.equal(module.classifyServiceConditionSnapshot(nullPrototype).ok, true);
  input.generatedAt = "changed";
  input.components.push("changed");
  assert.equal(result.generatedAt, GENERATED_AT);
  assert.deepEqual(result.components, []);

  const classify = module.classifyServiceConditionSnapshot;
  const malformed = [
    [],
    Object.create({ schemaVersion: "1.0", generatedAt: GENERATED_AT, components: [] }),
    { ...emptySnapshot(), extra: true },
    { ...emptySnapshot(), schemaVersion: "2.0" },
    { ...emptySnapshot(), generatedAt: "2000-01-01T00:00:00Z" },
    { ...emptySnapshot(), generatedAt: "2000-02-30T00:00:00.000Z" },
    { ...emptySnapshot(), components: Object.freeze([]) },
    { ...emptySnapshot(), components: Object.assign(Object.create(null), { length: 0 }) },
    Object.defineProperty(emptySnapshot(), "schemaVersion", { enumerable: false }),
    Object.defineProperty(emptySnapshot(), "generatedAt", { get() { throw new Error("private getter text"); } }),
    Object.assign(emptySnapshot(), { [Symbol("private-symbol")]: true })
  ];

  const malformedLength = emptySnapshot();
  Object.defineProperty(malformedLength.components, "length", { writable: false });
  malformed.push(malformedLength);

  for (const candidate of malformed) {
    const failure = classify(candidate);
    assert.deepEqual(failure, FAILURE);
    assert.equal(JSON.stringify(failure).includes("private"), false);
    assertRecursivelyFrozen(failure);
  }

  for (const trap of ["ownKeys", "getOwnPropertyDescriptor", "getPrototypeOf"]) {
    const proxy = new Proxy(emptySnapshot(), {
      [trap]() { throw new Error(`private ${trap} trap text`); }
    });
    assert.doesNotThrow(() => assert.deepEqual(classify(proxy), FAILURE));
  }

  let laterDescriptorReads = 0;
  const tooWide = new Proxy({}, {
    ownKeys() { return Array.from({ length: 18 }, (_, index) => `k${index}`); },
    getOwnPropertyDescriptor() { laterDescriptorReads += 1; return undefined; }
  });
  assert.deepEqual(classify(tooWide), FAILURE);
  assert.equal(laterDescriptorReads, 0);
});

test("classifies only the exact required unconfigured component as not_configured and never broken", async () => {
  const module = await loadServiceConditionModule("not-configured");
  const classify = module.classifyServiceConditionSnapshot;
  const inputComponent = component();
  const input = snapshot([inputComponent]);
  const result = classify(input);

  assert.equal(result.ok, true);
  assert.deepEqual(result.components, [{
    kind: "classified",
    id: "syn-component-01",
    label: "Synthetic Component 01",
    condition: "not_configured",
    freshness: "unavailable",
    evidenceCode: "none",
    reasonCode: "not_configured",
    reason: "Component is not configured.",
    observedAt: null
  }]);
  assert.equal(result.components[0].condition === "broken", false);
  assert.notEqual(result.components, input.components);
  assert.notEqual(result.components[0], inputComponent);
  assertRecursivelyFrozen(result);
  assert.equal(result.total, 1);
  assert.equal(result.classifiedTotal, 1);
  assert.equal(result.conditionUnavailableTotal, 0);
  assert.equal(result.hasLocalizedImpairment, false);

  const malformed = [];
  for (const key of Object.keys(component())) {
    const missing = component();
    delete missing[key];
    malformed.push(snapshot([missing]));
  }
  malformed.push(
    snapshot([{ ...component(), unknown: true }]),
    snapshot([component({ freshness: "live" })]),
    snapshot([component({ observedAt: GENERATED_AT })]),
    snapshot([component({ evidenceCode: "complete_failure" })]),
    snapshot([component({ blockedReasonCode: "dependency" })]),
    snapshot([component({ lastKnown: { observedAt: GENERATED_AT, evidenceCode: "positive" } })]),
    snapshot([component(), component({ id: "syn-component-01", label: "Synthetic Component 02" })]),
    snapshot([Object.assign(component(), { [Symbol("private")]: true })]),
    snapshot([Object.defineProperty(component(), "label", { enumerable: false })]),
    snapshot([Object.defineProperty(component(), "label", { get() { throw new Error("private accessor"); } })])
  );

  const aliased = component();
  malformed.push(snapshot([aliased, aliased]));
  const nonEnumerableIndex = snapshot([component()]);
  Object.defineProperty(nonEnumerableIndex.components, "0", { enumerable: false });
  malformed.push(nonEnumerableIndex);
  const readonlyIndex = snapshot([component()]);
  Object.defineProperty(readonlyIndex.components, "0", { writable: false });
  malformed.push(readonlyIndex);
  malformed.push(snapshot(Array(1)));
  malformed.push(snapshot(Array.from({ length: 17 }, (_, index) => component({ id: `syn-component-${index}` }))));

  for (const candidate of malformed) {
    assert.deepEqual(classify(candidate), FAILURE);
  }
});

test("maps current and validated last-known evidence to localized working degraded broken or condition_unavailable", async () => {
  const module = await loadServiceConditionModule("evidence-mappings");
  const classify = module.classifyServiceConditionSnapshot;
  const observedAt = "1999-12-31T23:59:59.000Z";
  const mappings = [
    ["positive", "working", "configured_positive", "Validated evidence indicates the component is working."],
    ["partial_function", "degraded", "configured_partial_function", "Validated evidence indicates partial component function."],
    ["complete_failure", "broken", "configured_complete_failure", "Validated evidence indicates complete component failure."]
  ];

  for (const [evidenceCode, condition, reasonCode, reason] of mappings) {
    const current = classify(snapshot([component({
      configured: true,
      freshness: "live",
      observedAt,
      evidenceCode
    })]));
    assert.equal(current.ok, true);
    assert.deepEqual(current.components[0], {
      kind: "classified",
      id: "syn-component-01",
      label: "Synthetic Component 01",
      condition,
      freshness: "live",
      evidenceCode,
      reasonCode,
      reason,
      observedAt
    });

    const lastKnown = classify(snapshot([component({
      configured: true,
      freshness: "stale",
      lastKnown: { observedAt, evidenceCode }
    })]));
    assert.equal(lastKnown.ok, true);
    assert.deepEqual(lastKnown.components[0], {
      kind: "classified",
      id: "syn-component-01",
      label: "Synthetic Component 01",
      condition,
      freshness: "stale",
      evidenceCode: `last_known_${evidenceCode}`,
      reasonCode: `last_known_${evidenceCode}`,
      reason: reason.replace("Validated evidence indicates", "Last validated evidence indicated")
        .replace("the component is", "the component was"),
      observedAt
    });
    assertRecursivelyFrozen(lastKnown);
  }

  for (const freshness of ["stale", "unavailable"]) {
    const unavailable = classify(snapshot([
      component({ id: "syn-working", label: "Synthetic Working" }),
      component({ id: "syn-unknown", label: "Synthetic Unknown", configured: true, freshness })
    ]));
    assert.equal(unavailable.ok, true);
    assert.equal(unavailable.components[0].condition, "not_configured");
    assert.deepEqual(unavailable.components[1], {
      kind: "condition_unavailable",
      id: "syn-unknown",
      label: "Synthetic Unknown",
      freshness,
      evidenceCode: "none",
      reasonCode: "condition_unknown_no_validated_last_known",
      reason: "Current condition unavailable; no validated last-known condition.",
      observedAt: null
    });
    assert.equal("condition" in unavailable.components[1], false);
  }

  const incompleteLastKnown = { observedAt, evidenceCode: "positive" };
  delete incompleteLastKnown.observedAt;
  for (const malformed of [
    component({ configured: true, freshness: "live", observedAt, evidenceCode: "none" }),
    component({ configured: true, freshness: "live", observedAt, evidenceCode: "positive", lastKnown: { observedAt, evidenceCode: "positive" } }),
    component({ configured: true, freshness: "stale", evidenceCode: "positive" }),
    component({ configured: true, freshness: "stale", lastKnown: { observedAt, evidenceCode: "none" } }),
    component({ configured: true, freshness: "stale", lastKnown: incompleteLastKnown }),
    component({ configured: true, freshness: "stale", lastKnown: { observedAt, evidenceCode: "positive", unknown: true } })
  ]) {
    assert.deepEqual(classify(snapshot([malformed])), FAILURE);
  }
});

test("keeps blocked optional and retired distinct with only approved code-owned blocked reasons", async () => {
  const module = await loadServiceConditionModule("administrative-mappings");
  const classify = module.classifyServiceConditionSnapshot;
  const blockedMappings = [
    ["dependency", "blocked_dependency", "Component activation is blocked by a dependency."],
    ["decision", "blocked_decision", "Component activation is blocked by a required decision."],
    ["access", "blocked_access", "Component activation is blocked by required access."],
    ["security_design", "blocked_security_design", "Component activation is blocked by security design."]
  ];

  for (const [blockedReasonCode, reasonCode, reason] of blockedMappings) {
    const result = classify(snapshot([component({ configured: true, blockedReasonCode })]));
    assert.equal(result.ok, true);
    assert.deepEqual(result.components[0], {
      kind: "classified",
      id: "syn-component-01",
      label: "Synthetic Component 01",
      condition: "blocked",
      freshness: "unavailable",
      evidenceCode: "none",
      reasonCode,
      reason,
      observedAt: null
    });
  }

  for (const administrativeState of ["optional", "retired"]) {
    const result = classify(snapshot([component({ administrativeState })]));
    assert.equal(result.ok, true);
    assert.deepEqual(result.components[0], {
      kind: "classified",
      id: "syn-component-01",
      label: "Synthetic Component 01",
      condition: administrativeState,
      freshness: "unavailable",
      evidenceCode: "none",
      reasonCode: administrativeState,
      reason: `Component is ${administrativeState}.`,
      observedAt: null
    });
    assert.equal(result.components[0].condition === "broken", false);
  }

  for (const malformed of [
    component({ configured: true, blockedReasonCode: "provider" }),
    component({ configured: true, blockedReasonCode: "dependency", freshness: "live" }),
    component({ configured: true, blockedReasonCode: "dependency", observedAt: GENERATED_AT }),
    component({ configured: true, blockedReasonCode: "dependency", evidenceCode: "positive" }),
    component({ configured: true, blockedReasonCode: "dependency", lastKnown: { observedAt: GENERATED_AT, evidenceCode: "positive" } }),
    component({ administrativeState: "optional", configured: true }),
    component({ administrativeState: "optional", freshness: "stale" }),
    component({ administrativeState: "retired", blockedReasonCode: "decision" })
  ]) {
    assert.deepEqual(classify(snapshot([malformed])), FAILURE);
  }
});

test("adds localized classified counts and impairment arithmetic without a building-wide condition", async () => {
  const module = await loadServiceConditionModule("localized-counts");
  const classify = module.classifyServiceConditionSnapshot;
  const observedAt = "1999-12-31T23:59:59.000Z";
  const input = snapshot([
    component({ id: "syn-working", label: "Synthetic Working", configured: true, freshness: "live", observedAt, evidenceCode: "positive" }),
    component({ id: "syn-degraded", label: "Synthetic Degraded", configured: true, freshness: "live", observedAt, evidenceCode: "partial_function" }),
    component({ id: "syn-blocked", label: "Synthetic Blocked", configured: true, blockedReasonCode: "dependency" }),
    component({ id: "syn-broken", label: "Synthetic Broken", configured: true, freshness: "live", observedAt, evidenceCode: "complete_failure" }),
    component({ id: "syn-not-configured", label: "Synthetic Not Configured" }),
    component({ id: "syn-optional", label: "Synthetic Optional", administrativeState: "optional" }),
    component({ id: "syn-retired", label: "Synthetic Retired", administrativeState: "retired" }),
    component({ id: "syn-unknown", label: "Synthetic Unknown", configured: true, freshness: "stale" })
  ]);
  const result = classify(input);

  assert.equal(result.ok, true);
  assert.deepEqual(result.counts, {
    working: 1,
    degraded: 1,
    blocked: 1,
    broken: 1,
    not_configured: 1,
    optional: 1,
    retired: 1
  });
  assert.equal(result.total, 8);
  assert.equal(result.classifiedTotal, 7);
  assert.equal(result.conditionUnavailableTotal, 1);
  assert.equal(result.total, result.classifiedTotal + result.conditionUnavailableTotal);
  assert.equal(result.hasLocalizedImpairment, true);
  assert.equal("condition" in result, false);
  assertRecursivelyFrozen(result);

  const calm = classify(snapshot([
    component({ id: "syn-working", label: "Synthetic Working", configured: true, freshness: "live", observedAt, evidenceCode: "positive" }),
    component({ id: "syn-not-configured", label: "Synthetic Not Configured" }),
    component({ id: "syn-optional", label: "Synthetic Optional", administrativeState: "optional" }),
    component({ id: "syn-retired", label: "Synthetic Retired", administrativeState: "retired" })
  ]));
  assert.equal(calm.hasLocalizedImpairment, false);
  assert.equal(classify(emptySnapshot()).hasLocalizedImpairment, false);
});

test("keeps all six freshness values independent and validates generatedAt-relative chronology", async () => {
  const module = await loadServiceConditionModule("freshness-chronology");
  const classify = module.classifyServiceConditionSnapshot;
  const before = "1999-12-31T23:59:59.000Z";
  const evidenceMappings = [
    ["positive", "working"],
    ["partial_function", "degraded"],
    ["complete_failure", "broken"]
  ];

  for (const freshness of ["live", "recent", "historical", "degraded"]) {
    for (const [evidenceCode, condition] of evidenceMappings) {
      const result = classify(snapshot([component({
        configured: true,
        freshness,
        observedAt: before,
        evidenceCode
      })]));
      assert.equal(result.ok, true, `${freshness}/${evidenceCode}`);
      assert.equal(result.components[0].freshness, freshness);
      assert.equal(result.components[0].condition, condition);
    }
  }

  for (const freshness of ["stale", "unavailable"]) {
    for (const [evidenceCode, condition] of evidenceMappings) {
      const result = classify(snapshot([component({
        configured: true,
        freshness,
        lastKnown: { observedAt: before, evidenceCode }
      })]));
      assert.equal(result.ok, true, `${freshness}/last-known/${evidenceCode}`);
      assert.equal(result.components[0].freshness, freshness);
      assert.equal(result.components[0].condition, condition);
    }
    const unknown = classify(snapshot([component({ configured: true, freshness })]));
    assert.equal(unknown.ok, true);
    assert.equal(unknown.components[0].kind, "condition_unavailable");
  }

  for (const equalTime of [
    component({ configured: true, freshness: "recent", observedAt: GENERATED_AT, evidenceCode: "positive" }),
    component({ configured: true, freshness: "unavailable", lastKnown: { observedAt: GENERATED_AT, evidenceCode: "positive" } })
  ]) {
    assert.equal(classify(snapshot([equalTime])).ok, true);
  }

  const future = "2000-01-01T00:00:00.001Z";
  for (const malformed of [
    component({ configured: true, freshness: "recent", observedAt: future, evidenceCode: "positive" }),
    component({ configured: true, freshness: "stale", lastKnown: { observedAt: future, evidenceCode: "positive" } }),
    component({ configured: true, freshness: "stale", observedAt: before, lastKnown: { observedAt: GENERATED_AT, evidenceCode: "positive" } }),
    component({ configured: true, freshness: "recent", observedAt: before, evidenceCode: "positive", lastKnown: { observedAt: before, evidenceCode: "positive" } }),
    component({ configured: true, freshness: "historical", observedAt: null, evidenceCode: "positive" }),
    component({ configured: true, freshness: "unavailable", observedAt: before }),
    component({ configured: true, freshness: "unknown", observedAt: before, evidenceCode: "positive" })
  ]) {
    assert.deepEqual(classify(snapshot([malformed])), FAILURE);
  }
});

test("rejects_the_complete_finite_hostile_label_table_without_copying_input", async () => {
  const module = await loadServiceConditionModule("finite-hostile-label-table");
  const classify = module.classifyServiceConditionSnapshot;
  const denied = [
    ["HL01", "Synthetic API Token"],
    ["HL02", "Synthetic Access Token"],
    ["HL03", "Synthetic Auth Token"],
    ["HL04", "Synthetic Secret Value"],
    ["HL05", "Synthetic Client Secret"],
    ["HL06", "Synthetic Login Credential"],
    ["HL07", "Synthetic Login Password"],
    ["HL08", "Synthetic Connection String"],
    ["HL09", "Synthetic Provider Error"],
    ["HL10", "Synthetic Provider Internal"],
    ["HL11", "Synthetic Provider Stack Trace"],
    ["HL12", "Synthetic Private Identifier"],
    ["HL13", "Synthetic Account ID"],
    ["HL14", "Synthetic Tenant ID"],
    ["HL15", "Synthetic Private Repository"],
    ["HL16", "Synthetic Execute Code"],
    ["HL17", "Synthetic Script Payload"]
  ];
  let previousFailure = null;
  for (const [denyId, label] of denied) {
    const failure = classify(snapshot([component({ label })]));
    assert.deepEqual(failure, FAILURE, denyId);
    assertRecursivelyFrozen(failure);
    if (previousFailure !== null) {
      assert.notEqual(failure, previousFailure);
      assert.notEqual(failure.error, previousFailure.error);
    }
    const serialized = JSON.stringify(failure);
    assert.equal(serialized.includes(label), false);
    assert.equal(serialized.includes(denyId), false);
    previousFailure = failure;
  }
});

test("applies exact ASCII label token boundaries without broad category or substring denial", async () => {
  const module = await loadServiceConditionModule("label-boundaries");
  const classify = module.classifyServiceConditionSnapshot;
  for (const label of [
    "Synthetic.Stack-Trace",
    "sYnThEtIc pRoViDeR eRrOr",
    "Synthetic (Client) Secret"
  ]) {
    assert.deepEqual(classify(snapshot([component({ label })])), FAILURE);
  }
  for (const label of [
    "Synthetic Token Monitor",
    "Synthetic Stack Monitor",
    "Synthetic Error Budget",
    "Synthetic Private Wing",
    "Synthetic Connection Status",
    "Synthetic Script Status"
  ]) {
    const result = classify(snapshot([component({ label })]));
    assert.equal(result.ok, true, label);
    assert.equal(result.components[0].label, label);
  }

  for (const malformed of [
    component({ label: "Synthetic https://unit.invalid" }),
    component({ label: "<script>" }),
    { ...component(), callerReason: "Synthetic caller copy" },
    component({ id: "component" }),
    component({ evidenceCode: "provider_error" }),
    component({ observedAt: "not-a-time" })
  ]) {
    assert.deepEqual(classify(snapshot([malformed])), FAILURE);
  }
});

test("rejects inherited Object.prototype names at every enum lookup boundary", async () => {
  const module = await loadServiceConditionModule("own-enum-membership");
  const classify = module.classifyServiceConditionSnapshot;
  const observedAt = "1999-12-31T23:59:59.000Z";
  const inheritedNames = ["toString", "constructor", "__proto__"];
  const malformedCases = inheritedNames.flatMap((rejectedName) => [
    {
      rejectedName,
      value: component({
        configured: true,
        freshness: "live",
        observedAt,
        evidenceCode: rejectedName
      })
    },
    {
      rejectedName,
      value: component({ configured: true, blockedReasonCode: rejectedName })
    },
    {
      rejectedName,
      value: component({
        configured: true,
        freshness: "stale",
        lastKnown: { observedAt, evidenceCode: rejectedName }
      })
    }
  ]);

  for (const { rejectedName, value } of malformedCases) {
    const input = snapshot([value]);
    const failure = classify(input);
    const repeatedFailure = classify(input);
    assert.deepEqual(failure, FAILURE);
    assert.deepEqual(repeatedFailure, FAILURE);
    assert.equal(failure.ok, false);
    assert.equal("components" in failure, false);
    assert.equal("counts" in failure, false);
    assert.equal("total" in failure, false);
    assert.equal(JSON.stringify(failure).includes(rejectedName), false);
    assertRecursivelyFrozen(failure);
    assertRecursivelyFrozen(repeatedFailure);
    assert.notEqual(failure, input);
    assert.notEqual(failure.error, input);
    assert.notEqual(failure, repeatedFailure);
    assert.notEqual(failure.error, repeatedFailure.error);
  }
});

test("enforces ordinary array and scalar boundaries while accepting null-prototype records", async () => {
  const module = await loadServiceConditionModule("structural-boundaries");
  const classify = module.classifyServiceConditionSnapshot;
  const nullComponent = Object.assign(Object.create(null), component());
  assert.equal(classify(snapshot([nullComponent])).ok, true);

  const malformedArrays = [];
  const nonEnumerable = [component()];
  Object.defineProperty(nonEnumerable, "0", { enumerable: false });
  malformedArrays.push(nonEnumerable);
  const accessor = [component()];
  let accessorCalls = 0;
  Object.defineProperty(accessor, "0", { get() { accessorCalls += 1; return component(); } });
  malformedArrays.push(accessor);
  const readonly = [component()];
  Object.defineProperty(readonly, "0", { writable: false });
  malformedArrays.push(readonly);
  const fixed = [component()];
  Object.defineProperty(fixed, "0", { configurable: false });
  malformedArrays.push(fixed);
  const wrongLength = [component()];
  Object.defineProperty(wrongLength, "length", { writable: false });
  malformedArrays.push(wrongLength);
  const symbol = [component()];
  symbol[Symbol("synthetic")] = true;
  malformedArrays.push(symbol);
  const noncanonical = [component()];
  noncanonical["01"] = component({ id: "syn-component-02" });
  malformedArrays.push(noncanonical, Array(1));
  const wrongPrototype = [component()];
  Object.setPrototypeOf(wrongPrototype, null);
  malformedArrays.push(wrongPrototype);

  for (const components of malformedArrays) {
    assert.deepEqual(classify(snapshot(components)), FAILURE);
  }
  assert.equal(accessorCalls, 0);

  for (const malformed of [
    component({ id: "syn-" }),
    component({ id: `syn-${"a".repeat(61)}` }),
    component({ id: "syn-upper-A" }),
    component({ label: "x".repeat(81) }),
    component({ label: "Synthetic/Label" }),
    component({ label: "Synthetic\ud800Label" }),
    component({ configured: new Boolean(false) }),
    component({ administrativeState: "planned" }),
    component({ freshness: "fresh" }),
    component({ blockedReasonCode: 1 }),
    component({ lastKnown: [] })
  ]) {
    assert.deepEqual(classify(snapshot([malformed])), FAILURE);
  }
});

test("proves exact maximal traversal arithmetic and defensive consumers without production test exports", async () => {
  const source = await readFile(FOCUSED_PATH, "utf8");
  const instrumented = source.replace(
    "    const detachedComponents = freezeObject(acceptedComponents);",
    "    globalThis.__serviceConditionTraversalProbe = { descriptors: context.descriptors, visitedValues: context.visitedValues };\n    const detachedComponents = freezeObject(acceptedComponents);"
  );
  assert.notEqual(instrumented, source);
  const measured = await loadServiceConditionSource(instrumented, "maximal-traversal");
  const maximal = Array.from({ length: 16 }, (_, index) => component({
    id: `syn-component-${index}`,
    label: `Synthetic Component ${index}`,
    configured: true,
    freshness: "stale",
    lastKnown: {
      observedAt: "1999-12-31T23:59:59.000Z",
      evidenceCode: "positive"
    }
  }));
  const result = measured.classifyServiceConditionSnapshot(snapshot(maximal));
  assert.equal(result.ok, true);
  assert.equal(result.total, 16);
  assert.deepEqual(globalThis.__serviceConditionTraversalProbe, {
    descriptors: 196,
    visitedValues: 197
  });
  delete globalThis.__serviceConditionTraversalProbe;

  const probeSource = `${source}\nexport function __probeInspect(context: any, value: unknown, depth: number, expected: readonly string[]) { return inspectContainer(context, value, depth, expected, false); }\nexport function __probeString(context: any, value: string, limit: number) { return consumeString(context, value, limit); }`;
  const probes = await loadServiceConditionSource(probeSource, "defensive-consumers");
  const context = (overrides = {}) => ({
    descriptors: 0,
    visitedValues: 1,
    stringBytes: 0,
    identities: new WeakSet(),
    ...overrides
  });

  let descriptorReads = 0;
  const descriptorOverflow = new Proxy({ probe: "synthetic" }, {
    getOwnPropertyDescriptor(target, key) {
      descriptorReads += 1;
      return Reflect.getOwnPropertyDescriptor(target, key);
    }
  });
  assert.equal(probes.__probeInspect(context({ descriptors: 212 }), descriptorOverflow, 0, ["probe"]), null);
  assert.equal(descriptorReads, 0);

  let prototypeReads = 0;
  const visitedOverflow = new Proxy({ probe: "synthetic" }, {
    getPrototypeOf(target) {
      prototypeReads += 1;
      return Reflect.getPrototypeOf(target);
    }
  });
  assert.equal(probes.__probeInspect(context({ visitedValues: 213 }), visitedOverflow, 0, ["probe"]), null);
  assert.equal(prototypeReads, 0);

  let depthOwnKeys = 0;
  const depthOverflow = new Proxy({}, {
    ownKeys() { depthOwnKeys += 1; return []; }
  });
  assert.equal(probes.__probeInspect(context(), depthOverflow, 4, []), null);
  assert.equal(depthOwnKeys, 0);
  assert.equal(probes.__probeString(context({ stringBytes: 8192 }), "x", 32), false);
});
