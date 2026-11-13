# Krijt — Implementation Plan

## 0. Purpose and working agreement

Build **Krijt**, a lightweight, browser-only editor for Dutch **strokendiagrammen**, designed primarily for **database normalization exercises during exams**. Students inventory fields from an original form, organize them into horizontal table strips, identify keys and references, and paste their finished diagram into an exam answer.

Krijt is an **expression tool, not a normalization tutor**: it must not propose relations, detect normal forms, recommend keys, grade correctness, or nudge students toward an answer.

The UI should feel like the existing lightweight educational tools **Kopje** (`https://kopje.pages.dev`) and **Krash** (the companion PostgreSQL exam IDE): restrained styling, concise controls, generous working space, and immediate direct manipulation. If source code or design tokens from those projects are available, use them; otherwise treat them as visual references rather than inventing a shared component system.

**Build for unreliable touchpads.** Every essential operation must be possible using ordinary clicks and visible controls. Drag-and-drop is an optional faster path, never the only path. Avoid hover-only or modifier-key-only essential actions.

**No backend, accounts, analytics, AI, network-dependent runtime services, file uploads, file downloads, or file imports.** Clipboard-based submission and `sessionStorage` recovery only.

### Definition of done

A student can paste a list of source fields, create and split tables, copy keys, mark primary/optional/calculated attributes, create single/composite references, arrange the diagram, and **copy the complete diagram as a PNG image** for pasting into an exam answer, without dragging or using keyboard modifiers. They can alternatively **copy JSON as text**. A reload of the same browser tab restores the working session.

---

## 1. Product scope and non-goals

### In scope for v1

- Resizable source-field sidebar; add/edit/delete/reorder fields and bulk-paste newline-separated field names.
- Spatial diagram canvas: pan, zoom, fit-to-content; horizontal table strips containing ordered attributes.
- Create a table directly from one or several selected source fields by clicking empty canvas; also support drag of source fields onto canvas/table.
- Create unnamed tables; names can be added/edited/removed at any time.
- Add/rename/delete/reorder/select attributes in a table; multi-selection across or within tables.
- Move and copy attribute selections to existing tables or into new tables on empty canvas, by clicks; optional drag moves by default.
- Primary-key marking (**bold and underlined**), optional marking (**superscript `o` suffix**), calculated marking (**`/` prefix**). *(Revised: calculated is a prefix, `/naam`.)*
- Create/delete single and composite foreign-key references with a click-based, two-ended selection workflow. Composite references are represented by **curly braces at both ends**.
- Context toolbar + keyboard shortcuts; clear operation state and Escape-to-cancel.
- Undo/redo covering all document edits and diagram-position changes.
- Copy rendered PNG to system clipboard; copy versioned JSON text to clipboard. **No import UI**.
- Autosave to `sessionStorage` (not localStorage) for same-tab reload recovery.
- A compact help/notation reference that describes controls, **not normalization theory or solutions**.
- Tests for editing commands, notation, rendering geometry, clipboard errors, session recovery, and essential exam workflows.

### Explicitly out of scope

- SQL generation or SQL import, database connections, ERD conversion, normalization checks or scoring.
- Auto-assignment of source fields, source-to-column traceability, unused-field warnings, completeness indicators.
- Uploading the original form, PDF/document viewing, OCR, image extraction.
- Real-time collaboration, authentication, cross-session persistence, cloud storage.
- Export/download of files (PNG/JSON/PDF/SVG) or loading files, including JSON import.
- Guaranteed clipboard compatibility with Ans; compatibility must be **tested in the actual student-answer and exam browser environment**.
- A full touchscreen-first/mobile application. Basic responsive behavior is desirable, but laptop exam use is the priority.

---

## 2. Domain model and notation

Treat the diagram as **semantically structured data**, not a collection of independently positioned text and arrow shapes. Do not assume the schema is valid or normalized.

### Visual notation (authoritative)

| Meaning | Rendered form |
|---|---|
| Table/relation | Horizontal strip of adjacent attribute cells; name optional, shown above the strip, right-aligned, in capitals |
| Primary key attribute | Attribute name **bold and underlined** |
| Optional | Superscript `o` after attribute name (not a baseline `o`, a zero, or `?`) |
| Calculated/derived | `/` prefix before attribute name |
| Optional + calculated | `/`, then the name, then superscript `o` |
| Single foreign key | A directional connector from referencing attribute to referenced attribute |
| Composite foreign key | Explicitly selected source and target attribute groups, visually bracketed by **curly braces on both ends**, with a single connector between groups |

