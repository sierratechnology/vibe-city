import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import http from 'node:http';
import net from 'node:net';
import { Readable } from 'node:stream';
import test from 'node:test';

const MODULE_PATH = '../server/tenantSkyscraperNavigationHttpAdapter.mjs';
const ROUTE = '/api/private/skyscraper-navigation/decision';
const CREDENTIAL = 'session_0000000000000001';
const BUILDING = 'id_0000000000000001';
const FLOOR = 'id_0000000000000002';
const STOP = 'id_0000000000000003';
const DESTINATION = 'id_0000000000000020';
const TENANT = 'id_0000000000000010';
const SUBJECT = 'id_0000000000000030';
const SESSION = 'id_0000000000000031';
const AUTHORIZATION_REFERENCE = 'id_0000000000000032';

function navigation(channel = 'door') {
  return {
    schemaVersion: '1.0',
    channel,
    buildingId: BUILDING,
    floorId: FLOOR,
    elevatorStopId: STOP,
    destinationId: DESTINATION,
  };
}

function requestBody(channel = 'door') {
  return JSON.stringify({ schemaVersion: '1.0', navigation: navigation(channel) });
}

function validHeaders(body, authorization = `Bearer ${CREDENTIAL}`) {
  return {
    authorization,
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(body),
  };
}

function acceptedResult(channel = 'door') {
  const decision = Object.freeze(Object.assign(Object.create(null), {
    allowed: true,
    code: 'allowed',
    schemaVersion: '1.0',
    channel,
    buildingId: BUILDING,
    floorId: FLOOR,
    elevatorStopId: STOP,
    destinationId: DESTINATION,
    destinationKind: 'shared_space',
    accessState: 'public',
    subjectId: 'id_0000000000000030',
    tenantId: null,
    authorizationReference: 'id_0000000000000032',
    policyRevision: 7,
    evaluatedAt: '2000-01-01T00:30:00.000Z',
    validUntil: null,
  }));
  return Object.freeze(Object.assign(Object.create(null), { ok: true, decision }));
}

function trustedState() {
  const suites = [1, 2, 3, 4].map((number) => ({
    destinationId: `id_000000000000010${number}`,
    floorId: FLOOR,
    displayName: `Synthetic Suite ${number}`,
    lifecycle: 'active',
    destinationKind: 'suite',
    accessState: 'tenant',
    ownerTenantId: TENANT,
    sharedSpacePolicy: 'not_shared',
  }));
  return {
    catalog: {
      schemaVersion: '1.0',
      building: {
        buildingId: BUILDING,
        displayName: 'Synthetic Tower',
        lifecycle: 'active',
        floors: [{
          floorId: FLOOR,
          buildingId: BUILDING,
          displayName: 'Synthetic Floor',
          lifecycle: 'active',
          floorKind: 'customer',
          elevatorStopId: STOP,
          destinations: [...suites, {
            destinationId: DESTINATION,
            floorId: FLOOR,
            displayName: 'Synthetic Lobby',
            lifecycle: 'active',
            destinationKind: 'shared_space',
            accessState: 'public',
            ownerTenantId: null,
            sharedSpacePolicy: 'building_public',
          }],
        }],
      },
    },
    authorization: {
      kind: 'trusted-server-context',
      authenticatedSubjectId: SUBJECT,
      authenticatedSessionId: SESSION,
      ownerTenantLifecycles: [{ tenantId: TENANT, lifecycle: 'active' }],
      activeTenantMembership: { tenantId: TENANT, subjectId: SUBJECT, active: true },
      privateDestinationGrants: [],
      invitation: null,
      restrictedDestinationAuthorities: [],
      authorizationReference: AUTHORIZATION_REFERENCE,
      policyRevision: 7,
    },
    evaluatedAt: '2000-01-01T00:30:00.000Z',
  };
}

async function loadAdapter() {
  return import(MODULE_PATH).catch(() => ({}));
}

async function withServer(handler, action) {
  const server = http.createServer(handler);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  try {
    return await action(server.address().port);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => {
      if (error) reject(error);
      else resolve();
    }));
  }
}

function send(port, { method = 'POST', path = ROUTE, headers = {}, body = '' } = {}) {
  return new Promise((resolve, reject) => {
    const request = http.request({ host: '127.0.0.1', port, method, path, headers }, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => resolve({
        statusCode: response.statusCode,
        headers: response.headers,
        body: Buffer.concat(chunks).toString('utf8'),
      }));
    });
    request.once('error', reject);
    request.end(body);
  });
}

function sendRaw(port, headerLines, body) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: '127.0.0.1', port });
    const chunks = [];
    socket.once('error', reject);
    socket.on('data', (chunk) => chunks.push(chunk));
    socket.once('end', () => {
      const response = Buffer.concat(chunks).toString('utf8');
      resolve(Number(response.match(/^HTTP\/1\.1 (\d{3})/)?.[1]));
    });
    socket.once('connect', () => {
      socket.end([
        `POST ${ROUTE} HTTP/1.1`,
        `Host: 127.0.0.1:${port}`,
        `Authorization: Bearer ${CREDENTIAL}`,
        `Content-Length: ${Buffer.byteLength(body)}`,
        'Connection: close',
        ...headerLines,
        '',
        body,
      ].join('\r\n'));
    });
  });
}

