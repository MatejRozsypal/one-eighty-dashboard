"use client";

/**
 * Demo story for the canvas, fed by `lib/reports/fixtures.ts`.
 *
 * Not part of the product UI: RS9 mounts the real report page. This exists so a
 * reviewer (and RS9 while wiring) can drag, resize, use the keyboard, undo and
 * watch autosave without the widgets, the API or a database. Widget bodies are
 * plain readouts of the fixture config and result; RS7's real widgets plug into
 * the same `renderWidget`.
 *
 * Mount it on any page under the reports layout (so `grid.css` is loaded), or
 * on a scratch route that imports both stylesheets:
 *   import "react-grid-layout/css/styles.css";
 *   import "@/app/(app)/reports/grid.css";
 *
 * Owner: RS6 (canvas).
 */

import { useCallback, useMemo, useRef, useState } from "react";
import { FIXTURE_CONFIGS, FIXTURE_RESULTS } from "@/lib/reports/fixtures";
import { WIDGET_SIZE } from "@/lib/reports/limits";
import { NO_VALUE } from "@/lib/format";
import type { WidgetConfigInput } from "@/lib/reports/types";
import { ReportCanvas, type CanvasMode, type CanvasWidget, type ReportCanvasHandle, type WidgetRender } from "./ReportCanvas";
import type { AutosaveStatus } from "./useAutosave";

const SEED: Array<{ id: string; config: WidgetConfigInput; x: number; y: number }> = [
  { id: "kpi-mer", config: FIXTURE_CONFIGS.kpi, x: 0, y: 0 },
  {
    id: "kpi-cm3",
    config: { v: 1, query: { metrics: ["cm3_pct"], grain: "total", split: "combined" }, view: { type: "kpi" } },
    x: 3,
    y: 0,
  },
  {
    id: "kpi-cpm",
    config: { v: 1, query: { metrics: ["meta_cpm"], grain: "total", split: "combined" }, view: { type: "kpi" } },
    x: 6,
    y: 0,
  },
  { id: "ranked", config: FIXTURE_CONFIGS.ranked, x: 8, y: 3 },
  { id: "line", config: FIXTURE_CONFIGS.line, x: 0, y: 3 },
  { id: "scatter", config: FIXTURE_CONFIGS.scatter, x: 6, y: 10 },
  { id: "bar", config: FIXTURE_CONFIGS.bar, x: 0, y: 10 },
  { id: "table", config: FIXTURE_CONFIGS.table, x: 0, y: 18 },
];

function seedWidgets(): CanvasWidget[] {
  return SEED.map(({ id, config, x, y }) => ({ id, type: config.view.type, x, y, w: WIDGET_SIZE[config.view.type].w, h: WIDGET_SIZE[config.view.type].h }));
}

function titleOf(config: WidgetConfigInput): string {
  return config.view.title ?? config.query.metrics.join(", ");
}

function chipOf(config: WidgetConfigInput): string | undefined {
  const o = config.query.overrides;
  return o && o.currency ? o.currency : undefined;
}

function Readout({ config }: { config: WidgetConfigInput }) {
  const metric = config.query.metrics[0];
  const cell = FIXTURE_RESULTS.combinedTotalBenchmarks.series[0]?.cells[metric];
  if (config.view.type === "kpi") {
    const text = cell && cell.status === "ok" && cell.total !== null ? String(cell.total) : NO_VALUE;
    return (
      <div className="flex h-full flex-col justify-center gap-1">
        <div className="font-mono text-display-lg text-content-strong">{text}</div>
        <div className="font-mono text-caption text-content-muted">{cell && cell.status !== "ok" ? cell.reason : config.query.grain}</div>
      </div>
    );
  }
  return (
    <div className="flex h-full flex-col justify-end rounded-md bg-bg-subtle p-3 font-mono text-caption text-content-muted">
      <div>{config.view.type}</div>
      <div className="truncate">{config.query.metrics.join(" / ")}</div>
      <div>
        {config.query.grain} · {config.query.split}
      </div>
    </div>
  );
}

export function CanvasDemo() {
  const [mode, setMode] = useState<CanvasMode>("edit");
  const [status, setStatus] = useState<AutosaveStatus>("idle");
  const [history, setHistory] = useState({ canUndo: false, canRedo: false });
  const [saves, setSaves] = useState<string[]>([]);
  const handle = useRef<ReportCanvasHandle>(null);

  // Configs live outside the canvas, by id, as the page will keep them.
  const [configs, setConfigs] = useState<Record<string, WidgetConfigInput>>(() => Object.fromEntries(SEED.map((s) => [s.id, s.config])));
  const initial = useMemo(seedWidgets, []);

  const renderWidget = useCallback(
    (w: CanvasWidget): WidgetRender => {
      const config = configs[w.id] ?? FIXTURE_CONFIGS[w.type];
      return { title: titleOf(config), chip: chipOf(config), body: <Readout config={config} /> };
    },
    [configs],
  );

  const onSave = useCallback(async (layout: Array<{ id: string }>) => {
    await new Promise((r) => setTimeout(r, 300));
    setSaves((s) => [`saved ${layout.length} items at ${new Date().toLocaleTimeString()}`, ...s].slice(0, 5));
  }, []);

  const btn = "rounded-control border border-hairline bg-surface-card px-3 py-1.5 text-body-sm text-content-strong hover:bg-bg-subtle disabled:opacity-40";

  return (
    <div className="flex flex-col gap-4 p-6">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className={btn} onClick={() => setMode((m) => (m === "edit" ? "view" : "edit"))}>
          {mode === "edit" ? "View" : "Edit"}
        </button>
        <button type="button" className={btn} disabled={!history.canUndo} onClick={() => handle.current?.undo()}>
          Undo
        </button>
        <button type="button" className={btn} disabled={!history.canRedo} onClick={() => handle.current?.redo()}>
          Redo
        </button>
        <button
          type="button"
          className={btn}
          onClick={() => {
            const id = crypto.randomUUID();
            setConfigs((c) => ({ ...c, [id]: FIXTURE_CONFIGS.kpi }));
            handle.current?.add(id, "kpi");
          }}
        >
          Add KPI
        </button>
        <span className="font-mono text-caption text-content-muted" data-testid="save-status">
          {status}
        </span>
      </div>
      <ReportCanvas
        ref={handle}
        widgets={initial}
        mode={mode}
        renderWidget={renderWidget}
        onSave={onSave}
        onSaveStatus={setStatus}
        onHistoryChange={setHistory}
        onOpenConfig={() => undefined}
        onDuplicate={(source, newId) => setConfigs((c) => ({ ...c, [newId]: c[source] }))}
        empty={<div className="p-8 font-mono text-caption text-content-muted">No widgets</div>}
      />
      <ul className="font-mono text-caption text-content-muted" data-testid="save-log">
        {saves.map((s) => (
          <li key={s}>{s}</li>
        ))}
      </ul>
    </div>
  );
}
