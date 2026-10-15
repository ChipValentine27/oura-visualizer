import type { MetricId } from './api'
import type { ColorId } from './colors'
import { formatDuration, formatNumber } from './dates'

export interface MetricConfig {
  id: MetricId
  /** Series name, e.g. in chips, legends and headings. */
  label: string
  /** Summary tile label, e.g. "Steps, daily average". */
  statLabel: string
  /** Tooltip/table label for one bar: per-day wording when a bar covers several days. */
  rowLabel: (perDay: boolean) => string
  /** Unit wording after a value in sentences: "8,773 steps/day", "82 sleep score". */
  describeUnit: string
  /** Noun for one day's record ("days with data" / "nights with data"). */
  dayNoun: string
  /** Formats an API value (steps, seconds of sleep, or a 0–100 score). */
  formatValue: (value: number) => string
  /**
   * Daily goal until the user types one: 'average' follows the mean for the selected period;
   * a number is a fixed goal (100 for scores, so a score of 82 reads as 82%).
   */
  defaultGoal: 'average' | number
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

/** Scores: a whole number from 1 to 100. */
function parseScore(text: string): number | null {
  const t = text.trim()
  if (!/^\d{1,3}$/.test(t)) return null
  const n = Number(t)
  return n >= 1 && n <= 100 ? n : null
}

const formatScore = (v: number) => String(Math.round(v))

function scoreMetric(id: MetricId, label: string, defaultColor: ColorId): MetricConfig {
  return {
    id,
    label,
    statLabel: `${label}, average`,
    rowLabel: (perDay) => (perDay ? `${label} (avg)` : label),
    describeUnit: label.toLowerCase(),
    dayNoun: 'days',
    formatValue: formatScore,
    defaultGoal: 100,
    formatGoal: formatScore,
    parseGoal: parseScore,
    goalHint: `${label} goal, 1–100`,
    defaultColor,
  }
}

export const METRICS: Record<MetricId, MetricConfig> = {
  steps: {
    id: 'steps',
    label: 'Steps',
    statLabel: 'Steps, daily average',
    rowLabel: (perDay) => (perDay ? 'Steps / day' : 'Steps'),
    describeUnit: 'steps/day',
    dayNoun: 'days',
    formatValue: formatNumber,
    defaultGoal: 'average',
    formatGoal: (v) => formatNumber(Math.round(v)),
    parseGoal: parseSteps,
    goalHint: 'Steps per day, e.g. 10,000',
    defaultColor: 'blue',
  },
  sleep: {
    id: 'sleep',
    label: 'Sleep',
    statLabel: 'Sleep, nightly average',
    rowLabel: (perDay) => (perDay ? 'Sleep / night' : 'Sleep'),
    describeUnit: 'sleep/night',
    dayNoun: 'nights',
    formatValue: formatDuration,
    defaultGoal: 'average',
    formatGoal: formatDuration,
    parseGoal: parseSleep,
    goalHint: 'Sleep per night, e.g. 7h 30m, 7:30 or 7.5',
    defaultColor: 'orange',
  },
  // Default colors continue the validated palette order after blue and orange.
  sleepScore: scoreMetric('sleepScore', 'Sleep score', 'aqua'),
  readinessScore: scoreMetric('readinessScore', 'Readiness', 'yellow'),
  activityScore: scoreMetric('activityScore', 'Activity score', 'magenta'),
}

/** Every metric, in display order (chips, bars within a group, table columns). */
export const METRIC_IDS: MetricId[] = ['steps', 'sleep', 'sleepScore', 'readinessScore', 'activityScore']

/** The most metrics the chart shows at once; beyond this, grouped bars get too thin to read. */
export const MAX_VISIBLE_METRICS = 4

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
