import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const sourceUrl = new URL("../src/main.ts", import.meta.url);

async function source() {
  return readFile(sourceUrl, "utf8");
}

test("kiosk performance mode lowers GPU cost and caps the render loop at 30 fps", async () => {
  const main = await source();

  assert.match(main, /performance.*kiosk/);
  assert.match(main, /KIOSK_PIXEL_RATIO\s*=\s*0\.65/);
  assert.match(main, /antialias:\s*!kioskPerformanceMode/);
  assert.match(main, /shadowMap\.enabled\s*=\s*!kioskPerformanceMode/);
  assert.match(main, /KIOSK_TARGET_FPS\s*=\s*30/);
  assert.match(main, /requestAnimationFrame\(renderLoop\)/);
  assert.match(main, /if \(kioskPerformanceMode\) enterWorld\(\)/);
  assert.doesNotMatch(main, /setInterval\(animate/);
});
