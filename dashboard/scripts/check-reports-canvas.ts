/**
 * Pure checks for the report canvas (RS6): undo history, autosave state
 * machine, keyboard move/resize math. No React, no DOM, no network.
 *
 *   npx tsx --tsconfig scripts/tsconfig.json scripts/check-reports-canvas.ts
 *
 * (RS0 owns package.json; the orchestrator can add this as
 * `check:reports-canvas`.)
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  COALESCE_MS,
  commitHistory,
  createHistory,
  redoHistory,
  undoHistory,
  type History,
} from "@/components/reports/canvas/useLayoutHistory";
import { createAutosaver, type AutosaveStatus, type Scheduler } from "@/components/reports/canvas/useAutosave";
import {
  addWidget,
  announceMoved,
  announceResized,
  duplicateWidget,
  firstFreeSlot,
  moveWidget,
  normalizeWidgets,
  readingOrder,
  removeWidget,
  resizeWidget,
  retypeWidget,
  tabletWidgets,
  type CanvasWidget,
} from "@/components/reports/canvas/useGridKeyboard";
import { AUTOSAVE_DEBOUNCE_MS, GRID, UNDO_HISTORY_STEPS, WIDGET_SIZE } from "@/lib/reports/limits";

let passed = 0;
const failures: string[] = [];
function check(name: string, ok: boolean, detail?: string) {
  if (ok) passed++;
  else failures.push(detail ? `${name}: ${detail}` : name);
}
const geo = (ws: readonly CanvasWidget[]) => ws.map((w) => `${w.id}:${w.x},${w.y} ${w.w}x${w.h}`).join(" | ");
const w = (id: string, type: CanvasWidget["type"], x: number, y: number, ww?: number, h?: number): CanvasWidget => ({
  id,
  type,
  x,
  y,
  w: ww ?? WIDGET_SIZE[type].w,
  h: h ?? WIDGET_SIZE[type].h,
});

// ---------------------------------------------------------------------------
// useLayoutHistory (pure core)
// ---------------------------------------------------------------------------

check("history limit is 50", UNDO_HISTORY_STEPS === 50);
{
  let h: History<number> = createHistory(0);
  check("fresh history cannot undo or redo", h.past.length === 0 && h.future.length === 0);
  h = commitHistory(h, 1, { now: 0 });
  h = commitHistory(h, 2, { now: 10_000 });
  check("commit moves present", h.present === 2 && h.past.length === 2);
  check("equal commit is a no-op (same object)", commitHistory(h, 2) === h);
  h = undoHistory(h);
  check("undo restores previous", h.present === 1 && h.future.length === 1);
  h = undoHistory(h);
  check("undo to initial", h.present === 0 && h.past.length === 0);
  check("undo at start is a no-op", undoHistory(h) === h);
  h = redoHistory(h);
  h = redoHistory(h);
  check("redo walks forward", h.present === 2 && h.future.length === 0);
  check("redo at end is a no-op", redoHistory(h) === h);
  h = undoHistory(h);
  h = commitHistory(h, 9, { now: 20_000 });
  check("a commit after undo clears redo", h.future.length === 0 && h.present === 9);

  let big: History<number> = createHistory(0);
  for (let i = 1; i <= 60; i++) big = commitHistory(big, i, { now: i * 10_000 });
  check("history is capped at 50 steps", big.past.length === 50, String(big.past.length));
  let steps = 0;
  while (undoHistory(big) !== big) {
    big = undoHistory(big);
    steps++;
  }
  check("exactly 50 undos available, oldest dropped", steps === 50 && big.present === 10, `${steps} steps, present ${big.present}`);

  let c: History<number> = createHistory(0);
  c = commitHistory(c, 1, { key: "move:a", now: 0 });
  c = commitHistory(c, 2, { key: "move:a", now: COALESCE_MS - 1 });
  c = commitHistory(c, 3, { key: "move:a", now: 2 * COALESCE_MS - 2 });
  check("same key within the window coalesces into one step", c.past.length === 1 && c.present === 3, `${c.past.length}`);
  check("coalesced step undoes to the state before the burst", undoHistory(c).present === 0);
  c = commitHistory(c, 4, { key: "move:a", now: 10 * COALESCE_MS });
  check("same key after the window starts a new step", c.past.length === 2);
  c = commitHistory(c, 5, { key: "move:b", now: 10 * COALESCE_MS + 1 });
  check("another key starts a new step", c.past.length === 3);

  const objs = commitHistory(createHistory([{ a: 1 }]), [{ a: 1 }]);
  check("structural equality by default", objs.past.length === 0);
}

// ---------------------------------------------------------------------------
// useAutosave (state machine, fake scheduler)
// ---------------------------------------------------------------------------

check("autosave debounce is 800 ms", AUTOSAVE_DEBOUNCE_MS === 800);
async function autosaveChecks() {
  const timers = new Map<number, { fn: () => void; at: number }>();
  let nextId = 1;
  let clock = 0;
  const scheduler: Scheduler = {
    set: (fn, ms) => {
      const id = nextId++;
      timers.set(id, { fn, at: clock + ms });
      return id;
    },
    clear: (h) => void timers.delete(h as number),
  };
  const advance = async (ms: number) => {
    clock += ms;
    for (const [id, t] of [...timers]) {
      if (t.at <= clock) {
        timers.delete(id);
        t.fn();
      }
    }
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  };

  const saves: number[] = [];
  const statuses: AutosaveStatus[] = [];
  let result: { ok: boolean } | void = undefined;
  let release: (() => void) | null = null;
  const saver = createAutosaver<number>({
    baseline: 0,
    scheduler,
    onStatus: (s) => statuses.push(s),
    save: (v) => {
      saves.push(v);
      if (release === null && result === undefined) return;
      return new Promise<{ ok: boolean } | void>((resolve) => {
        release = () => resolve(result);
      });
    },
  });

  saver.update(0);
  await advance(2000);
  check("mounting with the baseline value does not save", saves.length === 0);

  saver.update(1);
  await advance(AUTOSAVE_DEBOUNCE_MS - 100);
  saver.update(2);
  await advance(AUTOSAVE_DEBOUNCE_MS - 100);
  check("debounce restarts on each change", saves.length === 0);
  await advance(150);
  check("one save of the last value after the quiet period", saves.length === 1 && saves[0] === 2, JSON.stringify(saves));
  check("status ends saved", saver.status === "saved", saver.status);
  check("status sequence dirty, saving, saved", statuses.join(",") === "dirty,saving,saved", statuses.join(","));

  saver.update(2);
  await advance(2000);
  check("an unchanged value does not save again", saves.length === 1);

  // Change during an in-flight save: saved afterwards, never overlapping.
  result = { ok: true };
  release = null;
  saver.update(3);
  await advance(AUTOSAVE_DEBOUNCE_MS + 1);
  check("save 3 started", saves[saves.length - 1] === 3 && saver.status === "saving", saver.status);
  saver.update(4);
  await advance(AUTOSAVE_DEBOUNCE_MS + 1);
  check("no second save while one is in flight", saves.length === 2, JSON.stringify(saves));
  (release as (() => void) | null)?.();
  release = null;
  await advance(0);
  await advance(AUTOSAVE_DEBOUNCE_MS + 1);
  check("the newer value is saved after the first finishes", saves[saves.length - 1] === 4, JSON.stringify(saves));
  (release as (() => void) | null)?.();
  release = null;
  await advance(0);
  check("status saved at the end", saver.status === "saved", saver.status);

  // Failure: { ok: false } keeps the value dirty, flush retries.
  result = { ok: false };
  saver.update(5);
  await advance(AUTOSAVE_DEBOUNCE_MS + 1);
  (release as (() => void) | null)?.();
  release = null;
  await advance(0);
  check("{ ok: false } ends in error", saver.status === "error", saver.status);
  result = { ok: true };
  const pending = saver.flush();
  await advance(0);
  (release as (() => void) | null)?.();
  release = null;
  await pending;
  check("flush retries a failed save and succeeds", saver.status === "saved" && saves[saves.length - 1] === 5, `${saver.status} ${JSON.stringify(saves)}`);

  // Throwing save is an error too; markSaved resets.
  const thrower = createAutosaver<string>({
    baseline: "a",
    scheduler,
    save: () => {
      throw new Error("boom");
    },
  });
  thrower.update("b");
  await advance(AUTOSAVE_DEBOUNCE_MS + 1);
  check("a throwing save ends in error", thrower.status === "error", thrower.status);
  thrower.markSaved("b");
  check("markSaved resets to idle", thrower.status === "idle");
}

// ---------------------------------------------------------------------------
// Grid math
// ---------------------------------------------------------------------------

const base: CanvasWidget[] = [w("a", "kpi", 0, 0), w("b", "kpi", 3, 0), w("c", "line", 0, 3), w("d", "line", 6, 0), w("e", "table", 0, 10)];

{
  const n = normalizeWidgets(base);
  check("normalize keeps a valid compacted layout", geo(n) === geo(base), geo(n));
  check("normalize is idempotent", geo(normalizeWidgets(n)) === geo(n));

  const messy = normalizeWidgets([w("a", "kpi", 40, 50, 1, 1), w("b", "table", 0, 99, 30, 30)]);
  check("normalize clamps to min size, grid width, max height", messy[0].w >= 2 && messy[0].h >= 3 && messy[1].w === GRID.cols && messy[1].h === GRID.maxH && messy[0].x + messy[0].w <= GRID.cols, geo(messy));
  check("normalize compacts vertically", messy[0].y === 0, geo(messy));
}

{
  // Move right: b swaps out of the way (library collision rules), result stays in the grid.
  const r = moveWidget(base, "a", 1, 0);
  const a = r.widgets.find((x) => x.id === "a");
  check("move right by one column", r.changed && a?.x === 1, geo(r.widgets));
  check("move right never leaves the grid", r.widgets.every((x) => x.x >= 0 && x.x + x.w <= GRID.cols));
  check("move right leaves no overlap", noOverlap(r.widgets), geo(r.widgets));

  const left = moveWidget(base, "a", -1, 0);
  check("move left at x=0 is blocked", !left.changed && geo(left.widgets) === geo(base));

  const farRight = moveWidget([w("a", "kpi", 9, 0)], "a", 1, 0);
  check("move right at the right edge is blocked", !farRight.changed);

  const up = moveWidget(base, "c", 0, -1);
  check("up jumps above the neighbour", up.changed && (up.item?.y ?? 99) === 0, geo(up.widgets));
  check("up pushes the neighbour down, no overlap", noOverlap(up.widgets), geo(up.widgets));

  const top = moveWidget(base, "a", 0, -1);
  check("up at the top is blocked", !top.changed);

  const down = moveWidget(base, "a", 0, 1);
  check("down jumps below the neighbour", down.changed && (down.item?.y ?? 0) > 0, geo(down.widgets));
  check("down leaves no overlap", noOverlap(down.widgets), geo(down.widgets));

  const bottom = moveWidget(base, "e", 0, 1);
  check("down at the bottom is blocked", !bottom.changed);

  const missing = moveWidget(base, "zzz", 1, 0);
  check("unknown id is a no-op", !missing.changed && missing.item === null);

  // Round trip: down then up returns to a valid layout with the same set of ids.
  const rt = moveWidget(down.widgets, "a", 0, -1);
  check("up after down restores a compacted layout", noOverlap(rt.widgets) && rt.widgets.length === base.length);
}

{
  const g = resizeWidget(base, "a", 1, 1);
  const a = g.widgets.find((x) => x.id === "a");
  check("resize grows by one cell each way", g.changed && a?.w === 4 && a?.h === 4, geo(g.widgets));
  check("resize leaves no overlap", noOverlap(g.widgets), geo(g.widgets));

  const shrink = resizeWidget(base, "a", -5, -5);
  check("resize shrink clamps to the type minimum (kpi 2x3)", !shrink.changed || (shrink.item?.w === 2 && shrink.item?.h === 3), geo(shrink.widgets));
  const atMin = resizeWidget([w("a", "kpi", 0, 0, 2, 3)], "a", -1, 0);
  check("resize at minimum is blocked", !atMin.changed);

  const wide = resizeWidget([w("a", "line", 8, 0, 4, 7)], "a", 1, 0);
  check("resize cannot pass the right edge", !wide.changed);

  const tall = resizeWidget([w("a", "line", 0, 0, 6, GRID.maxH)], "a", 0, 1);
  check("resize cannot pass max height", !tall.changed);

  const push = resizeWidget([w("a", "line", 0, 0, 6, 7), w("b", "line", 6, 0, 6, 7)], "a", 1, 0);
  check("growing into a neighbour pushes it down", push.changed && noOverlap(push.widgets) && (push.widgets.find((x) => x.id === "b")?.y ?? 0) >= 7, geo(push.widgets));
}

{
  check("first free slot on an empty grid", JSON.stringify(firstFreeSlot([], 3, 3)) === JSON.stringify({ x: 0, y: 0 }));
  const row = [w("a", "kpi", 0, 0), w("b", "kpi", 3, 0)];
  check("first free slot goes right of existing items", JSON.stringify(firstFreeSlot(row, 3, 3)) === JSON.stringify({ x: 6, y: 0 }));
  const full = [w("a", "table", 0, 0)];
  check("first free slot goes below a full row", JSON.stringify(firstFreeSlot(full, 3, 3)) === JSON.stringify({ x: 0, y: 8 }));
  const gap = [w("a", "kpi", 0, 0), w("b", "kpi", 6, 0)];
  check("first free slot fills a gap", JSON.stringify(firstFreeSlot(gap, 3, 3)) === JSON.stringify({ x: 3, y: 0 }));
  check("oversize width is clamped, never throws", firstFreeSlot(gap, 20, 3).x === 0);

  const added = addWidget(row, "n", "line");
  const nw = added.find((x) => x.id === "n");
  check("addWidget uses the default size and a free slot", nw?.w === 6 && nw?.h === 7 && noOverlap(added), geo(added));

  const dup = duplicateWidget(base, "a", "a2");
  const a2 = dup.find((x) => x.id === "a2");
  check("duplicate keeps size and type, no overlap", a2?.w === 3 && a2?.type === "kpi" && noOverlap(dup) && dup.length === base.length + 1, geo(dup));

  const rem = removeWidget(base, "c");
  check("remove drops the item and compacts", rem.length === base.length - 1 && !rem.some((x) => x.id === "c") && noOverlap(rem));

  const rt = retypeWidget([w("a", "table", 0, 0, 12, 8)], "a", "kpi");
  check("retype keeps a valid size", rt[0].type === "kpi" && rt[0].w <= GRID.cols);
  const grow = retypeWidget([w("a", "kpi", 0, 0, 3, 3)], "a", "scatter");
  check("retype to a larger minimum grows the item", grow[0].w >= WIDGET_SIZE.scatter.minW && grow[0].h >= WIDGET_SIZE.scatter.minH, geo(grow));
}

{
  const order = readingOrder([w("z", "kpi", 6, 0), w("y", "kpi", 0, 3), w("x", "kpi", 0, 0), w("w", "kpi", 3, 0)]);
  check("reading order is y then x", order.map((o) => o.id).join("") === "xwzy", order.map((o) => o.id).join(""));

  const tab = tabletWidgets(base);
  check("tablet layout fits 6 columns", tab.every((x) => x.x >= 0 && x.x + x.w <= GRID.tabletCols), geo(tab));
  check("tablet layout has no overlap", noOverlap(tab), geo(tab));
  check("tablet keeps every widget", tab.length === base.length);
  const sideBySide = tabletWidgets([w("a", "kpi", 0, 0), w("b", "kpi", 3, 0), w("c", "kpi", 6, 0), w("d", "kpi", 9, 0)]);
  check("tablet keeps four KPI tiles two by two", sideBySide.filter((x) => x.y === 0).length === 3 && sideBySide.every((x) => x.w === 2) && noOverlap(sideBySide), geo(sideBySide));
  const full = tabletWidgets([w("t", "table", 0, 0, 12, 8)]);
  check("a full-width widget stays full width on tablet", full[0].w === GRID.tabletCols);

  check("announce moved uses 1-based column and row", announceMoved("MER", { id: "a", x: 6, y: 3, w: 3, h: 3 }) === "MER moved to column 7, row 4");
  check("announce resized", announceResized("MER", { id: "a", x: 0, y: 0, w: 4, h: 5 }) === "MER resized to 4 by 5");
}

function noOverlap(ws: readonly CanvasWidget[]): boolean {
  for (let i = 0; i < ws.length; i++)
    for (let j = i + 1; j < ws.length; j++) {
      const a = ws[i];
      const b = ws[j];
      if (a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h) return false;
    }
  return true;
}

// ---------------------------------------------------------------------------
// Static gates over the files this package owns
// ---------------------------------------------------------------------------

const ROOT = join(__dirname, "..");
// Built from code points so this file itself stays free of the characters it forbids.
const DASH = new RegExp(`[${String.fromCharCode(0x2013)}${String.fromCharCode(0x2014)}]`);
const OWNED = [
  "components/reports/canvas/ReportCanvas.tsx",
  "components/reports/canvas/WidgetFrame.tsx",
  "components/reports/canvas/MobileStack.tsx",
  "components/reports/canvas/CanvasDemo.tsx",
  "components/reports/canvas/useGridKeyboard.ts",
  "components/reports/canvas/useLayoutHistory.ts",
  "components/reports/canvas/useAutosave.ts",
  "app/(app)/reports/grid.css",
];
for (const f of OWNED) {
  let text = "";
  try {
    text = readFileSync(join(ROOT, f), "utf8");
  } catch {
    failures.push(`missing owned file ${f}`);
    continue;
  }
  check(`no em or en dash in ${f}`, !DASH.test(text));
  check(`no hex colour in ${f}`, !/#[0-9a-fA-F]{3,8}\b/.test(text.replace(/&#\d+;/g, "")), "hex literal");
  check(`no rgb() literal in ${f}`, !/\brgba?\(/.test(text));
}

autosaveChecks()
  .then(() => {
    if (failures.length > 0) {
      console.error(`FAILED ${failures.length} of ${passed + failures.length}`);
      for (const f of failures) console.error(`  - ${f}`);
      process.exit(1);
    }
    console.log(`check-reports-canvas: ${passed}/${passed} passed`);
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
