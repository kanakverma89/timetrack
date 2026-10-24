import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { createTask, fetchAdminProject, fetchAdminTasks, updateTask } from '../../api/endpoints';
import type { AdminTask } from '../../api/types';
import { EmptyState } from '../../components/EmptyState';
import { ErrorState } from '../../components/ErrorState';
import { CheckboxField, TextField } from '../../components/Fields';
import { FormDialog } from '../../components/FormDialog';
import { Toast } from '../../components/Toast';
import { NO_PROBLEMS, problemsOf, type Problems } from './problems';
import { CODE_HINT } from './ProjectsPage';

function TaskDialog({
  projectId,
  task,
  onClose,
  onSaved,
}: {
  projectId: string;
  task: AdminTask | null;
  onClose: () => void;
  onSaved: (name: string) => void;
}) {
  const queryClient = useQueryClient();
  const [code, setCode] = useState('');
  const [name, setName] = useState(task?.name ?? '');
  const [active, setActive] = useState(task?.is_active ?? true);
  const [problems, setProblems] = useState<Problems>(NO_PROBLEMS);
  const inFlight = useRef(false);
  const unchanged = task !== null && name.trim() === task.name && active === task.is_active;

  const save = useMutation({
    mutationFn: () =>
      task
        ? updateTask(task.id, { name: name.trim(), is_active: active })
        : createTask(projectId, { code, name: name.trim() }),
    onSuccess: async (saved) => {
      await queryClient.invalidateQueries({ queryKey: ['admin', 'tasks', projectId] });
      await queryClient.invalidateQueries({ queryKey: ['admin', 'projects'] });
      onSaved(saved.name);
    },
    onError: (error) => setProblems(problemsOf(error)),
  });

  return (
    <FormDialog
      title={task ? `Edit ${task.code}` : 'Add task'}
      submitLabel={save.isPending ? 'Saving…' : task ? 'Save changes' : 'Create task'}
      pending={save.isPending}
      submitDisabled={unchanged}
      error={problems.message}
      onCancel={onClose}
      onSubmit={() => {
        if (inFlight.current) return;
        const found: Record<string, string> = {};
        if (!task && !code.trim()) found.code = 'Enter a code.';
        if (!name.trim()) found.name = 'Enter a name.';
        if (Object.keys(found).length > 0) {
          setProblems({ fields: found, message: 'Please fix the highlighted fields.' });
          return;
        }
        setProblems(NO_PROBLEMS);
        inFlight.current = true;
        save.mutate(undefined, { onSettled: () => (inFlight.current = false) });
      }}
    >
      {task ? (
        <p>
          <span className="muted">Code</span> {task.code}{' '}
          <span className="muted small">(cannot be changed)</span>
        </p>
      ) : (
        <TextField
          label="Code"
          requirement="required"
          maxLength={50}
          hint={CODE_HINT}
          value={code}
          error={problems.fields.code}
          onChange={setCode}
        />
      )}
      <TextField
        label="Name"
        requirement="required"
        maxLength={200}
        value={name}
        error={problems.fields.name}
        onChange={setName}
      />
      {task ? (
        <CheckboxField
          label="Active"
          checked={active}
          hint="Inactive tasks cannot be chosen for new entries; existing entries keep them."
          onChange={setActive}
        />
      ) : null}
    </FormDialog>
  );
}

export function ProjectTasksPage() {
  const { projectId = '' } = useParams();
  const [dialog, setDialog] = useState<{ task: AdminTask | null } | null>(null);
  const [toast, setToast] = useState('');
  const project = useQuery({
    queryKey: ['admin', 'projects', projectId],
    queryFn: () => fetchAdminProject(projectId),
  });
  const tasks = useQuery({
    queryKey: ['admin', 'tasks', projectId],
    queryFn: () => fetchAdminTasks(projectId),
  });

  if (project.isError) {
    return <ErrorState error={project.error} onRetry={() => void project.refetch()} />;
  }

  return (
    <section aria-labelledby="tasks-heading">
      <p>
        <Link to="/admin/projects">← All projects</Link>
      </p>
      <div className="section-head">
        <h2 id="tasks-heading">
          Tasks{project.data ? ` of ${project.data.code} — ${project.data.name}` : ''}
        </h2>
        <button
          type="button"
          className="btn btn-primary"
          data-focus-fallback
          onClick={() => setDialog({ task: null })}
        >
          Add task
        </button>
      </div>
      <p className="hint">
        When a project has active tasks, people must choose one for each entry on it.
      </p>
      {tasks.isError ? (
        <ErrorState error={tasks.error} onRetry={() => void tasks.refetch()} />
      ) : !tasks.data ? (
        <div className="skeleton skeleton-block tall" role="status" aria-label="Loading tasks" />
      ) : tasks.data.length === 0 ? (
        <EmptyState title="No tasks">
          This project has no tasks, so entries on it do not need one.
        </EmptyState>
      ) : (
        <table className="data-table" data-testid="tasks-table">
          <caption className="sr-only">Tasks</caption>
          <thead>
            <tr>
              <th scope="col">Task</th>
              <th scope="col">Status</th>
              <th scope="col">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {tasks.data.map((task) => (
              <tr key={task.id} data-testid="task-row">
                <th scope="row" data-label="Task">
                  {task.code} <span className="muted">— {task.name}</span>
                </th>
                <td data-label="Status">
                  <span className={`badge ${task.is_active ? 'badge-approved' : 'badge-draft'}`}>
                    {task.is_active ? 'Active' : 'Inactive'}
                  </span>
                </td>
                <td className="row-action">
                  <button
                    type="button"
                    className="btn btn-secondary btn-small"
                    aria-label={`Edit ${task.code}`}
                    onClick={() => setDialog({ task })}
                  >
                    Edit
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {dialog ? (
        <TaskDialog
          projectId={projectId}
          task={dialog.task}
          onClose={() => setDialog(null)}
          onSaved={(name) => {
            setDialog(null);
            setToast(`Saved ${name}.`);
          }}
        />
      ) : null}
      <Toast message={toast} onDismiss={() => setToast('')} />
    </section>
  );
}
