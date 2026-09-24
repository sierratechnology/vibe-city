import {withinGatherRange} from '../shared/world.js';

export const SNAPSHOT_FIELDS = Object.freeze([
  'planet', 'settings', 'circumference', 'monuments', 'vehicles', 'locks', 'seed', 'time',
  'structures', 'containers', 'creatures', 'resources', 'playerCount', 'players',
]);
// A 4,999-floor authoritative snapshot measures 473,011 bytes, 36,468 keys and 41,704 nodes.
// These finite ceilings also cover 5,000 structures at all 16 allowed structure fields, plus world headroom.
export const SNAPSHOT_DELTA_LIMITS = Object.freeze({maxBytes: 2097152, maxDepth: 8, maxKeys: 100000, maxNodes: 120000});

const fieldSet = new Set(SNAPSHOT_FIELDS);
const forbiddenKeys = new Set(['__proto__', 'prototype', 'constructor']);
const privateKeys = new Set(['account', 'role', 'email', 'emailVerified', 'verification', 'verificationToken', 'password', 'passwordHash', 'session', 'sessionToken', 'cookie', 'admin']);
const playerFields = new Set([
  'id', 'name', 'x', 'z', 'yaw', 'aimYaw', 'health', 'charge', 'inventory', 'cutter', 'unlocked',
  'completed', 'flashlightOwned', 'flashlightOn', 'oxygen', 'water', 'food', 'stamina', 'suit',
  'skills', 'belt', 'survey', 'markers', 'vehicle', 'sleeping', 'room', 'rifle', 'repair', 'recovered',
  'discoveries', 'discoveredBiomes', 'firstBiomeContacts', 'airReading', 'lastDamage',
]);
const biomeDiscoveryIds = new Set(['quiet-basin', 'coral-shelf']);
const firstBiomeContactIds = new Set(['coral-shelf']);
const planetFields = new Set(['version', 'circumference', 'solarDistanceAU', 'rotationSeconds', 'daySeconds', 'nightSeconds']);
const settingsFields = new Set(['name', 'description', 'maxPlayers', 'public', 'pvp', 'structureDamage', 'offlineRaiding', 'survivalRate', 'gatherRate', 'daySeconds', 'nightSeconds', 'sleepPercent', 'vehicleSpeed']);
const monumentFields = new Set(['id', 'kind', 'name', 'x', 'z']);
const vehicleFields = new Set(['id', 'type', 'x', 'z', 'yaw', 'health', 'battery', 'modules', 'occupants', 'inventory', 'owner']);
const structureFields = new Set(['id', 'type', 'x', 'z', 'rotation', 'site', 'gx', 'gz', 'health', 'power', 'owner', 'open', 'cycleUntil', 'water', 'readyAt', 'lastDamage', 'canDismantle', 'dismantleGrantedTo', 'canAccessCargo', 'cargoGrantedTo', 'canUseWorkbench', 'workbenchGrantedTo', 'canCancelWorkbench', 'workbenchCancelJobId', 'canUseHydroponics', 'hydroponicsGrantedTo']);
const creatureFields = new Set(['id', 'type', 'x', 'z', 'homeX', 'homeZ', 'health', 'yaw', 'attackAt', 'respawnAt', 'fleeUntil']);
const resourceFields = new Set(['id', 'type', 'x', 'z', 'y', 'amount', 'regeneratesAt']);
const inventoryFields = new Set(['ice', 'water', 'copper', 'silica', 'carbon', 'scrap', 'ferrite', 'fiber', 'meat', 'ration', 'crystal']);
const skillFields = new Set(['mining', 'construction', 'combat', 'piloting']);
const roomFields = new Set(['id', 'cells', 'sealed', 'doors', 'pressure', 'oxygen', 'temperature', 'safe']);
const markerFields = new Set(['x', 'z', 'name']);
const airFields = new Set(['name', 'oxygen', 'pressure', 'toxicity', 'temperature', 'at']);
const encoder = new TextEncoder();
const arrayIsArray = Array.isArray;
const objectGetPrototypeOf = Object.getPrototypeOf;
const objectGetOwnPropertyDescriptors = Object.getOwnPropertyDescriptors;
const reflectOwnKeys = Reflect.ownKeys;
const nativeStructuredClone = globalThis.structuredClone;

