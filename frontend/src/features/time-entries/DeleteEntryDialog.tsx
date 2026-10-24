import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRef } from 'react';
import { deleteEntry } from '../../api/endpoints';
import { ApiError } from '../../api/client';
import type { TimeEntry } from '../../api/types';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { longDate } from '../../utils/dates';
import { formatHours } from '../../utils/hours';

interface Props {
  entry: TimeEntry;
  onCancel: () => void;
  onDeleted: () => void;
}

export function DeleteEntryDialog({ entry, onCancel, onDeleted }: Props) {
  const queryClient = useQueryClient();
  const inFlight = useRef(false); // blocks a second click before React disables the button
  const remove = useMutation({
    mutationFn: () => deleteEntry(entry.id),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['week'] });
      onDeleted();
    },
    onError: (error) => {
      // e.g. the week was submitted elsewhere: refresh so the screen shows the real state.
      if (error instanceof ApiError && (error.status === 404 || error.status === 409)) {
        void queryClient.invalidateQueries({ queryKey: ['week'] });
      }
    },
  });

  return (
    <ConfirmDialog
      title="Delete this entry?"
      confirmLabel={remove.isPending ? 'Deleting…' : 'Delete entry'}
      cancelLabel="Cancel"
      danger
      pending={remove.isPending}
      error={
        remove.isError
          ? remove.error instanceof ApiError
            ? remove.error.message
            : 'Could not delete the entry. Please try again.'
          : null
      }
      onCancel={onCancel}
      onConfirm={() => {
        if (inFlight.current) return;
        inFlight.current = true;
        remove.mutate(undefined, { onSettled: () => (inFlight.current = false) });
      }}
    >
      <p>
        <strong>{entry.project.code}</strong> · {formatHours(entry.hours)} h on{' '}
        {longDate(entry.work_date)}.
      </p>
      <p>This cannot be undone.</p>
    </ConfirmDialog>
  );
}
