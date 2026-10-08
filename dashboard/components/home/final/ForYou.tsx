"use client";

/**
 * For you, per person: client alerts (one rule, one client, one fact, one
 * link, money at stake first, at most two per rule and six in all) and the
 * person's most pressing ClickUp tasks (at most five), interleaved by urgency
 * (lib/home/alerts/model.ts, lib/home/alerts/tasks.ts).
 *
 * Every card can be dismissed, or snoozed for 7 days, for the signed-in
 * person only. The change shows at once and is saved in the background, and
 * undone if the save fails.
 */

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AppLink } from "@/components/ui/AppLink";
import { InfoTip } from "@/components/ui/InfoTip";
import { SectionTitle } from "@/components/plan/SectionTitle";
import { formatMoney } from "@/lib/format";
import { toneVars } from "@/lib/plan/health";
import {
  SNOOZE_DAYS,
  arrange,
  interleave,
  pragueDate,
  splitDismissals,
  taskHidden,
  type AlertCard,
  type ArrangedCard,
  type Dismissal,
} from "@/lib/home/alerts/model";
import { MAX_TASKS, lateLabel, type TaskCard } from "@/lib/home/alerts/tasks";
import type { RecTone } from "@/lib/home/shopify/types";
import { dismissAlertAction, undoDismissAction } from "@/app/(app)/home/actions";

const RULES_TIP =
  "Client cards: one rule each on warehouse or ClickUp data (behind plan, below last year, unmapped ads, promo ending, over capacity, slow verdicts, briefs to write, missing cost data), ordered by money at stake. Task cards: your ClickUp tasks, overdue first, then due today, due within 2 days, urgent or high without a due date. Dismissing hides a card for you only; a client card returns when its money at stake grows by more than 25% or its severity rises, a task card when its due date or status changes.";

const SOURCES_TIP =
  "Daily at 05:10 (mart.home_alerts): behind plan, below last year, unmapped ads, promo ending, missing cost data. Live on every load: over capacity, slow verdicts, briefs to write, your ClickUp tasks.";

const TZ = "Europe/Prague";
const TIME = new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hour12: false });
const DAY_TIME = new Intl.DateTimeFormat("en-GB", { timeZone: TZ, day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false });
const DAY = new Intl.DateTimeFormat("en-GB", { timeZone: TZ, day: "numeric", month: "short" });

function updatedLabel(iso: string, now: string): string {
  return pragueDate(iso) === pragueDate(now) ? `Updated ${TIME.format(new Date(iso))}` : `Updated ${DAY_TIME.format(new Date(iso))}`;
}

function whenLabel(iso: string, now: string): string {
  const d = pragueDate(iso);
  const today = pragueDate(now);
  const yesterday = pragueDate(new Date(Date.parse(now) - 86_400_000).toISOString());
  return d === today ? "today" : d === yesterday ? "yesterday" : `on ${DAY.format(new Date(iso))}`;
}

/** "lukas@oneeighty.cz" -> "Lukas". */
function personName(email: string): string {
  const head = email.split("@")[0]?.split(/[._-]/)[0] ?? email;
  return head ? head[0]!.toUpperCase() + head.slice(1) : email;
}

function othersTip(list: Dismissal[], now: string): string {
  return list
    .map((d) => `${personName(d.userEmail)} ${d.snoozeUntil ? "snoozed" : "dismissed"} it ${whenLabel(d.dismissedAt, now)}.`)
    .join(" ");
}

function ownTip(d: Dismissal, now: string): string {
  return d.snoozeUntil
    ? `You snoozed it ${whenLabel(d.dismissedAt, now)}. Back on ${DAY.format(new Date(d.snoozeUntil))}.`
    : `You dismissed it ${whenLabel(d.dismissedAt, now)}.`;
}

function openLabel(days: number): string {
  return `Open ${days} ${days === 1 ? "day" : "days"}`;
}

/* ------------------------------------------------------------------------ */
/* Controls                                                                 */
/* ------------------------------------------------------------------------ */

const ICON_BUTTON =
  "inline-flex h-7 w-7 flex-none items-center justify-center rounded-full text-content-muted hover:bg-bg-subtle hover:text-content-strong focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1";
const MENU_ITEM = "block w-full rounded-lg px-3 py-1.5 text-left text-[13px] font-medium text-content-strong hover:bg-bg-subtle";

interface Controls {
  onDismiss: () => void;
  onSnooze: () => void;
}

