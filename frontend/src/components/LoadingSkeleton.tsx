export function LoadingSkeleton({ label = 'Loading' }: { label?: string }) {
  return (
    <div className="skeleton-group" role="status" aria-busy="true" aria-label={label}>
      <div className="skeleton-row">
        {Array.from({ length: 7 }, (_, index) => (
          <div key={index} className="skeleton skeleton-card" aria-hidden="true" />
        ))}
      </div>
      <div className="skeleton skeleton-block" aria-hidden="true" />
      <div className="skeleton skeleton-block tall" aria-hidden="true" />
    </div>
  );
}
