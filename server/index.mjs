import { createReadStream, existsSync, mkdirSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, extname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { isProxy } from "node:util/types";
import { createPrivateMeetingSessionsRepository } from "./privateMeetingSessions.mjs";
import { createPrivateMeetingSessionsApiHandler } from "./privateMeetingSessionsApi.mjs";
import { createWorkRecordsApiHandler } from "./workRecordsApi.mjs";
import { WorkRecordStore } from "./workRecords.mjs";

const objectGetOwnPropertyDescriptors = Object.getOwnPropertyDescriptors;
const objectGetPrototypeOf = Object.getPrototypeOf;
const objectPrototype = Object.prototype;
const reflectOwnKeys = Reflect.ownKeys;
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "::1", "localhost"]);
const PRIVATE_MEETING_SESSIONS_ROUTE = /^\/api\/private\/tenants\/[^/]+\/meeting-sessions(?:\/[^/]+(?:\/(?:history|end))?)?$/;
const PRIVATE_MEETING_SESSIONS_NAMESPACE = /^\/api\/private\/tenants\/[^/]+\/meeting-sessions(?:\/|%2[fF]|$)/;
const MIME_TYPES = new Map([
  [".css", "text/css; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".ico", "image/x-icon"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".svg", "image/svg+xml"]
]);

function safePort(value) {
  const port = Number(value ?? 4173);
  if (!Number.isSafeInteger(port) || port < 0 || port > 65_535) throw new Error("VIBE_WORK_RECORD_PORT must be a valid local port");
  return port;
}

function serveFile(response, path) {
  response.writeHead(200, {
    "cache-control": path.endsWith(".html") ? "no-cache" : "public, max-age=3600",
    "content-type": MIME_TYPES.get(extname(path)) ?? "application/octet-stream",
    "x-content-type-options": "nosniff"
  });
  createReadStream(path).pipe(response);
}

function denyPrivateMeetingRoute(response) {
  const payload = JSON.stringify({ error: "not_found" });
  response.writeHead(404, {
    "cache-control": "private, no-store",
    "content-length": Buffer.byteLength(payload),
    "content-type": "application/json; charset=utf-8",
    vary: "Authorization",
    "x-content-type-options": "nosniff"
  });
  response.end(payload);
}

function composePrivateMeetingSessions(input) {
  let repository;
  try {
    if (input === null || typeof input !== "object" || isProxy(input) || objectGetPrototypeOf(input) !== objectPrototype) return null;
    const keys = ["databasePath", "now", "resolveTrustedSession", "resolveTrustedMembership", "evaluatePolicy"];
    const descriptors = objectGetOwnPropertyDescriptors(input);
    if (reflectOwnKeys(input).length !== keys.length) return null;
    for (const key of keys) {
      const descriptor = descriptors[key];
      if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) return null;
    }
    const databasePath = descriptors.databasePath.value;
    const now = descriptors.now.value;
    const resolveTrustedSession = descriptors.resolveTrustedSession.value;
    const resolveTrustedMembership = descriptors.resolveTrustedMembership.value;
    const evaluatePolicy = descriptors.evaluatePolicy.value;
    if (typeof databasePath !== "string" || databasePath.length === 0 ||
        typeof now !== "function" || typeof resolveTrustedSession !== "function" ||
        typeof resolveTrustedMembership !== "function" || typeof evaluatePolicy !== "function") return null;
    repository = createPrivateMeetingSessionsRepository(databasePath);
    const handler = createPrivateMeetingSessionsApiHandler({
      repository,
      now,
      resolveTrustedSession,
      resolveTrustedMembership,
      evaluatePolicy
    });
    return { handler, repository };
  } catch {
    if (repository) repository.close();
    return null;
  }
}

function createProductionHandler() {
  const distribution = join(ROOT, "dist");
  const indexPath = join(distribution, "index.html");
  if (!existsSync(indexPath)) throw new Error("Production bundle missing; run npm run build first");
  return (request, response) => {
    let pathname;
    try {
      pathname = decodeURIComponent(new URL(request.url ?? "/", "http://127.0.0.1").pathname);
    } catch {
      response.writeHead(400).end();
      return;
    }
    const requested = resolve(distribution, pathname.replace(/^\/+/, ""));
    const insideDistribution = requested === distribution || !relative(distribution, requested).startsWith(`..${sep}`) && relative(distribution, requested) !== "..";
    if (insideDistribution && existsSync(requested) && statSync(requested).isFile()) serveFile(response, requested);
    else serveFile(response, indexPath);
  };
}