Use real typographic or SVG styling for superscript, underline, and braces. Never treat notation suffixes as literal parts of the attribute's stored name. Do not reuse the previously proposed `NL` or `P` notation; those were incorrect for this project.

**Reference grouping:** multiple attributes at either end are selected *explicitly* by the student. The editor then renders curly braces for a composite relationship; do not infer composite references from adjacency or identical names. Reference endpoints retain **ordered attribute IDs**, so nonadjacent attributes may be represented without losing their semantic membership. The visual presentation for nonadjacent groups may use brackets spanning the selected cells; make selection/highlighting clear.

**Primary keys:** support zero, one, or multiple primary-key attributes per table. Multiple PK attributes form a composite key through individual bold-underlined names; do not assume only a single attribute may be a PK.

**Optional / calculated / PK:** model as independent flags, even if some combinations are questionable. Do not prevent a student's answer on normalization-theory grounds. Show clear rendering and avoid semantic auto-correction.

### Suggested TypeScript model

```ts
type Id = string;
type Point = { x: number; y: number };

type SourceField = { id: Id; label: string };

type Attribute = {
  id: Id;
  name: string;
  primaryKey: boolean;
  optional: boolean;
  calculated: boolean;
};

type Relation = {
  id: Id;
  name: string | null;  // null/blank means truly unnamed
  position: Point;
  attributes: Attribute[];
};

type Reference = {
  id: Id;
  from: { relationId: Id; attributeIds: Id[] }; // foreign key
  to: { relationId: Id; attributeIds: Id[] };   // referenced key
  // optional manual routing hints can be added in a later version
};

type KrijtDocument = {
  format: "krijt";
  version: 1;
  sourceFields: SourceField[];
  relations: Relation[];
  references: Reference[];
};
```

Maintain viewport zoom/pan and active operation/selection as **UI state**, separately from the document; session recovery can store both if useful. Generate stable IDs (do not tie references to names or array indices). The same source field may be copied to any number of attributes without a stored relationship to that field. No automatic reference generation.

**Reference validity:** permit only endpoints that exist, have nonempty selections, and have matching source/target group lengths. Disallow duplicate attribute IDs within an endpoint. This is structural integrity, not normalization checking. Do not require the target to be marked primary key or names to match.

---

## 3. Layout and visual style

### Desktop shell

- Compact header: **Krijt**, untitled exercise label if desired, help. *(Revised: undo/redo, zoom and clipboard actions moved into the diagram panel's header, titled **Diagram**, in the style of Kopje's panel headers.)*
- Persistent, resizable left sidebar (e.g. initial width 260–320px) titled **Form fields**. Keep inventory editing compact. *(Revised: no Dutch subtitles on panel headers.)*
- Main work area: large, pannable, zoomable canvas with whitespace; optional subtle grid. Table strips should be legible at normal zoom.
- ~~Compact tool strip~~ *(Revised: no tool strip. Every operation starts from the selection, so Select/Move/Copy/Reference tools were redundant; multi-selection is an **Add to selection** toggle in the context toolbar.)*
- Context toolbar, floating next to the selection (icon-only, with tooltips): rename, primary key, optional, calculated, reorder, move to, copy to, reference from, delete; for tables: name, add attribute, move, copy, delete; for references: delete, beside the line. Keep primary operations discoverable without relying on right-click.
- During an operation its toolbar button stays pressed; pressing it again cancels, as Escape does. *(Revised: no instruction bar; hover/focus previews on the canvas show what a click will do, and a hidden live region announces the operation for screen readers.)*
- No heavy property-inspector panel, modal-driven table builder, floating AI/help agent, or excessive chrome.

### Tables

- Horizontal sequence of bordered cells, fitted to their text with sensible minimum widths and padding; compute cell width from measured content.
- Optional name; unnamed tables have **no forced `Table 1` labels**. A subtle name affordance appears when selected/focused; table remains movable without a name.
- Each table has a visible, easy-to-hit drag handle or header area for moving the table. Do not overload cell dragging with table movement.
- Selected attributes and reference endpoints highlight clearly without obscuring the notation.
- Reordering can be achieved with click-based controls (e.g. Move left/right in context menu or keyboard), not only precise insertion dragging.
- Inline rename with Enter to commit and Escape to cancel; input focus must not trigger global shortcuts.

### Style and accessibility

