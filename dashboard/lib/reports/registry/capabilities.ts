/**
 * Capability expressions: which registry flags a component or metric needs,
 * and which of them a client lacks.
 *
 * Pure module (type-only imports), safe for the browser bundle: the metric
 * picker uses it for coverage hints.
 *
 * Design: 11_reporting_suite_design.md sections 2.2 and 2.7 step 6.
 * Owner: WP1 (RS1, semantic layer).
 */

import type { ClientCapabilities } from "@/lib/clients";
import type { CapabilitiesModule, EvalCapExpr, MissingCapabilities, ToReportCapabilities } from "../contracts";
import type { CapExpr, Capability } from "./types";

/** Every capability, in a stable order (used for dedupe and messages). */
export const CAPABILITIES: readonly Capability[] = [
  "shop",
  "shopify",
  "shoptet",
  "woocommerce",
  "meta",
  "googleAds",
  "ga4",
  "email",
  "klaviyo",
  "ecomail",
];

/** Source names for "{Source} not connected" (UI copy policy, section 4). */
export const CAPABILITY_LABEL: Readonly<Record<Capability, string>> = {
  shop: "Shop",
  shopify: "Shopify",
  shoptet: "Shoptet",
  woocommerce: "WooCommerce",
  meta: "Meta",
  googleAds: "Google Ads",
  ga4: "GA4",
  email: "Email",
  klaviyo: "Klaviyo",
  ecomail: "Ecomail",
};

/** ClientCapabilities (lib/clients.ts) plus the derived shop and email flags. NULL flags arrive as false. */
export const toReportCapabilities: ToReportCapabilities = (caps: ClientCapabilities) => ({
  shopify: caps.shopify === true,
  shoptet: caps.shoptet === true,
  woocommerce: caps.woocommerce === true,
  meta: caps.meta === true,
  googleAds: caps.googleAds === true,
  klaviyo: caps.klaviyo === true,
  ecomail: caps.ecomail === true,
  ga4: caps.ga4 === true,
  shop: caps.shopify === true || caps.shoptet === true || caps.woocommerce === true,
  email: caps.klaviyo === true || caps.ecomail === true,
});

export const evalCapExpr: EvalCapExpr = (expr, caps) => {
  if (typeof expr === "string") return caps[expr] === true;
  if ("all" in expr) return expr.all.every((e) => evalCapExpr(e, caps));
  return expr.any.some((e) => evalCapExpr(e, caps));
};

/**
 * Leaf capabilities that make `expr` false. For `any`, every leaf of every
 * failing branch is listed (connecting any one of them would do). Empty when
 * the expression holds.
 */
export const missingCapabilities: MissingCapabilities = (expr, caps) => {
  const out = new Set<Capability>();
  const walk = (e: CapExpr): void => {
    if (evalCapExpr(e, caps)) return;
    if (typeof e === "string") {
      out.add(e);
      return;
    }
    const parts = "all" in e ? e.all : e.any;
    for (const p of parts) walk(p);
  };
  walk(expr);
  return CAPABILITIES.filter((c) => out.has(c));
};

/** AND of several expressions, flattened and deduplicated. Returns a bare leaf when only one remains. */
export function allOf(exprs: readonly CapExpr[]): CapExpr {
  const flat: CapExpr[] = [];
  const seen = new Set<string>();
  const push = (e: CapExpr): void => {
    if (typeof e !== "string" && "all" in e) {
      for (const p of e.all) push(p);
      return;
    }
    const key = JSON.stringify(e);
    if (seen.has(key)) return;
    seen.add(key);
    flat.push(e);
  };
  for (const e of exprs) push(e);
  return flat.length === 1 ? flat[0] : { all: flat };
}

/** "Meta not connected": the first missing capability names the source. */
export function notConnectedReason(missing: readonly Capability[]): string {
  const first = missing[0];
  return first ? `${CAPABILITY_LABEL[first]} not connected` : "Not connected";
}

const _conforms: CapabilitiesModule = { toReportCapabilities, evalCapExpr, missingCapabilities };
void _conforms;
