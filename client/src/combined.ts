import type { MetricId } from './api'
import { parseDay, shortDay } from './dates'
import {
  capitalize,
  comparative,
  formatDelta,
  mean,
  median,
  MIN_COVERAGE,
  normalCdf,
  quantile,
  random,
  spread,
  weekdayEffects,
  type DayValue,
  type Timeframe,
} from './insights'
import { METRICS } from './metrics'

/**
 * Pairs where one metric is computed partly from the other (Oura's scores from their
 * contributors), or one is part of the other. They move together by construction, so a link
 * between them is shown as built in rather than as a finding.
 */
const BUILT_IN: { metric: MetricId; parts: MetricId[]; why: string }[] = [
  {
    metric: 'readinessScore',
    parts: ['sleepAverageHrv', 'sleepLowestHeartRate', 'temperatureDeviation', 'sleepScore', 'activityScore'],
    why: 'Oura’s {metric} score is partly computed from your {part}',
  },
  {
    metric: 'sleepScore',
    parts: ['sleep', 'efficiency', 'remSleep', 'deepSleep', 'latency', 'awakeTime', 'bedtimeStart', 'timeInBed'],
    why: 'Oura’s {metric} is partly computed from your {part}',
  },
  {
    metric: 'activityScore',
    parts: ['steps', 'highActivityTime', 'mediumActivityTime', 'lowActivityTime', 'sedentaryTime', 'walkingDistance'],
    why: 'Oura’s {metric} is partly computed from your {part}',
  },
  { metric: 'sleep', parts: ['deepSleep', 'lightSleep', 'remSleep'], why: 'your {part} is part of your {metric}' },
  { metric: 'timeInBed', parts: ['sleep', 'awakeTime', 'latency'], why: 'your {part} is part of your {metric}' },
  { metric: 'steps', parts: ['walkingDistance'], why: 'walking distance is derived from steps' },
  { metric: 'sleepAverageHrv', parts: ['sleepMaxHrv'], why: 'both come from the same nightly HRV readings' },
  {
    metric: 'sleepAverageHeartRate',
    parts: ['sleepLowestHeartRate', 'sleepMaxHeartRate'],
    why: 'both come from the same nightly heart rate readings',
  },
  { metric: 'heartRate', parts: ['heartRateMin', 'heartRateMax'], why: 'both come from the same 24h heart rate' },
]

/** A metric's name mid-sentence: "deep sleep", "steps", but "HRV" and "REM sleep" keep their capitals. */
const noun = (id: MetricId) => {
  const label = METRICS[id].label
  return /^[A-Z][a-z]/.test(label) ? label.charAt(0).toLowerCase() + label.slice(1) : label
}

/** Why two metrics are linked by construction, or undefined when they aren't. */
export function builtIn(a: MetricId, b: MetricId) {
  const rule = BUILT_IN.find((r) => (r.metric === a && r.parts.includes(b)) || (r.metric === b && r.parts.includes(a)))
  if (!rule) return undefined
  const part = rule.metric === a ? b : a
  return rule.why.replace('{metric}', noun(rule.metric)).replace('{part}', noun(part))
}

/** Overnight readings and the morning scores Oura gives for that night, recorded on the waking day. */
const MORNING = new Set<MetricId>(['sleepScore', 'readinessScore', 'temperatureDeviation', 'temperatureTrendDeviation'])
const isNightly = (id: MetricId) => METRICS[id].dayNoun === 'nights' || MORNING.has(id)

/** Lead/lag offsets tried, in record days. */
const LAGS = [1, 2]
/** Family-wise error rate, split across each kind's tests (Bonferroni). */
const ALPHA = 0.05
/** The weakest link worth reporting, whatever its p-value. */
const MIN_RHO = 0.2
/** A turning point must shift the level by this many of the metric's usual spread. */
const MIN_SHIFT = 0.75
const SHIFT_P = 0.01
const SHIFT_PERMUTATIONS = 199

/**
 * One metric's window with its trend and weekday pattern taken out, so two metrics that both
 * drift up, or both dip on Sundays, don't look linked. Null without enough data.
 */
