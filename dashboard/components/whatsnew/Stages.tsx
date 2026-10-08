"use client";

/**
 * The five beats: copy, timing and the mock each one animates.
 *
 * ── Why the mocks are rebuilt rather than screenshotted ───────────────────
 * No image, no video, no GIF. Each mock is DOM drawn with the app's own
 * tokens, which buys three things an asset cannot: it is a couple of KB
 * instead of a couple of MB, it is crisp at any pixel density, and when the
 * design system moves the mock moves with it, so the tour cannot drift into
 * showing a product that no longer exists.
 *
 * The ring in beat three goes further and imports the real geometry constants
 * from `lib/plan/health.ts`, so it is not a drawing of the ring, it is the
 * ring, at the same radius and stroke, with an illustrative arc on it.
 *
 * ── The "before" state ───────────────────────────────────────────────────
 * The before is the dashboard as it stood before the nav icons and before the
 * reporting suite, not yesterday's build, so the sequence shows the whole arc
 * of the change rather than its last day.
 *
 * It is a reconstruction, not a capture: the app cannot be rendered without
 * Google SSO and a warehouse connection, so there was no old frame to
 * photograph. It is built to the real thing's own values, read out of git
 * history, and the numbers below are those values rather than approximations:
 *
 *   nav rows        13.5px, #B8B8BF, no icon, a 5px green bar when active
 *   group labels    10px monospace, uppercase, 0.14em, #6A6A72
 *   Paid's views    a tab row above the page, underlined, 14px
 *   date control    a bordered button, a calendar emoji, the range in mono
 *   compare         a grey segmented group, monospace, uppercase label
 *   status          a monospace uppercase pill, 10.5px, 0.04em, fully round
 *   page            #F6F6F3, the off white with a green cast
 *
 * ── The figures ──────────────────────────────────────────────────────────
 * Every number in here is an invented round number and is captioned
 * "Example". None of it is any client's data, and none of it is fetched.
 */

import { RING_BOX, RING_RADIUS, RING_STROKE } from "@/lib/plan/health";
import {
  CalendarIcon,
  CompareIcon,
  CurrencyIcon,
} from "@/components/controls/Pill";

/**
 * The old monospace, named explicitly rather than taken from `--font-mono`.
 *
 * The overlay carries the `oe-health` scope so it is drawn in the new
 * language, and that scope deliberately repoints `--font-mono` at Inter. So a
 * "before" mock that asked for the mono token would render in the new face and
 * quietly undo the point of beat five.
 */
const OLD_MONO = 'ui-monospace, "SF Mono", Menlo, Consolas, monospace';

/* ====================================================================== */
/* Beat list                                                              */
/* ====================================================================== */

export interface Beat {
  title: string;
  body: string;
  /** The before and after of this change, for the reduced-motion summary. */
  before: string;
  after: string;
}

/**
 * The beats, in order.
 *
 * There are no durations here any more. Each beat's transition plays in
 * roughly 0.6 to 1.3 seconds when it is entered and then the beat simply
 * stays, because the person steps it. The ordering is still deliberate: the
 * sidebar first because it is the change somebody notices before they have
 * clicked anything, then the two Goals changes together, then the controls,
 * then the surface, which is the one that needs no explaining at all.
 */
export const BEATS: Beat[] = [
  {
    title: "The sidebar carries the whole app",
    body: "Every section has an icon now, with its pages indented underneath it. The Paid and Creative views moved out of the tab row above the page and into the menu, and Reports is new.",
    before:
      "A flat list of text links. Paid's views sat in a tab row above the page, and there was no Reports.",
    after:
      "An icon for every section, its pages indented underneath, and Reports in the list.",
  },
  {
    title: "Goals is one page",
    body: "Targets lived in a Settings form, and pacing lived on a separate Plan page. It is one Goals page now, carrying CM3 and aMER beside revenue, orders, new customers and ad spend.",
    before:
      "Targets typed into a Settings form and read on one page, with pacing on a separate Plan page.",
    after:
      "One Goals page, carrying CM3 and aMER alongside revenue, orders, new customers and ad spend.",
  },
  {
    title: "Status became a ring",
    body: "One full turn of the ring is the goal for the period, and the dot marks where the plan says you should be today. The gap between them is what is missing.",
    before:
      "A small uppercase pill, which named the status but gave no sense of how far through the goal you were.",
    after:
      "A ring per metric with a plan marker, in five states: off track, behind, under plan, on track and no target.",
  },
  {
    title: "Pick a period properly",
    body: "Period, comparison, delta and currency are pills with icons now. The presets run from today to all time, and the calendar takes any range you like.",
    before:
      "A bordered button with the dates on it, and grey segmented groups beside it. Today was not offered as a preset.",
    after:
      "Pills with an icon each, presets from today to all time, and a two month calendar for a custom range.",
  },
  {
    title: "A calmer page",
    body: "The page lost its green cast for a plain neutral, the cards softened, and labels and figures are set in Inter instead of a monospace.",
    before:
      "A green tinted off white page, with labels and figures in a monospace.",
    after: "A neutral page, softer cards, and Inter in place of the monospace.",
  },
];

