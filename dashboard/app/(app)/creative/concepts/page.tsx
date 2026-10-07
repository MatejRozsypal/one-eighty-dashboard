/**
 * Screen 2, Concepts.
 *
 * A concept is Persona × Angle × Offer, exactly one of each, and it is the unit
 * the SOP tests. This screen answers two questions in that order: what have we
 * never tried, and what is each thing we did try actually doing.
 *
 * Angle coverage comes first on purpose. At a 1.5% net-new hit rate the most
 * useful fact on the page is usually which of the eighteen angles has never run
 *, a concept card can only report on decisions already taken.
 */

import type { Metadata } from "next";
import { Header } from "@/components/shell/Header";
import { PageControls } from "@/components/controls/PageControls";
import { AngleCoverage } from "@/components/creative/AngleCoverage";
import { ConceptList } from "@/components/creative/ConceptList";
import type { ConceptCardData } from "@/components/creative/ConceptCard";
import { DecisionLog, type LoggedDecision, type ReviewRow } from "@/components/creative/DecisionLog";
import {
  CreativeNotConnected,
  StatLine,
  SectionHead,
  Tag,
  pct,
} from "@/components/creative/primitives";
import { NoData, NotConnected } from "@/components/ui/EmptyState";
import { InfoTip } from "@/components/ui/InfoTip";
import { NO_VALUE } from "@/lib/format";
import { buildAdViews, loadCreative, type CreativeContext } from "@/lib/creative/page";
import { rangeLabel } from "@/lib/params";
import { getConcepts, getPersonas } from "@/lib/queries/creative";
import { groupBy, read, sum, UNTAGGED } from "@/lib/creative/model";
import { conceptLabel, humanizeConceptCode } from "@/lib/creative/display";
import { moneyVerdict, unjudgedVerdict } from "@/lib/creative/verdict";
import { toAdsetView, toVerdictView, type AdView } from "@/lib/creative/view";
import { UnmappedPill } from "@/components/creative/CreativeBar";
import { listDecisions } from "@/lib/creative/store";
import { ANGLES } from "@/lib/creative/vocabulary";
import { daysInRange } from "@/lib/period";
import { personaCapacity } from "@/lib/creative/velocity";
import { purchasesForPrecision } from "@/lib/creative/stats";

export const metadata: Metadata = { title: "Concepts" };
export const dynamic = "force-dynamic";

