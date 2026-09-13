import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const CLASSIFIER_PATH = new URL("../src/domain/serviceCondition.ts", import.meta.url);
const DECODER_PATH = new URL("../src/domain/serviceConditionDecoder.ts", import.meta.url);
const FAILURE = {
  ok: false,
  error: {
    code: "invalid_service_condition_snapshot",
    reason: "Service condition snapshot is unavailable."
  }
};
const EMPTY_SUCCESS = {
  ok: true,
  schemaVersion: "1.0",
  generatedAt: "2000-01-01T00:00:00.000Z",
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
};

async function transpile(source) {
  return ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 }
  }).outputText;
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

function syntheticComponent(overrides = {}) {
  return {
    id: "syn-component",
    label: "Synthetic Component",
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

function serializedSnapshot(components, generatedAt = "2000-01-01T00:00:00.000Z") {
  return new TextEncoder().encode(JSON.stringify({ schemaVersion: "1.0", generatedAt, components }));
}

async function loadDecoderModule(fragment, probeParser = false, probeBudgets = false, probeDepth = false) {
  const classifierSource = await readFile(CLASSIFIER_PATH, "utf8");
  const classifierUrl = `data:text/javascript;base64,${Buffer.from(await transpile(classifierSource)).toString("base64")}#classifier-${fragment}`;
  const decoderSource = await readFile(DECODER_PATH, "utf8").catch(() => "");
  const importPattern = /from "\.\/serviceCondition\.ts";/g;
  const matches = decoderSource.match(importPattern) ?? [];
  assert.equal(matches.length, decoderSource.length === 0 ? 0 : 1);
  let rewritten = decoderSource.replace(importPattern, `from "${classifierUrl}";`);
  if (probeParser) {
    const parserPattern = "function parseDocument(";
    assert.equal(rewritten.split(parserPattern).length - 1, 1);
    rewritten += "\nexport { parseDocument as __testParseDocument };\n";
  }
  if (probeBudgets) {
    const stringParserPattern = "const parseString = () => {";
    assert.equal(rewritten.split(stringParserPattern).length - 1, 1);
    rewritten = `const __testStringPositions = [];\n${rewritten}`;
    rewritten = rewritten.replace(
      stringParserPattern,
      `${stringParserPattern}\n    __testStringPositions.push(index);`
    );
    rewritten += "\nexport { __testStringPositions };\n";
  }
  if (probeDepth) {
    const objectParserPattern = "const parseObject = (depth: number): Record<string, unknown> => {";
    const arrayParserPattern = "const parseArray = (depth: number): unknown[] => {";
    const consumePattern = `if (text[index] !== character) throw new Error();
    index += 1;`;
    assert.equal(rewritten.split(objectParserPattern).length - 1, 1);
    assert.equal(rewritten.split(arrayParserPattern).length - 1, 1);
    assert.equal(rewritten.split(consumePattern).length - 1, 1);
    rewritten = `const __testContainerEvents = [];\n${rewritten}`;
    rewritten = rewritten.replace(
      objectParserPattern,
      `${objectParserPattern}\n    __testContainerEvents.push(["dispatch", "{", depth, index]);`
    );
    rewritten = rewritten.replace(
      arrayParserPattern,
      `${arrayParserPattern}\n    __testContainerEvents.push(["dispatch", "[", depth, index]);`
    );
    rewritten = rewritten.replace(
      consumePattern,
      `if (text[index] !== character) throw new Error();
    if (character === "{" || character === "[") {
      __testContainerEvents.push(["consume", character, index]);
    }
    index += 1;`
    );
    const parserPattern = "function parseDocument(";
    assert.equal(rewritten.split(parserPattern).length - 1, 1);
    rewritten += "\nexport { parseDocument as __testParseDocument, __testContainerEvents };\n";
  }
  const decoderUrl = `data:text/javascript;base64,${Buffer.from(await transpile(rewritten)).toString("base64")}#decoder-${fragment}`;
  return import(decoderUrl);
}

test("rejects_non_bytes_empty_bytes_and_oversize_before_decoding", async () => {
  const module = await loadDecoderModule("carrier");
  assert.equal(typeof module.decodeServiceConditionSnapshotJson, "function");

  let decodeCalls = 0;
  const originalDecode = TextDecoder.prototype.decode;
  TextDecoder.prototype.decode = function (...args) {
    decodeCalls += 1;
    return Reflect.apply(originalDecode, this, args);
  };
  try {
    class ByteSubclass extends Uint8Array {}
    const invalid = [
      null,
      "{}",
      {},
      new DataView(new ArrayBuffer(1)),
      new Uint16Array(1),
      Buffer.from("{}"),
      new ByteSubclass([123, 125]),
      new Uint8Array(),
      new Uint8Array([0xef, 0xbb, 0xbf, 123, 125]),
      new Uint8Array(16_385)
    ];
    for (const input of invalid) {
      assert.deepEqual(module.decodeServiceConditionSnapshotJson(input), FAILURE);
    }
    assert.equal(decodeCalls, 0);
  } finally {
    TextDecoder.prototype.decode = originalDecode;
  }
});

test("decodes_the_smallest_UTF8_snapshot_and_delegates_to_the_classifier", async () => {
  const module = await loadDecoderModule("empty");
  const input = new TextEncoder().encode(
    "{\"schemaVersion\":\"1.0\",\"generatedAt\":\"2000-01-01T00:00:00.000Z\",\"components\":[]}"
  );

  const result = module.decodeServiceConditionSnapshotJson(input);

  assert.deepEqual(result, EMPTY_SUCCESS);
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.components), true);
  assert.equal(Object.isFrozen(result.counts), true);
});

