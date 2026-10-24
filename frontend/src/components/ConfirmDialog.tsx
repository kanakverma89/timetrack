import { useId, useRef, type ReactNode } from 'react';
import { Modal } from './Modal';

interface Props {
  title: string;
  children: ReactNode;
  confirmLabel: string;
  cancelLabel: string;
  danger?: boolean;
  pending?: boolean;
  error?: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}

/** Confirmation for destructive or irreversible actions. The safe choice has initial focus. */
export function ConfirmDialog({
  title,
  children,
  confirmLabel,
  cancelLabel,
  danger = false,
  pending = false,
  error = null,
  onConfirm,
  onCancel,
}: Props) {
  const titleId = useId();
  const bodyId = useId();
  const cancelRef = useRef<HTMLButtonElement>(null);
  return (
    <Modal
      variant="dialog"
      role="alertdialog"
      labelledBy={titleId}
      describedBy={bodyId}
      initialFocus={cancelRef}
      onRequestClose={() => {
        if (!pending) onCancel();
      }}
    >
      <div className="dialog-body">
        <h2 id={titleId}>{title}</h2>
        <div id={bodyId}>{children}</div>
        {error ? (
          <p className="form-error" role="alert">
            {error}
          </p>
        ) : null}
      </div>
      <div className="dialog-actions">
        <button
          ref={cancelRef}
          type="button"
          className="btn btn-secondary"
          disabled={pending}
          onClick={onCancel}
        >
          {cancelLabel}
        </button>
        <button
          type="button"
          className={`btn ${danger ? 'btn-danger' : 'btn-primary'}`}
          disabled={pending}
          onClick={onConfirm}
        >
          {confirmLabel}
        </button>
      </div>
    </Modal>
  );
}
