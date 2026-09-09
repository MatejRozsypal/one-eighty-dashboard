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
import { CreativeTabs } from "@/components/creative/CreativeTabs";
import { WindowToggle } from "@/components/creative/WindowToggle";
import { AngleCoverage } from "@/components/creative/AngleCoverage";
import { ConceptList } from "@/components/creative/ConceptList";
import type { ConceptCardData } from "@/components/creative/ConceptCard";
import { DecisionLog, type LoggedDecision, type ReviewRow } from "@/components/creative/DecisionLog";
import {
  NotIngested,
  Scorecard,
  SectionHead,
  Tag,
  ThresholdsMissing,
  pct,
} from "@/components/creative/primitives";
import { buildAdViews, loadCreativeContext } from "@/lib/creative/page";
import { getConcepts, getPersonas } from "@/lib/queries/creative";
import { groupBy, read, sum, UNTAGGED } from "@/lib/creative/model";
import { moneyVerdict, unjudgedVerdict } from "@/lib/creative/verdict";
import { toAdsetView, toVerdictView, type AdView } from "@/lib/creative/view";
import { listDecisions } from "@/lib/creative/store";
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
  const { client, currency, data, thresholds, display, account } = ctx;
  // Everything on this page except the verdict is a measurement. Rendering it
  // against `display` — which equals `thresholds` when they are set, and a
  // judgement-free stand-in when they are not — means a client without a kill
  // line still sees its concepts, its angle coverage and its untagged share,
  // which is the state in which those are most worth seeing.
  const judged = thresholds !== null;

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
    (ad) => ad.tags.conceptName ?? ad.tags.conceptId ?? ""
  );

  // Carries the client and the window into the link, so following a concept
  // does not silently move the reader to another client's lifetime figures.
  const adsHref = (conceptId: string) => {
    const q = new URLSearchParams();
    const c = Array.isArray(searchParams.client) ? searchParams.client[0] : searchParams.client;
    if (c) q.set("client", c);
    if (ctx.window === "30d") q.set("window", "30d");
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
    const r = read(components, account.meanRoas, account.spend, display);
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

    const meta = g.untagged ? null : conceptMeta.get(g.key) ?? null;

    return {
      key: g.key,
      conceptId: g.untagged ? null : g.key,
      conceptCode: meta?.conceptCode ?? null,
      clickupUrl: g.untagged ? null : conceptUrl.get(g.key) ?? null,
      adsHref: g.untagged ? null : adsHref(g.key),
      name: g.untagged ? "Untagged legacy creative" : (first.tags.conceptName ?? g.key),
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
  // persona and offer were never filled — which every ad inheriting from it
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
  // supports is an order-of-magnitude one — "six, not twelve" — so a precise
  // quarter boundary would be false precision.
  const quarterSpend =
    ctx.window === "30d" ? account.spend * 3 : account.spend / 2;
  const capacity = personaCapacity(
    purchasesForPrecision(display.maxCiHalfWidth),
    display.targetCpa,
    quarterSpend,
    personas.length || personasUsed.size,
    Math.max(0, (personas.length || personasUsed.size) - personasUsed.size)
  );

  // ── Hooks per body, and when it is not a measurement ────────────────────
  // The ratio only means anything if somebody wrote a body code on the ads. On
  // Manami not one of 55 carries one, and the naive version of this counted
  // every ad's `b?` as the same body — turning "one body per concept" into a
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
      account.meanRoas,
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
      {!judged && <ThresholdsMissing clientName={client.name} />}

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
            value: hooksPerBody === null ? "—" : hooksPerBody.toFixed(1),
            sub:
              hooksPerBody === null
                ? "no Body code on any ad"
                : `${bodies} ${bodies === 1 ? "body" : "bodies"} · target 6`,
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
        <SectionHead title="Live concepts" eyebrow="sorted by spend · click a creative to open it" />
        <ConceptList cards={cards} currency={currency} clientId={client.clientId} />
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
          <SectionHead
            title="In the bank"
            eyebrow={`${roster.length} concepts written · ${tagged.length} running`}
          />

          {incomplete.length > 0 && (
            <div className="glass mb-3 flex flex-col gap-3 border-warning/40 p-5">
              <span className="font-mono text-[10.5px] uppercase tracking-eyebrow text-warning">
                {incomplete.length} of {roster.length} inherit nothing
              </span>
              <p className="m-0 max-w-[74ch] text-[13px] leading-[1.7] text-content-body">
                An ad takes its persona, angle and offer from its concept and
                cannot override them. On these the concept itself is blank, so
                every ad attached to one shows a dashed placeholder wherever a
                tag should be — and no amount of tagging in the ad pipeline
                fixes it. These are decisions, not data entry: nothing here can
                guess them.
              </p>
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
                {dormant.length} written, no delivery in this window
              </span>
              <ul className="m-0 flex list-none flex-col gap-2 p-0">
                {dormant.map((c) => (
                  <li key={c.conceptId} className="flex flex-wrap items-baseline gap-x-3 gap-y-1.5">
                    {c.conceptCode && (
                      <span className="font-mono text-[11.5px] text-content-muted">{c.conceptCode}</span>
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

      {/* Last, and not in the mockup at all — which is why it sits after
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
          <SectionHead
            title="This week's decisions"
            eyebrow="ad set level · where money verdicts are taken"
          />
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
  ctx: Awaited<ReturnType<typeof loadCreativeContext>>;
  children: React.ReactNode;
}) {
  return (
    <>
      <Header eyebrow={`Creative · ${ctx.client.name}`} title="Concepts" />
      <main className="page-frame flex flex-col gap-6 px-5 pb-14 pt-0 lg:px-8">
        <CreativeTabs unmapped={ctx.unmappedCount} href="/creative#unmapped" />
        <div className="flex flex-wrap items-center justify-between gap-3">
          <CreativeBar
            unmapped={0}
            window={ctx.window}
            through={ctx.data.through}
            currency={ctx.currency}
            href="/creative#unmapped"
          />
          <WindowToggle current={ctx.window} />
        </div>
        {/* The definition, where the design puts it: beside the screen's name.
            The app shell owns that line and spends it on the client, so it sits
            here instead. It is load-bearing on this screen — every card below
            is exactly one persona, one angle and one offer, and a reader who
            does not know that reads the three chips as a list of attributes. */}
        <p className="-mt-1 m-0 font-mono text-[10.5px] uppercase tracking-eyebrow text-content-muted">
          persona × angle × offer · one concept, one ad set
        </p>
        {children}
      </main>
    </>
  );
}
