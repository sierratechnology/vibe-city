import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Game} from '../server/game.js';
import {saveWorld, loadWorld} from '../server/persistence.js';

function fixture(grants = undefined) {
  const game = new Game();
  const owner = game.join('owner', 'Owner');
  const collaborator = game.join('collaborator', 'Collaborator');
  const stranger = game.join('stranger', 'Stranger');
  const bed = {id: 'bed', type: 'garden', x: 0, z: 3, owner: owner.id, readyAt: 1, ...(grants === undefined ? {} : {hydroponicsGrants: grants})};
  game.world.time = 1;
  game.world.structures.push(bed);
  return {game, owner, collaborator, stranger, bed};
}

function harvest(game, actor) {
  return game.action(actor.id, {type: 'garden', id: 'bed'});
}

test('hydroponic bed owner and saved collaborator are authorized while a stranger is denied', () => {
  for (const role of ['owner', 'collaborator']) {
    const context = fixture(['collaborator']);
    assert.equal(harvest(context.game, context[role]).ok, true);
    assert.equal(context[role].inventory.fiber, 2);
    assert.equal(context[role].inventory.ration, 1);
    const other = role === 'owner' ? context.collaborator : context.owner;
    assert.equal(other.inventory.fiber, 0);
    assert.equal(other.inventory.ration, 0);
  }
  const context = fixture(['collaborator']);
  const before = structuredClone(context.game.world);
  assert.deepEqual(harvest(context.game, context.stranger), {ok: false, message: 'Only the hydroponic bed builder or an authorized collaborator may use it.'});
  assert.deepEqual(context.game.world, before);
});

test('missing ownership and malformed hydroponic grants fail closed for non-owners', () => {
  const malformed = [null, {}, ['collaborator', 'collaborator'], ['owner'], ['missing'], ['__proto__'], [7], ['x'.repeat(129)], Array.from({length: 17}, (_, index) => `saved-${index}`)];
  for (const grants of malformed) {
    const {game, collaborator, bed} = fixture(grants);
    const before = structuredClone({inventory: collaborator.inventory, readyAt: bed.readyAt});
    assert.equal(harvest(game, collaborator).ok, false);
    assert.deepEqual({inventory: collaborator.inventory, readyAt: bed.readyAt}, before);
  }
  const context = fixture(['collaborator']);
  delete context.bed.owner;
  assert.equal(harvest(context.game, context.collaborator).ok, false);
});

test('nearby owner grants and revokes one saved explorer with immediate authorization changes', () => {
  const {game, owner, collaborator, bed} = fixture();
  assert.deepEqual(game.action(owner.id, {type: 'hydroponicsAccess', id: bed.id, target: collaborator.id, allow: true}), {ok: true, message: 'Collaborator may use this hydroponic bed.'});
  assert.deepEqual(bed.hydroponicsGrants, [collaborator.id]);
  assert.deepEqual(game.action(owner.id, {type: 'hydroponicsAccess', id: bed.id, target: collaborator.id, allow: false}), {ok: true, message: 'Collaborator no longer has hydroponic access.'});
  assert.equal(Object.hasOwn(bed, 'hydroponicsGrants'), false);
  assert.equal(harvest(game, collaborator).ok, false);
  assert.equal(bed.readyAt, 1);
});

test('hydroponic access management rejects unauthorized malformed remote duplicate and over-cap requests without mutation', () => {
  const make = () => fixture();
  const reject = (context, actor, request) => {
    const before = structuredClone(context.game.world);
    assert.equal(context.game.action(actor.id, request).ok, false);
    assert.deepEqual(context.game.world, before);
  };
  {
    const context = make();
    const valid = {type: 'hydroponicsAccess', id: context.bed.id, target: context.collaborator.id, allow: true};
    reject(context, context.stranger, valid);
    context.owner.x = 20; reject(context, context.owner, valid);
  }
  for (const request of [
    {type: 'hydroponicsAccess', id: 'bed', target: 'collaborator', allow: true, extra: true},
    {type: 'hydroponicsAccess', id: 'bed', target: {id: 'collaborator'}, allow: true},
    {type: 'hydroponicsAccess', id: 'bed', target: 'missing', allow: true},
    {type: 'hydroponicsAccess', id: 'bed', target: 'owner', allow: true},
    {type: 'hydroponicsAccess', id: 'bed', target: '__proto__', allow: true},
    {type: 'hydroponicsAccess', id: 'bed', target: 'collaborator', allow: 'yes'},
  ]) reject(make(), make().owner, request);
  {
    const context = make();
    assert.equal(context.game.action(context.owner.id, {type: 'hydroponicsAccess', id: 'bed', target: 'collaborator', allow: true}).ok, true);
    reject(context, context.owner, {type: 'hydroponicsAccess', id: 'bed', target: 'collaborator', allow: true});
  }
  {
    const context = make();
    const ids = Array.from({length: 17}, (_, index) => context.game.join(`saved-${index}`, `Saved ${index}`).id);
    context.bed.hydroponicsGrants = ids.slice(0, 16);
    reject(context, context.owner, {type: 'hydroponicsAccess', id: 'bed', target: ids[16], allow: true});
  }
});