- Reflect Kopje/Krash typography, spacing, neutrals, buttons, and theme where practical.
- Usable with ordinary laptop screen widths and 100% browser zoom; avoid making canvas controls too small.
- Large enough click targets; focus indicators, accessible names/tooltips, contrast, and keyboard navigation.
- Avoid using color alone to communicate selection or operation status.
- Rendered exports should be clean **black/dark-on-white**, not screenshot-like reproductions of the app chrome.

---

## 4. Interaction contract

The application has one **normal selection state** and three **one-shot operations**. Favor straightforward state machines over scattered boolean flags.

### 4.1 Inventory (sidebar)

- Add one source field by text entry; Enter adds and focuses the next entry.
- Paste a newline-separated list to populate multiple fields quickly (trim empty lines; preserve ordering; do not silently deduplicate).
- Edit, remove, and optionally reorder source fields.
- Source inventory is **just a list**, not a correctness checklist; don't track used/unassigned/omitted fields.
- Select one or more source fields, click **Copy / Place**, then click an existing table to append/insert them or empty canvas to create an unnamed table.
- Optional drag source field(s) to table/canvas performs the same **copy/placement** action; never removes source fields.
- Fields placed in tables become independent attributes; subsequent rename or deletion does not modify source inventory.

### 4.2 Default selection state

- Click cell to select; click selected cell again or use a visible control to toggle where useful.
- Provide multi-selection **by ordinary successive clicks** while an explicit multi-select/operation is active. Do not require Ctrl/Shift for essential multi-selection. *(Revised: the **Add to selection** toggle; Shift-click as an optional shortcut. A selection lies within one table; the mode ends when the selection is empty.)*
- Double-click or press Enter on selected attribute to rename; avoid having single-click both select and edit.
- Click empty canvas in normal state clears selection (does not create a table).
- Click an unnamed table's name affordance to optionally name it; names can be cleared.

### 4.3 Move

- Activate **Move** on an existing attribute selection (from one table); the next click chooses the destination. *(Revised: no separate selection step with Next.)*
- Click existing table to append; click an insertion gap/cell-edge target to choose insertion index; click empty canvas to create an unnamed table at that point.
- **Move is the default for dragging an attribute out of a table.** Source table loses moved attributes; destination gets the *same attribute IDs* where possible, preserving semantics.
- Keep selected attributes in deterministic order: table visual/document order, then attribute order (for cross-table selections). Preserve order within single-table selection.
- Remove a source table automatically if it becomes empty; undo restores it and its position.
- References stay attached to attributes through movement; update their relation IDs when an endpoint attribute moves. If moving creates an invalid mixed-relation endpoint, handle as a documented explicit rule (recommend: prevent the operation with a clear message, or ask for reference removal; do not silently corrupt or mutate a composite reference).
- On completion return to Select. Escape/cancel leaves the document unchanged.

### 4.4 Copy

- Same selection and destination flow as Move, but source attributes stay in place.
- Copies receive **new attribute IDs**, preserve name and notation flags by default, and **do not automatically inherit existing foreign-key relationships**.
- A copy into an existing table may create duplicate attribute names; allow it rather than introducing normalization-policy constraints.
- On completion return to Select.

### 4.5 Reference

- Select the referencing/foreign-key attributes (side by side) with ordinary clicks, then **Reference**.
- One click on a cell picks the referenced attributes: as many side-by-side cells as the foreign key has, starting at the clicked cell (shifted left to fit the table). Hovering previews the block with pairing numbers and the connector. *(Revised: replaces Next/Finish and per-cell target picking; ends pair left to right in table order.)*
- Source and target must each belong to one relation for v1; the counts must match. The editor may highlight why an impossible selection cannot complete, but must not check schema correctness.
- For one attribute on each side, draw one arrow. For multiple, draw **a curly-braced group at each end** with one directional arrow between the groups.
- Direction is always foreign-key group → referenced group. Use arrows and feedback to make this unambiguous.
- Once complete, return to Select. Escape/cancel clears pending selection without adding a reference.
- Selecting an existing connector enables Delete (and preferably Edit/Replace endpoints in a later milestone).
- Reference mode never depends on dragging a tiny connection handle.

### 4.6 Drag-and-drop shortcuts (optional but desirable)

- Sidebar field → blank canvas: copy into new unnamed table.
- Sidebar field → table: copy into table at drop position.
- Attribute → another table: **move** to target table.
- Attribute → blank canvas: **move** into new unnamed table.
- Table handle → canvas: reposition table.
- Dragging is implemented through the *same command operations* used by click modes. No unique semantics.
- Use an adequate movement threshold to distinguish click from drag. Don't sacrifice touchpad usability for dragging.

