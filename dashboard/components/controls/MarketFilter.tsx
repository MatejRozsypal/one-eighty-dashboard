"use client";

/**
 * Market filter for the cohort grid: a control-bar pill ("All countries",
 * "Czechia +1") over a list of markets.
 *
 * Multi-select, written to one repeated search param so the view stays a
 * shareable link like every other control here. No selection means all
 * markets: an empty filter and "everything" are the same view, and forcing a
 * user to re-tick every box to get back to the default is a trap. Each row
 * applies on click and the list stays open, so several markets take several
 * clicks, not several trips through the pill.
 *
 * The pill and the list say which dimension this actually is. On Shopify it is
 * the shipping country of the first order; on Shoptet there is no address in
 * the data at all, so it is the currency the customer transacted in. Calling
 * both "market" without saying which would quietly imply every client has
 * country data.
 */

import { usePathname, useSearchParams } from "next/navigation";
import { useNavigation } from "@/components/shell/NavigationPending";
import { MarketIcon, MenuRow, Pill, Popover, usePopover } from "@/components/controls/Pill";
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

export function MarketFilter({
  markets,
  kind,
  active,
}: {
  markets: MarketOption[];
  kind: "country" | "currency";
  active: string[];
}) {
  const { open, setOpen, wrapRef } = usePopover();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { isPending, navigate, baseQuery } = useNavigation();

  // Toggles merge onto the URL a still-loading change is heading to, and the
  // selection is read from that URL too: `active` comes from the server and
  // two quick toggles would otherwise both start from the same old set.
  function toggle(code: string) {
    const committed = searchParams.toString();
    const base = baseQuery(pathname, committed);
    const next = new URLSearchParams(base);
    const set = new Set(base === committed ? active : next.getAll("market"));
    if (set.has(code)) set.delete(code);
    else set.add(code);

    next.delete("market");
    for (const m of set) next.append("market", m);
    navigate(`${pathname}?${next.toString()}`);
  }

  function clear() {
    const next = new URLSearchParams(baseQuery(pathname, searchParams.toString()));
    next.delete("market");
    navigate(`${pathname}?${next.toString()}`);
  }

  // A long tail of one-customer markets would bury the two that matter.
  const shown = markets.filter((m) => m.customers >= 10);
  const hidden = markets.length - shown.length;

  const selected = active;
  const pillLabel =
    selected.length === 0
      ? kind === "country"
        ? "All countries"
        : "All currencies"
      : selected.length === 1
        ? label(selected[0], kind)
        : `${label(selected[0], kind)} +${selected.length - 1}`;

  return (
    <div ref={wrapRef} className="relative">
      <Pill
        icon={<MarketIcon />}
        label={pillLabel}
        open={open}
        onClick={() => setOpen((v) => !v)}
        pending={isPending}
        title={kind === "country" ? "First-order country" : "First-order currency"}
      />
      {open && (
        <Popover
          label={kind === "country" ? "First-order country" : "First-order currency"}
          onClose={() => setOpen(false)}
          className="sm:w-[280px]"
        >
          <div role="menu" className="flex max-h-[60dvh] flex-col gap-0.5 overflow-y-auto p-2">
            <MenuRow selected={selected.length === 0} onClick={clear}>
              All
            </MenuRow>
            {shown.map((m) => (
              <MenuRow key={m.code} selected={selected.includes(m.code)} onClick={() => toggle(m.code)}>
                <span className="min-w-0 truncate">{label(m.code, kind)}</span>
                <span className="font-mono text-[11.5px] font-normal tabular text-content-muted">
                  {formatNumber(m.customers)}
                </span>
              </MenuRow>
            ))}
            {hidden > 0 && (
              <span
                className="px-3 py-2 font-mono text-[11px] text-content-muted"
                title="Under 10 customers: grouped in All"
              >
                +{hidden} small
              </span>
            )}
          </div>
        </Popover>
      )}
    </div>
  );
}
