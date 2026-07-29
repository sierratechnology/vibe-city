import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const toolsDir = path.dirname(fileURLToPath(import.meta.url));

const makePacket = () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "vibe-design-tools-test-"));
  const packet = path.join(root, "packet");
  for (const name of ["source", "exports", "previews"]) fs.mkdirSync(path.join(packet, name), { recursive: true });
  fs.writeFileSync(path.join(packet, "BRIEF.md"), "# Test packet\n");
  fs.writeFileSync(path.join(packet, "VALIDATION.md"), "# Test validation\n");
  fs.writeFileSync(
    path.join(packet, "source", "test-sign.svg"),
    '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="50" viewBox="0 0 100 50" role="img" aria-label="Test sign"><title>Test sign</title><desc>A safe test sign.</desc><defs><linearGradient id="safe"><stop offset="0" stop-color="#111820"/><stop offset="1" stop-color="#223040"/></linearGradient></defs><rect width="100" height="50" fill="url(#safe)"/></svg>\n'
  );
  fs.writeFileSync(
    path.join(packet, "manifest.json"),
    JSON.stringify({
      packetId: "test-packet",
      version: "0.0.0",
      status: "verified",
      license: "Test only",
      provenance: "Original deterministic test fixture.",
      assets: [
        {
          id: "test-sign",
          source: "source/test-sign.svg",
          export: "exports/test-sign.svg",
          preview: "previews/test-sign.png",
          dimensions: { width: 100, height: 50, unit: "px", viewBox: "0 0 100 50" },
          previewWidth: 100
        }
      ],
      validation: ["test"]
    }, null, 2)
  );
  return { root, packet };
};

const runTool = (script, packet) => spawnSync(process.execPath, [path.join(toolsDir, script), packet], { encoding: "utf8" });
const parseValidation = (result) => JSON.parse(result.stdout);

