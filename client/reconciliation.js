export const MAX_PENDING_INPUTS = 32;
export const HARD_CORRECTION_DISTANCE = 2;
export const MAX_SOFT_CORRECTION = 0.25;
export const SOFT_CORRECTION_RATE = 0.25;

export function createInputReconciler() {
  let nextSequence = 0;
  let latestAck = null;
  let pending = [];

  return {
    queue(input) {
      if (!Number.isSafeInteger(nextSequence)) return null;
      const sequenced = {...input, sequence: nextSequence++};
      pending.push(sequenced);
      if (pending.length > MAX_PENDING_INPUTS) pending = pending.slice(-MAX_PENDING_INPUTS);
      return sequenced;
    },
    reconcile(predicted, authoritative, acknowledgement) {
      if (Number.isSafeInteger(acknowledgement) && acknowledgement >= 0 && acknowledgement < nextSequence && (latestAck === null || acknowledgement >= latestAck)) {
        latestAck = acknowledgement;
        pending = pending.filter(input => input.sequence > acknowledgement);
      }
      const dx = authoritative.x - predicted.x;
      const dz = authoritative.z - predicted.z;
      const distance = Math.hypot(dx, dz);
      if (distance > HARD_CORRECTION_DISTANCE) return {x: authoritative.x, z: authoritative.z, hardCorrected: true};
      if (distance === 0) return {x: predicted.x, z: predicted.z, hardCorrected: false};
      const correction = Math.min(distance * SOFT_CORRECTION_RATE, MAX_SOFT_CORRECTION);
      return {x: predicted.x + dx / distance * correction, z: predicted.z + dz / distance * correction, hardCorrected: false};
    },
    reset() {
      nextSequence = 0;
      latestAck = null;
      pending = [];
    },
    get pendingCount() { return pending.length; },
    get pendingSequences() { return pending.map(input => input.sequence); },
    get latestAck() { return latestAck; },
  };
}
