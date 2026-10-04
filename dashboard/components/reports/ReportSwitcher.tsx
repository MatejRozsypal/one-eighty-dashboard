"use client";

/**
 * Switching between reports (design 1.10): the title dropdown in the report
 * header and the Cmd/Ctrl+K palette are one component.
 *
 *   <ReportSwitcher />       mounted once by the layout: the palette itself and
 *                            its global shortcut. Pinned reports, recent
 *                            reports, then All reports; type to filter, arrows
 *                            move, Enter opens, Esc closes.
 *   <ReportTitleButton />    the title in the header; opens the palette.
 *
 * Opening a report keeps the filter overrides of the current URL (`clients`,
 * `preset`, `from`, `to`, `compare`, `ccy`, `bench`): they are report-level
 * view state, so they apply to any report.
 *
 * Owner: RS9.
 */

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useNavigation } from "@/components/shell/NavigationPending";
import { FILTER_PARAMS } from "@/lib/reports/url";
import { useGroupedReports, type DirectoryEntry } from "./ReportsDirectory";
import { reportHref } from "./listFormat";

const OPEN_EVENT = "reports:switcher";

/** Opens the palette from anywhere (the title button uses it). */
export function openReportSwitcher(): void {
  window.dispatchEvent(new Event(OPEN_EVENT));
}

function isTypingTarget(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false;
  return t.isContentEditable || t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT";
}

interface Option {
  entry: DirectoryEntry;
  group: "Pinned" | "Recent" | "All reports";
}

export function ReportSwitcher() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const listId = useId();
  const { pinned, recent, all } = useGroupedReports();
  const searchParams = useSearchParams();
  const { navigate } = useNavigation();

  const show = useCallback(() => {
    returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setQuery("");
    setActive(0);
    setOpen(true);
  }, []);

  const close = useCallback(() => {
    setOpen(false);
    returnFocus.current?.focus();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === "k") {
        e.preventDefault();
        if (open) close();
        else show();
      }
    };
    const onOpen = () => show();
    window.addEventListener("keydown", onKey);
    window.addEventListener(OPEN_EVENT, onOpen);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener(OPEN_EVENT, onOpen);
    };
  }, [open, show, close]);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  const options = useMemo<Option[]>(() => {
    const q = query.trim().toLowerCase();
    if (q) return all.filter((e) => e.name.toLowerCase().includes(q)).map((entry) => ({ entry, group: "All reports" as const }));
    return [
      ...pinned.map((entry) => ({ entry, group: "Pinned" as const })),
      ...recent.slice(0, 6).map((entry) => ({ entry, group: "Recent" as const })),
      ...all.map((entry) => ({ entry, group: "All reports" as const })),
    ];
  }, [query, pinned, recent, all]);

  useEffect(() => setActive(0), [query]);

  function go(entry: DirectoryEntry) {
    const keep = new URLSearchParams();
    for (const key of FILTER_PARAMS) {
      const v = searchParams.get(key);
      if (v !== null) keep.set(key, v);
    }
    setOpen(false);
    navigate(reportHref(entry.id, keep.toString()));
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      close();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => (options.length ? (i + 1) % options.length : 0));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => (options.length ? (i - 1 + options.length) % options.length : 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const o = options[active];
      if (o) go(o.entry);
    } else if (e.key === "Tab") {
      // The palette is modal and has one control.
      e.preventDefault();
    }
  }

  if (!open) return null;

  let lastGroup = "";
  return (
    <div className="fixed inset-0 z-[110] flex items-start justify-center bg-ink-900/40 px-4 pt-[14vh]" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div role="dialog" aria-modal="true" aria-label="Switch report" onKeyDown={onKeyDown} className="w-[min(520px,100%)] overflow-hidden rounded-lg border border-hairline bg-paper shadow-lg">
        <input
          ref={inputRef}
          type="text"
          role="combobox"
          aria-expanded="true"
          aria-controls={listId}
          aria-activedescendant={options[active] ? `${listId}-${active}` : undefined}
          aria-label="Search reports"
          placeholder="Search reports"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="w-full border-b border-hairline bg-transparent px-4 py-3 text-[14px] text-content-strong outline-none placeholder:text-content-muted"
        />
        <div id={listId} role="listbox" aria-label="Reports" className="max-h-[360px] overflow-y-auto p-1.5">
          {options.length === 0 && <p className="px-3 py-3 text-[13px] text-content-muted">No reports.</p>}
          {options.map((o, i) => {
            const heading = o.group !== lastGroup;
            lastGroup = o.group;
            return (
              <div key={`${o.group}-${o.entry.id}`}>
                {heading && (
                  <span className="block px-3 pb-1 pt-2 font-mono text-[10px] uppercase tracking-[0.12em] text-content-muted">{o.group}</span>
                )}
                <div
                  id={`${listId}-${i}`}
                  role="option"
                  aria-selected={i === active}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => go(o.entry)}
                  className={`cursor-pointer truncate rounded-sm px-3 py-2 text-[13.5px] ${
                    i === active ? "bg-gray-100 text-content-strong" : "text-content-body"
                  }`}
                >
                  {o.entry.name}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/** The report title as a dropdown trigger. */
export function ReportTitleButton({ name }: { name: string }) {
  return (
    <button
      type="button"
      onClick={openReportSwitcher}
      aria-haspopup="dialog"
      title="Switch report"
      className="inline-flex min-w-0 max-w-full items-center gap-2 rounded-control px-2 py-1 text-left transition-colors duration-fast hover:bg-gray-100"
    >
      <span className="truncate text-[17px] font-bold tracking-heading text-content-strong">{name}</span>
      <span aria-hidden="true" className="text-[9px] text-content-muted">
        ▾
      </span>
    </button>
  );
}
