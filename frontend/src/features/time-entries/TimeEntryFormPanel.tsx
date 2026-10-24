import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useId, useMemo, useRef, useState, type FormEvent } from 'react';
import {
  createEntriesBatch,
  createEntry,
  fetchEarningCodes,
  fetchProjects,
  fetchTasks,
  updateEntry,
} from '../../api/endpoints';
import { ApiError } from '../../api/client';
import type {
  EarningCodeOption,
  EntryInput,
  ProjectOption,
  TaskOption,
  TimeEntry,
  TimesheetWeek,
} from '../../api/types';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { FieldError } from '../../components/FieldError';
import { Modal } from '../../components/Modal';
import { formatWeekRange, longDate } from '../../utils/dates';
import { EntryModeToggle, type EntryMode } from './EntryModeToggle';
import { ProjectCombobox } from './ProjectCombobox';
import { WeekHoursGrid, weekHoursInputId } from './WeekHoursGrid';
import {
  FIELD_ORDER,
  defaultWeekDays,
  isDirty,
  isWeekDirty,
  sumHours,
  validateEntry,
  validateWeek,
  type EntryFormValues,
  type FieldErrors,
  type FieldName,
  type WeekDay,
} from './validation';

type SaveRequest =
  { kind: 'single'; input: EntryInput } | { kind: 'week'; inputs: EntryInput[]; dates: string[] };

interface Props {
  week: TimesheetWeek;
  /** The entry being edited, or null to add a new one. */
  entry: TimeEntry | null;
  defaultDate: string;
  maxHours: string;
  descriptionMax: number;
  onClose: () => void;
  onSaved: (message: string) => void;
}

const LABELS: Record<FieldName, string> = {
  work_date: 'Date',
  hours: 'Hours',
  earning_code_id: 'Earning code',
  project_id: 'Project',
  task_id: 'Task',
  description: 'Description',
};

function initialValues(entry: TimeEntry | null, defaultDate: string): EntryFormValues {
  if (!entry) {
    return {
      work_date: defaultDate,
      hours: '',
      earning_code_id: '',
      project_id: '',
      task_id: '',
      description: '',
    };
  }
  return {
    work_date: entry.work_date,
    hours: entry.hours,
    earning_code_id: entry.earning_code.id,
    project_id: entry.project.id,
    task_id: entry.task?.id ?? '',
    description: entry.description,
  };
}

/** Options for the lists, plus the entry's own (possibly since-retired) values when editing. */
function withCurrent<T extends { id: string }>(items: T[] | undefined, current: T | null): T[] {
  const list = items ?? [];
  return current && !list.some((item) => item.id === current.id) ? [...list, current] : list;
}

