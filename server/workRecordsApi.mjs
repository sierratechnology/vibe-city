import { ingestWorkEvent, isWorkRecordsAuthorizationValid, readWorkEvents } from "./workRecords.mjs";

const MAX_BODY_BYTES = 16_384;
const LOOPBACK_HOSTNAMES = new Set(["127.0.0.1", "[::1]", "localhost"]);

function isLoopbackHostHeader(host) {
  if (typeof host !== "string") return false;
  try {
    return LOOPBACK_HOSTNAMES.has(new URL(`http://${host}`).hostname);
  } catch {
    return false;
  }
}

function sendJson(response, status, body, extraHeaders = {}) {
  const payload = JSON.stringify(body);
  response.writeHead(status, {
    "cache-control": "no-store",
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(payload),
    "x-content-type-options": "nosniff",
    ...extraHeaders
  });
  response.end(payload);
}

async function readJsonBody(request) {
  let size = 0;
  const chunks = [];
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) return { ok: false, status: 413, error: "body_too_large" };
    chunks.push(chunk);
  }
  try {
    return { ok: true, value: JSON.parse(Buffer.concat(chunks).toString("utf8")) };
  } catch {
    return { ok: false, status: 400, error: "invalid_json" };
  }
}

export function createWorkRecordsApiHandler({ store, expectedToken, now = Date.now }) {
  return async function workRecordsApiHandler(request, response) {
    try {
      if (!isLoopbackHostHeader(request.headers.host)) {
        sendJson(response, 403, { error: "forbidden_host" });
        return;
      }
      const requestUrl = new URL(request.url ?? "/", "http://127.0.0.1");
      if (requestUrl.pathname !== "/api/work-events") {
        sendJson(response, 404, { error: "not_found" });
        return;
      }

      if (request.method === "GET") {
        const rawLimit = requestUrl.searchParams.get("limit");
        const limit = rawLimit === null ? 20 : Number(rawLimit);
        const result = readWorkEvents({ store, now, limit });
        sendJson(response, result.status, result.body);
        return;
      }

      if (request.method === "POST") {
        if (!isWorkRecordsAuthorizationValid(request.headers.authorization, expectedToken)) {
          sendJson(response, 401, { accepted: false, error: "unauthorized" });
          return;
        }
        if (request.headers["content-type"]?.split(";", 1)[0].trim().toLowerCase() !== "application/json") {
          sendJson(response, 415, { accepted: false, error: "json_required" });
          return;
        }
        const body = await readJsonBody(request);
        if (!body.ok) {
          sendJson(response, body.status, { accepted: false, error: body.error });
          return;
        }
        const result = ingestWorkEvent({
          authorization: request.headers.authorization,
          expectedToken,
          body: body.value,
          store,
          now
        });
        sendJson(response, result.status, result.body);
        return;
      }

      sendJson(response, 405, { error: "method_not_allowed" }, { allow: "GET, POST" });
    } catch {
      if (!response.headersSent) sendJson(response, 500, { error: "internal_error" });
      else response.destroy();
    }
  };
}
