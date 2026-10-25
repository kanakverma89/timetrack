import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRef } from 'react';
import { withdrawWeek } from '../../api/endpoints';
import { ApiError } from '../../api/client';
import type { TimesheetWeek } from '../../api/types';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { formatWeekRange } from '../../utils/dates';
import { formatHours } from '../../utils/hours';

interface Props {
  week: TimesheetWeek;
  onCancel: () => void;
  onWithdrawn: () => void;
}

export function WithdrawWeekDialog({ week, onCancel, onWithdrawn }: Props) {
  const queryClient = useQueryClient();
  const inFlight = useRef(false); // blocks a second click before React disables the button
  const withdraw = useMutation({
    mutationFn: () => withdrawWeek(week.week_start_date),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['week'] });
      onWithdrawn();
    },
    onError: (error) => {
      // A manager may have decided in the meantime: refresh so the screen shows the real state.
      if (error instanceof ApiError && (error.status === 404 || error.status === 409)) {
        void queryClient.invalidateQueries({ queryKey: ['week'] });
      }
    },
  });

  return (
    <ConfirmDialog
      title="Withdraw this submission?"
      confirmLabel={withdraw.isPending ? 'Withdrawing…' : 'Withdraw submission'}
      cancelLabel="Keep submitted"
      pending={withdraw.isPending}
      error={
        withdraw.isError
          ? withdraw.error instanceof ApiError
            ? withdraw.error.message
            : 'Could not withdraw the submission. Please try again.'
          : null
      }
      onCancel={onCancel}
      onConfirm={() => {
        if (inFlight.current) return;
        inFlight.current = true;
        withdraw.mutate(undefined, { onSettled: () => (inFlight.current = false) });
      }}
    >
      <p>
        <strong>{formatWeekRange(week.week_start_date, week.week_end_date)}</strong>:{' '}
        {formatHours(week.summary.total_hours)} hours in {week.summary.entry_count}{' '}
        {week.summary.entry_count === 1 ? 'entry' : 'entries'}.
      </p>
      <p>
        Your manager will no longer see this week for review. It becomes a draft again, so you can
        change the entries and submit it again.
      </p>
    </ConfirmDialog>
  );
}
