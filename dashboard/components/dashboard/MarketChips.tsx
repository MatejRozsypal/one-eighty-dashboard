"use client";

/**
 * Market toggles for the cohort grid.
 *
 * Multi-select, written to one repeated search param so the view stays a
 * shareable link like every other control here. No selection means all markets
 *, an empty filter and "everything" are the same view, and forcing a user to
 * re-tick every box to get back to the default is a trap.
 *
 * The label says which dimension this actually is. On Shopify it is the
 * shipping country of the first order; on Shoptet there is no address in the
 * data at all, so it is the currency the customer transacted in. Calling both
 * "market" without saying which would quietly imply every client has country data.
 *
 * ── Answers on the click ───────────────────────────────────────────────────
 * The selection moves when the chip is clicked, not when the server answers
 * (QA N-05: the chip stayed on "All" for the whole 3 to 20 s round trip, so
 * people clicked again). `active` comes from the URL and can be seconds away;
 * until it catches up the click is held locally, exactly as `SegmentedControl`
 * does. `isPending` is the shared navigation signal, true until the new server
 * output is committed, so authority goes back to the server at that moment.
 */

import { useEffect, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { useNavigation } from "@/components/shell/NavigationPending";
import { formatNumber } from "@/lib/format";
import type { MarketOption } from "@/lib/queries/cohortGrid";

const COUNTRY = new Intl.DisplayNames(["en"], { type: "region" });

function label(code: string, kind: "country" | "currency"): string {
  if (kind === "currency") return code;
  if (code === "Unknown") return "No country";
  try {
    return COUNTRY.of(code) ?? code;
  } catch {
    return code;
  }
}

export function MarketChips({
  markets,
  kind,
  active,
}: {
  markets: MarketOption[];
  kind: "country" | "currency";
  active: string[];
}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { isPending, navigate } = useNavigation();
  const [optimistic, setOptimistic] = useState<string[] | null>(null);

  useEffect(() => {
    if (!isPending) setOptimistic(null);
  }, [isPending]);

  const selected = optimistic ?? active;

  function toggle(code: string) {
    const set = new Set(selected);
    if (set.has(code)) set.delete(code);
    else set.add(code);
    const nextSelected = [...set];
    setOptimistic(nextSelected);

    const next = new URLSearchParams(searchParams.toString());
    next.delete("market");
    for (const m of nextSelected) next.append("market", m);
    navigate(`${pathname}?${next.toString()}`);
  }

  function clear() {
    if (selected.length === 0) return;
    setOptimistic([]);
    const next = new URLSearchParams(searchParams.toString());
    next.delete("market");
    navigate(`${pathname}?${next.toString()}`);
  }

  // A long tail of one-customer markets would bury the two that matter.
  const shown = markets.filter((m) => m.customers >= 10);
  const hidden = markets.length - shown.length;

  return (
    <div className={`flex flex-col gap-2 ${isPending ? "oe-pulse" : ""}`}>
      <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-content-muted">
        {kind === "country" ? "First-order country" : "First-order currency"}
      </span>

      <div className="flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          onClick={clear}
          aria-pressed={selected.length === 0}
          className={`rounded-pill px-2.5 py-1.5 font-mono text-[11px] transition-colors duration-fast ${
            selected.length === 0
              ? "bg-ink-900 text-content-inverse"
              : "border border-hairline-strong text-content-body hover:bg-gray-50"
          }`}
        >
          All
        </button>

        {shown.map((m) => {
          const on = selected.includes(m.code);
          return (
            <button
              key={m.code}
              type="button"
              onClick={() => toggle(m.code)}
              aria-pressed={on}
              className={`inline-flex items-center gap-1.5 rounded-pill px-2.5 py-1.5 font-mono text-[11px] transition-colors duration-fast ${
                on
                  ? "bg-ink-900 text-content-inverse"
                  : "border border-hairline-strong text-content-body hover:bg-gray-50"
              }`}
            >
              {label(m.code, kind)}
              <span className={on ? "text-gray-300" : "text-content-muted"}>
                {formatNumber(m.customers)}
              </span>
            </button>
          );
        })}

        {hidden > 0 && (
          <span
            className="font-mono text-[11px] text-content-muted"
            title="Under 10 customers: grouped in All"
          >
            +{hidden} small
          </span>
        )}
      </div>
    </div>
  );
}
