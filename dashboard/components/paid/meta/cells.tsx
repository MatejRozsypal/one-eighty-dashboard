/**
 * Small cell and chip pieces shared by the Meta tab's tables and tiles.
 * Server components; nothing here holds state.
 */

import type { ReactNode } from "react";
import { NO_VALUE, type DeltaInput } from "@/lib/format";
import { DeltaChip, type GoodWhen } from "@/components/ui/Delta";

/** A figure cell: mono, tabular. The caller passes an already formatted string. */
export function Fig({
  children,
  strong = false,
  muted = false,
}: {
  children: string;
  strong?: boolean;
  muted?: boolean;
}) {
  return (
    <span
      className={`font-mono text-[12.5px] tabular ${
        muted || children === NO_VALUE
          ? "text-content-muted"
          : strong
            ? "font-semibold text-content-strong"
            : "text-content-strong"
      }`}
    >
      {children}
    </span>
  );
}

/**
 * ROAS or CPA of a row that is too small to judge: muted, with a "Low volume"
 * dot. The sort key for these cells is null, so they sort last either way.
 */
export function LowVolumeFig({ children, low }: { children: string; low: boolean }) {
  if (!low) return <Fig>{children}</Fig>;
  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        role="img"
        aria-label="Low volume"
        title="Low volume"
        className="h-[6px] w-[6px] flex-none rounded-full bg-warning-300"
      />
      <Fig muted>{children}</Fig>
    </span>
  );
}

/**
 * Change cell, in the mode the delta toggle shows. A missing change (either
 * side absent, or a relative change from zero) is the no-value glyph, never blank.
 */
export function DeltaCell({
  change,
  goodWhen = "up",
}: {
  change: DeltaInput | null;
  goodWhen?: GoodWhen;
}): ReactNode {
  return <DeltaChip change={change} goodWhen={goodWhen} fallback={NO_VALUE} />;
}

/** The card every section sits in. */
export function Section({
  title,
  children,
  right,
  id,
}: {
  title: string;
  children: ReactNode;
  right?: ReactNode;
  id?: string;
}) {
  return (
    <section
      id={id}
      className="flex scroll-mt-[calc(var(--header-h)+var(--paid-tabs-h)+64px)] flex-col gap-[18px] rounded-card border border-hairline bg-surface-card p-[22px_20px] shadow-sm lg:p-[24px_28px]"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-mono text-eyebrow font-medium uppercase tracking-eyebrow text-content-muted">
          {title}
        </h2>
        {right}
      </div>
      {children}
    </section>
  );
}
