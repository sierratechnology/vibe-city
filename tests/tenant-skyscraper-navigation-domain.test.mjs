import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

const MODULE_PATH = "../server/tenantSkyscraperNavigationDomain.mjs";
const BUILDING = "id_0000000000000001";
const FLOOR = "id_0000000000000002";
const STOP = "id_0000000000000003";
const TENANT = "id_0000000000000010";
const FOREIGN_TENANT = "id_0000000000000011";
const SUBJECT = "id_0000000000000030";
const SESSION = "id_0000000000000031";
const AUTHORIZATION_REFERENCE = "id_0000000000000032";
const INVITATION_ID = "id_0000000000000033";
const PUBLIC_DESTINATION = "id_0000000000000020";
const EVALUATED_AT = "2000-01-01T00:30:00.000Z";

async function loadDomain() {
  return import(MODULE_PATH).catch(() => ({}));
}

function destination(destinationId, overrides = {}) {
  return {
    destinationId,
    floorId: FLOOR,
    displayName: `Synthetic ${destinationId.slice(-4)}`,
    lifecycle: "active",
    destinationKind: "suite",
    accessState: "tenant",
    ownerTenantId: TENANT,
    sharedSpacePolicy: "not_shared",
    ...overrides
  };
}

function publicFixture() {
  const suites = [1, 2, 3, 4].map((number) =>
    destination(`id_000000000000010${number}`));
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
          destinations: [...suites, destination(PUBLIC_DESTINATION, {
            displayName: "Synthetic Lobby",
            destinationKind: "shared_space",
            accessState: "public",
            ownerTenantId: null,
            sharedSpacePolicy: "building_public"
          })]
        }]
      }
    },
    authorization: {
      kind: "trusted-server-context",
      authenticatedSubjectId: null,
      authenticatedSessionId: null,
      ownerTenantLifecycles: [{ tenantId: TENANT, lifecycle: "active" }],
      activeTenantMembership: null,
      privateDestinationGrants: [],
      invitation: null,
      restrictedDestinationAuthorities: [],
      authorizationReference: null,
      policyRevision: 1
    },
    evaluatedAt: EVALUATED_AT
  };
}

function request(destinationId = PUBLIC_DESTINATION, channel = "door") {
  return {
    schemaVersion: "1.0",
    channel,
    buildingId: BUILDING,
    floorId: FLOOR,
    elevatorStopId: STOP,
    destinationId
  };
}

function clone(value) {
  return structuredClone(value);
}

function authenticatedFixture() {
  const options = publicFixture();
  options.authorization.authenticatedSubjectId = SUBJECT;
  options.authorization.authenticatedSessionId = SESSION;
  options.authorization.activeTenantMembership = { tenantId: TENANT, subjectId: SUBJECT, active: true };
  options.authorization.authorizationReference = AUTHORIZATION_REFERENCE;
  options.authorization.policyRevision = 7;
  return options;
}

function invitedFixture() {
  const options = authenticatedFixture();
  Object.assign(options.catalog.building.floors[0].destinations[4], {
    accessState: "invited",
    ownerTenantId: TENANT,
    sharedSpacePolicy: "exact_invitation"
  });
  options.authorization.invitation = {
    tenantId: TENANT,
    invitationId: INVITATION_ID,
    subjectId: SUBJECT,
    destinationId: PUBLIC_DESTINATION,
    lifecycle: "accepted",
    revision: 2,
    validFrom: "2000-01-01T00:00:00.000Z",
    expiresAt: "2000-01-01T01:00:00.000Z"
  };
  return options;
}

function privateFixture() {
  const options = authenticatedFixture();
  options.catalog.building.floors[0].destinations[0].accessState = "private";
  options.authorization.privateDestinationGrants = [{
    tenantId: TENANT,
    subjectId: SUBJECT,
    destinationId: "id_0000000000000101"
  }];
  return options;
}

function restrictedFixture() {
  const options = authenticatedFixture();
  options.catalog.building.floors[0].destinations[0].accessState = "restricted";
  options.authorization.restrictedDestinationAuthorities = [{
    tenantId: TENANT,
    subjectId: SUBJECT,
    destinationId: "id_0000000000000101"
  }];
  return options;
}

function maximalId(number) {
  return `id_${number.toString(16).padStart(64, "0")}`;
}