test("applies_the_current_structural_carrier_rule_after_prototype_normalization", async () => {
  const module = await loadDecoderModule("structural-carrier");
  const document = new TextEncoder().encode(
    "{\"schemaVersion\":\"1.0\",\"generatedAt\":\"2000-01-01T00:00:00.000Z\",\"components\":[]}"
  );
  class ByteSubclass extends Uint8Array {}

  const unchangedBuffer = Buffer.from(document);
  const unchangedSubclass = new ByteSubclass(document);
  assert.deepEqual(module.decodeServiceConditionSnapshotJson(unchangedBuffer), FAILURE);
  assert.deepEqual(module.decodeServiceConditionSnapshotJson(unchangedSubclass), FAILURE);

  const normalizedBuffer = Buffer.from(document);
  const normalizedSubclass = new ByteSubclass(document);
  Object.setPrototypeOf(normalizedBuffer, Uint8Array.prototype);
  Object.setPrototypeOf(normalizedSubclass, Uint8Array.prototype);

  for (const normalized of [normalizedBuffer, normalizedSubclass]) {
    assert.equal(Object.getPrototypeOf(normalized), Uint8Array.prototype);
    assert.equal(Object.getPrototypeOf(normalized.buffer), ArrayBuffer.prototype);
    assert.deepEqual(module.decodeServiceConditionSnapshotJson(normalized), EMPTY_SUCCESS);
  }
  assert.equal(Buffer.isBuffer(normalizedBuffer), false);
});

test("applies_current_structure_to_unchanged_and_normalized_cross_realm_bytes", async () => {
  const module = await loadDecoderModule("cross-realm-structural-carrier");
  const document = new TextEncoder().encode(
    "{\"schemaVersion\":\"1.0\",\"generatedAt\":\"2000-01-01T00:00:00.000Z\",\"components\":[]}"
  );
  const crossRealm = vm.runInNewContext(`new Uint8Array(${JSON.stringify([...document])})`);

  assert.notEqual(Object.getPrototypeOf(crossRealm), Uint8Array.prototype);
  assert.notEqual(Object.getPrototypeOf(crossRealm.buffer), ArrayBuffer.prototype);
  assert.deepEqual(module.decodeServiceConditionSnapshotJson(crossRealm), FAILURE);

  Object.setPrototypeOf(crossRealm, Uint8Array.prototype);
  Object.setPrototypeOf(crossRealm.buffer, ArrayBuffer.prototype);
  assert.equal(Object.getPrototypeOf(crossRealm), Uint8Array.prototype);
  assert.equal(Object.getPrototypeOf(crossRealm.buffer), ArrayBuffer.prototype);
  assert.deepEqual(module.decodeServiceConditionSnapshotJson(crossRealm), EMPTY_SUCCESS);
});

test("accepts_closed_JSON_grammar_and_delegates_one_synthetic_component", async () => {
  const module = await loadDecoderModule("grammar", true);
  assert.equal(typeof module.__testParseDocument, "function");
  assert.deepEqual(module.decodeServiceConditionSnapshotJson(new TextEncoder().encode(
    "{\"schemaVersion\":\"1.0\",\"generatedAt\":\"2000-01-01T00:00:00.000Z\",\"components\":[]}"
  )), EMPTY_SUCCESS);

  const valid = new TextEncoder().encode(`{
    "components": [ { "lastKnown": null, "blockedReasonCode": null,
      "evidenceCode": "none", "observedAt": null, "freshness": "unavailable",
      "administrativeState": "required", "configured": false,
      "label": "Synth\\u0065tic", "\\u0069d": "syn-one" } ],
    "generatedAt": "2000-01-01T00:00:00.000Z", "schemaVersion": "1.0"
  }`);

  assert.deepEqual(module.decodeServiceConditionSnapshotJson(valid), {
    ok: true,
    schemaVersion: "1.0",
    generatedAt: "2000-01-01T00:00:00.000Z",
    components: [{
      kind: "classified",
      id: "syn-one",
      label: "Synthetic",
      condition: "not_configured",
      freshness: "unavailable",
      evidenceCode: "none",
      reasonCode: "not_configured",
      reason: "Component is not configured.",
      observedAt: null
    }],
    counts: {
      working: 0,
      degraded: 0,
      blocked: 0,
      broken: 0,
      not_configured: 1,
      optional: 0,
      retired: 0
    },
    total: 1,
    classifiedTotal: 1,
    conditionUnavailableTotal: 0,
    hasLocalizedImpairment: false
  });

  const probed = module.__testParseDocument("{\"emoji\":\"\\uD83D\\uDE00\"}");
  assert.equal(Object.getPrototypeOf(probed), null);
  assert.equal(probed.emoji, "😀");

  const malformed = [
    new Uint8Array([0x7b, 0x22, 0x78, 0x22, 0x3a, 0x22, 0xc3, 0x28, 0x22, 0x7d]),
    new TextEncoder().encode("{\"x\":\"\\x41\"}"),
    new TextEncoder().encode("{\"x\":\"line\nfeed\"}"),
    new TextEncoder().encode("{\"x\":\"\\uD800\"}"),
    new TextEncoder().encode("{\"x\":0}"),
    new TextEncoder().encode("{/*x*/}"),
    new TextEncoder().encode("{\"x\":null,}"),
    new TextEncoder().encode("null true"),
    new TextEncoder().encode("\u00a0null")
  ];
  for (const input of malformed) {
    assert.deepEqual(module.decodeServiceConditionSnapshotJson(input), FAILURE);
  }
});