interface Prepared {
  id: MetricId
  raw: (number | null)[]
  /** Raw value minus weekday effect: what turning points are found on. */
  adjusted: (number | null)[]
  /**
   * Adjusted value minus its rolling median: the day-to-day wobble that links are measured on.
   * A rolling baseline (not one trend line) also takes out level shifts, which would otherwise
   * make two metrics that shifted together look linked every day.
   */
  residual: (number | null)[]
  sd: number
}

/** Median of the values within `half` days either side of each day. */
function rollingMedian(xs: (number | null)[], half: number) {
  return xs.map((_, x) => {
    const near = xs.slice(Math.max(0, x - half), x + half + 1).filter((v) => v !== null)
    return near.length ? median(near) : null
  })
}

function prepare(id: MetricId, window: DayValue[]): Prepared | null {
  const points = window.flatMap((d, x) => (d.value === null ? [] : [{ x, weekday: parseDay(d.day).getDay(), value: d.value }]))
  if (points.length < Math.ceil(window.length * MIN_COVERAGE)) return null
  const values = points.map((p) => p.value)
  const sd = spread(values)
  if (sd === 0) return null
  const effects = weekdayEffects(
    values,
    points.map((p) => p.weekday),
  )
  const adjusted: (number | null)[] = window.map(() => null)
  points.forEach((p) => (adjusted[p.x] = p.value - (effects[p.weekday] ?? 0)))
  const baseline = rollingMedian(adjusted, window.length >= 90 ? 7 : 5)
  return {
    id,
    raw: window.map((d) => d.value),
    adjusted,
    residual: adjusted.map((v, x) => (v === null || baseline[x] === null ? null : v - baseline[x]!)),
    sd,
  }
}

// ---- Correlation ----

/** Ranks, with ties sharing their average rank. */
function ranks(xs: number[]) {
  const order = xs.map((v, i) => ({ v, i })).sort((a, b) => a.v - b.v)
  const r = Array<number>(xs.length)
  for (let i = 0; i < order.length; ) {
    let j = i
    while (j + 1 < order.length && order[j + 1].v === order[i].v) j++
    for (let k = i; k <= j; k++) r[order[k].i] = (i + j) / 2
    i = j + 1
  }
  return r
}

function pearson(xs: number[], ys: number[]) {
  const mx = mean(xs)
  const my = mean(ys)
  let sxy = 0
  let sxx = 0
  let syy = 0
  xs.forEach((x, i) => {
    sxy += (x - mx) * (ys[i] - my)
    sxx += (x - mx) ** 2
    syy += (ys[i] - my) ** 2
  })
  return sxx === 0 || syy === 0 ? 0 : sxy / Math.sqrt(sxx * syy)
}

/** Lag-1 autocorrelation over consecutive days that both have data. */
function lag1(xs: (number | null)[]) {
  const a: number[] = []
  const b: number[] = []
  for (let i = 1; i < xs.length; i++) {
    if (xs[i - 1] !== null && xs[i] !== null) {
      a.push(xs[i - 1]!)
      b.push(xs[i]!)
    }
  }
  return a.length < 5 ? 0 : pearson(a, b)
}

interface Correlation {
  rho: number
  p: number
  n: number
  /** Window positions of the leader's days in each pair, for the before/after split. */
  leaderAt: number[]
  leader: number[]
  follower: number[]
}

/**
 * Spearman correlation of a[x] with b[x + lag]. Daily values are autocorrelated, which makes
 * plain p-values too small, so the test uses an effective sample size (Bartlett):
 * n × (1 − r₁ᵃr₁ᵇ) / (1 + r₁ᵃr₁ᵇ).
 */
function correlate(a: (number | null)[], b: (number | null)[], lag: number): Correlation | null {
  const leaderAt: number[] = []
  const leader: number[] = []
  const follower: number[] = []
  for (let x = 0; x + lag < a.length; x++) {
    if (a[x] !== null && b[x + lag] !== null) {
      leaderAt.push(x)
      leader.push(a[x]!)
      follower.push(b[x + lag]!)
    }
  }
  const n = leader.length
  if (n < 12) return null
  const rho = pearson(ranks(leader), ranks(follower))
  const r1 = Math.max(0, lag1(a) * lag1(b))
  const nEff = Math.max(4, (n * (1 - r1)) / (1 + r1))
  const z = Math.atanh(Math.min(0.999999, Math.abs(rho))) * Math.sqrt(nEff - 3)
  return { rho, p: 2 * (1 - normalCdf(z)), n, leaderAt, leader, follower }
}

