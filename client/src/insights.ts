import type { Bucket, MetricId } from './api'
import { formatDuration, formatNumber, parseDay, shortDay } from './dates'
import { METRICS } from './metrics'

/**
 * Which way is an improvement. Metrics left out (clock times, temperatures, targets, light
 * sleep...) have no better direction: their insights are worded neutrally and get no streaks.
 */
const BETTER: Partial<Record<MetricId, 'higher' | 'lower'>> = {
  steps: 'higher',
  activityScore: 'higher',
  highActivityTime: 'higher',
  mediumActivityTime: 'higher',
  walkingDistance: 'higher',
  sedentaryTime: 'lower',
  sleep: 'higher',
  sleepScore: 'higher',
  deepSleep: 'higher',
  remSleep: 'higher',
  awakeTime: 'lower',
  latency: 'lower',
  efficiency: 'higher',
  readinessScore: 'higher',
  stressHigh: 'lower',
  recoveryHigh: 'higher',
  heartRate: 'lower',
  sleepLowestHeartRate: 'lower',
  sleepAverageHeartRate: 'lower',
  sleepAverageHrv: 'higher',
  sleepMaxHrv: 'higher',
  spo2: 'higher',
  breathingDisturbanceIndex: 'lower',
}

/** The most metrics the Insights tab analyzes at once. */
export const MAX_INSIGHT_METRICS = 3

/** A window the detectors look over, ending at the "as of" day. */
export interface Timeframe {
  days: 30 | 90
  label: string
  /** Baseline detector: these last days are compared with the rest of the window. */
  recentDays: number
  /** Momentum detector: a short average crossing a long one within the last `lookback` days. */
  momentum: { short: number; long: number; lookback: number }
  /** Shortest current streak worth mentioning. */
  minStreak: number
}

export const TIMEFRAMES: Timeframe[] = [
  { days: 30, label: 'Last 30 days', recentDays: 7, momentum: { short: 7, long: 30, lookback: 10 }, minStreak: 4 },
  { days: 90, label: 'Last 90 days', recentDays: 30, momentum: { short: 30, long: 90, lookback: 21 }, minStreak: 6 },
]

/** The longest window, which the tab loads tags for. */
export const LONGEST_TIMEFRAME = Math.max(...TIMEFRAMES.map((t) => t.days))

/** Days a momentum crossing must have held the other side before it. */
const HELD_DAYS = 5

/** Days of history to fetch: the long momentum average needs data from before the window. */
export const HISTORY_DAYS = Math.max(
  ...TIMEFRAMES.map((t) => Math.max(t.days, t.momentum.long + t.momentum.lookback + HELD_DAYS)),
)

/** A window needs this share of its days with data before any detector runs. */
export const MIN_COVERAGE = 0.6
/** Mann-Kendall p-value a trend must beat. Strict because daily values are autocorrelated. */
const TREND_P = 0.01
/** Permutation test p-value a weekly rhythm must beat, and the shuffles behind it. */
const WEEKLY_P = 0.05
const PERMUTATIONS = 499

export type InsightKind = 'baseline' | 'trend' | 'momentum' | 'weekly' | 'streak' | 'record'
export type Tone = 'good' | 'bad' | 'neutral'

export interface Insight {
  kind: InsightKind
  tone: Tone
  /** Which way the finding points, for its arrow; null for the weekly rhythm. */
  direction: 'up' | 'down' | null
  title: string
  detail: string
  /** How much it stands out; insights are listed highest first. */
  score: number
}

export interface DayValue {
  day: string
  value: number | null
}

export interface MetricInsights {
  metric: MetricId
  timeframe: Timeframe
  /** The window's days, oldest first, with the fitted trend where one was found. */
  days: (DayValue & { trend: number | null })[]
  daysWithData: number
  /** Days with data the detectors need; below it, `insights` is empty. */
  needed: number
  /** The window's median and middle half (25th–75th percentile); null without data. */
  normal: { median: number; low: number; high: number } | null
  insights: Insight[]
}

