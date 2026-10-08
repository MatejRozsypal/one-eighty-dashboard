/**
 * Row styles for the sidebar's second and third levels, shared by the three
 * things that draw them: the Analytics and Creative trees (`Sidebar`), the
 * conversation list (`HistoryList`) and the report list (`ReportListPanel`),
 * so a product's list looks the same whichever of them filled it.
 *
 * The indent puts the text under the product label (row padding 8px, icon
 * 18px, gap 10px), the way Shopify's admin lines a section's pages up under
 * its name. Rows are 28px, tighter than the 32px product rows above them, so
 * Analytics fits a 900px screen open without pushing the products below it off.
 */

export const SUB_ROW =
  "flex h-7 w-full min-w-0 flex-1 items-center rounded-sm pl-[36px] pr-2 text-left text-[13px] tracking-[-0.01em] transition-colors duration-fast focus-visible:outline-offset-[-2px]";

/** Third level (Paid's platforms, Breakdown's dimensions): one step further in, a touch smaller. */
export const THIRD_ROW =
  "flex h-[26px] w-full min-w-0 items-center rounded-sm pl-[48px] pr-2 text-left text-[12.5px] tracking-[-0.01em] transition-colors duration-fast focus-visible:outline-offset-[-2px]";

export const SUB_ROW_ACTIVE = "bg-growth-500/[0.14] font-semibold text-growth-300";
export const SUB_ROW_IDLE = "text-gray-300 hover:bg-white/[0.06] hover:text-gray-250";
export const SUB_ROW_MUTED = "text-gray-400 hover:bg-white/[0.06] hover:text-gray-300";

/** A group label inside an open product (Profitability, Pinned, ...). */
export const SUB_HEAD =
  "flex h-6 items-end pb-1 pl-[36px] pr-2 font-mono text-[9.5px] uppercase tracking-eyebrow text-gray-400";
