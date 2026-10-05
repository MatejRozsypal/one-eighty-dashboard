# RS7 report: Widgets (design WP7)

Branch `rs7-widgets`, worktree `oe-dash-wt/rs7-widgets`, one commit `3d3646f` on top of `d727748` (RS0 merged). Frontend only. No warehouse reads or writes, nothing to deploy.

## What changed (all under `dashboard/`)

| File | Content |
|---|---|
| `styles/tokens/colors.css` | `--series-1..6` (ink-900, growth-600, info, warning-700, gray-400, growth-300) and `--benchmark` (gray-300), aliases only. |
| `components/reports/widgets/format.ts` | `formatMetricValue` (FormatSpec to string, `compact`, `smallDecimals` under 10), `formatAxisValue`, delta magnitude (`12.4%`, `2.1 pp`), bucket and month labels, `statusLabel` ("Not connected", "No data", "No cost data", "No FX Oct 2026" built from `fxMonths`), `statusDetail`. Reuses `lib/format.ts`; it is not edited. |
| `chartTheme.ts` | Tokens only: series colour per slot, dash pattern for the 2nd+ use of a slot, benchmark and compare styles, axis and tooltip styles. Imports no recharts. |
| `CellStatus.tsx` | `StatusText` (`n/a` + muted words, reason on hover), `NotesMark` (`^` with hover list), `CellDelta` (relative via `DeltaChip`, pp own), `HoverCard` (portal, fixed coordinates, so neither clipped by a frame nor displaced by the grid's CSS transforms), `SeriesLegend`, `MetricSwitch`. |
| `BenchmarkHover.tsx` | "I 3.1x" tag, hover card exactly per design 1.9, stale (muted, "Stale") and no_fx (`I n/a`, "No FX Dec 2026") handling, `BenchmarkStrip`. |
| `KpiWidget.tsx`, `RankedWidget.tsx` | Hand-written HTML plus `Sparkline` (KPI). |
| `TableWidget.tsx` | `DataTable`; Industry row per vertical; bucket rows when one series has a time grain. |
| `LineWidget.tsx`, `BarWidget.tsx`, `ScatterWidget.tsx` | Recharts 2.15. |
| `ChartFrame.tsx` | `ResponsiveContainer` (or fixed `size`), tooltip card, hatch pattern. |
| `types.ts`, `index.tsx` | Shared props and data helpers; `index.tsx` is the one door: `next/dynamic` + `ssr: false` for the three chart widgets, direct imports for KPI, table, ranked, plus `WidgetBody` and `WIDGET_COMPONENTS`. |
| `scripts/check-reports-widgets.ts` | The check script (649 assertions). |

Three files beyond the owned list, all inside `components/reports/widgets/`: `types.ts`, `index.tsx` (where the `next/dynamic` loading has to live so "Recharts only through dynamic" is true), `ChartFrame.tsx` (must not live in a file KPI imports, or recharts leaks into KPI-only reports). Say if you want them folded elsewhere.

## Widget contract (for WP9 and WP6)
`<WidgetBody result metrics caveatTexts view />`. `metrics` is the widget's metrics in query order, picked from the registry (`WidgetMetric` is a `Pick` of `MetricBase`, so a registered metric is assignable); `caveatTexts` is `CAVEATS[id].short` per id. Widgets never import the registry. Every widget fills its parent (`h-full`) and draws edge to edge: the frame supplies padding and the title (KPI has no label of its own). Chart widgets also take `size` for fixed-size rendering.

## Behaviour, per design
- **Gaps (2.10):** `n/a` glyph plus the status words, never 0 or a dash. KPI hides the delta; line breaks (`connectNulls={false}`), not-connected series have no line and are greyed in the legend with the reason; bar has a hatched placeholder with the status (grain total) or a greyed legend entry (columns); table cell has muted status and sorts last (null sort key); ranked sinks below the ranked rows; scatter omits the point and footnotes "Name: reason".
- **Caveats:** `^` after the value, hover (and focus, tap) lists coverage ("1 of 2 clients") and the caveats in series.caveats AND metric.caveats. The list is also the button's aria-label. Low volume: muted figure and bar, `title="Low volume"`.
- **Benchmarks:** KPI tags under the value; line dashed horizontal; bar a dashed marker (vertical on total bars, horizontal on columns, not on stacked); ranked a dashed vertical marker on the track with hover; scatter a dashed crosshair; table an "Industry" row per vertical. Stale draws at half opacity.
- **One axis:** a chart with several metrics gets a local switch (no refetch). A ratio or percent never stacks.
- **Legend** for 2+ series (or any gap), end labels for 2 to 4 line series, 2px lines, 8px+ markers with a 2px surface ring, 4px rounded bar ends, 2px gap between stacked segments, partial last bucket shaded.

## Verification
- `npx tsc --noEmit`: exit 0. `npm run build`: exit 0 (`scratchpad/rs7_build.log`). `npm run check:reports`: 205/205.
- `npx tsx --tsconfig scripts/tsconfig.json scripts/check-reports-widgets.ts`: 649/649. It renders every widget for every fixture (clientWeekly, combinedTotalBenchmarks, combinedMonthlyFxMissing, verticalMonthly, plus two derived variants: clientWeekly with benchmarks, and at total grain) with `react-dom/server`, asserts no throw, the words for each of the five statuses, the `n/a` glyph, `^` and its list, low volume, pp deltas, the benchmark overlay for each widget type, hatched placeholder, and static gates: no hex literal, no U+2013/U+2014, no `border-dashed`, no `toLocaleString`, recharts imported only by chart files, chart widgets never imported statically, three `ssr: false` loaders, series tokens present.
- Grep gates on `components/reports` and `styles`: dashes, hex, `border-dashed`, `bg-[#`, `toLocaleString`, internal vocabulary, client names: all 0.
- Visual check: rendered the widgets with the built CSS to a static page and looked at it in the browser pane (KPI states, line, stacked bar, total bar with hatch, scatter, ranked, table). Layout is right. Hover cards were not exercised in a browser (no interactivity in a static render); their content is asserted through the aria-labels.
- Palette check (dataviz validator, light, the design's six aliases resolved to hex): FAIL on lightness band (ink-900 too dark, growth-300 too light), chroma floor (ink-900, gray-400 read as gray), and normal-vision floor (gray-400 vs warning-700, delta E 11.7, below 15); WARN on growth-300 contrast (1.44:1). CVD separation passes. The tokens are as designed (design 1.13), so I did not change them. Mitigation in the widgets: legend always present for 2+ series, direct end labels, tooltips and the table widget carry identity, so colour is never the only channel. Slots 5 and 6 are the weak ones.

## Open issues and deviations
1. **No dark theme exists** in the app (`colors.css` has no dark block). The new tokens are aliases of the base scales, so a future dark theme that redefines the base tokens carries them; I did not add a dark block that would only affect these six variables.
2. **Benchmark "stepped if periods change"** (design 1.9) is not drawn: a match is one value over one period, so there is one flat line per match. Needs several rows per metric from the matcher.
3. **Total-grain bar and ranked benchmark markers span all rows** (chart-wide line, per-row marker in ranked). A line is drawn per match; the hover card says which vertical it is.
4. **Bar at a time grain** shows no hatched placeholder per missing bucket, only a greyed legend entry with the status words (a hatched column would need a custom shape per bucket). Total grain has the hatched placeholder.
5. **KPI shows the first series and first metric only** (`seriesId` and `metricId` select others). Sparkline is the existing component, so its end dot clips at the right edge; not mine to edit.
6. Table `view.sort` orders the initial rows by the first metric; `DataTable` has no initial-sort prop.
7. The hover card portals to `document.body` with fixed coordinates and closes on scroll or resize.

## Requests to orchestrator
1. `package.json`: add `"check:reports-widgets": "tsx --tsconfig scripts/tsconfig.json scripts/check-reports-widgets.ts"` (RS0 owns the file).
2. WP9: map `METRICS[id]` to `WidgetMetric` (cast the id to `MetricId`) and `CAVEATS` to `CaveatTexts`; use `WidgetBody` from `components/reports/widgets` and never import `LineWidget`, `BarWidget` or `ScatterWidget` from their files.
3. WP6: the frame should give the body padding and a definite height (charts use `h-full`), and drag only from its header so tooltips and table scrolling work.
4. Owner: decide whether to re-step series 5 and 6 (gray-400, growth-300) and ink-900 to pass the palette validator; it is a token change in `colors.css` only.
