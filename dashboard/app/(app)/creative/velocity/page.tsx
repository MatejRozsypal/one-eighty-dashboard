/**
 * Screen 4 — Velocity.
 *
 * Whether enough creative is being made, and whether the packs it goes into are
 * funded well enough to produce a verdict before the no-touch window closes.
 *
 * ── Why the unit is the pack ───────────────────────────────────────────────
 * Nathan's creatives-per-month model ignores how long an ad takes to spend and
 * does not separate winners from losers. A pack has a fixed cost to a verdict
 * and a fixed duration, so both gaps close. The eight gauges say whether the
 * cadence is being kept; the spec below says whether one pack can actually
 * finish; the horizon table says what changes if you spread the same money
 * differently.
 *
 * The cost of a verdict is fixed. How you spread it is the only real lever.
 */

import type { Metadata } from "next";
import { Header } from "@/components/shell/Header";
import { CreativeBar } from "@/components/creative/CreativeBar";
import { CreativeTabs } from "@/components/creative/CreativeTabs";
import { NotIngested, Scorecard, SectionHead, ThresholdsMissing } from "@/components/creative/primitives";
import { loadCreativeContext } from "@/lib/creative/page";
import { getAdsetLaunchDates } from "@/lib/queries/creative";
import { gauges, horizons, launchCadence, packSpec, type PackSettings } from "@/lib/creative/velocity";
import { LaunchCadence } from "@/components/creative/LaunchCadence";
import { formatMoney } from "@/lib/format";

export const metadata: Metadata = { title: "Velocity" };
export const dynamic = "force-dynamic";

