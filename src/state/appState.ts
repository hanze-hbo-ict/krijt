/**
 * Application state: the document (single source of truth), its undo history,
 * and UI state.
 *
 * UI state is an explicit state machine: the normal `select` operation and
 * one-shot operations that return to `select` when they complete or are
 * cancelled. Cancelling changes UI state only, never the document.
 *
 * The reducer is pure. Anything that needs fresh IDs (building commands) is
 * resolved before dispatch, in interaction.ts.
 */
import { applyCommand, isContiguous, REFERENCE_ADJACENT_ERROR, type Command } from '../commands/commands'
import type { Id, KrijtDocument } from '../model/types'
import { emptyDocument } from '../model/types'
import { DEFAULT_VIEWPORT, type Viewport } from '../geometry/viewport'

export type Selection =
  | { kind: 'none' }
  | { kind: 'relation'; relationId: Id }
  /** Attributes in click order, possibly from several tables. */
  | { kind: 'attributes'; attributeIds: Id[] }
  | { kind: 'reference'; referenceId: Id }

export type Phase = 'selecting' | 'destination'

export type Operation =
  | { kind: 'select' }
  /** Copy the selected source fields into a table or onto empty canvas. */
  | { kind: 'place' }
  /** Click-based table movement: the next click on the canvas is the new position. */
  | { kind: 'moveTable'; relationId: Id }
  /** Move attributes: select them (clicks toggle), Next, then click a destination. */
  | { kind: 'move'; phase: Phase }
  /** Copy attributes: as Move, but the originals stay and copies get new IDs. */
  | { kind: 'copy'; phase: Phase }
  /**
   * Create a reference: click the foreign-key attributes (side by side in one table), Next, click the referenced
   * attributes (side by side in one table, same number), Finish. Lists are in click order while picking; the
   * reference pairs them left to right in table order.
   */
  | { kind: 'reference'; phase: ReferencePhase; source: Id[]; target: Id[] }

export type ReferencePhase = 'source' | 'target'

export type Editing =
  | null
  | { kind: 'relationName'; relationId: Id }
  | { kind: 'newAttribute'; relationId: Id }
  | { kind: 'attributeName'; attributeId: Id }

export type Message = { kind: 'error' | 'info'; text: string }

export type UiState = {
  operation: Operation
  selection: Selection
  /** In the normal state, clicks on cells add to / remove from the selection instead of replacing it. */
  multiSelect: boolean
  /** Selected source fields, in click order (placement uses inventory order). */
  selectedFieldIds: Id[]
  editing: Editing
  viewport: Viewport
  sidebarWidth: number
  message: Message | null
}

export type History = {
  past: KrijtDocument[]
  future: KrijtDocument[]
  /** Consecutive commands with the same key (e.g. arrow-key nudges of one table) form one step. */
  coalesceKey: string | null
}

export type AppState = { doc: KrijtDocument; ui: UiState; history: History }

export const SIDEBAR_MIN = 200
export const SIDEBAR_MAX = 480
export const SIDEBAR_DEFAULT = 280
export const HISTORY_LIMIT = 200

export const NO_SELECTION: Selection = { kind: 'none' }
export const SELECT: Operation = { kind: 'select' }
const EMPTY_HISTORY: History = { past: [], future: [], coalesceKey: null }

export function initialUi(): UiState {
  return {
    operation: SELECT,
    selection: NO_SELECTION,
    multiSelect: false,
    selectedFieldIds: [],
    editing: null,
    viewport: DEFAULT_VIEWPORT,
    sidebarWidth: SIDEBAR_DEFAULT,
    message: null,
  }
}

export function initialState(doc: KrijtDocument = emptyDocument(), ui: Partial<UiState> = {}): AppState {
  return { doc, ui: { ...initialUi(), ...ui }, history: EMPTY_HISTORY }
}

