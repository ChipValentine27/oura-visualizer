import type { MetricId } from './api'
import type { ColorId } from './colors'
import { formatDuration, formatNumber } from './dates'

export interface MetricConfig {
  id: MetricId
  /** Series name, e.g. in legends and tooltips. */
  label: string
  /** Noun for one day's record ("days with data" / "nights with data"). */
  dayNoun: string
  /** Formats an API value (steps, or seconds of sleep). */
  formatValue: (value: number) => string
  /** Text for the goal box; must round-trip through {@link MetricConfig.parseGoal}. */
  formatGoal: (value: number) => string
  /** Reads what the user typed into the goal box, or null if it isn't a usable goal. */
  parseGoal: (text: string) => number | null
  /** Example shown in the goal box's tooltip. */
  goalHint: string
  /** Color until the user picks another. */
  defaultColor: ColorId
}

/** Steps: digits with optional thousands separators, e.g. "10,000". */
function parseSteps(text: string): number | null {
  const cleaned = text.replace(/[,\s]|steps?/gi, '')
  if (!/^\d+$/.test(cleaned)) return null
  const n = Number(cleaned)
  return n >= 1 && n <= 100_000 ? n : null
}

/** Sleep: "7h 30m", "7h", "450m", "7:30" or plain hours like "7.5". Returns seconds. */
function parseSleep(text: string): number | null {
  const t = text.trim().toLowerCase()
  let hours: number | null = null

  const hm = /^(?:(\d+(?:\.\d+)?)\s*h(?:ours?|rs?)?)?\s*(?:(\d+)\s*m(?:in(?:utes?)?)?)?$/.exec(t)
  const clock = /^(\d{1,2}):([0-5]\d)$/.exec(t)
  if (clock) hours = Number(clock[1]) + Number(clock[2]) / 60
  else if (/^\d+(?:\.\d+)?$/.test(t)) hours = Number(t)
  else if (hm && (hm[1] || hm[2])) hours = Number(hm[1] ?? 0) + Number(hm[2] ?? 0) / 60

  if (hours === null || !Number.isFinite(hours) || hours < 1 || hours > 16) return null
  return Math.round(hours * 3600)
}

export const METRICS: Record<MetricId, MetricConfig> = {
  steps: {
    id: 'steps',
    label: 'Steps',
    dayNoun: 'days',
    formatValue: formatNumber,
    formatGoal: (v) => formatNumber(Math.round(v)),
    parseGoal: parseSteps,
    goalHint: 'Steps per day, e.g. 10,000',
    defaultColor: 'blue',
  },
  sleep: {
    id: 'sleep',
    label: 'Sleep',
    dayNoun: 'nights',
    formatValue: formatDuration,
    formatGoal: formatDuration,
    parseGoal: parseSleep,
    goalHint: 'Sleep per night, e.g. 7h 30m, 7:30 or 7.5',
    defaultColor: 'orange',
  },
}

/** Share of the daily goal as a whole percentage, or null when there is no data or no goal. */
export const percentOfGoal = (averagePerDay: number, daysWithData: number, goal: number) =>
  daysWithData === 0 || goal <= 0 ? null : Math.round((averagePerDay / goal) * 100)

/**
 * How far a per-day value sits above (+) or below (−) the period's mean, as a whole
 * percentage. Null when there is no data or no mean to compare against.
 */
export const percentFromMean = (averagePerDay: number, daysWithData: number, mean: number) =>
  daysWithData === 0 || mean <= 0 ? null : Math.round(((averagePerDay - mean) / mean) * 100)

/** "+12%", "−8%" (true minus sign), "0%". */
export const formatSignedPercent = (pct: number) => (pct > 0 ? `+${pct}%` : pct < 0 ? `−${-pct}%` : '0%')
