/**
 * Display labels for the raw values the Google marts carry.
 * Unknown values fall back to a readable form of the raw text, never to blank.
 */

import type { BrandClass } from "@/lib/paid/types";

function humanise(raw: string): string {
  const text = raw.toLowerCase().replace(/_/g, " ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

const CHANNEL: Record<string, string> = {
  SEARCH: "Search",
  SHOPPING: "Shopping",
  PERFORMANCE_MAX: "PMax",
  DEMAND_GEN: "Demand Gen",
  VIDEO: "Video",
  DISPLAY: "Display",
};

export function channelLabel(raw: string | null): string {
  return raw ? (CHANNEL[raw] ?? humanise(raw)) : "Other";
}

export const CLASS_LABEL: Record<BrandClass, string> = {
  brand: "Brand",
  non_brand: "Non-brand",
  shopping_pmax: "Shopping & PMax",
  other: "Other",
};

const BIDDING: Record<string, string> = {
  MAXIMIZE_CONVERSION_VALUE: "Max conversion value",
  MAXIMIZE_CONVERSIONS: "Max conversions",
  TARGET_ROAS: "Target ROAS",
  TARGET_CPA: "Target CPA",
  TARGET_SPEND: "Max clicks",
  TARGET_IMPRESSION_SHARE: "Target impression share",
  MANUAL_CPC: "Manual CPC",
  MANUAL_CPV: "Manual CPV",
  MANUAL_CPM: "Manual CPM",
};

export function biddingLabel(raw: string | null): string | null {
  return raw ? (BIDDING[raw] ?? humanise(raw)) : null;
}

/** PMax network order: the largest buckets first, partners last. */
export const NETWORK_ORDER = [
  "SEARCH",
  "YOUTUBE",
  "CONTENT",
  "DISCOVER",
  "GMAIL",
  "SEARCH_PARTNERS",
] as const;

const NETWORK: Record<string, string> = {
  SEARCH: "Search",
  YOUTUBE: "YouTube",
  CONTENT: "Display",
  DISCOVER: "Discover",
  GMAIL: "Gmail",
  SEARCH_PARTNERS: "Search partners",
};

export function networkLabel(raw: string): string {
  return NETWORK[raw] ?? humanise(raw);
}

/**
 * One segment fill per network. Tokens only: red, amber and blue are reserved
 * for status, so the six are steps of the ink, green and gray scales. Every
 * segment is also labelled (inside when wide, in the legend and tooltip always),
 * so colour is never the only way to tell them apart.
 */
export const NETWORK_FILL: Record<string, string> = {
  SEARCH: "bg-growth-600",
  YOUTUBE: "bg-ink-800",
  CONTENT: "bg-growth-300",
  DISCOVER: "bg-gray-400",
  GMAIL: "bg-ink-500",
  SEARCH_PARTNERS: "bg-gray-200",
  OTHER: "bg-gray-150",
};

/** Text colour that stays readable on each fill. */
export const NETWORK_TEXT: Record<string, string> = {
  SEARCH: "text-content-inverse",
  YOUTUBE: "text-content-inverse",
  CONTENT: "text-content-strong",
  DISCOVER: "text-content-strong",
  GMAIL: "text-content-inverse",
  SEARCH_PARTNERS: "text-content-strong",
  OTHER: "text-content-strong",
};

const DEVICE: Record<string, string> = {
  MOBILE: "Mobile",
  DESKTOP: "Desktop",
  TABLET: "Tablet",
  CONNECTED_TV: "TV",
  OTHER: "Other",
};

export function deviceLabel(raw: string): string {
  return DEVICE[raw] ?? humanise(raw);
}

/** Match type: BROAD to "Broad", NEAR_EXACT to "Near exact". */
export function matchLabel(raw: string | null): string | null {
  return raw ? humanise(raw) : null;
}

/** Search term status: Added, Excluded, or None. */
export function statusLabel(raw: string | null): string {
  if (raw === "ADDED") return "Added";
  if (raw === "EXCLUDED" || raw === "ADDED_EXCLUDED") return "Excluded";
  return "None";
}
