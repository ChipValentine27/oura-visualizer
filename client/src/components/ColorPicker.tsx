import { useEffect, useId, useRef, useState } from 'react'
import { COLORS, colorLabel, seriesColor, type ColorId } from '../colors'

interface Props {
  /** Series name, for labels ("Steps color"). */
  seriesLabel: string
  value: ColorId
  /** The other series' color, which can't be picked here. */
  otherColor: ColorId
  otherLabel: string
  onChange: (color: ColorId) => void
}

/**
 * A swatch button that opens a grid of the selectable colors. The color already used by the
 * other series can't be picked, so the two series never share a color.
 */
export function ColorPicker({ seriesLabel, value, otherColor, otherLabel, onChange }: Props) {
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
              const taken = c.id === otherColor
              return (
                <button
                  key={c.id}
                  type="button"
                  className={`color-option ${selected ? 'is-selected' : ''}`}
                  style={{ background: seriesColor(c.id).fill }}
                  disabled={taken}
                  aria-pressed={selected}
                  aria-label={taken ? `${c.label} (used by ${otherLabel})` : c.label}
                  title={taken ? `${c.label}: used by ${otherLabel}` : c.label}
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
