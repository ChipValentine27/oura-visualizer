import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type TooltipContentProps,
} from 'recharts'
import type { BatteryBucket, Interval } from '../api'
import type { SeriesColor } from '../colors'
import { bucketLabel, formatNumber, parseDay, tickLabel } from '../dates'

interface Props {
  buckets: BatteryBucket[]
  interval: Interval
  colors: { level: SeriesColor; range: SeriesColor }
}

/** Recharts draws a band when an Area's value is a [low, high] pair. */
const range = (b: BatteryBucket) => (b.minLevel === null || b.maxLevel === null ? null : [b.minLevel, b.maxLevel])

/**
 * Battery level per day, week, month or year on a fixed 0–100% scale: the average as a line
 * over a band from each period's lowest to highest reading. Periods without readings leave a
 * gap rather than reading as 0%.
 */
export function BatteryChart({ buckets, interval, colors }: Props) {
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
          tick={{ fill: 'var(--text-secondary)', fontSize: 12 }}
          axisLine={{ stroke: 'var(--axis)' }}
          tickLine={false}
          minTickGap={24}
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
          cursor={{ fill: 'var(--hover-band)' }}
          content={(props: TooltipContentProps) => <BatteryTooltip {...props} interval={interval} colors={colors} />}
          isAnimationActive={false}
        />
        <Area
          dataKey={range}
          name="Low – high"
          stroke="none"
          fill={colors.range.fill}
          fillOpacity={0.18}
          connectNulls={false}
          activeDot={false}
          isAnimationActive={false}
        />
        <Line
          dataKey="averageLevel"
          name="Average"
          stroke={colors.level.fill}
          strokeWidth={2}
          // Dots keep isolated periods (a gap on each side) visible.
          dot={buckets.length <= 60 ? { r: 2.5, fill: colors.level.fill, strokeWidth: 0 } : false}
          activeDot={{ r: 4, fill: colors.level.active, stroke: 'var(--surface-1)' }}
          connectNulls={false}
          isAnimationActive={false}
        />
      </ComposedChart>
    </ResponsiveContainer>
  )
}

function BatteryTooltip({
  active,
  payload,
  interval,
  colors,
}: TooltipContentProps & { interval: Interval; colors: Props['colors'] }) {
  if (!active || !payload?.length) return null
  const b = payload[0].payload as BatteryBucket
  const hasData = b.averageLevel !== null

  return (
    <div className="tooltip" role="status">
      <div className="tooltip-title">{bucketLabel(b.start, b.end, interval)}</div>
      {hasData ? (
        <>
          <div className="tooltip-row">
            <span className="swatch" style={{ background: colors.level.fill }} aria-hidden />
            <span>Average</span>
            <strong>{Math.round(b.averageLevel!)}%</strong>
          </div>
          <div className="tooltip-row">
            <span className="swatch" style={{ background: colors.range.fill, opacity: 0.5 }} aria-hidden />
            <span>Low – high</span>
            <strong>
              {b.minLevel}–{b.maxLevel}%
            </strong>
          </div>
          <div className="tooltip-row">
            <span aria-hidden />
            <span>Charges</span>
            <strong>{formatNumber(b.charges)}</strong>
          </div>
          <div className="tooltip-muted">{formatNumber(b.readings)} readings</div>
        </>
      ) : (
        <div className="tooltip-muted">No readings</div>
      )}
    </div>
  )
}
