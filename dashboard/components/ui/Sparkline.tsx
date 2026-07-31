/**
 * Sparkline — the small trend line on every metric card.
 *
 * Hand-rolled SVG rather than Recharts, on purpose. Recharts is a client-side
 * charting library: every card carrying one becomes a client component, ships
 * ~90 KB of JS, and renders after hydration rather than in the initial HTML. A
 * sparkline is a polyline with no axes, no tooltip and no interaction — it needs
 * none of that. This version renders on the server, costs zero JS, and appears
 * in the first paint.
 *
 * Recharts stays in the project for the real charts (revenue over time, cohort
 * curves), where the interactivity earns its weight.
 */

export interface SparklineProps {
  /** Chronological values. Nulls are gaps — days with no data, not zeros. */
  data: Array<number | null>;
  /** Line color. Defaults to the growth accent. */
  tone?: "accent" | "muted" | "negative";
  width?: number;
  height?: number;
  className?: string;
}

const TONES = {
  accent: { stroke: "var(--accent)", fill: "var(--accent)" },
  muted: { stroke: "var(--gray-300)", fill: "var(--gray-300)" },
  negative: { stroke: "var(--negative)", fill: "var(--negative)" },
} as const;

export function Sparkline({
  data,
  tone = "accent",
  width = 240,
  height = 48,
  className = "",
}: SparklineProps) {
  const points = data.filter((d): d is number => d !== null);

  // Two points is the minimum that describes a trend. Below that, draw nothing
  // rather than a misleading flat line through a single observation.
  if (points.length < 2) {
    return <div className={className} style={{ height }} aria-hidden="true" />;
  }

  const min = Math.min(...points);
  const max = Math.max(...points);
  // A perfectly flat series would divide by zero; render it as a centred line.
  const span = max - min || 1;

  // Inset by the stroke's half-width so the line isn't clipped at the extremes.
  const pad = 2;
  const usableH = height - pad * 2;

  const coords = data.map((value, i) => {
    const x = (i / (data.length - 1)) * width;
    if (value === null) return null;
    const y = pad + usableH - ((value - min) / span) * usableH;
    return { x, y };
  });

  const drawn = coords.filter((c): c is { x: number; y: number } => c !== null);

  const linePath = drawn
    .map((c, i) => `${i === 0 ? "M" : "L"}${c.x.toFixed(2)},${c.y.toFixed(2)}`)
    .join(" ");

  const areaPath = `${linePath} L${drawn[drawn.length - 1].x.toFixed(2)},${height} L${drawn[0].x.toFixed(2)},${height} Z`;

  const last = drawn[drawn.length - 1];
  const colors = TONES[tone];
  const gradientId = `spark-${tone}`;

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      className={`w-full ${className}`}
      style={{ height }}
      role="img"
      aria-label="Trend over the selected period"
    >
      <defs>
        {/*
         * The brand guide forbids gradients as decoration. This one is
         * functional: it fades the area fill so the line stays the figure and
         * the fill reads as shading, not a second object competing with it.
         */}
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={colors.fill} stopOpacity="0.16" />
          <stop offset="100%" stopColor={colors.fill} stopOpacity="0" />
        </linearGradient>
      </defs>

      <path d={areaPath} fill={`url(#${gradientId})`} />
      <path
        d={linePath}
        fill="none"
        stroke={colors.stroke}
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
      {/* End-point dot: anchors the eye on "where we are now". */}
      <circle cx={last.x} cy={last.y} r="2.5" fill={colors.stroke} />
    </svg>
  );
}