async function invoke(handler, {
  method = 'POST', path = ROUTE, headers = {}, body = '',
} = {}) {
  const request = new EventEmitter();
  const rawHeaders = [];
  for (const [name, rawValue] of Object.entries(headers)) {
    const values = Array.isArray(rawValue) ? rawValue : [rawValue];
    for (const value of values) rawHeaders.push(name, value);
  }
  Object.assign(request, {
    method, url: path, headers, rawHeaders,
    aborted: false, complete: false, destroyed: false,
  });
  const response = {
    destroyed: false,
    writableEnded: false,
    headersSent: false,
    statusCode: null,
    headers: null,
    body: '',
    writeHead(statusCode, responseHeaders) {
      this.statusCode = statusCode;
      this.headers = responseHeaders;
      this.headersSent = true;
    },
    end(value) {
      this.body = Buffer.from(value).toString('utf8');
      this.writableEnded = true;
    },
    destroy() { this.destroyed = true; },
  };
  const pending = handler(request, response);
  const chunk = Buffer.isBuffer(body) ? body : Buffer.from(body);
  if (chunk.length > 0) request.emit('data', chunk);
  request.complete = true;
  request.emit('end');
  await pending;
  return response;
}

test('H1 unauthenticated private POST returns generic denial without API dispatch', async () => {
  const adapter = await loadAdapter();
  assert.equal(typeof adapter.createTenantSkyscraperNavigationHttpAdapter, 'function');
  let apiCalls = 0;
  const handler = adapter.createTenantSkyscraperNavigationHttpAdapter(async () => {
    apiCalls += 1;
    throw new Error('must not dispatch');
  });

  const response = await invoke(handler, {
    headers: { 'content-type': 'application/json' },
    body: '{}',
  });

  assert.equal(response.statusCode, 404);
  assert.equal(response.body, '{"ok":false,"code":"not_found"}');
  assert.equal(response.headers['content-type'], 'application/json; charset=utf-8');
  assert.equal(response.headers['cache-control'], 'private, no-store');
  assert.equal(response.headers['x-content-type-options'], 'nosniff');
  assert.equal(response.headers.vary, 'Authorization');
  assert.equal(Number(response.headers['content-length']), Buffer.byteLength(response.body));
  assert.equal(apiCalls, 0);
});

test('H2 valid private POST delegates one detached envelope and returns canonical success', async () => {
  const adapter = await loadAdapter();
  const api = await import('../server/tenantSkyscraperNavigationApi.mjs');
  const acceptedApiHandler = api.createTenantSkyscraperNavigationApiHandler({
    authenticate: async () => ({ authenticated: true, sessionId: SESSION, subjectId: SUBJECT }),
    resolveTrustedNavigationState: async () => trustedState(),
  });
  let apiCalls = 0;
  let received;
  const handler = adapter.createTenantSkyscraperNavigationHttpAdapter(async (envelope) => {
    apiCalls += 1;
    received = envelope;
    return acceptedApiHandler(envelope);
  });
  const body = requestBody();

  const response = await withServer(handler, (port) => send(port, {
    headers: {
      authorization: `Bearer ${CREDENTIAL}`,
      'content-type': 'application/json',
      'content-length': Buffer.byteLength(body),
    },
    body,
  }));

  assert.equal(apiCalls, 1);
  assert.equal(Object.getPrototypeOf(received), null);
  assert.equal(Object.getPrototypeOf(received.navigation), null);
  assert.equal(Object.isFrozen(received), true);
  assert.equal(Object.isFrozen(received.navigation), true);
  assert.deepEqual({ ...received, navigation: { ...received.navigation } }, {
    schemaVersion: '1.0',
    sessionCredential: CREDENTIAL,
    navigation: navigation(),
  });
  assert.equal(response.statusCode, 200);
  assert.equal(response.body, JSON.stringify({ ok: true, decision: { ...acceptedResult().decision } }));
  assert.equal(Number(response.headers['content-length']), Buffer.byteLength(response.body));
});

test('H3 all four channels preserve identical accepted API meaning', async () => {
  const adapter = await loadAdapter();
  let apiCalls = 0;
  const handler = adapter.createTenantSkyscraperNavigationHttpAdapter(async (envelope) => {
    apiCalls += 1;
    return acceptedResult(envelope.navigation.channel);
  });

  const responses = [];
  for (const channel of ['door', 'elevator', 'direct', 'alternative']) {
    const body = requestBody(channel);
    responses.push(await invoke(handler, { headers: validHeaders(body), body }));
  }

  assert.equal(apiCalls, 4);
  const decisions = responses.map((response) => {
    assert.equal(response.statusCode, 200);
    const parsed = JSON.parse(response.body);
    return { ...parsed.decision, channel: 'same' };
  });
  assert.deepEqual(decisions[1], decisions[0]);
  assert.deepEqual(decisions[2], decisions[0]);
  assert.deepEqual(decisions[3], decisions[0]);
});

