import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

function staticClosure(manifest, key, seen = new Set()) {
  if (seen.has(key)) return seen;
  seen.add(key);
  for (const dependency of manifest[key]?.imports ?? []) staticClosure(manifest, dependency, seen);
  return seen;
}

test("offline production entry lazy-loads realtime instead of shipping Supabase initially", () => {
  const outDir = mkdtempSync(join(tmpdir(), "vibe-offline-bundle-"));
  try {
    const env = { ...process.env, VITE_SUPABASE_URL: "", VITE_SUPABASE_ANON_KEY: "" };
    execFileSync("npm", ["run", "build", "--", "--manifest", "--outDir", outDir, "--emptyOutDir"], {
      cwd: new URL("../", import.meta.url),
      env,
      stdio: "pipe"
    });
    const manifest = JSON.parse(readFileSync(join(outDir, ".vite", "manifest.json"), "utf8"));
    const entryKey = Object.keys(manifest).find((key) => manifest[key].isEntry);
    assert.ok(entryKey, "Vite manifest must contain an entry chunk");

    const dynamicImports = manifest[entryKey].dynamicImports ?? [];
    assert.ok(dynamicImports.some((key) => key.includes("realtimePresence")), "realtime must be a dynamic import");

    const initialJavaScript = [...staticClosure(manifest, entryKey)]
      .map((key) => readFileSync(join(outDir, manifest[key].file), "utf8"))
      .join("\n");
    assert.doesNotMatch(initialJavaScript, /STG World Zero Supabase client created/);
  } finally {
    rmSync(outDir, { recursive: true, force: true });
  }
});
