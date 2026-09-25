import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {Game} from '../server/game.js';
import {RECIPES, makeWorld, placementError, shape, sheltered} from '../shared/world.js';
import {loadWorld,saveWorld} from '../server/persistence.js';
import {acceptSnapshotBaseline,applySnapshotDelta,createSnapshotDelta,createSnapshotSession,nextSnapshotPacket} from '../server/snapshot-delta.js';
import {contextAction,readableActionLabel} from '../shared/context-action.js';
const clientSource=fs.readFileSync(new URL('../client/main.js',import.meta.url),'utf8');

const lamp = (overrides = {}) => ({id: 'lamp', type: 'lamp', x: 9, z: 0, rotation: 0, owner: 'builder', ...overrides});
const wall = () => ({id: 'wall', type: 'wall', x: 9, z: 0, rotation: 0, owner: 'builder'});
function gameWithLamp(overrides = {}) {
  const game = new Game();
  const player = game.join('builder', 'Builder');
  Object.assign(player, {x: 9, z: 2});
  game.world.resources = [];
  game.world.creatures = [];
  game.world.structures.push(wall(), lamp(overrides));
  return {game, player};
}

test('Wall lumen keeps its catalog and spatial invariants and new construction starts on', () => {
  assert.deepEqual(RECIPES.lamp.cost, {ferrite: 1, crystal: 1});
  assert.equal(RECIPES.lamp.name, 'Wall lumen');
  assert.deepEqual([0, 1, 2, 3].map(rotation => {const s = shape(lamp({rotation}), 7319);return [s.x, s.z, s.w, s.d, s.h];}), [
    [9, -1.3, .28, .28, .45], [10.3, 0, .28, .28, .45], [9, 1.3, .28, .28, .45], [7.7, 0, .28, .28, .45],
  ]);
  const world = makeWorld();world.resources=[];world.structures.push(wall());
  assert.equal(placementError(world, {x:9,z:2}, {type:'lamp',x:9,z:0,rotation:0}), '');
  assert.equal(sheltered({...world, structures:[lamp()]}, {x:9,z:0}), false);
  const game = new Game();const player = game.join('builder','Builder');Object.assign(player,{x:9,z:2});Object.assign(player.inventory,{ferrite:1,crystal:1});game.world.resources=[];game.world.creatures=[];game.world.structures.push(wall());
  assert.equal(game.action(player.id,{type:'build',piece:'lamp',x:9,z:0,rotation:0}).ok,true);
  assert.equal(game.world.structures.at(-1).on,true);
});

test('Exact nearby Wall lumen request toggles legacy-on off then on without unrelated mutation', () => {
  const {game, player} = gameWithLamp();
  const before = structuredClone(game.world);
  assert.deepEqual(game.action(player.id, {type:'wallLumen', id:'lamp'}), {ok:true, message:'Wall lumen off.'});
  assert.equal(game.world.structures.at(-1).on, false);
  const changed = structuredClone(game.world);delete changed.structures.at(-1).on;
  assert.deepEqual(changed, before);
  assert.deepEqual(game.action(player.id, {type:'wallLumen', id:'lamp'}), {ok:true, message:'Wall lumen on.'});
  assert.equal(game.world.structures.at(-1).on, true);
});

