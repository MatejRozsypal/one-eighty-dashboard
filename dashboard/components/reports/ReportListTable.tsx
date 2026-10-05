"use client";

/**
 * The report list (design 1.3): search, three tabs, a row per report.
 *
 *   ( Mine ) ( Team ) ( Templates )   [ Search ]                [ New report v ]
 *   pin  Name              Visibility   Owner  Widgets   Updated   [...]
 *
 * Rows come sorted from the store (pinned first, then last opened, then
 * updated). The row menu is Open, Duplicate, Rename, Pin, Visibility and
 * Delete; Rename needs edit permission, Visibility and Delete are owner only
 * (the store enforces the same rules, the menu just does not offer what would
 * be refused). Delete is a soft delete with an Undo toast.
 *
 * Templates are read-only; "Use template" creates a report in Mine from it and
 * opens it in edit mode. A new report opens the same way.
 *
 * Owner: RS9.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppLink } from "@/components/ui/AppLink";
import { useRouter } from "next/navigation";
import { useNavigation } from "@/components/shell/NavigationPending";
import {
  createReport,
  deleteReport,
  duplicateReport,
  pinReport,
  renameReport,
  restoreReport,
  setVisibility,
} from "@/app/(app)/reports/actions";
import type { ReportListItem, ReportTemplate, TemplateKey } from "@/lib/reports/contracts";
import { MAX_REPORT_NAME } from "@/lib/reports/limits";
import type { Visibility } from "@/lib/reports/types";
import { VISIBILITIES } from "@/lib/reports/types";
import { DotsIcon, ICON_BUTTON, Popover, PopoverMenu, type MenuEntry } from "./Popover";
import { useDirectoryActions } from "./ReportsDirectory";
import { ToastRegion, useToasts } from "./Toasts";
import { VISIBILITY_LONG, VISIBILITY_SHORT, ownerInitials, relativeTime, widgetCountLabel } from "./listFormat";

type Tab = "mine" | "team" | "templates";

const TABS: ReadonlyArray<{ id: Tab; label: string }> = [
  { id: "mine", label: "Mine" },
  { id: "team", label: "Team" },
  { id: "templates", label: "Templates" },
];

const ROW = "grid items-center gap-3 px-3 py-2.5 md:grid-cols-[28px_minmax(0,1fr)_104px_44px_88px_44px_36px] grid-cols-[28px_minmax(0,1fr)_36px]";

function PinIcon({ filled }: { filled: boolean }) {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true" fill={filled ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round">
      <path d="M9.5 2l4.5 4.5-2.2.6-2.4 2.4.3 2.7-1.2 1.2-2.6-2.6-3.3 3.3-.5-.5 3.3-3.3L2.8 7.7 4 6.5l2.7.3L9.1 4.4z" />
    </svg>
  );
}

/** One random value per click, for the server's idempotency check. */
function newClickToken(): string {
  try {
    return crypto.randomUUID();
  } catch {
    // Insecure context or an old browser: random enough for a per-click token.
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
  }
}

function Spinner() {
  return <span aria-hidden="true" className="h-3 w-3 flex-none animate-spin rounded-full border-[1.5px] border-current border-t-transparent" />;
}

export interface ReportListTableProps {
  mine: readonly ReportListItem[];
  team: readonly ReportListItem[];
  templates: readonly ReportTemplate[];
  /** `?new=1`: open the new-report picker on arrival. */
  openNew?: boolean;
  /** `?deleted=<id>`: the report just deleted from its page; offers Undo. */
  deletedId?: string;
}