function maximalFixture() {
  const buildingId = maximalId(1);
  const subjectId = maximalId(2000);
  const tenantIds = Array.from({ length: 512 }, (_, index) => maximalId(3000 + index));
  const destinations = [];
  const floors = Array.from({ length: 64 }, (_, floorIndex) => {
    const floorId = maximalId(100 + floorIndex * 2);
    const elevatorStopId = maximalId(101 + floorIndex * 2);
    return {
      floorId,
      buildingId,
      displayName: `Synthetic ${"F".repeat(70)}`,
      lifecycle: "active",
      floorKind: "customer",
      elevatorStopId,
      destinations: Array.from({ length: 8 }, (_, destinationIndex) => {
        const ordinal = floorIndex * 8 + destinationIndex;
        const item = {
          destinationId: maximalId(5000 + ordinal),
          floorId,
          displayName: `Synthetic ${"D".repeat(70)}`,
          lifecycle: "active",
          destinationKind: destinationIndex < 4 ? "suite" : "shared_space",
          accessState: "restricted",
          ownerTenantId: tenantIds[ordinal],
          sharedSpacePolicy: destinationIndex < 4 ? "not_shared" : "exact_restricted_authority"
        };
        destinations.push(item);
        return item;
      })
    };
  });
  const scopes = destinations.slice(0, 16).map((item) => ({
    tenantId: item.ownerTenantId,
    subjectId,
    destinationId: item.destinationId
  }));
  return {
    options: {
      catalog: {
        schemaVersion: "1.0",
        building: {
          buildingId,
          displayName: `Synthetic ${"B".repeat(70)}`,
          lifecycle: "active",
          floors
        }
      },
      authorization: {
        kind: "trusted-server-context",
        authenticatedSubjectId: subjectId,
        authenticatedSessionId: maximalId(2001),
        ownerTenantLifecycles: tenantIds.map((tenantId) => ({ tenantId, lifecycle: "active" })),
        activeTenantMembership: { tenantId: tenantIds[0], subjectId, active: true },
        privateDestinationGrants: clone(scopes),
        invitation: {
          tenantId: tenantIds[0],
          invitationId: maximalId(2002),
          subjectId,
          destinationId: destinations[0].destinationId,
          lifecycle: "accepted",
          revision: 2147483647,
          validFrom: "2000-01-01T00:00:00.000Z",
          expiresAt: "2000-01-01T01:00:00.000Z"
        },
        restrictedDestinationAuthorities: clone(scopes),
        authorizationReference: maximalId(2003),
        policyRevision: 2147483647
      },
      evaluatedAt: EVALUATED_AT
    },
    request: {
      schemaVersion: "1.0",
      channel: "door",
      buildingId,
      floorId: floors[0].floorId,
      elevatorStopId: floors[0].elevatorStopId,
      destinationId: destinations[0].destinationId
    }
  };
}

function instrumentGraph(root) {
  const identities = new WeakSet();
  const encoder = new TextEncoder();
  const totals = { containers: 0, descriptors: 0, values: 1, utf8Bytes: 0 };
  function visit(value) {
    if (value === null || typeof value !== "object") return;
    assert.equal(identities.has(value), false);
    identities.add(value);
    totals.containers += 1;
    const keys = Reflect.ownKeys(value);
    totals.descriptors += keys.length;
    totals.values += keys.length;
    for (const key of keys) {
      assert.equal(typeof key, "string");
      totals.utf8Bytes += encoder.encode(key).length;
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      assert.ok(descriptor && "value" in descriptor);
      if (typeof descriptor.value === "string") {
        totals.utf8Bytes += encoder.encode(descriptor.value).length;
      }
      visit(descriptor.value);
    }
  }
  visit(root);
  return totals;
}

