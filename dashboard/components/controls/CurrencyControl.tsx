"use client";

/**
 * The currency pill: the shop's own currency, or the rollup currency it is
 * converted into. A locked option keeps its row and says why on hover, the
 * same rule as `SegmentPills`: a control that silently loses an option looks
 * broken, a locked one looks deliberate.
 *
 * The rollup code arrives as a prop because `lib/currency` reads BigQuery and
 * must stay out of the browser bundle.
 */

import { useEffect, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { useNavigation } from "@/components/shell/NavigationPending";
import { CurrencyIcon, MenuRow, Pill, Popover, usePopover } from "@/components/controls/Pill";

/** "EUR €", "CZK Kč", "USD $". */
function withSymbol(code: string): string {
  try {
    const symbol = new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: code,
      currencyDisplay: "narrowSymbol",
    })
      .formatToParts(0)
      .find((p) => p.type === "currency")?.value;
    return symbol && symbol !== code ? `${code} ${symbol}` : code;
  } catch {
    return code;
  }
}

export function CurrencyControl({
  nativeCurrency,
  rollupCurrency,
  displayCurrency,
  canConvert,
  convertReason,
}: {
  nativeCurrency: string;
  rollupCurrency: string;
  /** "native" or the rollup code. */
  displayCurrency: string;
  canConvert: boolean;
  convertReason: string;
}) {
  const { open, setOpen, wrapRef } = usePopover();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { isPending, navigate, baseQuery } = useNavigation();

  // Held until the page commits, so the pill answers on click.
  const [optimistic, setOptimistic] = useState<string | null>(null);
  useEffect(() => {
    if (!isPending) setOptimistic(null);
  }, [isPending]);
  const shown = optimistic ?? displayCurrency;

  function select(value: string) {
    setOpen(false);
    if (value === shown) return;
    setOptimistic(value);
    const next = new URLSearchParams(baseQuery(pathname, searchParams.toString()));
    next.set("currency", value);
    navigate(`${pathname}?${next.toString()}`);
  }

  const options = [
    { value: "native", label: withSymbol(nativeCurrency), disabled: false },
    { value: rollupCurrency, label: withSymbol(rollupCurrency), disabled: !canConvert },
  ];

  return (
    <div ref={wrapRef} className="relative">
      <Pill
        icon={<CurrencyIcon />}
        label={withSymbol(shown === "native" ? nativeCurrency : shown)}
        open={open}
        onClick={() => setOpen((v) => !v)}
        pending={isPending && optimistic !== null}
        ariaLabel="Display currency"
      />
      {open && (
        <Popover label="Display currency" onClose={() => setOpen(false)} className="sm:w-[200px]">
          <div role="menu" className="flex flex-col gap-0.5 p-2">
            {options.map((o) => (
              <MenuRow
                key={o.value}
                selected={o.value === shown}
                disabled={o.disabled}
                title={o.disabled ? convertReason : undefined}
                onClick={() => select(o.value)}
              >
                {o.label}
              </MenuRow>
            ))}
          </div>
        </Popover>
      )}
    </div>
  );
}
