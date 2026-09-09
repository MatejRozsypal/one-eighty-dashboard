/**
 * The demo client's creative data.
 *
 * ── Why this is not the figures from docs/creative-engine/DEMO.html ────────
 * That mockup is built on Manami's REAL reported numbers and real ad names —
 * "Něžná - 13MAR - OE", the Founder story ad set, the PACK6 launch. The demo
 * client is a fictional brand shown to prospects, and putting a paying client's
 * creative names and spend into a screen designed to be presented to strangers
 * is a leak with a plausible-looking cover story.
 *
 * So this reproduces the SHAPE of that account rather than its contents, which
 * is what the demo actually needs to do: one dominant untagged legacy creative
 * holding about a third of spend, a handful of tagged concepts, video and
 * static side by side, one pack still inside its no-touch window, and a spread
 * across winner / carrier / loser / undecided so every state on every screen
 * has something to render.
 *
 * Figures are deterministic, not random — see `lib/demo/random.ts` for why that
 * matters halfway through a presentation.
 */

import { ZERO, type AdRow, type Components, type MonthlySpend, type Tags, NO_TAGS } from "@/lib/creative/model";
import type { CreativeData, CreativeAsset, AdBreakdowns, UnmappedData, TagCoverage, PersonaRow, ConceptRow } from "@/lib/queries/creative";
import { daysInRange, type DateRange } from "@/lib/period";
import type { Candidate } from "@/lib/creative/matching";
import { unit } from "@/lib/demo/random";

const MONTHS = ["2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09"];

interface Seed {
  id: string;
  name: string;
  adset: string;
  concept: string | null;
  persona: string | null;
  angle: string | null;
  offer: string | null;
  stage: string;
  format: string;
  market: string;
  method: string;
  creator: string;
  body: string;
  hook: string;
  /** Spend, revenue, purchases, CTR. The three that decide everything. */
  s: number;
  r: number;
  p: number;
  ctr: number;
  /** Video only: 3s plays and 15s thruplays as a share of impressions. */
  hookRate?: number;
  holdRate?: number;
  /** Spend by month, oldest first. */
  m: number[];
  cost: number;
}

const CONCEPTS: Record<string, { name: string; persona: string; angle: string; offer: string }> = {
  C02: { name: "Which of the seven is yours?", persona: "SampleFirstBuyer", angle: "Curiosity gap", offer: "Discovery set" },
  C03: { name: "Wild, in full size", persona: "SampleFirstBuyer", angle: "Curiosity gap", offer: "Full size" },
  C04: { name: "Scent does not need to shout", persona: "QuietElegance", angle: "Contrarian truth", offer: "Discovery set" },
  C05: { name: "The story behind the label", persona: "HeadacheFromSynthetics", angle: "Founder / origin story", offer: "Discovery set" },
  C07: { name: "Does perfume give you a headache?", persona: "HeadacheFromSynthetics", angle: "Problem agitation", offer: "Discovery set" },
  C09: { name: "Swap the chemistry", persona: "SensitiveSkinSwitcher", angle: "Contrarian truth", offer: "Discovery set" },
  C11: { name: "Risk-free tester", persona: "BlindBuySkeptic", angle: "Comparison / objection handling", offer: "Discovery set" },
  C14: { name: "Summer ritual", persona: "AromatherapyRitual", angle: "Scarcity / urgency", offer: "Promo -20%" },
};

/**
 * Spend is in USD and roughly a tenth of a Czech koruna account's figures, so
 * the demo reads as a small US brand rather than as a converted one. The
 * relationships between the rows — the 34% concentration, the 1.5% hit rate,
 * the one ad set still inside its window — are what the screens are testing.
 */
