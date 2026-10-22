import type { MetricId } from './api'
import { COLORS, type ColorId } from './colors'
import { formatClock, formatDuration, formatNumber } from './dates'

export type CategoryId = 'sleep' | 'readiness' | 'activity' | 'heart'

/** Groups for the metric picker, in display order. */
export const CATEGORIES: { id: CategoryId; label: string }[] = [
  { id: 'sleep', label: 'Sleep' },
  { id: 'readiness', label: 'Readiness' },
  { id: 'activity', label: 'Activity' },
  { id: 'heart', label: 'Heart & breathing' },
]

/** What a metric's values measure; in Unit mode the picker groups by this and the chart shares its axis. */
export type UnitId =
  | 'duration'
  | 'clock'
  | 'steps'
  | 'meters'
  | 'score'
  | 'percent'
  | 'bpm'
  | 'ms'
  | 'breaths'
  | 'celsius'
  | 'index'

/** Groups for the metric picker in Unit mode, in display order. */
export const UNITS: { id: UnitId; label: string }[] = [
  { id: 'duration', label: 'Duration' },
  { id: 'clock', label: 'Time of day' },
  { id: 'steps', label: 'Steps' },
  { id: 'meters', label: 'Distance' },
  { id: 'score', label: 'Score' },
  { id: 'percent', label: 'Percent' },
  { id: 'bpm', label: 'Heart rate (bpm)' },
  { id: 'ms', label: 'HRV (ms)' },
  { id: 'breaths', label: 'Breaths per minute' },
  { id: 'celsius', label: 'Temperature (°C)' },
  { id: 'index', label: 'Index' },
]

export const unitLabel = (id: UnitId) => UNITS.find((u) => u.id === id)!.label

/** How a metric's daily goal is read, written and defaulted. */
export interface GoalConfig {
  /**
   * Daily goal until the user types one: 'average' follows the mean for the selected period;
   * a number is a fixed goal (100 for scores, so a score of 82 reads as 82%).
   */
  defaultGoal: 'average' | number
  /** Text for the goal box; must round-trip through {@link GoalConfig.parse}. */
  format: (value: number) => string
  /** Reads what the user typed into the goal box, or null if it isn't a usable goal. */
  parse: (text: string) => number | null
  /** Example shown in the goal box's tooltip. */
  hint: string
  /** Keyboard to offer on touch devices. */
  inputMode: 'numeric' | 'decimal' | 'text'
}

export interface MetricConfig {
  id: MetricId
  category: CategoryId
  unit: UnitId
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
  /** Formats an API value in the metric's unit. */
  formatValue: (value: number) => string
  /**
   * Null for metrics that can't be measured against a goal: clock times and temperature
   * deviations, where "% of goal" means nothing. They can't be picked in Daily goal mode.
   */
  goal: GoalConfig | null
  /**
   * Set for values that sit around zero or on a clock, where "% from the mean" means nothing.
   * Against the average they show the difference instead, scaled so this much reads as 100%
   * (1 hour for clock times, 1 °C for temperature).
   */
  offsetScale?: { value: number; label: string }
  /** Color until the user picks another. */
  defaultColor: ColorId
}

/** Parses a plain number, ignoring thousands separators and an optional unit suffix. */
function numberParser(min: number, max: number, suffix?: RegExp, decimals = false) {
  return (text: string): number | null => {
    let t = text.trim().replace(/,/g, '')
    if (suffix) t = t.replace(suffix, '').trim()
    if (!(decimals ? /^\d+(?:\.\d+)?$/ : /^\d+$/).test(t)) return null
    const n = Number(t)
    return n >= min && n <= max ? n : null
  }
}

/**
 * Durations: "7h 30m", "7h", "45m", "7:30", or a plain number in hours (sleep-length metrics)
 * or minutes (short ones like latency). Returns seconds.
 */
function durationParser(plain: 'hours' | 'minutes', minMinutes: number, maxHours: number) {
  return (text: string): number | null => {
    const t = text.trim().toLowerCase()
    let minutes: number | null = null

    const hm = /^(?:(\d+(?:\.\d+)?)\s*h(?:ours?|rs?)?)?\s*(?:(\d+)\s*m(?:in(?:utes?)?)?)?$/.exec(t)
    const clock = /^(\d{1,2}):([0-5]\d)$/.exec(t)
    if (clock) minutes = Number(clock[1]) * 60 + Number(clock[2])
    else if (/^\d+(?:\.\d+)?$/.test(t)) minutes = Number(t) * (plain === 'hours' ? 60 : 1)
    else if (hm && (hm[1] || hm[2])) minutes = Number(hm[1] ?? 0) * 60 + Number(hm[2] ?? 0)

    if (minutes === null || !Number.isFinite(minutes) || minutes < minMinutes || minutes > maxHours * 60) return null
    return Math.round(minutes * 60)
  }
}

