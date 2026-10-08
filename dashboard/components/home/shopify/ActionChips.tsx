/**
 * Chips under the assistant's box: things waiting on somebody, each a count
 * and a link to the page that clears it. A count of zero has nothing to
 * clear and is left out; a count the source could not give reads n/a and
 * names the source on hover.
 */

import { AppLink } from "@/components/ui/AppLink";
import { NO_VALUE, formatNumber } from "@/lib/format";
import type { ActionChip } from "@/lib/home/shopify/types";

const PATHS: Record<string, string> = {
  behind: "M4 17l6-6 4 4 6-6M14 9h6v6",
  briefs: "M7 3h7l5 5v13H7zM14 3v5h5M10 13h6M10 17h4",
  unmapped: "M9 15l6-6M10.5 6.5l1-1a4 4 0 0 1 5.7 5.7l-1 1M13.5 17.5l-1 1a4 4 0 0 1-5.7-5.7l1-1",
  over: "M12 3v12M8 11l4 4 4-4M5 21h14",
  slow: "M12 7v5l3 2M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z",
  cost: "M4 7h16M4 12h10M4 17h6M17 15l4 4M21 15l-4 4",
};

function Icon({ name }: { name: string }) {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="flex-none">
      <path d={PATHS[name] ?? PATHS.behind} />
    </svg>
  );
}

const CHIP =
  "inline-flex items-center gap-2 rounded-full border border-hairline bg-surface-card px-3.5 py-2 text-[13.5px] font-semibold text-content-strong shadow-xs transition-colors";

export function ActionChips({ chips }: { chips: ActionChip[] }) {
  const shown = chips.filter((c) => c.count === null || c.count > 0);
  if (!shown.length) return null;
  return (
    <nav aria-label="Waiting on you" className="mx-auto flex max-w-[860px] flex-wrap justify-center gap-2">
      {shown.map((c) =>
        c.count === null ? (
          <span key={c.key} className={`${CHIP} text-content-muted`} title={c.note ?? undefined}>
            <Icon name={c.key} />
            {c.label}
            <span className="tabular">{NO_VALUE}</span>
          </span>
        ) : (
          <AppLink key={c.key} href={c.href} className={`${CHIP} hover:bg-bg-subtle`}>
            <span className="text-content-muted">
              <Icon name={c.key} />
            </span>
            {c.label}
            <span className="rounded-full bg-bg-subtle px-2 py-[1px] text-[12.5px] tabular text-content-strong">
              {formatNumber(c.count)}
            </span>
          </AppLink>
        )
      )}
    </nav>
  );
}
