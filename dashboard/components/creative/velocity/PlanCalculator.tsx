"use client";

/**
 * The Velocity calculator, the page version of the team's Google Sheet.
 *
 * Every input starts at the saved value, or empty, which means "use the
 * measured value" (shown under the field). Typing recomputes everything at
 * once with the same `capacity()` the server pages use; nothing is stored
 * until somebody presses Save, and then it is stored for the whole team. A
 * reset empties the field, which saves as "measured".
 *
 * It answers both ways round: what a budget buys (capacity, window, winners)
 * and what a target costs (spend for N new ads a month, spend for a 7-day
 * window).
 */

import { useMemo, useState, useTransition } from "react";
import { InfoTip } from "@/components/ui/InfoTip";
import { TableFrame, Td, Th } from "@/components/creative/velocity/Table";
import {
  EMPTY_VELOCITY_INPUTS,
  VELOCITY_INPUT_KEYS,
  briefQuota,
  capacity,
  resolveInputs,
  scenarioLadder,
  spendForTarget,
  tierOf,
  toCapacityInputs,
  type VelocityInputs,
} from "@/lib/creative/capacity";
import { days, perMonth, share, whole } from "@/lib/creative/velocityFormat";
import { formatMoney, formatNumber, isNoValue, NO_VALUE } from "@/lib/format";

type Key = (typeof VELOCITY_INPUT_KEYS)[number];

/** Shares are typed as percentages and stored as fractions. */
const PERCENT_KEYS: ReadonlySet<Key> = new Set(["newShare", "hitRate"]);

export interface SaveResult {
  ok: boolean;
  error?: string;
  savedBy?: string;
  savedAt?: string;
}

/** "35 900", "35,900" and "28,9" all read as numbers. Empty is null. */
export function parseInput(raw: string): number | null | "invalid" {
  const t = raw.trim().replace(/\s+/g, "");
  if (t === "") return null;
  const normalised = /^\d+,\d{1,2}$/.test(t) ? t.replace(",", ".") : t.replace(/,/g, "");
  const n = Number(normalised);
  return Number.isFinite(n) && n >= 0 ? n : "invalid";
}

function toText(key: Key, v: number | null): string {
  if (v === null) return "";
  const shown = PERCENT_KEYS.has(key) ? +(v * 100).toFixed(2) : v;
  return String(shown);
}

function fromText(key: Key, raw: string): number | null | "invalid" {
  const n = parseInput(raw);
  if (n === null || n === "invalid") return n;
  return PERCENT_KEYS.has(key) ? n / 100 : n;
}

function savedLabel(by: string | null, at: string | null): string | null {
  if (!by || !at) return null;
  const date = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Prague",
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(at));
  return `Saved by ${by}, ${date}`;
}

