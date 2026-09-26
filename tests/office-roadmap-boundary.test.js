import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const manifestRelativePath = 'docs/research/office-roadmap-boundary-2026-09-26.json';
const manifestPath = path.join(root, manifestRelativePath);
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const replacementCommit = '3550f164747a75a1d19a3fcc5fee3f4fe9d69dcc';
const requiredStateFields = [
  'implementedInHistory',
  'presentOnCurrentMain',
  'replacedBy',
  'producedOnly',
  'blockedBy',
  'notStarted',
];

function filesBelow(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);
    return entry.isDirectory() ? filesBelow(entryPath) : [entryPath];
  });
}

test('boundary manifest pins the verified current and historical identities', () => {
  assert.equal(manifest.schemaVersion, 1);
  assert.deepEqual(manifest.currentFirstSignal, {
    commit: 'f270a5de538a0ed4963bccf7a885bae2d1c9099c',
    tree: '1f95bb3d51644ab68f2c370eecc2c3d73e5c4ca3',
    product: 'Vibe City: First Signal',
    productionDeployment: {
      id: '6682629451',
      commit: 'f270a5de538a0ed4963bccf7a885bae2d1c9099c',
      evidenceOnly: true,
    },
  });
  assert.deepEqual(manifest.historicalOfficeRoadmap, {
    commit: '84a7f1cd3f8514869d6c0d5e1744a203aac267f3',
    tree: '39ff66c7f4b7bc94343d5f2f8ce2892d56e5b687',
    milestone3PacketCommit: '1b2302e082a5bc03c5903587fbdebb41dc7ef65d',
    milestone3Slice1Release: '8bf044d9de4465b7df86ed59df7292e8effca09c',
    replacementCommit,
  });
});

test('M3 through M11 preserve distinct truthful state fields and historical lineage', () => {
  assert.deepEqual(manifest.milestones.map(({ id }) => id), [
    'M3', 'M4', 'M5', 'M6', 'M7', 'M8', 'M9', 'M10', 'M11',
  ]);
  for (const milestone of manifest.milestones) {
    assert.deepEqual(
      Object.keys(milestone).filter((key) => requiredStateFields.includes(key)).sort(),
      [...requiredStateFields].sort(),
      `${milestone.id} must retain every non-collapsed state field`,
    );
    assert.equal(milestone.presentOnCurrentMain, false, milestone.id);
    assert.ok(Array.isArray(milestone.implementedInHistory), milestone.id);
    assert.ok(Array.isArray(milestone.blockedBy), milestone.id);
    assert.equal(typeof milestone.notStarted, 'boolean', milestone.id);
  }

  const byId = Object.fromEntries(manifest.milestones.map((milestone) => [milestone.id, milestone]));
  assert.deepEqual(byId.M3.slices.map(({ id }) => id), ['M3.1', 'M3.2', 'M3.3', 'M3.4', 'M3.5', 'M3.6']);
  for (const slice of byId.M3.slices) {
    for (const field of requiredStateFields) assert.ok(Object.hasOwn(slice, field), `${slice.id}.${field}`);
  }
  assert.ok(byId.M3.slices.slice(0, 5).every((slice) => (
    slice.implementedInHistory.length === 1
    && slice.presentOnCurrentMain === false
    && slice.replacedBy === replacementCommit
    && slice.producedOnly === false
    && slice.blockedBy.length === 0
    && slice.notStarted === false
  )));
  assert.deepEqual(byId.M3.slices[5], {
    id: 'M3.6',
    implementedInHistory: [],
    presentOnCurrentMain: false,
    replacedBy: null,
    producedOnly: false,
    blockedBy: ['human_identity_provider_credential_retention_security_privacy_deployment_decisions'],
    notStarted: true,
  });

  for (const id of ['M4', 'M5', 'M6', 'M7']) {
    assert.ok(byId[id].implementedInHistory.length > 0, id);
    assert.equal(byId[id].replacedBy, replacementCommit, id);
    assert.equal(byId[id].notStarted, false, id);
  }
  assert.deepEqual(byId.M7.producedOnly, {
    integrated: false,
    candidateTree: '35daf686ff7cdc43e39abcd5c04e3f56e733a45e',
  });
  for (const id of ['M8', 'M10', 'M11']) {
    assert.deepEqual(byId[id].implementedInHistory, [], id);
    assert.equal(byId[id].replacedBy, null, id);
    assert.equal(byId[id].producedOnly, false, id);
    assert.deepEqual(byId[id].blockedBy, [], id);
    assert.equal(byId[id].notStarted, true, id);
  }
  assert.deepEqual(byId.M9.implementedInHistory, []);
  assert.equal(byId.M9.notStarted, true);
  assert.ok(byId.M9.blockedBy.length > 0);
});

test('separate application policy and immutable safety gates remain explicit', () => {
  assert.equal(manifest.compositionPolicy, 'separate_application_required');
  assert.deepEqual(manifest.separateApplicationBoundary, {
    independent: [
      'name_or_repository_or_long_lived_application_branch',
      'runtime',
      'deployment',
      'data',
      'credentials',
      'backups',
      'privacy_security_policy',
      'release_history',
    ],
    prohibitedReuse: [
      'first_signal_production_route',
      'first_signal_saves',
      'first_signal_world_keys',
      'first_signal_redis_namespace',
      'first_signal_credentials',
      'first_signal_identity_semantics',
    ],
  });
  assert.deepEqual(manifest.immutableGates, {
    privacyPrivateByDefault: true,
    backendTenantIsolation: true,
    representationalIntegrity: true,
    accessibility: {
      keyboard: true,
      touch: true,
      nonSpatial: true,
    },
    piClassMeaningParity: true,
    backupRollback: true,
    exactIdentityReview: true,
    truthfulStatus: {
      required: true,
      distinctStates: [
        'Produced',
        'Verified',
        'Recorded',
        'Reviewed',
        'Approved',
        'Activated',
        'Working',
        'Blocked',
        'Not configured',
      ],
    },
  });
  assert.deepEqual(manifest.humanOnlyGates, {
    provider: true,
    credential: true,
    legal: true,
    securityPolicy: true,
    retention: true,
    publicData: true,
    spending: true,
  });
});

test('current runtime and build inputs do not import or consume the manifest', () => {
  const runtimeRoots = ['api', 'client', 'server', 'shared'].map((directory) => path.join(root, directory));
  const runtimeFiles = runtimeRoots.flatMap(filesBelow);
  const forbiddenReferences = runtimeFiles.filter((file) => (
    fs.readFileSync(file, 'utf8').includes(manifestRelativePath)
    || fs.readFileSync(file, 'utf8').includes(path.basename(manifestPath))
  ));
  assert.deepEqual(forbiddenReferences, []);

  const buildScript = fs.readFileSync(path.join(root, 'scripts/build-web.js'), 'utf8');
  assert.doesNotMatch(buildScript, /docs|research|office-roadmap-boundary/);
  assert.deepEqual(manifest.runtimeContract, {
    importedByCurrentRuntime: false,
    consumedByCurrentRuntime: false,
    changesProductionBehavior: false,
  });
});
