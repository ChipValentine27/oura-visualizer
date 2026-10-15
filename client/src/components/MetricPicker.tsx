import { useRef, useState, type KeyboardEvent } from 'react'
import type { MetricId } from '../api'
import type { SeriesColor } from '../colors'
import { CATEGORIES, MAX_VISIBLE_METRICS, METRIC_IDS, METRICS, type CategoryId } from '../metrics'
import type { Baseline, VisibleSeries } from './OverlayChart'

interface Props {
  id: string
  visible: VisibleSeries
  baseline: Baseline
  colors: Record<MetricId, SeriesColor>
  /** Why clock times and temperatures can't be picked against a goal. */
  notVsGoal: string
  onToggle: (id: MetricId) => void
}

/**
 * Every metric, grouped into category tabs (Sleep, Readiness, Activity...). Each tab shows how
 * many of its metrics are on the chart. A metric can't be picked when four are already shown,
 * or, against a daily goal, when it is a clock time or temperature deviation.
 */
export function MetricPicker({ id, visible, baseline, colors, notVsGoal, onToggle }: Props) {
  const selectedCount = METRIC_IDS.filter((m) => visible[m]).length
  const atMax = selectedCount >= MAX_VISIBLE_METRICS
  // Open on the category of the first metric already shown.
  const [category, setCategory] = useState<CategoryId>(
    () => METRICS[METRIC_IDS.find((m) => visible[m]) ?? 'sleep'].category,
  )
  const tabRefs = useRef<Partial<Record<CategoryId, HTMLButtonElement | null>>>({})
  const inCategory = METRIC_IDS.filter((m) => METRICS[m].category === category)
  const goalBlocks = baseline === 'goal' && inCategory.some((m) => METRICS[m].goal === null)

  // Arrow keys move between tabs, as in a standard tablist.
  const onTabKey = (e: KeyboardEvent) => {
    const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0
    if (!step) return
    e.preventDefault()
    const i = CATEGORIES.findIndex((c) => c.id === category)
    const next = CATEGORIES[(i + step + CATEGORIES.length) % CATEGORIES.length].id
    setCategory(next)
    tabRefs.current[next]?.focus()
  }

  return (
    <div id={id} className="metric-picker">
      <div className="picker-tabs" role="tablist" aria-label="Metric categories" onKeyDown={onTabKey}>
        {CATEGORIES.map((c) => {
          const count = METRIC_IDS.filter((m) => visible[m] && METRICS[m].category === c.id).length
          const selected = c.id === category
          return (
            <button
              key={c.id}
              ref={(el) => {
                tabRefs.current[c.id] = el
              }}
              type="button"
              role="tab"
              id={`${id}-tab-${c.id}`}
              aria-selected={selected}
              aria-controls={`${id}-panel`}
              tabIndex={selected ? 0 : -1}
              className={selected ? 'selected' : ''}
              onClick={() => setCategory(c.id)}
            >
              {c.label}
              {count > 0 && (
                <span className="picker-count" aria-label={`${count} shown`}>
                  {count}
                </span>
              )}
            </button>
          )
        })}
      </div>

      <div id={`${id}-panel`} role="tabpanel" aria-labelledby={`${id}-tab-${category}`} className="picker-panel">
        <div className="picker-grid">
          {inCategory.map((m) => {
            const config = METRICS[m]
            const on = visible[m]
            const reason =
              on && selectedCount === 1
                ? 'At least one metric must be shown'
                : !on && baseline === 'goal' && config.goal === null
                  ? notVsGoal
                  : !on && atMax
                    ? `Up to ${MAX_VISIBLE_METRICS} metrics at a time; turn one off first`
                    : undefined
            return (
              <label key={m} className="picker-option" title={reason}>
                <input
                  type="checkbox"
                  checked={on}
                  disabled={reason !== undefined}
                  onChange={() => onToggle(m)}
                  style={on ? { accentColor: colors[m].fill } : undefined}
                />
                <span>{config.label}</span>
                {config.goal === null && (
                  <span className="picker-tag" title="Compared to the average only">
                    avg only
                  </span>
                )}
              </label>
            )
          })}
        </div>
        {goalBlocks && <p className="picker-note">{notVsGoal}</p>}
      </div>
    </div>
  )
}
