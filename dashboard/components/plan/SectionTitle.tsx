/**
 * The title of a card on the Goals page.
 *
 * The rest of the dashboard labels a section with `Eyebrow`: small, wide
 * tracked, uppercase. The mock has no eyebrows, so Goals titles its cards in
 * the sans at reading size instead.
 *
 * ── Why this did not go out with the rollout ───────────────────────────────
 * `Eyebrow` asked for the monospace, and the skin repoints that token at
 * Inter, so it already comes out in the new family: an uppercase label at
 * 0.14em is a tracking device, not a monospace one, and it survived the swap
 * intact. There was therefore nothing broken to fix, and replacing it
 * everywhere would have been a second redesign riding along inside a rollout:
 * sixty-odd call sites, and a 17px sentence-case title on every card competing
 * with the 17px page title in the header beside it. Goals keeps its own; the
 * rest of the product keeps the eyebrow.
 */

import type { ReactNode } from "react";

export function SectionTitle({ children }: { children: ReactNode }) {
  return (
    <h3 className="m-0 text-[17px] font-semibold leading-[1.3] tracking-heading text-content-strong">{children}</h3>
  );
}
