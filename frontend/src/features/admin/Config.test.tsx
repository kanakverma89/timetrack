import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AdminEarningCode, AdminProject, AdminTask, AuditItem, Policy } from '../../api/types';
import { ALEX } from '../../test/fixtures';
import { adminApi, bodyOf, fieldError, paged, person } from '../../test/adminFixtures';
import { errorBody } from '../../test/mockApi';
import { renderApp } from '../../test/renderApp';
import { describeChanges } from './AuditPage';

afterEach(() => vi.unstubAllGlobals());

// ------------------------------------------------------------------------------------ teams

describe('teams', () => {
  const team = { id: 't-1', name: 'Platform', member_count: 2 };
  const detail = {
    ...team,
    members: [ALEX, { id: 'u-sam', display_name: 'Sam Second', email: 'employee2@example.test' }],
  };

  it('lists teams with their member counts', async () => {
    adminApi({ 'GET /admin/teams': () => ({ body: { items: [team] } }) });
    renderApp('/admin/teams');
    const row = await screen.findByTestId('team-row');
    expect(row).toHaveTextContent('Platform');
    expect(row.querySelector('[data-label="Members"]')).toHaveTextContent('2');
    expect(screen.getByText(/do not decide who approves/i)).toBeInTheDocument();
  });

  it('creates and renames, refusing an unchanged or empty name', async () => {
    const calls: string[] = [];
    adminApi({
      'GET /admin/teams': () => ({ body: { items: [team] } }),
      'POST /admin/teams': (_u, init) => {
        calls.push(`POST ${JSON.stringify(bodyOf(init))}`);
        return { status: 201, body: detail };
      },
      'PATCH /admin/teams/t-1': (_u, init) => {
        calls.push(`PATCH ${JSON.stringify(bodyOf(init))}`);
        return { body: { ...detail, name: 'Core' } };
      },
    });
    const user = userEvent.setup();
    renderApp('/admin/teams');
    await screen.findByTestId('team-row');

    await user.click(screen.getByRole('button', { name: 'Add team' }));
    await user.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Create team' }),
    );
    expect(screen.getByText('Enter a name.')).toBeInTheDocument();
    expect(calls).toEqual([]);
    await user.type(screen.getByLabelText(/^Team name/), 'Design');
    await user.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Create team' }),
    );
    await waitFor(() => expect(calls).toEqual(['POST {"name":"Design"}']));

    await user.click(await screen.findByRole('button', { name: 'Rename Platform' }));
    const save = within(screen.getByRole('dialog')).getByRole('button', { name: 'Save' });
    expect(save).toBeDisabled();
    await user.clear(screen.getByLabelText(/^Team name/));
    await user.type(screen.getByLabelText(/^Team name/), 'Core');
    await user.click(save);
    await waitFor(() => expect(calls).toContain('PATCH {"name":"Core"}'));
  });

  it('shows a duplicate name beside the field', async () => {
    adminApi({
      'GET /admin/teams': () => ({ body: { items: [team] } }),
      'POST /admin/teams': () => fieldError('name', 'A team with this name already exists.', 409),
    });
    const user = userEvent.setup();
    renderApp('/admin/teams');
    await screen.findByTestId('team-row');
    await user.click(screen.getByRole('button', { name: 'Add team' }));
    await user.type(screen.getByLabelText(/^Team name/), 'platform');
    await user.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Create team' }),
    );
    expect(await screen.findByText('A team with this name already exists.')).toBeInTheDocument();
    expect(screen.getByLabelText(/^Team name/)).toHaveAttribute('aria-invalid', 'true');
  });

  it('starts the members dialog from the real membership, tracks edits across searches, saves ids', async () => {
    const saved: unknown[] = [];
    const searches: Array<string | null> = [];
    adminApi({
      'GET /admin/teams': () => ({ body: { items: [team] } }),
      'GET /admin/teams/t-1': () => ({ body: detail }),
      'GET /admin/users': (url) => {
        searches.push(url.searchParams.get('search'));
        const wanted = url.searchParams.get('search');
        const everyone = [
          person({ id: ALEX.id, display_name: ALEX.display_name, email: ALEX.email }),
          person({ id: 'u-sam', display_name: 'Sam Second', email: 'employee2@example.test' }),
          person({ id: 'u-new', display_name: 'Nia Newhire', email: 'nia@example.test' }),
        ];
        return {
          body: paged(wanted ? everyone.filter((p) => p.email.includes(wanted)) : everyone),
        };
      },
      'PUT /admin/teams/t-1/members': (_u, init) => {
        saved.push(bodyOf(init));
        return { body: detail };
      },
    });
    const user = userEvent.setup();
    renderApp('/admin/teams');
    await user.click(await screen.findByRole('button', { name: 'Members of Platform' }));
    const form = screen.getByRole('dialog', { name: 'Members of Platform' });
    expect(await within(form).findByText('2 selected')).toBeInTheDocument();
    await waitFor(() =>
      expect(within(form).getByRole('checkbox', { name: /Alex Employee/ })).toBeChecked(),
    );
    expect(within(form).getByRole('checkbox', { name: /Nia Newhire/ })).not.toBeChecked();

    await user.click(within(form).getByRole('checkbox', { name: /Nia Newhire/ })); // add
    await user.click(within(form).getByRole('checkbox', { name: /Sam Second/ })); // remove
    expect(within(form).getByText('2 selected')).toBeInTheDocument();

    // Searching narrows the list but keeps the choices made so far.
    await user.type(within(form).getByLabelText('Find people'), 'nia');
    await waitFor(() => expect(within(form).queryByRole('checkbox', { name: /Alex/ })).toBeNull());
    expect(within(form).getByRole('checkbox', { name: /Nia Newhire/ })).toBeChecked();
    expect(within(form).getByText('2 selected')).toBeInTheDocument();
    expect(searches).toContain('nia');

    await user.click(within(form).getByRole('button', { name: 'Save members' }));
    await waitFor(() => expect(saved).toHaveLength(1));
    expect((saved[0] as { user_ids: string[] }).user_ids.sort()).toEqual([ALEX.id, 'u-new'].sort());
  });

  it('asks before deleting, with the safe choice focused, and says people are untouched', async () => {
    const deleted: string[] = [];
    adminApi({
      'GET /admin/teams': () => ({ body: { items: [team] } }),
      'DELETE /admin/teams/t-1': () => {
        deleted.push('t-1');
        return { status: 204 };
      },
    });
    const user = userEvent.setup();
    renderApp('/admin/teams');
    await user.click(await screen.findByRole('button', { name: 'Delete Platform' }));
    const confirm = screen.getByRole('alertdialog');
    expect(within(confirm).getByRole('button', { name: 'Cancel' })).toHaveFocus();
    expect(confirm).toHaveTextContent('2 people in it are not affected');
    await user.click(within(confirm).getByRole('button', { name: 'Cancel' }));
    expect(deleted).toEqual([]);
    await user.click(screen.getByRole('button', { name: 'Delete Platform' }));
    await user.click(
      within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Delete team' }),
    );
    await waitFor(() => expect(deleted).toEqual(['t-1']));
  });

  it('shows an empty state with a way forward', async () => {
    adminApi({ 'GET /admin/teams': () => ({ body: { items: [] } }) });
    renderApp('/admin/teams');
    expect(await screen.findByText('No teams yet')).toBeInTheDocument();
  });
});

