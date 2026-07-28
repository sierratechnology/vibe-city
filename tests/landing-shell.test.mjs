import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [html, css, main, packageJson] = await Promise.all([
  readFile(new URL("../index.html", import.meta.url), "utf8"),
  readFile(new URL("../src/styles.css", import.meta.url), "utf8"),
  readFile(new URL("../src/main.ts", import.meta.url), "utf8"),
  readFile(new URL("../package.json", import.meta.url), "utf8")
]);

function between(source, start, end) {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  assert.notEqual(startIndex, -1, `missing boundary: ${start}`);
  assert.notEqual(endIndex, -1, `missing boundary: ${end}`);
  return source.slice(startIndex, endIndex);
}

test("landing is a single-CTA, accessible World Zero first screen", () => {
  const landing = between(html, '<section id="landing-shell"', "<!-- End landing shell -->");
  assert.match(landing, /aria-labelledby="landing-title"/);
  assert.match(landing, /<h1 id="landing-title">Vibe City<\/h1>/i);
  assert.match(landing, /<button id="enter-world"[^>]*>\s*Enter World Zero\s*<\/button>/i);
  assert.equal((landing.match(/<button\b/g) ?? []).length, 1, "landing must have one CTA");
  assert.doesNotMatch(landing, /agent|operations|voice/i, "landing copy must not imply unavailable systems");
  assert.match(css, /#landing-shell\s*\{[^}]*position:\s*fixed[^}]*inset:\s*0/s);
  assert.match(css, /#landing-shell\s*\{[^}]*text-transform:\s*uppercase/s);
  assert.doesNotMatch(css, /@import|https?:\/\//i, "styles must not load external fonts or assets");
});

test("all legacy GUI is contained by one hidden inert compatibility wrapper", () => {
  const legacy = between(html, '<div id="legacy-interface"', "<!-- End legacy interface -->");
  assert.match(legacy, /^<div id="legacy-interface"[^>]*\bhidden\b[^>]*\binert\b[^>]*aria-hidden="true"/);
  for (const id of [
    "hud",
    "ops-panel",
    "action-prompt",
    "voice-panel",
    "briefing-panel",
    "interaction-popup",
    "knowledge-journal",
    "phone-panel",
    "voice-settings-panel",
    "home-panel",
    "toast-message",
    "character-modal",
    "dev-tools"
  ]) {
    assert.match(legacy, new RegExp(`id=["']${id}["']`), `${id} must be in legacy wrapper`);
    const outsideLegacy = html.slice(0, html.indexOf('<div id="legacy-interface"')) + html.slice(html.indexOf("<!-- End legacy interface -->"));
    assert.doesNotMatch(outsideLegacy, new RegExp(`id=["']${id}["']`), `${id} must not exist outside legacy wrapper`);
  }
  assert.match(css, /#legacy-interface\s*\{[^}]*display:\s*none\s*!important/s);
});

test("desktop is canvas-only after entry and mobile controls are entry-gated", () => {
  const touch = between(html, '<section id="touch-controls"', "<!-- End touch controls -->");
  assert.match(touch, /id="touch-joystick"/);
  assert.match(touch, /<button id="touch-action"[^>]*\bhidden\b[^>]*\bdisabled\b[^>]*>Action<\/button>/);
  assert.doesNotMatch(touch, /touch-phone|touch-debug|>\s*(Phone|Debug)\s*</i);

  assert.match(css, /#touch-controls\s*\{[^}]*display:\s*none/s);
  assert.match(css, /body:not\(\.city-entered\)\s+#touch-controls\s*\{[^}]*display:\s*none\s*!important/s);
  assert.match(css, /@media\s*\([^}]*pointer:\s*coarse[^}]*\)[\s\S]*?body\.city-entered\s+#touch-controls\.visible\s*\{[^}]*display:\s*block\s*!important/s);
  assert.doesNotMatch(css, /body\.city-entered\s+#touch-controls(?!\.visible)\s*\{[^}]*display:\s*block/s);
  assert.doesNotMatch(css, /body\.city-entered\s+#(?:hud|ops-panel|phone-panel|dev-tools)/);
});

test("entry handler hides the landing and records city-entered state", () => {
  assert.match(main, /querySelector<HTMLButtonElement>\("#enter-world"\)/);
  assert.match(main, /function enterWorld\(\): void\s*\{[\s\S]*?document\.body\.classList\.add\("city-entered"\)[\s\S]*?landingShell\.hidden\s*=\s*true/s);
  assert.match(main, /enterWorldButton\.addEventListener\("click",\s*enterWorld\)/);
  assert.match(main, /cityEntered[\s\S]*?shouldShowTouchControls\(\)/);
});

test("main synchronizes contextual navigation and records Action state", () => {
  assert.match(main, /import\s+\{\s*computeMobileControlState\s*\}\s+from\s+["']\.\/mobileControlState["']/);
  assert.match(main, /activeContextAction:\s*activeContextAction\s*!==\s*null/);
  const mobileState = between(main, "const state = computeMobileControlState({", "touchControls.classList.toggle");
  assert.doesNotMatch(mobileState, /modalBlocked|nearbyCitizen|activeHomeAction|popup|briefing|homePanel|phone|voice/i);
  assert.match(main, /touchActionButton\.hidden\s*=\s*!state\.actionVisible[\s\S]*?touchActionButton\.disabled\s*=\s*!state\.actionVisible/);
  const navigationContext = between(main, "function updateNavigationContext(): void {", "function openInteraction");
  assert.match(navigationContext, /activeContextAction\s*=\s*null/);
  assert.match(navigationContext, /exteriorPosition/);
  assert.match(navigationContext, /interiorPosition/);
  assert.match(navigationContext, /activeContextAction\s*=\s*["']inspect_records["']/);
  assert.match(navigationContext, /updateTouchControlVisibility\(\)/);
  assert.doesNotMatch(navigationContext, /nearbyCitizen|activeHomeAction|actionPrompt|selectedCitizen|popup|briefing|homePanel|phone|voice/i);
});

test("keyboard and touch Action share a bounded navigation and records handler", () => {
  const handler = between(main, "function handleNavigationAction(): void {", "function updateHud");
  assert.match(handler, /activeContextAction\s*===\s*["']enter_headquarters["'][\s\S]*?switchToScene\(["']headquarters["']/);
  assert.match(handler, /activeContextAction\s*===\s*["']leave_headquarters["'][\s\S]*?switchToScene\(["']outside["']/);
  assert.match(handler, /activeContextAction\s*===\s*["']inspect_records["'][\s\S]*?recordsTerminal\.open\(\)/);
  assert.doesNotMatch(handler, /openInteraction|restAtHome|renderHomeProfile|showToast|openPhone|phone|voice/i);
  assert.match(main, /touchActionButton\.addEventListener\(["']click["'],\s*handleNavigationAction\)/);
  const keyboard = between(main, "function handleKeyDown(event: KeyboardEvent): void {", "function handleKeyUp");
  assert.match(keyboard, /code\s*===\s*["']keye["']\)\s*handleNavigationAction\(\)/);
  assert.doesNotMatch(keyboard, /["']key[PV]["']|startAssistantVoicePlaceholder|openPhone/i);
});

test("animation updates navigation context without hidden legacy GUI work", () => {
  const animate = between(main, "function animate(): void {", "window.setInterval(animate");
  assert.match(animate, /updateNavigationContext\(\)/);
  assert.doesNotMatch(animate, /maybeOpenReceptionBriefing|updateHud|updateOpsPanel|renderPhone|updateVoiceState/);
});

test("unsafe HTML render sinks are gone", () => {
  assert.equal((main.match(/\.innerHTML\b/g) ?? []).length, 0, "main.ts must contain zero .innerHTML uses");
});

test("headquarters player spawn is outside the expanded reception-desk collider", () => {
  const spawnMatch = main.match(/const HEADQUARTERS_PLAYER_SPAWN = \{ x: (-?[\d.]+), z: (-?[\d.]+) \} as const;/);
  assert.ok(spawnMatch, "headquarters spawn must be a named release invariant");
  const radiusMatch = main.match(/const PLAYER_RADIUS = ([\d.]+);/);
  assert.ok(radiusMatch, "player radius must remain explicit");

  const spawn = { x: Number(spawnMatch[1]), z: Number(spawnMatch[2]) };
  const radius = Number(radiusMatch[1]);
  const desk = {
    minX: 0 - 4.8 / 2 - radius,
    maxX: 0 + 4.8 / 2 + radius,
    minZ: 4.1 - 1.4 / 2 - radius,
    maxZ: 4.1 + 1.4 / 2 + radius
  };
  const trapped = spawn.x >= desk.minX && spawn.x <= desk.maxX && spawn.z >= desk.minZ && spawn.z <= desk.maxZ;
  assert.equal(trapped, false, `spawn (${spawn.x}, ${spawn.z}) must not overlap the reception desk collider`);
  assert.match(main, /player\.position\.set\(HEADQUARTERS_PLAYER_SPAWN\.x, 0, HEADQUARTERS_PLAYER_SPAWN\.z\)/);
  assert.match(main, /switchToScene\("headquarters", \{ \.\.\.HEADQUARTERS_PLAYER_SPAWN \}\)/);
});

test("package exposes the focused Node test without dependency changes", () => {
  const pkg = JSON.parse(packageJson);
  assert.equal(pkg.scripts.test, "node --test tests/*.test.mjs");
  assert.deepEqual(Object.keys(pkg.dependencies).sort(), ["@supabase/supabase-js", "three", "typescript", "vite"].sort());
  assert.deepEqual(Object.keys(pkg.devDependencies).sort(), ["@types/three"]);
});
