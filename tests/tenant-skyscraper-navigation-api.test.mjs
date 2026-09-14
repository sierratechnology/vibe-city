import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { createConnection, Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { startWorkRecordsServer } from "../server/index.mjs";

const MODULE_PATH = "../server/tenantSkyscraperNavigationApi.mjs";
const TENANT = "id_0000000000000001";
const CANONICAL_ROUTE = `/api/private/tenants/${TENANT}/skyscraper-navigation/decision`;
const BEARER = "Bearer synthetic-token";
const BUILDING = "id_0000000000000002";
const FLOOR = "id_0000000000000003";
const STOP = "id_0000000000000004";
const DESTINATION = "id_0000000000000005";
const SUBJECT = "id_0000000000000010";
const SESSION = "id_0000000000000011";
const AUTHORIZATION_REFERENCE = "id_0000000000000012";
const safeJsonParse = JSON.parse.bind(JSON);
const listenerRequests = new WeakSet();
let injectedModule = 0;


async function loadApi() {
  return import(MODULE_PATH).catch(() => ({}));
}

async function loadApiWithAuthorizer(createTenantSkyscraperNavigationAuthorizer) {
  const source = await readFile(new URL(MODULE_PATH, import.meta.url), "utf8");
  globalThis.__testNavigationAuthorizer = { createTenantSkyscraperNavigationAuthorizer };
  const injected = source.replace(
    /const DOMAIN_MODULE_PATH[^\n]+\nconst \{ createTenantSkyscraperNavigationAuthorizer \} = await import\(DOMAIN_MODULE_PATH\);/,
    "const { createTenantSkyscraperNavigationAuthorizer } = globalThis.__testNavigationAuthorizer;"
  );
  try {
    injectedModule += 1;
    return await import(`data:text/javascript;base64,${Buffer.from(injected).toString("base64")}#${injectedModule}`);
  } finally {
    delete globalThis.__testNavigationAuthorizer;
  }
}

function dependencies(overrides = {}) {
  return {
    now: () => "2000-01-01T00:30:00.000Z",
    resolveTrustedSession: () => null,
    resolveTrustedNavigationFacts: () => null,
    ownsListenerRequest: (request) => listenerRequests.has(request),
    ...overrides
  };
}

function directDependencies(overrides = {}) {
  return dependencies({ ...overrides, ownsListenerRequest: () => false });
}

function navigationHandlerSource(overrides = {}, loader = loadApi) {
  return {
    async createHandler({ ownsListenerRequest }) {
      const { createTenantSkyscraperNavigationApiHandler } = await loader();
      const values = typeof overrides === "function" ? overrides(ownsListenerRequest) : overrides;
      return createTenantSkyscraperNavigationApiHandler(dependencies({
        ownsListenerRequest, ...values
      }));
    }
  };
}

function validRawHeaders(bodyLength = 2) {
  return [
    "Authorization", BEARER,
    "Content-Length", String(bodyLength),
    "Content-Type", "application/json"
  ];
}

function navigationBody(overrides = {}) {
  return {
    schemaVersion: "1.0",
    channel: "door",
    buildingId: BUILDING,
    floorId: FLOOR,
    elevatorStopId: STOP,
    destinationId: DESTINATION,
    ...overrides
  };
}

function trustedSession(overrides = {}) {
  return { authenticated: true, sessionId: SESSION, subjectId: SUBJECT, ...overrides };
}

function factsFixture(accessState = "public") {
  const target = {
    destinationId: DESTINATION,
    floorId: FLOOR,
    displayName: "Synthetic Destination",
    lifecycle: "active",
    destinationKind: ["tenant", "private", "restricted"].includes(accessState) ? "suite" : "shared_space",
    accessState,
    ownerTenantId: accessState === "public" ? null : TENANT,
    sharedSpacePolicy: accessState === "public" ? "building_public"
      : accessState === "invited" ? "exact_invitation" : "not_shared"
  };
  const destinations = [1, 2, 3, 4].map((number) => ({
    destinationId: `id_000000000000010${number}`,
    floorId: FLOOR,
    displayName: `Synthetic Suite ${number}`,
    lifecycle: "active",
    destinationKind: "suite",
    accessState: "tenant",
    ownerTenantId: TENANT,
    sharedSpacePolicy: "not_shared"
  }));
  if (target.destinationKind === "suite") destinations[0] = target;
  else destinations.push(target);
  return {
    catalog: {
      schemaVersion: "1.0",
      building: {
        buildingId: BUILDING,
        displayName: "Synthetic Tower",
        lifecycle: "active",
        floors: [{
          floorId: FLOOR,
          buildingId: BUILDING,
          displayName: "Synthetic Floor",
          lifecycle: "active",
          floorKind: "customer",
          elevatorStopId: STOP,
          destinations
        }]
      }
    },
    activeTenantMembership: { tenantId: TENANT, subjectId: SUBJECT, active: true },
    ownerTenantLifecycles: [{ tenantId: TENANT, lifecycle: "active" }],
    invitation: accessState === "invited" ? {
      tenantId: TENANT,
      invitationId: "id_0000000000000013",
      subjectId: SUBJECT,
      destinationId: DESTINATION,
      lifecycle: "accepted",
      revision: 2,
      validFrom: "2000-01-01T00:00:00.000Z",
      expiresAt: "2000-01-01T01:00:00.000Z"
    } : null,
    privateDestinationGrants: accessState === "private"
      ? [{ tenantId: TENANT, subjectId: SUBJECT, destinationId: DESTINATION }] : [],
    restrictedDestinationAuthorities: accessState === "restricted"
      ? [{ tenantId: TENANT, subjectId: SUBJECT, destinationId: DESTINATION }] : [],
    authorizationReference: AUTHORIZATION_REFERENCE,
    policyRevision: 7
  };
}

function directRequest(handler, overrides = {}) {
  let status;
  let headers;
  let payload = "";
  let destroyed = false;
  const ownedSocket = overrides.requestValue ? undefined : new Socket();
  const { instrumentHeaders, instrumentIterator, requestValue, ...requestOverrides } = overrides;
  const request = requestValue ?? {
    method: "GET",
    url: "/",
    rawHeaders: [],
    socket: ownedSocket,
    aborted: false,
    complete: true,
    readableEnded: true,
    readableAborted: false,
    destroyed: false,
    async *[Symbol.asyncIterator]() {},
    ...requestOverrides
  };
  if (instrumentHeaders) {
    const rawHeaders = request.rawHeaders;
    Object.defineProperty(request, "rawHeaders", {
      configurable: true,
      enumerable: true,
      get() {
        instrumentHeaders.count += 1;
        return rawHeaders;
      }
    });
  }
  if (instrumentIterator) {
    const iterator = request[Symbol.asyncIterator];
    Object.defineProperty(request, Symbol.asyncIterator, {
      configurable: true,
      get() {
        instrumentIterator.count += 1;
        return iterator;
      }
    });
  }
  const response = {
    headersSent: false,
    writeHead(nextStatus, nextHeaders) {
      status = nextStatus;
      headers = Object.fromEntries(Object.entries(nextHeaders)
        .map(([key, value]) => [key.toLowerCase(), value]));
      this.headersSent = true;
    },
    end(chunk = "") { payload += chunk; },
    destroy() { destroyed = true; }
  };
  return Promise.resolve(handler(request, response)).then(() => ({
    status, headers, payload, body: payload === "" ? null : safeJsonParse(payload), destroyed
  })).finally(() => ownedSocket?.destroy());
}

async function requestWithBody(handlerSource, body, beforeHandler = () => {}, options = {}) {
  const payload = typeof body === "string" ? body : JSON.stringify(body);
  const deadlineAt = Date.now() + 2_000;
  const clients = new Set();
  const sockets = new Set();
  const servers = new Set();
  const runningServers = new Set();
  const directories = new Set();
  const listeners = new Set();
  const helperHandles = new Set();
  const barriers = new Set();
  const pending = new Map();
  const audit = options.audit ?? {};
  const abortController = new AbortController();
  let client;
  let server;
  let deadline;
  let closeCalls = 0;
  let barriersReleased = 0;
  let completed = false;
  const listen = (emitter, event, listener, once = false) => {
    emitter[once ? "once" : "on"](event, listener);
    listeners.add([emitter, event, listener]);
    return listener;
  };
  const addBarrier = (release) => {
    let released = false;
    const releaseOnce = () => {
      if (released) return;
      released = true;
      barriersReleased += 1;
      release();
    };
    barriers.add(releaseOnce);
    return releaseOnce;
  };
  const deadlinePromise = new Promise((_, reject) => {
    deadline = setTimeout(() => {
      abortController.abort();
      reject(new Error("loopback absolute deadline exceeded"));
    }, Math.max(0, deadlineAt - Date.now()));
    deadline.unref();
    helperHandles.add(deadline);
  });
  const throwIfCancelled = () => {
    if (abortController.signal.aborted || Date.now() >= deadlineAt)
      throw new Error("loopback absolute deadline exceeded");
  };
  const track = (work, cancellable = false) => {
    let cancel; let tracked = Promise.resolve().then(work);
    if (cancellable) tracked = Promise.race([tracked, new Promise((_, reject) => {
      cancel = () => reject(new Error("loopback tracked work cancelled")); })]);
    pending.set(tracked, cancel);
    tracked.then(() => pending.delete(tracked), () => pending.delete(tracked));
    return tracked;
  };
  const race = (work) => Promise.race([track(work), deadlinePromise]);
  try {
    if (options.inject === "setup") throw new Error("injected setup failure");
    const ownsListenerRequest = (request) => listenerRequests.has(request);
    const handler = handlerSource.startServer ? undefined : typeof handlerSource === "object"
      ? await race(() => handlerSource.createHandler({
        addBarrier, ownsListenerRequest, signal: abortController.signal
      }))
      : handlerSource;
    if (Date.now() >= deadlineAt) throw new Error("loopback absolute deadline exceeded");
    let endpoint;
    if (handlerSource.startServer) {
      endpoint = await race(async () => {
        let registeredServer; const registerServer = (running) => {
          if (registeredServer) throw new Error("loopback server already registered");
          registeredServer = running; runningServers.add(running); throwIfCancelled(); return running;
        };
        const running = await handlerSource.startServer({
          registerDirectory(directory) {
            directories.add(directory); throwIfCancelled();
          },
          registerServer,
          signal: abortController.signal,
          throwIfCancelled
        });
        throwIfCancelled();
        assert.equal(running, registeredServer, "loopback server must be registered before return");
        return running;
      });
      await race(() => options.inspectRunning?.(endpoint));
    } else {
      server = createServer();
      servers.add(server);
      listen(server, "request", async (request, response) => {
        listenerRequests.add(request);
        listen(request.socket, "close", () => listenerRequests.delete(request), true);
        const restoration = await beforeHandler(request, { listen, response });
        let restore = typeof restoration === "function" ? restoration : restoration?.run;
        const handling = handler(request, response);
        if (restoration?.afterHandlerStart) {
          await restore();
          restore = undefined;
        }
        try {
          await handling;
        } finally {
          await restore?.();
        }
      });
      listen(server, "connection", (socket) => {
        sockets.add(socket);
      });
      endpoint = server;
    }
    if (options.inject === "listen") throw new Error("injected listen failure");
    const wire = await race(async () => {
      await new Promise((resolveListen, rejectListen) => {
        if (handlerSource.startServer) return resolveListen();
        listen(server, "error", rejectListen, true);
        server.listen(0, "127.0.0.1", () => {
          server.off("error", rejectListen);
          resolveListen();
        });
      });
      return new Promise((resolveResponse, rejectResponse) => {
        let responseText = "";
        const address = handlerSource.startServer
          ? { host: endpoint.host, port: endpoint.port }
          : { host: "127.0.0.1", port: server.address().port };
        client = createConnection(address);
        clients.add(client);
        client.setEncoding("utf8");
        listen(client, "error", rejectResponse, true);
        listen(client, "data", (chunk) => { responseText += chunk; });
        listen(client, "end", () => resolveResponse(responseText), true);
        listen(client, "close", () => {
          if (options.resolveOnClose) resolveResponse(responseText);
        }, true);
        listen(client, "connect", () => {
          if (options.inject === "client") return rejectResponse(new Error("injected client failure"));
          client[options.contentLengthAdjustment ? "end" : "write"]([
          `${options.method ?? "POST"} ${options.path ?? CANONICAL_ROUTE} HTTP/1.1`, "Host: 127.0.0.1",
          `Authorization: ${BEARER}`,
          `Content-Length: ${Buffer.byteLength(payload) + (options.contentLengthAdjustment ?? 0)}`,
          "Content-Type: application/json", "Connection: close", "", payload
          ].join("\r\n"));
          track(() => options.afterWrite?.({
            client,
            destroyAcceptedSockets() { for (const socket of sockets) socket.destroy(); },
            signal: abortController.signal
          }), true)
            .catch(rejectResponse);
        }, true);
      });
    });
    await race(() => options.inspectWire?.(wire));
    const [head, responsePayload = ""] = wire.split("\r\n\r\n");
    const lines = head.split("\r\n");
    const status = Number(/^HTTP\/1\.1 (\d{3})/u.exec(lines.shift())?.[1]);
    const headers = Object.fromEntries(lines.map((line) => {
      const split = line.indexOf(":");
      const key = line.slice(0, split).toLowerCase();
      const value = line.slice(split + 1).trim();
      return [key, key === "content-length" ? Number(value) : value];
    }).filter(([key]) => key !== "date" && key !== "connection"));
    const result = {
      status, headers, payload: responsePayload,
      body: responsePayload === "" ? null : safeJsonParse(responsePayload), destroyed: false
    };
    await race(() => options.afterResponse?.(result));
    completed = true;
    return result;
  } finally {
    abortController.abort();
    for (const release of barriers) release();
    barriers.clear();
    const cancelledSuccessfulWork = completed && pending.size > 0;
    for (const cancel of pending.values()) cancel?.();
    for (const [emitter, event, listener] of listeners) emitter.off(event, listener);
    for (const [emitter, event, listener] of listeners) {
      assert.equal(emitter.listeners(event).includes(listener), false);
    }
    listeners.clear();
    for (const ownedClient of clients) ownedClient.destroy();
    for (const socket of sockets) socket.destroy();
    const disposed = new Set(); const dispose = () => { const cleanup = [];
      for (const ownedServer of servers) if (!disposed.has(ownedServer)) {
        disposed.add(ownedServer); ownedServer.closeAllConnections?.(); ownedServer.closeIdleConnections?.(); closeCalls += 1;
        cleanup.push(new Promise((resolveClose, rejectClose) => ownedServer.close((error) =>
          error && error.code !== "ERR_SERVER_NOT_RUNNING" ? rejectClose(error) : resolveClose())).then(() => servers.delete(ownedServer)));
      } for (const running of runningServers) if (!disposed.has(running)) {
        disposed.add(running); closeCalls += 1; cleanup.push(Promise.resolve().then(() => running.close()).then(() => runningServers.delete(running)));
      } for (const directory of directories) if (!disposed.has(directory)) {
        disposed.add(directory); cleanup.push((options.removeDirectory ?? rm)(directory, { force: true, recursive: true }).then(() => directories.delete(directory)));
      }
      return Promise.allSettled(cleanup); };
    const initialCleanup = dispose(); const pendingSettlement = Promise.allSettled([...pending.keys()]);
    const accountableSettlement = (async () => { const cleanupResults = await initialCleanup;
      const pendingResults = await pendingSettlement; cleanupResults.push(...await dispose()); return [pendingResults, cleanupResults]; })();
    const settlements = await Promise.race([accountableSettlement, deadlinePromise]).catch(() => undefined);
    const cleanupFailures = settlements?.[1].filter(({ status }) => status === "rejected") ?? [];
    clearTimeout(deadline);
    deadline?.unref();
    helperHandles.delete(deadline);
    assert.equal(deadline?.hasRef(), false);
    assert.equal(client ? client.destroyed : true, true);
    for (const socket of sockets) assert.equal(socket.destroyed, true);
    clients.clear();
    sockets.clear();
    Object.assign(audit, {
      cleanupSettled: settlements !== undefined, cleanupFailures: cleanupFailures.map(({ reason }) => reason), cleanupResult: settlements ? undefined : accountableSettlement,
      deadlineOwned: deadline !== undefined,
      deadlineCleared: helperHandles.size === 0 && !deadline?.hasRef(),
      barriersReleased,
      listeners: listeners.size, clients: clients.size, sockets: sockets.size,
      servers: servers.size, runningServers: runningServers.size,
      directories: directories.size,
      helperHandles: helperHandles.size + pending.size,
      closeCalls
    });
    assert.equal(clients.size, 0); assert.equal(sockets.size, 0);
    assert.equal(helperHandles.size, 0);
    if (settlements !== undefined) assert.equal(pending.size, 0);
    if (cleanupFailures.length > 0) {
      throw new AggregateError(cleanupFailures.map(({ reason }) => reason), "loopback cleanup failed");
    }
    if (settlements !== undefined) assert.equal(servers.size + runningServers.size + directories.size, 0);
    if (cancelledSuccessfulWork) throw new Error("loopback tracked work cancelled before completion");
  }
}

function productionCompositionSource({ createDirectory = (prefix) => mkdtemp(prefix), now = () => "2000-01-01T00:30:00.000Z", resolveTrustedSession = () => trustedSession(), resolveTrustedNavigationFacts = () => factsFixture() } = {}) {
  return { async startServer({ registerDirectory, registerServer, signal, throwIfCancelled }) {
    throwIfCancelled(); const directory = await createDirectory(join(tmpdir(), "vibe-navigation-"), signal);
    registerDirectory(directory); return registerServer(await startWorkRecordsServer({ development: true, port: 0, databasePath: join(directory, "work-records.sqlite"), tenantSkyscraperNavigation: { now, resolveTrustedSession, resolveTrustedNavigationFacts } }));
  } }; }

test("F1 Node v22 complete real IncomingMessage admits the safe lifecycle", { concurrency: false }, async () => {
  let requestCount = 0; let sessionCalls = 0; let factsCalls = 0; let clockCalls = 0; let tracerCalls = 0; let observedRequest;
  const result = await requestWithBody({
    async createHandler({ ownsListenerRequest }) {
      const { createTenantSkyscraperNavigationApiHandler } = await loadApiWithAuthorizer((options) =>
        Object.freeze(Object.assign(Object.create(null), {
          decideNavigation(request) {
            tracerCalls += 1;
            const destination = options.catalog.building.floors[0].destinations
              .find((value) => value.destinationId === request.destinationId);
            return Object.freeze(Object.assign(Object.create(null), {
              ok: true,
              decision: Object.freeze(Object.assign(Object.create(null), {
                schemaVersion: "1.0", allowed: true, code: "allowed", channel: request.channel,
                buildingId: request.buildingId, floorId: request.floorId,
                elevatorStopId: request.elevatorStopId, destinationId: request.destinationId,
                destinationKind: destination.destinationKind, accessState: destination.accessState,
                subjectId: options.authorization.authenticatedSubjectId,
                tenantId: destination.ownerTenantId,
                authorizationReference: options.authorization.authorizationReference,
                policyRevision: options.authorization.policyRevision,
                evaluatedAt: options.evaluatedAt, validUntil: null
              }))
            }));
          }
        })));
      return createTenantSkyscraperNavigationApiHandler(dependencies({
        ownsListenerRequest,
        now() { clockCalls += 1; return "2000-01-01T00:30:00.000Z"; },
        resolveTrustedSession() { sessionCalls += 1; return trustedSession(); },
        resolveTrustedNavigationFacts() { factsCalls += 1; return factsFixture(); }
      }));
    }
  }, navigationBody(), (request) => {
    requestCount += 1;
    observedRequest = request;
  }, {
    inspectWire(wire) {
      assert.equal((wire.match(/HTTP\/1\.1/gu) ?? []).length, 1);
      assert.equal(wire.includes(BEARER), false);
    }
  });
  assert.equal(requestCount, 1);
  assert.deepEqual({ aborted: observedRequest.aborted, complete: observedRequest.complete,
    readableEnded: observedRequest.readableEnded, readableAborted: observedRequest.readableAborted,
    destroyed: observedRequest.destroyed }, { aborted: false, complete: true, readableEnded: true, readableAborted: false, destroyed: true });
  assert.equal(result.status, 200);
  assert.deepEqual({ sessionCalls, factsCalls, clockCalls, tracerCalls }, { sessionCalls: 2, factsCalls: 2, clockCalls: 2, tracerCalls: 1 });
});

test("B1 exposes only the frozen private navigation handler factory and generic denial shell", async () => {
  const api = await loadApi();
  assert.deepEqual(Object.keys(api), ["createTenantSkyscraperNavigationApiHandler"]);
  assert.throws(() => api.createTenantSkyscraperNavigationApiHandler({}), TypeError);

  const handler = api.createTenantSkyscraperNavigationApiHandler(directDependencies());
  assert.equal(typeof handler, "function");
  assert.equal(Object.isFrozen(handler), true);
  const denied = await directRequest(handler);
  assert.equal(denied.status, 404);
  assert.deepEqual(denied.body, { error: "not_found" });
  assert.equal(denied.payload, '{"error":"not_found"}');
  assert.deepEqual(denied.headers, {
    "cache-control": "private, no-store",
    "content-length": 21,
    "content-type": "application/json; charset=utf-8",
    vary: "Authorization",
    "x-content-type-options": "nosniff"
  });
});

test("Decision A direct imports deny plain proxy forged and descriptor-cloned requests before trusted work", async () => {
  let sessionCalls = 0;
  let factsCalls = 0;
  let clockCalls = 0;
  let tracerCalls = 0;
  let proxyTraps = 0;
  const { createTenantSkyscraperNavigationApiHandler } = await loadApiWithAuthorizer(() => {
    tracerCalls += 1;
    throw new Error("Tracer 1 must remain unreachable");
  });
  const handler = createTenantSkyscraperNavigationApiHandler(directDependencies({
    now() { clockCalls += 1; return "2000-01-01T00:30:00.000Z"; },
    resolveTrustedSession() { sessionCalls += 1; return trustedSession(); },
    resolveTrustedNavigationFacts() { factsCalls += 1; return factsFixture(); }
  }));
  const detached = new Socket();
  try {
    const base = {
      method: "POST", url: CANONICAL_ROUTE, rawHeaders: validRawHeaders(),
      socket: {}, aborted: false, complete: true, readableEnded: true, readableAborted: false,
      async *[Symbol.asyncIterator]() { yield Buffer.from("{}"); }
    };
    const forgedSocket = Object.create(Socket.prototype);
    Object.defineProperties(forgedSocket, {
      _readableState: { configurable: true, enumerable: true, value: { destroyed: false }, writable: true },
      _writableState: { configurable: true, enumerable: true, value: { destroyed: false }, writable: true }
    });
    const descriptorClone = Object.defineProperties(
      Object.create(Object.getPrototypeOf(detached)), Object.getOwnPropertyDescriptors(detached));
    const accessorProxy = new Proxy(base, {
      get() { proxyTraps += 1; throw new Error("request get trap"); },
      getOwnPropertyDescriptor() { proxyTraps += 1; throw new Error("request descriptor trap"); },
      ownKeys() { proxyTraps += 1; throw new Error("request keys trap"); }
    });
    const requests = [
      base,
      new Proxy(base, {}),
      accessorProxy,
      { ...base, socket: forgedSocket },
      { ...base, socket: descriptorClone }
    ];
    for (const requestValue of requests) {
      const denied = await directRequest(handler, { requestValue });
      assert.equal(denied.status, 404);
      assert.equal(denied.payload, '{"error":"not_found"}');
    }
    assert.deepEqual({ sessionCalls, factsCalls, clockCalls, tracerCalls, proxyTraps },
      { sessionCalls: 0, factsCalls: 0, clockCalls: 0, tracerCalls: 0, proxyTraps: 0 });
  } finally {
    detached.destroy();
  }
});

test("Decision A direct imported factory denies a canonical request before trusted work", async () => {
  const counts = { session: 0, facts: 0, clock: 0 };
  const { createTenantSkyscraperNavigationApiHandler } = await loadApi();
  const handler = createTenantSkyscraperNavigationApiHandler(directDependencies({
    now() { counts.clock += 1; return "2000-01-01T00:30:00.000Z"; },
    resolveTrustedSession() { counts.session += 1; return trustedSession(); },
    resolveTrustedNavigationFacts() { counts.facts += 1; return factsFixture(); }
  }));
  const body = JSON.stringify(navigationBody());
  const denied = await directRequest(handler, {
    method: "POST",
    url: CANONICAL_ROUTE,
    rawHeaders: validRawHeaders(Buffer.byteLength(body)),
    async *[Symbol.asyncIterator]() { yield Buffer.from(body); }
  });
  assert.equal(denied.status, 404);
  assert.deepEqual(counts, { session: 0, facts: 0, clock: 0 });
});

test("Decision A enforces the owned lifecycle shell at G0 through G5", async () => {
  let activeGate;
  let activeRequest;
  let counts;
  const mutate = () => { activeRequest.aborted = true; };
  const loader = () => loadApiWithAuthorizer((options) =>
    Object.freeze(Object.assign(Object.create(null), {
      decideNavigation(request) {
        counts.tracer += 1;
        if (activeGate === "G3") mutate();
        const destination = options.catalog.building.floors[0].destinations
          .find((value) => value.destinationId === request.destinationId);
        return Object.freeze(Object.assign(Object.create(null), {
          ok: true,
          decision: Object.freeze(Object.assign(Object.create(null), {
            schemaVersion: "1.0", allowed: true, code: "allowed", channel: request.channel,
            buildingId: request.buildingId, floorId: request.floorId,
            elevatorStopId: request.elevatorStopId, destinationId: request.destinationId,
            destinationKind: destination.destinationKind, accessState: destination.accessState,
            subjectId: options.authorization.authenticatedSubjectId,
            tenantId: destination.ownerTenantId,
            authorizationReference: options.authorization.authorizationReference,
            policyRevision: options.authorization.policyRevision,
            evaluatedAt: options.evaluatedAt, validUntil: null
          }))
        }));
      }
    })));
  const expected = {
    G0: [0, 0, 0, 0], G1: [1, 0, 0, 0], G2: [1, 1, 0, 0],
    G3: [1, 1, 1, 1], G4: [2, 1, 1, 1], G5: [2, 2, 2, 1]
  };
  for (const gate of Object.keys(expected)) {
    activeGate = gate;
    counts = { session: 0, facts: 0, clock: 0, tracer: 0 };
    const handler = navigationHandlerSource({
      resolveTrustedSession() {
        counts.session += 1;
        if (gate === "G1" && counts.session === 1 || gate === "G4" && counts.session === 2) mutate();
        return trustedSession();
      },
      resolveTrustedNavigationFacts() {
        counts.facts += 1;
        if (gate === "G2" && counts.facts === 1 || gate === "G5" && counts.facts === 2) mutate();
        return factsFixture();
      },
      now() { counts.clock += 1; return "2000-01-01T00:30:00.000Z"; }
    }, loader);
    const denied = await requestWithBody(handler, navigationBody(), (request) => {
      activeRequest = request;
      if (gate === "G0") mutate();
    });
    if (gate === "G0") {
      assert.equal(Number.isNaN(denied.status), true, gate);
      assert.equal(denied.payload, "", gate);
    } else assert.equal(denied.status, 404, gate);
    assert.deepEqual(Object.values(counts), expected[gate], gate);
  }

  counts = { session: 0, facts: 0, clock: 0, tracer: 0 };
  const descriptorHandler = navigationHandlerSource({
    resolveTrustedSession() { counts.session += 1; return trustedSession(); }
  }, loader);
  const denied = await requestWithBody(descriptorHandler, navigationBody(), (request) => {
    Object.defineProperty(request, "socket", {
      configurable: true, enumerable: true, value: {}, writable: true
    });
  });
  assert.equal(denied.status, 404);
  assert.deepEqual(counts, { session: 0, facts: 0, clock: 0, tracer: 0 });
});

async function exercisePostBodyG0(mutateOnOwnershipCheck) {
  const counts = {
    session: 0, facts: 0, clock: 0, tracer: 0,
    application: 0, provider: 0, persistence: 0, networkSource: 0
  };
  let ownershipChecks = 0;
  let observed;
  const loader = () => loadApiWithAuthorizer(() => {
    counts.tracer += 1;
    throw new Error("Tracer 1 must remain unreachable at G0");
  });
  const handler = navigationHandlerSource((ownsListenerRequest) => ({
    ownsListenerRequest(request) {
      ownershipChecks += 1;
      const owned = ownsListenerRequest(request);
      if (ownershipChecks === mutateOnOwnershipCheck) {
        const descriptor = Object.getOwnPropertyDescriptor(request, "socket");
        observed = {
          owned,
          descriptor: descriptor && {
            configurable: descriptor.configurable,
            enumerable: descriptor.enumerable,
            value: descriptor.value,
            writable: descriptor.writable
          },
          socketDestroyed: descriptor?.value?.destroyed,
          aborted: request.aborted,
          complete: request.complete,
          readableEnded: request.readableEnded,
          readableAborted: request.readableAborted,
          url: request.url,
          method: request.method,
          rawHeaders: request.rawHeaders
        };
        request.aborted = true;
      }
      return owned;
    },
    resolveTrustedSession() { counts.session += 1; return trustedSession(); },
    resolveTrustedNavigationFacts() { counts.facts += 1; return factsFixture(); },
    now() { counts.clock += 1; return "2000-01-01T00:30:00.000Z"; }
  }), loader);
  const denied = await requestWithBody(handler, navigationBody());
  assert.equal(denied.status, 404);
  assert.deepEqual(counts, {
    session: 0, facts: 0, clock: 0, tracer: 0,
    application: 0, provider: 0, persistence: 0, networkSource: 0
  });
  assert.equal(observed.owned, true);
  assert.deepEqual({
    configurable: observed.descriptor.configurable,
    enumerable: observed.descriptor.enumerable,
    writable: observed.descriptor.writable,
    socketIdentity: observed.descriptor.value,
    socketDestroyed: observed.socketDestroyed,
    aborted: observed.aborted,
    complete: observed.complete,
    readableEnded: observed.readableEnded,
    readableAborted: observed.readableAborted,
    url: observed.url,
    method: observed.method,
    rawHeaders: observed.rawHeaders
  }, {
    configurable: true,
    enumerable: true,
    writable: true,
    socketIdentity: observed.descriptor.value,
    socketDestroyed: false,
    aborted: false,
    complete: true,
    readableEnded: true,
    readableAborted: false,
    url: CANONICAL_ROUTE,
    method: "POST",
    rawHeaders: [
      "Host", "127.0.0.1",
      ...validRawHeaders(Buffer.byteLength(JSON.stringify(navigationBody()))),
      "Connection", "close"
    ]
  });
  return ownershipChecks;
}

test("Decision A post-body G0 mutation denies before the first trusted resolver", async () => {
  assert.equal(await exercisePostBodyG0(2), 2);
});

test("Decision A immediate-pre-first-resolver G0 mutation is independently enforced", async () => {
  assert.equal(await exercisePostBodyG0(3), 3);
});

test("Decision A denies incomplete-body abort and complete-body disconnect at the real transport boundary", async () => {
  async function runTransportCase(mode) {
    const counts = { session: 0, facts: 0, clock: 0 };
    let activeRequest;
    let reachedSessionResolve;
    const reachedSession = new Promise((resolve) => { reachedSessionResolve = resolve; });
    let releaseSession;
    let requestSocketClosed;
    let transportOpen = true;
    const result = await requestWithBody({
      async createHandler({ addBarrier, ownsListenerRequest }) {
        const { createTenantSkyscraperNavigationApiHandler } = await loadApi();
        return createTenantSkyscraperNavigationApiHandler(dependencies({
          ownsListenerRequest: (request) => transportOpen && ownsListenerRequest(request),
          now: () => { counts.clock += 1; return "2026-08-23T12:00:00.000Z"; },
          resolveTrustedNavigationFacts: async () => { counts.facts += 1; return factsFixture(); },
          resolveTrustedSession: async () => {
            counts.session += 1;
            if (mode === "disconnect" && counts.session === 1) {
              reachedSessionResolve();
              await new Promise((resolve) => { releaseSession = addBarrier(resolve); });
            }
            return trustedSession();
          }
        }));
      }
    }, navigationBody(), (request, { listen }) => {
      activeRequest = request;
      requestSocketClosed = new Promise((resolve) => listen(request.socket, "close", resolve, true));
    }, {
      contentLengthAdjustment: mode === "incomplete" ? 1 : 0,
      resolveOnClose: true,
      async afterWrite({ client, destroyAcceptedSockets }) {
        if (mode !== "disconnect") return;
        await reachedSession;
        client.destroy();
        destroyAcceptedSockets();
        await requestSocketClosed;
        transportOpen = false;
        releaseSession();
      }
    });
    assert.equal(result.payload, "");
    return { counts, flags: {
      aborted: activeRequest.aborted,
      complete: activeRequest.complete,
      readableAborted: activeRequest.readableAborted,
      readableEnded: activeRequest.readableEnded
    } };
  }

  const incomplete = await runTransportCase("incomplete");
  assert.deepEqual(incomplete.counts, { session: 0, facts: 0, clock: 0 });
  assert.equal(incomplete.flags.aborted, true);
  assert.equal(incomplete.flags.complete, false);
  assert.equal(incomplete.flags.readableAborted, true);
  assert.equal(incomplete.flags.readableEnded, false);

  const disconnected = await runTransportCase("disconnect");
  assert.deepEqual(disconnected.counts, { session: 1, facts: 0, clock: 0 });
  assert.equal(disconnected.flags.complete, true);
  assert.equal(disconnected.flags.readableEnded, true);
});

test("Decision A loopback cleanup owns the deadline and closes every failure path", async () => {
  for (const mode of ["pass", "assertion", "setup", "factory", "listen", "client", "resolver", "timeout"]) {
    const audit = {};
    let resolverCalls = 0;
    const source = {
      async createHandler({ addBarrier, ownsListenerRequest, signal }) {
        const { createTenantSkyscraperNavigationApiHandler } = await loadApi();
        if (mode === "factory") throw new Error("injected factory failure");
        let heldResolver;
        if (mode === "timeout") {
          heldResolver = new Promise((resolve) => { addBarrier(resolve); });
        }
        return createTenantSkyscraperNavigationApiHandler(dependencies({
          ownsListenerRequest: (request) => !signal.aborted && ownsListenerRequest(request),
          async resolveTrustedSession() {
            resolverCalls += 1;
            if (mode === "resolver") throw new Error("injected real resolver failure");
            if (heldResolver) await heldResolver;
            return trustedSession();
          },
          resolveTrustedNavigationFacts: () => factsFixture()
        }));
      }
    };
    const run = requestWithBody(source, navigationBody(), () => {}, {
      audit,
      inject: ["setup", "listen", "client"].includes(mode) ? mode : undefined,
      afterResponse: mode === "assertion" ? () => assert.fail("injected assertion failure") : undefined
    });
    if (["pass", "resolver"].includes(mode)) await run;
    else await assert.rejects(run);
    if (["resolver", "timeout"].includes(mode)) assert.equal(resolverCalls, 1, mode);
    assert.deepEqual(audit, {
      cleanupSettled: mode !== "timeout", cleanupFailures: [], cleanupResult: mode === "timeout" ? audit.cleanupResult : undefined, deadlineOwned: true, deadlineCleared: true,
      barriersReleased: mode === "timeout" ? 1 : 0,
      listeners: 0, clients: 0, sockets: 0,
      servers: mode === "timeout" ? 1 : 0,
      runningServers: 0, directories: 0, helperHandles: mode === "timeout" ? 1 : 0,
      closeCalls: ["setup", "factory"].includes(mode) ? 0 : 1
    }, mode);
  }
});

test("Decision A loopback deadline bounds noncooperative tracked cleanup", {
  concurrency: false,
  timeout: 2_300
}, async () => {
  const startedAt = Date.now();
  const source = navigationHandlerSource({
    resolveTrustedSession: () => trustedSession(),
    resolveTrustedNavigationFacts: () => factsFixture()
  });
  await assert.rejects(requestWithBody(source, navigationBody(), () => {}, {
    afterWrite() { return new Promise(() => {}); }
  }), /loopback tracked work cancelled before completion/u);
  assert.ok(Date.now() - startedAt < 2_300, "cleanup exceeded the original absolute deadline");
});

test("Decision A loopback makes cooperative acquisition and cleanup accountable", async () => {
  const created = { server: 0, directory: 0 };
  const cancellationErrors = [];
  let startedAt = Date.now(); let guard = setTimeout(() => {}, 2_250);
  try {
    await assert.rejects(requestWithBody({ async startServer({ signal, throwIfCancelled }) {
      if (!signal.aborted) await new Promise((resolve) => signal.addEventListener("abort", resolve, { once: true }));
      for (const kind of Object.keys(created)) {
        try { throwIfCancelled(); created[kind] += 1; } catch (error) { cancellationErrors.push(error); }
      }
      throw cancellationErrors[0];
    } }, navigationBody()), /loopback absolute deadline exceeded/u);
  } finally { clearTimeout(guard); }
  assert.equal(cancellationErrors.length, 2);
  assert.equal(cancellationErrors.every(({ message }) => /loopback absolute deadline exceeded/u.test(message)), true);
  assert.deepEqual(created, { server: 0, directory: 0 });
  assert.ok(Date.now() - startedAt < 2_300, "acquisition cancellation exceeded the absolute deadline");

  let lateCloseCalls = 0; const lateAudit = {}; guard = setTimeout(() => {}, 2_250);
  try {
    await assert.rejects(requestWithBody({ async startServer({ signal, registerServer }) {
      const acquired = { close() { lateCloseCalls += 1; return Promise.resolve(); }, host: "127.0.0.1", port: 1 };
      if (!signal.aborted) await new Promise((resolve) => signal.addEventListener("abort", resolve, { once: true }));
      return registerServer(acquired);
    } }, navigationBody(), () => {}, { audit: lateAudit }), /loopback absolute deadline exceeded/u);
  } finally { clearTimeout(guard); }
  await lateAudit.cleanupResult; assert.equal(lateCloseCalls, 1);

  const unsettledAudit = {}; startedAt = Date.now();
  guard = setTimeout(() => {}, 2_250);
  try {
    await assert.rejects(requestWithBody({ async startServer({ registerServer }) { return registerServer({
      close() { return new Promise((resolve) => { const timer = setTimeout(resolve, 2_050); timer.unref(); }); },
      host: "127.0.0.1", port: 1
    }); } }, navigationBody(), () => {}, { audit: unsettledAudit }));
  } finally { clearTimeout(guard); }
  assert.equal(unsettledAudit.cleanupSettled, false);
  assert.equal(unsettledAudit.runningServers, 1); assert.equal(unsettledAudit.cleanupResult instanceof Promise, true);
  assert.ok(Date.now() - startedAt < 2_300, "unsettled cleanup exceeded the absolute deadline");

  const closeAudit = {};
  await assert.rejects(requestWithBody({ async startServer({ registerServer }) { return registerServer({
    close() { return Promise.reject(new Error("injected close failure")); }, host: "127.0.0.1", port: 1
  }); } }, navigationBody(), () => {}, { audit: closeAudit }), /loopback cleanup failed/u);
  assert.deepEqual({ settled: closeAudit.cleanupSettled, servers: closeAudit.runningServers, calls: closeAudit.closeCalls },
    { settled: true, servers: 1, calls: 1 });

  const directory = await mkdtemp(join(tmpdir(), "vibe-navigation-cleanup-"));
  const directoryAudit = {};
  try {
    await assert.rejects(requestWithBody({ async startServer({ registerDirectory, registerServer, throwIfCancelled }) {
      throwIfCancelled(); registerDirectory(directory); throwIfCancelled();
      return registerServer({ close() { return Promise.resolve(); }, host: "127.0.0.1", port: 1 });
    } }, navigationBody(), () => {}, {
      audit: directoryAudit, removeDirectory: () => Promise.reject(new Error("injected removal failure"))
    }), /loopback cleanup failed/u);
    assert.deepEqual({ settled: directoryAudit.cleanupSettled, directories: directoryAudit.directories },
      { settled: true, directories: 1 });
  } finally { await rm(directory, { force: true, recursive: true }); }
});

test("Decision A production composition registers a directory acquired before cancellation", async () => { let acquiredDirectory; let releaseRemoval; let removeCalls = 0; const audit = {}; const removalGate = new Promise((resolve) => { releaseRemoval = resolve; });
  const guard = setTimeout(() => {}, 2_250); try { await assert.rejects(requestWithBody(productionCompositionSource({ createDirectory: async (prefix, signal) => {
    acquiredDirectory = await mkdtemp(prefix); if (!signal.aborted) await new Promise((resolve) => signal.addEventListener("abort", resolve, { once: true })); return acquiredDirectory;
  } }), navigationBody(), () => {}, { audit, removeDirectory(directory, options) { assert.equal(directory, acquiredDirectory); removeCalls += 1;
    return removalGate.then(() => rm(directory, options)); } }), /loopback absolute deadline exceeded/u);
  const accountedDirectories = audit.directories; releaseRemoval(); await audit.cleanupResult; assert.equal(accountedDirectories, 1); assert.equal(removeCalls, 1);
  await assert.rejects(rm(acquiredDirectory, { recursive: true }), { code: "ENOENT" }); } finally { clearTimeout(guard); releaseRemoval?.(); await rm(acquiredDirectory, { force: true, recursive: true }); }
});

test("Decision A loopback deadline includes actual handler factory construction", async () => {
  await assert.rejects(requestWithBody({
    async createHandler({ ownsListenerRequest }) {
      const startedAt = Date.now();
      const { createTenantSkyscraperNavigationApiHandler } = await loadApi();
      while (Date.now() - startedAt <= 2_000) { /* exceed the absolute case deadline */ }
      return createTenantSkyscraperNavigationApiHandler(dependencies({ ownsListenerRequest }));
    }
  }, navigationBody()),
    /loopback absolute deadline exceeded/u);
});

test("Decision A production composition mounts only the exact private route and does not escape", async () => {
  let sessionCalls = 0; let factsCalls = 0; let clockCalls = 0;
  const source = () => productionCompositionSource({ now() { clockCalls += 1; return "2000-01-01T00:30:00.000Z"; }, resolveTrustedSession() { sessionCalls += 1; return trustedSession(); },
    resolveTrustedNavigationFacts() { factsCalls += 1; return factsFixture(); } });
  const success = await requestWithBody(source(), navigationBody(), () => {}, {
    inspectRunning(running) { assert.deepEqual(Object.keys(running), ["host", "port", "close"]);
      assert.deepEqual(Reflect.ownKeys(running), ["host", "port", "close"]); assert.equal(typeof running.close, "function"); }
  });
  assert.equal(success.status, 200); assert.deepEqual({ sessionCalls, factsCalls, clockCalls }, { sessionCalls: 2, factsCalls: 2, clockCalls: 2 });
  for (const path of [
    `${CANONICAL_ROUTE}/child`,
    `${CANONICAL_ROUTE}%2fchild`,
    CANONICAL_ROUTE.replace(TENANT, `${TENANT}%2fescape`),
    CANONICAL_ROUTE.replace("/skyscraper", "//skyscraper"),
    CANONICAL_ROUTE.replace("/skyscraper", "/%73kyscraper"),
    CANONICAL_ROUTE.replace(`/${TENANT}/`, `/${TENANT}%252f`),
    "/api/private/tenants?probe=1"
  ]) {
    const denied = await requestWithBody(source(), navigationBody(), () => {}, { path });
    assert.deepEqual({ status: denied.status, payload: denied.payload },
      { status: 404, payload: '{"error":"not_found"}' });
  }
  for (const path of [
    `/api/private/tenants/${TENANT}%2fskyscraper-navigation/decision`,
    `/api/private/tenants/${TENANT}%5cskyscraper-navigation/decision`
  ]) {
    const denied = await requestWithBody(source(), navigationBody(), () => {}, { method: "GET", path });
    assert.deepEqual({
      status: denied.status,
      contentType: denied.headers["content-type"],
      payload: denied.payload
    }, {
      status: 404,
      contentType: "application/json; charset=utf-8",
      payload: '{"error":"not_found"}'
    });
  }
  assert.deepEqual({ sessionCalls, factsCalls, clockCalls },
    { sessionCalls: 2, factsCalls: 2, clockCalls: 2 });
});

test("Decision A final trusted clock denies an invitation at its exclusive expiry", async () => {
  const calls = { session: 0, facts: 0, clock: 0 }; const denied = await requestWithBody(productionCompositionSource({
    now() { calls.clock += 1; return calls.clock === 1 ? "2000-01-01T00:30:00.000Z" : "2000-01-01T01:00:00.000Z"; }, resolveTrustedSession() { calls.session += 1; return trustedSession(); },
    resolveTrustedNavigationFacts() { calls.facts += 1; return factsFixture("invited"); } }), navigationBody());
  assert.deepEqual({ status: denied.status, contentType: denied.headers["content-type"], payload: denied.payload }, { status: 404, contentType: "application/json; charset=utf-8", payload: '{"error":"not_found"}' });
  assert.equal(denied.payload.includes(DESTINATION) || denied.payload.includes(BEARER), false); assert.deepEqual(calls, { session: 2, facts: 2, clock: 2 });
});

test("Decision A production listener fails closed for parser-accepted malformed request targets", { concurrency: false }, async () => {
  const calls = { session: 0, facts: 0, clock: 0 }; const unhandled = []; const onUnhandled = (reason) => { unhandled.push(reason); }; process.on("unhandledRejection", onUnhandled);
  try { for (const path of ["http://[", "//["]) {
      const result = await requestWithBody(productionCompositionSource({ now() { calls.clock += 1; return "2000-01-01T00:30:00.000Z"; }, resolveTrustedSession() { calls.session += 1; return trustedSession(); },
        resolveTrustedNavigationFacts() { calls.facts += 1; return factsFixture(); } }), {}, () => {}, { method: "GET", path, resolveOnClose: true });
      assert.deepEqual({ status: result.status, payload: result.payload }, { status: 404, payload: '{"error":"not_found"}' }, path);
      assert.equal(result.payload.includes(DESTINATION) || result.payload.includes(BEARER), false, path);
    } await new Promise((resolve) => setImmediate(resolve)); assert.deepEqual(unhandled, [], "malformed targets must not escape as unhandled rejections"); assert.deepEqual(calls, { session: 0, facts: 0, clock: 0 });
  } finally { process.off("unhandledRejection", onUnhandled); }
});

test("B2 admits only the canonical bounded raw tenant navigation route to header inspection", async () => {
  const tenant = TENANT;
  const canonical = CANONICAL_ROUTE;
  const cases = [
    [canonical, 1],
    [`${canonical}?next=1`, 0],
    [`${canonical}#next`, 0],
    [canonical.replace(tenant, `${tenant}%2fescape`), 0],
    [canonical.replace(tenant, `${tenant}%5Cescape`), 0],
    [canonical.replace(tenant, `${tenant}\\escape`), 0],
    [canonical.replace(tenant, `${tenant}/escape`), 0],
    [canonical.replace("/skyscraper", "//skyscraper"), 0],
    [canonical.replace(tenant, "."), 0],
    [canonical.replace(tenant, ".."), 0],
    [`${canonical}/`, 0],
    [`/${"a".repeat(255)}`, 0],
    [`/${"a".repeat(256)}`, 0]
  ];
  for (const [url, expectedHeaderReads] of cases) {
    const reads = { count: 0 };
    const denied = await requestWithBody(navigationHandlerSource(), {}, (request) => {
      const rawHeaders = request.rawHeaders;
      Object.defineProperty(request, "rawHeaders", {
        configurable: true,
        enumerable: true,
        get() { reads.count += 1; return rawHeaders; }
      });
    }, { path: url });
    assert.equal(denied.status, 404, url);
    assert.equal(reads.count, expectedHeaderReads, url);
  }
});

test("B3 requires exact uppercase POST before header inspection or trusted resolution", async () => {
  let trustedCalls = 0;
  const source = navigationHandlerSource({
    resolveTrustedSession() { trustedCalls += 1; return null; }
  });
  const url = CANONICAL_ROUTE;
  for (const [method, expectedHeaderReads] of [["POST", 1], ["post", 0], ["GET", 0], ["PUT", 0]]) {
    const reads = { count: 0 };
    const denied = await requestWithBody(source, {}, (request) => {
      request.method = method;
      const rawHeaders = request.rawHeaders;
      Object.defineProperty(request, "rawHeaders", {
        configurable: true,
        enumerable: true,
        get() { reads.count += 1; return rawHeaders; }
      });
    }, { path: url });
    assert.equal(denied.status, 404, method);
    assert.equal(reads.count, expectedHeaderReads, method);
  }
  assert.equal(trustedCalls, 0);
});

test("B4 closes raw-header shape byte lexical and ordinary-duplicate limits before body access", async () => {
  const source = navigationHandlerSource();
  const base = validRawHeaders();
  const pairs64 = [...base];
  for (let index = 0; index < 61; index += 1) pairs64.push("X-Ordinary", String(index));
  const pairs65 = [...pairs64, "X-Overflow", "1"];
  const baseBytes = base.reduce((total, value) => total + Buffer.byteLength(value), 0);
  const bytes16384 = [...base, "X-Pad", "a".repeat(16_384 - baseBytes - 5)];
  const bytes16385 = [...base, "X-Pad", "a".repeat(16_385 - baseBytes - 5)];
  const cases = [
    [base, 1],
    [[...base, "Accept", "application/json", "Accept", "text/plain"], 1],
    [pairs64, 1],
    [pairs65, 0],
    [bytes16384, 1],
    [bytes16385, 0],
    [[...base, "Dangling"], 0],
    [[...base, "", "value"], 0],
    [[...base, "Bad Name", "value"], 0],
    [[...base, "Bad\nName", "value"], 0],
    [[...base, "X-Control", "bad\rvalue"], 0],
    [[...base, "X-Control", "bad\0value"], 0],
    [[...base, "X-Control", "bad\u007fvalue"], 0],
    [[...base, "X-Unicode", "\ud800"], 0],
    [new Proxy(base, {}), 0]
  ];
  for (const [caseIndex, [rawHeaders, expectedIteratorReads]] of cases.entries()) {
    const reads = { count: 0 };
    const denied = await requestWithBody(source, {}, (request) => {
      request.rawHeaders = rawHeaders;
      const iterator = request[Symbol.asyncIterator];
      Object.defineProperty(request, Symbol.asyncIterator, {
        configurable: true,
        get() { reads.count += 1; return iterator; }
      });
    });
    assert.equal(denied.status, 404);
    assert.equal(reads.count, expectedIteratorReads, `header case ${caseIndex}`);
  }
});

test("B5 requires one exact bounded Bearer authorization value before body access", async () => {
  const source = navigationHandlerSource();
  const withAuthorization = (value) => [
    "Authorization", value,
    "Content-Length", "2",
    "Content-Type", "application/json"
  ];
  const cases = [
    [withAuthorization(BEARER), 1],
    [withAuthorization(`Bearer ${"a".repeat(256)}`), 1],
    [withAuthorization(`Bearer ${"a".repeat(257)}`), 0],
    [validRawHeaders().slice(2), 0],
    [[...validRawHeaders(), "authorization", BEARER], 0],
    [withAuthorization("bearer synthetic-token"), 0],
    [withAuthorization("Basic synthetic-token"), 0],
    [withAuthorization("Bearer  synthetic-token"), 0],
    [withAuthorization("Bearer\tsynthetic-token"), 0],
    [withAuthorization("Bearer synthetic,token"), 0],
    [withAuthorization("Bearer "), 0],
    [withAuthorization("Bearer synthetic=token"), 0],
    [withAuthorization("Bearer synthetic@token"), 0]
  ];
  for (const [caseIndex, [rawHeaders, expectedIteratorReads]] of cases.entries()) {
    const reads = { count: 0 };
    await requestWithBody(source, {}, (request) => {
      request.rawHeaders = rawHeaders;
      const iterator = request[Symbol.asyncIterator];
      Object.defineProperty(request, Symbol.asyncIterator, {
        configurable: true,
        get() { reads.count += 1; return iterator; }
      });
    });
    assert.equal(reads.count, expectedIteratorReads, `authorization case ${caseIndex}`);
  }
});

test("B6 enforces exact length type framing and yielded-body byte limits before trusted resolution", async () => {
  let trustedCalls = 0;
  const source = navigationHandlerSource({
    resolveTrustedSession() { trustedCalls += 1; return null; }
  });
  const headers = ({ length = "2", type = "application/json", extra = [], omitLength = false } = {}) => [
    "Authorization", BEARER,
    ...(omitLength ? [] : ["Content-Length", length]),
    ...(type === null ? [] : ["Content-Type", type]),
    ...extra
  ];
  async function run(rawHeaders, chunks, requestOverrides = {}) {
    let yielded = 0;
    const result = await requestWithBody(source, {}, (request) => {
      request.rawHeaders = rawHeaders;
      Object.assign(request, requestOverrides);
      Object.defineProperty(request, Symbol.asyncIterator, {
        configurable: true,
        value: async function* () {
        for (const chunk of chunks) {
          yielded += 1;
          yield chunk;
        }
        }
      });
    });
    return { ...result, yielded };
  }
  assert.equal((await run(headers(), [Buffer.from("{}")])).yielded, 1);
  assert.equal((await run(headers({ length: "2048" }), [Buffer.alloc(2048, 32)])).yielded, 1);
  assert.equal((await run(headers({ length: "3" }), [Buffer.from("{}")])).yielded, 1);
  assert.equal((await run(headers(), [Buffer.from("{}"), Buffer.from("x"), Buffer.from("marker")])).yielded, 2);
  assert.equal((await run(headers(), [new Uint8Array(Buffer.from("{}"))])).yielded, 1);
  assert.equal((await run(headers(), ["{}"])).yielded, 1);
  assert.equal((await run(headers(), [Buffer.from([0xc3, 0x28])])).yielded, 1);
  for (const rawHeaders of [
    headers({ omitLength: true }),
    [...headers(), "Content-Length", "2"],
    headers({ length: "02" }),
    headers({ length: "1" }),
    headers({ length: "2049" }),
    headers({ length: String(Number.MAX_SAFE_INTEGER + 1) }),
    headers({ type: null }),
    headers({ type: "application/json; charset=utf-8" }),
    headers({ extra: ["Transfer-Encoding", "chunked"] })
  ]) {
    assert.equal((await run(rawHeaders, [Buffer.from("{}")])).yielded, 0);
  }
  assert.equal((await run(headers({ type: "Application/JSON" }), [Buffer.from("{}")])).yielded, 1);
  assert.equal((await run(headers(), [Buffer.from("{}")], { aborted: true })).status, 404);
  assert.equal((await run(headers(), [Buffer.from("{}")], { destroyed: true })).status, 404);
  assert.equal(trustedCalls, 0);
});

test("B7 admits only one bounded unambiguous exact navigation request schema", async () => {
  const { createTenantSkyscraperNavigationApiHandler } = await loadApi();
  let trustedCalls = 0;
  const handler = createTenantSkyscraperNavigationApiHandler(dependencies({
    resolveTrustedSession() { trustedCalls += 1; return null; }
  }));
  await requestWithBody(handler, navigationBody());
  assert.equal(trustedCalls, 1);
  const duplicate = JSON.stringify(navigationBody()).replace("{", '{"channel":"door",');
  const attacks = [
    "",
    "{",
    duplicate,
    `${JSON.stringify(navigationBody())}{}`,
    JSON.stringify({ ...navigationBody(), unknown: "marker" }),
    JSON.stringify({ ...navigationBody(), schemaVersion: undefined }),
    JSON.stringify({ ...navigationBody(), schemaVersion: "2.0" }),
    JSON.stringify({ ...navigationBody(), channel: "unsupported" }),
    JSON.stringify({ ...navigationBody(), buildingId: "id_NOT_CANONICAL" }),
    JSON.stringify({ ...navigationBody(), destinationId: "\ud800" }),
    '{"schemaVersion":"1.0","channel":"door","buildingId":01}',
    JSON.stringify({ nested: { deeper: { tooDeep: true } } }),
    JSON.stringify(Array.from({ length: 9 }, () => [])),
    JSON.stringify(Array.from({ length: 33 }, (_, index) => index)),
    JSON.stringify({ ["k".repeat(33)]: true })
  ];
  for (const attack of attacks) {
    const before = trustedCalls;
    const denied = await requestWithBody(handler, attack);
    assert.equal(denied.status, 404);
    assert.equal(trustedCalls, before, attack.slice(0, 48));
  }
});

test("B8 requires exact trusted session and active same-subject route-tenant facts", async () => {
  const { createTenantSkyscraperNavigationApiHandler } = await loadApi();
  let factsCalls = 0;
  let nowCalls = 0;
  const sourceSession = trustedSession();
  const facts = factsFixture();
  const handler = createTenantSkyscraperNavigationApiHandler(dependencies({
    now() { nowCalls += 1; return "2000-01-01T00:30:00.000Z"; },
    resolveTrustedSession: () => sourceSession,
    resolveTrustedNavigationFacts({ session, tenantId }) {
      factsCalls += 1;
      assert.equal(session, sourceSession);
      assert.equal(tenantId, TENANT);
      return facts;
    }
  }));
  await requestWithBody(handler, navigationBody());
  assert.equal(factsCalls, 2);

  for (const resolveTrustedSession of [
    () => null,
    () => { throw new Error("session marker"); },
    async () => { throw new Error("session rejection marker"); },
    () => trustedSession({ authenticated: false }),
    () => trustedSession({ subjectId: "not-an-id" }),
    () => ({ ...trustedSession(), role: "administrator" })
  ]) {
    let deeperFactsCalls = 0;
    const deniedHandler = createTenantSkyscraperNavigationApiHandler(dependencies({
      resolveTrustedSession,
      resolveTrustedNavigationFacts() { deeperFactsCalls += 1; return factsFixture(); }
    }));
    assert.equal((await requestWithBody(deniedHandler, navigationBody())).status, 404);
    assert.equal(deeperFactsCalls, 0);
  }

  for (const mutate of [
    (value) => { value.activeTenantMembership.active = false; },
    (value) => { value.activeTenantMembership.tenantId = "id_ffffffffffffffff"; },
    (value) => { value.activeTenantMembership.subjectId = "id_ffffffffffffffff"; },
    (value) => { value.authorizationReference = "not-an-id"; },
    (value) => { value.policyRevision = 0; }
  ]) {
    const changed = factsFixture();
    mutate(changed);
    let changedNowCalls = 0;
    const deniedHandler = createTenantSkyscraperNavigationApiHandler(dependencies({
      now() { changedNowCalls += 1; return "2000-01-01T00:30:00.000Z"; },
      resolveTrustedSession: () => trustedSession(),
      resolveTrustedNavigationFacts: () => changed
    }));
    assert.equal((await requestWithBody(deniedHandler, navigationBody())).status, 404);
    assert.equal(changedNowCalls, 0);
  }

  const clientAuthority = { ...navigationBody(), tenantId: TENANT, subjectId: SUBJECT, role: "admin" };
  let clientSessionCalls = 0;
  const clientHandler = createTenantSkyscraperNavigationApiHandler(dependencies({
    resolveTrustedSession() { clientSessionCalls += 1; return trustedSession(); }
  }));
  await requestWithBody(clientHandler, clientAuthority);
  assert.equal(clientSessionCalls, 0);
  assert.equal(nowCalls, 2);
});

test("B9 preserves all access states and navigation channels through released Tracer 1", async () => {
  const { createTenantSkyscraperNavigationApiHandler } = await loadApi();
  for (const accessState of ["public", "tenant", "invited", "private", "restricted"]) {
    for (const channel of ["door", "elevator", "direct", "alternative"]) {
      let sessionCalls = 0;
      const handler = createTenantSkyscraperNavigationApiHandler(dependencies({
        resolveTrustedSession() { sessionCalls += 1; return trustedSession(); },
        resolveTrustedNavigationFacts: () => factsFixture(accessState)
      }));
      const success = await requestWithBody(handler, navigationBody({ channel }));
      assert.equal(success.status, 200);
      assert.equal(sessionCalls, 2, `${accessState}/${channel}`);
    }
  }

  for (const [accessState, mutate] of [
    ["invited", (value) => { value.ownerTenantLifecycles[0].lifecycle = "archived"; }],
    ["private", (value) => { value.ownerTenantLifecycles[0].lifecycle = "archived"; }],
    ["restricted", (value) => { value.ownerTenantLifecycles[0].lifecycle = "deleted_tombstone"; }],
    ["private", (value) => { value.privateDestinationGrants = []; }],
    ["restricted", (value) => { value.restrictedDestinationAuthorities = []; }],
    ["invited", (value) => { value.invitation = null; }]
  ]) {
    const facts = factsFixture(accessState);
    mutate(facts);
    let sessionCalls = 0;
    const handler = createTenantSkyscraperNavigationApiHandler(dependencies({
      resolveTrustedSession() { sessionCalls += 1; return trustedSession(); },
      resolveTrustedNavigationFacts: () => facts
    }));
    await requestWithBody(handler, navigationBody());
    assert.ok(sessionCalls <= 1, `${accessState} denied without second trusted resolution`);
  }

  const crossTenantFacts = factsFixture("private");
  crossTenantFacts.catalog.building.floors[0].destinations[0].ownerTenantId = "id_ffffffffffffffff";
  crossTenantFacts.ownerTenantLifecycles[0].tenantId = "id_ffffffffffffffff";
  crossTenantFacts.privateDestinationGrants[0].tenantId = "id_ffffffffffffffff";
  const crossTenantHandler = createTenantSkyscraperNavigationApiHandler(dependencies({
    resolveTrustedSession: () => trustedSession(),
    resolveTrustedNavigationFacts: () => crossTenantFacts
  }));
  assert.equal((await requestWithBody(crossTenantHandler, navigationBody())).status, 404);

  const invitedCrossTenantFacts = factsFixture("invited");
  invitedCrossTenantFacts.catalog.building.floors[0].destinations.at(-1).ownerTenantId = "id_ffffffffffffffff";
  invitedCrossTenantFacts.ownerTenantLifecycles.push({ tenantId: "id_ffffffffffffffff", lifecycle: "active" });
  invitedCrossTenantFacts.invitation.tenantId = "id_ffffffffffffffff";
  const invitedCrossTenantHandler = createTenantSkyscraperNavigationApiHandler(dependencies({
    resolveTrustedSession: () => trustedSession(),
    resolveTrustedNavigationFacts: () => invitedCrossTenantFacts
  }));
  assert.equal((await requestWithBody(invitedCrossTenantHandler, navigationBody())).status, 404);
});

test("B10 closes trusted graphs and survives post-import intrinsic tampering", async () => {
  const { createTenantSkyscraperNavigationApiHandler } = await loadApi();
  for (const factsSource of [
    new Proxy(factsFixture(), {}),
    Object.assign(Object.create({ inherited: true }), factsFixture()),
    Object.defineProperty(factsFixture(), "marker", { value: true, enumerable: false }),
    Object.defineProperty(factsFixture(), "catalog", { get() { return {}; }, enumerable: true }),
    Object.assign(factsFixture(), { [Symbol("marker")]: true }),
    (() => { const value = factsFixture(); value.policyRevision = new Number(7); return value; })(),
    (() => { const value = factsFixture(); value.catalog.loop = value; return value; })(),
    (() => { const value = factsFixture(); value.invitation = value.activeTenantMembership; return value; })(),
    (() => { const value = factsFixture(); value.privateDestinationGrants = Array(513).fill(null); return value; })(),
    (() => { const value = factsFixture(); value.catalog.building.displayName = "x".repeat(524_289); return value; })()
  ]) {
    let sessionCalls = 0;
    const handler = createTenantSkyscraperNavigationApiHandler(dependencies({
      resolveTrustedSession() { sessionCalls += 1; return trustedSession(); },
      resolveTrustedNavigationFacts: () => factsSource
    }));
    await requestWithBody(handler, navigationBody());
    assert.equal(sessionCalls, 1);
  }

  const body = JSON.stringify(navigationBody());
  const saved = {
    objectCreate: Object.create,
    objectIs: Object.is,
    jsonParse: JSON.parse,
    regexpTest: RegExp.prototype.test,
    stringToLowerCase: String.prototype.toLowerCase,
    bufferByteLength: Buffer.byteLength
  };
  let sessionCalls = 0;
  const source = navigationHandlerSource({
    resolveTrustedSession() { sessionCalls += 1; return trustedSession(); },
    resolveTrustedNavigationFacts: () => factsFixture()
  });
  await requestWithBody(source, body, () => {
    Object.create = () => { throw new Error("tampered create"); };
    Object.is = () => { throw new Error("tampered is"); };
    JSON.parse = () => { throw new Error("tampered parse"); };
    RegExp.prototype.test = () => { throw new Error("tampered test"); };
    String.prototype.toLowerCase = () => { throw new Error("tampered lowercase"); };
    Buffer.byteLength = () => { throw new Error("tampered byteLength"); };
    return () => {
      Object.create = saved.objectCreate;
      Object.is = saved.objectIs;
      JSON.parse = saved.jsonParse;
      RegExp.prototype.test = saved.regexpTest;
      String.prototype.toLowerCase = saved.stringToLowerCase;
      Buffer.byteLength = saved.bufferByteLength;
    };
  });
  assert.equal(sessionCalls, 2);
});

test("B10 captures RegExp exec and array iteration before post-import replacement", async () => {
  let sessionCalls = 0;
  const source = navigationHandlerSource({
    resolveTrustedSession() { sessionCalls += 1; return null; }
  });
  const savedExec = RegExp.prototype.exec;
  const savedIterator = Array.prototype[Symbol.iterator];
  const denied = await requestWithBody(source, navigationBody(), () => {
    RegExp.prototype.exec = () => { throw new Error("tampered exec"); };
    Array.prototype[Symbol.iterator] = () => { throw new Error("tampered iterator"); };
    return {
      afterHandlerStart: true,
      run() {
        RegExp.prototype.exec = savedExec;
        Array.prototype[Symbol.iterator] = savedIterator;
      }
    };
  });
  assert.equal(denied.status, 404);
  assert.equal(sessionCalls, 1);
});

test("B11 emits only the exact private success envelope or the generic 404 denial", async () => {
  const { createTenantSkyscraperNavigationApiHandler } = await loadApi();
  const handler = createTenantSkyscraperNavigationApiHandler(dependencies({
    resolveTrustedSession: () => trustedSession(),
    resolveTrustedNavigationFacts: () => factsFixture()
  }));
  const success = await requestWithBody(handler, navigationBody());
  assert.equal(success.status, 200);
  assert.deepEqual(success.headers, {
    "cache-control": "private, no-store",
    "content-length": Buffer.byteLength(success.payload),
    "content-type": "application/json; charset=utf-8",
    vary: "Authorization",
    "x-content-type-options": "nosniff"
  });
  assert.deepEqual(success.body, {
    decision: {
      schemaVersion: "1.0",
      allowed: true,
      code: "allowed",
      channel: "door",
      buildingId: BUILDING,
      floorId: FLOOR,
      elevatorStopId: STOP,
      destinationId: DESTINATION,
      destinationKind: "shared_space",
      accessState: "public",
      subjectId: SUBJECT,
      tenantId: null,
      authorizationReference: AUTHORIZATION_REFERENCE,
      policyRevision: 7,
      evaluatedAt: "2000-01-01T00:30:00.000Z",
      validUntil: null
    }
  });
  assert.deepEqual(Object.keys(success.body), ["decision"]);
  assert.equal(success.payload.includes(BEARER), false);
  assert.equal(success.payload.includes("role"), false);

  const denied = await requestWithBody(handler, { ...navigationBody(), role: "admin" });
  assert.deepEqual(denied, {
    status: 404,
    headers: {
      "cache-control": "private, no-store",
      "content-length": 21,
      "content-type": "application/json; charset=utf-8",
      vary: "Authorization",
      "x-content-type-options": "nosniff"
    },
    payload: '{"error":"not_found"}',
    body: { error: "not_found" },
    destroyed: false
  });
});

test("B11 rejects a malformed Tracer 1 success decision before writing success", async () => {
  const validDecision = (overrides = {}, freeze = true, prototype = null) => {
    const value = Object.assign(Object.create(prototype), {
      schemaVersion: "1.0", allowed: true, code: "allowed", channel: "door",
      buildingId: BUILDING, floorId: FLOOR, elevatorStopId: STOP, destinationId: DESTINATION,
      destinationKind: "shared_space", accessState: "public", subjectId: SUBJECT, tenantId: null,
      authorizationReference: AUTHORIZATION_REFERENCE, policyRevision: 7,
      evaluatedAt: "2000-01-01T00:30:00.000Z", validUntil: null
    }, overrides);
    return freeze ? Object.freeze(value) : value;
  };
  const exactResult = (decision) => Object.freeze(Object.assign(Object.create(null), { ok: true, decision }));
  let result;
  const { createTenantSkyscraperNavigationApiHandler } = await loadApiWithAuthorizer(() =>
    Object.freeze(Object.assign(Object.create(null), { decideNavigation: () => result })));
  const handler = createTenantSkyscraperNavigationApiHandler(dependencies({
    resolveTrustedSession: () => trustedSession(),
    resolveTrustedNavigationFacts: () => factsFixture()
  }));
  const malformed = [
    { ok: true, decision: validDecision() },
    exactResult(validDecision({}, false)),
    exactResult(validDecision({}, true, Object.prototype)),
    ...[
      ["schemaVersion", "marker"], ["allowed", false], ["code", "denied"], ["channel", "direct"],
      ["buildingId", "id_ffffffffffffffff"], ["floorId", "id_ffffffffffffffff"],
      ["elevatorStopId", "id_ffffffffffffffff"], ["destinationId", "id_ffffffffffffffff"],
      ["destinationKind", "suite"], ["accessState", "tenant"], ["subjectId", "id_ffffffffffffffff"],
      ["tenantId", TENANT], ["authorizationReference", "id_ffffffffffffffff"],
      ["policyRevision", 8], ["evaluatedAt", "2000-01-01T00:30:01.000Z"],
      ["validUntil", "2000-01-01T01:00:00.000Z"]
    ].map(([key, value]) => exactResult(validDecision({ [key]: value })))
  ];
  for (const malformedResult of malformed) {
    result = malformedResult;
    assert.equal((await requestWithBody(handler, navigationBody())).status, 404);
  }
});

test("B11 rejects an extensible descriptor-closed Tracer 1 success result shell", async () => {
  const decision = Object.freeze(Object.assign(Object.create(null), {
    schemaVersion: "1.0", allowed: true, code: "allowed", channel: "door",
    buildingId: BUILDING, floorId: FLOOR, elevatorStopId: STOP, destinationId: DESTINATION,
    destinationKind: "shared_space", accessState: "public", subjectId: SUBJECT, tenantId: null,
    authorizationReference: AUTHORIZATION_REFERENCE, policyRevision: 7,
    evaluatedAt: "2000-01-01T00:30:00.000Z", validUntil: null
  }));
  const result = Object.create(null);
  Object.defineProperties(result, {
    ok: { configurable: false, enumerable: true, value: true, writable: false },
    decision: { configurable: false, enumerable: true, value: decision, writable: false }
  });
  assert.equal(Object.isExtensible(result), true);
  const { createTenantSkyscraperNavigationApiHandler } = await loadApiWithAuthorizer(() =>
    Object.freeze(Object.assign(Object.create(null), { decideNavigation: () => result })));
  const handler = createTenantSkyscraperNavigationApiHandler(dependencies({
    resolveTrustedSession: () => trustedSession(),
    resolveTrustedNavigationFacts: () => factsFixture()
  }));

  assert.equal((await requestWithBody(handler, navigationBody())).status, 404);
});

test("B11 rejects an extensible descriptor-closed Tracer 1 success decision shell", async () => {
  const decision = Object.create(null);
  const values = {
    schemaVersion: "1.0", allowed: true, code: "allowed", channel: "door",
    buildingId: BUILDING, floorId: FLOOR, elevatorStopId: STOP, destinationId: DESTINATION,
    destinationKind: "shared_space", accessState: "public", subjectId: SUBJECT, tenantId: null,
    authorizationReference: AUTHORIZATION_REFERENCE, policyRevision: 7,
    evaluatedAt: "2000-01-01T00:30:00.000Z", validUntil: null
  };
  for (const [key, value] of Object.entries(values)) {
    Object.defineProperty(decision, key, {
      configurable: false, enumerable: true, value, writable: false
    });
  }
  assert.equal(Object.isExtensible(decision), true);
  const result = Object.freeze(Object.assign(Object.create(null), { ok: true, decision }));
  const { createTenantSkyscraperNavigationApiHandler } = await loadApiWithAuthorizer(() =>
    Object.freeze(Object.assign(Object.create(null), { decideNavigation: () => result })));
  const handler = createTenantSkyscraperNavigationApiHandler(dependencies({
    resolveTrustedSession: () => trustedSession(),
    resolveTrustedNavigationFacts: () => factsFixture()
  }));

  assert.equal((await requestWithBody(handler, navigationBody())).status, 404);
});

test("B11 denies when a trusted resolver mutates the request shell", async () => {
  const { createTenantSkyscraperNavigationApiHandler } = await loadApi();
  let sessionCalls = 0;
  const handler = createTenantSkyscraperNavigationApiHandler(dependencies({
    resolveTrustedSession(request) {
      sessionCalls += 1;
      if (sessionCalls === 1) request.url = "/mutated-by-resolver";
      return trustedSession();
    },
    resolveTrustedNavigationFacts: () => factsFixture()
  }));
  assert.equal((await requestWithBody(handler, navigationBody())).status, 404);
  assert.equal(sessionCalls, 1);
});

test("B11 denies in-place raw-header mutation by a trusted resolver", async () => {
  const { createTenantSkyscraperNavigationApiHandler } = await loadApi();
  let sessionCalls = 0;
  const handler = createTenantSkyscraperNavigationApiHandler(dependencies({
    resolveTrustedSession(request) {
      sessionCalls += 1;
      if (sessionCalls === 1) request.rawHeaders[1] = "Bearer mutated-token";
      return trustedSession();
    },
    resolveTrustedNavigationFacts: () => factsFixture()
  }));
  assert.equal((await requestWithBody(handler, navigationBody())).status, 404);
  assert.equal(sessionCalls, 1);
});

test("B12 re-resolves session and facts and denies every pre-write parity mismatch", async () => {
  const { createTenantSkyscraperNavigationApiHandler } = await loadApi();
  let sessionCalls = 0;
  let factsCalls = 0;
  let nowCalls = 0;
  const stableHandler = createTenantSkyscraperNavigationApiHandler(dependencies({
    now() { nowCalls += 1; return "2000-01-01T00:30:00.000Z"; },
    resolveTrustedSession() { sessionCalls += 1; return trustedSession(); },
    resolveTrustedNavigationFacts() { factsCalls += 1; return factsFixture(); }
  }));
  assert.equal((await requestWithBody(stableHandler, navigationBody())).status, 200);
  assert.deepEqual({ sessionCalls, factsCalls, nowCalls }, { sessionCalls: 2, factsCalls: 2, nowCalls: 2 });

  for (const secondSession of [
    null,
    trustedSession({ authenticated: false }),
    trustedSession({ sessionId: "id_ffffffffffffffff" }),
    trustedSession({ subjectId: "id_eeeeeeeeeeeeeeee" }),
    { ...trustedSession(), role: "admin" }
  ]) {
    let call = 0;
    const handler = createTenantSkyscraperNavigationApiHandler(dependencies({
      resolveTrustedSession() { call += 1; return call === 1 ? trustedSession() : secondSession; },
      resolveTrustedNavigationFacts: () => factsFixture()
    }));
    assert.equal((await requestWithBody(handler, navigationBody())).status, 404);
  }

  for (const mutate of [
    (value) => { value.catalog.schemaVersion = "2.0"; },
    (value) => { value.catalog.building.buildingId = "id_ffffffffffffffff"; },
    (value) => { value.catalog.building.displayName = "Changed"; },
    (value) => { value.policyRevision += 1; },
    (value) => { value.authorizationReference = "id_ffffffffffffffff"; },
    (value) => { value.activeTenantMembership.active = false; },
    (value) => { value.activeTenantMembership.tenantId = "id_ffffffffffffffff"; },
    (value) => { value.activeTenantMembership.subjectId = "id_ffffffffffffffff"; },
    (value) => { value.catalog.building.lifecycle = "archived"; },
    (value) => { value.catalog.building.floors.push(JSON.parse(JSON.stringify(value.catalog.building.floors[0]))); },
    (value) => { value.catalog.building.floors[0].floorId = "id_ffffffffffffffff"; },
    (value) => { value.catalog.building.floors[0].buildingId = "id_ffffffffffffffff"; },
    (value) => { value.catalog.building.floors[0].displayName = "Changed"; },
    (value) => { value.catalog.building.floors[0].lifecycle = "archived"; },
    (value) => { value.catalog.building.floors[0].floorKind = "shared"; },
    (value) => { value.catalog.building.floors[0].elevatorStopId = "id_ffffffffffffffff"; },
    (value) => { value.catalog.building.floors[0].destinations.reverse(); },
    (value) => { value.catalog.building.floors[0].destinations.at(-1).destinationId = "id_ffffffffffffffff"; },
    (value) => { value.catalog.building.floors[0].destinations.at(-1).floorId = "id_ffffffffffffffff"; },
    (value) => { value.catalog.building.floors[0].destinations.at(-1).displayName = "Changed"; },
    (value) => { value.catalog.building.floors[0].destinations.at(-1).lifecycle = "archived"; },
    (value) => { value.catalog.building.floors[0].destinations.at(-1).destinationKind = "suite"; },
    (value) => { value.catalog.building.floors[0].destinations.at(-1).accessState = "tenant"; },
    (value) => { value.catalog.building.floors[0].destinations.at(-1).ownerTenantId = TENANT; },
    (value) => { value.catalog.building.floors[0].destinations.at(-1).sharedSpacePolicy = "not_shared"; },
    (value) => { value.ownerTenantLifecycles[0].tenantId = "id_ffffffffffffffff"; },
    (value) => { value.ownerTenantLifecycles[0].lifecycle = "archived"; },
    (value) => { value.ownerTenantLifecycles.push({ tenantId: "id_ffffffffffffffff", lifecycle: "active" }); },
    (value) => { value.privateDestinationGrants.push({ tenantId: TENANT, subjectId: SUBJECT, destinationId: DESTINATION }); }
  ]) {
    let factsCall = 0;
    const handler = createTenantSkyscraperNavigationApiHandler(dependencies({
      resolveTrustedSession: () => trustedSession(),
      resolveTrustedNavigationFacts() {
        factsCall += 1;
        const value = factsFixture();
        if (factsCall === 2) mutate(value);
        return value;
      }
    }));
    assert.equal((await requestWithBody(handler, navigationBody())).status, 404);
  }

  for (const mutate of [
    (value) => { value.invitation = null; },
    (value) => { value.invitation.tenantId = "id_ffffffffffffffff"; },
    (value) => { value.invitation.invitationId = "id_ffffffffffffffff"; },
    (value) => { value.invitation.subjectId = "id_ffffffffffffffff"; },
    (value) => { value.invitation.destinationId = "id_ffffffffffffffff"; },
    (value) => { value.invitation.lifecycle = "revoked"; },
    (value) => { value.invitation.revision += 1; },
    (value) => { value.invitation.validFrom = "2000-01-01T00:00:01.000Z"; },
    (value) => { value.invitation.expiresAt = "2000-01-01T00:59:59.000Z"; }
  ]) {
    let factsCall = 0;
    const handler = createTenantSkyscraperNavigationApiHandler(dependencies({
      resolveTrustedSession: () => trustedSession(),
      resolveTrustedNavigationFacts() {
        factsCall += 1;
        const value = factsFixture("invited");
        if (factsCall === 2) mutate(value);
        return value;
      }
    }));
    assert.equal((await requestWithBody(handler, navigationBody())).status, 404);
  }

  for (const [accessState, collection, mutate] of [
    ["private", "privateDestinationGrants", (item) => { item.tenantId = "id_ffffffffffffffff"; }],
    ["private", "privateDestinationGrants", (item) => { item.subjectId = "id_ffffffffffffffff"; }],
    ["private", "privateDestinationGrants", (item) => { item.destinationId = "id_ffffffffffffffff"; }],
    ["restricted", "restrictedDestinationAuthorities", (item) => { item.tenantId = "id_ffffffffffffffff"; }],
    ["restricted", "restrictedDestinationAuthorities", (item) => { item.subjectId = "id_ffffffffffffffff"; }],
    ["restricted", "restrictedDestinationAuthorities", (item) => { item.destinationId = "id_ffffffffffffffff"; }]
  ]) {
    let factsCall = 0;
    const handler = createTenantSkyscraperNavigationApiHandler(dependencies({
      resolveTrustedSession: () => trustedSession(),
      resolveTrustedNavigationFacts() {
        factsCall += 1;
        const value = factsFixture(accessState);
        if (factsCall === 2) mutate(value[collection][0]);
        return value;
      }
    }));
    assert.equal((await requestWithBody(handler, navigationBody())).status, 404);
  }

  let restrictedFactsCall = 0;
  const restrictedOrderHandler = createTenantSkyscraperNavigationApiHandler(dependencies({
    resolveTrustedSession: () => trustedSession(),
    resolveTrustedNavigationFacts() {
      restrictedFactsCall += 1;
      const value = factsFixture("restricted");
      if (restrictedFactsCall === 2) {
        value.restrictedDestinationAuthorities.push({
          tenantId: TENANT,
          subjectId: SUBJECT,
          destinationId: "id_ffffffffffffffff"
        });
      }
      return value;
    }
  }));
  assert.equal((await requestWithBody(restrictedOrderHandler, navigationBody())).status, 404);

  let rejectedSessionCall = 0;
  const rejectedSessionHandler = createTenantSkyscraperNavigationApiHandler(dependencies({
    resolveTrustedSession() {
      rejectedSessionCall += 1;
      return rejectedSessionCall === 1 ? trustedSession() : Promise.reject(new Error("second session"));
    },
    resolveTrustedNavigationFacts: () => factsFixture()
  }));
  assert.equal((await requestWithBody(rejectedSessionHandler, navigationBody())).status, 404);

  let rejectedFactsCall = 0;
  const rejectedFactsHandler = createTenantSkyscraperNavigationApiHandler(dependencies({
    resolveTrustedSession: () => trustedSession(),
    resolveTrustedNavigationFacts() {
      rejectedFactsCall += 1;
      return rejectedFactsCall === 1 ? factsFixture() : Promise.reject(new Error("second facts"));
    }
  }));
  assert.equal((await requestWithBody(rejectedFactsHandler, navigationBody())).status, 404);

  for (const secondNow of ["1999-12-31T23:59:59.999Z", "not-a-time", null]) {
    let nowCall = 0;
    const handler = createTenantSkyscraperNavigationApiHandler(dependencies({
      now() {
        nowCall += 1;
        return nowCall === 1 ? "2000-01-01T00:30:00.000Z" : secondNow;
      },
      resolveTrustedSession: () => trustedSession(),
      resolveTrustedNavigationFacts: () => factsFixture()
    }));
    assert.equal((await requestWithBody(handler, navigationBody())).status, 404);
    assert.equal(nowCall, 2);
  }
});

test("B12 rejects an invalid first timestamp before invoking Tracer 1", async () => {
  const { createTenantSkyscraperNavigationApiHandler } = await loadApi();
  const body = JSON.stringify(navigationBody());
  let status;
  let iteratorCalls = 0;
  let nowCalls = 0;
  const savedIterator = Array.prototype[Symbol.iterator];
  const handler = createTenantSkyscraperNavigationApiHandler(directDependencies({
    now() {
      nowCalls += 1;
      Array.prototype[Symbol.iterator] = function tamperedIterator() {
        iteratorCalls += 1;
        return savedIterator.call(this);
      };
      return "not-a-time";
    },
    resolveTrustedSession: () => trustedSession(),
    resolveTrustedNavigationFacts: () => factsFixture()
  }));
  try {
    await handler({
      method: "POST",
      url: CANONICAL_ROUTE,
      rawHeaders: validRawHeaders(Buffer.byteLength(body)),
      aborted: false,
      destroyed: false,
      async *[Symbol.asyncIterator]() { yield Buffer.from(body); }
    }, {
      headersSent: false,
      writeHead(nextStatus) { status = nextStatus; this.headersSent = true; },
      end() {},
      destroy() {}
    });
  } finally {
    Array.prototype[Symbol.iterator] = savedIterator;
  }
  assert.equal(status, 404);
  assert.equal(nowCalls, 0);
  assert.equal(iteratorCalls, 0);
});

test("B13 fails closed across throws before at and after the first response write", async () => {
  const { createTenantSkyscraperNavigationApiHandler } = await loadApi();
  const body = JSON.stringify(navigationBody());
  function request() {
    return {
      method: "POST",
      url: CANONICAL_ROUTE,
      rawHeaders: validRawHeaders(Buffer.byteLength(body)),
      aborted: false,
      destroyed: false,
      async *[Symbol.asyncIterator]() { yield Buffer.from(body); }
    };
  }
  function response({ throwAt, headersGetterThrows = false } = {}) {
    let headersSent = false;
    let writeHeadCalls = 0;
    let endCalls = 0;
    let destroyCalls = 0;
    const value = {
      get headersSent() {
        if (headersGetterThrows) throw new Error("headersSent marker");
        return headersSent;
      },
      writeHead() {
        writeHeadCalls += 1;
        if (throwAt === "before-write" && writeHeadCalls === 1) throw new Error("before write marker");
        headersSent = true;
        if (throwAt === "at-write") throw new Error("at write marker");
      },
      end() {
        endCalls += 1;
        if (throwAt === "after-write") throw new Error("after write marker");
      },
      destroy() { destroyCalls += 1; }
    };
    return { value, counts: () => ({ writeHeadCalls, endCalls, destroyCalls }) };
  }

  let earlyTrustedCalls = 0;
  const early = await directRequest(createTenantSkyscraperNavigationApiHandler(directDependencies({
    resolveTrustedSession() {
      earlyTrustedCalls += 1;
      throw new Error("trusted dependency marker");
    }
  })), {
    method: "POST",
    url: CANONICAL_ROUTE,
    rawHeaders: validRawHeaders(Buffer.byteLength(body)),
    async *[Symbol.asyncIterator]() { yield Buffer.from(body); }
  });
  assert.equal(early.status, 404);
  assert.equal(early.payload, '{"error":"not_found"}');
  assert.equal(earlyTrustedCalls, 0);

  const trustedCalls = { session: 0, facts: 0 };
  const handler = createTenantSkyscraperNavigationApiHandler(directDependencies({
    resolveTrustedSession() { trustedCalls.session += 1; return trustedSession(); },
    resolveTrustedNavigationFacts() { trustedCalls.facts += 1; return factsFixture(); }
  }));
  for (const [options, expected] of [
    [{ throwAt: "before-write" }, { writeHeadCalls: 2, endCalls: 1, destroyCalls: 0 }],
    [{ throwAt: "at-write" }, { writeHeadCalls: 1, endCalls: 0, destroyCalls: 1 }],
    [{ throwAt: "after-write" }, { writeHeadCalls: 1, endCalls: 1, destroyCalls: 1 }],
    [{ throwAt: "at-write", headersGetterThrows: true }, { writeHeadCalls: 1, endCalls: 0, destroyCalls: 1 }]
  ]) {
    const controlled = response(options);
    await assert.doesNotReject(handler(request(), controlled.value));
    assert.deepEqual(controlled.counts(), expected);
  }
  assert.deepEqual(trustedCalls, { session: 0, facts: 0 });
});
