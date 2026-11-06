import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import test from 'node:test';

import { createManagedCustomerIdentityDomain } from '../server/managedCustomerIdentityDomain.mjs';
import { createAgentCommonsParticipationPolicyProposal } from '../server/agentCommonsParticipationPolicyProposal.mjs';
import {
  createAgentCommonsActivationReadiness,
  createAgentCommonsActivityDefinition,
  createAgentCommonsAdmissionReadiness,
  createAgentCommonsReadinessPresentation,
  createAgentCommonsSharedSpaceDefinition,
} from '../src/domain/agentCommonsSharedSpace.ts';

const VIEW_URL = new URL('../src/agentCommonsReadinessView.ts', import.meta.url);
const ACCOUNT_ID = 'account_0000000000000001';
const TENANT_ID = 'tenant_0000000000000002';
const SPACE_ID = 'space_0000000000000003';
const ACTIVITY_ID = 'activity_0000000000000004';

async function loadView(suffix = '') {
  try {
    return await import(`${VIEW_URL.href}?${suffix}`);
  } catch (error) {
    if (error?.code === 'ERR_MODULE_NOT_FOUND' && error?.url === VIEW_URL.href) return {};
    throw error;
  }
}

function authenticPresentation(domain = {
  createAgentCommonsActivationReadiness,
  createAgentCommonsActivityDefinition,
  createAgentCommonsAdmissionReadiness,
  createAgentCommonsReadinessPresentation,
  createAgentCommonsSharedSpaceDefinition,
}) {
  const identity = createManagedCustomerIdentityDomain({
    schemaVersion: 'managed-customer-identity/1',
    account: { accountId: ACCOUNT_ID, displayLabel: 'Synthetic Account', lifecycle: 'active' },
    organization: {
      organizationId: 'organization_0000000000000002',
      displayLabel: 'Synthetic Organization',
      lifecycle: 'active',
    },
    membership: {
      accountId: ACCOUNT_ID,
      organizationId: 'organization_0000000000000002',
      roleLabel: 'member',
      lifecycle: 'active',
    },
  });
  const space = domain.createAgentCommonsSharedSpaceDefinition(identity, {
    schemaVersion: 'agent-commons-shared-space/1',
    spaceId: SPACE_ID,
    displayName: 'Agent Commons',
    purpose: 'voluntary_social_creative_recreation',
    definedAt: '2026-10-05T12:00:00.000Z',
    recordedAt: '2026-10-05T12:00:00.000Z',
  });
  const activity = domain.createAgentCommonsActivityDefinition(space, {
    schemaVersion: 'agent-commons-activity-definition/1',
    activityId: ACTIVITY_ID,
    activityKind: 'creative',
    definedAt: '2026-10-05T12:01:00.000Z',
    recordedAt: '2026-10-05T12:01:00.000Z',
  });
  const proposal = createAgentCommonsParticipationPolicyProposal(identity, {
    schemaVersion: 'agent-commons-participation-policy-proposal/1',
    proposalId: 'proposal_0000000000000005',
    participationMode: 'enabled',
    quietHours: { mode: 'disabled', startMinuteUtc: null, endMinuteUtc: null },
    proposedAt: '2026-10-05T11:59:00.000Z',
    recordedAt: '2026-10-05T11:59:00.000Z',
  });
  const activation = domain.createAgentCommonsActivationReadiness(space, activity, proposal);
  const admission = domain.createAgentCommonsAdmissionReadiness(
    identity, space, activity, proposal, activation, 720,
  );
  return domain.createAgentCommonsReadinessPresentation(
    identity, space, activity, proposal, activation, admission,
  );
}

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
    this.focusCalls = 0;
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
  focus() { this.focusCalls += 1; this.ownerDocument.activeElement = this; }
}

function fakeDom() {
  const document = new FakeDocument();
  return { document, root: new FakeElement('div', document) };
}

function descendants(node) {
  return node.children.flatMap((child) => [child, ...descendants(child)]);
}

function assertRejectedWithoutEffects(view, presentation, hooks = () => 0) {
  const { document, root } = fakeDom();
  assert.throws(
    () => view.createAgentCommonsReadinessView(root, presentation),
    { name: 'TypeError', message: 'Invalid Agent Commons readiness view input' },
  );
  assert.equal(root.children.length, 0);
  assert.equal([...root.listeners.values()].flat().length, 0);
  assert.equal(root.focusCalls, 0);
  assert.equal(document.activeElement, null);
  assert.equal(hooks(), 0);
}