test("B1 exposes only the frozen navigation authorizer shell and fresh generic failures", async () => {
  const domain = await loadDomain();
  assert.deepEqual(Object.keys(domain).sort(), [
    "TENANT_SKYSCRAPER_NAVIGATION_ACCESS_STATES",
    "createTenantSkyscraperNavigationAuthorizer"
  ]);
  assert.deepEqual(domain.TENANT_SKYSCRAPER_NAVIGATION_ACCESS_STATES, [
    "public", "tenant", "invited", "private", "restricted"
  ]);
  assert.equal(Object.isFrozen(domain.TENANT_SKYSCRAPER_NAVIGATION_ACCESS_STATES), true);

  const authorizer = domain.createTenantSkyscraperNavigationAuthorizer({});
  assert.equal(Object.getPrototypeOf(authorizer), null);
  assert.deepEqual(Object.keys(authorizer), ["decideNavigation"]);
  assert.equal(Object.isFrozen(authorizer), true);
  const first = authorizer.decideNavigation({});
  const second = authorizer.decideNavigation({});
  assert.deepEqual(first, { ok: false, code: "not_found" });
  assert.deepEqual(second, first);
  assert.notEqual(first, second);
  assert.equal(Object.isFrozen(first), true);
});

test("B2 allows the smallest ownerless public destination with a detached frozen decision", async () => {
  const domain = await loadDomain();
  const options = publicFixture();
  const authorizer = domain.createTenantSkyscraperNavigationAuthorizer(options);
  const result = authorizer.decideNavigation(request());
  assert.equal(result.ok, true);
  assert.equal(Object.getPrototypeOf(result), null);
  assert.equal(Object.getPrototypeOf(result.decision), null);
  assert.deepEqual({ ...result.decision }, {
    allowed: true,
    code: "allowed",
    schemaVersion: "1.0",
    channel: "door",
    buildingId: BUILDING,
    floorId: FLOOR,
    elevatorStopId: STOP,
    destinationId: PUBLIC_DESTINATION,
    destinationKind: "shared_space",
    accessState: "public",
    subjectId: null,
    tenantId: null,
    authorizationReference: null,
    policyRevision: 1,
    evaluatedAt: EVALUATED_AT,
    validUntil: null
  });
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.decision), true);
  options.catalog.building.displayName = "Synthetic Mutated";
  options.authorization.policyRevision = 2;
  assert.equal(result.decision.policyRevision, 1);
});

test("B3 requires stable linked unique identities and exactly four suites on customer floors", async () => {
  const domain = await loadDomain();
  const attacks = [];
  const duplicate = publicFixture();
  duplicate.catalog.building.floors[0].destinations[1].destinationId =
    duplicate.catalog.building.floors[0].destinations[0].destinationId;
  attacks.push([duplicate, request()]);
  const duplicateAcrossKinds = publicFixture();
  duplicateAcrossKinds.catalog.building.floors[0].destinations[0].destinationId = FLOOR;
  attacks.push([duplicateAcrossKinds, request()]);
  const wrongBuilding = publicFixture();
  wrongBuilding.catalog.building.floors[0].buildingId = "id_ffffffffffffffff";
  attacks.push([wrongBuilding, request()]);
  const wrongFloor = publicFixture();
  wrongFloor.catalog.building.floors[0].destinations[4].floorId = "id_ffffffffffffffff";
  attacks.push([wrongFloor, request()]);
  const wrongStopRequest = request();
  wrongStopRequest.elevatorStopId = "id_ffffffffffffffff";
  attacks.push([publicFixture(), wrongStopRequest]);
  const displayNameRequest = request();
  displayNameRequest.destinationId = "Synthetic Lobby";
  attacks.push([publicFixture(), displayNameRequest]);
  const repeated = publicFixture();
  repeated.catalog.building.floors[0].destinations[1] = repeated.catalog.building.floors[0].destinations[0];
  attacks.push([repeated, request()]);
  const onlyThreeSuites = publicFixture();
  onlyThreeSuites.catalog.building.floors[0].destinations.shift();
  attacks.push([onlyThreeSuites, request()]);

  for (const [options, rawRequest] of attacks) {
    assert.deepEqual(
      domain.createTenantSkyscraperNavigationAuthorizer(options).decideNavigation(rawRequest),
      { ok: false, code: "not_found" }
    );
  }
});

test("B4 applies one public authorization decision identically across every channel", async () => {
  const domain = await loadDomain();
  const decisions = ["door", "elevator", "direct", "alternative"].map((channel) =>
    domain.createTenantSkyscraperNavigationAuthorizer(publicFixture())
      .decideNavigation(request(PUBLIC_DESTINATION, channel)));
  for (const result of decisions) assert.equal(result.ok, true);
  const normalized = decisions.map((result) => ({ ...result.decision, channel: "same" }));
  assert.deepEqual(normalized[1], normalized[0]);
  assert.deepEqual(normalized[2], normalized[0]);
  assert.deepEqual(normalized[3], normalized[0]);
});

