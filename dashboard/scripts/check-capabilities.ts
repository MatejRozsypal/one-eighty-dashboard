/**
 * Asserts the page requirements table (sprint plan WP1) and the formatter
 * contract against the registry fixtures of all five clients plus demo.
 *
 *     npx tsx --tsconfig scripts/tsconfig.json scripts/check-capabilities.ts
 *
 * Fixtures are the `ref.clients` flags as audited on 2026-10-04 (03 section 1),
 * with NULL flags already mapped to false, as `toClient` does. Exits non-zero
 * on a mismatch. Pure modules only: no BigQuery, no session.
 */

import { pageAvailability, missingSource, hasShop } from "@/lib/capabilities";
import { productFor } from "@/lib/products";
import { navFor, navForProduct, navHref, railProducts, pageTitle, activeNavHref, resolveActive, selectedClient, CREATIVE_NAV, NAV } from "@/lib/nav";
import { formatMoney, formatNumber, formatPercent, formatRatio, NO_VALUE } from "@/lib/format";
import { tickLabels } from "@/components/dashboard/RevenueMix";
import { aggregate, spendGapNotice, paidSpendDelta, type PnlDay, type PnlSnapshot } from "@/lib/queries/pnl";
import type { ClientCapabilities } from "@/lib/clients";

type Caps = ClientCapabilities;
const OFF: Caps = {
  shopify: false, shoptet: false, woocommerce: false, klaviyo: false, ecomail: false,
  meta: false, googleAds: false, ga4: false, instagram: false,
};
const caps = (on: Partial<Caps>): { capabilities: Caps } => ({ capabilities: { ...OFF, ...on } });

const FIXTURES = {
  manami: caps({ shoptet: true, ecomail: true, meta: true, googleAds: true, instagram: true }),
  dobias: caps({ shopify: true, klaviyo: true, meta: true, instagram: true }),
  // Registry has email_platform = ecomail but has_ecomail = FALSE: Email stays hidden (DoD #12).
  venev: caps({ shopify: true, meta: true }),
  ethia: caps({ woocommerce: true, meta: true }),
  rawbark: caps({ woocommerce: true, googleAds: true }),
  // Demo client (lib/demo/client.ts).
  demo: caps({ shopify: true, klaviyo: true, meta: true, googleAds: true }),
};
type Name = keyof typeof FIXTURES;

const SHOP_PAGES = [
  "/snapshot", "/goals", "/growth", "/orders", "/products", "/unit-economics",
  "/customers", "/repeat-rate", "/gaps", "/cohorts", "/repurchase", "/repurchase/timing",
];
const INVENTORY = ["/inventory", "/inventory/catalogue", "/inventory/buying"];
const CREATIVE = ["/creative", "/creative/concepts", "/creative/breakdown", "/creative/velocity", "/creative/velocity/plan", "/creative/production"];

// Expected availability per client: true = available.
const EXPECT: Record<Name, { shop: boolean; inventory: boolean; paid: boolean; email: boolean; creative: boolean }> = {
  manami: { shop: true, inventory: false, paid: true, email: true, creative: true },
  dobias: { shop: true, inventory: true, paid: true, email: true, creative: true },
  venev: { shop: true, inventory: true, paid: true, email: false, creative: true },
  ethia: { shop: true, inventory: false, paid: true, email: false, creative: true },
  rawbark: { shop: true, inventory: false, paid: true, email: false, creative: false },
  demo: { shop: true, inventory: true, paid: true, email: true, creative: true },
};

let failures = 0;
let checks = 0;
function eq(label: string, actual: unknown, expected: unknown) {
  checks++;
  // Intl puts a no-break space between an ISO code and the amount.
  if (typeof actual === "string") actual = actual.replace(/\u00a0/g, " ");
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    failures++;
    console.error(`FAIL ${label}: got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`);
  }
}
const avail = (b: boolean) => (b ? "available" : "not-connected");