test('H4 duplicate JSON keys at any depth deny before API dispatch', async () => {
  const adapter = await loadAdapter();
  let apiCalls = 0;
  const handler = adapter.createTenantSkyscraperNavigationHttpAdapter(async () => {
    apiCalls += 1;
    return acceptedResult();
  });
  const body = requestBody().replace(
    `"destinationId":"${DESTINATION}"`,
    `"destinationId":"${DESTINATION}","\\u0064estinationId":"${DESTINATION}"`,
  );

  const response = await invoke(handler, {
    headers: {
      authorization: `Bearer ${CREDENTIAL}`,
      'content-type': 'application/json',
      'content-length': Buffer.byteLength(body),
    },
    body,
  });

  assert.equal(response.statusCode, 404);
  assert.equal(response.body, '{"ok":false,"code":"not_found"}');
  assert.equal(apiCalls, 0);
});

test('H5 non-exact routes, authentication, media, and bodies deny before API dispatch', async () => {
  const adapter = await loadAdapter();
  let apiCalls = 0;
  const handler = adapter.createTenantSkyscraperNavigationHttpAdapter(async () => {
    apiCalls += 1;
    return acceptedResult();
  });
  const validBody = requestBody();
  const extra = JSON.stringify({
    schemaVersion: '1.0', navigation: navigation(), tenantId: 'id_0000000000000010',
  });
  const oversized = ' '.repeat(8193);
  const attacks = [
    { method: 'GET', headers: validHeaders(validBody), body: validBody },
    { path: `${ROUTE}?sessionCredential=${CREDENTIAL}`, headers: validHeaders(validBody), body: validBody },
    { path: '/api/private/skyscraper-navigation%2Fdecision', headers: validHeaders(validBody), body: validBody },
    { headers: { ...validHeaders(validBody), 'content-type': 'application/json; charset=utf-8' }, body: validBody },
    { headers: validHeaders(validBody, `bearer ${CREDENTIAL}`), body: validBody },
    { headers: validHeaders(validBody, `Bearer  ${CREDENTIAL}`), body: validBody },
    { headers: { ...validHeaders(validBody), authorization: [`Bearer ${CREDENTIAL}`, `Bearer ${CREDENTIAL}`] }, body: validBody },
    { headers: validHeaders(''), body: '' },
    { headers: validHeaders('{'), body: '{' },
    { headers: validHeaders('[]'), body: '[]' },
    { headers: validHeaders(extra), body: extra },
    { headers: validHeaders(oversized), body: oversized },
  ];

  const responses = [];
  for (const attack of attacks) responses.push(await invoke(handler, attack));

  for (const response of responses) {
    assert.equal(response.statusCode, 404);
    assert.equal(response.body, '{"ok":false,"code":"not_found"}');
  }
  assert.equal(apiCalls, 0);
});

test('H6 API denial, failure, and hostile results produce one generic response per call', async () => {
  const adapter = await loadAdapter();
  let accessorCalls = 0;
  const accessor = Object.create(null);
  Object.defineProperty(accessor, 'ok', {
    enumerable: true,
    get() { accessorCalls += 1; return true; },
  });
  Object.defineProperty(accessor, 'decision', {
    enumerable: true,
    value: acceptedResult().decision,
  });
  Object.freeze(accessor);
  const extra = acceptedResult();
  const extraDecision = Object.freeze(Object.assign(Object.create(null), {
    ...extra.decision,
    privateSource: 'must-not-leak',
  }));
  const outcomes = [
    Object.freeze(Object.assign(Object.create(null), { ok: false, code: 'not_found' })),
    new Error('credential detail'),
    Promise.reject(new Error('private source detail')),
    { ok: true, decision: { ...acceptedResult().decision } },
    Object.freeze(Object.assign(Object.create(null), { ok: true, decision: extraDecision })),
    accessor,
    new Proxy(acceptedResult(), {}),
  ];
  outcomes[2].catch(() => {});
  let apiCalls = 0;
  const handler = adapter.createTenantSkyscraperNavigationHttpAdapter(async () => {
    const outcome = outcomes[apiCalls];
    apiCalls += 1;
    if (outcome instanceof Error) throw outcome;
    return outcome;
  });
  const body = requestBody();

  const responses = [];
  for (let index = 0; index < outcomes.length; index += 1) {
    responses.push(await invoke(handler, { headers: validHeaders(body), body }));
  }

  assert.equal(apiCalls, outcomes.length);
  assert.equal(accessorCalls, 0);
  for (const response of responses) {
    assert.equal(response.statusCode, 404);
    assert.equal(response.body, '{"ok":false,"code":"not_found"}');
    assert.equal(response.body.includes('private'), false);
    assert.equal(response.body.includes('credential'), false);
  }
});

