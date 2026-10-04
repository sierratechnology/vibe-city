import { isProxy } from 'node:util/types';

const ArrayPrototype = Array.prototype;
const arrayIsArray = Array.isArray;
const arrayFind = Function.call.bind(Array.prototype.find);
const arrayIncludes = Function.call.bind(Array.prototype.includes);
const arraySome = Function.call.bind(Array.prototype.some);
const arrayPush = Function.call.bind(Array.prototype.push);
const DateIntrinsic = Date;
const dateParse = Date.parse.bind(Date);
const dateToISOString = Function.call.bind(Date.prototype.toISOString);
const objectCreate = Object.create;
const objectAssign = Object.assign;
const objectFreeze = Object.freeze;
const getDescriptor = Object.getOwnPropertyDescriptor;
const getPrototype = Object.getPrototypeOf;
const reflectOwnKeys = Reflect.ownKeys;
const regexpTest = Function.call.bind(RegExp.prototype.test);
const numberIsFinite = Number.isFinite;
const numberIsSafeInteger = Number.isSafeInteger;
const objectIs = Object.is;
const ObjectPrototype = Object.prototype;
const SetIntrinsic = Set;
const setAdd = Function.call.bind(Set.prototype.add);
const setHas = Function.call.bind(Set.prototype.has);
const StringIntrinsic = String;
const stringCharCodeAt = Function.call.bind(String.prototype.charCodeAt);
const WeakSetIntrinsic = WeakSet;
const weakSetAdd = Function.call.bind(WeakSet.prototype.add);
const weakSetHas = Function.call.bind(WeakSet.prototype.has);

export const TENANT_SKYSCRAPER_NAVIGATION_ACCESS_STATES = objectFreeze([
  'public', 'tenant', 'invited', 'private', 'restricted',
]);

const ID = /^id_[a-f0-9]{16,64}$/;
const NAME = /^[A-Za-z0-9][A-Za-z0-9 ._()&-]{0,79}$/;
const TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const CHANNELS = new SetIntrinsic(['door', 'elevator', 'direct', 'alternative']);
const LIFECYCLES = new SetIntrinsic(['active', 'archived', 'deleted_tombstone']);
const ACCESS = new SetIntrinsic(TENANT_SKYSCRAPER_NAVIGATION_ACCESS_STATES);
const FLOOR_KINDS = new SetIntrinsic(['customer', 'administrative', 'shared']);
const DESTINATION_KINDS = new SetIntrinsic(['suite', 'shared_space']);
const isSuiteAccessState = (value) => value === 'tenant' || value === 'private' || value === 'restricted';
const MAX = objectFreeze({ depth: 6, containers: 1250, keys: 7500, bytes: 524288 });

const KEYS = objectFreeze({
  options: ['catalog', 'authorization', 'evaluatedAt'],
  catalog: ['schemaVersion', 'building'],
  building: ['buildingId', 'displayName', 'lifecycle', 'floors'],
  floor: ['floorId', 'buildingId', 'displayName', 'lifecycle', 'floorKind', 'elevatorStopId', 'destinations'],
  destination: ['destinationId', 'floorId', 'displayName', 'lifecycle', 'destinationKind', 'accessState', 'ownerTenantId', 'sharedSpacePolicy'],
  authorization: ['kind', 'authenticatedSubjectId', 'authenticatedSessionId', 'ownerTenantLifecycles', 'activeTenantMembership', 'privateDestinationGrants', 'invitation', 'restrictedDestinationAuthorities', 'authorizationReference', 'policyRevision'],
  owner: ['tenantId', 'lifecycle'],
  membership: ['tenantId', 'subjectId', 'active'],
  scope: ['tenantId', 'subjectId', 'destinationId'],
  invitation: ['tenantId', 'invitationId', 'subjectId', 'destinationId', 'lifecycle', 'revision', 'validFrom', 'expiresAt'],
  request: ['schemaVersion', 'channel', 'buildingId', 'floorId', 'elevatorStopId', 'destinationId'],
});

function denied() {
  return objectFreeze({ ok: false, code: 'not_found' });
}