for (const name of Object.keys(FIXTURES) as Name[]) {
  const c = FIXTURES[name];
  const e = EXPECT[name];
  for (const p of SHOP_PAGES) eq(`${name} ${p}`, pageAvailability(c, p), avail(e.shop));
  for (const p of INVENTORY) eq(`${name} ${p}`, pageAvailability(c, p), avail(e.inventory));
  for (const p of CREATIVE) eq(`${name} ${p}`, pageAvailability(c, p), avail(e.creative));
  eq(`${name} /paid`, pageAvailability(c, "/paid"), avail(e.paid));
  eq(`${name} /email`, pageAvailability(c, "/email"), avail(e.email));
  eq(`${name} /channels`, pageAvailability(c, "/channels"), "not-connected");
  eq(`${name} /channels source`, missingSource(c, "/channels"), "GA4");
  for (const p of ["/settings", "/health", "/admin", "/chat"]) eq(`${name} ${p}`, pageAvailability(c, p), "available");
  eq(`${name} hasShop`, hasShop(c), true);

  // The nav never lists Channels, and lists exactly the available pages.
  const hrefs = navFor(false, c).flatMap((g) => g.items.map((i) => i.href));
  eq(`${name} nav has no /channels`, hrefs.includes("/channels"), false);
  for (const h of hrefs) eq(`${name} nav ${h} available`, pageAvailability(c, h), "available");
  eq(`${name} nav has /email`, hrefs.includes("/email"), e.email);
  eq(`${name} nav has /inventory`, hrefs.includes("/inventory"), e.inventory);
  eq(`${name} rail has creative`, railProducts("admin", c).some((p) => p.id === "creative"), true);
  eq(`${name} rail has analytics`, railProducts("admin", c).some((p) => p.id === "analytics"), true);
}

// Rail by role (RS5): Reports for admin and agency only, other products unchanged.
const railIds = (role: "admin" | "agency" | "client", c?: Parameters<typeof railProducts>[1]) =>
  railProducts(role, c).map((p) => p.id);
eq("rail admin", railIds("admin", FIXTURES.manami), ["chat", "analytics", "creative", "reports"]);
eq("rail agency", railIds("agency", FIXTURES.manami), ["chat", "analytics", "creative", "reports"]);
eq("rail client", railIds("client", FIXTURES.manami), ["chat", "analytics"]);
eq("rail admin, no client", railIds("admin"), ["chat", "analytics", "creative", "reports"]);
eq("rail admin rawbark (no Meta)", railIds("admin", FIXTURES.rawbark), ["chat", "analytics", "creative", "reports"]);
eq("rail agency rawbark (no Meta)", railIds("agency", FIXTURES.rawbark), ["chat", "analytics", "creative", "reports"]);
eq("productFor /reports", productFor("/reports"), "reports");
eq("productFor /reports/abc", productFor("/reports/abc"), "reports");
eq("productFor /reportsx", productFor("/reportsx"), "analytics");
eq("title /reports", pageTitle("/reports"), "Reports");
eq("title /reports/abc", pageTitle("/reports/abc"), "Reports");

// RawBark: the acceptance line. No Inventory, Email, Channels or Creative.
const rb = navFor(false, FIXTURES.rawbark).flatMap((g) => g.items.map((i) => i.href));
eq("rawbark nav", rb.filter((h) => /^\/(inventory|email|channels|creative)/.test(h)), []);
eq("rawbark /email source", missingSource(FIXTURES.rawbark, "/email"), "Email");
eq("rawbark /creative source", missingSource(FIXTURES.rawbark, "/creative"), "Meta");
eq("rawbark /inventory source", missingSource(FIXTURES.rawbark, "/inventory/buying"), "Shopify");
eq("rawbark /paid source", missingSource(FIXTURES.rawbark, "/paid"), null);

// Paid sub-routes (later Paid package): longest prefix wins.
eq("rawbark /paid/meta", pageAvailability(FIXTURES.rawbark, "/paid/meta"), "not-connected");
eq("rawbark /paid/meta source", missingSource(FIXTURES.rawbark, "/paid/meta"), "Meta");
eq("rawbark /paid/google", pageAvailability(FIXTURES.rawbark, "/paid/google"), "available");
eq("ethia /paid/google source", missingSource(FIXTURES.ethia, "/paid/google"), "Google Ads");
eq("manami /paid/ga4", pageAvailability(FIXTURES.manami, "/paid/ga4"), "not-connected");
eq("query string ignored", pageAvailability(FIXTURES.rawbark, "/email?client=rawbark"), "not-connected");
eq("no client: internal nav unfiltered except Channels", navFor(true).flatMap((g) => g.items).length, 16);
eq("no client: client-role nav has no Paid", navFor(false).flatMap((g) => g.items).length, 15);

