/** Small stroke icons in the style of Kopje/Krash (24×24, 1.7px strokes). */
const PATHS: Record<string, string[]> = {
  plus: ['M12 5v14M5 12h14'],
  minus: ['M5 12h14'],
  pencil: ['M4 20h4L19 9l-4-4L4 16v4Z', 'm13.5 6.5 4 4'],
  trash: ['M5 7h14M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3'],
  check: ['m5 12.5 4.5 4.5L19 7'],
  close: ['M6 6l12 12M18 6 6 18'],
  help: ['M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z', 'M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.7.3-1 .9-1 1.7v.5', 'M12 17.2v.1'],
  place: ['M4 5h7v6H4z', 'M14 15h6v4h-6z', 'M7.5 11v6.5H12'],
  move: ['M12 3v18M3 12h18', 'm9 6 3-3 3 3M9 18l3 3 3-3M6 9l-3 3 3 3M18 9l3 3-3 3'],
  fit: ['M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5'],
  list: ['M8 6h12M8 12h12M8 18h12', 'M4 6h.01M4 12h.01M4 18h.01'],
  tag: ['M4 4h7l9 9-7 7-9-9V4Z', 'M8 8h.01'],
  undo: ['M9 14 4 9l5-5', 'M4 9h11a5 5 0 0 1 0 10h-3'],
  redo: ['m15 14 5-5-5-5', 'M20 9H9a5 5 0 0 0 0 10h3'],
  pointer: ['M5 3l14 7-6 2-2 6-6-15Z'],
  /** A pointer with a + badge: clicks add to the selection. */
  selectMore: ['M3.5 2.5l13 6.5-5.5 1.9-1.9 5.5-5.6-13.9Z', 'M18.5 14v7M15 17.5h7'],
  multi: ['M3 8h6v6H3z', 'M11 8h6v6h-6z', 'M5 11l1 1 2-2', 'M13 11l1 1 2-2', 'M19 8h2v6h-2'],
  copy: ['M9 9h10v11H9z', 'M15 9V5a1 1 0 0 0-1-1H6a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3'],
  left: ['M15 6l-6 6 6 6'],
  right: ['M9 6l6 6-6 6'],
  reference: ['M4 6h6v4H4z', 'M14 14h6v4h-6z', 'M7 10v6h4.5', 'm10 13.5 2.5 2.5-2.5 2.5'],
  back: ['M15 6l-6 6 6 6'],
  image: ['M4 5h16v14H4z', 'm4 16 5-5 4 4 2-2 5 5', 'M15.5 9.5h.01'],
  /** A panel with its side bar (show or hide the form fields, as in Krash). */
  sidebar: ['M4 5h16v14H4z', 'M9 5v14'],
  /** A cross in a circle, as in a search field's clear button (Clear diagram). */
  clear: ['M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z', 'm9 9 6 6M15 9l-6 6'],
}

export function Icon({ name, size }: { name: keyof typeof PATHS | string; size?: number }) {
  const paths = PATHS[name] ?? []
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" width={size} height={size} className="icon">
      {paths.map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  )
}
