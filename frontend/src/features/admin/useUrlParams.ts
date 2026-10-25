import { useSearchParams } from 'react-router-dom';

/** List state (filters, page) lives in the URL so it survives reloads and can be shared. */
export function useUrlParams() {
  const [params, setParams] = useSearchParams();
  const page = Math.max(1, Number.parseInt(params.get('page') ?? '1', 10) || 1);
  const update = (changes: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(changes)) {
      if (value === null || value === '') next.delete(key);
      else next.set(key, value);
    }
    setParams(next);
  };
  return { params, page, update };
}