### 4.7 Other editing behavior

- Allow attributes to be added by typing directly in a table, independent of the inventory.
- Toggling PK / optional / calculated changes only the corresponding flag.
- Deleting an attribute deletes references that become dangling, **with a clear user-facing indication**; one undo restores the entire prior state.
- Deleting a table deletes its references in the same undoable transaction.
- Clicking a connector selects it rather than a table below it.
- Undo/redo operate on semantic edits and layout changes; group a multi-attribute move/copy and its dependent changes as **one** undo step.
- `Ctrl/Cmd+Z`, `Ctrl/Cmd+Shift+Z` (and optionally `Ctrl+Y`) work outside text inputs; never intercept native input undo while typing.

---

## 5. Diagram rendering and geometry

Use **SVG** for diagram content and connector geometry; HTML overlays/inputs may be used for editing. Keep geometry calculation independent of UI components and make it testable. Do not build the diagram as a screenshot of arbitrary DOM elements.

### Geometry responsibilities

1. Measure or estimate cell text widths using the chosen font; calculate table boundaries and per-attribute anchor points.
2. Draw table strip cells, optional labels, notation, and selection overlays.
3. Position reference endpoints based on **stable attribute IDs**, recomputing after any table movement, attribute insertion/reorder, text change, or zoom change.
4. Use simple deterministic **orthogonal connectors** as the baseline; prefer readable paths and avoid passing through attribute labels where feasible. Do not make an elaborate auto-router a prerequisite to the MVP.
5. Composite endpoint: construct braces spanning each selected group, outside the table strip, and connect between brace anchors. Handle either direction, table placement, and long/multi-column groups. Highlight member cells on selection.
6. Ensure connectors are visible and selectable (larger invisible pointer hit area than visible stroke).
7. `fitToContent` computes content bounds including **braces and connectors**, not just table rectangles.

**Routing simplification:** in v1, automatic orthogonal routing is enough; allow users to rearrange tables to improve legibility. Manual connector bend points can be deferred unless realistic test diagrams make them necessary.

**Export renderer:** render from the **same document and geometry engine** as the canvas, but with export-only presentation (no selection, no grid, no toolbar/sidebar). Use a padded white background and scale to readable resolution (e.g. 2× or a target pixel density), with maximum canvas dimension safeguards. Check superscript `o`, underline, braces, and arrowheads in output, not just onscreen.

---

## 6. Clipboard-only submission and session recovery

### 6.1 Copy as PNG (primary)

- Visible **Copy image** button, not hidden in an export menu.
- Render the complete diagram with a white background, cropped to content plus margin.
- Copy a `image/png` Blob via the browser Clipboard API (`ClipboardItem` / `navigator.clipboard.write`) **in direct response to the user's click**.
- Show success only when the browser confirms the write; show actionable error when blocked, unsupported, or rejected.
- Clipboard requires HTTPS or another secure context and may be restricted in lockdown browsers. **Do not promise Ans support without verifying a real paste into a student-answer field.**
- Do not silently fall back to downloading a file.
- Test clipboard writes in target browsers, with special attention to the actual exam browser/lockdown configuration.

### 6.2 Copy as JSON (secondary)

- Visible **Copy data** action, probably secondary in the toolbar/menu.
- Serialize a complete, versioned `KrijtDocument` to plain JSON text and copy with `navigator.clipboard.writeText` when triggered.
- The copied text can be pasted as a plain-text submission if the examination instructions permit. This is **export only**; no paste/import/restore-from-JSON UI.
- Define stable serialization order for reproducibility. No need to aggressively minify unless testing suggests Ans text limits are a problem.
- JSON may include source inventory and internal IDs; no student identities or exam metadata should be automatically collected.

### 6.3 Session recovery

- Debounced write of document + appropriate UI state to `sessionStorage` under a versioned key, after document-changing actions.
- Restore on reload in the same tab; guard against corrupt data or incompatible versions without crashing.
- Do **not** use `localStorage`, IndexedDB, cookies, or backend persistence by default.
- Provide a deliberate **New / Clear diagram** action with confirmation; ensure recovery is overwritten with the cleared state.
- Explain in minimal UI help that browser/tab closure, crash, device change, and exam environment policy can lose the session. `sessionStorage` is convenience recovery, **not durable saving**.
- No autosubmission or integration with Ans in v1.

---

## 7. Architecture and implementation guidance

