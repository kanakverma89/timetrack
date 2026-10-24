import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import {
  createTeam,
  deleteTeam,
  fetchAdminUsers,
  fetchTeam,
  fetchTeams,
  renameTeam,
  setTeamMembers,
} from '../../api/endpoints';
import type { PersonRef, Team } from '../../api/types';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { EmptyState } from '../../components/EmptyState';
import { ErrorState, errorMessage } from '../../components/ErrorState';
import { TextField } from '../../components/Fields';
import { FormDialog } from '../../components/FormDialog';
import { Toast } from '../../components/Toast';
import { NO_PROBLEMS, problemsOf, type Problems } from './problems';

type Dialog =
  | { kind: 'name'; team: Team | null }
  | { kind: 'members'; team: Team }
  | { kind: 'delete'; team: Team };

function TeamNameDialog({
  team,
  onClose,
  onSaved,
}: {
  team: Team | null;
  onClose: () => void;
  onSaved: (name: string) => void;
}) {
  const queryClient = useQueryClient();
  const [name, setName] = useState(team?.name ?? '');
  const [problems, setProblems] = useState<Problems>(NO_PROBLEMS);
  const inFlight = useRef(false);
  const save = useMutation({
    mutationFn: () => (team ? renameTeam(team.id, name.trim()) : createTeam(name.trim())),
    onSuccess: async (saved) => {
      await queryClient.invalidateQueries({ queryKey: ['admin', 'teams'] });
      onSaved(saved.name);
    },
    onError: (error) => setProblems(problemsOf(error)),
  });
  return (
    <FormDialog
      title={team ? `Rename ${team.name}` : 'Add team'}
      submitLabel={save.isPending ? 'Saving…' : team ? 'Save' : 'Create team'}
      pending={save.isPending}
      submitDisabled={team !== null && name.trim() === team.name}
      error={problems.message}
      onCancel={onClose}
      onSubmit={() => {
        if (inFlight.current) return;
        if (!name.trim()) {
          setProblems({ fields: { name: 'Enter a name.' }, message: 'Please fix the highlighted fields.' });
          return;
        }
        setProblems(NO_PROBLEMS);
        inFlight.current = true;
        save.mutate(undefined, { onSettled: () => (inFlight.current = false) });
      }}
    >
      <TextField
        label="Team name"
        requirement="required"
        maxLength={200}
        value={name}
        error={problems.fields.name}
        onChange={setName}
      />
    </FormDialog>
  );
}

function TeamMembersDialog({
  team,
  onClose,
  onSaved,
}: {
  team: Team;
  onClose: () => void;
  onSaved: () => void;
}) {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [problems, setProblems] = useState<Problems>(NO_PROBLEMS);
  const [selected, setSelected] = useState<Map<string, PersonRef> | null>(null);
  const inFlight = useRef(false);

  const current = useQuery({
    queryKey: ['admin', 'teams', team.id],
    queryFn: () => fetchTeam(team.id),
  });
  const people = useQuery({
    queryKey: ['admin', 'users', 'picker', search],
    queryFn: () => fetchAdminUsers({ search, active: true, page: 1, pageSize: 100 }),
    placeholderData: (previous) => previous,
  });

  // Start from the team's real membership once it has loaded, then track edits locally.
  const chosen =
    selected ?? new Map((current.data?.members ?? []).map((member) => [member.id, member]));

  const save = useMutation({
    mutationFn: () => setTeamMembers(team.id, [...chosen.keys()]),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['admin', 'teams'] });
      onSaved();
    },
    onError: (error) => setProblems(problemsOf(error)),
  });

  function toggle(person: PersonRef, on: boolean) {
    const next = new Map(chosen);
    if (on) next.set(person.id, person);
    else next.delete(person.id);
    setSelected(next);
  }

  return (
    <FormDialog
      title={`Members of ${team.name}`}
      submitLabel={save.isPending ? 'Saving…' : 'Save members'}
      pending={save.isPending}
      submitDisabled={current.isPending || current.isError}
      error={problems.message}
      onCancel={onClose}
      onSubmit={() => {
        if (inFlight.current) return;
        setProblems(NO_PROBLEMS);
        inFlight.current = true;
        save.mutate(undefined, { onSettled: () => (inFlight.current = false) });
      }}
    >
      <TextField
        label="Find people"
        type="search"
        value={search}
        maxLength={100}
        onChange={setSearch}
      />
      {current.isError ? (
        <p className="form-error">{errorMessage(current.error)}</p>
      ) : (
        <>
          <p role="status" className="hint">
            {chosen.size} selected
          </p>
          <fieldset className="check-list">
            <legend className="sr-only">Active people</legend>
            {(people.data?.items ?? []).map((person) => (
              <label key={person.id} className="check-row">
                <input
                  type="checkbox"
                  checked={chosen.has(person.id)}
                  disabled={save.isPending || current.isPending}
                  onChange={(event) => toggle(person, event.target.checked)}
                />
                <span>
                  {person.display_name} <span className="muted small">{person.email}</span>
                </span>
              </label>
            ))}
            {people.data && people.data.items.length === 0 ? (
              <p className="hint">Nobody matches.</p>
            ) : null}
          </fieldset>
          {people.data && people.data.total > people.data.items.length ? (
            <p className="hint">
              Showing the first {people.data.items.length} of {people.data.total}; search to narrow
              the list. People you have ticked stay ticked.
            </p>
          ) : null}
        </>
      )}
    </FormDialog>
  );
}

