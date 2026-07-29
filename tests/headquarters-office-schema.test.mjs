import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

async function loadOfficeSchema() {
  const source = await readFile(new URL("../src/headquarters/officeSchema.ts", import.meta.url), "utf8");
  const javascript = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 }
  }).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(javascript).toString("base64")}#${Date.now()}`);
}

test("Headquarters office schema exposes stable IDs separately from display names", async () => {
  const { HEADQUARTERS_OFFICES } = await loadOfficeSchema();
  const identity = HEADQUARTERS_OFFICES.map(({ id, displayName }) => ({ id, displayName }));

  assert.deepEqual(identity, [
    { id: "reception", displayName: "Reception" },
    { id: "executive-office", displayName: "Executive Office" },
    { id: "chief-agent-office", displayName: "Chief Agent Office" },
    { id: "records-room", displayName: "Records Room" },
    { id: "finance", displayName: "Finance" },
    { id: "boardroom", displayName: "Boardroom" },
    { id: "small-meeting-room", displayName: "Small Meeting Room" },
    { id: "infrastructure", displayName: "Infrastructure" },
    { id: "reserved-departments", displayName: "Reserved Departments" }
  ]);
  assert.equal(new Set(identity.map(({ id }) => id)).size, identity.length);
  assert.ok(identity.every(({ id, displayName }) => id !== displayName));
});

test("office access uses only the five supported states, maps the visible slice truthfully, and gives a reason", async () => {
  const { HEADQUARTERS_ACCESS_STATES, HEADQUARTERS_OFFICES } = await loadOfficeSchema();

  assert.deepEqual(HEADQUARTERS_ACCESS_STATES, ["public", "tenant", "invited", "restricted", "unavailable"]);
  const supported = new Set(HEADQUARTERS_ACCESS_STATES);
  for (const office of HEADQUARTERS_OFFICES) {
    assert.ok(supported.has(office.access), `${office.id} has unsupported access ${office.access}`);
    assert.ok(office.accessReason.trim().length > 0, `${office.id} needs a truthful access reason`);
  }
  assert.deepEqual(Object.fromEntries(HEADQUARTERS_OFFICES.map(({ id, access }) => [id, access])), {
    reception: "public",
    "executive-office": "public",
    "chief-agent-office": "public",
    "records-room": "public",
    finance: "unavailable",
    boardroom: "public",
    "small-meeting-room": "unavailable",
    infrastructure: "unavailable",
    "reserved-departments": "unavailable"
  });
});

test("every office definition describes only the visible or reserved slice", async () => {
  const { HEADQUARTERS_OFFICES } = await loadOfficeSchema();
  assert.deepEqual(Object.fromEntries(HEADQUARTERS_OFFICES.map(({ id, definition }) => [id, definition])), {
    reception: "Visitor entry and wayfinding for the existing Headquarters interior.",
    "executive-office": "Existing office designated as the Executive Office; no occupancy is implied.",
    "chief-agent-office": "Existing office designation for the Chief Agent identity; no live agent or occupancy is implied.",
    "records-room": "Existing area containing the public Records Terminal.",
    finance: "Reserved department label only; no finance workspace or service is implemented.",
    boardroom: "Existing shared meeting space; no scheduling or meeting service is represented.",
    "small-meeting-room": "Reserved room definition; the room is not implemented.",
    infrastructure: "Reserved department label only; no infrastructure workspace or service is implemented.",
    "reserved-departments": "Placeholder for future department definitions; no rooms, departments, staffing, or capabilities are represented."
  });
});

test("environmental signs stay concise while directory access text remains explicit", async () => {
  const { HEADQUARTERS_OFFICES, officeAccessText, officeSignText } = await loadOfficeSchema();
  const signs = Object.fromEntries(HEADQUARTERS_OFFICES.map((office) => [office.id, officeSignText(office)]));
  const access = Object.fromEntries(HEADQUARTERS_OFFICES.map((office) => [office.id, officeAccessText(office)]));

  assert.equal(signs.reception, "Reception");
  assert.equal(signs["executive-office"], "Executive Office");
  assert.equal(signs.finance, "Finance · Reserved");
  assert.equal(signs["small-meeting-room"], "Small Meeting Room · Reserved");
  assert.equal(signs.infrastructure, "Infrastructure · Reserved");
  assert.equal(signs["reserved-departments"], "Reserved Departments · Reserved");
  assert.equal(access.reception, "Reception · Public");
  assert.equal(access["executive-office"], "Executive Office · Public");
  assert.equal(access.finance, "Finance · Reserved / Unavailable");
});

test("Headquarters scene projects schema-driven environmental room signage", async () => {
  const main = await readFile(new URL("../src/main.ts", import.meta.url), "utf8");

  assert.match(main, /import\s+\{[^}]*HEADQUARTERS_OFFICES[^}]*officeSignText[^}]*\}\s+from\s+["']\.\/headquarters\/officeSchema["']/s);
  assert.match(main, /const HEADQUARTERS_SIGN_POSITIONS:\s*Record<HeadquartersOfficeId,/);
  assert.match(main, /for \(const office of HEADQUARTERS_OFFICES\)/);
  assert.match(main, /createLabelSprite\(officeSignText\(office\),\s*768,\s*96,\s*64,\s*true\)/);
  assert.match(main, /roomSign\.scale\.set\(5\.2,\s*0\.9,\s*1\)/);
  assert.match(main, /roomSign\.userData\.officeId\s*=\s*office\.id/);
});