test("rejects_decoded_duplicate_keys_at_every_permitted_object_depth", async () => {
  const module = await loadDecoderModule("duplicates");
  const encode = (value) => new TextEncoder().encode(value);
  const notConfiguredFields = `"id":"syn-one","label":"Synthetic","configured":false,
    "administrativeState":"required","freshness":"unavailable","observedAt":null,
    "evidenceCode":"none","blockedReasonCode":null,"lastKnown":null`;
  const staleFields = `"id":"syn-one","label":"Synthetic","configured":true,
    "administrativeState":"required","freshness":"stale","observedAt":null,
    "evidenceCode":"none","blockedReasonCode":null,
    "lastKnown":{"observedAt":"1999-12-31T23:59:59.000Z","evidenceCode":"positive",
      "evidenceCode":"positive"}`;
  const documents = [
    `{"schemaVersion":"1.0","generatedAt":"2000-01-01T00:00:00.000Z",
      "generatedAt":"2000-01-01T00:00:00.000Z","components":[]}`,
    `{"schemaVersion":"1.0","generatedAt":"2000-01-01T00:00:00.000Z",
      "components":[{${notConfiguredFields},"configured":false}]}`,
    `{"schemaVersion":"1.0","generatedAt":"2000-01-01T00:00:00.000Z",
      "components":[{${staleFields}}]}`,
    `{"schemaVersion":"1.0","generatedAt":"2000-01-01T00:00:00.000Z",
      "components":[{${notConfiguredFields},"\\u0069d":"syn-one"}]}`
  ];

  const results = documents.map((document) => module.decodeServiceConditionSnapshotJson(encode(document)));
  for (const result of results) assert.deepEqual(result, FAILURE);
});

test("rejects_duplicate_keys_and_component_ids_after_Set_has_is_replaced", async () => {
  const module = await loadDecoderModule("set-has-replacement");
  const duplicateRoot = new TextEncoder().encode(
    `{"schemaVersion":"1.0","generatedAt":"2000-01-01T00:00:00.000Z",
      "generatedAt":"2000-01-01T00:00:00.000Z","components":[]}`
  );
  const duplicateIds = serializedSnapshot([
    syntheticComponent({ id: "syn-duplicate" }),
    syntheticComponent({ id: "syn-duplicate", label: "Synthetic Duplicate" })
  ]);
  const originalSetHas = Set.prototype.has;
  Set.prototype.has = () => false;
  try {
    for (const input of [duplicateRoot, duplicateIds]) {
      const result = module.decodeServiceConditionSnapshotJson(input);
      assert.deepEqual(result, FAILURE);
      const serializedResult = JSON.stringify(result);
      assert.equal(serializedResult.includes("syn-duplicate"), false);
      assert.equal(serializedResult.includes("generatedAt"), false);
      assert.equal(serializedResult.includes("Set.prototype.has"), false);
    }
  } finally {
    Set.prototype.has = originalSetHas;
  }
});

test("rejects_duplicate_keys_and_component_ids_after_Set_add_is_replaced", async () => {
  const module = await loadDecoderModule("set-add-replacement");
  const duplicateRoot = new TextEncoder().encode(
    `{"schemaVersion":"1.0","generatedAt":"2000-01-01T00:00:00.000Z",
      "generatedAt":"2000-01-01T00:00:00.000Z","components":[]}`
  );
  const duplicateIds = serializedSnapshot([
    syntheticComponent({ id: "syn-duplicate" }),
    syntheticComponent({ id: "syn-duplicate", label: "Synthetic Duplicate" })
  ]);
  const originalSetAdd = Set.prototype.add;
  Set.prototype.add = function () { return this; };
  try {
    for (const input of [duplicateRoot, duplicateIds]) {
      assert.deepEqual(module.decodeServiceConditionSnapshotJson(input), FAILURE);
    }
  } finally {
    Set.prototype.add = originalSetAdd;
  }
});