function CardControls({ onDismiss, onSnooze }: Controls) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative -my-1 -mr-1.5 flex flex-none items-center">
      <button type="button" className={ICON_BUTTON} aria-label="More" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <circle cx="5" cy="12" r="1.8" />
          <circle cx="12" cy="12" r="1.8" />
          <circle cx="19" cy="12" r="1.8" />
        </svg>
      </button>
      <button type="button" className={ICON_BUTTON} aria-label="Dismiss" title="Dismiss" onClick={onDismiss}>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" aria-hidden="true">
          <path d="M6 6l12 12M18 6L6 18" />
        </svg>
      </button>
      {open && (
        <div role="menu" className="absolute right-0 top-8 z-20 min-w-[150px] rounded-xl border border-hairline bg-surface-card p-1 shadow-md">
          <button type="button" role="menuitem" className={MENU_ITEM} onClick={() => {
              setOpen(false);
              onSnooze();
            }}>
            Snooze {SNOOZE_DAYS} days
          </button>
          <button type="button" role="menuitem" className={MENU_ITEM} onClick={() => {
              setOpen(false);
              onDismiss();
            }}>
            Dismiss
          </button>
        </div>
      )}
    </div>
  );
}

function Chevron() {
  return (
    <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M9 6l6 6-6 6" />
    </svg>
  );
}

const ACTION = "inline-flex flex-none items-center gap-1 rounded-full bg-bg-subtle px-3 py-1.5 text-[13px] font-semibold text-content-strong hover:bg-gray-150";
const CARD = "flex min-w-0 flex-col gap-3 rounded-card border border-hairline bg-surface-card p-[18px] shadow-sm sm:p-5";

function RuleLine({ tone, label, children }: { tone: RecTone; label: string; children?: ReactNode }) {
  const t = toneVars(tone);
  return (
    <div className="flex min-w-0 items-center gap-2">
      <div className="flex min-w-0 flex-1 items-center gap-2 text-[12px] font-semibold uppercase tracking-[0.06em]" style={{ color: t.text }}>
        <span aria-hidden="true" className="h-2 w-2 flex-none rounded-full" style={{ background: t.graphic }} />
        <span className="truncate">{label}</span>
      </div>
      {children}
    </div>
  );
}

/* ------------------------------------------------------------------------ */
/* Cards                                                                    */
/* ------------------------------------------------------------------------ */

function AlertCardView({ r, controls, now }: { r: ArrangedCard; controls: Controls | null; now: string }) {
  const tone = toneVars(r.tone);
  return (
    <article className={CARD}>
      <RuleLine tone={r.tone} label={r.rule}>
        {r.others.length > 0 && <InfoTip text={othersTip(r.others, now)} label="Dismissed by a teammate" />}
        {r.daysOpen !== null && <span className="flex-none text-[12px] text-content-muted tabular">{openLabel(r.daysOpen)}</span>}
        {controls && <CardControls {...controls} />}
      </RuleLine>
      {r.back && (
        <span className="-mt-1 self-start rounded-full px-2 py-0.5 text-[11.5px] font-semibold" style={{ color: tone.text, background: tone.tint }}>
          Back: worse since dismissed
        </span>
      )}
      <div className="flex min-w-0 flex-col gap-1">
        <h3 className="m-0 truncate text-[17px] font-semibold leading-[1.25] text-content-strong">{r.client}</h3>
        <p className="m-0 text-[14.5px] leading-[1.45] text-content-body">{r.fact}</p>
        {r.detail && <p className="m-0 text-[13px] leading-[1.4] text-content-muted tabular">{r.detail}</p>}
      </div>
      <div className="mt-auto flex items-end justify-between gap-3 border-t border-hairline pt-3">
        {r.stake ? (
          <div className="flex min-w-0 flex-col">
            <span className="text-[12px] text-content-muted">{r.stake.label}</span>
            <span className="text-[19px] font-bold leading-[1.2] tracking-heading tabular text-content-strong">
              {formatMoney(r.stake.value, r.stake.currency)}
            </span>
          </div>
        ) : (
          <span />
        )}
        <AppLink href={r.href} className={ACTION}>
          {r.action}
          <Chevron />
        </AppLink>
      </div>
    </article>
  );
}

const FLAG: Record<string, RecTone> = { urgent: "negative", high: "warning" };

function Avatars({ t }: { t: TaskCard }) {
  const shown = t.task.assignees.slice(0, 4);
  return (
    <div className="flex items-center -space-x-1.5">
      {shown.map((a) =>
        a.avatar ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img key={a.id} src={a.avatar} alt={a.name} title={a.name} className="h-6 w-6 rounded-full border-2 border-surface-card object-cover" />
        ) : (
          <span
            key={a.id}
            title={a.name}
            className="inline-flex h-6 w-6 items-center justify-center rounded-full border-2 border-surface-card text-[10px] font-bold text-white"
            style={{ background: a.color ?? "var(--h-neutral)" }}
          >
            {a.initials}
          </span>
        )
      )}
      {t.task.assignees.length > shown.length && (
        <span className="pl-2.5 text-[12px] text-content-muted">+{t.task.assignees.length - shown.length}</span>
      )}
    </div>
  );
}

