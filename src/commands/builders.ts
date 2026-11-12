/**
 * Builders turn user intent into commands, generating the IDs they need.
 * Click paths and (later) drag paths both go through these.
 */
import type { Command } from './commands'
import type { Id, KrijtDocument, Point } from '../model/types'
import { newAttribute } from '../model/types'
import { newAttributeId, newFieldId, newRelationId } from '../model/ids'

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
export function createRelationFromNames(names: string[], position: Point): Command | null {
  if (names.length === 0) return null
  return {
    type: 'createRelation',
    relation: {
      id: newRelationId(),
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
