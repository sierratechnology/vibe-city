import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const source = await readFile(new URL("../src/mobileControlState.ts", import.meta.url), "utf8");
const transpiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2022
  }
}).outputText;
const { computeMobileControlState } = await import(
  `data:text/javascript;base64,${Buffer.from(transpiled).toString("base64")}`
);

const ready = {
  cityEntered: true,
  mobileCapable: true,
  typing: false,
  interactionBlocked: false,
  transitionBlocked: false,
  activeContextAction: false
};

test("container visibility requires entry, mobile capability, and no typing", () => {
  assert.deepEqual(computeMobileControlState(ready), {
    containerVisible: true,
    actionVisible: false
  });

  for (const blocked of [
    { cityEntered: false },
    { mobileCapable: false },
    { typing: true },
    { interactionBlocked: true }
  ]) {
    assert.deepEqual(computeMobileControlState({ ...ready, ...blocked }), {
      containerVisible: false,
      actionVisible: false
    });
  }
});

test("Action is exposed only for an active context and is suppressed by transitions or a hidden container", () => {
  assert.deepEqual(computeMobileControlState({ ...ready, activeContextAction: true }), {
    containerVisible: true,
    actionVisible: true
  });
  assert.equal(
    computeMobileControlState({ ...ready, activeContextAction: true, transitionBlocked: true }).actionVisible,
    false
  );
  assert.equal(
    computeMobileControlState({ ...ready, activeContextAction: true, typing: true }).actionVisible,
    false
  );
});

test("legacy citizen, home, and modal state is not part of mobile control state", () => {
  assert.doesNotMatch(source, /\b(?:modalBlocked|nearbyCitizen|activeHomeAction)\s*:/);
  assert.deepEqual(
    computeMobileControlState({
      ...ready,
      modalBlocked: false,
      nearbyCitizen: true,
      activeHomeAction: true
    }),
    { containerVisible: true, actionVisible: false }
  );
});