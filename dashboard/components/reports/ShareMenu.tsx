"use client";

/**
 * Share menu (design 1.10): who can see the report, and a copy of the link.
 *
 *   Private | Team can view | Team can edit     (owner only; others see the current one)
 *   Copy link                                   (/reports/<id>: the saved report, no edit mode, no overrides)
 *   Copy link with current filters              (the saved link plus only the filter params in the URL)
 *
 * "Team" means everyone who passes the reports gate. The visibility write is an
 * owner-only action; a failure comes back through `onError`.
 *
 * Owner: RS9.
 */

import { useState } from "react";
import { FILTER_PARAMS } from "@/lib/reports/url";
import type { Visibility } from "@/lib/reports/types";
import { VISIBILITIES } from "@/lib/reports/types";
import { Popover } from "./Popover";
import { VISIBILITY_LONG } from "./listFormat";

export interface ShareMenuProps {
  reportId: string;
  visibility: Visibility;
  isOwner: boolean;
  onChange: (next: Visibility) => void;
}

/** The saved report: the same page for everyone, whatever the sender has open. */
function reportPath(reportId: string): string {
  return `/reports/${reportId}`;
}

/** The saved link plus the filter params in the address bar. Never `edit`, never anything else. */
function reportPathWithFilters(reportId: string): string {
  const here = new URLSearchParams(window.location.search);
  const kept = new URLSearchParams();
  for (const key of FILTER_PARAMS) {
    const value = here.get(key);
    if (value !== null) kept.set(key, value);
  }
  const qs = kept.toString().replace(/%3A/g, ":").replace(/%2C/g, ",");
  return qs === "" ? reportPath(reportId) : `${reportPath(reportId)}?${qs}`;
}

export function ShareMenu({ reportId, visibility, isOwner, onChange }: ShareMenuProps) {
  const [copied, setCopied] = useState<"saved" | "filters" | null>(null);

  async function copy(kind: "saved" | "filters") {
    const path = kind === "saved" ? reportPath(reportId) : reportPathWithFilters(reportId);
    try {
      await navigator.clipboard.writeText(`${window.location.origin}${path}`);
      setCopied(kind);
      setTimeout(() => setCopied(null), 1800);
    } catch {
      /* Clipboard blocked: nothing to fall back to, the button just does not confirm. */
    }
  }

  return (
    <Popover label="Share" button={<span>Share</span>} align="right" panelClassName="w-[240px]">
      {() => (
        <div className="flex flex-col gap-2">
          <div role="radiogroup" aria-label="Who can see this report" className="flex flex-col">
            {VISIBILITIES.map((v) => {
              const on = v === visibility;
              return (
                <button
                  key={v}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  disabled={!isOwner}
                  title={isOwner ? undefined : "Owner only"}
                  onClick={() => !on && onChange(v)}
                  className="flex items-center gap-2.5 rounded-sm px-2.5 py-2 text-left text-[13px] text-content-body transition-colors duration-fast hover:bg-gray-100 disabled:cursor-not-allowed disabled:hover:bg-transparent"
                >
                  <span
                    aria-hidden="true"
                    className={`flex h-[14px] w-[14px] flex-none items-center justify-center rounded-full border ${on ? "border-ink-900" : "border-hairline-strong"}`}
                  >
                    {on && <span className="h-[7px] w-[7px] rounded-full bg-ink-900" />}
                  </span>
                  <span className={on ? "font-medium text-content-strong" : isOwner ? "" : "text-content-muted"}>{VISIBILITY_LONG[v]}</span>
                </button>
              );
            })}
          </div>
          <div className="h-px bg-hairline" />
          {(["saved", "filters"] as const).map((kind) => (
            <button
              key={kind}
              type="button"
              onClick={() => void copy(kind)}
              className="rounded-control border border-hairline-strong px-3 py-1.5 text-left text-[12.5px] text-content-body transition-colors duration-fast hover:bg-gray-50"
            >
              {copied === kind ? "Copied" : kind === "saved" ? "Copy link" : "Copy link with current filters"}
            </button>
          ))}
        </div>
      )}
    </Popover>
  );
}