test('H7 body validation does not resolve the replaceable ambient Buffer predicate', async () => {
  const adapter = await loadAdapter();
  const handler = adapter.createTenantSkyscraperNavigationHttpAdapter(async () => acceptedResult());
  const body = Buffer.from(requestBody());
  const request = new EventEmitter();
  Object.assign(request, {
    method: 'POST',
    url: ROUTE,
    headers: {
      authorization: `Bearer ${CREDENTIAL}`,
      'content-type': 'application/json',
    },
    rawHeaders: ['Authorization', `Bearer ${CREDENTIAL}`, 'Content-Type', 'application/json'],
    aborted: false,
    complete: true,
    destroyed: false,
  });
  const response = {
    destroyed: false,
    writableEnded: false,
    headersSent: false,
    statusCode: null,
    headers: null,
    body: null,
    writeHead(statusCode, headers) {
      this.statusCode = statusCode;
      this.headers = headers;
      this.headersSent = true;
    },
    end(value) {
      this.body = Buffer.from(value).toString('utf8');
      this.writableEnded = true;
    },
    destroy() { this.destroyed = true; },
  };
  const original = Buffer.isBuffer;
  let ambientCalls = 0;
  let pending;
  try {
    Buffer.isBuffer = (...args) => {
      ambientCalls += 1;
      return original(...args);
    };
    pending = handler(request, response);
    request.emit('data', body);
    request.emit('end');
    await pending;
  } finally {
    Buffer.isBuffer = original;
  }

  assert.equal(ambientCalls, 0);
  assert.equal(response.statusCode, 200);
  assert.equal(response.writableEnded, true);
});

test('H8 body event overflow and late abort/error races dispatch zero times and respond once', async () => {
  const adapter = await loadAdapter();
  let apiCalls = 0;
  const handler = adapter.createTenantSkyscraperNavigationHttpAdapter(async () => {
    apiCalls += 1;
    return acceptedResult();
  });
  const request = new EventEmitter();
  Object.assign(request, {
    method: 'POST', url: ROUTE,
    headers: { authorization: `Bearer ${CREDENTIAL}`, 'content-type': 'application/json' },
    rawHeaders: ['Authorization', `Bearer ${CREDENTIAL}`, 'Content-Type', 'application/json'],
    aborted: false, complete: false, destroyed: false,
  });
  const writes = [];
  const response = {
    destroyed: false,
    writableEnded: false,
    headersSent: false,
    writeHead(statusCode, headers) {
      writes.push(['head', statusCode, headers]);
      this.headersSent = true;
    },
    end(body) {
      writes.push(['end', Buffer.from(body).toString('utf8')]);
      this.writableEnded = true;
    },
    destroy() { writes.push(['destroy']); this.destroyed = true; },
  };

  const pending = handler(request, response);
  for (let index = 0; index < 1025; index += 1) request.emit('data', Buffer.alloc(0));
  request.emit('aborted');
  request.emit('error', new Error('late private detail'));
  request.emit('end');
  await pending;

  assert.equal(apiCalls, 0);
  assert.equal(writes.filter(([kind]) => kind === 'head').length, 1);
  assert.equal(writes.filter(([kind]) => kind === 'end').length, 1);
  assert.equal(writes.filter(([kind]) => kind === 'destroy').length, 0);
  assert.equal(writes[0][1], 404);
  assert.equal(writes[1][1], '{"ok":false,"code":"not_found"}');
});

test('H9 hostile Authorization accessors deny without execution or API dispatch', async () => {
  const adapter = await loadAdapter();
  let apiCalls = 0;
  let accessorCalls = 0;
  const handler = adapter.createTenantSkyscraperNavigationHttpAdapter(async () => {
    apiCalls += 1;
    return acceptedResult();
  });
  const headers = Object.create(null);
  Object.defineProperty(headers, 'authorization', {
    enumerable: true,
    get() { accessorCalls += 1; return `Bearer ${CREDENTIAL}`; },
  });
  headers['content-type'] = 'application/json';
  const request = new EventEmitter();
  Object.assign(request, {
    method: 'POST', url: ROUTE, headers,
    rawHeaders: ['Authorization', `Bearer ${CREDENTIAL}`, 'Content-Type', 'application/json'],
    aborted: false, complete: true, destroyed: false,
  });
  const writes = [];
  const response = {
    destroyed: false, writableEnded: false, headersSent: false,
    writeHead(statusCode) { writes.push(statusCode); this.headersSent = true; },
    end() { writes.push('end'); this.writableEnded = true; },
    destroy() { writes.push('destroy'); this.destroyed = true; },
  };

  const pending = handler(request, response);
  request.emit('end');
  await pending;

  assert.equal(accessorCalls, 0);
  assert.equal(apiCalls, 0);
  assert.deepEqual(writes, [404, 'end']);
});

test('H10 malformed UTF-8, trailing data, and client authority deny before API dispatch', async () => {
  const adapter = await loadAdapter();
  let apiCalls = 0;
  const handler = adapter.createTenantSkyscraperNavigationHttpAdapter(async () => {
    apiCalls += 1;
    return acceptedResult();
  });
  const malformedUtf8 = Buffer.from([0x7b, 0x22, 0x78, 0x22, 0x3a, 0x22, 0xc3, 0x28, 0x22, 0x7d]);
  const trailing = `${requestBody()} private-detail`;
  const authority = JSON.stringify({
    schemaVersion: '1.0',
    sessionCredential: CREDENTIAL,
    navigation: { ...navigation(), policyRevision: 999 },
  });
  const attacks = [malformedUtf8, trailing, authority];

  const responses = [];
  for (const body of attacks) {
    responses.push(await invoke(handler, { headers: validHeaders(body), body }));
  }

  assert.equal(apiCalls, 0);
  for (const response of responses) {
    assert.equal(response.statusCode, 404);
    assert.equal(response.body, '{"ok":false,"code":"not_found"}');
  }
});

