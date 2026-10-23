import { useEffect } from 'react';

interface Props {
  message: string;
  onDismiss: () => void;
}

/** The live region is always mounted so announcements are reliably read by screen readers. */
export function Toast({ message, onDismiss }: Props) {
  useEffect(() => {
    if (!message) return;
    const timer = window.setTimeout(onDismiss, 6000);
    return () => window.clearTimeout(timer);
  }, [message, onDismiss]);

  return (
    <div className="toast-region" role="status" aria-live="polite" aria-atomic="true">
      {message ? (
        <div className="toast">
          <span>{message}</span>
          <button type="button" className="btn btn-link small" onClick={onDismiss}>
            Dismiss
          </button>
        </div>
      ) : null}
    </div>
  );
}
