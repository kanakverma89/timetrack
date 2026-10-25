import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ADMIN } from '../../test/fixtures';
import { MORGAN, adminApi, bodyOf, fieldError, paged, person } from '../../test/adminFixtures';
import { errorBody } from '../../test/mockApi';
import { renderApp } from '../../test/renderApp';

afterEach(() => vi.unstubAllGlobals());

const TEMP = 'Tmp-Pass-Word-12345';

function usersApi(items = [person()], extra: Parameters<typeof adminApi>[0] = {}) {
  const queries: URLSearchParams[] = [];
  const api = adminApi({
    'GET /admin/users': (url) => {
      queries.push(url.searchParams);
      return {
        body: url.searchParams.get('managers_only')
          ? paged(
              [MORGAN].map((m) =>
                person({ id: m.id, display_name: m.display_name, email: m.email, role: 'MANAGER' }),
              ),
            )
          : paged(items),
      };
    },
    ...extra,
  });
  return { ...api, queries };
}

const listQueries = (queries: URLSearchParams[]) => queries.filter((q) => !q.get('managers_only'));

describe('users list', () => {
  it('shows who they are, their role, manager, reports and status', async () => {
    usersApi([
      person(),
      person({
        id: 'u-2',
        email: 'boss@example.test',
        display_name: 'Bea Boss',
        role: 'MANAGER',
        report_count: 3,
        is_active: false,
        must_change_password: true,
      }),
      person({ id: 'u-3', display_name: 'Ray Report', email: 'ray@example.test', manager: MORGAN }),
    ]);
    renderApp('/admin/users');
    const rows = await screen.findAllByTestId('user-row');
    expect(rows).toHaveLength(3);
    expect(rows[0]).toHaveTextContent('Lee Leaver');
    expect(rows[0]).toHaveTextContent('lee@example.test');
    expect(rows[0]).toHaveTextContent('Active');
    expect(rows[1]).toHaveTextContent('Manager');
    expect(rows[1]).toHaveTextContent('Inactive'); // status is text, not only colour
    expect(rows[1]).toHaveTextContent('Temporary password pending');
    expect(rows[1]!.querySelector('[data-label="Reports"]')).toHaveTextContent('3');
    expect(rows[2]).toHaveTextContent('Morgan Manager');
    expect(screen.getByText('3 people found.')).toBeInTheDocument();
  });

  it('offers no password reset for your own row', async () => {
    usersApi([
      person({ id: ADMIN.id, email: ADMIN.email, display_name: ADMIN.display_name, role: 'ADMIN' }),
      person(),
    ]);
    renderApp('/admin/users');
    await screen.findAllByTestId('user-row');
    expect(
      screen.queryByRole('button', { name: `Reset password for ${ADMIN.display_name}` }),
    ).toBeNull();
    expect(
      screen.getByRole('button', { name: 'Reset password for Lee Leaver' }),
    ).toBeInTheDocument();
  });

  it('turns filters and the search box into request parameters and resets the page', async () => {
    const { queries } = usersApi();
    const user = userEvent.setup();
    renderApp('/admin/users?page=3');
    await screen.findAllByTestId('user-row');
    expect(listQueries(queries)[0]?.get('page')).toBe('3');

    await user.selectOptions(screen.getByLabelText('Role'), 'MANAGER');
    await user.selectOptions(screen.getByLabelText('Status'), 'inactive');
    await user.type(screen.getByLabelText('Name or email'), 'lee');
    await user.click(screen.getByRole('button', { name: 'Search' }));
    await waitFor(() => {
      const last = listQueries(queries).at(-1)!;
      expect(last.get('role')).toBe('MANAGER');
      expect(last.get('active')).toBe('false');
      expect(last.get('search')).toBe('lee');
      expect(last.get('page')).toBe('1');
    });
  });

  it('says so when nobody matches, and when the list cannot be loaded', async () => {
    usersApi([], {});
    renderApp('/admin/users');
    expect(await screen.findByText('No people match')).toBeInTheDocument();
  });

  it('shows a retryable error', async () => {
    adminApi({ 'GET /admin/users': () => errorBody('INTERNAL_ERROR', 'Something broke.', 500) });
    renderApp('/admin/users');
    expect(await screen.findByRole('alert')).toHaveTextContent('Something broke.');
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });
});

