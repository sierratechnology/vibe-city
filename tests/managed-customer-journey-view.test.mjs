import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import test from 'node:test';

import { createManagedCustomerIdentityDomain } from '../server/managedCustomerIdentityDomain.mjs';
import { createManagedCustomerJourneyPresentation } from '../server/managedCustomerJourneyPresentation.mjs';
import { createManagedFirstAssignmentReadiness } from '../server/managedFirstAssignmentReadiness.mjs';
import { createManagedRepositoryConnectionReadiness } from '../server/managedRepositoryConnectionReadiness.mjs';
import { createManagedStarterAgentReadiness } from '../server/managedStarterAgentReadiness.mjs';
import { createManagedSuiteSelectionPresentation } from '../server/managedSuiteSelectionPresentation.mjs';
import { createManagedSuiteSelectionReadiness } from '../server/managedSuiteSelectionReadiness.mjs';

const VIEW_PATH = '../src/managedCustomerJourneyView.ts';
const SUFFIX = '0000000000000001';

async function loadView(suffix = '') {
  try {
    return await import(`${new URL(VIEW_PATH, import.meta.url).href}?${suffix}`);
  } catch (error) {
    if (error?.code === 'ENOENT') return {};
    if (error?.code === 'ERR_MODULE_NOT_FOUND'
        && error?.url === new URL(VIEW_PATH, import.meta.url).href) return {};
    throw error;
  }
}

function gateObservation(schemaVersion, names, evaluatedAt, offset = 0) {
  const observedAt = new Date(Date.parse(evaluatedAt) - 60_000).toISOString();
  const observation = {
    schemaVersion,
    tenantId: `tenant_${SUFFIX}`,
    accountId: `account_${SUFFIX}`,
    organizationId: `organization_${SUFFIX}`,
    evaluatedAt,
    gates: names.map((name, index) => ({
      name,
      state: index % 2 === 0 ? 'blocked' : 'not_configured',
      sourceRef: `${index + offset + 1}`.padStart(16, '0'),
      observedAt,
    })),
  };
  if (schemaVersion === 'managed-suite-selection-readiness/1') delete observation.accountId;
  return observation;
}