export const CLOSING = {
  title: "That is the new dashboard",
  body: "Nothing moved out of reach. The same numbers, easier to read.",
};

/* ====================================================================== */
/* Shared bits                                                            */
/* ====================================================================== */

/** Marks a mock as invented, so no figure in here can be read as real. */
function ExampleTag() {
  return (
    <span className="absolute right-1.5 top-1.5 rounded-[999px] bg-gray-100 px-2 py-[3px] text-[9px] font-semibold uppercase tracking-[0.1em] text-content-muted">
      Example
    </span>
  );
}

/** The caption over a mock that names which state it is. */
function StateLabel({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-content-muted">
      {children}
    </span>
  );
}

/**
 * The stage frame: the before layer and the after layer stacked in the same
 * cell so they swap in place. Both are absolutely positioned and centred, so
 * neither one's height decides where the other sits.
 */
/**
 * The stage box is one fixed height for every beat, so the panel does not
 * resize as somebody steps through it.
 *
 * 262px is the tallest mock (the new sidebar, at 258) plus a little. The two
 * layers are absolutely positioned, so a mock taller than this box does not
 * push it open, it simply gets cut off by the stage's `overflow-hidden`, which
 * is how the sidebar's Reports row was being shaved. If a future beat is
 * taller than this, raise the number here and in the two stages below that set
 * their own height.
 */
function Swap({
  before,
  after,
  afterDelay = 0,
}: {
  before: React.ReactNode;
  after: React.ReactNode;
  /** Holds the "before" on screen longer when a beat needs reading time. */
  afterDelay?: number;
}) {
  return (
    <div className="relative flex h-[262px] w-full items-center justify-center">
      <div className="wn-before absolute inset-0 flex items-center justify-center">
        {before}
      </div>
      <div
        className="wn-after absolute inset-0 flex items-center justify-center"
        style={afterDelay ? { animationDelay: `${afterDelay}ms` } : undefined}
      >
        {after}
      </div>
    </div>
  );
}