describe('adding a person', () => {
  it('checks the form locally, then shows the temporary password once', async () => {
    const posts: Array<Record<string, unknown>> = [];
    const { queries } = usersApi([person()], {
      'POST /admin/users': (_url, init) => {
        posts.push(bodyOf(init));
        return {
          status: 201,
          body: {
            user: person({
              id: 'u-new',
              email: 'new@example.test',
              display_name: 'Nia Newhire',
              must_change_password: true,
            }),
            temporary_password: TEMP,
          },
        };
      },
    });
    const user = userEvent.setup();
    renderApp('/admin/users');
    await screen.findAllByTestId('user-row');
    await user.click(screen.getByRole('button', { name: 'Add user' }));
    const form = screen.getByRole('dialog', { name: 'Add user' });

    await user.click(within(form).getByRole('button', { name: 'Create user' }));
    expect(posts).toHaveLength(0); // nothing sent for an empty form
    expect(within(form).getByText('Enter an email address.')).toBeInTheDocument();
    expect(within(form).getByText('Enter a name.')).toBeInTheDocument();
    expect(within(form).getByRole('alert')).toHaveFocus();

    await user.type(within(form).getByLabelText(/^Email/), '  New@Example.test ');
    await user.type(within(form).getByLabelText(/^Name/), 'Nia Newhire');
    await user.selectOptions(within(form).getByLabelText(/^Role/), 'MANAGER');
    await user.dblClick(within(form).getByRole('button', { name: 'Create user' }));

    const shown = await screen.findByRole('alertdialog', { name: 'User created' });
    expect(posts).toEqual([
      { email: 'New@Example.test', display_name: 'Nia Newhire', role: 'MANAGER', manager_id: null },
    ]); // exactly one request despite the double click (the server normalises the email)
    expect(within(shown).getByLabelText('Temporary password')).toHaveTextContent(TEMP);
    expect(shown).toHaveTextContent(/only time it is shown/i);
    expect(within(shown).getByRole('button', { name: /I have saved it/ })).toHaveFocus();

    // Escape and the backdrop do nothing: it cannot be dismissed by accident.
    await user.keyboard('{Escape}');
    expect(screen.getByRole('alertdialog', { name: 'User created' })).toBeInTheDocument();

    await user.click(within(shown).getByRole('button', { name: /I have saved it/ }));
    expect(screen.queryByText(TEMP)).not.toBeInTheDocument();
    expect(document.body).not.toHaveTextContent(TEMP);
    expect(await screen.findByText('User created.')).toBeInTheDocument();
    // The list was reloaded to include the new person.
    expect(listQueries(queries).length).toBeGreaterThanOrEqual(2);
  });

  it('shows a taken email next to the field and keeps what was typed', async () => {
    usersApi([person()], {
      'POST /admin/users': () => fieldError('email', 'A user with this email already exists.', 409),
    });
    const user = userEvent.setup();
    renderApp('/admin/users');
    await screen.findAllByTestId('user-row');
    await user.click(screen.getByRole('button', { name: 'Add user' }));
    const form = screen.getByRole('dialog', { name: 'Add user' });
    await user.type(within(form).getByLabelText(/^Email/), 'lee@example.test');
    await user.type(within(form).getByLabelText(/^Name/), 'Another Lee');
    await user.click(within(form).getByRole('button', { name: 'Create user' }));
    expect(
      await within(form).findByText('A user with this email already exists.'),
    ).toBeInTheDocument();
    expect(within(form).getByLabelText(/^Email/)).toHaveAttribute('aria-invalid', 'true');
    expect(within(form).getByLabelText(/^Name/)).toHaveValue('Another Lee');
    expect(within(form).getByRole('alert')).toHaveFocus();
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });

  it('puts focus back on the error after a second failed attempt with the same message', async () => {
    usersApi([person()], {
      'POST /admin/users': () => fieldError('email', 'A user with this email already exists.', 409),
    });
    const user = userEvent.setup();
    renderApp('/admin/users');
    await screen.findAllByTestId('user-row');
    await user.click(screen.getByRole('button', { name: 'Add user' }));
    const form = screen.getByRole('dialog', { name: 'Add user' });
    await user.type(within(form).getByLabelText(/^Email/), 'lee@example.test');
    await user.type(within(form).getByLabelText(/^Name/), 'Another Lee');
    await user.click(within(form).getByRole('button', { name: 'Create user' }));
    await within(form).findByText('A user with this email already exists.');
    await user.click(within(form).getByLabelText(/^Name/)); // focus moves away
    await user.click(within(form).getByRole('button', { name: 'Create user' }));
    await waitFor(() => expect(within(form).getByRole('alert')).toHaveFocus());
  });
});

