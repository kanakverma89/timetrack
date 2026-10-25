import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState, type FormEvent } from 'react';
import { fetchPolicy, resetPolicy, savePolicy } from '../../api/endpoints';
import type { Policy } from '../../api/types';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { ErrorState, errorMessage } from '../../components/ErrorState';
import { TextField } from '../../components/Fields';
import { Toast } from '../../components/Toast';
import { formatTimestamp } from '../../utils/dates';
import { useMeta } from '../../hooks/useMeta';
import { NO_PROBLEMS, problemsOf, type Problems } from './problems';

const HOURS = /^\d{1,3}(\.\d{1,2})?$/;

/** "24.00" reads better as "24"; "7.50" stays as it is. */
const plain = (value: string) => value.replace(/\.00$/, '');

/** "8", "8.5", "8.50" are fine; returns an error message or null. */
function checkHours(value: string, max: number, required: boolean): string | null {
  const text = value.trim();
  if (!text) return required ? 'Enter a number of hours.' : null;
  if (!HOURS.test(text)) return 'Use a number with at most two decimal places, like 7.5.';
  const number = Number(text);
  if (number <= 0) return 'Must be more than zero.';
  if (number > max) return `Must be at most ${max}.`;
  return null;
}

function PolicyForm({ policy, onSaved }: { policy: Policy; onSaved: (message: string) => void }) {
  const queryClient = useQueryClient();
  const [entry, setEntry] = useState(plain(policy.max_hours_per_entry));
  const [day, setDay] = useState(plain(policy.max_hours_per_day ?? ''));
  const [week, setWeek] = useState(plain(policy.max_hours_per_week ?? ''));
  const [length, setLength] = useState(String(policy.description_max_length));
  const [problems, setProblems] = useState<Problems>(NO_PROBLEMS);
  const [confirmingReset, setConfirmingReset] = useState(false);
  const summary = useRef<HTMLDivElement>(null);
  const inFlight = useRef(false);

  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: ['admin', 'policy'] });
    // Entry forms read these limits from /meta, so they must see the new values straight away.
    await queryClient.invalidateQueries({ queryKey: ['meta'] });
  };

  const save = useMutation({
    mutationFn: () =>
      savePolicy({
        max_hours_per_entry: entry.trim(),
        max_hours_per_day: day.trim() || null,
        max_hours_per_week: week.trim() || null,
        description_max_length: Number(length),
      }),
    onSuccess: async () => {
      await refresh();
      onSaved('Policy saved. It applies to the next entry or submission.');
    },
    onError: (error) => {
      setProblems(problemsOf(error));
      queueMicrotask(() => summary.current?.focus());
    },
  });

  const restore = useMutation({
    mutationFn: resetPolicy,
    onSuccess: async () => {
      setConfirmingReset(false);
      await refresh();
      onSaved('Restored the defaults from the environment.');
    },
  });

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (inFlight.current) return;
    const found: Record<string, string> = {};
    const e = checkHours(entry, 24, true);
    if (e) found.max_hours_per_entry = e;
    const d = checkHours(day, 24, false);
    if (d) found.max_hours_per_day = d;
    const w = checkHours(week, 168, false);
    if (w) found.max_hours_per_week = w;
    if (!/^\d+$/.test(length.trim()) || Number(length) < 1 || Number(length) > 256) {
      found.description_max_length = 'Enter a whole number from 1 to 256.';
    }
    if (Object.keys(found).length > 0) {
      setProblems({ fields: found, message: 'Please fix the highlighted fields.' });
      queueMicrotask(() => summary.current?.focus());
      return;
    }
    setProblems(NO_PROBLEMS);
    inFlight.current = true;
    save.mutate(undefined, { onSettled: () => (inFlight.current = false) });
  }

  const customised = policy.source === 'database';

  return (
    <form className="card" onSubmit={onSubmit} noValidate>
      {problems.message ? (
        <div ref={summary} className="form-error" role="alert" tabIndex={-1}>
          {problems.message}
        </div>
      ) : null}
      <TextField
        label="Maximum hours in one entry"
        requirement="required"
        inputMode="decimal"
        hint="Up to 24. Checked every time an entry is saved."
        value={entry}
        error={problems.fields.max_hours_per_entry}
        onChange={setEntry}
      />
      <TextField
        label="Maximum hours in one day"
        requirement="optional"
        inputMode="decimal"
        hint="Checked when a week is submitted. Leave empty for no limit."
        value={day}
        error={problems.fields.max_hours_per_day}
        onChange={setDay}
      />
      <TextField
        label="Maximum hours in one week"
        requirement="optional"
        inputMode="decimal"
        hint="Checked when a week is submitted. Leave empty for no limit."
        value={week}
        error={problems.fields.max_hours_per_week}
        onChange={setWeek}
      />
      <TextField
        label="Maximum description length"
        requirement="required"
        inputMode="numeric"
        hint="Characters, up to 256."
        value={length}
        error={problems.fields.description_max_length}
        onChange={setLength}
      />
      <div className="dialog-actions">
        <button
          type="button"
          className="btn btn-secondary"
          disabled={!customised || save.isPending}
          onClick={() => setConfirmingReset(true)}
        >
          Restore defaults
        </button>
        <button type="submit" className="btn btn-primary" disabled={save.isPending}>
          {save.isPending ? 'Saving…' : 'Save policy'}
        </button>
      </div>
      {confirmingReset ? (
        <ConfirmDialog
          title="Restore the default policy?"
          confirmLabel={restore.isPending ? 'Restoring…' : 'Restore defaults'}
          cancelLabel="Cancel"
          danger
          pending={restore.isPending}
          error={restore.isError ? <p>{errorMessage(restore.error)}</p> : null}
          onCancel={() => {
            restore.reset();
            setConfirmingReset(false);
          }}
          onConfirm={() => {
            if (!restore.isPending) restore.mutate();
          }}
        >
          <p>
            The limits you set here are removed and the values from the server's configuration apply
            again. Existing entries and weeks are not changed.
          </p>
        </ConfirmDialog>
      ) : null}
    </form>
  );
}

