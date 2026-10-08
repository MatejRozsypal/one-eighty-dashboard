/**
 * Presence XP and levels: the rules in lib/presence/xp.ts.
 *
 *     npx tsx --tsconfig scripts/tsconfig.json scripts/check-presence-xp.ts
 *
 * Pure module, no database.
 */

import { dayXp, levelFor, streakByDay, xpByDay, xpWindows, type XpDay } from "@/lib/presence/xp";

let passed = 0;
const failures: string[] = [];
const j = (v: unknown) => JSON.stringify(v);
function eq(name: string, actual: unknown, expected: unknown): void {
  if (j(actual) === j(expected)) passed += 1;
  else failures.push(`${name}: got ${j(actual)}, want ${j(expected)}`);
}

// ── One day ─────────────────────────────────────────────────────────────────
eq("show up only, first day", dayXp(0, 1), 10 + 0 + 5);
eq("45 minutes, first day", dayXp(45, 1), 10 + 45 + 5);
eq("minutes capped at 300", dayXp(900, 1), 10 + 300 + 5);
eq("streak bonus capped at 10 days", dayXp(0, 25), 10 + 0 + 50);
eq("no streak (weekend with weekends off)", dayXp(30, 0), 40);
eq("negative minutes count as 0", dayXp(-5, 1), 15);

// ── Streak length per day ───────────────────────────────────────────────────
eq(
  "runs restart after a gap",
  [...streakByDay(["2026-10-01", "2026-10-02", "2026-10-03", "2026-10-05", "2026-10-06"], true)],
  [["2026-10-01", 1], ["2026-10-02", 2], ["2026-10-03", 3], ["2026-10-05", 1], ["2026-10-06", 2]],
);
// Fri 2 Oct, Mon 5 Oct 2026: with weekends off, two in a row; Sat 3 Oct has no streak.
eq(
  "weekends off: Friday then Monday is a run, Saturday is not a streak day",
  [...streakByDay(["2026-10-02", "2026-10-03", "2026-10-05"], false)],
  [["2026-10-02", 1], ["2026-10-05", 2]],
);

// ── Windows ─────────────────────────────────────────────────────────────────
// Today Thu 8 Oct 2026; week from Mon 5 Oct; month from 1 Oct.
const days: XpDay[] = [
  { day: "2026-09-30", activeMinutes: 100 }, // run 1: 10+100+5 = 115
  { day: "2026-10-01", activeMinutes: 20 }, // run 2: 10+20+10 = 40
  { day: "2026-10-05", activeMinutes: 60 }, // run 1: 10+60+5 = 75
  { day: "2026-10-06", activeMinutes: 400 }, // run 2: 10+300+10 = 320
  { day: "2026-10-08", activeMinutes: 35 }, // run 1: 10+35+5 = 50
  { day: "2026-10-09", activeMinutes: 10 }, // after today: ignored
];
eq("xp by day", Object.fromEntries(xpByDay(days.slice(0, 5), true)), {
  "2026-09-30": 115,
  "2026-10-01": 40,
  "2026-10-05": 75,
  "2026-10-06": 320,
  "2026-10-08": 50,
});
eq("windows", xpWindows(days, "2026-10-08", true), { today: 50, week: 445, month: 485, all: 600 });
eq("no days, all zero", xpWindows([], "2026-10-08", true), { today: 0, week: 0, month: 0, all: 0 });
eq("two rows for one day count once", xpWindows([{ day: "2026-10-08", activeMinutes: 10 }, { day: "2026-10-08", activeMinutes: 5 }], "2026-10-08", true).today, 30);

// ── Levels ──────────────────────────────────────────────────────────────────
eq("0 XP is level 1", levelFor(0), { level: 1, floorXp: 0, nextXp: 100, progress: 0 });
eq("99 XP is level 1", levelFor(99).level, 1);
eq("100 XP is level 2", levelFor(100).level, 2);
eq("399 XP is level 2", levelFor(399).level, 2);
eq("400 XP is level 3", levelFor(400).level, 3);
eq("650 XP halfway through level 3", levelFor(650), { level: 3, floorXp: 400, nextXp: 900, progress: 0.5 });
eq("10000 XP is level 11", levelFor(10_000).level, 11);
eq("NaN reads as 0", levelFor(Number.NaN).level, 1);

if (failures.length) {
  console.error(`check-presence-xp: ${failures.length} failed, ${passed} passed`);
  for (const f of failures) console.error(`  FAIL ${f}`);
  process.exit(1);
}
console.log(`check-presence-xp: all ${passed} passed`);