export function ReportListTable({ mine, team, templates, openNew = false, deletedId }: ReportListTableProps) {
  // Moving between pages goes through the shared navigation (the whole page
  // pulses from the click). `router.refresh()` below is a quiet resync after an
  // optimistic edit: the row already shows the new state.
  const router = useRouter();
  const { navigate, isPending } = useNavigation();
  const toasts = useToasts();
  const [tab, setTab] = useState<Tab>("mine");
  const [query, setQuery] = useState("");
  const [renaming, setRenaming] = useState<string | null>(null);

  // One create or duplicate at a time (QA N-01). `busyRef` is the guard (it is
  // set in the click handler itself, before React re-renders, so a fast second
  // click cannot get past it); `busy` is the same fact for rendering. The new
  // report takes several seconds on a cold server and the click gave no sign
  // of life: the clicked entry now shows "Creating..." and everything else in
  // the menu is disabled until the report opens or the call fails.
  const [busy, setBusy] = useState<{ key: string; phase: "creating" | "opening" } | null>(null);
  const busyRef = useRef(false);
  const sawPending = useRef(false);
  useEffect(() => {
    if (busy?.phase !== "opening") {
      sawPending.current = false;
      return;
    }
    // The navigation to the new report is in flight; if it ends without this
    // page unmounting (a failed navigation), give the buttons back.
    if (isPending) sawPending.current = true;
    else if (sawPending.current) {
      busyRef.current = false;
      setBusy(null);
    }
  }, [busy, isPending]);

  // Optimistic copies on top of the server lists.
  const [lists, setLists] = useState({ mine, team });
  useEffect(() => setLists({ mine, team }), [mine, team]);

  // Arrived from "Delete" on a report page: one toast with Undo, once.
  const announced = useRef(false);
  useEffect(() => {
    if (!deletedId || announced.current) return;
    announced.current = true;
    navigate("/reports", { replace: true, scroll: false });
    toasts.push({
      text: "Report deleted",
      action: {
        label: "Undo",
        run: () => {
          void restoreReport(deletedId).then((back) => {
            if (!back.ok) toasts.push({ text: "Could not save", tone: "error" });
            else router.refresh();
          });
        },
      },
      ttl: 10000,
    });
    // Once, on arrival.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deletedId]);

  const directory = useDirectoryActions();

  const patchItem = useCallback((id: string, patch: Partial<ReportListItem>) => {
    if (patch.name !== undefined) directory.patch(id, { name: patch.name });
    if (patch.pinned !== undefined) directory.patch(id, { pinned: patch.pinned });
    setLists((l) => ({
      mine: l.mine.map((r) => (r.id === id ? { ...r, ...patch } : r)),
      team: l.team.map((r) => (r.id === id ? { ...r, ...patch } : r)),
    }));
  }, [directory]);

  const dropItem = useCallback((id: string) => {
    directory.drop(id);
    setLists((l) => ({ mine: l.mine.filter((r) => r.id !== id), team: l.team.filter((r) => r.id !== id) }));
  }, [directory]);

  const fail = useCallback(
    (message = "Could not save") => {
      toasts.push({ text: message, tone: "error" });
      router.refresh();
    },
    [toasts, router],
  );

  const q = query.trim().toLowerCase();
  const rows = useMemo(() => {
    const source = tab === "mine" ? lists.mine : lists.team;
    return source.filter((r) => !q || r.name.toLowerCase().includes(q));
  }, [tab, lists, q]);
  const templateRows = useMemo(() => templates.filter((t) => !q || t.name.toLowerCase().includes(q)), [templates, q]);

  // ---- actions ------------------------------------------------------------

  function open(id: string, edit = false) {
    navigate(edit ? `/reports/${id}?edit=1` : `/reports/${id}`);
  }

  async function create(key: TemplateKey | undefined, name: string) {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy({ key: key ?? "blank", phase: "creating" });
    // One token per click: if the request is repeated (a retry, a second
    // lambda) the server hands back the report the first one created.
    const clientToken = newClickToken();
    // A server action can reject (network, platform error) instead of returning
    // a failure: say so, never let the click vanish.
    const result = await createReport({ name, templateKey: key, clientToken }).catch(() => null);
    if (!result || !result.ok) {
      busyRef.current = false;
      setBusy(null);
      return fail();
    }
    setBusy({ key: key ?? "blank", phase: "opening" });
    open(result.id, true);
    // The list and the left panel learn about the new report from the next
    // render of the layout; the action no longer forces it (see actions.ts).
    router.refresh();
  }

  async function duplicate(r: ReportListItem) {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy({ key: `dup:${r.id}`, phase: "creating" });
    const notice = toasts.push({ text: "Duplicating", ttl: 0 });
    const result = await duplicateReport(r.id).catch(() => null);
    toasts.dismiss(notice);
    if (!result || !result.ok) {
      busyRef.current = false;
      setBusy(null);
      return fail();
    }
    setBusy({ key: `dup:${r.id}`, phase: "opening" });
    open(result.id, true);
  }

  async function rename(r: ReportListItem, name: string) {
    setRenaming(null);
    const next = name.trim();
    if (!next || next === r.name) return;
    patchItem(r.id, { name: next });
    const result = await renameReport(r.id, next);
    if (!result.ok) fail();
    else router.refresh();
  }

  async function togglePin(r: ReportListItem) {
    patchItem(r.id, { pinned: !r.pinned });
    const result = await pinReport(r.id, !r.pinned);
    if (!result.ok) fail();
    else router.refresh();
  }

  async function changeVisibility(r: ReportListItem, visibility: Visibility) {
    patchItem(r.id, { visibility });
    const result = await setVisibility(r.id, visibility);
    if (!result.ok) fail();
    else router.refresh();
  }

  async function remove(r: ReportListItem) {
    dropItem(r.id);
    const result = await deleteReport(r.id);
    if (!result.ok) return fail();
    router.refresh();
    toasts.push({
      text: "Report deleted",
      action: {
        label: "Undo",
        run: () => {
          void restoreReport(r.id).then((back) => {
            if (!back.ok) fail();
            else router.refresh();
          });
        },
      },
    });
  }

  function menuFor(r: ReportListItem): MenuEntry[] {
    const p = r.permissions;
    const entries: MenuEntry[] = [
      { kind: "item", id: "open", label: "Open", onSelect: () => open(r.id) },
      { kind: "item", id: "duplicate", label: "Duplicate", disabled: busy !== null, onSelect: () => void duplicate(r) },
      { kind: "item", id: "rename", label: "Rename", disabled: !p.canEdit, hint: p.canEdit ? undefined : "Read only", onSelect: () => setRenaming(r.id) },
      { kind: "item", id: "pin", label: r.pinned ? "Unpin" : "Pin", onSelect: () => void togglePin(r) },
    ];
    if (p.isOwner) {
      entries.push({ kind: "separator" }, { kind: "heading", label: "Visibility" });
      for (const v of VISIBILITIES) {
        entries.push({ kind: "item", id: `vis-${v}`, label: VISIBILITY_LONG[v], checked: r.visibility === v, onSelect: () => void changeVisibility(r, v) });
      }
      entries.push({ kind: "separator" }, { kind: "item", id: "delete", label: "Delete", danger: true, onSelect: () => void remove(r) });
    }
    return entries;
  }

  // ---- render -------------------------------------------------------------

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <div role="tablist" aria-label="Report scope" className="inline-flex rounded-pill border border-hairline-strong bg-paper p-0.5">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={tab === t.id}
              onClick={() => setTab(t.id)}
              className={`rounded-pill px-3.5 py-1.5 text-[12.5px] transition-colors duration-fast ${
                tab === t.id ? "bg-ink-900 text-content-inverse" : "text-content-body hover:bg-gray-100"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        <input
          type="search"
          aria-label="Search reports"
          placeholder="Search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="min-w-[160px] flex-1 rounded-control border border-hairline-strong bg-paper px-3 py-2 text-[13px] text-content-strong outline-none placeholder:text-content-muted focus:border-ink-900 md:max-w-[280px]"
        />

        <div className="ml-auto">
          <Popover
            label="New report"
            align="right"
            defaultOpen={openNew}
            disabled={busy !== null}
            locked={busy !== null}
            panelClassName="w-[220px] p-1.5"
            buttonClassName="inline-flex items-center gap-2 rounded-control bg-ink-900 px-3.5 py-2 text-[13px] font-medium text-content-inverse transition-colors duration-fast hover:bg-ink-700 disabled:cursor-wait disabled:opacity-60"
            button={
              <>
                {busy !== null && <Spinner />}
                <span>{busy !== null ? (busy.phase === "opening" ? "Opening" : "Creating") : "New report"}</span>
              </>
            }
          >
            {() => (
              <div role="menu" aria-label="Start from" aria-busy={busy !== null} className="flex flex-col">
                {templates.map((t) => {
                  const mine = busy?.key === t.key;
                  return (
                    <button
                      key={t.key}
                      type="button"
                      role="menuitem"
                      disabled={busy !== null}
                      aria-disabled={busy !== null}
                      onClick={() => void create(t.key === "blank" ? undefined : t.key, t.key === "blank" ? "Untitled report" : t.name)}
                      className={`flex items-center justify-between gap-3 rounded-sm px-2.5 py-2 text-left text-[13px] transition-colors duration-fast ${
                        mine ? "bg-gray-100 text-content-strong" : "text-content-body hover:bg-gray-100"
                      } ${busy !== null && !mine ? "opacity-50" : ""} disabled:cursor-wait`}
                    >
                      <span>{t.name}</span>
                      {mine ? (
                        <span className="inline-flex items-center gap-1.5 text-[11.5px] text-content-muted">
                          <Spinner />
                          {busy?.phase === "opening" ? "Opening" : "Creating"}
                        </span>
                      ) : (
                        t.widgets.length > 0 && <span className="text-[11.5px] text-content-muted">{t.widgets.length}</span>
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </Popover>
        </div>
      </div>

      <div className="rounded-card border border-hairline bg-paper">
        {tab === "templates" ? (
          templateRows.length === 0 ? (
            <p className="px-4 py-6 text-[13.5px] text-content-muted">No templates.</p>
          ) : (
            <ul className="m-0 list-none divide-y divide-hairline p-0">
              {templateRows.map((t) => (
                <li key={t.key} className="flex items-center gap-4 px-4 py-3">
                  <span className="min-w-0 flex-1 truncate text-[13.5px] font-medium text-content-strong">{t.name}</span>
                  <span className="text-[12.5px] text-content-muted">{widgetCountLabel(t.widgets.length)}</span>
                  <button
                    type="button"
                    disabled={busy !== null}
                    aria-busy={busy?.key === t.key}
                    onClick={() => void create(t.key === "blank" ? undefined : t.key, t.key === "blank" ? "Untitled report" : t.name)}
                    className="inline-flex items-center gap-1.5 rounded-control border border-hairline-strong px-3 py-1.5 text-[12.5px] text-content-body transition-colors duration-fast hover:bg-gray-50 disabled:cursor-wait disabled:opacity-60"
                  >
                    {busy?.key === t.key && <Spinner />}
                    {busy?.key === t.key ? (busy.phase === "opening" ? "Opening" : "Creating") : "Use template"}
                  </button>
                </li>
              ))}
            </ul>
          )
        ) : rows.length === 0 ? (
          <p className="px-4 py-6 text-[13.5px] text-content-muted">No reports.</p>
        ) : (
          <ul className="m-0 list-none divide-y divide-hairline p-0">
            {rows.map((r) => (
              <li key={r.id} className={ROW}>
                <button
                  type="button"
                  onClick={() => void togglePin(r)}
                  aria-pressed={r.pinned}
                  aria-label={r.pinned ? `Unpin ${r.name}` : `Pin ${r.name}`}
                  className={`${ICON_BUTTON} h-7 w-7 ${r.pinned ? "text-content-strong" : ""}`}
                >
                  <PinIcon filled={r.pinned} />
                </button>

                {renaming === r.id ? (
                  <RenameInput initial={r.name} onDone={(name) => void rename(r, name)} onCancel={() => setRenaming(null)} />
                ) : (
                  <AppLink href={`/reports/${r.id}`} className="truncate text-[13.5px] font-medium text-content-strong hover:underline" title={r.name}>
                    {r.name}
                  </AppLink>
                )}

                <span className="hidden text-[12.5px] text-content-body md:block">{VISIBILITY_SHORT[r.visibility]}</span>
                <span className="hidden font-mono text-[11.5px] text-content-muted md:block" title={r.ownerEmail}>
                  {ownerInitials(r.ownerEmail)}
                </span>
                <span className="hidden text-[12.5px] text-content-muted md:block">{widgetCountLabel(r.widgetCount)}</span>
                <span className="hidden text-[12.5px] text-content-muted md:block" title={r.updatedAt}>
                  {relativeTime(r.lastOpenedAt ?? r.updatedAt)}
                </span>

                <PopoverMenu
                  label={`Actions for ${r.name}`}
                  align="right"
                  buttonClassName={ICON_BUTTON}
                  button={<DotsIcon />}
                  entries={menuFor(r)}
                />
              </li>
            ))}
          </ul>
        )}
      </div>

      <ToastRegion toasts={toasts} />
    </div>
  );
}

function RenameInput({ initial, onDone, onCancel }: { initial: string; onDone: (name: string) => void; onCancel: () => void }) {
  const [value, setValue] = useState(initial);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);
  return (
    <input
      ref={ref}
      value={value}
      maxLength={MAX_REPORT_NAME}
      aria-label="Report name"
      onChange={(e) => setValue(e.target.value)}
      onFocus={(e) => e.currentTarget.select()}
      onBlur={() => onDone(value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          onDone(value);
        } else if (e.key === "Escape") {
          e.preventDefault();
          onCancel();
        }
      }}
      className="min-w-0 rounded-control border border-ink-900 bg-paper px-2 py-1 text-[13.5px] text-content-strong outline-none"
    />
  );
}
