/**
 * The outline icon of a product (Home, Assistant, Analytics, Creative,
 * Reports): the top-level rows of the sidebar and of the mobile page sheet.
 *
 * Inline SVG on the same 24 grid and 1.7 stroke as `NavIcon`, so the two sets
 * read as one family and no icon dependency is added. Decorative: the label
 * beside it is the accessible name.
 */

import type { ProductId } from "@/lib/products";

export function ProductIcon({ id, size = 18 }: { id: ProductId; size?: number }) {
  const common = {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.7,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
  };
  if (id === "home")
    return (
      <svg {...common}>
        <path d="M4 10.5L12 4l8 6.5" />
        <path d="M6 9v10.5h4.5V15h3v4.5H18V9" />
      </svg>
    );
  if (id === "chat")
    // A spark, not a speech bubble: the section is an agent, and a bubble would
    // read as team chat, which this is not.
    return (
      <svg {...common}>
        <path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z" />
        <path d="M18.5 15.5l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7z" />
      </svg>
    );
  if (id === "reports")
    // A page with a chart and rules under it: a document you build and share,
    // distinct from the bar chart that means Analytics.
    return (
      <svg {...common}>
        <path d="M7 3.5h7.5L19 8v12a.5.5 0 0 1-.5.5h-11A.5.5 0 0 1 7 20z" />
        <path d="M14.5 3.5V8H19" />
        <path d="M9.5 16.5v-2.2M12 16.5v-4M14.5 16.5v-3" />
      </svg>
    );
  if (id === "analytics")
    return (
      <svg {...common}>
        <path d="M4 20h16" />
        <rect x="5" y="11" width="3.4" height="6" rx="1" />
        <rect x="10.3" y="6" width="3.4" height="11" rx="1" />
        <rect x="15.6" y="13" width="3.4" height="4" rx="1" />
      </svg>
    );
  return (
    <svg {...common}>
      <rect x="3.5" y="4.5" width="17" height="15" rx="2.5" />
      <circle cx="8.8" cy="9.6" r="1.6" />
      <path d="M20.5 15.2l-4.3-4.1L6 19.5" />
    </svg>
  );
}

/** The gear beside Settings at the foot of the sidebar. */
export function SettingsIcon({ size = 18 }: { size?: number }) {
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
    >
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}