test('T1 authentic M10.7 presentation opens a semantic blocked readiness view', async () => {
  const view = await loadView('t1');
  assert.equal(typeof view.createAgentCommonsReadinessView, 'function');
  const { document, root } = fakeDom();
  const controller = view.createAgentCommonsReadinessView(root, authenticPresentation());
  assert.equal(controller.isOpen, false);

  controller.open({ invoker: new FakeElement('button', document) });

  const nodes = descendants(root);
  const dialog = nodes.find(({ tagName }) => tagName === 'SECTION');
  assert.equal(dialog?.getAttribute('role'), 'dialog');
  assert.equal(dialog?.getAttribute('aria-modal'), 'true');
  assert.equal(nodes.filter(({ tagName }) => tagName === 'H2').length, 1);
  assert.match(nodes.map(({ textContent }) => textContent).join('\n'), /Blocked.*Unavailable/s);
  assert.equal(controller.isOpen, true);
});

test('T2 characterization: structural and JSON copies fail before side effects', async () => {
  const view = await loadView('t2');
  const presentation = authenticPresentation();
  assertRejectedWithoutEffects(view, { ...presentation });
  assertRejectedWithoutEffects(view, JSON.parse(JSON.stringify(presentation)));
});

test('T3 characterization: descendants and wrappers fail before side effects', async () => {
  const view = await loadView('t3');
  const presentation = authenticPresentation();
  assertRejectedWithoutEffects(view, Object.create(presentation));
  assertRejectedWithoutEffects(view, Object.freeze({ value: presentation }));
});

test('T4 characterization: proxies fail without attacker hooks or side effects', async () => {
  const view = await loadView('t4');
  let hooks = 0;
  const proxy = new Proxy(authenticPresentation(), {
    get() { hooks += 1; throw new Error('private'); },
    getPrototypeOf() { hooks += 1; throw new Error('private'); },
    ownKeys() { hooks += 1; throw new Error('private'); },
  });
  assertRejectedWithoutEffects(view, proxy, () => hooks);
});

test('T5 characterization: accessor forgeries fail without execution or side effects', async () => {
  const view = await loadView('t5');
  let hooks = 0;
  const forged = Object.defineProperty({}, 'readinessStatus', {
    enumerable: true,
    get() { hooks += 1; throw new Error('private'); },
  });
  assertRejectedWithoutEffects(view, forged, () => hooks);
});

test('T6 characterization: null and primitives fail before side effects', async () => {
  const view = await loadView('t6');
  for (const value of [null, undefined, false, 0, '', Symbol('forged')]) {
    assertRejectedWithoutEffects(view, value);
  }
});

test('T7 characterization: foreign-module results fail before side effects', async () => {
  const view = await loadView('t7');
  const foreignDomain = await import('../src/domain/agentCommonsSharedSpace.ts?view-foreign=1');
  assertRejectedWithoutEffects(view, authenticPresentation(foreignDomain));
});

test('T8 characterization: controller creation is dormant and exposes only its frozen contract', async () => {
  const view = await loadView('t8');
  const { document, root } = fakeDom();
  const originalFetch = globalThis.fetch;
  const originalSetTimeout = globalThis.setTimeout;
  let externalCalls = 0;
  globalThis.fetch = async () => { externalCalls += 1; throw new Error('network'); };
  globalThis.setTimeout = () => { externalCalls += 1; throw new Error('timer'); };
  try {
    const controller = view.createAgentCommonsReadinessView(root, authenticPresentation());
    assert.equal(Object.isFrozen(controller), true);
    assert.deepEqual(Object.keys(controller), ['open', 'close', 'isOpen']);
    assert.equal(controller.isOpen, false);
    assert.equal(root.children.length, 0);
    assert.equal([...root.listeners.values()].flat().length, 0);
    assert.equal(root.focusCalls, 0);
    assert.equal(document.activeElement, null);
    assert.equal(externalCalls, 0);
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.setTimeout = originalSetTimeout;
  }
});