/** The API's daily buckets as one value per day (null for days without data). */
export const toDaily = (buckets: Bucket[]): DayValue[] =>
  buckets.map((b) => ({ day: b.start, value: b.daysWithData === 0 ? null : b.averagePerDay }))

// ---- Statistics ----

export const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length

export function quantile(xs: number[], q: number) {
  const s = [...xs].sort((a, b) => a - b)
  const pos = (s.length - 1) * q
  const lo = Math.floor(pos)
  const hi = Math.ceil(pos)
  return s[lo] + (s[hi] - s[lo]) * (pos - lo)
}

export const median = (xs: number[]) => quantile(xs, 0.5)

/** A standard-deviation-like spread that one bad night can't inflate: 1.4826 × MAD. */
export function spread(xs: number[]) {
  const m = median(xs)
  const mad = median(xs.map((x) => Math.abs(x - m)))
  if (mad > 0) return 1.4826 * mad
  const mu = mean(xs)
  return Math.sqrt(mean(xs.map((x) => (x - mu) ** 2)))
}

/** Standard normal CDF (Abramowitz & Stegun 7.1.26, error < 1.5e-7). */
export function normalCdf(z: number) {
  const t = 1 / (1 + (0.3275911 * Math.abs(z)) / Math.SQRT2)
  const poly = ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t
  const erf = 1 - poly * Math.exp((-z * z) / 2)
  return z >= 0 ? (1 + erf) / 2 : (1 - erf) / 2
}

/** Small seeded PRNG (mulberry32), so the permutation test gives the same answer every render. */
export function random(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

interface Point {
  /** Position in the window (0 = its first day), so missing days keep their spacing. */
  x: number
  weekday: number
  value: number
}

/** Each weekday's mean minus the overall mean; null for weekdays with fewer than 2 values. */
export function weekdayEffects(values: number[], weekdays: number[]) {
  const grand = mean(values)
  const sums = Array<number>(7).fill(0)
  const counts = Array<number>(7).fill(0)
  values.forEach((v, i) => {
    sums[weekdays[i]] += v
    counts[weekdays[i]]++
  })
  return sums.map((s, d) => (counts[d] >= 2 ? s / counts[d] - grand : null))
}

function effectRange(effects: (number | null)[]) {
  const known = effects.filter((e) => e !== null)
  return known.length < 2 ? 0 : Math.max(...known) - Math.min(...known)
}

/** Theil-Sen slope (median of pairwise slopes) per day, with its intercept. */
export function theilSen(points: { x: number; y: number }[]) {
  const slopes: number[] = []
  for (let i = 0; i < points.length; i++)
    for (let j = i + 1; j < points.length; j++) slopes.push((points[j].y - points[i].y) / (points[j].x - points[i].x))
  const slope = median(slopes)
  const intercept = median(points.map((p) => p.y - slope * p.x))
  return { slope, intercept }
}

/** Two-sided Mann-Kendall p-value for a monotonic trend, with the tie correction. */
function mannKendallP(points: { x: number; y: number }[]) {
  const n = points.length
  let s = 0
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) s += Math.sign(points[j].y - points[i].y)
  const ties = new Map<number, number>()
  points.forEach((p) => ties.set(p.y, (ties.get(p.y) ?? 0) + 1))
  let tieTerm = 0
  ties.forEach((t) => (tieTerm += t * (t - 1) * (2 * t + 5)))
  const variance = (n * (n - 1) * (2 * n + 5) - tieTerm) / 18
  if (variance <= 0) return 1
  const z = (s - Math.sign(s)) / Math.sqrt(variance)
  return 2 * (1 - normalCdf(Math.abs(z)))
}

