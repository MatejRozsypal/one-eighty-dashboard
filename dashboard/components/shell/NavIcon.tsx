/**
 * The outline icon beside a top-level nav item.
 *
 * Inline SVG in the same style as the product rail (24 grid, 1.7 stroke, round
 * caps, `currentColor`), so the two columns read as one set and no icon
 * dependency is added. Decorative: the label beside it is the accessible name.
 */

import type { NavIconKey } from "@/lib/nav";

const PATHS: Record<NavIconKey, React.ReactNode> = {
  // Profitability
  snapshot: (
    <>
      <rect x="3.5" y="3.5" width="7" height="8" rx="1.6" />
      <rect x="13.5" y="3.5" width="7" height="5" rx="1.6" />
      <rect x="13.5" y="11.5" width="7" height="9" rx="1.6" />
      <rect x="3.5" y="14.5" width="7" height="6" rx="1.6" />
    </>
  ),
  goals: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <circle cx="12" cy="12" r="4.5" />
      <circle cx="12" cy="12" r="0.9" />
    </>
  ),
  growth: (
    <>
      <path d="M3.5 17l6-6 4 4 7-8" />
      <path d="M15 7h5.5v5.5" />
    </>
  ),
  orders: (
    <>
      <path d="M6 3.5h12v17l-3-2-3 2-3-2-3 2z" />
      <path d="M9 8.5h6M9 12h6" />
    </>
  ),
  products: (
    <>
      <path d="M3.5 4.5v7.2c0 .3.1.5.3.7l8 8c.4.4 1 .4 1.4 0l7-7c.4-.4.4-1 0-1.4l-8-8a1 1 0 0 0-.7-.3H4.5a1 1 0 0 0-1 1z" />
      <circle cx="8" cy="8" r="1.2" />
    </>
  ),
  "unit-economics": (
    <>
      <rect x="5" y="3.5" width="14" height="17" rx="2.2" />
      <rect x="8" y="6.5" width="8" height="3" rx="0.8" />
      <path d="M8.5 13.5h.01M12 13.5h.01M15.5 13.5h.01M8.5 17h.01M12 17h.01M15.5 17h.01" />
    </>
  ),
  // Inventory
  stock: (
    <>
      <path d="M12 3.5l8 4.2v8.6l-8 4.2-8-4.2V7.7z" />
      <path d="M4 7.7l8 4.3 8-4.3" />
      <path d="M12 12v8.5" />
    </>
  ),
  catalogue: (
    <>
      <path d="M5 5.5A1.5 1.5 0 0 1 6.5 4H19v13.5H6.5A1.5 1.5 0 0 0 5 19z" />
      <path d="M5 19a1.5 1.5 0 0 0 1.5 1.5H19v-3" />
    </>
  ),
  buying: (
    <>
      <path d="M3.5 4.5h2.6l2 10h9.4l1.8-7.3H7" />
      <circle cx="9.5" cy="19" r="1.2" />
      <circle cx="16.5" cy="19" r="1.2" />
    </>
  ),
  // Marketing
  paid: (
    <>
      <path d="M4 10v4a1 1 0 0 0 1 1h2.5l8 4V5l-8 4H5a1 1 0 0 0-1 1z" />
      <path d="M7.5 15l1 4.5h2.2l-.9-4.2" />
      <path d="M19 9.5a3.5 3.5 0 0 1 0 5" />
    </>
  ),
  email: (
    <>
      <rect x="3.5" y="5.5" width="17" height="13" rx="2.2" />
      <path d="M4 7l8 6 8-6" />
    </>
  ),
  // Retention
  customers: (
    <>
      <circle cx="9" cy="8.5" r="3.2" />
      <path d="M3.5 19.5c0-3.2 2.5-5.2 5.5-5.2s5.5 2 5.5 5.2" />
      <circle cx="17" cy="9.5" r="2.4" />
      <path d="M16.5 14.4c2.6 0 4 1.7 4 4.2" />
    </>
  ),
  "repeat-rate": (
    <>
      <path d="M4 11V9.5A2.5 2.5 0 0 1 6.5 7H18" />
      <path d="M15.5 4.5L18 7l-2.5 2.5" />
      <path d="M20 13v1.5a2.5 2.5 0 0 1-2.5 2.5H6" />
      <path d="M8.5 19.5L6 17l2.5-2.5" />
    </>
  ),
  gaps: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 2" />
    </>
  ),
  cohorts: (
    <>
      <path d="M12 3.5l8.5 4.5-8.5 4.5L3.5 8z" />
      <path d="M3.5 12.2l8.5 4.5 8.5-4.5" />
      <path d="M3.5 16.4L12 21l8.5-4.6" />
    </>
  ),
  repurchase: (
    <>
      <path d="M5.5 8h13l-1 12h-11z" />
      <path d="M9 8V7a3 3 0 0 1 6 0v1" />
    </>
  ),
  // Creative
  creatives: (
    <>
      <rect x="3.5" y="4.5" width="17" height="15" rx="2.5" />
      <circle cx="8.8" cy="9.6" r="1.6" />
      <path d="M20.5 15.2l-4.3-4.1L6 19.5" />
    </>
  ),
  concepts: (
    <>
      <path d="M9 18h6M10 21h4" />
      <path d="M12 3.5a5.5 5.5 0 0 0-3.4 9.8c.6.5.9 1.1.9 1.7V16h5v-1c0-.6.3-1.2.9-1.7A5.5 5.5 0 0 0 12 3.5z" />
    </>
  ),
  breakdown: (
    <>
      <path d="M12 3.5a8.5 8.5 0 1 0 8.5 8.5H12z" />
      <path d="M15 3.9a8.5 8.5 0 0 1 5.1 5.1H15z" />
    </>
  ),
  velocity: <path d="M13 3.5L5.5 13.5H12l-1 7 7.5-10H12z" />,
  production: (
    <>
      <rect x="3" y="6.5" width="18" height="11" rx="2" />
      <circle cx="12" cy="12" r="2.5" />
      <path d="M6.5 12h.01M17.5 12h.01" />
    </>
  ),
};

export function NavIcon({ name, size = 17 }: { name: NavIconKey; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="flex-none"
    >
      {PATHS[name]}
    </svg>
  );
}
