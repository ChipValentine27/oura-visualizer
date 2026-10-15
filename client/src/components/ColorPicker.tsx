import { useEffect, useId, useRef, useState } from 'react'
import { COLORS, colorLabel, seriesColor, type ColorId } from '../colors'

interface Props {
  /** Series name, for labels ("Steps color"). */
  seriesLabel: string
  value: ColorId
  /** Colors already used by other metrics (color → that metric's label); these can't be picked. */
  takenBy: Partial<Record<ColorId, string>>
  onChange: (color: ColorId) => void
}

/**
 * A swatch button that opens a grid of the selectable colors. Colors already used by other
 * metrics can't be picked, so no two metrics share a color.
 */
export function ColorPicker({ seriesLabel, value, takenBy, onChange }: Props) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLSpanElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const popoverId = useId()

  // Close on a click outside or on Escape, returning focus to the swatch button.
  useEffect(() => {
    if (!open) return
    const onPointerDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false)
        buttonRef.current?.focus()
      }
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  return (
    <span className="color-picker" ref={rootRef}>
      <button
        ref={buttonRef}
        type="button"
        className="color-trigger"
        aria-haspopup="true"
        aria-expanded={open}
        aria-controls={popoverId}
        aria-label={`${seriesLabel} color: ${colorLabel(value)}. Change color`}
        title="Change color"
        onClick={() => setOpen((o) => !o)}
      >
        <span className="swatch" style={{ background: seriesColor(value).fill }} aria-hidden />
      </button>

      {open && (
        <div id={popoverId} className="color-popover" role="group" aria-label={`${seriesLabel} color`}>
          <div className="color-grid">
            {COLORS.map((c) => {
              const selected = c.id === value
              const usedBy = selected ? undefined : takenBy[c.id]
              return (
                <button
                  key={c.id}
                  type="button"
                  className={`color-option ${selected ? 'is-selected' : ''}`}
                  style={{ background: seriesColor(c.id).fill }}
                  disabled={usedBy !== undefined}
                  aria-pressed={selected}
                  aria-label={usedBy ? `${c.label} (used by ${usedBy})` : c.label}
                  title={usedBy ? `${c.label}: used by ${usedBy}` : c.label}
                  onClick={() => {
                    onChange(c.id)
                    setOpen(false)
                    buttonRef.current?.focus()
                  }}
                >
                  {selected && (
                    <svg viewBox="0 0 16 16" aria-hidden>
                      <path d="M3.5 8.5l3 3 6-7" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  )}
                </button>
              )
            })}
          </div>
        </div>
      )}
    </span>
  )
}
