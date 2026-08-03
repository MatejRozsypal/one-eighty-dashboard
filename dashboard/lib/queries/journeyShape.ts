/**
 * The shape of a product journey — ranking, bucketing, colouring, main path.
 *
 * Split from `journey.ts` so it imports nothing: the query module pulls in the
 * BigQuery client and `server-only`, which makes the logic below impossible to
 * run anywhere except inside a request. Kept pure, the same code that renders
 * production can be replayed over real warehouse rows in a scratch script and
 * the geometry checked before anyone sees it.
 */

/** Products beyond the coloured four collapse into this. */
export const OTHER_PRODUCT = "Other products";

/**
 * Validated with the design system's palette checker, all-pairs, light surface:
 * lightness band PASS, chroma floor PASS, CVD separation PASS (worst 9.2),
 * normal-vision floor PASS (worst 20.5). Green is slot one, so the highest
 * volume product — the main path — carries the brand colour.
 *
 * The checker warns that green is below 3:1 against the surface, which obliges
 * visible labels or a table view. The page has both.
 */
export const JOURNEY_COLORS = ["#12b76a", "#0866ff", "#db2777", "#a16207"];
export const OTHER_COLOR = "#9797a0";

export interface JourneyLink {
  fromStep: number;
  fromProduct: string;
  toProduct: string;
  customers: number;
}

export interface JourneyNode {
  step: number;
  product: string;
  customers: number;
}

export interface ProductJourney {
  /** Highest step shown. Steps beyond this are folded away entirely. */
  maxStep: number;
  nodes: JourneyNode[];
  links: JourneyLink[];
  /** Product → colour. "Other products" always maps to the neutral. */
  colorOf: Record<string, string>;
  /** Coloured products in rank order, for the legend. */
  legend: Array<{ product: string; color: string; customers: number }>;
  /** The single heaviest chain through the diagram, for emphasis. */
  mainPath: string[];
}

export interface FirstProductRepeat {
  product: string;
  customers: number;
  repeaters: number;
  /** Recomputed here from the two counts — never read as a stored percentage. */
  repeatRate: number | null;
  avgLifetimeOrders: number | null;
}

/**
 * Fold a raw transition list into a diagram.
 *
 * Shared by the warehouse and demo paths so the two cannot drift in how they
 * rank, bucket or colour.
 */
export function buildJourney(
  raw: JourneyLink[],
  maxStep: number
): ProductJourney {
  const volume = new Map<string, number>();
  for (const l of raw) {
    if (l.fromStep > maxStep) continue;
    volume.set(l.fromProduct, (volume.get(l.fromProduct) ?? 0) + l.customers);
    volume.set(l.toProduct, (volume.get(l.toProduct) ?? 0) + l.customers);
  }

  const ranked = [...volume.entries()].sort((a, b) => b[1] - a[1]);
  const top = ranked.slice(0, JOURNEY_COLORS.length).map(([p]) => p);

  const colorOf: Record<string, string> = { [OTHER_PRODUCT]: OTHER_COLOR };
  top.forEach((p, i) => {
    colorOf[p] = JOURNEY_COLORS[i];
  });

  const label = (p: string) => (colorOf[p] ? p : OTHER_PRODUCT);

  // Re-aggregate after bucketing: two different tail products flowing to the
  // same destination are one ribbon once both are "Other".
  const linkMap = new Map<string, JourneyLink>();
  for (const l of raw) {
    if (l.fromStep > maxStep) continue;
    const from = label(l.fromProduct);
    const to = label(l.toProduct);
    const key = `${l.fromStep}|${from}|${to}`;
    const existing = linkMap.get(key);
    if (existing) existing.customers += l.customers;
    else
      linkMap.set(key, {
        fromStep: l.fromStep,
        fromProduct: from,
        toProduct: to,
        customers: l.customers,
      });
  }
  const links = [...linkMap.values()].sort((a, b) => b.customers - a.customers);

  // A node's size is what flows out of it, except in the last column where
  // nothing flows out and the size is what arrived.
  const nodeMap = new Map<string, JourneyNode>();
  const bump = (step: number, product: string, customers: number) => {
    const key = `${step}|${product}`;
    const existing = nodeMap.get(key);
    if (existing) existing.customers += customers;
    else nodeMap.set(key, { step, product, customers });
  };
  for (const l of links) {
    bump(l.fromStep, l.fromProduct, l.customers);
    if (l.fromStep === maxStep) bump(l.fromStep + 1, l.toProduct, l.customers);
  }

  // The main path is greedy: start at the biggest first-order product and
  // follow the heaviest ribbon out of it at each step. It is the single most
  // travelled route, which is the thing worth drawing attention to.
  //
  // "Other" is excluded at every hop. It is the residue of a hundred tail
  // products, so it is almost always the largest node on the board and a naive
  // greedy walk picks it every time — highlighting "the most common journey is
  // miscellaneous → miscellaneous", which is an artefact of bucketing rather
  // than anything a reader can act on. Caught by rendering it and looking.
  const named = (p: string) => p !== OTHER_PRODUCT;
  const mainPath: string[] = [];
  let current: string | null =
    [...nodeMap.values()]
      .filter((n) => n.step === 1 && named(n.product))
      .sort((a, b) => b.customers - a.customers)[0]?.product ?? null;
  for (let step = 1; current !== null && step <= maxStep + 1; step++) {
    const from: string = current;
    mainPath.push(from);
    const next = links
      .filter(
        (l) => l.fromStep === step && l.fromProduct === from && named(l.toProduct)
      )
      .sort((a, b) => b.customers - a.customers)[0];
    current = next ? next.toProduct : null;
  }

  return {
    maxStep,
    nodes: [...nodeMap.values()],
    links,
    colorOf,
    legend: top.map((p, i) => ({
      product: p,
      color: JOURNEY_COLORS[i],
      customers: volume.get(p) ?? 0,
    })),
    mainPath,
  };
}