function fail(message) {
  throw new TypeError(`Invalid snapshot delta: ${message}`);
}

function isPlainObject(value) {
  if (value === null || typeof value !== 'object') return false;
  const prototype = objectGetPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function cloneBounded(value, budget, depth = 0) {
  if (++budget.nodes > SNAPSHOT_DELTA_LIMITS.maxNodes) fail('node budget exceeded');
  if (depth > SNAPSHOT_DELTA_LIMITS.maxDepth) fail('depth budget exceeded');
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || Object.is(value, -0)) fail('number must be finite and canonical');
    if (Number.isInteger(value) && !Number.isSafeInteger(value)) fail('integer must be safe');
    return value;
  }
  if (arrayIsArray(value)) {
    if (objectGetPrototypeOf(value) !== Array.prototype || !Number.isSafeInteger(value.length) || value.length > SNAPSHOT_DELTA_LIMITS.maxNodes) fail('array shape');
    const descriptors = objectGetOwnPropertyDescriptors(value);
    const keys = reflectOwnKeys(descriptors);
    if (keys.some(key => typeof key !== 'string' || (key !== 'length' && !/^(0|[1-9]\d*)$/.test(key)))) fail('array shape');
    const result = [];
    for (let index = 0; index < value.length; index++) {
      const descriptor = descriptors[index];
      if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) fail('array shape');
      result.push(cloneBounded(descriptor.value, budget, depth + 1));
    }
    return result;
  }
  if (!isPlainObject(value)) fail('values must contain only ordinary objects');
  const result = {};
  const descriptors = objectGetOwnPropertyDescriptors(value);
  for (const key of reflectOwnKeys(descriptors)) {
    const descriptor = descriptors[key];
    if (typeof key !== 'string' || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) fail('ordinary data properties required');
    if (++budget.keys > SNAPSHOT_DELTA_LIMITS.maxKeys) fail('key budget exceeded');
    if (forbiddenKeys.has(key)) fail('forbidden key');
    if (privateKeys.has(key)) fail('private field');
    Object.defineProperty(result, key, {value: cloneBounded(descriptor.value, budget, depth + 1), enumerable: true, configurable: true, writable: true});
  }
  return result;
}

function cloneUntrusted(value) {
  let cloned;
  try {
    cloned = cloneBounded(value, {keys: 0, nodes: 0});
  } catch {
    fail('value rejected');
  }
  try {
    if (typeof nativeStructuredClone !== 'function') fail('native clone unavailable');
    nativeStructuredClone(value);
  } catch {
    fail('value rejected');
  }
  return cloned;
}

function exactKeys(value, allowed, required, label) {
  if (!isPlainObject(value)) fail(`${label} shape`);
  const keys = Object.keys(value);
  if (keys.some(key => !allowed.has(key)) || required.some(key => !Object.hasOwn(value, key))) fail(`${label} field set`);
}

function stringValue(value, label) {
  if (typeof value !== 'string') fail(`${label} shape`);
}

function numberValue(value, label) {
  if (typeof value !== 'number' || !Number.isFinite(value) || Object.is(value, -0)) fail(`${label} shape`);
}

function safeInteger(value, label) {
  if (!Number.isSafeInteger(value)) fail(`${label} shape`);
}

function booleanValue(value, label) {
  if (typeof value !== 'boolean') fail(`${label} shape`);
}

