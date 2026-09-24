import assert from 'node:assert/strict';
import test from 'node:test';
import * as planet from '../shared/planet.js';
import {coralShelfLandmark} from '../shared/landmarks.js';
import * as rendererModule from '../client/planet-renderer.js';
import * as THREE from 'three';

const SEED = 7319;
const CORAL_TILE = planet.tileAt(0, -1500);
const QUIET_TILE = planet.tileAt(0, 0);

test('Coral Shelf formations are deterministic, bounded per tile, and absent outside Coral Shelf', () => {
  assert.equal(typeof planet.coralShelfFormations, 'function');
  const first = planet.coralShelfFormations(SEED, CORAL_TILE);
  const again = planet.coralShelfFormations(SEED, {...CORAL_TILE});
  assert.deepEqual(first, again);
  assert.notEqual(first, again);
  assert.ok(first.length > 0);
  assert.ok(first.length <= 2);
  assert.deepEqual(planet.coralShelfFormations(SEED, QUIET_TILE), []);
  const nonCoralTile = planet.nearbyTiles({x: 0, z: -1500}).find(tile => planet.classifyBiome(...Object.values(planet.tileSample(tile, .5, .5)), SEED).id !== 'coral-shelf');
  if (nonCoralTile) assert.deepEqual(planet.coralShelfFormations(SEED, nonCoralTile), []);
});

test('Coral Shelf formations fail closed and preserve bounded scenery identity and separation', () => {
  assert.equal(typeof planet.nearbyCoralShelfFormations, 'function');
  assert.equal(planet.CORAL_FORMATIONS_NEARBY_MAX, 20);
  const crown = coralShelfLandmark(SEED);
  const resource = planet.tileContent(SEED, CORAL_TILE).nodes.find(node => node.id.startsWith('p:coral:'));
  const formations = planet.nearbyCoralShelfFormations(SEED, {x: 0, z: -1500}, [
    {x: crown.x, z: crown.z, radius: 14},
    {x: resource.x, z: resource.z, radius: 8},
  ]);
  assert.ok(formations.length > 0 && formations.length <= planet.CORAL_FORMATIONS_NEARBY_MAX);
  assert.equal(new Set(formations.map(formation => formation.id)).size, formations.length);
  for (const formation of formations) {
    assert.deepEqual(Object.keys(formation), ['id', 'kind', 'x', 'z', 'y', 'scale', 'rotation']);
    assert.equal(formation.kind, 'coral-fan');
    assert.match(formation.id, /^env:coral-fan:/);
    assert.doesNotMatch(formation.id, /^p:coral:/);
    assert.ok([formation.x, formation.z, formation.y, formation.scale, formation.rotation].every(Number.isFinite));
    assert.ok(formation.scale >= .8 && formation.scale <= 1.4);
    assert.ok(formation.rotation >= 0 && formation.rotation < Math.PI * 2);
    assert.ok(planet.planetDistance(formation, crown) >= 14);
    assert.ok(planet.planetDistance(formation, resource) >= 8);
  }
  for (const malformed of [
    [NaN, CORAL_TILE], [SEED, null], [SEED, {...CORAL_TILE, face: 6}],
    [SEED, {...CORAL_TILE, i: -1}], [SEED, {...CORAL_TILE, j: .5}],
  ]) assert.deepEqual(planet.coralShelfFormations(...malformed), []);
  for (const malformedPosition of [null, {x: NaN, z: 0}, {x: 0, z: Infinity}]) {
    assert.deepEqual(planet.nearbyCoralShelfFormations(SEED, malformedPosition), []);
  }
  assert.deepEqual(planet.nearbyCoralShelfFormations(SEED, {x: 0, z: -1500}, [{x: 0, z: 0, radius: NaN}]), []);
});

test('Coral Shelf fan renderer is bounded shared decorative geometry outside interaction collections', () => {
  assert.equal(typeof rendererModule.coralShelfFormationDescriptor, 'function');
  const formation = planet.coralShelfFormations(SEED, CORAL_TILE)[0];
  const descriptor = rendererModule.coralShelfFormationDescriptor(formation);
  assert.deepEqual(Object.keys(descriptor), ['kind', 'role', 'interactive', 'resource', 'bounds', 'ownership', 'parts']);
  assert.deepEqual(descriptor, {
    kind: 'coral-fan', role: 'scenery', interactive: false, resource: false,
    bounds: {radius: 3.5, height: 3.5},
    ownership: {geometry: 'shared-instanced', material: 'shared'},
    parts: descriptor.parts,
  });
  assert.equal(descriptor.parts.length, 5);
  assert.ok(new Set(descriptor.parts.map(part => part.tilt)).size >= 3);
  assert.ok(descriptor.parts.every(part => Object.values(part).every(Number.isFinite)));
  assert.equal(rendererModule.coralShelfFormationDescriptor({...formation, id: formation.id.replace('env:', 'p:coral:')}), null);

  const scene = new THREE.Scene();
  const renderer = rendererModule.planetRenderer(scene, SEED);
  renderer.update({x: 0, z: -1500});
  assert.ok(renderer.environment instanceof THREE.Group);
  assert.equal(renderer.environment.parent, scene);
  assert.equal(renderer.environment.children.length, 1);
  const instances = renderer.environment.children[0];
  assert.ok(instances instanceof THREE.InstancedMesh);
  assert.ok(instances.count > 0 && instances.count <= planet.CORAL_FORMATIONS_NEARBY_MAX * descriptor.parts.length);
  assert.deepEqual(instances.userData, {role: 'scenery', kind: 'coral-fan'});
  assert.equal(renderer.landmarks.children.includes(instances), false);
  renderer.dispose();
});
