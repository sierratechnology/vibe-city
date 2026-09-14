import { isProxy } from "node:util/types";

const arrayIsArray = Array.isArray;
const arrayFind = Function.call.bind(Array.prototype.find);
const arraySome = Function.call.bind(Array.prototype.some);
const DateIntrinsic = Date;
const dateParse = Date.parse.bind(Date);
const dateToISOString = Function.call.bind(Date.prototype.toISOString);
const numberIsFinite = Number.isFinite;
const numberIsSafeInteger = Number.isSafeInteger;
const objectAssign = Object.assign;
const objectCreate = Object.create;
const objectFreeze = Object.freeze;
const objectGetOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const objectGetPrototypeOf = Object.getPrototypeOf;
const objectIs = Object.is;
const reflectOwnKeys = Reflect.ownKeys;
const regexpTest = Function.call.bind(RegExp.prototype.test);
const setHas = Function.call.bind(Set.prototype.has);
const stringCharCodeAt = Function.call.bind(String.prototype.charCodeAt);

export const TENANT_SKYSCRAPER_NAVIGATION_ACCESS_STATES = objectFreeze([
  "public", "tenant", "invited", "private", "restricted"
]);

const ID = /^id_[a-f0-9]{16,64}$/;
const DISPLAY_NAME = /^[A-Za-z0-9][A-Za-z0-9 ._()&-]{0,79}$/;
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const OPTION_KEYS = ["catalog", "authorization", "evaluatedAt"];
const CATALOG_KEYS = ["schemaVersion", "building"];
const BUILDING_KEYS = ["buildingId", "displayName", "lifecycle", "floors"];
const FLOOR_KEYS = [
  "floorId", "buildingId", "displayName", "lifecycle", "floorKind", "elevatorStopId", "destinations"
];
const DESTINATION_KEYS = [
  "destinationId", "floorId", "displayName", "lifecycle", "destinationKind", "accessState",
  "ownerTenantId", "sharedSpacePolicy"
];
const AUTHORIZATION_KEYS = [
  "kind", "authenticatedSubjectId", "authenticatedSessionId", "ownerTenantLifecycles",
  "activeTenantMembership", "privateDestinationGrants", "invitation",
  "restrictedDestinationAuthorities", "authorizationReference", "policyRevision"
];
const OWNER_KEYS = ["tenantId", "lifecycle"];
const MEMBERSHIP_KEYS = ["tenantId", "subjectId", "active"];
const SCOPE_KEYS = ["tenantId", "subjectId", "destinationId"];
const INVITATION_KEYS = [
  "tenantId", "invitationId", "subjectId", "destinationId", "lifecycle", "revision", "validFrom", "expiresAt"
];
const REQUEST_KEYS = [
  "schemaVersion", "channel", "buildingId", "floorId", "elevatorStopId", "destinationId"
];
const CHANNELS = new Set(["door", "elevator", "direct", "alternative"]);
const LIFECYCLES = new Set(["active", "archived", "deleted_tombstone"]);
const MAX_DEPTH = 6;
const MAX_RECORD_KEYS = 12;
const MAX_CONTAINERS = 1250;
const MAX_DESCRIPTORS = 7500;
const MAX_VALUES = 7501;
const MAX_UTF8_BYTES = 524288;
const MAX_KEY_BYTES = 64;

function denied() {
  return objectFreeze({ ok: false, code: "not_found" });
}