export async function startWorkRecordsServer({
  development = false,
  host = process.env.VIBE_WORK_RECORD_HOST ?? "127.0.0.1",
  port = safePort(process.env.VIBE_WORK_RECORD_PORT),
  databasePath = process.env.VIBE_WORK_RECORD_DB ?? join(ROOT, ".runtime", "work-records.sqlite"),
  token = process.env.VIBE_WORK_RECORD_TOKEN,
  meetingSessions
} = {}) {
  if (!LOOPBACK_HOSTS.has(host)) throw new Error("Work-record prototype only permits loopback binding");
  mkdirSync(dirname(databasePath), { recursive: true, mode: 0o700 });
  const store = new WorkRecordStore(databasePath);
  const api = createWorkRecordsApiHandler({ store, expectedToken: token });
  let privateMeetings;
  let applicationHandler;
  let vite;
  let resourcesClosed = false;
  const closeResources = async () => {
    if (resourcesClosed) return;
    resourcesClosed = true;
    let failure;
    if (vite) {
      try { await vite.close(); } catch (error) { failure = error; }
    }
    try { store.close(); } catch (error) { failure ??= error; }
    if (privateMeetings) {
      try { privateMeetings.repository.close(); } catch (error) { failure ??= error; }
    }
    if (failure) throw failure;
  };
  let server;
  try {
    privateMeetings = composePrivateMeetingSessions(meetingSessions);
    if (development) {
      const { createServer: createViteServer } = await import("vite");
      vite = await createViteServer({ root: ROOT, appType: "spa", server: { middlewareMode: true } });
      applicationHandler = (request, response) => new Promise((resolveRequest) => {
        vite.middlewares(request, response, () => {
          if (!response.headersSent) response.writeHead(404).end();
          resolveRequest();
        });
      });
    } else {
      applicationHandler = createProductionHandler();
    }
    server = createServer(async (request, response) => {
      const pathname = new URL(request.url ?? "/", "http://127.0.0.1").pathname;
      if (pathname === "/api/work-events") await api(request, response);
      else if (PRIVATE_MEETING_SESSIONS_ROUTE.test(pathname)) {
        if (privateMeetings) await privateMeetings.handler(request, response);
        else denyPrivateMeetingRoute(response);
      }
      else if (PRIVATE_MEETING_SESSIONS_NAMESPACE.test(pathname)) denyPrivateMeetingRoute(response);
      else await applicationHandler(request, response);
    });
    await new Promise((resolveListen, reject) => {
      const rejectListen = (error) => reject(error);
      server.once("error", rejectListen);
      server.listen(port, host, () => {
        server.off("error", rejectListen);
        resolveListen();
      });
    });
  } catch (error) {
    if (server?.listening) {
      await new Promise((resolveClose) => server.close(() => resolveClose()));
    }
    try { await closeResources(); } catch { /* preserve startup failure */ }
    throw error;
  }
  const address = server.address();
  const boundPort = typeof address === "object" && address ? address.port : port;
  console.log(`Vibe City local work-record prototype listening on http://${host}:${boundPort}`);
  if (!token) console.log("Authenticated ingestion is disabled until VIBE_WORK_RECORD_TOKEN is set.");
  let closePromise;
  return {
    host,
    port: boundPort,
    close: () => {
      closePromise ??= (async () => {
        let failure;
        try {
          await new Promise((resolveClose, reject) => server.close((error) => error ? reject(error) : resolveClose()));
        } catch (error) {
          failure = error;
        }
        try { await closeResources(); } catch (error) { failure ??= error; }
        if (failure) throw failure;
      })();
      return closePromise;
    }
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const development = process.argv.includes("--dev");
  startWorkRecordsServer({ development }).catch(() => {
    console.error("Failed to start the local Vibe City work-record prototype.");
    process.exitCode = 1;
  });
}
