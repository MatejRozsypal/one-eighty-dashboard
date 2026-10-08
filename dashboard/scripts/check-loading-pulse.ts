/**
 * Loading feedback gates.
 *
 *   npx tsx --tsconfig scripts/tsconfig.json scripts/check-loading-pulse.ts
 *
 * Pure checks, no warehouse, no server. Pins the rules that keep every load
 * giving immediate, consistent pulsing feedback:
 *
 *   - one animation definition (app/globals.css) with a reduced-motion state,
 *     and nothing else defines a pulse or shimmer;
 *   - no link or URL change bypasses the shared navigation (`next/link` only
 *     inside AppLink, `router.push/replace` only inside NavigationPending);
 *   - every page segment under app/(app) has a loading.tsx at itself or its
 *     group, and each is built from the one Skeleton primitive;
 *   - the skeletons render, and carry the pulse class;
 *   - the widget hook reports loading for any request its stored result does
 *     not answer;
 *   - a client switch hides the page body behind a skeleton (no old figure
 *     under the new name), query-only navigation keeps the scroll position,
 *     the range chip shows the pending preset, the mobile menus are exclusive
 *     and the mobile date control is a bottom sheet.
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AppLink } from "@/components/ui/AppLink";
import { baseQueryFor, ClientSwitchSkeleton, PendingRegionFrame, scrollFor } from "@/components/shell/NavigationPending";
import { Skeleton, SkeletonPage, type SkeletonBlock } from "@/components/ui/Skeleton";
import { answerKey } from "@/components/reports/useWidgetData";

const ROOT = join(__dirname, "..");
const APP = join(ROOT, "app", "(app)");

let passed = 0;
const failures: string[] = [];

function check(name: string, ok: boolean, detail?: string): void {
  if (ok) passed += 1;
  else failures.push(detail ? `${name}: ${detail}` : name);
}

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (name === "node_modules" || name === ".next") continue;
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

const rel = (f: string) => relative(ROOT, f);
const read = (f: string) => readFileSync(f, "utf8");

const sources = [...walk(join(ROOT, "app")), ...walk(join(ROOT, "components"))].filter((f) => /\.(tsx?|css)$/.test(f));

// ---------------------------------------------------------------------------
// Known violations handed to their owner
// ---------------------------------------------------------------------------
//
// Files that break a rule below and belong to work in flight on another branch,
// which this branch must not edit: the Home page and its variants are being
// finished on `home-final` (2026-10-08). Each entry names the rule and the exact
// file, nothing wider, and is checked to still be a violation: once the owner
// fixes a file this check fails until its entry is deleted, so the list can
// only shrink. Everything else, including new Home files, is held to the rule.
const HANDED_OFF: Record<string, readonly string[]> = {
  // Emptied on home-final (2026-10-08): the Home files now follow every rule.
  "stray-animation": [],
  "raw-push": [],
  "loading-own-style": [],
  "loading-hex": [],
};

/** The violations a rule still reports once its handed-off files are set aside. */
function unhanded(rule: keyof typeof HANDED_OFF, violators: string[]): string[] {
  const listed = HANDED_OFF[rule];
  const found = new Set(violators.map(rel));
  for (const f of listed) {
    check(`handed-off ${rule}: ${f} still violates (else drop the entry)`, found.has(f));
  }
  return violators.filter((f) => !listed.includes(rel(f)));
}

// ---------------------------------------------------------------------------
// One animation definition
// ---------------------------------------------------------------------------

