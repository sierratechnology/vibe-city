import assert from "node:assert/strict";
import { channel } from "node:diagnostics_channel";
import { mkdtemp, rm } from "node:fs/promises";
import { createConnection } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { startWorkRecordsServer } from "../../server/index.mjs";

const netServerSockets = channel("net.server.socket");

export const EMPTY_OWNER = Object.freeze({ clients: 0, accepted: 0, timers: 0, immediates: 0,
  barriers: 0, subscriptions: 0, paths: 0, cleanupActions: 0, serverOpen: 0 });

function createResourceOwner(milliseconds) {
  const clients = new Set();
  const accepted = new Set();
  const timers = new Map();
  const deadlineTimers = new Set();
  const immediates = new Map();
  const barriers = new Set();
  const subscriptions = new Set();
  const paths = new Set();
  const deferredCleanup = [];
  const timeoutFailure = new Error("synthetic loopback deadline exceeded");
  let server;
  let serverClose;
  let rejectOperationTimeout;
  let rejectAbsoluteDeadline;
  const trackSocket = (socket, set) => {
    set.add(socket);
    socket.once("close", () => set.delete(socket));
    return socket;
  };
  const onAccepted = ({ socket }) => {
    if (server && socket?.localPort === server.port) trackSocket(socket, accepted);
  };
  netServerSockets.subscribe(onAccepted);
  subscriptions.add(() => netServerSockets.unsubscribe(onAccepted));
  const operationTimer = setTimeout(() => {
    rejectOperationTimeout(timeoutFailure);
  }, Math.max(1, milliseconds - Math.min(100, Math.floor(milliseconds / 2))));
  const absoluteTimer = setTimeout(() => {
    owner.abort(timeoutFailure);
    rejectAbsoluteDeadline(timeoutFailure);
  }, milliseconds);
  const owner = {
    operationTimeout: new Promise((_, reject) => { rejectOperationTimeout = reject; }),
    absoluteDeadline: new Promise((_, reject) => { rejectAbsoluteDeadline = reject; }),
    async temp(prefix) {
      const path = await mkdtemp(join(tmpdir(), prefix));
      paths.add(path);
      return path;
    },
    async startServer(options) {
      server = await startWorkRecordsServer(options);
      return server;
    },
    connect(activeServer) {
      return trackSocket(createConnection({ host: activeServer.host, port: activeServer.port }), clients);
    },
    exchange(activeServer, requestText, { endAfterWrite = false,
      onConnect = () => {}, onClose = () => {} } = {}) {
      return new Promise((resolve, reject) => {
        const socket = trackSocket(createConnection({ host: activeServer.host,
          port: activeServer.port }), clients);
        const chunks = [];
        let failure;
        socket.on("connect", () => {
          onConnect(socket);
          socket[endAfterWrite ? "end" : "write"](requestText);
        });
        socket.on("data", (chunk) => chunks.push(chunk));
        socket.on("error", (error) => { failure ??= error; socket.destroy(); });
        socket.on("close", () => {
          onClose(socket);
          if (failure) reject(failure);
          else resolve(Buffer.concat(chunks));
        });
      });
    },
    wait(millisecondsToWait) {
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => { timers.delete(timer); resolve(); }, millisecondsToWait);
        timer.unref();
        timers.set(timer, reject);
      });
    },
    immediate() {
      return new Promise((resolve, reject) => {
        const immediate = setImmediate(() => { immediates.delete(immediate); resolve(); });
        immediates.set(immediate, reject);
      });
    },
    barrier() {
      return new Promise((_, reject) => barriers.add(reject));
    },
    subscribe(diagnosticChannel, listener) {
      diagnosticChannel.subscribe(listener);
      subscriptions.add(() => diagnosticChannel.unsubscribe(listener));
    },
    deferCleanup(action) { deferredCleanup.push(action); },
    closeServer() {
      serverClose ??= server ? server.close() : Promise.resolve();
      return serverClose;
    },
    abort(error = timeoutFailure) {
      for (const [timer, reject] of timers) { clearTimeout(timer); reject(error); }
      timers.clear();
      for (const [immediate, reject] of immediates) { clearImmediate(immediate); reject(error); }
      immediates.clear();
      for (const reject of barriers) reject(error);
      barriers.clear();
      for (const socket of [...clients, ...accepted]) socket.destroy();
    },
    snapshot() {
      return { clients: clients.size, accepted: accepted.size,
        timers: timers.size + deadlineTimers.size,
        immediates: immediates.size, barriers: barriers.size, subscriptions: subscriptions.size,
        paths: paths.size, cleanupActions: deferredCleanup.length,
        serverOpen: server && !serverClose ? 1 : 0 };
    },
    async cleanup() {
      const sockets = [...clients, ...accepted].map((socket) => socket.closed
        ? Promise.resolve() : new Promise((resolveClose) => socket.once("close", resolveClose)));
      owner.abort();
      for (const unsubscribe of subscriptions) unsubscribe();
      subscriptions.clear();
      const cleanup = (async () => {
        const results = await Promise.allSettled([owner.closeServer(), ...sockets,
          ...deferredCleanup.map((action) => Promise.resolve().then(action))]);
        for (const path of paths) {
          try { await rm(path, { recursive: true, force: true }); }
          catch (error) { results.push({ status: "rejected", reason: error }); }
        }
        paths.clear();
        deferredCleanup.length = 0;
        const failure = results.find((result) => result.status === "rejected");
        if (failure) throw failure.reason;
      })();
      await Promise.race([cleanup, owner.absoluteDeadline]);
    },
    finish() {
      for (const timer of deadlineTimers) clearTimeout(timer);
      deadlineTimers.clear();
    }
  };
  deadlineTimers.add(operationTimer);
  deadlineTimers.add(absoluteTimer);
  return owner;
}

export async function withDeadline(run, milliseconds = 4_000) {
  const owner = createResourceOwner(milliseconds);
  const operation = Promise.resolve().then(() => run(owner));
  let result;
  let failure;
  try {
    try { result = await Promise.race([operation, owner.operationTimeout]); }
    catch (error) { failure = error; }
  } finally {
    operation.catch(() => {});
    try { await owner.cleanup(); }
    catch (error) { failure = failure ? new AggregateError([failure, error]) : error; }
    owner.finish();
    assert.deepEqual(owner.snapshot(), EMPTY_OWNER);
  }
  if (failure) throw failure;
  return result;
}
