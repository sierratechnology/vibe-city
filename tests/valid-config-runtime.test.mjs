import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { extname, join, normalize } from "node:path";
import test from "node:test";

const projectRoot = new URL("../", import.meta.url);
const chromeCandidates = [
  process.env.CHROME_BIN,
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser"
].filter(Boolean);
const chrome = chromeCandidates.find(existsSync);

function freePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close((error) => error ? reject(error) : resolve(port));
    });
  });
}

function contentType(path) {
  return ({ ".html": "text/html", ".js": "text/javascript", ".css": "text/css" })[extname(path)] ?? "application/octet-stream";
}

async function waitForJson(url, attempts = 80) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await fetch(url);
      if (response.ok) return response.json();
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`endpoint did not become ready: ${url}`);
}

async function connectCdp(webSocketDebuggerUrl) {
  const socket = new WebSocket(webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });
  let sequence = 0;
  const pending = new Map();
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (!message.id || !pending.has(message.id)) return;
    const waiter = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) waiter.reject(new Error(message.error.message));
    else waiter.resolve(message.result);
  });
  return {
    socket,
    send(method, params = {}) {
      const id = ++sequence;
      socket.send(JSON.stringify({ id, method, params }));
      return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
    }
  };
}

test("valid Supabase configuration does not deadlock production startup", { skip: !chrome, timeout: 60_000 }, async () => {
  const outDir = mkdtempSync(join(tmpdir(), "vibe-valid-config-"));
  const profileDir = mkdtempSync(join(tmpdir(), "vibe-valid-config-chrome-"));
  let server;
  let chromeProcess;
  let cdp;
  try {
    execFileSync("npm", ["run", "build", "--", "--outDir", outDir, "--emptyOutDir"], {
      cwd: projectRoot,
      env: {
        ...process.env,
        VITE_SUPABASE_URL: "https://valid-runtime-test.supabase.co",
        VITE_SUPABASE_ANON_KEY: "header.payload.signature"
      },
      stdio: "pipe"
    });

    const serverPort = await freePort();
    server = createServer((request, response) => {
      const pathname = new URL(request.url, `http://${request.headers.host}`).pathname;
      const relative = pathname === "/" ? "index.html" : pathname.slice(1);
      const file = normalize(join(outDir, relative));
      if (!file.startsWith(normalize(outDir))) {
        response.writeHead(403).end();
        return;
      }
      try {
        response.writeHead(200, { "content-type": contentType(file) });
        response.end(readFileSync(file));
      } catch {
        response.writeHead(404).end();
      }
    });
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(serverPort, "127.0.0.1", resolve);
    });

    const cdpPort = await freePort();
    chromeProcess = spawn(chrome, [
      "--headless=new",
      `--remote-debugging-port=${cdpPort}`,
      `--user-data-dir=${profileDir}`,
      "--no-first-run",
      "--no-default-browser-check",
      "about:blank"
    ], { stdio: "ignore" });
    await waitForJson(`http://127.0.0.1:${cdpPort}/json/version`);
    const targetResponse = await fetch(`http://127.0.0.1:${cdpPort}/json/new?${encodeURIComponent(`http://127.0.0.1:${serverPort}/`)}`, { method: "PUT" });
    assert.equal(targetResponse.ok, true);
    const target = await targetResponse.json();
    cdp = await connectCdp(target.webSocketDebuggerUrl);
    await cdp.send("Runtime.enable");
    const evaluate = async (expression, awaitPromise = false) => {
      const result = await cdp.send("Runtime.evaluate", { expression, awaitPromise, returnByValue: true });
      return result.result.value;
    };
    const pressKey = async (code, key, milliseconds) => {
      await cdp.send("Input.dispatchKeyEvent", { type: "keyDown", code, key });
      await new Promise((resolve) => setTimeout(resolve, milliseconds));
      await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", code, key });
      await new Promise((resolve) => setTimeout(resolve, 100));
    };
    const moveAxisTo = async (axis, target, positiveCode, positiveKey, negativeCode, negativeKey, maxAttempts = 100) => {
      let position;
      for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
        position = await evaluate("window.__vibeCity3DHealth.player");
        const delta = target - position[axis];
        if (Math.abs(delta) <= 0.2) return position;
        await cdp.send("Input.dispatchKeyEvent", { type: "keyDown", code: delta > 0 ? positiveCode : negativeCode, key: delta > 0 ? positiveKey : negativeKey });
        await new Promise((resolve) => setTimeout(resolve, 45));
        await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", code: delta > 0 ? positiveCode : negativeCode, key: delta > 0 ? positiveKey : negativeKey });
        await new Promise((resolve) => setTimeout(resolve, 30));
      }
      assert.fail(`player did not converge on ${axis}=${target}: ${JSON.stringify(position)}`);
    };
    const installRecordMock = `
      window.__recordsTestRequests = 0;
      window.fetch = async (input) => {
        const url = String(input);
        if (url !== "https://api.github.com/repos/sierratechnology/vibe-city/commits?per_page=1") {
          return new Response("", { status: 404 });
        }
        window.__recordsTestRequests += 1;
        const sha = "f".repeat(40);
        return new Response(JSON.stringify([{
          sha,
          html_url: "https://github.com/sierratechnology/vibe-city/commit/" + sha,
          commit: { message: "Runtime records proof", committer: { date: "2026-07-28T00:30:00Z" } }
        }]), { status: 200, headers: { "content-type": "application/json" } });
      };
    `;

    let health;
    for (let attempt = 0; attempt < 80; attempt += 1) {
      const result = await cdp.send("Runtime.evaluate", {
        expression: "window.__vibeCity3DHealth ?? null",
        returnByValue: true
      });
      health = result.result.value;
      if (health) break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    assert.ok(health, "valid realtime configuration must not block application initialization");
    assert.equal(health.multiplayerEnvConfigured, true);
    assert.equal(health.citizensVisible, 0, "unavailable agent registry must not project seeded agents");
    const remoteOpen = await cdp.send("Runtime.evaluate", {
      expression: `(async () => {
        document.querySelector("#enter-world").click();
        window.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyE", key: "e" }));
        window.dispatchEvent(new KeyboardEvent("keyup", { code: "KeyE", key: "e" }));
        await new Promise((resolve) => setTimeout(resolve, 150));
        return {
          dialogOpen: document.querySelector("#records-terminal-dialog").open,
          githubRequests: performance.getEntriesByType("resource")
            .filter((entry) => entry.name.includes("api.github.com")).length
        };
      })()`,
      awaitPromise: true,
      returnByValue: true
    });
    assert.deepEqual(remoteOpen.result.value, {
      dialogOpen: false,
      githubRequests: 0
    }, "Records must not open or request GitHub while the player is outside terminal proximity");

    await cdp.send("Emulation.setDeviceMetricsOverride", {
      width: 390,
      height: 844,
      deviceScaleFactor: 1,
      mobile: true,
      screenWidth: 390,
      screenHeight: 844
    });
    await cdp.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 1 });
    await cdp.send("Page.reload", { ignoreCache: true });
    await new Promise((resolve) => setTimeout(resolve, 300));
    let mobileHealth;
    for (let attempt = 0; attempt < 100; attempt += 1) {
      mobileHealth = await evaluate("window.__vibeCity3DHealth ?? null");
      if (mobileHealth?.frames > 5) break;
      await new Promise((resolve) => setTimeout(resolve, 75));
    }
    assert.ok(mobileHealth, "mobile production runtime must initialize");
    await evaluate(`${installRecordMock}\ndocument.querySelector("#enter-world").click();`);
    await new Promise((resolve) => setTimeout(resolve, 250));
    const touchJoystick = async (deltaX, deltaY, milliseconds = 260) => {
      const center = await evaluate(`(() => {
        const rect = document.querySelector("#touch-joystick").getBoundingClientRect();
        return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
      })()`);
      await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [center] });
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: [{ x: center.x + deltaX, y: center.y + deltaY }]
      });
      await new Promise((resolve) => setTimeout(resolve, milliseconds));
      await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
      await new Promise((resolve) => setTimeout(resolve, 100));
    };

    await cdp.send("Emulation.setEmulatedMedia", {
      features: [{ name: "prefers-reduced-motion", value: "reduce" }]
    });
    await evaluate(`document.documentElement.style.fontSize = "200%"`);
    let keyboardAccess;
    for (let attempt = 0; attempt < 12; attempt += 1) {
      await pressKey("Tab", "Tab", 20);
      keyboardAccess = await evaluate(`({
        activeId: document.activeElement?.id,
        rect: (() => {
          const box = document.querySelector("#operations-directory-access").getBoundingClientRect();
          return { width: box.width, height: box.height, left: box.left, top: box.top, right: box.right, bottom: box.bottom };
        })()
      })`);
      if (keyboardAccess.activeId === "operations-directory-access") break;
    }
    assert.equal(keyboardAccess.activeId, "operations-directory-access", JSON.stringify(keyboardAccess));
    assert.ok(keyboardAccess.rect.width >= 44 && keyboardAccess.rect.height >= 44, JSON.stringify(keyboardAccess));
    await cdp.send("Input.dispatchKeyEvent", {
      type: "keyDown",
      code: "Enter",
      key: "Enter",
      text: "\r",
      unmodifiedText: "\r",
      windowsVirtualKeyCode: 13,
      nativeVirtualKeyCode: 13
    });
    await cdp.send("Input.dispatchKeyEvent", {
      type: "keyUp",
      code: "Enter",
      key: "Enter",
      windowsVirtualKeyCode: 13,
      nativeVirtualKeyCode: 13
    });
    const accessibleOpen = await evaluate(`(async () => {
      await new Promise((resolve) => setTimeout(resolve, 100));
      const dialog = document.querySelector("#operations-directory-dialog");
      const rect = dialog.getBoundingClientRect();
      return {
        open: dialog.open,
        bounds: { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom },
        viewport: { width: innerWidth, height: innerHeight },
        controlsVisible: document.querySelector("#touch-controls").classList.contains("visible"),
        githubRequests: window.__recordsTestRequests,
        services: document.querySelector("#operations-directory-services").textContent,
        record: document.querySelector("#operations-directory-record").textContent,
        identity: document.querySelector("#operations-directory-identity").textContent,
        authority: document.querySelector("#operations-directory-authority").textContent,
        reducedMotionTransition: getComputedStyle(document.querySelector("#fade-overlay")).transitionDuration,
        player: window.__vibeCity3DHealth.player
      };
    })()`, true);
    assert.equal(accessibleOpen.open, true);
    assert.equal(accessibleOpen.controlsVisible, false);
    assert.equal(accessibleOpen.githubRequests, 0);
    assert.match(accessibleOpen.services, /World Zero entry and movement\. Capability: working\. Freshness: live\. As of: .* Reason: none\./i);
    assert.match(accessibleOpen.services, /Public GitHub record source\. Capability: unavailable\. Freshness: unavailable\. As of: not available\. Reason: not checked\./i);
    assert.match(accessibleOpen.services, /Hosted-agent registry\. Capability: not configured\. Freshness: unavailable\. As of: not available\. Reason: not configured\./i);
    assert.match(accessibleOpen.services, /Private Hermes and Kanban work state\. Capability: private\. Freshness: unavailable\. As of: not available\. Reason: not public\./i);
    assert.match(accessibleOpen.record, /No validated public record.*No record is being claimed/i);
    assert.match(accessibleOpen.identity, /Spiders.*plaque only.*does not claim a live hosted agent/i);
    assert.match(accessibleOpen.authority, /Devon.*spending.*external communication.*irreversible changes.*protected releases.*not an approval control/i);
    assert.equal(accessibleOpen.reducedMotionTransition, "0s");
    assert.ok(accessibleOpen.bounds.left >= 0 && accessibleOpen.bounds.top >= 0, JSON.stringify(accessibleOpen));
    assert.ok(accessibleOpen.bounds.right <= accessibleOpen.viewport.width, JSON.stringify(accessibleOpen));
    assert.ok(accessibleOpen.bounds.bottom <= accessibleOpen.viewport.height, JSON.stringify(accessibleOpen));
    await touchJoystick(46, 0, 260);
    const blockedDirectoryMovement = await evaluate(`({
      player: window.__vibeCity3DHealth.player,
      controlsVisible: document.querySelector("#touch-controls").classList.contains("visible")
    })`);
    assert.deepEqual(blockedDirectoryMovement.player, accessibleOpen.player);
    assert.equal(blockedDirectoryMovement.controlsVisible, false);
    await cdp.send("Input.dispatchKeyEvent", {
      type: "rawKeyDown",
      code: "Escape",
      key: "Escape",
      windowsVirtualKeyCode: 27,
      nativeVirtualKeyCode: 27
    });
    await cdp.send("Input.dispatchKeyEvent", {
      type: "keyUp",
      code: "Escape",
      key: "Escape",
      windowsVirtualKeyCode: 27,
      nativeVirtualKeyCode: 27
    });
    const accessibleFocusRestored = await evaluate(`(async () => {
      document.documentElement.style.fontSize = "";
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      return {
        open: document.querySelector("#operations-directory-dialog").open,
        activeId: document.activeElement?.id
      };
    })()`, true);
    assert.deepEqual(accessibleFocusRestored, { open: false, activeId: "operations-directory-access" });
    const touchDirectoryCenter = await evaluate(`(() => {
      const rect = document.querySelector("#operations-directory-access").getBoundingClientRect();
      return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
    })()`);
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [touchDirectoryCenter] });
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.equal(await evaluate(`document.querySelector("#operations-directory-dialog").open`), true);
    assert.equal(await evaluate(`window.__recordsTestRequests`), 0);
    const touchCloseCenter = await evaluate(`(() => {
      const rect = document.querySelector("#operations-directory-close").getBoundingClientRect();
      return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
    })()`);
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [touchCloseCenter] });
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.equal(await evaluate(`document.querySelector("#operations-directory-dialog").open`), false);
    await cdp.send("Emulation.setEmulatedMedia", { features: [] });
    await new Promise((resolve) => setTimeout(resolve, 100));

    let receptionProximity;
    for (let attempt = 0; attempt < 16; attempt += 1) {
      receptionProximity = await evaluate(`(() => {
        const action = document.querySelector("#touch-action");
        return {
          player: window.__vibeCity3DHealth.player,
          label: action.textContent,
          hidden: action.hidden,
          ariaLabel: action.getAttribute("aria-label")
        };
      })()`);
      if (receptionProximity.label === "Status" && !receptionProximity.hidden) break;
      if (receptionProximity.player.x < 2.8) await touchJoystick(46, 0, 120);
      else await touchJoystick(0, -46, 120);
    }
    assert.equal(receptionProximity.label, "Status", JSON.stringify(receptionProximity));
    assert.equal(receptionProximity.hidden, false);
    assert.equal(receptionProximity.ariaLabel, "Inspect Reception Status");
    const receptionActionCenter = await evaluate(`(() => {
      const rect = document.querySelector("#touch-action").getBoundingClientRect();
      return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
    })()`);
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [receptionActionCenter] });
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.equal(await evaluate(`document.querySelector("#operations-directory-dialog").open`), true);
    assert.equal(await evaluate(`window.__recordsTestRequests`), 0);
    const receptionFocusRestored = await evaluate(`(async () => {
      document.querySelector("#operations-directory-dialog").close();
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      return document.activeElement?.id;
    })()`, true);
    assert.equal(receptionFocusRestored, "touch-action");
    await new Promise((resolve) => setTimeout(resolve, 100));

    let mobileProximity;
    for (let attempt = 0; attempt < 12; attempt += 1) {
      mobileProximity = await evaluate(`(() => {
        const action = document.querySelector("#touch-action");
        return {
          player: window.__vibeCity3DHealth.player,
          label: action.textContent,
          hidden: action.hidden,
          disabled: action.disabled,
          ariaLabel: action.getAttribute("aria-label")
        };
      })()`);
      if (mobileProximity.label === "Inspect" && !mobileProximity.hidden) break;
      if (mobileProximity.player.x < 5.7) await touchJoystick(46, 0);
      else if (mobileProximity.player.z > 6.5) await touchJoystick(0, -46);
      else await touchJoystick(30, -20, 180);
    }
    assert.equal(mobileProximity.label, "Inspect");
    assert.equal(mobileProximity.hidden, false);
    assert.equal(mobileProximity.disabled, false);
    assert.equal(mobileProximity.ariaLabel, "Inspect Records Terminal");

    await cdp.send("Emulation.setDeviceMetricsOverride", {
      width: 800,
      height: 600,
      deviceScaleFactor: 1,
      mobile: false,
      screenWidth: 800,
      screenHeight: 600
    });
    await cdp.send("Emulation.setTouchEmulationEnabled", { enabled: false });
    await evaluate("window.dispatchEvent(new Event('resize'))");
    await new Promise((resolve) => setTimeout(resolve, 150));
    const desktopProximity = await evaluate(`(() => {
      const action = document.querySelector("#touch-action");
      return {
        player: window.__vibeCity3DHealth.player,
        label: action.textContent,
        ariaLabel: action.getAttribute("aria-label")
      };
    })()`);
    assert.equal(desktopProximity.label, "Inspect", JSON.stringify(desktopProximity));
    assert.equal(desktopProximity.ariaLabel, "Inspect Records Terminal");
    await pressKey("KeyE", "e", 40);
    let desktopOpen;
    for (let attempt = 0; attempt < 80; attempt += 1) {
      desktopOpen = await evaluate(`({
        open: document.querySelector("#records-terminal-dialog").open,
        freshness: document.querySelector("#records-terminal-freshness").textContent,
        requests: window.__recordsTestRequests
      })`);
      if (desktopOpen.open && desktopOpen.freshness === "Fresh") break;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    assert.deepEqual(desktopOpen, { open: true, freshness: "Fresh", requests: 1 });
    await evaluate(`document.querySelector("#records-terminal-dialog").close()`);

    await cdp.send("Emulation.setDeviceMetricsOverride", {
      width: 390,
      height: 844,
      deviceScaleFactor: 1,
      mobile: true,
      screenWidth: 390,
      screenHeight: 844
    });
    await cdp.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 1 });
    await evaluate("window.dispatchEvent(new Event('resize'))");
    await new Promise((resolve) => setTimeout(resolve, 150));
    const mobileActionRestored = await evaluate(`({
      label: document.querySelector("#touch-action").textContent,
      hidden: document.querySelector("#touch-action").hidden,
      disabled: document.querySelector("#touch-action").disabled
    })`);
    assert.deepEqual(mobileActionRestored, { label: "Inspect", hidden: false, disabled: false });
    const actionCenter = await evaluate(`(() => {
      const rect = document.querySelector("#touch-action").getBoundingClientRect();
      return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
    })()`);
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [actionCenter] });
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    let mobileOpen;
    for (let attempt = 0; attempt < 80; attempt += 1) {
      mobileOpen = await evaluate(`({
        open: document.querySelector("#records-terminal-dialog").open,
        freshness: document.querySelector("#records-terminal-freshness").textContent,
        requests: window.__recordsTestRequests,
        controlsVisible: document.querySelector("#touch-controls").classList.contains("visible")
      })`);
      if (mobileOpen.open && mobileOpen.freshness === "Fresh") break;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    assert.deepEqual(mobileOpen, {
      open: true,
      freshness: "Fresh",
      requests: 1,
      controlsVisible: false
    });
    await new Promise((resolve) => setTimeout(resolve, 1_100));
    await evaluate(`
      window.fetch = async (input) => {
        if (String(input) === "https://api.github.com/repos/sierratechnology/vibe-city/commits?per_page=1") {
          window.__recordsTestRequests += 1;
          throw new TypeError("simulated network failure");
        }
        return new Response("", { status: 404 });
      };
      document.querySelector("#records-terminal-refresh").click();
    `);
    let staleOpen;
    for (let attempt = 0; attempt < 80; attempt += 1) {
      staleOpen = await evaluate(`({
        freshness: document.querySelector("#records-terminal-freshness").textContent,
        requests: window.__recordsTestRequests
      })`);
      if (staleOpen.freshness === "Stale / last known" && staleOpen.requests === 2) break;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    assert.deepEqual(staleOpen, { freshness: "Stale / last known", requests: 2 });
    await evaluate(`document.querySelector("#records-terminal-dialog").close()`);
    const directoryRecord = await evaluate(`(async () => {
      const requestsBeforeOpen = window.__recordsTestRequests;
      document.querySelector("#operations-directory-access").click();
      await new Promise((resolve) => requestAnimationFrame(resolve));
      const container = document.querySelector("#operations-directory-record");
      return {
        open: document.querySelector("#operations-directory-dialog").open,
        text: container.textContent,
        services: document.querySelector("#operations-directory-services").textContent,
        sourceHref: container.querySelector("a")?.href ?? null,
        requestsBeforeOpen,
        requestsAfterOpen: window.__recordsTestRequests
      };
    })()`, true);
    assert.equal(directoryRecord.open, true);
    assert.match(directoryRecord.text, /Runtime records proof/);
    assert.match(directoryRecord.text, /Source ID: f{40}/);
    assert.match(directoryRecord.text, /Source updated: 2026-07-28T00:30:00\.000Z/);
    const observedTimestamp = directoryRecord.text.match(/Observed: (\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z)/)?.[1];
    const checkedTimestamp = directoryRecord.text.match(/Last checked: (\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z)/)?.[1];
    assert.ok(observedTimestamp, directoryRecord.text);
    assert.ok(checkedTimestamp, directoryRecord.text);
    assert.notEqual(checkedTimestamp, observedTimestamp, "failed refresh time must remain separate from last successful observation");
    assert.match(directoryRecord.text, /Freshness: stale \/ network/);
    const receptionObservedTimestamp = directoryRecord.services.match(/Public GitHub record source\. Capability: degraded\. Freshness: stale\. As of: (\d{4}-\d{2}-\d{2}T[^\s]+)\. Reason: stale source\./)?.[1];
    assert.equal(receptionObservedTimestamp, observedTimestamp, "Reception as-of must remain the last successful observation time");
    assert.equal(directoryRecord.sourceHref, `https://github.com/sierratechnology/vibe-city/commit/${"f".repeat(40)}`);
    assert.equal(directoryRecord.requestsAfterOpen, directoryRecord.requestsBeforeOpen, "Directory must not make another GitHub request");
    await evaluate(`document.querySelector("#operations-directory-dialog").close()`);
    await new Promise((resolve) => setTimeout(resolve, 100));
    await cdp.send("Emulation.setDeviceMetricsOverride", {
      width: 1280,
      height: 720,
      deviceScaleFactor: 1,
      mobile: false,
      screenWidth: 1280,
      screenHeight: 720
    });
    await cdp.send("Emulation.setTouchEmulationEnabled", { enabled: false });
    await evaluate("window.dispatchEvent(new Event('resize'))");
    await new Promise((resolve) => setTimeout(resolve, 100));

    await moveAxisTo("z", 7.6, "KeyS", "s", "KeyW", "w");
    await moveAxisTo("x", 3.25, "KeyD", "d", "KeyA", "a");
    await moveAxisTo("z", 7.2, "KeyS", "s", "KeyW", "w");
    await pressKey("KeyW", "w", 600);
    const receptionColliderStop = await evaluate(`({
      player: window.__vibeCity3DHealth.player,
      label: document.querySelector("#touch-action").textContent
    })`);
    assert.ok(receptionColliderStop.player.z >= 6.9, JSON.stringify(receptionColliderStop));
    assert.equal(receptionColliderStop.label, "Status");

    await moveAxisTo("z", 7.6, "KeyS", "s", "KeyW", "w");
    await moveAxisTo("x", -6.4, "KeyD", "d", "KeyA", "a");
    await moveAxisTo("z", 6.3, "KeyS", "s", "KeyW", "w");
    await pressKey("KeyW", "w", 600);
    const chiefProximity = await evaluate(`({
      player: window.__vibeCity3DHealth.player,
      label: document.querySelector("#touch-action").textContent,
      ariaLabel: document.querySelector("#touch-action").getAttribute("aria-label")
    })`);
    assert.ok(chiefProximity.player.z >= 5.6, JSON.stringify(chiefProximity));
    assert.equal(chiefProximity.label, "Identity", JSON.stringify(chiefProximity));
    assert.equal(chiefProximity.ariaLabel, "Inspect Spiders Identity");
    await pressKey("KeyE", "e", 40);
    const chiefOpen = await evaluate(`({
      open: document.querySelector("#operations-directory-dialog").open,
      identity: document.querySelector("#operations-directory-identity").textContent,
      requests: window.__recordsTestRequests
    })`);
    assert.equal(chiefOpen.open, true);
    assert.match(chiefOpen.identity, /Chief Agent Office/);
    assert.equal(chiefOpen.requests, 2);
    const chiefFocusRestored = await evaluate(`(async () => {
      document.querySelector("#operations-directory-dialog").close();
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      return document.activeElement?.tagName;
    })()`, true);
    assert.equal(chiefFocusRestored, "CANVAS");

    await moveAxisTo("z", 6.4, "KeyS", "s", "KeyW", "w");
    await moveAxisTo("x", -5.0, "KeyD", "d", "KeyA", "a");
    await moveAxisTo("z", 5.0, "KeyS", "s", "KeyW", "w");
    await pressKey("KeyA", "a", 600);
    const chiefSideStop = await evaluate(`({
      player: window.__vibeCity3DHealth.player,
      label: document.querySelector("#touch-action").textContent
    })`);
    assert.ok(chiefSideStop.player.x >= -5.4, JSON.stringify(chiefSideStop));
    assert.equal(chiefSideStop.label, "Identity");

    await moveAxisTo("x", -3.5, "KeyD", "d", "KeyA", "a");
    await moveAxisTo("z", -0.7, "KeyS", "s", "KeyW", "w");
    await moveAxisTo("x", 1.3, "KeyD", "d", "KeyA", "a");
    await pressKey("KeyD", "d", 600);
    const executiveProximity = await evaluate(`({
      player: window.__vibeCity3DHealth.player,
      label: document.querySelector("#touch-action").textContent,
      ariaLabel: document.querySelector("#touch-action").getAttribute("aria-label")
    })`);
    assert.ok(executiveProximity.player.x <= 1.65, JSON.stringify(executiveProximity));
    assert.equal(executiveProximity.label, "Authority", JSON.stringify(executiveProximity));
    assert.equal(executiveProximity.ariaLabel, "Inspect Executive Authority");
    await pressKey("KeyE", "e", 40);
    const executiveOpen = await evaluate(`({
      open: document.querySelector("#operations-directory-dialog").open,
      authority: document.querySelector("#operations-directory-authority").textContent,
      requests: window.__recordsTestRequests
    })`);
    assert.equal(executiveOpen.open, true);
    assert.match(executiveOpen.authority, /Human owner \/ executive authority/);
    assert.equal(executiveOpen.requests, 2);
  } finally {
    cdp?.socket.close();
    if (chromeProcess && chromeProcess.exitCode === null) {
      chromeProcess.kill("SIGTERM");
      await new Promise((resolve) => {
        let settled = false;
        const finish = () => {
          if (settled) return;
          settled = true;
          resolve();
        };
        chromeProcess.once("exit", finish);
        setTimeout(() => {
          if (chromeProcess.exitCode === null) chromeProcess.kill("SIGKILL");
          finish();
        }, 2_000);
      });
    }
    await new Promise((resolve) => server?.close(resolve) ?? resolve());
    rmSync(outDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    rmSync(profileDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});
