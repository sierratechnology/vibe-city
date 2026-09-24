import test from 'node:test';
import assert from 'node:assert/strict';
import {AUDIO_DEFAULTS, createAudioEngine, createAudioSettings, loadAudioPreferences} from '../client/audio.js';

const storageReturning = value => ({getItem: () => value});

test('audio preferences load exact valid values and fail closed to conservative defaults', () => {
  assert.deepEqual(loadAudioPreferences(storageReturning(null)), AUDIO_DEFAULTS);
  assert.deepEqual(loadAudioPreferences(storageReturning(JSON.stringify({muted:true,interfaceVolume:25,worldVolume:70}))), {muted:true,interfaceVolume:25,worldVolume:70});
  for (const value of [
    '{',
    'null',
    JSON.stringify({muted:'false',interfaceVolume:25,worldVolume:70}),
    JSON.stringify({muted:false,interfaceVolume:-1,worldVolume:70}),
    JSON.stringify({muted:false,interfaceVolume:25,worldVolume:101}),
    JSON.stringify({muted:false,interfaceVolume:25.5,worldVolume:70}),
    JSON.stringify({muted:false,interfaceVolume:25,worldVolume:70,extra:true}),
  ]) assert.deepEqual(loadAudioPreferences(storageReturning(value)), AUDIO_DEFAULTS);
  assert.deepEqual(loadAudioPreferences({getItem(){throw Error('blocked');}}), AUDIO_DEFAULTS);
  assert.deepEqual(loadAudioPreferences(new Proxy({}, {get(){throw Error('revoked');}})), AUDIO_DEFAULTS);
});

test('audio categories persist independently while master mute preserves their values', () => {
  const values = new Map();
  const storage = {getItem:key => values.get(key) ?? null, setItem:(key,value) => values.set(key,value)};
  const settings = createAudioSettings(storage);
  assert.equal(settings.setCategory('interface', 20), true);
  assert.equal(settings.setCategory('world', 80), true);
  assert.equal(settings.setMuted(true), true);
  assert.deepEqual(settings.get(), {muted:true,interfaceVolume:20,worldVolume:80});
  assert.equal(settings.effectiveVolume('interface'), 0);
  assert.equal(settings.effectiveVolume('world'), 0);
  assert.equal(settings.setMuted(false), true);
  assert.equal(settings.effectiveVolume('interface'), .2);
  assert.equal(settings.effectiveVolume('world'), .8);
  assert.deepEqual(createAudioSettings(storage).get(), {muted:false,interfaceVolume:20,worldVolume:80});
  assert.equal(settings.setCategory('interface', NaN), false);
  assert.equal(settings.setCategory('unknown', 50), false);
  assert.deepEqual(settings.get(), {muted:false,interfaceVolume:20,worldVolume:80});
  const blocked = createAudioSettings({getItem:()=>null,setItem(){throw Error('blocked');}});
  assert.equal(blocked.setMuted(true), false);
  assert.deepEqual(blocked.get(), AUDIO_DEFAULTS);
});

test('successfully applying master mute synchronously stops active voices and preserves category values', async () => {
  const values = new Map();
  const storage = {getItem:key => values.get(key) ?? null, setItem:(key,value) => values.set(key,value)};
  const settings = createAudioSettings(storage);
  settings.setCategory('interface', 20);
  settings.setCategory('world', 80);
  let contextsCreated = 0, resumes = 0;
  const oscillator = {
    frequency:{setValueAtTime(){}}, connect(){},
    disconnect(){this.disconnected=true;}, start(){}, stop(){this.stopped=true;}, onended:null,
  };
  const gain = {gain:{setValueAtTime(){},exponentialRampToValueAtTime(){}},connect(){},disconnect(){this.disconnected=true;}};
  const context = {
    state:'suspended', currentTime:0, destination:{},
    async resume(){resumes++;this.state='running';},
    createOscillator:()=>oscillator, createGain:()=>gain,
  };
  const engine = createAudioEngine({settings,createContext:()=>{contextsCreated++;return context;}});
  assert.equal(await engine.activate(true), true);
  assert.equal(engine.play('world'), true);
  assert.equal(engine.status().activeVoices, 1);

  assert.equal(engine.setMuted(true), true);
  assert.equal(engine.status().activeVoices, 0);
  assert.equal(oscillator.stopped, true);
  assert.equal(oscillator.disconnected, true);
  assert.equal(gain.disconnected, true);
  assert.deepEqual(settings.get(), {muted:true,interfaceVolume:20,worldVolume:80});
  assert.equal(engine.setMuted(false), true);
  assert.deepEqual(settings.get(), {muted:false,interfaceVolume:20,worldVolume:80});
  assert.equal(contextsCreated, 1);
  assert.equal(resumes, 1);
});

test('audio engine requires activation and bounds routed cue lifetime and cleanup', async () => {
  const oscillators = [], gains = [];
  const context = {
    state:'suspended', currentTime:10, destination:{},
    async resume(){this.state='running';}, async suspend(){this.state='suspended';}, async close(){this.state='closed';},
    createGain(){const node={gain:{setValueAtTime(value){node.value=value;},exponentialRampToValueAtTime(){}},connect(){},disconnect(){}};gains.push(node);return node;},
    createOscillator(){const node={frequency:{setValueAtTime(value){node.frequencyValue=value;}},connect(){},disconnect(){},start(time){node.started=time;},stop(time){node.stopped=time;},onended:null};oscillators.push(node);return node;},
  };
  const storage = {getItem:()=>JSON.stringify({muted:false,interfaceVolume:20,worldVolume:80}),setItem(){}};
  const engine = createAudioEngine({settings:createAudioSettings(storage),createContext:()=>context,maxVoices:2});
  assert.equal(engine.play('interface'), false);
  assert.equal(engine.status().hasContext, false);
  assert.equal(await engine.activate(false), false);
  assert.equal(engine.status().hasContext, false);
  assert.equal(await engine.activate(true), true);
  assert.equal(engine.play('interface'), true);
  assert.equal(engine.play('world'), true);
  assert.equal(engine.play('world'), false);
  assert.deepEqual(gains.map(node=>node.value), [.2,.8]);
  assert.ok(oscillators.every(node=>node.stopped-node.started<=.16));
  assert.equal(engine.status().activeVoices, 2);
  oscillators[0].onended();
  assert.equal(engine.status().activeVoices, 1);
  await engine.suspend();
  assert.equal(engine.status().activeVoices, 0);
  assert.equal(context.state, 'suspended');
  await engine.destroy();
  assert.equal(context.state, 'closed');
  const denied = createAudioEngine({settings:createAudioSettings(storage),createContext:()=>{throw Error('denied');}});
  assert.equal(await denied.activate(true), false);
  assert.equal(denied.play('interface'), false);
  let closed = false;
  const resumeDenied = createAudioEngine({settings:createAudioSettings(storage),createContext:()=>({state:'suspended',async resume(){throw Error('denied');},async close(){closed=true;this.state='closed;';}})});
  assert.equal(await resumeDenied.activate(true), false);
  assert.equal(closed, true, 'a denied resume does not leak its context');
});
