import {
  createAgentCommonsReadinessPresentation,
  type AgentCommonsReadinessPresentation,
} from './domain/agentCommonsSharedSpace.ts';

const objectFreeze = Object.freeze;
const TypeErrorIntrinsic = TypeError;
const isAuthenticPresentation = (
  createAgentCommonsReadinessPresentation as typeof createAgentCommonsReadinessPresentation & {
    isAuthenticResult(value: unknown): boolean;
  }
).isAuthenticResult;

export const AGENT_COMMONS_READINESS_VIEW_CSS = `
[data-agent-commons-readiness-view] {
  box-sizing: border-box;
  inline-size: 100%;
  max-inline-size: 48rem;
  max-block-size: 90vh;
  overflow: auto;
  overflow-wrap: anywhere;
  font-size: 1rem;
  line-height: 1.5;
}
[data-agent-commons-readiness-view] .agent-commons-readiness-control {
  min-inline-size: 2.75rem;
  min-block-size: 2.75rem;
  font: inherit;
}
@media (prefers-reduced-motion: reduce) {
  [data-agent-commons-readiness-view], [data-agent-commons-readiness-view] * {
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

export function createAgentCommonsReadinessView(
  root: HTMLElement,
  presentation: AgentCommonsReadinessPresentation,
) {
  if (arguments.length !== 2 || !isAuthenticPresentation(presentation)) {
    throw new TypeErrorIntrinsic('Invalid Agent Commons readiness view input');
  }
  let open = false;
  let replacingContent = false;
  let invoker: HTMLElement | null = null;
  let closeControl: HTMLElement | null = null;

  function keydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
      return;
    }
    if (event.target === closeControl && (event.key === 'Enter' || event.key === ' ')) {
      event.preventDefault();
      close();
      return;
    }
    if (event.key === 'Tab' && closeControl !== null) {
      event.preventDefault();
      closeControl.focus();
    }
  }

  function close(): void {
    if (!open) return;
    open = false;
    const retiringControl = closeControl;
    const retiringInvoker = invoker;
    closeControl = null;
    invoker = null;
    let firstError: unknown;
    const attempt = (operation: () => void): void => {
      try {
        operation();
      } catch (error) {
        if (firstError === undefined) firstError = error;
      }
    };
    attempt(() => root.removeEventListener('keydown', keydown));
    if (retiringControl !== null) {
      attempt(() => retiringControl.removeEventListener('click', close));
    }
    attempt(() => root.replaceChildren());
    if (retiringInvoker?.isConnected) {
      attempt(() => retiringInvoker.focus());
    } else {
      attempt(() => root.setAttribute('tabindex', '-1'));
      attempt(() => root.focus());
    }
    if (open) {
      const reentrantControl = closeControl as HTMLElement | null;
      open = false;
      closeControl = null;
      invoker = null;
      attempt(() => root.removeEventListener('keydown', keydown));
      if (reentrantControl !== null) {
        attempt(() => reentrantControl.removeEventListener('click', close));
      }
      attempt(() => root.replaceChildren());
    }
    if (firstError !== undefined) throw firstError;
  }

  return objectFreeze({
    open({ invoker: nextInvoker }: { invoker: HTMLElement }) {
      if (replacingContent) return;
      if (open) close();
      const document = root.ownerDocument;
      const style = document.createElement('style');
      style.textContent = AGENT_COMMONS_READINESS_VIEW_CSS;
      const panel = document.createElement('section');
      panel.setAttribute('data-agent-commons-readiness-view', '');
      panel.setAttribute('role', 'dialog');
      panel.setAttribute('aria-modal', 'true');
      panel.setAttribute('aria-labelledby', 'agent-commons-readiness-heading');
      const heading = textElement(document, 'h2', 'Agent Commons readiness');
      heading.setAttribute('id', 'agent-commons-readiness-heading');
      panel.append(
        heading,
        textElement(document, 'p', 'Readiness: Blocked'),
        textElement(document, 'p', 'Availability: Unavailable'),
        textElement(document, 'p', 'Participation policy is not authorized.'),
        textElement(document, 'p', 'Retention policy is not configured.'),
        textElement(document, 'p', 'Privacy: Tenant-private'),
        textElement(document, 'p', 'Cost: No incremental spend'),
        textElement(document, 'p', 'Interruption: Return to assigned state'),
        textElement(document, 'p', 'Participation: Not activated'),
        textElement(document, 'p', 'Occupancy: Unavailable'),
        textElement(document, 'p', 'Activity: Not activated'),
        textElement(
          document,
          'p',
          `Participation mode: ${presentation.participationMode === 'enabled' ? 'Enabled' : 'Paused'}`,
        ),
        textElement(
          document,
          'p',
          `Quiet hours: ${presentation.quietHoursStatus === 'disabled'
            ? 'Disabled'
            : presentation.quietHoursStatus === 'within_quiet_hours'
              ? 'Within quiet hours'
              : 'Outside quiet hours'}`,
        ),
        textElement(
          document,
          'p',
          `Activity kind: ${presentation.activityKind === 'social'
            ? 'Social'
            : presentation.activityKind === 'creative' ? 'Creative' : 'Recreation'}`,
        ),
      );
      const closeButton = textElement(document, 'button', 'Close Agent Commons readiness');
      closeButton.setAttribute('type', 'button');
      closeButton.setAttribute('class', 'agent-commons-readiness-control');
      closeButton.setAttribute('aria-label', 'Close Agent Commons readiness');
      closeButton.addEventListener('click', close);
      panel.append(closeButton);
      replacingContent = true;
      try {
        root.replaceChildren(style, panel);
      } catch (error) {
        for (let cleanupAttempt = 0; cleanupAttempt < 2; cleanupAttempt += 1) {
          try { closeButton.removeEventListener('click', close); break; } catch {}
        }
        for (let cleanupAttempt = 0; cleanupAttempt < 2; cleanupAttempt += 1) {
          try { root.replaceChildren(); break; } catch {}
        }
        throw error;
      } finally {
        replacingContent = false;
      }
      open = true;
      invoker = nextInvoker;
      closeControl = closeButton;
      root.addEventListener('keydown', keydown);
      closeButton.focus();
    },
    close,
    get isOpen() { return open; },
  });
}