test("rejects_classifier_output_corruption_after_Map_get_is_selectively_replaced", async () => {
  const module = await loadDecoderModule("map-get-replacement");
  const input = serializedSnapshot([syntheticComponent()]);
  const originalMapGet = Map.prototype.get;
  Map.prototype.get = function (key) {
    const descriptor = Reflect.apply(originalMapGet, this, [key]);
    if (key === "label" && descriptor?.value === "Synthetic Component") {
      return { ...descriptor, value: "Altered" };
    }
    return descriptor;
  };
  try {
    const result = module.decodeServiceConditionSnapshotJson(input);
    assert.deepEqual(result, FAILURE);
    assert.equal(JSON.stringify(result).includes("Altered"), false);
  } finally {
    Map.prototype.get = originalMapGet;
  }
});

test("rejects_classifier_output_corruption_after_Map_set_is_selectively_replaced", async () => {
  const module = await loadDecoderModule("map-set-replacement");
  const input = serializedSnapshot([syntheticComponent()]);
  const originalMapSet = Map.prototype.set;
  Map.prototype.set = function (key, descriptor) {
    const replacement = key === "label" && descriptor?.value === "Synthetic Component"
      ? { ...descriptor, value: "Altered" }
      : descriptor;
    return Reflect.apply(originalMapSet, this, [key, replacement]);
  };
  try {
    const result = module.decodeServiceConditionSnapshotJson(input);
    assert.deepEqual(result, FAILURE);
    assert.equal(JSON.stringify(result).includes("Altered"), false);
  } finally {
    Map.prototype.set = originalMapSet;
  }
});

test("rejects_malformed_classifier_input_after_Map_has_is_selectively_replaced", async () => {
  const module = await loadDecoderModule("map-has-replacement");
  const component = syntheticComponent();
  delete component.label;
  component.other = "Synthetic Component";
  const input = serializedSnapshot([component]);
  const originalMapHas = Map.prototype.has;
  const originalMapSet = Map.prototype.set;
  Map.prototype.has = function (key) {
    if (key === "label" && !Reflect.apply(originalMapHas, this, [key])) {
      Reflect.apply(originalMapSet, this, [key, {
        value: "Synthetic Component",
        enumerable: true,
        writable: true,
        configurable: true
      }]);
      return true;
    }
    return Reflect.apply(originalMapHas, this, [key]);
  };
  try {
    assert.deepEqual(module.decodeServiceConditionSnapshotJson(input), FAILURE);
  } finally {
    Map.prototype.has = originalMapHas;
  }
});

test("rejects_classifier_output_corruption_after_Map_values_is_selectively_replaced", async () => {
  const module = await loadDecoderModule("map-values-replacement");
  const input = serializedSnapshot([syntheticComponent()]);
  const originalMapValues = Map.prototype.values;
  Map.prototype.values = function () {
    const descriptors = Reflect.apply(originalMapValues, this, []);
    return (function* () {
      for (const descriptor of descriptors) {
        if (descriptor?.value === "Synthetic Component") descriptor.value = "Altered";
        yield descriptor;
      }
    })();
  };
  try {
    const result = module.decodeServiceConditionSnapshotJson(input);
    assert.deepEqual(result, FAILURE);
    assert.equal(JSON.stringify(result).includes("Altered"), false);
  } finally {
    Map.prototype.values = originalMapValues;
  }
});

test("rejects_classifier_output_corruption_after_Map_constructor_is_replaced", async () => {
  const module = await loadDecoderModule("map-constructor-replacement");
  const input = serializedSnapshot([syntheticComponent()]);
  const OriginalMap = Map;
  globalThis.Map = class extends OriginalMap {
    set(key, descriptor) {
      const replacement = key === "label" && descriptor?.value === "Synthetic Component"
        ? { ...descriptor, value: "Altered" }
        : descriptor;
      return super.set(key, replacement);
    }
  };
  try {
    const result = module.decodeServiceConditionSnapshotJson(input);
    assert.deepEqual(result, FAILURE);
    assert.equal(JSON.stringify(result).includes("Altered"), false);
  } finally {
    globalThis.Map = OriginalMap;
  }
});

test("rejects_duplicate_component_ids_after_Set_constructor_is_replaced", async () => {
  const module = await loadDecoderModule("set-constructor-replacement");
  const input = serializedSnapshot([
    syntheticComponent({ id: "syn-duplicate" }),
    syntheticComponent({ id: "syn-duplicate", label: "Synthetic Duplicate" })
  ]);
  const OriginalSet = Set;
  globalThis.Set = class extends OriginalSet {
    has() { return false; }
  };
  try {
    const result = module.decodeServiceConditionSnapshotJson(input);
    assert.deepEqual(result, FAILURE);
    assert.equal(JSON.stringify(result).includes("syn-duplicate"), false);
  } finally {
    globalThis.Set = OriginalSet;
  }
});

test("rejects_classifier_output_corruption_after_Array_isArray_is_replaced", async () => {
  const module = await loadDecoderModule("array-is-array-replacement");
  const input = serializedSnapshot([syntheticComponent()]);
  const originalIsArray = Array.isArray;
  Array.isArray = function (value) {
    if (!originalIsArray(value) && originalIsArray(value?.components)) {
      value.components[0].label = "Altered";
    }
    return originalIsArray(value);
  };
  try {
    const result = module.decodeServiceConditionSnapshotJson(input);
    assert.deepEqual(result, FAILURE);
    assert.equal(JSON.stringify(result).includes("Altered"), false);
  } finally {
    Array.isArray = originalIsArray;
  }
});

