import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { createAdminUser, fetchAdminUsers, updateAdminUser } from '../../api/endpoints';
import type { AdminUser, Role, UserUpdateInput, UserWithTemporaryPassword } from '../../api/types';
import { SelectField, TextField, CheckboxField } from '../../components/Fields';
import { FormDialog } from '../../components/FormDialog';
import { useSession } from '../../hooks/useSession';
import { NO_PROBLEMS, problemsOf, type Problems } from './problems';

const ROLES: Array<{ value: Role; label: string }> = [
  { value: 'EMPLOYEE', label: 'Employee' },
  { value: 'MANAGER', label: 'Manager' },
  { value: 'ADMIN', label: 'Administrator' },
];

interface Props {
  /** null creates a new user. */
  user: AdminUser | null;
  onClose: () => void;
  onCreated: (result: UserWithTemporaryPassword) => void;
  onSaved: (user: AdminUser) => void;
}

export function UserFormDialog({ user, onClose, onCreated, onSaved }: Props) {
  const editing = user !== null;
  const queryClient = useQueryClient();
  const { data: me } = useSession();
  const isSelf = editing && me?.id === user.id;
  const [email, setEmail] = useState(user?.email ?? '');
  const [name, setName] = useState(user?.display_name ?? '');
  const [role, setRole] = useState<Role>(user?.role ?? 'EMPLOYEE');
  const [managerId, setManagerId] = useState(user?.manager?.id ?? '');
  const [active, setActive] = useState(user?.is_active ?? true);
  const [problems, setProblems] = useState<Problems>(NO_PROBLEMS);
  const inFlight = useRef(false);

  const managers = useQuery({
    queryKey: ['admin', 'managers'],
    queryFn: () => fetchAdminUsers({ managersOnly: true, active: true, page: 1, pageSize: 100 }),
  });

  const changes: UserUpdateInput = {};
  if (user) {
    if (name.trim() !== user.display_name) changes.display_name = name.trim();
    if (role !== user.role) changes.role = role;
    if (managerId !== (user.manager?.id ?? '')) changes.manager_id = managerId || null;
    if (active !== user.is_active) changes.is_active = active;
  }
  const unchanged = editing && Object.keys(changes).length === 0;

  const save = useMutation({
    mutationFn: async () => {
      if (user) return { updated: await updateAdminUser(user.id, changes) };
      return {
        created: await createAdminUser({
          email: email.trim(),
          display_name: name.trim(),
          role,
          manager_id: managerId || null,
        }),
      };
    },
    onSuccess: async (result) => {
      await queryClient.invalidateQueries({ queryKey: ['admin', 'users'] });
      await queryClient.invalidateQueries({ queryKey: ['admin', 'managers'] });
      if (result.created) onCreated(result.created);
      else if (result.updated) onSaved(result.updated);
    },
    onError: (error) => setProblems(problemsOf(error)),
  });

  function submit() {
    if (inFlight.current) return;
    const found: Record<string, string> = {};
    if (!editing && !email.trim()) found.email = 'Enter an email address.';
    if (!name.trim()) found.display_name = 'Enter a name.';
    if (Object.keys(found).length > 0) {
      setProblems({ fields: found, message: 'Please fix the highlighted fields.' });
      return;
    }
    setProblems(NO_PROBLEMS);
    inFlight.current = true;
    save.mutate(undefined, { onSettled: () => (inFlight.current = false) });
  }

  const managerOptions = [
    { value: '', label: 'No manager' },
    ...(managers.data?.items ?? [])
      .filter((m) => m.id !== user?.id)
      .map((m) => ({ value: m.id, label: `${m.display_name} (${m.email})` })),
  ];
  // The current manager may be inactive and so missing from the list; keep it selectable.
  if (user?.manager && !managerOptions.some((o) => o.value === user.manager?.id)) {
    managerOptions.push({
      value: user.manager.id,
      label: `${user.manager.display_name} (${user.manager.email})`,
    });
  }

  return (
    <FormDialog
      title={editing ? `Edit ${user.display_name}` : 'Add user'}
      submitLabel={save.isPending ? 'Saving…' : editing ? 'Save changes' : 'Create user'}
      pending={save.isPending}
      submitDisabled={unchanged}
      error={problems.message}
      onSubmit={submit}
      onCancel={onClose}
    >
      {editing ? (
        <p>
          <span className="muted">Email</span> {user.email}
        </p>
      ) : (
        <TextField
          label="Email"
          requirement="required"
          type="email"
          autoComplete="off"
          value={email}
          error={problems.fields.email}
          onChange={setEmail}
        />
      )}
      <TextField
        label="Name"
        requirement="required"
        maxLength={200}
        value={name}
        error={problems.fields.display_name}
        onChange={setName}
      />
      <SelectField
        label="Role"
        value={role}
        options={ROLES}
        disabled={isSelf}
        hint={isSelf ? 'You cannot change your own role.' : undefined}
        error={problems.fields.role}
        onChange={(value) => setRole(value as Role)}
      />
      <SelectField
        label="Manager"
        requirement="optional"
        value={managerId}
        options={managerOptions}
        hint="The manager who approves this person's timesheets."
        error={problems.fields.manager_id}
        onChange={setManagerId}
      />
      {editing ? (
        <CheckboxField
          label="Active"
          checked={active}
          disabled={isSelf}
          error={problems.fields.is_active}
          hint={
            isSelf
              ? 'You cannot deactivate yourself.'
              : 'Inactive people cannot sign in; their history is kept.'
          }
          onChange={setActive}
        />
      ) : (
        <p className="hint">
          A temporary password is generated and shown once. The person must change it when they
          first sign in.
        </p>
      )}
    </FormDialog>
  );
}
