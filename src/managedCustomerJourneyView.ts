// The accepted server module is intentionally JavaScript-only.
// @ts-expect-error No declaration file is published for this dormant boundary.
import { createManagedCustomerJourneyPresentation } from '../server/managedCustomerJourneyPresentation.mjs';

const TypeErrorIntrinsic = TypeError;
const objectFreeze = Object.freeze;
const isAuthenticPresentation = createManagedCustomerJourneyPresentation.isAuthenticResult;

type ManagedJourneyPresentation = Readonly<{
  evaluatedAt: string;
  steps: readonly Readonly<{ name: string; state: string }>[];
}>;

type ElementLike = HTMLElement;

const STEP_LABELS = [
  'Account and organization',
  'Suite selection',
  'Starter agent',
  'Repository connection',
  'First assignment',
] as const;

export const MANAGED_CUSTOMER_JOURNEY_VIEW_CSS = `
[data-managed-customer-journey-view] {
  box-sizing: border-box;
  inline-size: 100%;
  max-inline-size: 48rem;
  max-block-size: 90vh;
  overflow: auto;
  overflow-wrap: anywhere;
  font-size: 1rem;
  line-height: 1.5;
}
[data-managed-customer-journey-view] .managed-customer-journey-control {
  min-inline-size: 2.75rem;
  min-block-size: 2.75rem;
  font: inherit;
}
@media (prefers-reduced-motion: reduce) {
  [data-managed-customer-journey-view], [data-managed-customer-journey-view] * {
    animation: none;
    transition: none;
    scroll-behavior: auto;
  }
}`;

function textElement(document: Document, tag: string, text: string): HTMLElement {
  const element = document.createElement(tag);
  element.textContent = text;
  return element;
}

export function createManagedCustomerJourneyView(
  root: ElementLike,
  presentation: ManagedJourneyPresentation,
) {
  if (!isAuthenticPresentation(presentation)) {
    throw new TypeErrorIntrinsic('Invalid managed customer journey view input');
  }

  type Generation = { invoker: ElementLike; closeControl: ElementLike };
  let generation: Generation | null = null;
  let renderInProgress = false;
  let suppressReentrantOpen = false;

  function keydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
      return;
    }
    if (event.target === generation?.closeControl && (event.key === 'Enter' || event.key === ' ')) {
      event.preventDefault();
      close();
      return;
    }
    if (event.key === 'Tab' && generation !== null) {
      event.preventDefault();
      generation.closeControl.focus();
    }
  }

  function takeGeneration(): Generation | null {
    const current = generation;
    generation = null;
    return current;
  }

  type CleanupError = { threw: boolean; error: unknown };

  function attemptCleanup(cleanup: CleanupError, operation: () => void): void {
    try {
      operation();
    } catch (error) {
      if (!cleanup.threw) {
        cleanup.threw = true;
        cleanup.error = error;
      }
    }
  }

  function removeOwnedListeners(retiring: Generation, cleanup: CleanupError): void {
    const previousSuppression = suppressReentrantOpen;
    suppressReentrantOpen = true;
    try {
      attemptCleanup(cleanup, () => root.removeEventListener('keydown', keydown));
      attemptCleanup(cleanup, () => retiring.closeControl.removeEventListener('click', close));
    } finally {
      suppressReentrantOpen = previousSuppression;
    }
  }

  function teardown(): Generation | null {
    const retiring = takeGeneration();
    if (retiring === null) return null;
    const cleanup: CleanupError = { threw: false, error: undefined };
    removeOwnedListeners(retiring, cleanup);
    attemptCleanup(cleanup, () => root.replaceChildren());
    const reentrant = takeGeneration();
    if (reentrant !== null) {
      const previousSuppression = suppressReentrantOpen;
      suppressReentrantOpen = true;
      try {
        removeOwnedListeners(reentrant, cleanup);
        attemptCleanup(cleanup, () => root.replaceChildren());
      } finally {
        suppressReentrantOpen = previousSuppression;
      }
    }
    if (cleanup.threw) throw cleanup.error;
    return retiring;
  }

  function close(): void {
    const retiring = teardown();
    if (retiring === null) return;
    let focusThrew = false;
    let focusError: unknown;
    try {
      if (retiring.invoker.isConnected) {
        retiring.invoker.focus();
      } else {
        root.setAttribute('tabindex', '-1');
        root.focus();
      }
    } catch (error) {
      focusThrew = true;
      focusError = error;
    }
    try {
      if (generation !== null) teardown();
    } catch (error) {
      if (!focusThrew) throw error;
    }
    if (focusThrew) throw focusError;
  }

  function render(nextInvoker: ElementLike): void {
    const document = root.ownerDocument;
    const style = document.createElement('style');
    style.textContent = MANAGED_CUSTOMER_JOURNEY_VIEW_CSS;
    const panel = document.createElement('section');
    panel.setAttribute('data-managed-customer-journey-view', '');
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'true');
    panel.setAttribute('aria-labelledby', 'managed-customer-journey-heading');
    const heading = textElement(document, 'h2', 'Guided customer journey');
    heading.setAttribute('id', 'managed-customer-journey-heading');
    panel.append(
      heading,
      textElement(
        document,
        'p',
        'Overall status: Blocked. This view is informational and non-authoritative; '
          + 'it grants no access or authority and offers no commitment.',
      ),
      textElement(document, 'p', `Evaluated at: ${presentation.evaluatedAt}`),
      textElement(
        document,
        'p',
        'Costs and recurring obligations are not presented. No hosted agent, repository '
          + 'connection, durable first assignment, review, evidence, or completion is created.',
      ),
    );
    const list = document.createElement('ol');
    for (let index = 0; index < 5; index += 1) {
      const state = presentation.steps[index].state === 'ready' ? 'Ready' : 'Blocked';
      list.append(textElement(document, 'li', `${STEP_LABELS[index]} — ${state}`));
    }
    const closeButton = textElement(document, 'button', 'Close guided journey');
    closeButton.setAttribute('type', 'button');
    closeButton.setAttribute('class', 'managed-customer-journey-control');
    closeButton.setAttribute('aria-label', 'Close guided journey');
    closeButton.addEventListener('click', close);
    const nextGeneration = { invoker: nextInvoker, closeControl: closeButton };
    generation = nextGeneration;
    panel.append(list, closeButton);
    const previousRenderInProgress = renderInProgress;
    renderInProgress = true;
    try {
      root.replaceChildren(style, panel);
      if (generation !== nextGeneration) return;
      root.addEventListener('keydown', keydown);
      if (generation !== nextGeneration) return;
      closeButton.focus();
    } finally {
      renderInProgress = previousRenderInProgress;
    }
  }

  return objectFreeze({
    open({ invoker: nextInvoker }: { invoker: ElementLike }) {
      if (suppressReentrantOpen) return;
      const previousSuppression = suppressReentrantOpen;
      if (renderInProgress) suppressReentrantOpen = true;
      try {
        if (generation !== null) {
          close();
          if (generation !== null) teardown();
        }
        render(nextInvoker);
      } finally {
        suppressReentrantOpen = previousSuppression;
      }
    },
    close,
    get isOpen() { return generation !== null; },
  });
}
