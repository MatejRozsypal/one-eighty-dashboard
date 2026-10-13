/**
 * How a creative's ROAS reads on the wall and in the detail panel.
 *
 * Pure and tiny on purpose: the grid is a client component and imports this
 * without pulling the engine into the browser bundle.
 */

import type { Outcome } from "@/lib/creative/model";

/**
 * How a creative's ROAS reads on the wall and in the detail panel.
 *
 * Green (`winner`) is reserved for a winner, the one test every surface shares
 * (`classify`). A creative that clears the target but is not a winner yet
 * (younger than the winner age) is `promising`: a lighter tone, never the
 * winner colour. Below the kill line is red, whatever the purchase count:
 * the real number decides the colour.
 */
export type RoasTone = "winner" | "promising" | "negative" | "neutral";

export function roasTone(
  ad: { roas: number | null; outcome: Outcome },
  t: { targetRoas: number; killRoas: number }
): RoasTone {
  if (ad.outcome === "winner") return "winner";
  if (ad.roas !== null && ad.roas >= t.targetRoas) return "promising";
  if (ad.roas !== null && ad.roas < t.killRoas) return "negative";
  return "neutral";
}
