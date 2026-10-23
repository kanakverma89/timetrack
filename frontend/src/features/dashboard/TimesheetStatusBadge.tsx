import type { WeekStatus } from '../../api/types';

const LABELS: Record<WeekStatus, { text: string; symbol: string }> = {
  DRAFT: { text: 'Draft', symbol: '✎' },
  SUBMITTED: { text: 'Submitted', symbol: '➜' },
  APPROVED: { text: 'Approved', symbol: '✓' },
  REJECTED: { text: 'Rejected', symbol: '!' },
};

/** Status is conveyed by text and a symbol, never by colour alone. */
export function TimesheetStatusBadge({ status }: { status: WeekStatus }) {
  const { text, symbol } = LABELS[status];
  return (
    <span className={`badge badge-${status.toLowerCase()}`}>
      <span aria-hidden="true">{symbol}</span> {text}
    </span>
  );
}
