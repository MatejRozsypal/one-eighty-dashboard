"use client";

/**
 * Home, Today: what needs a founder today, and nothing else.
 *
 * The greeting carries the count of open items, and a ring that closes as the
 * day's list is checked off (one rotation is an empty list). Under it, one
 * pill per source: how many items it raised, or n/a with the reason, so a
 * source that could not be read never looks like a quiet day. The list is
 * ordered by money at stake, then urgency, or grouped by client.
 *
 * Done lives in this browser only (localStorage, keyed on the Prague day the
 * list was built for) and resets the next day. Nothing is written anywhere
 * else: checking an item does not touch ClickUp, the warehouse or the app's
 * database.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { GoalRing } from "@/components/plan/GoalRing";
import { InfoTip } from "@/components/ui/InfoTip";
import { planStatusLabel, toneOfRow, toneVars } from "@/lib/plan/health";
import { HOME_TIME_ZONE, hourIn, longDate, partOfDay } from "@/lib/home/greeting";
import type { ClientLine, RuleKey, SourceCheck, TodayItem } from "@/lib/home/today/types";
import { ClientTable } from "./ClientTable";
import { DayRing, Chevron } from "./glyphs";
import { ItemRow } from "./ItemRow";
import { WeatherChip } from "./WeatherChip";

const STORE_KEY = "oe.home.today.done";
type Mode = "priority" | "client";

function loadDone(day: string): string[] {
  try {
    const raw = window.localStorage.getItem(STORE_KEY);
    if (!raw) return [];
    const v = JSON.parse(raw) as { day?: string; ids?: unknown };
    return v.day === day && Array.isArray(v.ids) ? v.ids.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function saveDone(day: string, ids: string[]): void {
  try {
    window.localStorage.setItem(STORE_KEY, JSON.stringify({ day, ids }));
  } catch {
    /* private window or blocked storage: done lasts for this visit only */
  }
}

function loadMode(): Mode | null {
  try {
    const v = window.localStorage.getItem(`${STORE_KEY}.mode`);
    return v === "client" || v === "priority" ? v : null;
  } catch {
    return null;
  }
}

function countLine(open: number, total: number): string {
  if (total === 0) return "Nothing needs you today";
  if (open === 0) return "All done for today";
  return `${open} ${open === 1 ? "thing needs" : "things need"} you today`;
}

function Hello({
  name,
  now,
  open,
  total,
  naSources,
}: {
  name: string | null;
  now: string;
  open: number;
  total: number;
  naSources: SourceCheck[];
}) {
  const [moment, setMoment] = useState(() => {
    const d = new Date(now);
    return { part: partOfDay(hourIn(d, HOME_TIME_ZONE)), date: longDate(d, HOME_TIME_ZONE) };
  });
  useEffect(() => {
    const local = new Date();
    setMoment({ part: partOfDay(local.getHours()), date: longDate(local) });
  }, []);

  return (
    <section className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between" aria-label="Today">
      <div className="flex min-w-0 flex-col gap-1.5">
        <span className="text-[13px] font-semibold uppercase tracking-[0.06em] text-content-muted">{moment.date}</span>
        <h2 className="m-0 text-[30px] font-bold leading-[1.1] tracking-heading text-content-strong sm:text-[34px]">
          {name ? `${moment.part}, ${name}` : moment.part}
        </h2>
        <p className="m-0 mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[17px] leading-[1.35] text-content-body">
          <DayRing done={total - open} total={total} />
          <span aria-live="polite" className="font-semibold text-content-strong">
            {countLine(open, total)}
          </span>
          {naSources.length > 0 && (
            <span className="inline-flex items-center gap-1 text-[13px] text-content-muted">
              {naSources.length} {naSources.length === 1 ? "check" : "checks"} n/a
              <InfoTip
                text={`Not read: ${naSources.map((s) => s.label).join(", ")}. The list may be missing items from ${
                  naSources.length === 1 ? "it" : "them"
                }.`}
                label="Checks that could not run"
              />
            </span>
          )}
        </p>
      </div>
      <WeatherChip />
    </section>
  );
}

function SourcePill({
  source,
  open,
  active,
  onClick,
}: {
  source: SourceCheck;
  open: number;
  active: boolean;
  onClick: () => void;
}) {
  if (source.status === "na") {
    return (
      <span className="inline-flex h-9 items-center gap-1.5 rounded-pill border border-dashed border-hairline-strong px-3.5 text-[13px] text-content-muted">
        {source.label}
        <span className="font-semibold">n/a</span>
        <InfoTip text={source.note} label={`Why ${source.label} is n/a`} />
      </span>
    );
  }
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      title={source.note}
      className={`inline-flex h-9 items-center gap-2 rounded-pill border px-3.5 text-[13px] font-semibold transition-colors duration-fast ${
        active
          ? "border-transparent bg-[var(--text-strong)] text-paper"
          : "border-hairline bg-surface-card text-content-strong shadow-xs hover:bg-[var(--gray-50)]"
      }`}
    >
      {source.label}
      <span
        className={`min-w-[22px] rounded-pill px-1.5 py-[1px] text-center text-[12px] tabular ${
          active ? "bg-paper/20 text-paper" : open > 0 ? "bg-[var(--gray-100)] text-content-strong" : "text-content-muted"
        }`}
      >
        {open > 0 ? open : "✓"}
      </span>
    </button>
  );
}