function utf8ByteLength(value) {
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

function consumeString(context, value, maximum = MAX_UTF8_BYTES) {
  const bytes = utf8ByteLength(value);
  if (bytes === null || bytes > maximum) return false;
  context.utf8Bytes += bytes;
  return context.utf8Bytes <= MAX_UTF8_BYTES;
}

function beginContainer(context, value, depth, array) {
  if (depth > MAX_DEPTH || value === null || typeof value !== "object" || isProxy(value) ||
      (array ? !arrayIsArray(value) : arrayIsArray(value))) return null;
  const prototype = objectGetPrototypeOf(value);
  if (array ? prototype !== Array.prototype : prototype !== Object.prototype && prototype !== null) return null;
  if (context.identities.has(value)) return null;
  context.identities.add(value);
  context.containers += 1;
  if (context.containers > MAX_CONTAINERS) return null;
  return reflectOwnKeys(value);
}

function reserveKeys(context, keys) {
  context.descriptors += keys.length;
  context.values += keys.length;
  if (context.descriptors > MAX_DESCRIPTORS || context.values > MAX_VALUES) return false;
  for (const key of keys) {
    if (typeof key !== "string" || !consumeString(context, key, MAX_KEY_BYTES)) return false;
  }
  return true;
}

function rememberContainer(context, value, prototype, keys, descriptors) {
  context.observations.push({ value, prototype, keys, descriptors });
}

function sameDescriptor(before, after) {
  return Boolean(after) && ("value" in after) && objectIs(before.value, after.value) &&
    before.writable === after.writable && before.enumerable === after.enumerable &&
    before.configurable === after.configurable;
}

function verifyStability(context) {
  for (const observation of context.observations) {
    if (isProxy(observation.value) || objectGetPrototypeOf(observation.value) !== observation.prototype) return false;
    const keys = reflectOwnKeys(observation.value);
    if (keys.length !== observation.keys.length) return false;
    for (let index = 0; index < keys.length; index += 1) {
      const key = keys[index];
      if (key !== observation.keys[index] ||
          !sameDescriptor(observation.descriptors.get(key),
            objectGetOwnPropertyDescriptor(observation.value, key))) return false;
    }
  }
  return true;
}

function exactRecord(value, expectedKeys, context, depth) {
  const keys = beginContainer(context, value, depth, false);
  if (!keys || keys.length > MAX_RECORD_KEYS || keys.length !== expectedKeys.length ||
      !reserveKeys(context, keys) || expectedKeys.some((key) => !keys.includes(key))) return null;
  const copy = objectCreate(null);
  const descriptors = new Map();
  for (const key of expectedKeys) {
    const descriptor = objectGetOwnPropertyDescriptor(value, key);
    if (!descriptor || !("value" in descriptor) || descriptor.enumerable !== true ||
        (typeof descriptor.value === "string" && !consumeString(context, descriptor.value))) return null;
    descriptors.set(key, descriptor);
    copy[key] = descriptor.value;
  }
  rememberContainer(context, value, objectGetPrototypeOf(value), keys, descriptors);
  return copy;
}

function exactArray(value, maximum, minimum, context, depth) {
  const keys = beginContainer(context, value, depth, true);
  if (!keys || keys.length < 1 || keys.length > maximum + 1 || !reserveKeys(context, keys) ||
      keys[keys.length - 1] !== "length") return null;
  const lengthDescriptor = objectGetOwnPropertyDescriptor(value, "length");
  if (!lengthDescriptor || !("value" in lengthDescriptor) ||
      lengthDescriptor.writable !== true || lengthDescriptor.enumerable !== false ||
      lengthDescriptor.configurable !== false || !numberIsSafeInteger(lengthDescriptor.value) ||
      lengthDescriptor.value < minimum || lengthDescriptor.value > maximum ||
      keys.length !== lengthDescriptor.value + 1) return null;
  const copy = [];
  const descriptors = new Map([["length", lengthDescriptor]]);
  for (let index = 0; index < lengthDescriptor.value; index += 1) {
    const key = String(index);
    if (keys[index] !== key) return null;
    const descriptor = objectGetOwnPropertyDescriptor(value, key);
    if (!descriptor || !("value" in descriptor) || descriptor.enumerable !== true ||
        descriptor.writable !== true || descriptor.configurable !== true ||
        (typeof descriptor.value === "string" && !consumeString(context, descriptor.value))) return null;
    descriptors.set(key, descriptor);
    copy.push(descriptor.value);
  }
  rememberContainer(context, value, objectGetPrototypeOf(value), keys, descriptors);
  return copy;
}

function isId(value) {
  const bytes = typeof value === "string" ? utf8ByteLength(value) : null;
  return bytes !== null && bytes >= 19 && bytes <= 67 && regexpTest(ID, value);
}

function isDisplayName(value) {
  const bytes = typeof value === "string" ? utf8ByteLength(value) : null;
  return bytes !== null && bytes >= 1 && bytes <= 80 && regexpTest(DISPLAY_NAME, value);
}

function isTimestamp(value) {
  if (typeof value !== "string" || utf8ByteLength(value) !== 24 || !regexpTest(TIMESTAMP, value)) return false;
  const milliseconds = dateParse(value);
  return numberIsFinite(milliseconds) && dateToISOString(new DateIntrinsic(milliseconds)) === value;
}

function isRevision(value) {
  return numberIsSafeInteger(value) && !objectIs(value, -0) && value >= 1 && value <= 2147483647;
}

function snapshotOptions(raw) {
  const context = {
    containers: 0, descriptors: 0, values: 1, utf8Bytes: 0,
    identities: new WeakSet(), observations: []
  };
  const navigationIds = new Set();
  const ownerTenantIds = new Set();
  const options = exactRecord(raw, OPTION_KEYS, context, 0);
  if (!options || !isTimestamp(options.evaluatedAt)) return null;
  const catalog = exactRecord(options.catalog, CATALOG_KEYS, context, 1);
  const building = catalog && exactRecord(catalog.building, BUILDING_KEYS, context, 2);
  const floors = building && exactArray(building.floors, 64, 1, context, 3);
  if (!catalog || catalog.schemaVersion !== "1.0" || !building || !floors ||
      !isId(building.buildingId) || !isDisplayName(building.displayName) ||
      !setHas(LIFECYCLES, building.lifecycle)) return null;
  navigationIds.add(building.buildingId);

  const copiedFloors = [];
  for (const rawFloor of floors) {
    const floor = exactRecord(rawFloor, FLOOR_KEYS, context, 4);
    const destinations = floor && exactArray(floor.destinations, 8, 1, context, 5);
    if (!floor || !destinations || !isId(floor.floorId) || floor.buildingId !== building.buildingId ||
        !isDisplayName(floor.displayName) || !setHas(LIFECYCLES, floor.lifecycle) ||
        !setHas(new Set(["customer", "administrative", "shared"]), floor.floorKind) ||
        !isId(floor.elevatorStopId) || setHas(navigationIds, floor.floorId) ||
        setHas(navigationIds, floor.elevatorStopId) || floor.floorId === floor.elevatorStopId) return null;
    navigationIds.add(floor.floorId);
    navigationIds.add(floor.elevatorStopId);
    const copiedDestinations = [];
    let suiteCount = 0;
    for (const rawDestination of destinations) {
      const item = exactRecord(rawDestination, DESTINATION_KEYS, context, 6);
      if (!item || !isId(item.destinationId) || item.floorId !== floor.floorId ||
          !isDisplayName(item.displayName) || !setHas(LIFECYCLES, item.lifecycle) ||
          !setHas(new Set(["suite", "shared_space"]), item.destinationKind) ||
          !TENANT_SKYSCRAPER_NAVIGATION_ACCESS_STATES.includes(item.accessState) ||
          (item.ownerTenantId !== null && !isId(item.ownerTenantId)) ||
          setHas(navigationIds, item.destinationId)) return null;
      navigationIds.add(item.destinationId);
      if (item.destinationKind === "suite" && (item.ownerTenantId === null ||
          item.sharedSpacePolicy !== "not_shared" ||
          !setHas(new Set(["tenant", "private", "restricted"]), item.accessState))) return null;
      if (item.destinationKind === "suite") suiteCount += 1;
      if (item.ownerTenantId !== null) ownerTenantIds.add(item.ownerTenantId);
      const sharedPairs = {
        public: "building_public",
        tenant: "owner_tenant_only",
        invited: "exact_invitation",
        private: "exact_private_grant",
        restricted: "exact_restricted_authority"
      };
      if (item.destinationKind === "shared_space" &&
          (item.sharedSpacePolicy !== sharedPairs[item.accessState] ||
           (item.accessState === "public" ? item.ownerTenantId !== null : item.ownerTenantId === null))) return null;
      copiedDestinations.push(item);
    }
    if (floor.floorKind === "customer" && suiteCount > 0 && suiteCount !== 4) return null;
    copiedFloors.push(objectAssign(floor, { destinations: copiedDestinations }));
  }

  const authorization = exactRecord(options.authorization, AUTHORIZATION_KEYS, context, 1);
  const owners = authorization && exactArray(authorization.ownerTenantLifecycles, 512, 0, context, 2);
  const privateGrants = authorization && exactArray(authorization.privateDestinationGrants, 16, 0, context, 2);
  const authorities = authorization && exactArray(authorization.restrictedDestinationAuthorities, 16, 0, context, 2);
  if (!authorization || !owners || !privateGrants || !authorities ||
      authorization.kind !== "trusted-server-context" ||
      !isRevision(authorization.policyRevision)) return null;
  let membership = null;
  if (authorization.authenticatedSubjectId === null) {
    if (authorization.authenticatedSessionId !== null || authorization.activeTenantMembership !== null ||
        authorization.authorizationReference !== null) return null;
  } else {
    membership = exactRecord(authorization.activeTenantMembership, MEMBERSHIP_KEYS, context, 2);
    if (!isId(authorization.authenticatedSubjectId) || !isId(authorization.authenticatedSessionId) ||
        !isId(authorization.authorizationReference) || !membership || !isId(membership.tenantId) ||
        membership.subjectId !== authorization.authenticatedSubjectId || membership.active !== true) return null;
  }
  let invitation = null;
  if (authorization.invitation !== null) {
    invitation = exactRecord(authorization.invitation, INVITATION_KEYS, context, 2);
    if (!invitation || !isId(invitation.tenantId) || !isId(invitation.invitationId) ||
        !isId(invitation.subjectId) || invitation.subjectId !== authorization.authenticatedSubjectId ||
        !isId(invitation.destinationId) ||
        invitation.lifecycle !== "accepted" || !isRevision(invitation.revision) || invitation.revision < 2 ||
        !isTimestamp(invitation.validFrom) || !isTimestamp(invitation.expiresAt) ||
        dateParse(invitation.validFrom) >= dateParse(invitation.expiresAt)) return null;
  }
  const copiedGrants = [];
  let previousGrant = null;
  for (const rawGrant of privateGrants) {
    const grant = exactRecord(rawGrant, SCOPE_KEYS, context, 3);
    if (!grant || !isId(grant.tenantId) || !isId(grant.subjectId) || !isId(grant.destinationId)) return null;
    const identity = `${grant.tenantId}:${grant.subjectId}:${grant.destinationId}`;
    if (previousGrant !== null && identity <= previousGrant) return null;
    previousGrant = identity;
    copiedGrants.push(grant);
  }
  const copiedAuthorities = [];
  let previousAuthority = null;
  for (const rawAuthority of authorities) {
    const authority = exactRecord(rawAuthority, SCOPE_KEYS, context, 3);
    if (!authority || !isId(authority.tenantId) || !isId(authority.subjectId) ||
        !isId(authority.destinationId)) return null;
    const identity = `${authority.tenantId}:${authority.subjectId}:${authority.destinationId}`;
    if (previousAuthority !== null && identity <= previousAuthority) return null;
    previousAuthority = identity;
    copiedAuthorities.push(authority);
  }
  const copiedOwners = [];
  let previousOwner = null;
  for (const rawOwner of owners) {
    const owner = exactRecord(rawOwner, OWNER_KEYS, context, 3);
    if (!owner || !isId(owner.tenantId) || !setHas(LIFECYCLES, owner.lifecycle) ||
        (previousOwner !== null && owner.tenantId <= previousOwner)) return null;
    previousOwner = owner.tenantId;
    copiedOwners.push(owner);
  }
  if (copiedOwners.length !== ownerTenantIds.size ||
      copiedOwners.some((owner) => !setHas(ownerTenantIds, owner.tenantId))) return null;

  if (!verifyStability(context)) return null;
  return {
    catalog: objectAssign(catalog, { building: objectAssign(building, { floors: copiedFloors }) }),
    authorization: objectAssign(authorization, {
      ownerTenantLifecycles: copiedOwners,
      activeTenantMembership: membership,
      invitation,
      privateDestinationGrants: copiedGrants,
      restrictedDestinationAuthorities: copiedAuthorities
    }),
    evaluatedAt: options.evaluatedAt
  };
}

function snapshotRequest(raw) {
  const context = {
    containers: 0, descriptors: 0, values: 1, utf8Bytes: 0,
    identities: new WeakSet(), observations: []
  };
  const request = exactRecord(raw, REQUEST_KEYS, context, 0);
  if (!request || request.schemaVersion !== "1.0" || !setHas(CHANNELS, request.channel) ||
      !isId(request.buildingId) || !isId(request.floorId) || !isId(request.elevatorStopId) ||
      !isId(request.destinationId) || !verifyStability(context)) return null;
  return request;
}

function allowedDecision(options, request, destination) {
  const decision = objectFreeze(objectAssign(objectCreate(null), {
    allowed: true,
    code: "allowed",
    schemaVersion: "1.0",
    channel: request.channel,
    buildingId: request.buildingId,
    floorId: request.floorId,
    elevatorStopId: request.elevatorStopId,
    destinationId: request.destinationId,
    destinationKind: destination.destinationKind,
    accessState: destination.accessState,
    subjectId: options.authorization.authenticatedSubjectId,
    tenantId: destination.ownerTenantId,
    authorizationReference: options.authorization.authorizationReference,
    policyRevision: options.authorization.policyRevision,
    evaluatedAt: options.evaluatedAt,
    validUntil: destination.accessState === "invited" ? options.authorization.invitation.expiresAt : null
  }));
  return objectFreeze(objectAssign(objectCreate(null), { ok: true, decision }));
}

export function createTenantSkyscraperNavigationAuthorizer(trustedOptions) {
  let options = null;
  try {
    options = snapshotOptions(trustedOptions);
  } catch {
    options = null;
  }
  return objectFreeze(objectAssign(objectCreate(null), {
    decideNavigation(rawRequest) {
      try {
        const request = snapshotRequest(rawRequest);
        if (!options || !request) return denied();
        const building = options.catalog.building;
        const floor = arrayFind(building.floors, (candidate) => candidate.floorId === request.floorId);
        const destination = floor && arrayFind(floor.destinations,
          (candidate) => candidate.destinationId === request.destinationId);
        if (!floor || !destination || building.buildingId !== request.buildingId ||
            floor.elevatorStopId !== request.elevatorStopId || building.lifecycle !== "active" ||
            floor.lifecycle !== "active" || destination.lifecycle !== "active") return denied();
        if (destination.accessState !== "public") {
          const owner = arrayFind(options.authorization.ownerTenantLifecycles, (candidate) =>
            candidate.tenantId === destination.ownerTenantId);
          if (!owner || owner.lifecycle !== "active") return denied();
        }
        if (destination.accessState === "tenant") {
          const membership = options.authorization.activeTenantMembership;
          if (!membership || membership.tenantId !== destination.ownerTenantId ||
              membership.subjectId !== options.authorization.authenticatedSubjectId || membership.active !== true) {
            return denied();
          }
        } else if (destination.accessState === "invited") {
          const invitation = options.authorization.invitation;
          if (!invitation || invitation.tenantId !== destination.ownerTenantId ||
              invitation.subjectId !== options.authorization.authenticatedSubjectId ||
              invitation.destinationId !== destination.destinationId || invitation.lifecycle !== "accepted" ||
              invitation.revision < 2 || dateParse(options.evaluatedAt) < dateParse(invitation.validFrom) ||
              dateParse(options.evaluatedAt) >= dateParse(invitation.expiresAt)) return denied();
        } else if (destination.accessState === "private") {
          const membership = options.authorization.activeTenantMembership;
          const hasGrant = arraySome(options.authorization.privateDestinationGrants, (grant) =>
            grant.tenantId === destination.ownerTenantId &&
            grant.subjectId === options.authorization.authenticatedSubjectId &&
            grant.destinationId === destination.destinationId);
          if (!membership || membership.tenantId !== destination.ownerTenantId ||
              membership.subjectId !== options.authorization.authenticatedSubjectId || !hasGrant) return denied();
        } else if (destination.accessState === "restricted") {
          const membership = options.authorization.activeTenantMembership;
          const hasAuthority = arraySome(options.authorization.restrictedDestinationAuthorities, (authority) =>
            authority.tenantId === destination.ownerTenantId &&
            authority.subjectId === options.authorization.authenticatedSubjectId &&
            authority.destinationId === destination.destinationId);
          if (!membership || membership.tenantId !== destination.ownerTenantId ||
              membership.subjectId !== options.authorization.authenticatedSubjectId || !hasAuthority) return denied();
        } else if (destination.accessState !== "public") return denied();
        return allowedDecision(options, request, destination);
      } catch {
        return denied();
      }
    }
  }));
}
