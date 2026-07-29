const MAX_BODY_BYTES = 32_768;
const CREATE_AUTHORIZATION_ACTION = "create";
const REQUEST_ID = /^id_[a-f0-9]{16,64}$/;
const PRIVATE_CACHE_HEADERS = Object.freeze({
  "cache-control": "private, no-store",
  "content-type": "application/json; charset=utf-8",
  "vary": "authorization",
  "x-content-type-options": "nosniff"
});

function sendJson(response, status, body) {
  const payload = JSON.stringify(body);
  response.writeHead(status, {
    ...PRIVATE_CACHE_HEADERS,
    "content-length": Buffer.byteLength(payload)
  });
  response.end(payload);
}

function deny(response) {
  sendJson(response, 404, { error: "not_found" });
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasExactKeys(value, expected) {
  if (!isObject(value)) return false;
  const keys = Object.keys(value).sort();
  const sorted = [...expected].sort();
  return keys.length === sorted.length && keys.every((key, index) => key === sorted[index]);
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (isObject(value)) {
    return `{${Object.keys(value).sort().map((key) =>
      `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

async function readJsonBody(request) {
  let size = 0;
  const chunks = [];
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) return null;
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    return null;
  }
}

function parseRoute(rawUrl) {
  const url = new URL(rawUrl ?? "/", "http://private.invalid");
  if (url.searchParams.size !== 0) return null;
  const parts = url.pathname.split("/").filter(Boolean);
  if (parts.length !== 5 && parts.length !== 6) return null;
  if (parts[0] !== "api" || parts[1] !== "private" || parts[2] !== "tenants" || parts[4] !== "records") return null;
  return { tenantId: parts[3], recordId: parts[5] ?? null };
}

function createRecord(body, tenantId, recordId, recordedAt) {
  if (!hasExactKeys(body, ["expectedRevision", "record", "requestId"]) ||
      typeof body.requestId !== "string" || !REQUEST_ID.test(body.requestId) || !isObject(body.record) ||
      ["tenantId", "recordId", "recordedAt", "updatedAt", "revision"].some((key) => Object.hasOwn(body.record, key))) {
    return null;
  }
  return {
    ...body.record,
    recordId,
    tenantId,
    recordedAt,
    updatedAt: recordedAt,
    revision: 1
  };
}

function creationAudit(record, authorization, auditEventId) {
  return {
    auditEventId,
    tenantId: record.tenantId,
    recordId: record.recordId,
    eventKind: "creation",
    actor: { tenantId: record.tenantId, subjectId: authorization.authentication.subjectId },
    onBehalfOf: null,
    authorizationRef: authorization.authorizationRef,
    policyRevision: authorization.policyRevision,
    occurredAt: record.recordedAt,
    recordedAt: record.recordedAt,
    priorRevision: 0,
    newRevision: 1,
    changedFields: [{ field: "recordId", before: null, after: record.recordId }],
    reasonRef: null,
    source: record.source
  };
}

export function createPrivateWorkRecordsApiHandler({
  store,
  domain,
  resolveTrustedIdentity,
  resolveTrustedReferences,
  now = Date.now,
  generateId
}) {
  if (!store || !domain || typeof resolveTrustedIdentity !== "function" ||
      typeof resolveTrustedReferences !== "function" || typeof generateId !== "function") {
    throw new TypeError("private work-record dependencies are required");
  }
  return async function privateWorkRecordsApiHandler(request, response) {
    try {
      const route = parseRoute(request.url);
      if (route === null) return deny(response);
      const facts = await resolveTrustedIdentity(request);
      const trusted = domain.createTrustedAuthorizationContext(facts);
      if (!trusted.ok || !trusted.value.authentication.authenticated || !trusted.value.membership.active ||
          trusted.value.membership.tenantId !== route.tenantId) {
        return deny(response);
      }
      const authorization = trusted.value;

      if (request.method === "POST" && route.recordId === null) {
        if (request.headers["content-type"]?.split(";", 1)[0].trim().toLowerCase() !== "application/json") {
          return deny(response);
        }
        const body = await readJsonBody(request);
        let recordedAt;
        try {
          const timestamp = now();
          if (!Number.isFinite(timestamp)) return deny(response);
          recordedAt = new Date(timestamp).toISOString();
        } catch {
          return deny(response);
        }
        const record = createRecord(body, route.tenantId, generateId("record"), recordedAt);
        if (record === null) return deny(response);
        const validation = domain.validateWorkRecord(record);
        if (!validation.ok) return deny(response);
        const referencesAllowed = await resolveTrustedReferences({
          tenantId: route.tenantId,
          principalId: authorization.authentication.subjectId,
          authorizationRef: authorization.authorizationRef,
          policyRevision: authorization.policyRevision,
          record: validation.value
        });
        if (referencesAllowed !== true) return deny(response);
        const decision = domain.authorizeAction({
          authorization,
          action: CREATE_AUTHORIZATION_ACTION,
          tenantId: route.tenantId,
          record: validation.value
        });
        if (!decision.allowed) return deny(response);
        const auditValidation = domain.validateCreationAuditEvent(
          creationAudit(validation.value, authorization, generateId("audit")),
          validation.value,
          authorization
        );
        if (!auditValidation.ok) return deny(response);
        const result = store.create(
          validation.value,
          auditValidation.value,
          body.expectedRevision,
          {
            tenantId: route.tenantId,
            principalId: authorization.authentication.subjectId,
            authorizationRef: authorization.authorizationRef,
            policyRevision: authorization.policyRevision,
            requestId: body.requestId,
            requestSemantics: canonicalJson({ expectedRevision: body.expectedRevision, record: body.record })
          }
        );
        if (!result.ok) return sendJson(response, 409, { error: "conflict" });
        if (result.replayed) return sendJson(response, 200, { record: result.record });
        return sendJson(response, 201, { record: validation.value });
      }

      if (request.method === "GET" && route.recordId !== null) {
        const record = store.read(route.tenantId, route.recordId);
        if (record === null) return deny(response);
        const decision = domain.authorizeAction({
          authorization,
          action: "read",
          tenantId: route.tenantId,
          record
        });
        if (!decision.allowed) return deny(response);
        return sendJson(response, 200, { record });
      }

      if (request.method === "GET" && route.recordId === null) {
        if (!authorization.permissions.includes("read")) return deny(response);
        const records = store.list(route.tenantId, 50);
        for (const record of records) {
          const decision = domain.authorizeAction({
            authorization,
            action: "read",
            tenantId: route.tenantId,
            record
          });
          if (!decision.allowed) return deny(response);
        }
        return sendJson(response, 200, { records, count: records.length, cursor: null });
      }

      return deny(response);
    } catch {
      if (!response.headersSent) sendJson(response, 500, { error: "internal_error" });
      else response.destroy();
    }
  };
}
