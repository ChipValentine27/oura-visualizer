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
import type { Interval, StepBucket } from '../api'
import { bucketLabel, formatCompact, formatNumber, parseDay, tickLabel } from '../dates'

export type Metric = 'total' | 'average'

interface Props {
  buckets: StepBucket[]
  interval: Interval
  metric: Metric
  goal: number
}

export function StepsChart({ buckets, interval, metric, goal }: Props) {
  const first = buckets[0]?.start
  const last = buckets.at(-1)?.start
  const spansYears = !!first && !!last && parseDay(first).getFullYear() !== parseDay(last).getFullYear()
  const dataKey = metric === 'total' ? 'totalSteps' : 'averageDailySteps'

  // The daily goal only makes sense when each bar represents steps per day.
  const showGoal = metric === 'average' || interval === 'daily'

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
          tickFormatter={(v: number) => formatCompact(v)}
          tick={{ fill: 'var(--text-secondary)', fontSize: 12 }}
          axisLine={false}
          tickLine={false}
          width={48}
        />
        <Tooltip
          cursor={{ fill: 'var(--hover-band)' }}
          content={(props: TooltipContentProps) => <BucketTooltip {...props} interval={interval} />}
          isAnimationActive={false}
        />
        {showGoal && (
          <ReferenceLine
            y={goal}
            stroke="var(--text-muted)"
            strokeDasharray="4 4"
            label={{ value: `${formatCompact(goal)} goal`, position: 'right', fill: 'var(--text-secondary)', fontSize: 12 }}
          />
        )}
        <Bar
          dataKey={dataKey}
          fill="var(--series-1)"
          activeBar={{ fill: 'var(--series-1-active)' }}
          radius={[4, 4, 0, 0]}
          maxBarSize={24}
          isAnimationActive={false}
        />
      </BarChart>
    </ResponsiveContainer>
  )
}

function BucketTooltip({ active, payload, interval }: TooltipContentProps & { interval: Interval }) {
  if (!active || !payload?.length) return null
  const b = payload[0].payload as StepBucket
  const span = Math.round((parseDay(b.end).getTime() - parseDay(b.start).getTime()) / 86_400_000) + 1

  return (
    <div className="tooltip" role="status">
      <div className="tooltip-title">{bucketLabel(b.start, b.end, interval)}</div>
      {b.daysWithData === 0 ? (
        <div className="tooltip-muted">No data</div>
      ) : (
        <>
          <div className="tooltip-row">
            <span className="swatch" aria-hidden />
            <span>Total steps</span>
            <strong>{formatNumber(b.totalSteps)}</strong>
          </div>
          {interval !== 'daily' && (
            <>
              <div className="tooltip-row">
                <span className="swatch swatch-empty" aria-hidden />
                <span>Daily average</span>
                <strong>{formatNumber(b.averageDailySteps)}</strong>
              </div>
              <div className="tooltip-muted">
                {b.daysWithData} of {span} days with data
              </div>
            </>
          )}
        </>
      )}
    </div>
  )
}
