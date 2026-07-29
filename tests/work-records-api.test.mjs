import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer, request as httpRequest } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const NOW = "2026-07-28T22:00:05.000Z";
const EVENT = {
  version: "1.0",
  eventId: "evt_33333333333333333333333333333333",
  sourceType: "hermes_kanban",
  workRef: "public-a92cfe6086ac4f34",
  profileId: "ariadne",
  eventKind: "task_started",
  status: "running",
  occurredAt: "2026-07-28T22:00:00.000Z",
  observedAt: NOW,
  summary: "Work is in progress."
};

test("current Kanban ingestion helper refuses to send credentials outside loopback HTTP", () => {
  for (const endpoint of [
    "https://127.0.0.1:4173/api/work-events",
    "http://attacker.example/api/work-events",
    "http://127.0.0.1.attacker.example/api/work-events",
    "http://user:password@127.0.0.1:4173/api/work-events",
    "http://127.0.0.1:4173/api/work-events?forward=attacker.example",
    "http://127.0.0.1:4173/api/work-events#fragment",
    "http://127.0.0.1:4173/alternate-path",
    "http://127.0.0.1:4173/api/work-events/"
  ]) {
    const result = spawnSync(process.execPath, ["scripts/ingest-current-kanban-event.mjs"], {
      cwd: new URL("..", import.meta.url),
      encoding: "utf8",
      env: {
        ...process.env,
        HERMES_KANBAN_TASK: "t_test",
        HERMES_PROFILE: "ariadne",
        VIBE_WORK_RECORD_TOKEN: "local-test-token",
        VIBE_WORK_RECORD_ENDPOINT: endpoint
      }
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /loopback HTTP endpoint/);
    assert.equal(result.stdout, "");
  }
});

test("local HTTP boundary authenticates writes and exposes only the bounded read projection", async () => {
  const [{ createWorkRecordsApiHandler }, { WorkRecordStore }] = await Promise.all([
    import("../server/workRecordsApi.mjs"),
    import("../server/workRecords.mjs")
  ]);
  const directory = mkdtempSync(join(tmpdir(), "vibe-work-api-"));
  const store = new WorkRecordStore(join(directory, "records.sqlite"));
  const handler = createWorkRecordsApiHandler({
    store,
    expectedToken: "http-local-test-token",
    now: () => Date.parse(NOW)
  });
  const server = createServer(handler);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const base = `http://127.0.0.1:${address.port}`;
  try {
    const reboundStatus = await new Promise((resolve, reject) => {
      const request = httpRequest({
        host: "127.0.0.1",
        port: address.port,
        path: "/api/work-events",
        headers: { host: "attacker.example" }
      }, (response) => {
        response.resume();
        response.on("end", () => resolve(response.statusCode));
      });
      request.on("error", reject);
      request.end();
    });
    assert.equal(reboundStatus, 403);

    const unauthorized = await fetch(`${base}/api/work-events`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(EVENT)
    });
    assert.equal(unauthorized.status, 401);

    const unauthorizedMalformed = await fetch(`${base}/api/work-events`, {
      method: "POST",
      headers: { "content-type": "text/plain" },
      body: "not-json"
    });
    assert.equal(unauthorizedMalformed.status, 401);

    const unicodeToken = await fetch(`${base}/api/work-events`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${"é".repeat("http-local-test-token".length)}`,
        "content-type": "application/json"
      },
      body: JSON.stringify(EVENT)
    });
    assert.equal(unicodeToken.status, 401);

    const accepted = await fetch(`${base}/api/work-events`, {
      method: "POST",
      headers: {
        authorization: "Bearer http-local-test-token",
        "content-type": "application/json"
      },
      body: JSON.stringify(EVENT)
    });
    assert.equal(accepted.status, 201);

    const read = await fetch(`${base}/api/work-events?limit=1000`);
    assert.equal(read.status, 200);
    assert.equal(read.headers.get("cache-control"), "no-store");
    const projection = await read.json();
    assert.deepEqual(projection.events, [EVENT]);
    assert.equal(JSON.stringify(projection).includes("http-local-test-token"), false);

    const malformed = await fetch(`${base}/api/work-events`, {
      method: "POST",
      headers: {
        authorization: "Bearer http-local-test-token",
        "content-type": "application/json"
      },
      body: "{not-json"
    });
    assert.equal(malformed.status, 400);
    assert.deepEqual(await malformed.json(), { accepted: false, error: "invalid_json" });

    const wrongMethod = await fetch(`${base}/api/work-events`, { method: "DELETE" });
    assert.equal(wrongMethod.status, 405);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