// A shopless client keeps Analytics in the rail but loses the shop pages.
const adsOnly = caps({ meta: true });
eq("ads-only /snapshot", pageAvailability(adsOnly, "/snapshot"), "not-connected");
eq("ads-only /snapshot source", missingSource(adsOnly, "/snapshot"), "Shop");

// Active state and titles are prefix based.
eq("active /repurchase/timing", activeNavHref("/repurchase/timing"), "/repurchase");
eq("active /repurchase", activeNavHref("/repurchase"), "/repurchase");
eq("active /paid/meta", activeNavHref("/paid/meta"), "/paid");
eq("active /inventory/catalogue", activeNavHref("/inventory/catalogue"), "/inventory/catalogue");
eq("active /paidx", activeNavHref("/paidx"), null);
eq("title /paid/google", pageTitle("/paid/google"), "Paid");
eq("title /creative/velocity", pageTitle("/creative/velocity"), "Velocity");
eq("title /creative/velocity/plan", pageTitle("/creative/velocity/plan"), "Velocity plan");
eq("title /creative/unknown", pageTitle("/creative/unknown"), "Creatives");
eq("title /chat/abc", pageTitle("/chat/abc"), "Assistant");
eq("title /health", pageTitle("/health"), "Data health");
eq("title /channels", pageTitle("/channels"), "Channels");
eq("selectedClient fallback", selectedClient([{ clientId: "a" }, { clientId: "b" }], "zzz")?.clientId, "a");
eq("selectedClient pick", selectedClient([{ clientId: "a" }, { clientId: "b" }], "b")?.clientId, "b");

