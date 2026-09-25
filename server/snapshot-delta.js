export {
  SNAPSHOT_DELTA_LIMITS,
  SNAPSHOT_FIELDS,
  acceptSnapshotBaseline,
  applySnapshotDelta,
  createSnapshotDelta,
} from '../client/snapshot-delta.js';

import {acceptSnapshotBaseline, SNAPSHOT_FIELDS, SNAPSHOT_DELTA_LIMITS} from '../client/snapshot-delta.js';

export const FULL_SNAPSHOT_INTERVAL = 32;

function snapshotForDelivery(state) {
  const snapshot = structuredClone(state);
  for (const player of snapshot.players || []) {
    delete player.account;
    delete player.role;
  }
  return acceptSnapshotBaseline(snapshot, 0);
}

export function createSnapshotSession(state) {
  return {state: snapshotForDelivery(state), revision: 0, deltasSinceFull: 0, acknowledgedInput: false, sentUpdate: false};
}

export function nextSnapshotPacket(session, state, metadata = {}) {
  if (!session || !Number.isSafeInteger(session.revision) || session.revision < 0 || session.revision >= Number.MAX_SAFE_INTEGER) {
    throw new TypeError('Invalid snapshot session revision');
  }
  state = snapshotForDelivery(state);
  const revision = session.revision + 1;
  // Both baselines already passed the full schema and privacy validator. Avoid
  // recursively cloning and validating them again for every connected viewer.
  const changes={};for(const field of SNAPSHOT_FIELDS)if(JSON.stringify(session.state[field])!==JSON.stringify(state[field]))changes[field]=state[field];
  const delta = {type:'delta',baseRevision:session.revision,revision,changes};
  const deltaPacket = {...metadata, type: 'delta', delta};
  const fullPacket = {...metadata, type: 'state', revision, state};
  const rosterChanged = JSON.stringify(session.state.players.map(player => player.id)) !== JSON.stringify(state.players.map(player => player.id));
  const firstAcknowledgement = !session.acknowledgedInput && metadata.inputAck !== null && metadata.inputAck !== undefined;
  const forceFull = !session.sentUpdate || rosterChanged || firstAcknowledgement || session.deltasSinceFull + 1 >= FULL_SNAPSHOT_INTERVAL
    || Buffer.byteLength(JSON.stringify(delta)) > SNAPSHOT_DELTA_LIMITS.maxBytes
    || Buffer.byteLength(JSON.stringify(deltaPacket)) >= Buffer.byteLength(JSON.stringify(fullPacket));
  session.state = state;
  session.revision = revision;
  session.deltasSinceFull = forceFull ? 0 : session.deltasSinceFull + 1;
  session.sentUpdate = true;
  if (metadata.inputAck !== null && metadata.inputAck !== undefined) session.acknowledgedInput = true;
  return structuredClone(forceFull ? fullPacket : deltaPacket);
}
