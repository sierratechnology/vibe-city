import assert from "node:assert/strict";
import test from "node:test";

import { resolveReviewedHostedIdentityMapping } from "../server/hermesPresenceAdapter.mjs";

const EVALUATED_AT = "2026-07-29T12:06:00.000Z";

function mapping(overrides = {}) {
  return {
    schemaVersion: "1.0",
    tenantId: "id_1111111111111111",
    subjectId: "id_2222222222222222",
    identityId: "stg-spiders",
    profileName: "synthetic_profile",
    registryRevision: 7,
    synchronizedAt: "2026-07-29T12:00:00.000Z",
    status: "active",
    ...overrides
  };
}

function validateMapping(value, evaluatedAt) {
  const expectedKeys = [
    "identityId", "profileName", "registryRevision", "schemaVersion", "status", "subjectId", "synchronizedAt",
    "tenantId"
  ];
  try {
    if (value === null || typeof value !== "object" || Array.isArray(value) ||
        Object.keys(value).sort().join("|") !== expectedKeys.join("|") ||
        value.schemaVersion !== "1.0" || !/^id_[a-f0-9]{16,64}$/.test(value.tenantId) ||
        !/^id_[a-f0-9]{16,64}$/.test(value.subjectId) || value.identityId !== "stg-spiders" ||
        !/^[a-z][a-z0-9_-]{0,63}$/.test(value.profileName) ||
        !Number.isSafeInteger(value.registryRevision) || value.registryRevision < 0 ||
        !["active", "revoked", "retired"].includes(value.status) ||
        new Date(value.synchronizedAt).toISOString() !== value.synchronizedAt ||
        Date.parse(value.synchronizedAt) > Date.parse(evaluatedAt)) {
      return { ok: false, code: "invalid_hosted_agent_presence" };
    }
    return { ok: true, value: Object.freeze({ ...value }) };
  } catch {
    return { ok: false, code: "invalid_hosted_agent_presence" };
  }
}

function resolve(mappingCandidates, installedProfileNames) {
  return resolveReviewedHostedIdentityMapping({
    mappingCandidates,
    installedProfileNames,
    evaluatedAt: EVALUATED_AT,
    validateMapping
  });
}

function assertRejected(result) {
  assert.deepEqual(result, { ok: false, code: "invalid_hosted_agent_mapping" });
  assert.equal("value" in result, false);
  assert.equal(JSON.stringify(result).includes("synthetic_profile"), false);
}

test("resolver rejects a reviewed mapping with an extra private field generically", () => {
  const result = resolveReviewedHostedIdentityMapping({
    mappingCandidates: [mapping()],
    installedProfileNames: ["synthetic_profile"],
    evaluatedAt: EVALUATED_AT,
    validateMapping() {
      return { ok: true, value: mapping({ privateToken: "must-not-escape" }) };
    }
  });

  assertRejected(result);
  assert.equal(JSON.stringify(result).includes("must-not-escape"), false);
});

test("resolver rejects a reviewed mapping with a missing required field generically", () => {
  const incomplete = mapping();
  delete incomplete.tenantId;
  const result = resolveReviewedHostedIdentityMapping({
    mappingCandidates: [mapping()],
    installedProfileNames: ["synthetic_profile"],
    evaluatedAt: EVALUATED_AT,
    validateMapping() {
      return { ok: true, value: incomplete };
    }
  });

  assertRejected(result);
});

test("resolver rejects a reviewed mapping with a malformed scalar generically", () => {
  const cases = [
    mapping({ schemaVersion: new String("1.0") }),
    mapping({ tenantId: "id_111111111111111G" }),
    mapping({ subjectId: "id_2222222222222222/path" }),
    mapping({ identityId: new String("stg-spiders") }),
    mapping({ profileName: new String("synthetic_profile") }),
    mapping({ registryRevision: -1 }),
    mapping({ registryRevision: -0 }),
    mapping({ registryRevision: 1.5 }),
    mapping({ registryRevision: Number.MAX_SAFE_INTEGER + 1 }),
    mapping({ synchronizedAt: new Date("2026-07-29T12:00:00.000Z") }),
    mapping({ synchronizedAt: "2026-07-29T12:00:00Z" }),
    mapping({ synchronizedAt: "2026-07-29T12:07:00.000Z" }),
    mapping({ status: new String("active") }),
    mapping({ status: "unknown" })
  ];

  for (const value of cases) {
    const result = resolveReviewedHostedIdentityMapping({
      mappingCandidates: [mapping()],
      installedProfileNames: ["synthetic_profile"],
      evaluatedAt: EVALUATED_AT,
      validateMapping() {
        return { ok: true, value };
      }
    });
    assertRejected(result);
  }
});

test("resolver rejects reviewed mappings with own symbols or accessors without invoking getters", () => {
  const symbolMapping = mapping();
  symbolMapping[Symbol("private")] = "must-not-escape";
  let getterReads = 0;
  const accessorMapping = mapping();
  Object.defineProperty(accessorMapping, "tenantId", {
    enumerable: true,
    get() {
      getterReads += 1;
      return "id_1111111111111111";
    }
  });
  const nonEnumerableMapping = mapping();
  Object.defineProperty(nonEnumerableMapping, "tenantId", { enumerable: false });
  const inheritedMapping = mapping();
  Object.setPrototypeOf(inheritedMapping, { privateToken: "must-not-escape" });

  for (const value of [symbolMapping, accessorMapping, nonEnumerableMapping, inheritedMapping]) {
    const result = resolveReviewedHostedIdentityMapping({
      mappingCandidates: [mapping()],
      installedProfileNames: ["synthetic_profile"],
      evaluatedAt: EVALUATED_AT,
      validateMapping() {
        return { ok: true, value };
      }
    });
    assertRejected(result);
  }
  assert.equal(getterReads, 0);
});

