import type { HistoryItem } from '../../api/types';
import { formatTimestamp } from '../../utils/dates';

const VERB: Record<HistoryItem['action'], string> = {
  SUBMITTED: 'Submitted',
  APPROVED: 'Approved',
  REJECTED: 'Rejected',
  WITHDRAWN: 'Withdrawn',
};

/** The append-only decision trail, oldest first. Comments are shown as plain text. */
export function ApprovalHistory({ items, timeZone }: { items: HistoryItem[]; timeZone: string }) {
  return (
    <section className="history" aria-labelledby="history-heading">
      <h2 id="history-heading">History</h2>
      <ol className="history-list">
        {items.map((item, index) => (
          <li
            key={`${item.created_at}-${index}`}
            className={`history-item history-${item.action.toLowerCase()}`}
          >
            <p>
              <strong>{VERB[item.action]}</strong> by {item.actor.display_name}{' '}
              <span className="muted">· {formatTimestamp(item.created_at, timeZone)}</span>
            </p>
            {item.comment ? <p className="history-comment">{item.comment}</p> : null}
          </li>
        ))}
      </ol>
    </section>
  );
}