const ICON = {
  width: 14,
  height: 14,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.7,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

/** The dark nav panel both nav mocks sit in. */
function NavPanel({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-px rounded-[12px] bg-ink-900 px-2.5 py-2">
      {children}
    </div>
  );
}

function NavGroupLabel({ children }: { children: React.ReactNode }) {
  return (
    <span
      className="px-1.5 pb-0.5 pt-1 text-[9px] uppercase text-gray-400"
      style={{ fontFamily: OLD_MONO, letterSpacing: "0.14em" }}
    >
      {children}
    </span>
  );
}

/* ====================================================================== */
/* Beat 1: the sidebar                                                    */
/* ====================================================================== */

/**
 * The old nav: grouped, but flat inside each group. No icons anywhere, only a
 * 5px green bar on the active row. Paid had no children, so its four views
 * lived in a tab row above the page.
 */
function NavBefore() {
  const groups: Array<[string, string[]]> = [
    ["Profitability", ["Snapshot", "Goals", "Orders"]],
    ["Marketing", ["Paid", "Email"]],
  ];
  return (
    <div className="flex w-full max-w-[290px] flex-col gap-1.5">
      <StateLabel>Before</StateLabel>
      <NavPanel>
        {groups.map(([group, rows]) => (
          <span key={group} className="flex flex-col gap-px">
            <NavGroupLabel>{group}</NavGroupLabel>
            {rows.map((label) => {
              const active = label === "Goals";
              return (
                <span
                  key={label}
                  className={`flex items-center gap-[7px] rounded-[8px] px-1.5 py-[5px] text-[12.5px] leading-[1.3] ${
                    active
                      ? "bg-accent/[0.14] font-semibold text-growth-300"
                      : "text-gray-250"
                  }`}
                >
                  {/* The only mark a row had: a bar, not an icon. */}
                  <span
                    className={`h-[13px] w-[4px] flex-none rounded-[3px] ${
                      active ? "bg-accent" : "bg-transparent"
                    }`}
                  />
                  <span className="truncate">{label}</span>
                </span>
              );
            })}
          </span>
        ))}
      </NavPanel>

      {/* Where Paid's views used to live: underlined tabs above the page. */}
      <div className="flex items-end gap-3 overflow-hidden border-b border-hairline px-1">
        {["Overview", "Meta", "Google", "GA4"].map((t, i) => (
          <span
            key={t}
            className={`-mb-px whitespace-nowrap border-b-2 pb-1.5 text-[10.5px] ${
              i === 0
                ? "border-accent font-medium text-content-strong"
                : "border-transparent text-content-muted"
            }`}
          >
            {t}
          </span>
        ))}
      </div>
    </div>
  );
}

/** The new nav: an icon per section, pages indented, Reports added. */
function NavAfter() {
  const profitability: Array<{
    label: string;
    icon: React.ReactNode;
    delay: number;
    active?: boolean;
  }> = [
    {
      label: "Snapshot",
      delay: 0,
      icon: (
        <>
          <rect x="3.5" y="3.5" width="7" height="8" rx="1.6" />
          <rect x="13.5" y="3.5" width="7" height="5" rx="1.6" />
          <rect x="13.5" y="11.5" width="7" height="9" rx="1.6" />
          <rect x="3.5" y="14.5" width="7" height="6" rx="1.6" />
        </>
      ),
    },
    {
      label: "Goals",
      delay: 60,
      active: true,
      icon: (
        <>
          <circle cx="12" cy="12" r="8.5" />
          <circle cx="12" cy="12" r="4.5" />
          <circle cx="12" cy="12" r="0.9" />
        </>
      ),
    },
  ];

  return (
    <div className="flex w-full max-w-[290px] flex-col gap-1.5">
      <StateLabel>After</StateLabel>
      <NavPanel>
        <NavGroupLabel>Profitability</NavGroupLabel>
        {profitability.map((item) => (
          <span
            key={item.label}
            className={`flex items-center gap-[7px] rounded-[8px] px-1.5 py-[4px] text-[12.5px] leading-[1.3] ${
              item.active
                ? "bg-accent/[0.14] font-semibold text-growth-300"
                : "text-gray-250"
            }`}
          >
            <span
              className="wn-nav-icon flex-none"
              style={{ animationDelay: `${item.delay}ms` }}
            >
              <svg {...ICON} aria-hidden="true">
                {item.icon}
              </svg>
            </span>
            <span className="truncate">{item.label}</span>
          </span>
        ))}

        <NavGroupLabel>Marketing</NavGroupLabel>
        <span className="flex items-center gap-[7px] rounded-[8px] px-1.5 py-[4px] text-[12.5px] leading-[1.3] text-gray-250">
          <span
            className="wn-nav-icon flex-none"
            style={{ animationDelay: "120ms" }}
          >
            <svg {...ICON} aria-hidden="true">
              <path d="M4 10v4a1 1 0 0 0 1 1h2.5l8 4V5l-8 4H5a1 1 0 0 0-1 1z" />
              <path d="M19 9.5a3.5 3.5 0 0 1 0 5" />
            </svg>
          </span>
          <span className="truncate">Paid</span>
        </span>

        {/* The four views that used to be a tab row, now indented pages. */}
        <span
          className="wn-nav-children flex flex-col gap-px"
          style={{ animationDelay: "280ms" }}
        >
          {["Overview", "Meta", "Google", "GA4"].map((child) => (
            <span
              key={child}
              className="truncate py-[2px] pl-[22px] text-[11px] leading-[1.3] text-gray-400"
            >
              {child}
            </span>
          ))}
        </span>

        {/* Reports did not exist before, so it arrives rather than fades in. */}
        <span
          className="wn-nav-new flex items-center gap-[7px] rounded-[8px] px-1.5 py-[4px] text-[12.5px] leading-[1.3] text-gray-250"
          style={{ animationDelay: "440ms" }}
        >
          <span className="flex-none">
            <svg {...ICON} aria-hidden="true">
              <rect x="4" y="3.5" width="16" height="17" rx="2.4" />
              <path d="M8 9h8M8 12.5h8M8 16h4.5" />
            </svg>
          </span>
          <span className="truncate">Reports</span>
          <span className="ml-auto flex-none rounded-[999px] bg-accent/25 px-1.5 py-[1px] text-[8.5px] font-semibold uppercase tracking-[0.08em] text-growth-300">
            New
          </span>
        </span>
      </NavPanel>
    </div>
  );
}

/* ====================================================================== */
/* Beat 2: two pages becoming one                                         */
/* ====================================================================== */

function MiniCard({
  title,
  lines,
  className = "",
}: {
  title: string;
  lines: string[];
  className?: string;
}) {
  return (
    <div
      className={`flex w-[132px] flex-none flex-col gap-1.5 rounded-[14px] border border-hairline bg-paper p-3 shadow-xs ${className}`}
    >
      <span className="truncate text-[11px] font-semibold text-content-strong">
        {title}
      </span>
      {lines.map((l) => (
        <span key={l} className="truncate text-[9.5px] text-content-muted">
          {l}
        </span>
      ))}
    </div>
  );
}

function GoalsBefore() {
  return (
    <div className="flex w-full flex-col items-center gap-2">
      <StateLabel>Before</StateLabel>
      <div className="flex items-start justify-center gap-3">
        <MiniCard
          className="wn-merge-left"
          title="Settings form"
          lines={["Revenue", "Orders", "New customers", "CM3"]}
        />
        <MiniCard
          className="wn-merge-right"
          title="Plan"
          lines={["Revenue", "Orders", "New customers", "Ad spend"]}
        />
      </div>
    </div>
  );
}

function GoalsAfter() {
  // Six chips. The two at the end are new to the page, so they land last and
  // carry the accent.
  const chips = [
    { label: "Revenue", isNew: false },
    { label: "Orders", isNew: false },
    { label: "New customers", isNew: false },
    { label: "Ad spend", isNew: false },
    { label: "CM3", isNew: true },
    { label: "aMER", isNew: true },
  ];
  return (
    <div className="flex w-full flex-col items-center gap-2">
      <StateLabel>After</StateLabel>
      <div className="wn-merged flex w-full max-w-[300px] flex-col gap-2.5 rounded-[18px] border border-hairline bg-paper p-3.5 shadow-sm">
        <span className="text-[12.5px] font-semibold text-content-strong">
          Goals
        </span>
        <span className="flex flex-wrap gap-1.5">
          {chips.map((chip, i) => (
            <span
              key={chip.label}
              className="wn-chip rounded-[999px] px-2.5 py-[5px] text-[10.5px] font-medium"
              style={{
                animationDelay: `${420 + i * 70}ms`,
                background: chip.isNew
                  ? "var(--h-positive-tint)"
                  : "var(--gray-100)",
                color: chip.isNew
                  ? "var(--h-positive-text)"
                  : "var(--text-body)",
              }}
            >
              {chip.label}
            </span>
          ))}
        </span>
      </div>
    </div>
  );
}

/* ====================================================================== */
/* Beat 3: the pill becoming a ring                                       */
/* ====================================================================== */

/* The ring's own numbers, from the product's constants rather than redrawn. */
const RING_C = 2 * Math.PI * RING_RADIUS;
/** Illustrative: 46% of the period goal reached. */
const ARC_FRACTION = 0.46;
/** Illustrative: the plan wants 72% by today, so the dot sits ahead of the arc. */
const MARK_FRACTION = 0.72;

function markPoint(fraction: number) {
  const angle = (-90 + fraction * 360) * (Math.PI / 180);
  const centre = RING_BOX / 2;
  return {
    x: centre + RING_RADIUS * Math.cos(angle),
    y: centre + RING_RADIUS * Math.sin(angle),
  };
}

function StatusBefore() {
  return (
    <div className="flex w-full flex-col items-center gap-2">
      <StateLabel>Before</StateLabel>
      <div className="flex w-full max-w-[250px] flex-col gap-1.5 rounded-[14px] border border-hairline bg-paper p-4">
        <span
          className="text-[10px] uppercase text-content-muted"
          style={{ fontFamily: OLD_MONO, letterSpacing: "0.08em" }}
        >
          Revenue
        </span>
        <span
          className="text-[24px] font-bold leading-[1.1] text-content-strong"
          style={{ fontFamily: OLD_MONO, fontVariantNumeric: "tabular-nums" }}
        >
          1 200 000
        </span>
        {/* The real thing: fully round, monospace, uppercased by CSS. */}
        <span
          className="wn-pill-out mt-1 self-start rounded-[999px] px-2 py-[3px] text-[10px] font-medium uppercase leading-none"
          style={{
            fontFamily: OLD_MONO,
            letterSpacing: "0.04em",
            background: "color-mix(in srgb, var(--h-negative) 10%, transparent)",
            color: "var(--h-negative-text)",
          }}
        >
          Off track
        </span>
      </div>
    </div>
  );
}

function StatusAfter() {
  const mark = markPoint(MARK_FRACTION);
  const states = [
    { label: "Off track", tone: "negative" },
    { label: "Behind", tone: "warning" },
    { label: "Under plan", tone: "info" },
    { label: "On track", tone: "positive" },
    { label: "No target", tone: "neutral" },
  ];
  return (
    <div className="flex w-full flex-col items-center gap-2.5">
      <StateLabel>After</StateLabel>
      <div className="relative flex w-full max-w-[290px] items-start justify-between gap-3 rounded-[18px] border border-hairline bg-paper p-4 shadow-sm">
        <ExampleTag />
        <span className="flex min-w-0 flex-col pt-3">
          <span className="text-[11px] font-semibold text-[var(--h-negative-text)]">
            Revenue
          </span>
          <span
            className="mt-1.5 text-[23px] font-bold leading-[1.05] tracking-heading text-content-strong"
            style={{ fontVariantNumeric: "tabular-nums" }}
          >
            1 200 000
          </span>
          <span className="mt-0.5 text-[10px] leading-[1.3] text-content-muted">
            of 2 600 000 goal
          </span>
        </span>

        {/* Decorative: the state chips below say the same thing in words. */}
        <span className="wn-ring mt-2.5 flex-none">
          <svg
            width={58}
            height={58}
            viewBox={`0 0 ${RING_BOX} ${RING_BOX}`}
            aria-hidden="true"
            focusable="false"
            className="block"
          >
            <circle
              cx={RING_BOX / 2}
              cy={RING_BOX / 2}
              r={RING_RADIUS}
              fill="none"
              stroke="var(--h-negative-tint)"
              strokeWidth={RING_STROKE}
            />
            <circle
              className="wn-ring-arc"
              cx={RING_BOX / 2}
              cy={RING_BOX / 2}
              r={RING_RADIUS}
              fill="none"
              stroke="var(--h-negative)"
              strokeWidth={RING_STROKE}
              strokeLinecap="round"
              strokeDasharray={RING_C}
              transform={`rotate(-90 ${RING_BOX / 2} ${RING_BOX / 2})`}
              style={
                {
                  "--wn-ring-c": RING_C,
                  "--wn-ring-end": RING_C * (1 - ARC_FRACTION),
                } as React.CSSProperties
              }
            />
            <g className="wn-ring-dot">
              <circle cx={mark.x} cy={mark.y} r={4.5} fill="var(--paper)" />
              <circle cx={mark.x} cy={mark.y} r={3} fill="var(--h-mark)" />
            </g>
          </svg>
        </span>
      </div>

      <span className="flex flex-wrap items-center justify-center gap-x-2.5 gap-y-1">
        {states.map((s, i) => (
          <span
            key={s.label}
            className="wn-chip flex items-center gap-1 text-[9.5px] font-medium"
            style={{
              animationDelay: `${860 + i * 60}ms`,
              color: `var(--h-${s.tone}-text)`,
            }}
          >
            <span
              className="h-[6px] w-[6px] flex-none rounded-full"
              style={{ background: `var(--h-${s.tone})` }}
            />
            {s.label}
          </span>
        ))}
      </span>
    </div>
  );
}

/* ====================================================================== */
/* Beat 4: the period controls                                            */
/* ====================================================================== */

/** One grey segmented group, as every control beside the date used to be. */
function OldSegments({
  label,
  options,
  active,
}: {
  label: string;
  options: string[];
  active: string;
}) {
  return (
    <span className="flex items-center gap-2">
      <span
        className="hidden text-[9.5px] uppercase text-content-muted sm:inline"
        style={{ fontFamily: OLD_MONO, letterSpacing: "0.12em" }}
      >
        {label}
      </span>
      <span className="flex gap-0.5 rounded-[999px] bg-gray-100 p-[3px]">
        {options.map((o) => (
          <span
            key={o}
            className={`whitespace-nowrap rounded-[999px] px-2 py-1 text-[9.5px] ${
              o === active
                ? "bg-paper text-content-strong shadow-xs"
                : "text-content-muted"
            }`}
            style={{ fontFamily: OLD_MONO }}
          >
            {o}
          </span>
        ))}
      </span>
    </span>
  );
}

/**
 * The old controls: a bordered button carrying the dates and a calendar
 * emoji, the preset name as a bare monospace label beside it, and the
 * comparison and currency as grey segmented groups.
 */
function PeriodBefore() {
  return (
    <div className="flex w-full flex-col items-center gap-2.5">
      <StateLabel>Before</StateLabel>
      <div className="flex items-center gap-2">
        <span className="flex items-center gap-2 rounded-[12px] border border-hairline-strong bg-paper px-2.5 py-1.5 text-content-strong">
          <span className="text-[11px]" aria-hidden="true">
            &#128197;
          </span>
          <span
            className="text-[10.5px]"
            style={{
              fontFamily: OLD_MONO,
              fontVariantNumeric: "tabular-nums",
            }}
          >
            Sep 8, 2026 to Oct 7, 2026
          </span>
          <span className="text-[8px] text-content-muted" aria-hidden="true">
            &#9662;
          </span>
        </span>
        <span
          className="hidden text-[9.5px] uppercase text-content-muted sm:inline"
          style={{ fontFamily: OLD_MONO, letterSpacing: "0.06em" }}
        >
          Last 30 days
        </span>
      </div>
      <OldSegments
        label="Compare"
        options={["Prev period", "Prev year", "None"]}
        active="None"
      />
      <OldSegments
        label="Currency"
        options={["Native (USD)", "USD to CZK"]}
        active="Native (USD)"
      />
    </div>
  );
}

/** One tiny calendar month. `range` is the inclusive day span to fill. */
function MiniMonth({
  name,
  offset,
  days,
  range,
  delay,
}: {
  name: string;
  /** Weekday the 1st falls on, 0 = Monday. */
  offset: number;
  days: number;
  /** The selected span, or null when this month holds no selection. */
  range: [number, number] | null;
  delay: number;
}) {
  const cells: Array<number | null> = [
    ...Array.from({ length: offset }, () => null),
    ...Array.from({ length: days }, (_, i) => i + 1),
  ];
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[8.5px] font-semibold text-content-strong">
        {name}
      </span>
      <div className="grid grid-cols-7 gap-[2px]">
        {cells.map((day, i) => {
          if (day === null)
            return <span key={`p${i}`} className="h-[12px] w-[12px]" />;
          const isStart = range?.[0] === day;
          const isEnd = range?.[1] === day;
          const inside = range ? day > range[0] && day < range[1] : false;
          if (isStart || isEnd) {
            return (
              <span
                key={day}
                className="wn-day-end flex h-[12px] w-[12px] items-center justify-center rounded-[4px] bg-ink-900 text-[7px] font-semibold text-paper"
                style={{ animationDelay: `${delay + (isStart ? 0 : 340)}ms` }}
              >
                {day}
              </span>
            );
          }
          if (inside) {
            return (
              <span
                key={day}
                className="wn-day-span flex h-[12px] w-[12px] items-center justify-center rounded-[3px] bg-gray-150 text-[7px] text-content-body"
                style={{ animationDelay: `${delay + 140}ms` }}
              >
                {day}
              </span>
            );
          }
          return (
            <span
              key={day}
              className="flex h-[12px] w-[12px] items-center justify-center text-[7px] text-content-muted"
            >
              {day}
            </span>
          );
        })}
      </div>
    </div>
  );
}

