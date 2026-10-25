import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ADMIN, MANAGER, META, USER, week } from '../../test/fixtures';
import { mockApi } from '../../test/mockApi';
import { renderApp } from '../../test/renderApp';

afterEach(() => vi.unstubAllGlobals());

const LOCKED = { ...USER, must_change_password: true };

function api(user: typeof USER, extra: Record<string, Parameters<typeof mockApi>[0][string]> = {}) {
  return mockApi({
    'GET /auth/me': () => ({ body: user }),
    'GET /meta': () => ({ body: META }),
    'GET /timesheets/weeks/2026-10-19': () => ({ body: week('2026-10-19') }),
    'GET /approvals': () => ({ body: { items: [], page: 1, page_size: 1, total: 0 } }),
    ...extra,
  });
}

async function fill(current: string, next: string, again: string) {
  const user = userEvent.setup();
  await user.type(await screen.findByLabelText(/^Current password/), current);
  await user.type(screen.getByLabelText(/^New password/), next);
  await user.type(screen.getByLabelText(/^Repeat new password/), again);
  return user;
}

describe('forced password change', () => {
  it('sends someone with a temporary password to the change page and asks for nothing else', async () => {
    const { calls } = api(LOCKED);
    renderApp('/');
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Choose a new password' }),
    ).toBeInTheDocument();
    expect(screen.getByText(/signed in with a temporary password/i)).toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: 'Main' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Change password' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeInTheDocument();
    // The API would refuse these anyway; the app does not even try.
    expect(calls).not.toContain('GET /meta');
    expect(calls).not.toContain('GET /approvals');
    expect(calls.some((call) => call.startsWith('GET /timesheets'))).toBe(false);
  });

  it('keeps redirecting every other address back to the change page', async () => {
    api({ ...MANAGER, must_change_password: true });
    renderApp('/approvals');
    expect(
      await screen.findByRole('heading', { name: 'Choose a new password' }),
    ).toBeInTheDocument();
  });

  it('checks length, repetition and difference before sending anything', async () => {
    const { calls } = api(LOCKED);
    renderApp('/account/password');
    const user = await fill('temp-password-1', 'short', 'different');
    await user.click(screen.getByRole('button', { name: 'Change password' }));
    expect(screen.getByRole('alert')).toHaveFocus();
    expect(screen.getByText('Use at least 12 characters.')).toBeInTheDocument();
    expect(screen.getByText('The two new passwords do not match.')).toBeInTheDocument();
    expect(screen.getByLabelText(/^New password/)).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByLabelText(/^New password/)).toHaveAccessibleDescription(/at least 12/i);
    expect(calls).not.toContain('POST /auth/change-password');

    // The same password again is refused locally too.
    const again = userEvent.setup();
    await again.clear(screen.getByLabelText(/^New password/));
    await again.type(screen.getByLabelText(/^New password/), 'temp-password-1');
    await again.clear(screen.getByLabelText(/^Repeat new password/));
    await again.type(screen.getByLabelText(/^Repeat new password/), 'temp-password-1');
    await again.click(screen.getByRole('button', { name: 'Change password' }));
    expect(screen.getByText(/different from the current one/)).toBeInTheDocument();
    expect(calls).not.toContain('POST /auth/change-password');
  });

  it("shows the server's explanation beside the right field and lets the person retry", async () => {
    let attempt = 0;
    api(LOCKED, {
      'POST /auth/change-password': () => {
        attempt += 1;
        return attempt === 1
          ? {
              status: 422,
              body: {
                error: {
                  code: 'VALIDATION_ERROR',
                  message: 'bad',
                  field_errors: { new_password: 'That password is too easy to guess.' },
                  request_id: 'r',
                },
              },
            }
          : { status: 204 };
      },
      'GET /timesheets/weeks/2026-10-19': () => ({ body: week('2026-10-19') }),
    });
    renderApp('/account/password');
    const user = await fill('temp-password-1', 'password12345', 'password12345');
    await user.click(screen.getByRole('button', { name: 'Change password' }));
    expect(await screen.findByText('That password is too easy to guess.')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveFocus();
    expect(screen.getByLabelText(/^New password/)).toHaveAttribute('aria-invalid', 'true');

    await user.clear(screen.getByLabelText(/^New password/));
    await user.type(screen.getByLabelText(/^New password/), 'violet harbor lantern 47');
    await user.clear(screen.getByLabelText(/^Repeat new password/));
    await user.type(screen.getByLabelText(/^Repeat new password/), 'violet harbor lantern 47');
    await user.click(screen.getByRole('button', { name: 'Change password' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Timesheet' })).toBeInTheDocument();
  });

  it('reports a wrong current password on that field, not as a sign-out', async () => {
    api(LOCKED, {
      'POST /auth/change-password': () => ({
        status: 422,
        body: {
          error: {
            code: 'VALIDATION_ERROR',
            message: 'bad',
            field_errors: { current_password: 'The current password is not correct.' },
            request_id: 'r',
          },
        },
      }),
    });
    renderApp('/account/password');
    const user = await fill(
      'wrong-one-12345',
      'violet harbor lantern 47',
      'violet harbor lantern 47',
    );
    await user.click(screen.getByRole('button', { name: 'Change password' }));
    expect(await screen.findByText('The current password is not correct.')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Choose a new password' })).toBeInTheDocument();
  });

  it('says so when the attempts are throttled', async () => {
    api(LOCKED, {
      'POST /auth/change-password': () => ({
        status: 429,
        body: {
          error: { code: 'RATE_LIMITED', message: 'Too many.', field_errors: {}, request_id: 'r' },
        },
      }),
    });
    renderApp('/account/password');
    const user = await fill(
      'temp-password-1',
      'violet harbor lantern 47',
      'violet harbor lantern 47',
    );
    await user.click(screen.getByRole('button', { name: 'Change password' }));
    expect(await screen.findByText(/Too many attempts/)).toBeInTheDocument();
  });

  it('sends exactly the two passwords once, unlocks the app and shows the normal navigation', async () => {
    const { fetchMock, calls } = api(LOCKED, {
      'POST /auth/change-password': () => ({ status: 204 }),
    });
    renderApp('/');
    const user = await fill(
      'temp-password-1',
      'violet harbor lantern 47',
      'violet harbor lantern 47',
    );
    await user.dblClick(screen.getByRole('button', { name: 'Change password' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Timesheet' })).toBeInTheDocument();

    const sent = fetchMock.mock.calls.filter(([url]) =>
      String(url).endsWith('/auth/change-password'),
    );
    expect(sent).toHaveLength(1); // a double click is one request
    expect(JSON.parse(String(sent[0]?.[1]?.body))).toEqual({
      current_password: 'temp-password-1',
      new_password: 'violet harbor lantern 47',
    });
    const nav = await screen.findByRole('navigation', { name: 'Main' });
    expect(within(nav).getByRole('link', { name: 'Timesheet' })).toBeInTheDocument();
    expect(calls).toContain('GET /meta'); // data loads only now
  });
});

describe('voluntary password change', () => {
  it('is reachable from the header, stays on the page and confirms', async () => {
    api(USER, { 'POST /auth/change-password': () => ({ status: 204 }) });
    const user = userEvent.setup();
    renderApp('/');
    await user.click(await screen.findByRole('link', { name: 'Change password' }));
    expect(screen.getByRole('heading', { level: 1, name: 'Change password' })).toBeInTheDocument();
    expect(screen.queryByText(/temporary password/i)).not.toBeInTheDocument();

    await user.type(screen.getByLabelText(/^Current password/), 'my-old-password-1');
    await user.type(screen.getByLabelText(/^New password/), 'violet harbor lantern 47');
    await user.type(screen.getByLabelText(/^Repeat new password/), 'violet harbor lantern 47');
    await user.click(screen.getByRole('button', { name: 'Change password' }));
    expect(await screen.findByText(/Your password was changed/)).toBeInTheDocument();
    expect(screen.getByLabelText(/^Current password/)).toHaveValue(''); // nothing left in the form
    expect(screen.getByLabelText(/^New password/)).toHaveValue('');
  });
});

describe('navigation by role', () => {
  it.each([
    [USER, false, false],
    [MANAGER, true, false],
    [ADMIN, true, true],
  ])('%#: Reports=%s Admin=%s', async (person, reports, admin) => {
    api(person);
    renderApp('/');
    const nav = await screen.findByRole('navigation', { name: 'Main' });
    expect(!!within(nav).queryByRole('link', { name: 'Reports' })).toBe(reports);
    expect(!!within(nav).queryByRole('link', { name: 'Admin' })).toBe(admin);
    await waitFor(() => expect(screen.getByText(person.display_name)).toBeInTheDocument());
  });

  it('turns a manager away from the admin area without asking the API for anything', async () => {
    const { calls } = api(MANAGER);
    renderApp('/admin/users');
    expect(await screen.findByRole('heading', { name: /do not have access/i })).toBeInTheDocument();
    expect(calls.some((call) => call.includes('/admin/'))).toBe(false);
  });
});
