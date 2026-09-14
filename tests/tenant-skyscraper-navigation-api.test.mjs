import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

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
    return await import(`data:text/javascript;base64,${Buffer.from(injected).toString("base64")}`);
  } finally {
    delete globalThis.__testNavigationAuthorizer;
  }
}

function dependencies(overrides = {}) {
  return {
    now: () => "2000-01-01T00:30:00.000Z",
    resolveTrustedSession: () => null,
    resolveTrustedNavigationFacts: () => null,
    ...overrides
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
  const { instrumentHeaders, instrumentIterator, ...requestOverrides } = overrides;
  const request = {
    method: "GET",
    url: "/",
    rawHeaders: [],
    aborted: false,
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
  }));
}

function requestWithBody(handler, body, overrides = {}) {
  const payload = typeof body === "string" ? body : JSON.stringify(body);
  return directRequest(handler, {
    method: "POST",
    url: CANONICAL_ROUTE,
    rawHeaders: validRawHeaders(Buffer.byteLength(payload)),
    async *[Symbol.asyncIterator]() { yield Buffer.from(payload); },
    ...overrides
  });
}

test("B1 exposes only the frozen private navigation handler factory and generic denial shell", async () => {
  const api = await loadApi();
  assert.deepEqual(Object.keys(api), ["createTenantSkyscraperNavigationApiHandler"]);
  assert.throws(() => api.createTenantSkyscraperNavigationApiHandler({}), TypeError);

  const handler = api.createTenantSkyscraperNavigationApiHandler(dependencies());
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

test("B2 admits only the canonical bounded raw tenant navigation route to header inspection", async () => {
  const { createTenantSkyscraperNavigationApiHandler } = await loadApi();
  const handler = createTenantSkyscraperNavigationApiHandler(dependencies());
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
    const denied = await directRequest(handler, { method: "POST", url, instrumentHeaders: reads });
    assert.equal(denied.status, 404, url);
    assert.equal(reads.count, expectedHeaderReads, url);
  }
});

test("B3 requires exact uppercase POST before header inspection or trusted resolution", async () => {
  const { createTenantSkyscraperNavigationApiHandler } = await loadApi();
  let trustedCalls = 0;
  const handler = createTenantSkyscraperNavigationApiHandler(dependencies({
    resolveTrustedSession() { trustedCalls += 1; return null; }
  }));
  const url = CANONICAL_ROUTE;
  for (const [method, expectedHeaderReads] of [["POST", 1], ["post", 0], ["GET", 0], ["PUT", 0]]) {
    const reads = { count: 0 };
    const denied = await directRequest(handler, { method, url, instrumentHeaders: reads });
    assert.equal(denied.status, 404, method);
    assert.equal(reads.count, expectedHeaderReads, method);
  }
  assert.equal(trustedCalls, 0);
});

test("B4 closes raw-header shape byte lexical and ordinary-duplicate limits before body access", async () => {
  const { createTenantSkyscraperNavigationApiHandler } = await loadApi();
  const handler = createTenantSkyscraperNavigationApiHandler(dependencies());
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
    const denied = await directRequest(handler, {
      method: "POST", url: CANONICAL_ROUTE, rawHeaders, instrumentIterator: reads
    });
    assert.equal(denied.status, 404);
    assert.equal(reads.count, expectedIteratorReads, `header case ${caseIndex}`);
  }
});

test("B5 requires one exact bounded Bearer authorization value before body access", async () => {
  const { createTenantSkyscraperNavigationApiHandler } = await loadApi();
  const handler = createTenantSkyscraperNavigationApiHandler(dependencies());
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
    await directRequest(handler, {
      method: "POST", url: CANONICAL_ROUTE, rawHeaders, instrumentIterator: reads
    });
    assert.equal(reads.count, expectedIteratorReads, `authorization case ${caseIndex}`);
  }
});