export type Action =
  /** Apply a document command; on success also apply `after` to the UI state. */
  | { type: 'command'; command: Command; after?: Partial<UiState>; coalesceKey?: string }
  | { type: 'ui'; patch: Partial<UiState> }
  | { type: 'toggleField'; fieldId: Id }
  | { type: 'toggleAttribute'; attributeId: Id }
  | { type: 'startPlace' }
  | { type: 'startMoveTable'; relationId: Id }
  /**
   * Start Move/Copy. From the tool strip (`fromSelection` false) it starts empty: select, then Next.
   * From the selection's "Move to… / Copy to…" it uses the current selection and goes straight to the destination.
   */
  | { type: 'startAttributes'; kind: 'move' | 'copy'; fromSelection?: boolean }
  /** Move/Copy: finish selecting and choose a destination. Reference: finish the foreign key, choose referenced attributes. */
  | { type: 'next' }
  /** Reference: back from the referenced attributes to the foreign key. */
  | { type: 'back' }
  /**
   * Start Reference. From the tool strip it starts empty; from the selection's "Reference from…" the selected
   * attributes become the foreign key and, if they lie in one table, it goes straight to step 2.
   */
  | { type: 'startReference'; fromSelection?: boolean }
  /** Reference: a click on a cell adds it to (or removes it from) the end being chosen. */
  | { type: 'pickReferenceAttribute'; attributeId: Id }
  /** Escape / Cancel: close an edit, end the operation, or clear the selection. */
  | { type: 'cancel' }
  | { type: 'undo' }
  | { type: 'redo' }

export const clampSidebar = (w: number) => Math.round(Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, w)))

export function selectedAttributeIds(ui: UiState): Id[] {
  return ui.selection.kind === 'attributes' ? ui.selection.attributeIds : []
}

export const NO_ATTRIBUTES_MESSAGE = 'Select one or more attributes first.'
export const NO_SOURCE_MESSAGE = 'Click the foreign-key attributes first.'
export const SOURCE_ONE_TABLE_MESSAGE =
  'The foreign-key attributes must all be in one table. Click a selected cell to remove it, or Cancel to start again.'
export const TARGET_ONE_TABLE_MESSAGE =
  'The referenced attributes must all be in one table. Click a selected cell to remove it, or Back to change the foreign key.'
export const TARGET_IS_SOURCE_MESSAGE = 'That attribute is part of the foreign key. Click the attributes it refers to.'

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

/** The table that owns each attribute. */
export function attributeOwners(doc: KrijtDocument): Map<Id, Id> {
  const owner = new Map<Id, Id>()
  for (const r of doc.relations) for (const a of r.attributes) owner.set(a.id, r.id)
  return owner
}

/** The single table holding all of `ids`, or null if they span several (or none). */
export function commonRelation(doc: KrijtDocument, ids: Id[]): Id | null {
  const owner = attributeOwners(doc)
  const tables = new Set(ids.map((id) => owner.get(id)))
  if (tables.size !== 1) return null
  return [...tables][0] ?? null
}

/** Drops UI references to things the document no longer has. */
export function reconcileUi(doc: KrijtDocument, ui: UiState): UiState {
  const relationIds = new Set(doc.relations.map((r) => r.id))
  const attributeIds = new Set(doc.relations.flatMap((r) => r.attributes.map((a) => a.id)))
  const fieldIds = new Set(doc.sourceFields.map((f) => f.id))
  let { selection, operation, editing } = ui
  if (selection.kind === 'relation' && !relationIds.has(selection.relationId)) selection = NO_SELECTION
  if (selection.kind === 'attributes') {
    const kept = selection.attributeIds.filter((id) => attributeIds.has(id))
    if (kept.length !== selection.attributeIds.length) selection = kept.length ? { kind: 'attributes', attributeIds: kept } : NO_SELECTION
  }
  if (selection.kind === 'reference') {
    const id = selection.referenceId
    if (!doc.references.some((r) => r.id === id)) selection = NO_SELECTION
  }
  if (operation.kind === 'moveTable' && !relationIds.has(operation.relationId)) operation = SELECT
  if (operation.kind === 'reference') {
    const source = operation.source.filter((id) => attributeIds.has(id))
    const target = operation.target.filter((id) => attributeIds.has(id))
    if (source.length !== operation.source.length || target.length !== operation.target.length)
      operation = { ...operation, source, target, phase: source.length ? operation.phase : 'source' }
  }
  if ((operation.kind === 'move' || operation.kind === 'copy') && operation.phase === 'destination' && selection.kind !== 'attributes')
    operation = { ...operation, phase: 'selecting' }
  if (editing) {
    const gone = editing.kind === 'attributeName' ? !attributeIds.has(editing.attributeId) : !relationIds.has(editing.relationId)
    if (gone) editing = null
  }
  const selectedFieldIds = ui.selectedFieldIds.filter((id) => fieldIds.has(id))
  const same =
    selection === ui.selection &&
    operation === ui.operation &&
    editing === ui.editing &&
    selectedFieldIds.length === ui.selectedFieldIds.length
  return same ? ui : { ...ui, selection, operation, editing, selectedFieldIds }
}