function TaskCardView({ t, controls }: { t: TaskCard; controls: Controls | null }) {
  const where = [t.task.folderName, t.task.listName].filter(Boolean).join(" · ") || "n/a";
  const flag = t.task.priority ? FLAG[t.task.priority] : undefined;
  return (
    <article className={CARD}>
      <RuleLine tone={t.tone} label={lateLabel(t)}>
        {flag && (
          <span className="flex flex-none items-center gap-1 text-[12px] font-semibold capitalize" style={{ color: toneVars(flag).text }}>
            <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M5 3h2v18H5zM8 4h11l-2.5 4L19 12H8z" />
            </svg>
            {t.task.priority}
          </span>
        )}
        {controls && <CardControls {...controls} />}
      </RuleLine>
      <div className="flex min-w-0 flex-col gap-1">
        <span className="truncate text-[12.5px] font-medium text-content-muted">{where}</span>
        <h3 className="m-0 line-clamp-2 text-[16px] font-semibold leading-[1.3] text-content-strong">{t.task.name}</h3>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-content-muted tabular">
          <span className="inline-flex items-center gap-1.5">
            <span aria-hidden="true" className="h-2 w-2 rounded-full" style={{ background: t.task.statusColor ?? "var(--h-neutral)" }} />
            <span>{t.task.status ? t.task.status[0]!.toUpperCase() + t.task.status.slice(1) : "n/a"}</span>
          </span>
          <span>{t.dueDate ? `Due ${DAY.format(new Date(`${t.dueDate}T12:00:00Z`))}` : "No due date"}</span>
        </div>
      </div>
      <div className="mt-auto flex items-center justify-between gap-3 border-t border-hairline pt-3">
        <Avatars t={t} />
        <a href={t.task.url} target="_blank" rel="noreferrer" className={ACTION}>
          Open in ClickUp
          <Chevron />
        </a>
      </div>
    </article>
  );
}

/* ------------------------------------------------------------------------ */
/* Section                                                                  */
/* ------------------------------------------------------------------------ */

export interface ForYouProps {
  me: string;
  cards: AlertCard[];
  mine: Dismissal[];
  others: Dismissal[];
  tasks: TaskCard[] | null;
  tasksNote: string | null;
  dismissNote: string | null;
  mode: "snapshot" | "live";
  updatedAt: string | null;
  liveNote: string | null;
  now: string;
}

type Item = { kind: "alert"; tone: RecTone; card: ArrangedCard } | { kind: "task"; tone: RecTone; task: TaskCard };

type HiddenRow = { key: string; label: string; title: string; dismissal: Dismissal };

