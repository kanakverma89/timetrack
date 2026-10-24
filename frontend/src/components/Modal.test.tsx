import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { Modal } from './Modal';

function Harness() {
  const [open, setOpen] = useState(false);
  return (
    <div id="root">
      <button type="button" onClick={() => setOpen(true)}>
        Open
      </button>
      {open ? (
        <Modal variant="dialog" labelledBy="t" onRequestClose={() => setOpen(false)}>
          <h2 id="t">Title</h2>
          <button type="button">Inside</button>
        </Modal>
      ) : null}
    </div>
  );
}

describe('Modal page lock', () => {
  it('freezes and silences the page behind it while open, with no inline style, and restores it', async () => {
    const user = userEvent.setup();
    // The Modal looks the app root up by id, as in index.html.
    render(<Harness />, { container: document.body.appendChild(document.createElement('div')) });
    const root = document.getElementById('root')!;

    await user.click(screen.getByRole('button', { name: 'Open' }));
    expect(screen.getByRole('dialog', { name: 'Title' })).toBeInTheDocument();
    expect(document.body).toHaveClass('modal-open'); // a class, so a strict CSP is satisfied
    expect(document.body.getAttribute('style')).toBeNull();
    expect(root).toHaveAttribute('inert');

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(document.body).not.toHaveClass('modal-open');
    expect(root).not.toHaveAttribute('inert');
  });

  it('keeps the lock until the last of several open modals closes', async () => {
    const user = userEvent.setup();
    function Two() {
      const [a, setA] = useState(true);
      const [b, setB] = useState(true);
      return (
        <div id="root">
          {a ? (
            <Modal variant="dialog" labelledBy="a" onRequestClose={() => setA(false)}>
              <h2 id="a">First</h2>
              <button type="button" onClick={() => setA(false)}>
                Close first
              </button>
            </Modal>
          ) : null}
          {b ? (
            <Modal variant="dialog" labelledBy="b" onRequestClose={() => setB(false)}>
              <h2 id="b">Second</h2>
              <button type="button" onClick={() => setB(false)}>
                Close second
              </button>
            </Modal>
          ) : null}
        </div>
      );
    }
    render(<Two />, { container: document.body.appendChild(document.createElement('div')) });
    expect(document.body).toHaveClass('modal-open');
    await user.click(screen.getByRole('button', { name: 'Close first' }));
    expect(document.body).toHaveClass('modal-open'); // the second is still open
    await user.click(screen.getByRole('button', { name: 'Close second' }));
    expect(document.body).not.toHaveClass('modal-open');
  });
});
