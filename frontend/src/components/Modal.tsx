import { useEffect, useRef, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

let openModals = 0;

// Safari-family browsers do not focus a button when it is clicked, so document.activeElement is
// just <body> when a modal opens. Remember the last clicked control to restore focus to it.
let lastClickedControl: HTMLElement | null = null;
if (typeof document !== 'undefined') {
  document.addEventListener(
    'click',
    (event) => {
      const target = event.target instanceof Element ? event.target : null;
      lastClickedControl = target?.closest<HTMLElement>('button, a[href]') ?? null;
    },
    true,
  );
}

function setBackgroundInert(inert: boolean) {
  const root = document.getElementById('root');
  if (!root) return;
  if (inert) root.setAttribute('inert', '');
  else root.removeAttribute('inert');
  // A class, not an inline style: the production Content-Security-Policy has no 'unsafe-inline',
  // and Safari-family browsers treat style assignments through the DOM as inline styles.
  document.body.classList.toggle('modal-open', inert);
}

interface Props {
  labelledBy: string;
  describedBy?: string;
  role?: 'dialog' | 'alertdialog';
  variant: 'panel' | 'dialog';
  /** Called for Escape and backdrop clicks; the owner decides whether closing needs confirmation. */
  onRequestClose: () => void;
  /** Element to focus on open; defaults to the first focusable element. */
  initialFocus?: RefObject<HTMLElement | null>;
  children: ReactNode;
}

/**
 * Accessible modal: moves focus in, traps Tab, handles Escape, makes the page inert while open
 * and returns focus to the control that opened it (or a stable fallback if that is gone).
 */
export function Modal({
  labelledBy,
  describedBy,
  role = 'dialog',
  variant,
  onRequestClose,
  initialFocus,
  children,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  // The control that had focus before the modal opened. Kept in a ref so it survives React
  // StrictMode's extra mount/unmount cycle in development (where activeElement would be wrong).
  const openerRef = useRef<HTMLElement | null>(null);
  const restoreTimer = useRef<number | undefined>(undefined);
  const closeRef = useRef(onRequestClose);
  useEffect(() => {
    closeRef.current = onRequestClose;
  });

  useEffect(() => {
    // A pending restore from a simulated unmount must not steal focus back from this modal.
    window.clearTimeout(restoreTimer.current);
    if (openerRef.current === null) {
      const active = document.activeElement as HTMLElement | null;
      // Prefer the focused control; otherwise (Safari/WebKit) the control that was just clicked.
      openerRef.current = active?.matches(FOCUSABLE) ? active : lastClickedControl;
    }
    openModals += 1;
    setBackgroundInert(true);

    const container = containerRef.current;
    const target =
      initialFocus?.current ?? container?.querySelector<HTMLElement>(FOCUSABLE) ?? container;
    target?.focus();

    return () => {
      openModals -= 1;
      if (openModals === 0) setBackgroundInert(false);
      const opener = openerRef.current;
      restoreTimer.current = window.setTimeout(() => {
        // Only repair lost focus. When several modals close together the first restore wins and
        // the rest must not move focus again (their openers may already be gone).
        // "Lost" means <body> or a non-interactive container (WebKit parks focus on <main>).
        const active = document.activeElement;
        if (active && active.isConnected && active.matches(FOCUSABLE)) return;
        const fallback =
          document.querySelector<HTMLElement>('[data-focus-fallback]') ??
          document.getElementById('main');
        (opener && opener.isConnected ? opener : fallback)?.focus();
      }, 0);
    };
  }, [initialFocus]);

  function onKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      closeRef.current();
      return;
    }
    if (event.key !== 'Tab') return;
    const items = [...(containerRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])];
    if (items.length === 0) {
      event.preventDefault();
      return;
    }
    const first = items[0] as HTMLElement;
    const last = items[items.length - 1] as HTMLElement;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  return createPortal(
    <div
      className={`modal-backdrop modal-${variant}`}
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) closeRef.current();
      }}
    >
      <div
        ref={containerRef}
        className={`modal-surface modal-surface-${variant}`}
        role={role}
        aria-modal="true"
        aria-labelledby={labelledBy}
        aria-describedby={describedBy}
        tabIndex={-1}
        onKeyDown={onKeyDown}
      >
        {children}
      </div>
    </div>,
    document.body,
  );
}
