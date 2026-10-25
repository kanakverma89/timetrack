import { useQuery } from '@tanstack/react-query';
import { fetchAudit } from '../../api/endpoints';
import type { AuditItem, ConfigAction, ConfigEntity } from '../../api/types';
import { EmptyState } from '../../components/EmptyState';
import { ErrorState } from '../../components/ErrorState';
import { LiveRegion } from '../../components/LiveRegion';
import { Pager } from '../../components/Pager';
import { useMeta } from '../../hooks/useMeta';
import { formatTimestamp } from '../../utils/dates';
import { useUrlParams } from './useUrlParams';

const PAGE_SIZE = 20;

const ENTITIES: Array<[ConfigEntity, string]> = [
  ['USER', 'People'],
  ['TEAM', 'Teams'],
  ['PROJECT', 'Projects'],
  ['TASK', 'Tasks'],
  ['EARNING_CODE', 'Earning codes'],
  ['POLICY', 'Policy'],
];
const ENTITY_LABEL = Object.fromEntries(ENTITIES) as Record<ConfigEntity, string>;
const ACTION_LABEL: Record<ConfigAction, string> = {
  CREATED: 'Created',
  UPDATED: 'Changed',
  DEACTIVATED: 'Deactivated',
  REACTIVATED: 'Reactivated',
  DELETED: 'Deleted',
  PASSWORD_RESET: 'Reset password',
  MEMBERS_CHANGED: 'Changed members',
};
const FIELD_LABEL: Record<string, string> = {
  display_name: 'name',
  role: 'role',
  manager_id: 'manager',
  is_active: 'active',
  name: 'name',
  description: 'description',
  classification: 'classification',
  max_hours_per_entry: 'hours per entry',
  max_hours_per_day: 'hours per day',
  max_hours_per_week: 'hours per week',
  description_max_length: 'description length',
  added: 'added',
  removed: 'removed',
  members_removed: 'members removed',
};

function show(value: unknown): string {
  if (value === null || value === undefined || value === '') return 'none';
  if (Array.isArray(value)) return value.length ? value.join(', ') : 'none';
  return typeof value === 'string' ? value.replace(/^(\d+)\.00$/, '$1') : String(value);
}

/** One readable line per changed field. Values for personal fields are never recorded. */
export function describeChanges(item: AuditItem): string[] {
  const changes = item.details.changes;
  if (!changes) return [];
  return Object.entries(changes).map(([field, raw]) => {
    const label = FIELD_LABEL[field] ?? field.replace(/_/g, ' ');
    const change = raw as { from?: unknown; to?: unknown; changed?: boolean };
    if (change && typeof change === 'object') {
      if (change.changed) return `${label} changed`;
      if (item.action === 'MEMBERS_CHANGED') {
        const names = field === 'added' ? change.to : change.from;
        return `${label}: ${show(names)}`;
      }
      return `${label}: ${show(change.from)} → ${show(change.to)}`;
    }
    return `${label}: ${show(raw)}`;
  });
}

export function AuditPage() {
  const { params, page, update } = useUrlParams();
  const entity = (params.get('entity') ?? '') as ConfigEntity | '';
  const meta = useMeta();
  const timeZone = meta.data?.business_timezone ?? 'UTC';

  const list = useQuery({
    queryKey: ['admin', 'audit', { entity, page }],
    queryFn: () => fetchAudit({ entityType: entity, page, pageSize: PAGE_SIZE }),
    placeholderData: (previous) => previous,
  });
  const data = list.data;

  return (
    <section aria-labelledby="audit-heading">
      <h2 id="audit-heading">Audit log</h2>
      <p className="hint">
        Every change made in this area, newest first. Entries cannot be edited or removed. Passwords
        are never recorded.
      </p>
      <form className="filters" onSubmit={(event) => event.preventDefault()}>
        <div className="field">
          <label htmlFor="audit-entity">What changed</label>
          <select
            id="audit-entity"
            value={entity}
            onChange={(event) => update({ entity: event.target.value, page: null })}
          >
            <option value="">Everything</option>
            {ENTITIES.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>
      </form>
      <LiveRegion
        message={data ? `${data.total} ${data.total === 1 ? 'event' : 'events'} found.` : ''}
      />
      {list.isError && !data ? (
        <ErrorState error={list.error} onRetry={() => void list.refetch()} />
      ) : !data ? (
        <div
          className="skeleton skeleton-block tall"
          role="status"
          aria-label="Loading audit log"
        />
      ) : data.items.length === 0 ? (
        <EmptyState title="Nothing recorded">No changes match this filter.</EmptyState>
      ) : (
        <>
          <table className="data-table" data-testid="audit-table">
            <caption className="sr-only">Administrative changes, newest first</caption>
            <thead>
              <tr>
                <th scope="col">When</th>
                <th scope="col">Who</th>
                <th scope="col">What</th>
                <th scope="col">Details</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((item) => {
                const lines = describeChanges(item);
                return (
                  <tr key={item.id} data-testid="audit-row">
                    <th scope="row" data-label="When">
                      {formatTimestamp(item.created_at, timeZone)}
                    </th>
                    <td data-label="Who">{item.actor.display_name}</td>
                    <td data-label="What">
                      {ACTION_LABEL[item.action]} · {ENTITY_LABEL[item.entity_type]}
                      {item.entity_label ? (
                        <span className="muted"> — {item.entity_label}</span>
                      ) : null}
                    </td>
                    <td data-label="Details">
                      {lines.length ? (
                        <ul className="plain-list">
                          {lines.map((line) => (
                            <li key={line}>{line}</li>
                          ))}
                        </ul>
                      ) : (
                        <span className="muted">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <Pager
            page={data.page}
            pageSize={data.page_size}
            total={data.total}
            noun="event"
            onPage={(next) => update({ page: String(next) })}
          />
        </>
      )}
    </section>
  );
}
