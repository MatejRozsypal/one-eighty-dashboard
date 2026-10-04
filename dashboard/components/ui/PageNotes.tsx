/**
 * One muted line under the control bar on a page that ignores the date range
 * (cohorts, repurchase, customers, stock). The date picker still sits above it
 * so the URL keeps its range for the pages that do read it; this says the
 * picker has no effect here.
 */
export function RangeNote() {
  return (
    <div className="page-frame px-5 pt-2 lg:px-8">
      <p className="text-[11.5px] text-content-muted">Not affected by date range.</p>
    </div>
  );
}

/**
 * An empty state with its own one-line message, same box as `NoData`. For the
 * cases where "No data in this range." would be wrong: the page ignores the
 * range, or the source is simply not ingested.
 */
export function EmptyNote({ children }: { children: string }) {
  return (
    <div
      role="status"
      className="rounded-card border border-dashed border-hairline-strong bg-paper px-5 py-6 text-[13.5px] text-content-muted"
    >
      {children}
    </div>
  );
}
