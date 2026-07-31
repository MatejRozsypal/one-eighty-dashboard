/**
 * Cohort grid, drawn as a heatmap.
 *
 * ── Colour is scaled per grid, not per row ──────────────────────────────────
 * Every cell shares one scale, so a dark cell means the same thing wherever it
 * is and cohorts are comparable down a column. Scaling per row would make every
 * cohort's own best month dark and destroy exactly the comparison the grid is
 * for.
 *
 * ── Month 0 is excluded from that scale ─────────────────────────────────────
 * On retention month 0 is 100% by definition — every cohort ordered in the
 * month it was born. Leaving it in the scale makes it the maximum everywhere
 * and washes every later month to near-white, which is how a retention grid
 * ends up looking empty. It is still shown, just not allowed to set the range.
 *
 * ── Empty vs zero ───────────────────────────────────────────────────────────
 * A cohort that hasn't lived through an offset gets no cell at all. Drawing 0%
 * there would say everybody churned when it means the month hasn't happened.
 */

import { formatMoney, formatNumber, formatPercent } from "@/lib/currency";
import type { CellFormat, CohortGrid } from "@/lib/queries/cohortGrid";

export function CohortHeatmap({
  grid,
  format,
  currency,
}: {
  grid: CohortGrid;
  format: CellFormat;
  currency: string;
}) {
  const scaleValues: number[] = [];
  for (const row of grid.rows) {
    row.cells.forEach((v, offset) => {
      if (offset > 0 && v !== null && v > 0) scaleValues.push(v);
    });
  }
  const max = scaleValues.length > 0 ? Math.max(...scaleValues) : 0;

  const render = (v: number | null): string => {
    if (v === null) return "";
    switch (format) {
      case "percent":
        return formatPercent(v, { decimals: 1 });
      case "money":
        return formatMoney(v, currency, { compact: true });
      case "ratio":
        return v.toFixed(2);
      default:
        return formatNumber(v);
    }
  };

  // Opacity, not a colour ramp: one accent at varying strength keeps the grid
  // inside the brand's single-accent rule and stays readable to anyone who
  // can't separate hues.
  const shade = (v: number | null, offset: number): string => {
    if (v === null) return "";
    if (offset === 0) return "background-color:var(--gray-100)";
    if (max <= 0 || v <= 0) return "";
    // Square root: the distribution is heavily skewed to small values, and a
    // linear ramp would leave everything but the top few cells invisible.
    const t = Math.min(1, Math.sqrt(v / max));
    return `background-color:color-mix(in srgb, var(--accent) ${(t * 82).toFixed(0)}%, transparent)`;
  };

  const offsets = Array.from({ length: grid.maxOffset + 1 }, (_, i) => i);
  const cols = `minmax(96px,1.1fr) minmax(72px,0.7fr) repeat(${offsets.length}, minmax(62px, 1fr))`;

  return (
    <div className="overflow-x-auto">
      <div style={{ minWidth: 180 + offsets.length * 62 }}>
        <div
          className="grid items-center gap-0 border-b border-hairline bg-gray-50"
          style={{ gridTemplateColumns: cols }}
        >
          {["Cohort", "Customers", ...offsets.map((o) => `Month ${o}`)].map((h, i) => (
            <span
              key={h}
              className={`px-2.5 py-2.5 font-mono text-[10px] uppercase tracking-[0.06em] text-content-muted ${
                i >= 2 ? "text-right" : ""
              }`}
            >
              {h}
            </span>
          ))}
        </div>

        <div
          className="grid items-center gap-0 border-b border-hairline bg-gray-50/60"
          style={{ gridTemplateColumns: cols }}
        >
          <span className="px-2.5 py-2.5 text-[12.5px] font-semibold text-content-strong">
            All cohorts
          </span>
          <span className="px-2.5 py-2.5 text-right font-mono text-[12px] tabular text-content-strong">
            {formatNumber(grid.totalCustomers)}
          </span>
          {offsets.map((o) => (
            <span
              key={o}
              className="px-2.5 py-2.5 text-right font-mono text-[12px] tabular text-content-strong"
            >
              {render(grid.allCohorts[o] ?? null)}
            </span>
          ))}
        </div>

        {grid.rows.map((row) => (
          <div
            key={row.month}
            className="grid items-center gap-0 border-b border-hairline"
            style={{ gridTemplateColumns: cols }}
          >
            <span className="px-2.5 py-2.5 font-mono text-[12px] tabular text-content-strong">
              {monthLabel(row.month)}
            </span>
            <span className="px-2.5 py-2.5 text-right font-mono text-[12px] tabular text-content-body">
              {formatNumber(row.customers)}
            </span>
            {offsets.map((o) => {
              const v = row.cells[o] ?? null;
              return (
                <span
                  key={o}
                  // Inline because the value is continuous — a Tailwind class
                  // per shade would mean 100 classes that the JIT can't see.
                  style={cssToStyle(shade(v, o))}
                  className={`px-2.5 py-2.5 text-right font-mono text-[12px] tabular ${
                    v === null ? "text-gray-200" : "text-content-strong"
                  }`}
                >
                  {render(v)}
                </span>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

function cssToStyle(css: string): React.CSSProperties {
  if (!css) return {};
  const [, value] = css.split("background-color:");
  return value ? { backgroundColor: value } : {};
}

function monthLabel(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-US", {
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}