/** Distances: "8 km", "8.5km", "8000 m" or a plain number of meters. Returns meters. */
function parseMeters(text: string): number | null {
  const t = text.trim().toLowerCase().replace(/,/g, '')
  const m = /^(\d+(?:\.\d+)?)\s*(km|m)?$/.exec(t)
  if (!m) return null
  const meters = Number(m[1]) * (m[2] === 'km' ? 1000 : 1)
  return meters >= 1 && meters <= 200_000 ? Math.round(meters) : null
}

/** Drops a trailing ".0": 14.5 → "14.5", 14 → "14". */
const oneDecimal = (v: number) => (Math.round(v * 10) / 10).toLocaleString()
const formatMeters = (v: number) =>
  Math.abs(v) >= 1000 ? `${(Math.round(v / 100) / 10).toLocaleString()} km` : `${Math.round(v)} m`
const formatScore = (v: number) => String(Math.round(v))
/** "+0.25 °C", "−0.10 °C" (true minus sign). */
const formatCelsius = (v: number) => {
  const r = Math.round(v * 100) / 100
  return `${r > 0 ? '+' : r < 0 ? '−' : ''}${Math.abs(r).toFixed(2)} °C`
}

const scoreGoal = (label: string): GoalConfig => ({
  defaultGoal: 100,
  format: formatScore,
  parse: numberParser(1, 100),
  hint: `${label} goal, 1–100`,
  inputMode: 'numeric',
})

const percentGoal: GoalConfig = {
  defaultGoal: 100,
  format: (v) => `${oneDecimal(v)}%`,
  parse: numberParser(1, 100, /%$/, true),
  hint: 'A percentage, e.g. 90%',
  inputMode: 'decimal',
}

const durationGoal = (plain: 'hours' | 'minutes', example: string): GoalConfig => ({
  defaultGoal: 'average',
  format: formatDuration,
  parse: durationParser(plain, 1, 24),
  hint: `A duration, e.g. ${example}`,
  inputMode: 'text',
})

const unitGoal = (unit: string, min: number, max: number, example: string, decimals = false): GoalConfig => ({
  defaultGoal: 'average',
  format: (v) => (decimals ? oneDecimal(v) : String(Math.round(v))),
  parse: numberParser(min, max, new RegExp(`${unit}$`, 'i'), decimals),
  hint: `e.g. ${example}`,
  inputMode: decimals ? 'decimal' : 'numeric',
})

const ONE_HOUR = { value: 3600, label: '1 hour' }
const ONE_DEGREE = { value: 1, label: '1 °C' }

type Kind = Exclude<UnitId, 'steps'>

interface Options {
  /** "night" for overnight readings (sleep stages, nightly heart rate...); "day" otherwise. */
  per?: 'day' | 'night'
  /** Duration goals: what a plain number means. Defaults to hours. */
  plain?: 'hours' | 'minutes'
}

