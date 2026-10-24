import { useId, useRef, useState } from 'react';
import { Modal } from '../../components/Modal';

interface Props {
  /** Whose password this is, for the heading. */
  name: string;
  email: string;
  kind: 'created' | 'reset';
  password: string;
  onDone: () => void;
}

/**
 * Shows a temporary password exactly once. It lives only in this component's props: it is never put
 * in the URL, storage or the query cache, and the server keeps only its hash.
 */
export function TemporaryPasswordDialog({ name, email, kind, password, onDone }: Props) {
  const titleId = useId();
  const bodyId = useId();
  const doneRef = useRef<HTMLButtonElement>(null);
  const [copied, setCopied] = useState<'yes' | 'no' | null>(null);

  async function copy() {
    try {
      await navigator.clipboard.writeText(password);
      setCopied('yes');
    } catch {
      setCopied('no'); // clipboard blocked: the password is still selectable on screen
    }
  }

  return (
    <Modal
      variant="dialog"
      role="alertdialog"
      labelledBy={titleId}
      describedBy={bodyId}
      initialFocus={doneRef}
      onRequestClose={() => undefined}
    >
      <div className="dialog-body">
        <h2 id={titleId}>{kind === 'created' ? 'User created' : 'Password reset'}</h2>
        <div id={bodyId}>
          <p>
            Temporary password for <strong>{name}</strong> ({email}):
          </p>
          <p>
            <output className="temp-password" aria-label="Temporary password">
              {password}
            </output>
          </p>
          <p className="notice">
            This is the only time it is shown. Give it to {name} through a private channel. They must
            choose their own password the first time they sign in
            {kind === 'reset' ? ', and they have been signed out everywhere' : ''}.
          </p>
          <p role="status" className="hint">
            {copied === 'yes' ? 'Copied to the clipboard.' : null}
            {copied === 'no' ? 'Could not copy automatically. Select the password and copy it.' : null}
          </p>
        </div>
      </div>
      <div className="dialog-actions">
        <button type="button" className="btn btn-secondary" onClick={() => void copy()}>
          Copy password
        </button>
        <button ref={doneRef} type="button" className="btn btn-primary" onClick={onDone}>
          I have saved it — done
        </button>
      </div>
    </Modal>
  );
}