test("essential Headquarters labels meet the 1080p kiosk readability contract", async () => {
  const [main, css] = await Promise.all([
    readFile(new URL("../src/main.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/styles.css", import.meta.url), "utf8")
  ]);
  const projectedTextPixels = ({ fontSize, textureHeight, spriteHeight }) =>
    (fontSize / textureHeight) * spriteHeight * (1080 / 30);

  assert.ok(projectedTextPixels({ fontSize: 64, textureHeight: 96, spriteHeight: 0.9 }) >= 20);
  assert.match(main, /createLabelSprite\("STG Headquarters",\s*512,\s*128,\s*56,\s*true\)/);
  assert.match(main, /createLabelSprite\("Exit",\s*256,\s*96,\s*56,\s*true\)/);
  assert.match(main, /createLabelSprite\("You",\s*256,\s*96,\s*56,\s*true\)/);
  assert.match(css, /body\.city-entered \.operations-directory-access\s*\{[^}]*min-height:\s*56px[^}]*font-size:\s*22px[^}]*opacity:\s*1/s);
  const mobileDirectoryOverride = css.slice(css.lastIndexOf("@media (max-width: 520px)"));
  assert.match(mobileDirectoryOverride, /body\.city-entered \.operations-directory-access\s*\{[^}]*min-height:\s*56px/s);
});

test("nearby Headquarters interactions use one accessible non-overlapping DOM status", async () => {
  const [html, main, css] = await Promise.all([
    readFile(new URL("../index.html", import.meta.url), "utf8"),
    readFile(new URL("../src/main.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/styles.css", import.meta.url), "utf8")
  ]);
  const visibleExperience = html.slice(html.indexOf("<!-- End legacy interface -->"));

  assert.match(visibleExperience, /<p id="context-action-status" role="status" aria-live="polite" hidden><\/p>/);
  assert.match(main, /const contextActionStatus = document\.querySelector<HTMLElement>\("#context-action-status"\)!/);
  assert.match(main, /computeContextActionStatusState\(\{/);
  assert.match(main, /contextActionStatus\.hidden = contextStatusState\.hidden/);
  assert.match(main, /contextActionStatus\.textContent = contextStatusState\.text/);
  assert.match(main, /if \(action === "enter_headquarters"\) return "Enter STG Headquarters"/);
  assert.match(main, /if \(action === "leave_headquarters"\) return "Exit STG Headquarters"/);
  assert.doesNotMatch(main, /createLabelSprite\("Records Terminal"/);
  assert.doesNotMatch(main, /createLabelSprite\(fixture\.label/);
  assert.doesNotMatch(main, /contextualWorldLabels/);
  assert.match(css, /#context-action-status\s*\{[^}]*font-size:\s*18px/s);
  assert.match(main, /reception:\s*\{\s*x:\s*2\.8,\s*z:\s*6\.1\s*\}/);
  assert.match(main, /title\.position\.set\(0,\s*3\.6,\s*-9\.4\)/);
  assert.match(main, /exitSign\.position\.set\(0,\s*1\.2,\s*9\.1\)/);
});

test("Headquarters office directory is visible, semantic, and schema-driven", async () => {
  const [html, main, css] = await Promise.all([
    readFile(new URL("../index.html", import.meta.url), "utf8"),
    readFile(new URL("../src/main.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/styles.css", import.meta.url), "utf8")
  ]);
  const legacyEnd = html.indexOf("<!-- End legacy interface -->");
  const visibleExperience = html.slice(legacyEnd);

  assert.match(visibleExperience, /<button id="operations-directory-access"[^>]*>Headquarters Office Directory<\/button>/);
  assert.match(visibleExperience, /<dialog id="operations-directory-dialog"[^>]*aria-labelledby="operations-directory-title"/);
  assert.match(visibleExperience, /<h2 id="operations-directory-title">Headquarters Office Directory<\/h2>/);
  assert.match(visibleExperience, /<section id="headquarters-office-directory"[^>]*aria-labelledby="headquarters-office-directory-title"[^>]*aria-describedby="headquarters-office-directory-note"/);
  assert.match(visibleExperience, /<ul id="headquarters-office-directory-list"><\/ul>/);
  assert.match(main, /function renderHeadquartersOfficeDirectory\(\): void/);
  assert.match(main, /for \(const office of HEADQUARTERS_OFFICES\)/);
  assert.match(main, /directoryItem\.dataset\.officeId\s*=\s*office\.id/);
  assert.match(main, /directoryAccess\.textContent\s*=\s*officeAccessText\(office\)/);
  assert.match(main, /directoryDetail\.textContent\s*=\s*`\$\{office\.definition\} Access reason: \$\{office\.accessReason\}`/);
  assert.doesNotMatch(main, /headquartersOfficeDirectoryList\.innerHTML/);
  assert.match(visibleExperience, /Only the Observed Public Record section mirrors validated public record data already observed through the contextual Records Terminal\./);
  assert.doesNotMatch(visibleExperience, /This directory mirrors only validated public record data/);
  assert.match(css, /#headquarters-office-directory-list\s*\{[^}]*display:\s*grid/s);
});