function authenticJourney(journeyFactory = createManagedCustomerJourneyPresentation) {
  const identity = createManagedCustomerIdentityDomain({
    schemaVersion: 'managed-customer-identity/1',
    account: { accountId: `account_${SUFFIX}`, displayLabel: 'Synthetic Account', lifecycle: 'active' },
    organization: {
      organizationId: `organization_${SUFFIX}`,
      displayLabel: 'Synthetic Organization',
      lifecycle: 'active',
    },
    membership: {
      accountId: `account_${SUFFIX}`,
      organizationId: `organization_${SUFFIX}`,
      roleLabel: 'member',
      lifecycle: 'active',
    },
  });
  const suiteReadiness = createManagedSuiteSelectionReadiness(gateObservation(
    'managed-suite-selection-readiness/1',
    ['pricing', 'lease_terms', 'payment', 'refunds', 'tax', 'capacity'],
    '2026-10-04T05:00:00.000Z',
  ));
  const suite = createManagedSuiteSelectionPresentation(identity, suiteReadiness);
  const starter = createManagedStarterAgentReadiness(identity, suite, gateObservation(
    'managed-starter-agent-readiness-observation/1',
    ['suite_commitment', 'hosted_identity', 'provider_selection', 'credential_issuance', 'authority_policy', 'workplace_assignment'],
    '2026-10-04T05:30:00.000Z',
    6,
  ));
  const repository = createManagedRepositoryConnectionReadiness(identity, suite, starter, gateObservation(
    'managed-repository-connection-readiness-observation/1',
    ['repository_identity', 'tenant_binding', 'repository_access', 'data_classification', 'credential_issuance', 'authorization_policy'],
    '2026-10-04T06:00:00.000Z',
    12,
  ));
  const assignment = createManagedFirstAssignmentReadiness(repository, gateObservation(
    'managed-first-assignment-readiness-observation/1',
    ['direction_authorization', 'assignment_definition', 'owner_accountability', 'assignee_identity', 'repository_work_access', 'evidence_plan', 'review_authority', 'outcome_acceptance'],
    '2026-10-04T06:30:00.000Z',
    18,
  ));
  return journeyFactory(identity, suite, starter, repository, assignment);
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

test('T1 authentic presentation opens an exact five-step semantic view', async () => {
  const view = await loadView('t1');
  assert.equal(typeof view.createManagedCustomerJourneyView, 'function');
  const { document, root } = fakeDom();
  const controller = view.createManagedCustomerJourneyView(root, authenticJourney());
  assert.equal(controller.isOpen, false);
  controller.open({ invoker: new FakeElement('button', document) });

  const nodes = descendants(root);
  const dialog = nodes.find(({ tagName }) => tagName === 'SECTION');
  const list = nodes.find(({ tagName }) => tagName === 'OL');
  assert.equal(dialog?.getAttribute('role'), 'dialog');
  assert.equal(dialog?.getAttribute('aria-modal'), 'true');
  assert.equal(nodes.filter(({ tagName }) => tagName === 'H2').length, 1);
  assert.deepEqual(list?.children.map(({ textContent }) => textContent), [
    'Account and organization — Ready',
    'Suite selection — Blocked',
    'Starter agent — Blocked',
    'Repository connection — Blocked',
    'First assignment — Blocked',
  ]);
  assert.equal(controller.isOpen, true);
});

function assertRejectedWithoutEffects(view, presentation, hooks = () => 0) {
  const { document, root } = fakeDom();
  assert.throws(
    () => view.createManagedCustomerJourneyView(root, presentation),
    { name: 'TypeError', message: 'Invalid managed customer journey view input' },
  );
  assert.equal(root.children.length, 0);
  assert.equal([...root.listeners.values()].flat().length, 0);
  assert.equal(root.focusCalls, 0);
  assert.equal(document.activeElement, null);
  assert.equal(hooks(), 0);
}

test('T2 characterization: structural and JSON copies fail before side effects', async () => {
  const view = await loadView('t2');
  const presentation = authenticJourney();
  assertRejectedWithoutEffects(view, { ...presentation });
  assertRejectedWithoutEffects(view, JSON.parse(JSON.stringify(presentation)));
});

test('T3 characterization: descendants fail before side effects', async () => {
  const view = await loadView('t3');
  assertRejectedWithoutEffects(view, Object.create(authenticJourney()));
});

test('T4 characterization: proxies fail without attacker hooks or side effects', async () => {
  const view = await loadView('t4');
  let hooks = 0;
  const proxy = new Proxy(authenticJourney(), {
    get() { hooks += 1; throw new Error('private'); },
    getPrototypeOf() { hooks += 1; throw new Error('private'); },
    ownKeys() { hooks += 1; throw new Error('private'); },
  });
  assertRejectedWithoutEffects(view, proxy, () => hooks);
});

test('T5 characterization: accessor forgeries fail without accessor execution or side effects', async () => {
  const view = await loadView('t5');
  let hooks = 0;
  const forged = Object.defineProperty({}, 'steps', {
    enumerable: true,
    get() { hooks += 1; throw new Error('private'); },
  });
  assertRejectedWithoutEffects(view, forged, () => hooks);
});

test('T6 characterization: foreign-module results fail before side effects', async () => {
  const view = await loadView('t6');
  const foreign = await import('../server/managedCustomerJourneyPresentation.mjs?view-foreign=1');
  assertRejectedWithoutEffects(
    view,
    authenticJourney(foreign.createManagedCustomerJourneyPresentation),
  );
});

test('T7 characterization: null and primitives fail before side effects', async () => {
  const view = await loadView('t7');
  for (const value of [null, undefined, false, 0, '', Symbol('forged')]) {
    assertRejectedWithoutEffects(view, value);
  }
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
    const controller = view.createManagedCustomerJourneyView(root, authenticJourney());
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

test('T9 open states blocked non-authoritative boundaries without private details or actions', async () => {
  const view = await loadView('t9');
  const presentation = authenticJourney();
  const { document, root } = fakeDom();
  view.createManagedCustomerJourneyView(root, presentation)
    .open({ invoker: new FakeElement('button', document) });

  const nodes = descendants(root);
  const renderedText = nodes.map(({ textContent }) => textContent).join('\n');
  assert.match(renderedText, /Overall status: Blocked/);
  assert.match(renderedText, /informational and non-authoritative/);
  assert.match(renderedText, /no access or authority/i);
  assert.match(renderedText, /no commitment/i);
  assert.match(renderedText, /Costs and recurring obligations are not presented/);
  assert.match(renderedText, /No hosted agent, repository connection, durable first assignment, review, evidence, or completion is created/);
  assert.match(renderedText, /Evaluated at: 2026-10-04T06:30:00.000Z/);
  for (const privateText of [presentation.tenantId, presentation.accountId, presentation.organizationId]) {
    assert.equal(renderedText.includes(privateText), false);
  }
  const buttons = nodes.filter(({ tagName }) => tagName === 'BUTTON');
  assert.equal(buttons.length, 1);
  assert.equal(buttons[0].textContent, 'Close guided journey');
  assert.equal(buttons[0].getAttribute('aria-label'), 'Close guided journey');
});

test('T10 Enter Space and click activate the only close control', async () => {
  const view = await loadView('t10');
  const { document, root } = fakeDom();
  const invoker = new FakeElement('button', document);
  const controller = view.createManagedCustomerJourneyView(root, authenticJourney());

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

test('T11 characterization: Escape Tab repeated open and focus restoration stay bounded', async () => {
  const view = await loadView('t11');
  const { document, root } = fakeDom();
  const invoker = new FakeElement('button', document);
  const controller = view.createManagedCustomerJourneyView(root, authenticJourney());

  controller.open({ invoker });
  controller.open({ invoker });
  assert.equal((root.listeners.get('keydown') ?? []).length, 1);
  let closeButton = descendants(root).find(({ tagName }) => tagName === 'BUTTON');
  const tab = root.dispatch('keydown', { key: 'Tab', target: closeButton });
  assert.equal(tab.defaultPrevented, true);
  assert.equal(document.activeElement, closeButton);
  root.dispatch('keydown', { key: 'Escape', target: closeButton });
  assert.equal(controller.isOpen, false);
  assert.equal(document.activeElement, invoker);
  assert.equal((root.listeners.get('keydown') ?? []).length, 0);

  controller.open({ invoker });
  invoker.isConnected = false;
  closeButton = descendants(root).find(({ tagName }) => tagName === 'BUTTON');
  root.dispatch('keydown', { key: 'Escape', target: closeButton });
  assert.equal(document.activeElement, root);
  assert.equal(root.getAttribute('tabindex'), '-1');
});

test('T15 close and repeated open remove listeners from retained Close controls', async () => {
  const view = await loadView('t15');
  const { document, root } = fakeDom();
  const invoker = new FakeElement('button', document);
  const controller = view.createManagedCustomerJourneyView(root, authenticJourney());

  controller.open({ invoker });
  const explicitlyClosedControl = descendants(root).find(({ tagName }) => tagName === 'BUTTON');
  assert.equal((explicitlyClosedControl.listeners.get('click') ?? []).length, 1);
  controller.close();
  assert.equal((explicitlyClosedControl.listeners.get('click') ?? []).length, 0);

  controller.open({ invoker });
  const replacedControl = descendants(root).find(({ tagName }) => tagName === 'BUTTON');
  assert.equal((replacedControl.listeners.get('click') ?? []).length, 1);
  controller.open({ invoker });
  assert.equal((replacedControl.listeners.get('click') ?? []).length, 0);

  const nestedInvoker = new FakeElement('button', document);
  let nestedControl;
  let reentered = false;
  invoker.focus = function focusWithReentrantOpen() {
    FakeElement.prototype.focus.call(this);
    if (!reentered) {
      reentered = true;
      controller.open({ invoker: nestedInvoker });
      nestedControl = descendants(root).find(({ tagName }) => tagName === 'BUTTON');
    }
  };
  controller.open({ invoker });
  assert.equal((nestedControl.listeners.get('click') ?? []).length, 0);
});

test('T16 repeated open retires a nested generation created during content teardown', async () => {
  const view = await loadView('t16');
  const { document, root } = fakeDom();
  const invoker = new FakeElement('button', document);
  const nestedInvoker = new FakeElement('button', document);
  const controller = view.createManagedCustomerJourneyView(root, authenticJourney());
  const replaceChildren = root.replaceChildren.bind(root);
  let nestedControl;
  let reentered = false;
  root.replaceChildren = (...children) => {
    replaceChildren(...children);
    if (children.length === 0 && !reentered) {
      reentered = true;
      controller.open({ invoker: nestedInvoker });
      nestedControl = descendants(root).find(({ tagName }) => tagName === 'BUTTON');
    }
  };

  controller.open({ invoker });
  controller.open({ invoker });

  assert.equal((nestedControl.listeners.get('click') ?? []).length, 0);
});

test('T17 explicit close retires a nested generation created during content teardown', async () => {
  const view = await loadView('t17');
  const { document, root } = fakeDom();
  const invoker = new FakeElement('button', document);
  const nestedInvoker = new FakeElement('button', document);
  const controller = view.createManagedCustomerJourneyView(root, authenticJourney());
  const replaceChildren = root.replaceChildren.bind(root);
  let nestedControl;
  let reentered = false;
  root.replaceChildren = (...children) => {
    replaceChildren(...children);
    if (children.length === 0 && !reentered) {
      reentered = true;
      controller.open({ invoker: nestedInvoker });
      nestedControl = descendants(root).find(({ tagName }) => tagName === 'BUTTON');
    }
  };

  controller.open({ invoker });
  controller.close();

  assert.equal((nestedControl.listeners.get('click') ?? []).length, 0);
  assert.equal(controller.isOpen, false);
});

test('T18 explicit close retires bounded nested generations created during listener removal', async () => {
  const view = await loadView('t18');
  const { document, root } = fakeDom();
  const invoker = new FakeElement('button', document);
  const nestedInvokers = Array.from({ length: 4 }, () => new FakeElement('button', document));
  const controller = view.createManagedCustomerJourneyView(root, authenticJourney());
  const removeEventListener = FakeElement.prototype.removeEventListener;
  const retainedControls = [];
  let reentryCount = 0;

  controller.open({ invoker });
  try {
    FakeElement.prototype.removeEventListener = function removeWithReentrantOpen(type, listener) {
      removeEventListener.call(this, type, listener);
      if (type === 'click' && reentryCount < nestedInvokers.length) {
        controller.open({ invoker: nestedInvokers[reentryCount] });
        reentryCount += 1;
        const nestedControl = descendants(root).find(({ tagName }) => tagName === 'BUTTON');
        if (nestedControl !== undefined && nestedControl !== this) {
          retainedControls.push(nestedControl);
        }
      }
    };
    controller.close();
  } finally {
    FakeElement.prototype.removeEventListener = removeEventListener;
  }

  assert.equal(reentryCount > 0 && reentryCount <= nestedInvokers.length, true);
  for (const control of retainedControls) {
    assert.equal((control.listeners.get('click') ?? []).length, 0);
  }
  assert.equal(controller.isOpen, false);
});

test('T19 nested open during non-empty render leaves only the winning generation active', async () => {
  const view = await loadView('t19');
  const { document, root } = fakeDom();
  const outerInvoker = new FakeElement('button', document);
  const nestedInvoker = new FakeElement('button', document);
  const controller = view.createManagedCustomerJourneyView(root, authenticJourney());
  const replaceChildren = root.replaceChildren.bind(root);
  let outerControl;
  let activeControl;
  let reentered = false;

  root.replaceChildren = (...children) => {
    replaceChildren(...children);
    if (children.length > 0 && !reentered) {
      reentered = true;
      outerControl = descendants(root).find(({ tagName }) => tagName === 'BUTTON');
      controller.open({ invoker: nestedInvoker });
      activeControl = descendants(root).find(({ tagName }) => tagName === 'BUTTON');
    }
  };

  controller.open({ invoker: outerInvoker });

  assert.equal(controller.isOpen, true);
  assert.equal((root.listeners.get('keydown') ?? []).length, 1);
  assert.equal((outerControl.listeners.get('click') ?? []).length, 0);
  assert.equal((activeControl.listeners.get('click') ?? []).length, 1);
  assert.equal(activeControl.parentNode.parentNode, root);
  assert.equal(document.activeElement, activeControl);
  assert.equal(outerControl.parentNode.parentNode, null);
  assert.equal(outerControl.focusCalls, 0);
});

test('T20 characterization: repeated non-empty render reentry stays bounded and closes cleanly', async () => {
  const view = await loadView('t20');
  const { document, root } = fakeDom();
  const outerInvoker = new FakeElement('button', document);
  const nestedInvokers = Array.from({ length: 4 }, () => new FakeElement('button', document));
  const controller = view.createManagedCustomerJourneyView(root, authenticJourney());
  const replaceChildren = root.replaceChildren.bind(root);
  const retainedControls = [];
  let reentryCount = 0;

  root.replaceChildren = (...children) => {
    replaceChildren(...children);
    if (children.length > 0 && reentryCount < nestedInvokers.length) {
      retainedControls.push(descendants(root).find(({ tagName }) => tagName === 'BUTTON'));
      const nestedInvoker = nestedInvokers[reentryCount];
      reentryCount += 1;
      controller.open({ invoker: nestedInvoker });
    }
  };

  controller.open({ invoker: outerInvoker });

  const activeControl = descendants(root).find(({ tagName }) => tagName === 'BUTTON');
  assert.equal(reentryCount > 1 && reentryCount <= nestedInvokers.length, true);
  assert.equal(controller.isOpen, true);
  assert.equal((root.listeners.get('keydown') ?? []).length, 1);
  assert.equal(document.activeElement, activeControl);
  for (const control of retainedControls.filter((item) => item !== activeControl)) {
    assert.equal((control.listeners.get('click') ?? []).length, 0);
    assert.equal(control.focusCalls, 0);
  }
  assert.equal((activeControl.listeners.get('click') ?? []).length, 1);

  controller.close();

  assert.equal(controller.isOpen, false);
  assert.equal((root.listeners.get('keydown') ?? []).length, 0);
  for (const control of retainedControls) {
    assert.equal((control.listeners.get('click') ?? []).length, 0);
  }
});

test('T21 connected invoker focus reentry that throws closes without owned residue', async () => {
  const view = await loadView('t21');
  const { document, root } = fakeDom();
  const outerInvoker = new FakeElement('button', document);
  const nestedInvoker = new FakeElement('button', document);
  const controller = view.createManagedCustomerJourneyView(root, authenticJourney());
  const sentinel = new Error('focus failure');
  let outerControl;
  let nestedControl;

  controller.open({ invoker: outerInvoker });
  outerControl = descendants(root).find(({ tagName }) => tagName === 'BUTTON');
  outerInvoker.focus = function focusWithReentrantOpenAndThrow() {
    FakeElement.prototype.focus.call(this);
    controller.open({ invoker: nestedInvoker });
    nestedControl = descendants(root).find(({ tagName }) => tagName === 'BUTTON');
    throw sentinel;
  };

  let thrown;
  try {
    controller.close();
  } catch (error) {
    thrown = error;
  }

  assert.equal(thrown, sentinel);
  assert.equal(controller.isOpen, false);
  assert.equal(root.children.length, 0);
  assert.equal((root.listeners.get('keydown') ?? []).length, 0);
  assert.equal((outerControl.listeners.get('click') ?? []).length, 0);
  assert.equal((nestedControl.listeners.get('click') ?? []).length, 0);
  assert.equal(outerControl.parentNode.parentNode, null);
  assert.equal(nestedControl.parentNode.parentNode, null);
});

test('T22 root fallback focus reentry that throws closes without owned residue', async () => {
  const view = await loadView('t22');
  const { document, root } = fakeDom();
  const disconnectedInvoker = new FakeElement('button', document);
  const nestedInvoker = new FakeElement('button', document);
  const controller = view.createManagedCustomerJourneyView(root, authenticJourney());
  const sentinel = new Error('fallback focus failure');
  let outerControl;
  let nestedControl;

  controller.open({ invoker: disconnectedInvoker });
  outerControl = descendants(root).find(({ tagName }) => tagName === 'BUTTON');
  disconnectedInvoker.isConnected = false;
  root.focus = function fallbackFocusWithReentrantOpenAndThrow() {
    FakeElement.prototype.focus.call(this);
    controller.open({ invoker: nestedInvoker });
    nestedControl = descendants(root).find(({ tagName }) => tagName === 'BUTTON');
    throw sentinel;
  };

  let thrown;
  try {
    controller.close();
  } catch (error) {
    thrown = error;
  }

  assert.equal(thrown, sentinel);
  assert.equal(controller.isOpen, false);
  assert.equal(root.children.length, 0);
  assert.equal((root.listeners.get('keydown') ?? []).length, 0);
  assert.equal((outerControl.listeners.get('click') ?? []).length, 0);
  assert.equal((nestedControl.listeners.get('click') ?? []).length, 0);
  assert.equal(outerControl.parentNode.parentNode, null);
  assert.equal(nestedControl.parentNode.parentNode, null);
});

test('T23 focus and keydown cleanup errors preserve focus error without owned residue', async () => {
  const view = await loadView('t23');
  const { document, root } = fakeDom();
  const outerInvoker = new FakeElement('button', document);
  const nestedInvoker = new FakeElement('button', document);
  const controller = view.createManagedCustomerJourneyView(root, authenticJourney());
  const focusError = new Error('focus failure');
  const cleanupError = new Error('cleanup failure');
  const removeEventListener = root.removeEventListener.bind(root);
  let outerControl;
  let nestedControl;

  controller.open({ invoker: outerInvoker });
  outerControl = descendants(root).find(({ tagName }) => tagName === 'BUTTON');
  outerInvoker.focus = function focusWithReentrantOpenAndCleanupError() {
    FakeElement.prototype.focus.call(this);
    controller.open({ invoker: nestedInvoker });
    nestedControl = descendants(root).find(({ tagName }) => tagName === 'BUTTON');
    root.removeEventListener = (type, listener) => {
      removeEventListener(type, listener);
      if (type === 'keydown') throw cleanupError;
    };
    throw focusError;
  };

  let thrown;
  try {
    controller.close();
  } catch (error) {
    thrown = error;
  }

  assert.equal(thrown, focusError);
  assert.equal(controller.isOpen, false);
  assert.equal(root.children.length, 0);
  assert.equal((root.listeners.get('keydown') ?? []).length, 0);
  assert.equal((outerControl.listeners.get('click') ?? []).length, 0);
  assert.equal((nestedControl.listeners.get('click') ?? []).length, 0);
  assert.equal(outerControl.parentNode.parentNode, null);
  assert.equal(nestedControl.parentNode.parentNode, null);
});

test('T24 characterization: cleanup error after successful focus is preserved without residue', async () => {
  const view = await loadView('t24');
  const { document, root } = fakeDom();
  const outerInvoker = new FakeElement('button', document);
  const nestedInvoker = new FakeElement('button', document);
  const controller = view.createManagedCustomerJourneyView(root, authenticJourney());
  const cleanupError = new Error('cleanup failure');
  const removeEventListener = root.removeEventListener.bind(root);
  let outerControl;
  let nestedControl;

  controller.open({ invoker: outerInvoker });
  outerControl = descendants(root).find(({ tagName }) => tagName === 'BUTTON');
  outerInvoker.focus = function focusWithReentrantOpenAndCleanupError() {
    FakeElement.prototype.focus.call(this);
    controller.open({ invoker: nestedInvoker });
    nestedControl = descendants(root).find(({ tagName }) => tagName === 'BUTTON');
    root.removeEventListener = (type, listener) => {
      removeEventListener(type, listener);
      if (type === 'keydown') throw cleanupError;
    };
  };

  assert.throws(() => controller.close(), (error) => error === cleanupError);
  assert.equal(controller.isOpen, false);
  assert.equal(root.children.length, 0);
  assert.equal((root.listeners.get('keydown') ?? []).length, 0);
  assert.equal((outerControl.listeners.get('click') ?? []).length, 0);
  assert.equal((nestedControl.listeners.get('click') ?? []).length, 0);
  assert.equal(outerControl.parentNode.parentNode, null);
  assert.equal(nestedControl.parentNode.parentNode, null);
});

test('T25 characterization: Close listener cleanup error still retires content and root listener', async () => {
  const view = await loadView('t25');
  const { document, root } = fakeDom();
  const invoker = new FakeElement('button', document);
  const controller = view.createManagedCustomerJourneyView(root, authenticJourney());
  const cleanupError = new Error('Close listener cleanup failure');

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
  assert.equal(closeControl.parentNode.parentNode, null);
});

test('T26 characterization: content cleanup error still retires one nested generation', async () => {
  const view = await loadView('t26');
  const { document, root } = fakeDom();
  const outerInvoker = new FakeElement('button', document);
  const nestedInvoker = new FakeElement('button', document);
  const controller = view.createManagedCustomerJourneyView(root, authenticJourney());
  const cleanupError = new Error('content cleanup failure');
  const replaceChildren = root.replaceChildren.bind(root);
  let outerControl;
  let nestedControl;
  let reentered = false;

  controller.open({ invoker: outerInvoker });
  outerControl = descendants(root).find(({ tagName }) => tagName === 'BUTTON');
  root.replaceChildren = (...children) => {
    replaceChildren(...children);
    if (children.length === 0 && !reentered) {
      reentered = true;
      controller.open({ invoker: nestedInvoker });
      nestedControl = descendants(root).find(({ tagName }) => tagName === 'BUTTON');
      throw cleanupError;
    }
  };

  assert.throws(() => controller.close(), (error) => error === cleanupError);
  assert.equal(controller.isOpen, false);
  assert.equal(root.children.length, 0);
  assert.equal((root.listeners.get('keydown') ?? []).length, 0);
  assert.equal((outerControl.listeners.get('click') ?? []).length, 0);
  assert.equal((nestedControl.listeners.get('click') ?? []).length, 0);
  assert.equal(outerControl.parentNode.parentNode, null);
  assert.equal(nestedControl.parentNode.parentNode, null);
});

test('T12 view exposes touch zoom overflow and reduced-motion contracts', async () => {
  const view = await loadView('t12');
  assert.equal(typeof view.MANAGED_CUSTOMER_JOURNEY_VIEW_CSS, 'string');
  assert.match(view.MANAGED_CUSTOMER_JOURNEY_VIEW_CSS, /max-inline-size:\s*48rem/);
  assert.match(view.MANAGED_CUSTOMER_JOURNEY_VIEW_CSS, /max-block-size:\s*90vh/);
  assert.match(view.MANAGED_CUSTOMER_JOURNEY_VIEW_CSS, /overflow:\s*auto/);
  assert.match(view.MANAGED_CUSTOMER_JOURNEY_VIEW_CSS, /overflow-wrap:\s*anywhere/);
  assert.match(view.MANAGED_CUSTOMER_JOURNEY_VIEW_CSS, /font-size:\s*1rem/);
  assert.match(view.MANAGED_CUSTOMER_JOURNEY_VIEW_CSS, /min-inline-size:\s*2\.75rem/);
  assert.match(view.MANAGED_CUSTOMER_JOURNEY_VIEW_CSS, /min-block-size:\s*2\.75rem/);
  assert.match(view.MANAGED_CUSTOMER_JOURNEY_VIEW_CSS, /prefers-reduced-motion:\s*reduce/);
  assert.match(view.MANAGED_CUSTOMER_JOURNEY_VIEW_CSS, /animation:\s*none/);
  assert.match(view.MANAGED_CUSTOMER_JOURNEY_VIEW_CSS, /transition:\s*none/);

  const { document, root } = fakeDom();
  view.createManagedCustomerJourneyView(root, authenticJourney())
    .open({ invoker: new FakeElement('button', document) });
  const nodes = descendants(root);
  assert.equal(nodes.filter(({ tagName }) => tagName === 'STYLE').length, 1);
  const closeButton = nodes.find(({ tagName }) => tagName === 'BUTTON');
  assert.equal(closeButton.getAttribute('class'), 'managed-customer-journey-control');
});

test('T13 post-import ambient replacements cannot observe validation or dormant creation', async () => {
  const view = await loadView('t13');
  const OriginalTypeError = globalThis.TypeError;
  const originalFreeze = Object.freeze;
  const originalFetch = globalThis.fetch;
  const originalSetTimeout = globalThis.setTimeout;
  let hooks = 0;
  let error;
  try {
    globalThis.TypeError = function HostileTypeError(...args) {
      hooks += 1;
      return new OriginalTypeError(...args);
    };
    Object.freeze = (...args) => { hooks += 1; return originalFreeze(...args); };
    globalThis.fetch = () => { hooks += 1; throw new Error('network'); };
    globalThis.setTimeout = () => { hooks += 1; throw new Error('timer'); };
    try {
      view.createManagedCustomerJourneyView(fakeDom().root, null);
    } catch (caught) {
      error = caught;
    }
    const { root } = fakeDom();
    const controller = view.createManagedCustomerJourneyView(root, authenticJourney());
    assert.equal(controller.isOpen, false);
  } finally {
    globalThis.TypeError = OriginalTypeError;
    Object.freeze = originalFreeze;
    globalThis.fetch = originalFetch;
    globalThis.setTimeout = originalSetTimeout;
  }
  assert.equal(Object.getPrototypeOf(error), OriginalTypeError.prototype);
  assert.equal(error.message, 'Invalid managed customer journey view input');
  assert.equal(hooks, 0);
});

test('T14 characterization: renderer is text-only and dormant outside its own source file', async () => {
  const sourceRoot = new URL('../src/', import.meta.url);
  const source = await readFile(new URL('managedCustomerJourneyView.ts', sourceRoot), 'utf8');
  assert.equal(/\b(?:innerHTML|outerHTML|insertAdjacentHTML|document\.write)\b/.test(source), false);
  assert.equal(/\b(?:fetch|XMLHttpRequest|WebSocket|localStorage|sessionStorage|indexedDB|setTimeout|setInterval)\b/.test(source), false);
  assert.equal(/\b(?:process|Deno|Bun|node:fs|node:child_process)\b/.test(source), false);
  assert.match(source, /\.textContent\s*=/);
  assert.match(source, /\.createElement\(/);

  const paths = (await readdir(sourceRoot, { recursive: true }))
    .filter((path) => path.endsWith('.ts'))
    .filter((path) => path !== 'managedCustomerJourneyView.ts');
  const importers = [];
  for (const path of paths) {
    const runtimeSource = await readFile(new URL(path, sourceRoot), 'utf8');
    if (/managedCustomerJourneyView/.test(runtimeSource)) importers.push(path);
  }
  assert.deepEqual(importers, []);
});
