import { createReadStream, existsSync, mkdirSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, extname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { isProxy } from "node:util/types";
import { createPrivateMeetingSessionsRepository } from "./privateMeetingSessions.mjs";
import { createPrivateMeetingSessionsApiHandler } from "./privateMeetingSessionsApi.mjs";
import { createTenantSkyscraperNavigationApiHandler } from "./tenantSkyscraperNavigationApi.mjs";
import { createTenantSkyscraperNavigationTrustedSourceAdapter } from "./tenantSkyscraperNavigationTrustedSourceAdapter.mjs";
import { createWorkRecordsApiHandler } from "./workRecordsApi.mjs";
import { WorkRecordStore } from "./workRecords.mjs";

const objectGetOwnPropertyDescriptors = Object.getOwnPropertyDescriptors;
const objectGetPrototypeOf = Object.getPrototypeOf;
const objectPrototype = Object.prototype;
const reflectApply = Reflect.apply;
const reflectOwnKeys = Reflect.ownKeys;
const regexpTest = RegExp.prototype.test;
const setImmediateIntrinsic = setImmediate;
const weakMapGet = Function.call.bind(WeakMap.prototype.get);
const weakMapSet = Function.call.bind(WeakMap.prototype.set);
const weakSetAdd = Function.call.bind(WeakSet.prototype.add);
const weakSetDelete = Function.call.bind(WeakSet.prototype.delete);
const weakSetHas = Function.call.bind(WeakSet.prototype.has);
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "::1", "localhost"]);
const PRIVATE_MEETING_SESSIONS_ROUTE = /^\/api\/private\/tenants\/[^/]+\/meeting-sessions(?:\/[^/]+(?:\/(?:history|end))?)?$/;
const PRIVATE_MEETING_SESSIONS_NAMESPACE = /^\/api\/private\/tenants\/[^/]+\/meeting-sessions(?:\/|%2[fF]|$)/;
const PRIVATE_NAVIGATION_ROUTE = /^\/api\/private\/tenants\/id_[a-f0-9]{16,64}\/skyscraper-navigation\/decision$/;
const PRIVATE_NAVIGATION_NAMESPACE = /^\/api\/private\/tenants\/[^/]+(?:\/|%2[fF]|%5[cC])skyscraper-navigation(?:\/|%2[fF]|%5[cC]|$)/;
const PRIVATE_TENANT_NAMESPACE = /^\/api\/private\/tenants(?:[/%\\]|$)/i;
const RAW_PRIVATE_TENANT_NAMESPACE = /^(?:\/|\\)+api(?:\/|\\|%2f|%5c)+private(?:\/|\\|%2f|%5c)+tenants(?:\/|\\|%2f|%5c|$)/i;
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

