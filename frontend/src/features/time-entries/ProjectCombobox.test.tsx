import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { ProjectOption } from '../../api/types';
import { ProjectCombobox } from './ProjectCombobox';

const projects: ProjectOption[] = [
  { id: 'p1', code: 'PRJ-001', name: 'Platform Development', is_active: true },
  { id: 'p2', code: 'PRJ-002', name: 'Customer Portal', is_active: true },
  { id: 'p3', code: 'PRJ-003', name: 'Internal Operations', is_active: true },
];

function Harness({ onChange = () => undefined }: { onChange?: (id: string) => void }) {
  const [value, setValue] = useState('');
  return (
    <form onSubmit={(e) => e.preventDefault()}>
      <label htmlFor="project">Project</label>
      <ProjectCombobox
        id="project"
        projects={projects}
        value={value}
        onChange={(id) => {
          setValue(id);
          onChange(id);
        }}
      />
      <output data-testid="value">{value}</output>
    </form>
  );
}

describe('ProjectCombobox', () => {
  it('exposes the combobox pattern to assistive technology', () => {
    render(<Harness />);
    const input = screen.getByRole('combobox', { name: 'Project' });
    expect(input).toHaveAttribute('aria-expanded', 'false');
    expect(input).toHaveAttribute('aria-autocomplete', 'list');
    expect(input).toHaveAttribute('aria-controls');
  });

  it('filters by code or name as the user types and selects with the mouse', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    const input = screen.getByRole('combobox');
    await user.type(input, 'portal');
    expect(input).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getAllByRole('option')).toHaveLength(1);
    await user.click(screen.getByRole('option', { name: 'PRJ-002 — Customer Portal' }));
    expect(onChange).toHaveBeenCalledWith('p2');
    expect(input).toHaveValue('PRJ-002 — Customer Portal');
    expect(input).toHaveAttribute('aria-expanded', 'false');

    await user.clear(input);
    await user.type(input, 'prj-003');
    expect(screen.getAllByRole('option')).toHaveLength(1);
  });

  it('supports keyboard selection without submitting the form', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const input = screen.getByRole('combobox');
    await user.click(input);
    // Clicking opens the list with the first option active; one ArrowDown reaches the second.
    await user.keyboard('{ArrowDown}');
    expect(input).toHaveAttribute(
      'aria-activedescendant',
      screen.getByRole('option', { name: /PRJ-002/ }).id,
    );
    await user.keyboard('{Enter}');
    expect(screen.getByTestId('value')).toHaveTextContent('p2');
    expect(input).toHaveValue('PRJ-002 — Customer Portal');
  });

  it('shows a message when nothing matches', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.type(screen.getByRole('combobox'), 'zzz');
    expect(screen.queryAllByRole('option')).toHaveLength(0);
    expect(screen.getByText('No matching projects')).toBeInTheDocument();
  });

  it('does not treat free text as a selection and reverts on blur', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const input = screen.getByRole('combobox');
    await user.type(input, 'plat');
    await user.tab();
    expect(screen.getByTestId('value')).toHaveTextContent('');
    expect(input).toHaveValue('');
  });

  it('Escape closes the list and restores the selection; a second Escape is left to the caller', async () => {
    const user = userEvent.setup();
    const outer = vi.fn();
    render(
      // eslint-disable-next-line jsx-a11y/no-static-element-interactions
      <div onKeyDown={(e) => e.key === 'Escape' && outer()}>
        <Harness />
      </div>,
    );
    const input = screen.getByRole('combobox');
    await user.click(input);
    await user.click(screen.getByRole('option', { name: /PRJ-001/ }));
    await user.keyboard('{Backspace}'); // still matches, so the list stays open
    expect(input).toHaveAttribute('aria-expanded', 'true');
    await user.keyboard('{Escape}');
    expect(input).toHaveAttribute('aria-expanded', 'false');
    expect(input).toHaveValue('PRJ-001 — Platform Development');
    expect(outer).not.toHaveBeenCalled(); // swallowed while the list was open
    await user.keyboard('{Escape}');
    expect(outer).toHaveBeenCalledOnce(); // list already closed: bubbles up
  });
});
