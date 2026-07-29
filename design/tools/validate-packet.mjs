import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { Resvg } from "@resvg/resvg-js";
import { optimize } from "svgo";
import { inspectSvgSafety } from "./svg-safety.mjs";

const packetArg = process.argv[2];
if (!packetArg) {
  console.error("usage: npm run validate -- <packet-directory>");
  process.exit(2);
}

const requestedPacketDir = path.resolve(packetArg);
const errors = [];
const warnings = [];
const statuses = new Set(["produced", "verified", "integration-ready", "integrated", "released"]);

let packetDir;
try {
  const packetStat = fs.lstatSync(requestedPacketDir);
  if (!packetStat.isDirectory()) throw new Error("packet path must be a directory");
  packetDir = fs.realpathSync(requestedPacketDir);
} catch (error) {
  console.log(JSON.stringify({ packet: requestedPacketDir, svgCount: 0, errors: [`packet directory is unavailable: ${error.message}`], warnings }, null, 2));
  process.exit(1);
}

const lstatOrNull = (target) => {
  try {
    return fs.lstatSync(target);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
};

const resolveInsidePacket = (relativePath, label) => {
  if (typeof relativePath !== "string") {
    errors.push(`${label} path must be a string`);
    return null;
  }
  const target = path.resolve(packetDir, relativePath);
  const relative = path.relative(packetDir, target);
  if (!relative || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    errors.push(`${label} escapes packet directory`);
    return null;
  }
  let current = packetDir;
  for (const component of relative.split(path.sep)) {
    current = path.join(current, component);
    const stat = lstatOrNull(current);
    if (stat?.isSymbolicLink()) {
      errors.push(`${label} contains a symbolic-link path component`);
      return null;
    }
  }
  const finalStat = lstatOrNull(target);
  if (finalStat?.isFile() && finalStat.nlink > 1) {
    errors.push(`${label} is a hard-linked file`);
    return null;
  }
  return target;
};
const resolveRequiredPath = (name, expectedType) => {
  const target = resolveInsidePacket(name, name);
  if (!target) return null;
  const stat = lstatOrNull(target);
  if (!stat) {
    errors.push(`missing required path: ${name}`);
    return null;
  }
  if (expectedType === "file" && !stat.isFile()) errors.push(`${name} must be a regular file`);
  if (expectedType === "directory" && !stat.isDirectory()) errors.push(`${name} must be a directory`);
  return target;
};

const assertFlatAssetPath = (relativePath, directory, extension, label) => {
  if (typeof relativePath !== "string") {
    errors.push(`${label} path must be a string`);
    return false;
  }
  const normalized = path.normalize(relativePath);
  const valid = normalized.startsWith(`${directory}${path.sep}`)
    && path.dirname(normalized) === directory
    && path.extname(normalized) === extension;
  if (!valid) errors.push(`${label} must be a flat ${extension} path under ${directory}/`);
  return valid;
};

const optimizeSvg = (source) => optimize(source, {
  multipass: true,
  plugins: [
    {
      name: "preset-default",
      params: {
        overrides: {
          removeDesc: false,
          removeUnknownsAndDefaults: false
        }
      }
    }
  ]
}).data;

const inspectSvg = (svg, label, requireAccessibleRoot = false) => {
  const issues = inspectSvgSafety(svg, label, { requireAccessibleRoot });
  errors.push(...issues);
  return issues.length === 0;
};

const listFlatFiles = (directoryPath, label, extension) => {
  if (!directoryPath || !lstatOrNull(directoryPath)?.isDirectory()) return [];
  const files = [];
  for (const entry of fs.readdirSync(directoryPath, { withFileTypes: true })) {
    const target = path.join(directoryPath, entry.name);
    const stat = lstatOrNull(target);
    if (stat?.isSymbolicLink()) {
      errors.push(`${label}/${entry.name} is a symbolic link`);
      continue;
    }
    if (!entry.isFile()) {
      errors.push(`${label}/${entry.name} must be a regular file`);
      continue;
    }
    if (path.extname(entry.name) !== extension) {
      errors.push(`${label}/${entry.name} has an unsupported extension`);
      continue;
    }
    files.push(entry.name);
  }
  return files.sort();
};

resolveRequiredPath("BRIEF.md", "file");
const manifestPath = resolveRequiredPath("manifest.json", "file");
resolveRequiredPath("VALIDATION.md", "file");
const sourceDir = resolveRequiredPath("source", "directory");
const exportDir = resolveRequiredPath("exports", "directory");
const previewDir = resolveRequiredPath("previews", "directory");

let manifest;
if (manifestPath && lstatOrNull(manifestPath)?.isFile()) {
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  } catch (error) {
    errors.push(`manifest.json is not valid JSON: ${error.message}`);
  }
}

const requiredManifestFields = ["packetId", "version", "status", "license", "provenance", "assets", "validation"];
if (manifest) {
  for (const field of requiredManifestFields) {
    if (!(field in manifest)) errors.push(`manifest missing field: ${field}`);
  }
  if (!statuses.has(manifest.status)) errors.push(`manifest status is not recognized: ${manifest.status}`);
  if (!Array.isArray(manifest.assets) || manifest.assets.length === 0) errors.push("manifest assets must be a non-empty array");
  if (!Array.isArray(manifest.validation) || manifest.validation.length === 0) errors.push("manifest validation must be a non-empty array");
}

const svgFiles = listFlatFiles(sourceDir, "source", ".svg");
const exportFiles = listFlatFiles(exportDir, "exports", ".svg");
const previewFiles = listFlatFiles(previewDir, "previews", ".png");
if (svgFiles.length === 0) errors.push("source directory contains no SVG files");