function composeTenantSkyscraperNavigation(input, ownsListenerRequest) {
  try {
    const adapter = createTenantSkyscraperNavigationTrustedSourceAdapter(input);
    if (adapter === null) return null;
    return createTenantSkyscraperNavigationApiHandler({
      now: adapter.now,
      resolveTrustedSession: adapter.resolveTrustedSession,
      resolveTrustedNavigationFacts: adapter.resolveTrustedNavigationFacts,
      ownsListenerRequest
    });
  } catch {
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
  meetingSessions,
  tenantSkyscraperNavigation,
  applicationHandler: injectedApplicationHandler,
  tenantSkyscraperNavigationDispatchObserver: injectedNavigationDispatchObserver
} = {}) {
  if (!LOOPBACK_HOSTS.has(host)) throw new Error("Work-record prototype only permits loopback binding");
  if (injectedApplicationHandler !== undefined && typeof injectedApplicationHandler !== "function") {
    throw new TypeError("applicationHandler must be a function");
  }
  if (injectedNavigationDispatchObserver !== undefined &&
      (typeof injectedNavigationDispatchObserver !== "function" ||
       typeof injectedApplicationHandler !== "function")) {
    throw new TypeError("tenantSkyscraperNavigationDispatchObserver requires an applicationHandler");
  }
  const navigationDispatchObserver = injectedNavigationDispatchObserver;
  mkdirSync(dirname(databasePath), { recursive: true, mode: 0o700 });
  const store = new WorkRecordStore(databasePath);
  const api = createWorkRecordsApiHandler({ store, expectedToken: token });
  let privateMeetings;
  let applicationHandler = injectedApplicationHandler;
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
    const listenerRequests = new WeakSet();
    const socketStates = new WeakMap();
    const ownsListenerRequest = Object.freeze((candidate) => {
      try { return weakSetHas(listenerRequests, candidate); } catch { return false; }
    });
    const navigationHandler = composeTenantSkyscraperNavigation(
      tenantSkyscraperNavigation, ownsListenerRequest);
    privateMeetings = composePrivateMeetingSessions(meetingSessions);
    if (applicationHandler) {
      // Test-local final fallback supplied by the server caller.
    } else if (development) {
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
      try {
        try {
          weakSetAdd(listenerRequests, request);
          request.socket.once("close", () => weakSetDelete(listenerRequests, request));
        } catch {
          denyPrivateMeetingRoute(response);
          return;
        }
        let socketState = weakMapGet(socketStates, request.socket);
        if (!socketState) {
          socketState = { privateClaimed: false, parserFailed: false };
          weakMapSet(socketStates, request.socket, socketState);
        } else if (socketState.privateClaimed) {
          return;
        }
        const requestTarget = request.url ?? "";
        const rawPrivateTenantNamespace = reflectApply(regexpTest, RAW_PRIVATE_TENANT_NAMESPACE, [requestTarget]);
        const pathname = new URL(requestTarget || "/", "http://127.0.0.1").pathname;
        if (pathname === "/api/work-events") await api(request, response);
        else if (PRIVATE_MEETING_SESSIONS_ROUTE.test(pathname)) {
          if (privateMeetings) await privateMeetings.handler(request, response);
          else denyPrivateMeetingRoute(response);
        }
        else if (PRIVATE_MEETING_SESSIONS_NAMESPACE.test(pathname)) denyPrivateMeetingRoute(response);
        else if (PRIVATE_NAVIGATION_ROUTE.test(request.url ?? "")) {
          socketState.privateClaimed = true;
          response.shouldKeepAlive = false;
          response.setHeader("Connection", "close");
          await new Promise((resolveImmediate) => setImmediateIntrinsic(resolveImmediate));
          if (socketState.parserFailed) {
            response.destroy();
            return;
          }
          if (navigationHandler) {
            if (navigationDispatchObserver) reflectApply(navigationDispatchObserver, undefined, []);
            await navigationHandler(request, response);
          }
          else denyPrivateMeetingRoute(response);
        }
        else if (PRIVATE_NAVIGATION_NAMESPACE.test(pathname)) denyPrivateMeetingRoute(response);
        else if (PRIVATE_TENANT_NAMESPACE.test(pathname) || rawPrivateTenantNamespace) denyPrivateMeetingRoute(response);
        else await applicationHandler(request, response);
      } catch {
        let headersSent = true;
        try { headersSent = response.headersSent === true; } catch { /* assume partial write */ }
        if (!headersSent) {
          try {
            denyPrivateMeetingRoute(response);
            return;
          } catch { /* fall through to connection destruction */ }
        }
        try { response.destroy(); } catch { /* response unavailable */ }
      }
    });
    server.on("clientError", (_error, socket) => {
      let socketState = weakMapGet(socketStates, socket);
      if (!socketState) {
        socketState = { privateClaimed: false, parserFailed: true };
        weakMapSet(socketStates, socket, socketState);
      } else {
        socketState.parserFailed = true;
      }
      try { socket.destroy(); } catch {}
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
        let resolveServerClose;
        let rejectServerClose;
        const serverClose = new Promise((resolveClose, rejectClose) => {
          resolveServerClose = resolveClose;
          rejectServerClose = rejectClose;
        });
        try {
          server.close((error) => error ? rejectServerClose(error) : resolveServerClose());
        } catch (error) {
          rejectServerClose(error);
        }
        try { server.closeIdleConnections?.(); } catch (error) { failure = error; }
        try { server.closeAllConnections?.(); } catch (error) { failure ??= error; }
        try { await serverClose; } catch (error) { failure ??= error; }
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
