"use client";

/**
 * Segmented pill control — the shared shape behind the compare and currency
 * toggles. A disabled segment keeps its slot and explains itself on hover
 * rather than disappearing; a control that silently loses an option looks
 * broken, while a locked one looks deliberate.
 */

import { usePathname, useRouter, useSearchParams } from "next/navigation";

export interface Segment {
  value: string;
  label: string;
  disabled?: boolean;
  /** Why it's disabled. Shown as a title tooltip. */
  disabledReason?: string;
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
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  function select(value: string) {
    const next = new URLSearchParams(searchParams.toString());
    next.set(param, value);
    router.push(`${pathname}?${next.toString()}`);
  }

  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className="flex gap-0.5 rounded-pill bg-gray-100 p-[3px]"
    >
      {segments.map((seg) => {
        const isActive = seg.value === active;

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
            onClick={() => select(seg.value)}
            aria-pressed={isActive}
            className={`whitespace-nowrap rounded-pill px-2.5 py-1.5 font-mono text-[11px] transition-colors duration-fast ${
              isActive
                ? "bg-paper text-content-strong shadow-sm"
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
