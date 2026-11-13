/**
 * Same-tab recovery through sessionStorage (never localStorage, IndexedDB or
 * cookies). This is a convenience after an accidental reload, not durable
 * saving: closing the tab, a crash or the exam browser's policy can lose it.
 */
import type { KrijtDocument } from '../model/types'
import { parseDocument } from '../model/validate'
import type { UiState } from '../state/appState'
import { DEFAULT_VIEWPORT, MAX_ZOOM, MIN_ZOOM, type Viewport } from '../geometry/viewport'

export const SESSION_KEY = 'krijt:v1:session'
export const SAVE_DEBOUNCE_MS = 300

export type SessionData = { doc: KrijtDocument; ui: Pick<UiState, 'viewport' | 'sidebarCollapsed' | 'theme'> }

export function safeSessionStorage(): Storage | null {
  try {
    const s = globalThis.sessionStorage
    if (!s) return null
    const probe = 'krijt:probe'
    s.setItem(probe, '1')
    s.removeItem(probe)
    return s
  } catch {
    return null
  }
}

export function serializeSession(data: SessionData): string {
  return JSON.stringify({ version: 1, doc: data.doc, ui: { viewport: data.ui.viewport, sidebarCollapsed: data.ui.sidebarCollapsed, theme: data.ui.theme } })
}

function parseViewport(v: unknown): Viewport {
  if (typeof v !== 'object' || v === null) return DEFAULT_VIEWPORT
  const { x, y, zoom } = v as Record<string, unknown>
  const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && Math.abs(n) < 1e6
  if (!finite(x) || !finite(y) || !finite(zoom) || zoom < MIN_ZOOM || zoom > MAX_ZOOM) return DEFAULT_VIEWPORT
  return { x, y, zoom }
}

/** Parses stored data; returns null for missing, corrupt or incompatible data. */
export function parseSession(raw: string | null): SessionData | null {
  if (!raw) return null
  let v: unknown
  try {
    v = JSON.parse(raw)
  } catch {
    return null
  }
  if (typeof v !== 'object' || v === null) return null
  const obj = v as Record<string, unknown>
  if (obj.version !== 1) return null
  const doc = parseDocument(obj.doc)
  if (!doc) return null
  const ui = typeof obj.ui === 'object' && obj.ui !== null ? (obj.ui as Record<string, unknown>) : {}
  return {
    doc,
    ui: {
      viewport: parseViewport(ui.viewport),
      sidebarCollapsed: ui.sidebarCollapsed === true,
      theme: ui.theme === 'light' || ui.theme === 'dark' ? ui.theme : 'system',
    },
  }
}

export function loadSession(storage: Storage | null): SessionData | null {
  return readSession(storage).data
}

/**
 * Reads the stored session and says what happened: nothing stored, restored, or stored but unusable
 * (corrupt, from an incompatible version, or unreadable storage), so the student can be told.
 */
export function readSession(storage: Storage | null): { data: SessionData | null; status: 'none' | 'restored' | 'unreadable' } {
  if (!storage) return { data: null, status: 'none' }
  let raw: string | null
  try {
    raw = storage.getItem(SESSION_KEY)
  } catch {
    return { data: null, status: 'unreadable' }
  }
  if (raw === null) return { data: null, status: 'none' }
  const data = parseSession(raw)
  return data ? { data, status: 'restored' } : { data: null, status: 'unreadable' }
}

export const UNREADABLE_SESSION_MESSAGE = 'The work kept in this tab could not be restored, so Krijt started with an empty diagram.'

/** Returns false if the write failed (quota, blocked storage). */
export function saveSession(storage: Storage | null, data: SessionData): boolean {
  if (!storage) return false
  try {
    storage.setItem(SESSION_KEY, serializeSession(data))
    return true
  } catch {
    return false
  }
}