// ---- Links between two metrics ----

export interface Link {
  kind: 'together' | 'leads'
  leader: MetricId
  follower: MetricId
  /** Record days from the leader's value to the follower's (0 for the same day). */
  lag: number
  rho: number
  n: number
  title: string
  /** One line: "More high stress time → 1h 27m more sleep the next night". */
  summary: string
  /**
   * The follower's average after the leader's top third, then after its bottom third, for a
   * side-by-side comparison. Absent when the split disagrees with the correlation.
   */
  compare?: { label: string; value: number; text: string }[]
  /** "Strong link · 27 days". */
  strength: string
  /** Set when the two are linked by construction; such links are listed after real ones. */
  builtIn?: string
  score: number
}

export interface PairLinks {
  a: MetricId
  b: MetricId
  links: Link[]
  /** Set when one or both metrics lacked data, instead of links. */
  missing?: string
}

/** "more"/"less" for amounts (durations, steps, distance), "later"/"earlier" for clock times, else "higher"/"lower". */
function more(id: MetricId, up: boolean) {
  const unit = METRICS[id].unit
  if (unit === 'clock') return up ? 'later' : 'earlier'
  if (unit === 'steps') return up ? 'more' : 'fewer'
  if (unit === 'duration' || unit === 'meters') return up ? 'more' : 'less'
  return up ? 'higher' : 'lower'
}

const strength = (rho: number) => (Math.abs(rho) >= 0.5 ? 'Strong' : Math.abs(rho) >= 0.3 ? 'Moderate' : 'Weak')

/** When the follower's value comes, from the leader's: "that night", "the next day", "2 days later". */
function timing(leader: MetricId, follower: MetricId, lag: number) {
  if (lag === 0) return 'that day'
  if (isNightly(follower)) {
    const nights = lag - (isNightly(leader) ? 0 : 1)
    // Scores are given in the morning; sleep readings belong to the night before it.
    return MORNING.has(follower)
      ? ['that morning', 'the next morning', '2 mornings later'][nights]
      : ['that night', 'the next night', '2 nights later'][nights]
  }
  return lag === 1 ? 'the next day' : `${lag} days later`
}

/**
 * The follower's own average on days after the leader's top third vs. its bottom third (thirds
 * of the leader's residual, so "higher than usual for you"). Null if the split disagrees with
 * the correlation's sign, which can happen when the relationship is weak.
 */
function split(c: Correlation, follower: Prepared, lag: number, rho: number) {
  const lo = quantile(c.leader, 1 / 3)
  const hi = quantile(c.leader, 2 / 3)
  const raw = (i: number) => follower.raw[c.leaderAt[i] + lag]!
  const high = c.leader.flatMap((v, i) => (v >= hi ? [raw(i)] : []))
  const low = c.leader.flatMap((v, i) => (v <= lo ? [raw(i)] : []))
  if (high.length < 3 || low.length < 3) return null
  const h = mean(high)
  const l = mean(low)
  return Math.sign(h - l) === Math.sign(rho) ? { high: h, low: l } : null
}

function describe(kind: Link['kind'], c: Correlation, leader: Prepared, follower: Prepared, lag: number): Link | null {
  const L = METRICS[leader.id]
  const F = METRICS[follower.id]
  const s = split(c, follower, lag, c.rho)
  const when = timing(leader.id, follower.id, lag)
  const why = builtIn(leader.id, follower.id)
  const followerWhen = kind === 'together' ? 'that day' : when
  // "More high stress time → 1h 27m more sleep the next night"; "higher" for scores.
  const up = c.rho > 0
  const summary = s
    ? `${capitalize(more(leader.id, true))} ${noun(leader.id)} → ${formatDelta(follower.id, s.high - s.low)} ` +
      `${more(follower.id, s.high > s.low)} ${noun(follower.id)} ${followerWhen}`
    : `${capitalize(more(leader.id, true))} ${noun(leader.id)} → ${more(follower.id, up)} ${noun(follower.id)} ${followerWhen}`
  const on = kind === 'together' ? 'Days with' : 'After'
  return {
    kind,
    leader: leader.id,
    follower: follower.id,
    lag,
    rho: c.rho,
    n: c.n,
    title:
      kind === 'together'
        ? up
          ? 'Move together'
          : 'Move in opposite directions'
        : `${L.label} → ${F.label} ${when}`,
    summary,
    compare: s
      ? [
          { label: `${on} ${more(leader.id, true)} ${noun(leader.id)}`, value: s.high, text: F.formatValue(s.high) },
          { label: `${on} ${more(leader.id, false)} ${noun(leader.id)}`, value: s.low, text: F.formatValue(s.low) },
        ]
      : undefined,
    strength: `${strength(c.rho)} link · ${c.n} days`,
    builtIn: why,
    score: Math.abs(c.rho) * (why ? 0.25 : 1),
  }
}