const SEEDS: Seed[] = [
  { id: "1201", name: "Softly - 13MAR - house", adset: "Evergreen prospecting", concept: null, persona: null, angle: null, offer: null,
    stage: "TOF", format: "STAT", market: "US", method: "Internal studio", creator: "In-house design", body: "b1", hook: "h1",
    s: 4740, r: 11270, p: 195, ctr: 0.031, m: [496, 632, 896, 952, 1024, 740], cost: 36 },
  { id: "1202", name: "SampleFirstBuyer | C02 | TOF | STAT | b1h1 | 01JUL | US", adset: "Discovery pack, 1 Jul", concept: "C02",
    persona: null, angle: null, offer: null, stage: "TOF", format: "STAT", market: "US", method: "Internal studio",
    creator: "In-house design", body: "b1", hook: "h1", s: 500, r: 1225, p: 37, ctr: 0.029, m: [0, 0, 0, 168, 204, 128], cost: 36 },
  { id: "1203", name: "SampleFirstBuyer | C02 | TOF | CAR | b3h1 | 24JUN | CA", adset: "Prospecting CA", concept: "C02",
    persona: null, angle: null, offer: null, stage: "TOF", format: "CAR", market: "CA", method: "Internal studio",
    creator: "In-house design", body: "b3", hook: "h1", s: 464, r: 789, p: 21, ctr: 0.025, m: [0, 0, 104, 120, 128, 112], cost: 56 },
  { id: "1204", name: "SampleFirstBuyer | C03 | TOF | STAT | b1h1 | 25AUG | US", adset: "Pack 5, 14 Aug", concept: "C03",
    persona: null, angle: null, offer: null, stage: "TOF", format: "STAT", market: "US", method: "Internal studio",
    creator: "In-house design", body: "b1", hook: "h1", s: 116, r: 254, p: 7, ctr: 0.028, m: [0, 0, 0, 0, 44, 72], cost: 36 },
  { id: "1205", name: "QuietElegance | C04 | TOF | STAT | b1h1 | 13AUG | US", adset: "Pack 6, 4 Sep", concept: "C04",
    persona: null, angle: null, offer: null, stage: "TOF", format: "STAT", market: "US", method: "UGC",
    creator: "Anna K.", body: "b1", hook: "h1", s: 184, r: 342, p: 9, ctr: 0.026, m: [0, 0, 0, 0, 68, 116], cost: 180 },
  { id: "1206", name: "QuietElegance | C04 | TOF | STAT | b2h1 | 13AUG | US", adset: "Pack 6, 4 Sep", concept: "C04",
    persona: null, angle: null, offer: null, stage: "TOF", format: "STAT", market: "US", method: "Internal studio",
    creator: "In-house design", body: "b2", hook: "h1", s: 164, r: 187, p: 5, ctr: 0.021, m: [0, 0, 0, 0, 58, 106], cost: 36 },
  { id: "1207", name: "HeadacheFromSynthetics | C05 | MOF | STAT | b1h1 | 16JUN | US", adset: "Founder story, 27 May", concept: "C05",
    persona: null, angle: null, offer: null, stage: "MOF", format: "STAT", market: "US", method: "Internal studio",
    creator: "In-house design", body: "b1", hook: "h1", s: 884, r: 1503, p: 40, ctr: 0.022, m: [0, 164, 208, 192, 172, 148], cost: 36 },
  { id: "1208", name: "HeadacheFromSynthetics | C07 | TOF | STAT | b1h1 | 04SEP | US", adset: "Pack 6, 4 Sep", concept: "C07",
    persona: null, angle: null, offer: null, stage: "TOF", format: "STAT", market: "US", method: "AI generated",
    creator: "In-house design", body: "b1", hook: "h1", s: 124, r: 284, p: 7, ctr: 0.036, m: [0, 0, 0, 0, 0, 124], cost: 16 },
  { id: "1209", name: "SensitiveSkinSwitcher | C09 | TOF | STAT | b1h1 | 16JUN | CA", adset: "Prospecting CA", concept: "C09",
    persona: null, angle: null, offer: null, stage: "TOF", format: "STAT", market: "CA", method: "Internal studio",
    creator: "In-house design", body: "b1", hook: "h1", s: 534, r: 886, p: 23, ctr: 0.027, m: [0, 0, 96, 124, 172, 142], cost: 36 },
  { id: "1210", name: "BlindBuySkeptic | C11 | MOF | STAT | b1h1 | 14AUG | US", adset: "Pack 5, 14 Aug", concept: "C11",
    persona: null, angle: null, offer: null, stage: "MOF", format: "STAT", market: "US", method: "Internal studio",
    creator: "In-house design", body: "b1", hook: "h1", s: 376, r: 989, p: 24, ctr: 0.034, m: [0, 0, 0, 0, 224, 152], cost: 36 },
  { id: "1211", name: "BlindBuySkeptic | C11 | TOF | STAT | b2h1 | 13AUG | US", adset: "Pack 6, 4 Sep", concept: "C11",
    persona: null, angle: null, offer: null, stage: "TOF", format: "STAT", market: "US", method: "Internal studio",
    creator: "In-house design", body: "b2", hook: "h1", s: 176, r: 595, p: 15, ctr: 0.032, m: [0, 0, 0, 0, 66, 110], cost: 36 },
  { id: "1212", name: "AromatherapyRitual | C14 | TOF | STAT | b1h1 | 24JUN | CA", adset: "Prospecting CA", concept: "C14",
    persona: null, angle: null, offer: null, stage: "TOF", format: "STAT", market: "CA", method: "AI generated",
    creator: "In-house design", body: "b1", hook: "h1", s: 356, r: 605, p: 16, ctr: 0.029, m: [0, 0, 76, 96, 100, 84], cost: 16 },
  { id: "1213", name: "UGC unboxing - Dana - 29APR", adset: "Evergreen prospecting", concept: null, persona: null, angle: null, offer: null,
    stage: "TOF", format: "DYN", market: "US", method: "UGC", creator: "Dana M.", body: "b1", hook: "h1",
    s: 1148, r: 1986, p: 51, ctr: 0.024, hookRate: 0.224, holdRate: 0.061, m: [244, 216, 196, 124, 168, 200], cost: 180 },
  { id: "1214", name: "Founder story V1 - 6JUN - US", adset: "Founder story, 27 May", concept: null, persona: null, angle: null, offer: null,
    stage: "TOF", format: "DYN", market: "US", method: "Internal studio", creator: "In-house studio", body: "b1", hook: "h1",
    s: 1248, r: 2246, p: 60, ctr: 0.019, hookRate: 0.182, holdRate: 0.043, m: [272, 248, 216, 196, 188, 128], cost: 272 },
  { id: "1215", name: "Founder - Earth Day - 17JUN - US", adset: "Founder story, 27 May", concept: null, persona: null, angle: null, offer: null,
    stage: "TOF", format: "DYN", market: "US", method: "Internal studio", creator: "In-house studio", body: "b1", hook: "h1",
    s: 736, r: 765, p: 19, ctr: 0.016, hookRate: 0.141, holdRate: 0.032, m: [168, 152, 132, 116, 92, 76], cost: 272 },
];