Suggested stack: **TypeScript + React + Vite**, with SVG for the diagram, a small state-management layer, and browser-native clipboard/storage APIs. Choose dependencies conservatively. A generic heavyweight graph-editor framework may fight against the specialized horizontal-strip and brace notation; justify it before adopting it.

Suggested modules:

```text
src/
  app/                 shell, toolbar, sidebar, canvas layout
  model/               document types, ID generation, validators
  commands/            pure edit commands, undo/redo transactions
  state/               document state, selection, operation state machine
  geometry/            strip layout, anchor points, braces, connectors, bounds
  canvas/              SVG layers, hit targets, zoom/pan, selection
  inventory/           field entry, bulk paste, field selection
  clipboard/           PNG rendering, image/text writes, errors
  persistence/         versioned sessionStorage
  components/          compact reusable UI controls
  tests/               unit, integration, end-to-end
```

### Important engineering rules

- **Single source of truth** for `KrijtDocument`. Avoid duplicated table/attribute state between canvas and sidebar.
- Implement operations as tested pure commands (`moveAttributes`, `copyAttributes`, `addReference`, `toggleOptional`, etc.). The UI dispatches commands and does not mutate nested React state directly.
- State machine examples: `select`, `move.selecting`, `move.destination`, `copy.selecting`, `copy.destination`, `reference.selectingSource`, `reference.selectingTarget`.
- `Cancel` in an unfinished operation changes **UI state only**, not the document.
- Centralize selection ordering, target resolution, and group validation; use the same logic for click and drag paths.
- Avoid applying normalization domain rules as validation. Validate *references to actual IDs*, command preconditions, clipboard and geometry bounds.
- Keep browser API calls triggered by genuine user gestures. PNG rendering may require async work; implement clipboard interaction so it survives browser user-activation restrictions (test rather than assume).
- Feature-detect and surface errors rather than silently failing.
- No runtime telemetry, external CDNs, remote fonts, analytics, or third-party script dependencies. Bundle required assets; ensure the deployed app works after initial loading without contacting services. Consider a service worker/offline asset caching only if it can be tested reliably in the exam environment; no external runtime dependency.
- Preserve user content verbatim where possible; escape names as text in SVG/HTML (no raw HTML injection).

---

## 8. Implementation milestones

Each milestone should produce a runnable build, relevant tests, and a short manual demo scenario. Prefer vertical slices over a large unfinished framework.

### Milestone 1 — Shell, model, inventory, basic tables

- Vite/React/TypeScript project, visual baseline inspired by Kopje/Krash.
- `KrijtDocument` model and simple command dispatcher.
- Sidebar: single entry, bulk paste, edit/delete source fields.
- SVG canvas: render and position unnamed/named horizontal table strips.
- Click-to-place selected source fields into a new or existing table; direct typed attributes.
- Basic selection and table movement; `sessionStorage` persistence.

**Acceptance:** A student can paste 12 source fields and, with clicks alone, construct an initial unnamed table from a subset.

### Milestone 2 — Attribute manipulations and notation

- Attribute editing, delete, ordering, multi-selection, selection indications.
- Move/Copy one-shot modes, destination previews, new table creation on empty canvas.
- Composite PK markings, optional superscript `o`, calculated `/`.
- Robust command history + undo/redo.
- Optional drag-and-drop for source fields/attributes and table handles.

**Acceptance:** Split a 10-attribute table into three tables, copy an attribute back into another table, and undo/redo each change, without dragging.

### Milestone 3 — References and geometry

- Source/target selection with Escape. *(Revised: Reference on the selection, then one click on the referenced block.)*
- Single reference connectors and composite curly-brace endpoints.
- Reference selection/deletion; references update when cells or tables move.
- Orthogonal geometry and proper export bounds; sensible errors for impossible structural operations.

**Acceptance:** Construct a diagram with one simple and one two-column composite foreign key; both remain attached after moving/reordering tables and attributes.

### Milestone 4 — Clipboard export and exam hardening

- High-quality PNG renderer and actual clipboard image write.
- JSON text clipboard copy and versioned serialization.
- Recovery edge cases, clear/reset, accessibility and keyboard behavior.
- Browser testing, especially clipboard in the target exam setup; tests for unsupported/blocked clipboard.
- Optimize interaction responsiveness with moderately sized diagrams.

**Acceptance:** Complete a realistic normalization exercise entirely by clicks, copy the diagram as PNG, paste into a supported destination, and verify that all notation is legible; reload recovers the work.

### Milestone 5 — Polish only after real usage tests