test("rejects_classifier_output_corruption_after_WeakSet_has_is_replaced", async () => {
  const module = await loadDecoderModule("weak-set-has-replacement");
  const input = serializedSnapshot([syntheticComponent()]);
  const originalWeakSetHas = WeakSet.prototype.has;
  WeakSet.prototype.has = function (value) {
    if (Array.isArray(value?.components)) value.components[0].label = "Altered";
    return Reflect.apply(originalWeakSetHas, this, [value]);
  };
  try {
    const result = module.decodeServiceConditionSnapshotJson(input);
    assert.deepEqual(result, FAILURE);
    assert.equal(JSON.stringify(result).includes("Altered"), false);
  } finally {
    WeakSet.prototype.has = originalWeakSetHas;
  }
});

test("rejects_classifier_output_corruption_after_WeakSet_add_is_replaced", async () => {
  const module = await loadDecoderModule("weak-set-add-replacement");
  const input = serializedSnapshot([syntheticComponent()]);
  const originalWeakSetAdd = WeakSet.prototype.add;
  WeakSet.prototype.add = function (value) {
    if (Array.isArray(value?.components)) value.components[0].label = "Altered";
    return Reflect.apply(originalWeakSetAdd, this, [value]);
  };
  try {
    const result = module.decodeServiceConditionSnapshotJson(input);
    assert.deepEqual(result, FAILURE);
    assert.equal(JSON.stringify(result).includes("Altered"), false);
  } finally {
    WeakSet.prototype.add = originalWeakSetAdd;
  }
});

test("rejects_classifier_output_corruption_after_WeakSet_constructor_is_replaced", async () => {
  const module = await loadDecoderModule("weak-set-constructor-replacement");
  const input = serializedSnapshot([syntheticComponent()]);
  const OriginalWeakSet = WeakSet;
  globalThis.WeakSet = class extends OriginalWeakSet {
    has(value) {
      if (Array.isArray(value?.components)) value.components[0].label = "Altered";
      return super.has(value);
    }
  };
  try {
    const result = module.decodeServiceConditionSnapshotJson(input);
    assert.deepEqual(result, FAILURE);
    assert.equal(JSON.stringify(result).includes("Altered"), false);
  } finally {
    globalThis.WeakSet = OriginalWeakSet;
  }
});

test("rejects_classifier_output_reordering_after_String_constructor_is_replaced", async () => {
  const module = await loadDecoderModule("string-constructor-replacement");
  const input = serializedSnapshot([
    syntheticComponent({ id: "syn-one", label: "Synthetic One" }),
    syntheticComponent({ id: "syn-two", label: "Synthetic Two" })
  ]);
  const OriginalString = String;
  function AlteredString(value) {
    if (value === 0) return OriginalString(1);
    if (value === 1) return OriginalString(0);
    return OriginalString(value);
  }
  AlteredString.prototype = OriginalString.prototype;
  AlteredString.fromCharCode = OriginalString.fromCharCode;
  globalThis.String = AlteredString;
  try {
    assert.deepEqual(module.decodeServiceConditionSnapshotJson(input), FAILURE);
  } finally {
    globalThis.String = OriginalString;
  }
});

test("rejects_hostile_label_bypass_after_String_fromCharCode_is_selectively_replaced", async () => {
  const module = await loadDecoderModule("string-from-char-code-replacement");
  const input = serializedSnapshot([syntheticComponent({ label: "Synthetic API Token" })]);
  const originalFromCharCode = String.fromCharCode;
  String.fromCharCode = function (...codes) {
    if (codes.length === 1 && codes[0] === 97) return "x";
    return Reflect.apply(originalFromCharCode, String, codes);
  };
  try {
    const result = module.decodeServiceConditionSnapshotJson(input);
    assert.deepEqual(result, FAILURE);
    assert.equal(JSON.stringify(result).includes("API Token"), false);
  } finally {
    String.fromCharCode = originalFromCharCode;
  }
});

test("rejects_invalid_literals_after_String_startsWith_is_selectively_replaced", async () => {
  const module = await loadDecoderModule("string-starts-with-replacement");
  const invalid = new TextEncoder().encode(
    `{"schemaVersion":"1.0","generatedAt":"2000-01-01T00:00:00.000Z",
      "components":[{"id":"syn-one","label":"Synthetic","configured":xxxx,
      "administrativeState":"required","freshness":"unavailable","observedAt":null,
      "evidenceCode":"none","blockedReasonCode":null,"lastKnown":null}]}`
  );
  const originalStartsWith = String.prototype.startsWith;
  String.prototype.startsWith = function (token, position) {
    if (originalStartsWith.call(this, "xxxx", position)) return true;
    return originalStartsWith.call(this, token, position);
  };
  try {
    const result = module.decodeServiceConditionSnapshotJson(invalid);
    assert.deepEqual(result, FAILURE);
    assert.equal(JSON.stringify(result).includes("xxxx"), false);
  } finally {
    String.prototype.startsWith = originalStartsWith;
  }
});

