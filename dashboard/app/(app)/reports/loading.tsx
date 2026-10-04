/**
 * Loading state for /reports and /reports/[id]. It sits under the layout, so
 * the rail and the list panel stay put; only the page area is a skeleton: a
 * header strip, the filter strip, a row of KPI tiles and two charts.
 */

const shimmer =
  "bg-[linear-gradient(90deg,var(--gray-100)_25%,var(--gray-150)_37%,var(--gray-100)_63%)] bg-[length:320px_100%] animate-[oe-shimmer_1.3s_linear_infinite]";

export default function Loading() {
  return (
    <>
      <div className="hidden h-[var(--header-h)] items-center gap-3 border-b border-hairline bg-paper px-8 pt-[var(--safe-top)] lg:flex">
        <span className={`h-[15px] w-[160px] rounded-xs ${shimmer}`} />
      </div>
      <div className="flex items-center gap-4 border-b border-hairline bg-paper px-5 py-2 lg:px-8">
        <span className={`h-[34px] w-[120px] rounded-control ${shimmer}`} />
        <span className={`h-[34px] w-[200px] rounded-control ${shimmer}`} />
        <span className={`hidden h-[30px] w-[220px] rounded-pill lg:block ${shimmer}`} />
      </div>
      <main aria-busy="true" aria-label="Loading" className="flex flex-col gap-4 px-5 pb-14 pt-5 lg:px-8">
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {Array.from({ length: 4 }, (_, i) => (
            <span key={i} className={`h-[136px] rounded-card border border-hairline ${shimmer}`} />
          ))}
        </div>
        <div className="grid gap-4 lg:grid-cols-2">
          <span className={`h-[312px] rounded-card border border-hairline ${shimmer}`} />
          <span className={`h-[312px] rounded-card border border-hairline ${shimmer}`} />
        </div>
      </main>
    </>
  );
}