/** Options 1–3 for one pair: the same-day link and the strongest lead in either direction. */
function pairLinks(a: Prepared, b: Prepared, testsPerKind: { together: number; leads: number }): Link[] {
  const links: Link[] = []
  const same = correlate(a.residual, b.residual, 0)
  if (same && Math.abs(same.rho) >= MIN_RHO && same.p < ALPHA / testsPerKind.together) {
    const link = describe('together', same, a, b, 0)
    if (link) links.push(link)
  }
  let best: { c: Correlation; leader: Prepared; follower: Prepared; lag: number } | null = null
  for (const [leader, follower] of [
    [a, b],
    [b, a],
  ]) {
    for (const lag of LAGS) {
      const c = correlate(leader.residual, follower.residual, lag)
      if (!c || Math.abs(c.rho) < MIN_RHO || c.p >= ALPHA / testsPerKind.leads) continue
      if (!best || c.p < best.c.p) best = { c, leader, follower, lag }
    }
  }
  if (best) {
    const link = describe('leads', best.c, best.leader, best.follower, best.lag)
    if (link) links.push(link)
  }
  return links.sort((x, y) => y.score - x.score)
}

// ---- Shared turning points ----

interface Shift {
  metric: MetricId
  x: number
  before: number
  after: number
}

/** The split of points into before/after with the largest Welch t, using prefix sums. */
function bestSplit(ys: number[], minSeg: number) {
  const n = ys.length
  const sum = [0]
  const sq = [0]
  ys.forEach((y, i) => {
    sum.push(sum[i] + y)
    sq.push(sq[i] + y * y)
  })
  let best = { at: -1, t: 0 }
  for (let k = minSeg; k <= n - minSeg; k++) {
    const n1 = k
    const n2 = n - k
    const m1 = sum[k] / n1
    const m2 = (sum[n] - sum[k]) / n2
    const v1 = Math.max(1e-12, (sq[k] - n1 * m1 * m1) / (n1 - 1))
    const v2 = Math.max(1e-12, (sq[n] - sq[k] - n2 * m2 * m2) / (n2 - 1))
    const t = Math.abs(m2 - m1) / Math.sqrt(v1 / n1 + v2 / n2)
    if (t > best.t) best = { at: k, t }
  }
  return best
}

/**
 * Level shifts in one metric (trend kept, weekday pattern removed): binary segmentation, up to
 * two splits, each needing a permutation test on the max t and a shift of {@link MIN_SHIFT} spreads.
 */
function turningPoints(p: Prepared, minSeg: number): Shift[] {
  const pts = p.adjusted.flatMap((y, x) => (y === null ? [] : [{ x, y }]))
  const shifts: Shift[] = []
  const rand = random(pts.length * 104729)
  const search = (seg: { x: number; y: number }[], depth: number) => {
    if (depth > 2 || seg.length < 2 * minSeg) return
    const ys = seg.map((q) => q.y)
    const { at, t } = bestSplit(ys, minSeg)
    if (at < 0) return
    const before = median(ys.slice(0, at))
    const after = median(ys.slice(at))
    if (Math.abs(after - before) < MIN_SHIFT * p.sd) return
    const shuffled = [...ys]
    let atLeast = 0
    for (let k = 0; k < SHIFT_PERMUTATIONS; k++) {
      for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(rand() * (i + 1))
        ;[shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]
      }
      if (bestSplit(shuffled, minSeg).t >= t) atLeast++
    }
    if ((atLeast + 1) / (SHIFT_PERMUTATIONS + 1) >= SHIFT_P) return
    shifts.push({ metric: p.id, x: seg[at].x, before, after })
    search(seg.slice(0, at), depth + 1)
    search(seg.slice(at), depth + 1)
  }
  search(pts, 1)
  return shifts
}

