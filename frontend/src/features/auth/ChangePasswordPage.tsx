import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { ApiError } from '../../api/client';
import { changePassword } from '../../api/endpoints';
import { SESSION_KEY } from '../../app/queryClient';
import { FieldError } from '../../components/FieldError';
import { useSession } from '../../hooks/useSession';
import type { User } from '../../api/types';

const MIN_LENGTH = 12;

interface Problems {
  current?: string;
  next?: string;
  confirm?: string;
  form?: string;
}

function serverProblems(error: unknown): Problems {
  if (!(error instanceof ApiError)) return { form: 'Could not change the password. Try again.' };
  if (error.status === 429) {
    return { form: 'Too many attempts. Please wait a few minutes and try again.' };
  }
  const fields = error.fieldErrors;
  if (fields.current_password || fields.new_password) {
    return { current: fields.current_password, next: fields.new_password };
  }
  return { form: error.message };
}

/**
 * Change your own password. When an administrator issued a temporary password the same screen is
 * the only thing that works ("forced"): the rest of the app redirects here until it is done.
 */
export function ChangePasswordPage() {
  const { data: user } = useSession();
  const forced = user?.must_change_password === true;
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const ids = { current: useId(), next: useId(), confirm: useId(), hint: useId() };
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [problems, setProblems] = useState<Problems>({});
  const [done, setDone] = useState(false);
  const inFlight = useRef(false);
  const summary = useRef<HTMLDivElement>(null);
  const hasProblems = Object.values(problems).some(Boolean);

  useEffect(() => {
    document.title = 'Change password · TimeTrack';
  }, []);
  // Move focus to the explanation when validation fails, so it is announced and Tab continues from it.
  useEffect(() => {
    if (hasProblems) summary.current?.focus();
  }, [hasProblems, problems]);

  const change = useMutation({
    mutationFn: () => changePassword(current, next),
    onSuccess: () => {
      setCurrent('');
      setNext('');
      setConfirm('');
      if (user) {
        const updated: User = { ...user, must_change_password: false };
        queryClient.setQueryData(SESSION_KEY, updated);
      }
      // Anything fetched under the old state (403s while locked, a missing nav) is stale now.
      queryClient.removeQueries({ predicate: (query) => query.queryKey[0] !== SESSION_KEY[0] });
      if (forced) navigate('/', { replace: true });
      else setDone(true);
    },
    onError: (error) => setProblems(serverProblems(error)),
  });

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (inFlight.current) return;
    setDone(false);
    const found: Problems = {};
    if (!current) found.current = 'Enter your current password.';
    if (next.length < MIN_LENGTH) found.next = `Use at least ${MIN_LENGTH} characters.`;
    else if (next === current) found.next = 'Choose a password different from the current one.';
    if (confirm !== next) found.confirm = 'The two new passwords do not match.';
    setProblems(found);
    if (Object.values(found).some(Boolean)) return;
    inFlight.current = true;
    change.mutate(undefined, { onSettled: () => (inFlight.current = false) });
  }

  const describe = (field: keyof Problems, id: string) =>
    problems[field] ? `${id}-error` : undefined;

  return (
    <div className="narrow">
      <h1>{forced ? 'Choose a new password' : 'Change password'}</h1>
      {forced ? (
        <p className="notice" role="status">
          You signed in with a temporary password. Choose your own password to continue.
        </p>
      ) : null}
      {done ? (
        <p className="notice" role="status">
          Your password was changed. Any other devices were signed out.
        </p>
      ) : null}
      <form className="card" onSubmit={onSubmit} noValidate>
        {hasProblems ? (
          <div ref={summary} className="form-error" role="alert" tabIndex={-1}>
            {problems.form ?? 'Please fix the highlighted fields.'}
          </div>
        ) : null}
        <div className="field">
          <label htmlFor={ids.current}>
            Current password <span className="required">(required)</span>
          </label>
          <input
            id={ids.current}
            type="password"
            autoComplete="current-password"
            value={current}
            aria-invalid={problems.current ? 'true' : undefined}
            aria-describedby={describe('current', ids.current)}
            onChange={(event) => setCurrent(event.target.value)}
          />
          <FieldError id={`${ids.current}-error`} message={problems.current} />
        </div>
        <div className="field">
          <label htmlFor={ids.next}>
            New password <span className="required">(required)</span>
          </label>
          <input
            id={ids.next}
            type="password"
            autoComplete="new-password"
            value={next}
            aria-invalid={problems.next ? 'true' : undefined}
            aria-describedby={[ids.hint, describe('next', ids.next)].filter(Boolean).join(' ')}
            onChange={(event) => setNext(event.target.value)}
          />
          <p id={ids.hint} className="hint">
            At least {MIN_LENGTH} characters. Avoid common passwords and anything that contains your
            name or email.
          </p>
          <FieldError id={`${ids.next}-error`} message={problems.next} />
        </div>
        <div className="field">
          <label htmlFor={ids.confirm}>
            Repeat new password <span className="required">(required)</span>
          </label>
          <input
            id={ids.confirm}
            type="password"
            autoComplete="new-password"
            value={confirm}
            aria-invalid={problems.confirm ? 'true' : undefined}
            aria-describedby={describe('confirm', ids.confirm)}
            onChange={(event) => setConfirm(event.target.value)}
          />
          <FieldError id={`${ids.confirm}-error`} message={problems.confirm} />
        </div>
        <button type="submit" className="btn btn-primary" disabled={change.isPending}>
          {change.isPending ? 'Saving…' : 'Change password'}
        </button>
      </form>
    </div>
  );
}