function PeriodAfter() {
  const presets = [
    "Today",
    "Last 7 days",
    "Last 28 days",
    "Last 30 days",
    "Month to date",
    "Year to date",
    "Custom range",
  ];
  const pills = [
    { icon: <CalendarIcon />, label: "Sep 8 to Oct 7", delay: 0 },
    { icon: <CompareIcon />, label: "Previous period", delay: 90 },
    { icon: <CurrencyIcon />, label: "CZK", delay: 180 },
  ];
  return (
    <div className="flex w-full flex-col items-center gap-2">
      <StateLabel>After</StateLabel>

      {/* The pill row. Each one flips from the control it replaced. */}
      <div className="flex flex-wrap items-center justify-center gap-1.5">
        {pills.map((pill) => (
          <span
            key={pill.label}
            className="wn-flip flex h-[25px] max-w-full items-center gap-1 whitespace-nowrap rounded-[999px] bg-gray-100 px-2 text-[10.5px] font-medium text-content-strong shadow-[inset_0_0_0_1px_var(--gray-150)]"
            style={{ animationDelay: `${pill.delay}ms` }}
          >
            <span className="flex-none scale-[0.75]">{pill.icon}</span>
            {pill.label}
          </span>
        ))}
        {/* The delta toggle, which exists only while a comparison is on. */}
        <span
          className="wn-flip flex h-[25px] flex-none items-center gap-0.5 rounded-[999px] bg-gray-100 px-1 text-[9.5px] font-medium shadow-[inset_0_0_0_1px_var(--gray-150)]"
          style={{ animationDelay: "270ms" }}
        >
          <span className="rounded-[999px] bg-paper px-1.5 py-[2px] font-semibold text-content-strong">
            %
          </span>
          <span className="px-1 text-content-muted">123</span>
        </span>
      </div>

      {/* The popover, opening on Custom range. */}
      <div
        className="wn-popover flex w-full max-w-[320px] overflow-hidden rounded-[12px] border border-hairline bg-paper shadow-md"
        style={{ animationDelay: "440ms" }}
      >
        <div className="flex flex-none flex-col gap-px border-r border-hairline bg-gray-50 p-1.5">
          {presets.map((p, i) => (
            <span
              key={p}
              className={`wn-preset whitespace-nowrap rounded-[6px] px-1.5 py-[3px] text-[9px] ${
                p === "Custom range"
                  ? "bg-gray-150 font-semibold text-content-strong"
                  : "text-content-body"
              }`}
              style={{ animationDelay: `${580 + i * 35}ms` }}
            >
              {p}
            </span>
          ))}
        </div>
        <div className="flex min-w-0 flex-1 justify-center gap-2.5 p-2">
          <MiniMonth
            name="September"
            offset={0}
            days={30}
            range={[8, 30]}
            delay={920}
          />
          {/* The second month is a desktop luxury: at 375px it would push the
              popover past the panel, and one month still shows the mechanic. */}
          <span className="hidden sm:block">
            <MiniMonth
              name="October"
              offset={2}
              days={31}
              range={[1, 7]}
              delay={920}
            />
          </span>
        </div>
      </div>
    </div>
  );
}