function pushHistory(h: History, doc: KrijtDocument, key: string | null): History {
  if (key !== null && key === h.coalesceKey) return { ...h, future: [] }
  const past = h.past.length >= HISTORY_LIMIT ? [...h.past.slice(h.past.length - HISTORY_LIMIT + 1), doc] : [...h.past, doc]
  return { past, future: [], coalesceKey: key }
}

/** After undo/redo, operations and edits that refer to the old document end. */
function afterTimeTravel(doc: KrijtDocument, ui: UiState): UiState {
  return reconcileUi(doc, { ...ui, operation: SELECT, editing: null, message: null })
}

export function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case 'command': {
      const result = applyCommand(state.doc, action.command)
      if (!result.ok) return { ...state, ui: { ...state.ui, message: { kind: 'error', text: result.error } } }
      const message: Message | null = result.notice ? { kind: 'info', text: result.notice } : null
      const ui = reconcileUi(result.doc, { ...state.ui, message, ...action.after })
      if (result.doc === state.doc) return { ...state, ui }
      return { doc: result.doc, ui, history: pushHistory(state.history, state.doc, action.coalesceKey ?? null) }
    }
    case 'ui': {
      const patch = { ...action.patch }
      if (patch.sidebarWidth !== undefined) patch.sidebarWidth = clampSidebar(patch.sidebarWidth)
      return { ...state, ui: reconcileUi(state.doc, { ...state.ui, ...patch }) }
    }
    case 'toggleField': {
      if (!state.doc.sourceFields.some((f) => f.id === action.fieldId)) return state
      const ids = state.ui.selectedFieldIds
      const selectedFieldIds = ids.includes(action.fieldId) ? ids.filter((id) => id !== action.fieldId) : [...ids, action.fieldId]
      return { ...state, ui: { ...state.ui, selectedFieldIds, message: null } }
    }
    case 'toggleAttribute': {
      if (!state.doc.relations.some((r) => r.attributes.some((a) => a.id === action.attributeId))) return state
      const ids = selectedAttributeIds(state.ui)
      const next = ids.includes(action.attributeId) ? ids.filter((id) => id !== action.attributeId) : [...ids, action.attributeId]
      const selection: Selection = next.length ? { kind: 'attributes', attributeIds: next } : NO_SELECTION
      return { ...state, ui: { ...state.ui, selection, message: null } }
    }
    case 'startPlace':
      return { ...state, ui: { ...state.ui, operation: { kind: 'place' }, editing: null, message: null } }
    case 'startMoveTable':
      if (!state.doc.relations.some((r) => r.id === action.relationId)) return state
      return {
        ...state,
        ui: {
          ...state.ui,
          operation: { kind: 'moveTable', relationId: action.relationId },
          selection: { kind: 'relation', relationId: action.relationId },
          editing: null,
          message: null,
        },
      }
    case 'startAttributes': {
      // Never carry over a selection silently: only "Move to… / Copy to…" (acting on the selection) uses it.
      const useSelection = action.fromSelection === true && state.ui.selection.kind === 'attributes'
      return {
        ...state,
        ui: {
          ...state.ui,
          operation: { kind: action.kind, phase: useSelection ? 'destination' : 'selecting' },
          selection: useSelection ? state.ui.selection : NO_SELECTION,
          editing: null,
          message: null,
        },
      }
    }
    case 'startReference': {
      const sel = selectedAttributeIds(state.ui)
      const source = action.fromSelection === true ? sel : []
      const oneTable = source.length > 0 && commonRelation(state.doc, source) !== null
      const adjacent = oneTable && isContiguous(state.doc, source)
      const message: Message | null =
        source.length === 0 ? null : !oneTable ? { kind: 'error', text: SOURCE_ONE_TABLE_MESSAGE } : !adjacent ? { kind: 'error', text: REFERENCE_ADJACENT_ERROR } : null
      return {
        ...state,
        ui: {
          ...state.ui,
          operation: { kind: 'reference', phase: adjacent ? 'target' : 'source', source, target: [] },
          selection: NO_SELECTION,
          editing: null,
          message,
        },
      }
    }
    case 'pickReferenceAttribute': {
      const op = state.ui.operation
      if (op.kind !== 'reference') return state
      const owner = attributeOwners(state.doc)
      const table = owner.get(action.attributeId)
      if (!table) return state
      const error = (text: string): AppState => ({ ...state, ui: { ...state.ui, message: { kind: 'error', text } } })
      const list = op.phase === 'source' ? op.source : op.target
      if (list.includes(action.attributeId)) {
        const next = list.filter((id) => id !== action.attributeId)
        const operation: Operation = op.phase === 'source' ? { ...op, source: next } : { ...op, target: next }
        return { ...state, ui: { ...state.ui, operation, message: null } }
      }
      if (op.phase === 'source') {
        if (op.source.length > 0 && owner.get(op.source[0]!) !== table) return error(SOURCE_ONE_TABLE_MESSAGE)
        return { ...state, ui: { ...state.ui, operation: { ...op, source: [...op.source, action.attributeId] }, message: null } }
      }
      if (op.source.includes(action.attributeId)) return error(TARGET_IS_SOURCE_MESSAGE)
      if (op.target.length > 0 && owner.get(op.target[0]!) !== table) return error(TARGET_ONE_TABLE_MESSAGE)
      if (op.target.length >= op.source.length)
        return error(
          `The foreign key has ${plural(op.source.length, 'attribute')}, and ${op.source.length === 1 ? 'it is' : 'all are'} matched. Click a selected cell to remove it, or choose Finish.`,
        )
      return { ...state, ui: { ...state.ui, operation: { ...op, target: [...op.target, action.attributeId] }, message: null } }
    }
    case 'back': {
      const op = state.ui.operation
      if (op.kind !== 'reference' || op.phase !== 'target') return state
      return { ...state, ui: { ...state.ui, operation: { ...op, phase: 'source', target: [] }, message: null } }
    }
    case 'next': {
      const op = state.ui.operation
      if (op.kind === 'reference') {
        if (op.phase !== 'source') return state
        if (op.source.length === 0) return { ...state, ui: { ...state.ui, message: { kind: 'error', text: NO_SOURCE_MESSAGE } } }
        if (commonRelation(state.doc, op.source) === null)
          return { ...state, ui: { ...state.ui, message: { kind: 'error', text: SOURCE_ONE_TABLE_MESSAGE } } }
        if (!isContiguous(state.doc, op.source)) return { ...state, ui: { ...state.ui, message: { kind: 'error', text: REFERENCE_ADJACENT_ERROR } } }
        return { ...state, ui: { ...state.ui, operation: { ...op, phase: 'target' }, message: null } }
      }
      if ((op.kind !== 'move' && op.kind !== 'copy') || op.phase !== 'selecting') return state
      if (selectedAttributeIds(state.ui).length === 0)
        return { ...state, ui: { ...state.ui, message: { kind: 'error', text: NO_ATTRIBUTES_MESSAGE } } }
      return { ...state, ui: { ...state.ui, operation: { ...op, phase: 'destination' }, message: null } }
    }
    case 'cancel': {
      const ui = state.ui
      if (ui.editing) return { ...state, ui: { ...ui, editing: null } }
      if (ui.operation.kind !== 'select') return { ...state, ui: { ...ui, operation: SELECT, message: null } }
      if (ui.message) return { ...state, ui: { ...ui, message: null } }
      if (ui.selection.kind !== 'none') return { ...state, ui: { ...ui, selection: NO_SELECTION } }
      if (ui.multiSelect) return { ...state, ui: { ...ui, multiSelect: false } }
      return state
    }
    case 'undo': {
      const { past, future } = state.history
      const prev = past[past.length - 1]
      if (!prev) return state
      return {
        doc: prev,
        ui: afterTimeTravel(prev, state.ui),
        history: { past: past.slice(0, -1), future: [state.doc, ...future], coalesceKey: null },
      }
    }
    case 'redo': {
      const { past, future } = state.history
      const next = future[0]
      if (!next) return state
      return {
        doc: next,
        ui: afterTimeTravel(next, state.ui),
        history: { past: [...past, state.doc], future: future.slice(1), coalesceKey: null },
      }
    }
  }
}
