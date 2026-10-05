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
 * Green (`winner`) is reserved for a read winner, the one test every surface
 * shares (`classify`). A creative with enough purchases to be directional that
 * clears the target but is not a winner yet (fewer purchases than the read
 * threshold, or too young) is `promising`: a lighter tone, never the winner
 * colour. Red and grey are as before.
 */
export type RoasTone = "muted" | "winner" | "promising" | "negative" | "neutral";

export function roasTone(
  ad: { purchases: number; roas: number | null; outcome: Outcome },
  t: { directionalPurchases: number; targetRoas: number; killRoas: number }
): RoasTone {
  if (ad.purchases < t.directionalPurchases) return "muted";
  if (ad.outcome === "winner") return "winner";
  if (ad.roas !== null && ad.roas >= t.targetRoas) return "promising";
  if (ad.roas !== null && ad.roas < t.killRoas) return "negative";
  return "neutral";
}
