/** Shown while a console page's server data loads. */
export default function Loading() {
  return (
    <div aria-busy="true" aria-label="Loading" className="mx-auto max-w-5xl px-6 py-6">
      <div className="mb-6 h-5 w-40 animate-pulse rounded bg-surface-2" />
      <div className="flex flex-col gap-2">
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="h-10 animate-pulse rounded-md bg-surface-2" style={{ opacity: 1 - i * 0.12 }} />
        ))}
      </div>
    </div>
  );
}