test("rejects_component_data_after_Array_push_is_replaced", async () => {
  const module = await loadDecoderModule("array-push-replacement");
  const input = serializedSnapshot([syntheticComponent({ id: "syn-one" })]);
  const originalPush = Array.prototype.push;
  Array.prototype.push = function () { return this.length; };
  try {
    const result = module.decodeServiceConditionSnapshotJson(input);
    assert.deepEqual(result, FAILURE);
    assert.equal(JSON.stringify(result).includes("syn-one"), false);
  } finally {
    Array.prototype.push = originalPush;
  }
});

test("rejects_invalid_hex_after_String_charCodeAt_is_selectively_replaced", async () => {
  const module = await loadDecoderModule("string-char-code-at-replacement");
  const invalid = new TextEncoder().encode(
    "{\"schem\\u006gVersion\":\"1.0\",\"generatedAt\":\"2000-01-01T00:00:00.000Z\",\"components\":[]}"
  );
  const originalCharCodeAt = String.prototype.charCodeAt;
  String.prototype.charCodeAt = function (position) {
    const code = originalCharCodeAt.call(this, position);
    return code === 0x67 && String(this).includes("\\u006g") ? 0x31 : code;
  };
  try {
    const result = module.decodeServiceConditionSnapshotJson(invalid);
    assert.deepEqual(result, FAILURE);
    assert.equal(JSON.stringify(result).includes("006g"), false);
  } finally {
    String.prototype.charCodeAt = originalCharCodeAt;
  }
});

test("preserves_decoded_strings_after_String_fromCodePoint_is_replaced", async () => {
  const module = await loadDecoderModule("string-from-code-point-replacement");
  const input = new TextEncoder().encode(
    `{"schemaVersion":"1.0","generatedAt":"2000-01-01T00:00:00.000Z",
      "components":[{"id":"syn-one","label":"Synth\\u0065tic","configured":false,
      "administrativeState":"required","freshness":"unavailable","observedAt":null,
      "evidenceCode":"none","blockedReasonCode":null,"lastKnown":null}]}`
  );
  const originalFromCodePoint = String.fromCodePoint;
  String.fromCodePoint = () => "Z";
  try {
    const result = module.decodeServiceConditionSnapshotJson(input);
    assert.equal(result.ok, true);
    assert.equal(result.components[0].label, "Synthetic");
  } finally {
    String.fromCodePoint = originalFromCodePoint;
  }
});

test("preserves_parsed_properties_after_Object_defineProperty_is_replaced", async () => {
  const module = await loadDecoderModule("object-define-property-replacement");
  const input = serializedSnapshot([syntheticComponent({ id: "syn-one" })]);
  const originalDefineProperty = Object.defineProperty;
  Object.defineProperty = function (target, key, descriptor) {
    const replacement = key === "label" ? { ...descriptor, value: "Altered" } : descriptor;
    return Reflect.apply(originalDefineProperty, Object, [target, key, replacement]);
  };
  try {
    const result = module.decodeServiceConditionSnapshotJson(input);
    assert.equal(result.ok, true);
    assert.equal(result.components[0].label, "Synthetic Component");
  } finally {
    Object.defineProperty = originalDefineProperty;
  }
});

test("preserves_null_prototype_records_after_Object_create_is_replaced", async () => {
  const module = await loadDecoderModule("object-create-replacement", true);
  const originalCreate = Object.create;
  Object.create = () => ({});
  try {
    const parsed = module.__testParseDocument("{\"synthetic\":null}");
    assert.equal(Object.getPrototypeOf(parsed), null);
  } finally {
    Object.create = originalCreate;
  }
});

test("stops_before_the_first_over_budget_JSON_unit_and_accepts_the_exact_maximum", async () => {
  const module = await loadDecoderModule("budgets", false, true);
  const encode = (value) => new TextEncoder().encode(value);
  const components = Array.from({ length: 16 }, (_, index) => ({
    id: `syn-${String(index).padStart(2, "0")}`,
    label: `Synthetic ${String(index).padStart(2, "0")}`,
    configured: true,
    administrativeState: "required",
    freshness: "stale",
    observedAt: null,
    evidenceCode: "none",
    blockedReasonCode: null,
    lastKnown: {
      observedAt: "1999-12-31T23:59:59.000Z",
      evidenceCode: "positive"
    }
  }));
  const maximum = {
    schemaVersion: "1.0",
    generatedAt: "2000-01-01T00:00:00.000Z",
    components
  };
  const totals = { members: 0, elements: 0, values: 0, containers: 0 };
  const count = (value) => {
    totals.values += 1;
    if (Array.isArray(value)) {
      totals.containers += 1;
      totals.elements += value.length;
      for (const item of value) count(item);
    } else if (value !== null && typeof value === "object") {
      totals.containers += 1;
      const entries = Object.entries(value);
      totals.members += entries.length;
      for (const [, item] of entries) count(item);
    }
  };
  count(maximum);
  assert.deepEqual(totals, { members: 179, elements: 16, values: 196, containers: 34 });
  const maximumResult = module.decodeServiceConditionSnapshotJson(encode(JSON.stringify(maximum)));
  assert.equal(maximumResult.ok, true);
  assert.equal(maximumResult.total, 16);

  const overArray = `[${Array.from({ length: 16 }, () => "null").join(",")},"sentinel"]`;
  const sentinelPosition = overArray.indexOf("\"sentinel\"");
  module.__testStringPositions.length = 0;
  assert.deepEqual(module.decodeServiceConditionSnapshotJson(encode(overArray)), FAILURE);
  assert.equal(module.__testStringPositions.includes(sentinelPosition), false);

  const overBudget = [
    "[[[[{}]]]]",
    `{${Array.from({ length: 10 }, (_, index) => `"k${index}":null`).join(",")}}`,
    `{"${"k".repeat(33)}":null}`,
    `"${"v".repeat(81)}"`,
    `[${Array.from({ length: 16 }, () => `{${Array.from({ length: 9 }, (_, index) => `"k${index}":"${"v".repeat(57)}"`).join(",")}}`).join(",")}]`
  ];
  for (const document of overBudget) {
    assert.deepEqual(module.decodeServiceConditionSnapshotJson(encode(document)), FAILURE);
  }
});