test('T9 open preserves exact readiness meaning without private identifiers or actions', async () => {
  const view = await loadView('t9');
  const presentation = authenticPresentation();
  const { document, root } = fakeDom();
  view.createAgentCommonsReadinessView(root, presentation)
    .open({ invoker: new FakeElement('button', document) });

  const nodes = descendants(root);
  const text = nodes.map(({ textContent }) => textContent).join('\n');
  for (const expected of [
    'Readiness: Blocked',
    'Availability: Unavailable',
    'Participation policy is not authorized',
    'Retention policy is not configured',
    'Privacy: Tenant-private',
    'Cost: No incremental spend',
    'Interruption: Return to assigned state',
    'Participation: Not activated',
    'Occupancy: Unavailable',
    'Activity: Not activated',
    'Participation mode: Enabled',
    'Quiet hours: Disabled',
    'Activity kind: Creative',
  ]) assert.match(text, new RegExp(expected));
  for (const privateText of [
    presentation.tenantId, presentation.accountId, presentation.spaceId, presentation.activityId,
  ]) assert.equal(text.includes(privateText), false);
  const buttons = nodes.filter(({ tagName }) => tagName === 'BUTTON');
  assert.equal(buttons.length, 1);
  assert.equal(buttons[0].textContent, 'Close Agent Commons readiness');
  assert.equal(buttons[0].getAttribute('aria-label'), 'Close Agent Commons readiness');
  assert.doesNotMatch(
    buttons.map((button) => button.textContent).join('\n'),
    /approve|activate|join|invite|attend|interrupt|spend|configure/i,
  );
});

test('T10 Enter Space and click activate the only close control', async () => {
  const view = await loadView('t10');
  const { document, root } = fakeDom();
  const invoker = new FakeElement('button', document);
  const controller = view.createAgentCommonsReadinessView(root, authenticPresentation());

  for (const activation of ['Enter', ' ', 'click']) {
    controller.open({ invoker });
    const closeButton = descendants(root).find(({ tagName }) => tagName === 'BUTTON');
    assert.equal(document.activeElement, closeButton);
    if (activation === 'click') closeButton.dispatch('click');
    else root.dispatch('keydown', { key: activation, target: closeButton });
    assert.equal(controller.isOpen, false);
    assert.equal(root.children.length, 0);
  }
});

test('T11 characterization: repeated open Escape Tab focus and listener ownership stay bounded', async () => {
  const view = await loadView('t11');
  const { document, root } = fakeDom();
  const invoker = new FakeElement('button', document);
  const controller = view.createAgentCommonsReadinessView(root, authenticPresentation());

  controller.open({ invoker });
  const retiredControl = descendants(root).find(({ tagName }) => tagName === 'BUTTON');
  controller.open({ invoker });
  assert.equal((retiredControl.listeners.get('click') ?? []).length, 0);
  assert.equal((root.listeners.get('keydown') ?? []).length, 1);
  let closeButton = descendants(root).find(({ tagName }) => tagName === 'BUTTON');
  const tab = root.dispatch('keydown', { key: 'Tab', target: closeButton });
  assert.equal(tab.defaultPrevented, true);
  assert.equal(document.activeElement, closeButton);
  root.dispatch('keydown', { key: 'Escape', target: closeButton });
  assert.equal(controller.isOpen, false);
  assert.equal(document.activeElement, invoker);
  assert.equal((root.listeners.get('keydown') ?? []).length, 0);
  assert.equal((closeButton.listeners.get('click') ?? []).length, 0);

  controller.open({ invoker });
  invoker.isConnected = false;
  closeButton = descendants(root).find(({ tagName }) => tagName === 'BUTTON');
  root.dispatch('keydown', { key: 'Escape', target: closeButton });
  assert.equal(document.activeElement, root);
  assert.equal(root.getAttribute('tabindex'), '-1');
});

test('T12 view exposes touch zoom overflow and reduced-motion contracts', async () => {
  const view = await loadView('t12');
  assert.equal(typeof view.AGENT_COMMONS_READINESS_VIEW_CSS, 'string');
  assert.match(view.AGENT_COMMONS_READINESS_VIEW_CSS, /max-inline-size:\s*48rem/);
  assert.match(view.AGENT_COMMONS_READINESS_VIEW_CSS, /max-block-size:\s*90vh/);
  assert.match(view.AGENT_COMMONS_READINESS_VIEW_CSS, /overflow:\s*auto/);
  assert.match(view.AGENT_COMMONS_READINESS_VIEW_CSS, /overflow-wrap:\s*anywhere/);
  assert.match(view.AGENT_COMMONS_READINESS_VIEW_CSS, /font-size:\s*1rem/);
  assert.match(view.AGENT_COMMONS_READINESS_VIEW_CSS, /min-inline-size:\s*2\.75rem/);
  assert.match(view.AGENT_COMMONS_READINESS_VIEW_CSS, /min-block-size:\s*2\.75rem/);
  assert.match(view.AGENT_COMMONS_READINESS_VIEW_CSS, /prefers-reduced-motion:\s*reduce/);
  assert.match(view.AGENT_COMMONS_READINESS_VIEW_CSS, /animation:\s*none/);
  assert.match(view.AGENT_COMMONS_READINESS_VIEW_CSS, /transition:\s*none/);

  const { document, root } = fakeDom();
  view.createAgentCommonsReadinessView(root, authenticPresentation())
    .open({ invoker: new FakeElement('button', document) });
  const nodes = descendants(root);
  assert.equal(nodes.filter(({ tagName }) => tagName === 'STYLE').length, 1);
  assert.equal(
    nodes.find(({ tagName }) => tagName === 'SECTION').getAttribute('data-agent-commons-readiness-view'),
    '',
  );
  assert.equal(
    nodes.find(({ tagName }) => tagName === 'BUTTON').getAttribute('class'),
    'agent-commons-readiness-control',
  );
});

