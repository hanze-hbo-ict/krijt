/**
 * The text a student can copy ("Copy as text"): the diagram as plain text, meant
 * to be understood by reading it. Export only; Krijt never imports it
 * (session recovery uses the internal document format instead).
 *
 *   Klant
 *     *klantnr*
 *     naam
 *
 *   #1
 *     *ordernr*
 *     klantnr → Klant.klantnr
 *     totaal/°
 *
 *   #2
 *     ordernr
 *     regelnr
 *     datum
 *     (ordernr, regelnr) → Regel(ordernr, regelnr)
 *
 * - One block per table, in diagram order, separated by an empty line. The first line is the table's name; a
 *   repeated name gets a suffix by occurrence (the second "Klant" is "Klant#2"); unnamed tables are "#1", "#2", ….
 * - Then the columns, indented two spaces, in diagram order. A repeated column name gets the same suffix ("x#2").
 * - A primary key is wrapped in asterisks: "*klantnr*". Then come `/` calculated and `°` nullable, in the diagram's
 *   order ("totaal/°"; a calculated key: "*x*" followed by "/"). A duplicate suffix belongs to the name, inside the
 *   asterisks ("*x#2*").
 * - Names contain only letters, digits, dashes and underscores (see names.ts), so none of the notation can be part
 *   of a name, and the text is unambiguous.
 * - Single-column references are written on their column: "klantnr → Klant.klantnr"; several from one column are
 *   separated by commas: "ref → A.id, B.id".
 * - A composite reference is a line of its own after the columns: "(ordernr, regelnr) → Regel(ordernr, regelnr)",
 *   columns paired in order (left to right in the diagram).
 * - References name tables and columns without the notation.
 * - Layout (table positions) and the form-field list are not part of the export.
 *
 * The same diagram always gives the same text.
 */
import type { Attribute, Id, KrijtDocument, Reference } from './types'

export type ExportTable = {
  name: string
  /** Column lines: name, notation suffix, and any single-column references. */
  columns: string[]
  /** Composite reference lines. */
  references: string[]
}

/** A column as written: `*name*` for a primary key, then `/` calculated and `°` nullable, in that order. */
export function notated(a: Attribute, name: string): string {
  return (a.primaryKey ? `*${name}*` : name) + (a.calculated ? '/' : '') + (a.nullable ? '°' : '')
}

/** Names made unique by occurrence: the first keeps its name, later ones get "#2", "#3", …; null names become "#1", "#2", …. */
function uniqueNames<T>(items: T[], name: (t: T) => string | null): string[] {
  const seen = new Map<string | null, number>()
  return items.map((t) => {
    const n = name(t)
    const k = (seen.get(n) ?? 0) + 1
    seen.set(n, k)
    if (n === null) return `#${k}`
    return k === 1 ? n : `${n}#${k}`
  })
}

export function exportTables(doc: KrijtDocument): ExportTable[] {
  const tableNames = new Map<Id, string>()
  uniqueNames(doc.relations, (r) => r.name).forEach((n, i) => tableNames.set(doc.relations[i]!.id, n))
  const columnNames = new Map<Id, string>()
  for (const r of doc.relations) uniqueNames(r.attributes, (a) => a.name).forEach((n, i) => columnNames.set(r.attributes[i]!.id, n))
  const col = (id: Id) => columnNames.get(id) ?? '?'
  const table = (id: Id) => tableNames.get(id) ?? '?'

  // Single-column references by their column, in document order.
  const singles = new Map<Id, Reference[]>()
  for (const ref of doc.references)
    if (ref.from.attributeIds.length === 1) {
      const id = ref.from.attributeIds[0]!
      singles.set(id, [...(singles.get(id) ?? []), ref])
    }

  return doc.relations.map((r) => {
    const columns = r.attributes.map((a) => {
      const name = notated(a, col(a.id))
      const targets = (singles.get(a.id) ?? []).map((ref) => `${table(ref.to.relationId)}.${col(ref.to.attributeIds[0]!)}`)
      return targets.length ? `${name} → ${targets.join(', ')}` : name
    })
    const references = doc.references
      .filter((ref) => ref.from.relationId === r.id && ref.from.attributeIds.length > 1)
      .map((ref) => `(${ref.from.attributeIds.map(col).join(', ')}) → ${table(ref.to.relationId)}(${ref.to.attributeIds.map(col).join(', ')})`)
    return { name: table(r.id), columns, references }
  })
}

export function serializeDocument(doc: KrijtDocument): string {
  const blocks = exportTables(doc).map((t) => [t.name, ...[...t.columns, ...t.references].map((line) => `  ${line}`)].join('\n'))
  return blocks.length ? blocks.join('\n\n') + '\n' : ''
}
