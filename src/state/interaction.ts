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
import { expandToUnits, orderAttributeIds, referenceBlocks, referenceProblem, snapIndex } from '../commands/commands'
import type { Id, KrijtDocument, Point, Reference, ReferenceEnd } from '../model/types'
import { METRICS } from '../geometry/layout'
import { attributeOwners, commonRelation, NO_SELECTION, SELECT, selectedAttributeIds, type Action, type AppState } from './appState'

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
  // Form fields follow the name rules (see names.ts), so their labels are the attribute names.
  const names = orderedFieldLabels(state.doc, fieldIds)
  if (names.length === 0) return null
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

/**
 * The referenced attributes a click on `attributeId` stands for while creating a reference from `source`:
 * that many side-by-side cells, starting at the clicked one and shifted left where needed to fit the table.
 * Null if the table has too few attributes (the cell is not in a table, or there is no source).
 */
export function referenceBlock(doc: KrijtDocument, source: Id[], attributeId: Id): Id[] | null {
  const need = source.length
  const r = doc.relations.find((x) => x.attributes.some((a) => a.id === attributeId))
  if (!r || need === 0 || r.attributes.length < need) return null
  const i = r.attributes.findIndex((a) => a.id === attributeId)
  const start = Math.min(i, r.attributes.length - need)
  return r.attributes.slice(start, start + need).map((a) => a.id)
}

/** The reference a click on `attributeId` would create, or why it cannot. */
export function referenceIntent(state: AppState, attributeId: Id): { from: ReferenceEnd; to: ReferenceEnd } | { problem: string } | null {
  const op = state.ui.operation
  if (op.kind !== 'reference') return null
  const { doc } = state
  const block = referenceBlock(doc, op.source, attributeId)
  if (!block) {
    const r = doc.relations.find((x) => x.attributes.some((a) => a.id === attributeId))
    if (!r) return null
    return { problem: `This table has only ${n(r.attributes.length, 'attribute')}; the foreign key has ${op.source.length}.` }
  }
  const owner = attributeOwners(doc)
  const from: ReferenceEnd = { relationId: owner.get(op.source[0]!) ?? '', attributeIds: orderAttributeIds(doc, op.source) }
  const to: ReferenceEnd = { relationId: owner.get(block[0]!) ?? '', attributeIds: block }
  const problem = referenceProblem(doc, from, to)
  return problem ? { problem } : { from, to }
}

/** Creating the reference for a click on a cell (needs a fresh ID, so it is resolved here, not in the reducer). */
export function referenceAction(state: AppState, attributeId: Id): Action | null {
  const intent = referenceIntent(state, attributeId)
  if (!intent) return null
  // An impossible target is not highlighted and shows a not-allowed cursor; clicking it does nothing.
  if ('problem' in intent) return null
  const command = addReference(intent.from, intent.to)
  if (command.type !== 'addReference') return null
  return {
    type: 'command',
    command,
    after: { operation: SELECT, selection: { kind: 'reference', referenceId: command.reference.id } },
  }
}

/** `additive`: a Shift-click, which adds to or removes from the selection like the "Add to selection" mode. */
export function resolveCanvasClick(state: AppState, target: CanvasTarget, point: Point, additive = false): Action | null {
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

  if (op.kind === 'copyTable') {
    // Any click places the copy, as Move table does: all attributes (with their notation), no name, no references.
    const r = state.doc.relations.find((x) => x.id === op.relationId)
    if (!r) return null
    const destination = toDestination({ kind: 'newTable', position: newTablePosition(point) })
    const copy = copyAttributes(state.doc, r.attributes.map((a) => a.id), destination)
    if (!copy) return null
    return { type: 'command', command: copy.command, after: { operation: SELECT, selection: { kind: 'relation', relationId: destination.relationId } } }
  }

  if (op.kind === 'reference') {
    // Only cells count, so a stray click on a header or empty canvas loses nothing.
    return target.kind === 'attribute' ? referenceAction(state, target.attributeId) : null
  }

  if (op.kind === 'move' || op.kind === 'copy') return transferAction(state, op.kind, selectedAttributeIds(ui), target, point)

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
      const ids = selectedAttributeIds(ui)
      // Adding works within the selected table; a cell in another table starts a new selection there.
      const sameTable = ids.length > 0 && commonRelation(state.doc, [...ids, target.attributeId]) !== null
      if ((ui.multiSelect || additive) && sameTable) {
        const next = ids.includes(target.attributeId) ? ids.filter((id) => id !== target.attributeId) : [...ids, target.attributeId]
        return { type: 'ui', patch: { selection: next.length ? { kind: 'attributes', attributeIds: next } : NO_SELECTION, message: null } }
      }
      if (!sameTable && ids.length > 0)
        return { type: 'ui', patch: { selection: { kind: 'attributes', attributeIds: [target.attributeId] }, multiSelect: false, message: null } }
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
  if (op.kind === 'move' || op.kind === 'copy') return op.kind
  return null
}

const n = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`

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

/**
 * A short announcement of the active operation for screen readers. Sighted users see the pressed button and the
 * canvas previews instead.
 */
export function operationAnnouncement(state: AppState): string | null {
  const op = state.ui.operation
  if (op.kind === 'place') {
    const count = state.ui.selectedFieldIds.length
    if (count === 0) return 'Place in diagram: select form fields first.'
    return `Place ${n(count, 'field')}: choose a table, or empty canvas for a new table.`
  }
  if (op.kind === 'moveTable') return 'Move table: choose where it should go.'
  if (op.kind === 'copyTable') return 'Copy table: choose where the copy should go.'
  if (op.kind === 'reference') return `Reference from ${n(op.source.length, 'attribute')}: choose the referenced ${op.source.length === 1 ? 'attribute' : 'attributes'}.`
  if (op.kind === 'move' || op.kind === 'copy') {
    const verb = op.kind === 'move' ? 'Move' : 'Copy'
    return `${verb} ${n(selectedAttributeIds(state.ui).length, 'attribute')}: choose a destination.`
  }
  return null
}