test("resolver rejects a reviewed mapping with a nested mutable value generically", () => {
  const nested = { privateToken: "must-not-escape" };
  const result = resolveReviewedHostedIdentityMapping({
    mappingCandidates: [mapping()],
    installedProfileNames: ["synthetic_profile"],
    evaluatedAt: EVALUATED_AT,
    validateMapping() {
      return { ok: true, value: mapping({ tenantId: nested }) };
    }
  });

  assertRejected(result);
  assert.equal(JSON.stringify(result).includes("must-not-escape"), false);
});

test("presence requires exactly one active reviewed stg-spiders profile mapping", () => {
  const reviewedSource = mapping();
  const result = resolveReviewedHostedIdentityMapping({
    mappingCandidates: [mapping()],
    installedProfileNames: ["synthetic_profile"],
    evaluatedAt: EVALUATED_AT,
    validateMapping() {
      return { ok: true, value: reviewedSource };
    }
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.value, mapping());
  assert.notEqual(result.value, reviewedSource);
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.value), true);
  reviewedSource.registryRevision = 8;
  assert.equal(result.value.registryRevision, 7);
});

test("reviewed mapping rejects missing ambiguous inactive malformed and unresolved candidates generically", () => {
  const cases = [
    [[], ["synthetic_profile"]],
    [[mapping(), mapping({ registryRevision: 8 })], ["synthetic_profile"]],
    [[mapping({ status: "revoked" })], ["synthetic_profile"]],
    [[mapping({ status: "retired" })], ["synthetic_profile"]],
    [[mapping({ identityId: "other-agent" })], ["synthetic_profile"]],
    [[mapping({ extra: true })], ["synthetic_profile"]],
    [[mapping({ schemaVersion: "2.0" })], ["synthetic_profile"]],
    [[mapping({ registryRevision: 1.5 })], ["synthetic_profile"]],
    [[mapping({ synchronizedAt: "2026-07-29T12:07:00.000Z" })], ["synthetic_profile"]],
    [[mapping()], []],
    [[mapping()], ["synthetic_profile", "synthetic_profile"]],
    [[mapping()], ["renamed_profile"]]
  ];

  for (const [mappingCandidates, installedProfileNames] of cases) {
    assertRejected(resolve(mappingCandidates, installedProfileNames));
  }
});

test("reviewed mapping snapshots bounded candidate and profile collections without invoking accessors", () => {
  const sparseCandidates = new Array(1);
  const symbolCandidates = [mapping()];
  symbolCandidates[Symbol("hidden")] = true;
  let candidateGetterReads = 0;
  const accessorCandidates = [];
  Object.defineProperty(accessorCandidates, "0", {
    enumerable: true,
    get() {
      candidateGetterReads += 1;
      return mapping();
    }
  });
  accessorCandidates.length = 1;
  const throwingCandidates = new Proxy([mapping()], {
    ownKeys() { throw new Error("sensitive candidate trap"); }
  });
  let candidateKeyReads = 0;
  const mutatingCandidates = new Proxy([mapping()], {
    ownKeys(target) {
      candidateKeyReads += 1;
      if (candidateKeyReads > 1) target[0] = mapping({ registryRevision: 8 });
      return Reflect.ownKeys(target);
    }
  });

  const sparseProfiles = new Array(1);
  const symbolProfiles = ["synthetic_profile"];
  symbolProfiles[Symbol("hidden")] = true;
  let profileGetterReads = 0;
  const accessorProfiles = [];
  Object.defineProperty(accessorProfiles, "0", {
    enumerable: true,
    get() {
      profileGetterReads += 1;
      return "synthetic_profile";
    }
  });
  accessorProfiles.length = 1;
  const throwingProfiles = new Proxy(["synthetic_profile"], {
    ownKeys() { throw new Error("sensitive profile trap"); }
  });
  let profileKeyReads = 0;
  const mutatingProfiles = new Proxy(["synthetic_profile"], {
    ownKeys(target) {
      profileKeyReads += 1;
      if (profileKeyReads > 1) target[0] = "renamed_profile";
      return Reflect.ownKeys(target);
    }
  });

  for (const candidates of [sparseCandidates, symbolCandidates, accessorCandidates,
    throwingCandidates, mutatingCandidates]) {
    assertRejected(resolve(candidates, ["synthetic_profile"]));
  }
  for (const profiles of [sparseProfiles, symbolProfiles, accessorProfiles,
    throwingProfiles, mutatingProfiles]) {
    assertRejected(resolve([mapping()], profiles));
  }
  assert.equal(candidateGetterReads, 0);
  assert.equal(profileGetterReads, 0);

  let validationCalls = 0;
  const oversizedResult = resolveReviewedHostedIdentityMapping({
    mappingCandidates: [mapping(), mapping(), mapping()],
    installedProfileNames: ["synthetic_profile"],
    evaluatedAt: EVALUATED_AT,
    validateMapping() {
      validationCalls += 1;
      return { ok: true, value: mapping() };
    }
  });
  assertRejected(oversizedResult);
  assert.equal(validationCalls, 0);

  const candidatesMutatedDuringValidation = [mapping()];
  const mutationResult = resolveReviewedHostedIdentityMapping({
    mappingCandidates: candidatesMutatedDuringValidation,
    installedProfileNames: ["synthetic_profile"],
    evaluatedAt: EVALUATED_AT,
    validateMapping(value, evaluatedAt) {
      const result = validateMapping(value, evaluatedAt);
      candidatesMutatedDuringValidation[0] = mapping({ registryRevision: 8 });
      return result;
    }
  });
  assertRejected(mutationResult);
});
