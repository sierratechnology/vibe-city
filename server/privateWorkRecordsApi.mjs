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
  const match = /^\/api\/private\/tenants\/([^/]+)\/records(?:\/([^/]+)(?:\/(rename|reassignment|block|unblock|history))?)?$/.exec(rawUrl ?? '/');
  if (match === null) return null;
  return { tenantId: match[1], recordId: match[2] ?? null, action: match[3] ?? null };
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
      if (request.method === 'POST' && route.recordId !== null && route.action === 'block') {
        if (!trusted.permissions.includes('record.block')) return deny(response);
        if (request.headers['content-type']?.split(';', 1)[0].trim().toLowerCase() !== 'application/json') {
          return deny(response);
        }
        const body = await readJsonBody(request);
        if (!isObject(body)
          || Object.keys(body).sort().join(',') !== 'blockReason,expectedRevision,reasonRef,requestId'
          || !Number.isSafeInteger(body.expectedRevision)
          || typeof body.requestId !== 'string' || !REQUEST_ID.test(body.requestId)
          || !isObject(body.blockReason)
          || !['blockedAt,category,resolutionAuthoritySubjectId,summary', 'blockedAt,category,summary']
            .includes(Object.keys(body.blockReason).sort().join(','))
          || body.blockReason.category !== 'dependency'
          || typeof body.blockReason.summary !== 'string'
          || body.blockReason.summary.trim() !== body.blockReason.summary
          || body.blockReason.summary.length < 1 || body.blockReason.summary.length > 240
          || (body.blockReason.resolutionAuthoritySubjectId !== undefined
            && (typeof body.blockReason.resolutionAuthoritySubjectId !== 'string'
              || !REQUEST_ID.test(body.blockReason.resolutionAuthoritySubjectId)))
          || typeof body.blockReason.blockedAt !== 'string'
          || !Number.isFinite(new Date(body.blockReason.blockedAt).getTime())
          || new Date(body.blockReason.blockedAt).toISOString() !== body.blockReason.blockedAt
          || typeof body.reasonRef !== 'string' || body.reasonRef.trim() !== body.reasonRef
          || body.reasonRef.length < 1 || body.reasonRef.length > 240) return deny(response);
        const current = store.read(route.tenantId, route.recordId);
        if (current === null) return deny(response);
        domain.authorizeRecordAction(trusted, {
          action: 'record.block', requestedTenantId: route.tenantId,
        }, current);
        const requestIdentity = {
          tenantId: route.tenantId, principalId: trusted.actorSubjectId,
          authorizationId: trusted.authorizationId, policyRevision: trusted.policyRevision,
          operation: 'block', requestId: body.requestId,
          requestSemantics: canonicalJson({
            recordId: route.recordId, expectedRevision: body.expectedRevision,
            blockReason: body.blockReason, reasonRef: body.reasonRef,
          }),
        };
        const replay = store.replayMutation(requestIdentity);
        if (replay !== null) {
          return replay.ok
            ? sendJson(response, 200, { record: replay.record })
            : sendJson(response, 409, { error: 'conflict' });
        }
        if (!['open', 'in_progress'].includes(current.lifecycle)
          && body.expectedRevision === current.revision) {
          return sendJson(response, 409, { error: 'conflict' });
        }
        if (body.blockReason.resolutionAuthoritySubjectId !== undefined) {
          const referencesAllowed = await resolveTrustedReferences({
            tenantId: route.tenantId, principalId: trusted.actorSubjectId,
            authorizationId: trusted.authorizationId, policyRevision: trusted.policyRevision,
            resolutionAuthoritySubjectId: body.blockReason.resolutionAuthoritySubjectId,
          });
          if (referencesAllowed !== true) return deny(response);
        }
        const timestamp = now();
        if (!Number.isFinite(timestamp)) return deny(response);
        const recordedAt = new Date(timestamp).toISOString();
        if (body.blockReason.blockedAt < current.updatedAt
          || body.blockReason.blockedAt > recordedAt
          || recordedAt < current.source.recordedAt) return deny(response);
        const record = domain.validateWorkRecord({
          ...current,
          lifecycle: 'blocked', blockReason: body.blockReason,
          stateChangedAt: body.blockReason.blockedAt,
          revision: current.revision + 1, updatedAt: recordedAt,
        });
        const audit = {
          auditId: generateId('audit'), tenantId: route.tenantId, recordId: route.recordId,
          eventKind: 'block', actorSubjectId: trusted.actorSubjectId,
          authorizationId: trusted.authorizationId, policyRevision: trusted.policyRevision,
          sourceId: current.source.sourceId, reasonRef: body.reasonRef,
          priorRevision: current.revision, newRevision: record.revision,
          occurredAt: body.blockReason.blockedAt, recordedAt,
          changedFields: {
            lifecycle: { prior: current.lifecycle, next: 'blocked' },
            blockReason: { prior: current.blockReason ?? null, next: body.blockReason },
          },
        };
        const result = store.mutate(record, audit, body.expectedRevision, requestIdentity);
        if (!result.ok) return sendJson(response, 409, { error: 'conflict' });
        return sendJson(response, 200, { record: result.replayed ? result.record : record });
      }
      if (request.method === 'POST' && route.recordId !== null && route.action === 'unblock') {
        if (!trusted.permissions.includes('record.unblock')) return deny(response);
        if (request.headers['content-type']?.split(';', 1)[0].trim().toLowerCase() !== 'application/json') {
          return deny(response);
        }
        const body = await readJsonBody(request);
        if (!isObject(body)
          || Object.keys(body).sort().join(',') !== 'expectedRevision,occurredAt,reasonRef,requestId'
          || !Number.isSafeInteger(body.expectedRevision)
          || typeof body.requestId !== 'string' || !REQUEST_ID.test(body.requestId)
          || typeof body.reasonRef !== 'string' || body.reasonRef.trim() !== body.reasonRef
          || body.reasonRef.length < 1 || body.reasonRef.length > 240
          || typeof body.occurredAt !== 'string') return deny(response);
        const current = store.read(route.tenantId, route.recordId);
        if (current === null) return deny(response);
        domain.authorizeRecordAction(trusted, {
          action: 'record.unblock', requestedTenantId: route.tenantId,
        }, current);
        const requestIdentity = {
          tenantId: route.tenantId, principalId: trusted.actorSubjectId,
          authorizationId: trusted.authorizationId, policyRevision: trusted.policyRevision,
          operation: 'unblock', requestId: body.requestId,
          requestSemantics: canonicalJson({
            recordId: route.recordId, expectedRevision: body.expectedRevision,
            reasonRef: body.reasonRef, occurredAt: body.occurredAt,
          }),
        };
        const replay = store.replayMutation(requestIdentity);
        if (replay !== null) {
          return replay.ok
            ? sendJson(response, 200, { record: replay.record })
            : sendJson(response, 409, { error: 'conflict' });
        }
        if (current.lifecycle !== 'blocked' && body.expectedRevision === current.revision) {
          return sendJson(response, 409, { error: 'conflict' });
        }
        const blockEvent = store.readLatestBlock(route.tenantId, route.recordId);
        const unblockedLifecycle = blockEvent?.changedFields?.lifecycle?.prior;
        if (!['open', 'in_progress'].includes(unblockedLifecycle)) return deny(response);
        const timestamp = now();
        if (!Number.isFinite(timestamp)) return deny(response);
        const recordedAt = new Date(timestamp).toISOString();
        const occurred = new Date(body.occurredAt);
        if (!Number.isFinite(occurred.getTime()) || occurred.toISOString() !== body.occurredAt
          || body.occurredAt < current.stateChangedAt || body.occurredAt > recordedAt
          || recordedAt < current.updatedAt
          || recordedAt < current.source.recordedAt) return deny(response);
        const priorReason = structuredClone(current.blockReason);
        const record = domain.validateWorkRecord({
          ...current,
          lifecycle: unblockedLifecycle, blockReason: null, stateChangedAt: body.occurredAt,
          revision: current.revision + 1, updatedAt: recordedAt,
        });
        const audit = {
          auditId: generateId('audit'), tenantId: route.tenantId, recordId: route.recordId,
          eventKind: 'unblock', actorSubjectId: trusted.actorSubjectId,
          authorizationId: trusted.authorizationId, policyRevision: trusted.policyRevision,
          sourceId: current.source.sourceId, reasonRef: body.reasonRef,
          priorRevision: current.revision, newRevision: record.revision,
          occurredAt: body.occurredAt, recordedAt,
          changedFields: {
            lifecycle: { prior: 'blocked', next: unblockedLifecycle },
            blockReason: { prior: priorReason, next: null },
          },
        };
        const result = store.mutate(record, audit, body.expectedRevision, requestIdentity);
        if (!result.ok) return sendJson(response, 409, { error: 'conflict' });
        return sendJson(response, 200, { record: result.replayed ? result.record : record });
      }
      if (request.method === 'POST' && route.recordId !== null && route.action === 'reassignment') {
        if (!trusted.permissions.includes('record.reassign')) return deny(response);
        if (request.headers['content-type']?.split(';', 1)[0].trim().toLowerCase() !== 'application/json') {
          return deny(response);
        }
        const body = await readJsonBody(request);
        if (!isObject(body)
          || Object.keys(body).sort().join(',') !== 'assigneeSubjectIds,expectedRevision,occurredAt,reasonRef,requestId'
          || !Number.isSafeInteger(body.expectedRevision)
          || typeof body.requestId !== 'string' || !REQUEST_ID.test(body.requestId)
          || !Array.isArray(body.assigneeSubjectIds) || body.assigneeSubjectIds.length > 50
          || body.assigneeSubjectIds.some((id) => typeof id !== 'string' || !REQUEST_ID.test(id))
          || new Set(body.assigneeSubjectIds).size !== body.assigneeSubjectIds.length
          || typeof body.reasonRef !== 'string' || body.reasonRef.trim() !== body.reasonRef
          || body.reasonRef.length < 1 || body.reasonRef.length > 240
          || typeof body.occurredAt !== 'string') return deny(response);
        const current = store.read(route.tenantId, route.recordId);
        if (current === null) return deny(response);
        domain.authorizeRecordAction(trusted, {
          action: 'record.reassign', requestedTenantId: route.tenantId,
        }, current);
        const referencesAllowed = await resolveTrustedReferences({
          tenantId: route.tenantId, principalId: trusted.actorSubjectId,
          authorizationId: trusted.authorizationId, policyRevision: trusted.policyRevision,
          assigneeSubjectIds: [...body.assigneeSubjectIds],
        });
        if (referencesAllowed !== true) return deny(response);
        const timestamp = now();
        if (!Number.isFinite(timestamp)) return deny(response);
        const recordedAt = new Date(timestamp).toISOString();
        const occurred = new Date(body.occurredAt);
        if (!Number.isFinite(occurred.getTime()) || occurred.toISOString() !== body.occurredAt
          || body.occurredAt > recordedAt || recordedAt < current.updatedAt
          || recordedAt < current.source.recordedAt) return deny(response);
        const prior = current.assignees.map((assignee) => assignee.subjectId);
        const record = domain.validateWorkRecord({
          ...current,
          assignees: body.assigneeSubjectIds.map((subjectId) => ({
            tenantId: route.tenantId, subjectId,
          })),
          revision: current.revision + 1, updatedAt: recordedAt,
        });
        const audit = {
          auditId: generateId('audit'), tenantId: route.tenantId, recordId: route.recordId,
          eventKind: 'reassignment', actorSubjectId: trusted.actorSubjectId,
          authorizationId: trusted.authorizationId, policyRevision: trusted.policyRevision,
          sourceId: current.source.sourceId, reasonRef: body.reasonRef,
          priorRevision: current.revision, newRevision: record.revision,
          occurredAt: body.occurredAt, recordedAt,
          changedFields: { assignees: { prior, next: [...body.assigneeSubjectIds] } },
        };
        const result = store.mutate(record, audit, body.expectedRevision, {
          tenantId: route.tenantId, principalId: trusted.actorSubjectId,
          authorizationId: trusted.authorizationId, policyRevision: trusted.policyRevision,
          operation: 'reassignment', requestId: body.requestId,
          requestSemantics: canonicalJson({
            recordId: route.recordId, expectedRevision: body.expectedRevision,
            assigneeSubjectIds: body.assigneeSubjectIds,
            reasonRef: body.reasonRef, occurredAt: body.occurredAt,
          }),
        });
        if (!result.ok) return sendJson(response, 409, { error: 'conflict' });
        return sendJson(response, 200, { record: result.replayed ? result.record : record });
      }
      if (request.method === 'POST' && route.recordId !== null && route.action === 'rename') {
        if (!trusted.permissions.includes('record.rename')) return deny(response);
        if (request.headers['content-type']?.split(';', 1)[0].trim().toLowerCase() !== 'application/json') {
          return deny(response);
        }
        const body = await readJsonBody(request);
        if (!isObject(body)
          || Object.keys(body).sort().join(',') !== 'expectedRevision,occurredAt,reasonRef,requestId,title'
          || !Number.isSafeInteger(body.expectedRevision)
          || typeof body.requestId !== 'string' || !REQUEST_ID.test(body.requestId)
          || typeof body.title !== 'string' || body.title.trim() !== body.title
          || body.title.length < 1 || body.title.length > 240
          || typeof body.reasonRef !== 'string' || body.reasonRef.trim() !== body.reasonRef
          || body.reasonRef.length < 1 || body.reasonRef.length > 240
          || typeof body.occurredAt !== 'string') return deny(response);
        const current = store.read(route.tenantId, route.recordId);
        if (current === null) return deny(response);
        domain.authorizeRecordAction(trusted, {
          action: 'record.rename', requestedTenantId: route.tenantId,
        }, current);
        const timestamp = now();
        if (!Number.isFinite(timestamp)) return deny(response);
        const recordedAt = new Date(timestamp).toISOString();
        const occurred = new Date(body.occurredAt);
        if (!Number.isFinite(occurred.getTime()) || occurred.toISOString() !== body.occurredAt
          || body.occurredAt > recordedAt || recordedAt < current.updatedAt
          || recordedAt < current.source.recordedAt) return deny(response);
        const record = domain.validateWorkRecord({
          ...current, title: body.title, revision: current.revision + 1, updatedAt: recordedAt,
        });
        const audit = {
          auditId: generateId('audit'), tenantId: route.tenantId, recordId: route.recordId,
          eventKind: 'rename', actorSubjectId: trusted.actorSubjectId,
          authorizationId: trusted.authorizationId, policyRevision: trusted.policyRevision,
          sourceId: current.source.sourceId, reasonRef: body.reasonRef,
          priorRevision: current.revision, newRevision: record.revision,
          occurredAt: body.occurredAt, recordedAt,
          changedFields: { title: { prior: current.title, next: body.title } },
        };
        const result = store.mutate(record, audit, body.expectedRevision, {
          tenantId: route.tenantId, principalId: trusted.actorSubjectId,
          authorizationId: trusted.authorizationId, policyRevision: trusted.policyRevision,
          operation: 'rename', requestId: body.requestId,
          requestSemantics: canonicalJson({
            recordId: route.recordId, expectedRevision: body.expectedRevision,
            title: body.title, reasonRef: body.reasonRef, occurredAt: body.occurredAt,
          }),
        });
        if (!result.ok) return sendJson(response, 409, { error: 'conflict' });
        if (result.replayed) return sendJson(response, 200, { record: result.record });
        return sendJson(response, 200, { record });
      }
      if (request.method === 'GET' && route.recordId !== null && route.action === 'history') {
        if (!trusted.permissions.includes('record.history.read')) return deny(response);
        const record = store.read(route.tenantId, route.recordId);
        if (record === null) return deny(response);
        domain.authorizeRecordAction(trusted, {
          action: 'record.history.read', requestedTenantId: route.tenantId,
        }, record);
        const history = store.readHistory(route.tenantId, route.recordId, 50).map((event) => {
          const changedFields = event.eventKind === 'reassignment'
            ? {
              assignees: {
                prior: event.changedFields.assignees.prior.map((subjectId) => ({
                  subjectId, availability: 'unavailable',
                })),
                next: event.changedFields.assignees.next.map((subjectId) => ({
                  subjectId, availability: 'unavailable',
                })),
              },
            }
            : event.changedFields;
          return {
            auditId: event.auditId,
            tenantId: event.tenantId,
            recordId: event.recordId,
            eventKind: event.eventKind ?? (event.priorRevision === 0 ? 'creation' : 'material_change'),
            actorSubjectId: event.actorSubjectId,
            authorizationId: event.authorizationId,
            policyRevision: event.policyRevision,
            source: { sourceId: event.sourceId, availability: 'unavailable' },
            reasonRef: event.reasonRef ?? null,
            priorRevision: event.priorRevision,
            newRevision: event.newRevision,
            occurredAt: event.occurredAt ?? event.recordedAt,
            recordedAt: event.recordedAt,
            changedFields,
          };
        });
        return sendJson(response, 200, { history });
      }
      if (request.method === 'GET' && route.recordId !== null) {
        if (route.action !== null) return deny(response);
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