/** Mean of the non-null values in history[end - len + 1 .. end]; null if under half have data. */
function trailingMean(history: DayValue[], end: number, len: number) {
  const vals = history
    .slice(Math.max(0, end - len + 1), end + 1)
    .map((d) => d.value)
    .filter((v) => v !== null)
  return vals.length < len / 2 ? null : mean(vals)
}

// ---- Wording ----

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

/** A difference in the metric's unit, without a sign: "12 min", "3 pts", "1,200 steps". */
export function formatDelta(id: MetricId, delta: number) {
  const a = Math.abs(delta)
  switch (METRICS[id].unit) {
    case 'clock':
    case 'duration':
      return formatDuration(a)
    case 'score':
    case 'percent':
      return `${(Math.round(a * 10) / 10).toLocaleString()} pts`
    case 'celsius':
      return `${a.toFixed(2)} °C`
    case 'steps':
      return `${formatNumber(Math.round(a))} steps`
    default:
      return METRICS[id].formatValue(a)
  }
}

/** "higher"/"lower", or for clock times "later"/"earlier", durations "longer"/"shorter". */
export function comparative(id: MetricId, up: boolean) {
  const unit = METRICS[id].unit
  if (unit === 'clock') return up ? 'later' : 'earlier'
  if (unit === 'duration') return up ? 'longer' : 'shorter'
  return up ? 'higher' : 'lower'
}

function superlative(id: MetricId, up: boolean) {
  const unit = METRICS[id].unit
  if (unit === 'clock') return up ? 'latest' : 'earliest'
  if (unit === 'duration') return up ? 'longest' : 'shortest'
  return up ? 'highest' : 'lowest'
}

export const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

export function toneOf(id: MetricId, up: boolean): Tone {
  const better = BETTER[id]
  if (!better) return 'neutral'
  return (better === 'higher') === up ? 'good' : 'bad'
}

// ---- Detectors ----

interface Context {
  id: MetricId
  frame: Timeframe
  window: DayValue[]
  points: Point[]
  values: number[]
  sd: number
  format: (v: number) => string
}

/** 1. The recent days against the window's earlier days, measured in the user's own spread. */
function baselineInsight({ id, frame, points, sd, format }: Context): Insight | null {
  const cut = frame.days - frame.recentDays
  const recent = points.filter((p) => p.x >= cut).map((p) => p.value)
  const prior = points.filter((p) => p.x < cut).map((p) => p.value)
  if (recent.length < frame.recentDays / 2 || prior.length < cut / 2) return null
  const normal = median(prior)
  const priorSd = spread(prior) || sd
  const effect = (mean(recent) - normal) / priorSd
  // The recent mean of n days varies by sd/√n, so a smaller effect can still be real.
  if (Math.abs(effect) < 0.5 || Math.abs(effect) * Math.sqrt(recent.length) < 2) return null
  const up = effect > 0
  const delta = mean(recent) - normal
  return {
    kind: 'baseline',
    tone: toneOf(id, up),
    direction: up ? 'up' : 'down',
    title: `${capitalize(comparative(id, up))} than your normal`,
    detail:
      `Your last ${frame.recentDays} days averaged ${format(mean(recent))}, ${formatDelta(id, delta)} ${comparative(id, up)} ` +
      `than the ${cut} days before (${format(normal)}, usually ${format(quantile(prior, 0.25))}–${format(quantile(prior, 0.75))}).`,
    score: 1.5 * Math.abs(effect),
  }
}

