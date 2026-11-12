/**
 * A text input for inline editing. Enter commits, Escape cancels, blur commits.
 * Key events never reach the global shortcuts (see isTypingTarget).
 *
 * With `repeat`, Enter commits and clears the input for the next entry
 * (used for typing several attributes in a row).
 */
import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { MAX_TEXT_LENGTH } from '../model/validate'

interface Props {
  initial: string
  label: string
  placeholder?: string
  className?: string
  style?: CSSProperties
  repeat?: boolean
  /** Rewrites the text as it is typed (not during IME composition), e.g. to keep names valid. */
  sanitize?: (text: string) => string
  onCommit: (value: string) => void
  onCancel: () => void
}

export function InlineInput({ initial, label, placeholder, className, style, repeat, sanitize, onCommit, onCancel }: Props) {
  const [value, setValue] = useState(initial)
  const ref = useRef<HTMLInputElement>(null)
  const done = useRef(false)

  useEffect(() => {
    ref.current?.focus()
    ref.current?.select()
  }, [])

  return (
    <input
      ref={ref}
      className={className}
      style={style}
      aria-label={label}
      placeholder={placeholder}
      value={value}
      maxLength={MAX_TEXT_LENGTH}
      spellCheck={false}
      autoComplete="off"
      onChange={(e) => {
        const composing = (e.nativeEvent as InputEvent).isComposing
        setValue(sanitize && !composing ? sanitize(e.target.value) : e.target.value)
      }}
      onCompositionEnd={(e) => sanitize && setValue(sanitize(e.currentTarget.value))}
      onKeyDown={(e) => {
        e.stopPropagation()
        if (e.key === 'Enter') {
          e.preventDefault()
          if (repeat) {
            if (value.trim() !== '') onCommit(value)
            setValue('')
          } else {
            done.current = true
            onCommit(value)
          }
        } else if (e.key === 'Escape') {
          e.preventDefault()
          done.current = true
          onCancel()
        }
      }}
      onBlur={() => {
        if (done.current) return
        done.current = true
        if (repeat) {
          if (value.trim() !== '') onCommit(value)
          onCancel()
        } else onCommit(value)
      }}
    />
  )
}

/** True when a key event comes from a text field, so global shortcuts must ignore it. */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  return target.isContentEditable || target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT'
}
