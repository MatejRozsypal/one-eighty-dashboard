/**
 * Is the ClickUp credential in this environment actually accepted?
 *
 *     CLICKUP_API_TOKEN=... npm run check:clickup
 *     npm run check:clickup -- <task id>      # also read one task's activity
 *
 * The same probe the Data Health page runs, from a terminal — so the answer is
 * available before a deploy rather than after somebody opens an ad.
 */

import { getActivity, listNotes, probeClickUp } from "@/lib/creative/clickup";

async function main() {
  const p = await probeClickUp();
  console.log(
    p.ok
      ? `ok    ClickUp accepts the token, as ${p.user ?? "an unnamed account"}.`
      : `FAIL  ${p.problem}`
  );
  if (!p.ok) process.exit(1);

  const taskId = process.argv[2];
  if (!taskId) {
    console.log("      Pass a task id to also read its notes and activity.");
    return;
  }

  const [notes, activity] = await Promise.all([listNotes(taskId), getActivity(taskId)]);
  console.log(`\ntask  ${activity.name ?? taskId}`);
  console.log(`      status ${activity.status ?? "—"}, created by ${activity.createdBy ?? "—"}`);
  console.log(
    `      ${activity.statuses.length} status transitions, ${notes.length} comments, ` +
      `${activity.assignees.length} assignees`
  );
  for (const s of activity.statuses) {
    console.log(`      · ${s.status.padEnd(24)} ${s.minutes} min${s.current ? "  (current)" : ""}`);
  }
  for (const n of notes) {
    console.log(`      · ${n.author}: ${n.text.slice(0, 60).replace(/\n/g, " ")}`);
  }
}

main().catch((e) => {
  console.error("probe failed:", e instanceof Error ? e.message : e);
  process.exit(1);
});