const DEFAULT_LABELS: Record<string, string> = {
  max_hours_per_entry: 'Hours in one entry',
  max_hours_per_day: 'Hours in one day',
  max_hours_per_week: 'Hours in one week',
  description_max_length: 'Description length',
};

export function PolicyPage() {
  const [toast, setToast] = useState('');
  const meta = useMeta();
  const policy = useQuery({ queryKey: ['admin', 'policy'], queryFn: fetchPolicy });

  return (
    <section aria-labelledby="policy-heading">
      <h2 id="policy-heading">Hour policy</h2>
      {policy.isError ? (
        <ErrorState error={policy.error} onRetry={() => void policy.refetch()} />
      ) : !policy.data ? (
        <div className="skeleton skeleton-block tall" role="status" aria-label="Loading policy" />
      ) : (
        <>
          <p className="notice" role="status">
            {policy.data.source === 'database'
              ? `Customised${policy.data.updated_by_name ? ` by ${policy.data.updated_by_name}` : ''}${
                  policy.data.updated_at
                    ? ` on ${formatTimestamp(policy.data.updated_at, meta.data?.business_timezone ?? 'UTC')}`
                    : ''
                }.`
              : 'Using the defaults from the server configuration. Saving creates your own settings.'}
          </p>
          {/* Keyed so the form restarts from the saved values after every save or restore. */}
          <PolicyForm
            key={`${policy.data.source}-${policy.data.updated_at ?? 'default'}`}
            policy={policy.data}
            onSaved={setToast}
          />
          <h3>Server defaults</h3>
          <p className="hint">What applies if the customised settings are removed.</p>
          <dl className="facts">
            {Object.entries(policy.data.environment_defaults).map(([key, value]) => (
              <div key={key}>
                <dt>{DEFAULT_LABELS[key] ?? key}</dt>
                <dd>{value === null || value === undefined ? 'No limit' : plain(String(value))}</dd>
              </div>
            ))}
          </dl>
        </>
      )}
      <Toast message={toast} onDismiss={() => setToast('')} />
    </section>
  );
}