// Sidebar tree (NAV1): every top-level item has an icon, children are one level,
// and the current item and child follow the path and, for siblings sharing a path, the query.
{
  const all = [...NAV, ...CREATIVE_NAV].flatMap((g) => g.items);
  eq("every top-level item has an icon", all.every((i) => typeof i.icon === "string" && i.icon.length > 0), true);
  eq("icons are unique", new Set(all.map((i) => i.icon)).size, all.length);
  eq("items with children", all.filter((i) => i.children).map((i) => i.label), ["Paid", "Repurchase", "Breakdown", "Velocity"]);
  eq("Paid children", NAV.flatMap((g) => g.items).find((i) => i.href === "/paid")?.children?.map((c) => c.label), ["Overview", "Meta", "Google", "GA4"]);
  eq("Breakdown has ten dimension children", CREATIVE_NAV[0].items.find((i) => i.label === "Breakdown")?.children?.length, 10);
  eq("creative nav is the same for every client", navForProduct("creative", false, FIXTURES.rawbark), CREATIVE_NAV);
  eq("chat and reports list nothing", [navForProduct("chat", true), navForProduct("reports", true)], [[], []]);

  // A platform the client lacks stays under Paid, muted; Overview never mutes.
  const paid = (c: Parameters<typeof navFor>[1]) => navFor(true, c).flatMap((g) => g.items).find((i) => i.href === "/paid")?.children?.map((x) => `${x.label}${x.muted ? ":muted" : ""}`);
  eq("Paid children for Meta + Google (Manami)", paid(FIXTURES.manami), ["Overview", "Meta", "Google", "GA4:muted"]);
  eq("Paid children for Meta only (Ethia)", paid(FIXTURES.ethia), ["Overview", "Meta", "Google:muted", "GA4:muted"]);
  eq("Paid children for Google only (RawBark)", paid(FIXTURES.rawbark), ["Overview", "Meta:muted", "Google", "GA4:muted"]);
  eq("Paid children without a client", paid(undefined), ["Overview", "Meta", "Google", "GA4"]);

  const q = (s: string) => new URLSearchParams(s);
  const on = (path: string, query = "") => {
    const a = resolveActive(path, q(query));
    return [a.item?.label ?? null, a.child?.label ?? null];
  };
  eq("active /paid", on("/paid"), ["Paid", "Overview"]);
  eq("active /paid/ga4", on("/paid/ga4"), ["Paid", "GA4"]);
  eq("active /repurchase", on("/repurchase"), ["Repurchase", null]);
  eq("active /repurchase/timing", on("/repurchase/timing"), ["Repurchase", "Repeat timing"]);
  eq("active /snapshot", on("/snapshot"), ["Snapshot", null]);
  eq("active /creative", on("/creative"), ["Creatives", null]);
  eq("active /creative/breakdown defaults to Angle", on("/creative/breakdown"), ["Breakdown", "Angle"]);
  eq("active /creative/breakdown?by=persona", on("/creative/breakdown", "client=a&by=persona"), ["Breakdown", "Persona"]);
  eq("active /creative/breakdown?by=nonsense falls back", on("/creative/breakdown", "by=nonsense"), ["Breakdown", "Angle"]);
  eq("active /creative/velocity", on("/creative/velocity"), ["Velocity", "Overview"]);
  eq("active /creative/velocity/plan", on("/creative/velocity/plan"), ["Velocity", "Plan"]);
  eq("active /creative/velocity/track", on("/creative/velocity/track"), ["Velocity", "Track record"]);
  eq("active /paidx", on("/paidx"), [null, null]);

  // Links keep the view (client, range) and let a child's own query win.
  eq("navHref carries the query", navHref("/paid/meta", "client=a&preset=30d"), "/paid/meta?client=a&preset=30d");
  eq("navHref without a query", navHref("/paid", ""), "/paid");
  eq("navHref child query wins", navHref("/creative/breakdown?by=offer", "client=a&by=angle"), "/creative/breakdown?client=a&by=offer");
  eq("title /repurchase/timing", pageTitle("/repurchase/timing"), "Repeat timing");
  eq("title /creative/breakdown", pageTitle("/creative/breakdown"), "Breakdown");
}

// Formatters.
eq("NO_VALUE", NO_VALUE, "n/a");
eq("formatMoney null", formatMoney(null, "CZK"), "n/a");
eq("formatNumber null", formatNumber(null), "n/a");
eq("formatPercent null", formatPercent(null), "n/a");
eq("formatRatio null", formatRatio(null), "n/a");
eq("formatMoney unit 0.62 USD", formatMoney(0.62, "USD", { unit: true }), "$0.62");
eq("formatMoney unit 12.5 CZK", formatMoney(12.5, "CZK", { unit: true }), "CZK 12.50");
eq("formatMoney unit 250 CZK", formatMoney(250, "CZK", { unit: true }), "CZK 250");
eq("formatMoney decimals 2", formatMoney(1234.5, "USD", { decimals: 2 }), "$1,234.50");
eq("formatMoney default", formatMoney(108357.4, "CZK"), "CZK 108,357");
eq("formatMoney 0.62 default", formatMoney(0.62, "USD"), "$1");
eq("formatMoney compact", formatMoney(1234567, "CZK", { compact: true }), "CZK 1.2M");
eq("formatPercent", formatPercent(0.35), "35.0%");
eq("formatRatio", formatRatio(4.2), "4.20×");

// Negatives: U+2212 for money, percentages, counts and ratios; never a signed zero (QA A-20).
eq("formatMoney negative", formatMoney(-27660, "USD"), "\u2212$27,660");
eq("formatMoney negative CZK", formatMoney(-856248, "CZK"), "\u2212CZK 856,248");
eq("formatMoney -0.4 is unsigned", formatMoney(-0.4, "EUR"), "\u20ac0");
eq("formatMoney negated discount", formatMoney(-105, "USD"), "\u2212$105");
eq("formatMoney negated tiny discount", formatMoney(-0.3, "EUR"), "\u20ac0");
eq("formatPercent negative", formatPercent(-0.128), "\u221212.8%");
eq("formatPercent -0.0004 is unsigned", formatPercent(-0.0004), "0.0%");
eq("formatNumber negative", formatNumber(-15), "\u221215");
eq("formatRatio negative", formatRatio(-0.5), "\u22120.50\u00d7");
eq("formatRatio -0.001 is unsigned", formatRatio(-0.001), "0.00\u00d7");

