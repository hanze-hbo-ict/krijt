# Krijt

**A lightweight, browser-only editor for _strokendiagrammen_** (Dutch strip diagrams) in database normalization exercises.
Students list the fields of an original form, place them into horizontal table strips, draw references, and arrange the diagram.
Krijt is an expression tool, not a normalization tutor: it never proposes tables, keys or normal forms, and never grades.

It is in the same family as [Kopje](https://kopje.pages.dev) and Krash and takes its styling from Krash's design tokens
(`src/styles/tokens.css`). There is no backend, no account, no telemetry and no network access at runtime.

The product specification is [PLAN.md](PLAN.md). **Status: Milestone 4** (clipboard export and exam hardening).
All v1 features are built. The release gate that remains is a manual one: a real PNG paste into an answer field in
the actual exam browser (see "Release gate" below).

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

**References**

- **Reference** tool (or **Reference from…** for the selected attributes): click the foreign-key attribute(s), all in
  one table and side by side, **Next** (Enter), then click the referenced attribute(s), side by side in one table and
  as many, **Finish** (Enter). The ends pair up **left to right in table order** (click order does not matter, and the
  ends are stored in table order); composite ends show numbered badges. **Back** returns to step 1; Escape/Cancel
  changes nothing. Impossible picks (a second table, ends not side by side, too many targets, a foreign-key attribute
  as its own target) are refused with a message. Nothing checks keys or names: a target need not be a primary key.
- **Ends are units.** ← → on a whole composite end shift it as one block, and other attributes jump over it. ← → on
  part of an end reorder inside it (which changes the left-to-right pairing, as the diagram shows); once the part
  reaches the end's edge, the next press moves the whole block. A reorder that would separate overlapping ends moves
  the block instead.
  Moving one member (Move, Move to…, or a drag) brings the rest of the end along, with a message, and selects it all.
  Placing, copying or moving to a point inside an end snaps to the block's nearer edge (after it on a tie); the
  preview shows the snapped spot. Overlapping ends in one table form one block.
- **Rendering**: one attribute per end gives a plain orthogonal arrow from the foreign key to the referenced cell; a
  composite reference gets a curly brace at **both** ends and one arrow between the brace tips. (A brace that spans
  non-member cells, possible only in sessions from before ends became units, marks its members with dots.)
- **Selecting** a connector (click it, or Enter on it with the keyboard) highlights both ends (dashed amber: foreign
  key; solid teal: referenced) and offers **Delete reference** (also Del). Connectors have a 14px invisible hit
  stroke and win over tables underneath; while any operation runs they are click-through.
- Connectors follow their cells by attribute ID when tables move (also during a drag), attributes are reordered,
  renamed or moved together to another table. Deleting an attribute or table deletes its references in the same undo
  step, with a message.

**Names**: table and column names may contain only letters, marks and digits of any script (accents, Greek,
Cyrillic, … included), dashes (Unicode Pd: `-`, `–`, `—`) and connectors (Unicode Pc: `_`). While typing a name, a
space becomes an underscore and other characters are left out; commands refuse invalid names. Form-field labels
stay free text; placing a field converts its label (each run of other characters becomes one underscore, repeated
underscores become one and outer ones are dropped; typed dashes stay: `Datum (dd-mm)` → `Datum_dd-mm`). Names from sessions made before this rule still load.

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
width are saved to `sessionStorage` (debounced, and at once when the tab is hidden or the page unloads, so a change
right before a reload is kept) and restored on reload in the same tab. Corrupt or incompatible data starts an empty
diagram and says so.

**Handing in** (header, always visible):

- **Copy image** puts a PNG of the diagram on the clipboard: tables, notation, table names, connectors and braces in
  dark ink on opaque white, cropped to the content plus a 24-unit margin, at 2× (smaller only for very large
  diagrams, within browser canvas limits). No grid, header bands, grips, + cells, selection or end marks. Success is
  shown only after the browser confirms the write; a blocked, unsupported or insecure clipboard, or a failed render,
  gives a specific message and nothing claims success. There is no download fallback. Disabled while there are no
  tables.
- **Copy data** puts the diagram on the clipboard as plain text, meant to be understood by reading it:

  ```text
  Klant
    *klantnr*
    naam

  #1
    *ordernr*
    klantnr → Klant.klantnr
    totaal/°

  Regel
    *ordernr*
    *regelnr*

  #2
    ordernr
    regelnr
    datum
    (ordernr, regelnr) → Regel(ordernr, regelnr)
  ```

  One block per table, in diagram order, separated by an empty line: the table's name, then its columns indented two
  spaces. A repeated name gets a suffix by occurrence (`Klant#2`, `x#2`); unnamed tables are `#1`, `#2`, ….
  A primary key is wrapped in asterisks (`*klantnr*`, `*x#2*`); then come `/` calculated and `°` nullable, in the
  diagram's order (`totaal/°`). Single-column references are written on their column (`klantnr → Klant.klantnr`;
  several from one column comma-separated: `ref → A.id, B.id`). A composite reference is a line of its own after the
  columns, columns paired in order. References use names without the notation. Table positions and the form-field
  list are not exported. Same diagram, same text; no internal IDs. Export only: there is no import. Disabled while
  there are no tables. Because names can only contain letters, digits, dashes and underscores (below), none of the
  notation can be part of a name, so the text is unambiguous. If the answer field renders Markdown, `*klantnr*`
  would show as italics without the asterisks; check this in the release gate.