describe('form errors and focus', () => {
  it('moves focus to the error again when the same local mistake is made twice', async () => {
    usersApi();
    const user = userEvent.setup();
    renderApp('/admin/users');
    await screen.findAllByTestId('user-row');
    await user.click(screen.getByRole('button', { name: 'Add user' }));
    const form = screen.getByRole('dialog', { name: 'Add user' });
    await user.click(within(form).getByRole('button', { name: 'Create user' }));
    await waitFor(() => expect(within(form).getByRole('alert')).toHaveFocus());
    await user.click(within(form).getByLabelText(/^Email/)); // wander off
    expect(within(form).getByRole('alert')).not.toHaveFocus();
    await user.click(within(form).getByRole('button', { name: 'Create user' })); // same mistake
    await waitFor(() => expect(within(form).getByRole('alert')).toHaveFocus());
  });
});

describe('editing a person', () => {
  it('cannot be saved until something changes, and sends only what changed', async () => {
    const patches: Array<Record<string, unknown>> = [];
    usersApi([person()], {
      'PATCH /admin/users/u-lee': (_url, init) => {
        patches.push(bodyOf(init));
        return {
          body: person({ display_name: 'Lee Q. Leaver', role: 'MANAGER', manager: MORGAN }),
        };
      },
    });
    const user = userEvent.setup();
    renderApp('/admin/users');
    await screen.findAllByTestId('user-row');
    await user.click(screen.getByRole('button', { name: 'Edit Lee Leaver' }));
    const form = screen.getByRole('dialog', { name: 'Edit Lee Leaver' });
    expect(within(form).getByRole('button', { name: 'Save changes' })).toBeDisabled();
    expect(within(form).getByText('lee@example.test')).toBeInTheDocument(); // email is not editable
    expect(within(form).queryByLabelText(/^Email/)).not.toBeInTheDocument();

    await user.clear(within(form).getByLabelText(/^Name/));
    await user.type(within(form).getByLabelText(/^Name/), 'Lee Q. Leaver');
    await user.selectOptions(within(form).getByLabelText(/^Role/), 'MANAGER');
    await waitFor(() =>
      expect(within(form).getByRole('option', { name: /Morgan Manager/ })).toBeInTheDocument(),
    );
    await user.selectOptions(within(form).getByLabelText(/^Manager/), 'u-morgan');
    await user.click(within(form).getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(patches).toHaveLength(1));
    expect(patches[0]).toEqual({
      display_name: 'Lee Q. Leaver',
      role: 'MANAGER',
      manager_id: 'u-morgan',
    });
    expect(await screen.findByText('Saved Lee Q. Leaver.')).toBeInTheDocument();
  });

  it('removes a manager with an explicit null and deactivates with is_active false', async () => {
    const patches: Array<Record<string, unknown>> = [];
    usersApi([person({ manager: MORGAN })], {
      'PATCH /admin/users/u-lee': (_url, init) => {
        patches.push(bodyOf(init));
        return { body: person() };
      },
    });
    const user = userEvent.setup();
    renderApp('/admin/users');
    await screen.findAllByTestId('user-row');
    await user.click(screen.getByRole('button', { name: 'Edit Lee Leaver' }));
    const form = screen.getByRole('dialog');
    await user.selectOptions(within(form).getByLabelText(/^Manager/), '');
    await user.click(within(form).getByLabelText('Active'));
    await user.click(within(form).getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(patches).toEqual([{ manager_id: null, is_active: false }]));
  });

  it("explains a refused deactivation on the Active checkbox, not as an unexplained 'fix the fields'", async () => {
    usersApi([person({ role: 'MANAGER', report_count: 2 })], {
      'PATCH /admin/users/u-lee': () =>
        fieldError('is_active', 'Reassign their 2 active reports first.'),
    });
    const user = userEvent.setup();
    renderApp('/admin/users');
    await screen.findAllByTestId('user-row');
    await user.click(screen.getByRole('button', { name: 'Edit Lee Leaver' }));
    const form = screen.getByRole('dialog');
    await user.click(within(form).getByLabelText('Active'));
    await user.click(within(form).getByRole('button', { name: 'Save changes' }));
    expect(
      await within(form).findByText('Reassign their 2 active reports first.'),
    ).toBeInTheDocument();
    expect(within(form).getByLabelText('Active')).toHaveAttribute('aria-invalid', 'true');
    expect(within(form).getByLabelText('Active')).toHaveAccessibleDescription(/Reassign their 2/);
    expect(form).toBeInTheDocument(); // still open, nothing lost
  });

  it('shows a conflict such as "last administrator" as a message for the whole form', async () => {
    usersApi([person({ role: 'ADMIN' })], {
      'PATCH /admin/users/u-lee': () =>
        errorBody('LAST_ADMIN', 'At least one administrator must stay active.', 409),
    });
    const user = userEvent.setup();
    renderApp('/admin/users');
    await screen.findAllByTestId('user-row');
    await user.click(screen.getByRole('button', { name: 'Edit Lee Leaver' }));
    const form = screen.getByRole('dialog');
    await user.selectOptions(within(form).getByLabelText(/^Role/), 'EMPLOYEE');
    await user.click(within(form).getByRole('button', { name: 'Save changes' }));
    expect(await within(form).findByRole('alert')).toHaveTextContent(
      'At least one administrator must stay active.',
    );
  });

  it('will not let you change your own role or deactivate yourself', async () => {
    usersApi([
      person({ id: ADMIN.id, email: ADMIN.email, display_name: ADMIN.display_name, role: 'ADMIN' }),
    ]);
    const user = userEvent.setup();
    renderApp('/admin/users');
    await screen.findAllByTestId('user-row');
    await user.click(screen.getByRole('button', { name: `Edit ${ADMIN.display_name}` }));
    const form = screen.getByRole('dialog');
    expect(within(form).getByLabelText(/^Role/)).toBeDisabled();
    expect(within(form).getByLabelText('Active')).toBeDisabled();
    expect(within(form).getByText('You cannot change your own role.')).toBeInTheDocument();
  });

  it('keeps an inactive current manager selectable so editing does not silently drop them', async () => {
    usersApi([
      person({ manager: { id: 'u-gone', display_name: 'Gil Gone', email: 'gil@example.test' } }),
    ]);
    const user = userEvent.setup();
    renderApp('/admin/users');
    await screen.findAllByTestId('user-row');
    await user.click(screen.getByRole('button', { name: 'Edit Lee Leaver' }));
    expect(screen.getByLabelText(/^Manager/)).toHaveValue('u-gone');
  });
});