test('H11 factory accepts exactly one non-Proxy function and freezes the captured handler', async () => {
  const adapter = await loadAdapter();
  const injected = async () => acceptedResult();

  assert.throws(() => adapter.createTenantSkyscraperNavigationHttpAdapter(), TypeError);
  assert.throws(() => adapter.createTenantSkyscraperNavigationHttpAdapter(null), TypeError);
  assert.throws(() => adapter.createTenantSkyscraperNavigationHttpAdapter({}), TypeError);
  assert.throws(() => adapter.createTenantSkyscraperNavigationHttpAdapter(
    new Proxy(injected, {}),
  ), TypeError);
  assert.throws(() => adapter.createTenantSkyscraperNavigationHttpAdapter(
    injected, injected,
  ), TypeError);
  const handler = adapter.createTenantSkyscraperNavigationHttpAdapter(injected);
  assert.equal(typeof handler, 'function');
  assert.equal(Object.isFrozen(handler), true);
});

test('H12 internally inconsistent frozen success results fail closed', async () => {
  const adapter = await loadAdapter();
  let apiCalls = 0;
  const original = acceptedResult();
  const decision = Object.freeze(Object.assign(Object.create(null), {
    ...original.decision,
    tenantId: 'id_0000000000000010',
    validUntil: '2000-01-01T01:00:00.000Z',
  }));
  const hostile = Object.freeze(Object.assign(Object.create(null), { ok: true, decision }));
  const handler = adapter.createTenantSkyscraperNavigationHttpAdapter(async () => {
    apiCalls += 1;
    return hostile;
  });
  const body = requestBody();

  const response = await invoke(handler, { headers: validHeaders(body), body });

  assert.equal(apiCalls, 1);
  assert.equal(response.statusCode, 404);
  assert.equal(response.body, '{"ok":false,"code":"not_found"}');
});

test('H13 hostile Content-Type accessors deny without execution or API dispatch', async () => {
  const adapter = await loadAdapter();
  let apiCalls = 0;
  let accessorCalls = 0;
  const handler = adapter.createTenantSkyscraperNavigationHttpAdapter(async () => {
    apiCalls += 1;
    return acceptedResult();
  });
  const headers = Object.create(null);
  headers.authorization = `Bearer ${CREDENTIAL}`;
  Object.defineProperty(headers, 'content-type', {
    enumerable: true,
    get() { accessorCalls += 1; return 'application/json'; },
  });
  const request = new EventEmitter();
  Object.assign(request, {
    method: 'POST', url: ROUTE, headers,
    rawHeaders: ['Authorization', `Bearer ${CREDENTIAL}`, 'Content-Type', 'application/json'],
    aborted: false, complete: true, destroyed: false,
  });
  const writes = [];
  const response = {
    destroyed: false, writableEnded: false, headersSent: false,
    writeHead(statusCode) { writes.push(statusCode); this.headersSent = true; },
    end() { writes.push('end'); this.writableEnded = true; },
    destroy() { writes.push('destroy'); this.destroyed = true; },
  };

  const pending = handler(request, response);
  request.emit('end');
  await pending;

  assert.equal(accessorCalls, 0);
  assert.equal(apiCalls, 0);
  assert.deepEqual(writes, [404, 'end']);
});

test('H14 non-canonical or expired temporal results fail closed', async () => {
  const adapter = await loadAdapter();
  const original = acceptedResult();
  const temporalValues = [
    {
      accessState: 'invited',
      tenantId: TENANT,
      evaluatedAt: '2000-01-01T00:30:00.000Z',
      validUntil: '2000-01-01T00:29:59.999Z',
    },
    {
      accessState: 'invited',
      tenantId: TENANT,
      evaluatedAt: '2000-01-01T00:30:00.000Z',
      validUntil: '2000-01-01T00:30:00.000Z',
    },
    {
      accessState: 'public',
      tenantId: null,
      evaluatedAt: '2000-99-99T99:99:99.999Z',
      validUntil: null,
    },
  ];
  let apiCalls = 0;
  const handler = adapter.createTenantSkyscraperNavigationHttpAdapter(async () => {
    const temporal = temporalValues[apiCalls];
    apiCalls += 1;
    const decision = Object.freeze(Object.assign(Object.create(null), {
      ...original.decision,
      ...temporal,
    }));
    return Object.freeze(Object.assign(Object.create(null), { ok: true, decision }));
  });
  const body = requestBody();

  const responses = [];
  for (let index = 0; index < temporalValues.length; index += 1) {
    responses.push(await invoke(handler, { headers: validHeaders(body), body }));
  }

  assert.equal(apiCalls, temporalValues.length);
  assert.deepEqual(responses.map(({ statusCode }) => statusCode), [404, 404, 404]);
  for (const response of responses) {
    assert.equal(response.body, '{"ok":false,"code":"not_found"}');
  }
});

