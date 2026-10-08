/**
 * Category glyphs for the card headers, Health style: a filled shape in the
 * category colour beside the category name. Decorative.
 */

import { family, type Family } from "./palette";

export function CategoryIcon({ of }: { of: Family }) {
  const c = family(of).graphic;
  const common = { width: 18, height: 18, viewBox: "0 0 18 18", "aria-hidden": true, focusable: false, className: "block flex-none" } as const;
  switch (of) {
    case "revenue":
      // A flame, Health's Activity mark.
      return (
        <svg {...common}>
          <path
            fill={c}
            d="M9.2 1.2c.5 2.6 4.6 4.4 4.6 9a4.8 4.8 0 0 1-9.6 0c0-2 .9-3.3 2-4.3.1 1.4.8 2.5 1.9 2.9-.5-3 .4-5.6 1.1-7.6z"
          />
        </svg>
      );
    case "cm3":
      // A leaf, Health's Nutrition mark.
      return (
        <svg {...common}>
          <path
            fill={c}
            d="M15.2 2.6C8.3 2.4 3.6 5.6 3.6 10.6c0 1.2.3 2.3.9 3.2l1.3-1.3c1.8-2.4 4.2-4.1 6.5-5-2.5 1.4-4.5 3.4-6 5.9.9.6 2 .9 3.1.9 4.6 0 5.8-5 5.8-11.7z"
          />
        </svg>
      );
    case "amer":
      return (
        <svg {...common} fill="none" stroke={c} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M2.5 13.5l4.6-4.6 3 3 5.4-5.4" />
          <path d="M11.4 6.5h4.1v4.1" />
        </svg>
      );
    case "creative":
      // Sparkles.
      return (
        <svg {...common}>
          <path fill={c} d="M8 1.8l1.7 4.6 4.6 1.7-4.6 1.7L8 14.4 6.3 9.8 1.7 8.1l4.6-1.7z" />
          <path fill={c} d="M14 11.2l.8 2.1 2.1.8-2.1.8-.8 2.1-.8-2.1-2.1-.8 2.1-.8z" />
        </svg>
      );
    default:
      return (
        <svg {...common}>
          <circle cx="9" cy="9" r="6" fill={c} />
        </svg>
      );
  }
}

export function Chevron({ className = "" }: { className?: string }) {
  return (
    <svg
      width="8"
      height="13"
      viewBox="0 0 8 13"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className={`block flex-none ${className}`}
    >
      <path d="M1.5 1.5l5 5-5 5" />
    </svg>
  );
}