export function PlanCalculator({
  clientId,
  currency,
  measured,
  saved,
  savedBy,
  savedAt,
  spendSource,
  usdRate,
  queued,
  action,
}: {
  clientId: string;
  /** The Meta ad account's currency. */
  currency: string;
  measured: VelocityInputs;
  saved: VelocityInputs | null;
  savedBy: string | null;
  savedAt: string | null;
  /** Tooltip for the spend default: the plan month, or the last 30 days. */
  spendSource: string;
  usdRate: number | null;
  /** Ready plus in works, or null without a ClickUp board. */
  queued: number | null;
  action: (clientId: string, input: VelocityInputs) => Promise<SaveResult>;
}) {
  const initial = useMemo(
    () => Object.fromEntries(VELOCITY_INPUT_KEYS.map((k) => [k, toText(k, saved?.[k] ?? null)])) as Record<Key, string>,
    [saved]
  );
  const [text, setText] = useState<Record<Key, string>>(initial);
  const [baseline, setBaseline] = useState<Record<Key, string>>(initial);
  const [stamp, setStamp] = useState(savedLabel(savedBy, savedAt));
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const parsed = Object.fromEntries(VELOCITY_INPUT_KEYS.map((k) => [k, fromText(k, text[k])])) as Record<
    Key,
    number | null | "invalid"
  >;
  const invalid = VELOCITY_INPUT_KEYS.filter((k) => parsed[k] === "invalid");
  const typed: VelocityInputs = { ...EMPTY_VELOCITY_INPUTS };
  for (const k of VELOCITY_INPUT_KEYS) {
    const v = parsed[k];
    typed[k] = v === "invalid" ? null : v;
  }
  const inputs = resolveInputs(typed, measured);
  const ci = toCapacityInputs(inputs);
  const c = capacity(ci);
  const target = spendForTarget(inputs.targetNewAds, ci);
  const tier = tierOf(inputs.monthlySpend !== null && usdRate !== null ? inputs.monthlySpend * usdRate : null);
  const ladder = scenarioLadder(ci);
  const dirty = VELOCITY_INPUT_KEYS.some((k) => text[k].trim() !== baseline[k].trim());

  const m = (v: number | null) => formatMoney(v, currency);

  function save() {
    setError(null);
    startTransition(async () => {
      const result = await action(clientId, typed);
      if (!result.ok) {
        setError(result.error ?? "Not saved.");
        return;
      }
      setBaseline(text);
      setStamp(savedLabel(result.savedBy ?? null, result.savedAt ?? null));
    });
  }

  const fields: Array<{ key: Key; label: string; info: string; shown: string }> = [
    { key: "monthlySpend", label: `Meta spend / month (${currency})`, info: spendSource, shown: m(measured.monthlySpend) },
    {
      key: "newShare",
      label: "New-creative share %",
      info: "Share of spend on ads in their first 14 days, last 30 days.",
      shown: share(measured.newShare),
    },
    { key: "cpa", label: `CPA (${currency})`, info: "Last 90 days, 7d click + 1d view.", shown: formatMoney(measured.cpa, currency, { unit: true }) },
    { key: "verdictN", label: "Purchases to verdict", info: "Settings, read at.", shown: whole(measured.verdictN) },
    { key: "adsPerPack", label: "Ads per pack", info: "Default 4.", shown: whole(measured.adsPerPack) },
    {
      key: "hitRate",
      label: "Hit rate %",
      info: "Winners among launches of the trailing 12 months.",
      shown: share(measured.hitRate),
    },
    { key: "targetNewAds", label: "Target new ads / month", info: "For the spend needed.", shown: NO_VALUE },
  ];

  const outputs: Array<{ label: string; value: string; info?: string; warn?: boolean }> = [
    { label: "Capacity, new ads / mo", value: perMonth(c.capacity), info: "Verdicts a month x ads per pack." },
    { label: "Verdicts / mo", value: perMonth(c.verdicts), info: "New-creative spend / verdict cost." },
    { label: "Window", value: days(c.windowDays), info: "Days until one new pack has been paid N x CPA, at least 7.", warn: c.longWindow },
    { label: "Packs at once", value: whole(c.packsAtOnce), info: "Packs the budget carries side by side at a 7-day window, at least 1." },
    { label: "Winners / mo", value: formatNumber(c.winners, { decimals: 2 }) },
    { label: "Months per winner", value: perMonth(c.monthsPerWinner) },
    { label: "New creative / mo", value: m(c.newCreativeSpend), info: "Spend x new-creative share." },
    { label: "Verdict cost", value: m(c.verdictCost), info: "N x CPA." },
    { label: "New pack / day", value: m(c.daily) },
    {
      label: "Per ad / day",
      value: formatMoney(c.perAdDaily, currency, { unit: true }),
      info: `Floor ${formatMoney(c.perAdFloor, currency, { unit: true })} (0.5x CPA).`,
      warn: c.belowPerAdFloor,
    },
    { label: "Tier", value: tier ?? NO_VALUE, info: "SMALL under 3k, MID 3k to 15k, LARGE over 15k USD a month." },
    { label: "Brief next month", value: whole(briefQuota(c.capacity, queued)), info: "Capacity minus ready and in works in ClickUp." },
  ];

  const reverse: Array<{ label: string; value: string; info?: string }> = [
    { label: "Spend for target", value: m(target), info: "Monthly Meta spend for the target new ads, at this share." },
    {
      label: "New creative for target",
      value: m(target !== null && inputs.newShare !== null ? target * inputs.newShare : null),
    },
    { label: "Spend for a 7-day window", value: m(c.spendFor7Day), info: "Monthly Meta spend at which one pack reaches N purchases in 7 days." },
    { label: "New creative for 7 days", value: m(c.newCreativeFor7Day) },
  ];

  return (
    <div className="flex flex-col gap-6">
      <section className="glass flex flex-col gap-4 px-5 py-4">
        <div className="flex flex-wrap items-start gap-4">
          {fields.map((f) => {
            const bad = parsed[f.key] === "invalid";
            return (
              <label key={f.key} className="flex w-[168px] flex-col gap-1.5">
                <span className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.08em] text-content-muted">
                  <span className="truncate">{f.label}</span>
                  <InfoTip text={f.info} label={`About ${f.label}`} />
                </span>
                <input
                  type="text"
                  inputMode="decimal"
                  value={text[f.key]}
                  placeholder={f.shown}
                  onChange={(e) => setText((t) => ({ ...t, [f.key]: e.target.value }))}
                  aria-invalid={bad}
                  className={`w-full rounded-control border bg-paper px-2.5 py-1.5 text-right font-mono text-[12.5px] ${
                    bad ? "border-negative" : "border-hairline-strong"
                  }`}
                />
                <span className="flex items-baseline justify-between gap-2 font-mono text-[10.5px] text-content-muted">
                  <span className="truncate">Measured {f.shown}</span>
                  {text[f.key].trim() !== "" && (
                    <button
                      type="button"
                      onClick={() => setText((t) => ({ ...t, [f.key]: "" }))}
                      className="shrink-0 underline decoration-dotted underline-offset-2 hover:text-content-strong"
                    >
                      Reset
                    </button>
                  )}
                </span>
              </label>
            );
          })}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={save}
            disabled={pending || invalid.length > 0 || !dirty}
            className="inline-flex items-center justify-center rounded-control border border-content-strong bg-content-strong px-3 py-2 font-mono text-[11px] text-paper transition-colors disabled:opacity-40"
          >
            {pending ? "Saving" : "Save for the team"}
          </button>
          {stamp && <span className="font-mono text-[11px] text-content-muted">{stamp}</span>}
          {invalid.length > 0 && <span className="text-[12px] text-negative-text">Numbers only.</span>}
          {error && <span className="text-[12px] text-negative-text">{error}</span>}
        </div>
      </section>

      {(c.belowPerAdFloor || c.longWindow) && (
        <div className="flex flex-col gap-2">
          {c.longWindow && (
            <p className="m-0 rounded-md border border-warning/30 bg-notice-warning px-4 py-2.5 text-[13px] text-content-body">
              Window over 30 days.
            </p>
          )}
          {c.belowPerAdFloor && (
            <p className="m-0 rounded-md border border-warning/30 bg-notice-warning px-4 py-2.5 text-[13px] text-content-body">
              Each ad gets less than 0.5× CPA a day.
            </p>
          )}
        </div>
      )}

      <section>
        <Head title="What this budget buys" />
        <Figures items={outputs} />
      </section>

      <section>
        <Head title="What a target costs" />
        <Figures items={reverse} />
      </section>

      <section>
        <Head title="Scenarios" info="The same inputs at other monthly spend levels." />
        {ladder.length === 0 ? (
          <p className="m-0 text-[13px] text-content-muted">{NO_VALUE}</p>
        ) : (
          <TableFrame minWidth={820}>
            <thead>
              <tr>
                <Th left>{`Spend / mo (${currency})`}</Th>
                <Th>New creative</Th>
                <Th>Window</Th>
                <Th>Packs at once</Th>
                <Th>Verdicts / mo</Th>
                <Th>New ads / mo</Th>
                <Th>Winners / mo</Th>
                <Th>Mo. / winner</Th>
              </tr>
            </thead>
            <tbody>
              {ladder.map((r) => (
                <tr key={r.spend} className={r.current ? "bg-accent-soft/60" : ""}>
                  <Td left>
                    {m(r.spend)}
                    {r.current && (
                      <span className="ml-2 rounded-xs bg-accent-soft px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.08em] text-growth-700">
                        plan
                      </span>
                    )}
                  </Td>
                  <Td>{m(r.result.newCreativeSpend)}</Td>
                  <Td tone={r.result.longWindow ? "warn" : "default"}>{days(r.result.windowDays)}</Td>
                  <Td>{whole(r.result.packsAtOnce)}</Td>
                  <Td>{perMonth(r.result.verdicts)}</Td>
                  <Td>{perMonth(r.result.capacity)}</Td>
                  <Td>{formatNumber(r.result.winners, { decimals: 2 })}</Td>
                  <Td>{perMonth(r.result.monthsPerWinner)}</Td>
                </tr>
              ))}
            </tbody>
          </TableFrame>
        )}
      </section>
    </div>
  );
}

function Head({ title, info }: { title: string; info?: string }) {
  return (
    <div className="mb-3.5 mt-1 flex flex-wrap items-baseline gap-3.5">
      <h3 className="m-0 text-[16px] font-semibold tracking-heading text-content-strong">{title}</h3>
      {info && <InfoTip text={info} label={`About ${title}`} />}
    </div>
  );
}

/** Figures with labels, four to a row on a wide screen. */
function Figures({ items }: { items: Array<{ label: string; value: string; info?: string; warn?: boolean }> }) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {items.map((t) => (
        <div key={t.label} className="glass px-4 py-3.5">
          <div className="flex items-center gap-1.5 font-mono text-[10.5px] uppercase tracking-eyebrow text-content-muted">
            <span className="truncate">{t.label}</span>
            {t.info && <InfoTip text={t.info} label={`About ${t.label}`} />}
          </div>
          <div
            className={`mt-1 whitespace-nowrap font-mono text-[21px] font-medium tracking-heading tabular ${
              isNoValue(t.value) ? "text-content-muted" : t.warn ? "text-warning" : "text-content-strong"
            }`}
          >
            {t.value}
          </div>
        </div>
      ))}
    </div>
  );
}
