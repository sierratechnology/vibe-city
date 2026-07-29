import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const source = await readFile(new URL("../src/contextActionStatusState.ts", import.meta.url), "utf8");
const transpiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2022
  }
}).outputText;
const { computeContextActionStatusState } = await import(
  `data:text/javascript;base64,${Buffer.from(transpiled).toString("base64")}`
);

const ready = {
  cityEntered: true,
  transitionBlocked: false,
  recordsTerminalOpen: false,
  operationsDirectoryOpen: false,
  activeContextLabel: "Exit STG Headquarters"
};

const hidden = { hidden: true, text: "" };

test("context status exposes only a currently executable action", () => {
  assert.deepEqual(computeContextActionStatusState(ready), {
    hidden: false,
    text: "Exit STG Headquarters"
  });
  assert.deepEqual(computeContextActionStatusState({ ...ready, activeContextLabel: null }), hidden);
});

test("context status is cleared before entry and while either dialog blocks world input", () => {
  assert.deepEqual(computeContextActionStatusState({ ...ready, cityEntered: false }), hidden);
  assert.deepEqual(computeContextActionStatusState({ ...ready, recordsTerminalOpen: true }), hidden);
  assert.deepEqual(computeContextActionStatusState({ ...ready, operationsDirectoryOpen: true }), hidden);
});

test("context status is cleared through scene transitions and restored only after transition completion", () => {
  assert.deepEqual(computeContextActionStatusState({ ...ready, transitionBlocked: true }), hidden);
  assert.deepEqual(computeContextActionStatusState(ready), {
    hidden: false,
    text: "Exit STG Headquarters"
  });
});
