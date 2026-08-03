/**
 * Product journey — a Sankey of what customers buy next.
 *
 * ── Why this is hand-drawn SVG ──────────────────────────────────────────────
 * The two things that make this diagram readable are the ones a generic Sankey
 * component does not give you: the main path drawn at full strength while every
 * other ribbon recedes, and a 2px gap between stacked segments so adjacent
 * flows of the same colour do not merge into one block. Both are a few lines
 * here and a fight against a library elsewhere.
 *
 * ── Reading the layout ──────────────────────────────────────────────────────
 * One column per order number. A node's height is the customers flowing out of
 * it; a ribbon's thickness is how many took that route. Ribbons leave and
 * arrive in the order the destinations rank, so the heaviest flows stay near
 * the top and the eye can follow one line across without tracking crossings.
 *
 * ── What the colours mean ───────────────────────────────────────────────────
 * A ribbon takes the colour of the product it *leaves*, so "where did GutSense
 * buyers go" is one colour fanning outwards. Colour is identity, never rank —
 * the assignment comes from overall volume computed once, so a product keeps
 * its colour in every column.
 *
 * The four hues were chosen by running the design system's palette validator
 * over candidates in all-pairs mode; four pass every check and five do not, so
 * everything beyond the top four is a neutral grey "Other". See
 * `lib/queries/journey.ts`.
 */

import type { ProductJourney } from "@/lib/queries/journey";
import { OTHER_PRODUCT } from "@/lib/queries/journey";

const WIDTH = 980;
const NODE_W = 13;
/** Vertical gap between stacked segments, so same-coloured flows stay distinct. */
const GAP = 2;
const TOP = 26;
const BOTTOM = 12;
const HEIGHT = 460;

interface Placed {
  x: number;
  y: number;
  h: number;
  product: string;
  customers: number;
  step: number;
}