export function TimeEntryFormPanel({
  week,
  entry,
  defaultDate,
  maxHours,
  descriptionMax,
  onClose,
  onSaved,
}: Props) {
  const queryClient = useQueryClient();
  const uid = useId();
  const titleId = `${uid}-title`;
  const fieldId = (name: FieldName) => `${uid}-${name}`;
  const errorId = (name: FieldName) => `${uid}-${name}-error`;
  const summaryRef = useRef<HTMLDivElement>(null);
  const inFlight = useRef(false); // blocks a second submit before React disables Save

  const initial = useMemo(() => initialValues(entry, defaultDate), [entry, defaultDate]);
  const [values, setValues] = useState<EntryFormValues>(initial);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  // Both modes keep their own state, so switching modes never discards anything the user typed.
  const [mode, setMode] = useState<EntryMode>('day');
  const initialDays = useMemo(() => defaultWeekDays(week.week_start_date), [week.week_start_date]);
  const [days, setDays] = useState<WeekDay[]>(initialDays);
  const [dayErrors, setDayErrors] = useState<Record<string, string>>({});
  const weekMode = mode === 'week' && entry === null;
  const existingHours = useMemo(
    () => Object.fromEntries(week.daily_totals.map((d) => [d.date, d.hours])),
    [week.daily_totals],
  );

  const projects = useQuery({ queryKey: ['projects'], queryFn: fetchProjects, staleTime: 300_000 });
  const earningCodes = useQuery({
    queryKey: ['earning-codes'],
    queryFn: fetchEarningCodes,
    staleTime: 300_000,
  });
  const tasks = useQuery({
    queryKey: ['tasks', values.project_id],
    queryFn: () => fetchTasks(values.project_id),
    enabled: values.project_id !== '',
    staleTime: 300_000,
  });

  const currentProject: ProjectOption | null = entry ? { ...entry.project, is_active: true } : null;
  const currentEarning: EarningCodeOption | null = entry
    ? { ...entry.earning_code, is_active: true }
    : null;
  const currentTask: TaskOption | null =
    entry?.task && entry.project.id === values.project_id
      ? { ...entry.task, project_id: entry.project.id, is_active: true }
      : null;

  const projectOptions = withCurrent(projects.data, currentProject);
  const earningOptions = withCurrent(earningCodes.data, currentEarning);
  const taskOptions = withCurrent(tasks.data, currentTask);
  const projectHasTasks = taskOptions.length > 0;
  const referenceReady = projects.isSuccess && earningCodes.isSuccess;
  const referenceFailed = projects.isError || earningCodes.isError;

  const dirty = isDirty(values, initial) || isWeekDirty(days, initialDays);

  const save = useMutation({
    mutationFn: (request: SaveRequest): Promise<unknown> => {
      if (request.kind === 'week') return createEntriesBatch(request.inputs);
      return entry
        ? updateEntry(entry.id, request.input, entry.version)
        : createEntry(request.input);
    },
    onSuccess: async (_result, request) => {
      await queryClient.invalidateQueries({ queryKey: ['week'] });
      if (request.kind === 'week') {
        const total = sumHours(request.inputs.map((i) => i.hours));
        onSaved(`${request.inputs.length} entries saved (${total} hours).`);
      } else {
        onSaved(entry ? 'Entry updated.' : 'Entry saved.');
      }
    },
    onError: (error, request) => {
      if (error instanceof ApiError && error.status === 422) {
        const known = new Set<string>(FIELD_ORDER);
        const mapped: FieldErrors = {};
        const perDay: Record<string, string> = {};
        const other: string[] = [];
        for (const [field, message] of Object.entries(error.fieldErrors)) {
          // Batch errors arrive as "entries.<index>.<field>"; map the index back to its day.
          const batch = /^entries\.(\d+)\.(\w+)$/.exec(field);
          const name = batch ? (batch[2] as string) : field;
          const date =
            batch && request.kind === 'week' ? request.dates[Number(batch[1])] : undefined;
          if (date && (name === 'hours' || name === 'work_date')) perDay[date] ??= message;
          else if (known.has(name)) mapped[name as FieldName] ??= message;
          else other.push(message);
        }
        setErrors(mapped);
        setDayErrors(perDay);
        setFormError(other.length ? other.join(' ') : null);
      } else {
        setErrors({});
        setDayErrors({});
        setFormError(error instanceof ApiError ? error.message : 'Could not save the entry.');
        // The week may have changed underneath us (e.g. it was submitted); show current state.
        if (error instanceof ApiError && error.status === 409) {
          void queryClient.invalidateQueries({ queryKey: ['week'] });
        }
      }
      requestAnimationFrame(() => summaryRef.current?.focus());
    },
  });

  function setField(name: FieldName, value: string) {
    setValues((current) => {
      const next = { ...current, [name]: value };
      // A task only makes sense for its own project, so changing project clears it.
      if (name === 'project_id' && value !== current.project_id) next.task_id = '';
      return next;
    });
    setErrors((current) => ({ ...current, [name]: undefined }));
  }

  function setDay(date: string, patch: Partial<Pick<WeekDay, 'enabled' | 'hours'>>) {
    setDays((current) => current.map((d) => (d.date === date ? { ...d, ...patch } : d)));
    setDayErrors(({ [date]: _removed, ...rest }) => rest);
  }

  function changeMode(next: EntryMode) {
    setMode(next);
    setErrors({});
    setDayErrors({});
    setFormError(null);
  }

  function send(request: SaveRequest) {
    if (inFlight.current) return;
    inFlight.current = true;
    save.mutate(request, { onSettled: () => (inFlight.current = false) });
  }

  function requestClose() {
    if (save.isPending) return;
    if (dirty) setConfirmDiscard(true);
    else onClose();
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (save.isPending) return;
    const context = {
      weekStart: week.week_start_date,
      weekEnd: week.week_end_date,
      maxHours,
      descriptionMax,
      projectHasTasks,
    };
    const shared = {
      earning_code_id: values.earning_code_id,
      project_id: values.project_id,
      task_id: values.task_id || null,
      description: values.description.trim(),
    };

    if (weekMode) {
      const result = validateWeek(values, days, context);
      setErrors(result.fields);
      setDayErrors(result.days);
      setFormError(result.form);
      if (result.form || Object.keys(result.fields).length || Object.keys(result.days).length) {
        requestAnimationFrame(() => summaryRef.current?.focus());
        return;
      }
      send({
        kind: 'week',
        dates: result.entries.map((e) => e.date),
        inputs: result.entries.map((e) => ({ ...shared, work_date: e.date, hours: e.hours })),
      });
      return;
    }

    const found = validateEntry(values, context);
    setFormError(null);
    setDayErrors({});
    setErrors(found);
    if (Object.keys(found).length > 0) {
      requestAnimationFrame(() => summaryRef.current?.focus());
      return;
    }
    send({
      kind: 'single',
      input: { ...shared, work_date: values.work_date, hours: values.hours.trim() },
    });
  }

  const errorFields = FIELD_ORDER.filter((name) => errors[name]);
  const errorDays = Object.keys(dayErrors).sort();
  const errorCount = errorFields.length + errorDays.length;
  const hasErrors = errorCount > 0 || formError !== null;
  const describedBy = (name: FieldName, hint?: string) =>
    [errors[name] ? errorId(name) : null, hint].filter(Boolean).join(' ') || undefined;

  const taskDisabled =
    values.project_id === '' || tasks.isPending || tasks.isError || !projectHasTasks;
  const taskRequired = projectHasTasks;

  return (
    <>
      <Modal variant="panel" labelledBy={titleId} onRequestClose={requestClose}>
        <form className="panel-form" onSubmit={onSubmit} noValidate>
          <header className="panel-header">
            <h2 id={titleId}>{entry ? 'Edit time entry' : 'Add time entry'}</h2>
            <button
              type="button"
              className="btn btn-secondary"
              aria-label="Close panel"
              onClick={requestClose}
            >
              <span aria-hidden="true">×</span>
            </button>
          </header>

          <div className="panel-body">
            <p className="muted small">
              Week of {formatWeekRange(week.week_start_date, week.week_end_date)}. Fields marked
              “required” must be filled in.
            </p>

            {hasErrors ? (
              <div ref={summaryRef} className="error-summary" role="alert" tabIndex={-1}>
                <h3>
                  {errorCount > 0
                    ? `Please fix ${errorCount} ${errorCount === 1 ? 'field' : 'fields'} before saving`
                    : 'The entry could not be saved'}
                </h3>
                {formError ? <p>{formError}</p> : null}
                {errorCount > 0 ? (
                  <ul>
                    {errorFields.map((name) => (
                      <li key={name}>
                        <a
                          href={`#${fieldId(name)}`}
                          onClick={(event) => {
                            event.preventDefault();
                            document.getElementById(fieldId(name))?.focus();
                          }}
                        >
                          {LABELS[name]}: {errors[name]}
                        </a>
                      </li>
                    ))}
                    {errorDays.map((date) => (
                      <li key={date}>
                        <a
                          href={`#${weekHoursInputId(uid, date)}`}
                          onClick={(event) => {
                            event.preventDefault();
                            document.getElementById(weekHoursInputId(uid, date))?.focus();
                          }}
                        >
                          {longDate(date)}: {dayErrors[date]}
                        </a>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            ) : null}

            {referenceFailed ? (
              <div className="error-state" role="alert">
                <p>Projects or earning codes could not be loaded.</p>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => {
                    void projects.refetch();
                    void earningCodes.refetch();
                  }}
                >
                  Try again
                </button>
              </div>
            ) : null}

            {entry === null ? <EntryModeToggle mode={mode} onChange={changeMode} /> : null}

            {weekMode ? (
              <WeekHoursGrid
                idPrefix={uid}
                days={days}
                existing={existingHours}
                errors={dayErrors}
                maxHours={maxHours}
                onChange={setDay}
              />
            ) : (
              <>
                <div className="field">
                  <label htmlFor={fieldId('work_date')}>
                    Date <span className="required">(required)</span>
                  </label>
                  <input
                    id={fieldId('work_date')}
                    type="date"
                    min={week.week_start_date}
                    max={week.week_end_date}
                    value={values.work_date}
                    aria-required="true"
                    aria-invalid={errors.work_date ? 'true' : undefined}
                    aria-describedby={describedBy('work_date')}
                    onChange={(e) => setField('work_date', e.target.value)}
                  />
                  <FieldError id={errorId('work_date')} message={errors.work_date} />
                </div>

                <div className="field">
                  <label htmlFor={fieldId('hours')}>
                    Hours <span className="required">(required)</span>
                  </label>
                  <input
                    id={fieldId('hours')}
                    type="text"
                    inputMode="decimal"
                    autoComplete="off"
                    value={values.hours}
                    aria-required="true"
                    aria-invalid={errors.hours ? 'true' : undefined}
                    aria-describedby={describedBy('hours', `${uid}-hours-hint`)}
                    onChange={(e) => setField('hours', e.target.value)}
                  />
                  <p id={`${uid}-hours-hint`} className="hint">
                    For example 7.5. Up to two decimals, maximum {maxHours.replace(/\.0+$/, '')}.
                  </p>
                  <FieldError id={errorId('hours')} message={errors.hours} />
                </div>
              </>
            )}

            <div className="field">
              <label htmlFor={fieldId('earning_code_id')}>
                Earning code <span className="required">(required)</span>
              </label>
              <select
                id={fieldId('earning_code_id')}
                value={values.earning_code_id}
                disabled={!earningCodes.isSuccess}
                aria-required="true"
                aria-invalid={errors.earning_code_id ? 'true' : undefined}
                aria-describedby={describedBy('earning_code_id')}
                onChange={(e) => setField('earning_code_id', e.target.value)}
              >
                <option value="">
                  {earningCodes.isPending ? 'Loading earning codes…' : 'Select an earning code'}
                </option>
                {earningOptions.map((code) => (
                  <option key={code.id} value={code.id}>
                    {code.code} — {code.name} (
                    {code.classification === 'CAPPED' ? 'capped' : 'non-capped'})
                  </option>
                ))}
              </select>
              <FieldError id={errorId('earning_code_id')} message={errors.earning_code_id} />
            </div>

            <div className="field">
              <label htmlFor={fieldId('project_id')}>
                Project <span className="required">(required)</span>
              </label>
              <ProjectCombobox
                id={fieldId('project_id')}
                projects={projectOptions}
                value={values.project_id}
                disabled={!projects.isSuccess}
                invalid={Boolean(errors.project_id)}
                describedBy={describedBy('project_id')}
                onChange={(id) => setField('project_id', id)}
              />
              <FieldError id={errorId('project_id')} message={errors.project_id} />
            </div>

            <div className="field">
              <label htmlFor={fieldId('task_id')}>
                Task{' '}
                <span className="required">
                  (
                  {values.project_id === ''
                    ? 'select a project first'
                    : taskRequired
                      ? 'required'
                      : 'optional'}
                  )
                </span>
              </label>
              <select
                id={fieldId('task_id')}
                value={values.task_id}
                disabled={taskDisabled}
                aria-required={taskRequired ? 'true' : undefined}
                aria-invalid={errors.task_id ? 'true' : undefined}
                aria-describedby={describedBy('task_id')}
                onChange={(e) => setField('task_id', e.target.value)}
              >
                <option value="">
                  {values.project_id === ''
                    ? 'Select a project first'
                    : tasks.isPending
                      ? 'Loading tasks…'
                      : tasks.isError
                        ? 'Tasks could not be loaded'
                        : projectHasTasks
                          ? 'Select a task'
                          : 'No tasks for this project'}
                </option>
                {taskOptions.map((task) => (
                  <option key={task.id} value={task.id}>
                    {task.name}
                  </option>
                ))}
              </select>
              {tasks.isError ? (
                <button
                  type="button"
                  className="btn btn-link small"
                  onClick={() => void tasks.refetch()}
                >
                  Retry loading tasks
                </button>
              ) : null}
              <FieldError id={errorId('task_id')} message={errors.task_id} />
            </div>

            <div className="field">
              <label htmlFor={fieldId('description')}>
                Work description <span className="required">(required)</span>
              </label>
              <textarea
                id={fieldId('description')}
                rows={4}
                maxLength={descriptionMax}
                value={values.description}
                aria-required="true"
                aria-invalid={errors.description ? 'true' : undefined}
                aria-describedby={describedBy('description', `${uid}-description-count`)}
                onChange={(e) => setField('description', e.target.value)}
              />
              <p id={`${uid}-description-count`} className="hint">
                {values.description.length} / {descriptionMax} characters
              </p>
              <FieldError id={errorId('description')} message={errors.description} />
            </div>
          </div>

          <footer className="panel-footer">
            <button type="button" className="btn btn-secondary" onClick={requestClose}>
              Cancel
            </button>
            <button
              type="submit"
              className="btn btn-primary"
              disabled={save.isPending || !referenceReady}
            >
              {save.isPending ? 'Saving…' : weekMode ? 'Save entries' : 'Save entry'}
            </button>
          </footer>
        </form>
      </Modal>

      {confirmDiscard ? (
        <ConfirmDialog
          title="Discard changes?"
          confirmLabel="Discard changes"
          cancelLabel="Keep editing"
          danger
          onCancel={() => setConfirmDiscard(false)}
          onConfirm={() => {
            setConfirmDiscard(false);
            onClose();
          }}
        >
          <p>You have unsaved changes to this entry. If you close now they will be lost.</p>
        </ConfirmDialog>
      ) : null}
    </>
  );
}
