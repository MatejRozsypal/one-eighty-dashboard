"use client";

/**
 * Share menu (design 1.10): who can see the report, and a copy of the link.
 *
 *   Private | Team can view | Team can edit     (owner only; others see the current one)
 *   Copy link                                   (the current URL, filter overrides included)
 *
 * "Team" means everyone who passes the reports gate. The visibility write is an
 * owner-only action; a failure comes back through `onError`.
 *
 * Owner: RS9.
 */

import { useState } from "react";
import type { Visibility } from "@/lib/reports/types";
import { VISIBILITIES } from "@/lib/reports/types";
import { Popover } from "./Popover";
import { VISIBILITY_LONG } from "./listFormat";

export interface ShareMenuProps {
  visibility: Visibility;
  isOwner: boolean;
  onChange: (next: Visibility) => void;
}

export function ShareMenu({ visibility, isOwner, onChange }: ShareMenuProps) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      /* Clipboard blocked: the address bar still has the link. */
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
          <button
            type="button"
            onClick={copy}
            className="rounded-control border border-hairline-strong px-3 py-1.5 text-[12.5px] text-content-body transition-colors duration-fast hover:bg-gray-50"
          >
            {copied ? "Copied" : "Copy link"}
          </button>
        </div>
      )}
    </Popover>
  );
}