export default async function VelocityPage({
  searchParams,
}: {
  searchParams: { [k: string]: string | string[] | undefined };
}) {
  const ctx = await loadCreativeContext(searchParams);
  const { client, currency, data, thresholds, display, settings } = ctx;

  // ── What survives without a target CPA, and what does not ───────────────
  // The pack model is CPA all the way down: the pack's daily budget is 2× CPA,
  // the ads it can feed follow from that, and the horizon and the testing share
  // follow from those. None of it means anything without the number.
  //
  // The cadence does. How many packs shipped in each of the last six months is
  // counted off the ad sets, and it is the single most useful thing on this
  // screen for an account that has not been configured yet — a team that
  // stopped shipping looks exactly like a team that is fine, until you draw it.
  const judged = thresholds !== null;

  // The two floors are 2× and 0.5× CPA by SOP. A client can override them in
  // settings; the defaults are derived rather than stored so a CPA correction
  // moves the whole model instead of leaving three stale numbers behind.
  const pack: PackSettings = {
    testPurchases: settings.testPurchases,
    targetCpa: display.targetCpa,
    perAdFloorDaily: settings.perAdFloorDaily ?? display.targetCpa * 0.5,
    minPackDaily: settings.minAdsetBudgetDaily ?? display.targetCpa * 2,
    noTouchDays: display.noTouchDays,
    monthlyBudget: settings.monthlyBudget ?? estimateMonthlyBudget(ctx),
    packsPerMonthTarget: settings.packsPerMonthTarget,
    hooksPerBodyTarget: settings.hooksPerBodyTarget,
    netNewShareTarget: settings.netNewShareTarget,
  };

  const spec = packSpec(pack);
  const tiles = gauges({ ads: data.ads, adsets: data.adsets, settings: pack }).filter(
    (g) => judged || !g.cpaDerived
  );
  const options = horizons(pack);
  const cadence = launchCadence(await getAdsetLaunchDates(client.clientId));
  const m = (v: number | null) => formatMoney(v, currency);

  return (
    <Shell ctx={ctx}>
      {!judged && <ThresholdsMissing clientName={client.name} />}

      {!data.available && (
        <NotIngested
          what="No delivery data, so the cadence gauges have nothing to measure."
          object={data.missing}
          hint="The pack arithmetic below still holds — it is derived from the settings, not from delivery."
        />
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {tiles.map((g) => (
          <div key={g.label} className="glass flex flex-col gap-2.5 px-4 py-3.5">
            <div className="flex items-center gap-2">
              <span
                aria-hidden="true"
                className="h-2 w-2 flex-shrink-0 rounded-full"
                style={{ background: STATE_COLOUR[g.state] }}
              />
              <span className="truncate font-mono text-[10px] uppercase tracking-eyebrow text-content-muted">
                {g.label}
              </span>
            </div>
            <div className="flex items-baseline gap-2 whitespace-nowrap">
              <b className="font-mono text-[26px] font-medium leading-none tracking-heading tabular text-content-strong">
                {g.value}
              </b>
              <span className="truncate font-mono text-[11.5px] text-content-muted">
                {g.against}
              </span>
            </div>
            <div className="relative h-1.5 overflow-hidden rounded-xs bg-gray-100">
              <span
                className="absolute inset-y-0 left-0 rounded-xs"
                style={{
                  width: `${Math.max(3, g.fill * 100).toFixed(0)}%`,
                  background: STATE_COLOUR[g.state],
                }}
              />
              {/* The target tick. Without it a half-full bar means nothing —
                  half of what? */}
              <span
                aria-hidden="true"
                className="absolute -inset-y-0.5 w-0.5 bg-content-strong opacity-50"
                style={{ left: `${Math.min(99, g.mark * 100).toFixed(0)}%` }}
              />
            </div>
          </div>
        ))}
      </div>

      {/* The mockup's second block, and the one that was never built. */}
      <section>
        <SectionHead
          title="Packs launched per month"
          eyebrow="weekly to biweekly batch cadence"
        />
        <div className="glass p-5">
          <LaunchCadence months={cadence} target={pack.packsPerMonthTarget} />
          <p className="mt-3 max-w-[78ch] text-[12.5px] leading-[1.6] text-content-muted">
            A pack is an ad set, dated by the month it first delivered. An ad set
            that never spent is not a launch — nothing ran, so nothing can be
            judged, and counting it would let a folder of drafts read as output.
          </p>
        </div>
      </section>

      {/* Everything below is the pack model, and the pack model is the target
          CPA restated four ways. Without one it would be arithmetic on a
          placeholder, printed with the confidence of a measurement. */}
      {judged && (
      <>
      <section>
        <SectionHead title="One pack, start to verdict" eyebrow="current configuration" />
        <Scorecard
          tiles={[
            { label: "Pack budget", value: `${m(pack.minPackDaily)}/day`, sub: "2× CPA floor" },
            { label: "Ads in the pack", value: String(spec.adsPerPack), sub: `${m(pack.perAdFloorDaily)}/day each` },
            { label: "Runs for", value: `${pack.noTouchDays} days`, sub: "no-touch window" },
            { label: "Pack costs", value: m(spec.packCost), sub: "to the decision" },
            { label: "Purchases reached", value: String(spec.purchasesReached), sub: `at ${m(pack.targetCpa)} CPA` },
            { label: "Purchases needed", value: String(spec.purchasesNeeded), sub: "test size" },
          ]}
        />
        {/*
          The horizon does not quite close, and this is the one line on the
          screen that says so. A 14-day pack at the 2× CPA floor reaches 23
          purchases against a test size of 25 — two short, every pack — which
          means either the verdict is taken on thinner data than the standard
          claims or the no-touch window quietly runs long. One decision, two
          answers, stated as a sentence rather than buried in a table.
        */}
        <p className="mt-3 max-w-[78ch] border-l-2 border-hairline-strong pl-4 text-[13.5px] leading-[1.7] text-content-body">
          {spec.closes ? (
            <>
              <strong className="font-medium text-content-strong">
                The pack reaches its verdict inside the no-touch window.
              </strong>{" "}
              No change needed.
            </>
          ) : (
            <>
              <strong className="font-medium text-content-strong">
                Short by {spec.purchasesNeeded - spec.purchasesReached}{" "}
                {spec.purchasesNeeded - spec.purchasesReached === 1 ? "purchase" : "purchases"}.
              </strong>{" "}
              Raise the pack to{" "}
              <span className="font-mono">{m(spec.dailyToClose)}/day</span>, or let it run{" "}
              <span className="font-mono">{spec.daysToClose} days</span> instead of{" "}
              {pack.noTouchDays}.
            </>
          )}
        </p>
      </section>

      <section>
        <SectionHead
          title="If you change the horizon"
          eyebrow="the verdict costs the same, only the pace changes"
        />
        <div className="glass-solid overflow-x-auto">
          <table className="w-full min-w-[620px] border-collapse">
            <thead>
              <tr>
                {["Pack runs for", "Budget / day", "Ads per pack", "Packs / month", "New ads / month", "Share of budget"].map(
                  (h, i) => (
                    <th
                      key={h}
                      className={`border-b border-hairline bg-gray-50/60 px-3.5 py-2.5 font-mono text-[10px] font-medium uppercase tracking-[0.1em] text-content-muted ${
                        i === 0 ? "text-left" : "text-right"
                      }`}
                    >
                      {h}
                    </th>
                  )
                )}
              </tr>
            </thead>
            <tbody>
              {options.map((o) => (
                <tr key={o.days} className={o.current ? "bg-accent-soft/60" : ""}>
                  <td className="border-b border-hairline px-3.5 py-2.5 text-[13px] font-medium text-content-strong">
                    {o.days} days
                    {o.current && (
                      <span className="ml-2 rounded-xs bg-accent-soft px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.08em] text-growth-700">
                        current
                      </span>
                    )}
                  </td>
                  <Cell>{m(o.dailyBudget)}</Cell>
                  <Cell>{o.adsPerPack}</Cell>
                  <Cell>{o.packsPerMonth.toFixed(1)}</Cell>
                  <Cell>{o.newAdsPerMonth}</Cell>
                  <Cell>{Math.round(o.shareOfBudget * 100)}%</Cell>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-3 max-w-[78ch] border-l-2 border-hairline-strong pl-4 text-[13px] leading-[1.7] text-content-muted">
          Anything shorter than the current window spends more than half the
          account on testing. Anything longer outruns the no-touch window and
          starves the pack, because under CBO the carriers take what the test
          pack is not holding.
        </p>
      </section>
      </>
      )}
    </Shell>
  );
}

const STATE_COLOUR = {
  ok: "var(--positive)",
  warn: "var(--warning)",
  bad: "var(--negative)",
} as const;

function Cell({ children }: { children: React.ReactNode }) {
  return (
    <td className="border-b border-hairline px-3.5 py-2.5 text-right font-mono text-[13px] tabular text-content-body">
      {children}
    </td>
  );
}

/**
 * Monthly budget, when nobody has stated one.
 *
 * Derived from the last 30 days of actual delivery rather than defaulted to a
 * round number: the testing-share gauge is a fraction of this, and a wrong
 * denominator would turn a healthy 25% into a red 60% with nothing on screen
 * explaining why.
 */
function estimateMonthlyBudget(ctx: Awaited<ReturnType<typeof loadCreativeContext>>): number {
  const months = new Set(
    ctx.data.ads.flatMap((a) => a.monthlySpend.filter((m) => m.spend > 0).map((m) => m.month))
  ).size;
  return months > 0 ? ctx.account.spend / months : ctx.account.spend;
}

function Shell({
  ctx,
  children,
}: {
  ctx: Awaited<ReturnType<typeof loadCreativeContext>>;
  children: React.ReactNode;
}) {
  return (
    <>
      <Header eyebrow={`Creative · ${ctx.client.name}`} title="Velocity" />
      <main className="page-frame flex flex-col gap-6 px-5 pb-14 pt-0 lg:px-8">
        <CreativeTabs unmapped={ctx.unmappedCount} href="/creative#unmapped" />
        <CreativeBar
          unmapped={0}
          window={ctx.window}
          through={ctx.data.through}
          currency={ctx.currency}
          href="/creative#unmapped"
        />
        {/* The screen's own definition, where the mockup puts it. The app shell
            spends the header's eyebrow on the client, so it sits here. */}
        <p className="-mt-1 m-0 font-mono text-[10.5px] uppercase tracking-eyebrow text-content-muted">
          pack cadence against what the budget can carry
        </p>
        {children}
      </main>
    </>
  );
}
