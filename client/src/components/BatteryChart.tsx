import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type TooltipContentProps,
} from 'recharts'
import type { BatteryBucket, BatteryReading, Interval } from '../api'
import type { SeriesColor } from '../colors'
import { addDays, bucketLabel, formatNumber, parseDay, tickLabel, toIso } from '../dates'

/**
 * Ranges up to this many days chart every reading. Past it a reading-by-reading line is a solid
 * smear (a ring charges every day or two), so each period's average, lowest and highest are drawn.
 */
export const MAX_READING_DAYS = 31

const daysIn = (start: string, end: string) =>
  Math.round((parseDay(end).getTime() - parseDay(start).getTime()) / 86_400_000) + 1

export const showsReadings = (start: string, end: string) => daysIn(start, end) <= MAX_READING_DAYS

/** More periods than this can't be told apart on one chart (a year of days is a smear). */
const MAX_PERIODS = 120
const COARSER: Partial<Record<Interval, Interval>> = { daily: 'weekly', weekly: 'monthly', monthly: 'yearly' }
const DAYS_PER: Record<Interval, number> = { daily: 1, weekly: 7, monthly: 30.4, yearly: 365.25 }

/** The chosen interval, or the next coarser one until the range fits in {@link MAX_PERIODS} periods. */
export function chartInterval(start: string, end: string, interval: Interval): Interval {
  const days = daysIn(start, end)
  let i = interval
  while (days / DAYS_PER[i] > MAX_PERIODS && COARSER[i]) i = COARSER[i]!
  return i
}

/** A gap between readings longer than this breaks the line, so missing data never reads as a level. */
const GAP_MS = 3 * 3_600_000
const MAX_TICKS = 12

const Y_AXIS = {
  domain: [0, 100] as [number, number],
  ticks: [0, 25, 50, 75, 100],
  tickFormatter: (v: number) => `${v}%`,
  tick: { fill: 'var(--text-secondary)', fontSize: 12 },
  axisLine: false,
  tickLine: false,
  width: 52,
}

const X_TICK = { fill: 'var(--text-secondary)', fontSize: 12 }

/** Round joins and caps keep a dense line from looking jagged. */
const LINE_STYLE = { strokeWidth: 2, strokeLinejoin: 'round' as const, strokeLinecap: 'round' as const }

interface Props {
  readings: BatteryReading[]
  buckets: BatteryBucket[]
  start: string
  end: string
  from: number
  to: number
  interval: Interval
  color: SeriesColor
}

/** Battery % on a fixed 0–100% scale: every reading for short ranges, period averages for long ones. */
export function BatteryChart(props: Props) {
  return showsReadings(props.start, props.end) ? <ReadingsChart {...props} /> : <BucketsChart {...props} />
}

// ---- Every reading ------------------------------------------------------------------------------

type ReadingPoint = { timestamp: number; level: number | null; reading: BatteryReading | null }

/** A run at one level lasting longer than this is a real plateau, kept flat end to end. */
const PLATEAU_MS = 2 * 3_600_000

/**
 * Levels are whole percents, so a slow drain arrives as stairs: several readings at 30%, then
 * several at 29%. Drawing through every reading makes the line look pixelated. Instead each short
 * run of equal readings is drawn as its middle reading, so the line slopes through the centre of
 * each step; long plateaus keep their first and last reading. Every point drawn is still a reading
 * Oura reported.
 */
function smoothRuns(readings: BatteryReading[]): BatteryReading[] {
  const out: BatteryReading[] = []
  for (let i = 0; i < readings.length; ) {
    let j = i
    while (
      j + 1 < readings.length &&
      readings[j + 1].level === readings[i].level &&
      readings[j + 1].timestamp - readings[j].timestamp <= GAP_MS
    )
      j++
    const first = readings[i]
    const last = readings[j]
    if (last.timestamp - first.timestamp > PLATEAU_MS) out.push(first, last)
    else out.push(readings[Math.floor((i + j) / 2)])
    i = j + 1
  }
  return out
}

function toReadingPoints(readings: BatteryReading[]): ReadingPoint[] {
  const smoothed = smoothRuns(readings)
  const out: ReadingPoint[] = []
  smoothed.forEach((r, i) => {
    const prev = smoothed[i - 1]
    if (prev && r.timestamp - prev.timestamp > GAP_MS) {
      out.push({ timestamp: prev.timestamp + 1, level: null, reading: null })
    }
    out.push({ timestamp: r.timestamp, level: r.level, reading: r })
  })
  return out
}

const startOf = (iso: string, interval: Interval) => {
  const d = parseDay(iso)
  if (interval === 'weekly') d.setDate(d.getDate() - ((d.getDay() + 6) % 7)) // ISO weeks start Monday
  if (interval === 'monthly') d.setDate(1)
  if (interval === 'yearly') d.setMonth(0, 1)
  return toIso(d)
}

const next = (iso: string, interval: Interval) => {
  if (interval === 'daily') return addDays(iso, 1)
  if (interval === 'weekly') return addDays(iso, 7)
  const d = parseDay(iso)
  if (interval === 'monthly') d.setMonth(d.getMonth() + 1, 1)
  else d.setFullYear(d.getFullYear() + 1, 0, 1)
  return toIso(d)
}

/** Ticks at each day, week, month or year boundary in the range, thinned to stay readable. */
function intervalTicks(start: string, end: string, interval: Interval) {
  const days: string[] = []
  for (let d = startOf(start, interval); d <= end; d = next(d, interval)) if (d >= start) days.push(d)
  if (days.length === 0) days.push(start)
  const step = Math.ceil(days.length / MAX_TICKS)
  return days.filter((_, i) => i % step === 0).map((iso) => ({ iso, ms: new Date(`${iso}T00:00:00`).getTime() }))
}