test("B5 allows tenant navigation only for the exact active same-tenant membership", async () => {
  const domain = await loadDomain();
  const destinationId = "id_0000000000000101";
  const allowed = domain.createTenantSkyscraperNavigationAuthorizer(authenticatedFixture())
    .decideNavigation(request(destinationId));
  assert.equal(allowed.ok, true);
  assert.equal(allowed.decision.accessState, "tenant");
  assert.equal(allowed.decision.subjectId, SUBJECT);
  assert.equal(allowed.decision.tenantId, TENANT);
  assert.equal(allowed.decision.authorizationReference, AUTHORIZATION_REFERENCE);

  for (const mutate of [
    (value) => { value.authorization.activeTenantMembership.tenantId = FOREIGN_TENANT; },
    (value) => { value.authorization.activeTenantMembership.subjectId = "id_ffffffffffffffff"; },
    (value) => { value.authorization.activeTenantMembership.active = false; },
    (value) => { value.authorization.authenticatedSubjectId = "id_ffffffffffffffff"; }
  ]) {
    const options = authenticatedFixture();
    mutate(options);
    assert.deepEqual(
      domain.createTenantSkyscraperNavigationAuthorizer(options).decideNavigation(request(destinationId)),
      { ok: false, code: "not_found" }
    );
  }
});

test("B6 requires one exact accepted current invitation and uses its exclusive expiry", async () => {
  const domain = await loadDomain();
  const allowed = domain.createTenantSkyscraperNavigationAuthorizer(invitedFixture())
    .decideNavigation(request());
  assert.equal(allowed.ok, true);
  assert.equal(allowed.decision.accessState, "invited");
  assert.equal(allowed.decision.validUntil, "2000-01-01T01:00:00.000Z");

  const attacks = [
    (value) => { value.authorization.invitation.lifecycle = "issued"; },
    (value) => { value.authorization.invitation.lifecycle = "revoked"; },
    (value) => { value.authorization.invitation.subjectId = "id_ffffffffffffffff"; },
    (value) => { value.authorization.invitation.tenantId = FOREIGN_TENANT; },
    (value) => { value.authorization.invitation.destinationId = "id_ffffffffffffffff"; },
    (value) => { value.authorization.invitation.revision = 1; },
    (value) => { value.evaluatedAt = "1999-12-31T23:59:59.999Z"; },
    (value) => { value.evaluatedAt = value.authorization.invitation.expiresAt; }
  ];
  for (const mutate of attacks) {
    const options = invitedFixture();
    mutate(options);
    assert.deepEqual(
      domain.createTenantSkyscraperNavigationAuthorizer(options).decideNavigation(request()),
      { ok: false, code: "not_found" }
    );
  }
});

test("invited access requires a non-null authenticated identity", async () => {
  const domain = await loadDomain();
  const options = invitedFixture();
  options.authorization.authenticatedSubjectId = null;
  options.authorization.authenticatedSessionId = null;
  options.authorization.activeTenantMembership = null;
  options.authorization.authorizationReference = null;
  options.authorization.invitation.subjectId = null;

  assert.deepEqual(
    domain.createTenantSkyscraperNavigationAuthorizer(options).decideNavigation(request()),
    { ok: false, code: "not_found" }
  );
});

test("invitation expiry uses the captured Date.parse intrinsic", async () => {
  const domain = await loadDomain();
  const options = invitedFixture();
  options.evaluatedAt = "2000-01-01T02:00:00.000Z";
  const authorizer = domain.createTenantSkyscraperNavigationAuthorizer(options);
  const originalDateParse = Date.parse;
  try {
    Date.parse = (value) => value === options.authorization.invitation.expiresAt ? 1 : 0;
    assert.deepEqual(authorizer.decideNavigation(request()), { ok: false, code: "not_found" });
  } finally {
    Date.parse = originalDateParse;
  }
});

