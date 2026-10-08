"use server";

/**
 * Dismissing a For you card for the signed-in person only.
 *
 * The same gate as Settings and the Velocity inputs (`requireInternalForConfig`).
 * The person is always the session's email, never a value from the browser.
 * The key is checked against the alert_key shape; value, severity and
 * fingerprint are what the card showed when dismissed, the baseline the
 * "worse since dismissed" and "task changed" checks compare with.
 */

import { requireInternalForConfig } from "@/lib/authz";
import {
  ALERT_KEY_PATTERN,
  FINGERPRINT_PATTERN,
  SNOOZE_DAYS,
  isSeverity,
  type Dismissal,
} from "@/lib/home/alerts/model";
import { deleteDismissal, saveDismissal } from "@/lib/home/alerts/store";

export interface DismissResult {
  ok: boolean;
  error?: string;
  dismissal?: Dismissal;
}

export async function dismissAlertAction(input: {
  alertKey: string;
  snooze: boolean;
  value: number | null;
  severity: string | null;
  fingerprint: string | null;
}): Promise<DismissResult> {
  const { email } = await requireInternalForConfig();
  if (typeof input?.alertKey !== "string" || !ALERT_KEY_PATTERN.test(input.alertKey)) {
    return { ok: false, error: "Unknown card." };
  }
  const value = typeof input.value === "number" && Number.isFinite(input.value) ? input.value : null;
  const severity = isSeverity(input.severity) ? input.severity : null;
  const fingerprint =
    typeof input.fingerprint === "string" && FINGERPRINT_PATTERN.test(input.fingerprint) ? input.fingerprint : null;
  try {
    const dismissal = await saveDismissal({
      userEmail: email,
      alertKey: input.alertKey,
      snoozeDays: input.snooze === true ? SNOOZE_DAYS : null,
      value,
      severity,
      fingerprint,
    });
    return { ok: true, dismissal };
  } catch (error) {
    console.error("[home] dismiss failed", error);
    return { ok: false, error: "Not saved." };
  }
}

export async function undoDismissAction(alertKey: string): Promise<DismissResult> {
  const { email } = await requireInternalForConfig();
  if (typeof alertKey !== "string" || !ALERT_KEY_PATTERN.test(alertKey)) return { ok: false, error: "Unknown card." };
  try {
    await deleteDismissal(email, alertKey);
    return { ok: true };
  } catch (error) {
    console.error("[home] undo dismiss failed", error);
    return { ok: false, error: "Not saved." };
  }
}