// Revenue mix axis: one tick per day on a short range, never a repeated date (QA N-04).
eq("tickLabels 4 days", tickLabels({ days: 4, from: "2026-10-01" }), ["Oct 1", "Oct 2", "Oct 3", "Oct 4"]);
eq("tickLabels 1 day", tickLabels({ days: 1, from: "2026-10-01" }), ["Oct 1"]);
eq("tickLabels 7 days distinct", new Set(tickLabels({ days: 7, from: "2026-10-01" })).size, 5);
eq("tickLabels 30 days", tickLabels({ days: 30, from: "2026-09-01" }), ["Sep 1", "Sep 8", "Sep 16", "Sep 23", "Sep 30"]);

// Spend gap: one rule for the tile, the margin stack and the notice (QA N-01, N-02).
{
  const day = (date: string, spend: number | null): PnlDay => ({
    date, currency: "CZK", revenue: 100, netSales: 100, grossRevenueInclTax: 100, shippingRevenue: 0,
    taxCollected: 0, newCustomerRevenue: 50, returningCustomerRevenue: 50, cogs: 40, cm1: 60, cm2: 60,
    cm3: 60 - (spend ?? 0), metaSpend: spend, googleSpend: null, paidSpend: spend, orders: 1,
    uniqueCustomers: 1, newCustomerOrders: 1, returningCustomerOrders: 0, fulfilmentCost: null, otherCm1Cost: null,
  });
  // Current range Oct 5 to Oct 9, spend from Oct 7. Comparison range Sep 30 to Oct 4, spend from Oct 2.
  const cur = { from: "2026-10-05", to: "2026-10-09" };
  const prevRange = { from: "2026-09-30", to: "2026-10-04" };
  const curRows = [day("2026-10-05", null), day("2026-10-06", null), day("2026-10-07", 10), day("2026-10-08", 10), day("2026-10-09", 10)];
  const prevRows = [day("2026-09-30", null), day("2026-10-01", null), day("2026-10-02", 10), day("2026-10-03", 10), day("2026-10-04", 10)];
  const snap = (withPrev: boolean): PnlSnapshot => ({
    period: {} as PnlSnapshot["period"],
    currency: "CZK",
    current: aggregate(curRows, { range: cur, paidCapable: true }),
    previous: withPrev ? aggregate(prevRows, { range: prevRange, paidCapable: true }) : null,
    series: curRows,
  });
  const none = spendGapNotice(snap(false));
  const prev = spendGapNotice(snap(true));
  eq("notice date, compare none", none, { from: "2026-10-07", scope: "current" });
  eq("notice date, compare previous", prev, { from: "2026-10-07", scope: "current" });
  eq("paid spend delta withheld under a gap", paidSpendDelta(snap(true)), null);

  // Current range complete, comparison starts before spend: delta withheld, notice names the comparison.
  const full: PnlSnapshot = {
    ...snap(true),
    current: aggregate([day("2026-10-05", 10), day("2026-10-06", 10)], { range: { from: "2026-10-05", to: "2026-10-06" }, paidCapable: true }),
  };
  eq("comparison-only gap notice", spendGapNotice(full), { from: "2026-10-02", scope: "comparison" });
  eq("comparison-only gap withholds delta", paidSpendDelta(full), null);

  // No gap anywhere: a delta, no notice.
  const clean: PnlSnapshot = {
    ...full,
    previous: aggregate([day("2026-10-03", 5), day("2026-10-04", 5)], { range: { from: "2026-10-03", to: "2026-10-04" }, paidCapable: true }),
  };
  eq("no gap, no notice", spendGapNotice(clean), null);
  eq("no gap, delta shown", paidSpendDelta(clean), 1);
}

console.log(`${checks - failures}/${checks} checks passed`);
if (failures > 0) process.exit(1);