/** 2 and 5. A monotonic trend after taking out the weekly rhythm. Returns the fitted line too. */
function trendInsight(
  { id, frame, points, sd }: Context,
  effects: (number | null)[],
): { insight: Insight | null; line: { slope: number; intercept: number } | null } {
  const adjusted = points.map((p) => ({ x: p.x, y: p.value - (effects[p.weekday] ?? 0) }))
  const p = mannKendallP(adjusted)
  const { slope, intercept } = theilSen(adjusted)
  const change = slope * (frame.days - 1)
  if (p >= TREND_P || Math.abs(change) < 0.5 * sd) return { insight: null, line: null }
  const up = change > 0
  return {
    insight: {
      kind: 'trend',
      tone: toneOf(id, up),
      direction: up ? 'up' : 'down',
      title: METRICS[id].unit === 'clock' ? `Trending ${comparative(id, up)}` : up ? 'Trending up' : 'Trending down',
      detail:
        `About ${formatDelta(id, change)} ${comparative(id, up)} over ${frame.days} days ` +
        `(${formatDelta(id, slope * 7)} a week), allowing for your weekly rhythm.`,
      score: 2 * (Math.abs(change) / sd),
    },
    line: { slope, intercept },
  }
}

/** 3. The short average crossing the long one recently, after holding the other side a while. */
function momentumInsight({ id, frame, sd }: Context, history: DayValue[]): Insight | null {
  const { short, long, lookback } = frame.momentum
  const last = history.length - 1
  const diffAt = (i: number) => {
    const s = trailingMean(history, i, short)
    const l = trailingMean(history, i, long)
    return s === null || l === null ? null : s - l
  }
  const diffs = new Map<number, number | null>()
  for (let i = last - lookback - HELD_DAYS; i <= last; i++) diffs.set(i, i >= 0 ? diffAt(i) : null)
  const now = diffs.get(last)
  if (now == null || Math.abs(now) < 0.2 * sd) return null
  // The most recent crossing within the lookback, with the days before it on the other side.
  for (let c = last; c > last - lookback; c--) {
    const at = diffs.get(c)
    const before = Array.from({ length: HELD_DAYS }, (_, k) => diffs.get(c - k - 1))
    if (at == null || Math.sign(at) !== Math.sign(now)) continue
    if (before.every((b) => b != null && Math.sign(b) === -Math.sign(now))) {
      const up = now > 0
      return {
        kind: 'momentum',
        tone: toneOf(id, up),
        direction: up ? 'up' : 'down',
        title: METRICS[id].unit === 'clock' ? `Shifting ${comparative(id, up)}` : up ? 'Turning up' : 'Turning down',
        detail:
          `Your ${short}-day average crossed ${up ? 'above' : 'below'} your ${long}-day average on ${shortDay(history[c].day)} ` +
          `and is now ${formatDelta(id, now)} ${comparative(id, up)}.`,
        score: 1 + Math.abs(now) / sd,
      }
    }
  }
  return null
}

/** 5. A weekday pattern that a permutation test says isn't chance. */
function weeklyInsight({ id, points, values, sd }: Context, effects: (number | null)[]): Insight | null {
  const observed = effectRange(effects)
  if (observed < 0.5 * sd) return null
  const weekdays = points.map((p) => p.weekday)
  const rand = random(points.length * 7919)
  const shuffled = [...values]
  let atLeast = 0
  for (let k = 0; k < PERMUTATIONS; k++) {
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1))
      ;[shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]
    }
    if (effectRange(weekdayEffects(shuffled, weekdays)) >= observed) atLeast++
  }
  if ((atLeast + 1) / (PERMUTATIONS + 1) >= WEEKLY_P) return null
  const known = effects.map((e, d) => ({ e, d })).filter((x): x is { e: number; d: number } => x.e !== null)
  const hi = known.reduce((a, b) => (b.e > a.e ? b : a))
  const lo = known.reduce((a, b) => (b.e < a.e ? b : a))
  return {
    kind: 'weekly',
    tone: 'neutral',
    direction: null,
    title: 'Weekly rhythm',
    detail:
      `${capitalize(superlative(id, true))} on ${WEEKDAYS[hi.d]}s (${formatDelta(id, hi.e)} ${comparative(id, true)}) and ` +
      `${superlative(id, false)} on ${WEEKDAYS[lo.d]}s (${formatDelta(id, lo.e)} ${comparative(id, false)}) than your average.`,
    score: observed / sd,
  }
}

