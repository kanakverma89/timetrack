import { useId, type ReactNode } from 'react';
import { FieldError } from './FieldError';

interface Common {
  label: string;
  /** Shown as "(required)" or "(optional)" in the label; omit for neither. */
  requirement?: 'required' | 'optional';
  hint?: ReactNode;
  error?: string;
}

function describedBy(...ids: Array<string | false | undefined>): string | undefined {
  const present = ids.filter(Boolean).join(' ');
  return present || undefined;
}

function Label({ id, label, requirement }: Pick<Common, 'label' | 'requirement'> & { id: string }) {
  return (
    <label htmlFor={id}>
      {label} {requirement ? <span className="required">({requirement})</span> : null}
    </label>
  );
}

export function TextField({
  label,
  requirement,
  hint,
  error,
  value,
  onChange,
  type = 'text',
  ...rest
}: Common & {
  value: string;
  onChange: (value: string) => void;
  type?: 'text' | 'email' | 'search';
  maxLength?: number;
  autoComplete?: string;
  inputMode?: 'text' | 'decimal' | 'numeric';
  disabled?: boolean;
}) {
  const id = useId();
  return (
    <div className="field">
      <Label id={id} label={label} requirement={requirement} />
      <input
        id={id}
        type={type}
        value={value}
        aria-required={requirement === 'required' ? 'true' : undefined}
        aria-invalid={error ? 'true' : undefined}
        aria-describedby={describedBy(hint ? `${id}-hint` : undefined, error && `${id}-error`)}
        onChange={(event) => onChange(event.target.value)}
        {...rest}
      />
      {hint ? (
        <p id={`${id}-hint`} className="hint">
          {hint}
        </p>
      ) : null}
      <FieldError id={`${id}-error`} message={error} />
    </div>
  );
}

export function TextAreaField({
  label,
  requirement,
  hint,
  error,
  value,
  onChange,
  rows = 3,
  maxLength,
}: Common & { value: string; onChange: (value: string) => void; rows?: number; maxLength?: number }) {
  const id = useId();
  return (
    <div className="field">
      <Label id={id} label={label} requirement={requirement} />
      <textarea
        id={id}
        rows={rows}
        maxLength={maxLength}
        value={value}
        aria-required={requirement === 'required' ? 'true' : undefined}
        aria-invalid={error ? 'true' : undefined}
        aria-describedby={describedBy(hint ? `${id}-hint` : undefined, error && `${id}-error`)}
        onChange={(event) => onChange(event.target.value)}
      />
      {hint ? (
        <p id={`${id}-hint`} className="hint">
          {hint}
        </p>
      ) : null}
      <FieldError id={`${id}-error`} message={error} />
    </div>
  );
}

export function SelectField({
  label,
  requirement,
  hint,
  error,
  value,
  onChange,
  options,
  disabled,
}: Common & {
  value: string;
  onChange: (value: string) => void;
  options: Array<{ value: string; label: string }>;
  disabled?: boolean;
}) {
  const id = useId();
  return (
    <div className="field">
      <Label id={id} label={label} requirement={requirement} />
      <select
        id={id}
        value={value}
        disabled={disabled}
        aria-required={requirement === 'required' ? 'true' : undefined}
        aria-invalid={error ? 'true' : undefined}
        aria-describedby={describedBy(hint ? `${id}-hint` : undefined, error && `${id}-error`)}
        onChange={(event) => onChange(event.target.value)}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      {hint ? (
        <p id={`${id}-hint`} className="hint">
          {hint}
        </p>
      ) : null}
      <FieldError id={`${id}-error`} message={error} />
    </div>
  );
}

export function CheckboxField({
  label,
  hint,
  checked,
  onChange,
  disabled,
}: {
  label: string;
  hint?: ReactNode;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
}) {
  const id = useId();
  return (
    <div className="field field-check">
      <input
        id={id}
        type="checkbox"
        checked={checked}
        disabled={disabled}
        aria-describedby={hint ? `${id}-hint` : undefined}
        onChange={(event) => onChange(event.target.checked)}
      />
      <label htmlFor={id}>{label}</label>
      {hint ? (
        <p id={`${id}-hint`} className="hint">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
