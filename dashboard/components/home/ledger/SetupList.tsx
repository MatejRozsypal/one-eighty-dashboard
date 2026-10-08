/**
 * What is missing to complete the picture, as a checklist.
 *
 * Each item is derived from the data on every load: an item is done when no
 * client is missing the input, and the clients still missing it are listed.
 * This is the honest stand-in for the figures above that read n/a: it says
 * which input turns them into numbers and where it is entered.
 */

import { InfoTip } from "@/components/ui/InfoTip";
import type { SetupItem } from "@/lib/home/ledger/types";

export function StepMark({ done, small = false }: { done: boolean; small?: boolean }) {
  const size = small ? "h-[15px] w-[15px]" : "h-[20px] w-[20px]";
  if (done) {
    return (
      <span
        aria-label="Done"
        className={`inline-flex ${size} shrink-0 items-center justify-center rounded-full`}
        style={{ background: "var(--h-positive)" }}
      >
        <svg viewBox="0 0 12 12" className="h-[60%] w-[60%]" aria-hidden="true">
          <path d="M2.5 6.2 5 8.6 9.6 3.6" fill="none" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
    );
  }
  return (
    <span
      aria-label="Open"
      className={`inline-block ${size} shrink-0 rounded-full border-[1.5px] border-dashed`}
      style={{ borderColor: "var(--h-info)" }}
    />
  );
}

function Row({ s }: { s: SetupItem }) {
  return (
    <li className="flex gap-3.5 border-t border-hairline px-5 py-4 first:border-t-0 sm:px-6">
      <span className="pt-[1px]">
        <StepMark done={s.done} />
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex items-start justify-between gap-3">
          <span
            className={`inline-flex min-w-0 items-center gap-1 text-[14.5px] font-semibold leading-[1.3] ${
              s.done ? "text-content-muted" : "text-content-strong"
            }`}
          >
            <span className="min-w-0">{s.title}</span>
            <InfoTip text={s.tip} label={`About ${s.title}`} />
          </span>
          {s.progress && (
            <span className="shrink-0 rounded-pill bg-[var(--h-neutral-tint)] px-2 py-[1px] text-[12px] font-semibold tabular text-content-body">
              {s.progress}
            </span>
          )}
        </div>
        <span className="text-[12.5px] leading-[1.4] text-content-muted">
          {s.href ? (
            <a href={s.href} target="_blank" rel="noreferrer" className="text-[var(--h-info-text)] hover:underline">
              {s.where}
            </a>
          ) : (
            s.where
          )}
          <span> · Unlocks {/^[A-Z][a-z]/.test(s.unlocks) ? s.unlocks.charAt(0).toLowerCase() + s.unlocks.slice(1) : s.unlocks}</span>
        </span>
        {!s.done && s.clients.length > 0 && (
          <ul className="m-0 mt-1 flex list-none flex-wrap gap-1.5 p-0" aria-label="Clients missing this">
            {s.clients.map((c) => (
              <li
                key={c}
                className="rounded-pill border border-hairline px-2.5 py-[2px] text-[12px] font-medium text-content-body"
              >
                {c}
              </li>
            ))}
          </ul>
        )}
      </div>
    </li>
  );
}

export function SetupList({ items }: { items: SetupItem[] }) {
  const done = items.filter((i) => i.done).length;
  const share = items.length ? (done / items.length) * 100 : 0;
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <div className="h-[6px] flex-1 overflow-hidden rounded-pill bg-[var(--h-neutral-tint)]" aria-hidden="true">
          <div className="h-full rounded-pill" style={{ width: `${share}%`, background: "var(--h-positive)" }} />
        </div>
        <span className="shrink-0 text-[13px] font-semibold tabular text-content-muted">
          {done} of {items.length} done
        </span>
      </div>
      <ol className="m-0 list-none overflow-hidden rounded-card border border-hairline bg-surface-card p-0 shadow-sm">
        {items.map((s) => (
          <Row key={s.id} s={s} />
        ))}
      </ol>
    </div>
  );
}