function utf8Bytes(value) {
  let bytes = 0;
  for (let index = 0; index < value.length; index += 1) {
    const code = stringCharCodeAt(value, index);
    if (code <= 0x7f) bytes += 1;
    else if (code <= 0x7ff) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff) {
      const next = stringCharCodeAt(value, index + 1);
      if (next < 0xdc00 || next > 0xdfff) return null;
      bytes += 4;
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) return null;
    else bytes += 3;
  }
  return bytes;
}

function consume(context, value, maximum = MAX.bytes) {
  const bytes = utf8Bytes(value);
  if (bytes === null || bytes > maximum) return false;
  context.bytes += bytes;
  return context.bytes <= MAX.bytes;
}

function start(context, value, depth, array) {
  if (depth > MAX.depth || value === null || typeof value !== 'object' || isProxy(value)
      || arrayIsArray(value) !== array) return null;
  const prototype = getPrototype(value);
  if (array ? prototype !== ArrayPrototype : prototype !== ObjectPrototype && prototype !== null) return null;
  if (weakSetHas(context.identities, value)) return null;
  weakSetAdd(context.identities, value);
  context.containers += 1;
  if (context.containers > MAX.containers) return null;
  const keys = reflectOwnKeys(value);
  context.keys += keys.length;
  if (context.keys > MAX.keys) return null;
  for (let index = 0; index < keys.length; index += 1) {
    const key = keys[index];
    if (typeof key !== 'string' || !consume(context, key, 64)) return null;
  }
  return { keys, prototype };
}

function record(context, value, expected, depth) {
  const begun = start(context, value, depth, false);
  if (!begun || begun.keys.length !== expected.length
      || arraySome(expected, (key) => !arrayIncludes(begun.keys, key))) return null;
  const copy = objectCreate(null);
  const descriptors = [];
  for (let index = 0; index < expected.length; index += 1) {
    const key = expected[index];
    const descriptor = getDescriptor(value, key);
    if (!descriptor || !('value' in descriptor) || descriptor.enumerable !== true) return null;
    if (typeof descriptor.value === 'string' && !consume(context, descriptor.value)) return null;
    arrayPush(descriptors, [key, descriptor]);
    copy[key] = descriptor.value;
  }
  arrayPush(context.observations, { value, prototype: begun.prototype, keys: begun.keys, descriptors });
  return copy;
}

function array(context, value, maximum, minimum, depth) {
  const begun = start(context, value, depth, true);
  if (!begun) return null;
  const lengthDescriptor = getDescriptor(value, 'length');
  if (!lengthDescriptor || !('value' in lengthDescriptor) || !numberIsSafeInteger(lengthDescriptor.value)
      || lengthDescriptor.writable !== true || lengthDescriptor.enumerable !== false
      || lengthDescriptor.configurable !== false
      || lengthDescriptor.value < minimum || lengthDescriptor.value > maximum
      || begun.keys.length !== lengthDescriptor.value + 1
      || begun.keys[begun.keys.length - 1] !== 'length') return null;
  const copy = [];
  const descriptors = [['length', lengthDescriptor]];
  for (let index = 0; index < lengthDescriptor.value; index += 1) {
    const key = StringIntrinsic(index);
    if (begun.keys[index] !== key) return null;
    const descriptor = getDescriptor(value, key);
    if (!descriptor || !('value' in descriptor) || descriptor.enumerable !== true
        || descriptor.writable !== true || descriptor.configurable !== true) return null;
    if (typeof descriptor.value === 'string' && !consume(context, descriptor.value)) return null;
    arrayPush(descriptors, [key, descriptor]);
    arrayPush(copy, descriptor.value);
  }
  arrayPush(context.observations, { value, prototype: begun.prototype, keys: begun.keys, descriptors });
  return copy;
}