test('Wall lumen authority rejects malformed requests, actors, state, coordinates and grids without mutation', () => {
  const requestCases = [
    {}, {type:'wallLumen'}, {type:'wallLumen',id:1}, {type:'wallLumen',id:'lamp',extra:true},
    new Proxy({type:'wallLumen',id:'lamp'}, {}), Object.defineProperty({type:'wallLumen'},'id',{enumerable:true,get(){throw Error('read');}}),
  ];
  for (const request of requestCases) {const {game,player}=gameWithLamp({on:true}),before=structuredClone(game.world);assert.equal(game.action(player.id,request).ok,false);assert.deepEqual(game.world,before);}
  for (const bad of [
    {id:'lamp',type:'wall',x:9,z:0,rotation:0,owner:'builder',on:true}, lamp({on:'yes'}), lamp({x:NaN,on:true}), lamp({z:Infinity,on:true}),
    lamp({gx:0,on:true}), lamp({gz:0,on:true}), lamp({site:{face:0,i:0,j:0},on:true}), lamp({site:{face:0,i:0,j:0},gx:0,on:true}),
    lamp({site:{face:0,i:0,j:0,extra:true},gx:0,gz:0,on:true}), new Proxy(lamp({on:true}), {}),
    Object.defineProperty(lamp(),'on',{enumerable:true,get(){throw Error('read');}}),
  ]) {const {game,player}=gameWithLamp({on:true});game.world.structures[1]=bad;const structures=game.world.structures;assert.equal(game.action(player.id,{type:'wallLumen',id:'lamp'}).ok,false);assert.equal(game.world.structures,structures);assert.equal(game.world.structures[1],bad);}
  const remote=gameWithLamp({on:true});remote.player.x=100;const remoteBefore=structuredClone(remote.game.world);assert.equal(remote.game.action(remote.player.id,{type:'wallLumen',id:'lamp'}).ok,false);assert.deepEqual(remote.game.world,remoteBefore);
  const offline=gameWithLamp({on:true});offline.game.leave(offline.player.id);const offlineBefore=structuredClone(offline.game.world);assert.equal(offline.game.action(offline.player.id,{type:'wallLumen',id:'lamp'}).ok,false);assert.deepEqual(offline.game.world,offlineBefore);
});

for (const [name, attributes] of [['non-writable', {writable:false,configurable:true}], ['non-configurable', {writable:true,configurable:false}]]) test(`Wall lumen rejects ${name} persisted data without throw or mutation`, () => {
  const {game,player}=gameWithLamp({on:true}),structure=game.world.structures.at(-1),before=structuredClone(game.world);
  Object.defineProperty(structure,'on',{value:true,enumerable:true,...attributes});
  const descriptor=Object.getOwnPropertyDescriptor(structure,'on');let result;
  assert.doesNotThrow(()=>{result=game.action(player.id,{type:'wallLumen',id:'lamp'});});
  assert.equal(result.ok,false);assert.deepEqual(game.world,before);assert.deepEqual(Object.getOwnPropertyDescriptor(structure,'on'),descriptor);
});

test('Wall lumen state survives version-one JSON, baseline, delta and reconnect boundaries strictly', () => {
  const {game,player}=gameWithLamp({on:false}),directory=fs.mkdtempSync(path.join(os.tmpdir(),'wall-lumen-')),file=path.join(directory,'world.json');
  try {saveWorld(file,game.world);const loaded=loadWorld(file,game.world.seed);assert.equal(loaded.version,1);assert.equal(loaded.structures.at(-1).on,false);assert.deepEqual(JSON.parse(JSON.stringify(loaded.structures.at(-1))),loaded.structures.at(-1));} finally {fs.rmSync(directory,{recursive:true,force:true});}
  const before=game.snapshot(player.id),accepted=acceptSnapshotBaseline(before,0),session=createSnapshotSession(before);nextSnapshotPacket(session,before);game.world.structures.at(-1).on=true;const after=game.snapshot(player.id),delta=createSnapshotDelta(before,after,0,1),packet=nextSnapshotPacket(session,after);
  assert.equal(applySnapshotDelta(accepted,delta,0).structures.at(-1).on,true);assert.equal(packet.delta.changes.structures.at(-1).on,true);assert.equal(acceptSnapshotBaseline(after,2).structures.at(-1).on,true);
  for(const on of ['yes',null,0])assert.throws(()=>acceptSnapshotBaseline({...after,structures:[{...after.structures.at(-1),on}]},3),/Invalid snapshot delta/);
  for(const field of ['mystery','account'])assert.throws(()=>applySnapshotDelta(accepted,{type:'delta',baseRevision:0,revision:1,changes:{structures:[{...accepted.structures.at(-1),[field]:true}]}},0),/Invalid snapshot delta/);
});