test("normal packet exports and validates", () => {
  const { root, packet } = makePacket();
  try {
    const exported = runTool("export-packet.mjs", packet);
    assert.equal(exported.status, 0, exported.stderr);
    const validated = runTool("validate-packet.mjs", packet);
    assert.equal(validated.status, 0, validated.stdout + validated.stderr);
    assert.deepEqual(parseValidation(validated).errors, []);
    assert.deepEqual(parseValidation(validated).warnings, []);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("export rejects a symbolic-link output directory", () => {
  const { root, packet } = makePacket();
  const outside = path.join(root, "outside");
  fs.mkdirSync(outside);
  fs.rmSync(path.join(packet, "exports"), { recursive: true, force: true });
  fs.symlinkSync(outside, path.join(packet, "exports"), "dir");
  try {
    const exported = runTool("export-packet.mjs", packet);
    assert.notEqual(exported.status, 0);
    assert.match(exported.stderr, /symbolic-link path component/);
    assert.deepEqual(fs.readdirSync(outside), []);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("export and validator reject a symbolic-link source file", () => {
  const { root, packet } = makePacket();
  const outsideSource = path.join(root, "outside.svg");
  fs.renameSync(path.join(packet, "source", "test-sign.svg"), outsideSource);
  fs.symlinkSync(outsideSource, path.join(packet, "source", "test-sign.svg"));
  try {
    const exported = runTool("export-packet.mjs", packet);
    assert.notEqual(exported.status, 0);
    assert.match(exported.stderr, /symbolic-link path component/);
    const validated = runTool("validate-packet.mjs", packet);
    assert.notEqual(validated.status, 0);
    assert.ok(parseValidation(validated).errors.some((error) => error.includes("symbolic")));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("export and validator reject a dangling output symlink", () => {
  const { root, packet } = makePacket();
  const outside = path.join(root, "outside.svg");
  fs.symlinkSync(outside, path.join(packet, "exports", "test-sign.svg"));
  try {
    const exported = runTool("export-packet.mjs", packet);
    assert.notEqual(exported.status, 0);
    assert.match(exported.stderr, /symbolic-link path component/);
    assert.equal(fs.existsSync(outside), false);
    const validated = runTool("validate-packet.mjs", packet);
    assert.notEqual(validated.status, 0);
    assert.ok(parseValidation(validated).errors.some((error) => error.includes("symbolic")));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("export and validator reject a symbolic-link source directory", () => {
  const { root, packet } = makePacket();
  const outsideSourceDir = path.join(root, "outside-source");
  fs.renameSync(path.join(packet, "source"), outsideSourceDir);
  fs.symlinkSync(outsideSourceDir, path.join(packet, "source"), "dir");
  try {
    const exported = runTool("export-packet.mjs", packet);
    assert.notEqual(exported.status, 0);
    assert.match(exported.stderr, /symbolic-link path component/);
    const validated = runTool("validate-packet.mjs", packet);
    assert.notEqual(validated.status, 0);
    assert.ok(parseValidation(validated).errors.some((error) => error.includes("symbolic")));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("export and validator reject active animation and xml:base", () => {
  const payloads = [
    '<animate href="#safe" attributeName="href" to="https://example.invalid/payload.svg" dur="1s"/>',
    '<animateColor attributeName="fill" values="red;blue" dur="1s"/>',
    '<g xml:base="https://example.invalid/"><use href="#safe"/></g>',
    '<s:script xmlns:s="http://www.w3.org/2000/svg">alert(1)</s:script>',
    '<rect width="10" height="10" style="fill:url(https://example.invalid/a.svg)"/>',
    '<rect width="10" height="10" fill="u\\72l(https://example.invalid/a.svg)"/>',
    '<rect width="10" height="10" marker="url(https://example.invalid/a.svg)"/>',
    '<rect width="10" height="10" offset-path="url(https://example.invalid/a.svg)"/>',
    '<rect width="10" height="10" shape-inside="url(https://example.invalid/a.svg)"/>',
    '<rect width="10" height="10" background-image="url(https://example.invalid/a.svg)"/>',
    '<rect width="10" height="10" list-style-image="url(https://example.invalid/a.svg)"/>',
    '<rect width="10" height="10" marker="var(--external-resource)"/>'
  ];
  for (const payload of payloads) {
    const { root, packet } = makePacket();
    const svgPath = path.join(packet, "source", "test-sign.svg");
    fs.writeFileSync(svgPath, fs.readFileSync(svgPath, "utf8").replace("</svg>", `${payload}</svg>`));
    try {
      const exported = runTool("export-packet.mjs", packet);
      assert.notEqual(exported.status, 0);
      assert.match(exported.stderr, /forbidden .* element|xml:base attributes are forbidden|style attributes are forbidden|obfuscated CSS resource syntax is forbidden|dynamic CSS value syntax is forbidden|only local fragment url/);
      const validated = runTool("validate-packet.mjs", packet);
      assert.notEqual(validated.status, 0);
      assert.ok(parseValidation(validated).errors.some((error) => /forbidden .* element|xml:base attributes are forbidden|style attributes are forbidden|obfuscated CSS resource syntax is forbidden|dynamic CSS value syntax is forbidden|only local fragment url/.test(error)));
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  }
});

test("export and validator require accessibility metadata on the SVG root", () => {
  const { root, packet } = makePacket();
  const svgPath = path.join(packet, "source", "test-sign.svg");
  const source = fs.readFileSync(svgPath, "utf8")
    .replace(/\srole="img"/, "")
    .replace(/\saria-label="[^"]*"/, "")
    .replace("</svg>", '<g role="img" aria-label="child-only"><title>Child title</title><desc>Child description</desc></g></svg>');
  fs.writeFileSync(svgPath, source);
  try {
    const exported = runTool("export-packet.mjs", packet);
    assert.notEqual(exported.status, 0);
    assert.match(exported.stderr, /root is missing role=img|root is missing an accessible name/);
    const validated = runTool("validate-packet.mjs", packet);
    assert.notEqual(validated.status, 0);
    const report = parseValidation(validated);
    assert.ok(report.errors.some((error) => error.includes("root is missing role=img")));
    assert.ok(report.errors.some((error) => error.includes("root is missing an accessible name")));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("export and validator reject foreign-namespace accessibility metadata", () => {
  const { root, packet } = makePacket();
  const svgPath = path.join(packet, "source", "test-sign.svg");
  const source = fs.readFileSync(svgPath, "utf8")
    .replace('<svg xmlns="http://www.w3.org/2000/svg"', '<svg xmlns="http://www.w3.org/2000/svg" xmlns:x="urn:not-svg"')
    .replace("<title>", "<x:title>")
    .replace("</title>", "</x:title>")
    .replace("<desc>", "<x:desc>")
    .replace("</desc>", "</x:desc>");
  fs.writeFileSync(svgPath, source);
  try {
    const exported = runTool("export-packet.mjs", packet);
    assert.notEqual(exported.status, 0);
    assert.match(exported.stderr, /root is missing a direct title child|root is missing a direct desc child/);
    const validated = runTool("validate-packet.mjs", packet);
    assert.notEqual(validated.status, 0);
    const report = parseValidation(validated);
    assert.ok(report.errors.some((error) => error.includes("root is missing a direct title child")));
    assert.ok(report.errors.some((error) => error.includes("root is missing a direct desc child")));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("export and validator reject hard-linked packet assets", () => {
  for (const relativePath of ["source/test-sign.svg", "exports/test-sign.svg", "previews/test-sign.png"]) {
    const { root, packet } = makePacket();
    assert.equal(runTool("export-packet.mjs", packet).status, 0);
    const target = path.join(packet, relativePath);
    const outside = path.join(root, `outside${path.extname(relativePath)}`);
    fs.copyFileSync(target, outside);
    fs.rmSync(target);
    fs.linkSync(outside, target);
    try {
      const exported = runTool("export-packet.mjs", packet);
      assert.notEqual(exported.status, 0, relativePath);
      assert.match(exported.stderr, /private regular file/, relativePath);
      const validated = runTool("validate-packet.mjs", packet);
      assert.notEqual(validated.status, 0, relativePath);
      assert.ok(parseValidation(validated).errors.some((error) => error.includes("hard-linked file")), relativePath);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  }
});

test("malformed SVG fails closed and validator still returns JSON", () => {
  const { root, packet } = makePacket();
  const svgPath = path.join(packet, "source", "test-sign.svg");
  fs.writeFileSync(svgPath, fs.readFileSync(svgPath, "utf8").replace("</svg>", ""));
  try {
    const exported = runTool("export-packet.mjs", packet);
    assert.notEqual(exported.status, 0);
    assert.match(exported.stderr, /XML parse failed/);
    const validated = runTool("validate-packet.mjs", packet);
    assert.notEqual(validated.status, 0);
    const report = parseValidation(validated);
    assert.ok(report.errors.some((error) => error.includes("XML parse failed")));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("export and validator reject non-fragment SVG resources", () => {
  const { root, packet } = makePacket();
  const svgPath = path.join(packet, "source", "test-sign.svg");
  fs.writeFileSync(svgPath, '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="50" viewBox="0 0 100 50" role="img" aria-label="Unsafe test"><title>Unsafe test</title><desc>Unsafe relative image.</desc><image href="../outside.png" width="100" height="50"/></svg>\n');
  try {
    const exported = runTool("export-packet.mjs", packet);
    assert.notEqual(exported.status, 0);
    assert.match(exported.stderr, /forbidden image element|forbidden non-fragment href/);
    const validated = runTool("validate-packet.mjs", packet);
    assert.notEqual(validated.status, 0);
    assert.ok(parseValidation(validated).errors.some((error) => error.includes("forbidden image element") || error.includes("forbidden non-fragment href")));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("validator rejects a stale preview", () => {
  const { root, packet } = makePacket();
  try {
    assert.equal(runTool("export-packet.mjs", packet).status, 0);
    const previewPath = path.join(packet, "previews", "test-sign.png");
    const preview = fs.readFileSync(previewPath);
    preview[preview.length - 1] ^= 1;
    fs.writeFileSync(previewPath, preview);
    const validated = runTool("validate-packet.mjs", packet);
    assert.notEqual(validated.status, 0);
    assert.ok(parseValidation(validated).errors.some((error) => error.includes("preview does not exactly match rendered export")));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("validator rejects a stale export", () => {
  const { root, packet } = makePacket();
  try {
    assert.equal(runTool("export-packet.mjs", packet).status, 0);
    fs.appendFileSync(path.join(packet, "exports", "test-sign.svg"), "\n");
    const validated = runTool("validate-packet.mjs", packet);
    assert.notEqual(validated.status, 0);
    assert.ok(parseValidation(validated).errors.some((error) => error.includes("export does not exactly match optimized source")));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("validator rejects manifest traversal", () => {
  const { root, packet } = makePacket();
  const manifestPath = path.join(packet, "manifest.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  manifest.assets[0].export = "../escaped.svg";
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  try {
    const validated = runTool("validate-packet.mjs", packet);
    assert.notEqual(validated.status, 0);
    assert.ok(parseValidation(validated).errors.some((error) => error.includes("escapes packet directory")));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("export and validator reject duplicate manifest paths", () => {
  const { root, packet } = makePacket();
  const manifestPath = path.join(packet, "manifest.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  manifest.assets.push({ ...manifest.assets[0], id: "duplicate-sign" });
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  try {
    const exported = runTool("export-packet.mjs", packet);
    assert.notEqual(exported.status, 0);
    assert.match(exported.stderr, /duplicate source path/);
    const validated = runTool("validate-packet.mjs", packet);
    assert.notEqual(validated.status, 0);
    assert.ok(parseValidation(validated).errors.some((error) => error.includes("duplicate source path")));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("validator rejects unmanifested export and preview files", () => {
  const { root, packet } = makePacket();
  try {
    assert.equal(runTool("export-packet.mjs", packet).status, 0);
    fs.writeFileSync(path.join(packet, "exports", "extra.svg"), "<svg/>");
    fs.copyFileSync(path.join(packet, "previews", "test-sign.png"), path.join(packet, "previews", "extra.png"));
    const validated = runTool("validate-packet.mjs", packet);
    assert.notEqual(validated.status, 0);
    const report = parseValidation(validated);
    assert.ok(report.errors.some((error) => error.includes("export/extra.svg is not represented in manifest")));
    assert.ok(report.errors.some((error) => error.includes("preview/extra.png is not represented in manifest")));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