function isCanonicalCoralFluxId(id) {
  if (typeof id !== 'string') return false;
  const parts = id.split(':');
  if (parts.length !== 6 || parts[0] !== 'p' || parts[1] !== 'coral') return false;
  const seed = Number(parts[2]);
  const face = Number(parts[3]);
  const i = Number(parts[4]);
  const j = Number(parts[5]);
  return Number.isFinite(seed) && String(seed) === parts[2]
    && Number.isSafeInteger(face) && face >= 0 && face <= 5 && String(face) === parts[3]
    && Number.isSafeInteger(i) && i >= 0 && String(i) === parts[4]
    && Number.isSafeInteger(j) && j >= 0 && String(j) === parts[5];
}

export function isCanonicalCoralFluxResource(resource) {
  if (!isPlainObject(resource)) return false;
  const keys = Object.keys(resource);
  if (keys.some(key => !resourceFields.has(key)) || !['id', 'type', 'x', 'z', 'y', 'amount'].every(key => Object.hasOwn(resource, key))) return false;
  if (!isCanonicalCoralFluxId(resource.id) || resource.type !== 'crystal'
    || ![resource.x, resource.z, resource.y].every(value => typeof value === 'number' && Number.isFinite(value) && !Object.is(value, -0))
    || !Number.isSafeInteger(resource.amount) || resource.amount < 0 || resource.amount > 6) return false;
  const depleted = resource.amount === 0;
  if (depleted !== Object.hasOwn(resource, 'regeneratesAt')) return false;
  return !depleted || (Number.isFinite(resource.regeneratesAt) && !Object.is(resource.regeneratesAt, -0)
    && resource.regeneratesAt >= 0 && resource.regeneratesAt <= Number.MAX_SAFE_INTEGER);
}

export function coralFluxResourceLabel(resource) {
  return isCanonicalCoralFluxResource(resource) ? 'Coral Flux' : null;
}

export function coralFieldCutterFeedback(resources, player, actionableTarget, distance) {
  if (!Array.isArray(resources) || !player || typeof player !== 'object' || Array.isArray(player)
    || player.cutter !== false || actionableTarget?.type !== 'gather'
    || typeof actionableTarget.id !== 'string' || typeof distance !== 'function') return null;
  const resource = resources.find(candidate => candidate?.id === actionableTarget.id);
  if (!isCanonicalCoralFluxResource(resource) || resource.amount <= 0) return null;
  let separation;
  try { separation = distance(resource, player); } catch { return null; }
  return withinGatherRange(separation)
    ? 'A Field cutter is required to gather Coral Flux.'
    : null;
}

export function coralRegenerationStatus(resource, worldTime) {
  const due = resource?.regeneratesAt;
  if (resource?.amount !== 0 || resource?.type !== 'crystal' || typeof resource?.id !== 'string' || !resource.id.startsWith('p:coral:')) return null;
  if (!Number.isFinite(due) || Object.is(due, -0) || due < 0 || due > Number.MAX_SAFE_INTEGER) return null;
  if (!Number.isFinite(worldTime) || Object.is(worldTime, -0) || worldTime < 0 || worldTime > Number.MAX_SAFE_INTEGER) return null;
  const seconds = Math.max(0, Math.ceil(due - worldTime));
  return `Flux crystal depleted, regenerates in ${seconds} seconds of server time.`;
}

export function coralRegenerationFeedback(resources, player, worldTime, actionableTarget, distance) {
  if (actionableTarget || !Array.isArray(resources) || typeof distance !== 'function') return null;
  const candidates = resources.map(resource => ({resource, status: coralRegenerationStatus(resource, worldTime), distance: distance(resource, player)}))
    .filter(candidate => candidate.status && Number.isFinite(candidate.distance) && candidate.distance <= 3)
    .sort((left, right) => left.distance - right.distance || left.resource.id.localeCompare(right.resource.id));
  return candidates[0]?.status ?? null;
}

export function coralFluxAccessibleRegenerationStatus(resource, worldTime) {
  if (!isCanonicalCoralFluxResource(resource) || resource.amount !== 0
    || !Number.isFinite(worldTime) || Object.is(worldTime, -0) || worldTime < 0 || worldTime > Number.MAX_SAFE_INTEGER) return null;
  const seconds = Math.max(0, Math.ceil(resource.regeneratesAt - worldTime));
  return `Coral Flux depleted, regenerates in ${seconds} seconds of server time.`;
}