test("navigation lookup ignores replacement of Array.prototype.find", async () => {
  const domain = await loadDomain();
  const authorizer = domain.createTenantSkyscraperNavigationAuthorizer(publicFixture());
  const mismatchedRequest = request("id_ffffffffffffffff");
  mismatchedRequest.floorId = "id_eeeeeeeeeeeeeeee";
  const originalFind = Array.prototype.find;
  try {
    Array.prototype.find = function replacedFind() {
      return this.length === 1 ? this[0] : this[this.length - 1];
    };
    assert.deepEqual(
      authorizer.decideNavigation(mismatchedRequest),
      { ok: false, code: "not_found" }
    );
  } finally {
    Array.prototype.find = originalFind;
  }
});

test("authorization membership lookups ignore replacement of Array.prototype.some", async () => {
  const domain = await loadDomain();
  const destinationId = "id_0000000000000101";
  const privateOptions = privateFixture();
  privateOptions.authorization.privateDestinationGrants[0].destinationId = "id_ffffffffffffffff";
  const restrictedOptions = restrictedFixture();
  restrictedOptions.authorization.restrictedDestinationAuthorities[0].destinationId =
    "id_ffffffffffffffff";
  const privateAuthorizer = domain.createTenantSkyscraperNavigationAuthorizer(privateOptions);
  const restrictedAuthorizer = domain.createTenantSkyscraperNavigationAuthorizer(restrictedOptions);
  const originalSome = Array.prototype.some;
  try {
    Array.prototype.some = function replacedSome(callback, thisArg) {
      return this.length > 0 && typeof this[0] === "object"
        ? true
        : originalSome.call(this, callback, thisArg);
    };
    assert.deepEqual(
      privateAuthorizer.decideNavigation(request(destinationId)),
      { ok: false, code: "not_found" }
    );
    assert.deepEqual(
      restrictedAuthorizer.decideNavigation(request(destinationId)),
      { ok: false, code: "not_found" }
    );
  } finally {
    Array.prototype.some = originalSome;
  }
});

test("request channel validation ignores post-construction replacement of Set.prototype.has", async () => {
  const domain = await loadDomain();
  const authorizer = domain.createTenantSkyscraperNavigationAuthorizer(publicFixture());
  const originalHas = Set.prototype.has;
  try {
    Set.prototype.has = () => true;
    assert.deepEqual(
      authorizer.decideNavigation(request(PUBLIC_DESTINATION, "unsupported")),
      { ok: false, code: "not_found" }
    );
  } finally {
    Set.prototype.has = originalHas;
  }
});

test("B7 private navigation needs both same-tenant membership and one exact private grant", async () => {
  const domain = await loadDomain();
  const destinationId = "id_0000000000000101";
  assert.equal(domain.createTenantSkyscraperNavigationAuthorizer(privateFixture())
    .decideNavigation(request(destinationId)).ok, true);
  const attacks = [
    (value) => { value.authorization.privateDestinationGrants = []; },
    (value) => { value.authorization.privateDestinationGrants[0].tenantId = FOREIGN_TENANT; },
    (value) => { value.authorization.privateDestinationGrants[0].subjectId = "id_ffffffffffffffff"; },
    (value) => { value.authorization.privateDestinationGrants[0].destinationId = "id_ffffffffffffffff"; },
    (value) => {
      value.authorization.privateDestinationGrants = [];
      value.authorization.invitation = invitedFixture().authorization.invitation;
    },
    (value) => { value.authorization.role = "administrator"; }
  ];
  for (const mutate of attacks) {
    const options = privateFixture();
    mutate(options);
    assert.deepEqual(domain.createTenantSkyscraperNavigationAuthorizer(options)
      .decideNavigation(request(destinationId)), { ok: false, code: "not_found" });
  }
});

