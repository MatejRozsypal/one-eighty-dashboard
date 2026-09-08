/**
 * Screen 2 — Concepts.
 *
 * A concept is Persona × Angle × Offer, exactly one of each, and it is the unit
 * the SOP tests. This screen answers two questions in that order: what have we
 * never tried, and what is each thing we did try actually doing.
 *
 * Angle coverage comes first on purpose. At a 1.5% net-new hit rate the most
 * useful fact on the page is usually which of the eighteen angles has never run
 * — a concept card can only report on decisions already taken.
 */

import type { Metadata } from "next";
import { Header } from "@/components/shell/Header";
import { CreativeBar } from "@/components/creative/CreativeBar";
import { WindowToggle } from "@/components/creative/WindowToggle";
import { AngleCoverage } from "@/components/creative/AngleCoverage";
import { ConceptCard, type ConceptCardData } from "@/components/creative/ConceptCard";
import {
  NotIngested,
  Scorecard,
  SectionHead,
  ThresholdsMissing,
  pct,
} from "@/components/creative/primitives";
import { buildAdViews, loadCreativeContext } from "@/lib/creative/page";
import { getPersonas } from "@/lib/queries/creative";
import { groupBy, read, sum, UNTAGGED } from "@/lib/creative/model";
import { moneyVerdict } from "@/lib/creative/verdict";
import { toVerdictView, type AdView } from "@/lib/creative/view";
import { ANGLES } from "@/lib/creative/vocabulary";
import { personaCapacity } from "@/lib/creative/velocity";
import { purchasesForPrecision } from "@/lib/creative/stats";

export const metadata: Metadata = { title: "Concepts" };
export const dynamic = "force-dynamic";

export default async function ConceptsPage({
  searchParams,
}: {
  searchParams: { [k: string]: string | string[] | undefined };
}) {
  const ctx = await loadCreativeContext(searchParams);
  const { client, currency, data, thresholds, account } = ctx;

  if (!data.available || data.ads.length === 0) {
    return (
      <Shell ctx={ctx}>
        <NotIngested
          what="Nothing to group into concepts yet."
          object={data.missing}
          hint="This screen reads the same rows as Creatives; when that one has data, this one does too."
        />
      </Shell>
    );
  }

  if (!thresholds) {
    return (
      <Shell ctx={ctx}>
        <ThresholdsMissing clientName={client.name} />
      </Shell>
    );
  }

  const views = await buildAdViews(ctx, thresholds);
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
    (ad) => ad.tags.conceptName ?? ad.tags.conceptId ?? ""
  );

  const cards: ConceptCardData[] = groups.map((g) => {
    const components = sum(g.ads);
    const r = read(components, account.meanRoas, account.spend, thresholds);
    const first = g.ads[0];
    const adsets = [...new Set(g.ads.map((a) => a.adsetName ?? "—"))];
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

    return {
      key: g.key,
      conceptId: g.untagged ? null : g.key,
      name: g.untagged ? "Untagged legacy creative" : (first.tags.conceptName ?? g.key),
      persona: first.tags.personaName ?? first.tags.personaId,
      angle: first.tags.angle,
      offer: first.tags.offer,
      ads: g.ads.map((a) => byId.get(a.adId)).filter((v): v is AdView => Boolean(v)),
      bodies: new Set(g.ads.map((a) => a.tags.bodyCode ?? "b?")).size,
      adsets,
      spend: r.spend,
      spendShare: r.spendShare,
      purchases: r.purchases,
      cpa: components.purchases > 0 ? components.spend / components.purchases : null,
      roas: r.roas,
      confidence: r.confidence,
      verdict: toVerdictView(
        moneyVerdict({ level: "concept", components, roas: r.roas, ageDays }, thresholds)
      ),
      ageDays,
      frequency: freqs.length ? Math.max(...freqs) : null,
    };
  });

  const tagged = cards.filter((c) => c.conceptId !== null);
  const untagged = cards.find((c) => c.key === UNTAGGED);
  const personas = await getPersonas(client.clientId);
  const personasUsed = new Set(
    data.ads.map((a) => a.tags.personaId).filter((v): v is string => Boolean(v))
  );

  // Quarterly spend, approximated from the window in view. The statement it
  // supports is an order-of-magnitude one — "six, not twelve" — so a precise
  // quarter boundary would be false precision.
  const quarterSpend =
    ctx.window === "30d" ? account.spend * 3 : account.spend / 2;
  const capacity = personaCapacity(
    purchasesForPrecision(thresholds.maxCiHalfWidth),
    thresholds.targetCpa,
    quarterSpend,
    personas.length || personasUsed.size,
    Math.max(0, (personas.length || personasUsed.size) - personasUsed.size)
  );

  const bodies = new Set(
    data.ads.map((a) => `${a.tags.conceptId ?? a.adId}|${a.tags.bodyCode ?? "b?"}`)
  ).size;

  return (
    <Shell ctx={ctx}>
      <Scorecard
        tiles={[
          { label: "Live concepts", value: String(tagged.length), sub: "minimum 3" },
          {
            label: "Angles in use",
            value: `${spendByAngle.size} / ${ANGLES.length}`,
            sub: "ClickUp vocabulary",
          },
          {
            label: "Personas in use",
            value: `${personasUsed.size} / ${capacity.activePersonas}`,
            // The arithmetic that settles the argument rather than continuing
            // it. Cutting the active set is the fix; a better dashboard is not.
            sub: `capacity ${capacity.readablePerQuarter} per quarter`,
          },
          {
            label: "Untagged spend",
            value: pct(untagged ? untagged.spendShare : 0),
            sub: "no concept",
          },
          {
            label: "Top concept share",
            value: pct(cards[0]?.spendShare ?? 0),
            sub: "concentration limit 60%",
          },
          {
            label: "Hooks per body",
            value: bodies > 0 ? (data.ads.length / bodies).toFixed(1) : "—",
            sub: `${bodies} bodies · target 6`,
          },
        ]}
      />

      <section>
        <SectionHead
          title="Angle coverage"
          eyebrow={`${spendByAngle.size} of ${ANGLES.length} in use`}
        />
        <AngleCoverage
          spendByAngle={spendByAngle}
          totalSpend={account.spend}
          currency={currency}
        />
      </section>

      <section>
        <SectionHead title="Live concepts" eyebrow="sorted by spend" />
        {cards.map((c) => (
          <ConceptCard key={c.key} data={c} currency={currency} />
        ))}
      </section>
    </Shell>
  );
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
      <Header eyebrow={`Creative · ${ctx.client.name}`} title="Concepts" />
      <main className="page-frame flex flex-col gap-6 px-5 pb-14 pt-6 lg:px-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <CreativeBar
            unmapped={ctx.unmappedCount}
            window={ctx.window}
            through={ctx.data.through}
            currency={ctx.currency}
            href="/creative#unmapped"
          />
          <WindowToggle current={ctx.window} />
        </div>
        {children}
      </main>
    </>
  );
}