/** Builds the config for a metric from its kind of value. */
function metric(id: MetricId, label: string, category: CategoryId, kind: Kind, options: Options = {}): MetricConfig {
  const per = options.per ?? 'day'
  const base = {
    id,
    category,
    unit: kind,
    label,
    statLabel: `${label}, ${per === 'night' ? 'nightly' : 'daily'} average`,
    rowLabel: (perDay: boolean) => (perDay ? `${label} (avg)` : label),
    // Lowercase "Deep sleep" but not acronyms like "HRV" or "REM sleep".
    describeUnit: /^[A-Z][a-z]/.test(label) ? label.charAt(0).toLowerCase() + label.slice(1) : label,
    dayNoun: per === 'night' ? 'nights' : 'days',
    defaultColor: 'blue' as ColorId, // replaced below
  }
  switch (kind) {
    case 'duration': {
      const plain = options.plain ?? 'hours'
      return { ...base, formatValue: formatDuration, goal: durationGoal(plain, plain === 'hours' ? '1h 30m or 1.5' : '20m or 20') }
    }
    case 'clock':
      return { ...base, formatValue: formatClock, goal: null, offsetScale: ONE_HOUR }
    case 'score':
      return { ...base, statLabel: `${label}, average`, dayNoun: 'days', formatValue: formatScore, goal: scoreGoal(label) }
    case 'percent':
      return { ...base, formatValue: (v) => `${oneDecimal(v)}%`, goal: percentGoal }
    case 'bpm':
      return { ...base, formatValue: (v) => `${Math.round(v)} bpm`, goal: unitGoal('bpm', 20, 250, '55 bpm') }
    case 'ms':
      return { ...base, formatValue: (v) => `${Math.round(v)} ms`, goal: unitGoal('ms', 1, 500, '50 ms') }
    case 'breaths':
      return {
        ...base,
        formatValue: (v) => `${oneDecimal(v)} br/min`,
        goal: unitGoal('(?:br|breaths)?\\s*/\\s*min', 1, 60, '14.5', true),
      }
    case 'index':
      return { ...base, formatValue: oneDecimal, goal: unitGoal('', 0.1, 100, '5', true) }
    case 'meters':
      return {
        ...base,
        formatValue: formatMeters,
        goal: {
          defaultGoal: 'average',
          format: formatMeters,
          parse: parseMeters,
          hint: 'A distance, e.g. 8 km or 8000 m',
          inputMode: 'text',
        },
      }
    case 'celsius':
      return { ...base, formatValue: formatCelsius, goal: null, offsetScale: ONE_DEGREE }
  }
}

/** Every metric, in display order within each category (picker, bars within a group, table columns). */
const DEFINITIONS: MetricConfig[] = [
  // Sleep
  {
    id: 'sleep',
    category: 'sleep',
    unit: 'duration',
    label: 'Sleep',
    statLabel: 'Sleep, nightly average',
    rowLabel: (perDay) => (perDay ? 'Sleep / night' : 'Sleep'),
    describeUnit: 'sleep/night',
    dayNoun: 'nights',
    formatValue: formatDuration,
    goal: {
      defaultGoal: 'average',
      format: formatDuration,
      parse: durationParser('hours', 60, 16),
      hint: 'Sleep per night, e.g. 7h 30m, 7:30 or 7.5',
      inputMode: 'text',
    },
    defaultColor: 'orange',
  },
  metric('sleepScore', 'Sleep score', 'sleep', 'score'),
  metric('deepSleep', 'Deep sleep', 'sleep', 'duration', { per: 'night' }),
  metric('lightSleep', 'Light sleep', 'sleep', 'duration', { per: 'night' }),
  metric('remSleep', 'REM sleep', 'sleep', 'duration', { per: 'night' }),
  metric('awakeTime', 'Awake time', 'sleep', 'duration', { per: 'night', plain: 'minutes' }),
  metric('timeInBed', 'Time in bed', 'sleep', 'duration', { per: 'night' }),
  metric('latency', 'Time to fall asleep', 'sleep', 'duration', { per: 'night', plain: 'minutes' }),
  metric('efficiency', 'Sleep efficiency', 'sleep', 'percent', { per: 'night' }),
  metric('bedtimeStart', 'Bedtime', 'sleep', 'clock', { per: 'night' }),
  metric('bedtimeEnd', 'Wake time', 'sleep', 'clock', { per: 'night' }),

  // Readiness
  metric('readinessScore', 'Readiness', 'readiness', 'score'),
  metric('temperatureDeviation', 'Temperature deviation', 'readiness', 'celsius'),
  metric('temperatureTrendDeviation', 'Temperature trend', 'readiness', 'celsius'),
  metric('stressHigh', 'High stress time', 'readiness', 'duration', { plain: 'minutes' }),
  metric('recoveryHigh', 'High recovery time', 'readiness', 'duration', { plain: 'minutes' }),

  // Activity
  {
    id: 'steps',
    category: 'activity',
    unit: 'steps',
    label: 'Steps',
    statLabel: 'Steps, daily average',
    rowLabel: (perDay) => (perDay ? 'Steps / day' : 'Steps'),
    describeUnit: 'steps/day',
    dayNoun: 'days',
    formatValue: (v) => formatNumber(Math.round(v)),
    goal: {
      defaultGoal: 'average',
      format: (v) => formatNumber(Math.round(v)),
      parse: numberParser(1, 100_000, /steps?$/i),
      hint: 'Steps per day, e.g. 10,000',
      inputMode: 'numeric',
    },
    defaultColor: 'blue',
  },
  metric('activityScore', 'Activity score', 'activity', 'score'),
  metric('walkingDistance', 'Walking distance', 'activity', 'meters'),
  metric('targetMeters', 'Activity target', 'activity', 'meters'),
  metric('highActivityTime', 'High activity', 'activity', 'duration', { plain: 'minutes' }),
  metric('mediumActivityTime', 'Medium activity', 'activity', 'duration', { plain: 'minutes' }),
  metric('lowActivityTime', 'Low activity', 'activity', 'duration'),
  metric('sedentaryTime', 'Sedentary time', 'activity', 'duration'),
  metric('restingTime', 'Resting time', 'activity', 'duration'),
  metric('nonWearTime', 'Non-wear time', 'activity', 'duration', { plain: 'minutes' }),

  // Heart and breathing
  metric('heartRate', 'Heart rate (24h avg)', 'heart', 'bpm'),
  metric('heartRateMin', 'Heart rate (24h low)', 'heart', 'bpm'),
  metric('heartRateMax', 'Heart rate (24h high)', 'heart', 'bpm'),
  metric('sleepLowestHeartRate', 'Lowest heart rate', 'heart', 'bpm', { per: 'night' }),
  metric('sleepAverageHeartRate', 'Sleep heart rate', 'heart', 'bpm', { per: 'night' }),
  metric('sleepMaxHeartRate', 'Peak sleep heart rate', 'heart', 'bpm', { per: 'night' }),
  metric('sleepAverageHrv', 'HRV', 'heart', 'ms', { per: 'night' }),
  metric('sleepMaxHrv', 'Peak HRV', 'heart', 'ms', { per: 'night' }),
  metric('averageBreath', 'Breathing rate', 'heart', 'breaths', { per: 'night' }),
  metric('spo2', 'Blood oxygen (SpO₂)', 'heart', 'percent', { per: 'night' }),
  metric('breathingDisturbanceIndex', 'Breathing disturbance', 'heart', 'index', { per: 'night' }),
]

