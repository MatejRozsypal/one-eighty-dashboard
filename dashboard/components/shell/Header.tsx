/**
 * Page header — sticky, translucent, blurs content scrolling under it.
 *
 * The blur-on-scroll treatment is lifted from the marketing site's sticky nav,
 * which is the one place the brand system uses transparency.
 */

import { Logo } from "@/components/ui/Logo";

export function Header({
  eyebrow,
  title,
  rangeLabel,
}: {
  eyebrow: string;
  title: string;
  rangeLabel?: string;
}) {
  return (
    <header className="sticky top-0 z-30 flex items-center justify-between gap-6 border-b border-hairline bg-paper/[0.86] px-5 py-4 backdrop-blur-[12px] lg:px-8">
      <div className="flex min-w-0 items-center gap-3">
        {/* The mark stands in for the sidebar logo once the sidebar is gone. */}
        <span className="lg:hidden">
          <Logo markOnly size={24} />
        </span>
        <div className="flex min-w-0 flex-col gap-1">
          <span className="truncate font-mono text-[10px] uppercase tracking-eyebrow text-content-muted">
            {eyebrow}
          </span>
          <h1 className="m-0 truncate text-[22px] font-bold tracking-heading text-content-strong">
            {title}
          </h1>
        </div>
      </div>

      {rangeLabel && (
        <span className="hidden shrink-0 font-mono text-[11.5px] tabular text-content-muted sm:inline">
          {rangeLabel}
        </span>
      )}
    </header>
  );
}
