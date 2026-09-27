import { isPrivateRecordsSemanticView } from './privateRecordsPresentation.js';

type SemanticLink = Readonly<{
  kind: string;
  label: string;
  state: string;
  stateText: string;
  sequence: number;
  occurredAt: string | null;
  actionAvailable: boolean;
  actionToken?: string;
}>;

type SemanticView = Readonly<{
  recordId: string;
  title: string;
  stateText: string;
  freshnessText: string;
  links: readonly SemanticLink[];
}>;

type Action = Readonly<{ recordId: string; kind: string; actionToken: string }>;

type ElementLike = HTMLElement;

export const PRIVATE_RECORDS_VIEW_CSS = `
[data-private-records-view] {
  box-sizing: border-box;
  inline-size: 100%;
  max-inline-size: 48rem;
  max-block-size: 90vh;
  overflow: auto;
  overflow-wrap: anywhere;
  font-size: 1rem;
  line-height: 1.5;
}
[data-private-records-view] .private-records-control {
  min-inline-size: 2.75rem;
  min-block-size: 2.75rem;
  font: inherit;
}
@media (prefers-reduced-motion: reduce) {
  [data-private-records-view], [data-private-records-view] * {
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

export function createPrivateRecordsView({
  root,
  semantic,
  onAction,
}: {
  root: ElementLike;
  semantic: SemanticView;
  onAction: (action: Action) => void;
}) {
  if (!isPrivateRecordsSemanticView(semantic)) {
    throw new TypeError('Invalid private records semantic view');
  }
  let open = false;
  let invoker: ElementLike | null = null;
  let controls: ElementLike[] = [];
  const actions = new Map<EventTarget, Action>();

  function keydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
      return;
    }
    const target = event.target as EventTarget;
    const action = actions.get(target);
    if ((event.key === 'Enter' || event.key === ' ') && action) {
      event.preventDefault();
      onAction(action);
      return;
    }
    if (event.key !== 'Tab' || controls.length === 0) return;
    const first = controls[0];
    const last = controls[controls.length - 1];
    if (event.shiftKey && target === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && target === last) {
      event.preventDefault();
      first.focus();
    }
  }

  function close(): void {
    if (!open) return;
    open = false;
    root.removeEventListener('keydown', keydown);
    root.replaceChildren();
    controls = [];
    actions.clear();
    if (invoker?.isConnected) {
      invoker.focus();
    } else {
      root.setAttribute('tabindex', '-1');
      root.focus();
    }
  }

  function render(): void {
    const document = root.ownerDocument;
    const style = document.createElement('style');
    style.textContent = PRIVATE_RECORDS_VIEW_CSS;
    const panel = document.createElement('section');
    panel.setAttribute('data-private-records-view', '');
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'true');
    panel.setAttribute('aria-label', 'Private Records');
    panel.append(
      textElement(document, 'h2', semantic.title),
      textElement(document, 'p', semantic.stateText),
      textElement(document, 'p', semantic.freshnessText),
    );
    const list = document.createElement('ol');
    for (const link of semantic.links) {
      const item = document.createElement('li');
      item.append(textElement(document, 'span', link.stateText));
      if (link.occurredAt !== null) {
        item.append(textElement(document, 'time', `Occurred: ${link.occurredAt}`));
      }
      if (link.actionAvailable && link.actionToken) {
        const button = textElement(document, 'button', `Open ${link.label}`);
        button.setAttribute('type', 'button');
        button.setAttribute('class', 'private-records-control');
        button.setAttribute('data-record-action', link.kind);
        button.setAttribute('aria-label', `Open authorized ${link.label}`);
        const action = {
          recordId: semantic.recordId,
          kind: link.kind,
          actionToken: link.actionToken as string,
        };
        actions.set(button, action);
        button.addEventListener('click', () => onAction(action));
        controls.push(button);
        item.append(button);
      }
      list.append(item);
    }
    const closeButton = textElement(document, 'button', 'Close private Records');
    closeButton.setAttribute('type', 'button');
    closeButton.setAttribute('class', 'private-records-control');
    closeButton.setAttribute('aria-label', 'Close private Records');
    closeButton.addEventListener('click', close);
    controls.push(closeButton);
    panel.append(list, closeButton);
    root.replaceChildren(style, panel);
    root.addEventListener('keydown', keydown);
    controls[0].focus();
  }

  return Object.freeze({
    open({ invoker: nextInvoker }: { invoker: ElementLike }) {
      if (open) close();
      open = true;
      invoker = nextInvoker;
      render();
    },
    close,
    get isOpen() { return open; },
  });
}
