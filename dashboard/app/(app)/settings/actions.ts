"use server";

/**
 * Settings mutations.
 *
 * Every action re-checks the session itself. Server actions are individually
 * addressable POST endpoints — the page they were rendered from is not a gate,
 * and a caller can invoke one without ever loading it — so the role check has
 * to live in the action, not in the screen that draws the form.
 */

import { revalidatePath } from "next/cache";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { isGoalMetric, saveGoal } from "@/lib/goals/store";
import { isDemo } from "@/lib/demo/client";

async function requireAdmin(): Promise<string> {
  const session = await getServerSession(authOptions);
  if (session?.user?.role !== "admin") {
    throw new Error("Not authorised.");
  }
  return session.user.email!.toLowerCase();
}

/**
 * Parse a target from a form field.
 *
 * An empty box clears the target rather than storing zero. The two are
 * genuinely different — zero is an intention, absent is nobody having said —
 * and the Goals page renders them differently, so the distinction has to
 * survive the form.
 */
function parseTarget(value: FormDataEntryValue | null): number | null {
  const raw = String(value ?? "").trim().replace(/\s|,/g, "");
  if (raw === "") return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) {
    throw new Error(`"${raw}" is not a target. Use a number, or empty to clear.`);
  }
  return n;
}

export async function saveGoalsAction(formData: FormData): Promise<void> {
  const email = await requireAdmin();

  const clientId = String(formData.get("clientId") ?? "");
  const month = String(formData.get("month") ?? "");
  if (!clientId || !/^\d{4}-\d{2}-01$/.test(month)) {
    throw new Error("A target needs a client and a month.");
  }

  // The demo's targets are generated in code so they always frame its data.
  // Accepting a save would write rows nothing reads.
  if (isDemo(clientId)) {
    throw new Error("The demo client's targets are fixed in code.");
  }

  // One form carries every metric for a month, so a month is saved as a unit
  // rather than four separate round trips.
  for (const [key, value] of formData.entries()) {
    if (!key.startsWith("target_")) continue;
    const metric = key.slice("target_".length);
    if (!isGoalMetric(metric)) continue;
    await saveGoal(clientId, metric, month, parseTarget(value), email);
  }

  revalidatePath("/settings");
  revalidatePath("/goals");
}