/** Ad sets, with the age that decides the no-touch gate. */
const ADSETS: Record<string, { campaign: string; mode: string; age: number; freq: number }> = {
  "Evergreen prospecting": { campaign: "Prospecting US", mode: "ABO", age: 94, freq: 1.8 },
  "Discovery pack, 1 Jul": { campaign: "Packs US", mode: "CBO", age: 69, freq: 2.4 },
  "Pack 5, 14 Aug": { campaign: "Packs US", mode: "CBO", age: 25, freq: 1.6 },
  // Inside its window on purpose: without one, the "Too early" state never
  // renders and nobody sees that the tool declines to judge a fresh pack.
  "Pack 6, 4 Sep": { campaign: "Packs US", mode: "CBO", age: 4, freq: 1.1 },
  "Prospecting CA": { campaign: "Prospecting CA", mode: "ABO", age: 84, freq: 2.2 },
  "Founder story, 27 May": { campaign: "Prospecting US", mode: "ABO", age: 104, freq: 3.1 },
};

function componentsOf(seed: Seed): Components {
  // Impressions from spend at a plausible CPM, so hook rate and CTR land on the
  // seeded values rather than being invented twice.
  const cpm = 6.5 + unit(`cpm:${seed.id}`) * 2;
  const impressions = Math.round((seed.s / cpm) * 1000);
  const clicks = Math.round(impressions * seed.ctr);
  const isVideo = seed.format === "DYN";

  return {
    ...ZERO,
    spend: seed.s,
    revenue: seed.r,
    purchases: seed.p,
    impressions,
    clicks,
    reach: Math.round(impressions / (ADSETS[seed.adset]?.freq ?? 1.6)),
    addToCart: Math.round(clicks * (0.14 + unit(`atc:${seed.id}`) * 0.06)),
    initiateCheckout: Math.round(clicks * 0.07),
    landingPageViews: Math.round(clicks * 0.82),
    linkClicks: clicks,
    outboundClicks: Math.round(clicks * 0.86),
    uniqueOutboundClicks: Math.round(clicks * 0.72),
    ...(isVideo ? videoCurve(seed, impressions) : {}),
  };
}

