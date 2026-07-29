import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { Resvg } from "@resvg/resvg-js";
import { optimize } from "svgo";
import { assertSafeSvg } from "./svg-safety.mjs";

const packetArg = process.argv[2];
if (!packetArg) {
  console.error("usage: npm run export -- <packet-directory>");
  process.exit(2);
}

const requestedPacketDir = path.resolve(packetArg);
const packetStat = fs.lstatSync(requestedPacketDir);
if (!packetStat.isDirectory()) throw new Error("packet path must be a directory");
const packetDir = fs.realpathSync(requestedPacketDir);
const exported = [];

const lstatOrNull = (target) => {
  try {
    return fs.lstatSync(target);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
};

const assertSafePacketPath = (target, label) => {
  const relative = path.relative(packetDir, target);
  if (!relative || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error(`${label} escapes packet directory: ${target}`);
  }
  let current = packetDir;
  for (const component of relative.split(path.sep)) {
    current = path.join(current, component);
    const stat = lstatOrNull(current);
    if (stat?.isSymbolicLink()) throw new Error(`${label} contains a symbolic-link path component: ${current}`);
  }
};

const assertFlatAssetPath = (relativePath, directory, extension, label) => {
  if (typeof relativePath !== "string") throw new Error(`${label} path must be a string`);
  const normalized = path.normalize(relativePath);
  const expectedDirectory = `${directory}${path.sep}`;
  if (!normalized.startsWith(expectedDirectory) || path.dirname(normalized) !== directory || path.extname(normalized) !== extension) {
    throw new Error(`${label} must be a flat ${extension} path under ${directory}/`);
  }
};

const atomicWrite = (target, data, encoding) => {
  assertSafePacketPath(target, "output");
  const parent = path.dirname(target);
  fs.mkdirSync(parent, { recursive: true });
  assertSafePacketPath(parent, "output directory");
  const existing = lstatOrNull(target);
  if (existing?.isSymbolicLink()) throw new Error(`output contains a symbolic-link path component: ${target}`);
  if (existing && (!existing.isFile() || existing.nlink > 1)) throw new Error(`output target is not a private regular file: ${target}`);
  const temporary = path.join(parent, `.${path.basename(target)}.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`);
  assertSafePacketPath(temporary, "temporary output");
  try {
    fs.writeFileSync(temporary, data, { encoding, flag: "wx", mode: 0o600 });
    fs.renameSync(temporary, target);
  } finally {
    try {
      fs.unlinkSync(temporary);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
};

const manifestPath = path.join(packetDir, "manifest.json");
assertSafePacketPath(manifestPath, "manifest");
const manifestStat = lstatOrNull(manifestPath);
if (!manifestStat?.isFile() || manifestStat.nlink > 1) throw new Error("manifest.json must be a private regular file");
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
if (!Array.isArray(manifest.assets) || manifest.assets.length === 0) throw new Error("manifest assets must be a non-empty array");

const seenIds = new Set();
const seenPaths = { source: new Set(), export: new Set(), preview: new Set() };
for (const asset of manifest.assets) {
  if (!asset || typeof asset.id !== "string" || !asset.id) throw new Error("every asset requires a non-empty id");
  if (seenIds.has(asset.id)) throw new Error(`duplicate asset id: ${asset.id}`);
  seenIds.add(asset.id);
  for (const key of ["source", "export", "preview"]) {
    if (seenPaths[key].has(asset[key])) throw new Error(`${asset.id}: duplicate ${key} path: ${asset[key]}`);
    seenPaths[key].add(asset[key]);
  }
  assertFlatAssetPath(asset.source, "source", ".svg", `${asset.id}: source`);
  assertFlatAssetPath(asset.export, "exports", ".svg", `${asset.id}: export`);
  assertFlatAssetPath(asset.preview, "previews", ".png", `${asset.id}: preview`);

  const sourcePath = path.resolve(packetDir, asset.source);
  const exportPath = path.resolve(packetDir, asset.export);
  const previewPath = path.resolve(packetDir, asset.preview);
  assertSafePacketPath(sourcePath, `${asset.id}: source`);
  assertSafePacketPath(exportPath, `${asset.id}: export`);
  assertSafePacketPath(previewPath, `${asset.id}: preview`);
  const sourceStat = lstatOrNull(sourcePath);
  if (!sourceStat?.isFile() || sourceStat.nlink > 1) throw new Error(`${asset.id}: source must be a private regular file`);

  const source = fs.readFileSync(sourcePath, "utf8");
  assertSafeSvg(source, `${asset.id}: source`, { requireAccessibleRoot: true });

  const result = optimize(source, {
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
  });

  const previewWidth = Number(asset.previewWidth);
  if (!Number.isFinite(previewWidth) || previewWidth <= 0) throw new Error(`${asset.id}: previewWidth must be a positive finite number`);
  const renderer = new Resvg(result.data, { fitTo: { mode: "width", value: previewWidth } });
  const rendered = renderer.render();
  const png = rendered.asPng();

  atomicWrite(exportPath, result.data, "utf8");
  atomicWrite(previewPath, png);
  exported.push({
    id: asset.id,
    export: path.relative(packetDir, exportPath),
    preview: path.relative(packetDir, previewPath),
    width: rendered.width,
    height: rendered.height,
    pngBytes: png.length
  });
}

console.log(JSON.stringify({ packet: packetDir, exported }, null, 2));
