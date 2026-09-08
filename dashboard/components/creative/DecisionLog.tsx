"use client";

/**
 * The Monday review, and the record of it.
 *
 * ── Why this is at ad-set level and not on the concept cards ───────────────
 * Money verdicts are taken at ad-set level: that is where the budget lives,
 * where the no-touch window applies, and where Meta's learning phase is a real
 * thing. It is also the level the SOP names. The concept cards deliberately
 * carry no buttons — a card that offers "Scale" and "Kill" one click apart
 * turns a weekly review into a clicking exercise, and no budget in Ads Manager
 * changes because somebody clicked something here.
 *
 * ── What this actually records ─────────────────────────────────────────────
 * What the engine said, what the human did, and — when the two differ — why.
 * `overridden` is derived from the two values rather than being a checkbox,
 * because it is a fact about them and not an opinion.
 *
 * A kill without a learning note is refused BY POSTGRES. The form asks for one,
 * but the form is not the rule: a CHECK constraint is, so no future code path,
 * script, or second kill button can get round it. The message below is a
 * translation of the database's refusal, never a substitute for it.
 */

import { useState, useTransition } from "react";
import { logDecision } from "@/app/(app)/creative/actions";
import { VerdictChip, money, roas } from "@/components/creative/primitives";
import type { VerdictCode } from "@/lib/creative/verdict";

export interface ReviewRow {
  adsetId: string;
  adsetName: string;
  campaignName: string | null;
  spend: number;
  purchases: number;
  roas: number | null;
  ciLow: number | null;
  ciHigh: number | null;
  ageDays: number | null;
  verdictCode: string;
  verdictLabel: string;
  verdictSay: string;
  undecided: boolean;
}

export interface LoggedDecision {
  id: number;
  entityName: string | null;
  computedVerdict: string;
  finalVerdict: string;
  overridden: boolean;
  learningNote: string | null;
  decidedBy: string;
  decidedAt: string;
}

/** What a human may record. Ordered by how often it is the answer. */
const CHOICES = [
  ["hold", "Hold"],
  ["scale", "Scale"],
  ["aggressive-scale", "Scale hard"],
  ["iterate", "Iterate"],
  ["kill", "Kill"],
  ["no-touch", "No decision"],
] as const;