export function ProductJourneyChart({ journey }: { journey: ProductJourney }) {
  const columns = journey.maxStep + 1;
  const colX = (step: number) =>
    ((step - 1) / (columns - 1)) * (WIDTH - NODE_W - 210) + 8;

  const plot = HEIGHT - TOP - BOTTOM;

  // ── Lay out each column ──────────────────────────────────────────────────
  const placed = new Map<string, Placed>();
  for (let step = 1; step <= columns; step++) {
    const nodes = journey.nodes
      .filter((n) => n.step === step)
      .sort((a, b) => {
        // "Other" sinks to the bottom; it is a residue, not a product, and
        // letting it float by volume makes the eye chase it.
        if (a.product === OTHER_PRODUCT) return 1;
        if (b.product === OTHER_PRODUCT) return -1;
        return b.customers - a.customers;
      });

    const total = nodes.reduce((sum, n) => sum + n.customers, 0);
    if (total === 0) continue;
    const available = plot - GAP * Math.max(0, nodes.length - 1);

    let y = TOP;
    for (const n of nodes) {
      const h = Math.max(2, (n.customers / total) * available);
      placed.set(`${step}|${n.product}`, {
        x: colX(step),
        y,
        h,
        product: n.product,
        customers: n.customers,
        step,
      });
      y += h + GAP;
    }
  }

  // ── Ribbons ──────────────────────────────────────────────────────────────
  // Offsets accumulate per node so ribbons stack against the node edge rather
  // than all starting at its top.
  const outOffset = new Map<string, number>();
  const inOffset = new Map<string, number>();

  const ordered = [...journey.links].sort(
    (a, b) => a.fromStep - b.fromStep || b.customers - a.customers
  );

  const isMain = (step: number, from: string, to: string) =>
    journey.mainPath[step - 1] === from && journey.mainPath[step] === to;

  const ribbons = ordered.flatMap((link) => {
    const source = placed.get(`${link.fromStep}|${link.fromProduct}`);
    const target = placed.get(`${link.fromStep + 1}|${link.toProduct}`);
    if (!source || !target) return [];

    const sourceTotal = source.customers || 1;
    const targetTotal = target.customers || 1;
    const sh = (link.customers / sourceTotal) * source.h;
    const th = (link.customers / targetTotal) * target.h;

    const sKey = `${link.fromStep}|${link.fromProduct}`;
    const tKey = `${link.fromStep + 1}|${link.toProduct}`;
    const sy = source.y + (outOffset.get(sKey) ?? 0);
    const ty = target.y + (inOffset.get(tKey) ?? 0);
    outOffset.set(sKey, (outOffset.get(sKey) ?? 0) + sh);
    inOffset.set(tKey, (inOffset.get(tKey) ?? 0) + th);

    const x0 = source.x + NODE_W;
    const x1 = target.x;
    const cx = (x0 + x1) / 2;
    const main = isMain(link.fromStep, link.fromProduct, link.toProduct);

    return [
      {
        key: `${link.fromStep}-${link.fromProduct}-${link.toProduct}`,
        d: `M ${x0} ${sy} C ${cx} ${sy}, ${cx} ${ty}, ${x1} ${ty} L ${x1} ${ty + th} C ${cx} ${ty + th}, ${cx} ${sy + sh}, ${x0} ${sy + sh} Z`,
        color: journey.colorOf[link.fromProduct] ?? journey.colorOf[OTHER_PRODUCT],
        main,
        link,
      },
    ];
  });

  const stepLabel = (step: number) =>
    step === 1 ? "1st order" : step === 2 ? "2nd order" : step === 3 ? "3rd order" : `${step}th order`;

  return (
    <figure className="m-0 flex flex-col gap-4">
      <div className="overflow-x-auto">
        <svg
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
          className="w-full min-w-[860px]"
          role="img"
          aria-label="Sankey diagram of which products customers buy in successive orders"
        >
          {/* Column headings */}
          {Array.from({ length: columns }, (_, i) => i + 1).map((step) => (
            <text
              key={step}
              x={colX(step)}
              y={14}
              className="fill-content-muted font-mono text-[10px] uppercase"
              style={{ letterSpacing: "0.08em" }}
            >
              {stepLabel(step)}
            </text>
          ))}

          {/* Ribbons, faint first so the main path is never buried */}
          {ribbons
            .filter((r) => !r.main)
            .map((r) => (
              <path key={r.key} d={r.d} fill={r.color} fillOpacity={0.17}>
                <title>
                  {`${r.link.fromProduct} → ${r.link.toProduct}: ${r.link.customers.toLocaleString()} customers`}
                </title>
              </path>
            ))}
          {ribbons
            .filter((r) => r.main)
            .map((r) => (
              <path key={r.key} d={r.d} fill={r.color} fillOpacity={0.62}>
                <title>
                  {`Main path · ${r.link.fromProduct} → ${r.link.toProduct}: ${r.link.customers.toLocaleString()} customers`}
                </title>
              </path>
            ))}

          {/* Nodes and their labels */}
          {[...placed.values()].map((n) => {
            const color = journey.colorOf[n.product] ?? journey.colorOf[OTHER_PRODUCT];
            const last = n.step === columns;
            return (
              <g key={`${n.step}|${n.product}`}>
                <rect
                  x={n.x}
                  y={n.y}
                  width={NODE_W}
                  height={n.h}
                  rx={3}
                  fill={color}
                >
                  <title>
                    {`${n.product} · ${stepLabel(n.step)}: ${n.customers.toLocaleString()} customers`}
                  </title>
                </rect>
                {/*
                  Only the last column is labelled in place. Labelling every
                  node repeats the legend four times and collides with the
                  ribbons; the endpoints are what the reader is tracing toward.
                */}
                {last && n.h >= 11 && (
                  <text
                    x={n.x + NODE_W + 7}
                    y={n.y + n.h / 2 + 3.5}
                    className="fill-content-body text-[10.5px]"
                  >
                    {n.product.length > 26 ? `${n.product.slice(0, 25)}…` : n.product}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
      </div>

      {/* Legend — identity is never colour alone, and ≥2 series always has one */}
      <figcaption className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          {journey.legend.map((item, i) => (
            <span key={item.product} className="flex items-center gap-1.5">
              <span
                aria-hidden="true"
                className="h-2.5 w-2.5 flex-none rounded-[3px]"
                style={{ backgroundColor: item.color }}
              />
              <span className="text-[12px] text-content-body">
                {item.product}
              </span>
              {i === 0 && (
                <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-content-muted">
                  main path
                </span>
              )}
            </span>
          ))}
          <span className="flex items-center gap-1.5">
            <span
              aria-hidden="true"
              className="h-2.5 w-2.5 flex-none rounded-[3px]"
              style={{ backgroundColor: journey.colorOf[OTHER_PRODUCT] }}
            />
            <span className="text-[12px] text-content-body">{OTHER_PRODUCT}</span>
          </span>
        </div>

        <p className="max-w-[86ch] text-[12px] leading-relaxed text-content-muted">
          A ribbon carries the colour of the product it leaves, so one colour
          fanning out is where that product&rsquo;s buyers went next. The heaviest
          route through the diagram is drawn solid; everything else is faint.
          Only four products can be told apart by colour at once, so the rest are
          grouped — they are still in the table below.
        </p>
      </figcaption>
    </figure>
  );
}