function stable(context) {
  for (let observationIndex = 0; observationIndex < context.observations.length; observationIndex += 1) {
    const observation = context.observations[observationIndex];
    if (isProxy(observation.value) || getPrototype(observation.value) !== observation.prototype) return false;
    const keys = reflectOwnKeys(observation.value);
    if (keys.length !== observation.keys.length
        || arraySome(keys, (key, index) => key !== observation.keys[index])) return false;
    for (let descriptorIndex = 0; descriptorIndex < observation.descriptors.length; descriptorIndex += 1) {
      const key = observation.descriptors[descriptorIndex][0];
      const before = observation.descriptors[descriptorIndex][1];
      const after = getDescriptor(observation.value, key);
      if (!after || !('value' in after) || !objectIs(before.value, after.value)
          || before.writable !== after.writable || before.enumerable !== after.enumerable
          || before.configurable !== after.configurable) return false;
    }
  }
  return true;
}

function id(value) {
  return typeof value === 'string' && value.length >= 19 && value.length <= 67 && regexpTest(ID, value);
}
function name(value) { return typeof value === 'string' && regexpTest(NAME, value); }
function revision(value) { return numberIsSafeInteger(value) && value >= 1 && value <= 2147483647 && !objectIs(value, -0); }
function timestamp(value) {
  if (typeof value !== 'string' || !regexpTest(TIME, value)) return false;
  const parsed = dateParse(value);
  return numberIsFinite(parsed) && dateToISOString(new DateIntrinsic(parsed)) === value;
}
function context() { return { identities: new WeakSetIntrinsic(), observations: [], containers: 0, keys: 0, bytes: 0 }; }