export function coralFluxAccessibleRegenerationFeedback(resources, player, worldTime, actionableTarget, distance) {
  if (actionableTarget || !Array.isArray(resources) || typeof distance !== 'function') return null;
  const candidates = resources.map(resource => ({resource, status: coralFluxAccessibleRegenerationStatus(resource, worldTime), distance: distance(resource, player)}))
    .filter(candidate => candidate.status && Number.isFinite(candidate.distance) && candidate.distance <= 3)
    .sort((left, right) => left.distance - right.distance || left.resource.id.localeCompare(right.resource.id));
  return candidates[0]?.status ?? null;
}

function stringArray(value, label) {
  if (!Array.isArray(value) || value.some(item => typeof item !== 'string')) fail(`${label} shape`);
}

function validateInventory(value, label) {
  exactKeys(value, inventoryFields, [], label);
  for (const amount of Object.values(value)) {
    if (!Number.isSafeInteger(amount) || amount < 0) fail(`${label} shape`);
  }
}

function validateSnapshotSchema(snapshot) {
  exactKeys(snapshot.planet, planetFields, [...planetFields], 'planet');
  safeInteger(snapshot.planet.version, 'planet');
  for (const key of ['circumference', 'solarDistanceAU', 'rotationSeconds', 'daySeconds', 'nightSeconds']) numberValue(snapshot.planet[key], 'planet');

  exactKeys(snapshot.settings, settingsFields, ['name', 'maxPlayers'], 'settings');
  for (const key of ['name', 'description']) if (Object.hasOwn(snapshot.settings, key)) stringValue(snapshot.settings[key], 'settings');
  for (const key of ['maxPlayers', 'daySeconds', 'nightSeconds', 'sleepPercent']) if (Object.hasOwn(snapshot.settings, key)) safeInteger(snapshot.settings[key], 'settings');
  for (const key of ['survivalRate', 'gatherRate', 'vehicleSpeed']) if (Object.hasOwn(snapshot.settings, key)) numberValue(snapshot.settings[key], 'settings');
  for (const key of ['public', 'pvp', 'structureDamage', 'offlineRaiding']) if (Object.hasOwn(snapshot.settings, key)) booleanValue(snapshot.settings[key], 'settings');

  for (const monument of snapshot.monuments) {
    exactKeys(monument, monumentFields, ['id', 'x', 'z'], 'monument');
    stringValue(monument.id, 'monument');
    for (const key of ['kind', 'name']) if (Object.hasOwn(monument, key)) stringValue(monument[key], 'monument');
    numberValue(monument.x, 'monument'); numberValue(monument.z, 'monument');
  }
  for (const vehicle of snapshot.vehicles) {
    exactKeys(vehicle, vehicleFields, ['id', 'type', 'x', 'z', 'occupants'], 'vehicle');
    stringValue(vehicle.id, 'vehicle'); stringValue(vehicle.type, 'vehicle');
    numberValue(vehicle.x, 'vehicle'); numberValue(vehicle.z, 'vehicle');
    for (const key of ['yaw', 'health', 'battery']) if (Object.hasOwn(vehicle, key)) numberValue(vehicle[key], 'vehicle');
    stringArray(vehicle.occupants, 'vehicle occupants');
    if (Object.hasOwn(vehicle, 'modules')) stringArray(vehicle.modules, 'vehicle modules');
    if (Object.hasOwn(vehicle, 'inventory')) validateInventory(vehicle.inventory, 'vehicle inventory');
    if (Object.hasOwn(vehicle, 'owner') && vehicle.owner !== null) stringValue(vehicle.owner, 'vehicle owner');
  }
  for (const lock of Object.values(snapshot.locks)) {
    exactKeys(lock, new Set(['locked']), ['locked'], 'lock');
    booleanValue(lock.locked, 'lock');
  }
  for (const structure of snapshot.structures) {
    exactKeys(structure, structureFields, ['id', 'type'], 'structure');
    stringValue(structure.id, 'structure'); stringValue(structure.type, 'structure');
    for (const key of ['x', 'z', 'health', 'power', 'cycleUntil', 'water', 'readyAt', 'lastDamage']) if (Object.hasOwn(structure, key)) numberValue(structure[key], 'structure');
    for (const key of ['rotation', 'gx', 'gz']) if (Object.hasOwn(structure, key)) safeInteger(structure[key], 'structure');
    for (const key of ['site', 'owner']) if (Object.hasOwn(structure, key)) stringValue(structure[key], 'structure');
    if (Object.hasOwn(structure, 'open')) booleanValue(structure.open, 'structure');
    if (Object.hasOwn(structure, 'canDismantle')) booleanValue(structure.canDismantle, 'structure');
    if (Object.hasOwn(structure, 'dismantleGrantedTo')) stringArray(structure.dismantleGrantedTo, 'structure dismantle grants');
    if (Object.hasOwn(structure, 'canAccessCargo')) booleanValue(structure.canAccessCargo, 'structure cargo access');
    if (Object.hasOwn(structure, 'cargoGrantedTo')) {
      if (!Array.isArray(structure.cargoGrantedTo) || structure.cargoGrantedTo.length > 16) fail('structure cargo grants shape');
      for (const character of structure.cargoGrantedTo) {
        exactKeys(character, new Set(['id', 'name']), ['id', 'name'], 'structure cargo grant');
        stringValue(character.id, 'structure cargo grant'); stringValue(character.name, 'structure cargo grant');
      }
    }
    if (Object.hasOwn(structure, 'canUseWorkbench')) booleanValue(structure.canUseWorkbench, 'structure workbench access');
    if (Object.hasOwn(structure, 'workbenchGrantedTo')) {
      if (!Array.isArray(structure.workbenchGrantedTo) || structure.workbenchGrantedTo.length > 32) fail('structure workbench grants shape');
      for (const character of structure.workbenchGrantedTo) {
        exactKeys(character, new Set(['id', 'name']), ['id', 'name'], 'structure workbench grant');
        stringValue(character.id, 'structure workbench grant'); stringValue(character.name, 'structure workbench grant');
      }
    }
    if (Object.hasOwn(structure, 'canUseHydroponics')) booleanValue(structure.canUseHydroponics, 'structure hydroponic access');
    if (Object.hasOwn(structure, 'hydroponicsGrantedTo')) {
      if (!Array.isArray(structure.hydroponicsGrantedTo) || structure.hydroponicsGrantedTo.length > 16) fail('structure hydroponic grants shape');
      for (const character of structure.hydroponicsGrantedTo) {
        exactKeys(character, new Set(['id', 'name']), ['id', 'name'], 'structure hydroponic grant');
        stringValue(character.id, 'structure hydroponic grant'); stringValue(character.name, 'structure hydroponic grant');
      }
    }
    const hasCancellation = Object.hasOwn(structure, 'canCancelWorkbench');
    if (hasCancellation !== Object.hasOwn(structure, 'workbenchCancelJobId')) fail('structure workbench cancellation field set');
    if (hasCancellation) {
      if (structure.canCancelWorkbench !== true) fail('structure workbench cancellation shape');
      stringValue(structure.workbenchCancelJobId, 'structure workbench cancellation');
      if (!/^[A-Za-z0-9_-]{1,64}$/.test(structure.workbenchCancelJobId)) fail('structure workbench cancellation shape');
    }
  }
  for (const inventory of Object.values(snapshot.containers)) validateInventory(inventory, 'container inventory');
  for (const creature of snapshot.creatures) {
    exactKeys(creature, creatureFields, ['id', 'type', 'x', 'z'], 'creature');
    stringValue(creature.id, 'creature'); stringValue(creature.type, 'creature');
    for (const key of Object.keys(creature)) if (!['id', 'type'].includes(key)) numberValue(creature[key], 'creature');
  }
  for (const resource of snapshot.resources) {
    exactKeys(resource, resourceFields, ['id', 'type', 'amount'], 'resource');
    stringValue(resource.id, 'resource'); stringValue(resource.type, 'resource');
    for (const key of ['x', 'z', 'y']) if (Object.hasOwn(resource, key)) numberValue(resource[key], 'resource');
    safeInteger(resource.amount, 'resource');
    if (Object.hasOwn(resource, 'regeneratesAt') && (!Number.isFinite(resource.regeneratesAt) || Object.is(resource.regeneratesAt, -0) || resource.regeneratesAt < 0 || resource.regeneratesAt > Number.MAX_SAFE_INTEGER)) fail('resource regeneration shape');
  }
  for (const player of snapshot.players) {
    exactKeys(player, playerFields, ['id', 'x', 'z'], 'player');
    stringValue(player.id, 'player');
    for (const key of ['name']) if (Object.hasOwn(player, key)) stringValue(player[key], 'player');
    for (const key of ['x', 'z', 'yaw', 'aimYaw', 'health', 'charge', 'oxygen', 'water', 'food', 'stamina', 'lastDamage']) if (Object.hasOwn(player, key)) numberValue(player[key], 'player');
    for (const key of ['cutter', 'unlocked', 'completed', 'flashlightOwned', 'flashlightOn', 'suit', 'sleeping', 'rifle', 'repair']) if (Object.hasOwn(player, key)) booleanValue(player[key], 'player');
    if (Object.hasOwn(player, 'vehicle') && player.vehicle !== null) stringValue(player.vehicle, 'player vehicle');
    if (Object.hasOwn(player, 'recovered')) safeInteger(player.recovered, 'player');
    if (Object.hasOwn(player, 'inventory')) validateInventory(player.inventory, 'player inventory');
    if (Object.hasOwn(player, 'skills')) {
      exactKeys(player.skills, skillFields, [...skillFields], 'player skills');
      for (const value of Object.values(player.skills)) numberValue(value, 'player skills');
    }
    if (Object.hasOwn(player, 'belt') && (!Array.isArray(player.belt) || player.belt.some(item => item !== null && typeof item !== 'string'))) fail('player belt shape');
    for (const key of ['survey', 'discoveries']) if (Object.hasOwn(player, key)) stringArray(player[key], `player ${key}`);
    if (Object.hasOwn(player, 'discoveredBiomes')) {
      stringArray(player.discoveredBiomes, 'player discovered biomes');
      if (player.discoveredBiomes.length > biomeDiscoveryIds.size
        || new Set(player.discoveredBiomes).size !== player.discoveredBiomes.length
        || player.discoveredBiomes.some(id => !biomeDiscoveryIds.has(id))) fail('player discovered biomes shape');
    }
    if (Object.hasOwn(player, 'firstBiomeContacts')) {
      exactKeys(player.firstBiomeContacts, firstBiomeContactIds, [], 'player first biome contacts');
      const contactIds = Object.keys(player.firstBiomeContacts);
      if (contactIds.length !== firstBiomeContactIds.size
        || !Array.isArray(player.discoveredBiomes)
        || contactIds.some(id => !player.discoveredBiomes.includes(id))) fail('player first biome contacts shape');
      for (const point of Object.values(player.firstBiomeContacts)) {
        exactKeys(point, new Set(['x', 'z']), ['x', 'z'], 'player first biome contact');
        numberValue(point.x, 'player first biome contact'); numberValue(point.z, 'player first biome contact');
      }
    }
    if (Object.hasOwn(player, 'markers')) {
      if (!Array.isArray(player.markers)) fail('player markers shape');
      for (const marker of player.markers) {
        exactKeys(marker, markerFields, [...markerFields], 'player marker');
        numberValue(marker.x, 'player marker'); numberValue(marker.z, 'player marker'); stringValue(marker.name, 'player marker');
      }
    }
    if (Object.hasOwn(player, 'airReading')) {
      exactKeys(player.airReading, airFields, [...airFields], 'player air reading');
      stringValue(player.airReading.name, 'player air reading');
      for (const key of ['oxygen', 'pressure', 'toxicity', 'temperature', 'at']) numberValue(player.airReading[key], 'player air reading');
    }
    if (Object.hasOwn(player, 'room')) {
      exactKeys(player.room, roomFields, ['sealed', 'safe', 'pressure', 'oxygen', 'temperature'], 'player room');
      for (const key of ['sealed', 'safe']) booleanValue(player.room[key], 'player room');
      for (const key of ['pressure', 'oxygen', 'temperature']) numberValue(player.room[key], 'player room');
      if (Object.hasOwn(player.room, 'id')) stringValue(player.room.id, 'player room');
      for (const key of ['cells', 'doors']) if (Object.hasOwn(player.room, key)) stringArray(player.room[key], 'player room');
    }
  }
}

