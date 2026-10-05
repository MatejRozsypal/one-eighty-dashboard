/**
 * What the Creative numbers are measured on, said once.
 *
 * The ingest requests no attribution window, so spend, purchases and ROAS are
 * whatever Meta returns by default for each ad set's own setting. Printing
 * "7-day click, customers excluded" asserted a window nothing in the pipeline
 * enforces (audit change C2). Until the ingest pins and stores the window
 * (package ME2), the label says what is true.
 *
 * ME2 flips this ONE constant, to "7-day click" once the dashboard reads the
 * pinned 7d_click columns. Nothing else prints an attribution window.
 */
export const ATTRIBUTION_LABEL = "Meta default attribution (per ad set)";
