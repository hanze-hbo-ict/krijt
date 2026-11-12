/**
 * Resolves a click on the canvas into one action, depending on the active
 * operation. Click paths and (from Milestone 2) drag paths share this logic,
 * so the two can never mean different things.
 */
import { addAttributesFromNames, createRelationFromNames, orderedFieldLabels } from '../commands/builders'
import type { Id, Point } from '../model/types'
import { METRICS } from '../geometry/layout'
import { SELECT, type Action, type AppState } from './appState'

export type CanvasTarget =
  | { kind: 'empty' }
  /** The table's header band (handle / name). */
  | { kind: 'relation'; relationId: Id }
  /** The name (or "Add name" affordance) of a selected table. */
  | { kind: 'relationName'; relationId: Id }
  | { kind: 'attribute'; relationId: Id; attributeId: Id }
  /** The "+" cell after a table's last attribute. */
  | { kind: 'addCell'; relationId: Id }

const targetRelation = (t: CanvasTarget): Id | null => (t.kind === 'empty' ? null : t.relationId)

/** Where a new table goes for a click at `point`: the click lands mid-height at the strip's left edge. */
export function newTablePosition(point: Point): Point {
  return { x: Math.round(point.x), y: Math.round(point.y - METRICS.cellHeight / 2) }
}

export const NO_FIELDS_MESSAGE = 'Select one or more form fields in the sidebar first.'

export function resolveCanvasClick(state: AppState, target: CanvasTarget, point: Point): Action | null {
  const { doc, ui } = state
  const op = ui.operation

  if (op.kind === 'place') {
    const names = orderedFieldLabels(doc, ui.selectedFieldIds)
    if (names.length === 0) return { type: 'ui', patch: { message: { kind: 'error', text: NO_FIELDS_MESSAGE } } }
    const relationId = targetRelation(target)
    const command = relationId ? addAttributesFromNames(relationId, names) : createRelationFromNames(names, newTablePosition(point))
    if (!command) return null
    const placedIn = command.type === 'createRelation' ? command.relation.id : relationId!
    return {
      type: 'command',
      command,
      after: { operation: SELECT, selectedFieldIds: [], selection: { kind: 'relation', relationId: placedIn }, editing: null },
    }
  }

  if (op.kind === 'moveTable') {
    // Any click sets the new position; the table's strip goes where the click was.
    return {
      type: 'command',
      command: { type: 'moveRelation', relationId: op.relationId, position: newTablePosition(point) },
      after: { operation: SELECT },
    }
  }

  // Normal selection state.
  switch (target.kind) {
    case 'empty':
      return { type: 'ui', patch: { selection: { kind: 'none' }, editing: null, message: null } }
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
      const sel = ui.selection
      const again = sel.kind === 'attribute' && sel.attributeId === target.attributeId
      return {
        type: 'ui',
        patch: {
          selection: again ? { kind: 'none' } : { kind: 'attribute', relationId: target.relationId, attributeId: target.attributeId },
          message: null,
        },
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

/** The one-line instruction shown while an operation is active. */
export function operationInstruction(state: AppState): string | null {
  const op = state.ui.operation
  if (op.kind === 'place') {
    const n = state.ui.selectedFieldIds.length
    if (n === 0) return 'Select form fields in the sidebar, then click a table to add them or empty canvas for a new table.'
    return `Click a table to add ${n === 1 ? 'the field' : `${n} fields`}, or click empty canvas to create a new table.`
  }
  if (op.kind === 'moveTable') return 'Click on the canvas where the table should go.'
  return null
}