export interface SharedShift {
  /** The day the shift starts (median of the metrics' own turning points). */
  day: string
  x: number
  members: { metric: MetricId; before: number; after: number }[]
  title: string
  detail: string
}

/** Turning points of two or more metrics within a few days of each other. */
function sharedShifts(prepared: Prepared[], window: DayValue[], frame: Timeframe): SharedShift[] {
  const minSeg = frame.days >= 90 ? 10 : 7
  const tolerance = frame.days >= 90 ? 5 : 3
  const all = prepared.flatMap((p) => turningPoints(p, minSeg)).sort((a, b) => a.x - b.x)
  const groups: Shift[][] = []
  for (const s of all) {
    const g = groups.find((grp) => grp.every((m) => m.metric !== s.metric && Math.abs(m.x - s.x) <= tolerance))
    if (g) g.push(s)
    else groups.push([s])
  }
  return groups
    .filter((g) => g.length >= 2)
    .map((g) => {
      const x = Math.round(median(g.map((s) => s.x)))
      const day = window[x].day
      const parts = g.map((s) => {
        const up = s.after > s.before
        const verb = METRICS[s.metric].unit === 'clock' ? `moved ${comparative(s.metric, up)}` : up ? 'rose' : 'dropped'
        return `${METRICS[s.metric].label} ${verb} ${formatDelta(s.metric, s.after - s.before)} (${METRICS[s.metric].formatValue(s.before)} → ${METRICS[s.metric].formatValue(s.after)})`
      })
      return {
        day,
        x,
        members: g.map(({ metric, before, after }) => ({ metric, before, after })),
        title: `Shared turning point around ${shortDay(day)}`,
        detail: `${capitalize(parts.join('; '))}. Worth asking what changed then.`,
      }
    })
}

// ---- Entry point ----

export interface CombinedInsights {
  pairs: PairLinks[]
  shifts: SharedShift[]
  /** Metrics with too little data to compare. */
  skipped: MetricId[]
}

/** Options 1–4 across the chosen metrics for one timeframe. `histories` end at the "as of" day. */
export function analyzeCombined(ids: MetricId[], frame: Timeframe, histories: Partial<Record<MetricId, DayValue[]>>): CombinedInsights {
  const window = histories[ids[0]]!.slice(-frame.days)
  const prepared = new Map<MetricId, Prepared>()
  for (const id of ids) {
    const p = prepare(id, histories[id]!.slice(-frame.days))
    if (p) prepared.set(id, p)
  }
  const pairs: [MetricId, MetricId][] = []
  ids.forEach((a, i) => ids.slice(i + 1).forEach((b) => pairs.push([a, b])))
  const tests = { together: pairs.length, leads: pairs.length * 2 * LAGS.length }
  return {
    pairs: pairs.map(([a, b]) => {
      const pa = prepared.get(a)
      const pb = prepared.get(b)
      if (!pa || !pb)
        return { a, b, links: [], missing: `Not enough data for ${[!pa && METRICS[a].label, !pb && METRICS[b].label].filter(Boolean).join(' or ')}.` }
      return { a, b, links: pairLinks(pa, pb, tests) }
    }),
    shifts: sharedShifts([...prepared.values()], window, frame),
    skipped: ids.filter((id) => !prepared.has(id)),
  }
}

/** Each metric's 3- or 7-day average in units of its own spread, so all share one axis. */
export function standardized(ids: MetricId[], frame: Timeframe, histories: Partial<Record<MetricId, DayValue[]>>) {
  const smooth = frame.days >= 90 ? 7 : 3
  const windows = ids.map((id) => histories[id]!.slice(-frame.days))
  const stats = windows.map((w) => {
    const vals = w.map((d) => d.value).filter((v) => v !== null)
    return vals.length ? { med: median(vals), sd: spread(vals) || 1 } : null
  })
  return windows[0].map((d, x) => {
    const row: Record<string, number | string | null> = { day: d.day }
    ids.forEach((id, i) => {
      const s = stats[i]
      const vals = windows[i]
        .slice(Math.max(0, x - smooth + 1), x + 1)
        .map((v) => v.value)
        .filter((v) => v !== null)
      row[id] = s && vals.length ? (mean(vals) - s.med) / s.sd : null
    })
    return row
  })
}
