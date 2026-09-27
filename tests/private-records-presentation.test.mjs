import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

async function loadTypeScript(relativePath) {
  let source;
  try {
    source = await readFile(new URL(relativePath, import.meta.url), 'utf8');
  } catch (error) {
    if (error?.code === 'ENOENT') return {};
    throw error;
  }
  let output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  if (relativePath.endsWith('privateRecordsView.ts')) {
    const dependencySource = await readFile(
      new URL('../src/privateRecordsPresentation.ts', import.meta.url), 'utf8',
    );
    const dependencyOutput = ts.transpileModule(dependencySource, {
      compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    const dependencyUrl = `data:text/javascript;base64,${Buffer.from(dependencyOutput).toString('base64')}`;
    output = output.replace('./privateRecordsPresentation.js', dependencyUrl);
  }
  return import(`data:text/javascript;base64,${Buffer.from(output).toString('base64')}`);
}

const presentationInput = () => ({
  recordId: 'id_1111111111111111',
  title: 'Synthetic private result',
  lifecycle: 'completed',
  freshness: 'historical',
  sourceObservedAt: '2026-09-27T08:00:00.000Z',
  links: [
    { kind: 'direction', label: 'Direction', state: 'available', occurredAt: '2026-09-27T07:00:00.000Z', actionToken: 'act_direction_0001' },
    { kind: 'authorization', label: 'Authorization', state: 'available', occurredAt: '2026-09-27T07:10:00.000Z', actionToken: 'act_authorization_1' },
    { kind: 'assignment', label: 'Assignment', state: 'available', occurredAt: '2026-09-27T07:20:00.000Z', actionToken: 'act_assignment_0001' },
    { kind: 'activity', label: 'Activity', state: 'not_recorded', occurredAt: null },
    { kind: 'evidence', label: 'Evidence', state: 'not_authorized', occurredAt: null },
    { kind: 'outcome', label: 'Outcome', state: 'unavailable', occurredAt: '2026-09-27T08:00:00.000Z' },
  ],
});

class FakeDocument {
  constructor() { this.activeElement = null; }
  createElement(tagName) { return new FakeElement(tagName, this); }
}

class FakeElement {
  constructor(tagName, ownerDocument) {
    this.tagName = tagName.toUpperCase();
    this.ownerDocument = ownerDocument;
    this.children = [];
    this.attributes = new Map();
    this.listeners = new Map();
    this.parentNode = null;
    this.isConnected = true;
    this.textContent = '';
  }
  set innerHTML(_value) { throw new Error('innerHTML must not be used'); }
  append(...children) {
    for (const child of children) {
      child.parentNode = this;
      child.isConnected = this.isConnected;
      this.children.push(child);
    }
  }
  replaceChildren(...children) {
    for (const child of this.children) { child.parentNode = null; child.isConnected = false; }
    this.children = [];
    this.append(...children);
  }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }
  removeEventListener(type, listener) {
    this.listeners.set(type, (this.listeners.get(type) ?? []).filter((item) => item !== listener));
  }
  dispatch(type, init = {}) {
    const event = { type, target: this, preventDefault() { this.defaultPrevented = true; }, ...init };
    for (const listener of this.listeners.get(type) ?? []) listener(event);
    return event;
  }
  focus() { this.ownerDocument.activeElement = this; }
}

function fakeDom() {
  const document = new FakeDocument();
  const root = new FakeElement('div', document);
  return { document, root };
}

function descendants(node) {
  return node.children.flatMap((child) => [child, ...descendants(child)]);
}

test('closed presentation input detaches accepted data and rejects hostile shapes', async () => {
  const presentation = await loadTypeScript('../src/privateRecordsPresentation.ts');
  assert.equal(typeof presentation.createPrivateRecordsPresentation, 'function');

  const input = presentationInput();
  const result = presentation.createPrivateRecordsPresentation(input);
  input.title = 'mutated';
  input.links[0].label = 'mutated';
  assert.equal(result.title, 'Synthetic private result');
  assert.equal(result.links[0].label, 'Direction');

  const rejected = [
    { ...presentationInput(), tenantId: 'id_2222222222222222' },
    Object.assign(Object.create({ inherited: true }), presentationInput()),
    Object.defineProperty(presentationInput(), 'title', { get: () => 'accessed' }),
    Object.assign(presentationInput(), { [Symbol('hidden')]: true }),
    { ...presentationInput(), title: 'x'.repeat(161) },
    { ...presentationInput(), revision: Number.MAX_SAFE_INTEGER + 1 },
    { ...presentationInput(), revision: Number.NaN },
    { ...presentationInput(), links: [...presentationInput().links, presentationInput().links[0]] },
    { ...presentationInput(), links: presentationInput().links.map((link, index) =>
      index === 0 ? { ...link, locator: 'https://private.invalid/evidence' } : link) },
    { ...presentationInput(), links: presentationInput().links.map((link, index) =>
      index === 0 ? { ...link, actionToken: 'https://private.invalid/evidence' } : link) },
    { ...presentationInput(), links: presentationInput().links.map((link, index) =>
      index === 0 ? { kind: link.kind, label: link.label, state: link.state, occurredAt: link.occurredAt } : link) },
    { ...presentationInput(), links: presentationInput().links.map((link, index) =>
      index === 5 ? { ...link, actionToken: 'act_forbidden_0001' } : link) },
    { ...presentationInput(), links: presentationInput().links.map((link, index) =>
      index === 0 ? { ...link, label: 'x'.repeat(81) } : link) },
    { ...presentationInput(), links: new Date() },
  ];
  const cyclic = presentationInput();
  cyclic.links[0].cycle = cyclic;
  rejected.push(cyclic);
  for (const value of rejected) {
    assert.throws(() => presentation.createPrivateRecordsPresentation(value), /invalid private records presentation/i);
  }
});

test('presentation rejects link chronology after source observation', async () => {
  const presentation = await loadTypeScript('../src/privateRecordsPresentation.ts');
  for (let index = 0; index < presentationInput().links.length; index += 1) {
    const input = presentationInput();
    input.links[index].occurredAt = '2026-09-27T08:00:00.001Z';
    assert.throws(() => presentation.createPrivateRecordsPresentation(input),
      /invalid private records presentation/i);
  }
});

test('presentation accepts link chronology equal to source observation', async () => {
  const presentation = await loadTypeScript('../src/privateRecordsPresentation.ts');
  const input = presentationInput();
  input.links[0].occurredAt = input.sourceObservedAt;

  const result = presentation.createPrivateRecordsPresentation(input);
  assert.equal(result.links[0].occurredAt, input.sourceObservedAt);
});

test('semantic view preserves all six links with explicit state text and chronology', async () => {
  const presentation = await loadTypeScript('../src/privateRecordsPresentation.ts');
  const closed = presentation.createPrivateRecordsPresentation(presentationInput());
  assert.equal(typeof presentation.createPrivateRecordsSemanticView, 'function');

  const semantic = presentation.createPrivateRecordsSemanticView(closed);
  assert.deepEqual(semantic.links.map(({ kind, state, stateText, sequence, actionAvailable }) => ({
    kind, state, stateText, sequence, actionAvailable,
  })), [
    { kind: 'direction', state: 'available', stateText: 'Direction: available', sequence: 1, actionAvailable: true },
    { kind: 'authorization', state: 'available', stateText: 'Authorization: available', sequence: 2, actionAvailable: true },
    { kind: 'assignment', state: 'available', stateText: 'Assignment: available', sequence: 3, actionAvailable: true },
    { kind: 'activity', state: 'not_recorded', stateText: 'Activity: not recorded', sequence: 4, actionAvailable: false },
    { kind: 'evidence', state: 'not_authorized', stateText: 'Evidence: not authorized', sequence: 5, actionAvailable: false },
    { kind: 'outcome', state: 'unavailable', stateText: 'Outcome: unavailable', sequence: 6, actionAvailable: false },
  ]);
  assert.equal(semantic.stateText, 'State: completed');
  assert.equal(semantic.freshnessText, 'Freshness: historical; observed 2026-09-27T08:00:00.000Z');
  assert.equal(Object.hasOwn(semantic.links[4], 'actionToken'), false);
});

test('semantic view rejects objects that bypass the closed presentation boundary', async () => {
  const presentation = await loadTypeScript('../src/privateRecordsPresentation.ts');
  const closed = presentation.createPrivateRecordsPresentation(presentationInput());
  const bypass = {
    ...closed,
    links: closed.links.map((link) => ({ ...link })),
  };
  assert.throws(() => presentation.createPrivateRecordsSemanticView(bypass),
    /invalid private records presentation/i);
});

test('world panel and non-spatial adapters preserve normalized semantic meaning', async () => {
  const presentation = await loadTypeScript('../src/privateRecordsPresentation.ts');
  const semantic = presentation.createPrivateRecordsSemanticView(
    presentation.createPrivateRecordsPresentation(presentationInput()),
  );
  assert.equal(typeof presentation.adaptPrivateRecordsWorldPanel, 'function');
  assert.equal(typeof presentation.adaptPrivateRecordsNonSpatial, 'function');

  const world = presentation.adaptPrivateRecordsWorldPanel(semantic);
  const nonSpatial = presentation.adaptPrivateRecordsNonSpatial(semantic);
  const normalize = ({ semantic: value }) => JSON.parse(JSON.stringify(value));
  assert.deepEqual(normalize(world), normalize(nonSpatial));
  assert.equal(world.surface, 'world-panel');
  assert.equal(nonSpatial.surface, 'non-spatial');
  assert.equal(world.semantic, semantic);
  assert.equal(nonSpatial.semantic, semantic);
});

test('renderer keeps hostile text inert and emits only opaque authorized actions', async () => {
  const [presentation, view] = await Promise.all([
    loadTypeScript('../src/privateRecordsPresentation.ts'),
    loadTypeScript('../src/privateRecordsView.ts'),
  ]);
  assert.equal(typeof view.createPrivateRecordsView, 'function');
  const input = presentationInput();
  input.title = '<script>globalThis.pwned=true</script>';
  input.links[0].label = 'https://private.invalid/<img src=x onerror=alert(1)>';
  const semantic = presentation.createPrivateRecordsSemanticView(
    presentation.createPrivateRecordsPresentation(input),
  );
  const { root } = fakeDom();
  const actions = [];
  const controller = view.createPrivateRecordsView({ root, semantic, onAction: (action) => actions.push(action) });
  controller.open({ invoker: new FakeElement('button', root.ownerDocument) });

  const nodes = descendants(root);
  assert.ok(nodes.some(({ textContent }) => textContent === input.title));
  assert.ok(nodes.some(({ textContent }) => textContent.includes(input.links[0].label)));
  const renderedData = nodes.map((node) => ({
    textContent: node.textContent,
    attributes: Object.fromEntries(node.attributes),
  }));
  assert.equal(JSON.stringify(renderedData).includes('private.invalid'), true);
  assert.equal(JSON.stringify(renderedData).includes('act_direction_0001'), false);
  const actionButtons = nodes.filter((node) => node.getAttribute('data-record-action') !== null);
  assert.equal(actionButtons.length, 3);
  actionButtons[0].dispatch('click');
  assert.deepEqual(actions, [{
    recordId: 'id_1111111111111111', kind: 'direction', actionToken: 'act_direction_0001',
  }]);
  assert.equal(JSON.stringify(actions).includes('private.invalid'), false);
});

test('renderer rejects structurally forged semantic input before side effects', async () => {
  const view = await loadTypeScript('../src/privateRecordsView.ts');
  const { root } = fakeDom();
  const actions = [];
  const semantic = {
    recordId: 'https://private.invalid/record',
    title: 'Forged private record',
    stateText: 'State: completed',
    freshnessText: 'Freshness: historical',
    links: [{
      kind: 'evidence',
      label: 'Forged evidence',
      state: 'available',
      stateText: 'Evidence: available',
      sequence: 1,
      occurredAt: '2026-09-27T08:00:00.000Z',
      actionAvailable: true,
      actionToken: 'https://private.invalid/evidence',
    }],
  };

  assert.throws(() => view.createPrivateRecordsView({
    root, semantic, onAction: (action) => actions.push(action),
  }), /invalid private records semantic view/i);
  assert.equal(root.children.length, 0);
  assert.equal([...root.listeners.values()].flat().length, 0);
  assert.deepEqual(actions, []);
});

test('renderer rejects semantic input inherited from an accepted semantic view', async () => {
  const [presentation, view] = await Promise.all([
    loadTypeScript('../src/privateRecordsPresentation.ts'),
    loadTypeScript('../src/privateRecordsView.ts'),
  ]);
  const semantic = presentation.createPrivateRecordsSemanticView(
    presentation.createPrivateRecordsPresentation(presentationInput()),
  );
  const inherited = Object.create(semantic);
  const { root } = fakeDom();
  const actions = [];

  assert.throws(() => view.createPrivateRecordsView({
    root, semantic: inherited, onAction: (action) => actions.push(action),
  }), /invalid private records semantic view/i);
  assert.equal(root.children.length, 0);
  assert.equal([...root.listeners.values()].flat().length, 0);
  assert.deepEqual(actions, []);
});

test('renderer rejects spread and reconstructed copies of accepted semantic views', async () => {
  const [presentation, view] = await Promise.all([
    loadTypeScript('../src/privateRecordsPresentation.ts'),
    loadTypeScript('../src/privateRecordsView.ts'),
  ]);
  const semantic = presentation.createPrivateRecordsSemanticView(
    presentation.createPrivateRecordsPresentation(presentationInput()),
  );
  const copies = [
    { ...semantic },
    { ...semantic, links: semantic.links.map((link) => ({ ...link })) },
  ];

  for (const copy of copies) {
    const { root } = fakeDom();
    const actions = [];
    assert.throws(() => view.createPrivateRecordsView({
      root, semantic: copy, onAction: (action) => actions.push(action),
    }), /invalid private records semantic view/i);
    assert.equal(root.children.length, 0);
    assert.equal([...root.listeners.values()].flat().length, 0);
    assert.deepEqual(actions, []);
  }
});

test('controller creation has zero rendering network timer storage or listener effects before open', async () => {
  const [presentation, view] = await Promise.all([
    loadTypeScript('../src/privateRecordsPresentation.ts'),
    loadTypeScript('../src/privateRecordsView.ts'),
  ]);
  const semantic = presentation.createPrivateRecordsSemanticView(
    presentation.createPrivateRecordsPresentation(presentationInput()),
  );
  const { root } = fakeDom();
  const originalFetch = globalThis.fetch;
  const originalSetTimeout = globalThis.setTimeout;
  let externalCalls = 0;
  globalThis.fetch = async () => { externalCalls += 1; throw new Error('unexpected fetch'); };
  globalThis.setTimeout = () => { externalCalls += 1; throw new Error('unexpected timer'); };
  try {
    const controller = view.createPrivateRecordsView({ root, semantic, onAction: () => {} });
    assert.equal(controller.isOpen, false);
    assert.equal(root.children.length, 0);
    assert.equal([...root.listeners.values()].flat().length, 0);
    assert.equal(externalCalls, 0);
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.setTimeout = originalSetTimeout;
  }
});

test('keyboard interaction stays bounded and close restores focus with a safe root fallback', async () => {
  const [presentation, view] = await Promise.all([
    loadTypeScript('../src/privateRecordsPresentation.ts'),
    loadTypeScript('../src/privateRecordsView.ts'),
  ]);
  const semantic = presentation.createPrivateRecordsSemanticView(
    presentation.createPrivateRecordsPresentation(presentationInput()),
  );
  const { document, root } = fakeDom();
  const invoker = new FakeElement('button', document);
  const actions = [];
  const controller = view.createPrivateRecordsView({ root, semantic, onAction: (action) => actions.push(action) });

  controller.open({ invoker });
  assert.equal((root.listeners.get('keydown') ?? []).length, 1);
  let buttons = descendants(root).filter(({ tagName }) => tagName === 'BUTTON');
  assert.equal(document.activeElement, buttons[0]);
  root.dispatch('keydown', { key: 'Enter', target: buttons[0] });
  root.dispatch('keydown', { key: ' ', target: buttons[0] });
  assert.equal(actions.length, 2);
  buttons.at(-1).focus();
  root.dispatch('keydown', { key: 'Tab', target: buttons.at(-1) });
  assert.equal(document.activeElement, buttons[0]);
  root.dispatch('keydown', { key: 'Tab', shiftKey: true, target: buttons[0] });
  assert.equal(document.activeElement, buttons.at(-1));
  root.dispatch('keydown', { key: 'Escape', target: buttons.at(-1) });
  assert.equal(controller.isOpen, false);
  assert.equal(document.activeElement, invoker);
  assert.equal((root.listeners.get('keydown') ?? []).length, 0);

  controller.open({ invoker });
  controller.open({ invoker });
  assert.equal((root.listeners.get('keydown') ?? []).length, 1);
  invoker.isConnected = false;
  buttons = descendants(root).filter(({ tagName }) => tagName === 'BUTTON');
  root.dispatch('keydown', { key: 'Escape', target: buttons[0] });
  assert.equal(document.activeElement, root);
  assert.equal(root.getAttribute('tabindex'), '-1');
});

test('renderer exposes structural zoom reduced-motion and labeled touch-target contracts', async () => {
  const [presentation, view] = await Promise.all([
    loadTypeScript('../src/privateRecordsPresentation.ts'),
    loadTypeScript('../src/privateRecordsView.ts'),
  ]);
  assert.equal(typeof view.PRIVATE_RECORDS_VIEW_CSS, 'string');
  assert.match(view.PRIVATE_RECORDS_VIEW_CSS, /max-inline-size:\s*48rem/);
  assert.match(view.PRIVATE_RECORDS_VIEW_CSS, /overflow-wrap:\s*anywhere/);
  assert.match(view.PRIVATE_RECORDS_VIEW_CSS, /min-block-size:\s*2\.75rem/);
  assert.match(view.PRIVATE_RECORDS_VIEW_CSS, /prefers-reduced-motion:\s*reduce/);
  assert.match(view.PRIVATE_RECORDS_VIEW_CSS, /animation:\s*none/);

  const semantic = presentation.createPrivateRecordsSemanticView(
    presentation.createPrivateRecordsPresentation(presentationInput()),
  );
  const { root } = fakeDom();
  view.createPrivateRecordsView({ root, semantic, onAction: () => {} })
    .open({ invoker: new FakeElement('button', root.ownerDocument) });
  const nodes = descendants(root);
  assert.equal(nodes.filter(({ tagName }) => tagName === 'STYLE').length, 1);
  assert.equal(nodes.find(({ tagName }) => tagName === 'SECTION')
    .getAttribute('data-private-records-view'), '');
  for (const button of nodes.filter(({ tagName }) => tagName === 'BUTTON')) {
    assert.ok(button.getAttribute('aria-label'));
    assert.equal(button.getAttribute('class'), 'private-records-control');
  }
});

test('private Records modules remain dormant outside every existing runtime source file', async () => {
  const sourceRoot = new URL('../src/', import.meta.url);
  const paths = (await readdir(sourceRoot, { recursive: true }))
    .filter((path) => path.endsWith('.ts'))
    .filter((path) => !['privateRecordsPresentation.ts', 'privateRecordsView.ts'].includes(path));
  const runtimeSources = await Promise.all(paths.map(async (path) => ({
    path,
    source: await readFile(new URL(path, sourceRoot), 'utf8'),
  })));
  assert.deepEqual(runtimeSources.filter(({ source }) =>
    /privateRecords(?:Presentation|View)/.test(source)).map(({ path }) => path), []);
  const privateSources = await Promise.all([
    readFile(new URL('privateRecordsPresentation.ts', sourceRoot), 'utf8'),
    readFile(new URL('privateRecordsView.ts', sourceRoot), 'utf8'),
  ]);
  assert.equal(privateSources.some((source) =>
    /from\s+['"].*(?:main|server|multiplayer)/.test(source)), false);
});