/* ====================================================================== */
/* Beat 5: the surface and the type                                       */
/* ====================================================================== */

/* The page as it was: the off white with a green cast, from the token file's
   own history (`--gray-50: #F6F6F3`, which `--bg-subtle` pointed at). The
   card was already white; what changed on it is the radius, the shadow and
   the hairline. */
const OLD_PAGE = "#F6F6F3";
const OLD_CARD = "#FFFFFF";
const OLD_BORDER = "#E4E4E1";

function SurfaceStage() {
  return (
    <div
      className="wn-surface flex h-[262px] w-full flex-col items-center justify-center gap-3 rounded-[16px]"
      style={
        {
          "--wn-old-page": OLD_PAGE,
          "--wn-new-page": "var(--gray-100)",
          "--wn-old-card": OLD_CARD,
          "--wn-old-border": OLD_BORDER,
        } as React.CSSProperties
      }
    >
      <div className="wn-surface-card relative flex w-full max-w-[270px] flex-col gap-1 border p-4">
        <ExampleTag />
        {/* The label, in both faces, stacked so the swap happens in place. */}
        <span className="relative block h-[13px]">
          <span
            className="wn-type-out absolute inset-0 text-[9.5px] uppercase text-content-muted"
            style={{ fontFamily: OLD_MONO, letterSpacing: "0.08em" }}
          >
            Revenue
          </span>
          <span className="wn-type-in absolute inset-0 text-[10.5px] font-semibold text-content-muted">
            Revenue
          </span>
        </span>
        <span className="relative block h-[33px]">
          <span
            className="wn-type-out absolute inset-0 text-[25px] font-bold leading-[1.25] text-content-strong"
            style={{ fontFamily: OLD_MONO, fontVariantNumeric: "tabular-nums" }}
          >
            1 200 000
          </span>
          <span
            className="wn-type-in absolute inset-0 text-[28px] font-bold leading-[1.15] tracking-heading text-content-strong"
            style={{ fontVariantNumeric: "tabular-nums" }}
          >
            1 200 000
          </span>
        </span>
      </div>

      {/* The face, named. Both words stacked in one cell so the swap happens
          in place: as a row they would leave a hole where the old word was. */}
      <span className="relative block h-[14px] w-[110px] text-[10px] font-semibold uppercase tracking-[0.12em]">
        <span
          className="wn-type-out absolute inset-0 text-center text-content-muted"
          style={{ fontFamily: OLD_MONO }}
        >
          Monospace
        </span>
        <span className="wn-type-in absolute inset-0 text-center text-content-strong">
          Inter
        </span>
      </span>
    </div>
  );
}

