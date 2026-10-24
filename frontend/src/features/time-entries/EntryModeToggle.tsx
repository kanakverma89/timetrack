export type EntryMode = 'day' | 'week';

interface Props {
  mode: EntryMode;
  onChange: (mode: EntryMode) => void;
}

/** Day / Week switch as a native radio group, so arrow keys and screen readers just work. */
export function EntryModeToggle({ mode, onChange }: Props) {
  return (
    <fieldset className="mode-toggle">
      <legend>Entry mode</legend>
      {(
        [
          ['day', 'Day', 'One date'],
          ['week', 'Week', 'Several days at once'],
        ] as const
      ).map(([value, label, hint]) => (
        <label key={value} className={mode === value ? 'is-selected' : undefined}>
          <input
            type="radio"
            name="entry-mode"
            value={value}
            checked={mode === value}
            onChange={() => onChange(value)}
          />
          {label} <span className="muted small">{hint}</span>
        </label>
      ))}
    </fieldset>
  );
}
