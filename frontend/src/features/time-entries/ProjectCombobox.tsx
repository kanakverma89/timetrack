import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { ProjectOption } from '../../api/types';

interface Props {
  id: string;
  projects: ProjectOption[];
  value: string;
  onChange: (projectId: string) => void;
  invalid?: boolean;
  describedBy?: string;
  disabled?: boolean;
}

export const projectLabel = (p: ProjectOption) => `${p.code} — ${p.name}`;

/** Searchable single-select following the ARIA 1.2 combobox (list autocomplete) pattern. */
export function ProjectCombobox({
  id,
  projects,
  value,
  onChange,
  invalid,
  describedBy,
  disabled,
}: Props) {
  const listId = useId();
  const selected = projects.find((p) => p.id === value);
  const selectedLabel = selected ? projectLabel(selected) : '';
  // Text typed by the user while searching; null means "show the selected project".
  const [draft, setDraft] = useState<string | null>(null);
  const query = draft ?? selectedLabel;
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase();
    // Show everything unless the user is actively searching.
    if (!needle || draft === null) return projects;
    return projects.filter((p) => projectLabel(p).toLowerCase().includes(needle));
  }, [projects, query, draft]);

  const optionId = (index: number) => `${listId}-option-${index}`;
  const expanded = open && matches.length > 0;

  useEffect(() => {
    if (!expanded) return;
    document.getElementById(optionId(active))?.scrollIntoView?.({ block: 'nearest' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, expanded]);

  function choose(project: ProjectOption) {
    onChange(project.id);
    setDraft(null);
    setOpen(false);
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        if (!open) setOpen(true);
        else setActive((i) => Math.min(i + 1, matches.length - 1));
        break;
      case 'ArrowUp':
        event.preventDefault();
        if (!open) setOpen(true);
        else setActive((i) => Math.max(i - 1, 0));
        break;
      case 'Enter':
        // Never submit the surrounding form from the combobox.
        event.preventDefault();
        if (expanded && matches[active]) choose(matches[active]);
        break;
      case 'Escape':
        if (open) {
          // Close only the list; the panel must not treat this as "close the panel".
          event.preventDefault();
          event.stopPropagation();
          setOpen(false);
          setDraft(null);
        }
        break;
      default:
    }
  }

  return (
    <div className="combobox">
      <input
        ref={inputRef}
        id={id}
        type="text"
        role="combobox"
        autoComplete="off"
        aria-autocomplete="list"
        aria-expanded={expanded}
        aria-controls={listId}
        aria-activedescendant={expanded ? optionId(active) : undefined}
        aria-required="true"
        aria-invalid={invalid ? 'true' : undefined}
        aria-describedby={describedBy}
        disabled={disabled}
        placeholder="Search projects"
        value={query}
        onChange={(event) => {
          setDraft(event.target.value);
          setActive(0);
          setOpen(true);
        }}
        onFocus={() => setOpen(false)}
        onClick={() => setOpen(true)}
        onKeyDown={onKeyDown}
        onBlur={() => {
          setOpen(false);
          // Free text is not a selection: fall back to the chosen project (or empty).
          setDraft(null);
        }}
      />
      <ul
        id={listId}
        role="listbox"
        aria-label="Projects"
        className="combobox-list"
        hidden={!expanded}
      >
        {matches.map((project, index) => (
          <li
            key={project.id}
            id={optionId(index)}
            role="option"
            aria-selected={project.id === value}
            className={index === active ? 'combobox-option is-active' : 'combobox-option'}
            // mousedown (not click) so the input does not blur first and discard the choice
            onMouseDown={(event) => {
              event.preventDefault();
              choose(project);
            }}
          >
            {projectLabel(project)}
          </li>
        ))}
      </ul>
      {open && matches.length === 0 ? (
        <div className="combobox-empty" role="status">
          No matching projects
        </div>
      ) : null}
    </div>
  );
}
