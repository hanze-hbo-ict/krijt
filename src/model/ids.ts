/**
 * Stable random IDs. References point at these, never at names or indices.
 * The prefix only helps when reading copied JSON; it carries no meaning.
 */
const ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789'

export function randomId(prefix: string, length = 10): string {
  const bytes = new Uint8Array(length)
  globalThis.crypto.getRandomValues(bytes)
  let s = ''
  for (const b of bytes) s += ALPHABET[b % ALPHABET.length]
  return `${prefix}_${s}`
}

export const newFieldId = () => randomId('f')
export const newRelationId = () => randomId('r')
export const newAttributeId = () => randomId('a')
