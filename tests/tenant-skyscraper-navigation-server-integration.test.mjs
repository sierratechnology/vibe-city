import assert from "node:assert/strict";
import { channel } from "node:diagnostics_channel";
import { EventEmitter } from "node:events";
import { access, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { startWorkRecordsServer } from "../server/index.mjs";
import { createTenantSkyscraperNavigationTrustedSourceAdapter } from "../server/tenantSkyscraperNavigationTrustedSourceAdapter.mjs";
import { EMPTY_OWNER, withDeadline } from "./support/tenant-skyscraper-navigation-resource-owner.mjs";

const PUBLIC_MARKER = "synthetic-public-application-handler";
const TENANT = "id_0000000000000001";
const ROUTE = `/api/private/tenants/${TENANT}/skyscraper-navigation/decision`;
const BUILDING = "id_0000000000000002";
const FLOOR = "id_0000000000000003";
const STOP = "id_0000000000000004";
const DESTINATION = "id_0000000000000005";
const SUBJECT = "id_0000000000000010";
const SESSION = "id_0000000000000011";
const netServerSockets = channel("net.server.socket");

function navigationBody(overrides = {}) {
  return JSON.stringify({ schemaVersion: "1.0", channel: "door", buildingId: BUILDING,
    floorId: FLOOR, elevatorStopId: STOP, destinationId: DESTINATION, ...overrides });
}

function navigationFacts(accessState = "public") {
  const target = {
    destinationId: DESTINATION, floorId: FLOOR, displayName: "Synthetic Destination",
    lifecycle: "active", destinationKind: ["tenant", "private", "restricted"].includes(accessState)
      ? "suite" : "shared_space", accessState, ownerTenantId: accessState === "public" ? null : TENANT,
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
    catalog: { schemaVersion: "1.0", building: { buildingId: BUILDING,
      displayName: "Synthetic Tower", lifecycle: "active", floors: [{ floorId: FLOOR,
        buildingId: BUILDING, displayName: "Synthetic Floor", lifecycle: "active",
        floorKind: "customer", elevatorStopId: STOP, destinations }] } },
    activeTenantMembership: { tenantId: TENANT, subjectId: SUBJECT, active: true },
    ownerTenantLifecycles: [{ tenantId: TENANT, lifecycle: "active" }],
    invitation: accessState === "invited" ? { tenantId: TENANT,
      invitationId: "id_0000000000000013", subjectId: SUBJECT, destinationId: DESTINATION,
      lifecycle: "accepted", revision: 2, validFrom: "2000-01-01T00:00:00.000Z",
      expiresAt: "2000-01-01T01:00:00.000Z" } : null,
    privateDestinationGrants: accessState === "private"
      ? [{ tenantId: TENANT, subjectId: SUBJECT, destinationId: DESTINATION }] : [],
    restrictedDestinationAuthorities: accessState === "restricted"
      ? [{ tenantId: TENANT, subjectId: SUBJECT, destinationId: DESTINATION }] : [],
    authorizationReference: "id_0000000000000012",
    policyRevision: 7
  };
}

function canonicalRequest(extra = "", connection = "close", bodyOverrides = {}) {
  const body = navigationBody(bodyOverrides);
  return [`POST ${ROUTE} HTTP/1.1`, "Host: 127.0.0.1", "Authorization: Bearer synthetic-token",
    `Content-Length: ${Buffer.byteLength(body)}`, "Content-Type: application/json",
    `Connection: ${connection}`, "", body + extra].join("\r\n");
}

test("raw-loopback timeout keeps unsettled operation cleanup inside its absolute deadline", async () => {
  const timeoutResourcesBefore = process.getActiveResourcesInfo()
    .filter((type) => type === "Timeout").length;
  const startedAt = Date.now();
  await assert.rejects(withDeadline(async () => {
    await new Promise(() => {});
  }, 20), /synthetic loopback deadline exceeded/u);
  const elapsed = Date.now() - startedAt;
  assert.ok(elapsed < 80, `20 ms absolute deadline settled after ${elapsed} ms`);
  assert.equal(process.getActiveResourcesInfo().filter((type) => type === "Timeout").length,
    timeoutResourcesBefore, "the timed-out operation must leave no live timeout resource");
});

test("raw-loopback timeout accounts for and releases every acquired resource exactly once", async () => {
  const cleanupFailure = new Error("synthetic complete timeout cleanup failure");
  const diagnostic = channel("vibe-city.navigation.timeout-control");
  const counts = { acceptedCloses: 0, barrierRejects: 0, cleanupCalls: 0,
    clientCloses: 0, diagnosticCalls: 0, diagnosticSubscribes: 0,
    diagnosticUnsubscribes: 0, immediateSettles: 0, timerRejects: 0 };
  const ownedDiagnostic = {
    subscribe(listener) { counts.diagnosticSubscribes += 1; diagnostic.subscribe(listener); },
    unsubscribe(listener) { counts.diagnosticUnsubscribes += 1; diagnostic.unsubscribe(listener); }
  };
  let acceptedSocket;
  let client;
  let directory;
  let owner;
  let server;
  let snapshotBeforeTimeout;
  let failure;
  const startedAt = Date.now();
  await assert.rejects(withDeadline(async (activeOwner) => {
    owner = activeOwner;
    directory = await owner.temp("vibe-city-navigation-complete-timeout-");
    server = await owner.startServer({ development: true, port: 0,
      databasePath: join(directory, "work-records.sqlite"),
      applicationHandler(_request, response) { response.writeHead(404).end(); } });
    const accepted = new Promise((resolveAccepted) => owner.subscribe(netServerSockets, ({ socket }) => {
      if (!acceptedSocket && socket?.localPort === server.port) {
        acceptedSocket = socket;
        acceptedSocket.on("close", () => { counts.acceptedCloses += 1; });
        resolveAccepted();
      }
    }));
    client = owner.connect(server);
    client.on("close", () => { counts.clientCloses += 1; });
    await Promise.all([accepted, new Promise((resolveConnect, rejectConnect) => {
      client.once("connect", resolveConnect);
      client.once("error", rejectConnect);
    })]);
    owner.subscribe(ownedDiagnostic, () => { counts.diagnosticCalls += 1; });
    diagnostic.publish({ acquired: true });
    owner.deferCleanup(() => { counts.cleanupCalls += 1; throw cleanupFailure; });
    owner.wait(5_000).then(() => {}, () => { counts.timerRejects += 1; });
    owner.immediate().then(() => { counts.immediateSettles += 1; },
      () => { counts.immediateSettles += 1; });
    owner.barrier().catch(() => { counts.barrierRejects += 1; });
    snapshotBeforeTimeout = owner.snapshot();
    await new Promise(() => {});
  }, 500), (error) => { failure = error; return true; });
  const elapsed = Date.now() - startedAt;
  assert.deepEqual(snapshotBeforeTimeout, { clients: 1, accepted: 1, timers: 3,
    immediates: 1, barriers: 1, subscriptions: 3, paths: 1, cleanupActions: 1,
    serverOpen: 1 });
  assert.ok(elapsed < 500, `500 ms absolute deadline settled after ${elapsed} ms`);
  assert.ok(failure instanceof AggregateError);
  assert.deepEqual(failure.errors.map((error) => error.message),
    ["synthetic loopback deadline exceeded", cleanupFailure.message]);
  assert.equal(owner.closeServer(), owner.closeServer(), "server close promise identity must be stable");
  assert.deepEqual(owner.snapshot(), EMPTY_OWNER);
  await assert.rejects(access(directory), { code: "ENOENT" });
  diagnostic.publish({ acquired: false });
  assert.deepEqual(counts, { acceptedCloses: 1, barrierRejects: 1, cleanupCalls: 1,
    clientCloses: 1, diagnosticCalls: 1, diagnosticSubscribes: 1,
    diagnosticUnsubscribes: 1, immediateSettles: 1, timerRejects: 1 });
  assert.equal(client.destroyed, true);
  assert.equal(acceptedSocket.destroyed, true);
});

test("raw-loopback timeout empties every owned handle set", async () => {
  let owner;
  await assert.rejects(withDeadline(async (activeOwner) => {
    owner = activeOwner;
    await Promise.all([owner.wait(120), owner.immediate(), owner.barrier()]);
  }, 20), /synthetic loopback deadline exceeded/u);
  assert.deepEqual(owner.snapshot(), EMPTY_OWNER);
});

test("raw-loopback owner removes partial setup after setup failure", async () => {
  let owner;
  let directory;
  const marker = new Error("synthetic setup failure");
  await assert.rejects(withDeadline(async (activeOwner) => {
    owner = activeOwner;
    directory = await owner.temp("vibe-city-navigation-setup-failure-");
    throw marker;
  }), (error) => error === marker);
  await assert.rejects(access(directory), { code: "ENOENT" });
  assert.deepEqual(owner.snapshot(), EMPTY_OWNER);
});

test("raw-loopback owner cleans all resources after assertion failure", async () => {
  let owner;
  await assert.rejects(withDeadline(async (activeOwner) => {
    owner = activeOwner;
    await owner.immediate();
    assert.fail("synthetic assertion failure");
  }), /synthetic assertion failure/u);
  assert.deepEqual(owner.snapshot(), EMPTY_OWNER);
});

test("raw-loopback cleanup failure fails the owning test", async () => {
  let owner;
  const marker = new Error("synthetic cleanup failure");
  await assert.rejects(withDeadline(async (activeOwner) => {
    owner = activeOwner;
    owner.deferCleanup(() => { throw marker; });
  }), (error) => error === marker);
  assert.deepEqual(owner.snapshot(), EMPTY_OWNER);
});

async function exactScenario({ raw, sourceMode = "valid", accessState = "public",
  endAfterWrite = false, afterCloseWrite }) {
  return withDeadline(async (owner) => {
    const directory = await owner.temp("vibe-city-navigation-matrix-");
    const counts = { requestEvents: 0, navigationDispatches: 0, sessionCalls: 0,
      factsCalls: 0, clockCalls: 0, applicationCalls: 0, statusLines: 0,
      responseBytes: 0, clientErrors: 0, socketCloses: 0 };
    const requestStarts = channel("http.server.request.start");
    const originalEmit = EventEmitter.prototype.emit;
    let server;
    let clientEndpoint;
    const sameEndpoint = (socket) => server && clientEndpoint &&
      socket?.localPort === server.port && socket?.remotePort === clientEndpoint.port &&
      socket?.remoteAddress === clientEndpoint.address;
    const countRequest = ({ request }) => {
      if (sameEndpoint(request?.socket)) counts.requestEvents += 1;
    };
    EventEmitter.prototype.emit = function emit(event, ...args) {
      if (event === "clientError" && sameEndpoint(args[1])) counts.clientErrors += 1;
      return Reflect.apply(originalEmit, this, [event, ...args]);
    };
    owner.deferCleanup(() => { EventEmitter.prototype.emit = originalEmit; });
    try {
      const trustedSource = {
        now() { counts.clockCalls += 1; return "2000-01-01T00:30:00.000Z"; },
        resolveTrustedSession() {
          counts.sessionCalls += 1;
          return { authenticated: true, sessionId: SESSION, subjectId: SUBJECT };
        },
        resolveTrustedNavigationFacts() { counts.factsCalls += 1; return navigationFacts(accessState); }
      };
      server = await owner.startServer({
        development: true, port: 0, databasePath: join(directory, "work-records.sqlite"),
        tenantSkyscraperNavigation: sourceMode === "valid" ? trustedSource
          : sourceMode === "malformed" ? {} : undefined,
        tenantSkyscraperNavigationDispatchObserver() { counts.navigationDispatches += 1; },
        applicationHandler(_request, response) {
          counts.applicationCalls += 1;
          response.writeHead(200, { connection: "close", "content-length": Buffer.byteLength(PUBLIC_MARKER) });
          response.end(PUBLIC_MARKER);
        }
      });
      owner.subscribe(requestStarts, countRequest);
      const wire = await owner.exchange(server, raw, {
        endAfterWrite,
        onConnect(socket) { clientEndpoint = { address: socket.localAddress, port: socket.localPort }; },
        onClose(socket) {
          counts.socketCloses += 1;
          if (afterCloseWrite) socket.write(afterCloseWrite, () => {});
        }
      });
      if (afterCloseWrite) await owner.wait(20);
      counts.statusLines = (wire.toString("latin1").match(/^HTTP\/1\.1 \d{3} /gm) ?? []).length;
      counts.responseBytes = wire.length;
      return { snapshot: Object.freeze({ ...counts }), wire };
    } finally {
      EventEmitter.prototype.emit = originalEmit;
      if (server) await owner.closeServer();
    }
  });
}

test("F1 supplied application handler owns the final public fallback", async () => {
  await withDeadline(async (owner) => {
    const directory = await owner.temp("vibe-city-navigation-f1-");
    let server;
    let applicationCalls = 0;
    try {
      server = await owner.startServer({
        development: true,
        port: 0,
        databasePath: join(directory, "work-records.sqlite"),
        applicationHandler(_request, response) {
          applicationCalls += 1;
          response.writeHead(200, {
            "connection": "close",
            "content-length": Buffer.byteLength(PUBLIC_MARKER),
            "content-type": "text/plain; charset=utf-8"
          });
          response.end(PUBLIC_MARKER);
        }
      });
      const wire = (await owner.exchange(server,
        "GET /synthetic-public HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n")).toString("utf8");
      assert.equal(applicationCalls, 1);
      assert.match(wire, /^HTTP\/1\.1 200 /);
      assert.match(wire, new RegExp(`${PUBLIC_MARKER}$`));
    } finally {
      if (server) await owner.closeServer();
    }
  });
});

test("F1 rejects a malformed application handler before filesystem side effects", async () => {
  const directory = await mkdtemp(join(tmpdir(), "vibe-city-navigation-f1-invalid-"));
  const databasePath = join(directory, "uncreated", "work-records.sqlite");
  try {
    await assert.rejects(startWorkRecordsServer({
      development: true,
      port: 0,
      databasePath,
      applicationHandler: {}
    }), { name: "TypeError" });
    await assert.rejects(access(join(directory, "uncreated")), { code: "ENOENT" });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("F2 observer counts the exact canonical navigation dispatch", async () => {
  await withDeadline(async (owner) => {
    const directory = await owner.temp("vibe-city-navigation-f2-");
    let server;
    const counters = { navigation: 0, session: 0, facts: 0, clock: 0, application: 0 };
    try {
      server = await owner.startServer({
        development: true,
        port: 0,
        databasePath: join(directory, "work-records.sqlite"),
        applicationHandler(_request, response) {
          counters.application += 1;
          response.writeHead(599, { connection: "close" }).end();
        },
        tenantSkyscraperNavigationDispatchObserver: function () {
          assert.equal(this, undefined);
          assert.equal(arguments.length, 0);
          counters.navigation += 1;
        },
        tenantSkyscraperNavigation: {
          now: () => { counters.clock += 1; return "2000-01-01T00:30:00.000Z"; },
          resolveTrustedSession: () => { counters.session += 1; return {
            authenticated: true, sessionId: SESSION, subjectId: SUBJECT
          }; },
          resolveTrustedNavigationFacts: () => { counters.facts += 1; return navigationFacts(); }
        }
      });
      const wire = (await owner.exchange(server, canonicalRequest())).toString("utf8");
      assert.deepEqual({ session: counters.session, facts: counters.facts, clock: counters.clock,
        application: counters.application }, { session: 2, facts: 2, clock: 2, application: 0 });
      assert.match(wire, /^HTTP\/1\.1 200 /);
      assert.equal(counters.navigation, 1);
    } finally {
      if (server) await owner.closeServer();
    }
  });
});

test("F2 observer preflight rejects malformed and unpaired observers without side effects", async () => {
  const directory = await mkdtemp(join(tmpdir(), "vibe-city-navigation-f2-invalid-"));
  try {
    const rows = [
      ["malformed", { applicationHandler() {}, tenantSkyscraperNavigationDispatchObserver: {} }],
      ["unpaired", { tenantSkyscraperNavigationDispatchObserver() {} }]
    ];
    for (const [label, options] of rows) {
      const parent = join(directory, label);
      await assert.rejects(startWorkRecordsServer({ development: true, port: 0,
        databasePath: join(parent, "work-records.sqlite"), ...options }), { name: "TypeError" });
      await assert.rejects(access(parent), { code: "ENOENT" });
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("F2 throwing observer denies before navigation source or application work", async () => {
  await withDeadline(async (owner) => {
    const directory = await owner.temp("vibe-city-navigation-f2-throw-");
    let server;
    const counters = { attempts: 0, navigation: 0, session: 0, facts: 0, clock: 0, application: 0 };
    try {
      server = await owner.startServer({
        development: true, port: 0, databasePath: join(directory, "work-records.sqlite"),
        applicationHandler(_request, response) {
          counters.application += 1;
          response.writeHead(599, { connection: "close" }).end();
        },
        tenantSkyscraperNavigationDispatchObserver() {
          counters.attempts += 1;
          throw new Error("synthetic-observer-secret");
        },
        tenantSkyscraperNavigation: {
          now: () => { counters.clock += 1; },
          resolveTrustedSession: () => { counters.session += 1; },
          resolveTrustedNavigationFacts: () => { counters.facts += 1; }
        }
      });
      const wire = (await owner.exchange(server, canonicalRequest())).toString("utf8");
      assert.deepEqual(counters, { attempts: 1, navigation: 0, session: 0, facts: 0,
        clock: 0, application: 0 });
      assert.match(wire, /^HTTP\/1\.1 404 /);
      assert.doesNotMatch(wire, /synthetic-observer-secret/);
    } finally {
      if (server) await owner.closeServer();
    }
  });
});

test("F3 server adapter detaches exact source calls and preserves the facts record identity", async () => {
  await withDeadline(async (owner) => {
    const directory = await owner.temp("vibe-city-navigation-f3-");
    let server;
    let navigationDispatches = 0;
    const sourceSession = { authenticated: true, sessionId: SESSION, subjectId: SUBJECT };
    const counters = { session: 0, facts: 0, clock: 0, application: 0 };
    const source = {
      now: function () {
        assert.equal(this, undefined); assert.equal(arguments.length, 0);
        counters.clock += 1; return "2000-01-01T00:30:00.000Z";
      },
      resolveTrustedSession: function (request) {
        assert.equal(this, undefined); assert.equal(arguments.length, 1);
        assert.equal(request.constructor.name, "IncomingMessage");
        counters.session += 1; return sourceSession;
      },
      resolveTrustedNavigationFacts: function (factsInput) {
        assert.equal(this, undefined); assert.equal(arguments.length, 1);
        assert.equal(Object.isFrozen(factsInput), true);
        assert.equal(Object.getPrototypeOf(factsInput), Object.prototype);
        assert.deepEqual(Reflect.ownKeys(factsInput), ["session", "tenantId"]);
        assert.equal(factsInput.session, sourceSession);
        assert.equal(factsInput.tenantId, TENANT);
        counters.facts += 1; return navigationFacts();
      }
    };
    try {
      server = await owner.startServer({
        development: true, port: 0, databasePath: join(directory, "work-records.sqlite"),
        applicationHandler(_request, response) {
          counters.application += 1; response.writeHead(599, { connection: "close" }).end();
        },
        tenantSkyscraperNavigationDispatchObserver() { navigationDispatches += 1; },
        tenantSkyscraperNavigation: source
      });
      const wire = (await owner.exchange(server, canonicalRequest())).toString("utf8");
      assert.match(wire, /^HTTP\/1\.1 200 /);
      assert.equal(navigationDispatches, 1);
      assert.deepEqual(counters, { session: 2, facts: 2, clock: 2, application: 0 });
    } finally {
      if (server) await owner.closeServer();
    }
  });
});

test("F3 adapter is frozen, fresh, caller-safe, identity-preserving, and fail closed", async () => {
  const calls = [];
  const promised = Promise.resolve("synthetic-promise-identity");
  const source = {
    now: function () { calls.push(["now", this, arguments.length]); return "synthetic-time"; },
    resolveTrustedSession: function (request) {
      calls.push(["session", this, arguments.length, request]); return request;
    },
    resolveTrustedNavigationFacts: function (facts) {
      calls.push(["facts", this, arguments.length, facts]); return promised;
    }
  };
  const sourceSnapshot = {
    prototype: Object.getPrototypeOf(source),
    keys: Reflect.ownKeys(source),
    descriptors: Object.getOwnPropertyDescriptors(source),
    extensible: Object.isExtensible(source)
  };
  const adapter = createTenantSkyscraperNavigationTrustedSourceAdapter(source);
  const second = createTenantSkyscraperNavigationTrustedSourceAdapter(source);
  assert.equal(Object.getPrototypeOf(adapter), null);
  assert.equal(Object.isFrozen(adapter), true);
  assert.deepEqual(Reflect.ownKeys(adapter), ["now", "resolveTrustedSession", "resolveTrustedNavigationFacts"]);
  for (const value of Object.values(adapter)) assert.equal(Object.isFrozen(value), true);
  assert.notEqual(adapter, second);
  assert.notEqual(adapter.now, second.now);
  const request = {};
  const facts = Object.freeze({ session: request, tenantId: TENANT });
  assert.equal(adapter.now.call({}), "synthetic-time");
  assert.equal(adapter.resolveTrustedSession.call({}, request), request);
  assert.equal(adapter.resolveTrustedNavigationFacts.call({}, facts), promised);
  assert.deepEqual(calls, [
    ["now", undefined, 0], ["session", undefined, 1, request], ["facts", undefined, 1, facts]
  ]);
  assert.deepEqual(Object.getOwnPropertyDescriptors(source), sourceSnapshot.descriptors);
  source.now = () => "replacement";
  assert.equal(adapter.now(), "synthetic-time");
  assert.equal(Object.getPrototypeOf(source), sourceSnapshot.prototype);
  assert.deepEqual(sourceSnapshot.keys, ["now", "resolveTrustedSession", "resolveTrustedNavigationFacts"]);
  assert.equal(sourceSnapshot.descriptors.resolveTrustedSession.value, source.resolveTrustedSession);
  assert.equal(sourceSnapshot.descriptors.resolveTrustedNavigationFacts.value, source.resolveTrustedNavigationFacts);
  assert.equal(Object.isExtensible(source), sourceSnapshot.extensible);
  assert.equal(Object.isFrozen(source), false);

  const accessor = { now() {}, resolveTrustedSession() {} };
  Object.defineProperty(accessor, "resolveTrustedNavigationFacts", { enumerable: true, get() {
    throw new Error("accessor must not run");
  } });
  const inherited = Object.create({ now() {}, resolveTrustedSession() {}, resolveTrustedNavigationFacts() {} });
  const symbol = { now() {}, resolveTrustedSession() {}, resolveTrustedNavigationFacts() {}, [Symbol("extra")]: true };
  const extra = { now() {}, resolveTrustedSession() {}, resolveTrustedNavigationFacts() {}, extra: true };
  const traps = { count: 0 };
  const proxy = new Proxy({ now() {}, resolveTrustedSession() {}, resolveTrustedNavigationFacts() {} }, {
    getPrototypeOf() { traps.count += 1; throw new Error("proxy trap"); },
    ownKeys() { traps.count += 1; throw new Error("proxy trap"); }
  });
  for (const malformed of [undefined, null, {}, accessor, inherited, symbol, extra, proxy]) {
    assert.equal(createTenantSkyscraperNavigationTrustedSourceAdapter(malformed), null);
  }
  assert.equal(traps.count, 0);

  const marker = new Error("synthetic-throw-identity");
  const throwing = createTenantSkyscraperNavigationTrustedSourceAdapter({
    now() { throw marker; }, resolveTrustedSession() {}, resolveTrustedNavigationFacts() {}
  });
  assert.throws(() => throwing.now(), (error) => error === marker);
});

test("F4 two private requests in one write dispatch and respond only once", async () => {
  await withDeadline(async (owner) => {
    const directory = await owner.temp("vibe-city-navigation-f4-");
    let server;
    const counters = { navigation: 0, session: 0, facts: 0, clock: 0, application: 0 };
    try {
      server = await owner.startServer({
        development: true, port: 0, databasePath: join(directory, "work-records.sqlite"),
        applicationHandler(_request, response) {
          counters.application += 1; response.writeHead(599, { connection: "close" }).end();
        },
        tenantSkyscraperNavigationDispatchObserver() { counters.navigation += 1; },
        tenantSkyscraperNavigation: {
          now: () => { counters.clock += 1; return "2000-01-01T00:30:00.000Z"; },
          resolveTrustedSession: () => { counters.session += 1; return {
            authenticated: true, sessionId: SESSION, subjectId: SUBJECT
          }; },
          resolveTrustedNavigationFacts: () => { counters.facts += 1; return navigationFacts(); }
        }
      });
      const wire = (await owner.exchange(server,
        canonicalRequest("", "keep-alive") + canonicalRequest())).toString("utf8");
      assert.equal((wire.match(/HTTP\/1\.1 /gu) ?? []).length, 1);
      assert.deepEqual(counters, { navigation: 1, session: 2, facts: 2, clock: 2, application: 0 });
    } finally {
      if (server) await owner.closeServer();
    }
  }, 6_000);
});

test("F4 a public request pipelined after private work is suppressed", async () => {
  await withDeadline(async (owner) => {
    const directory = await owner.temp("vibe-city-navigation-f4-public-");
    let server;
    const counters = { navigation: 0, session: 0, facts: 0, clock: 0, application: 0 };
    try {
      server = await owner.startServer({
        development: true, port: 0, databasePath: join(directory, "work-records.sqlite"),
        applicationHandler(_request, response) {
          counters.application += 1;
          response.writeHead(200, { connection: "close", "content-length": Buffer.byteLength(PUBLIC_MARKER) });
          response.end(PUBLIC_MARKER);
        },
        tenantSkyscraperNavigationDispatchObserver() { counters.navigation += 1; },
        tenantSkyscraperNavigation: {
          now: () => { counters.clock += 1; return "2000-01-01T00:30:00.000Z"; },
          resolveTrustedSession: () => { counters.session += 1; return {
            authenticated: true, sessionId: SESSION, subjectId: SUBJECT
          }; },
          resolveTrustedNavigationFacts: () => { counters.facts += 1; return navigationFacts(); }
        }
      });
      const publicRequest = "GET /synthetic-public HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n";
      const wire = (await owner.exchange(server,
        canonicalRequest("", "keep-alive") + publicRequest)).toString("utf8");
      assert.equal((wire.match(/HTTP\/1\.1 /gu) ?? []).length, 1);
      assert.doesNotMatch(wire, new RegExp(PUBLIC_MARKER));
      assert.deepEqual(counters, { navigation: 1, session: 2, facts: 2, clock: 2, application: 0 });
    } finally {
      if (server) await owner.closeServer();
    }
  }, 6_000);
});

test("F5 invalid chunk framing cancels a scheduled private navigation dispatch", async () => {
  await withDeadline(async (owner) => {
    const directory = await owner.temp("vibe-city-navigation-f5-");
    let server;
    let requestEvents = 0;
    const requestStarts = channel("http.server.request.start");
    const countRequest = ({ request }) => {
      if (request?.socket?.localPort === server?.port) requestEvents += 1;
    };
    const counters = { navigation: 0, session: 0, facts: 0, clock: 0, application: 0 };
    try {
      server = await owner.startServer({
        development: true, port: 0, databasePath: join(directory, "work-records.sqlite"),
        applicationHandler(_request, response) {
          counters.application += 1; response.writeHead(599, { connection: "close" }).end();
        },
        tenantSkyscraperNavigationDispatchObserver() { counters.navigation += 1; },
        tenantSkyscraperNavigation: {
          now: () => { counters.clock += 1; },
          resolveTrustedSession: () => { counters.session += 1; },
          resolveTrustedNavigationFacts: () => { counters.facts += 1; }
        }
      });
      owner.subscribe(requestStarts, countRequest);
      const invalidChunk = [`POST ${ROUTE} HTTP/1.1`, "Host: 127.0.0.1",
        "Authorization: Bearer synthetic-token", "Transfer-Encoding: chunked",
        "Content-Type: application/json", "Connection: close", "", "Z", "synthetic-parser-secret", "0", "", ""].join("\r\n");
      const wire = (await owner.exchange(server, invalidChunk)).toString("utf8");
      assert.equal(requestEvents, 1);
      assert.deepEqual(counters, { navigation: 0, session: 0, facts: 0, clock: 0, application: 0 });
      assert.doesNotMatch(wire, /synthetic-parser-secret/);
    } finally {
      if (server) await owner.closeServer();
    }
  });
});

test("private namespace denials never dispatch observer, source, or application fallbacks", async () => {
  await withDeadline(async (owner) => {
    const directory = await owner.temp("vibe-city-navigation-namespace-");
    let server;
    const counters = { navigation: 0, application: 0 };
    try {
      server = await owner.startServer({
        development: true, port: 0, databasePath: join(directory, "work-records.sqlite"),
        applicationHandler(_request, response) {
          counters.application += 1;
          response.writeHead(200, { connection: "close", "content-length": Buffer.byteLength(PUBLIC_MARKER) });
          response.end(PUBLIC_MARKER);
        },
        tenantSkyscraperNavigationDispatchObserver() { counters.navigation += 1; }
      });
      assert.deepEqual(Reflect.ownKeys(server), ["host", "port", "close"]);
      const privateTargets = [
        ROUTE,
        `//api/private/tenants/${TENANT}/skyscraper-navigation/decision`,
        `/api%2fprivate%2ftenants%2f${TENANT}%2fskyscraper-navigation%2fdecision`,
        ROUTE + "/extra",
        ROUTE.replace("/decision", ""),
        ROUTE.replace("/decision", "//decision"),
        ROUTE.replace("/decision", "/./decision"),
        ROUTE.replace("/decision", "/%2e/decision"),
        ROUTE.replace("/skyscraper-navigation/", "/skyscraper-navigation%2f"),
        ROUTE.replace("/skyscraper-navigation/", "/skyscraper-navigation%5c"),
        `/api/private/tenants/id_bad/skyscraper-navigation/decision`,
        `/api/private/tenants/${TENANT}/other-private-resource`
      ];
      for (const target of privateTargets) {
        const raw = `POST ${target} HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n`;
        const wire = (await owner.exchange(server, raw)).toString("utf8");
        assert.match(wire, /^HTTP\/1\.1 404 /, target);
        assert.doesNotMatch(wire, /<html|synthetic-public/iu, target);
      }
      assert.deepEqual(counters, { navigation: 0, application: 0 });
      const publicWire = (await owner.exchange(server,
        "GET /synthetic-public HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n")).toString("utf8");
      assert.match(publicWire, /^HTTP\/1\.1 200 /);
      assert.match(publicWire, new RegExp(`${PUBLIC_MARKER}$`));
      assert.deepEqual(counters, { navigation: 0, application: 1 });
    } finally {
      if (server) await owner.closeServer();
    }
  });
});

test("F5 parser ambiguity and trailing garbage never dispatch application or private work", async () => {
  await withDeadline(async (owner) => {
    const directory = await owner.temp("vibe-city-navigation-f5-parser-");
    let server;
    let requestEvents = 0;
    const requestStarts = channel("http.server.request.start");
    const countRequest = ({ request }) => {
      if (request?.socket?.localPort === server?.port) requestEvents += 1;
    };
    const counters = { navigation: 0, session: 0, facts: 0, clock: 0, application: 0 };
    try {
      server = await owner.startServer({
        development: true, port: 0, databasePath: join(directory, "work-records.sqlite"),
        applicationHandler(_request, response) {
          counters.application += 1; response.writeHead(599, { connection: "close" }).end();
        },
        tenantSkyscraperNavigationDispatchObserver() { counters.navigation += 1; },
        tenantSkyscraperNavigation: {
          now: () => { counters.clock += 1; },
          resolveTrustedSession: () => { counters.session += 1; },
          resolveTrustedNavigationFacts: () => { counters.facts += 1; }
        }
      });
      owner.subscribe(requestStarts, countRequest);
      const body = navigationBody();
      const prefix = [`POST ${ROUTE} HTTP/1.1`, "Host: 127.0.0.1",
        "Authorization: Bearer synthetic-token", `Content-Length: ${Buffer.byteLength(body)}`];
      const rows = [
        ["declared body plus trailing garbage", canonicalRequest("synthetic-trailing-secret"), 1],
        ["duplicate content length", [...prefix, `Content-Length: ${Buffer.byteLength(body)}`,
          "Content-Type: application/json", "Connection: close", "", body].join("\r\n"), 0],
        ["content length plus transfer encoding", [...prefix, "Transfer-Encoding: chunked",
          "Content-Type: application/json", "Connection: close", "", body].join("\r\n"), 0]
      ];
      for (const [label, raw, expectedRequests] of rows) {
        requestEvents = 0;
        const wire = await owner.exchange(server, raw);
        assert.equal(requestEvents, expectedRequests, label);
        assert.equal(wire.length, 0, label);
        assert.deepEqual(counters, { navigation: 0, session: 0, facts: 0, clock: 0,
          application: 0 }, label);
      }
    } finally {
      if (server) await owner.closeServer();
    }
  });
});

test("F5 incomplete body plus FIN enters once but performs no trusted source work", async () => {
  await withDeadline(async (owner) => {
    const directory = await owner.temp("vibe-city-navigation-f5-fin-");
    let server;
    let requestEvents = 0;
    const requestStarts = channel("http.server.request.start");
    const countRequest = ({ request }) => {
      if (request?.socket?.localPort === server?.port) requestEvents += 1;
    };
    const counters = { navigation: 0, session: 0, facts: 0, clock: 0, application: 0 };
    try {
      server = await owner.startServer({
        development: true, port: 0, databasePath: join(directory, "work-records.sqlite"),
        applicationHandler(_request, response) {
          counters.application += 1; response.writeHead(599, { connection: "close" }).end();
        },
        tenantSkyscraperNavigationDispatchObserver() { counters.navigation += 1; },
        tenantSkyscraperNavigation: {
          now: () => { counters.clock += 1; },
          resolveTrustedSession: () => { counters.session += 1; },
          resolveTrustedNavigationFacts: () => { counters.facts += 1; }
        }
      });
      owner.subscribe(requestStarts, countRequest);
      const body = navigationBody();
      const partial = [`POST ${ROUTE} HTTP/1.1`, "Host: 127.0.0.1",
        "Authorization: Bearer synthetic-token", `Content-Length: ${Buffer.byteLength(body) + 10}`,
        "Content-Type: application/json", "Connection: close", "", body].join("\r\n");
      const wire = await owner.exchange(server, partial, { endAfterWrite: true });
      assert.equal(requestEvents, 1);
      assert.equal(wire.length, 0);
      assert.deepEqual(counters, { navigation: 1, session: 0, facts: 0, clock: 0, application: 0 });
    } finally {
      if (server) await owner.closeServer();
    }
  });
});

test("server close forces an active accepted connection before closing resources", async () => {
  await withDeadline(async (owner) => {
    const directory = await owner.temp("vibe-city-navigation-close-");
    let server;
    let socket;
    try {
      server = await owner.startServer({
        development: true, port: 0, databasePath: join(directory, "work-records.sqlite"),
        applicationHandler(_request, response) { response.writeHead(404).end(); }
      });
      socket = owner.connect(server);
      await new Promise((resolveConnect, rejectConnect) => {
        socket.once("connect", resolveConnect);
        socket.once("error", rejectConnect);
      });
      const closePromise = owner.closeServer();
      const closedWithoutExternalSocketCleanup = await Promise.race([
        closePromise.then(() => true),
        owner.wait(100).then(() => false)
      ]);
      if (!closedWithoutExternalSocketCleanup) socket.destroy();
      await closePromise;
      server = null;
      assert.equal(closedWithoutExternalSocketCleanup, true);
    } finally {
      socket?.destroy();
      if (server) await owner.closeServer();
    }
  });
});

test("exact raw-loopback acceptance snapshots", async () => {
  const body = navigationBody();
  const expectedSnapshot = (overrides) => Object.freeze({ requestEvents: 1,
    navigationDispatches: 0, sessionCalls: 0, factsCalls: 0, clockCalls: 0,
    applicationCalls: 0, statusLines: 1, responseBytes: 258, clientErrors: 0,
    socketCloses: 1, ...overrides });
  const success = expectedSnapshot({ navigationDispatches: 1, sessionCalls: 2, factsCalls: 2,
    clockCalls: 2, responseBytes: 691 });
  const denied = expectedSnapshot({});
  const parserFailure = expectedSnapshot({ statusLines: 0, responseBytes: 0, clientErrors: 1 });
  const prefix = [`POST ${ROUTE} HTTP/1.1`, "Host: 127.0.0.1",
    "Authorization: Bearer synthetic-token", `Content-Length: ${Buffer.byteLength(body)}`];
  const invalidChunk = [`POST ${ROUTE} HTTP/1.1`, "Host: 127.0.0.1",
    "Authorization: Bearer synthetic-token", "Transfer-Encoding: chunked",
    "Content-Type: application/json", "Connection: close", "", "Z", body, "0", "", ""].join("\r\n");
  const cases = [
    ["success", { raw: canonicalRequest() }, success],
    ["omitted source", { raw: canonicalRequest(), sourceMode: "omitted" }, denied],
    ["malformed source", { raw: canonicalRequest(), sourceMode: "malformed" }, denied],
    ["configured denial", { raw: canonicalRequest().replace("Bearer synthetic-token", "Basic synthetic-token") },
      expectedSnapshot({ navigationDispatches: 1 })],
    ["network-path namespace", { raw: `POST //api/private/tenants/${TENANT}/skyscraper-navigation/decision HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n` }, denied],
    ["encoded-root namespace", { raw: `POST /api%2fprivate%2ftenants%2f${TENANT}%2fskyscraper-navigation%2fdecision HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n` }, denied],
    ["public", { raw: "GET /synthetic-public HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n" },
      expectedSnapshot({ applicationCalls: 1, responseBytes: 131 })],
    ["private then private", { raw: canonicalRequest("", "keep-alive") + canonicalRequest() },
      expectedSnapshot({ ...success, requestEvents: 2 })],
    ["private then public", { raw: canonicalRequest("", "keep-alive") + "GET /synthetic-public HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n" },
      expectedSnapshot({ ...success, requestEvents: 2 })],
    ["second write after observed close", { raw: canonicalRequest(), afterCloseWrite: canonicalRequest() }, success],
    ["complete body disconnect", { raw: canonicalRequest(), endAfterWrite: true }, success],
    ["invalid chunk", { raw: invalidChunk }, parserFailure],
    ["trailing garbage", { raw: canonicalRequest("synthetic-trailing-secret") }, parserFailure],
    ["duplicate content length", { raw: [...prefix, `Content-Length: ${Buffer.byteLength(body)}`,
      "Content-Type: application/json", "Connection: close", "", body].join("\r\n") },
      expectedSnapshot({ requestEvents: 0, statusLines: 0, responseBytes: 0, clientErrors: 1 })],
    ["ambiguous framing", { raw: [...prefix, "Transfer-Encoding: chunked",
      "Content-Type: application/json", "Connection: close", "", body].join("\r\n") },
      expectedSnapshot({ requestEvents: 0, statusLines: 0, responseBytes: 0, clientErrors: 1 })],
    ["incomplete body FIN", { raw: [...prefix.slice(0, 3), `Content-Length: ${Buffer.byteLength(body) + 10}`,
      "Content-Type: application/json", "Connection: close", "", body].join("\r\n"), endAfterWrite: true },
      expectedSnapshot({ navigationDispatches: 1, statusLines: 0, responseBytes: 0, clientErrors: 1 })]
  ];
  for (const [label, options, expected] of cases) {
    const { snapshot, wire } = await exactScenario(options);
    assert.deepEqual(snapshot, expected, label);
    if (label === "success") {
      const response = wire.toString("utf8");
      assert.match(response, /cache-control: private, no-store/iu);
      assert.match(response, /content-type: application\/json; charset=utf-8/iu);
      assert.match(response, /vary: Authorization/iu);
      assert.match(response, /x-content-type-options: nosniff/iu);
      assert.match(response, /connection: close/iu);
      assert.doesNotMatch(response, /synthetic-public-application-handler/);
    }
  }
});

test("server path preserves all access states across every navigation channel", async () => {
  const responseBytes = {
    public: { door: 691, elevator: 695, direct: 693, alternative: 698 },
    tenant: { door: 701, elevator: 705, direct: 703, alternative: 708 },
    invited: { door: 731, elevator: 735, direct: 733, alternative: 738 },
    private: { door: 702, elevator: 706, direct: 704, alternative: 709 },
    restricted: { door: 705, elevator: 709, direct: 707, alternative: 712 }
  };
  for (const accessState of ["public", "tenant", "invited", "private", "restricted"]) {
    for (const channel of ["door", "elevator", "direct", "alternative"]) {
      const { snapshot, wire } = await exactScenario({
        raw: canonicalRequest("", "close", { channel }), accessState
      });
      assert.deepEqual(snapshot, Object.freeze({
        requestEvents: 1,
        navigationDispatches: 1,
        sessionCalls: 2,
        factsCalls: 2,
        clockCalls: 2,
        applicationCalls: 0,
        statusLines: 1,
        responseBytes: responseBytes[accessState][channel],
        clientErrors: 0,
        socketCloses: 1
      }), `${accessState}/${channel}`);
      const response = wire.toString("utf8");
      assert.match(response, /^HTTP\/1\.1 200 /u, `${accessState}/${channel}`);
      const decision = JSON.parse(response.split("\r\n\r\n")[1]).decision;
      assert.equal(decision.accessState, accessState, `${accessState}/${channel}`);
      assert.equal(decision.channel, channel, `${accessState}/${channel}`);
    }
  }
});