test("rejects_the_first_over_depth_container_before_dispatch_or_opening_token_consumption", async () => {
  const module = await loadDecoderModule("depth-order", false, false, true);
  const parse = module.__testParseDocument;
  assert.equal(typeof parse, "function");
  for (const document of ["[[[[{}]]]]", "[[[[[]]]]]"]) {
    const overDepthPosition = 4;
    module.__testContainerEvents.length = 0;
    assert.throws(() => parse(document));
    assert.equal(
      module.__testContainerEvents.some((event) => event[2] === 4 && event[3] === overDepthPosition),
      false
    );
    assert.equal(
      module.__testContainerEvents.some((event) => event[0] === "consume" && event[2] === overDepthPosition),
      false
    );
  }
});

test("preserves_captured_carrier_operations_detachment_and_fresh_frozen_results", async () => {
  const module = await loadDecoderModule("freeze");
  assert.deepEqual(Object.keys(module), ["decodeServiceConditionSnapshotJson"]);

  const document = JSON.stringify({
    schemaVersion: "1.0",
    generatedAt: "2000-01-01T00:00:00.000Z",
    components: []
  });
  const exact = new TextEncoder().encode(document + " ".repeat(16_384 - document.length));
  assert.equal(exact.byteLength, 16_384);
  assert.equal(module.decodeServiceConditionSnapshotJson(exact).ok, true);

  const originalApply = Reflect.apply;
  Reflect.apply = () => { throw new Error("ambient mutation"); };
  try {
    assert.deepEqual(module.decodeServiceConditionSnapshotJson(new TextEncoder().encode(document)), EMPTY_SUCCESS);
  } finally {
    Reflect.apply = originalApply;
  }

  const mutable = serializedSnapshot([syntheticComponent()]);
  const success = module.decodeServiceConditionSnapshotJson(mutable);
  mutable.fill(0);
  assert.equal(success.ok, true);
  assert.equal(success.components[0].condition, "not_configured");
  assertRecursivelyFrozen(success);

  const crossRealm = vm.runInNewContext("new Uint8Array([123, 125])");
  const proxied = new Proxy(new Uint8Array([123, 125]), {
    getPrototypeOf() { return Uint8Array.prototype; }
  });
  const detached = new Uint8Array([123, 125]);
  structuredClone(detached.buffer, { transfer: [detached.buffer] });
  const invalid = [crossRealm, proxied, detached];
  if (typeof SharedArrayBuffer === "function") invalid.push(new Uint8Array(new SharedArrayBuffer(2)));
  for (const input of invalid) assert.deepEqual(module.decodeServiceConditionSnapshotJson(input), FAILURE);

  const first = module.decodeServiceConditionSnapshotJson(new Uint8Array([0xff]));
  const second = module.decodeServiceConditionSnapshotJson(new TextEncoder().encode("{\"private\":}"));
  assert.deepEqual(first, FAILURE);
  assert.deepEqual(second, FAILURE);
  assert.notEqual(first, second);
  assert.notEqual(first.error, second.error);
  assert.equal(JSON.stringify(second).includes("private"), false);
  assertRecursivelyFrozen(first);
  assertRecursivelyFrozen(second);
});

