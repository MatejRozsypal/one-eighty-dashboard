/**
 * The invented furniture of the demo brand: products, ads, campaigns, flows,
 * markets and customers.
 *
 * Everything here is fiction. Customer addresses use `example.com`, which is
 * reserved by RFC 2606 and can never belong to anyone — so even a screenshot
 * that escapes the room cannot point at a real person. Product and campaign
 * names are invented for a brand that does not exist.
 *
 * Names are deliberately written in the shape real accounts use — the ad naming
 * convention with pipes and dates, the flow names Klaviyo ships with — because a
 * demo whose labels look nothing like the client's own account fails to make the
 * point that this is their data in here.
 */

import { intBetween, pick, unit } from "./random";

export interface DemoProduct {
  name: string;
  line: string;
  /** Share of units sold. Sums to 1 across the catalogue. */
  share: number;
  price: number;
  marginPct: number;
}

/** Shares sum to 1.00 — checked by the consistency script. */
export const PRODUCTS: DemoProduct[] = [
  { name: "Radiance Serum 30ml", line: "skincare", share: 0.191, price: 68, marginPct: 0.74 },
  { name: "Daily Renewal Cream", line: "skincare", share: 0.164, price: 54, marginPct: 0.71 },
  { name: "Calm Balance Capsules", line: "supplement", share: 0.138, price: 42, marginPct: 0.69 },
  { name: "Deep Sleep Tincture", line: "supplement", share: 0.112, price: 48, marginPct: 0.72 },
  { name: "Restore Body Oil", line: "skincare", share: 0.094, price: 39, marginPct: 0.68 },
  { name: "Clarity Cleanser", line: "skincare", share: 0.081, price: 32, marginPct: 0.66 },
  { name: "Immunity Blend Powder", line: "supplement", share: 0.073, price: 56, marginPct: 0.7 },
  { name: "Starter Ritual Set", line: "bundle", share: 0.058, price: 129, marginPct: 0.63 },
  { name: "Overnight Repair Mask", line: "skincare", share: 0.044, price: 46, marginPct: 0.7 },
  { name: "Travel Duo", line: "bundle", share: 0.045, price: 74, marginPct: 0.61 },
];

/** Where the brand sells. Shares sum to 1.00. */
export const MARKETS: Array<{ code: string; share: number }> = [
  { code: "US", share: 0.612 },
  { code: "CA", share: 0.166 },
  { code: "GB", share: 0.102 },
  { code: "AU", share: 0.058 },
  { code: "DE", share: 0.038 },
  { code: "IE", share: 0.024 },
];

export const CAMPAIGNS = [
  "US I Prospecting I Broad I CBO",
  "US I PACKS I CBO I ADV+",
  "CA I Prospecting I Broad I CBO",
  "US I Retargeting I 30D I ABO",
  "US I Catalog I Broad I DPA",
  "INTL I Prospecting I Broad I CBO",
];

export const AD_NAMES = [
  "STAT I Radiance Serum I Before-After I 14MAY-26 I v2 I US",
  "DYN I Founder Story I 3JUN-26 I OE",
  "UGC I Sleep Tincture Review I 21JUN-26 I v1 I US",
  "STAT I Starter Set I Bundle Offer I 2JUL-26 I v3 I US",
  "CAR I Skincare Range I Long I 11APR-26",
  "DYN I Clinical Results I TOF I 9JUL-26 I v1 I CA",
  "STAT I Calm Balance I Problem-Solution I 28MAY-26 I v2",
  "UGC I Morning Ritual I MOF I 17JUN-26 I v4 I US",
  "STAT I Free Shipping I BOF I 24JUL-26 I v1 I US",
  "DYN I Ingredient Story I TOF I 30JUN-26 I v2 I INTL",
  "CAR I Best Sellers I 6MAY-26 I US",
  "STAT I Overnight Mask I Social Proof I 19JUL-26 I v1",
];

export const EMAIL_CAMPAIGNS = [
  "July Ritual Refresh",
  "New: Overnight Repair Mask",
  "Mid-Summer Restock",
  "The Sleep Edit",
  "Members Early Access",
  "Founder Letter — Why We Reformulated",
  "Last Call: Starter Ritual Set",
  "Ingredient Spotlight: Bakuchiol",
  "Your Skin in August",
  "Weekend Reading + 10% Back",
  "Back in Stock: Calm Balance",
  "The Autumn Preview",
];

export const EMAIL_FLOWS = [
  { name: "Welcome Series", weight: 0.27, emails: 4 },
  { name: "Abandoned Checkout", weight: 0.234, emails: 3 },
  { name: "Browse Abandonment", weight: 0.118, emails: 2 },
  { name: "Post-Purchase Nurture", weight: 0.111, emails: 4 },
  { name: "Winback 60-Day", weight: 0.093, emails: 3 },
  { name: "Replenishment Reminder", weight: 0.086, emails: 2 },
  { name: "Sunset / Re-Engagement", weight: 0.049, emails: 3 },
  { name: "Birthday", weight: 0.039, emails: 1 },
];

const FIRST = [
  "avery", "rowan", "sasha", "imani", "noor", "theo", "mika", "june",
  "ellis", "kai", "lena", "otto", "priya", "quinn", "remy", "sena",
  "tova", "yara", "zane", "bel", "cleo", "dara", "esme", "finn",
];
const LAST = [
  "harlow", "vance", "okafor", "bishara", "lindqvist", "moreau", "tanaka",
  "abernathy", "delacroix", "novak", "iyer", "castellan", "brennan",
  "ferreira", "sorensen", "aldridge", "kowalski", "mbeki",
];

/**
 * A fictional address for a customer index. `example.com` is reserved and
 * unroutable, so these can never collide with a real inbox.
 */
export function demoEmail(index: number): string {
  const first = pick(`cust:first:${index}`, FIRST);
  const last = pick(`cust:last:${index}`, LAST);
  const style = unit(`cust:style:${index}`);
  const local =
    style < 0.4
      ? `${first}.${last}`
      : style < 0.75
        ? `${first}${intBetween(`cust:num:${index}`, 2, 89)}`
        : `${first[0]}${last}`;
  return `${local}@example.com`;
}
