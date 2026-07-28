import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const projectRoot = new URL("../", import.meta.url);
const legacySceneTerm = ["apart", "ment"].join("");

async function sourceFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const url = new URL(entry.name, directory);
    if (entry.isDirectory()) files.push(...await sourceFiles(new URL(`${entry.name}/`, directory)));
    else if (/\.(?:ts|html|css|mjs)$/.test(entry.name)) files.push(url);
  }
  return files;
}

test("STG Headquarters terminology replaces the legacy residential scene name", async () => {
  const files = [
    new URL("index.html", projectRoot),
    ...await sourceFiles(new URL("src/", projectRoot)),
    ...await sourceFiles(new URL("tests/", projectRoot))
  ];
  const violations = [];
  for (const file of files) {
    const contents = await readFile(file, "utf8");
    contents.split("\n").forEach((line, index) => {
      if (line.toLowerCase().includes(legacySceneTerm)) {
        violations.push(`${file.pathname}:${index + 1}:${line.trim()}`);
      }
    });
  }
  assert.deepEqual(violations, [], `legacy residential terminology remains:\n${violations.join("\n")}`);
});

test("multiplayer preserves mixed-version visibility at the protocol boundary", async () => {
  const source = await readFile(new URL("src/multiplayer/presenceSceneProtocol.ts", projectRoot), "utf8");
  const javascript = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 }
  }).outputText;
  const protocol = await import(`data:text/javascript;base64,${Buffer.from(javascript).toString("base64")}`);

  const oldClientPayload = { currentScene: legacySceneTerm };
  assert.equal(protocol.normalizePresenceScene(oldClientPayload.currentScene), "headquarters");

  const newClientPayload = {
    currentScene: protocol.legacyCompatibleWireScene("headquarters"),
    currentSceneV2: "headquarters"
  };
  assert.equal(newClientPayload.currentScene, legacySceneTerm, "old clients must recognize the compatibility field");
  assert.equal(
    protocol.normalizePresenceScene(newClientPayload.currentSceneV2 ?? newClientPayload.currentScene),
    "headquarters",
    "new clients must prefer the current scene field"
  );
  assert.equal(protocol.normalizePresenceScene("outside"), "outside");
  assert.equal(protocol.normalizePresenceScene("invalid-scene"), null);
});

test("offline presence distinguishes configuration errors from realtime load failures", async () => {
  const source = await readFile(new URL("src/multiplayer/presenceOfflineStatus.ts", projectRoot), "utf8");
  const javascript = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 }
  }).outputText;
  const status = await import(`data:text/javascript;base64,${Buffer.from(javascript).toString("base64")}`);

  assert.deepEqual(status.offlinePresenceStatus("configuration"), {
    hudStatus: "Offline / Missing Env",
    channelStatus: "offline",
    subscribeStatus: "offline"
  });
  assert.deepEqual(status.offlinePresenceStatus("load_failure"), {
    hudStatus: "Offline / Realtime Unavailable",
    channelStatus: "load_failed",
    subscribeStatus: "load_failed"
  });
});
