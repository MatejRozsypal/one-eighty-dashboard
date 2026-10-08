/**
 * Table cells for the Velocity screens: the same look as the Creative tables,
 * figures right-aligned in mono, the first column left-aligned. No state and no
 * server import, so the Plan calculator (a client component) can use them too.
 */

import type { ReactNode } from "react";
import { InfoTip } from "@/components/ui/InfoTip";
import { isNoValue } from "@/lib/format";

export function Th({ children, info, left = false }: { children: string; info?: string; left?: boolean }) {
  return (
    <th
      className={`border-b border-hairline bg-gray-50/60 px-2.5 py-2.5 align-bottom font-mono text-[10px] leading-tight font-medium uppercase tracking-[0.1em] text-content-muted ${
        left ? "text-left" : "text-right"
      }`}
    >
      <span className={`inline-flex items-center gap-1.5 ${left ? "" : "justify-end"}`}>
        {children}
        {info && <InfoTip text={info} label={`About ${children}`} />}
      </span>
    </th>
  );
}

export function Td({
  children,
  left = false,
  tone = "default",
}: {
  children: ReactNode;
  left?: boolean;
  /** `warn` colours a figure that breaks a rule (over capacity, window over 30 days). */
  tone?: "default" | "warn";
}) {
  const muted = isNoValue(children);
  return (
    <td
      className={`whitespace-nowrap border-b border-hairline px-2.5 py-2.5 text-[13px] ${
        left ? "text-left font-medium text-content-strong" : "text-right font-mono tabular"
      } ${muted ? "text-content-muted" : tone === "warn" ? "text-warning" : left ? "" : "text-content-body"}`}
    >
      {children}
    </td>
  );
}

/** The table's frame, scrolling sideways on a narrow screen. */
export function TableFrame({ children, minWidth = 720 }: { children: ReactNode; minWidth?: number }) {
  return (
    <div className="glass-solid overflow-x-auto">
      <table className="w-full border-collapse" style={{ minWidth }}>
        {children}
      </table>
    </div>
  );
}
