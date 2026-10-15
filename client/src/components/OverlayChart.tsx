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
import { formatSignedPercent, METRICS, percentFromMean } from '../metrics'

export interface OverlayPoint {
  start: string
  end: string
  steps: Bucket
  sleep: Bucket
  /** ± % of each bucket's per-day average versus the selected period's mean. */
  stepsPct: number | null
  sleepPct: number | null
}

export type VisibleSeries = Record<MetricId, boolean>
export type Means = Record<MetricId, number>

/** Pairs the two series bucket-by-bucket; both come from the same range and interval. */
export function toOverlayPoints(steps: Bucket[], sleep: Bucket[], means: Means): OverlayPoint[] {
  return steps.map((s, i) => {
    const z = sleep[i]
    return {
      start: s.start,
      end: s.end,
      steps: s,
      sleep: z,
      stepsPct: percentFromMean(s.averagePerDay, s.daysWithData, means.steps),
      sleepPct: z ? percentFromMean(z.averagePerDay, z.daysWithData, means.sleep) : null,
    }
  })
}

const SERIES: MetricId[] = ['steps', 'sleep']
const PCT_KEY: Record<MetricId, 'stepsPct' | 'sleepPct'> = { steps: 'stepsPct', sleep: 'sleepPct' }
const DIMMED_OPACITY = 0.3
const NICE_STEPS = [5, 10, 20, 25, 50, 100, 200]

/** Symmetric ticks around 0 at a round step, at most ~4 per side. */
function symmetricTicks(maxAbs: number) {
  const step = NICE_STEPS.find((s) => maxAbs / s <= 4) ?? NICE_STEPS.at(-1)!
  const top = Math.max(step, Math.ceil(maxAbs / step) * step)
  return { top, ticks: Array.from({ length: (2 * top) / step + 1 }, (_, i) => -top + i * step) }
}

interface Props {
  points: OverlayPoint[]
  interval: Interval
  visible: VisibleSeries
}

/**
 * Steps and sleep as grouped bars on one shared scale: how far each period is above (+) or
 * below (−) that metric's mean for the selected range. Indexing both to their own mean
 * avoids a dual-axis chart and needs no goals.
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

  const maxAbs = Math.max(0, ...points.flatMap((p) => shown.map((id) => Math.abs(p[PCT_KEY[id]] ?? 0))))
  const { top, ticks } = symmetricTicks(maxAbs)

  return (
    <ResponsiveContainer width="100%" height={360}>
      <BarChart
        data={points}
        margin={{ top: 16, right: 64, bottom: 0, left: 0 }}
        barCategoryGap="20%"
        barGap={2}
        onMouseLeave={() => setHovered(null)}
      >
        <CartesianGrid vertical={false} stroke="var(--grid)" />
        <XAxis
          dataKey="start"
          tickFormatter={(v: string) => tickLabel(v, interval, spansYears)}
          tick={{ fill: 'var(--text-secondary)', fontSize: 12 }}
          axisLine={false}
          tickLine={false}
          minTickGap={24}
        />
        <YAxis
          tickFormatter={(v: number) => formatSignedPercent(v)}
          tick={{ fill: 'var(--text-secondary)', fontSize: 12 }}
          axisLine={false}
          tickLine={false}
          width={52}
          domain={[-top, top]}
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
          y={0}
          stroke="var(--axis)"
          label={{ value: 'Average', position: 'right', fill: 'var(--text-secondary)', fontSize: 12 }}
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
              // Recharts mirrors the radius for negative bars, so this rounds the end away
              // from the average line in both directions.
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
            <span className="tooltip-pct">{r.pct === null ? '' : formatSignedPercent(r.pct)}</span>
          </div>
        )
      })}
      <div className="tooltip-muted">vs. average (mean) for the selected period{perDay ? ', per-day averages' : ''}</div>
    </div>
  )
}
