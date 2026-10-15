import type { MetricId } from './api'
import { formatCompact, formatDuration, formatHours, formatNumber } from './dates'

export interface MetricConfig {
  id: MetricId
  /** Series name, e.g. in legends and tooltips. */
  label: string
  totalLabel: string
  averageLabel: string
  /** Noun for one day's record ("days with data" / "nights with data"). */
  dayNoun: string
  /** Daily goal in the API's unit (steps, or seconds of sleep). */
  goal: number
  goalLabel: string
  /** Converts an API value to chart units, so axis ticks land on round numbers. */
  toChart: (value: number) => number
  formatValue: (value: number) => string
  formatAxis: (chartValue: number) => string
  /** CSS custom property for this metric's color; fixed so a metric keeps its color in every view. */
  color: string
  colorActive: string
}

export const METRICS: Record<MetricId, MetricConfig> = {
  steps: {
    id: 'steps',
    label: 'Steps',
    totalLabel: 'Total steps',
    averageLabel: 'Daily average',
    dayNoun: 'days',
    goal: 10_000,
    goalLabel: '10K goal',
    toChart: (v) => v,
    formatValue: formatNumber,
    formatAxis: formatCompact,
    color: 'var(--series-1)',
    colorActive: 'var(--series-1-active)',
  },
  sleep: {
    id: 'sleep',
    label: 'Sleep',
    totalLabel: 'Total sleep',
    averageLabel: 'Nightly average',
    dayNoun: 'nights',
    goal: 8 * 3600,
    goalLabel: '8h goal',
    toChart: (v) => v / 3600,
    formatValue: formatDuration,
    formatAxis: formatHours,
    color: 'var(--series-2)',
    colorActive: 'var(--series-2-active)',
  },
}

/**
 * How far a per-day value sits above (+) or below (−) the period's median, as a whole
 * percentage. Null when there is no data or no median to compare against.
 */
export const percentFromMedian = (averagePerDay: number, daysWithData: number, median: number) =>
  daysWithData === 0 || median <= 0 ? null : Math.round(((averagePerDay - median) / median) * 100)

/** "+12%", "−8%" (true minus sign), "0%". */
export const formatSignedPercent = (pct: number) => (pct > 0 ? `+${pct}%` : pct < 0 ? `−${-pct}%` : '0%')
