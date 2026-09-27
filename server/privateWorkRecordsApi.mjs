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

function hasExactKeys(value, keys) {
  return isObject(value) && Object.keys(value).sort().join(',') === [...keys].sort().join(',');
}

function isCanonicalTimestamp(value) {
  if (typeof value !== 'string') return false;
  const timestamp = new Date(value);
  return Number.isFinite(timestamp.getTime()) && timestamp.toISOString() === value;
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) =>
      `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function projectRecordEvidence(_store, record) {
  return {
    ...record,
    evidence: record.evidence.map((evidence) => {
      const { locator: _locator, ...citation } = evidence;
      return citation;
    }),
  };
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
  const match = /^\/api\/private\/tenants\/([^/]+)\/records(?:\/([^/]+)(?:\/(rename|reassignment|block|unblock|archive|tombstone|restore|correction|history|trace|evidence)(?:\/([^/]+))?)?)?$/.exec(rawUrl ?? '/');
  if (match === null) return null;
  const route = {
    tenantId: match[1], recordId: match[2] ?? null,
    action: match[3] ?? null, childId: match[4] ?? null,
  };
  if ((route.action === 'evidence') !== (route.childId !== null)) return null;
  return route;
}

export function createPrivateWorkRecordsApiHandler({
  store,
  domain,
  resolveTrustedIdentity,
  resolveTrustedReferences,
  resolveTracePolicy = async () => false,
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
      if (request.method === 'GET' && route.recordId !== null && route.action === 'evidence') {
        if (!trusted.permissions.includes('record.evidence.resolve')) return deny(response);
        const record = store.read(route.tenantId, route.recordId);
        const trace = store.readTrace(route.tenantId, route.recordId);
        const evidence = trace?.evidence.find((candidate) => candidate.evidenceId === route.childId);
        if (record === null || trace === null || evidence === undefined) return deny(response);
        domain.authorizeRecordAction(trusted, {
          action: 'record.evidence.resolve', requestedTenantId: route.tenantId,
        }, record);
        const allowed = await resolveTracePolicy({
          tenantId: route.tenantId, principalId: trusted.actorSubjectId,
          policyRevision: trusted.policyRevision, action: 'read', link: 'evidence', value: evidence,
          recordSensitivity: record.sensitivity, authorizationScope: record.recordId,
          evidenceSensitivity: evidence.sensitivity,
          locatorClass: evidence.locator.startsWith('https:')
            ? 'https_repository_artifact' : 'internal_object',
          availability: evidence.availability, relation: evidence.relation,
        }) === true;
        if (!allowed) return deny(response);
        const inspectable = ['available', 'stale'].includes(evidence.availability);
        if (inspectable) {
          return sendJson(response, 200, {
            state: evidence.availability, inspectable: true,
            decision: { allowed: true, code: 'allowed' }, evidence,
          });
        }
        const { locator: _locator, ...citation } = evidence;
        return sendJson(response, 200, {
          state: evidence.availability, inspectable: false,
          decision: { allowed: true, code: 'allowed' }, evidence: citation,
        });
      }
      if (request.method === 'PATCH' && route.recordId !== null && route.action === 'evidence') {
        if (!trusted.permissions.includes('record.evidence.availability.update')) return deny(response);
        if (request.headers['content-type']?.split(';', 1)[0].trim().toLowerCase() !== 'application/json') {
          return deny(response);
        }
        const body = await readJsonBody(request);
        if (!hasExactKeys(body, ['availability', 'expectedRevision', 'requestId'])
          || !['unavailable', 'withdrawn'].includes(body.availability)
          || !Number.isSafeInteger(body.expectedRevision)
          || typeof body.requestId !== 'string' || !REQUEST_ID.test(body.requestId)) return deny(response);
        const current = store.read(route.tenantId, route.recordId);
        const trace = store.readTrace(route.tenantId, route.recordId);
        if (current === null || trace === null) return deny(response);
        domain.authorizeRecordAction(trusted, {
          action: 'record.evidence.availability.update', requestedTenantId: route.tenantId,
        }, current);
        const requestIdentity = {
          tenantId: route.tenantId, principalId: trusted.actorSubjectId,
          authorizationId: trusted.authorizationId, policyRevision: trusted.policyRevision,
          operation: 'evidence_availability', requestId: body.requestId,
          requestSemantics: canonicalJson({
            recordId: route.recordId, evidenceId: route.childId,
            availability: body.availability, expectedRevision: body.expectedRevision,
          }),
        };
        const replay = store.replayMutation(requestIdentity);
        if (replay !== null && !replay.ok) {
          return sendJson(response, 409, { error: 'conflict' });
        }
        const evidenceIndex = trace.evidence.findIndex(
          (candidate) => candidate.evidenceId === route.childId,
        );
        if (evidenceIndex < 0) return deny(response);
        const evidence = trace.evidence[evidenceIndex];
        if (await resolveTracePolicy({
          tenantId: route.tenantId, principalId: trusted.actorSubjectId,
          policyRevision: trusted.policyRevision, action: 'write', link: 'evidence', value: evidence,
          recordSensitivity: current.sensitivity, authorizationScope: current.recordId,
          evidenceSensitivity: evidence.sensitivity,
          locatorClass: evidence.locator.startsWith('https:')
            ? 'https_repository_artifact' : 'internal_object',
          availability: evidence.availability, relation: evidence.relation,
        }) !== true) return deny(response);
        if (replay?.ok) {
          return sendJson(response, 200, {
            record: projectRecordEvidence(store, replay.record),
          });
        }
        if (body.expectedRevision !== current.revision) {
          return sendJson(response, 409, { error: 'conflict' });
        }
        if (evidence.availability === body.availability
          || ['withdrawn', 'deleted_tombstone'].includes(evidence.availability)) {
          return deny(response);
        }
        const timestamp = now();
        if (!Number.isFinite(timestamp)) return deny(response);
        const recordedAt = new Date(timestamp).toISOString();
        if (recordedAt < current.updatedAt) return deny(response);
        const nextEvidence = { ...evidence, availability: body.availability };
        const nextTrace = {
          ...trace,
          evidence: trace.evidence.map((candidate, index) =>
            index === evidenceIndex ? nextEvidence : candidate),
        };
        const nextRecord = domain.validateWorkRecord({
          ...current, revision: current.revision + 1, updatedAt: recordedAt,
        });
        const audit = {
          auditId: generateId('audit'), tenantId: route.tenantId, recordId: route.recordId,
          eventKind: 'evidence_detach', actorSubjectId: trusted.actorSubjectId,
          authorizationId: trusted.authorizationId, policyRevision: trusted.policyRevision,
          sourceId: current.source.sourceId, reasonRef: null,
          priorRevision: current.revision, newRevision: nextRecord.revision,
          occurredAt: recordedAt, recordedAt,
          changedFields: {
            evidenceAvailability: {
              evidenceId: evidence.evidenceId,
              prior: evidence.availability,
              next: body.availability,
            },
          },
        };
        if (!REQUEST_ID.test(audit.auditId)) return deny(response);
        const result = store.mutateEvidence(
          nextRecord, audit, nextTrace, body.expectedRevision, requestIdentity,
        );
        if (!result.ok) return sendJson(response, 409, { error: 'conflict' });
        return sendJson(response, 200, {
          record: projectRecordEvidence(store, result.record),
        });
      }
      if (request.method === 'POST' && route.recordId !== null && route.action === 'trace') {
        if (!trusted.permissions.includes('record.trace.write')) return deny(response);
        if (request.headers['content-type']?.split(';', 1)[0].trim().toLowerCase() !== 'application/json') {
          return deny(response);
        }
        const current = store.read(route.tenantId, route.recordId);
        if (current === null) return deny(response);
        domain.authorizeRecordAction(trusted, {
          action: 'record.trace.write', requestedTenantId: route.tenantId,
        }, current);
        const body = await readJsonBody(request);
        if (!hasExactKeys(body, ['expectedRevision', 'requestId', 'trace'])
          || !Number.isSafeInteger(body.expectedRevision)
          || typeof body.requestId !== 'string' || !REQUEST_ID.test(body.requestId)) return deny(response);
        const requestIdentity = {
          tenantId: route.tenantId, principalId: trusted.actorSubjectId,
          authorizationId: trusted.authorizationId, policyRevision: trusted.policyRevision,
          operation: 'trace', requestId: body.requestId,
          requestSemantics: canonicalJson({
            recordId: route.recordId, expectedRevision: body.expectedRevision, trace: body.trace,
          }),
        };
        const replay = store.replayMutation(requestIdentity);
        if (replay !== null && !replay.ok) {
          return sendJson(response, 409, { error: 'conflict' });
        }
        if (!replay?.ok && ['completed', 'archived', 'deleted'].includes(current.lifecycle)) {
          return deny(response);
        }
        if (!replay?.ok && body.expectedRevision !== current.revision) {
          return sendJson(response, 409, { error: 'conflict' });
        }
        const validation = domain.validateTraceBundle(body.trace);
        if (!validation.ok) return deny(response);
        const trace = validation.value;
        if (trace.tenantId !== route.tenantId || trace.recordId !== route.recordId
          || trace.assignment.acceptedRevision !== body.expectedRevision
          || trace.assignment.owner.subjectId !== current.owner.subjectId
          || trace.direction.directingSubject.subjectId !== current.owner.subjectId
          || trace.authorization.authorizer.subjectId !== trusted.actorSubjectId
          || !trace.assignment.assignees.some(({ subjectId }) =>
            subjectId === trace.authorization.beneficiary.subjectId)
          || trace.activities.some(({ actor }) =>
            !trace.assignment.assignees.some(({ subjectId }) => subjectId === actor.subjectId))
          || trace.outcome.acceptanceActor.subjectId !== trusted.actorSubjectId
          || trace.authorization.authorizationId !== trusted.authorizationId
          || String(trace.authorization.policyRevision) !== trusted.policyRevision) return deny(response);
        const links = [
          ['direction', trace.direction],
          ['authorization', trace.authorization],
          ['assignment', trace.assignment],
          ...trace.activities.map((activity) => ['activity', activity]),
          ...trace.evidence.map((evidence) => ['evidence', evidence]),
          ['outcome', trace.outcome],
        ];
        for (const [link, value] of links) {
          const evidenceScope = link === 'evidence' ? {
            evidenceSensitivity: value.sensitivity,
            locatorClass: value.locator.startsWith('https:')
              ? 'https_repository_artifact' : 'internal_object',
            availability: value.availability,
            relation: value.relation,
          } : {};
          if (await resolveTracePolicy({
            tenantId: route.tenantId, principalId: trusted.actorSubjectId,
            policyRevision: trusted.policyRevision, action: 'write', link, value,
            recordSensitivity: current.sensitivity, authorizationScope: current.recordId,
            ...evidenceScope,
          }) !== true) return deny(response);
        }
        if (replay?.ok) {
          return sendJson(response, 200, {
            record: projectRecordEvidence(store, replay.record),
          });
        }
        const timestamp = now();
        if (!Number.isFinite(timestamp)) return deny(response);
        const recordedAt = new Date(timestamp).toISOString();
        if (trace.outcome.acceptedAt < current.updatedAt || trace.outcome.acceptedAt > recordedAt) {
          return deny(response);
        }
        const record = domain.validateWorkRecord({
          ...current,
          assignees: trace.assignment.assignees,
          evidence: trace.evidence.map((evidence) => ({
            tenantId: evidence.tenantId, evidenceId: evidence.evidenceId,
            locator: evidence.locator, recordedAt: evidence.recordedAt,
          })),
          lifecycle: 'completed', stateChangedAt: trace.outcome.acceptedAt,
          revision: current.revision + 1, updatedAt: recordedAt,
        });
        const audit = {
          auditId: generateId('audit'), tenantId: route.tenantId, recordId: route.recordId,
          eventKind: 'outcome_acceptance', actorSubjectId: trusted.actorSubjectId,
          authorizationId: trusted.authorizationId, policyRevision: trusted.policyRevision,
          sourceId: current.source.sourceId, reasonRef: trace.direction.directionId,
          priorRevision: current.revision, newRevision: record.revision,
          occurredAt: trace.outcome.acceptedAt, recordedAt,
          changedFields: {
            assignees: { prior: current.assignees, next: record.assignees },
            evidence: {
              prior: current.evidence.map(({ evidenceId }) => evidenceId),
              next: record.evidence.map(({ evidenceId }) => evidenceId),
            },
            lifecycle: { prior: current.lifecycle, next: 'completed' },
          },
        };
        if (!REQUEST_ID.test(audit.auditId)) return deny(response);
        const result = store.completeTrace(
          record, audit, trace, body.expectedRevision, requestIdentity,
        );
        if (!result.ok) return sendJson(response, 409, { error: 'conflict' });
        return sendJson(response, result.replayed ? 200 : 201, {
          record: projectRecordEvidence(store, result.record),
        });
      }
      if (request.method === 'GET' && route.recordId !== null && route.action === 'trace') {
        if (!trusted.permissions.includes('record.trace.read')) return deny(response);
        const record = store.read(route.tenantId, route.recordId);
        const trace = store.readTrace(route.tenantId, route.recordId);
        if (record === null || trace === null) return deny(response);
        domain.authorizeRecordAction(trusted, {
          action: 'record.trace.read', requestedTenantId: route.tenantId,
        }, record);
        const edges = [];
        for (const [link, value] of [
          ['direction', trace.direction],
          ['authorization', trace.authorization],
          ['assignment', trace.assignment],
          ...trace.activities.map((activity) => ['activity', activity]),
          ...trace.evidence.map((evidence) => ['evidence', evidence]),
          ['outcome', trace.outcome],
        ]) {
          const evidenceScope = link === 'evidence' ? {
            evidenceSensitivity: value.sensitivity,
            locatorClass: value.locator.startsWith('https:')
              ? 'https_repository_artifact' : 'internal_object',
            availability: value.availability,
            relation: value.relation,
          } : {};
          const allowed = await resolveTracePolicy({
            tenantId: route.tenantId, principalId: trusted.actorSubjectId,
            policyRevision: trusted.policyRevision, action: 'read', link, value,
            recordSensitivity: record.sensitivity, authorizationScope: record.recordId,
            ...evidenceScope,
          }) === true;
          if (!allowed) {
            edges.push({
              link, state: 'not_authorized',
              decision: { allowed: false, code: 'not_authorized' },
            });
            continue;
          }
          const state = link === 'evidence' ? value.availability : 'available';
          let projected = value;
          if (link === 'evidence' && !['available', 'stale'].includes(value.availability)) {
            const { locator: _locator, ...citation } = value;
            projected = citation;
          }
          edges.push({
            link, state, decision: { allowed: true, code: 'allowed' }, value: projected,
          });
        }
        return sendJson(response, 200, {
          trace: { tenantId: route.tenantId, recordId: route.recordId, edges },
        });
      }
      if (request.method === 'POST' && route.recordId !== null && route.action === 'correction') {
        if (!trusted.permissions.includes('record.correct')) return deny(response);
        if (request.headers['content-type']?.split(';', 1)[0].trim().toLowerCase() !== 'application/json') {
          return deny(response);
        }
        const body = await readJsonBody(request);
        if (!isObject(body)
          || Object.keys(body).sort().join(',') !== 'expectedRevision,occurredAt,reasonRef,record,requestId'
          || !Number.isSafeInteger(body.expectedRevision)
          || typeof body.requestId !== 'string' || !REQUEST_ID.test(body.requestId)
          || typeof body.reasonRef !== 'string' || body.reasonRef.trim() !== body.reasonRef
          || body.reasonRef.length < 1 || body.reasonRef.length > 240
          || typeof body.occurredAt !== 'string'
          || !isObject(body.record)
          || ['tenantId', 'recordId', 'createdAt', 'updatedAt', 'revision',
            'sensitivity', 'correctionOf'].some((key) => Object.hasOwn(body.record, key))
          || body.record.supersedes !== null) return deny(response);
        const original = store.read(route.tenantId, route.recordId);
        if (original === null) return deny(response);
        domain.authorizeRecordAction(trusted, {
          action: 'record.correct', requestedTenantId: route.tenantId,
        }, original);
        if (original.correctionOf !== null) return deny(response);
        const requestIdentity = {
          tenantId: route.tenantId, principalId: trusted.actorSubjectId,
          authorizationId: trusted.authorizationId, policyRevision: trusted.policyRevision,
          operation: 'correction', requestId: body.requestId,
          requestSemantics: canonicalJson({
            originalRecordId: route.recordId, expectedRevision: body.expectedRevision,
            occurredAt: body.occurredAt, reasonRef: body.reasonRef, record: body.record,
          }),
        };
        const replay = store.replayMutation(requestIdentity);
        if (replay !== null) {
          return replay.ok
            ? sendJson(response, 200, { record: replay.record })
            : sendJson(response, 409, { error: 'conflict' });
        }
        if (body.expectedRevision !== original.revision) {
          return sendJson(response, 409, { error: 'conflict' });
        }
        const timestamp = now();
        if (!Number.isFinite(timestamp)) return deny(response);
        const recordedAt = new Date(timestamp).toISOString();
        const occurred = new Date(body.occurredAt);
        if (!Number.isFinite(occurred.getTime()) || occurred.toISOString() !== body.occurredAt
          || body.occurredAt < original.updatedAt || body.occurredAt > recordedAt) return deny(response);
        const recordId = generateId('record');
        if (original.correctionOf?.recordId === recordId) return deny(response);
        const record = domain.createCorrectionRecord(trusted, original, domain.createWorkRecord({
          ...body.record,
          tenantId: route.tenantId, recordId,
          sensitivity: 'tenant_private',
          correctionOf: { tenantId: route.tenantId, recordId: route.recordId },
          revision: 1, createdAt: recordedAt, updatedAt: recordedAt,
        }));
        const referencesAllowed = await resolveTrustedReferences({
          tenantId: route.tenantId, principalId: trusted.actorSubjectId,
          authorizationId: trusted.authorizationId, policyRevision: trusted.policyRevision,
          originalRecordId: route.recordId, record,
        });
        if (referencesAllowed !== true) return deny(response);
        const audit = {
          auditId: generateId('audit'), tenantId: route.tenantId, recordId,
          eventKind: 'correction', actorSubjectId: trusted.actorSubjectId,
          authorizationId: trusted.authorizationId, policyRevision: trusted.policyRevision,
          sourceId: record.source.sourceId, reasonRef: body.reasonRef,
          priorRevision: 0, newRevision: 1,
          occurredAt: body.occurredAt, recordedAt,
          changedFields: {
            recordId: { prior: null, next: recordId },
            correctionOf: { prior: null, next: record.correctionOf },
          },
        };
        if (!REQUEST_ID.test(audit.auditId)) return deny(response);
        const result = store.createCorrection(
          record, audit, route.recordId, body.expectedRevision, requestIdentity,
        );
        if (!result.ok) return sendJson(response, 409, { error: 'conflict' });
        return sendJson(response, result.replayed ? 200 : 201, {
          record: result.replayed ? result.record : record,
        });
      }
      if (request.method === 'POST' && route.recordId !== null && route.action === 'restore') {
        if (!trusted.permissions.includes('record.restore')) return deny(response);
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
          action: 'record.restore', requestedTenantId: route.tenantId,
        }, current);
        const requestIdentity = {
          tenantId: route.tenantId, principalId: trusted.actorSubjectId,
          authorizationId: trusted.authorizationId, policyRevision: trusted.policyRevision,
          operation: 'restore', requestId: body.requestId,
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
        if (body.expectedRevision !== current.revision || current.lifecycle !== 'archived') {
          return sendJson(response, 409, { error: 'conflict' });
        }
        const archiveEvent = store.readLatestArchive(route.tenantId, route.recordId);
        const restoredLifecycle = archiveEvent?.changedFields?.lifecycle?.prior;
        if (!hasExactKeys(archiveEvent, [
          'auditId', 'tenantId', 'recordId', 'eventKind', 'actorSubjectId',
          'authorizationId', 'policyRevision', 'sourceId', 'reasonRef',
          'priorRevision', 'newRevision', 'occurredAt', 'recordedAt', 'changedFields',
        ])
          || !hasExactKeys(archiveEvent.changedFields, ['lifecycle', 'archivedAt'])
          || !hasExactKeys(archiveEvent.changedFields.lifecycle, ['prior', 'next'])
          || !hasExactKeys(archiveEvent.changedFields.archivedAt, ['prior', 'next'])
          || !['open', 'in_progress', 'completed'].includes(restoredLifecycle)
          || archiveEvent.tenantId !== route.tenantId || archiveEvent.recordId !== route.recordId
          || archiveEvent.eventKind !== 'archive'
          || !REQUEST_ID.test(archiveEvent.auditId)
          || !REQUEST_ID.test(archiveEvent.actorSubjectId)
          || !REQUEST_ID.test(archiveEvent.authorizationId)
          || !REQUEST_ID.test(archiveEvent.sourceId)
          || archiveEvent.sourceId !== current.source.sourceId
          || typeof archiveEvent.policyRevision !== 'string'
          || archiveEvent.policyRevision.length < 1 || archiveEvent.policyRevision.length > 120
          || typeof archiveEvent.reasonRef !== 'string'
          || archiveEvent.reasonRef.trim() !== archiveEvent.reasonRef
          || archiveEvent.reasonRef.length < 1 || archiveEvent.reasonRef.length > 240
          || archiveEvent.priorRevision !== current.revision - 1
          || archiveEvent.newRevision !== current.revision
          || archiveEvent.changedFields.lifecycle.next !== 'archived'
          || archiveEvent.changedFields.archivedAt.prior !== null
          || archiveEvent.changedFields.archivedAt.next !== current.archivedAt
          || !isCanonicalTimestamp(archiveEvent.occurredAt)
          || archiveEvent.occurredAt !== current.archivedAt
          || !isCanonicalTimestamp(archiveEvent.recordedAt)
          || archiveEvent.occurredAt > archiveEvent.recordedAt
          || archiveEvent.recordedAt > current.updatedAt) return deny(response);
        const timestamp = now();
        if (!Number.isFinite(timestamp)) return deny(response);
        const recordedAt = new Date(timestamp).toISOString();
        const occurred = new Date(body.occurredAt);
        if (!Number.isFinite(occurred.getTime()) || occurred.toISOString() !== body.occurredAt
          || body.occurredAt < current.archivedAt || body.occurredAt < current.updatedAt
          || body.occurredAt > recordedAt || recordedAt < current.updatedAt
          || recordedAt < current.source.recordedAt) return deny(response);
        const record = domain.validateWorkRecord({
          ...current,
          lifecycle: restoredLifecycle, archivedAt: null,
          stateChangedAt: body.occurredAt,
          revision: current.revision + 1, updatedAt: recordedAt,
        });
        const audit = {
          auditId: generateId('audit'), tenantId: route.tenantId, recordId: route.recordId,
          eventKind: 'restore', actorSubjectId: trusted.actorSubjectId,
          authorizationId: trusted.authorizationId, policyRevision: trusted.policyRevision,
          sourceId: current.source.sourceId, reasonRef: body.reasonRef,
          priorRevision: current.revision, newRevision: record.revision,
          occurredAt: body.occurredAt, recordedAt,
          changedFields: {
            lifecycle: { prior: 'archived', next: restoredLifecycle },
            archivedAt: { prior: current.archivedAt, next: null },
          },
        };
        const result = store.mutate(record, audit, body.expectedRevision, requestIdentity);
        if (!result.ok) return sendJson(response, 409, { error: 'conflict' });
        return sendJson(response, 200, { record: result.replayed ? result.record : record });
      }
      if (request.method === 'POST' && route.recordId !== null && route.action === 'tombstone') {
        if (!trusted.permissions.includes('record.delete')) return deny(response);
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
          action: 'record.delete', requestedTenantId: route.tenantId,
        }, current);
        const requestIdentity = {
          tenantId: route.tenantId, principalId: trusted.actorSubjectId,
          authorizationId: trusted.authorizationId, policyRevision: trusted.policyRevision,
          operation: 'tombstone', requestId: body.requestId,
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
        if (body.expectedRevision !== current.revision || current.lifecycle !== 'archived') {
          return sendJson(response, 409, { error: 'conflict' });
        }
        const timestamp = now();
        if (!Number.isFinite(timestamp)) return deny(response);
        const recordedAt = new Date(timestamp).toISOString();
        const occurred = new Date(body.occurredAt);
        if (!Number.isFinite(occurred.getTime()) || occurred.toISOString() !== body.occurredAt
          || body.occurredAt < current.archivedAt || body.occurredAt < current.updatedAt
          || body.occurredAt > recordedAt || recordedAt < current.source.recordedAt) {
          return deny(response);
        }
        const record = domain.validateWorkRecord({
          ...current,
          lifecycle: 'deleted', deletedAt: body.occurredAt,
          stateChangedAt: body.occurredAt,
          revision: current.revision + 1, updatedAt: recordedAt,
        });
        const audit = {
          auditId: generateId('audit'), tenantId: route.tenantId, recordId: route.recordId,
          eventKind: 'tombstone', actorSubjectId: trusted.actorSubjectId,
          authorizationId: trusted.authorizationId, policyRevision: trusted.policyRevision,
          sourceId: current.source.sourceId, reasonRef: body.reasonRef,
          priorRevision: current.revision, newRevision: record.revision,
          occurredAt: body.occurredAt, recordedAt,
          changedFields: {
            lifecycle: { prior: 'archived', next: 'deleted' },
            deletedAt: { prior: current.deletedAt, next: body.occurredAt },
          },
        };
        const result = store.mutate(record, audit, body.expectedRevision, requestIdentity);
        if (!result.ok) return sendJson(response, 409, { error: 'conflict' });
        return sendJson(response, 200, { record: result.replayed ? result.record : record });
      }
      if (request.method === 'POST' && route.recordId !== null && route.action === 'archive') {
        if (!trusted.permissions.includes('record.archive')) return deny(response);
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
          action: 'record.archive', requestedTenantId: route.tenantId,
        }, current);
        const requestIdentity = {
          tenantId: route.tenantId, principalId: trusted.actorSubjectId,
          authorizationId: trusted.authorizationId, policyRevision: trusted.policyRevision,
          operation: 'archive', requestId: body.requestId,
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
        if (body.expectedRevision !== current.revision
          || ['blocked', 'archived', 'deleted'].includes(current.lifecycle)) {
          return sendJson(response, 409, { error: 'conflict' });
        }
        const timestamp = now();
        if (!Number.isFinite(timestamp)) return deny(response);
        const recordedAt = new Date(timestamp).toISOString();
        const occurred = new Date(body.occurredAt);
        if (!Number.isFinite(occurred.getTime()) || occurred.toISOString() !== body.occurredAt
          || body.occurredAt < current.updatedAt || body.occurredAt > recordedAt
          || recordedAt < current.source.recordedAt) return deny(response);
        const record = domain.validateWorkRecord({
          ...current,
          lifecycle: 'archived', archivedAt: body.occurredAt,
          stateChangedAt: body.occurredAt,
          revision: current.revision + 1, updatedAt: recordedAt,
        });
        const audit = {
          auditId: generateId('audit'), tenantId: route.tenantId, recordId: route.recordId,
          eventKind: 'archive', actorSubjectId: trusted.actorSubjectId,
          authorizationId: trusted.authorizationId, policyRevision: trusted.policyRevision,
          sourceId: current.source.sourceId, reasonRef: body.reasonRef,
          priorRevision: current.revision, newRevision: record.revision,
          occurredAt: body.occurredAt, recordedAt,
          changedFields: {
            lifecycle: { prior: current.lifecycle, next: 'archived' },
            archivedAt: { prior: current.archivedAt, next: body.occurredAt },
          },
        };
        const result = store.mutate(record, audit, body.expectedRevision, requestIdentity);
        if (!result.ok) return sendJson(response, 409, { error: 'conflict' });
        return sendJson(response, 200, { record: result.replayed ? result.record : record });
      }
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
        if (['archived', 'deleted'].includes(current.lifecycle)
          && body.expectedRevision === current.revision) {
          return sendJson(response, 409, { error: 'conflict' });
        }
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
        if (['archived', 'deleted'].includes(current.lifecycle)
          && body.expectedRevision === current.revision) {
          return sendJson(response, 409, { error: 'conflict' });
        }
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
        return sendJson(response, 200, {
          record: projectRecordEvidence(store, record),
        });
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
        return sendJson(response, 200, {
          records: records.map((record) => projectRecordEvidence(store, record)),
          count: records.length,
          cursor: null,
        });
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