test("enforces_every_string_collection_and_depth_boundary_through_the_private_parser_probe", async () => {
  const module = await loadDecoderModule("boundary-probe", true);
  const parse = module.__testParseDocument;

  assert.doesNotThrow(() => parse(`{"${"k".repeat(32)}":null}`));
  assert.throws(() => parse(`{"${"k".repeat(33)}":null}`));
  assert.doesNotThrow(() => parse(`"${"v".repeat(80)}"`));
  assert.throws(() => parse(`"${"v".repeat(81)}"`));
  assert.doesNotThrow(() => parse(`[${Array.from({ length: 16 }, () => "null").join(",")}]`));
  assert.throws(() => parse(`[${Array.from({ length: 17 }, () => "null").join(",")}]`));
  assert.doesNotThrow(() => parse(`{${Array.from({ length: 9 }, (_, index) => `"k${index}":null`).join(",")}}`));
  assert.throws(() => parse(`{${Array.from({ length: 10 }, (_, index) => `"k${index}":null`).join(",")}}`));
  assert.doesNotThrow(() => parse("[[[{}]]]"));
  assert.throws(() => parse("[[[[{}]]]]"));

  const strings = Array.from({ length: 144 }, (_, index) => "v".repeat(index < 128 ? 55 : 54));
  const aggregateDocument = () => `[${Array.from({ length: 16 }, (_, objectIndex) => {
    const entries = Array.from({ length: 9 }, (_, memberIndex) => {
      const flatIndex = objectIndex * 9 + memberIndex;
      return `"k${memberIndex}":"${strings[flatIndex]}"`;
    });
    return `{${entries.join(",")}}`;
  }).join(",")}]`;
  assert.doesNotThrow(() => parse(aggregateDocument()));
  strings[0] += "v";
  assert.throws(() => parse(aggregateDocument()));
});

test("preserves_serialized_condition_freshness_locality_chronology_and_hostile_label_semantics", async () => {
  const module = await loadDecoderModule("semantics");
  const before = "1999-12-31T23:59:59.000Z";
  const components = [
    syntheticComponent({ id: "syn-working", label: "Synthetic Working", configured: true, freshness: "degraded", observedAt: before, evidenceCode: "positive" }),
    syntheticComponent({ id: "syn-degraded", label: "Synthetic Degraded", configured: true, freshness: "live", observedAt: before, evidenceCode: "partial_function" }),
    syntheticComponent({ id: "syn-broken", label: "Synthetic Broken", configured: true, freshness: "recent", observedAt: before, evidenceCode: "complete_failure" }),
    syntheticComponent({ id: "syn-blocked", label: "Synthetic Blocked", configured: true, blockedReasonCode: "dependency" }),
    syntheticComponent({ id: "syn-not-configured", label: "Synthetic Not Configured" }),
    syntheticComponent({ id: "syn-optional", label: "Synthetic Optional", administrativeState: "optional" }),
    syntheticComponent({ id: "syn-retired", label: "Synthetic Retired", administrativeState: "retired" }),
    syntheticComponent({ id: "syn-unavailable", label: "Synthetic Unknown", configured: true, freshness: "stale" }),
    syntheticComponent({ id: "syn-last-known", label: "Synthetic Last Known", configured: true, freshness: "unavailable", lastKnown: { observedAt: before, evidenceCode: "positive" } })
  ];
  const result = module.decodeServiceConditionSnapshotJson(serializedSnapshot(components));
  assert.equal(result.ok, true);
  assert.deepEqual(result.counts, {
    working: 2,
    degraded: 1,
    blocked: 1,
    broken: 1,
    not_configured: 1,
    optional: 1,
    retired: 1
  });
  assert.equal(result.conditionUnavailableTotal, 1);
  assert.equal(result.components[0].freshness, "degraded");
  assert.equal(result.components[0].condition, "working");
  assert.equal("condition" in result, false);

  const equalCurrent = syntheticComponent({ configured: true, freshness: "recent", observedAt: "2000-01-01T00:00:00.000Z", evidenceCode: "positive" });
  assert.equal(module.decodeServiceConditionSnapshotJson(serializedSnapshot([equalCurrent])).ok, true);
  for (const malformed of [
    syntheticComponent({ configured: true, freshness: "recent", observedAt: "2000-01-01T00:00:00.001Z", evidenceCode: "positive" }),
    syntheticComponent({ configured: true, freshness: "stale", lastKnown: { observedAt: "2000-01-01T00:00:00.001Z", evidenceCode: "positive" } }),
    syntheticComponent({ configured: true, freshness: "live", observedAt: before, evidenceCode: "none" })
  ]) assert.deepEqual(module.decodeServiceConditionSnapshotJson(serializedSnapshot([malformed])), FAILURE);

  assert.deepEqual(module.decodeServiceConditionSnapshotJson(serializedSnapshot([
    syntheticComponent({ id: "syn-duplicate" }),
    syntheticComponent({ id: "syn-duplicate", label: "Synthetic Duplicate" })
  ])), FAILURE);
  const deniedLabels = [
    "Synthetic API Token", "Synthetic Access Token", "Synthetic Auth Token", "Synthetic Secret Value",
    "Synthetic Client Secret", "Synthetic Login Credential", "Synthetic Login Password",
    "Synthetic Connection String", "Synthetic Provider Error", "Synthetic Provider Internal",
    "Synthetic Provider Stack Trace", "Synthetic Private Identifier", "Synthetic Account ID",
    "Synthetic Tenant ID", "Synthetic Private Repository", "Synthetic Execute Code", "Synthetic Script Payload"
  ];
  for (const label of deniedLabels) {
    assert.deepEqual(module.decodeServiceConditionSnapshotJson(serializedSnapshot([syntheticComponent({ label })])), FAILURE);
  }
});
