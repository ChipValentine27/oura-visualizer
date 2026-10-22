import { useRef, useState, type KeyboardEvent } from 'react'
import type { MetricId } from '../api'
import type { SeriesColor } from '../colors'
import { METRICS } from '../metrics'
import type { VisibleSeries } from './OverlayChart'

/** One picker tab: a category (Sleep, Readiness...) or, in Unit mode, a unit. */
export interface PickerGroup {
  id: string
  label: string
  ids: MetricId[]
}

interface Props {
  id: string
  groups: PickerGroup[]
  visible: VisibleSeries
  colors: Record<MetricId, SeriesColor>
  /** Why a metric's checkbox is disabled right now, or undefined when it can be toggled. */
  reasonFor: (id: MetricId) => string | undefined
  /** A short muted tag after a metric's name, such as "avg only". */
  tagFor?: (id: MetricId) => { text: string; title: string } | undefined
  /** Shown under the open tab's checkboxes when set for that tab. */
  noteFor?: (group: PickerGroup) => string | undefined
  onToggle: (id: MetricId) => void
}

/**
 * Every metric, grouped into tabs. Each tab shows how many of its metrics are on the chart;
 * which metrics can be picked, and why not, is up to the caller.
 */
export function MetricPicker({ id, groups, visible, colors, reasonFor, tagFor, noteFor, onToggle }: Props) {
  // Open on the group of the first metric already shown; fall back to it when the groups
  // change (switching between categories and units) and the open tab no longer exists.
  const firstWithSelection = groups.find((g) => g.ids.some((m) => visible[m])) ?? groups[0]
  const [picked, setPicked] = useState<string>(firstWithSelection.id)
  const current = groups.find((g) => g.id === picked) ?? firstWithSelection
  const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({})
  const note = noteFor?.(current)

  // Arrow keys move between tabs, as in a standard tablist.
  const onTabKey = (e: KeyboardEvent) => {
    const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0
    if (!step) return
    e.preventDefault()
    const i = groups.findIndex((g) => g.id === current.id)
    const next = groups[(i + step + groups.length) % groups.length].id
    setPicked(next)
    tabRefs.current[next]?.focus()
  }

  return (
    <div id={id} className="metric-picker">
      <div className="picker-tabs" role="tablist" aria-label="Metric groups" onKeyDown={onTabKey}>
        {groups.map((g) => {
          const count = g.ids.filter((m) => visible[m]).length
          const selected = g.id === current.id
          return (
            <button
              key={g.id}
              ref={(el) => {
                tabRefs.current[g.id] = el
              }}
              type="button"
              role="tab"
              id={`${id}-tab-${g.id}`}
              aria-selected={selected}
              aria-controls={`${id}-panel`}
              tabIndex={selected ? 0 : -1}
              className={selected ? 'selected' : ''}
              onClick={() => setPicked(g.id)}
            >
              {g.label}
              {count > 0 && (
                <span className="picker-count" aria-label={`${count} shown`}>
                  {count}
                </span>
              )}
            </button>
          )
        })}
      </div>

      <div id={`${id}-panel`} role="tabpanel" aria-labelledby={`${id}-tab-${current.id}`} className="picker-panel">
        <div className="picker-grid">
          {current.ids.map((m) => {
            const on = visible[m]
            const reason = reasonFor(m)
            const tag = tagFor?.(m)
            return (
              <label key={m} className="picker-option" title={reason}>
                <input
                  type="checkbox"
                  checked={on}
                  disabled={reason !== undefined}
                  onChange={() => onToggle(m)}
                  style={on ? { accentColor: colors[m].fill } : undefined}
                />
                <span>{METRICS[m].label}</span>
                {tag && (
                  <span className="picker-tag" title={tag.title}>
                    {tag.text}
                  </span>
                )}
              </label>
            )
          })}
        </div>
        {note && <p className="picker-note">{note}</p>}
      </div>
    </div>
  )
}
