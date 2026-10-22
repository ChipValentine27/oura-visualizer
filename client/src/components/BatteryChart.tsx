import {
  Area,
  CartesianGrid,
  ComposedChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type TooltipContentProps,
} from 'recharts'
import type { BatteryPoint } from '../api'
import type { SeriesColor } from '../colors'

/** A point on the chart: `level` is null across gaps so the line breaks instead of bridging them. */
interface ChartPoint {
  timestamp: number
  level: number | null
  /** The level again, but only where the ring was charging, drawn over the main line. */
  charging: number | null
  point: BatteryPoint | null
}

const HOUR = 3_600_000
const DAY = 24 * HOUR

/**
 * Splits the line wherever samples are missing for longer than a few buckets (and at least
 * three hours, since Oura only samples every so often), so "no data" never reads as a level.
 */
function toChartPoints(points: BatteryPoint[], bucketMs: number): ChartPoint[] {
  const maxGap = Math.max(3 * bucketMs, 3 * HOUR)
  const out: ChartPoint[] = []
  points.forEach((p, i) => {
    const prev = points[i - 1]
    if (prev && p.timestamp - prev.timestamp > maxGap) {
      out.push({ timestamp: prev.timestamp + bucketMs, level: null, charging: null, point: null })
    }
    // Keep the charging trace joined to its neighbours so short charges still show as a stroke.
    const chargingEdge = p.charging || prev?.charging || points[i + 1]?.charging
    out.push({ timestamp: p.timestamp, level: p.level, charging: chargingEdge ? p.level : null, point: p })
  })
  return out
}

const fmt = (opts: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat(undefined, opts)
const timeOnly = fmt({ hour: 'numeric', minute: '2-digit' })
const dayTime = fmt({ month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
const dayMonth = fmt({ month: 'short', day: 'numeric' })
const dayMonthYear = fmt({ month: 'short', day: 'numeric', year: 'numeric' })

function tickFormatter(from: number, to: number) {
  const span = to - from
  const spansYears = new Date(from).getFullYear() !== new Date(to - 1).getFullYear()
  return (t: number) => {
    const d = new Date(t)
    if (span <= 2 * DAY) return span <= DAY ? timeOnly.format(d) : dayTime.format(d)
    return spansYears ? dayMonthYear.format(d) : dayMonth.format(d)
  }
}

interface Props {
  points: BatteryPoint[]
  from: number
  to: number
  bucketMs: number
  colors: { level: SeriesColor; charging: SeriesColor }
}

/** Ring battery level over time on a fixed 0–100% scale, with charging stretches overdrawn. */
export function BatteryChart({ points, from, to, bucketMs, colors }: Props) {
  const data = toChartPoints(points, bucketMs)

  return (
    <ResponsiveContainer width="100%" height={300}>
      <ComposedChart data={data} margin={{ top: 16, right: 24, bottom: 0, left: 0 }}>
        <CartesianGrid vertical={false} stroke="var(--grid)" />
        <XAxis
          dataKey="timestamp"
          type="number"
          scale="time"
          domain={[from, to]}
          tickFormatter={tickFormatter(from, to)}
          tick={{ fill: 'var(--text-secondary)', fontSize: 12 }}
          axisLine={{ stroke: 'var(--axis)' }}
          tickLine={false}
          minTickGap={32}
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
          content={(props: TooltipContentProps) => (
            <BatteryTooltip {...props} bucketMs={bucketMs} colors={colors} />
          )}
          isAnimationActive={false}
        />
        <Area
          dataKey="level"
          name="Battery level"
          type="monotone"
          stroke={colors.level.fill}
          strokeWidth={2}
          fill={colors.level.fill}
          fillOpacity={0.12}
          connectNulls={false}
          dot={false}
          activeDot={{ r: 4, fill: colors.level.active, stroke: 'var(--surface-1)' }}
          isAnimationActive={false}
        />
        <Area
          dataKey="charging"
          name="Charging"
          type="monotone"
          stroke={colors.charging.fill}
          strokeWidth={2.5}
          fill="none"
          connectNulls={false}
          dot={false}
          activeDot={false}
          isAnimationActive={false}
        />
      </ComposedChart>
    </ResponsiveContainer>
  )
}

function BatteryTooltip({
  active,
  payload,
  bucketMs,
  colors,
}: TooltipContentProps & { bucketMs: number; colors: Props['colors'] }) {
  const p = (payload?.[0]?.payload as ChartPoint | undefined)?.point
  if (!active || !p) return null
  const start = new Date(p.timestamp)
  const single = bucketMs <= 15 * 60_000

  return (
    <div className="tooltip" role="status">
      <div className="tooltip-title">
        {single ? dayTime.format(start) : `${dayTime.format(start)} – ${timeOnly.format(new Date(p.timestamp + bucketMs))}`}
      </div>
      <div className="tooltip-row">
        <span className="swatch" style={{ background: colors.level.fill }} aria-hidden />
        <span>{single ? 'Battery' : 'Average'}</span>
        <strong>{Math.round(p.level)}%</strong>
      </div>
      {p.min !== p.max && (
        <div className="tooltip-row">
          <span aria-hidden />
          <span>Range</span>
          <strong>
            {p.min}–{p.max}%
          </strong>
        </div>
      )}
      {p.charging && (
        <div className="tooltip-row">
          <span className="swatch" style={{ background: colors.charging.fill }} aria-hidden />
          <span>Charging</span>
          <strong />
        </div>
      )}
    </div>
  )
}
