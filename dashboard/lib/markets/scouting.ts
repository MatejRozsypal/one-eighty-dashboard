/**
 * Scouting reference: what the 2026-10 market research found per country
 * (docs/sessions/2026-10-15/markets/research/research-dtc-markets.md).
 *
 * Static on purpose. `ref.industry_benchmarks` is empty (F11) and search
 * demand per country is not ingested, so these are the only per-country facts
 * the page can stand behind today. A blank stays blank: a field the research
 * did not cover is null and the page says so, it is never estimated.
 */

export interface ScoutReference {
  iso: string;
  /** Standard VAT rate. */
  vat: string | null;
  /** Meta users 18+, vendor table (Affect Group). */
  metaAudience: string | null;
  /** Meta CPM benchmark, vendor figures, 2026. */
  cpm: string | null;
  /** Market economics worth knowing before a test. */
  note: string | null;
}

export const SCOUT_REFERENCE: Record<string, ScoutReference> = {
  PL: { iso: "PL", vat: "23%", metaAudience: "21.0M", cpm: "$3.50 to 5.50", note: "BLIK dominant; COD about 16%; parcel lockers" },
  HU: { iso: "HU", vat: "27%", metaAudience: "5.8M", cpm: "$2.50 to 5.50", note: "COD about 60% of parcels" },
  DE: { iso: "DE", vat: "19%", metaAudience: "37.6M", cpm: "$10.05 avg", note: "About 24% of parcels returned" },
  AT: { iso: "AT", vat: "20%", metaAudience: null, cpm: "$9.50 avg", note: "Meta location fee 5% from July 2026" },
  GB: { iso: "GB", vat: "20%", metaAudience: null, cpm: null, note: "Meta location fee 2%; CAC about 0.9 to 1.2x US" },
  IE: { iso: "IE", vat: "23%", metaAudience: null, cpm: null, note: null },
  CH: { iso: "CH", vat: "8.1%", metaAudience: null, cpm: null, note: "Outside the EU customs union" },
  RS: { iso: "RS", vat: "20%", metaAudience: null, cpm: null, note: "Outside the EU customs union" },
};

/**
 * Research candidates by where the client already sells, listed even with no
 * orders yet. Countries with orders are added from the data.
 */
export function researchCandidates(sold: string[]): string[] {
  const americas = sold.some((m) => ["US", "CA", "MX"].includes(m));
  return americas ? ["GB", "IE"] : ["PL", "HU", "DE", "AT"];
}