test("B6 enforces exact length type framing and yielded-body byte limits before trusted resolution", async () => {
  const { createTenantSkyscraperNavigationApiHandler } = await loadApi();
  let trustedCalls = 0;
  const handler = createTenantSkyscraperNavigationApiHandler(dependencies({
    resolveTrustedSession() { trustedCalls += 1; return null; }
  }));
  const headers = ({ length = "2", type = "application/json", extra = [], omitLength = false } = {}) => [
    "Authorization", BEARER,
    ...(omitLength ? [] : ["Content-Length", length]),
    ...(type === null ? [] : ["Content-Type", type]),
    ...extra
  ];
  async function run(rawHeaders, chunks, requestOverrides = {}) {
    let yielded = 0;
    const result = await directRequest(handler, {
      method: "POST",
      url: CANONICAL_ROUTE,
      rawHeaders,
      async *[Symbol.asyncIterator]() {
        for (const chunk of chunks) {
          yielded += 1;
          yield chunk;
        }
      },
      ...requestOverrides
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
  const handler = createTenantSkyscraperNavigationApiHandler(dependencies({
    resolveTrustedSession() { sessionCalls += 1; return trustedSession(); },
    resolveTrustedNavigationFacts: () => factsFixture()
  }));
  try {
    Object.create = () => { throw new Error("tampered create"); };
    Object.is = () => { throw new Error("tampered is"); };
    JSON.parse = () => { throw new Error("tampered parse"); };
    RegExp.prototype.test = () => { throw new Error("tampered test"); };
    String.prototype.toLowerCase = () => { throw new Error("tampered lowercase"); };
    Buffer.byteLength = () => { throw new Error("tampered byteLength"); };
    await directRequest(handler, {
      method: "POST",
      url: CANONICAL_ROUTE,
      rawHeaders: validRawHeaders(Buffer.from(body).byteLength),
      async *[Symbol.asyncIterator]() { yield Buffer.from(body); }
    });
  } finally {
    Object.create = saved.objectCreate;
    Object.is = saved.objectIs;
    JSON.parse = saved.jsonParse;
    RegExp.prototype.test = saved.regexpTest;
    String.prototype.toLowerCase = saved.stringToLowerCase;
    Buffer.byteLength = saved.bufferByteLength;
  }
  assert.equal(sessionCalls, 2);
});

test("B10 captures RegExp exec and array iteration before post-import replacement", async () => {
  const { createTenantSkyscraperNavigationApiHandler } = await loadApi();
  const body = JSON.stringify(navigationBody());
  const request = {
    method: "POST",
    url: CANONICAL_ROUTE,
    rawHeaders: validRawHeaders(Buffer.byteLength(body)),
    aborted: false,
    destroyed: false,
    async *[Symbol.asyncIterator]() { yield Buffer.from(body); }
  };
  let status;
  const response = {
    headersSent: false,
    writeHead(nextStatus) { status = nextStatus; this.headersSent = true; },
    end() {},
    destroy() {}
  };
  let sessionCalls = 0;
  const handler = createTenantSkyscraperNavigationApiHandler(dependencies({
    resolveTrustedSession() { sessionCalls += 1; return null; }
  }));
  const savedExec = RegExp.prototype.exec;
  const savedIterator = Array.prototype[Symbol.iterator];
  try {
    RegExp.prototype.exec = () => { throw new Error("tampered exec"); };
    Array.prototype[Symbol.iterator] = () => { throw new Error("tampered iterator"); };
    await handler(request, response);
  } finally {
    RegExp.prototype.exec = savedExec;
    Array.prototype[Symbol.iterator] = savedIterator;
  }
  assert.equal(status, 404);
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
  const savedIterator = Array.prototype[Symbol.iterator];
  const handler = createTenantSkyscraperNavigationApiHandler(dependencies({
    now() {
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

  const early = await directRequest(createTenantSkyscraperNavigationApiHandler(dependencies({
    resolveTrustedSession() { throw new Error("trusted dependency marker"); }
  })), {
    method: "POST",
    url: CANONICAL_ROUTE,
    rawHeaders: validRawHeaders(Buffer.byteLength(body)),
    async *[Symbol.asyncIterator]() { yield Buffer.from(body); }
  });
  assert.equal(early.status, 404);
  assert.equal(early.payload, '{"error":"not_found"}');

  const handler = createTenantSkyscraperNavigationApiHandler(dependencies({
    resolveTrustedSession: () => trustedSession(),
    resolveTrustedNavigationFacts: () => factsFixture()
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
});
