import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { META, USER, week } from '../../test/fixtures';
import { errorBody, mockApi } from '../../test/mockApi';
import { renderApp } from '../../test/renderApp';

afterEach(() => vi.unstubAllGlobals());

const unauthenticated = () => errorBody('UNAUTHENTICATED', 'Authentication is required.', 401);

describe('authentication flow', () => {
  it('redirects an unauthenticated visitor to the sign-in form', async () => {
    mockApi({ 'GET /auth/me': unauthenticated });
    renderApp('/');
    expect(
      await screen.findByRole('heading', { name: /sign in to timetrack/i }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText(/email/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/password/i)).toHaveAttribute('type', 'password');
  });

  it('keeps the submit button disabled until both fields are filled', async () => {
    const user = userEvent.setup();
    mockApi({ 'GET /auth/me': unauthenticated });
    renderApp('/login');
    const submit = await screen.findByRole('button', { name: 'Sign in' });
    expect(submit).toBeDisabled();
    await user.type(screen.getByLabelText(/email/i), 'employee@example.test');
    expect(submit).toBeDisabled();
    await user.type(screen.getByLabelText(/password/i), 'x');
    expect(submit).toBeEnabled();
  });

  it('signs in and lands on the dashboard', async () => {
    const user = userEvent.setup();
    const { fetchMock } = mockApi({
      'GET /auth/me': unauthenticated,
      'POST /auth/login': () => ({ body: USER }),
      'GET /meta': () => ({ body: META }),
      'GET /timesheets/weeks/2026-10-19': () => ({ body: week('2026-10-19') }),
    });
    renderApp('/');
    await user.type(await screen.findByLabelText(/email/i), 'employee@example.test');
    await user.type(screen.getByLabelText(/password/i), 'a-password');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(await screen.findByRole('heading', { name: 'Timesheet' })).toBeInTheDocument();
    expect(screen.getByText('Alex Employee')).toBeInTheDocument();
    const login = fetchMock.mock.calls.find(([url]) => String(url).endsWith('/auth/login'));
    expect(JSON.parse(String(login?.[1]?.body))).toEqual({
      email: 'employee@example.test',
      password: 'a-password',
    });
  });

  it('shows a generic error for bad credentials and stays on the form', async () => {
    const user = userEvent.setup();
    mockApi({
      'GET /auth/me': unauthenticated,
      'POST /auth/login': () => errorBody('INVALID_CREDENTIALS', 'Invalid email or password.', 401),
    });
    renderApp('/login');
    await user.type(await screen.findByLabelText(/email/i), 'employee@example.test');
    await user.type(screen.getByLabelText(/password/i), 'wrong');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Invalid email or password.');
    expect(screen.getByRole('heading', { name: /sign in/i })).toBeInTheDocument();
  });

  it('explains rate limiting', async () => {
    const user = userEvent.setup();
    mockApi({
      'GET /auth/me': unauthenticated,
      'POST /auth/login': () => errorBody('RATE_LIMITED', 'Too many attempts.', 429),
    });
    renderApp('/login');
    await user.type(await screen.findByLabelText(/email/i), 'employee@example.test');
    await user.type(screen.getByLabelText(/password/i), 'wrong');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/too many failed attempts/i);
  });

  it('signs out, clears cached data and returns to the sign-in form', async () => {
    const user = userEvent.setup();
    let signedOut = false;
    const { client } = (() => {
      mockApi({
        'GET /auth/me': () => (signedOut ? unauthenticated() : { body: USER }),
        'GET /meta': () => ({ body: META }),
        'GET /timesheets/weeks/2026-10-19': () => ({ body: week('2026-10-19') }),
        'POST /auth/logout': () => {
          signedOut = true;
          return { status: 204 };
        },
      });
      return renderApp('/');
    })();
    await screen.findByRole('heading', { name: 'Timesheet' });
    await user.click(screen.getByRole('button', { name: 'Sign out' }));
    expect(
      await screen.findByRole('heading', { name: /sign in to timetrack/i }),
    ).toBeInTheDocument();
    await waitFor(() => expect(client.getQueryData(['week', '2026-10-19'])).toBeUndefined());
  });

  it('surfaces a network failure while checking the session with a retry', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch');
      }),
    );
    renderApp('/');
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/unable to reach the server/i);
    expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument();
  });
});