/**
 * The eight video points, from a decay fitted through the two seeded rates.
 *
 * ── Why they are not scaled independently ──────────────────────────────────
 * The first version multiplied the hook rate by one factor for the quartiles
 * and the hold rate by another. On a 33-second video that put the 50% quartile
 * at 16.5 seconds ABOVE the ThruPlay figure at 15 seconds — a curve that rises
 * — which is not a rendering artefact but an impossible claim: more people
 * cannot reach 16.5 seconds than reached 15.
 *
 * (The approved mockup has the same inconsistency in its illustrative numbers.
 * It does not matter in a mockup and it matters here, because this dataset is
 * what anyone demonstrating the product is looking at.)
 *
 * Fitting an exponential through y(0) = hook rate and y(15) = hold rate makes
 * every point fall out of one function, so the ordering is correct by
 * construction at any duration.
 *
 * y(0) is the HOOK RATE rather than a separate "started" figure, because the
 * brief defines hook rate as video_play_actions / impressions and that is what
 * the tile and the curve's first point both read. Seeding them from two
 * different numbers would put one hook rate on the tile and a different one at
 * the left edge of the chart beside it.
 */
function videoCurve(seed: Seed, impressions: number): Partial<Components> {
  const hook = seed.hookRate ?? 0.2;
  const hold = seed.holdRate ?? 0.05;
  const len = 32 + Math.round(unit(`len:${seed.id}`) * 12);
  const k = Math.log(hook / hold) / 15;
  const y = (t: number) => hook * Math.exp(-k * t);
  const at = (t: number) => Math.round(impressions * y(t));

  return {
    videoPlays: at(0),        // hook rate numerator
    videoViews: at(3),        // the 3-second definition
    videoP25: at(len * 0.25),
    videoThruplays: at(15),   // ThruPlay: 15 seconds, or complete if shorter
    videoP50: at(len * 0.5),
    videoP75: at(len * 0.75),
    videoP95: at(len * 0.95),
    videoP100: at(len),
    video30s: len > 30 ? at(30) : 0,
  };
}

function tagsOf(seed: Seed): Tags {
  const c = seed.concept ? CONCEPTS[seed.concept] : null;
  if (!c) {
    // An untagged ad still carries what Meta itself knows. Everything that
    // would have come from ClickUp stays null, which is what the dashed "?"
    // chips in the grid are rendering.
    return {
      ...NO_TAGS,
      format: seed.format,
      stage: seed.stage,
      // Null on purpose: the untagged ads predate `Content Purpose`, which is
      // what makes the velocity gauge exercise its inference fallback.
      productionType: null,
      market: seed.market,
      productionMethod: seed.method,
      creatorName: seed.creator,
      creatorId: seed.creator,
      productionCost: seed.cost,
      productionCostSource: "settings",
      bodyCode: seed.body,
      hookCode: seed.hook,
    };
  }
  return {
    clickupTaskId: `demo-${seed.id}`,
    clickupUrl: null,
    conceptId: seed.concept,
    conceptCode: seed.concept,
    conceptName: c.name,
    personaId: c.persona,
    personaName: c.persona,
    angle: c.angle,
    offer: c.offer,
    stage: seed.stage,
    // A mix, so the 80/20 gauge has something to read: a second body or a
    // second hook on a concept is an iteration of it, not a new idea.
    productionType:
      seed.body === "b1" && seed.hook === "h1" ? "Net-new" : "Winner Variant",
    format: seed.format,
    bodyCode: seed.body,
    hookCode: seed.hook,
    productionMethod: seed.method,
    creatorId: seed.creator,
    creatorName: seed.creator,
    creatorType: seed.method === "UGC" ? "UGC creator" : "Brand employee",
    productionCost: seed.cost,
    productionCostSource: "settings",
    briefUrl: null,
    market: seed.market,
    launchedAt: null,
    matchMethod: "creative_id",
    matchConfidence: 1,
  };
}

