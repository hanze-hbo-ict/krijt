# Krijt

**A lightweight, browser-only editor for _strokendiagrammen_** (Dutch strip diagrams) in database normalization exercises.
Students list the fields of an original form, place them into horizontal table strips, and arrange the diagram.
Krijt is an expression tool, not a normalization tutor: it never proposes tables, keys or normal forms, and never grades.

It is in the same family as [Kopje](https://kopje.pages.dev) and Krash and takes its styling from Krash's design tokens
(`src/styles/tokens.css`). There is no backend, no account, no telemetry and no network access at runtime.

The product specification is [PLAN.md](PLAN.md). **Status: Milestone 1** (shell, model, inventory, basic tables).

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

## What works now (Milestone 1)

- **Form fields sidebar** (resizable, with drag or ←/→ on the splitter): type a field and press Enter (focus stays for
  the next one); paste a multi-line list into the entry, or use **Paste a list** (blank lines are dropped, order and
  duplicates are kept); rename or remove a field with its always-visible buttons.
- **Placing**: click fields to select them (plain clicks, no modifier keys), click **Place in diagram**, then click a
  table to append them or empty canvas to create an **unnamed** table. Command-first also works: Place, then select
  fields, then click. The inventory never changes when fields are placed; attributes are independent copies.
- **Tables**: SVG strips with cells fitted to measured text. Click a table's header band to select it; then
  **Name table** / **Rename table** (an empty name makes it unnamed again), **Add attribute**, **Move table**,
  **Delete table** (with confirmation). The dashed **+** cell after a strip types attributes directly; Enter adds one and
  keeps the input open.
- **Moving tables**: **Move table** then a click (no dragging needed), arrow keys on a selected table, or drag the header
  band (6px threshold, so a click stays a click).
- **Selection**: click a cell to select it, click it again to deselect. Clicking empty canvas clears the selection and
  never creates a table. Escape steps back: closes an inline edit, then ends the operation, then clears the selection.
- **Canvas**: scroll to pan, pinch (ctrl+wheel) to zoom, zoom buttons, 100% reset and **Fit**.
- **Session recovery**: the document, viewport and sidebar width are saved to `sessionStorage` (debounced, 300ms) and
  restored on reload in the same tab. Corrupt or incompatible data starts an empty diagram instead of crashing. A failed
  write shows a warning in the header.

### Demo scenario (the Milestone 1 acceptance)

1. Click the list icon in the sidebar (**Paste a list**) and paste these 12 lines, then **Add 12 fields**:
   `Ordernummer, Orderdatum, Klantnummer, Klantnaam, Adres, Postcode, Plaats, Artikelnummer, Omschrijving, Aantal, Prijs, Subtotaal`
   (one per line).
2. Click **Klantnaam**, **Klantnummer** and **Plaats**. The footer says "3 selected".
3. Click **Place in diagram**, then click empty canvas. A new unnamed table appears with
   `Klantnummer | Klantnaam | Plaats` in inventory order, and the 12 fields are still in the sidebar.
4. Reload the tab: the work is still there.

This scenario is automated in `tests/unit/state.test.ts` (state level) and `tests/e2e/app.spec.ts` (in real browsers,
clicks only, no drags, no modifier keys).

## Architecture

```text
src/
  model/        types.ts (KrijtDocument), ids.ts (stable random IDs), validate.ts (structural checks of untrusted data)
  commands/     commands.ts (pure applyCommand), builders.ts (intent → command, generates IDs; field-list parsing)
  state/        appState.ts (reducer, UI state machine), interaction.ts (canvas click → action)
  geometry/     layout.ts (strip layout, notation widths, bounds), measure.ts (canvas text measurer), viewport.ts
  canvas/       Canvas.tsx (SVG, hit testing, pan/zoom, drag, inline editors), RelationView.tsx (one strip)
  inventory/    Sidebar.tsx (form fields)
  persistence/  session.ts (versioned sessionStorage)
  components/   Icon, Splitter, InlineInput
  app/          App.tsx (shell, context bar, shortcuts), HelpDialog.tsx
tests/
  unit/         commands, geometry, state machine, session recovery
  e2e/          Playwright workflows
```

**Document.** `KrijtDocument` (`src/model/types.ts`) is the plan's model, unchanged, and the single source of truth.
Positions of tables are part of the document; viewport, selection, the active operation and inline editing are UI state.
Notation (PK, nullable, calculated) lives in independent boolean flags, never in the stored name.

**Commands.** Every edit is a plain-data `Command` applied by the pure `applyCommand(doc, cmd)`, which returns
`{ ok, doc }` or `{ ok: false, error }` and never mutates its input. Commands carry every ID they introduce (builders
generate them before dispatch), so applying a command is deterministic. That is the hook for Milestone 2's undo/redo:
one dispatched command is one history step, and multi-part edits (move + empty-table removal + reference updates) will
be single commands. Commands check structure only (things exist, IDs are fresh), never normalization rules.

**State.** One `useReducer` holds `{ doc, ui }`. `ui.operation` is a small state machine: `select`, `place`,
`moveTable`. Every one-shot operation returns to `select` on completion; Cancel/Escape changes UI state only. After
each command, `reconcileUi` drops UI references to things that no longer exist. Canvas clicks are resolved by
`resolveCanvasClick(state, target, point)` into one action, and keyboard activation uses the same function, as drag
and drop will in Milestone 2, so the input methods cannot diverge.

**Geometry.** `layoutRelation` computes cell boxes, the header band (move handle and name) and the editor-only + cell
from a `TextMeasurer`. The browser uses a cached canvas measurer with the diagram font; tests use a deterministic
estimate. `contentBounds(doc, m, editor)` covers editor affordances or only exported content, ready for the PNG
renderer (Milestone 4) and for braces/connectors (Milestone 3).

**Security and offline.** All assets are bundled; the production build carries a strict CSP (`vite.config.ts`,
`public/_headers`) that only allows the app's own origin. User text is rendered as text (React/SVG), never as HTML. An
E2E hook fails any test that triggers a request to another host.

## Deviations from the plan and decisions

- **Delete table is included in Milestone 1**, ahead of Milestone 2's editing commands. Without undo (Milestone 2) a
  student otherwise could not recover from a mistaken table. It asks for confirmation and also removes references that
  touch the table.
- **Click-based table movement** (`Move table`, then click) and arrow-key nudging are added alongside the drag handle.
  The plan lists table movement for M1 and requires every essential operation to work without dragging.
- **Pan/zoom/fit are in M1** (scroll, pinch, buttons). The plan lists them in v1 scope; M1 only names "position". Panning
  is by scroll, not by dragging empty canvas, so a click on empty canvas always stays a click.
- **Placing appends** to the clicked table. Choosing an insertion index by clicking a gap is Milestone 2 (destination
  previews); the `addAttributes` command already takes an index.
- **Notation is rendered but cannot be toggled yet.** Layout and rendering of bold-underlined PK, `/` and superscript
  `o` exist (and are tested for width), but the toggles are Milestone 2.
- **Attribute rename/delete/reorder and multi-select** are not in M1 (they are M2). Selection is single: one table or
  one attribute.
- **Source-field reordering** is not implemented yet (the plan marks it optional).
- **Session data** stores the document, viewport and sidebar width. Selection and the active operation are not
  restored: a reload starts in the normal select state.
- **Dark mode** follows the system preference; table cells stay dark-on-light "paper" so the notation looks the same as
  in an export.
- **Kopje/Krash styling**: Krash's source was available next to this repository, so its tokens and base control styles
  are reused. The header is more compact than Krash's to give the canvas room.
- **Language**: the UI is English, like Krash, with Dutch subtitles where the plan names them (Formuliervelden,
  Strokendiagrammen).

## Risks and open points for Milestone 2

- **Undo/redo**: commands are pure and deterministic, so a history stack of documents (or of commands) is
  straightforward. Arrow-key nudges currently make one command each; they should be coalesced into one history step.
- **Multi-selection without modifiers** needs a clear "selecting" state (Move/Copy), or a cell click in select mode will
  mean both "select this one" and "add this one". The plan's mode-based selection resolves this but must be visible.
- **Hit-target density**: cells are 34px tall, and the header band (24px) is the only table handle. Insertion-gap targets
  between cells will be narrow; they need generous invisible hit areas or a click-based "insert after" control.
- **Text measurement**: widths come from canvas `measureText` with the system font stack (no bundled font). On-screen
  and PNG output share the measurer, but the font differs per OS, so exported images will vary slightly between
  machines. Bundling a font would make output identical; decide before Milestone 4.
- **Move semantics with references** (plan §4.3): the rule for an endpoint that would span two tables after a move
  needs to be fixed in M2/M3. The recommended "prevent with a clear message" fits the command result type.
- **Inline editors** are HTML inputs positioned over the SVG from the viewport. Blur commits the edit. Attribute rename
  in M2 can reuse them, but long names in a narrow cell will need the input to grow past the cell.
- **Clipboard (M4)** is untested in the target exam browser. That remains the release gate.
