"use client";

/**
 * Which dimension the Breakdown screen groups by.
 *
 * A link-driven `<select>` rather than client state: the choice belongs in the
 * URL so a view is shareable, which is the same reason the client and the date
 * range live there. "Look at the persona breakdown" should be a link somebody
 * can paste into Slack.
 */

import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { BREAKDOWN_DIMENSIONS, type BreakdownKey } from "@/lib/creative/vocabulary";

export function DimensionPicker({ current }: { current: BreakdownKey }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  return (
    <label className="flex items-center gap-2">
      <span className="font-mono text-[10.5px] uppercase tracking-eyebrow text-content-muted">
        Break down by
      </span>
      <select
        value={current}
        onChange={(e) => {
          const next = new URLSearchParams(params.toString());
          next.set("by", e.target.value);
          router.push(`${pathname}?${next.toString()}`);
        }}
        className="rounded-control border border-hairline-strong bg-paper/70 px-2.5 py-1.5 text-[13px] text-content-body backdrop-blur-[8px] transition-colors duration-fast hover:border-accent/40"
      >
        {BREAKDOWN_DIMENSIONS.map((d) => (
          <option key={d.key} value={d.key}>
            {d.label}
          </option>
        ))}
      </select>
    </label>
  );
}
