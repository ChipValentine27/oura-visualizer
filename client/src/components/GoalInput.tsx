import { useRef, useState } from 'react'
import type { MetricConfig } from '../metrics'

interface Props {
  metric: MetricConfig
  /** The goal in effect: the user's own, or the period average when they haven't set one. */
  goal: number
  /** True when the user typed this goal; false while it follows the average. */
  isCustom: boolean
  disabled?: boolean
  /** A new goal, or null to go back to following the average. */
  onChange: (value: number | null) => void
}

/**
 * Editable daily goal shown inside a series chip. Commits on Enter or blur, reverts on Escape,
 * and keeps text it can't read (flagged as invalid) so the user can fix it.
 */
export function GoalInput({ metric, goal, isCustom, disabled, onChange }: Props) {
  const formatted = goal > 0 ? metric.formatGoal(goal) : ''
  // While editing (or holding unreadable text) the box shows the draft; otherwise the live goal,
  // so it keeps following the average as the date range changes.
  const [draft, setDraft] = useState<string | null>(null)
  const [invalid, setInvalid] = useState(false)
  const cancelled = useRef(false)

  const commit = () => {
    if (cancelled.current || draft === null) {
      cancelled.current = false
      return
    }
    if (draft.trim() === '') {
      setDraft(null)
      setInvalid(false)
      onChange(null)
      return
    }
    const value = metric.parseGoal(draft)
    if (value === null) {
      setInvalid(true)
      return
    }
    setDraft(null)
    setInvalid(false)
    if (value !== goal || !isCustom) onChange(value)
  }

  return (
    <span className="goal-field">
      <span className="goal-label" aria-hidden>
        Goal
      </span>
      <input
        type="text"
        inputMode={metric.id === 'steps' ? 'numeric' : 'text'}
        className="goal-input"
        value={draft ?? formatted}
        disabled={disabled}
        aria-label={`${metric.label} daily goal`}
        aria-invalid={invalid}
        title={invalid ? `Couldn't read that. ${metric.goalHint}` : metric.goalHint}
        size={7}
        onFocus={(e) => {
          if (draft === null) setDraft(formatted)
          e.currentTarget.select()
        }}
        onChange={(e) => {
          setDraft(e.target.value)
          setInvalid(false)
        }}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur()
          if (e.key === 'Escape') {
            cancelled.current = true
            setDraft(null)
            setInvalid(false)
            e.currentTarget.blur()
          }
        }}
      />
      {isCustom ? (
        <button
          type="button"
          className="goal-reset"
          disabled={disabled}
          onClick={() => {
            setDraft(null)
            setInvalid(false)
            onChange(null)
          }}
          title="Use the average for the selected period"
        >
          Use average
        </button>
      ) : (
        <span className="goal-source" title="Following the average for the selected period">
          avg
        </span>
      )}
    </span>
  )
}