test("B8 restricted navigation accepts only exact authority and rejects authority-shaped extras", async () => {
  const domain = await loadDomain();
  const destinationId = "id_0000000000000101";
  assert.equal(domain.createTenantSkyscraperNavigationAuthorizer(restrictedFixture())
    .decideNavigation(request(destinationId)).ok, true);
  const attacks = [
    (value) => { value.authorization.restrictedDestinationAuthorities = []; },
    (value) => { value.authorization.restrictedDestinationAuthorities[0].tenantId = FOREIGN_TENANT; },
    (value) => { value.authorization.restrictedDestinationAuthorities[0].subjectId = "id_ffffffffffffffff"; },
    (value) => { value.authorization.restrictedDestinationAuthorities[0].destinationId = "id_ffffffffffffffff"; },
    (value) => {
      value.authorization.restrictedDestinationAuthorities = [];
      value.authorization.privateDestinationGrants = privateFixture().authorization.privateDestinationGrants;
    },
    (value) => { value.authorization.skill = "building-admin"; },
    (value) => { value.authorization.assignment = "operator"; }
  ];
  for (const mutate of attacks) {
    const options = restrictedFixture();
    mutate(options);
    assert.deepEqual(domain.createTenantSkyscraperNavigationAuthorizer(options)
      .decideNavigation(request(destinationId)), { ok: false, code: "not_found" });
  }
  const clientAssertion = request(destinationId);
  clientAssertion.authority = true;
  assert.deepEqual(domain.createTenantSkyscraperNavigationAuthorizer(restrictedFixture())
    .decideNavigation(clientAssertion), { ok: false, code: "not_found" });
});

test("B9 closes owner lifecycle and cross-tenant access before every non-public branch", async () => {
  const domain = await loadDomain();
  const controls = [
    [authenticatedFixture, "id_0000000000000101"],
    [invitedFixture, PUBLIC_DESTINATION],
    [privateFixture, "id_0000000000000101"],
    [restrictedFixture, "id_0000000000000101"]
  ];
  for (const [fixture, destinationId] of controls) {
    for (const lifecycle of ["archived", "deleted_tombstone"]) {
      for (const channel of ["door", "elevator", "direct", "alternative"]) {
        const options = fixture();
        options.authorization.ownerTenantLifecycles[0].lifecycle = lifecycle;
        assert.deepEqual(domain.createTenantSkyscraperNavigationAuthorizer(options)
          .decideNavigation(request(destinationId, channel)), { ok: false, code: "not_found" });
      }
    }
  }

  for (const mutate of [
    (value) => { value.authorization.ownerTenantLifecycles = []; },
    (value) => { value.authorization.ownerTenantLifecycles.push(clone(value.authorization.ownerTenantLifecycles[0])); },
    (value) => { value.authorization.ownerTenantLifecycles.push({ tenantId: FOREIGN_TENANT, lifecycle: "active" }); },
    (value) => { value.catalog.building.lifecycle = "archived"; },
    (value) => { value.catalog.building.floors[0].lifecycle = "deleted_tombstone"; },
    (value) => { value.catalog.building.floors[0].destinations[0].lifecycle = "archived"; }
  ]) {
    const options = authenticatedFixture();
    mutate(options);
    assert.deepEqual(domain.createTenantSkyscraperNavigationAuthorizer(options)
      .decideNavigation(request("id_0000000000000101")), { ok: false, code: "not_found" });
  }

  const crossTenant = authenticatedFixture();
  crossTenant.authorization.activeTenantMembership.tenantId = FOREIGN_TENANT;
  assert.deepEqual(domain.createTenantSkyscraperNavigationAuthorizer(crossTenant)
    .decideNavigation(request("id_0000000000000101")), { ok: false, code: "not_found" });
  const clientLifecycle = request("id_0000000000000101");
  clientLifecycle.ownerLifecycle = "active";
  assert.deepEqual(domain.createTenantSkyscraperNavigationAuthorizer(authenticatedFixture())
    .decideNavigation(clientLifecycle), { ok: false, code: "not_found" });
});

test("B10 returns one fresh non-enumerating denial shape for a finite attack table", async () => {
  const domain = await loadDomain();
  const attacks = [
    [publicFixture(), { ...request(), destinationId: "id_ffffffffffffffff", marker: "neighbor-marker" }],
    [authenticatedFixture(), { ...request("id_0000000000000101"), buildingId: "id_ffffffffffffffff" }],
    [invitedFixture(), { ...request(), floorId: "id_ffffffffffffffff" }],
    [privateFixture(), { ...request("id_0000000000000101"), elevatorStopId: "id_ffffffffffffffff" }],
    [restrictedFixture(), { ...request("id_0000000000000101"), destinationId: "id_ffffffffffffffff" }]
  ];
  const denials = attacks.map(([options, rawRequest]) =>
    domain.createTenantSkyscraperNavigationAuthorizer(options).decideNavigation(rawRequest));
  for (const denial of denials) {
    assert.deepEqual(Object.keys(denial), ["ok", "code"]);
    assert.equal(JSON.stringify(denial), '{"ok":false,"code":"not_found"}');
    assert.equal(Object.isFrozen(denial), true);
    assert.equal(JSON.stringify(denial).includes("marker"), false);
  }
  assert.equal(new Set(denials).size, denials.length);
  assert.equal(new Set(denials.map((value) => JSON.stringify(value).length)).size, 1);
});

