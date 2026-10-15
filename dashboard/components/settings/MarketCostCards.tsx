"use client";

/**
 * Market costs on the Settings screen: one cost card per sold market of the
 * client, plus Other for every country pooled into it.
 *
 * Each card is its own form, so saving one market never touches another. The
 * fields validate as they are typed (the server action repeats the check);
 * empty is allowed and means "not stated", which the Markets page shows as
 * n/a on the lines that need it.
 *
 * ── History ─────────────────────────────────────────────────────────────────
 * The date says from when the costs apply. It opens on the current card's
 * date, so a plain edit corrects that card. A rate change is a new date: the
 * old card stays and keeps costing the days before it.
 */

import { useState } from "react";
import { SaveButton } from "@/components/settings/SaveButton";
import { InfoTip } from "@/components/ui/InfoTip";
import { Badge } from "@/components/ui/Badge";
import { NO_VALUE } from "@/lib/format";
import { countryName } from "@/lib/markets/display";
import type { CostCard } from "@/lib/markets/types";
import {
  cardToValues,
  checkCostCard,
  COST_FIELDS,
  type CostCardMarketRow,
  type CostField,
} from "@/lib/markets/costCardForm";

const FIELD =
  "w-[120px] rounded-control border border-hairline-strong bg-paper px-2.5 py-1.5 text-right font-mono text-[12.5px] disabled:opacity-60";
const FIELD_BAD = "border-negative";


function marketName(m: string): string {
  return m === "OTHER" ? "Other countries" : `${countryName(m)} (${m})`;
}

function money(v: number | null, pct = false): string {
  if (v === null) return NO_VALUE;
  return pct ? `${+(v * 100).toFixed(2)}%` : String(v);
}

function MarketCard({
  clientId,
  currency,
  market,
  isHome,
  cards,
  today,
  readOnly,
  action,
}: {
  clientId: string;
  currency: string;
  market: string;
  isHome: boolean;
  /** This market's cards, oldest first. */
  cards: CostCard[];
  today: string;
  readOnly: boolean;
  action: (formData: FormData) => Promise<void>;
}) {
  // The card in effect today, else the latest scheduled one.
  const current = [...cards].reverse().find((c) => c.effectiveFrom <= today) ?? cards[cards.length - 1] ?? null;
  const [values, setValues] = useState<Record<CostField, string>>(cardToValues(current));
  const [from, setFrom] = useState(current?.effectiveFrom ?? today);
  const [touched, setTouched] = useState(false);
  const checked = checkCostCard({ effectiveFrom: from, values });
  const show = (k: CostField | "effectiveFrom") => (touched ? checked.errors[k] : undefined);
  const id = `mc-${market}`;

  return (
    <form
      action={action}
      className="flex flex-col gap-3 rounded-card border border-hairline p-4"
      aria-labelledby={`${id}-title`}
    >
      <input type="hidden" name="clientId" value={clientId} />
      <input type="hidden" name="market" value={market} />
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 id={`${id}-title`} className="m-0 flex items-center gap-2 text-[14px] font-semibold text-content-strong">
          {marketName(market)}
          {isHome && (
            <Badge variant="outline" size="sm">
              home
            </Badge>
          )}
        </h3>
        <span className="font-mono text-[10.5px] text-content-muted">
          {current ? `From ${current.effectiveFrom}` : "No card: CM2 and CM3 show n/a"}
        </span>
      </div>

      <div className="flex flex-wrap items-start gap-3">
        <label className="flex flex-col gap-1.5">
          <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-content-muted">
            Effective from{" "}
            <InfoTip
              text="The costs apply from this day until the next card. Keep the date to correct this card; a new date records a rate change and keeps the old card for earlier days."
              label="About Effective from"
            />
          </span>
          <input
            name="effectiveFrom"
            type="date"
            value={from}
            disabled={readOnly}
            onChange={(e) => {
              setTouched(true);
              setFrom(e.target.value);
            }}
            aria-invalid={!!show("effectiveFrom")}
            aria-describedby={show("effectiveFrom") ? `${id}-effectiveFrom-err` : undefined}
            className={`${FIELD} w-[150px] text-left ${show("effectiveFrom") ? FIELD_BAD : ""}`}
          />
          {show("effectiveFrom") && (
            <span id={`${id}-effectiveFrom-err`} className="text-[11px] text-negative-text">
              {show("effectiveFrom")}
            </span>
          )}
        </label>
        {COST_FIELDS.map((f) => {
          const err = show(f.key);
          const label = f.label(currency);
          return (
            <label key={f.key} className="flex max-w-[180px] flex-col gap-1.5">
              <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-content-muted">
                {label} <InfoTip text={f.hint} label={`About ${label}`} />
              </span>
              <input
                name={f.key}
                type="text"
                inputMode="decimal"
                placeholder={NO_VALUE}
                value={values[f.key]}
                disabled={readOnly}
                onChange={(e) => {
                  setTouched(true);
                  setValues((v) => ({ ...v, [f.key]: e.target.value }));
                }}
                aria-invalid={!!err}
                aria-describedby={err ? `${id}-${f.key}-err` : undefined}
                className={`${FIELD} ${err ? FIELD_BAD : ""}`}
              />
              {err && (
                <span id={`${id}-${f.key}-err`} className="text-[11px] text-negative-text">
                  {err}
                </span>
              )}
            </label>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        {!readOnly && <SaveButton disabled={!checked.card} />}
        {touched && checked.errors.card && <span className="text-[11.5px] text-negative-text">{checked.errors.card}</span>}
        {current?.updatedAt && (
          <span className="font-mono text-[10.5px] text-content-muted">
            {current.updatedAt.slice(0, 10)} · {current.updatedBy}
          </span>
        )}
      </div>

      {cards.length > 1 && (
        <details className="text-[11.5px] text-content-body">
          <summary className="cursor-pointer font-mono text-[10.5px] uppercase tracking-[0.08em] text-content-muted">
            History, {cards.length} cards
          </summary>
          <ul className="m-0 mt-2 flex list-none flex-col gap-1 p-0 font-mono text-[11px] tabular">
            {[...cards].reverse().map((c) => (
              <li key={c.effectiveFrom}>
                from {c.effectiveFrom} · ship {money(c.shipCostPerOrder)} · fee {money(c.payFeePct, true)} · COD{" "}
                {money(c.codFee)} · return {money(c.returnCost)} · fixed {money(c.fixedMonthly)}
              </li>
            ))}
          </ul>
        </details>
      )}
    </form>
  );
}

export function MarketCostCards({
  clientId,
  currency,
  markets,
  cards,
  today,
  readOnly = false,
  action,
}: {
  clientId: string;
  /** The client's base currency: every amount is compared with base-currency revenue. */
  currency: string;
  markets: CostCardMarketRow[];
  cards: CostCard[];
  /** YYYY-MM-DD, from the server, so the default date does not depend on the browser. */
  today: string;
  readOnly?: boolean;
  action: (formData: FormData) => Promise<void>;
}) {
  return (
    <div className="flex flex-col gap-3">
      {markets.map((m) => (
        <MarketCard
          key={m.market}
          clientId={clientId}
          currency={currency}
          market={m.market}
          isHome={m.isHome}
          cards={cards.filter((c) => c.market === m.market).sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom))}
          today={today}
          readOnly={readOnly}
          action={action}
        />
      ))}
    </div>
  );
}