function snapshotOptions(raw) {
  const scan = context();
  const options = record(scan, raw, KEYS.options, 0);
  const catalog = options && record(scan, options.catalog, KEYS.catalog, 1);
  const building = catalog && record(scan, catalog.building, KEYS.building, 2);
  const floors = building && array(scan, building.floors, 64, 1, 3);
  if (!options || !timestamp(options.evaluatedAt) || !catalog || catalog.schemaVersion !== '1.0'
      || !building || !id(building.buildingId) || !name(building.displayName)
      || !setHas(LIFECYCLES, building.lifecycle) || !floors) return null;
  const navigationIds = new SetIntrinsic();
  setAdd(navigationIds, building.buildingId);
  const ownerTenantIds = new SetIntrinsic();
  let ownerTenantCount = 0;
  const copiedFloors = [];
  for (let floorIndex = 0; floorIndex < floors.length; floorIndex += 1) {
    const rawFloor = floors[floorIndex];
    const floor = record(scan, rawFloor, KEYS.floor, 4);
    const destinations = floor && array(scan, floor.destinations, 8, 1, 5);
    if (!floor || !destinations || !id(floor.floorId) || floor.buildingId !== building.buildingId
        || !name(floor.displayName) || !setHas(LIFECYCLES, floor.lifecycle) || !setHas(FLOOR_KINDS, floor.floorKind)
        || !id(floor.elevatorStopId) || setHas(navigationIds, floor.floorId)
        || setHas(navigationIds, floor.elevatorStopId) || floor.floorId === floor.elevatorStopId) return null;
    setAdd(navigationIds, floor.floorId); setAdd(navigationIds, floor.elevatorStopId);
    const copiedDestinations = [];
    let suiteCount = 0;
    for (let destinationIndex = 0; destinationIndex < destinations.length; destinationIndex += 1) {
      const rawDestination = destinations[destinationIndex];
      const item = record(scan, rawDestination, KEYS.destination, 6);
      if (!item || !id(item.destinationId) || item.floorId !== floor.floorId || !name(item.displayName)
          || !setHas(LIFECYCLES, item.lifecycle) || !setHas(DESTINATION_KINDS, item.destinationKind)
          || !setHas(ACCESS, item.accessState) || (item.ownerTenantId !== null && !id(item.ownerTenantId))
          || setHas(navigationIds, item.destinationId)) return null;
      setAdd(navigationIds, item.destinationId);
      if (item.destinationKind === 'suite') {
        suiteCount += 1;
        if (item.ownerTenantId === null || item.sharedSpacePolicy !== 'not_shared'
            || !isSuiteAccessState(item.accessState)) return null;
      } else {
        const policies = { public: 'building_public', tenant: 'owner_tenant_only', invited: 'exact_invitation', private: 'exact_private_grant', restricted: 'exact_restricted_authority' };
        if (item.sharedSpacePolicy !== policies[item.accessState]
            || (item.accessState === 'public' ? item.ownerTenantId !== null : item.ownerTenantId === null)) return null;
      }
      if (item.ownerTenantId !== null && !setHas(ownerTenantIds, item.ownerTenantId)) {
        setAdd(ownerTenantIds, item.ownerTenantId);
        ownerTenantCount += 1;
      }
      arrayPush(copiedDestinations, item);
    }
    if (floor.floorKind === 'customer' && suiteCount > 0 && suiteCount !== 4) return null;
    floor.destinations = copiedDestinations;
    arrayPush(copiedFloors, floor);
  }
  const authorization = record(scan, options.authorization, KEYS.authorization, 1);
  const owners = authorization && array(scan, authorization.ownerTenantLifecycles, 512, 0, 2);
  const grants = authorization && array(scan, authorization.privateDestinationGrants, 16, 0, 2);
  const authorities = authorization && array(scan, authorization.restrictedDestinationAuthorities, 16, 0, 2);
  if (!authorization || !owners || !grants || !authorities || authorization.kind !== 'trusted-server-context'
      || !revision(authorization.policyRevision)) return null;
  let membership = null;
  if (authorization.authenticatedSubjectId === null) {
    if (authorization.authenticatedSessionId !== null || authorization.activeTenantMembership !== null
        || authorization.authorizationReference !== null) return null;
  } else {
    membership = record(scan, authorization.activeTenantMembership, KEYS.membership, 2);
    if (!id(authorization.authenticatedSubjectId) || !id(authorization.authenticatedSessionId)
        || !id(authorization.authorizationReference) || !membership || !id(membership.tenantId)
        || membership.subjectId !== authorization.authenticatedSubjectId || membership.active !== true) return null;
  }
  let invitation = null;
  if (authorization.invitation !== null) {
    invitation = record(scan, authorization.invitation, KEYS.invitation, 2);
    if (!invitation || !id(invitation.tenantId) || !id(invitation.invitationId)
        || !id(invitation.subjectId) || invitation.subjectId !== authorization.authenticatedSubjectId
        || !id(invitation.destinationId)
        || invitation.lifecycle !== 'accepted' || !revision(invitation.revision) || invitation.revision < 2
        || !timestamp(invitation.validFrom) || !timestamp(invitation.expiresAt)
        || dateParse(invitation.validFrom) >= dateParse(invitation.expiresAt)) return null;
  }
  function scopes(rawScopes) {
    const copies = [];
    const seen = new SetIntrinsic();
    for (let scopeIndex = 0; scopeIndex < rawScopes.length; scopeIndex += 1) {
      const rawScope = rawScopes[scopeIndex];
      const scope = record(scan, rawScope, KEYS.scope, 3);
      if (!scope || !id(scope.tenantId) || !id(scope.subjectId) || !id(scope.destinationId)) return null;
      const identity = `${scope.tenantId}:${scope.subjectId}:${scope.destinationId}`;
      if (setHas(seen, identity)) return null;
      setAdd(seen, identity); arrayPush(copies, scope);
    }
    return copies;
  }
  const copiedGrants = scopes(grants);
  const copiedAuthorities = scopes(authorities);
  if (!copiedGrants || !copiedAuthorities) return null;
  const copiedOwners = [];
  const seenOwners = new SetIntrinsic();
  for (let ownerIndex = 0; ownerIndex < owners.length; ownerIndex += 1) {
    const rawOwner = owners[ownerIndex];
    const owner = record(scan, rawOwner, KEYS.owner, 3);
    if (!owner || !id(owner.tenantId) || !setHas(LIFECYCLES, owner.lifecycle) || setHas(seenOwners, owner.tenantId)) return null;
    setAdd(seenOwners, owner.tenantId); arrayPush(copiedOwners, owner);
  }
  if (copiedOwners.length !== ownerTenantCount
      || arraySome(copiedOwners, (owner) => !setHas(ownerTenantIds, owner.tenantId))
      || !stable(scan)) return null;
  building.floors = copiedFloors; catalog.building = building;
  authorization.ownerTenantLifecycles = copiedOwners;
  authorization.activeTenantMembership = membership;
  authorization.invitation = invitation;
  authorization.privateDestinationGrants = copiedGrants;
  authorization.restrictedDestinationAuthorities = copiedAuthorities;
  return { catalog, authorization, evaluatedAt: options.evaluatedAt };
}

