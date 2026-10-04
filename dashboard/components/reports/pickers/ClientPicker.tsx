"use client";

/**
 * Client multi-select (design 1.8).
 *
 *   [ 5 clients v ]  ->  ( All active )  ( By vertical v )
 *                        [x] name   CZK  . shop . meta
 *
 * Produces a `ClientSelection`:
 * - "All active" is `{ mode: "all" }`, so clients added later appear in saved
 *   reports on their own. Checking every row by hand also lands here.
 * - "By vertical" is `{ mode: "vertical", verticals }`, resolved server-side
 *   through the client verticals table. Clients without a vertical cannot be
 *   reached this way and are only selectable by name.
 * - Anything else is `{ mode: "list", ids }`. The last row cannot be unchecked
 *   (a selection is never empty).
 *
 * `clients` is the output of `getReportClients()`: active, demo excluded.
 * Props `commit` decides when `onChange` fires: "change" on every click (the
 * widget drawer), "close" once when the popover closes with a different value
 * (the filter bar, so one visit to the picker is one query, not five).
 *
 * Keyboard: Enter or Space on the chip opens it; Tab and Up or Down move
 * between rows; Space toggles a row; Esc closes and returns to the chip.
 *
 * Owner: RS8.
 */

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useNavigation } from "@/components/shell/NavigationPending";
import type { ReportClient } from "@/lib/reports/registry/types";
import type { ClientSelection } from "@/lib/reports/types";
import { UNASSIGNED_VERTICAL } from "@/lib/reports/types";

// ---------------------------------------------------------------------------
// Helpers shared with the filter bar and the config panel
// ---------------------------------------------------------------------------

/** "pet_food" to "Pet food". Verticals are keys in the warehouse; people read words. */
export function humanizeKey(key: string): string {
  const t = key.replace(/_/g, " ").trim();
  return t === "" ? key : t.charAt(0).toUpperCase() + t.slice(1);
}

/** The clients a selection resolves to, in the order of `clients`. Unknown ids are dropped. */
export function selectedClients(clients: readonly ReportClient[], selection: ClientSelection): ReportClient[] {
  if (selection.mode === "all") return [...clients];
  if (selection.mode === "list") {
    const ids = new Set(selection.ids);
    return clients.filter((c) => ids.has(c.id));
  }
  const verticals = new Set(selection.verticals);
  return clients.filter((c) => c.vertical !== null && verticals.has(c.vertical));
}

/** Chip text: the client's name when one, else "N clients". */
export function clientSelectionLabel(clients: readonly ReportClient[], selection: ClientSelection): string {
  const chosen = selectedClients(clients, selection);
  if (chosen.length === 1) return chosen[0].name;
  return `${chosen.length} clients`;
}

/** Distinct vertical keys present among the clients, sorted. */
export function verticalsOf(clients: readonly ReportClient[]): string[] {
  const set = new Set<string>();
  for (const c of clients) if (c.vertical !== null && c.vertical !== UNASSIGNED_VERTICAL) set.add(c.vertical);
  return [...set].sort();
}

/** Normalise a hand-picked id set: everything checked means "all". */
function fromIds(clients: readonly ReportClient[], ids: ReadonlySet<string>): ClientSelection {
  if (clients.every((c) => ids.has(c.id))) return { mode: "all" };
  return { mode: "list", ids: clients.filter((c) => ids.has(c.id)).map((c) => c.id) };
}

function sameSelection(a: ClientSelection, b: ClientSelection): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

// ---------------------------------------------------------------------------
// Platform dots (colours are the shared platform tokens)
// ---------------------------------------------------------------------------

const DOT: Record<string, { cls: string; label: string }> = {
  shopify: { cls: "bg-platform-shopify", label: "Shopify" },
  shoptet: { cls: "bg-platform-shoptet", label: "Shoptet" },
  woocommerce: { cls: "bg-platform-woocommerce", label: "WooCommerce" },
  meta: { cls: "bg-platform-meta", label: "Meta" },
  google: { cls: "bg-platform-google", label: "Google" },
  klaviyo: { cls: "bg-platform-klaviyo", label: "Klaviyo" },
  ecomail: { cls: "bg-platform-ecomail", label: "Ecomail" },
};

