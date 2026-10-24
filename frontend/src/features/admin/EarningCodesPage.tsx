import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { createEarningCode, fetchAdminEarningCodes, updateEarningCode } from '../../api/endpoints';
import type { AdminEarningCode, Classification } from '../../api/types';
import { EmptyState } from '../../components/EmptyState';
import { ErrorState } from '../../components/ErrorState';
import { CheckboxField, SelectField, TextField } from '../../components/Fields';
import { FormDialog } from '../../components/FormDialog';
import { Toast } from '../../components/Toast';
import { NO_PROBLEMS, problemsOf, type Problems } from './problems';
import { CODE_HINT } from './ProjectsPage';

const CLASSES: Array<{ value: Classification; label: string }> = [
  { value: 'CAPPED', label: 'Capped' },
  { value: 'NON_CAPPED', label: 'Non-capped' },
];
const CLASS_LABEL: Record<Classification, string> = {
  CAPPED: 'Capped',
  NON_CAPPED: 'Non-capped',
};

function EarningCodeDialog({
  code: existing,
  onClose,
  onSaved,
}: {
  code: AdminEarningCode | null;
  onClose: () => void;
  onSaved: (name: string) => void;
}) {
  const queryClient = useQueryClient();
  const [code, setCode] = useState('');
  const [name, setName] = useState(existing?.name ?? '');
  const [classification, setClassification] = useState<Classification>(
    existing?.classification ?? 'CAPPED',
  );
  const [active, setActive] = useState(existing?.is_active ?? true);
  const [problems, setProblems] = useState<Problems>(NO_PROBLEMS);
  const inFlight = useRef(false);
  const unchanged =
    existing !== null &&
    name.trim() === existing.name &&
    classification === existing.classification &&
    active === existing.is_active;

  const save = useMutation({
    mutationFn: () =>
      existing
        ? updateEarningCode(existing.id, { name: name.trim(), classification, is_active: active })
        : createEarningCode({ code, name: name.trim(), classification }),
    onSuccess: async (saved) => {
      await queryClient.invalidateQueries({ queryKey: ['admin', 'earning-codes'] });
      onSaved(saved.name);
    },
    onError: (error) => setProblems(problemsOf(error)),
  });

  return (
    <FormDialog
      title={existing ? `Edit ${existing.code}` : 'Add earning code'}
      submitLabel={save.isPending ? 'Saving…' : existing ? 'Save changes' : 'Create earning code'}
      pending={save.isPending}
      submitDisabled={unchanged}
      error={problems.message}
      onCancel={onClose}
      onSubmit={() => {
        if (inFlight.current) return;
        const found: Record<string, string> = {};
        if (!existing && !code.trim()) found.code = 'Enter a code.';
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
      {existing ? (
        <p>
          <span className="muted">Code</span> {existing.code}{' '}
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
      <SelectField
        label="Classification"
        value={classification}
        options={CLASSES}
        hint={
          existing && existing.entry_count > 0
            ? `Changing this affects how ${existing.entry_count} existing ${
                existing.entry_count === 1 ? 'entry counts' : 'entries count'
              } in totals and reports.`
            : 'Decides whether hours with this code count as capped or non-capped in totals.'
        }
        error={problems.fields.classification}
        onChange={(value) => setClassification(value as Classification)}
      />
      {existing ? (
        <CheckboxField
          label="Active"
          checked={active}
          hint="Inactive codes cannot be chosen for new entries; existing entries keep them."
          onChange={setActive}
        />
      ) : null}
    </FormDialog>
  );
}

export function EarningCodesPage() {
  const [dialog, setDialog] = useState<{ code: AdminEarningCode | null } | null>(null);
  const [toast, setToast] = useState('');
  const codes = useQuery({ queryKey: ['admin', 'earning-codes'], queryFn: fetchAdminEarningCodes });

  return (
    <section aria-labelledby="codes-heading">
      <div className="section-head">
        <h2 id="codes-heading">Earning codes</h2>
        <button
          type="button"
          className="btn btn-primary"
          data-focus-fallback
          onClick={() => setDialog({ code: null })}
        >
          Add earning code
        </button>
      </div>
      {codes.isError ? (
        <ErrorState error={codes.error} onRetry={() => void codes.refetch()} />
      ) : !codes.data ? (
        <div className="skeleton skeleton-block tall" role="status" aria-label="Loading codes" />
      ) : codes.data.length === 0 ? (
        <EmptyState title="No earning codes">People cannot log time until one exists.</EmptyState>
      ) : (
        <table className="data-table" data-testid="codes-table">
          <caption className="sr-only">Earning codes</caption>
          <thead>
            <tr>
              <th scope="col">Code</th>
              <th scope="col">Classification</th>
              <th scope="col">Used by</th>
              <th scope="col">Status</th>
              <th scope="col">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {codes.data.map((code) => (
              <tr key={code.id} data-testid="code-row">
                <th scope="row" data-label="Code">
                  {code.code} <span className="muted">— {code.name}</span>
                </th>
                <td data-label="Classification">{CLASS_LABEL[code.classification]}</td>
                <td data-label="Used by">
                  {code.entry_count} {code.entry_count === 1 ? 'entry' : 'entries'}
                </td>
                <td data-label="Status">
                  <span className={`badge ${code.is_active ? 'badge-approved' : 'badge-draft'}`}>
                    {code.is_active ? 'Active' : 'Inactive'}
                  </span>
                </td>
                <td className="row-action">
                  <button
                    type="button"
                    className="btn btn-secondary btn-small"
                    aria-label={`Edit ${code.code}`}
                    onClick={() => setDialog({ code })}
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
        <EarningCodeDialog
          code={dialog.code}
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
