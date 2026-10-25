import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Modal } from './Modal';

interface Props {
  title: string;
  children: ReactNode;
  submitLabel: string;
  cancelLabel?: string;
  pending?: boolean;
  /** Summary shown above the buttons; receives focus when it appears. */
  error?: ReactNode;
  /** Disable submitting (e.g. required fields still empty) without hiding the button. */
  submitDisabled?: boolean;
  danger?: boolean;
  onSubmit: () => void;
  onCancel: () => void;
}

/**
 * A modal form: Enter submits, Escape cancels, and a second submit while one is running is ignored.
 * The first field gets focus (the Modal default), so people can start typing straight away.
 */
export function FormDialog({
  title,
  children,
  submitLabel,
  cancelLabel = 'Cancel',
  pending = false,
  error = null,
  submitDisabled = false,
  danger = false,
  onSubmit,
  onCancel,
}: Props) {
  const titleId = useId();
  const errorRef = useRef<HTMLDivElement>(null);
  const hasError = Boolean(error);
  const [attempts, setAttempts] = useState(0);
  // After every attempt that ends in an error the error takes focus, even if its text is the same
  // as last time: it is announced again and Tab/Escape keep working (a disabled submit button
  // would otherwise drop focus to <body>).
  useEffect(() => {
    if (hasError && !pending) errorRef.current?.focus();
  }, [hasError, pending, attempts]);

  function submit(event: FormEvent) {
    event.preventDefault();
    if (pending || submitDisabled) return;
    setAttempts((count) => count + 1);
    onSubmit();
  }

  return (
    <Modal
      variant="dialog"
      labelledBy={titleId}
      onRequestClose={() => {
        if (!pending) onCancel();
      }}
    >
      <form onSubmit={submit} noValidate className="form-dialog">
        <div className="dialog-body">
          <h2 id={titleId}>{title}</h2>
          {children}
          {error ? (
            <div ref={errorRef} className="form-error" role="alert" tabIndex={-1}>
              {error}
            </div>
          ) : null}
        </div>
        <div className="dialog-actions">
          <button type="button" className="btn btn-secondary" disabled={pending} onClick={onCancel}>
            {cancelLabel}
          </button>
          <button
            type="submit"
            className={`btn ${danger ? 'btn-danger' : 'btn-primary'}`}
            disabled={pending || submitDisabled}
          >
            {submitLabel}
          </button>
        </div>
      </form>
    </Modal>
  );
}