- **New** asks for confirmation, then clears the diagram (optionally keeping the form fields). It is one undo step;
  the recovery copy follows the cleared state.

### Demo scenario (Milestone 4 acceptance)

1. Build a normalization answer with clicks only (Milestones 1–3): tables, keys, nullable/calculated marks, one simple
   and one composite reference.
2. **Copy image**, paste into the answer field (or any image-accepting editor) and check that all notation is legible:
   bold underlined keys, superscript `o`, `/`, braces at both ends, arrowheads.
3. Reload the tab: the diagram is restored.

Automated in `tests/unit/export.test.ts` (scene, scale limits, clipboard results with fake browser objects, the text export,
New, recovery status) and `tests/e2e/milestone4.spec.ts`: in Chromium a real clipboard round trip (the PNG is read
back and checked for size, opaque white corners, ink and the absence of selection colours; the text is read back and
compared), and in every browser a blocked and an unsupported clipboard, New diagram, corrupt recovery data, a change
right before reload, and a 25-field / 10-table / 12-reference diagram whose interactions each stay under one second.

### Release gate (manual)

Clipboard behaviour in a locked-down exam browser cannot be tested from here. Before relying on Krijt in an exam:

1. Open the deployed (https) Krijt in the actual exam/lockdown browser and the actual answer type.
2. Build a small diagram with every notation, **Copy image**, paste into the answer field, submit a test answer and view
   it as a grader. Check legibility at the size the grader sees.
3. Repeat with **Copy data** if text answers are allowed.
4. If the clipboard is blocked, Krijt says so; report the limitation. Do not add a download or upload path without a
   deliberate change to the requirements.

### Demo scenario (Milestone 3 acceptance)

1. Paste `ordernr, klantnr, naam, regelnr, aantal, levnr` (one per line) and place four tables: Order
   (`ordernr, klantnr`), Klant (`klantnr, naam`), Regel (`ordernr, regelnr, aantal`), Levering (`ordernr, regelnr, levnr`).
2. **Reference**, click Order's `klantnr`, **Next**, click Klant's `klantnr`, **Finish**: one arrow.
3. **Select several**, click Levering's `ordernr` and `regelnr`, **Reference from…**, click Regel's `ordernr` and
   `regelnr`, Enter: braces at both ends, one arrow.
4. Move Klant and Regel (**Move table** + click), reorder attributes with ← →, undo: both references stay attached at
   every step, and survive a reload.

Automated in `tests/unit/references.test.ts` and `tests/e2e/milestone3.spec.ts`, which checks from the rendered SVG
which cells each connector end touches.

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
  geometry/     layout.ts (strip layout, notation widths, bounds), references.ts (connectors, braces), measure.ts, viewport.ts
  canvas/       Canvas.tsx (SVG, hit testing, previews, pan/zoom, drags, inline editors), RelationView.tsx (one strip),
                ReferenceView.tsx (one connector)
  inventory/    Sidebar.tsx (form fields, field drag source)
  clipboard/    scene.ts (export picture as drawing operations), paint.ts (canvas + PNG), clipboard.ts (writes, errors)
  persistence/  session.ts (versioned sessionStorage)
  components/   Icon, Splitter, InlineInput
  app/          App.tsx (shell, shortcuts), ContextBar.tsx (tools, context bar, messages), HelpDialog.tsx