test('T13 cleanup failure still retires owned listeners and content', async () => {
  const view = await loadView('t13');
  const { document, root } = fakeDom();
  const invoker = new FakeElement('button', document);
  const controller = view.createAgentCommonsReadinessView(root, authenticPresentation());
  const cleanupError = new Error('close listener cleanup failure');

  controller.open({ invoker });
  const closeControl = descendants(root).find(({ tagName }) => tagName === 'BUTTON');
  const removeEventListener = closeControl.removeEventListener.bind(closeControl);
  closeControl.removeEventListener = (type, listener) => {
    removeEventListener(type, listener);
    if (type === 'click') throw cleanupError;
  };

  assert.throws(() => controller.close(), (error) => error === cleanupError);
  assert.equal(controller.isOpen, false);
  assert.equal(root.children.length, 0);
  assert.equal((root.listeners.get('keydown') ?? []).length, 0);
  assert.equal((closeControl.listeners.get('click') ?? []).length, 0);
});

test('T14 focus reentrancy that throws closes without owned residue', async () => {
  const view = await loadView('t14');
  const { document, root } = fakeDom();
  const outerInvoker = new FakeElement('button', document);
  const nestedInvoker = new FakeElement('button', document);
  const controller = view.createAgentCommonsReadinessView(root, authenticPresentation());
  const focusError = new Error('focus failure');

  controller.open({ invoker: outerInvoker });
  const outerControl = descendants(root).find(({ tagName }) => tagName === 'BUTTON');
  let nestedControl;
  outerInvoker.focus = () => {
    controller.open({ invoker: nestedInvoker });
    nestedControl = descendants(root).find(({ tagName }) => tagName === 'BUTTON');
    throw focusError;
  };

  assert.throws(() => controller.close(), (error) => error === focusError);
  assert.equal(controller.isOpen, false);
  assert.equal(root.children.length, 0);
  assert.equal((root.listeners.get('keydown') ?? []).length, 0);
  assert.equal((outerControl.listeners.get('click') ?? []).length, 0);
  assert.equal((nestedControl.listeners.get('click') ?? []).length, 0);
});

test('T15 post-import ambient replacements cannot observe rejection or dormant creation', async () => {
  const view = await loadView('t15');
  const OriginalTypeError = globalThis.TypeError;
  const originalFreeze = Object.freeze;
  let hooks = 0;
  let error;
  try {
    globalThis.TypeError = function HostileTypeError(...args) {
      hooks += 1;
      return new OriginalTypeError(...args);
    };
    Object.freeze = (...args) => { hooks += 1; return originalFreeze(...args); };
    try {
      view.createAgentCommonsReadinessView(fakeDom().root, null);
    } catch (caught) {
      error = caught;
    }
    const controller = view.createAgentCommonsReadinessView(
      fakeDom().root,
      authenticPresentation(),
    );
    assert.equal(controller.isOpen, false);
  } finally {
    globalThis.TypeError = OriginalTypeError;
    Object.freeze = originalFreeze;
  }
  assert.equal(Object.getPrototypeOf(error), OriginalTypeError.prototype);
  assert.equal(error.message, 'Invalid Agent Commons readiness view input');
  assert.equal(hooks, 0);
});