function platformsOf(c: ReportClient): string[] {
  const out: string[] = [];
  if (c.shopPlatform) out.push(c.shopPlatform);
  if (c.capabilities.meta) out.push("meta");
  if (c.capabilities.googleAds) out.push("google");
  if (c.capabilities.klaviyo) out.push("klaviyo");
  if (c.capabilities.ecomail) out.push("ecomail");
  return out;
}

function PlatformDots({ client }: { client: ReportClient }) {
  const platforms = platformsOf(client);
  if (platforms.length === 0) return null;
  return (
    <span role="img" aria-label={platforms.map((p) => DOT[p]?.label ?? p).join(", ")} className="flex items-center gap-1">
      {platforms.map((p) => (
        <span key={p} title={DOT[p]?.label} className={`h-[7px] w-[7px] rounded-full ${DOT[p]?.cls ?? "bg-gray-400"}`} />
      ))}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export interface ClientPickerProps {
  /** Active, non-demo clients from `getReportClients()`. */
  clients: readonly ReportClient[];
  value: ClientSelection;
  onChange: (next: ClientSelection) => void;
  /** "change": every click. "close": once, when the popover closes with a new value. Default "change". */
  commit?: "change" | "close";
  /** Accessible name of the chip. Default "Clients". */
  label?: string;
  /** Open on mount (used when a drawer opens straight to this field). */
  defaultOpen?: boolean;
  /** Greys the chip; used while the filter is inherited. */
  disabled?: boolean;
}

export function ClientPicker({
  clients,
  value,
  onChange,
  commit = "change",
  label = "Clients",
  defaultOpen = false,
  disabled = false,
}: ClientPickerProps) {
  const [open, setOpen] = useState(defaultOpen);
  const [draft, setDraft] = useState<ClientSelection>(value);
  const [verticalOpen, setVerticalOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const panelId = useId();

  // A "close" commit navigates, so the server's value lags by a query. Hold the
  // committed value until the navigation settles (same rule as SegmentedControl),
  // otherwise the chip snaps back to the old selection for seconds.
  const { isPending } = useNavigation();
  const [held, setHeld] = useState<ClientSelection | null>(null);
  useEffect(() => {
    if (!isPending) setHeld(null);
  }, [isPending]);

  // The draft follows the prop except while a "close"-commit popover is open.
  const shown = commit === "close" && open ? draft : (held ?? value);
  const verticals = useMemo(() => verticalsOf(clients), [clients]);
  const chosen = useMemo(() => selectedClients(clients, shown), [clients, shown]);
  const chosenIds = useMemo(() => new Set(chosen.map((c) => c.id)), [chosen]);

  function emit(next: ClientSelection) {
    if (commit === "close") setDraft(next);
    else onChange(next);
  }

  function close(returnFocus: boolean) {
    setOpen(false);
    setVerticalOpen(false);
    if (commit === "close" && !sameSelection(draft, value)) {
      setHeld(draft);
      onChange(draft);
    }
    if (returnFocus) triggerRef.current?.focus();
  }

  function toggleOpen() {
    if (disabled) return;
    if (open) {
      close(false);
    } else {
      setDraft(value);
      setOpen(true);
    }
  }

  // Outside click closes (and commits).
  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (!wrapRef.current?.contains(e.target as Node)) close(false);
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
    // close() reads the latest draft through the closure of this render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, draft, value]);

  function toggleClient(id: string) {
    const ids = new Set(chosenIds);
    if (ids.has(id)) {
      if (ids.size === 1) return; // never empty
      ids.delete(id);
    } else {
      ids.add(id);
    }
    emit(fromIds(clients, ids));
  }

  function toggleVertical(key: string) {
    const current = shown.mode === "vertical" ? shown.verticals : [];
    const next = current.includes(key) ? current.filter((v) => v !== key) : [...current, key];
    if (next.length === 0) return; // never empty
    emit({ mode: "vertical", verticals: next });
  }

  function onPanelKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      close(true);
      return;
    }
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    const boxes = Array.from(listRef.current?.querySelectorAll<HTMLInputElement>("input[type=checkbox]") ?? []);
    if (boxes.length === 0) return;
    const at = boxes.indexOf(document.activeElement as HTMLInputElement);
    if (at < 0) return;
    e.preventDefault();
    const next = e.key === "ArrowDown" ? (at + 1) % boxes.length : (at - 1 + boxes.length) % boxes.length;
    boxes[next].focus();
  }

  const mode = shown.mode;
  const chipText = clientSelectionLabel(clients, shown);

  return (
    <div ref={wrapRef} className="relative inline-block">
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        onClick={toggleOpen}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        aria-label={`${label}: ${chipText}`}
        className="inline-flex items-center gap-2.5 rounded-control border border-hairline-strong bg-paper px-3 py-2 text-content-strong transition-colors duration-fast hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
      >
        <span className="text-[13px] font-medium">{chipText}</span>
        <span aria-hidden="true" className="text-[9px] text-content-muted">
          {open ? "▴" : "▾"}
        </span>
      </button>

      {open && (
        <div
          id={panelId}
          role="dialog"
          aria-label={label}
          onKeyDown={onPanelKeyDown}
          className="absolute left-0 top-[46px] z-[90] w-[min(340px,calc(100vw-2rem))] rounded-lg border border-hairline bg-paper p-2 shadow-lg"
        >
          <div className="flex items-center gap-1.5 pb-2">
            <button
              type="button"
              aria-pressed={mode === "all"}
              onClick={() => {
                setVerticalOpen(false);
                emit({ mode: "all" });
              }}
              className={`rounded-pill border px-3 py-1.5 text-[12.5px] transition-colors duration-fast ${
                mode === "all"
                  ? "border-transparent bg-ink-900 text-content-inverse"
                  : "border-hairline-strong text-content-body hover:bg-gray-50"
              }`}
            >
              All active
            </button>
            <button
              type="button"
              aria-pressed={mode === "vertical"}
              aria-expanded={verticalOpen}
              disabled={verticals.length === 0}
              title={verticals.length === 0 ? "No verticals set" : undefined}
              onClick={() => setVerticalOpen((v) => !v)}
              className={`inline-flex items-center gap-1.5 rounded-pill border px-3 py-1.5 text-[12.5px] transition-colors duration-fast disabled:cursor-not-allowed disabled:opacity-40 ${
                mode === "vertical"
                  ? "border-transparent bg-ink-900 text-content-inverse"
                  : "border-hairline-strong text-content-body hover:bg-gray-50"
              }`}
            >
              By vertical
              <span aria-hidden="true" className="text-[9px]">
                {verticalOpen ? "▴" : "▾"}
              </span>
            </button>
          </div>

          {verticalOpen && (
            <div role="group" aria-label="Verticals" className="mb-2 flex flex-wrap gap-1.5 rounded-md bg-gray-50 p-2">
              {verticals.map((key) => {
                const on = shown.mode === "vertical" && shown.verticals.includes(key);
                return (
                  <button
                    key={key}
                    type="button"
                    aria-pressed={on}
                    onClick={() => toggleVertical(key)}
                    className={`rounded-pill border px-2.5 py-1 text-[12px] transition-colors duration-fast ${
                      on
                        ? "border-transparent bg-accent-soft text-growth-700"
                        : "border-hairline-strong bg-paper text-content-body hover:bg-gray-100"
                    }`}
                  >
                    {humanizeKey(key)}
                  </button>
                );
              })}
            </div>
          )}

          <div ref={listRef} role="group" aria-label="Clients" className="flex max-h-[320px] flex-col overflow-y-auto">
            {clients.map((c) => {
              const checked = chosenIds.has(c.id);
              const last = checked && chosenIds.size === 1;
              return (
                <label
                  key={c.id}
                  title={last ? "At least one client" : undefined}
                  className="flex cursor-pointer items-center gap-2.5 rounded-sm px-2 py-[7px] transition-colors duration-fast hover:bg-gray-50"
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggleClient(c.id)}
                    className="h-[14px] w-[14px] accent-[var(--accent)]"
                  />
                  <span className="min-w-0 flex-1 truncate text-[13px] text-content-strong">{c.name}</span>
                  <span className="font-mono text-[10.5px] uppercase text-content-muted">{c.currency}</span>
                  <PlatformDots client={c} />
                </label>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