test("B11 rejects hostile object boundaries and admits the exact maximal active graph", async () => {
  const domain = await loadDomain();
  const deny = (options, rawRequest = request()) => assert.deepEqual(
    domain.createTenantSkyscraperNavigationAuthorizer(options).decideNavigation(rawRequest),
    { ok: false, code: "not_found" }
  );

  deny(new Proxy(publicFixture(), {}));
  deny(publicFixture(), new Proxy(request(), {}));
  let throwingProxyTraps = 0;
  const throwingProxy = new Proxy(publicFixture(), {
    getPrototypeOf() { throwingProxyTraps += 1; throw new Error("marker"); },
    ownKeys() { throwingProxyTraps += 1; throw new Error("marker"); }
  });
  deny(throwingProxy);
  assert.equal(throwingProxyTraps, 0);

  const attacks = [];
  const missing = publicFixture();
  delete missing.catalog.schemaVersion;
  attacks.push(missing);
  attacks.push({ ...publicFixture(), unexpected: true });
  const symbol = publicFixture();
  symbol[Symbol("marker")] = true;
  attacks.push(symbol);
  attacks.push(Object.assign(Object.create({ inherited: true }), publicFixture()));
  const accessor = publicFixture();
  Object.defineProperty(accessor, "evaluatedAt", { enumerable: true, get() { return EVALUATED_AT; } });
  attacks.push(accessor);
  const nonEnumerable = publicFixture();
  Object.defineProperty(nonEnumerable.catalog.building, "displayName", {
    value: "Synthetic Tower", enumerable: false, configurable: true, writable: true
  });
  attacks.push(nonEnumerable);
  const holey = publicFixture();
  delete holey.catalog.building.floors[0].destinations[1];
  attacks.push(holey);
  const noncanonicalIndex = publicFixture();
  noncanonicalIndex.catalog.building.floors[0].destinations["01"] = destination(maximalId(9000));
  attacks.push(noncanonicalIndex);
  const wrongPrototype = publicFixture();
  Object.setPrototypeOf(wrongPrototype.catalog, Date.prototype);
  attacks.push(wrongPrototype);
  const boxed = publicFixture();
  boxed.evaluatedAt = new String(EVALUATED_AT);
  attacks.push(boxed);
  const unsafeInteger = publicFixture();
  unsafeInteger.authorization.policyRevision = Number.MAX_SAFE_INTEGER + 1;
  attacks.push(unsafeInteger);
  const negativeZero = publicFixture();
  negativeZero.authorization.policyRevision = -0;
  attacks.push(negativeZero);
  const badTimestamp = publicFixture();
  badTimestamp.evaluatedAt = "2000-01-01T00:30:00.000+00:00";
  attacks.push(badTimestamp);
  const alias = publicFixture();
  alias.catalog.building.floors[0].destinations[1] = alias.catalog.building.floors[0].destinations[0];
  attacks.push(alias);
  const cycle = publicFixture();
  cycle.catalog.building.floors[0].destinations[1] = cycle.catalog.building;
  attacks.push(cycle);
  const wide = publicFixture();
  for (let index = 0; index < 13; index += 1) wide.catalog[`wide${index}`] = index;
  attacks.push(wide);
  for (const attack of attacks) deny(attack);

  const maximal = maximalFixture();
  assert.deepEqual(instrumentGraph(maximal.options), {
    containers: 1194,
    descriptors: 6882,
    values: 6883,
    utf8Bytes: 295494
  });
  const conservativeComponents = [279, 24700, 227200, 416, 53144, 157, 3724, 401, 3724];
  const conservativeBytes = conservativeComponents.reduce((total, value) => total + value, 0);
  assert.equal(conservativeBytes, 313745);
  assert.ok(conservativeBytes < 524288);
  assert.equal(domain.createTenantSkyscraperNavigationAuthorizer(maximal.options)
    .decideNavigation(maximal.request).ok, true);

  const overLimits = [
    ["floors", 64, (value) => value.catalog.building.floors],
    ["destinations", 8, (value) => value.catalog.building.floors[0].destinations],
    ["owner lifecycles", 512, (value) => value.authorization.ownerTenantLifecycles],
    ["private grants", 16, (value) => value.authorization.privateDestinationGrants],
    ["restricted authorities", 16, (value) => value.authorization.restrictedDestinationAuthorities]
  ];
  for (const [label, limit, select] of overLimits) {
    const fixture = maximalFixture();
    const array = select(fixture.options);
    let deeperReads = 0;
    Object.defineProperty(array, String(limit), {
      configurable: true,
      enumerable: true,
      get() { deeperReads += 1; throw new Error(`${label} marker`); }
    });
    deny(fixture.options, fixture.request);
    assert.equal(deeperReads, 0, `${label} limit was checked after a deeper descriptor read`);
  }
});

