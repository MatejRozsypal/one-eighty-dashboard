# RS6 report: Canvas (design WP6)

Branch `rs6-canvas`, worktree `oe-dash-wt/rs6-canvas`, commit `75e7886` on top of `d727748` (merge of rs0). Frontend only: no warehouse access, no `mart_qa` objects, nothing to deploy.

## What changed (all under `dashboard/`)

| File | Content |
|---|---|
| `components/reports/canvas/ReportCanvas.tsx` | The canvas. 12 cols, rowHeight 40, 16 px gutters, vertical compaction (library `verticalCompactor`), drag only from `.widget-drag`, resize handles `se`, `e`, `s`. Own ResizeObserver for width (no use of the v2 `useContainerWidth` hook, so no ref-type cast). View vs edit via `mode`. Three tiers by viewport: >= 1200 edit-capable 12 cols, 768 to 1199 six-column display only (derived layout), < 768 `MobileStack`. aria-live announcer, focus kept across reorders, Cmd/Ctrl+Z and Shift+Z (and Ctrl+Y) while editing. Imperative handle: `add`, `remove`, `retype`, `undo`, `redo`, `flush`, `focus`, `getWidgets`. |
| `components/reports/canvas/WidgetFrame.tsx` | Card with header: grip (edit only), title button (opens config), override chip, menu. Menu is portalled to `document.body` (not clipped by the card or the grid item's stacking context), arrow-key navigable, Escape returns focus. Exports `WidgetRender` (the render-prop result). Frame is focusable; keyboard handler hangs on it. |
| `components/reports/canvas/MobileStack.tsx` | Read-only stack ordered by (y, x). KPI tiles 2-up (a lone trailing tile spans the row), every other widget full width, height from the type's default row count. |
| `components/reports/canvas/useGridKeyboard.ts` | Pure grid math (browser-safe) plus the hook: `normalizeWidgets`, `compactWidgets`, `moveWidget`, `resizeWidget`, `firstFreeSlot`, `addWidget`, `duplicateWidget`, `removeWidget`, `retypeWidget`, `tabletWidgets`, `readingOrder`, announcement strings. Built on the library's `moveElement` and `verticalCompactor`, so keys land where the mouse would. |
| `components/reports/canvas/useLayoutHistory.ts` | Pure `createHistory`/`commitHistory`/`undoHistory`/`redoHistory` + generic `useLayoutHistory<T>`. Limit 50 (`UNDO_HISTORY_STEPS`), structural equality (equal commit is a no-op), coalescing of same-key commits within 600 ms (held arrow key is one undo step). |
| `components/reports/canvas/useAutosave.ts` | Framework-free `createAutosaver` (fake-scheduler testable) + `useAutosave`. 800 ms debounce (`AUTOSAVE_DEBOUNCE_MS`), no save on mount, saves never overlap, `{ ok: false }` or a throw gives status `error` (value stays dirty, next change or `flush()` retries), flush on `pagehide`, tab hidden and unmount. |
| `components/reports/canvas/CanvasDemo.tsx` | Extra (not in the owned list, inside my folder): demo story from `lib/reports/fixtures.ts` (8 widgets, Edit/View, Undo/Redo, Add KPI, fake 300 ms `onSave`, status and save log). Bodies are placeholder readouts; RS7's widgets plug into the same `renderWidget`. |
| `app/(app)/reports/grid.css` | Token-only restyle: dotted cell grid in edit mode, placeholder (`--accent-soft`, dashed `--accent`), corner L-grip and edge pills for the handles, drag/resize card state, focus ring `--focus-ring`, motion tokens, reduced-motion. All scoped under `.report-canvas`, one class deeper than the library CSS. |
| `scripts/check-reports-canvas.ts` | 98 pure checks (see below). Extra file beyond the owned list. |

## Public API for RS9

```tsx
<ReportCanvas
  key={reportId}                      // layout state is uncontrolled: `widgets` seeds it
  ref={handle}                        // ReportCanvasHandle
  widgets={CanvasWidget[]}            // { id, type, x, y, w, h }
  mode="view" | "edit"
  renderWidget={(w, ctx) => ({ title, chip?, body, menu? })}   // RS7 widget goes in `body`
  onSave={(layout: LayoutItem[]) => actions.saveLayout(id, version, layout)}  // may return { ok:false }
  onSaveStatus={(s) => ...}           // idle | dirty | saving | saved | error
  onWidgetsChange={(widgets, reason) => ...}   // every committed change, incl. undo/redo
  onOpenConfig={(id) => ...}          // title click, menu Edit/Open, Enter
  onDuplicate={(sourceId, newId) => clone config under newId}  // no prop = no Duplicate action
  onRemove={(id) => ...}              // show an Undo toast that calls handle.undo()
  onHistoryChange={({canUndo, canRedo}) => ...}
  undoShortcuts                       // default true; set false if RS9 owns Cmd+Z
  empty={ReactNode}
/>
```
- Widget configs live in the page keyed by id and must outlive removal (undo of a removal re-renders the id). Layout history covers geometry, add, remove, duplicate and retype of the widget list; config edits are RS9's (it may reuse `useLayoutHistory<T>`).
- `handle.add(newId, type)` places the widget at the first free slot at its default size (the page creates the config under `newId` first). `handle.retype(id, type)` when the config panel changes the widget type.
- `onSave` receives geometry only (`LayoutItem[]` of the zod contract), matching `ReportActions.saveLayout`. Add/remove go through their own actions; RS9 must order them so a freshly added id exists server side before a layout containing it is saved.
- Keys handled on a focused widget frame (edit mode): arrows move, Shift+arrows resize, Delete/Backspace remove, Cmd/Ctrl+D duplicate; Enter opens config in any mode. Tab order is the DOM order, which the canvas keeps in reading order (y, x). Global keys (`/`, `N`, `E`, `?`, Cmd+K, Cmd+S) stay with RS9.

## CSS import (RS9's `app/(app)/reports/layout.tsx`)

```ts
import "react-grid-layout/css/styles.css";   // library base, first
import "./grid.css";                          // app/(app)/reports/grid.css, second
```
Verified in a scratch route that this exact pair loads and styles correctly under Next 14.2 (the scratch route was removed).

## Verification
- `npx tsc --noEmit`: exit 0. `npm run build`: exit 0 (`scratchpad/rs6_build.log`). `npm run check:reports`: 205/205 (RS0 checks unaffected).
- `npx tsx --tsconfig scripts/tsconfig.json scripts/check-reports-canvas.ts`: **98/98**. Covers: history (commit, undo, redo, no-op, redo cleared on commit, 50-step cap with exactly 50 undos, coalescing in and out of the window, structural equality); autosave (no save on mount, debounce restart, one save of the last value, status sequence, no overlap, follow-up save, `{ ok:false }`, throw, flush retry, `markSaved`); keyboard math (edges blocked, left/right push, up jumps above and pushes down, down jumps below, resize clamps to type minimum, grid width and max height, push on grow, first free slot incl. gap and below, add/duplicate/remove/retype, reading order, tablet 6-col layout, announcement strings); static gates over the owned files (no em/en dash, no hex, no `rgb()`).
- Grep gates: no U+2013 or U+2014 and no hex or rgb literal in `components/reports`, `app/(app)/reports`, or the check script.
- Real-browser run in a throwaway route outside `(app)` (dev server, no login needed; route and server removed afterwards): at 1440 px, mouse drag from the grip moved a KPI (announced "mer moved to column 10, row 1", then autosave status dirty to saved, log "saved 8 items"); corner resize gave 3x4 (208 px high = 4 rows with gutters); ArrowRight and Shift+ArrowDown on a focused card moved and resized it and focus stayed on it; Ctrl+Z undid it ("Undone"); Ctrl+D duplicated and focused the copy; Delete removed it and focused the neighbour; menu opened portalled with Edit/Duplicate/Remove and closed on Escape; at 1000 px the 6-column display-only grid showed no grips or handles; at 637 px the stack showed KPIs 2-up with a trailing tile full width. Console clean (no hydration or React warnings).

## Deviations and decisions
1. **Mobile edit.** Design 1.12 mentions Move up/down reorder in edit mode on mobile; the brief and 1.12's own "editing disabled below 1200" say read-only, so the stack has no editing at all.
2. **Tier by viewport (matchMedia), grid width by container.** The grid width comes from the container (rail and padding excluded), the 1200/768 thresholds from the viewport as in the design.
3. **Vertical keyboard steps jump over the neighbour.** With vertical compaction a one-cell Up/Down step is pulled straight back by the compactor, so Up/Down place the item at the top of the nearest item above (that one is pushed down) or directly below the nearest item beneath; with no neighbour in that direction the move is announced as blocked. Left/right and resize use the library rules unchanged.
4. **Resize into a neighbour that sits higher** moves the resized item below that neighbour (compaction orders by y, then x), the same as the mouse; same-row neighbours are pushed down.
5. **Tablet layout** is first-fit in reading order at half width (`ceil(w/2)`); minimum sizes do not apply at 6 columns.
6. **Autosave** is skipped when `onSave` is omitted; config and filter changes are not part of it (layout geometry only).
7. Extra files beyond the owned list, both inside my folders: `CanvasDemo.tsx` and `scripts/check-reports-canvas.ts`.

## Requests to orchestrator
1. RS0/package.json owner: add `"check:reports-canvas": "tsx --tsconfig scripts/tsconfig.json scripts/check-reports-canvas.ts"` (I did not edit `package.json`).
2. RS9: import the two CSS files in the order above; own the global keys; mount `CanvasDemo` on a scratch route only if a visual check is wanted before the real page exists.
3. RS7: widget bodies get 100% of the frame body (header excluded, 16 px side padding, `overflow: hidden`); charts should use `ResponsiveContainer` with a debounce so resize stays smooth.
4. RS5/RS9: the canvas needs `crypto.randomUUID()` (all supported browsers, secure contexts) for duplicates; the page may instead pass its own ids by calling `handle.add`.

## Open issues
- None blocking. Not verified on a touch device or at real 60 fps with RS7's chart widgets (placeholders only); the drag path itself only re-renders the library's own items, children elements are stable during a drag.
