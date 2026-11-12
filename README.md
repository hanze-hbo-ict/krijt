# Krijt

**A lightweight, browser-only editor for _strokendiagrammen_** (Dutch strip diagrams) in database normalization exercises.
Students list the fields of an original form, place them into horizontal table strips, and arrange the diagram.
Krijt is an expression tool, not a normalization tutor: it never proposes tables, keys or normal forms, and never grades.

It is in the same family as [Kopje](https://kopje.pages.dev) and Krash and takes its styling from Krash's design tokens
(`src/styles/tokens.css`). There is no backend, no account, no telemetry and no network access at runtime.

The product specification is [PLAN.md](PLAN.md). **Status: Milestone 2** (attribute manipulation, notation, Move/Copy,
undo/redo). References (M3) and clipboard export (M4) are not built yet.

## Quick start

Requires Node.js 20+ and npm.

```sh
npm ci
npm run dev        # http://localhost:5173
npm test           # unit tests (Vitest)
npm run build      # type-check + production build in dist/
npm run preview    # serve dist/ with the production security headers
npm run test:e2e   # Playwright against the production build (Chromium, Firefox, WebKit)
```

First-time E2E setup: `npx playwright install chromium firefox webkit`. Run against the dev server with `KRIJT_E2E_DEV=1`.

## Deployment

`.github/workflows/deploy.yml` tests, builds and deploys to Cloudflare Pages (project `krijt`,
<https://krijt.pages.dev>), like Krash. Every push to `main` deploys to production; pull requests from this repository
get a preview URL. The pipeline runs the unit tests, the production build and the Chromium E2E tests before deploying.
`public/_headers` gives the deployed site the same CSP and security headers as `npm run preview`.

One-time setup:

1. Create the Pages project: `npx wrangler login`, then `npx wrangler pages project create krijt --production-branch main`.
2. Add repository secrets `CLOUDFLARE_API_TOKEN` (permission "Cloudflare Pages: Edit") and `CLOUDFLARE_ACCOUNT_ID`.

## What works now

Every essential operation works with plain clicks and visible controls. Dragging is an optional shortcut, and no
operation needs a modifier key.

**Form fields** (sidebar, resizable with drag or ←/→ on the splitter)

- Type a field and press Enter (focus stays for the next one); paste a multi-line list into the entry, or use
  **Paste a list** (blank lines dropped, order and duplicates kept); rename or remove a field with its visible buttons.
- **Place in diagram**: select fields with plain clicks, then click a table (header: append; left/right half of a cell:
  insert before/after it) or empty canvas (new **unnamed** table). Command-first works too. Dragging fields onto the
  canvas does the same. The inventory is never consumed; attributes are independent copies.

**Attributes**

- **Tools** (column at the left of the canvas): **Select** (one cell per click; clicking it again deselects),
  **Select several** (each click adds or removes a cell, across tables), **Move**, **Copy**.
- The bar above the canvas acts on the selection: **Rename** (also double-click or Enter), **Primary key**,
  **Nullable**, **Calculated** (each toggles only its own flag; a mixed selection shows a mixed state), **Move left /
  right** (also ← →), **Move to…**, **Copy to…**, **Delete** (also Del/Backspace).
- **Notation**: primary key **bold and underlined** (several per table for a composite key), nullable with a real
  superscript `o`, calculated with a `/` suffix, both as `name/ᵒ`. Notation is rendered from flags, never stored in names.
- **Move / Copy** are one-shot, two-step operations. From the tool strip: click attributes (count shown), **Next**
  (Enter), then click a destination. From **Move to… / Copy to…**: straight to the destination for the current
  selection. Destinations: a table header (append), a cell's left/right half (insert), or empty canvas (new unnamed
  table). Hovering shows a preview: an insertion bar, or the outline of the new table. Afterwards the moved attributes
  (or the new copies) are selected and the tool returns to Select. Escape/Cancel at any step changes nothing.
- Move keeps attribute IDs, so references stay attached; copies get new IDs and no references. A table left empty is
  removed. Dragging a cell (or a selection) moves it, through the same command.
- Typed attributes: the dashed **+** cell after a strip, or **Add attribute**.

**Tables**: click the header band to select; **Name table / Rename table** (empty = unnamed), **Add attribute**, **Move
table** (then click), **Select all attributes**, **Delete table**. Tables also move by dragging the header band or with
the arrow keys.

**Undo / redo**: buttons in the header, Ctrl/⌘+Z and Ctrl/⌘+Shift+Z (or Ctrl+Y). Every document change is one step,
including layout: a multi-attribute move with its empty-table removal is one step, and consecutive arrow-key nudges of a
table form one step. Inside text fields the browser's own undo is left alone. Undo restores deleted tables in place,
so deletion needs no confirmation.

**Messages** about dependent changes ("Deleted 2 attributes and 1 reference that used them. 1 empty table removed.")
and refused operations appear over the top of the canvas.

**Canvas and recovery**: scroll to pan, pinch to zoom, zoom buttons, 100% and Fit. The document, viewport and sidebar
width are saved to `sessionStorage` and restored on reload in the same tab; corrupt data starts an empty diagram.

### Demo scenario (Milestone 2 acceptance)

1. Paste ten fields (`Ordernr, Datum, Klantnr, Naam, Adres, Plaats, Artikelnr, Omschrijving, Aantal, Prijs`, one per
   line), select them all, **Place in diagram**, click empty canvas.
2. **Move** tool, click `Klantnr`, `Naam`, `Adres`, `Plaats`, **Next**, click empty canvas below: a second table.
3. Click empty canvas, **Select several**, click `Artikelnr`, `Omschrijving`, `Prijs`, **Move to…**, click empty canvas:
   three tables.
4. **Copy** tool, click `Klantnr`, **Next**, click the first table's header: `Klantnr` is copied back.
5. Undo four times and redo four times; each step restores exactly the previous diagram.

This runs as automated tests in `tests/unit/operations.test.ts` and `tests/e2e/milestone2.spec.ts` (clicks only).
The Milestone 1 scenario (paste 12 fields, build a table from a subset) is in `tests/e2e/app.spec.ts`.

## Architecture

```text
src/
  model/        types.ts (KrijtDocument), ids.ts (stable random IDs), validate.ts (structural checks of untrusted data)
  commands/     commands.ts (pure applyCommand), builders.ts (intent → command, generates IDs; field-list parsing)
  state/        appState.ts (reducer, UI state machine, history), interaction.ts (click/drop → action, destinations)
  geometry/     layout.ts (strip layout, notation widths, bounds), measure.ts (canvas text measurer), viewport.ts
  canvas/       Canvas.tsx (SVG, hit testing, previews, pan/zoom, drags, inline editors), RelationView.tsx (one strip)
  inventory/    Sidebar.tsx (form fields, field drag source)
  persistence/  session.ts (versioned sessionStorage)
  components/   Icon, Splitter, InlineInput
  app/          App.tsx (shell, shortcuts), ContextBar.tsx (tools, context bar, messages), HelpDialog.tsx
tests/
  unit/         commands, attributes, geometry, state machine, operations + history, session recovery
  e2e/          Playwright workflows (app.spec.ts: M1, milestone2.spec.ts: M2)
```

**Document.** `KrijtDocument` (`src/model/types.ts`) is the plan's model, unchanged, and the single source of truth.
Positions of tables are part of the document; viewport, selection, the active operation and inline editing are UI state.
Notation (PK, nullable, calculated) lives in independent boolean flags, never in the stored name.

**Commands.** Every edit is a plain-data `Command` applied by the pure `applyCommand(doc, cmd)`, which returns
`{ ok, doc, notice? }` or `{ ok: false, error }` and never mutates its input. Commands carry every ID they introduce
(builders generate them before dispatch), so applying a command is deterministic. Edits with dependent changes are one
command: `moveAttributes` removes the moved attributes, inserts them (index adjusted for attributes that moved out
from before it), drops emptied tables and re-points reference ends; `deleteAttributes` also removes dangling references
and empty tables and returns a `notice`. Commands check structure only, never normalization rules.

**Destinations.** One `Destination` type (`table` + index, or `newTable` + position) serves Place, Move, Copy and all
drops. `destinationFor(doc, target, point)` turns a hit target into a destination; a cell target carries which half was
hit. The preview renders from the same function, so what you see is where things go.

**State and history.** One `useReducer` holds `{ doc, ui, history }`. `ui.operation` is the state machine: `select`,
`place`, `moveTable`, `move.{selecting,destination}`, `copy.{selecting,destination}`. One-shot operations return to
`select`; Cancel/Escape changes UI state only. History keeps up to 200 previous documents; a successful command that
changes the document pushes one entry (or merges with the previous entry for the same `coalesceKey`), and an unchanged
or failed command pushes nothing. Undo/redo end any running operation and `reconcileUi` drops selections that no longer
exist.

**Input paths.** Pointer clicks, keyboard activation (Enter/Space on a focused cell or header) and drops all resolve
through `resolveCanvasClick`, `placeAction` and `transferAction`. Drags only start after 6px of movement, so a click
stays a click. The sidebar drops onto the canvas through a small `CanvasHandle` (hit test + preview). Toolbars have a
fixed size and messages float over the canvas, so selecting something never moves the diagram under the pointer.

**Geometry.** `layoutRelation` computes cell boxes, the header band and the editor-only + cell from a `TextMeasurer`.
The browser uses a cached canvas measurer with the diagram font; tests use a deterministic estimate.
`contentBounds(doc, m, editor)` covers editor affordances or only exported content.

**Security and offline.** All assets are bundled; the production build carries a strict CSP (`vite.config.ts`,
`public/_headers`) that only allows the app's own origin. User text is rendered as text (React/SVG), never as HTML. An
E2E hook fails any test that triggers a request to another host.

## Deviations from the plan and decisions

- **Moving a reference end apart is refused** (plan §4.3 asks for a documented rule): if a move would leave some
  attributes of a reference end in one table and some in another, nothing changes and the student is told to move them
  together or delete the reference. An end that moves completely follows to the destination table.
- **Two entry points for Move/Copy.** The plan wants both "selection → command" and "command → selection". The tool
  strip starts with an empty selection; **Move to… / Copy to…** use the current selection and skip straight to the
  destination. Carrying an old selection into the tool proved easy to miss (attributes moved that the student had only
  selected to mark a flag).
- **After Move/Copy, the result is selected** (the moved attributes, or the new copies), so the student sees where it
  went and can mark flags right away.
- **Insertion by cell halves.** Instead of separate thin gap targets, the left/right half of any cell chooses
  before/after, with an insertion-bar preview. A table header (or the + cell) appends.
- **Delete without confirmation** (tables and attributes), since undo restores them; M1 asked for confirmation before
  undo existed.
- **Tool strip as a column** at the canvas edge rather than in the top bar, so the top bar fits the selection actions
  in one row at laptop widths and keeps a fixed height.
- **Keyboard:** ← → reorder selected attributes (they nudge a selected table, with ↑ ↓); Enter renames a single
  selected attribute or advances Move/Copy; Delete/Backspace deletes selected attributes.
- **Undo history is not saved** across a reload; only the document is.
- Unchanged from M1: click-based table movement and pan/zoom/fit are included; source-field reordering is not
  (optional in the plan); selection and the active operation are not restored on reload; dark mode keeps cells as light
  "paper"; the UI is English with Dutch subtitles; Krash's tokens and base styles are reused.

## Risks and open points for Milestone 3

- **References UI**: the Reference mode fits the existing two-phase pattern (`selecting` → `destination` becomes
  source → target). Selection order is already kept in click order, which the plan needs for endpoint order.
- **Deleting with references** already removes dangling references and says so; it is tested at command level with
  hand-made references, but not yet through the UI.
- **Connector hit areas** must win over cells and headers underneath (§4.7), and the canvas currently resolves targets
  from `data-kind` attributes; connectors need their own kind and a wide invisible stroke.
- **Bounds**: `contentBounds` covers strips and headers only; braces and connectors must join it for Fit and export.
- **Text measurement**: widths come from canvas `measureText` with the system font stack (no bundled font). On-screen and
  PNG output share the measurer, but the font differs per OS, so exports will vary slightly between machines. Bundling a
  font would make output identical; decide before Milestone 4.
- **Firefox E2E** has not run in this environment (the headless browser cannot start inside the tool sandbox here);
  Chromium and WebKit pass. Run `npx playwright test --project=firefox` locally or rely on CI.
- **Clipboard (M4)** is untested in the target exam browser. That remains the release gate.