- Improve reference routing if crossings are genuinely problematic.
- Refine table/cell insertion affordances and multiple-selection interactions.
- Audit sidebar/canvas width behavior on smaller laptop screens.
- Improve contextual instructions without introducing correctness hints.

---

## 9. Test scenarios / acceptance checklist

Automate command/geometry behavior and use browser end-to-end tests for workflows.

1. **Inventory:** Paste lines with blank lines, duplicates, diacritics, and long field names; preserve deliberate duplicates and display them safely.
2. **Create table:** Select one source field, place on empty canvas → new unnamed table. Select multiple fields → new table with preserved order.
3. **Add to table:** Select source fields and click an existing table → attributes appended/inserted; inventory unchanged.
4. **Move default:** Move two attributes from a populated table to empty canvas → exactly one new table; source attributes removed; original order preserved.
5. **Copy:** Copy an attribute to a second table → both attributes exist with different IDs, same display flags, no automatic reference.
6. **No drag required:** Execute scenarios 2–5 without any pointer drag or modifier key.
7. **Notation:** Correct bold/underline for PK, superscript `o` for optional, `/` for calculated, and combined flags both onscreen and in PNG.
8. **Unnamed relations:** Creating a table does not prompt for name; name can be supplied/cleared later; no generated visible `Table 1`.
9. **Simple reference:** Reference foreign-key attribute → referenced attribute; correct direction; survives table movement.
10. **Composite reference:** Explicitly select two source and two target attributes; visible braces at **both ends**, single connecting arrow; order preserved in document.
11. **Reference edits:** Deleting a referenced attribute/table removes or handles dependent references as specified, with undo restoring entire state.
12. **Undo/redo:** Multi-attribute move, copy, table creation, marking changes, and reference creation are each sensible atomic history actions.
13. **Selection robustness:** Escape cancels all pending modes with no document mutation; unfinished reference cannot be accidentally committed.
14. **Keyboard input:** Typing names never accidentally triggers shortcuts; Enter/Escape semantics behave consistently.
15. **Clipboard PNG:** PNG is content-cropped, crisp, opaque white, correct geometry and notation, and no selected-state UI. Browser rejection shows error and does not claim success.
16. **Clipboard JSON:** Valid versioned JSON matching current document, no UI-only ephemeral state unless intentionally specified.
17. **Persistence:** Reload same tab restores document; clearing creates an empty recovered state; corrupt or old session data does not crash.
18. **Exam constraints:** No accounts, tracking, runtime web calls, file pickers/downloads, normalization hints, SQL tools, or JSON import.
19. **Performance:** For a realistic exam diagram (e.g. 15–25 source fields, 5–10 relations, 10+ references), pointer interactions and mode transitions remain responsive.
20. **Ans test (manual, release gate):** Using the intended student-answer type and locked-down browser, verify a real PNG clipboard paste. If blocked, report the limitation; do not invent a bypass or reintroduce downloads without a deliberate requirement change.

---

## 10. Ambiguities resolved as defaults

The agent should implement these defaults and document any deviations rather than stopping for minor clarification:

- **Move is default** for dragging existing attributes; copying is an explicit tool.
- **Source inventory is never consumed.** Source-field placement always creates independent attribute copies.
- **Selection → command → destination** and **command → selection → destination** are both supported where feasible.
- **One-shot modes**: every completed Move/Copy/Reference returns to Select.
- **Empty table deletion**: after its last attribute is moved or deleted, remove it automatically (undoable).
- **Table naming optional**, including at export time.
- **Composite references**: students select endpoint members explicitly; visual braces follow from those group selections.
- **No normalization assistance**, including subtle hints such as used-field counts, key recommendations, or schema warnings.
- **No import**, including pasted JSON and file loading; clipboard JSON is for submission/inspection only.
- **Clipboard-only output**, no downloads even as fallback. PNG first, JSON second.
- **Autosave is session-scoped**, and not presented as permanent exam protection.

---

## 11. First task for the coding agent

1. Read this plan fully and inspect the repository, if present.
2. If Kopje/Krash source/design files are available in the project, extract reusable styling conventions; otherwise use the websites as broad visual references without copying assets or inferring undocumented architecture.
3. Implement **Milestone 1 only**, including tests and a runnable app.
4. Describe the proposed document/command/state organization briefly in the README, including any justified deviations from this plan.
5. Demonstrate the first acceptance scenario and identify any open implementation risks for Milestone 2.

Do not implement SQL generation, normalization feedback, data import, or a backend. Do not optimize the reference router before the foundational editor works.
