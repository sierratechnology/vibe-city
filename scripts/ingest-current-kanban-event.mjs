import { createHash } from "node:crypto";

const taskId = process.env.HERMES_KANBAN_TASK;
const profileId = process.env.HERMES_PROFILE;
const token = process.env.VIBE_WORK_RECORD_TOKEN;
const endpoint = process.env.VIBE_WORK_RECORD_ENDPOINT ?? "http://127.0.0.1:4173/api/work-events";
const LOOPBACK_HOSTNAMES = new Set(["127.0.0.1", "[::1]", "localhost"]);

function isLocalIngestionEndpoint(value) {
  try {
    const url = new URL(value);
    return url.protocol === "http:" && LOOPBACK_HOSTNAMES.has(url.hostname) &&
      url.username === "" && url.password === "" && url.pathname === "/api/work-events" &&
      url.search === "" && url.hash === "";
  } catch {
    return false;
  }
}

if (!taskId || !profileId || !token) {
  console.error("HERMES_KANBAN_TASK, HERMES_PROFILE, and VIBE_WORK_RECORD_TOKEN are required.");
  process.exitCode = 1;
} else if (!isLocalIngestionEndpoint(endpoint)) {
  console.error("VIBE_WORK_RECORD_ENDPOINT must be a loopback HTTP endpoint ending in /api/work-events.");
  process.exitCode = 1;
} else {
  const observedAt = new Date().toISOString();
  const digest = (value, length) => createHash("sha256").update(value).digest("hex").slice(0, length);
  const event = {
    version: "1.0",
    eventId: `evt_${digest(`${taskId}:${profileId}:status_changed:running`, 32)}`,
    sourceType: "hermes_kanban",
    workRef: `public-${digest(taskId, 16)}`,
    profileId,
    eventKind: "status_changed",
    status: "running",
    occurredAt: observedAt,
    observedAt,
    summary: "Work is in progress."
  };
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json"
    },
    body: JSON.stringify(event),
    signal: AbortSignal.timeout(5_000)
  });
  const result = await response.json().catch(() => ({ accepted: false, error: "invalid_response" }));
  if (!response.ok) {
    console.error(JSON.stringify(result));
    process.exitCode = 1;
  } else {
    console.log(JSON.stringify({ accepted: true, eventId: result.eventId, workRef: event.workRef, observedAt }));
  }
}