function Segmented({ mode, onChange }: { mode: Mode; onChange: (m: Mode) => void }) {
  const opt = (m: Mode, label: string) => (
    <button
      type="button"
      role="radio"
      aria-checked={mode === m}
      onClick={() => onChange(m)}
      className={`h-8 rounded-pill px-3.5 text-[13px] font-semibold transition-colors duration-fast ${
        mode === m ? "bg-surface-card text-content-strong shadow-xs" : "text-content-muted hover:text-content-strong"
      }`}
    >
      {label}
    </button>
  );
  return (
    <div role="radiogroup" aria-label="Group the list" className="inline-flex rounded-pill bg-[var(--gray-100)] p-[3px]">
      {opt("priority", "By priority")}
      {opt("client", "By client")}
    </div>
  );
}

interface Group {
  key: string;
  label: string | null;
  items: TodayItem[];
}

export function TodayInbox({
  items,
  sources,
  clients,
  clientsNote,
  day,
  name,
  now,
}: {
  items: TodayItem[];
  sources: SourceCheck[];
  clients: ClientLine[];
  clientsNote: string | null;
  day: string;
  name: string | null;
  now: string;
}) {
  const [done, setDone] = useState<string[]>([]);
  const [leaving, setLeaving] = useState<string[]>([]);
  const [mode, setMode] = useState<Mode>("priority");
  const [rule, setRule] = useState<RuleKey | null>(null);
  const [focusClient, setFocusClient] = useState<string | null>(null);
  const [showDone, setShowDone] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  useEffect(() => {
    setDone(loadDone(day));
    const m = loadMode();
    if (m) setMode(m);
  }, [day]);

  useEffect(() => {
    const t = timers.current;
    return () => t.forEach((h) => clearTimeout(h));
  }, []);

  const doneSet = useMemo(() => new Set(done), [done]);
  const leavingSet = useMemo(() => new Set(leaving), [leaving]);
  // Done ids from earlier versions of the list (an item that cleared) do not count.
  const ids = useMemo(() => new Set(items.map((i) => i.id)), [items]);
  const doneCount = done.filter((id) => ids.has(id)).length;
  const openItems = items.filter((i) => !doneSet.has(i.id) || leavingSet.has(i.id));
  const openCount = items.length - doneCount;

  const toggle = useCallback(
    (id: string) => {
      const isDone = doneSet.has(id);
      const next = isDone ? done.filter((x) => x !== id) : [...done, id];
      setDone(next);
      saveDone(day, next);
      if (!isDone) {
        // Drawn checked for a moment, then it joins the done list.
        setLeaving((l) => [...l, id]);
        const h = setTimeout(() => {
          setLeaving((l) => l.filter((x) => x !== id));
          timers.current.delete(id);
        }, 650);
        timers.current.set(id, h);
      } else {
        setLeaving((l) => l.filter((x) => x !== id));
      }
    },
    [day, done, doneSet]
  );

  const changeMode = (m: Mode) => {
    setMode(m);
    setFocusClient(null);
    try {
      window.localStorage.setItem(`${STORE_KEY}.mode`, m);
    } catch {
      /* not remembered */
    }
  };

  const openByRule = useMemo(() => {
    const out: Partial<Record<RuleKey, number>> = {};
    for (const i of items) {
      if (doneSet.has(i.id)) continue;
      const key: RuleKey = i.rule === "cm3_negative" ? "plan" : i.rule;
      out[key] = (out[key] ?? 0) + 1;
    }
    return out;
  }, [items, doneSet]);

  const openByClient = useMemo(() => {
    const out: Record<string, number> = {};
    for (const i of items) if (i.clientId && !doneSet.has(i.id)) out[i.clientId] = (out[i.clientId] ?? 0) + 1;
    return out;
  }, [items, doneSet]);

  const matches = (i: TodayItem) =>
    (rule === null || i.rule === rule || (rule === "plan" && i.rule === "cm3_negative")) &&
    (focusClient === null || i.clientId === focusClient);

  const visible = openItems.filter(matches);
  const doneItems = items.filter((i) => doneSet.has(i.id) && !leavingSet.has(i.id) && matches(i));

  const groups: Group[] = useMemo(() => {
    if (mode === "priority") return [{ key: "all", label: null, items: visible }];
    const map = new Map<string, Group>();
    for (const i of visible) {
      const key = i.clientId ?? "~agency";
      const g = map.get(key) ?? { key, label: i.clientName ?? "Agency", items: [] };
      g.items.push(i);
      map.set(key, g);
    }
    // Groups keep the list's own order: the first item of each is its most pressing.
    return Array.from(map.values());
  }, [mode, visible]);

  const pickClient = (clientId: string) => {
    setMode("client");
    setRule(null);
    setFocusClient(clientId);
    listRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const naSources = sources.filter((s) => s.status === "na");
  const filterLabel =
    focusClient !== null
      ? clients.find((c) => c.clientId === focusClient)?.name ?? focusClient
      : rule !== null
        ? sources.find((s) => s.key === rule)?.label ?? null
        : null;

  return (
    <div className="mx-auto flex w-full max-w-[940px] flex-col gap-6">
      <Hello name={name} now={now} open={openCount} total={items.length} naSources={naSources} />

      <nav aria-label="Sources" className="flex flex-wrap gap-2">
        {sources.map((s) => (
          <SourcePill
            key={s.key}
            source={s}
            open={openByRule[s.key] ?? 0}
            active={rule === s.key}
            onClick={() => {
              setFocusClient(null);
              setRule((r) => (r === s.key ? null : s.key));
            }}
          />
        ))}
      </nav>

      <div ref={listRef} className="flex scroll-mt-20 flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Segmented mode={mode} onChange={changeMode} />
          {filterLabel && (
            <button
              type="button"
              onClick={() => {
                setRule(null);
                setFocusClient(null);
              }}
              className="inline-flex h-8 items-center gap-1.5 rounded-pill bg-[var(--gray-100)] px-3 text-[13px] font-semibold text-content-strong hover:bg-[var(--gray-150)]"
            >
              {filterLabel}
              <span aria-hidden="true" className="text-content-muted">
                ×
              </span>
              <span className="sr-only">Clear filter</span>
            </button>
          )}
        </div>

        {visible.length === 0 ? (
          <div className="flex flex-col items-center gap-3 rounded-card border border-hairline bg-surface-card px-6 py-12 text-center shadow-sm">
            <DayRing done={1} total={1} size={44} />
            <span className="text-[17px] font-semibold text-content-strong">
              {items.length === 0 ? "Nothing needs you today" : filterLabel ? `Nothing open for ${filterLabel}` : "All done for today"}
            </span>
            {naSources.length > 0 && (
              <span className="text-[13px] text-content-muted">
                {naSources.map((s) => s.label).join(", ")} could not be checked.
              </span>
            )}
          </div>
        ) : (
          groups.map((g) => (
            <section key={g.key} aria-label={g.label ?? "Open items"} className="flex flex-col gap-2">
              {g.label && (
                <h3 className="m-0 flex items-center gap-2 px-1 pt-2 text-[17px] font-semibold tracking-heading text-content-strong">
                  {(() => {
                    const focus = clients.find((c) => c.clientId === g.key)?.focus ?? null;
                    return focus ? <GoalRing row={focus} periodType="month" tone={toneOfRow(focus)} size={24} /> : null;
                  })()}
                  {g.label}
                  <span className="text-[13px] font-semibold tabular text-content-muted">{g.items.length}</span>
                  {(() => {
                    const focus = clients.find((c) => c.clientId === g.key)?.focus ?? null;
                    return focus ? (
                      <span className="text-[13px] font-semibold" style={{ color: toneVars(toneOfRow(focus)).text }}>
                        {focus.metric === "cm3" ? "CM3" : "Revenue"} {planStatusLabel(focus).toLowerCase()}
                      </span>
                    ) : null;
                  })()}
                </h3>
              )}
              <ul className="m-0 list-none divide-y divide-[var(--border)] overflow-hidden rounded-card border border-hairline bg-surface-card p-0 shadow-sm">
                {g.items.map((i) => (
                  <ItemRow
                    key={i.id}
                    item={i}
                    done={doneSet.has(i.id)}
                    leaving={leavingSet.has(i.id)}
                    showClient={mode === "priority"}
                    onToggle={toggle}
                  />
                ))}
              </ul>
            </section>
          ))
        )}

        {doneItems.length > 0 && (
          <div className="flex flex-col gap-2">
            <button
              type="button"
              onClick={() => setShowDone((v) => !v)}
              aria-expanded={showDone}
              className="inline-flex w-fit items-center gap-1.5 px-1 py-1 text-[13px] font-semibold text-content-muted hover:text-content-strong"
            >
              <Chevron open={showDone} />
              Done today
              <span className="tabular">{doneItems.length}</span>
            </button>
            {showDone && (
              <ul className="m-0 list-none divide-y divide-[var(--border)] overflow-hidden rounded-card border border-hairline bg-surface-card p-0 shadow-sm">
                {doneItems.map((i) => (
                  <ItemRow key={i.id} item={i} done leaving={false} showClient onToggle={toggle} />
                ))}
              </ul>
            )}
          </div>
        )}
      </div>

      <section aria-label="Clients" className="flex flex-col gap-3 pt-2">
        <h3 className="m-0 px-1 text-[17px] font-semibold leading-[1.3] tracking-heading text-content-strong">Clients</h3>
        <ClientTable clients={clients} note={clientsNote} openByClient={openByClient} onPick={pickClient} />
      </section>
    </div>
  );
}