function monthly(seed: Seed): MonthlySpend[] {
  return MONTHS.map((month, i) => ({ month, spend: seed.m[i] ?? 0 }));
}

/**
 * How much of the demo's lifetime figures a range should return.
 *
 * The seeds carry six months of monthly spend and a lifetime total. A shorter
 * range takes proportionally less, which reproduces the effect the range picker
 * exists to show: every interval widens and most rows stop being readable. Six
 * months is the whole seed, so anything at or beyond it returns everything.
 */
function rangeShare(range: DateRange): number {
  const days = daysInRange(range);
  return Math.min(1, days / (MONTHS.length * 30));
}

function adRows(range: DateRange): AdRow[] {
  const fraction = rangeShare(range);
  return SEEDS.map((seed) => {
    const full = componentsOf(seed);
    const share = fraction;
    const scaled = { ...ZERO };
    for (const k of Object.keys(ZERO) as (keyof Components)[]) {
      scaled[k] = Math.round(full[k] * share);
    }

    return {
      adId: seed.id,
      adName: seed.name,
      adsetId: seed.adset,
      adsetName: seed.adset,
      campaignId: ADSETS[seed.adset]?.campaign ?? null,
      campaignName: ADSETS[seed.adset]?.campaign ?? null,
      tags: tagsOf(seed),
      components: fraction >= 1 ? full : scaled,
      monthlySpend: monthly(seed),
    };
  }).sort((a, b) => b.components.spend - a.components.spend);
}

export function demoCreative(range: DateRange): CreativeData {
  const ads = adRows(range);

  const adsets = Object.entries(ADSETS).map(([name, meta]) => {
    const mine = ads.filter((a) => a.adsetId === name);
    const c = mine.reduce<Components>(
      (acc, a) => {
        const out = { ...acc };
        for (const k of Object.keys(ZERO) as (keyof Components)[]) {
          out[k] = acc[k] + a.components[k];
        }
        return out;
      },
      { ...ZERO }
    );
    return {
      adsetId: name,
      adsetName: name,
      campaignId: meta.campaign,
      campaignName: meta.campaign,
      components: c,
      firstDate: null,
      lastDate: null,
      ageDays: meta.age,
      frequencyLatest: meta.freq,
    };
  }).filter((a) => a.components.spend > 0)
    .sort((a, b) => b.components.spend - a.components.spend);

  return {
    ads,
    adsets,
    available: true,
    missing: null,
    currency: "USD",
    through: "2026-09-08",
  };
}

