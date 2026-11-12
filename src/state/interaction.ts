/**
 * Resolves canvas clicks (and drops) into one action, depending on the active
 * operation. Clicks, keyboard activation and drag-and-drop share this logic,
 * so they can never mean different things.
 */
import {
  addReference,
  copyAttributes,
  moveAttributes,
  orderedFieldLabels,
  placeNames,
  toDestination,
  type DestinationIntent,
} from '../commands/builders'
import { expandToUnits, referenceBlocks, referenceProblem, snapIndex } from '../commands/commands'
import type { Id, KrijtDocument, Point, Reference, ReferenceEnd } from '../model/types'
import { METRICS } from '../geometry/layout'
import { commonRelation, NO_SELECTION, SELECT, selectedAttributeIds, type Action, type AppState, type Selection } from './appState'

export type CanvasTarget =
  | { kind: 'empty' }
  /** The table's header band (handle / name). */
  | { kind: 'relation'; relationId: Id }
  /** The name (or "Add name" affordance) of a selected table. */
  | { kind: 'relationName'; relationId: Id }
  /** A cell; `side` says which half was hit, for choosing an insertion point. */
  | { kind: 'attribute'; relationId: Id; attributeId: Id; side?: 'before' | 'after' }
  /** The "+" cell after a table's last attribute. */
  | { kind: 'addCell'; relationId: Id }
  /** A reference's connector or brace. */
  | { kind: 'reference'; referenceId: Id }

/** Where a new table goes for a click at `point`: the click lands mid-height at the strip's left edge. */
export function newTablePosition(point: Point): Point {
  return { x: Math.round(point.x), y: Math.round(point.y - METRICS.cellHeight / 2) }
}

export const NO_FIELDS_MESSAGE = 'Select one or more form fields in the sidebar first.'

/**
 * The destination a click on `target` stands for: before/after a cell,
 * the end of a table (header or + cell), or a new table on empty canvas.
 */
export function destinationFor(doc: KrijtDocument, target: CanvasTarget, point: Point): DestinationIntent | null {
  // Connectors do not take part in destinations (the canvas makes them click-through then); treat one as empty canvas.
  if (target.kind === 'empty' || target.kind === 'reference') return { kind: 'newTable', position: newTablePosition(point) }
  const r = doc.relations.find((x) => x.id === target.relationId)
  if (!r) return null
  if (target.kind === 'attribute') {
    const i = r.attributes.findIndex((a) => a.id === target.attributeId)
    if (i < 0) return null
    // Never between the members of a reference end: snap to the nearer edge (the preview shows where).
    return { kind: 'table', relationId: r.id, index: snapIndex(referenceBlocks(doc, r.id), target.side === 'before' ? i : i + 1) }
  }
  return { kind: 'table', relationId: r.id, index: r.attributes.length }
}

/** Placing the selected source fields at a target. Shared by Place mode and sidebar drops. */
export function placeAction(state: AppState, fieldIds: Id[], target: CanvasTarget, point: Point): Action | null {
  const names = orderedFieldLabels(state.doc, fieldIds)
  if (names.length === 0) return { type: 'ui', patch: { message: { kind: 'error', text: NO_FIELDS_MESSAGE } } }
  const intent = destinationFor(state.doc, target, point)
  if (!intent) return null
  const destination = toDestination(intent)
  const command = placeNames(names, destination)
  if (!command) return null
  return {
    type: 'command',
    command,
    after: { operation: SELECT, selectedFieldIds: [], selection: { kind: 'relation', relationId: destination.relationId }, editing: null },
  }
}

/** Moving or copying attributes to a target. Shared by Move/Copy modes and attribute drops. */
export function transferAction(state: AppState, kind: 'move' | 'copy', attributeIds: Id[], target: CanvasTarget, point: Point): Action | null {
  if (attributeIds.length === 0) return null
  const intent = destinationFor(state.doc, target, point)
  if (!intent) return null
  const destination = toDestination(intent)
  if (kind === 'move') {
    const command = moveAttributes(attributeIds, destination)
    if (!command) return null
    // Reference ends move as units; select everything that moved.
    const moved = expandToUnits(state.doc, attributeIds)
    return { type: 'command', command, after: { operation: SELECT, selection: { kind: 'attributes', attributeIds: moved } } }
  }
  const copy = copyAttributes(state.doc, attributeIds, destination)
  if (!copy) return null
  return { type: 'command', command: copy.command, after: { operation: SELECT, selection: { kind: 'attributes', attributeIds: copy.newIds } } }
}

