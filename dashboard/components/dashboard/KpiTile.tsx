/**
 * One KPI tile on the Paid page.
 *
 * Extracted so the two scope rows cannot drift apart — the all-platform row and
 * the Meta-only row are the same object shown twice, not two similar-looking
 * cards that happen to match today.
 */
export interface Kpi {
  label: string;
  value: string;
  /** Present when the figure covers one platform only. */
  scope?: string;
}

export function KpiTile({ label, value, scope }: Kpi) {
  return (
    <div className="flex flex-col gap-[9px] rounded-card border border-hairline bg-surface-card p-[16px_18px] shadow-sm">
      <span className="flex items-center justify-between gap-2">
        <span className="font-mono text-[10.5px] uppercase tracking-[0.08em] text-content-muted">
          {label}
        </span>
        {scope === "meta" && (
          <span
            aria-label="Meta only"
            title="Meta only — Google reports no comparable figure"
            className="h-[7px] w-[7px] flex-none rounded-[2px] bg-platform-meta"
          />
        )}
      </span>
      <span className="font-mono text-[22px] font-semibold leading-none tracking-heading tabular text-content-strong">
        {value}
      </span>
    </div>
  );
}
