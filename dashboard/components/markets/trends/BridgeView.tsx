"use client";

/**
 * What changed: GP after ads against the compare period. First the change by
 * market (Unallocated spend is its own bar), then, for the picked market, the
 * change split into five drivers in a fixed order: orders, AOV, discount
 * rate, COGS %, ad spend, and their sum. Gains are green, losses red; the two
 * levels are printed above the chart rather than drawn, so a small driver is
 * not dwarfed by the size of the whole.
 */

import { useId, useState } from "react";
import { Bar, BarChart, CartesianGrid, Cell, LabelList, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ChartSummary } from "@/components/ui/ChartSummary";
import { InfoTip } from "@/components/ui/InfoTip";
import { SegmentPills } from "@/components/controls/SegmentedControl";
import { formatMoney, NO_VALUE } from "@/lib/format";
import { bridgeMoney, type MarketChange } from "@/lib/markets/analysis";
import { AXIS_TICK, TooltipBox, TooltipRow, marketLabel } from "@/components/markets/trends/bits";

const POS = "var(--positive)";
const NEG = "var(--negative)";

export const BRIDGE_ORDER_NOTE =
  "Sequential decomposition of GP after ads = orders x AOV before discounts x (1 - discount rate) x (1 - COGS %) - ad spend. Drivers move from the compare period to this period one at a time in this order: orders, AOV, discount rate, COGS %, ad spend; each step holds the earlier drivers at this period and the later ones at the compare period, so the steps add up to the change exactly. Discount rate here includes refunds (net sales / gross sales).";

