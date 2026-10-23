import { useId, useState } from 'react';

const LIMIT = 140;

/** Renders text (never HTML); long text is truncated with an accessible expand toggle. */
export function ExpandableText({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false);
  const id = useId();
  if (text.length <= LIMIT) return <p className="entry-description">{text}</p>;
  return (
    <div>
      <p id={id} className="entry-description">
        {expanded ? text : `${text.slice(0, LIMIT).trimEnd()}…`}
      </p>
      <button
        type="button"
        className="btn btn-link small"
        aria-expanded={expanded}
        aria-controls={id}
        onClick={() => setExpanded((value) => !value)}
      >
        {expanded ? 'Show less' : 'Show more'}
      </button>
    </div>
  );
}
