/**
 * Resolves canvas clicks (and drops) into one action, depending on the active
 * operation. Clicks, keyboard activation and drag-and-drop share this logic,
 * so they can never mean different things.
 */
import {
  copyAttributes,
  moveAttributes,
  orderedFieldLabels,
  placeNames,
  toDestination,
  type DestinationIntent,
} from '../commands/builders'
import type { Id, KrijtDocument, Point } from '../model/types'
import { METRICS } from '../geometry/layout'
import { NO_SELECTION, SELECT, selectedAttributeIds, type Action, type AppState, type Selection } from './appState'

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
  if (target.kind === 'empty') return { kind: 'newTable', position: newTablePosition(point) }
  const r = doc.relations.find((x) => x.id === target.relationId)
  if (!r) return null
  if (target.kind === 'attribute') {
    const i = r.attributes.findIndex((a) => a.id === target.attributeId)
    if (i < 0) return null
    return { kind: 'table', relationId: r.id, index: target.side === 'before' ? i : i + 1 }
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
    return { type: 'command', command, after: { operation: SELECT, selection: { kind: 'attributes', attributeIds: [...attributeIds] } } }
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

/** The one-line instruction shown while an operation is active. */
export function operationInstruction(state: AppState): string | null {
  const op = state.ui.operation
  if (op.kind === 'place') {
    const count = state.ui.selectedFieldIds.length
    if (count === 0) return 'Select form fields in the sidebar, then click a table to add them or empty canvas for a new table.'
    return `Click a table to add ${count === 1 ? 'the field' : `${count} fields`}, or click empty canvas to create a new table.`
  }
  if (op.kind === 'moveTable') return 'Click on the canvas where the table should go.'
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