function ReadingsChart({ readings, start, end, from, to, interval, color }: Props) {
  const ticks = intervalTicks(start, end, interval)
  const labels = new Map(ticks.map((t) => [t.ms, t.iso]))
  const spansYears = parseDay(start).getFullYear() !== parseDay(end).getFullYear()

  return (
    <ResponsiveContainer width="100%" height={360}>
      <LineChart data={toReadingPoints(readings)} margin={{ top: 16, right: 24, bottom: 0, left: 0 }}>
        <CartesianGrid vertical={false} stroke="var(--grid)" />
        <XAxis
          dataKey="timestamp"
          type="number"
          scale="time"
          domain={[from, to]}
          ticks={ticks.map((t) => t.ms)}
          tickFormatter={(ms: number) => tickLabel(labels.get(ms) ?? toIso(new Date(ms)), interval, spansYears)}
          tick={X_TICK}
          axisLine={{ stroke: 'var(--axis)' }}
          tickLine={false}
          interval={0}
        />
        <YAxis {...Y_AXIS} />
        <Tooltip
          cursor={{ stroke: 'var(--axis)' }}
          content={(p: TooltipContentProps) => <ReadingTooltip {...p} color={color} />}
          isAnimationActive={false}
        />
        <Line
          dataKey="level"
          name="Battery"
          // Monotone smooths the corners without overshooting past 0% or 100%.
          type="monotone"
          stroke={color.fill}
          {...LINE_STYLE}
          dot={false}
          activeDot={{ r: 4, fill: color.active, stroke: 'var(--surface-1)' }}
          connectNulls={false}
          isAnimationActive={false}
        />
      </LineChart>
    </ResponsiveContainer>
  )
}

const readingTime = new Intl.DateTimeFormat(undefined, {
  weekday: 'short',
  month: 'short',
  day: 'numeric',
  year: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
})

function ReadingTooltip({ active, payload, color }: TooltipContentProps & { color: SeriesColor }) {
  const r = (payload?.[0]?.payload as ReadingPoint | undefined)?.reading
  if (!active || !r) return null
  return (
    <div className="tooltip" role="status">
      <div className="tooltip-title">{readingTime.format(new Date(r.timestamp))}</div>
      <div className="tooltip-row">
        <span className="swatch" style={{ background: color.fill }} aria-hidden />
        <span>Battery</span>
        <strong>{r.level}%</strong>
      </div>
    </div>
  )
}

// ---- Period averages ----------------------------------------------------------------------------

/** Recharts draws a band when an Area's value is a [low, high] pair. */
const lowHigh = (b: BatteryBucket) => (b.minLevel === null || b.maxLevel === null ? null : [b.minLevel, b.maxLevel])

function BucketsChart({ buckets, interval, color }: Props) {
  const first = buckets[0]?.start
  const last = buckets.at(-1)?.start
  const spansYears = !!first && !!last && parseDay(first).getFullYear() !== parseDay(last).getFullYear()

  return (
    <ResponsiveContainer width="100%" height={360}>
      <ComposedChart data={buckets} margin={{ top: 16, right: 24, bottom: 0, left: 0 }}>
        <CartesianGrid vertical={false} stroke="var(--grid)" />
        <XAxis
          dataKey="start"
          tickFormatter={(v: string) => tickLabel(v, interval, spansYears)}
          tick={X_TICK}
          axisLine={{ stroke: 'var(--axis)' }}
          tickLine={false}
          minTickGap={24}
        />
        <YAxis {...Y_AXIS} />
        <Tooltip
          cursor={{ stroke: 'var(--axis)' }}
          content={(p: TooltipContentProps) => <BucketTooltip {...p} interval={interval} color={color} />}
          isAnimationActive={false}
        />
        <Area
          dataKey={lowHigh}
          name="Lowest – highest"
          type="monotone"
          stroke="none"
          fill={color.fill}
          fillOpacity={0.16}
          connectNulls={false}
          activeDot={false}
          isAnimationActive={false}
        />
        <Line
          dataKey="averageLevel"
          name="Average"
          type="monotone"
          stroke={color.fill}
          {...LINE_STYLE}
          // Dots mark each period while there are few enough to tell apart.
          dot={buckets.length <= 60 ? { r: 3, fill: color.fill, strokeWidth: 0 } : false}
          activeDot={{ r: 4, fill: color.active, stroke: 'var(--surface-1)' }}
          connectNulls={false}
          isAnimationActive={false}
        />
      </ComposedChart>
    </ResponsiveContainer>
  )
}

function BucketTooltip({
  active,
  payload,
  interval,
  color,
}: TooltipContentProps & { interval: Interval; color: SeriesColor }) {
  if (!active || !payload?.length) return null
  const b = payload[0].payload as BatteryBucket
  return (
    <div className="tooltip" role="status">
      <div className="tooltip-title">{bucketLabel(b.start, b.end, interval)}</div>
      {b.averageLevel === null ? (
        <div className="tooltip-muted">No readings</div>
      ) : (
        <>
          <div className="tooltip-row">
            <span className="swatch" style={{ background: color.fill }} aria-hidden />
            <span>Average</span>
            <strong>{Math.round(b.averageLevel)}%</strong>
          </div>
          <div className="tooltip-row">
            <span className="swatch" style={{ background: color.fill, opacity: 0.3 }} aria-hidden />
            <span>Lowest – highest</span>
            <strong>
              {b.minLevel}–{b.maxLevel}%
            </strong>
          </div>
          <div className="tooltip-muted">{formatNumber(b.readings)} readings</div>
        </>
      )}
    </div>
  )
}