export function BridgeView({
  changes,
  currency,
  compareLabel,
}: {
  changes: MarketChange[];
  currency: string;
  compareLabel: string;
}) {
  const byMarketId = useId();
  const walkId = useId();
  const withWalk = changes.filter((c) => c.decomposition);
  const [picked, setPicked] = useState<string>(withWalk[0]?.market ?? "");
  const sel = withWalk.find((c) => c.market === picked) ?? withWalk[0];

  const known = changes.filter((c) => c.change !== null);
  const total = known.length === changes.length ? known.reduce((t, c) => t + (c.change as number), 0) : null;
  const bars = [
    ...known.map((c) => ({ name: marketLabel(c.market), value: c.change as number, kind: "change" as const })),
    ...(total !== null && known.length > 1 ? [{ name: "Total", value: total, kind: "total" as const }] : []),
  ];
  const fmt = (v: number) => formatMoney(v, currency);
  const missing = changes.filter((c) => c.change === null);

  // A real bridge: the compare-period level, each driver floating from where the
  // previous one ended, and today's level. The value axis is zoomed to the band
  // the walk moves in (it says so), so a small driver is not dwarfed by the
  // size of the whole.
  type WalkRow = { name: string; value: number | null; range: [number, number] | null; kind: "level" | "step"; note?: string; label: string };
  const walk: WalkRow[] | null = sel?.decomposition
    ? (() => {
        const d = sel.decomposition!;
        const short = (v: number) => bridgeMoney(v, currency);
        const signed = (v: number) => `${v >= 0 ? "+" : "−"}${short(Math.abs(v))}`;
        const rows: WalkRow[] = [{ name: "Compare period", value: d.before, range: [0, d.before], kind: "level", label: short(d.before) }];
        let at = d.before;
        for (const st of d.steps) {
          if (st.value === null) {
            rows.push({ name: st.label, value: null, range: null, kind: "step", note: st.note, label: NO_VALUE });
            continue;
          }
          rows.push({ name: st.label, value: st.value, range: [at, at + st.value], kind: "step", note: st.note, label: signed(st.value) });
          at += st.value;
        }
        rows.push({ name: "Now", value: d.after, range: [0, d.after], kind: "level", label: short(d.after) });
        return rows;
      })()
    : null;
  const walkDomain = (() => {
    if (!walk) return undefined;
    const ends = walk.filter((w) => w.kind === "step" && w.range).flatMap((w) => w.range as [number, number]);
    const levels = walk.filter((w) => w.kind === "level").map((w) => w.value as number);
    const all = [...ends, ...levels];
    const lo = Math.min(...all);
    const hi = Math.max(...all);
    const pad = Math.max((hi - lo) * 0.25, Math.abs(hi) * 0.02, 1);
    // Zoom only when every level is clearly away from zero; otherwise draw from zero.
    const from = lo > 0 && lo - pad > 0 ? lo - pad : Math.min(0, lo - pad);
    return [from, hi + pad] as [number, number];
  })();
  const zoomed = walkDomain !== undefined && walkDomain[0] > 0;
  const takeaway = sel?.decomposition ? bridgeTakeaway(sel.decomposition, fmt) : null;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-1.5 text-[12.5px] font-medium text-content-strong">
          Change in GP after ads by market
          <span className="font-normal text-content-muted">{compareLabel}</span>
        </div>
        {bars.length > 0 ? (
          <div className="w-full" style={{ height: 40 + bars.length * 34 }} role="img" aria-label="Change in GP after ads by market" aria-describedby={byMarketId}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={bars} layout="vertical" margin={{ top: 4, right: 16, bottom: 0, left: 4 }}>
                <CartesianGrid stroke="var(--border)" horizontal={false} />
                <XAxis type="number" tickLine={false} axisLine={false} tick={AXIS_TICK} tickFormatter={(v: number) => bridgeMoney(v, currency)} />
                <YAxis type="category" dataKey="name" tickLine={false} axisLine={false} width={84} tick={{ ...AXIS_TICK, fill: "var(--text-body)" }} />
                <ReferenceLine x={0} stroke="var(--gray-400)" />
                <Tooltip cursor={{ fill: "var(--gray-100)", opacity: 0.6 }} content={<ValueTooltip currency={currency} />} />
                <Bar dataKey="value" isAnimationActive={false} radius={[3, 3, 3, 3]} barSize={18}>
                  {bars.map((b, i) => (
                    <Cell key={i} fill={b.value >= 0 ? POS : NEG} fillOpacity={b.kind === "total" ? 1 : 0.8} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        ) : null}
        <ChartSummary id={byMarketId} categories labels={bars.map((b) => b.name)} series={[{ name: "Change in GP after ads", values: bars.map((b) => b.value) }]} format={fmt} />
        {missing.length > 0 && (
          <ul className="m-0 flex list-none flex-col gap-1 p-0 text-[12px] text-content-muted">
            {missing.map((c) => (
              <li key={c.market} className="inline-flex items-center gap-1.5">
                <span className="font-mono text-content-body">{marketLabel(c.market)}</span> {NO_VALUE}
                <InfoTip text={c.why ?? "No value"} label={`Why ${marketLabel(c.market)} is n/a`} />
              </li>
            ))}
          </ul>
        )}
      </div>

      {sel && walk && (
        <div className="flex flex-col gap-2 border-t border-hairline pt-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-1.5 text-[12.5px] font-medium text-content-strong">
              What drove {marketLabel(sel.market)}
              <InfoTip text={BRIDGE_ORDER_NOTE} label="How the drivers are split" />
            </div>
            {withWalk.length > 1 && (
              <SegmentPills
                segments={withWalk.map((c) => ({ value: c.market, label: marketLabel(c.market) }))}
                shown={sel.market}
                onSelect={setPicked}
                ariaLabel="Market"
              />
            )}
          </div>
          {takeaway && <p className="m-0 text-[13px] text-content-strong">{takeaway}</p>}
          <div className="h-[250px] w-full" role="img" aria-label={`Bridge of GP after ads from the compare period to now, ${marketLabel(sel.market)}`} aria-describedby={walkId}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={walk} margin={{ top: 22, right: 8, bottom: 0, left: 4 }}>
                <CartesianGrid stroke="var(--border)" vertical={false} />
                <XAxis dataKey="name" tickLine={false} axisLine={false} interval={0} tick={AXIS_TICK} />
                <YAxis
                  domain={walkDomain}
                  allowDataOverflow
                  tickLine={false}
                  axisLine={false}
                  width={68}
                  tick={AXIS_TICK}
                  tickFormatter={(v: number) => bridgeMoney(v, currency)}
                />
                {!zoomed && <ReferenceLine y={0} stroke="var(--gray-400)" />}
                <Tooltip cursor={{ fill: "var(--gray-100)", opacity: 0.6 }} content={<WalkTooltip currency={currency} />} />
                <Bar dataKey="range" isAnimationActive={false} radius={[3, 3, 3, 3]} maxBarSize={56}>
                  {walk.map((w, i) => (
                    <Cell
                      key={i}
                      fill={w.kind === "level" ? "var(--gray-400)" : (w.value ?? 0) >= 0 ? POS : NEG}
                      fillOpacity={w.kind === "level" ? 0.55 : 0.85}
                    />
                  ))}
                  <LabelList dataKey="label" position="top" className="tabular" style={{ fontSize: 11, fill: "var(--text-body)" }} />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
          {zoomed && <p className="m-0 text-[11.5px] text-content-muted">Value axis starts at {bridgeMoney(walkDomain![0], currency)}, zoomed to the band the change moves in.</p>}
          <ChartSummary
            id={walkId}
            categories
            labels={walk.map((w) => w.name)}
            series={[{ name: `Drivers of the change in GP after ads, ${marketLabel(sel.market)}`, values: walk.map((w) => w.value) }]}
            format={fmt}
          />
          {walk.some((w) => w.note) && (
            <p className="m-0 text-[12px] text-content-muted">{walk.find((w) => w.note)?.note}.</p>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * One plain sentence: how much GP after ads moved and which drivers moved it.
 * Drivers under 10 % of the largest one are grouped as "barely moved".
 */
export function bridgeTakeaway(
  d: { before: number; after: number; steps: Array<{ label: string; value: number | null }> },
  fmt: (v: number) => string
): string {
  const delta = d.after - d.before;
  const pct = d.before !== 0 ? ` (${delta >= 0 ? "+" : "−"}${Math.abs((delta / Math.abs(d.before)) * 100).toFixed(0)} %)` : "";
  const head = `GP after ads ${delta >= 0 ? "rose" : "fell"} ${fmt(Math.abs(delta))}${pct}.`;
  const known = d.steps.filter((s): s is { label: string; value: number } => s.value !== null);
  if (!known.length) return head;
  const biggest = Math.max(...known.map((s) => Math.abs(s.value)));
  const sig = known.filter((s) => Math.abs(s.value) >= 0.1 * biggest).sort((a, b) => Math.abs(b.value) - Math.abs(a.value));
  const name: Record<string, string> = { Orders: "orders", AOV: "AOV", "Discount rate": "discount rate", "COGS %": "COGS %", "Ad spend": "ad spend" };
  const flatNames = known.filter((s) => Math.abs(s.value) < 0.1 * biggest).map((s) => name[s.label] ?? s.label);
  const flat = flatNames.length > 1 ? [`${flatNames.slice(0, -1).join(", ")} and ${flatNames[flatNames.length - 1]}`] : flatNames;
  const word: Record<string, [string, string]> = {
    Orders: ["more orders", "fewer orders"],
    AOV: ["a higher AOV", "a lower AOV"],
    "Discount rate": ["less discounting", "more discounting"],
    "COGS %": ["a better margin (lower COGS %)", "a worse margin (higher COGS %)"],
    "Ad spend": ["lower ad spend", "higher ad spend"],
  };
  const parts = sig.map((s) => {
    const [up, down] = word[s.label] ?? [s.label, s.label];
    return `${s.value >= 0 ? up : down} ${s.value >= 0 ? "added" : "cost"} ${fmt(Math.abs(s.value))}`;
  });
  const body = parts.length ? ` ${parts[0][0].toUpperCase()}${parts[0].slice(1)}${parts.length > 1 ? `; ${parts.slice(1).join("; ")}` : ""}.` : "";
  const tail = flat.length ? ` ${flat[0].replace(/^[a-z]/, (c) => c.toUpperCase())} barely moved.` : "";
  return head + body + tail;
}

function ValueTooltip({ active, payload, currency }: { active?: boolean; payload?: Array<{ payload: { name: string; value: number } }>; currency: string }) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  return (
    <TooltipBox title={p.name}>
      <TooltipRow name="Change" value={formatMoney(p.value, currency)} />
    </TooltipBox>
  );
}

function WalkTooltip({
  active,
  payload,
  currency,
}: {
  active?: boolean;
  payload?: Array<{ payload: { name: string; value: number | null; kind: string; note?: string } }>;
  currency: string;
}) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  return (
    <TooltipBox title={p.name}>
      <TooltipRow name={p.kind === "level" ? "GP after ads" : "Effect"} value={p.value === null ? NO_VALUE : formatMoney(p.value, currency)} muted={p.value === null} />
      {p.value === null && p.note && <div className="max-w-[240px] whitespace-normal font-sans text-[11px] text-content-muted">{p.note}</div>}
    </TooltipBox>
  );
}
