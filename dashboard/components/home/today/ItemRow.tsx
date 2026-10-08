"use client";

/**
 * One thing that needs a founder: the check, what is wrong, the number, and
 * the button to the page that resolves it. A grouped item (several packs,
 * several sync rows) opens to its lines.
 */

import { useState } from "react";
import { AppLink } from "@/components/ui/AppLink";
import { InfoTip } from "@/components/ui/InfoTip";
import { toneVars } from "@/lib/plan/health";
import type { TodayItem } from "@/lib/home/today/types";
import { Arrow, CheckCircle, Chevron, UrgencyGlyph } from "./glyphs";

function ActionLink({ item }: { item: TodayItem }) {
  const cls =
    "inline-flex h-8 flex-none items-center gap-1.5 whitespace-nowrap rounded-pill bg-[var(--gray-100)] px-3 text-[13px] font-semibold text-content-strong transition-colors duration-fast hover:bg-[var(--gray-150)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]";
  return item.external ? (
    <a href={item.href} target="_blank" rel="noreferrer" className={cls}>
      {item.action}
      <Arrow external />
    </a>
  ) : (
    <AppLink href={item.href} className={cls}>
      {item.action}
      <Arrow external={false} />
    </AppLink>
  );
}

function initials(name: string): string {
  return name
    .split(/[\s._-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p.charAt(0).toUpperCase())
    .join("");
}

export function ItemRow({
  item,
  done,
  leaving,
  showClient,
  onToggle,
}: {
  item: TodayItem;
  done: boolean;
  /** Just checked: drawn done for a moment before it moves to the done list. */
  leaving: boolean;
  showClient: boolean;
  onToggle: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const checked = done || leaving;
  const tone = toneVars(item.tone);
  const hasDetails = item.details.length > 0;
  const detailsId = `today-details-${item.id.replace(/[^a-z0-9]/gi, "-")}`;

  return (
    <li
      className={`group transition-opacity duration-base ${leaving ? "opacity-40" : ""}`}
      data-rule={item.rule}
    >
      <div className="flex items-start gap-3 px-4 py-3.5 sm:px-5">
        <button
          type="button"
          onClick={() => onToggle(item.id)}
          aria-pressed={checked}
          aria-label={checked ? `Mark "${item.title}" not done` : `Mark "${item.title}" done`}
          className="-m-1 mt-[-2px] flex-none rounded-full p-1 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--focus-ring)]"
        >
          <CheckCircle done={checked} />
        </button>

        <div className="flex min-w-0 flex-1 flex-col gap-1 sm:flex-row sm:items-center sm:gap-4">
          <div className="flex min-w-0 flex-1 flex-col gap-[3px]">
            <div className="flex min-w-0 items-center gap-2">
              {!checked && <UrgencyGlyph urgency={item.urgency} />}
              <span
                className={`min-w-0 text-[15px] font-semibold leading-[1.3] ${
                  checked ? "text-content-muted line-through decoration-[var(--gray-250)]" : "text-content-strong"
                }`}
              >
                {item.title}
              </span>
              {hasDetails && (
                <button
                  type="button"
                  onClick={() => setOpen((v) => !v)}
                  aria-expanded={open}
                  aria-controls={detailsId}
                  className="inline-flex flex-none items-center gap-1 rounded-pill px-1.5 py-0.5 text-[12px] font-semibold text-content-muted hover:bg-[var(--gray-100)] hover:text-content-strong"
                >
                  {item.details.length}
                  <Chevron open={open} />
                  <span className="sr-only">{open ? "Hide lines" : "Show lines"}</span>
                </button>
              )}
            </div>
            <div className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[13px] leading-[1.35] text-content-muted">
              {showClient && (
                <span className="inline-flex items-center gap-1.5 font-semibold text-content-body">
                  <span
                    aria-hidden="true"
                    className="grid h-[18px] w-[18px] place-items-center rounded-[6px] bg-[var(--gray-100)] text-[9.5px] font-bold text-content-strong"
                  >
                    {initials(item.clientName ?? "Agency")}
                  </span>
                  {item.clientName ?? "Agency"}
                </span>
              )}
              {showClient && item.context && <span aria-hidden="true">·</span>}
              {item.context && <span className="min-w-0">{item.context}</span>}
              {item.assignees && item.assignees.length > 0 && (
                <span className="inline-flex items-center gap-1">
                  <span aria-hidden="true">·</span>
                  {item.assignees.join(", ")}
                </span>
              )}
              <InfoTip text={item.tip} label={`How "${item.title}" is found`} />
            </div>
          </div>

          <div className="mt-1.5 flex flex-none items-center justify-between gap-3 sm:mt-0 sm:justify-end">
            <span
              className="text-[15px] font-semibold tabular leading-none"
              style={{ color: checked ? "var(--text-muted)" : tone.text }}
            >
              {item.figure}
            </span>
            {!checked && <ActionLink item={item} />}
          </div>
        </div>
      </div>

      {hasDetails && open && (
        <ul id={detailsId} className="m-0 mb-3 ml-[52px] mr-4 list-none rounded-[14px] bg-[var(--gray-50)] p-0 sm:ml-[60px] sm:mr-5">
          {item.details.map((d, i) => {
            const label = d.href ? (
              d.external ? (
                <a href={d.href} target="_blank" rel="noreferrer" className="font-semibold text-content-strong hover:underline">
                  {d.label}
                </a>
              ) : (
                <AppLink href={d.href} className="font-semibold text-content-strong hover:underline">
                  {d.label}
                </AppLink>
              )
            ) : (
              <span className="font-semibold text-content-strong">{d.label}</span>
            );
            return (
              <li
                key={`${d.label}-${i}`}
                className="flex flex-col gap-0.5 border-t border-hairline px-3.5 py-2 text-[12.5px] leading-[1.35] first:border-t-0 sm:flex-row sm:items-baseline sm:justify-between sm:gap-4"
              >
                <span className="min-w-0 break-words">{label}</span>
                {d.value && <span className="min-w-0 tabular text-content-muted sm:text-right">{d.value}</span>}
              </li>
            );
          })}
        </ul>
      )}
    </li>
  );
}
