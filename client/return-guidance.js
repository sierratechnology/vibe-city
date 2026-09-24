const DIRECTIONS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];

function cloneCanonicalPoint(value) {
  try {
    if (value === null || typeof value !== 'object' || Array.isArray(value)
      || Object.getPrototypeOf(value) !== Object.prototype) return null;
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const keys = Reflect.ownKeys(descriptors);
    if (keys.length !== 2 || !keys.includes('x') || !keys.includes('z')) return null;
    for (const key of keys) {
      const descriptor = descriptors[key];
      if (typeof key !== 'string' || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) return null;
    }
    const point = structuredClone(value);
    if (!Number.isFinite(point.x) || !Number.isFinite(point.z)
      || Object.is(point.x, -0) || Object.is(point.z, -0)) return null;
    return point;
  } catch {
    return null;
  }
}

export function computeReturnGuidance(current, contact) {
  const safeCurrent = cloneCanonicalPoint(current);
  const safeContact = cloneCanonicalPoint(contact);
  if (!safeCurrent || !safeContact) return null;
  const dx = safeContact.x - safeCurrent.x;
  const dz = safeContact.z - safeCurrent.z;
  if (dx === 0 && dz === 0) {
    return {
      distance: 0,
      bearing: null,
      direction: null,
      label: 'At first Coral Shelf contact',
    };
  }
  const distance = Math.round(Math.hypot(dx, dz));
  if (!Number.isFinite(distance) || !Number.isSafeInteger(distance)) return null;
  const degrees = Math.atan2(dx, -dz) * 180 / Math.PI;
  const normalizedDegrees = (degrees + 360) % 360;
  const bearing = Math.round(normalizedDegrees + 1e-10) % 360;
  const direction = DIRECTIONS[Math.floor((normalizedDegrees + 22.5 + 1e-10) / 45) % DIRECTIONS.length];
  return {
    distance,
    bearing,
    direction,
    label: `Return to first Coral Shelf contact: ${distance} m · ${direction} · ${bearing}°`,
  };
}
