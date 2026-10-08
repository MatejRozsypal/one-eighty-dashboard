/**
 * The Clients list, Health's "Show All Health Data": one inset grouped list,
 * a row per client with its status chips and money facts, and a chevron to
 * the client's Goals page.
 */

import { AppLink } from "@/components/ui/AppLink";
import { InfoTip } from "@/components/ui/InfoTip";
import { NO_VALUE } from "@/lib/format";
import type { ChipTone, ClientRow } from "@/lib/home/health/types";
import { Chevron } from "./Icons";
import { family } from "./palette";

export const CHIP: Record<ChipTone, { text: string; bg: string }> = {
  positive: { text: "var(--h-positive-text)", bg: "var(--h-positive-tint)" },
  info: { text: "var(--h-info-text)", bg: "var(--h-info-tint)" },
  warning: { text: "var(--h-warning-text)", bg: "var(--h-warning-tint)" },
  negative: { text: "var(--h-negative-text)", bg: "var(--h-negative-tint)" },
  neutral: { text: "var(--h-neutral-text)", bg: "var(--h-neutral-tint)" },
};

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter((w) => /^[\p{L}\p{N}]/u.test(w))
    .slice(0, 2)
    .map((w) => w.charAt(0).toUpperCase())
    .join("");
}

function Row({ row }: { row: ClientRow }) {
  const money = family("money");
  return (
    <li className="flex gap-3 px-4 py-3.5 sm:px-[18px]">
      <span
        aria-hidden="true"
        className="mt-0.5 flex h-9 w-9 flex-none items-center justify-center rounded-full text-[13px] font-semibold"
        style={{ background: money.tint, color: money.text }}
      >
        {initials(row.name)}
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1.5">
          {row.href ? (
            <AppLink href={row.href} className="truncate text-[15px] font-semibold leading-[1.3] text-content-strong hover:underline">
              {row.name}
            </AppLink>
          ) : (
            <span className="truncate text-[15px] font-semibold leading-[1.3] text-content-strong">{row.name}</span>
          )}
          {row.chips.map((c) => (
            <span
              key={c.label}
              title={c.tip}
              className="inline-flex items-center rounded-full px-2 py-[2px] text-[11.5px] font-semibold leading-[1.4]"
              style={{ color: CHIP[c.tone].text, background: CHIP[c.tone].bg }}
            >
              {c.label}
            </span>
          ))}
          {row.crmUrl && (
            <a
              href={row.crmUrl}
              target="_blank"
              rel="noreferrer"
              className="text-[12px] text-content-muted underline-offset-2 hover:text-content-strong hover:underline"
            >
              ClickUp
            </a>
          )}
        </div>
        <dl className="m-0 grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-4">
          {row.money.map((m) => (
            <div key={m.label} className="flex min-w-0 flex-col">
              <dt className="text-[11.5px] text-content-muted">{m.label}</dt>
              <dd className="m-0 inline-flex min-w-0 items-center gap-1 text-[13.5px] leading-[1.35] tabular">
                {m.text === null ? (
                  <>
                    <span className="text-content-muted">{NO_VALUE}</span>
                    <InfoTip text={m.tip} label={`Why ${m.label} is n/a`} />
                  </>
                ) : (
                  <>
                    <span className="truncate font-semibold" style={{ color: money.text }}>
                      {m.text}
                    </span>
                    {m.suffix && <span className="flex-none text-[12px] text-content-muted">{m.suffix}</span>}
                    <InfoTip text={m.tip} label={`About ${m.label}`} />
                  </>
                )}
              </dd>
            </div>
          ))}
        </dl>
      </div>
      {row.href ? (
        <AppLink
          href={row.href}
          tabIndex={-1}
          aria-hidden="true"
          className="flex flex-none items-center self-center pl-1 text-content-muted hover:text-content-strong"
        >
          <Chevron />
        </AppLink>
      ) : (
        <span className="w-[13px] flex-none" aria-hidden="true" />
      )}
    </li>
  );
}

export function ClientList({ rows }: { rows: ClientRow[] }) {
  return (
    <ul className="m-0 list-none divide-y divide-hairline overflow-hidden rounded-card border border-hairline bg-surface-card p-0 shadow-sm">
      {rows.map((r) => (
        <Row key={r.key} row={r} />
      ))}
    </ul>
  );
}