if (Array.isArray(manifest?.assets)) {
  const ids = new Set();
  const expectedFiles = { source: new Set(), export: new Set(), preview: new Set() };

  for (const asset of manifest.assets) {
    if (!asset || !asset.id || !asset.source || !asset.export || !asset.preview || !asset.dimensions) {
      errors.push("each manifest asset requires id, source, export, preview, and dimensions");
      continue;
    }
    if (ids.has(asset.id)) errors.push(`duplicate asset id: ${asset.id}`);
    ids.add(asset.id);

    const pathSpec = {
      source: ["source", ".svg"],
      export: ["exports", ".svg"],
      preview: ["previews", ".png"]
    };
    const resolved = {};
    for (const key of ["source", "export", "preview"]) {
      const [directory, extension] = pathSpec[key];
      if (assertFlatAssetPath(asset[key], directory, extension, `${asset.id}: ${key}`)) {
        const basename = path.basename(asset[key]);
        if (expectedFiles[key].has(basename)) errors.push(`${asset.id}: duplicate ${key} path: ${asset[key]}`);
        expectedFiles[key].add(basename);
      }
      const target = resolveInsidePacket(asset[key], `${asset.id}: ${key}`);
      resolved[key] = target;
      if (target && !lstatOrNull(target)) errors.push(`${asset.id}: missing required ${key}: ${asset[key]}`);
    }

    const width = Number(asset.dimensions.width);
    const height = Number(asset.dimensions.height);
    const previewWidth = Number(asset.previewWidth);
    if (!Number.isFinite(width) || width <= 0 || !Number.isFinite(height) || height <= 0) {
      errors.push(`${asset.id}: dimensions must be positive finite numbers`);
    }
    if (!Number.isFinite(previewWidth) || previewWidth <= 0) errors.push(`${asset.id}: previewWidth must be a positive finite number`);

    let source;
    let sourceIsSafe = false;
    let exportedSvg;
    let exportIsSafe = false;
    if (resolved.source && lstatOrNull(resolved.source)?.isFile()) {
      source = fs.readFileSync(resolved.source, "utf8");
      sourceIsSafe = inspectSvg(source, `${asset.id}: source`, true);
      const viewBox = source.match(/\bviewBox\s*=\s*["']([^"']+)["']/i)?.[1]?.trim().replace(/\s+/g, " ");
      const manifestViewBox = String(asset.dimensions.viewBox ?? "").trim().replace(/\s+/g, " ");
      if (!viewBox || viewBox !== manifestViewBox) errors.push(`${asset.id}: source viewBox does not match manifest dimensions.viewBox`);
      const expectedViewBox = `0 0 ${width} ${height}`;
      if (manifestViewBox !== expectedViewBox) errors.push(`${asset.id}: manifest viewBox must equal ${expectedViewBox}`);
      try {
        const rendered = new Resvg(source, { fitTo: { mode: "width", value: 1024 } }).render();
        if (rendered.width <= 0 || rendered.height <= 0 || rendered.asPng().length === 0) errors.push(`${asset.id}: source renderer produced an empty result`);
      } catch (error) {
        errors.push(`${asset.id}: source SVG render failed: ${error.message}`);
      }
    }

    if (resolved.export && lstatOrNull(resolved.export)?.isFile()) {
      exportedSvg = fs.readFileSync(resolved.export, "utf8");
      exportIsSafe = inspectSvg(exportedSvg, `${asset.id}: export`, true);
      if (source && sourceIsSafe && exportIsSafe) {
        try {
          if (exportedSvg !== optimizeSvg(source)) errors.push(`${asset.id}: export does not exactly match optimized source`);
        } catch (error) {
          errors.push(`${asset.id}: source optimization failed: ${error.message}`);
        }
      }
    }

    if (resolved.preview && lstatOrNull(resolved.preview)?.isFile()) {
      const png = fs.readFileSync(resolved.preview);
      const signature = png.subarray(0, 8).toString("hex");
      if (signature !== "89504e470d0a1a0a" || png.length < 24) {
        errors.push(`${asset.id}: preview is not a valid PNG header`);
      } else {
        const actualWidth = png.readUInt32BE(16);
        const actualHeight = png.readUInt32BE(20);
        const expectedHeight = Math.round((previewWidth * height) / width);
        if (actualWidth !== previewWidth || actualHeight !== expectedHeight) {
          errors.push(`${asset.id}: preview dimensions ${actualWidth}x${actualHeight} do not match expected ${previewWidth}x${expectedHeight}`);
        }
        if (exportedSvg && exportIsSafe && Number.isFinite(previewWidth) && previewWidth > 0) {
          const expectedPng = new Resvg(exportedSvg, { fitTo: { mode: "width", value: previewWidth } }).render().asPng();
          if (!png.equals(expectedPng)) errors.push(`${asset.id}: preview does not exactly match rendered export`);
        }
      }
    }
  }

  const parityChecks = [
    ["source", svgFiles],
    ["export", exportFiles],
    ["preview", previewFiles]
  ];
  for (const [key, actualFiles] of parityChecks) {
    const expected = expectedFiles[key];
    for (const file of actualFiles) if (!expected.has(file)) errors.push(`${key}/${file} is not represented in manifest`);
    for (const file of expected) if (!actualFiles.includes(file)) errors.push(`${key}/${file} is listed in manifest but missing from packet`);
  }
}

const result = { packet: packetDir, svgCount: svgFiles.length, errors, warnings };
console.log(JSON.stringify(result, null, 2));
process.exit(errors.length === 0 ? 0 : 1);