tests/
  unit/         commands, attributes, geometry, state machine, operations + history, references, export, session recovery
  e2e/          Playwright workflows (app.spec.ts: M1, milestone2.spec.ts … milestone4.spec.ts: M2–M4)
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
`place`, `moveTable`, `move.{selecting,destination}`, `copy.{selecting,destination}`, and
`reference.{source,target}`, which carries both ordered attribute lists itself. Finishing a reference needs a fresh ID,
so `nextStepAction(state)` resolves Next/Finish/Enter for every operation outside the reducer. One-shot operations return to
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
`contentBounds(doc, m, editor)` covers editor affordances or only exported content, and always includes connectors and
braces. `layoutReferences(references, layouts)` derives each connector from the current strip layouts: target clearly
below → bottom edge to top edge; clearly above → top to bottom; otherwise (side by side, or one table) → both bottom,
with the horizontal run underneath. Horizontal runs that would lie on top of an earlier one shift by a 10px lane.
Commands `addReference` and `deleteReference` check structure only (`referenceProblem`): ends exist, one table each,
no repeats, equal size, no attribute referring to itself, no exact duplicate.

**Security and offline.** All assets are bundled; the production build carries a strict CSP (`vite.config.ts`,
`public/_headers`) that only allows the app's own origin. User text is rendered as text (React/SVG), never as HTML. An
E2E hook fails any test that triggers a request to another host.

## Deviations from the plan and decisions

- **Restricted names** (not in the plan): letters, digits, dashes and underscores only, so the text export needs no
  quoting or escaping. Form-field labels stay free text and are converted when placed.
- **Copy data is a plain-text description, not the internal document as JSON** (plan §6.2 says "serialize a
  complete, versioned `KrijtDocument` to plain JSON text"). The internal format's random IDs made references
  unreadable; the text keeps what is needed to understand the answer (tables, column order, notation, references)
  and drops internal IDs, layout (the image carries it), the form-field list (it comes from the exercise) and a
  format/version marker. Session recovery still stores the internal, versioned `KrijtDocument`.

- **Reference ends are adjacent, ordered units** (plan §4.3 asks for a documented rule; this follows the course
  convention and deliberately narrows plan §2, which allowed non-adjacent ends). Ends must be side by side when the
  reference is made, pair up left to right, and every edit keeps them that way: shifting reorders inside the end or
  moves the block, moving a member brings the whole end, insertions snap out of it. A reference end that moves follows to the destination table.
  Not expressible: overlapping composite keys such as (a,b), (a,c), (b,c) in one table.
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

- **References (M3)**: the tool starts empty and **Reference from…** uses the selection, as with Move/Copy. A reference
  within one table is allowed (structure only); an attribute referring to itself and an exact duplicate are not.
  Deleting an attribute that belongs to a composite end removes the whole reference (§4.7 "removes or handles").
  Editing a reference's ends is not offered; delete and redraw.
- **Key hints in filled buttons** (Next/Finish) were unreadable (white on the light key background); fixed for M2's
  Next as well.

- **Export (M4)** is drawn on a 2D canvas from a pure scene (`exportScene`), built from the same `layoutRelation` /
  `layoutReferences` and measurer as the screen, rather than by serializing the on-screen SVG; this needs no font
  embedding and guarantees no editor chrome leaks in. Table names sit above the strip, left-aligned.
- **Clipboard timing**: the image write starts synchronously in the click with the PNG as a promise in
  `ClipboardItem` (required by Safari); if a browser rejects that for a reason other than permission, it retries once
  with the finished blob.
- **Straight connectors**: when two ends lie one above the other and overlap horizontally, the connector is a single
  straight line; each end's contact point (or brace tip) may move up to a quarter of its width from the centre.
- **Narrow selection bar**: below about 1180px of bar width, Move to… / Copy to… / Reference from… / Delete show only
  their icons (names and tooltips remain); below about 860px also Rename and the notation samples.
- **Shortcuts are off while a dialog is open**, checked in the DOM (React state lags behind the dialog's close event).
- **No `beforeunload` warning** on closing the tab: lockdown browsers and test runners handle it unpredictably, and a
  reload already restores the work.

## Risks and open points for Milestone 5

- **Release gate**: a real paste in the exam browser (above) is still to be done. Firefox supports image clipboard
  writes only from version 127.
- **Routing is per reference** and ignores other tables: a connector can cross an unrelated table or its header band
  (it then wins clicks there; the header's grip end stays clickable), and an end on a strip's top edge sits in the
  header band, where a brace can overlap the grip or the start of a long table name. Students can rearrange tables;
  better routing is a Milestone 5 item if real diagrams need it.
- **Text measurement**: widths come from canvas `measureText` with the system font stack (no bundled font). Screen and
  PNG share the measurer and the font, so a picture is always consistent in itself, but pictures differ slightly
  between operating systems. Bundling a font would make them identical, if graders ever need that.
- **Firefox E2E** has not run in this environment (the headless browser cannot start inside the tool sandbox here);
  Chromium and WebKit pass. Run `npx playwright test --project=firefox` locally or rely on CI.
