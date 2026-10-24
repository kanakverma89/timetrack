import { ApiError } from '../../api/client';

export interface Problems {
  /** Errors for individual fields, keyed by the API's field names. */
  fields: Record<string, string>;
  /** A message for the whole form, or null when only fields are wrong. */
  message: string | null;
}

/** Split an API failure into per-field messages and a form-level message. */
export function problemsOf(error: unknown): Problems {
  if (!(error instanceof ApiError)) {
    return { fields: {}, message: 'Something went wrong. Please try again.' };
  }
  const { request, ...fields } = error.fieldErrors;
  if (Object.keys(fields).length > 0) {
    return { fields, message: request ?? 'Please fix the highlighted fields.' };
  }
  return { fields: {}, message: request ?? error.message };
}

export const NO_PROBLEMS: Problems = { fields: {}, message: null };