export function DecisionLog({
  rows,
  recent,
  clientId,
  currency,
}: {
  rows: ReviewRow[];
  recent: LoggedDecision[];
  clientId: string;
  currency: string;
}) {
  return (
    <div className="flex flex-col gap-3">
      {rows.map((row) => (
        <ReviewItem key={row.adsetId} row={row} clientId={clientId} currency={currency} />
      ))}

      {recent.length > 0 && (
        <details className="glass mt-2 p-4">
          <summary className="cursor-pointer font-mono text-[11px] uppercase tracking-eyebrow text-content-muted">
            {recent.length} recorded {recent.length === 1 ? "decision" : "decisions"}
          </summary>
          <ul className="m-0 mt-3 flex list-none flex-col gap-2.5 p-0">
            {recent.map((d) => (
              <li key={d.id} className="border-b border-hairline pb-2.5 last:border-b-0">
                <div className="flex flex-wrap items-baseline gap-2 text-[12.5px]">
                  <span className="font-medium text-content-strong">{d.entityName}</span>
                  <span className="font-mono text-[11px] uppercase text-content-muted">
                    {d.finalVerdict}
                  </span>
                  {d.overridden && (
                    <span className="rounded-xs bg-warning/10 px-1.5 py-px font-mono text-[10px] uppercase tracking-[0.08em] text-warning">
                      overrode {d.computedVerdict}
                    </span>
                  )}
                  <span className="ml-auto font-mono text-[11px] text-content-muted">
                    {d.decidedAt.slice(0, 10)} · {d.decidedBy}
                  </span>
                </div>
                {d.learningNote && (
                  <p className="m-0 mt-1 text-[12.5px] leading-[1.55] text-content-muted">
                    {d.learningNote}
                  </p>
                )}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

function ReviewItem({
  row,
  clientId,
  currency,
}: {
  row: ReviewRow;
  clientId: string;
  currency: string;
}) {
  const [final, setFinal] = useState<string>(row.undecided ? "no-touch" : row.verdictCode);
  const [note, setNote] = useState("");
  const [reason, setReason] = useState("");
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [pending, start] = useTransition();

  const overriding = final !== row.verdictCode;
  const killing = final === "kill";

  return (
    <div className="glass flex flex-col gap-3 p-4">
      <div className="flex flex-wrap items-baseline gap-3">
        <span className="text-[14px] font-semibold tracking-heading text-content-strong">
          {row.adsetName}
        </span>
        {row.campaignName && (
          <span className="text-[12px] text-content-muted">{row.campaignName}</span>
        )}
        <span className="ml-auto flex flex-wrap items-center gap-3 font-mono text-[12px] tabular text-content-muted">
          <span>{money(row.spend, currency)}</span>
          <span>{row.purchases} purchases</span>
          <span className="text-content-strong">ROAS {roas(row.roas)}</span>
          {row.ciLow !== null && row.ciHigh !== null && (
            <span>
              {roas(row.ciLow)}–{roas(row.ciHigh)}
            </span>
          )}
          {row.ageDays !== null && <span>{row.ageDays}d</span>}
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <VerdictChip code={row.verdictCode as VerdictCode} label={row.verdictLabel} />
        <span className="min-w-[240px] flex-1 text-[12.5px] leading-[1.5] text-content-muted">
          {row.verdictSay}
        </span>
      </div>

      {result?.ok ? (
        <p className="m-0 text-[12.5px] text-positive">{result.message}</p>
      ) : (
        <div className="flex flex-col gap-2.5">
          <div className="flex flex-wrap items-center gap-2.5">
            <label className="flex items-center gap-2">
              <span className="font-mono text-[10px] uppercase tracking-eyebrow text-content-muted">
                What you did
              </span>
              <select
                value={final}
                onChange={(e) => setFinal(e.target.value)}
                className="rounded-control border border-hairline-strong bg-paper px-2.5 py-1.5 text-[13px]"
              >
                {CHOICES.map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </select>
            </label>

            <button
              disabled={pending}
              onClick={() =>
                start(async () => {
                  const r = await logDecision({
                    clientId,
                    level: "adset",
                    entityId: row.adsetId,
                    entityName: row.adsetName,
                    computedVerdict: row.verdictCode,
                    finalVerdict: final,
                    overrideReason: overriding ? reason || null : null,
                    learningNote: note || null,
                    spend: row.spend,
                    purchases: row.purchases,
                    roas: row.roas,
                    ciLow: row.ciLow,
                    ciHigh: row.ciHigh,
                  });
                  setResult(r);
                })
              }
              className="rounded-control bg-content-strong px-3 py-1.5 text-[12.5px] font-medium text-paper transition-transform duration-fast hover:-translate-y-px disabled:opacity-50"
            >
              Record
            </button>

            {overriding && (
              <span className="font-mono text-[10.5px] uppercase tracking-eyebrow text-warning">
                overriding {row.verdictLabel}
              </span>
            )}
          </div>

          {killing && (
            <label className="flex flex-col gap-1.5">
              <span className="font-mono text-[10px] uppercase tracking-eyebrow text-content-muted">
                Learning note — required
              </span>
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                rows={2}
                placeholder="Angle tested, persona, offer, spend, ROAS. What the next brief should do differently."
                className="w-full rounded-control border border-hairline-strong bg-paper px-2.5 py-2 text-[13px]"
              />
              {/* The SOP's words, because the constraint is the SOP's rule. */}
              <span className="text-[11.5px] text-content-muted">
                A kill without a documented learning is invalid. The database
                rejects one, not just this form.
              </span>
            </label>
          )}

          {overriding && (
            <label className="flex flex-col gap-1.5">
              <span className="font-mono text-[10px] uppercase tracking-eyebrow text-content-muted">
                Why you overrode it — required
              </span>
              <input
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="What you knew that the numbers did not."
                className="w-full rounded-control border border-hairline-strong bg-paper px-2.5 py-2 text-[13px]"
              />
            </label>
          )}

          {result && !result.ok && (
            <p className="m-0 text-[12.5px] text-negative">{result.message}</p>
          )}
        </div>
      )}
    </div>
  );
}