test('Proxy accessor and custom-prototype hydroponic access requests fail closed before mutation', () => {
  const requests = [];
  requests.push(new Proxy({type: 'hydroponicsAccess', id: 'bed', target: 'collaborator', allow: true}, {}));
  const accessor = {id: 'bed', target: 'collaborator', allow: true};
  let reads = 0;
  Object.defineProperty(accessor, 'type', {enumerable: true, get() { reads++; return 'hydroponicsAccess'; }});
  requests.push(accessor, Object.assign(Object.create({unexpected: true}), {type: 'hydroponicsAccess', id: 'bed', target: 'collaborator', allow: true}));
  for (const request of requests) {
    const context = fixture();
    const before = structuredClone(context.game.world);
    assert.equal(context.game.action(context.owner.id, request).ok, false);
    assert.deepEqual(context.game.world, before);
  }
  assert.equal(reads, 0);
});

test('hydroponic snapshots expose a bounded named roster only to owner and minimum capability only to collaborator', () => {
  const {game, owner, collaborator, stranger} = fixture(['collaborator']);
  const ownerBed = game.snapshot(owner.id).structures[0];
  const collaboratorBed = game.snapshot(collaborator.id).structures[0];
  const strangerBed = game.snapshot(stranger.id).structures[0];
  assert.deepEqual(ownerBed.hydroponicsGrantedTo, [{id: collaborator.id, name: collaborator.name}]);
  assert.equal(collaboratorBed.canUseHydroponics, true);
  for (const view of [collaboratorBed, strangerBed]) assert.equal(Object.hasOwn(view, 'hydroponicsGrantedTo'), false);
  assert.equal(Object.hasOwn(strangerBed, 'canUseHydroponics'), false);
  for (const view of [ownerBed, collaboratorBed, strangerBed]) assert.equal(Object.hasOwn(view, 'hydroponicsGrants'), false);
});

test('malformed persisted hydroponic grant state authorizes nobody and projects no rejected values', () => {
  const {game, owner, collaborator, stranger, bed} = fixture(['collaborator']);
  bed.hydroponicsGrants = ['collaborator', 'collaborator'];
  assert.equal(harvest(game, collaborator).ok, false);
  const ownerBed = game.snapshot(owner.id).structures[0];
  assert.deepEqual(ownerBed.hydroponicsGrantedTo, []);
  for (const actor of [collaborator, stranger]) {
    const view = game.snapshot(actor.id).structures[0];
    assert.equal(Object.hasOwn(view, 'canUseHydroponics'), false);
    assert.equal(Object.hasOwn(view, 'hydroponicsGrantedTo'), false);
    assert.equal(Object.hasOwn(view, 'hydroponicsGrants'), false);
  }
});

test('Proxy accessor and custom-prototype persisted hydroponic grants fail closed without executing traps', () => {
  let traps = 0;
  let getters = 0;
  const values = [
    new Proxy(['collaborator'], {
      get() { traps++; throw Error('get trap executed'); },
      getOwnPropertyDescriptor() { traps++; throw Error('descriptor trap executed'); },
      getPrototypeOf() { traps++; throw Error('prototype trap executed'); },
      ownKeys() { traps++; throw Error('ownKeys trap executed'); },
    }),
    Object.setPrototypeOf(['collaborator'], Object.create(Array.prototype)),
    (() => {
      const grants = ['collaborator'];
      Object.defineProperty(grants, 0, {enumerable: true, configurable: true, get() { getters++; return 'collaborator'; }});
      return grants;
    })(),
  ];
  for (const grants of values) {
    const {game, owner, collaborator, bed} = fixture();
    bed.hydroponicsGrants = grants;
    assert.doesNotThrow(() => assert.equal(harvest(game, collaborator).ok, false));
    assert.doesNotThrow(() => assert.deepEqual(game.snapshot(owner.id).structures[0].hydroponicsGrantedTo, []));
  }
  assert.equal(traps, 0);
  assert.equal(getters, 0);
});

test('save reload and reconnect preserve grants and revocation without access expansion', () => {
  const {game, owner, collaborator, stranger, bed} = fixture();
  assert.equal(game.action(owner.id, {type: 'hydroponicsAccess', id: bed.id, target: collaborator.id, allow: true}).ok, true);
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'vibe-hydroponics-access-'));
  try {
    const file = path.join(directory, 'world.json');
    saveWorld(file, game.world);
    const restored = new Game(loadWorld(file, 999));
    const restoredOwner = restored.join(owner.id, owner.name);
    const restoredCollaborator = restored.join(collaborator.id, collaborator.name);
    const restoredStranger = restored.join(stranger.id, stranger.name);
    assert.deepEqual(restored.world.structures[0].hydroponicsGrants, [collaborator.id]);
    assert.equal(harvest(restored, restoredCollaborator).ok, true);
    restored.world.structures[0].readyAt = restored.world.time;
    assert.equal(restored.action(restoredOwner.id, {type: 'hydroponicsAccess', id: bed.id, target: collaborator.id, allow: false}).ok, true);
    restored.leave(collaborator.id);
    restored.join(collaborator.id, collaborator.name);
    assert.equal(harvest(restored, restoredCollaborator).ok, false);
    assert.equal(harvest(restored, restoredStranger).ok, false);
    saveWorld(file, restored.world);
    const revoked = new Game(loadWorld(file, 999));
    const returning = revoked.join(collaborator.id, collaborator.name);
    assert.equal(Object.hasOwn(revoked.world.structures[0], 'hydroponicsGrants'), false);
    assert.equal(harvest(revoked, returning).ok, false);
  } finally {
    fs.rmSync(directory, {recursive: true, force: true});
  }
});
