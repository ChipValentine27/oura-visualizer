import {
  Bar,
  BarChart,
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type TooltipContentProps,
} from 'recharts'
import type { Bucket, Interval } from '../api'
import { bucketLabel, parseDay, tickLabel } from '../dates'
import type { MetricConfig } from '../metrics'

export type Aggregate = 'total' | 'average'

interface Props {
  metric: MetricConfig
  buckets: Bucket[]
  interval: Interval
  aggregate: Aggregate
}

/** One metric as bars, either the bucket's total or its per-day average. */
export function MetricChart({ metric, buckets, interval, aggregate }: Props) {
  const first = buckets[0]?.start
  const last = buckets.at(-1)?.start
  const spansYears = !!first && !!last && parseDay(first).getFullYear() !== parseDay(last).getFullYear()

  // The daily goal only makes sense when each bar represents one day's worth.
  const showGoal = aggregate === 'average' || interval === 'daily'
  const value = (b: Bucket) => metric.toChart(aggregate === 'total' ? b.total : b.averagePerDay)

  return (
    <ResponsiveContainer width="100%" height={360}>
      <BarChart data={buckets} margin={{ top: 16, right: showGoal ? 64 : 8, bottom: 0, left: 0 }} barCategoryGap="20%">
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
          tickFormatter={(v: number) => metric.formatAxis(v)}
          tick={{ fill: 'var(--text-secondary)', fontSize: 12 }}
          axisLine={false}
          tickLine={false}
          width={52}
        />
        <Tooltip
          cursor={{ fill: 'var(--hover-band)' }}
          content={(props: TooltipContentProps) => <BucketTooltip {...props} interval={interval} metric={metric} />}
          isAnimationActive={false}
        />
        {showGoal && (
          <ReferenceLine
            y={metric.toChart(metric.goal)}
            stroke="var(--text-muted)"
            strokeDasharray="4 4"
            label={{ value: metric.goalLabel, position: 'right', fill: 'var(--text-secondary)', fontSize: 12 }}
          />
        )}
        <Bar
          dataKey={value}
          name={metric.label}
          fill={metric.color}
          activeBar={{ fill: metric.colorActive }}
          radius={[4, 4, 0, 0]}
          maxBarSize={24}
          isAnimationActive={false}
        />
      </BarChart>
    </ResponsiveContainer>
  )
}

function BucketTooltip({
  active,
  payload,
  interval,
  metric,
}: TooltipContentProps & { interval: Interval; metric: MetricConfig }) {
  if (!active || !payload?.length) return null
  const b = payload[0].payload as Bucket
  const span = Math.round((parseDay(b.end).getTime() - parseDay(b.start).getTime()) / 86_400_000) + 1

  return (
    <div className="tooltip" role="status">
      <div className="tooltip-title">{bucketLabel(b.start, b.end, interval)}</div>
      {b.daysWithData === 0 ? (
        <div className="tooltip-muted">No data</div>
      ) : (
        <>
          <div className="tooltip-row">
            <span className="swatch" style={{ background: metric.color }} aria-hidden />
            <span>{metric.totalLabel}</span>
            <strong>{metric.formatValue(b.total)}</strong>
          </div>
          {interval !== 'daily' && (
            <>
              <div className="tooltip-row">
                <span className="swatch swatch-empty" style={{ borderColor: metric.color }} aria-hidden />
                <span>{metric.averageLabel}</span>
                <strong>{metric.formatValue(b.averagePerDay)}</strong>
              </div>
              <div className="tooltip-muted">
                {b.daysWithData} of {span} {metric.dayNoun} with data
              </div>
            </>
          )}
        </>
      )}
    </div>
  )
}