export function demoAssets(): Map<string, CreativeAsset> {
  const copy: Record<string, { title: string; body: string; desc: string; cta: string }> = {
    "1201": { title: "Softly. Scent from plants.", body: "A scent that stays close. Hand-blended oil perfume from essential oils, with no alcohol and no synthetic fixatives.\nSeven scents to try at home before you choose yours.", desc: "Hand-made in small batches", cta: "SHOP_NOW" },
    "1202": { title: "Which of the seven is yours?", body: "Do not buy perfume blind. The discovery set holds all seven scents in miniature, so you find yours before you spend on a full size.", desc: "Discovery set $24", cta: "LEARN_MORE" },
    "1207": { title: "Why we started", body: "We started because ordinary perfume left us unable to breathe. So we blended our own. Today there are seven.", desc: "The story", cta: "LEARN_MORE" },
    "1208": { title: "It is not you. It is the formula.", body: "A headache within the hour. No, you are not oversensitive.\nWhat sits behind that feeling is the formula: ordinary perfume is built on alcohol and synthetic fixatives that evaporate into the air around you and hang there.\nOurs is an oil perfume. No alcohol, no synthetic fixatives, it stays on skin rather than in the room.", desc: "Discovery set $24", cta: "LEARN_MORE" },
    "1213": { title: "Seven scents, one unboxing", body: "Dana opens the discovery set for the first time. No script, no cutaways.", desc: "Discovery set $24", cta: "LEARN_MORE" },
    "1214": { title: "How it is made", body: "How an oil perfume is made in a small studio. From essence to bottle.", desc: "Hand-made in small batches", cta: "LEARN_MORE" },
    "1215": { title: "Earth Day", body: "On Earth Day, why we chose an oil base and glass bottles.", desc: "Less chemistry, by design", cta: "LEARN_MORE" },
  };

  return new Map(
    SEEDS.map((s) => {
      const c = copy[s.id];
      return [
        s.id,
        {
          adId: s.id,
          // Null on purpose. No asset has been mirrored for the demo client, so
          // the grid renders its placeholder tile and the panel says the asset
          // is not in the bucket — which is exactly what a real client looks
          // like before the Cloud Run job has run, and worth seeing.
          assetUri: null,
          thumbUri: null,
          assetKind: s.format === "DYN" ? "video" : "image",
          objectType: s.format === "DYN" ? "VIDEO" : "PHOTO",
          // Same expression as `videoCurve`, from the same seed: the curve is fitted
          // to this duration, and a different one here would plot the points
          // against the wrong clock.
          videoLengthSec: s.format === "DYN" ? 32 + Math.round(unit(`len:${s.id}`) * 12) : null,
          title: c?.title ?? null,
          body: c?.body ?? null,
          linkDescription: c?.desc ?? null,
          callToActionType: c?.cta ?? null,
          linkUrl: null,
          bodies: [],
          titles: [],
          effectiveStatus: ADSETS[s.adset]?.age && ADSETS[s.adset].age < 90 ? "ACTIVE" : "PAUSED",
          adsetName: s.adset,
          campaignName: ADSETS[s.adset]?.campaign ?? null,
        },
      ];
    })
  );
}

const AGES = ["18-24", "25-34", "35-44", "45-54", "55-64", "65+"];
const PLACEMENTS = [
  "Instagram Feed", "Instagram Reels", "Instagram Stories",
  "Facebook Feed", "Facebook Reels", "Audience Network",
];

export function demoBreakdowns(adId: string): AdBreakdowns {
  const seed = SEEDS.find((s) => s.id === adId);
  const impressions = seed ? componentsOf(seed).impressions : 100000;

  const ageWeights = [3, 17, 27, 24, 19, 10].map(
    (w, i) => Math.max(1, w + (unit(`age:${adId}:${i}`) - 0.5) * 8)
  );
  const ageTotal = ageWeights.reduce((a, b) => a + b, 0);

  const placeWeights = [31, 22, 14, 20, 7, 6].map(
    (w, i) => Math.max(2, w + (unit(`pl:${adId}:${i}`) - 0.5) * 10)
  );
  const placeTotal = placeWeights.reduce((a, b) => a + b, 0);

  return {
    ages: AGES.map((label, i) => ({
      label,
      impressions: Math.round((ageWeights[i] / ageTotal) * impressions),
      spend: Math.round(((ageWeights[i] / ageTotal) * (seed?.s ?? 0)) * 100) / 100,
      purchases: Math.round(((ageWeights[i] / ageTotal) * (seed?.p ?? 0))),
    })),
    femaleShare: 0.84 + unit(`f:${adId}`) * 0.12,
    placements: PLACEMENTS.map((label, i) => ({
      label,
      impressions: Math.round((placeWeights[i] / placeTotal) * impressions),
      spend: Math.round(((placeWeights[i] / placeTotal) * (seed?.s ?? 0)) * 100) / 100,
      purchases: Math.round(((placeWeights[i] / placeTotal) * (seed?.p ?? 0))),
    })).sort((a, b) => b.impressions - a.impressions),
  };
}