describe('resetting a password', () => {
  it('asks first (safe choice focused), then shows the new one-time password', async () => {
    let resets = 0;
    usersApi([person()], {
      'POST /admin/users/u-lee/reset-password': () => {
        resets += 1;
        return { body: { temporary_password: TEMP } };
      },
    });
    const user = userEvent.setup();
    renderApp('/admin/users');
    await screen.findAllByTestId('user-row');
    await user.click(screen.getByRole('button', { name: 'Reset password for Lee Leaver' }));
    const confirm = screen.getByRole('alertdialog', { name: /Reset password for Lee Leaver/ });
    expect(within(confirm).getByRole('button', { name: 'Cancel' })).toHaveFocus();
    await user.click(within(confirm).getByRole('button', { name: 'Cancel' }));
    expect(resets).toBe(0);

    await user.click(screen.getByRole('button', { name: 'Reset password for Lee Leaver' }));
    await user.click(
      within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Reset password' }),
    );
    const shown = await screen.findByRole('alertdialog', { name: 'Password reset' });
    expect(within(shown).getByLabelText('Temporary password')).toHaveTextContent(TEMP);
    expect(shown).toHaveTextContent(/signed out everywhere/);
    expect(resets).toBe(1);
    await user.click(within(shown).getByRole('button', { name: /I have saved it/ }));
    expect(document.body).not.toHaveTextContent(TEMP);
  });

  it('keeps the confirmation open with the reason when the reset fails', async () => {
    usersApi([person()], {
      'POST /admin/users/u-lee/reset-password': () =>
        errorBody('NOT_FOUND', 'User not found.', 404),
    });
    const user = userEvent.setup();
    renderApp('/admin/users');
    await screen.findAllByTestId('user-row');
    await user.click(screen.getByRole('button', { name: 'Reset password for Lee Leaver' }));
    await user.click(
      within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Reset password' }),
    );
    expect(await within(screen.getByRole('alertdialog')).findByRole('alert')).toHaveTextContent(
      'User not found.',
    );
  });
});

describe('copying the password', () => {
  it('copies when the browser allows it and says so when it does not', async () => {
    usersApi([person()], {
      'POST /admin/users/u-lee/reset-password': () => ({ body: { temporary_password: TEMP } }),
    });
    const user = userEvent.setup();
    renderApp('/admin/users');
    await screen.findAllByTestId('user-row');
    await user.click(screen.getByRole('button', { name: 'Reset password for Lee Leaver' }));
    await user.click(
      within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Reset password' }),
    );
    const shown = await screen.findByRole('alertdialog', { name: 'Password reset' });

    const writeText = vi.fn().mockRejectedValue(new Error('denied'));
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    await user.click(within(shown).getByRole('button', { name: 'Copy password' }));
    expect(await within(shown).findByText(/Could not copy automatically/)).toBeInTheDocument();

    writeText.mockResolvedValue(undefined);
    await user.click(within(shown).getByRole('button', { name: 'Copy password' }));
    expect(await within(shown).findByText('Copied to the clipboard.')).toBeInTheDocument();
    expect(writeText).toHaveBeenLastCalledWith(TEMP);
  });
});