function toggled(selection: Selection, attributeId: Id): Selection {
  const ids = selection.kind === 'attributes' ? selection.attributeIds : []
  const next = ids.includes(attributeId) ? ids.filter((id) => id !== attributeId) : [...ids, attributeId]
  return next.length ? { kind: 'attributes', attributeIds: next } : NO_SELECTION
}

export function resolveCanvasClick(state: AppState, target: CanvasTarget, point: Point): Action | null {
  const { ui } = state
  const op = ui.operation

  if (op.kind === 'place') return placeAction(state, ui.selectedFieldIds, target, point)

  if (op.kind === 'moveTable') {
    // Any click sets the new position; the table's strip goes where the click was.
    return {
      type: 'command',
      command: { type: 'moveRelation', relationId: op.relationId, position: newTablePosition(point) },
      after: { operation: SELECT },
    }
  }

  if (op.kind === 'reference') {
    // Only cells count, so a stray click on a header or empty canvas loses nothing.
    return target.kind === 'attribute' ? { type: 'pickReferenceAttribute', attributeId: target.attributeId } : null
  }

  if (op.kind === 'move' || op.kind === 'copy') {
    if (op.phase === 'destination') return transferAction(state, op.kind, selectedAttributeIds(ui), target, point)
    // Selecting: plain clicks add or remove cells. Anything else does nothing, so a stray click loses nothing.
    if (target.kind === 'attribute') return { type: 'toggleAttribute', attributeId: target.attributeId }
    return null
  }

  // Normal selection state.
  switch (target.kind) {
    case 'empty':
      return { type: 'ui', patch: { selection: NO_SELECTION, editing: null, message: null } }
    case 'relation':
      return { type: 'ui', patch: { selection: { kind: 'relation', relationId: target.relationId }, message: null } }
    case 'reference':
      return { type: 'ui', patch: { selection: { kind: 'reference', referenceId: target.referenceId }, editing: null, message: null } }
    case 'relationName': {
      // Only a table that is already selected shows its name affordance; the first click selects.
      const selected = ui.selection.kind === 'relation' && ui.selection.relationId === target.relationId
      return {
        type: 'ui',
        patch: {
          selection: { kind: 'relation', relationId: target.relationId },
          editing: selected ? { kind: 'relationName', relationId: target.relationId } : ui.editing,
          message: null,
        },
      }
    }
    case 'attribute': {
      if (ui.multiSelect) return { type: 'ui', patch: { selection: toggled(ui.selection, target.attributeId), message: null } }
      const ids = selectedAttributeIds(ui)
      const again = ids.length === 1 && ids[0] === target.attributeId
      return {
        type: 'ui',
        patch: { selection: again ? NO_SELECTION : { kind: 'attributes', attributeIds: [target.attributeId] }, message: null },
      }
    }
    case 'addCell':
      return {
        type: 'ui',
        patch: {
          selection: { kind: 'relation', relationId: target.relationId },
          editing: { kind: 'newAttribute', relationId: target.relationId },
          message: null,
        },
      }
  }
}

/** Whether clicks on the canvas currently choose a destination (for previews). */
export function choosingDestination(state: AppState): 'place' | 'move' | 'copy' | null {
  const op = state.ui.operation
  if (op.kind === 'place') return state.ui.selectedFieldIds.length > 0 ? 'place' : null
  if ((op.kind === 'move' || op.kind === 'copy') && op.phase === 'destination') return op.kind
  return null
}

