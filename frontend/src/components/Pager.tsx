interface Props {
  page: number;
  pageSize: number;
  total: number;
  /** Singular noun for the count, e.g. "timesheet"; an "s" is added for the plural. */
  noun: string;
  onPage: (page: number) => void;
}

export function Pager({ page, pageSize, total, noun, onPage }: Props) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  return (
    <nav className="pager" aria-label="Pagination">
      <button
        type="button"
        className="btn btn-secondary"
        disabled={page <= 1}
        onClick={() => onPage(page - 1)}
      >
        Previous page
      </button>
      <span>
        Page {page} of {pages} · {total} {total === 1 ? noun : `${noun}s`}
      </span>
      <button
        type="button"
        className="btn btn-secondary"
        disabled={page >= pages}
        onClick={() => onPage(page + 1)}
      >
        Next page
      </button>
    </nav>
  );
}
