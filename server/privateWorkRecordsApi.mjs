const REQUEST_ID = /^id_[a-f0-9]{16,64}$/;
const MAX_BODY_BYTES = 32_768;
const PRIVATE_HEADERS = Object.freeze({
  'cache-control': 'private, no-store',
  'content-type': 'application/json; charset=utf-8',
  'vary': 'authorization',
  'x-content-type-options': 'nosniff',
});

function sendJson(response, status, body) {
  const payload = JSON.stringify(body);
  response.writeHead(status, {
    ...PRIVATE_HEADERS,
    'content-length': Buffer.byteLength(payload),
  });
  response.end(payload);
}

function deny(response) {
  sendJson(response, 404, { error: 'not_found' });
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) =>
      `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
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
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    return null;
  }
}

function parseRoute(rawUrl) {
  const match = /^\/api\/private\/tenants\/([^/]+)\/records(?:\/([^/]+))?$/.exec(rawUrl ?? '/');
  if (match === null) return null;
  return { tenantId: match[1], recordId: match[2] ?? null };
}

export function createPrivateWorkRecordsApiHandler({
  store,
  domain,
  resolveTrustedIdentity,
  resolveTrustedReferences,
  now = Date.now,
  generateId,
}) {
  if (!store || !domain || typeof resolveTrustedIdentity !== 'function'
    || typeof resolveTrustedReferences !== 'function' || typeof now !== 'function'
    || typeof generateId !== 'function') {
    throw new TypeError('private work-record dependencies are required');
  }
  return async function privateWorkRecordsApiHandler(request, response) {
    try {
      const route = parseRoute(request.url);
      if (route === null) return deny(response);
      const trusted = domain.createTrustedAuthorizationContext(await resolveTrustedIdentity(request));
      const membership = trusted.memberships.find((candidate) => candidate.tenantId === route.tenantId);
      if (!trusted.authenticated || !membership || membership.status !== 'active') return deny(response);
      if (request.method === 'GET' && route.recordId !== null) {
        if (!trusted.permissions.includes('record.read')) return deny(response);
        const record = store.read(route.tenantId, route.recordId);
        if (record === null) return deny(response);
        domain.authorizeRecordAction(trusted, {
          action: 'record.read',
          requestedTenantId: route.tenantId,
        }, record);
        return sendJson(response, 200, { record });
      }
      if (request.method === 'GET' && route.recordId === null) {
        if (!trusted.permissions.includes('record.read')) return deny(response);
        const records = store.list(route.tenantId, 50);
        for (const record of records) {
          domain.authorizeRecordAction(trusted, {
            action: 'record.read',
            requestedTenantId: route.tenantId,
          }, record);
        }
        return sendJson(response, 200, { records, count: records.length, cursor: null });
      }
      if (request.method !== 'POST' || route.recordId !== null) return deny(response);
      if (request.headers['content-type']?.split(';', 1)[0].trim().toLowerCase() !== 'application/json') {
        return deny(response);
      }
      const body = await readJsonBody(request);
      if (body === null || typeof body !== 'object' || Array.isArray(body)
        || Object.keys(body).sort().join(',') !== 'expectedRevision,record,requestId'
        || typeof body.requestId !== 'string' || !REQUEST_ID.test(body.requestId)
        || !isObject(body.record)
        || ['tenantId', 'recordId', 'createdAt', 'updatedAt', 'revision']
          .some((key) => Object.hasOwn(body.record, key))) {
        return deny(response);
      }
      const timestamp = now();
      if (!Number.isFinite(timestamp)) return deny(response);
      const recordedAt = new Date(timestamp).toISOString();
      const record = domain.createWorkRecord({
        ...body.record,
        tenantId: route.tenantId,
        recordId: generateId('record'),
        revision: 1,
        createdAt: recordedAt,
        updatedAt: recordedAt,
      });
      domain.authorizeRecordAction(trusted, {
        action: 'record.create',
        requestedTenantId: route.tenantId,
      }, record);
      const referencesAllowed = await resolveTrustedReferences({
        tenantId: route.tenantId,
        principalId: trusted.actorSubjectId,
        authorizationId: trusted.authorizationId,
        policyRevision: trusted.policyRevision,
        record,
      });
      if (referencesAllowed !== true) return deny(response);
      const audit = domain.validateCreationAuditEvent({
        auditId: generateId('audit'),
        tenantId: route.tenantId,
        recordId: record.recordId,
        actorSubjectId: trusted.actorSubjectId,
        authorizationId: trusted.authorizationId,
        policyRevision: trusted.policyRevision,
        sourceId: record.source.sourceId,
        priorRevision: 0,
        newRevision: 1,
        occurredAt: recordedAt,
        recordedAt,
        changedFields: ['recordId'],
      }, record, trusted);
      const result = store.create(record, audit, body.expectedRevision, {
        tenantId: route.tenantId,
        principalId: trusted.actorSubjectId,
        authorizationId: trusted.authorizationId,
        policyRevision: trusted.policyRevision,
        requestId: body.requestId,
        requestSemantics: canonicalJson({
          expectedRevision: body.expectedRevision,
          record: body.record,
        }),
      });
      if (!result.ok) return sendJson(response, 409, { error: 'conflict' });
      if (result.replayed) return sendJson(response, 200, { record: result.record });
      return sendJson(response, 201, { record });
    } catch {
      if (!response.headersSent) deny(response);
      else response.destroy();
    }
  };
}
