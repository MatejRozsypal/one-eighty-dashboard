/**
 * The title of a card on the Goals page.
 *
 * The rest of the dashboard labels a section with `Eyebrow`: small, mono, wide
 * tracked, uppercase. This skin has no monospace and no eyebrows, so Goals
 * titles its cards in the sans at reading size instead. Local to the plan
 * components, so nothing else changes.
 */

import type { ReactNode } from "react";

export function SectionTitle({ children }: { children: ReactNode }) {
  return (
    <h3 className="m-0 text-[17px] font-semibold leading-[1.3] tracking-heading text-content-strong">{children}</h3>
  );
}
