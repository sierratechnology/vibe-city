import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";

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
  const presence = await readFile(new URL("src/multiplayer/presence.ts", projectRoot), "utf8");
  assert.match(presence, /const LEGACY_WIRE_HEADQUARTERS_SCENE = \["apart", "ment"\]\.join\(""\)/);
  assert.match(presence, /currentSceneV2\?: PresenceScene/);
  assert.match(presence, /normalizePresenceScene\(latest\.currentSceneV2 \?\? latest\.currentScene\)/);
  assert.match(presence, /currentSceneV2: publicPayload\.currentScene/);
});
