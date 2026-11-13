/**
 * Clipboard writes: the PNG image (primary) and the JSON text (secondary).
 *
 * Success is reported only when the browser confirms the write. Every failure
 * becomes an actionable message; there is never a download fallback.
 *
 * Browsers only allow clipboard writes in response to a user gesture. The
 * image write therefore starts synchronously inside the click handler, with
 * the PNG passed to ClipboardItem as a promise (Safari requires this; Chrome
 * and Firefox accept it). If a browser rejects a promised item for another
 * reason than permission, the write is retried once with the finished blob,
 * still within the click's activation window.
 *
 * The browser objects come from a ClipboardEnv, so the logic is unit-tested
 * with fakes.
 */

type ClipboardItemCtor = new (items: Record<string, Blob | Promise<Blob>>) => unknown

export interface ClipboardEnv {
  isSecureContext: boolean
  clipboard?: {
    write?: (items: unknown[]) => Promise<void>
    writeText?: (text: string) => Promise<void>
  }
  ClipboardItem?: ClipboardItemCtor
}

export function browserEnv(): ClipboardEnv {
  const g = globalThis as unknown as {
    isSecureContext?: boolean
    navigator?: { clipboard?: ClipboardEnv['clipboard'] }
    ClipboardItem?: ClipboardItemCtor
  }
  const clipboard = g.navigator?.clipboard
  return {
    isSecureContext: g.isSecureContext !== false,
    clipboard: clipboard
      ? {
          write: typeof clipboard.write === 'function' ? clipboard.write.bind(clipboard) : undefined,
          writeText: typeof clipboard.writeText === 'function' ? clipboard.writeText.bind(clipboard) : undefined,
        }
      : undefined,
    ClipboardItem: typeof g.ClipboardItem === 'function' ? g.ClipboardItem : undefined,
  }
}

export type CopyFailure = 'insecure' | 'unsupported' | 'blocked' | 'failed'
export type CopyResult = { ok: true } | { ok: false; reason: CopyFailure; detail?: string }

const isPermissionError = (e: unknown) => e instanceof Error && (e.name === 'NotAllowedError' || e.name === 'SecurityError')
const detailOf = (e: unknown) => (e instanceof Error && e.message ? e.message : String(e))

/** Copies a PNG. Call synchronously from the click handler; `png` starts the rendering. */
export async function copyImage(env: ClipboardEnv, png: () => Promise<Blob>): Promise<CopyResult> {
  if (!env.isSecureContext) return { ok: false, reason: 'insecure' }
  const write = env.clipboard?.write
  const Item = env.ClipboardItem
  if (!write || !Item) return { ok: false, reason: 'unsupported' }
  const blob = png()
  // A rendering failure must not surface as an unhandled rejection when the browser ignores the promise.
  blob.catch(() => undefined)
  try {
    await write([new Item({ 'image/png': blob })])
    return { ok: true }
  } catch (e) {
    if (isPermissionError(e)) return { ok: false, reason: 'blocked', detail: detailOf(e) }
    let finished: Blob
    try {
      finished = await blob
    } catch (renderError) {
      return { ok: false, reason: 'failed', detail: detailOf(renderError) }
    }
    try {
      await write([new Item({ 'image/png': finished })])
      return { ok: true }
    } catch (e2) {
      if (isPermissionError(e2)) return { ok: false, reason: 'blocked', detail: detailOf(e2) }
      return { ok: false, reason: e2 instanceof TypeError ? 'unsupported' : 'failed', detail: detailOf(e2) }
    }
  }
}

export async function copyText(env: ClipboardEnv, text: string): Promise<CopyResult> {
  if (!env.isSecureContext) return { ok: false, reason: 'insecure' }
  const writeText = env.clipboard?.writeText
  if (!writeText) return { ok: false, reason: 'unsupported' }
  try {
    await writeText(text)
    return { ok: true }
  } catch (e) {
    return { ok: false, reason: isPermissionError(e) ? 'blocked' : 'failed', detail: detailOf(e) }
  }
}

export const COPY_MESSAGES = {
  imageCopied: 'Image copied. Paste it into your answer, and check that it arrived.',
  dataCopied: 'Diagram data copied as text.',
  fieldsCopied: 'Form fields copied, one per line.',
  empty: 'There is nothing to copy yet: the diagram has no tables.',
  tooLarge: 'The diagram is too large to copy as one image. Move the tables closer together and try again.',
} as const

export function failureMessage(kind: 'image' | 'data' | 'fields', reason: CopyFailure, detail?: string): string {
  switch (reason) {
    case 'insecure':
      return 'Copying needs a secure (https) page. Open Krijt over https and try again.'
    case 'unsupported':
      return kind === 'image'
        ? 'This browser cannot put images on the clipboard. Try another browser, or use Copy as text if text answers are allowed.'
        : 'This browser cannot put text on the clipboard.'
    case 'blocked':
      return `The browser blocked the clipboard. Allow clipboard access for this page, then click ${
        kind === 'image' ? 'Copy as image' : kind === 'data' ? 'Copy as text' : 'Copy form fields'
      } again.`
    case 'failed':
      return `Copying failed${detail ? ` (${detail})` : ''}. Nothing was copied; try again.`
  }
}