export function demoUnmapped(): UnmappedData {
  const unmapped = SEEDS.filter((s) => !s.concept);
  return {
    ads: unmapped.map((s) => ({
      adId: s.id,
      adName: s.name,
      spend: s.s,
      purchases: s.p,
      impressions: componentsOf(s).impressions,
      firstSeen: "2026-04-01",
      lastSeen: "2026-09-08",
    })),
    candidates: [
      { taskId: "d-t1", taskName: "Softly - 13MAR - house", taskUrl: null, status: "live", conceptId: null, conceptName: null, market: "US", contentFormat: "STAT" },
      { taskId: "d-t2", taskName: "Founder story V1", taskUrl: null, status: "live", conceptId: "C05", conceptName: CONCEPTS.C05.name, market: "US", contentFormat: "DYN" },
      { taskId: "d-t3", taskName: "Founder - Earth Day", taskUrl: null, status: "live", conceptId: "C05", conceptName: CONCEPTS.C05.name, market: "US", contentFormat: "DYN" },
      { taskId: "d-t4", taskName: "UGC unboxing - Dana", taskUrl: null, status: "live", conceptId: null, conceptName: null, market: "US", contentFormat: "DYN" },
    ] satisfies Candidate[],
    available: true,
  };
}

export function demoCoverage(): TagCoverage {
  const tagged = SEEDS.filter((s) => s.concept).reduce((a, s) => a + s.s, 0);
  const total = SEEDS.reduce((a, s) => a + s.s, 0);
  return {
    pctSpendTagged: tagged / total,
    spendTotal: total,
    ads: SEEDS.length,
    adsTagged: SEEDS.filter((s) => s.concept).length,
  };
}

export function demoPersonas(): PersonaRow[] {
  const used = new Set(Object.values(CONCEPTS).map((c) => c.persona));
  // Twelve declared, six actually spent on — the exact shape the persona
  // capacity statement is about.
  const dormant = [
    "BusyParent", "GiftBuyer", "LayeringEnthusiast",
    "FragranceFreeOffice", "TeenFirstScent", "SubscriptionSaver",
  ];
  return [
    ...[...used].map((p) => ({ personaId: p, name: p, status: "active", clickupUrl: null })),
    ...dormant.map((p) => ({ personaId: p, name: p, status: "active", clickupUrl: null })),
  ];
}

export function demoConcepts(): ConceptRow[] {
  // Two of the eight are written and never briefed against — the state the
  // Concepts screen exists to make visible.
  return [
    ...Object.entries(CONCEPTS).map(([id, c]) => ({
      conceptId: id,
      conceptCode: id,
      name: c.name,
      angle: c.angle,
      offer: c.offer,
      personaId: c.persona,
      clickupUrl: null,
      multiValued: false,
    })),
    {
      conceptId: "C16", conceptCode: "C16", name: "Gift set, wrapped",
      angle: null, offer: null, personaId: null, clickupUrl: null, multiValued: false,
    },
    {
      conceptId: "C17", conceptCode: "C17", name: "The refill argument",
      angle: "Cost of inaction", offer: "Refill", personaId: "QuietElegance",
      clickupUrl: null, multiValued: false,
    },
  ];
}

/** Six months of launches: a ramp, a peak, then a stall. */
export function demoLaunchDates(): string[] {
  const now = new Date();
  const perMonth = [1, 2, 4, 3, 1, 1];
  const out: string[] = [];
  perMonth.forEach((n, i) => {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (5 - i), 8));
    for (let k = 0; k < n; k++) out.push(d.toISOString().slice(0, 10));
  });
  return out;
}

/** Account totals for a comparison range, scaled the same way the ads are. */
export function demoTotals(range: DateRange): Components | null {
  const rows = adRows(range);
  if (rows.length === 0) return null;
  const out = { ...ZERO };
  for (const r of rows) {
    for (const k of Object.keys(ZERO) as (keyof Components)[]) {
      out[k] += r.components[k];
    }
  }
  return out.spend > 0 ? out : null;
}
