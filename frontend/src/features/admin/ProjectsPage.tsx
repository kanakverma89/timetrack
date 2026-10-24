import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { createProject, fetchAdminProjects, updateProject } from '../../api/endpoints';
import type { AdminProject } from '../../api/types';
import { EmptyState } from '../../components/EmptyState';
import { ErrorState } from '../../components/ErrorState';
import { CheckboxField, TextAreaField, TextField } from '../../components/Fields';
import { FormDialog } from '../../components/FormDialog';
import { LiveRegion } from '../../components/LiveRegion';
import { Pager } from '../../components/Pager';
import { Toast } from '../../components/Toast';
import { NO_PROBLEMS, problemsOf, type Problems } from './problems';
import { useUrlParams } from './useUrlParams';

const PAGE_SIZE = 20;
export const CODE_HINT = 'Letters, digits, dots, hyphens or underscores. Saved in capitals.';

function ProjectDialog({
  project,
  onClose,
  onSaved,
}: {
  project: AdminProject | null;
  onClose: () => void;
  onSaved: (name: string) => void;
}) {
  const queryClient = useQueryClient();
  const [code, setCode] = useState('');
  const [name, setName] = useState(project?.name ?? '');
  const [description, setDescription] = useState(project?.description ?? '');
  const [active, setActive] = useState(project?.is_active ?? true);
  const [problems, setProblems] = useState<Problems>(NO_PROBLEMS);
  const inFlight = useRef(false);

  const unchanged =
    project !== null &&
    name.trim() === project.name &&
    description.trim() === (project.description ?? '') &&
    active === project.is_active;

  const save = useMutation({
    mutationFn: () =>
      project
        ? updateProject(project.id, {
            name: name.trim(),
            description: description.trim() || null,
            is_active: active,
          })
        : createProject({ code, name: name.trim(), description: description.trim() || null }),
    onSuccess: async (saved) => {
      await queryClient.invalidateQueries({ queryKey: ['admin', 'projects'] });
      onSaved(saved.name);
    },
    onError: (error) => setProblems(problemsOf(error)),
  });

  return (
    <FormDialog
      title={project ? `Edit ${project.code}` : 'Add project'}
      submitLabel={save.isPending ? 'Saving…' : project ? 'Save changes' : 'Create project'}
      pending={save.isPending}
      submitDisabled={unchanged}
      error={problems.message}
      onCancel={onClose}
      onSubmit={() => {
        if (inFlight.current) return;
        const found: Record<string, string> = {};
        if (!project && !code.trim()) found.code = 'Enter a code.';
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
      {project ? (
        <p>
          <span className="muted">Code</span> {project.code}{' '}
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
      <TextAreaField
        label="Description"
        requirement="optional"
        maxLength={2000}
        value={description}
        error={problems.fields.description}
        onChange={setDescription}
      />
      {project ? (
        <CheckboxField
          label="Active"
          checked={active}
          error={problems.fields.is_active}
          hint="Inactive projects cannot be chosen for new entries; existing entries keep them."
          onChange={setActive}
        />
      ) : null}
    </FormDialog>
  );
}

export function ProjectsPage() {
  const { params, page, update } = useUrlParams();
  const search = params.get('search') ?? '';
  const status = params.get('status') ?? '';
  const [draftSearch, setDraftSearch] = useState(search);
  const [dialog, setDialog] = useState<{ project: AdminProject | null } | null>(null);
  const [toast, setToast] = useState('');
  const active = status === 'active' ? true : status === 'inactive' ? false : undefined;

  const list = useQuery({
    queryKey: ['admin', 'projects', { search, active, page }],
    queryFn: () => fetchAdminProjects({ search, active, page, pageSize: PAGE_SIZE }),
    placeholderData: (previous) => previous,
  });
  const data = list.data;

  function onSearch(event: FormEvent) {
    event.preventDefault();
    update({ search: draftSearch.trim(), page: null });
  }

  return (
    <section aria-labelledby="projects-heading">
      <div className="section-head">
        <h2 id="projects-heading">Projects</h2>
        <button
          type="button"
          className="btn btn-primary"
          data-focus-fallback
          onClick={() => setDialog({ project: null })}
        >
          Add project
        </button>
      </div>
      <form className="filters" role="search" onSubmit={onSearch}>
        <div className="field">
          <label htmlFor="project-search">Code or name</label>
          <input
            id="project-search"
            type="search"
            value={draftSearch}
            maxLength={100}
            onChange={(event) => setDraftSearch(event.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="project-status">Status</label>
          <select
            id="project-status"
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
        message={data ? `${data.total} ${data.total === 1 ? 'project' : 'projects'} found.` : ''}
      />
      {list.isError && !data ? (
        <ErrorState error={list.error} onRetry={() => void list.refetch()} />
      ) : !data ? (
        <div className="skeleton skeleton-block tall" role="status" aria-label="Loading projects" />
      ) : data.items.length === 0 ? (
        <EmptyState title="No projects match">Try changing or clearing the filters.</EmptyState>
      ) : (
        <>
          <table className="data-table" data-testid="projects-table">
            <caption className="sr-only">Projects</caption>
            <thead>
              <tr>
                <th scope="col">Project</th>
                <th scope="col">Tasks</th>
                <th scope="col">Status</th>
                <th scope="col">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((project) => (
                <tr key={project.id} data-testid="project-row">
                  <th scope="row" data-label="Project">
                    {project.code} <span className="muted">— {project.name}</span>
                  </th>
                  <td data-label="Tasks">{project.task_count}</td>
                  <td data-label="Status">
                    <span
                      className={`badge ${project.is_active ? 'badge-approved' : 'badge-draft'}`}
                    >
                      {project.is_active ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td className="row-action">
                    <Link
                      className="btn btn-secondary btn-small"
                      to={`/admin/projects/${project.id}`}
                      aria-label={`Tasks of ${project.code}`}
                    >
                      Tasks
                    </Link>{' '}
                    <button
                      type="button"
                      className="btn btn-secondary btn-small"
                      aria-label={`Edit ${project.code}`}
                      onClick={() => setDialog({ project })}
                    >
                      Edit
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <Pager
            page={data.page}
            pageSize={data.page_size}
            total={data.total}
            noun="project"
            onPage={(next) => update({ page: String(next) })}
          />
        </>
      )}
      {dialog ? (
        <ProjectDialog
          project={dialog.project}
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
