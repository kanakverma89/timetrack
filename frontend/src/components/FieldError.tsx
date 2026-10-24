/** Inline field error; its id is referenced by the input's aria-describedby. */
export function FieldError({ id, message }: { id: string; message?: string }) {
  if (!message) return null;
  return (
    <p id={id} className="field-error">
      <span className="sr-only">Error: </span>
      {message}
    </p>
  );
}
