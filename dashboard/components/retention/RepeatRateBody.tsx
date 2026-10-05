/**
 * The Repeat rate page body: controls, tiles, cohort table, trend, curve and
 * entry products, computed from one `RetentionData`.
 *
 * Shared by the page (warehouse or demo data) and by the check script, so what
 * the script renders is what the page renders. All numbers come from
 * `lib/retention/model`; this file only lays them out.
 *
 * Controls are URL params (`entry`, `event`, `h`, `vs`, `months`). Entry and
 * Event are absent for a client without product classes (no entry class, no
 * full-size event), and so are the full-size tiles and the Entry products table.
 */

import { SegmentedControl } from "@/components/controls/SegmentedControl";
import { DeltaModeToggle } from "@/components/controls/DeltaModeToggle";
import { InfoTip } from "@/components/ui/InfoTip";
import { Eyebrow } from "@/components/ui/Eyebrow";
import { EmptyNote } from "@/components/ui/PageNotes";
import { RETENTION_TIPS } from "@/lib/metrics";
import {
  HORIZONS,
  cohortTable,
  curves,
  entryOptions,
  entryTable,
  maturing,
  parseEvent,
  parseHorizon,
  parseVs,
  resolveEntry,
  tile,
  trend,
  type RetentionData,
} from "@/lib/retention/model";
import { RetentionTiles } from "@/components/retention/RetentionTiles";
import { CohortRateTable } from "@/components/retention/CohortRateTable";
import { CohortTrendChart } from "@/components/retention/CohortTrendChart";
import { RepeatCurveChart } from "@/components/retention/RepeatCurveChart";
import { EntryClassTable } from "@/components/retention/EntryClassTable";

type Params = Record<string, string | string[] | undefined>;

const LABEL = "font-mono text-[10px] uppercase tracking-[0.12em] text-content-muted";
const CARD = "flex flex-col gap-4 rounded-card border border-hairline bg-surface-card p-[22px_20px] shadow-sm lg:p-[22px_26px]";

const MONTH_RANGES = [
  { value: "13", label: "13" },
  { value: "25", label: "25" },
  { value: "all", label: "All" },
];

function first(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

export function RepeatRateBody({ data, params }: { data: RetentionData; params: Params }) {
  const { meta, rows } = data;
  const entry = resolveEntry(first(params.entry), rows, meta);
  const event = parseEvent(first(params.event), meta);
  const horizon = parseHorizon(first(params.h), parseHorizon(data.primaryHorizon));
  const vs = parseVs(first(params.vs));
  const monthsParam = MONTH_RANGES.some((r) => r.value === first(params.months)) ? (first(params.months) as string) : "25";
  const months = monthsParam === "all" ? null : Number(monthsParam);

  const options = entryOptions(rows, meta);
  const tiles = [
    tile(rows, meta, entry, "repeat", 90, vs),
    tile(rows, meta, entry, "repeat", 180, vs),
    ...(meta.classes ? [tile(rows, meta, entry, "full", 90, vs), tile(rows, meta, entry, "full", 180, vs)] : []),
  ];
  const table = cohortTable(rows, meta, entry, event, months);
  const series = trend(rows, meta, entry, event, horizon, months);
  const { recent, older } = curves(data.km, entry, event);
  const classLines = entryTable(rows, meta);
  const earlyLeftOut = rows.reduce((s, r) => (r.early ? s + r.n : s), 0);
  const eventTitle = event === "repeat" ? "Time to repeat" : "Time to full size";
  const eventName = event === "repeat" ? "Repeat" : "Full size";

  return (
    <>
      <div className="flex flex-wrap items-end gap-x-6 gap-y-4" data-controls>
        {meta.classes && options.length > 0 && (
          <div className="flex min-w-0 max-w-full flex-col gap-2">
            <span className={LABEL}>Entry</span>
            <div className="max-w-full overflow-x-auto">
              <SegmentedControl param="entry" ariaLabel="Entry product" active={entry} segments={options} />
            </div>
          </div>
        )}
        {meta.classes && (
          <div className="flex flex-col gap-2">
            <span className={LABEL}>Event</span>
            <SegmentedControl
              param="event"
              ariaLabel="Event"
              active={event}
              segments={[
                { value: "repeat", label: "Repeat" },
                { value: "full", label: "Full size" },
              ]}
            />
          </div>
        )}
        <div className="flex flex-col gap-2">
          <span className={LABEL}>vs</span>
          <div className="flex flex-wrap items-center gap-2">
            <SegmentedControl
              param="vs"
              ariaLabel="Compare with"
              active={vs}
              segments={[
                { value: "year", label: "Year earlier" },
                { value: "prior", label: "Prior 6 months" },
              ]}
            />
            <DeltaModeToggle />
          </div>
        </div>
      </div>

      <RetentionTiles tiles={tiles} maturing={maturing(rows, entry)} vsLabel={vs === "year" ? "year earlier" : "prior 6 months"} />

      <CohortRateTable
        table={table}
        control={
          <div className="flex items-center gap-2">
            <span className={LABEL}>Months</span>
            <SegmentedControl param="months" ariaLabel="Months shown" active={monthsParam} segments={MONTH_RANGES} />
          </div>
        }
      />

      <section className={CARD} data-section="trend">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Eyebrow>
            Trend
            <InfoTip text={RETENTION_TIPS.trend} />
          </Eyebrow>
          <div className="flex items-center gap-2">
            <span className={LABEL}>Horizon</span>
            <SegmentedControl
              param="h"
              ariaLabel="Horizon in days"
              active={String(horizon)}
              segments={HORIZONS.map((h) => ({ value: String(h), label: String(h) }))}
            />
          </div>
        </div>
        {series.points.length === 0 ? (
          <EmptyNote>Too few customers.</EmptyNote>
        ) : (
          <CohortTrendChart trend={series} eventLabel={eventName} />
        )}
      </section>

      <section className={CARD} data-section="curve">
        <Eyebrow>
          {eventTitle}
          <InfoTip text={event === "repeat" ? RETENTION_TIPS.timeToRepeat : RETENTION_TIPS.timeToFull} />
        </Eyebrow>
        {recent.endT === null && older.endT === null ? (
          <EmptyNote>Too few customers.</EmptyNote>
        ) : (
          <RepeatCurveChart recent={recent} older={older} eventLabel={eventName} />
        )}
      </section>

      {meta.classes && <EntryClassTable lines={classLines} earlyLeftOut={earlyLeftOut} />}
    </>
  );
}
