/**
 * Builders turn user intent into commands, generating the IDs they need.
 * Click paths, keyboard activation and drag-and-drop all go through these.
 */
import { orderAttributeIds, type Command, type Destination } from './commands'
import type { Id, KrijtDocument, Point, ReferenceEnd } from '../model/types'
import { newAttribute } from '../model/types'
import { newAttributeId, newFieldId, newReferenceId, newRelationId } from '../model/ids'

/** A destination chosen by the student, before any new table ID exists. */
export type DestinationIntent = { kind: 'table'; relationId: Id; index?: number } | { kind: 'newTable'; position: Point }

export function toDestination(intent: DestinationIntent): Destination {
  return intent.kind === 'table' ? intent : { kind: 'newTable', relationId: newRelationId(), position: intent.position }
}

/** The table the attributes end up in, for selecting it afterwards. */
export const destinationRelationId = (d: Destination): Id => d.relationId

/**
 * Splits pasted text into field labels: one per line, trimmed, blank lines
 * dropped. Order and deliberate duplicates are preserved.
 */
export function parseFieldList(text: string): string[] {
  return text
    .split(/\r\n|\r|\n/)
    .map((line) => line.trim())
    .filter((line) => line !== '')
}

export function addSourceFields(labels: string[], index?: number): Command | null {
  const clean = labels.map((l) => l.trim()).filter((l) => l !== '')
  if (clean.length === 0) return null
  return { type: 'addSourceFields', fields: clean.map((label) => ({ id: newFieldId(), label })), index }
}

/** Source fields in inventory order, whatever order they were clicked in. */
export function orderedFieldLabels(doc: KrijtDocument, fieldIds: Iterable<Id>): string[] {
  const wanted = new Set(fieldIds)
  return doc.sourceFields.filter((f) => wanted.has(f.id)).map((f) => f.label)
}

/** A new unnamed table holding copies of the given names. */
export function createRelationFromNames(names: string[], position: Point, relationId: Id = newRelationId()): Command | null {
  if (names.length === 0) return null
  return {
    type: 'createRelation',
    relation: {
      id: relationId,
      name: null,
      position: { x: Math.round(position.x), y: Math.round(position.y) },
      attributes: names.map((n) => newAttribute(newAttributeId(), n)),
    },
  }
}

export function addAttributesFromNames(relationId: Id, names: string[], index?: number): Command | null {
  if (names.length === 0) return null
  return { type: 'addAttributes', relationId, attributes: names.map((n) => newAttribute(newAttributeId(), n)), index }
}

/** Placing names (from source fields) at a destination: a new table or an existing one. */
export function placeNames(names: string[], destination: Destination): Command | null {
  return destination.kind === 'newTable'
    ? createRelationFromNames(names, destination.position, destination.relationId)
    : addAttributesFromNames(destination.relationId, names, destination.index)
}

export function moveAttributes(attributeIds: Id[], destination: Destination): Command | null {
  if (attributeIds.length === 0) return null
  return { type: 'moveAttributes', attributeIds: [...attributeIds], destination }
}

export function copyAttributes(doc: KrijtDocument, attributeIds: Id[], destination: Destination): { command: Command; newIds: Id[] } | null {
  const ordered = orderAttributeIds(doc, attributeIds)
  if (ordered.length === 0) return null
  const newIds = ordered.map(() => newAttributeId())
  return { command: { type: 'copyAttributes', attributeIds: ordered, newIds, destination }, newIds }
}

/** A reference between two ends, each in the order the student clicked. */
export function addReference(from: ReferenceEnd, to: ReferenceEnd): Command {
  return { type: 'addReference', reference: { id: newReferenceId(), from, to } }
}
