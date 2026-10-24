import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useId, useRef, useState } from 'react';
import { approveWeek, rejectWeek } from '../../api/endpoints';
import { ApiError } from '../../api/client';
import type { ApprovalDetail } from '../../api/types';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { formatWeekRange } from '../../utils/dates';
import { formatHours } from '../../utils/hours';
import { newIdempotencyKey } from '../../utils/idempotency';

export const MIN_REASON_LENGTH = 5;
const REASON_MAX = 1000;
const APPROVE_COMMENT_MAX = 500;

interface Props {
  mode: 'approve' | 'reject';
  detail: ApprovalDetail;
  onCancel: () => void;
  onDecided: (mode: 'approve' | 'reject') => void;
}

export function DecisionDialog({ mode, detail, onCancel, onDecided }: Props) {
  const queryClient = useQueryClient();
  const fieldId = useId();
  const [text, setText] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  // One key per opened dialog: retrying this decision reuses it, a new dialog gets a new one.
  const key = useRef<string>(newIdempotencyKey());
  // React disables the button a moment after a click; this blocks a second click in that gap.
  const inFlight = useRef(false);
  const rejecting = mode === 'reject';
  const { week, employee } = detail;
  const weekId = week.id as string;

  const decide = useMutation({
    mutationFn: () =>
      rejecting
        ? rejectWeek(weekId, text.trim(), key.current)
        : approveWeek(weekId, text.trim() || null, key.current),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['approval', weekId] });
      await queryClient.invalidateQueries({ queryKey: ['approvals'] });
      onDecided(mode);
    },
    onError: (error) => {
      // Someone else may have decided already (or the week changed): show the real state behind.
      if (error instanceof ApiError && error.status !== 422) {
        void queryClient.invalidateQueries({ queryKey: ['approval', weekId] });
      }
    },
  });

  function confirm() {
    if (inFlight.current) return;
    if (rejecting && text.trim().length < MIN_REASON_LENGTH) {
      setProblem(`Explain why the week is rejected (at least ${MIN_REASON_LENGTH} characters).`);
      return;
    }
    setProblem(null);
    inFlight.current = true;
    decide.mutate(undefined, { onSettled: () => (inFlight.current = false) });
  }

  let error = null;
  if (problem) error = <p>{problem}</p>;
  else if (decide.isError) {
    const failure = decide.error;
    const message =
      failure instanceof ApiError
        ? (failure.fieldErrors.comment ?? failure.message)
        : 'Could not save the decision. Please try again.';
    error = <p>{message}</p>;
  }

  return (
    <ConfirmDialog
      title={rejecting ? 'Reject this week?' : 'Approve this week?'}
      confirmLabel={decide.isPending ? 'Saving…' : rejecting ? 'Reject week' : 'Approve week'}
      cancelLabel="Cancel"
      danger={rejecting}
      pending={decide.isPending}
      error={error}
      onCancel={onCancel}
      onConfirm={confirm}
    >
      <p>
        <strong>{employee.display_name}</strong>,{' '}
        {formatWeekRange(week.week_start_date, week.week_end_date)}:{' '}
        {formatHours(week.summary.total_hours)} hours in {week.summary.entry_count}{' '}
        {week.summary.entry_count === 1 ? 'entry' : 'entries'}.
      </p>
      <p>
        {rejecting
          ? 'The week returns to the employee, who will see your reason and can correct and resubmit it.'
          : 'The week becomes read-only and the employee is notified.'}
      </p>
      <div className="field">
        <label htmlFor={fieldId}>
          {rejecting ? 'Reason for rejection' : 'Comment for the employee'}{' '}
          <span className="required">({rejecting ? 'required' : 'optional'})</span>
        </label>
        <textarea
          id={fieldId}
          rows={4}
          maxLength={rejecting ? REASON_MAX : APPROVE_COMMENT_MAX}
          value={text}
          disabled={decide.isPending}
          aria-required={rejecting ? 'true' : undefined}
          aria-invalid={problem ? 'true' : undefined}
          onChange={(event) => {
            setText(event.target.value);
            setProblem(null);
          }}
        />
        <p className="hint">
          {text.length} / {rejecting ? REASON_MAX : APPROVE_COMMENT_MAX} characters
        </p>
      </div>
    </ConfirmDialog>
  );
}