// The original five keep the colors they always had; the rest take the palette in turn.
// Colors only need to differ among the metrics on the chart, which App enforces.
const ORIGINAL_COLORS: Partial<Record<MetricId, ColorId>> = {
  steps: 'blue',
  sleep: 'orange',
  sleepScore: 'aqua',
  readinessScore: 'yellow',
  activityScore: 'magenta',
}
DEFINITIONS.forEach((m, i) => {
  m.defaultColor = ORIGINAL_COLORS[m.id] ?? COLORS[i % COLORS.length].id
})

export const METRICS = Object.fromEntries(DEFINITIONS.map((m) => [m.id, m])) as Record<MetricId, MetricConfig>

/** Every metric, grouped by category in {@link CATEGORIES} order. */
export const METRIC_IDS: MetricId[] = CATEGORIES.flatMap((c) =>
  DEFINITIONS.filter((m) => m.category === c.id).map((m) => m.id),
)

/** True when the metric can be shown against the chosen baseline. */
export const canCompareToGoal = (id: MetricId) => METRICS[id].goal !== null

/** The most metrics the chart shows at once; beyond this, grouped bars get too thin to read. */
export const MAX_VISIBLE_METRICS = 4

/** Share of the daily goal as a whole percentage, or null when there is no data or no goal. */
export const percentOfGoal = (averagePerDay: number, daysWithData: number, goal: number) =>
  daysWithData === 0 || goal <= 0 ? null : Math.round((averagePerDay / goal) * 100)

/**
 * How far a per-day value sits above (+) or below (−) the period's mean, as a whole
 * percentage. Null when there is no data or no mean to compare against. Metrics with an
 * {@link MetricConfig.offsetScale} use the plain difference, in units of that scale.
 */
export function percentFromMean(id: MetricId, averagePerDay: number, daysWithData: number, mean: number) {
  if (daysWithData === 0) return null
  const scale = METRICS[id].offsetScale
  if (scale) return Math.round(((averagePerDay - mean) / scale.value) * 100)
  return mean <= 0 ? null : Math.round(((averagePerDay - mean) / mean) * 100)
}

/** "+12%", "−8%" (true minus sign), "0%". */
export const formatSignedPercent = (pct: number) => (pct > 0 ? `+${pct}%` : pct < 0 ? `−${-pct}%` : '0%')
