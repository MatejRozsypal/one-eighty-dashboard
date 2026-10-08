"use client";

/**
 * The compact client table under the list: status, the month's goal ring,
 * revenue month to date, CM3 against plan, and how many items are open for
 * the client today. The ring and its colour are the Goals pacing row, exactly
 * as Goals draws it; a client with no plan gets no ring.
 */

import { GoalRing } from "@/components/plan/GoalRing";
import { InfoTip } from "@/components/ui/InfoTip";
import { NO_VALUE } from "@/lib/format";
import { planStatusLabel, toneOfRow, toneVars } from "@/lib/plan/health";
import { fmtPace, fmtValue } from "@/lib/plan/format";
import type { ClientLine } from "@/lib/home/today/types";

const STATUS_TONE: Record<string, string> = {
  steady: "var(--h-positive)",
  active: "var(--h-positive)",
  onboarding: "var(--h-info)",
  paused: "var(--h-warning)",
  churned: "var(--h-neutral)",
};

function capitalise(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function NA({ note, label }: { note: string | null; label: string }) {
  return (
    <span className="inline-flex items-center gap-1 text-content-muted">
      {NO_VALUE}
      {note && <InfoTip text={note} label={`Why ${label} is n/a`} />}
    </span>
  );
}

const COLS = "sm:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.3fr)_64px]";

export function ClientTable({
  clients,
  note,
  openByClient,
  onPick,
}: {
  clients: ClientLine[];
  note: string | null;
  openByClient: Record<string, number>;
  onPick: (clientId: string) => void;
}) {
  if (clients.length === 0) {
    return (
      <div className="rounded-card border border-hairline bg-surface-card px-5 py-4 text-[13px] text-content-muted shadow-sm">
        <NA note={note} label="Clients" />
      </div>
    );
  }
  return (
    <div className="overflow-hidden rounded-card border border-hairline bg-surface-card shadow-sm" role="table" aria-label="Clients">
      <div
        role="row"
        className={`hidden border-b border-hairline px-5 py-2.5 text-[12px] font-semibold uppercase tracking-[0.06em] text-content-muted sm:grid sm:gap-4 ${COLS}`}
      >
        <span role="columnheader">Client</span>
        <span role="columnheader">Plan</span>
        <span role="columnheader" className="text-right">
          Revenue MTD
        </span>
        <span role="columnheader" className="text-right">
          CM3 vs plan
        </span>
        <span role="columnheader" className="text-right">
          Open
        </span>
      </div>
      <ul className="m-0 list-none p-0">
        {clients.map((c) => {
          const cur = c.currency;
          const open = c.clientId ? openByClient[c.clientId] ?? 0 : 0;
          const focusTone = c.focus ? toneOfRow(c.focus) : "neutral";
          const statusColour = (c.status && STATUS_TONE[c.status]) || "var(--h-neutral)";
          return (
            <li
              key={c.key}
              role="row"
              className={`grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1.5 border-t border-hairline px-4 py-3 first:border-t-0 sm:px-5 ${COLS} sm:grid`}
            >
              <span role="cell" className="flex min-w-0 items-center gap-2.5">
                <span className="flex min-w-0 flex-col">
                  <span className="truncate text-[15px] font-semibold text-content-strong">{c.name}</span>
                  <span className="inline-flex items-center gap-1.5 text-[12.5px] text-content-muted">
                    <span aria-hidden="true" className="h-[7px] w-[7px] rounded-full" style={{ background: statusColour }} />
                    {c.status ? capitalise(c.status) : NO_VALUE}
                  </span>
                </span>
              </span>

              <span role="cell" className="flex items-center justify-end gap-2 sm:justify-start">
                {c.focus ? (
                  <>
                    <GoalRing row={c.focus} periodType="month" tone={focusTone} size={30} />
                    <span className="flex flex-col text-[12.5px] leading-[1.25]">
                      <span className="font-semibold" style={{ color: toneVars(focusTone).text }}>
                        {planStatusLabel(c.focus)}
                      </span>
                      <span className="text-content-muted">{c.focus.metric === "cm3" ? "CM3" : "Revenue"}</span>
                    </span>
                  </>
                ) : (
                  <span className="text-[12.5px] text-content-muted">No plan</span>
                )}
              </span>

              <span role="cell" className="flex items-baseline gap-1.5 text-[14px] tabular text-content-strong sm:justify-end">
                <span className="text-[12px] text-content-muted sm:hidden">Revenue</span>
                {c.revenueMtd === null || !cur ? (
                  <NA note={c.revenueNote} label="Revenue" />
                ) : (
                  fmtValue(c.revenueMtd, "revenue", cur)
                )}
              </span>

              <span role="cell" className="flex flex-wrap items-baseline justify-end gap-x-1.5 text-[14px] tabular text-content-strong">
                <span className="text-[12px] text-content-muted sm:hidden">CM3</span>
                {c.cm3Mtd === null || !cur ? (
                  <NA note={c.cm3Note} label="CM3" />
                ) : (
                  <>
                    {fmtValue(c.cm3Mtd, "cm3", cur)}
                    {c.cm3Row ? (
                      <span className="text-[12.5px] font-semibold" style={{ color: toneVars(toneOfRow(c.cm3Row)).text }}>
                        {fmtPace(c.cm3Row.pacePct)}
                      </span>
                    ) : (
                      <span className="text-[12.5px] text-content-muted">no target</span>
                    )}
                  </>
                )}
              </span>

              <span role="cell" className="col-span-2 flex justify-end sm:col-span-1">
                {c.clientId && open > 0 ? (
                  <button
                    type="button"
                    onClick={() => onPick(c.clientId as string)}
                    className="inline-flex h-7 items-center gap-1 rounded-pill bg-[var(--gray-100)] px-2.5 text-[12.5px] font-semibold tabular text-content-strong hover:bg-[var(--gray-150)]"
                    aria-label={`${open} open for ${c.name}, show them`}
                  >
                    {open}
                  </button>
                ) : (
                  <span className="text-[12.5px] text-content-muted">{c.clientId ? "Clear" : ""}</span>
                )}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