/* ====================================================================== */
/* The closing card                                                       */
/* ====================================================================== */

function ClosingStage() {
  return (
    <div className="flex h-[262px] w-full flex-col items-center justify-center gap-3">
      <svg width="66" height="66" viewBox="0 0 68 68" aria-hidden="true">
        <circle
          className="wn-check-ring"
          cx="34"
          cy="34"
          r="27"
          fill="none"
          stroke="var(--h-positive)"
          strokeWidth="4"
          strokeLinecap="round"
          strokeDasharray="170"
          transform="rotate(-90 34 34)"
        />
        <path
          className="wn-check"
          d="M23 34.5l7.5 7.5L45.5 27"
          fill="none"
          stroke="var(--h-positive)"
          strokeWidth="4"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeDasharray="34"
        />
      </svg>
      <p className="max-w-[34ch] text-center text-[12.5px] leading-[1.5] text-content-muted">
        Have a look around. If a figure does not read the way you expect, say so
        and we will fix it.
      </p>
    </div>
  );
}

/* ====================================================================== */
/* The stage switch                                                       */
/* ====================================================================== */

export function Stage({ index }: { index: number | "closing" }) {
  if (index === "closing") return <ClosingStage />;
  switch (index) {
    case 0:
      return <Swap before={<NavBefore />} after={<NavAfter />} afterDelay={120} />;
    case 1:
      return <Swap before={<GoalsBefore />} after={<GoalsAfter />} />;
    case 2:
      return (
        <Swap before={<StatusBefore />} after={<StatusAfter />} afterDelay={60} />
      );
    case 3:
      return <Swap before={<PeriodBefore />} after={<PeriodAfter />} />;
    case 4:
      return <SurfaceStage />;
    default:
      return null;
  }
}

