/**
 * The top of the ledger: the greeting, two shortcuts, and the agency's three
 * figures. Agreed retainers (a monthly sum, agreed, not received), the profit
 * share on the latest invoices, and the value generated for clients over
 * their baselines. The last one has no source yet, so it renders as the setup
 * steps that will produce it rather than as a missing number.
 */

import { Greeting } from "@/components/home/Greeting";
import { InfoTip } from "@/components/ui/InfoTip";
import type { LedgerHero as Hero, SetupItem } from "@/lib/home/ledger/types";
import { Money, NotAvailable } from "./bits";
import { StepMark } from "./SetupList";

const LABEL = "inline-flex items-center gap-1 text-[13px] font-semibold text-content-muted";
const FIGURE = "text-[38px] font-bold leading-[1.05] tracking-display text-content-strong sm:text-[42px]";
const CAPTION = "text-[13px] leading-[1.35] text-content-muted";
const CELL = "flex min-w-0 flex-col gap-2 px-5 py-5 sm:px-6 sm:py-6";

function Chip({ href, label, count }: { href: string; label: string; count: string }) {
  const external = href.startsWith("http");
  return (
    <a
      href={href}
      {...(external ? { target: "_blank", rel: "noreferrer" } : {})}
      className="inline-flex items-center gap-2 rounded-pill border border-hairline bg-surface-card px-3.5 py-[7px] text-[13.5px] font-medium text-content-strong shadow-xs transition-colors duration-fast hover:border-hairline-strong"
    >
      {label}
      <span className="rounded-pill bg-[var(--h-neutral-tint)] px-2 py-[1px] text-[12px] font-semibold tabular text-content-body">
        {count}
      </span>
    </a>
  );
}

function SetupState({ steps }: { steps: SetupItem[] }) {
  return (
    <div className="flex flex-col gap-2.5">
      <span className="inline-flex w-fit items-center gap-1.5 rounded-pill bg-[var(--h-info-tint)] px-2.5 py-[3px] text-[12px] font-semibold text-[var(--h-info-text)]">
        Set up to measure
      </span>
      <ol className="m-0 flex list-none flex-col gap-1.5 p-0">
        {steps.map((s) => (
          <li key={s.id} className="flex items-center gap-2 text-[13px] text-content-strong">
            <StepMark done={s.done} small />
            <span className="min-w-0 truncate">{s.title}</span>
            {s.progress && <span className="ml-auto shrink-0 tabular text-content-muted">{s.progress}</span>}
          </li>
        ))}
      </ol>
      <a href="#setup" className="text-[13px] font-semibold text-[var(--h-info-text)] hover:underline">
        Open setup
      </a>
    </div>
  );
}

export function LedgerHero({
  hero,
  name,
  now,
  chips,
}: {
  hero: Hero;
  name: string | null;
  now: string;
  chips: Array<{ href: string; label: string; count: string }>;
}) {
  const { retainers, profitShareLast: share, generated } = hero;
  return (
    <section className="flex flex-col gap-6" aria-label="The partnership">
      <div className="flex flex-col items-center gap-4 pt-2 text-center sm:pt-6">
        <Greeting name={name} now={now} />
        <div className="flex flex-wrap justify-center gap-2">
          {chips.map((c) => (
            <Chip key={c.label} {...c} />
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 divide-y divide-hairline overflow-hidden rounded-card border border-hairline bg-surface-card shadow-sm md:grid-cols-3 md:divide-x md:divide-y-0">
        <div className={CELL}>
          <span className={LABEL}>
            Agreed retainers
            <InfoTip
              text={retainers.note ?? "Sum of monthly retainers: ref.contracts, else ClickUp Retainer CZK. Agreed, not received."}
              label="About agreed retainers"
            />
          </span>
          {retainers.value === null ? (
            <NotAvailable note={retainers.note} label="Agreed retainers" className={FIGURE} />
          ) : (
            <Money value={retainers.value} className={FIGURE} />
          )}
          <span className={CAPTION}>
            per month · {retainers.clients} {retainers.clients === 1 ? "client" : "clients"}
          </span>
        </div>

        <div className={CELL}>
          <span className={LABEL}>
            Profit share, last invoiced
            <InfoTip
              text="Profit share on the latest period in the ClickUp Invoice Tracker. Invoiced, not received."
              label="About profit share invoiced"
            />
          </span>
          {share.value === null ? (
            <NotAvailable note={share.note} label="Profit share invoiced" className={FIGURE} />
          ) : (
            <Money value={share.value} className={FIGURE} />
          )}
          <span className={CAPTION}>
            {share.period ?? "No invoice"}
            {share.value !== null && ` · ${share.clients} ${share.clients === 1 ? "client" : "clients"}`}
          </span>
        </div>

        <div className={CELL}>
          <span className={LABEL}>
            Value generated for clients
            <InfoTip
              text="CM3 above each client's frozen baseline, summed over complete months since the contract began (mart_profit_share_monthly)."
              label="About value generated"
            />
          </span>
          {generated.value === null ? (
            <SetupState steps={hero.generatedSetup} />
          ) : (
            <>
              <Money value={generated.value} className={FIGURE} />
              <span className={CAPTION}>
                CM3 above baseline · {generated.clients} {generated.clients === 1 ? "client" : "clients"}
              </span>
            </>
          )}
        </div>
      </div>
    </section>
  );
}
