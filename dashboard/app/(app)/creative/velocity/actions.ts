"use server";

/**
 * Saving the Velocity Plan inputs for the whole team.
 *
 * The same gate as Settings (`requireInternalForConfig`): these are stated
 * inputs about how the account is run. The client id is re-resolved from the
 * session, never trusted from the browser.
 */

import { revalidatePath } from "next/cache";
import { requireInternalForConfig } from "@/lib/authz";
import { getClients, resolveClient } from "@/lib/clients";
import { isDemo } from "@/lib/demo/client";
import { saveVelocityInputs } from "@/lib/creative/store";
import { VELOCITY_INPUT_KEYS, type VelocityInputs } from "@/lib/creative/capacity";

export interface SaveVelocityResult {
  ok: boolean;
  error?: string;
  savedBy?: string;
  savedAt?: string;
}

/** Shares must be 0..1, counts whole and at least 1, money not negative. */
function clean(input: VelocityInputs): VelocityInputs | string {
  const out = { ...input };
  for (const k of VELOCITY_INPUT_KEYS) {
    const v = input[k];
    if (v === null) continue;
    if (typeof v !== "number" || !Number.isFinite(v) || v < 0) return "Numbers only, not negative.";
    if ((k === "newShare" || k === "hitRate") && v > 1) return "Shares are 0 to 100%.";
    if (k === "verdictN" || k === "adsPerPack") {
      if (v < 1) return "At least 1.";
      out[k] = Math.round(v);
    }
  }
  return out;
}

export async function saveVelocityInputsAction(
  clientId: string,
  input: VelocityInputs
): Promise<SaveVelocityResult> {
  const { email } = await requireInternalForConfig();
  const client = await resolveClient(clientId, await getClients());
  if (isDemo(client.clientId)) return { ok: false, error: "The demo client is read-only." };

  const values = clean(input);
  if (typeof values === "string") return { ok: false, error: values };

  await saveVelocityInputs(client.clientId, values, email);
  revalidatePath("/creative/velocity", "layout");
  return { ok: true, savedBy: email, savedAt: new Date().toISOString() };
}
