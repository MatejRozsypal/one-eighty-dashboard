/**
 * Apple's Activity rings: concentric, outermost first.
 *
 * One full turn is the comparison the card names (the plan to date, or the
 * same days last year), so a closed ring means level with it. Past one turn
 * the ring stays closed and the excess runs on over it from the top, with a
 * shadow under its rounded end so the second lap reads as a lap. The overflow
 * stops at a second full turn; the figure beside the ring carries the number.
 *
 * A ring with nothing to measure against draws its track only. A negative
 * figure (CM3 early in a month) draws nothing rather than running backwards.
 *
 * Decorative: the figures beside it are the accessible text.
 */

import { family, type Family } from "./palette";

export interface RingSpec {
  family: Family;
  /** Actual over the comparison; 1 = one full turn. Null: track only. */
  fraction: number | null;
}

export function ActivityRings({ rings, size = 128 }: { rings: RingSpec[]; size?: number }) {
  const stroke = Math.round(size * (rings.length > 1 ? 0.115 : 0.14));
  const gap = Math.max(2, Math.round(size * 0.018));
  const centre = size / 2;

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true" focusable="false" className="block flex-none">
      {rings.map((ring, i) => {
        const r = centre - stroke / 2 - i * (stroke + gap);
        const c = 2 * Math.PI * r;
        const colour = family(ring.family);
        const f = ring.fraction === null || !Number.isFinite(ring.fraction) ? 0 : Math.max(0, ring.fraction);
        const main = Math.min(1, f);
        const over = Math.min(0.999, Math.max(0, f - 1));
        // End of the overflow arc, clockwise from the top.
        const angle = 2 * Math.PI * over;
        const end = { x: centre + r * Math.sin(angle), y: centre - r * Math.cos(angle) };
        return (
          <g key={i}>
            <circle cx={centre} cy={centre} r={r} fill="none" stroke={colour.tint} strokeWidth={stroke} />
            {main > 0 && (
              <circle
                cx={centre}
                cy={centre}
                r={r}
                fill="none"
                stroke={colour.graphic}
                strokeWidth={stroke}
                strokeLinecap={main >= 1 ? "butt" : "round"}
                strokeDasharray={main >= 1 ? undefined : `${main * c} ${c}`}
                transform={`rotate(-90 ${centre} ${centre})`}
              />
            )}
            {over > 0 && (
              <>
                <circle
                  cx={end.x}
                  cy={end.y}
                  r={stroke / 2}
                  fill={colour.graphic}
                  style={{ filter: "drop-shadow(0 0 1.5px rgba(0, 0, 0, 0.35))" }}
                />
                <circle
                  cx={centre}
                  cy={centre}
                  r={r}
                  fill="none"
                  stroke={colour.graphic}
                  strokeWidth={stroke}
                  strokeLinecap="butt"
                  strokeDasharray={`${over * c} ${c}`}
                  transform={`rotate(-90 ${centre} ${centre})`}
                />
                <circle cx={end.x} cy={end.y} r={stroke / 2} fill={colour.graphic} />
              </>
            )}
          </g>
        );
      })}
    </svg>
  );
}

/** The rings as an icon for card headers: closed tracks, no figure. */
export function RingsGlyph({ families }: { families: Family[] }) {
  const radii = [7.6, 4.9, 2.2];
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true" focusable="false" className="block flex-none">
      {families.slice(0, 3).map((f, i) => (
        <circle key={i} cx="9" cy="9" r={radii[i]} fill="none" stroke={family(f).graphic} strokeWidth="2.1" />
      ))}
    </svg>
  );
}