export function ForYou({ me, cards, mine: initialMine, others: initialOthers, tasks, tasksNote, dismissNote, mode, updatedAt, liveNote, now }: ForYouProps) {
  const [mine, setMine] = useState(() => new Map(initialMine.map((d) => [d.alertKey, d])));
  const others = useMemo(() => splitDismissals(initialOthers, me).others, [initialOthers, me]);
  const [showDismissed, setShowDismissed] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { items, hidden } = useMemo(() => {
    const a = arrange(cards, mine, others, now);
    const openTasks = (tasks ?? []).filter((t) => !taskHidden(t.fingerprint, mine.get(t.alertKey), now));
    const hiddenTasks = (tasks ?? []).filter((t) => taskHidden(t.fingerprint, mine.get(t.alertKey), now));
    const merged = interleave<Item, Item>(
      a.cards.map((card) => ({ kind: "alert", tone: card.tone, card })),
      openTasks.slice(0, MAX_TASKS).map((task) => ({ kind: "task", tone: task.tone, task }))
    );
    const rows: HiddenRow[] = [
      ...a.dismissed.map(({ card, dismissal }) => ({ key: card.alertKey, label: `${card.rule} · ${card.client}`, title: card.fact, dismissal })),
      ...hiddenTasks.map((t) => ({ key: t.alertKey, label: `Task · ${t.task.listName ?? "ClickUp"}`, title: t.task.name, dismissal: mine.get(t.alertKey)! })),
    ].sort((x, y) => y.dismissal.dismissedAt.localeCompare(x.dismissal.dismissedAt));
    return { items: merged, hidden: rows };
  }, [cards, mine, others, tasks, now]);

  const canDismiss = dismissNote === null && me !== "";

  function put(key: string, d: Dismissal | undefined) {
    setMine((m) => {
      const next = new Map(m);
      if (d) next.set(key, d);
      else next.delete(key);
      return next;
    });
  }

  function dismiss(input: { key: string; value: number | null; severity: RecTone | null; fingerprint: string | null }, snooze: boolean) {
    const before = mine.get(input.key);
    const at = new Date();
    put(input.key, {
      alertKey: input.key,
      userEmail: me,
      dismissedAt: at.toISOString(),
      snoozeUntil: snooze ? new Date(at.getTime() + SNOOZE_DAYS * 86_400_000).toISOString() : null,
      valueAtDismiss: input.value,
      severityAtDismiss: input.severity,
      fingerprint: input.fingerprint,
    });
    setError(null);
    void (async () => {
      try {
        const res = await dismissAlertAction({ alertKey: input.key, snooze, value: input.value, severity: input.severity, fingerprint: input.fingerprint });
        if (res.ok && res.dismissal) put(input.key, res.dismissal);
        else throw new Error(res.error ?? "Not saved.");
      } catch {
        put(input.key, before);
        setError("Not saved. Try again.");
      }
    })();
  }

  function undo(key: string) {
    const before = mine.get(key);
    put(key, undefined);
    setError(null);
    void (async () => {
      try {
        const res = await undoDismissAction(key);
        if (!res.ok) throw new Error(res.error ?? "Not saved.");
      } catch {
        put(key, before);
        setError("Not saved. Try again.");
      }
    })();
  }

  const alertControls = (c: AlertCard): Controls | null =>
    canDismiss
      ? {
          onDismiss: () => dismiss({ key: c.alertKey, value: c.stake?.value ?? null, severity: c.tone, fingerprint: null }, false),
          onSnooze: () => dismiss({ key: c.alertKey, value: c.stake?.value ?? null, severity: c.tone, fingerprint: null }, true),
        }
      : null;
  const taskControls = (t: TaskCard): Controls | null =>
    canDismiss
      ? {
          onDismiss: () => dismiss({ key: t.alertKey, value: null, severity: null, fingerprint: t.fingerprint }, false),
          onSnooze: () => dismiss({ key: t.alertKey, value: null, severity: null, fingerprint: t.fingerprint }, true),
        }
      : null;

  return (
    <section aria-label="For you" className="flex flex-col gap-3.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <SectionTitle>For you</SectionTitle>
          <InfoTip text={RULES_TIP} label="About these cards" />
        </div>
        <div className="flex items-center gap-1 text-[12.5px] text-content-muted tabular">
          {mode === "snapshot" && updatedAt ? (
            <>
              <span>{updatedLabel(updatedAt, now)}</span>
              <InfoTip text={SOURCES_TIP} label="When these cards are computed" />
            </>
          ) : (
            <>
              <span>Live</span>
              <InfoTip text={liveNote ?? "Computed on this load."} label="Why live" />
            </>
          )}
        </div>
      </div>

      {items.length === 0 ? (
        <div className="rounded-card border border-hairline bg-surface-card px-5 py-6 text-center text-[14px] text-content-muted shadow-sm">
          Nothing flagged
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-[18px] md:grid-cols-2 xl:grid-cols-3">
          {items.map((it) =>
            it.kind === "alert" ? (
              <AlertCardView key={it.card.alertKey} r={it.card} controls={alertControls(it.card)} now={now} />
            ) : (
              <TaskCardView key={it.task.alertKey} t={it.task} controls={taskControls(it.task)} />
            )
          )}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        {tasks === null && (
          <span className="inline-flex items-center gap-1 text-[13px] text-content-muted">
            Your ClickUp tasks: n/a
            <InfoTip text={tasksNote ?? "ClickUp could not be read."} label="Why n/a" />
          </span>
        )}
        {hidden.length > 0 && (
          <button
            type="button"
            aria-expanded={showDismissed}
            onClick={() => setShowDismissed((v) => !v)}
            className="text-[13px] font-semibold text-content-muted hover:text-content-strong"
          >
            Dismissed ({hidden.length})
          </button>
        )}
        {error && (
          <span role="status" className="text-[13px] font-medium" style={{ color: "var(--h-negative-text)" }}>
            {error}
          </span>
        )}
      </div>

      {showDismissed && hidden.length > 0 && (
        <ul className="m-0 flex list-none flex-col divide-y divide-hairline rounded-card border border-hairline bg-surface-card p-0 shadow-sm">
          {hidden.map((row) => (
            <li key={row.key} className="flex items-center gap-3 px-4 py-3">
              <div className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-[12px] font-semibold uppercase tracking-[0.06em] text-content-muted">{row.label}</span>
                <span className="truncate text-[14px] text-content-body">{row.title}</span>
              </div>
              <InfoTip text={ownTip(row.dismissal, now)} label="When you dismissed it" />
              <button type="button" onClick={() => undo(row.key)} className={ACTION}>
                Undo
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
