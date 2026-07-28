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
