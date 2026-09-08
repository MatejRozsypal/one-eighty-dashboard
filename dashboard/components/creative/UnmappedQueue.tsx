"use client";

/**
 * The Unmapped ads queue.
 *
 * ── What this actually is ──────────────────────────────────────────────────
 * The join between a Meta ad and the concept that produced it is the ad_id
 * written into the ClickUp task's `Creative ID` field. That field has never
 * been filled once — it holds the literal string "Creative ID" on all 65 Manami
 * tasks. Every tag breakdown in this product is blind to any ad missing from
 * it.
 *
 * So this is not an admin screen. It is the mechanism by which the product
 * becomes able to answer its own question, and it is ordered by spend because
 * mapping the ad holding a third of the budget changes more than mapping the
 * other sixty combined.
 *
 * ── Nothing is applied automatically ───────────────────────────────────────
 * A proposal above 70% offers a one-click Confirm; anything below makes you
 * pick. Neither writes without a press. A wrong match does not look wrong
 * afterwards — it attributes real spend to the wrong persona, and the number it
 * produces is entirely plausible.
 */

import { useState, useTransition } from "react";
import { confirmMapping } from "@/app/(app)/creative/actions";
import type { Candidate } from "@/lib/creative/matching";
import type { QueueRow } from "@/lib/creative/view";
import { money } from "@/components/creative/primitives";

export function UnmappedQueue({
  rows,
  candidates,
  clientId,
  currency,
  confirmThreshold,
}: {
  rows: QueueRow[];
  candidates: Candidate[];
  clientId: string;
  currency: string;
  confirmThreshold: number;
}) {
  const [done, setDone] = useState<Record<string, string>>({});
  const [failed, setFailed] = useState<Record<string, string>>({});
  const [pending, start] = useTransition();
  const [picking, setPicking] = useState<string | null>(null);

  const act = (adId: string, taskId: string, method: string, confidence: number | null) => {
    start(async () => {
      const result = await confirmMapping({ clientId, adId, taskId, method, confidence });
      if (result.ok) {
        setDone((d) => ({ ...d, [adId]: result.message }));
        setFailed((f) => {
          const next = { ...f };
          delete next[adId];
          return next;
        });
        setPicking(null);
      } else {
        setFailed((f) => ({ ...f, [adId]: result.message }));
      }
    });
  };

  const outstanding = rows.filter((r) => !done[r.adId]);

  return (
    <section className="glass mt-8 overflow-hidden border-warning/30">
      <header className="flex flex-wrap items-baseline gap-3 border-b border-hairline bg-warning/10 px-5 py-3.5">
        <h3 className="m-0 text-[14px] font-bold tracking-heading text-warning">
          Unmapped ads
        </h3>
        <p className="m-0 min-w-[230px] flex-1 text-[12.5px] text-content-muted">
          No ClickUp task carries these ad ids, so their spend is invisible to
          every tag breakdown. Confirm and the dashboard writes the id into the
          task&apos;s <span className="font-mono">Creative ID</span> field
          itself.
        </p>
        <span className="font-mono text-[11.5px] text-content-muted">
          {outstanding.length} outstanding
        </span>
      </header>

      <ul className="m-0 list-none p-0">
        {rows.map((row) => (
          <li
            key={row.adId}
            className="flex flex-wrap items-center gap-3.5 border-b border-hairline px-5 py-3 last:border-b-0"
          >
            <div className="min-w-[200px] flex-1">
              <div className="break-all font-mono text-[12px] text-content-strong">
                {row.adName}
              </div>
              <div className="mt-0.5 font-mono text-[11px] text-content-muted">
                {money(row.spend, currency)} · {row.purchases}{" "}
                {row.purchases === 1 ? "purchase" : "purchases"}
              </div>
            </div>

            {done[row.adId] ? (
              <span className="text-[12.5px] text-positive">{done[row.adId]}</span>
            ) : (
              <>
                <div className="min-w-[220px] flex-1 text-[12.5px] text-content-muted">
                  {row.proposal ? (
                    <>
                      Best guess{" "}
                      <b className="font-medium text-content-body">
                        {row.proposal.taskName}
                      </b>{" "}
                      · {Math.round(row.proposal.confidence * 100)}%
                      {row.proposal.reasons.length > 0 && (
                        <span className="block text-[11.5px] text-content-muted">
                          {row.proposal.reasons.slice(0, 2).join(" · ")}
                        </span>
                      )}
                    </>
                  ) : (
                    <span>
                      No task name resembles this one — it may predate the
                      Persona Bank.
                    </span>
                  )}
                </div>

                <div className="flex items-center gap-2">
                  {row.proposal && row.proposal.confidence >= confirmThreshold && (
                    <button
                      disabled={pending}
                      onClick={() =>
                        act(
                          row.adId,
                          row.proposal!.taskId,
                          row.proposal!.method,
                          row.proposal!.confidence
                        )
                      }
                      className="rounded-control bg-content-strong px-3 py-1.5 text-[12.5px] font-medium text-paper transition-transform duration-fast hover:-translate-y-px disabled:opacity-50"
                    >
                      Confirm
                    </button>
                  )}
                  <button
                    disabled={pending}
                    onClick={() =>
                      setPicking(picking === row.adId ? null : row.adId)
                    }
                    className="rounded-control border border-hairline-strong px-3 py-1.5 text-[12.5px] font-medium text-content-muted transition-colors duration-fast hover:bg-gray-100 disabled:opacity-50"
                  >
                    Pick task
                  </button>
                </div>

                {failed[row.adId] && (
                  <p className="m-0 w-full text-[12.5px] text-negative">
                    {failed[row.adId]}
                  </p>
                )}

                {picking === row.adId && (
                  <div className="w-full">
                    <label className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-[10.5px] uppercase tracking-eyebrow text-content-muted">
                        Task
                      </span>
                      <select
                        defaultValue=""
                        disabled={pending}
                        onChange={(e) => {
                          if (e.target.value) {
                            // A hand-picked task is `manual` at full
                            // confidence: a person looked at both and said
                            // yes, which is a stronger claim than any string
                            // similarity score.
                            act(row.adId, e.target.value, "manual", 1);
                          }
                        }}
                        className="min-w-[280px] flex-1 rounded-control border border-hairline-strong bg-paper/70 px-2.5 py-1.5 text-[13px]"
                      >
                        <option value="">Choose a ClickUp task…</option>
                        {candidates.map((c) => (
                          <option key={c.taskId} value={c.taskId}>
                            {c.taskName}
                            {c.conceptId ? ` — ${c.conceptId}` : ""}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                )}
              </>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