test("B12 denies traversal mutation and returns no caller identity in recursively frozen output", async () => {
  const originalDescriptor = Object.getOwnPropertyDescriptor;
  const options = publicFixture();
  let mutated = false;
  try {
    Object.getOwnPropertyDescriptor = function instrumentedDescriptor(value, key) {
      const descriptor = originalDescriptor(value, key);
      if (!mutated && value === options.catalog && key === "building") {
        mutated = true;
        options.evaluatedAt = "2000-01-01T00:45:00.000Z";
      }
      return descriptor;
    };
    const isolated = await import(`${MODULE_PATH}?b12-mutation`);
    assert.deepEqual(isolated.createTenantSkyscraperNavigationAuthorizer(options)
      .decideNavigation(request()), { ok: false, code: "not_found" });
  } finally {
    Object.getOwnPropertyDescriptor = originalDescriptor;
  }
  assert.equal(mutated, true);

  const domain = await loadDomain();
  const custodyInput = invitedFixture();
  const identities = new WeakSet();
  (function collect(value) {
    if (value === null || typeof value !== "object" || identities.has(value)) return;
    identities.add(value);
    for (const key of Reflect.ownKeys(value)) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (descriptor && "value" in descriptor) collect(descriptor.value);
    }
  })(custodyInput);
  const result = domain.createTenantSkyscraperNavigationAuthorizer(custodyInput).decideNavigation(request());
  assert.equal(result.ok, true);
  (function verify(value) {
    if (value === null || typeof value !== "object") return;
    assert.equal(identities.has(value), false);
    assert.equal(Object.isFrozen(value), true);
    for (const key of Reflect.ownKeys(value)) verify(value[key]);
  })(result);
  assert.throws(() => { result.decision.validUntil = null; }, TypeError);
  custodyInput.authorization.invitation.expiresAt = "2000-01-01T02:00:00.000Z";
  assert.equal(result.decision.validUntil, "2000-01-01T01:00:00.000Z");
});

test("B13 keeps exactly two exports and no import outside this focused test", () => {
  const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));
  const moduleSource = readFileSync(new URL(MODULE_PATH, import.meta.url), "utf8");
  const exports = [...moduleSource.matchAll(/\bexport\s+(?:const|function)\s+([A-Za-z_$][\w$]*)/g)]
    .map((match) => match[1]).sort();
  assert.deepEqual(exports, [
    "TENANT_SKYSCRAPER_NAVIGATION_ACCESS_STATES",
    "createTenantSkyscraperNavigationAuthorizer"
  ]);
  assert.equal(/\bexport\s+default\b/.test(moduleSource), false);

  const candidates = ["server", "src", "tests"].flatMap((directory) => {
    const walk = (path) => readdirSync(path, { withFileTypes: true }).flatMap((entry) => {
      const child = `${path}/${entry.name}`;
      return entry.isDirectory() ? walk(child) : [child];
    });
    return walk(`${repositoryRoot}/${directory}`);
  }).concat(`${repositoryRoot}/index.html`);
  const importers = candidates.filter((path) =>
    /\.(?:[cm]?js|tsx?|html)$/.test(path) &&
    readFileSync(path, "utf8").includes("tenantSkyscraperNavigationDomain"));
  assert.deepEqual(importers.map((path) => path.slice(repositoryRoot.length + 1)), [
    "tests/tenant-skyscraper-navigation-domain.test.mjs"
  ]);
});
