import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type TooltipContentProps,
} from 'recharts'
import type { BatteryReading, Interval } from '../api'
import type { SeriesColor } from '../colors'
import { addDays, parseDay, tickLabel, toIso } from '../dates'

/** A gap between readings longer than this breaks the line, so missing data never reads as a level. */
const GAP_MS = 3 * 3_600_000
const MAX_TICKS = 12

type ChartPoint = { timestamp: number; level: number | null; reading: BatteryReading | null }

function toChartPoints(readings: BatteryReading[]): ChartPoint[] {
  const out: ChartPoint[] = []
  readings.forEach((r, i) => {
    const prev = readings[i - 1]
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

interface Props {
  readings: BatteryReading[]
  start: string
  end: string
  from: number
  to: number
  interval: Interval
  color: SeriesColor
}

/**
 * The battery percentage Oura reported, reading by reading, on a fixed 0–100% scale. The interval
 * sets where the time axis is labelled (each day, week, month or year).
 */
export function BatteryChart({ readings, start, end, from, to, interval, color }: Props) {
  const ticks = intervalTicks(start, end, interval)
  const labels = new Map(ticks.map((t) => [t.ms, t.iso]))
  const spansYears = parseDay(start).getFullYear() !== parseDay(end).getFullYear()

  return (
    <ResponsiveContainer width="100%" height={360}>
      <LineChart data={toChartPoints(readings)} margin={{ top: 16, right: 24, bottom: 0, left: 0 }}>
        <CartesianGrid vertical={false} stroke="var(--grid)" />
        <XAxis
          dataKey="timestamp"
          type="number"
          scale="time"
          domain={[from, to]}
          ticks={ticks.map((t) => t.ms)}
          tickFormatter={(ms: number) => tickLabel(labels.get(ms) ?? toIso(new Date(ms)), interval, spansYears)}
          tick={{ fill: 'var(--text-secondary)', fontSize: 12 }}
          axisLine={{ stroke: 'var(--axis)' }}
          tickLine={false}
          interval={0}
        />
        <YAxis
          domain={[0, 100]}
          ticks={[0, 25, 50, 75, 100]}
          tickFormatter={(v: number) => `${v}%`}
          tick={{ fill: 'var(--text-secondary)', fontSize: 12 }}
          axisLine={false}
          tickLine={false}
          width={52}
        />
        <Tooltip
          cursor={{ stroke: 'var(--axis)' }}
          content={(props: TooltipContentProps) => <BatteryTooltip {...props} color={color} />}
          isAnimationActive={false}
        />
        <Line
          dataKey="level"
          name="Battery"
          type="linear"
          stroke={color.fill}
          strokeWidth={2}
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

function BatteryTooltip({ active, payload, color }: TooltipContentProps & { color: SeriesColor }) {
  const r = (payload?.[0]?.payload as ChartPoint | undefined)?.reading
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