export function TeamsPage() {
  const queryClient = useQueryClient();
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [toast, setToast] = useState('');
  const teams = useQuery({ queryKey: ['admin', 'teams'], queryFn: fetchTeams });

  const remove = useMutation({
    mutationFn: (team: Team) => deleteTeam(team.id),
    onSuccess: async (_unused, team) => {
      await queryClient.invalidateQueries({ queryKey: ['admin', 'teams'] });
      setDialog(null);
      setToast(`Deleted ${team.name}.`);
    },
  });

  return (
    <section aria-labelledby="teams-heading">
      <div className="section-head">
        <h2 id="teams-heading">Teams</h2>
        <button
          type="button"
          className="btn btn-primary"
          data-focus-fallback
          onClick={() => setDialog({ kind: 'name', team: null })}
        >
          Add team
        </button>
      </div>
      <p className="hint">
        Teams group people for organisation. They do not decide who approves whose timesheet: that
        is each person's manager.
      </p>
      {teams.isError ? (
        <ErrorState error={teams.error} onRetry={() => void teams.refetch()} />
      ) : !teams.data ? (
        <div className="skeleton skeleton-block tall" role="status" aria-label="Loading teams" />
      ) : teams.data.length === 0 ? (
        <EmptyState title="No teams yet">Add the first team to get started.</EmptyState>
      ) : (
        <table className="data-table" data-testid="teams-table">
          <caption className="sr-only">Teams</caption>
          <thead>
            <tr>
              <th scope="col">Team</th>
              <th scope="col">Members</th>
              <th scope="col">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {teams.data.map((team) => (
              <tr key={team.id} data-testid="team-row">
                <th scope="row" data-label="Team">
                  {team.name}
                </th>
                <td data-label="Members">{team.member_count}</td>
                <td className="row-action">
                  <button
                    type="button"
                    className="btn btn-secondary btn-small"
                    aria-label={`Members of ${team.name}`}
                    onClick={() => setDialog({ kind: 'members', team })}
                  >
                    Members
                  </button>{' '}
                  <button
                    type="button"
                    className="btn btn-secondary btn-small"
                    aria-label={`Rename ${team.name}`}
                    onClick={() => setDialog({ kind: 'name', team })}
                  >
                    Rename
                  </button>{' '}
                  <button
                    type="button"
                    className="btn btn-secondary btn-small"
                    aria-label={`Delete ${team.name}`}
                    onClick={() => setDialog({ kind: 'delete', team })}
                  >
                    Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {dialog?.kind === 'name' ? (
        <TeamNameDialog
          team={dialog.team}
          onClose={() => setDialog(null)}
          onSaved={(name) => {
            setDialog(null);
            setToast(`Saved ${name}.`);
          }}
        />
      ) : null}
      {dialog?.kind === 'members' ? (
        <TeamMembersDialog
          team={dialog.team}
          onClose={() => setDialog(null)}
          onSaved={() => {
            setDialog(null);
            setToast(`Updated the members of ${dialog.team.name}.`);
          }}
        />
      ) : null}
      {dialog?.kind === 'delete' ? (
        <ConfirmDialog
          title={`Delete ${dialog.team.name}?`}
          confirmLabel={remove.isPending ? 'Deleting…' : 'Delete team'}
          cancelLabel="Cancel"
          danger
          pending={remove.isPending}
          error={remove.isError ? <p>{errorMessage(remove.error)}</p> : null}
          onCancel={() => {
            remove.reset();
            setDialog(null);
          }}
          onConfirm={() => {
            if (!remove.isPending) remove.mutate(dialog.team);
          }}
        >
          <p>
            The team is removed. The {dialog.team.member_count}{' '}
            {dialog.team.member_count === 1 ? 'person' : 'people'} in it are not affected and
            keep their timesheets and managers.
          </p>
        </ConfirmDialog>
      ) : null}
      <Toast message={toast} onDismiss={() => setToast('')} />
    </section>
  );
}
