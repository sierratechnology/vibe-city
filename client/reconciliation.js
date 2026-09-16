import {planetDistance,direction,travel} from '../shared/planet.js';
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
      const distance = planetDistance(predicted, authoritative);
      const tangent = direction(predicted, authoritative);
      const length = Math.hypot(tangent.x,tangent.z)||1;
      if (distance > HARD_CORRECTION_DISTANCE) return {x: authoritative.x, z: authoritative.z, hardCorrected: true};
      if (distance === 0) return {x: predicted.x, z: predicted.z, hardCorrected: false};
      const correction = Math.min(distance * SOFT_CORRECTION_RATE, MAX_SOFT_CORRECTION);
      return {...travel(predicted,tangent.x/length*correction,tangent.z/length*correction),hardCorrected:false};
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
