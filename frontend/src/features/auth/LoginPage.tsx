import { useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { ApiError } from '../../api/client';
import { SESSION_EXPIRED_KEY } from '../../app/queryClient';
import { useLogin, useSession } from '../../hooks/useSession';

function loginErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 429)
      return 'Too many failed attempts. Please wait a few minutes and try again.';
    if (error.status === 401) return 'Invalid email or password.';
    return error.message;
  }
  return 'Sign in failed. Please try again.';
}

export function LoginPage({ appName }: { appName: string }) {
  const session = useSession();
  const login = useLogin();
  const client = useQueryClient();
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const from = (location.state as { from?: string } | null)?.from ?? '/';
  const expired = client.getQueryData(SESSION_EXPIRED_KEY) === true;

  if (session.data) return <Navigate to={from} replace />;

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    login.mutate({ email, password }, { onSuccess: () => navigate(from, { replace: true }) });
  }

  return (
    <main className="login-page" id="main">
      <form className="card login-card" onSubmit={onSubmit} noValidate>
        <h1>Sign in to {appName}</h1>
        {expired ? (
          <p className="notice" role="status">
            Your session has ended. Please sign in again.
          </p>
        ) : null}
        {login.isError ? (
          <p className="form-error" role="alert">
            {loginErrorMessage(login.error)}
          </p>
        ) : null}
        <div className="field">
          <label htmlFor="email">
            Email <span className="required">(required)</span>
          </label>
          <input
            id="email"
            name="email"
            type="email"
            autoComplete="username"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="password">
            Password <span className="required">(required)</span>
          </label>
          <input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
        <button
          type="submit"
          className="btn btn-primary"
          disabled={login.isPending || !email.trim() || !password}
        >
          {login.isPending ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </main>
  );
}