/** 7. Consecutive recent days on the better side of the window's median. */
function streakInsight({ id, frame, points, values, format }: Context): Insight | null {
  const better = BETTER[id]
  if (!better || points.length === 0) return null
  const med = median(values)
  const good = (v: number) => (better === 'higher' ? v > med : v < med)
  // Missing days don't break a streak; they just don't count toward it.
  let longest = 0
  let run = 0
  for (const p of points) {
    run = good(p.value) ? run + 1 : 0
    longest = Math.max(longest, run)
  }
  const lastPoint = points[points.length - 1]
  if (run < frame.minStreak || lastPoint.x < frame.days - 3) return null
  const side = better === 'higher' ? 'above' : 'below'
  return {
    kind: 'streak',
    tone: 'good',
    direction: better === 'higher' ? 'up' : 'down',
    title: `${run}-day streak`,
    detail:
      `${run} days in a row ${side} your ${frame.days}-day median (${format(med)})` +
      (run === longest ? `, your longest in this period.` : `. Longest in this period: ${longest}.`),
    score: run / frame.minStreak,
  }
}

/** 7. One of the last 3 days is the window's highest or lowest. */
function recordInsight({ id, frame, window, points, format }: Context): Insight | null {
  const recent = points.filter((p) => p.x >= frame.days - 3)
  const earlier = points.filter((p) => p.x < frame.days - 3).map((p) => p.value)
  if (recent.length === 0 || earlier.length === 0) return null
  for (const up of [true, false]) {
    const best = recent.reduce((a, b) => (up ? (b.value > a.value ? b : a) : b.value < a.value ? b : a))
    const beats = up ? best.value > Math.max(...earlier) : best.value < Math.min(...earlier)
    if (!beats) continue
    return {
      kind: 'record',
      tone: toneOf(id, up),
      direction: up ? 'up' : 'down',
      title: `${capitalize(superlative(id, up))} in ${frame.days} days`,
      detail: `${format(best.value)} on ${shortDay(window[best.x].day)}.`,
      score: 1.2,
    }
  }
  return null
}

/**
 * Runs every detector on one metric for one timeframe. `history` is the metric's daily values,
 * oldest first, ending at the "as of" day and at least {@link HISTORY_DAYS} long.
 */
export function analyze(id: MetricId, frame: Timeframe, history: DayValue[]): MetricInsights {
  const window = history.slice(-frame.days)
  const points: Point[] = window.flatMap((d, x) =>
    d.value === null ? [] : [{ x, weekday: parseDay(d.day).getDay(), value: d.value }],
  )
  const values = points.map((p) => p.value)
  const needed = Math.ceil(frame.days * MIN_COVERAGE)
  const normal =
    values.length === 0 ? null : { median: median(values), low: quantile(values, 0.25), high: quantile(values, 0.75) }
  const result: MetricInsights = {
    metric: id,
    timeframe: frame,
    days: window.map((d) => ({ ...d, trend: null })),
    daysWithData: values.length,
    needed,
    normal,
    insights: [],
  }
  const sd = values.length ? spread(values) : 0
  if (values.length < needed || sd === 0) return result

  const ctx: Context = { id, frame, window, points, values, sd, format: METRICS[id].formatValue }
  const effects = weekdayEffects(
    values,
    points.map((p) => p.weekday),
  )
  const trend = trendInsight(ctx, effects)
  if (trend.line) {
    const { slope, intercept } = trend.line
    result.days = window.map((d, x) => ({ ...d, trend: intercept + slope * x }))
  }
  result.insights = [
    baselineInsight(ctx),
    trend.insight,
    momentumInsight(ctx, history),
    weeklyInsight(ctx, effects),
    streakInsight(ctx),
    recordInsight(ctx),
  ]
    .filter((i): i is Insight => i !== null)
    .sort((a, b) => b.score - a.score)
  return result
}