test('H15 duplicate or ambiguous raw Content-Type fields deny before API dispatch', async () => {
  const adapter = await loadAdapter();
  let apiCalls = 0;
  const handler = adapter.createTenantSkyscraperNavigationHttpAdapter(async () => {
    apiCalls += 1;
    return acceptedResult();
  });
  const body = requestBody();

  const statuses = await withServer(handler, async (port) => [
    await sendRaw(port, ['Content-Type: application/json', 'Content-Type: text/plain'], body),
    await sendRaw(port, ['Content-Type: text/plain', 'Content-Type: application/json'], body),
    await sendRaw(port, ['Content-Type: application/json, text/plain'], body),
  ]);

  assert.deepEqual(statuses, [404, 404, 404]);
  assert.equal(apiCalls, 0);
});

test('H16 request accessors and Proxies deny without executing hostile hooks', async () => {
  const adapter = await loadAdapter();
  let apiCalls = 0;
  const handler = adapter.createTenantSkyscraperNavigationHttpAdapter(async () => {
    apiCalls += 1;
    return acceptedResult();
  });
  const body = requestBody();
  const base = {
    method: 'POST',
    url: ROUTE,
    headers: { authorization: `Bearer ${CREDENTIAL}`, 'content-type': 'application/json' },
    rawHeaders: ['Authorization', `Bearer ${CREDENTIAL}`, 'Content-Type', 'application/json'],
    aborted: false,
    complete: false,
    destroyed: false,
  };
  const accessorValues = {
    method: 'GET',
    url: '/hostile',
    headers: null,
    rawHeaders: [],
    aborted: true,
    complete: false,
    destroyed: true,
  };
  const hookCalls = [];
  const responses = [];

  for (const property of Object.keys(accessorValues)) {
    let calls = 0;
    const request = new EventEmitter();
    Object.assign(request, base);
    if (property === 'complete') request.destroyed = true;
    Object.defineProperty(request, property, {
      configurable: true,
      enumerable: true,
      get() { calls += 1; return accessorValues[property]; },
    });
    const response = {
      destroyed: false, writableEnded: false, headersSent: false, statusCode: null,
      writeHead(statusCode) { this.statusCode = statusCode; this.headersSent = true; },
      end() { this.writableEnded = true; },
      destroy() { this.destroyed = true; },
    };
    const pending = handler(request, response);
    request.emit('data', Buffer.from(body));
    request.emit('end');
    await pending;
    hookCalls.push(calls);
    responses.push(response.statusCode);
  }

  let proxyTraps = 0;
  const proxyRequest = new Proxy(new EventEmitter(), {
    get() { proxyTraps += 1; return 'GET'; },
    getOwnPropertyDescriptor() { proxyTraps += 1; return undefined; },
  });
  const proxyResponse = {
    destroyed: false, writableEnded: false, headersSent: false, statusCode: null,
    writeHead(statusCode) { this.statusCode = statusCode; this.headersSent = true; },
    end() { this.writableEnded = true; },
    destroy() { this.destroyed = true; },
  };
  await handler(proxyRequest, proxyResponse);

  assert.deepEqual([...hookCalls, proxyTraps], [0, 0, 0, 0, 0, 0, 0, 0]);
  assert.deepEqual(responses, [404, 404, 404, 404, 404, 404, 404]);
  assert.equal(proxyResponse.statusCode, 404);
  assert.equal(apiCalls, 0);
});

test('H17 body listeners return to baseline after success and denial', async () => {
  const adapter = await loadAdapter();
  const handler = adapter.createTenantSkyscraperNavigationHttpAdapter(async () => acceptedResult());
  const listenerCounts = (request) => ['data', 'end', 'aborted', 'error']
    .map((eventName) => request.listenerCount(eventName));
  const run = async (body) => {
    const request = new EventEmitter();
    Object.assign(request, {
      method: 'POST',
      url: ROUTE,
      headers: { authorization: `Bearer ${CREDENTIAL}`, 'content-type': 'application/json' },
      rawHeaders: ['Authorization', `Bearer ${CREDENTIAL}`, 'Content-Type', 'application/json'],
      aborted: false,
      complete: false,
      destroyed: false,
    });
    const response = {
      destroyed: false, writableEnded: false, headersSent: false, statusCode: null,
      writeHead(statusCode) { this.statusCode = statusCode; this.headersSent = true; },
      end() { this.writableEnded = true; },
      destroy() { this.destroyed = true; },
    };
    const baseline = listenerCounts(request);
    const pending = handler(request, response);
    request.emit('data', Buffer.from(body));
    request.complete = true;
    request.emit('end');
    await pending;
    return { baseline, final: listenerCounts(request), statusCode: response.statusCode };
  };

  const success = await run(requestBody());
  const denial = await run('{');

  assert.deepEqual([success.final, denial.final], [success.baseline, denial.baseline]);
  assert.equal(success.statusCode, 200);
  assert.equal(denial.statusCode, 404);
});

