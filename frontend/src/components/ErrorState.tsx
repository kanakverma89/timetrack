import { ApiError } from '../api/client';

interface Props {
  error: unknown;
  onRetry: () => void;
  title?: string;
}

export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  return 'Something went wrong. Please try again.';
}

export function ErrorState({ error, onRetry, title = 'We could not load this data' }: Props) {
  const requestId = error instanceof ApiError ? error.requestId : null;
  return (
    <div className="error-state" role="alert">
      <h3>{title}</h3>
      <p>{errorMessage(error)}</p>
      {requestId ? <p className="muted small">Reference: {requestId}</p> : null}
      <button type="button" className="btn btn-primary" onClick={onRetry}>
        Try again
      </button>
    </div>
  );
}
