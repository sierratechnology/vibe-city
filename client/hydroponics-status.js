function acceptedTime(value) {
  return typeof value === 'number'
    && Number.isFinite(value)
    && !Object.is(value, -0)
    && value >= 0
    && value <= Number.MAX_SAFE_INTEGER;
}

function acceptedStatus(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const descriptors = Object.getOwnPropertyDescriptors(input);
  const keys = Reflect.ownKeys(descriptors);
  if (Object.getPrototypeOf(input) !== Object.prototype
    || keys.some(key => key !== 'worldTime' && key !== 'readyAt')
    || keys.length !== (descriptors.readyAt ? 2 : 1)
    || !Object.hasOwn(descriptors.worldTime, 'value')
    || !acceptedTime(descriptors.worldTime.value)) return null;
  if (descriptors.readyAt) {
    if (!Object.hasOwn(descriptors.readyAt, 'value') || !acceptedTime(descriptors.readyAt.value)) return null;
    structuredClone(input);
    const remainingSeconds = Math.max(0, Math.ceil(descriptors.readyAt.value - descriptors.worldTime.value));
    if (remainingSeconds > 0) return {
      kind: 'growing',
      remainingSeconds,
      label: `Hydroponic bed growing, ${remainingSeconds} seconds of server time remaining`,
    };
    return {kind: 'ready', label: 'Hydroponic bed ready to harvest'};
  }
  structuredClone(input);
  return {kind: 'plantable', label: 'Plant water + fiber'};
}

export function hydroponicStatus(input) {
  try {
    return acceptedStatus(input);
  } catch {
    return null;
  }
}

export function hydroponicBedRenderState(structure, worldTime) {
  try {
    const descriptors = Object.getOwnPropertyDescriptors(structure);
    if (Object.getPrototypeOf(structure) !== Object.prototype
      || Reflect.ownKeys(descriptors).some(key => !Object.hasOwn(descriptors[key], 'value'))) {
      return {label: 'Hydroponic bed status unavailable', action: null};
    }
    structuredClone(structure);
    const descriptor = descriptors.readyAt;
    const status = hydroponicStatus(descriptor
      ? {worldTime, readyAt: descriptor.value}
      : {worldTime});
    if (!status) return {label: 'Hydroponic bed status unavailable', action: null};
    if (status.kind === 'growing') return {label: status.label, action: null};
    return {
      label: status.label,
      action: {
        label: status.kind === 'ready' ? 'Harvest' : status.label,
        message: {type: 'garden'},
      },
    };
  } catch {
    return {label: 'Hydroponic bed status unavailable', action: null};
  }
}