test('T16 dialog heading provides its accessible name', async () => {
  const view = await loadView('t16');
  const { document, root } = fakeDom();
  view.createAgentCommonsReadinessView(root, authenticPresentation())
    .open({ invoker: new FakeElement('button', document) });
  const nodes = descendants(root);
  const dialog = nodes.find(({ tagName }) => tagName === 'SECTION');
  const heading = nodes.find(({ tagName }) => tagName === 'H2');
  assert.equal(heading.getAttribute('id'), 'agent-commons-readiness-heading');
  assert.equal(dialog.getAttribute('aria-labelledby'), heading.getAttribute('id'));
});

test('T17 characterization: renderer is text-only and dormant outside its source file', async () => {
  const sourceRoot = new URL('../src/', import.meta.url);
  const source = await readFile(new URL('agentCommonsReadinessView.ts', sourceRoot), 'utf8');
  assert.equal(/\b(?:innerHTML|outerHTML|insertAdjacentHTML|document\.write)\b/.test(source), false);
  assert.equal(/\b(?:fetch|XMLHttpRequest|WebSocket|localStorage|sessionStorage|indexedDB|setTimeout|setInterval)\b/.test(source), false);
  assert.equal(/\b(?:process|Deno|Bun|node:fs|node:child_process)\b/.test(source), false);
  assert.equal(/\b(?:location|window\.open|URL)\s*[.(]/.test(source), false);
  assert.match(source, /\.textContent\s*=/);
  assert.match(source, /\.createElement\(/);

  const paths = (await readdir(sourceRoot, { recursive: true }))
    .filter((path) => path.endsWith('.ts'))
    .filter((path) => path !== 'agentCommonsReadinessView.ts');
  const importers = [];
  for (const path of paths) {
    const runtimeSource = await readFile(new URL(path, sourceRoot), 'utf8');
    if (/agentCommonsReadinessView/.test(runtimeSource)) importers.push(path);
  }
  assert.deepEqual(importers, []);
});

test('T18 extra arguments fail before root or extra-input observation', async () => {
  const view = await loadView('t18');
  const { root } = fakeDom();
  let hooks = 0;
  const hostileRoot = new Proxy(root, {
    get() { hooks += 1; throw new Error('root observed'); },
  });
  const extra = new Proxy({}, {
    get() { hooks += 1; throw new Error('extra input observed'); },
  });

  assert.throws(
    () => view.createAgentCommonsReadinessView(hostileRoot, authenticPresentation(), extra),
    { name: 'TypeError', message: 'Invalid Agent Commons readiness view input' },
  );
  assert.equal(root.children.length, 0);
  assert.equal([...root.listeners.values()].flat().length, 0);
  assert.equal(root.focusCalls, 0);
  assert.equal(root.ownerDocument.activeElement, null);
  assert.equal(hooks, 0);
});

test('T19 non-empty replacement reentry keeps one connected rendered generation', async () => {
  const view = await loadView('t19');
  const { document, root } = fakeDom();
  const outerInvoker = new FakeElement('button', document);
  const nestedInvoker = new FakeElement('button', document);
  const createElement = document.createElement.bind(document);
  const createdControls = [];
  document.createElement = (tagName) => {
    const element = createElement(tagName);
    if (element.tagName === 'BUTTON') createdControls.push(element);
    return element;
  };
  const controller = view.createAgentCommonsReadinessView(root, authenticPresentation());
  const replaceChildren = root.replaceChildren.bind(root);
  let reentries = 0;
  root.replaceChildren = (...children) => {
    replaceChildren(...children);
    if (children.length > 0 && reentries === 0) {
      reentries += 1;
      controller.open({ invoker: nestedInvoker });
    }
  };

  controller.open({ invoker: outerInvoker });

  const renderedControl = descendants(root).find(({ tagName }) => tagName === 'BUTTON');
  assert.equal(reentries, 1);
  assert.equal(controller.isOpen, true);
  assert.equal((root.listeners.get('keydown') ?? []).length, 1);
  assert.equal(document.activeElement, renderedControl);
  assert.equal(renderedControl.isConnected, true);
  for (const detachedControl of createdControls.filter((control) => control !== renderedControl)) {
    assert.equal(detachedControl.isConnected, false);
    assert.equal((detachedControl.listeners.get('click') ?? []).length, 0);
  }
});

test('T20 repeated non-empty replacement reentry stays bounded and leaves no residue', async () => {
  const view = await loadView('t20');
  const { document, root } = fakeDom();
  const invoker = new FakeElement('button', document);
  const controller = view.createAgentCommonsReadinessView(root, authenticPresentation());
  const replaceChildren = root.replaceChildren.bind(root);
  let replacementCalls = 0;
  let reentryAttempts = 0;
  root.replaceChildren = (...children) => {
    replaceChildren(...children);
    if (children.length > 0) {
      replacementCalls += 1;
      assert.ok(replacementCalls <= 1, 'render replacement recursed');
      for (let index = 0; index < 5; index += 1) {
        reentryAttempts += 1;
        controller.open({ invoker });
      }
    }
  };

  controller.open({ invoker });

  const renderedControl = descendants(root).find(({ tagName }) => tagName === 'BUTTON');
  assert.equal(replacementCalls, 1);
  assert.equal(reentryAttempts, 5);
  assert.equal(controller.isOpen, true);
  assert.equal((root.listeners.get('keydown') ?? []).length, 1);
  assert.equal(document.activeElement, renderedControl);
  assert.equal(renderedControl.isConnected, true);

  controller.close();
  assert.equal(controller.isOpen, false);
  assert.equal(root.children.length, 0);
  assert.equal((root.listeners.get('keydown') ?? []).length, 0);
  assert.equal((renderedControl.listeners.get('click') ?? []).length, 0);
  assert.equal(document.activeElement, invoker);
});

test('T21 post-mutation replacement failure rolls back every failed open attempt', async () => {
  const view = await loadView('t21');
  const { document, root } = fakeDom();
  const invoker = new FakeElement('button', document);
  const createdControls = [];
  const createElement = document.createElement.bind(document);
  document.createElement = (tagName) => {
    const element = createElement(tagName);
    if (element.tagName === 'BUTTON') createdControls.push(element);
    return element;
  };
  const controller = view.createAgentCommonsReadinessView(root, authenticPresentation());
  const replaceChildren = root.replaceChildren.bind(root);
  const replacementError = new Error('replacement failed after mutation');
  root.replaceChildren = (...children) => {
    replaceChildren(...children);
    if (children.length > 0) throw replacementError;
  };

  for (let attempt = 0; attempt < 2; attempt += 1) {
    assert.throws(() => controller.open({ invoker }), (error) => error === replacementError);
    assert.equal(controller.isOpen, false);
    assert.equal(root.children.length, 0);
    assert.equal((root.listeners.get('keydown') ?? []).length, 0);
    assert.equal(document.activeElement, null);
    assert.equal(invoker.focusCalls, 0);
    for (const control of createdControls) {
      assert.equal((control.listeners.get('click') ?? []).length, 0);
    }
  }
});

test('T22 rollback retries one-shot cleanup failures without residue across failed opens', async () => {
  const view = await loadView('t22');
  const { document, root } = fakeDom();
  const invoker = new FakeElement('button', document);
  const createdControls = [];
  const createElement = document.createElement.bind(document);
  document.createElement = (tagName) => {
    const element = createElement(tagName);
    if (element.tagName === 'BUTTON') {
      createdControls.push(element);
      const removeEventListener = element.removeEventListener.bind(element);
      let failRemoval = true;
      element.removeEventListener = (type, listener) => {
        if (type === 'click' && failRemoval) {
          failRemoval = false;
          throw new Error('one-shot listener cleanup failure');
        }
        removeEventListener(type, listener);
      };
    }
    return element;
  };
  const controller = view.createAgentCommonsReadinessView(root, authenticPresentation());
  const replaceChildren = root.replaceChildren.bind(root);
  const replacementErrors = Array.from(
    { length: 3 },
    (_, index) => new Error(`original replacement failure ${index + 1}`),
  );
  let attempt = 0;
  let failEmptyReplacement = false;
  let emptyReplacementCalls = 0;
  root.replaceChildren = (...children) => {
    if (children.length === 0) {
      emptyReplacementCalls += 1;
      if (failEmptyReplacement) {
        failEmptyReplacement = false;
        throw new Error('one-shot content cleanup failure');
      }
      replaceChildren();
      return;
    }
    replaceChildren(...children);
    failEmptyReplacement = true;
    throw replacementErrors[attempt++];
  };

  for (const replacementError of replacementErrors) {
    assert.throws(() => controller.open({ invoker }), (error) => error === replacementError);
    assert.equal(controller.isOpen, false);
    assert.equal(root.children.length, 0);
    assert.equal((root.listeners.get('keydown') ?? []).length, 0);
    assert.equal(document.activeElement, null);
    assert.equal(invoker.focusCalls, 0);
    for (const control of createdControls) {
      assert.equal((control.listeners.get('click') ?? []).length, 0);
    }
  }
  assert.equal(attempt, 3);
  assert.equal(emptyReplacementCalls, 6);
});