const css = read(join(ROOT, "app", "globals.css"));
check("one @keyframes oe-pulse", (css.match(/@keyframes oe-pulse(?![-\w])/g) ?? []).length === 1);
check("one @keyframes oe-pulse-in", (css.match(/@keyframes oe-pulse-in\b/g) ?? []).length === 1);
check("shimmer keyframes gone", !css.includes("oe-shimmer"));
for (const token of ["--pulse-dur", "--pulse-in", "--pulse-hi", "--pulse-lo", "--pulse-static", "--skeleton-bg"]) {
  check(`token ${token} defined`, new RegExp(`${token}:`).test(css));
}
check(".oe-skeleton defined", /\.oe-skeleton\s*\{/.test(css));
check("pending region pulses main, not a skeleton main", css.includes('[data-pending="true"] main:not([aria-busy="true"])'));
{
  const reduced = css.slice(css.indexOf("@media (prefers-reduced-motion: reduce)", css.indexOf("--pulse-static")));
  check("reduced motion: pulse is static and dimmed", /\.oe-pulse[\s\S]*?animation:\s*none;[\s\S]*?opacity:\s*var\(--pulse-static\)/.test(reduced));
  check("reduced motion: skeleton is solid", /\.oe-skeleton\s*\{[^}]*animation:\s*none;[^}]*opacity:\s*1/.test(reduced));
}
{
  const tw = read(join(ROOT, "tailwind.config.ts"));
  check("tailwind animate-pulse is the shared pulse", /pulse:\s*"oe-pulse var\(--pulse-dur\)/.test(tw));
}

// The release sequence (components/whatsnew) owns its own keyframes. It is a
// one-off product tour, not a loading state, so it is exempt from the rule
// below, and the check straight after holds it to that: if it ever grows a
// pulse or a shimmer of its own, this fails like anything else would.
const WHATS_NEW_CSS = join("whatsnew", "whats-new.css");

const strayAnimation = sources.filter((f) => {
  if (f.endsWith("globals.css")) return false;
  if (f.endsWith(WHATS_NEW_CSS)) return false;
  const text = read(f);
  // `oe-indeterminate` (the route progress sweep) is a different thing: a bar, not a pulse.
  return /animate-pulse|animate-\[oe-(?!indeterminate)|oe-shimmer|@keyframes/.test(text);
});
{
  const left = unhanded("stray-animation", strayAnimation);
  check("no second pulse or shimmer definition", left.length === 0, left.map(rel).join(", "));
}

{
  const exempt = sources.filter((f) => f.endsWith(WHATS_NEW_CSS));
  const offending = exempt.filter((f) => /animate-pulse|oe-pulse|oe-shimmer|oe-skeleton/.test(read(f)));
  check(
    "the release sequence defines no pulse of its own",
    offending.length === 0,
    offending.map(rel).join(", "),
  );
}

// ---------------------------------------------------------------------------
// Nothing bypasses the shared navigation
// ---------------------------------------------------------------------------

const rawLink = sources.filter((f) => !f.includes(`${join("app", "auth")}`) && !f.endsWith(join("ui", "AppLink.tsx")) && /from "next\/link"/.test(read(f)));
check("next/link only in AppLink (and the signed-out pages)", rawLink.length === 0, rawLink.map(rel).join(", "));

const rawPush = unhanded(
  "raw-push",
  sources.filter((f) => !f.endsWith(join("shell", "NavigationPending.tsx")) && /\brouter\.(push|replace)\(/.test(read(f))),
);
check("router.push/replace only in NavigationPending", rawPush.length === 0, rawPush.map(rel).join(", "));

const ownTransition = sources.filter((f) => !f.endsWith(join("shell", "NavigationPending.tsx")) && /useTransition\(\)/.test(read(f)));
check(
  "useTransition only in NavigationPending and the server-action buttons",
  // The server-action buttons: each awaits its action inside the transition to
  // show its own pending state, and none of them navigates.
  ownTransition.every((f) => /creative[\\/](DecisionLog|UnmappedQueue|velocity[\\/]PlanCalculator)\.tsx$/.test(f)),
  ownTransition.map(rel).join(", "),
);

{
  const link = read(join(ROOT, "components", "ui", "AppLink.tsx"));
  check("AppLink routes plain clicks through navigate", link.includes("navigate(url, { replace, scroll })"));
  check("AppLink leaves modified clicks to the browser", ["metaKey", "ctrlKey", "shiftKey", "altKey"].every((k) => link.includes(`e.${k}`)));
  check("AppLink leaves target and download alone", link.includes("target &&") && link.includes('"download" in rest'));
  const html = renderToStaticMarkup(createElement(AppLink, { href: "/orders?client=x", className: "c" }, "Orders"));
  check("AppLink outside the provider is a plain link", html === '<a class="c" href="/orders?client=x">Orders</a>', html);
}

{
  const provider = read(join(ROOT, "components", "shell", "NavigationPending.tsx"));
  check("provider exposes navigate and refresh", provider.includes("navigate,") && provider.includes("refresh"));
  check("pending region marks data-pending", provider.includes('data-pending={pending ? (client ? "client" : "true") : undefined}'));
}

// ---------------------------------------------------------------------------
// Navigation state: client switch, scroll, pending labels, mobile shell
// ---------------------------------------------------------------------------

{
  // The pending region in each state, rendered without a router.
  const frame = (pending: boolean, kind: "view" | "client" | null) =>
    renderToStaticMarkup(createElement(PendingRegionFrame, { pending, kind, children: createElement("main", null, "x") }));
  const idle = frame(false, null);
  const view = frame(true, "view");
  const client = frame(true, "client");
  const HIDE = "[&amp;_main:not([aria-busy=true])]:invisible";
  check("region idle: no data-pending", !idle.includes("data-pending") && !idle.includes(HIDE), idle);
  check("region view change: data-pending=true, main pulses, not hidden", view.includes('data-pending="true"') && !view.includes(HIDE), view);
  check("region client switch: data-pending=client", client.includes('data-pending="client"'), client);
  check("region client switch: page main hidden (not a skeleton main)", client.includes(HIDE), client);
  check("region client switch: main is the skeleton's frame", client.includes("[&amp;_main:not([aria-busy=true])]:relative"), client);
  check("region client switch: main does not pulse", !css.includes('[data-pending="client"]') && !client.includes('data-pending="true"'));
  check("region client switch: aria-busy", client.includes('aria-busy="true"'));

  const sk = renderToStaticMarkup(createElement(ClientSwitchSkeleton));
  check("client skeleton re-shows itself inside the hidden main", /^<div[^>]*class="visible absolute inset-0/.test(sk), sk.slice(0, 160));
  check("client skeleton is hidden from assistive tech", sk.startsWith('<div aria-hidden="true"'));
  check("client skeleton pulses through Skeleton blocks", (sk.match(/oe-skeleton/g) ?? []).length >= 8);
  check("client skeleton sticks under the header", sk.includes("sticky top-[var(--header-h)]"));
  check("client skeleton clips without becoming a scroll container", /^<div[^>]*class="[^"]*overflow-clip"/.test(sk) && !/^<div[^>]*class="[^"]*overflow-hidden/.test(sk));

  const provider = read(join(ROOT, "components", "shell", "NavigationPending.tsx"));
  check("pending kind is derived from isPending (never outlives the commit)", provider.includes("const pendingKind = isPending ? kind : null;"));
  check("client skeleton mounts before paint", /useLayoutEffect\(\(\) => \{[\s\S]*?querySelector<HTMLElement>\(PAGE_MAIN\)/.test(provider));
  check("client skeleton is portalled into the page main", provider.includes("createPortal(<ClientSwitchSkeleton />, host)"));
  check("navigate resolves scroll through scrollFor", provider.includes("scrollFor(href, options?.scroll, window.location)") && provider.includes("router.push(href, { scroll })") && provider.includes("router.replace(href, { scroll })"));

  for (const f of [join("components", "shell", "AccountMenu.tsx"), join("components", "shell", "MobileTopBar.tsx")]) {
    check(`${f}: client switch is a client navigation`, read(join(ROOT, f)).includes('{ kind: "client" }'));
  }
}

{
  // Controls merge onto the URL still in flight, not the committed snapshot
  // (QF2 request, r3-perf): a second change inside one load keeps the first.
  check("base query: nothing in flight uses the committed query", baseQueryFor(null, "/snapshot", "client=a&preset=30d") === "client=a&preset=30d");
  check("base query: in flight on the same path wins", baseQueryFor("/snapshot?client=a&preset=90d", "/snapshot", "client=a&preset=30d") === "client=a&preset=90d");
  check("base query: in flight to another path is ignored", baseQueryFor("/growth?client=a&preset=90d", "/snapshot", "client=a&preset=30d") === "client=a&preset=30d");
  check("base query: in flight with no query is an empty base", baseQueryFor("/snapshot", "/snapshot", "client=a") === "");
  {
    // The race itself: compare, then currency before the first commits.
    const committed = "client=a&preset=30d";
    const first = new URLSearchParams(baseQueryFor(null, "/snapshot", committed));
    first.set("compare", "yoy");
    const firstHref = `/snapshot?${first.toString()}`;
    const second = new URLSearchParams(baseQueryFor(firstHref, "/snapshot", committed));
    second.set("ccy", "CZK");
    check("base query: second change keeps the first", second.get("compare") === "yoy" && second.get("ccy") === "CZK" && second.get("preset") === "30d", second.toString());
  }
  const provider = read(join(ROOT, "components", "shell", "NavigationPending.tsx"));
  check("navigate records the newest href before the transition", /latestHref\.current = href;[\s\S]*?startTransition/.test(provider));
  check("newest href is dropped when the transition commits", /if \(!isPending\) \{[\s\S]*?latestHref\.current = null;/.test(provider));
  for (const f of [
    join("components", "controls", "SegmentedControl.tsx"),
    join("components", "controls", "DateRangeControl.tsx"),
    join("components", "controls", "MarketFilter.tsx"),
    join("components", "shell", "AccountMenu.tsx"),
    join("components", "shell", "MobileTopBar.tsx"),
  ]) {
    const src = read(join(ROOT, f));
    check(`${f}: builds on baseQuery`, src.includes("baseQuery(pathname,") && !/new URLSearchParams\(searchParams\.toString\(\)\)/.test(src));
  }
}

{
  const here = { href: "https://x.test/paid/meta?client=a&cols=delivery", origin: "https://x.test", pathname: "/paid/meta" };
  check("scroll: query-only change on the same path keeps position", scrollFor("/paid/meta?client=a&cols=funnel", undefined, here) === false);
  check("scroll: client switch keeps position", scrollFor("/paid/meta?client=b&cols=delivery", undefined, here) === false);
  check("scroll: same path, no query keeps position", scrollFor("/paid/meta", undefined, here) === false);
  check("scroll: another path keeps the default", scrollFor("/paid/google?client=a", undefined, here) === undefined);
  check("scroll: a hash keeps the default (jump to it)", scrollFor("/paid/meta?client=a#campaigns", undefined, here) === undefined);
  check("scroll: explicit true wins", scrollFor("/paid/meta?client=a&cols=funnel", true, here) === true);
  check("scroll: explicit false wins", scrollFor("/paid/google", false, here) === false);
  check("scroll: another origin keeps the default", scrollFor("https://y.test/paid/meta", undefined, here) === undefined);
}

{
  // The period pill draws its trigger, sheet and calendar through Pill and
  // RangeCalendar, so the pins follow the markup there.
  const date = read(join(ROOT, "components", "controls", "DateRangeControl.tsx"));
  const pill = read(join(ROOT, "components", "controls", "Pill.tsx"));
  const cal = read(join(ROOT, "components", "controls", "RangeCalendar.tsx"));
  check("range chip shows the pending preset label", date.includes("pending?.label ??") && date.includes("label: PRESET_LABELS[key]"));
  check("range trigger shows the pending range", date.includes("const shownRange = pending?.range ?? range;"));
  check("range pill pulses while pending", date.includes("pending={isPending}") && pill.includes('pending ? "oe-pulse" : ""'));
  check("date control is a bottom sheet below sm", pill.includes("fixed inset-x-0 bottom-0") && pill.includes("sm:absolute"));
  check("date sheet: one month below sm", cal.includes('mi === 0 ? "hidden sm:flex" : "flex"'));
  check("date sheet: Cancel/Apply foot does not scroll away", /flex flex-none[^"]*items-center justify-between[^"]*border-t/.test(pill));

  const bar = read(join(ROOT, "components", "shell", "MobileTopBar.tsx"));
  check("mobile menus: one state for both (never open together)", bar.includes('useState<"pages" | "client" | null>(null)') && !/useState\(false\)/.test(bar));
  check("mobile menus: Escape closes them", /e\.key === "Escape"\) setMenu\(null\)/.test(bar));
  // The sheet carries the sidebar's hierarchy: products as one vertical list,
  // the current one's pages under it. Nothing in it scrolls sideways (QA C-12).
  check("mobile sheet lists products as one vertical list", bar.includes("sidebarProducts(role, shownClient)") && /<ul className="m-0 flex list-none flex-col/.test(bar));
  check("mobile sheet never scrolls sideways", !/overflow-x-(auto|scroll)/.test(bar));
  check("mobile sheet nests the current product's pages", /isCurrent && nav\.length > 0/.test(bar));
}

// ---------------------------------------------------------------------------
// Every page segment has a skeleton
// ---------------------------------------------------------------------------

const EXEMPT = new Set(["admin"]); // redirects, never renders
const pageDirs = walk(APP)
  .filter((f) => f.endsWith(`${"page.tsx"}`))
  .map((f) => f.slice(0, -"page.tsx".length - 1));

check("app/(app)/loading.tsx exists", existsSync(join(APP, "loading.tsx")));
for (const dir of pageDirs) {
  const name = relative(APP, dir);
  if (name === "" || EXEMPT.has(name)) continue;
  const own = existsSync(join(dir, "loading.tsx"));
  const parent = join(dir, "..");
  const group = parent !== APP && existsSync(join(parent, "loading.tsx"));
  // channels is a one-line "not connected" page: the root fallback is its shape.
  check(`loading.tsx covers ${name}`, own || group || name === "channels");
}

{
  const loadings = walk(APP).filter((x) => x.endsWith("loading.tsx"));
  const ownStyle = (f: string) => /#[0-9a-fA-F]{3,8}\b|rgb\(|animate-|duration-/.test(read(f));
  unhanded("loading-own-style", loadings.filter(ownStyle));
  for (const f of loadings) {
    check(`${rel(f)} uses the Skeleton primitive`, read(f).includes('@/components/ui/Skeleton'));
    if (!HANDED_OFF["loading-own-style"].includes(rel(f))) {
      check(`${rel(f)} has no colour or timing of its own`, !ownStyle(f));
    }
  }
}

// ---------------------------------------------------------------------------
// The skeletons render and pulse
// ---------------------------------------------------------------------------

{
  const one = renderToStaticMarkup(createElement(Skeleton, { className: "h-3" }));
  check("Skeleton is a pulsing, hidden block", one.includes("oe-skeleton") && one.includes('aria-hidden="true"'), one);

  const blocks: SkeletonBlock[] = ["kpi", "kpi-6", "kpi-8", "chart", "split", "table", "table-long", "heatmap", "cards", "list"];
  for (const block of blocks) {
    const html = renderToStaticMarkup(createElement(SkeletonPage, { blocks: [block] }));
    check(`SkeletonPage ${block}: renders blocks that pulse`, (html.match(/oe-skeleton/g) ?? []).length >= 3, html.slice(0, 120));
    check(`SkeletonPage ${block}: main is aria-busy (no double pulse)`, /<main[^>]*aria-busy="true"/.test(html));
  }
  const withTabs = renderToStaticMarkup(createElement(SkeletonPage, { blocks: ["kpi"], tabs: true }));
  const without = renderToStaticMarkup(createElement(SkeletonPage, { blocks: ["kpi"], controls: false }));
  const plain = renderToStaticMarkup(createElement(SkeletonPage, { blocks: ["kpi"] }));
  check("SkeletonPage tabs adds blocks", withTabs.length > plain.length);
  check("SkeletonPage controls={false} removes the strip", without.length < plain.length);
  check("SkeletonPage header is a <header> sibling of <main>", /<header[^>]*>.*<\/header>(<div|<main)/s.test(plain));
}

// ---------------------------------------------------------------------------
// Widgets: loading whenever the stored result does not answer the request
// ---------------------------------------------------------------------------

{
  check("answerKey changes with the request", answerKey("a", 0) !== answerKey("b", 0));
  check("answerKey changes with Refresh", answerKey("a", 0) !== answerKey("a", 1));
  check("answerKey is stable", answerKey("a", 3) === answerKey("a", 3));
  const hook = read(join(ROOT, "components", "reports", "useWidgetData.ts"));
  check("hook derives loading from forKey", hook.includes("state.forKey !== answerKey(plan.key, refreshNonce)"));
  const parts = read(join(ROOT, "components", "reports", "ReportParts.tsx"));
  check("widget cell pulses on refreshing", parts.includes("|| refreshing"));
  check("widget cell pulses stale figures", parts.includes('loading ? "oe-pulse"'));
  check("widget cell first load is a Skeleton", parts.includes("<Skeleton"));
}

// ---------------------------------------------------------------------------
// Style gates on the files this change owns
// ---------------------------------------------------------------------------

// Built from code points so this file never contains the characters itself.
const DASHES = new RegExp(`[${String.fromCharCode(0x2013)}${String.fromCharCode(0x2014)}]`);

const owned = [
  join(ROOT, "components", "shell", "AccountMenu.tsx"),
  join(ROOT, "components", "shell", "MobileTopBar.tsx"),
  join(ROOT, "components", "shell", "Sidebar.tsx"),
  join(ROOT, "components", "shell", "ProductIcon.tsx"),
  join(ROOT, "components", "shell", "NavSlot.tsx"),
  join(ROOT, "components", "shell", "navStyles.ts"),
  join(ROOT, "components", "shell", "NavCollapseToggle.tsx"),
  join(ROOT, "components", "chat", "HistoryList.tsx"),
  join(ROOT, "components", "reports", "ReportListPanel.tsx"),
  join(ROOT, "components", "controls", "DateRangeControl.tsx"),
  join(ROOT, "components", "controls", "SegmentedControl.tsx"),
  join(ROOT, "components", "controls", "MarketFilter.tsx"),
  join(ROOT, "components", "ui", "Skeleton.tsx"),
  join(ROOT, "components", "ui", "AppLink.tsx"),
  join(ROOT, "components", "ui", "PendingSubmit.tsx"),
  join(ROOT, "components", "shell", "NavigationPending.tsx"),
  join(ROOT, "scripts", "check-loading-pulse.ts"),
  ...walk(APP).filter((x) => x.endsWith("loading.tsx")),
];
{
  const hex = (f: string) => !f.endsWith("check-loading-pulse.ts") && /#[0-9a-fA-F]{3,8}\b/.test(read(f));
  unhanded("loading-hex", owned.filter(hex));
  for (const f of owned) {
    check(`${rel(f)}: no em or en dash`, !DASHES.test(read(f)));
    if (!f.endsWith("check-loading-pulse.ts") && !HANDED_OFF["loading-hex"].includes(rel(f))) {
      check(`${rel(f)}: no hex literal`, !hex(f));
    }
  }
}

// ---------------------------------------------------------------------------

if (failures.length > 0) {
  console.error(`FAILED ${failures.length} of ${passed + failures.length}`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log(`check-loading-pulse: ${passed}/${passed} passed`);