/* ====================================================================== */
/* The reduced-motion summary                                             */
/* ====================================================================== */

/**
 * What somebody with `prefers-reduced-motion` set sees instead.
 *
 * The same five changes and the same closing line, as one static before and
 * after list. Nothing animates and nothing is stepped.
 *
 * ── Why this is not stepped, now that the main path is ────────────────────
 * Stepping exists to let a person control the pace of motion. There is no
 * motion here, so there is nothing to pace, and splitting the list across six
 * clicks would add work without adding anything: it would make the five
 * changes harder to compare, impossible to scan, and it would mean pressing
 * Next five times to reach a Close that is already on screen. Reading order is
 * the reader's either way. The consistency worth keeping is that both paths
 * carry the same content and the same ways out, and they do.
 *
 * It is taller than the panel on a phone, so it scrolls.
 */
export function StaticSummary({
  titleId,
  onDone,
}: {
  titleId: string;
  onDone: () => void;
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-5 pb-5 pt-3 sm:px-7 sm:pb-7 sm:pt-4">
      <h2
        id={titleId}
        className="text-[19px] font-semibold leading-[1.25] tracking-heading text-content-strong sm:text-[22px]"
      >
        What changed in the dashboard
      </h2>
      <p className="mt-1.5 max-w-[52ch] text-[13.5px] leading-[1.5] text-content-muted">
        Five changes, before and after.
      </p>

      <ol className="mt-4 flex list-none flex-col gap-3 p-0">
        {BEATS.map((beat) => (
          <li
            key={beat.title}
            className="flex flex-col gap-2 rounded-[14px] border border-hairline bg-paper p-3.5 shadow-xs"
          >
            <span className="text-[13.5px] font-semibold leading-[1.3] text-content-strong">
              {beat.title}
            </span>
            <span className="flex flex-col gap-1.5">
              <span className="flex gap-2">
                <span className="w-[42px] flex-none pt-[1px] text-[9.5px] font-semibold uppercase tracking-[0.1em] text-content-muted">
                  Before
                </span>
                <span className="min-w-0 text-[12.5px] leading-[1.45] text-content-muted">
                  {beat.before}
                </span>
              </span>
              <span className="flex gap-2">
                <span
                  className="w-[42px] flex-none pt-[1px] text-[9.5px] font-semibold uppercase tracking-[0.1em]"
                  style={{ color: "var(--h-positive-text)" }}
                >
                  After
                </span>
                <span className="min-w-0 text-[12.5px] leading-[1.45] text-content-body">
                  {beat.after}
                </span>
              </span>
            </span>
          </li>
        ))}
      </ol>

      <p className="mt-4 text-[13.5px] leading-[1.5] text-content-body">
        {CLOSING.body}
      </p>

      <button
        type="button"
        onClick={onDone}
        className="mt-4 flex h-11 flex-none items-center justify-center self-start rounded-[999px] bg-ink-900 px-6 text-[14.5px] font-semibold text-content-inverse transition-colors duration-fast hover:bg-ink-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]"
      >
        Got it
      </button>
    </div>
  );
}