const n = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`

/**
 * What Next / Finish (and Enter) does in the active operation, or null if it has no next step.
 * Finishing a reference needs a fresh ID, so it is resolved here rather than in the reducer.
 */
export function nextStepAction(state: AppState): Action | null {
  const op = state.ui.operation
  if ((op.kind === 'move' || op.kind === 'copy') && op.phase === 'selecting') return { type: 'next' }
  if (op.kind !== 'reference') return null
  if (op.phase === 'source') return { type: 'next' }
  const fromTable = commonRelation(state.doc, op.source)
  const toTable = commonRelation(state.doc, op.target)
  const from: ReferenceEnd = { relationId: fromTable ?? '', attributeIds: op.source }
  const to: ReferenceEnd = { relationId: toTable ?? '', attributeIds: op.target }
  const problem =
    op.target.length > 0 && op.target.length < op.source.length
      ? `Select ${n(op.source.length, 'referenced attribute')} (${op.target.length} selected).`
      : referenceProblem(state.doc, from, to)
  if (problem) return { type: 'ui', patch: { message: { kind: 'error', text: problem } } }
  const command = addReference(from, to)
  if (command.type !== 'addReference') return null
  return {
    type: 'command',
    command,
    after: { operation: SELECT, selection: { kind: 'reference', referenceId: command.reference.id } },
  }
}

/** Whether Finish can complete the reference now (for enabling the button). */
export function referenceReady(state: AppState): boolean {
  const op = state.ui.operation
  return op.kind === 'reference' && op.phase === 'target' && op.target.length > 0 && op.target.length === op.source.length
}

function tableName(doc: KrijtDocument, relationId: Id): string {
  const r = doc.relations.find((x) => x.id === relationId)
  return r?.name ?? 'unnamed table'
}

function endNames(doc: KrijtDocument, end: ReferenceEnd): string {
  const names = new Map<Id, string>()
  for (const r of doc.relations) for (const a of r.attributes) names.set(a.id, a.name || '(no name)')
  return end.attributeIds.map((id) => names.get(id) ?? '?').join(', ')
}

/** A readable description, e.g. "Bestelling (klantnr) → Klant (klantnr)". */
export function describeReference(doc: KrijtDocument, ref: Reference): { from: string; to: string } {
  return {
    from: `${tableName(doc, ref.from.relationId)} (${endNames(doc, ref.from)})`,
    to: `${tableName(doc, ref.to.relationId)} (${endNames(doc, ref.to)})`,
  }
}

/** The one-line instruction shown while an operation is active. */
export function operationInstruction(state: AppState): string | null {
  const op = state.ui.operation
  if (op.kind === 'place') {
    const count = state.ui.selectedFieldIds.length
    if (count === 0) return 'Select form fields in the sidebar, then click a table to add them or empty canvas for a new table.'
    return `Click a table to add ${count === 1 ? 'the field' : `${count} fields`}, or click empty canvas to create a new table.`
  }
  if (op.kind === 'moveTable') return 'Click on the canvas where the table should go.'
  if (op.kind === 'reference') {
    if (op.phase === 'source') {
      if (op.source.length === 0) return 'Click the foreign-key attribute (or several side by side) that refers to another attribute, then choose Next.'
      const table = commonRelation(state.doc, op.source)
      const where = table ? ` in ${tableName(state.doc, table)}` : ''
      return `Foreign key: ${n(op.source.length, 'attribute')}${where}. Click more to add or remove, then choose Next.`
    }
    const need = op.source.length
    if (need === 1)
      return op.target.length === 0 ? 'Click the attribute the foreign key refers to, then choose Finish.' : 'Choose Finish, or click the selected cell to undo the choice.'
    return op.target.length < need
      ? `Click the ${need} side-by-side attributes it refers to (they pair up left to right): ${op.target.length} of ${need} chosen.`
      : `All ${need} chosen. Choose Finish, or click a selected cell to remove it.`
  }
  if (op.kind === 'move' || op.kind === 'copy') {
    const count = selectedAttributeIds(state.ui).length
    const verb = op.kind === 'move' ? 'move' : 'copy'
    if (op.phase === 'selecting')
      return count === 0
        ? `Click the attributes to ${verb}, then choose Next.`
        : `${n(count, 'attribute')} selected. Click more to add or remove, then choose Next.`
    return `Click a table or a cell edge to ${verb} ${count === 1 ? 'the attribute' : `${count} attributes`} there, or click empty canvas for a new table.`
  }
  return null
}