// -------------------------------------------------------------------------- projects & tasks

const project = (o: Partial<AdminProject> = {}): AdminProject => ({
  id: 'p-1',
  code: 'PRJ-001',
  name: 'Platform Development',
  description: 'Core',
  is_active: true,
  task_count: 2,
  ...o,
});

describe('projects', () => {
  it('lists projects with a link to their tasks', async () => {
    adminApi({
      'GET /admin/projects': () => ({
        body: paged([project(), project({ id: 'p-2', code: 'OLD', is_active: false })]),
      }),
    });
    renderApp('/admin/projects');
    const rows = await screen.findAllByTestId('project-row');
    expect(rows[0]).toHaveTextContent('PRJ-001');
    expect(rows[1]).toHaveTextContent('Inactive');
    expect(screen.getByRole('link', { name: 'Tasks of PRJ-001' })).toHaveAttribute(
      'href',
      '/admin/projects/p-1',
    );
  });

  it('creates with the code as typed (the server capitalises) and explains a duplicate', async () => {
    const sent: unknown[] = [];
    let duplicate = true;
    adminApi({
      'GET /admin/projects': () => ({ body: paged([project()]) }),
      'POST /admin/projects': (_u, init) => {
        sent.push(bodyOf(init));
        if (duplicate) return fieldError('code', 'A project with this code already exists.', 409);
        return { status: 201, body: project({ id: 'p-9', code: 'NEW-1', name: 'New' }) };
      },
    });
    const user = userEvent.setup();
    renderApp('/admin/projects');
    await screen.findAllByTestId('project-row');
    await user.click(screen.getByRole('button', { name: 'Add project' }));
    const form = screen.getByRole('dialog');
    await user.click(within(form).getByRole('button', { name: 'Create project' }));
    expect(within(form).getByText('Enter a code.')).toBeInTheDocument();
    expect(within(form).getByText('Enter a name.')).toBeInTheDocument();
    expect(sent).toEqual([]);

    await user.type(within(form).getByLabelText(/^Code/), 'prj-001');
    await user.type(within(form).getByLabelText(/^Name/), '  New  ');
    await user.type(within(form).getByLabelText(/^Description/), '  About  ');
    await user.click(within(form).getByRole('button', { name: 'Create project' }));
    expect(
      await within(form).findByText('A project with this code already exists.'),
    ).toBeInTheDocument();
    expect(sent[0]).toEqual({ code: 'prj-001', name: 'New', description: 'About' });

    duplicate = false;
    await user.clear(within(form).getByLabelText(/^Code/));
    await user.type(within(form).getByLabelText(/^Code/), 'new-1');
    await user.click(within(form).getByRole('button', { name: 'Create project' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(await screen.findByText('Saved New.')).toBeInTheDocument();
  });

  it('edits without a code field, sends the three editable fields, and an empty description as null', async () => {
    const sent: unknown[] = [];
    adminApi({
      'GET /admin/projects': () => ({ body: paged([project()]) }),
      'PATCH /admin/projects/p-1': (_u, init) => {
        sent.push(bodyOf(init));
        return { body: project() };
      },
    });
    const user = userEvent.setup();
    renderApp('/admin/projects');
    await screen.findAllByTestId('project-row');
    await user.click(screen.getByRole('button', { name: 'Edit PRJ-001' }));
    const form = screen.getByRole('dialog');
    expect(within(form).queryByLabelText(/^Code/)).toBeNull();
    expect(within(form).getByText('(cannot be changed)')).toBeInTheDocument();
    expect(within(form).getByRole('button', { name: 'Save changes' })).toBeDisabled();
    await user.clear(within(form).getByLabelText(/^Description/));
    await user.click(within(form).getByLabelText('Active'));
    await user.click(within(form).getByRole('button', { name: 'Save changes' }));
    await waitFor(() =>
      expect(sent).toEqual([{ name: 'Platform Development', description: null, is_active: false }]),
    );
  });
});

describe('project tasks', () => {
  const task = (o: Partial<AdminTask> = {}): AdminTask => ({
    id: 'k-1',
    project_id: 'p-1',
    code: 'DEV',
    name: 'Development',
    is_active: true,
    ...o,
  });

  it('lists tasks, explains the rule and creates a task for this project', async () => {
    const sent: unknown[] = [];
    adminApi({
      'GET /admin/projects/p-1': () => ({ body: project() }),
      'GET /admin/projects/p-1/tasks': () => ({ body: { items: [task()] } }),
      'POST /admin/projects/p-1/tasks': (_u, init) => {
        sent.push(bodyOf(init));
        return { status: 201, body: task({ id: 'k-2', code: 'TST', name: 'Testing' }) };
      },
    });
    const user = userEvent.setup();
    renderApp('/admin/projects/p-1');
    expect(
      await screen.findByRole('heading', { level: 2, name: /Tasks of PRJ-001/ }),
    ).toBeInTheDocument();
    expect(await screen.findByTestId('task-row')).toHaveTextContent('DEV');
    expect(screen.getByText(/must choose one for each entry/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Add task' }));
    await user.type(screen.getByLabelText(/^Code/), 'tst');
    await user.type(screen.getByLabelText(/^Name/), 'Testing');
    await user.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Create task' }),
    );
    await waitFor(() => expect(sent).toEqual([{ code: 'tst', name: 'Testing' }]));
  });

  it('deactivates a task with only the changed fields and a project without tasks says so', async () => {
    const sent: unknown[] = [];
    let items = [task()];
    adminApi({
      'GET /admin/projects/p-1': () => ({ body: project({ task_count: 0 }) }),
      'GET /admin/projects/p-1/tasks': () => ({ body: { items } }),
      'PATCH /admin/tasks/k-1': (_u, init) => {
        sent.push(bodyOf(init));
        items = [];
        return { body: task({ is_active: false }) };
      },
    });
    const user = userEvent.setup();
    renderApp('/admin/projects/p-1');
    await user.click(await screen.findByRole('button', { name: 'Edit DEV' }));
    await user.click(within(screen.getByRole('dialog')).getByLabelText('Active'));
    await user.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Save changes' }),
    );
    await waitFor(() => expect(sent).toEqual([{ name: 'Development', is_active: false }]));
    expect(await screen.findByText('No tasks')).toBeInTheDocument();
  });

  it('reports an unknown project instead of an empty page', async () => {
    adminApi({
      'GET /admin/projects/p-1': () => errorBody('NOT_FOUND', 'Project not found.', 404),
      'GET /admin/projects/p-1/tasks': () => errorBody('NOT_FOUND', 'Project not found.', 404),
    });
    renderApp('/admin/projects/p-1');
    expect(await screen.findByRole('alert')).toHaveTextContent('Project not found.');
  });
});

// ------------------------------------------------------------------------------ earning codes

const code = (o: Partial<AdminEarningCode> = {}): AdminEarningCode => ({
  id: 'c-1',
  code: 'REG',
  name: 'Regular Work',
  classification: 'CAPPED',
  is_active: true,
  entry_count: 0,
  ...o,
});

describe('earning codes', () => {
  it('lists the classification and how many entries use each code', async () => {
    adminApi({
      'GET /admin/earning-codes': () => ({
        body: {
          items: [
            code({ entry_count: 1 }),
            code({ id: 'c-2', code: 'OVT', classification: 'NON_CAPPED', entry_count: 5 }),
          ],
        },
      }),
    });
    renderApp('/admin/earning-codes');
    const rows = await screen.findAllByTestId('code-row');
    expect(rows[0]).toHaveTextContent('1 entry');
    expect(rows[1]).toHaveTextContent('Non-capped');
    expect(rows[1]).toHaveTextContent('5 entries');
  });

  it('locks the classification once entries use the code, and says why', async () => {
    const sent: unknown[] = [];
    adminApi({
      'GET /admin/earning-codes': () => ({ body: { items: [code({ entry_count: 3 })] } }),
      'PATCH /admin/earning-codes/c-1': (_u, init) => {
        sent.push(bodyOf(init));
        return { body: code() };
      },
    });
    const user = userEvent.setup();
    renderApp('/admin/earning-codes');
    await user.click(await screen.findByRole('button', { name: 'Edit REG' }));
    const form = screen.getByRole('dialog');
    expect(within(form).getByLabelText(/^Classification/)).toBeDisabled();
    expect(within(form).getByLabelText(/^Classification/)).toHaveAccessibleDescription(
      /Fixed because 3 entries use this code/,
    );
    await user.clear(within(form).getByLabelText(/^Name/));
    await user.type(within(form).getByLabelText(/^Name/), 'Regular');
    await user.click(within(form).getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(sent).toHaveLength(1));
    // The classification is still sent (unchanged), never altered by the page.
    expect(sent[0]).toMatchObject({ name: 'Regular', classification: 'CAPPED', is_active: true });
  });

  it('lets an unused code be reclassified and creates new ones with a chosen classification', async () => {
    const sent: unknown[] = [];
    adminApi({
      'GET /admin/earning-codes': () => ({ body: { items: [code()] } }),
      'POST /admin/earning-codes': (_u, init) => {
        sent.push(bodyOf(init));
        return {
          status: 201,
          body: code({ id: 'c-9', code: 'BON', classification: 'NON_CAPPED' }),
        };
      },
    });
    const user = userEvent.setup();
    renderApp('/admin/earning-codes');
    await user.click(await screen.findByRole('button', { name: 'Edit REG' }));
    expect(within(screen.getByRole('dialog')).getByLabelText(/^Classification/)).toBeEnabled();
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel' }));

    await user.click(screen.getByRole('button', { name: 'Add earning code' }));
    const form = screen.getByRole('dialog');
    await user.type(within(form).getByLabelText(/^Code/), 'bon');
    await user.type(within(form).getByLabelText(/^Name/), 'Bonus');
    await user.selectOptions(within(form).getByLabelText(/^Classification/), 'NON_CAPPED');
    await user.click(within(form).getByRole('button', { name: 'Create earning code' }));
    await waitFor(() =>
      expect(sent).toEqual([{ code: 'bon', name: 'Bonus', classification: 'NON_CAPPED' }]),
    );
  });
});

// ----------------------------------------------------------------------------------- policy

const policy = (o: Partial<Policy> = {}): Policy => ({
  max_hours_per_entry: '24.00',
  max_hours_per_day: '16.00',
  max_hours_per_week: '60.00',
  description_max_length: 256,
  source: 'environment',
  updated_at: null,
  updated_by_name: null,
  environment_defaults: {
    max_hours_per_entry: '24.00',
    max_hours_per_day: '16.00',
    max_hours_per_week: null,
    description_max_length: 256,
  },
  ...o,
});

describe('policy', () => {
  it('shows whole hours plainly, the source, and the server defaults', async () => {
    adminApi({ 'GET /admin/policy': () => ({ body: policy() }) });
    renderApp('/admin/policy');
    expect(await screen.findByLabelText(/^Maximum hours in one entry/)).toHaveValue('24');
    expect(screen.getByLabelText(/^Maximum hours in one day/)).toHaveValue('16');
    expect(
      screen.getByText(/Using the defaults from the server configuration/),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Restore defaults' })).toBeDisabled();
    const defaults = screen.getByRole('heading', { name: 'Server defaults' }).nextElementSibling!
      .nextElementSibling!;
    expect(defaults).toHaveTextContent('No limit'); // a null default is stated, not left blank
  });

  it('validates every field and sends nothing until they are right', async () => {
    const sent: unknown[] = [];
    adminApi({
      'GET /admin/policy': () => ({ body: policy() }),
      'PUT /admin/policy': (_u, init) => {
        sent.push(bodyOf(init));
        return { body: policy() };
      },
    });
    const user = userEvent.setup();
    renderApp('/admin/policy');
    const entry = await screen.findByLabelText(/^Maximum hours in one entry/);
    for (const [label, text] of [
      [/^Maximum hours in one entry/, '25'],
      [/^Maximum hours in one day/, 'abc'],
      [/^Maximum hours in one week/, '200'],
      [/^Maximum description length/, '0'],
    ] as const) {
      const field = screen.getByLabelText(label);
      await user.clear(field);
      await user.type(field, text);
    }
    await user.click(screen.getByRole('button', { name: 'Save policy' }));
    expect(screen.getByText('Must be at most 24.')).toBeInTheDocument();
    expect(screen.getByText(/Use a number with at most two decimal places/)).toBeInTheDocument();
    expect(screen.getByText('Must be at most 168.')).toBeInTheDocument();
    expect(screen.getByText('Enter a whole number from 1 to 256.')).toBeInTheDocument();
    expect(entry).toHaveAttribute('aria-invalid', 'true');
    await waitFor(() => expect(screen.getByRole('alert')).toHaveFocus());
    expect(sent).toEqual([]);

    await user.clear(entry);
    await user.type(entry, '0');
    await user.click(screen.getByRole('button', { name: 'Save policy' }));
    expect(screen.getByText('Must be more than zero.')).toBeInTheDocument();
  });

  it('saves trimmed numbers, with an empty limit sent as null (no limit)', async () => {
    const sent: unknown[] = [];
    adminApi({
      'GET /admin/policy': () => ({ body: policy() }),
      'PUT /admin/policy': (_u, init) => {
        sent.push(bodyOf(init));
        return {
          body: policy({
            source: 'database',
            updated_by_name: 'Jordan Admin',
            updated_at: '2026-10-24T10:00:00Z',
          }),
        };
      },
    });
    const user = userEvent.setup();
    renderApp('/admin/policy');
    const entry = await screen.findByLabelText(/^Maximum hours in one entry/);
    await user.clear(entry);
    await user.type(entry, ' 12.5 ');
    await user.clear(screen.getByLabelText(/^Maximum hours in one day/));
    await user.click(screen.getByRole('button', { name: 'Save policy' }));
    await waitFor(() =>
      expect(sent).toEqual([
        {
          max_hours_per_entry: '12.5',
          max_hours_per_day: null,
          max_hours_per_week: '60',
          description_max_length: 256,
        },
      ]),
    );
    expect(await screen.findByText(/Policy saved/)).toBeInTheDocument();
  });

  it("shows the server's verdict beside the field it is about", async () => {
    adminApi({
      'GET /admin/policy': () => ({ body: policy() }),
      'PUT /admin/policy': () =>
        fieldError('max_hours_per_entry', 'A single entry cannot exceed the daily limit.'),
    });
    const user = userEvent.setup();
    renderApp('/admin/policy');
    await screen.findByLabelText(/^Maximum hours in one entry/);
    await user.click(screen.getByRole('button', { name: 'Save policy' }));
    expect(
      await screen.findByText('A single entry cannot exceed the daily limit.'),
    ).toBeInTheDocument();
    expect(screen.getByLabelText(/^Maximum hours in one entry/)).toHaveAttribute(
      'aria-invalid',
      'true',
    );
  });

  it('restores defaults only after confirmation, and only when customised', async () => {
    let restored = 0;
    adminApi({
      'GET /admin/policy': () => ({
        body: policy({
          source: 'database',
          max_hours_per_entry: '10.00',
          updated_by_name: 'Jordan Admin',
          updated_at: '2026-10-24T10:00:00Z',
        }),
      }),
      'DELETE /admin/policy': () => {
        restored += 1;
        return { body: policy() };
      },
    });
    const user = userEvent.setup();
    renderApp('/admin/policy');
    expect(await screen.findByText(/Customised by Jordan Admin on /)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Restore defaults' }));
    const confirm = screen.getByRole('alertdialog');
    expect(within(confirm).getByRole('button', { name: 'Cancel' })).toHaveFocus();
    await user.click(within(confirm).getByRole('button', { name: 'Cancel' }));
    expect(restored).toBe(0);
    await user.click(screen.getByRole('button', { name: 'Restore defaults' }));
    await user.click(
      within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Restore defaults' }),
    );
    await waitFor(() => expect(restored).toBe(1));
  });
});

// ------------------------------------------------------------------------------------ audit

const event = (o: Partial<AuditItem> = {}): AuditItem => ({
  id: 'e-1',
  created_at: '2026-10-24T09:30:00Z',
  actor: { id: 'a', display_name: 'Jordan Admin', email: 'admin@example.test' },
  entity_type: 'USER',
  entity_id: 'u-1',
  entity_label: 'Lee Leaver',
  action: 'UPDATED',
  details: { label: 'u-1', changes: { role: { from: 'EMPLOYEE', to: 'MANAGER' } } },
  ...o,
});

describe('audit log', () => {
  it('describes changes in words and never shows values for personal fields', () => {
    expect(describeChanges(event())).toEqual(['role: EMPLOYEE → MANAGER']);
    expect(
      describeChanges(event({ details: { changes: { display_name: { changed: true } } } })),
    ).toEqual(['name changed']);
    expect(
      describeChanges(
        event({
          action: 'MEMBERS_CHANGED',
          details: {
            changes: {
              added: { from: [], to: ['Alex Employee', 'Sam Second'] },
              removed: { from: ['Old Member'], to: [] },
            },
          },
        }),
      ),
    ).toEqual(['added: Alex Employee, Sam Second', 'removed: Old Member']);
    expect(
      describeChanges(
        event({ details: { changes: { max_hours_per_entry: { from: '24.00', to: '11.00' } } } }),
      ),
    ).toEqual(['hours per entry: 24 → 11']);
    expect(
      describeChanges(event({ details: { changes: { manager_id: { from: null, to: 'x' } } } })),
    ).toEqual(['manager: none → x']);
    expect(describeChanges(event({ details: {} }))).toEqual([]);
  });

  it('lists who did what to what, newest first, and filters by kind', async () => {
    const queries: URLSearchParams[] = [];
    adminApi({
      'GET /admin/audit': (url) => {
        queries.push(url.searchParams);
        return {
          body: paged([event(), event({ id: 'e-2', action: 'PASSWORD_RESET', details: {} })]),
        };
      },
    });
    const user = userEvent.setup();
    renderApp('/admin/audit');
    const rows = await screen.findAllByTestId('audit-row');
    expect(rows[0]).toHaveTextContent('Jordan Admin');
    expect(rows[0]).toHaveTextContent('Changed · People');
    expect(rows[0]).toHaveTextContent('Lee Leaver');
    expect(rows[0]).toHaveTextContent('role: EMPLOYEE → MANAGER');
    expect(rows[1]).toHaveTextContent('Reset password');
    expect(document.body).not.toHaveTextContent(/password:|temporary/i);

    await user.selectOptions(screen.getByLabelText('What changed'), 'TEAM');
    await waitFor(() => expect(queries.at(-1)?.get('entity_type')).toBe('TEAM'));
    expect(queries.at(-1)?.get('page')).toBe('1');
  });

  it('pages through long histories', async () => {
    const queries: URLSearchParams[] = [];
    adminApi({
      'GET /admin/audit': (url) => {
        queries.push(url.searchParams);
        return { body: paged([event()], 45, Number(url.searchParams.get('page') ?? 1)) };
      },
    });
    const user = userEvent.setup();
    renderApp('/admin/audit');
    await screen.findAllByTestId('audit-row');
    expect(screen.getByText(/Page 1 of 3 · 45 events/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Next page' }));
    await waitFor(() => expect(queries.at(-1)?.get('page')).toBe('2'));
  });

  it('says when nothing matches', async () => {
    adminApi({ 'GET /admin/audit': () => ({ body: paged([]) }) });
    renderApp('/admin/audit');
    expect(await screen.findByText('Nothing recorded')).toBeInTheDocument();
  });
});
