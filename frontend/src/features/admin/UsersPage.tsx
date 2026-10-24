import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { fetchAdminUsers, resetUserPassword } from '../../api/endpoints';
import type { AdminUser, Role, UserWithTemporaryPassword } from '../../api/types';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { EmptyState } from '../../components/EmptyState';
import { ErrorState, errorMessage } from '../../components/ErrorState';
import { LiveRegion } from '../../components/LiveRegion';
import { Pager } from '../../components/Pager';
import { Toast } from '../../components/Toast';
import { useSession } from '../../hooks/useSession';
import { TemporaryPasswordDialog } from './TemporaryPasswordDialog';
import { UserFormDialog } from './UserFormDialog';
import { useUrlParams } from './useUrlParams';

const PAGE_SIZE = 20;
const ROLE_LABEL: Record<Role, string> = {
  EMPLOYEE: 'Employee',
  MANAGER: 'Manager',
  ADMIN: 'Administrator',
};

type Dialog =
  | { kind: 'form'; user: AdminUser | null }
  | { kind: 'reset'; user: AdminUser }
  | { kind: 'password'; name: string; email: string; password: string; created: boolean };

export function UsersPage() {
  const { params, page, update } = useUrlParams();
  const search = params.get('search') ?? '';
  const role = (params.get('role') ?? '') as Role | '';
  const status = params.get('status') ?? '';
  const [draftSearch, setDraftSearch] = useState(search);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [toast, setToast] = useState('');
  const queryClient = useQueryClient();
  const { data: me } = useSession();

  const active = status === 'active' ? true : status === 'inactive' ? false : undefined;
  const list = useQuery({
    queryKey: ['admin', 'users', { search, role, active, page }],
    queryFn: () => fetchAdminUsers({ search, role, active, page, pageSize: PAGE_SIZE }),
    placeholderData: (previous) => previous,
  });

  const reset = useMutation({
    mutationFn: (user: AdminUser) => resetUserPassword(user.id),
    onSuccess: async (result, user) => {
      await queryClient.invalidateQueries({ queryKey: ['admin', 'users'] });
      setDialog({
        kind: 'password',
        name: user.display_name,
        email: user.email,
        password: result.temporary_password,
        created: false,
      });
    },
  });

  function onSearch(event: FormEvent) {
    event.preventDefault();
    update({ search: draftSearch.trim(), page: null });
  }

  const showCreated = (result: UserWithTemporaryPassword) =>
    setDialog({
      kind: 'password',
      name: result.user.display_name,
      email: result.user.email,
      password: result.temporary_password,
      created: true,
    });

  const data = list.data;

  return (
    <section aria-labelledby="users-heading">
      <div className="section-head">
        <h2 id="users-heading">Users</h2>
        <button
          type="button"
          className="btn btn-primary"
          data-focus-fallback
          onClick={() => setDialog({ kind: 'form', user: null })}
        >
          Add user
        </button>
      </div>

      <form className="filters" role="search" onSubmit={onSearch}>
        <div className="field">
          <label htmlFor="user-search">Name or email</label>
          <input
            id="user-search"
            type="search"
            value={draftSearch}
            maxLength={100}
            onChange={(event) => setDraftSearch(event.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="user-role">Role</label>
          <select
            id="user-role"
            value={role}
            onChange={(event) => update({ role: event.target.value, page: null })}
          >
            <option value="">All roles</option>
            <option value="EMPLOYEE">Employees</option>
            <option value="MANAGER">Managers</option>
            <option value="ADMIN">Administrators</option>
          </select>
        </div>
        <div className="field">
          <label htmlFor="user-status">Status</label>
          <select
            id="user-status"
            value={status}
            onChange={(event) => update({ status: event.target.value, page: null })}
          >
            <option value="">Active and inactive</option>
            <option value="active">Active only</option>
            <option value="inactive">Inactive only</option>
          </select>
        </div>
        <button type="submit" className="btn btn-secondary">
          Search
        </button>
      </form>

      <LiveRegion
        message={data ? `${data.total} ${data.total === 1 ? 'person' : 'people'} found.` : ''}
      />

      {list.isError && !data ? (
        <ErrorState error={list.error} onRetry={() => void list.refetch()} />
      ) : !data ? (
        <div className="skeleton skeleton-block tall" role="status" aria-label="Loading users" />
      ) : data.items.length === 0 ? (
        <EmptyState title="No people match">Try changing or clearing the filters.</EmptyState>
      ) : (
        <>
          <table className="data-table" data-testid="users-table">
            <caption className="sr-only">People</caption>
            <thead>
              <tr>
                <th scope="col">Name</th>
                <th scope="col">Role</th>
                <th scope="col">Manager</th>
                <th scope="col">Reports</th>
                <th scope="col">Status</th>
                <th scope="col">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((user) => (
                <tr key={user.id} data-testid="user-row">
                  <th scope="row" data-label="Name">
                    {user.display_name}
                    <span className="muted small block">{user.email}</span>
                  </th>
                  <td data-label="Role">{ROLE_LABEL[user.role]}</td>
                  <td data-label="Manager">{user.manager?.display_name ?? '—'}</td>
                  <td data-label="Reports">{user.report_count}</td>
                  <td data-label="Status">
                    <span className={`badge ${user.is_active ? 'badge-approved' : 'badge-draft'}`}>
                      {user.is_active ? 'Active' : 'Inactive'}
                    </span>
                    {user.must_change_password ? (
                      <span className="muted small block">Temporary password pending</span>
                    ) : null}
                  </td>
                  <td className="row-action">
                    <button
                      type="button"
                      className="btn btn-secondary btn-small"
                      aria-label={`Edit ${user.display_name}`}
                      onClick={() => setDialog({ kind: 'form', user })}
                    >
                      Edit
                    </button>{' '}
                    {user.id !== me?.id ? (
                      <button
                        type="button"
                        className="btn btn-secondary btn-small"
                        aria-label={`Reset password for ${user.display_name}`}
                        onClick={() => setDialog({ kind: 'reset', user })}
                      >
                        Reset password
                      </button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <Pager
            page={data.page}
            pageSize={data.page_size}
            total={data.total}
            noun="person"
            onPage={(next) => update({ page: String(next) })}
          />
        </>
      )}

      {dialog?.kind === 'form' ? (
        <UserFormDialog
          user={dialog.user}
          onClose={() => setDialog(null)}
          onCreated={showCreated}
          onSaved={(saved) => {
            setDialog(null);
            setToast(`Saved ${saved.display_name}.`);
          }}
        />
      ) : null}
      {dialog?.kind === 'reset' ? (
        <ConfirmDialog
          title={`Reset password for ${dialog.user.display_name}?`}
          confirmLabel={reset.isPending ? 'Resetting…' : 'Reset password'}
          cancelLabel="Cancel"
          danger
          pending={reset.isPending}
          error={reset.isError ? <p>{errorMessage(reset.error)}</p> : null}
          onCancel={() => {
            reset.reset();
            setDialog(null);
          }}
          onConfirm={() => {
            if (!reset.isPending) reset.mutate(dialog.user);
          }}
        >
          <p>
            They will be signed out everywhere and given a new temporary password, which you will
            see once. Their current password stops working immediately.
          </p>
        </ConfirmDialog>
      ) : null}
      {dialog?.kind === 'password' ? (
        <TemporaryPasswordDialog
          name={dialog.name}
          email={dialog.email}
          kind={dialog.created ? 'created' : 'reset'}
          password={dialog.password}
          onDone={() => {
            setDialog(null);
            setToast(dialog.created ? 'User created.' : 'Password reset.');
          }}
        />
      ) : null}
      <Toast message={toast} onDismiss={() => setToast('')} />
    </section>
  );
}
