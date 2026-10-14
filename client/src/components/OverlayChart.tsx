import { useState } from 'react'
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
import type { Bucket, Interval, MetricId } from '../api'
import { bucketLabel, parseDay, tickLabel } from '../dates'
import { METRICS, percentOfGoal } from '../metrics'

export interface OverlayPoint {
  start: string
  end: string
  steps: Bucket
  sleep: Bucket
  stepsPct: number | null
  sleepPct: number | null
}

export type VisibleSeries = Record<MetricId, boolean>

/** Pairs the two series bucket-by-bucket; both come from the same range and interval. */
export function toOverlayPoints(steps: Bucket[], sleep: Bucket[]): OverlayPoint[] {
  return steps.map((s, i) => {
    const z = sleep[i]
    return {
      start: s.start,
      end: s.end,
      steps: s,
      sleep: z,
      stepsPct: percentOfGoal(s.averagePerDay, s.daysWithData, METRICS.steps.goal),
      sleepPct: z ? percentOfGoal(z.averagePerDay, z.daysWithData, METRICS.sleep.goal) : null,
    }
  })
}

const SERIES: MetricId[] = ['steps', 'sleep']
const PCT_KEY: Record<MetricId, 'stepsPct' | 'sleepPct'> = { steps: 'stepsPct', sleep: 'sleepPct' }
const DIMMED_OPACITY = 0.3

interface Props {
  points: OverlayPoint[]
  interval: Interval
  visible: VisibleSeries
}

/**
 * Steps and sleep as grouped bars on one shared scale: each as a percentage of its own daily
 * goal. Indexing to a common base avoids a dual-axis chart, where the apparent relationship
 * between the series would depend on how the two axes happened to be scaled.
 *
 * Hovering a bar emphasizes its series: that bar darkens, the other series fades across the
 * chart, and the tooltip highlights the matching row.
 */
export function OverlayChart({ points, interval, visible }: Props) {
  const [hovered, setHovered] = useState<MetricId | null>(null)
  const shown = SERIES.filter((id) => visible[id])

  const first = points[0]?.start
  const last = points.at(-1)?.start
  const spansYears = !!first && !!last && parseDay(first).getFullYear() !== parseDay(last).getFullYear()

  // Ticks every 25% so the 100% goal always sits on a gridline; scale only to visible series.
  const maxPct = Math.max(0, ...points.flatMap((p) => shown.map((id) => p[PCT_KEY[id]] ?? 0)))
  const top = Math.max(125, Math.ceil(maxPct / 25) * 25)
  const ticks = Array.from({ length: top / 25 + 1 }, (_, i) => i * 25)

  return (
    <ResponsiveContainer width="100%" height={360}>
      <BarChart
        data={points}
        margin={{ top: 16, right: 56, bottom: 0, left: 0 }}
        barCategoryGap="20%"
        barGap={2}
        onMouseLeave={() => setHovered(null)}
      >
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
          tickFormatter={(v: number) => `${v}%`}
          tick={{ fill: 'var(--text-secondary)', fontSize: 12 }}
          axisLine={false}
          tickLine={false}
          width={48}
          domain={[0, top]}
          ticks={ticks}
        />
        <Tooltip
          cursor={{ fill: 'var(--hover-band)' }}
          content={(props: TooltipContentProps) => (
            <OverlayTooltip {...props} interval={interval} shown={shown} hovered={hovered} />
          )}
          isAnimationActive={false}
        />
        <ReferenceLine
          y={100}
          stroke="var(--text-muted)"
          strokeDasharray="4 4"
          label={{ value: 'Goal', position: 'right', fill: 'var(--text-secondary)', fontSize: 12 }}
        />
        {shown.map((id) => {
          const m = METRICS[id]
          const dimmed = hovered !== null && hovered !== id
          return (
            <Bar
              key={id}
              dataKey={PCT_KEY[id]}
              name={m.label}
              fill={m.color}
              fillOpacity={dimmed ? DIMMED_OPACITY : 1}
              // The shared tooltip activates every bar in the hovered period; only darken the
              // one under the mouse, and keep the other series faded.
              activeBar={dimmed ? { fill: m.color, fillOpacity: DIMMED_OPACITY } : { fill: m.colorActive, fillOpacity: 1 }}
              radius={[4, 4, 0, 0]}
              maxBarSize={24}
              isAnimationActive={false}
              onMouseEnter={() => setHovered(id)}
              onMouseLeave={() => setHovered(null)}
            />
          )
        })}
      </BarChart>
    </ResponsiveContainer>
  )
}

function OverlayTooltip({
  active,
  payload,
  interval,
  shown,
  hovered,
}: TooltipContentProps & { interval: Interval; shown: MetricId[]; hovered: MetricId | null }) {
  if (!active || !payload?.length) return null
  const p = payload[0].payload as OverlayPoint
  const perDay = interval !== 'daily'

  const rows: Record<MetricId, { label: string; bucket: Bucket; pct: number | null }> = {
    steps: { label: perDay ? 'Steps / day' : 'Steps', bucket: p.steps, pct: p.stepsPct },
    sleep: { label: perDay ? 'Sleep / night' : 'Sleep', bucket: p.sleep, pct: p.sleepPct },
  }

  return (
    <div className="tooltip" role="status">
      <div className="tooltip-title">{bucketLabel(p.start, p.end, interval)}</div>
      {shown.map((id) => {
        const r = rows[id]
        const state = hovered === null ? '' : hovered === id ? 'is-hovered' : 'is-dimmed'
        return (
          <div key={id} className={`tooltip-row tooltip-row-wide ${state}`}>
            <span className="swatch" style={{ background: METRICS[id].color }} aria-hidden />
            <span>{r.label}</span>
            <strong>{r.pct === null ? '—' : METRICS[id].formatValue(r.bucket.averagePerDay)}</strong>
            <span className="tooltip-pct">{r.pct === null ? '' : `${r.pct}%`}</span>
          </div>
        )
      })}
      {perDay && <div className="tooltip-muted">% of daily goal, per-day averages</div>}
    </div>
  )
}
