import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useId, useRef, useState } from 'react';
import { submitWeek } from '../../api/endpoints';
import { ApiError } from '../../api/client';
import type { TimesheetWeek } from '../../api/types';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { formatWeekRange } from '../../utils/dates';
import { formatHours } from '../../utils/hours';
import { newIdempotencyKey } from '../../utils/idempotency';
import { describeSubmitErrors } from './submitErrors';

const COMMENT_MAX = 500;

interface Props {
  week: TimesheetWeek;
  onCancel: () => void;
  onSubmitted: () => void;
}

export function SubmitWeekDialog({ week, onCancel, onSubmitted }: Props) {
  const queryClient = useQueryClient();
  const commentId = useId();
  const [comment, setComment] = useState('');
  // One key per opened dialog: a retry of this same action reuses it, a new dialog gets a new one.
  const key = useRef<string>(newIdempotencyKey());
  const resubmitting = week.status === 'REJECTED';
  // React re-renders (and disables the button) a moment after a click; two clicks inside that gap
  // would otherwise both send a request.
  const inFlight = useRef(false);

  const submit = useMutation({
    mutationFn: () => submitWeek(week.week_start_date, comment.trim() || null, key.current),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['week'] });
      onSubmitted();
    },
    onError: (error) => {
      // The week may have changed elsewhere (e.g. already submitted): show the real state behind.
      if (error instanceof ApiError && error.status !== 422) {
        void queryClient.invalidateQueries({ queryKey: ['week'] });
      }
    },
  });

  let errorContent = null;
  if (submit.isError) {
    const error = submit.error;
    if (error instanceof ApiError && error.status === 422) {
      const lines = describeSubmitErrors(error.fieldErrors, week.entries);
      errorContent = (
        <>
          <p>
            <strong>This week cannot be submitted yet.</strong>
          </p>
          <ul>
            {lines.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
          <p>Close this dialog, fix the entries, and submit again.</p>
        </>
      );
    } else {
      errorContent = (
        <p>{error instanceof ApiError ? error.message : 'Could not submit the week.'}</p>
      );
    }
  }

  const { summary } = week;
  return (
    <ConfirmDialog
      title={resubmitting ? 'Resubmit this week?' : 'Submit this week?'}
      confirmLabel={
        submit.isPending ? 'Submitting…' : resubmitting ? 'Resubmit week' : 'Submit week'
      }
      cancelLabel="Cancel"
      pending={submit.isPending}
      error={errorContent}
      onCancel={onCancel}
      onConfirm={() => {
        if (inFlight.current) return;
        inFlight.current = true;
        submit.mutate(undefined, { onSettled: () => (inFlight.current = false) });
      }}
    >
      <p>
        <strong>{formatWeekRange(week.week_start_date, week.week_end_date)}</strong>:{' '}
        {summary.entry_count} {summary.entry_count === 1 ? 'entry' : 'entries'},{' '}
        {formatHours(summary.total_hours)} hours ({formatHours(summary.capped_hours)} capped,{' '}
        {formatHours(summary.non_capped_hours)} non-capped).
      </p>
      <p>
        After you submit, entries can no longer be added, changed or deleted unless your manager
        rejects the week.
      </p>
      <div className="field">
        <label htmlFor={commentId}>
          Comment for your manager <span className="required">(optional)</span>
        </label>
        <textarea
          id={commentId}
          rows={3}
          maxLength={COMMENT_MAX}
          value={comment}
          disabled={submit.isPending}
          onChange={(event) => setComment(event.target.value)}
        />
        <p className="hint">
          {comment.length} / {COMMENT_MAX} characters
        </p>
      </div>
    </ConfirmDialog>
  );
}