export default async function ConceptsPage({
  searchParams,
}: {
  searchParams: { [k: string]: string | string[] | undefined };
}) {
  const loaded = await loadCreative(searchParams);
  if (loaded.status === "not-connected") {
    return <CreativeNotConnected title="Concepts" source={loaded.source} />;
  }
  const { ctx } = loaded;
  const { client, currency, data, thresholds, display, account } = ctx;
  // Everything on this page except the verdict is a measurement. Rendering it
  // against `display`, which equals `thresholds` when they are set, and a
  // judgement-free stand-in when they are not, means a client without a kill
  // line still sees its concepts, its angle coverage and its untagged share,
  // which is the state in which those are most worth seeing.
  const judged = thresholds !== null;

  if (!data.available || data.ads.length === 0) {
    return (
      <Shell ctx={ctx}>
        {data.available ? <NoData /> : <NotConnected source="Creative data" />}
      </Shell>
    );
  }

  const [views, personas, roster] = await Promise.all([
    buildAdViews(ctx, display),
    getPersonas(client.clientId),
    getConcepts(client.clientId),
  ]);
  const conceptUrl = new Map(roster.map((c) => [c.conceptId, c.clickupUrl]));
  const byId = new Map(views.map((v) => [v.adId, v]));

  // Spend per angle, for the coverage grid. Untagged spend is excluded from the
  // numerator but NOT from the denominator: the share an angle holds is a share
  // of the whole account, and rebasing it on tagged spend alone would inflate
  // every figure by however much has not been filed.
  const spendByAngle = new Map<string, number>();
  for (const ad of data.ads) {
    if (!ad.tags.angle) continue;
    spendByAngle.set(
      ad.tags.angle,
      (spendByAngle.get(ad.tags.angle) ?? 0) + ad.components.spend
    );
  }

  const groups = groupBy(
    data.ads,
    (ad) => ad.tags.conceptId,
    (ad) => conceptLabel(ad.tags.conceptId, ad.tags.conceptName) ?? ""
  );

  // Carries the client and the window into the link, so following a concept
  // does not silently move the reader to another client's lifetime figures.
  // The incoming params, never the resolved ones, see the note in
  // breakdown/page.tsx. A resolved default written into a link escapes this
  // screen and re-dates every other one.
  const adsHref = (conceptId: string) => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(searchParams)) {
      const one = Array.isArray(v) ? v[0] : v;
      if (one !== undefined && k !== "focus" && k !== "is") q.set(k, one);
    }
    q.set("focus", "conceptId");
    q.set("is", conceptId);
    return `/creative?${q.toString()}`;
  };

  const conceptMeta = new Map(
    data.ads
      .filter((a) => a.tags.conceptId)
      .map((a) => [a.tags.conceptId as string, a.tags])
  );

  const cards: ConceptCardData[] = groups.map((g) => {
    const components = sum(g.ads);
    const r = read(components, account.anchorRoas, account.spend, display);
    const first = g.ads[0];
    const adsets = [...new Set(g.ads.map((a) => a.adsetName ?? NO_VALUE))];
    // The verdict is taken against the OLDEST ad set the concept runs in: the
    // no-touch window belongs to the ad set, and a concept spread across a
    // mature set and a two-day-old one is decidable only on the mature part.
    const ages = ctx.data.adsets
      .filter((s) => adsets.includes(s.adsetName))
      .map((s) => s.ageDays)
      .filter((v): v is number => v !== null);
    const ageDays = ages.length ? Math.max(...ages) : null;
    const freqs = ctx.data.adsets
      .filter((s) => adsets.includes(s.adsetName))
      .map((s) => s.frequencyLatest)
      .filter((v): v is number => v !== null);

    const meta = g.untagged ? null : conceptMeta.get(g.key) ?? null;

    return {
      key: g.key,
      conceptId: g.untagged ? null : g.key,
      conceptCode: meta?.conceptCode ?? null,
      clickupUrl: g.untagged ? null : conceptUrl.get(g.key) ?? null,
      adsHref: g.untagged ? null : adsHref(g.key),
      name: g.untagged ? UNTAGGED : (conceptLabel(first.tags.conceptId, first.tags.conceptName) ?? g.key),
      persona: first.tags.personaName ?? first.tags.personaId,
      angle: first.tags.angle,
      offer: first.tags.offer,
      ads: g.ads.map((a) => byId.get(a.adId)).filter((v): v is AdView => Boolean(v)),
      // Null, not 1, when nobody wrote a body code. The card says "1 body"
      // otherwise, which is a claim about how the concept was built rather
      // than an admission that the field is empty.
      bodies: (() => {
        const codes = new Set(
          g.ads.map((a) => a.tags.bodyCode).filter((c): c is string => c !== null)
        );
        return codes.size > 0 ? codes.size : null;
      })(),
      adsets,
      spend: r.spend,
      spendShare: r.spendShare,
      purchases: r.purchases,
      cpa: components.purchases > 0 ? components.spend / components.purchases : null,
      roas: r.roas,
      confidence: r.confidence,
      verdict: toVerdictView(
        judged
          ? moneyVerdict({ level: "concept", components, roas: r.roas, ageDays }, thresholds)
          : unjudgedVerdict()
      ),
      ageDays,
      frequency: freqs.length ? Math.max(...freqs) : null,
    };
  });

  const tagged = cards.filter((c) => c.conceptId !== null);
  const untagged = cards.find((c) => c.key === UNTAGGED);
  // ── The concepts that are not on the screen above ───────────────────────
  // "Live concepts" can only ever list concepts some ad is already attached
  // to. Two states are invisible to it and both are the ones worth acting on:
  // a concept written and never briefed against, and a concept whose angle,
  // persona and offer were never filled, which every ad inheriting from it
  // then inherits nothing from.
  const runningIds = new Set(tagged.map((c) => c.conceptId));
  const dormant = roster.filter((c) => !runningIds.has(c.conceptId));
  const incomplete = roster.filter(
    (c) => c.angle === null || c.offer === null || c.personaId === null
  );
  const personasUsed = new Set(
    data.ads.map((a) => a.tags.personaId).filter((v): v is string => Boolean(v))
  );

  // Quarterly spend, approximated from the window in view. The statement it
  // supports is an order-of-magnitude one, "six, not twelve", so a precise
  // quarter boundary would be false precision.
  // Scaled from whatever range is selected to a quarter, so the statement
  // holds whether somebody is looking at seven days or two years. It supports
  // an order-of-magnitude claim, "six personas, not twelve", so a precise
  // quarter boundary would be false precision either way.
  const quarterSpend = account.spend * (91 / Math.max(1, daysInRange(ctx.params.range)));
  const capacity = personaCapacity(
    purchasesForPrecision(display.maxCiHalfWidth),
    display.targetCpa,
    quarterSpend,
    personas.length || personasUsed.size,
    Math.max(0, (personas.length || personasUsed.size) - personasUsed.size)
  );

  // ── Hooks per body, and when it is not a measurement ────────────────────
  // The ratio only means anything if somebody wrote a body code on the ads. On
  // the pilot account, not one of its 55 carries one, and the naive version of this counted
  // every ad's `b?` as the same body, turning "one body per concept" into a
  // confident 13.8 hooks per body against a target of 6. A fabricated number
  // beside a target is worse than a dash: it reads as a pass.
  const withBodyCode = data.ads.filter((a) => a.tags.bodyCode !== null);
  const bodies = new Set(
    withBodyCode.map((a) => `${a.tags.conceptId ?? a.adId}|${a.tags.bodyCode}`)
  ).size;
  const hooksPerBody = bodies > 0 ? withBodyCode.length / bodies : null;

  // ── The weekly review ───────────────────────────────────────────────────
  // Ad-set level, because that is where the budget lives, where the no-touch
  // window applies, and what the SOP names as the decision grain. Ordered by
  // spend like everything else here.
  const reviewRows: ReviewRow[] = ctx.data.adsets.map((set) => {
    const v = toAdsetView(
      set,
      data.ads.filter((a) => a.adsetId === set.adsetId).length,
      account.anchorRoas,
      account.spend,
      display
    );
    return {
      adsetId: v.adsetId,
      adsetName: v.adsetName,
      campaignName: v.campaignName,
      spend: v.spend,
      purchases: v.purchases,
      roas: v.roas,
      ciLow: v.ciLow,
      ciHigh: v.ciHigh,
      ageDays: v.ageDays,
      verdictCode: v.verdict.code,
      verdictLabel: v.verdict.label,
      verdictSay: v.verdict.say,
      undecided: v.verdict.undecided,
    };
  });

  const recent: LoggedDecision[] = (await listDecisions(client.clientId, 40)).map((d) => ({
    id: d.id,
    entityName: d.entityName,
    computedVerdict: d.computedVerdict,
    finalVerdict: d.finalVerdict,
    overridden: d.overridden,
    learningNote: d.learningNote,
    decidedBy: d.decidedBy,
    decidedAt: d.decidedAt,
  }));

  return (
    <Shell ctx={ctx}>
      <StatLine
        tiles={[
          { label: "Live concepts", value: String(tagged.length), info: "Minimum 3." },
          {
            label: "Angles in use",
            value: `${spendByAngle.size} / ${ANGLES.length}`,
            info: "Of the angles in the ClickUp vocabulary.",
          },
          {
            label: "Personas in use",
            value: `${personasUsed.size} / ${capacity.activePersonas}`,
            // The arithmetic that settles the argument rather than continuing
            // it. Cutting the active set is the fix; a better dashboard is not.
            info: `Capacity: ${capacity.readablePerQuarter} personas a quarter.`,
          },
          {
            label: "Untagged spend",
            value: pct(untagged ? untagged.spendShare : 0),
            info: "Spend on ads with no concept.",
          },
          {
            label: "Top concept share",
            value: pct(cards[0]?.spendShare ?? 0),
            info: "Concentration limit: 60%.",
          },
          {
            label: "Hooks per body",
            value: hooksPerBody === null ? NO_VALUE : hooksPerBody.toFixed(1),
            info:
              hooksPerBody === null
                ? "No Body code on any ad."
                : `${bodies} ${bodies === 1 ? "body" : "bodies"}. Target 6.`,
          },
        ]}
      />

      <section>
        <SectionHead title="Live concepts" />
        <ConceptList
          cards={cards}
          currency={currency}
          clientId={client.clientId}
          rangeLabel={rangeLabel(ctx.params)}
        />
      </section>

      <section>
        <SectionHead title="Angle coverage" />
        <AngleCoverage
          spendByAngle={spendByAngle}
          totalSpend={account.spend}
          currency={currency}
        />
      </section>

      {/* ── The bank ──────────────────────────────────────────────────────
          Everything above is a concept that already has delivery behind it.
          These two lists are the ones that do not, and they are where the next
          decision is: a concept nobody has briefed against, and a concept that
          cannot pass anything down to the ads written against it because its
          own three fields are empty. Neither can appear on a screen built from
          ad rows, which is why the roster is read separately. */}
      {(incomplete.length > 0 || dormant.length > 0) && (
        <section>
          <SectionHead title="In the bank" />

          {incomplete.length > 0 && (
            <div className="glass mb-3 flex flex-col gap-3 border-warning/40 p-5">
              <span className="flex items-center gap-1.5 font-mono text-[10.5px] uppercase tracking-eyebrow text-warning">
                {incomplete.length} of {roster.length} incomplete
                <InfoTip
                  text="Ads take persona, angle and offer from their concept. These concepts leave one blank, so their ads show n/a."
                  label="About incomplete concepts"
                />
              </span>
              <ul className="m-0 flex list-none flex-col gap-2 p-0">
                {incomplete.map((c) => (
                  <li key={c.conceptId} className="flex flex-wrap items-baseline gap-x-3 gap-y-1.5">
                    <span className="text-[13.5px] font-medium text-content-strong">{c.name}</span>
                    <span className="flex flex-wrap gap-1.5">
                      <Tag value={c.personaId} missing="persona" />
                      <Tag value={c.angle} missing="angle" />
                      <Tag value={c.offer} missing="offer" />
                    </span>
                    {c.clickupUrl && (
                      <a
                        href={c.clickupUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="text-[12.5px] text-content-accent underline underline-offset-2"
                      >
                        Fill it in
                      </a>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {dormant.length > 0 && (
            <div className="glass flex flex-col gap-3 p-5">
              <span className="font-mono text-[10.5px] uppercase tracking-eyebrow text-content-muted">
                {dormant.length} without delivery
              </span>
              <ul className="m-0 flex list-none flex-col gap-2 p-0">
                {dormant.map((c) => (
                  <li key={c.conceptId} className="flex flex-wrap items-baseline gap-x-3 gap-y-1.5">
                    {c.conceptCode && (
                      <span className="text-[11.5px] text-content-muted">{humanizeConceptCode(c.conceptCode)}</span>
                    )}
                    <span className="text-[13.5px] text-content-body">{c.name}</span>
                    <span className="flex flex-wrap gap-1.5">
                      <Tag value={c.angle} missing="angle" />
                      <Tag value={c.offer} missing="offer" />
                    </span>
                    {c.clickupUrl && (
                      <a
                        href={c.clickupUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="text-[12.5px] text-content-accent underline underline-offset-2"
                      >
                        Open in ClickUp
                      </a>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}

      {/* Last, and not in the mockup at all, which is why it sits after
          everything the mockup does specify rather than between the two halves
          of it. Angle coverage and the concept roster are one thought: what
          have we never tried, and what did the things we tried do. A decision
          table wedged between them separated a question from its answer.

          It is also the one section here that is genuinely a judgement rather
          than a measurement: every row is a Scale / Hold / Kill against lines
          this client may not have set, and logging a decision would write an
          "unjudged" computed verdict into the record. So it waits for the three
          numbers; nothing above it does. */}
      {judged && reviewRows.length > 0 && (
        <section>
          <SectionHead title="This week's decisions" info="Ad set level, where money verdicts are taken." />
          <DecisionLog
            rows={reviewRows}
            recent={recent}
            clientId={client.clientId}
            currency={currency}
          />
        </section>
      )}
    </Shell>
  );
}

function Shell({
  ctx,
  children,
}: {
  ctx: CreativeContext;
  children: React.ReactNode;
}) {
  return (
    <>
      <Header title="Concepts" />
      <PageControls client={ctx.client} params={ctx.params} />
      <main className="page-frame flex flex-col gap-6 px-5 pb-14 pt-4 lg:px-8">
        {ctx.unmappedCount > 0 && (
          <div className="flex">
            <UnmappedPill count={ctx.unmappedCount} href="/creative#unmapped" />
          </div>
        )}
        {children}
      </main>
    </>
  );
}