function snapshotRequest(raw) {
  const scan = context();
  const request = record(scan, raw, KEYS.request, 0);
  if (!request || request.schemaVersion !== '1.0' || !setHas(CHANNELS, request.channel)
      || !id(request.buildingId) || !id(request.floorId) || !id(request.elevatorStopId)
      || !id(request.destinationId) || !stable(scan)) return null;
  return request;
}

function allowed(options, request, destination) {
  const decision = objectFreeze(objectAssign(objectCreate(null), {
    allowed: true, code: 'allowed', schemaVersion: '1.0', channel: request.channel,
    buildingId: request.buildingId, floorId: request.floorId,
    elevatorStopId: request.elevatorStopId, destinationId: request.destinationId,
    destinationKind: destination.destinationKind, accessState: destination.accessState,
    subjectId: options.authorization.authenticatedSubjectId,
    tenantId: destination.ownerTenantId,
    authorizationReference: options.authorization.authorizationReference,
    policyRevision: options.authorization.policyRevision, evaluatedAt: options.evaluatedAt,
    validUntil: destination.accessState === 'invited' ? options.authorization.invitation.expiresAt : null,
  }));
  return objectFreeze(objectAssign(objectCreate(null), { ok: true, decision }));
}

export function createTenantSkyscraperNavigationAuthorizer(trustedOptions) {
  let options = null;
  try { options = snapshotOptions(trustedOptions); } catch { options = null; }
  return objectFreeze(objectAssign(objectCreate(null), {
    decideNavigation(rawRequest) {
      try {
        const request = snapshotRequest(rawRequest);
        if (!options || !request) return denied();
        const building = options.catalog.building;
        const floor = arrayFind(building.floors, (candidate) => candidate.floorId === request.floorId);
        const destination = floor && arrayFind(floor.destinations, (candidate) => candidate.destinationId === request.destinationId);
        if (!floor || !destination || building.buildingId !== request.buildingId
            || floor.elevatorStopId !== request.elevatorStopId || building.lifecycle !== 'active'
            || floor.lifecycle !== 'active' || destination.lifecycle !== 'active') return denied();
        const authorization = options.authorization;
        if (destination.accessState !== 'public') {
          const owner = arrayFind(authorization.ownerTenantLifecycles, (candidate) => candidate.tenantId === destination.ownerTenantId);
          if (!owner || owner.lifecycle !== 'active') return denied();
        }
        const membership = authorization.activeTenantMembership;
        const sameTenant = membership && membership.active === true
          && membership.tenantId === destination.ownerTenantId
          && membership.subjectId === authorization.authenticatedSubjectId;
        if (destination.accessState === 'tenant' && !sameTenant) return denied();
        if (destination.accessState === 'invited') {
          const invitation = authorization.invitation;
          if (!invitation || invitation.tenantId !== destination.ownerTenantId
              || invitation.subjectId !== authorization.authenticatedSubjectId
              || invitation.destinationId !== destination.destinationId
              || dateParse(options.evaluatedAt) < dateParse(invitation.validFrom)
              || dateParse(options.evaluatedAt) >= dateParse(invitation.expiresAt)) return denied();
        }
        if (destination.accessState === 'private') {
          const hasGrant = arraySome(authorization.privateDestinationGrants, (grant) =>
            grant.tenantId === destination.ownerTenantId && grant.subjectId === authorization.authenticatedSubjectId
            && grant.destinationId === destination.destinationId);
          if (!sameTenant || !hasGrant) return denied();
        }
        if (destination.accessState === 'restricted') {
          const hasAuthority = arraySome(authorization.restrictedDestinationAuthorities, (authority) =>
            authority.tenantId === destination.ownerTenantId && authority.subjectId === authorization.authenticatedSubjectId
            && authority.destinationId === destination.destinationId);
          if (!sameTenant || !hasAuthority) return denied();
        }
        return allowed(options, request, destination);
      } catch { return denied(); }
    },
  }));
}