function cloneSnapshot(value) {
  const snapshot = cloneUntrusted(value);
  if (!isPlainObject(snapshot)) fail('snapshot must be an ordinary object');
  const keys = Object.keys(snapshot);
  if (keys.length !== SNAPSHOT_FIELDS.length || keys.some(key => !fieldSet.has(key))) fail('snapshot field set');
  if (!isPlainObject(snapshot.planet)) fail('planet shape');
  if (!isPlainObject(snapshot.settings)) fail('settings shape');
  if (!Number.isFinite(snapshot.circumference) || snapshot.circumference <= 0) fail('circumference shape');
  for (const field of ['monuments', 'vehicles', 'structures', 'creatures', 'resources', 'players']) {
    if (!Array.isArray(snapshot[field]) || snapshot[field].some(item => !isPlainObject(item))) fail(`${field} shape`);
  }
  for (const field of ['locks', 'containers']) if (!isPlainObject(snapshot[field])) fail(`${field} shape`);
  if (!Number.isSafeInteger(snapshot.seed) || snapshot.seed < 0) fail('seed shape');
  if (!Number.isFinite(snapshot.time) || snapshot.time < 0) fail('time shape');
  if (!Number.isSafeInteger(snapshot.playerCount) || snapshot.playerCount < 0) fail('playerCount shape');
  validateSnapshotSchema(snapshot);
  return snapshot;
}