test('Wall lumen reclaim in either state keeps authorization, range, cooldown, capacity and exact-once refunds', () => {
  for(const on of [true,false]){const {game,player}=gameWithLamp({on});assert.equal(game.action(player.id,{type:'dismantle',id:'lamp'}).ok,true);assert.deepEqual({ferrite:player.inventory.ferrite,crystal:player.inventory.crystal},{ferrite:1,crystal:1});assert.equal(game.action(player.id,{type:'dismantle',id:'lamp'}).ok,false);assert.deepEqual({ferrite:player.inventory.ferrite,crystal:player.inventory.crystal},{ferrite:1,crystal:1});}
  const granted=gameWithLamp({on:false,dismantleGrants:['helper']});const helper=granted.game.join('helper','Helper');Object.assign(helper,{x:9,z:2});assert.equal(granted.game.action(helper.id,{type:'dismantle',id:'lamp'}).ok,true);assert.deepEqual({ferrite:helper.inventory.ferrite,crystal:helper.inventory.crystal},{ferrite:1,crystal:1});
  for(const setup of ['unauthorized','remote','cooldown','capacity','malformed']){const {game,player}=gameWithLamp({on:setup==='malformed'?'yes':false});let actor=player;if(setup==='unauthorized')actor=game.join('other','Other');Object.assign(actor,{x:setup==='remote'?100:9,z:2});if(setup==='cooldown')game.cooldowns.set(actor.id,game.world.time+1);if(setup==='capacity')actor.inventory.meat=59;const before=structuredClone(game.world);assert.equal(game.action(actor.id,{type:'dismantle',id:'lamp'}).ok,false);assert.deepEqual(game.world,before);}
});

test('Wall lumen exact labels and deterministic arbitration preserve existing action classes',()=>{const g=new Game(),p=g.join('a','A');Object.assign(p,{x:9,z:2});g.world.resources=[];g.world.creatures=[];g.world.structures=[{id:'lamp',type:'lamp',x:9,z:0,rotation:0,owner:p.id,on:false}];let action=contextAction(g.snapshot(),p);assert.deepEqual(action,{kind:'message',message:{type:'wallLumen',id:'lamp'},label:'Turn on Wall lumen',repeat:false,distance:3.3});assert.equal(readableActionLabel(g.snapshot(),action),'Wall lumen off · Turn on Wall lumen');g.world.structures[0].on=true;action=contextAction(g.snapshot(),p);assert.equal(readableActionLabel(g.snapshot(),action),'Wall lumen on · Turn off Wall lumen');g.world.resources=[{id:'ore',type:'ferrite',x:9,z:2.1,amount:1}];assert.equal(contextAction(g.snapshot(),p).message.type,'gather');for(const [structure,expected] of [[{id:'door',type:'door',x:9,z:0,rotation:0,open:false},'door'],[{id:'camp',type:'campGate',x:9,z:0,rotation:0,open:false},'campGate'],[{id:'deck',type:'deckGate',x:9,z:0,rotation:0,open:false},'deckGate'],[{id:'bench',type:'workbench',x:9,z:1},'fabrication'],[{id:'box',type:'cargo',x:9,z:1},'storage'],[{id:'bed',type:'bed',x:9,z:1},'habitat']]){g.world.resources=[];g.world.structures=[structure];const selected=contextAction(g.snapshot(),p);assert.equal(selected.kind==='message'?selected.message.type:selected.kind,expected);}g.world.structures=[wall(),lamp({on:false})].map(structure=>({...structure,owner:p.id}));assert.equal(contextAction(g.snapshot(),p,{reclaimMode:true}).message.id,'lamp');});

test('Wall lumen off uses a bounded non-emissive client state and invalidates geometry without external assets',()=>{assert.match(clientSource,/lampOff:mat\([^)]*emissiveIntensity:0/);assert.match(clientSource,/piece\.type==='lamp'&&piece\.on===false[\s\S]*object\.material=materials\.lampOff/);assert.match(clientSource,/structures\.map\(s=>s\.type==='lamp'&&s\.on!==false\)/);assert.match(clientSource,/structures:displayState\.structures\.filter\(s=>s\.type!=='lamp'\|\|s\.on!==false\)/);assert.doesNotMatch(clientSource,/assets\/wall[-_]lumen|fetch\([^)]*wallLumen|loadAuthoredMesh\([^)]*wallLumen/);});