test('H18 listener setup and cleanup reject hostile internals and callbacks transactionally', async () => {
  const adapter = await loadAdapter();
  let apiCalls = 0;
  const handler = adapter.createTenantSkyscraperNavigationHttpAdapter(async () => {
    apiCalls += 1;
    return acceptedResult();
  });
  const requestFields = {
    method: 'POST',
    url: ROUTE,
    headers: { authorization: `Bearer ${CREDENTIAL}`, 'content-type': 'application/json' },
    rawHeaders: ['Authorization', `Bearer ${CREDENTIAL}`, 'Content-Type', 'application/json'],
    aborted: false,
    complete: false,
    destroyed: false,
  };
  const makeResponse = () => ({
    destroyed: false, writableEnded: false, headersSent: false, statusCode: null,
    writeHead(statusCode) { this.statusCode = statusCode; this.headersSent = true; },
    end() { this.writableEnded = true; },
    destroy() { this.destroyed = true; },
  });
  const listenerCounts = (request) => ['data', 'end', 'aborted', 'error']
    .map((eventName) => request.listenerCount(eventName));

  const internalHookCalls = [];
  for (const [makeRequest, internalName] of [
    [() => new EventEmitter(), '_events'],
    [() => new Readable({ read() {} }), '_readableState'],
  ]) {
    const request = makeRequest();
    Object.assign(request, requestFields);
    let calls = 0;
    Object.defineProperty(request, internalName, {
      configurable: true,
      get() { calls += 1; throw new Error('hostile request internal'); },
    });
    const response = makeResponse();
    await handler(request, response);
    internalHookCalls.push(calls);
    assert.equal(response.statusCode, 404);
  }

  const partial = new EventEmitter();
  Object.assign(partial, requestFields);
  let newListenerCalls = 0;
  partial.on('newListener', (eventName) => {
    newListenerCalls += 1;
    if (eventName === 'end') throw new Error('hostile registration callback');
  });
  const partialBaseline = listenerCounts(partial);
  const partialResponse = makeResponse();
  await handler(partial, partialResponse);

  const cleanup = new EventEmitter();
  Object.assign(cleanup, requestFields);
  let removeListenerCalls = 0;
  cleanup.on('removeListener', () => {
    removeListenerCalls += 1;
    throw new Error('hostile cleanup callback');
  });
  const cleanupBaseline = listenerCounts(cleanup);
  const cleanupResponse = makeResponse();
  const cleanupPending = handler(cleanup, cleanupResponse);
  cleanup.emit('data', Buffer.from(requestBody()));
  cleanup.complete = true;
  try { cleanup.emit('end'); } catch { /* expected only from the rejected implementation */ }
  const cleanupOutcome = await Promise.race([
    cleanupPending.then(() => 'settled'),
    new Promise((resolve) => setTimeout(resolve, 25, 'timeout')),
  ]);

  assert.deepEqual({
    internalHookCalls,
    newListenerCalls,
    partialBaseline,
    partialFinal: listenerCounts(partial),
    partialStatus: partialResponse.statusCode,
    removeListenerCalls,
    cleanupOutcome,
    cleanupBaseline,
    cleanupFinal: listenerCounts(cleanup),
    cleanupStatus: cleanupResponse.statusCode,
    apiCalls,
  }, {
    internalHookCalls: [0, 0],
    newListenerCalls: 0,
    partialBaseline: [0, 0, 0, 0],
    partialFinal: [0, 0, 0, 0],
    partialStatus: 404,
    removeListenerCalls: 0,
    cleanupOutcome: 'settled',
    cleanupBaseline: [0, 0, 0, 0],
    cleanupFinal: [0, 0, 0, 0],
    cleanupStatus: 404,
    apiCalls: 0,
  });
});

test('H19 raw headers accept 64 pairs and reject larger inputs before bounded descriptor work', async () => {
  const originalGetOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
  let observedRawHeaders = null;
  let descriptorCalls = 0;
  let adapter;
  try {
    Object.getOwnPropertyDescriptor = (value, key) => {
      if (value === observedRawHeaders) descriptorCalls += 1;
      return originalGetOwnPropertyDescriptor(value, key);
    };
    adapter = await import(`${MODULE_PATH}?raw-header-work-ceiling`);
  } finally {
    Object.getOwnPropertyDescriptor = originalGetOwnPropertyDescriptor;
  }
  let apiCalls = 0;
  const handler = adapter.createTenantSkyscraperNavigationHttpAdapter(async () => {
    apiCalls += 1;
    return acceptedResult();
  });
  const run = async (rawHeaders) => {
    const request = new EventEmitter();
    Object.assign(request, {
      method: 'POST',
      url: ROUTE,
      headers: { authorization: `Bearer ${CREDENTIAL}`, 'content-type': 'application/json' },
      rawHeaders,
      aborted: false,
      complete: false,
      destroyed: false,
    });
    const response = {
      destroyed: false, writableEnded: false, headersSent: false, statusCode: null,
      writeHead(statusCode) { this.statusCode = statusCode; this.headersSent = true; },
      end() { this.writableEnded = true; },
      destroy() { this.destroyed = true; },
    };
    observedRawHeaders = rawHeaders;
    descriptorCalls = 0;
    const pending = handler(request, response);
    request.emit('data', Buffer.from(requestBody()));
    request.complete = true;
    request.emit('end');
    await pending;
    return { statusCode: response.statusCode, descriptorCalls };
  };
  const atLimit = [];
  for (let index = 0; index < 62; index += 1) {
    atLimit.push(`X-Filler-${index}`, 'bounded');
  }
  atLimit.push('Authorization', `Bearer ${CREDENTIAL}`, 'Content-Type', 'application/json');
  const overLimit = [...atLimit, 'X-Over-Limit', 'denied'];

  const accepted = await run(atLimit);
  const denied = await run(overLimit);

  assert.deepEqual({ accepted, denied, apiCalls }, {
    accepted: { statusCode: 200, descriptorCalls: 129 },
    denied: { statusCode: 404, descriptorCalls: 1 },
    apiCalls: 1,
  });
});

