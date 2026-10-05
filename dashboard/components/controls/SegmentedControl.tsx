"use client";

/**
 * Segmented pill control: the shared shape behind the compare and currency
 * toggles. A disabled segment keeps its slot and explains itself on hover
 * rather than disappearing; a control that silently loses an option looks
 * broken, while a locked one looks deliberate.
 *
 * The selected segment moves on click, not on response. `active` comes from the
 * server and can be seconds away; until it catches up the click is held locally
 * so the control answers immediately. Without that, clicking a segment does
 * nothing visible for the length of a BigQuery query and reads as broken.
 */

import { useEffect, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { useNavigation } from "@/components/shell/NavigationPending";

export interface Segment {
  value: string;
  label: string;
  disabled?: boolean;
  /** Why it's disabled. Shown as a title tooltip. */
  disabledReason?: string;
  /** Hover text for an enabled segment whose label is terse ("%", "123"). */
  title?: string;
}

export function SegmentedControl({
  param,
  segments,
  active,
  ariaLabel,
}: {
  /** Search param this control writes to. */
  param: string;
  segments: Segment[];
  active: string;
  ariaLabel: string;
}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // Shared with the rest of the page, so the figures pulse while this resolves.
  const { isPending, navigate, baseQuery } = useNavigation();
  const [optimistic, setOptimistic] = useState<string | null>(null);

  // `isPending` stays true until the new server output is committed, so this
  // hands authority back to the server at exactly the moment it has an answer.
  useEffect(() => {
    if (!isPending) setOptimistic(null);
  }, [isPending]);

  const shown = optimistic ?? active;

  function select(value: string) {
    if (value === shown) return;
    setOptimistic(value);

    // Merged onto the URL a still-loading change is heading to, so a second
    // control used before the first answers does not undo it.
    const next = new URLSearchParams(baseQuery(pathname, searchParams.toString()));
    next.set(param, value);
    navigate(`${pathname}?${next.toString()}`);
  }

  return (
    <SegmentPills
      segments={segments}
      shown={shown}
      onSelect={select}
      ariaLabel={ariaLabel}
      pending={isPending}
    />
  );
}

/**
 * The pills alone: no URL, no navigation. `SegmentedControl` drives them from
 * a search param; the delta toggle drives them from its own context.
 */
export function SegmentPills({
  segments,
  shown,
  onSelect,
  ariaLabel,
  pending = false,
}: {
  segments: Segment[];
  shown: string;
  onSelect: (value: string) => void;
  ariaLabel: string;
  /** Pulse the selected segment while its change is in flight. */
  pending?: boolean;
}) {
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      aria-busy={pending}
      className="flex gap-0.5 rounded-pill bg-gray-100 p-[3px]"
    >
      {segments.map((seg) => {
        const isActive = seg.value === shown;

        if (seg.disabled) {
          return (
            <span
              key={seg.value}
              title={seg.disabledReason}
              className="inline-flex cursor-not-allowed items-center gap-[5px] whitespace-nowrap rounded-pill px-2.5 py-1.5 font-mono text-[11px] text-gray-250"
            >
              {seg.label}
              <span aria-hidden="true" className="text-[9px]">
                🔒
              </span>
            </span>
          );
        }

        return (
          <button
            key={seg.value}
            type="button"
            onClick={() => {
              if (seg.value !== shown) onSelect(seg.value);
            }}
            aria-pressed={isActive}
            title={seg.title}
            aria-label={seg.title}
            className={`whitespace-nowrap rounded-pill px-2.5 py-1.5 font-mono text-[11px] transition-colors duration-fast ${
              isActive
                ? `bg-paper text-content-strong shadow-sm ${pending ? "oe-pulse" : ""}`
                : "text-content-muted hover:text-content-body"
            }`}
          >
            {seg.label}
          </button>
        );
      })}
    </div>
  );
}