function validRevision(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

function wireBytes(value) {
  let json;
  try { json = JSON.stringify(value); } catch { fail('not JSON serializable'); }
  if (encoder.encode(json).byteLength > SNAPSHOT_DELTA_LIMITS.maxBytes) fail('byte budget exceeded');
  return json;
}

export function createSnapshotDelta(previous, next, baseRevision, revision) {
  if (!validRevision(baseRevision) || !validRevision(revision) || revision !== baseRevision + 1) fail('revision ordering');
  const before = cloneSnapshot(previous);
  const after = cloneSnapshot(next);
  const changes = {};
  for (const field of SNAPSHOT_FIELDS) {
    if (JSON.stringify(before[field]) !== JSON.stringify(after[field])) changes[field] = after[field];
  }
  const delta = {type: 'delta', baseRevision, revision, changes};
  wireBytes(delta);
  return cloneBounded(delta, {keys: 0, nodes: 0});
}

export function acceptSnapshotBaseline(snapshot, revision) {
  if (!validRevision(revision)) fail('baseline revision');
  const accepted = cloneSnapshot(snapshot);
  wireBytes(accepted);
  return accepted;
}

export function applySnapshotDelta(previous, delta, currentRevision) {
  if (!validRevision(currentRevision)) fail('packet shape');
  const packet = cloneUntrusted(delta);
  if (!isPlainObject(packet)) fail('packet shape');
  const packetKeys = Object.keys(packet);
  if (packetKeys.length !== 4 || !['type', 'baseRevision', 'revision', 'changes'].every(key => packetKeys.includes(key))) fail('packet field set');
  if (packet.type !== 'delta' || packet.baseRevision !== currentRevision || !validRevision(packet.revision) || packet.revision !== currentRevision + 1) fail('revision ordering');
  if (!isPlainObject(packet.changes)) fail('changes shape');
  for (const field of Object.keys(packet.changes)) if (!fieldSet.has(field)) fail('unknown snapshot field');
  wireBytes(packet);
  const accepted = cloneSnapshot(previous);
  for (const [field, value] of Object.entries(packet.changes)) accepted[field] = value;
  return cloneSnapshot(accepted);
}

export function parseSnapshotMessage(text) {
  try {
    if (typeof text !== 'string' || encoder.encode(text).byteLength > SNAPSHOT_DELTA_LIMITS.maxBytes) throw TypeError();
    const stack = [];
    let rootState = 'value';
    let keys = 0;
    let nodes = 0;
    const whitespace = char => char === ' ' || char === '\n' || char === '\r' || char === '\t';
    const beginValue = () => {
      if (++nodes > SNAPSHOT_DELTA_LIMITS.maxNodes) throw TypeError();
      const parent = stack.at(-1);
      if (!parent) {
        if (rootState !== 'value') throw TypeError();
        rootState = 'done';
      } else if (parent.type === 'object') {
        if (parent.state !== 'value') throw TypeError();
        parent.state = 'commaOrEnd';
      } else {
        if (parent.state !== 'valueOrEnd') throw TypeError();
        parent.state = 'commaOrEnd';
      }
    };
    const scanString = start => {
      let escaped = false;
      for (let index = start + 1; index < text.length; index++) {
        const char = text[index];
        if (escaped) escaped = false;
        else if (char === '\\') escaped = true;
        else if (char === '"') return index + 1;
      }
      throw TypeError();
    };

    for (let index = 0; index < text.length;) {
      if (whitespace(text[index])) { index++; continue; }
      const frame = stack.at(-1);
      const char = text[index];
      if (char === '"') {
        const end = scanString(index);
        if (frame?.type === 'object' && frame.state === 'keyOrEnd') {
          if (++keys > SNAPSHOT_DELTA_LIMITS.maxKeys) throw TypeError();
          const key = JSON.parse(text.slice(index, end));
          if (frame.keys.has(key)) throw TypeError();
          frame.keys.add(key);
          frame.state = 'colon';
        } else beginValue();
        index = end;
        continue;
      }
      if (char === '{' || char === '[') {
        beginValue();
        if (stack.length + 1 > SNAPSHOT_DELTA_LIMITS.maxDepth + 3) throw TypeError();
        stack.push(char === '{' ? {type: 'object', state: 'keyOrEnd', keys: new Set()} : {type: 'array', state: 'valueOrEnd'});
        index++;
        continue;
      }
      if (char === '}' || char === ']') {
        if (!frame || (char === '}' && (frame.type !== 'object' || !['keyOrEnd', 'commaOrEnd'].includes(frame.state))) || (char === ']' && (frame.type !== 'array' || !['valueOrEnd', 'commaOrEnd'].includes(frame.state)))) throw TypeError();
        stack.pop(); index++; continue;
      }
      if (char === ':') {
        if (!frame || frame.type !== 'object' || frame.state !== 'colon') throw TypeError();
        frame.state = 'value'; index++; continue;
      }
      if (char === ',') {
        if (!frame || frame.state !== 'commaOrEnd') throw TypeError();
        frame.state = frame.type === 'object' ? 'keyOrEnd' : 'valueOrEnd'; index++; continue;
      }
      beginValue();
      do { index++; } while (index < text.length && !whitespace(text[index]) && ![',', '}', ']'].includes(text[index]));
    }
    if (stack.length || rootState !== 'done') throw TypeError();
    return JSON.parse(text);
  } catch {
    throw new TypeError('Invalid snapshot message');
  }
}