test('H20 ambient Array iteration cannot bypass registration callback preflight', async () => {
  const adapter = await import(`${MODULE_PATH}?ambient-registration-iterator`);
  let apiCalls = 0;
  const handler = adapter.createTenantSkyscraperNavigationHttpAdapter(async () => {
    apiCalls += 1;
    return acceptedResult();
  });
  const request = new EventEmitter();
  Object.assign(request, {
    method: 'POST',
    url: ROUTE,
    headers: { authorization: `Bearer ${CREDENTIAL}`, 'content-type': 'application/json' },
    rawHeaders: ['Authorization', `Bearer ${CREDENTIAL}`, 'Content-Type', 'application/json'],
    aborted: false,
    complete: false,
    destroyed: false,
  });
  const response = {
    destroyed: false, writableEnded: false, headersSent: false, statusCode: null, body: '',
    writeHead(statusCode) { this.statusCode = statusCode; this.headersSent = true; },
    end(value) { this.body = Buffer.from(value).toString('utf8'); this.writableEnded = true; },
    destroy() { this.destroyed = true; },
  };
  const targetListenerCounts = () => ['data', 'end', 'aborted', 'error']
    .map((eventName) => request.listenerCount(eventName));
  const baseline = targetListenerCounts();
  let iteratorHooks = 0;
  let hostileCallbacks = 0;
  const retainedListeners = [];
  request.on('newListener', (_eventName, listener) => {
    hostileCallbacks += 1;
    retainedListeners.push(listener);
  });
  const iteratorDescriptor = Object.getOwnPropertyDescriptor(Array.prototype, Symbol.iterator);
  let pending;
  try {
    Object.defineProperty(Array.prototype, Symbol.iterator, {
      configurable: true,
      writable: true,
      value() {
        if (this.length === 2 && this[0] === 'newListener' && this[1] === 'removeListener') {
          iteratorHooks += 1;
          return { next() { return { done: true }; } };
        }
        return iteratorDescriptor.value.call(this);
      },
    });
    pending = handler(request, response);
  } finally {
    Object.defineProperty(Array.prototype, Symbol.iterator, iteratorDescriptor);
  }
  request.emit('data', Buffer.from(requestBody()));
  request.complete = true;
  request.emit('end');
  await pending;

  assert.deepEqual({
    iteratorHooks,
    hostileCallbacks,
    retainedReferences: retainedListeners.length,
    baseline,
    final: targetListenerCounts(),
    statusCode: response.statusCode,
    body: response.body,
    apiCalls,
  }, {
    iteratorHooks: 0,
    hostileCallbacks: 0,
    retainedReferences: 0,
    baseline: [0, 0, 0, 0],
    final: [0, 0, 0, 0],
    statusCode: 404,
    body: '{"ok":false,"code":"not_found"}',
    apiCalls: 0,
  });
});

test('H21 inherited event-map accessors deny before native listener registration', async () => {
  const adapter = await import(`${MODULE_PATH}?inherited-event-map-accessor`);
  let apiCalls = 0;
  const handler = adapter.createTenantSkyscraperNavigationHttpAdapter(async () => {
    apiCalls += 1;
    return acceptedResult();
  });
  const request = new EventEmitter();
  Object.assign(request, {
    method: 'POST',
    url: ROUTE,
    headers: { authorization: `Bearer ${CREDENTIAL}`, 'content-type': 'application/json' },
    rawHeaders: ['Authorization', `Bearer ${CREDENTIAL}`, 'Content-Type', 'application/json'],
    aborted: false,
    complete: false,
    destroyed: false,
  });
  request._events = {};
  const response = {
    destroyed: false, writableEnded: false, headersSent: false, statusCode: null, body: '',
    writeHead(statusCode) { this.statusCode = statusCode; this.headersSent = true; },
    end(value) { this.body = Buffer.from(value).toString('utf8'); this.writableEnded = true; },
    destroy() { this.destroyed = true; },
  };
  const targetListenerCounts = () => ['data', 'end', 'aborted', 'error']
    .map((eventName) => request.listenerCount(eventName));
  const baseline = targetListenerCounts();
  let inheritedGetterCalls = 0;
  let pending;
  Object.defineProperty(Object.prototype, 'data', {
    configurable: true,
    get() {
      inheritedGetterCalls += 1;
      return undefined;
    },
  });
  try {
    pending = handler(request, response);
  } finally {
    delete Object.prototype.data;
  }
  await pending;

  assert.deepEqual({
    inheritedGetterCalls,
    baseline,
    final: targetListenerCounts(),
    statusCode: response.statusCode,
    body: response.body,
    apiCalls,
  }, {
    inheritedGetterCalls: 0,
    baseline: [0, 0, 0, 0],
    final: [0, 0, 0, 0],
    statusCode: 404,
    body: '{"ok":false,"code":"not_found"}',
    apiCalls: 0,
  });
});
