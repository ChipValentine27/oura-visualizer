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
import type { SeriesColor } from '../colors'
import { bucketLabel, parseDay, tickLabel } from '../dates'
import { formatSignedPercent, METRICS, percentFromMean, percentOfGoal } from '../metrics'

/**
 * What each bar is measured against:
 * - goal: % of the metric's daily goal (0% up, goal at 100%)
 * - average: ± % from the metric's mean for the selected range (diverging around 0)
 */
export type Baseline = 'goal' | 'average'

export interface OverlayPoint {
  start: string
  end: string
  /** Each metric's bucket for this period. */
  buckets: Partial<Record<MetricId, Bucket>>
  /** Each metric's per-day average as a percentage, per the chosen {@link Baseline}. */
  pct: Partial<Record<MetricId, number | null>>
}

export type VisibleSeries = Record<MetricId, boolean>
/** Per metric, the daily goal or the period mean that bars are measured against. */
export type References = Partial<Record<MetricId, number>>

function toPercent(b: Bucket, baseline: Baseline, reference: number) {
  return baseline === 'goal'
    ? percentOfGoal(b.averagePerDay, b.daysWithData, reference)
    : percentFromMean(b.averagePerDay, b.daysWithData, reference)
}

/** Lines the metrics up period by period; they all come from the same range and interval. */
export function toOverlayPoints(
  series: Partial<Record<MetricId, Bucket[]>>,
  ids: MetricId[],
  baseline: Baseline,
  references: References,
): OverlayPoint[] {
  const first = ids.map((id) => series[id]).find((b) => b !== undefined) ?? []
  return first.map((anchor, i) => {
    const buckets: OverlayPoint['buckets'] = {}
    const pct: OverlayPoint['pct'] = {}
    for (const id of ids) {
      const b = series[id]?.[i]
      if (!b) continue
      buckets[id] = b
      pct[id] = toPercent(b, baseline, references[id] ?? 0)
    }
    return { start: anchor.start, end: anchor.end, buckets, pct }
  })
}

/** "87%" against a goal, "+12%" / "−8%" against the average. */
export const formatPercent = (pct: number, baseline: Baseline) =>
  baseline === 'goal' ? `${pct}%` : formatSignedPercent(pct)

const DIMMED_OPACITY = 0.3
const NICE_STEPS = [5, 10, 20, 25, 50, 100, 200]

/** Symmetric ticks around 0 at a round step, at most ~4 per side. */
function symmetricTicks(maxAbs: number) {
  const step = NICE_STEPS.find((s) => maxAbs / s <= 4) ?? NICE_STEPS.at(-1)!
  const top = Math.max(step, Math.ceil(maxAbs / step) * step)
  return { domain: [-top, top], ticks: Array.from({ length: (2 * top) / step + 1 }, (_, i) => -top + i * step) }
}

/** 0% to 100% in steps of 25%, extended in 25% steps only when a bar goes past the goal. */
function goalTicks(max: number) {
  const top = Math.max(100, Math.ceil(max / 25) * 25)
  return { domain: [0, top], ticks: Array.from({ length: top / 25 + 1 }, (_, i) => i * 25) }
}

interface Props {
  points: OverlayPoint[]
  interval: Interval
  /** Metrics to draw, in order (left to right within each period). */
  shown: MetricId[]
  baseline: Baseline
  colors: Record<MetricId, SeriesColor>
}

/**
 * Up to four metrics as grouped bars on one shared percentage scale, either as % of each
 * metric's daily goal or as ± % from each metric's mean for the selected range. Indexing every
 * metric to its own baseline avoids a multi-axis chart.
 *
 * Hovering a bar emphasizes its metric: that bar darkens, the other metrics fade across the
 * chart, and the tooltip highlights the matching row.
 */
export function OverlayChart({ points, interval, shown, baseline, colors }: Props) {
  const [hovered, setHovered] = useState<MetricId | null>(null)

  const first = points[0]?.start
  const last = points.at(-1)?.start
  const spansYears = !!first && !!last && parseDay(first).getFullYear() !== parseDay(last).getFullYear()

  const values = points.flatMap((p) => shown.map((id) => p.pct[id] ?? 0))
  const { domain, ticks } =
    baseline === 'goal'
      ? goalTicks(Math.max(0, ...values))
      : symmetricTicks(Math.max(0, ...values.map(Math.abs)))

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
          axisLine={baseline === 'goal' ? { stroke: 'var(--axis)' } : false}
          tickLine={false}
          minTickGap={24}
        />
        <YAxis
          tickFormatter={(v: number) => formatPercent(v, baseline)}
          tick={{ fill: 'var(--text-secondary)', fontSize: 12 }}
          axisLine={false}
          tickLine={false}
          width={52}
          domain={domain}
          ticks={ticks}
        />
        <Tooltip
          cursor={{ fill: 'var(--hover-band)' }}
          content={(props: TooltipContentProps) => (
            <OverlayTooltip
              {...props}
              interval={interval}
              shown={shown}
              hovered={hovered}
              baseline={baseline}
              colors={colors}
            />
          )}
          isAnimationActive={false}
        />
        {baseline === 'goal' ? (
          <ReferenceLine
            y={100}
            stroke="var(--text-muted)"
            strokeDasharray="4 4"
            label={{ value: 'Goal', position: 'right', fill: 'var(--text-secondary)', fontSize: 12 }}
          />
        ) : (
          <ReferenceLine
            y={0}
            stroke="var(--axis)"
            label={{ value: 'Average', position: 'right', fill: 'var(--text-secondary)', fontSize: 12 }}
          />
        )}
        {shown.map((id) => {
          const dimmed = hovered !== null && hovered !== id
          return (
            <Bar
              key={id}
              dataKey={(p: OverlayPoint) => p.pct[id] ?? null}
              name={METRICS[id].label}
              fill={colors[id].fill}
              fillOpacity={dimmed ? DIMMED_OPACITY : 1}
              // The shared tooltip activates every bar in the hovered period; only darken the
              // one under the mouse, and keep the other metrics faded.
              activeBar={
                dimmed
                  ? { fill: colors[id].fill, fillOpacity: DIMMED_OPACITY }
                  : { fill: colors[id].active, fillOpacity: 1 }
              }
              // Recharts mirrors the radius for negative bars, so this rounds the end away
              // from the baseline in both directions.
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
  baseline,
  colors,
}: TooltipContentProps & {
  interval: Interval
  shown: MetricId[]
  hovered: MetricId | null
  baseline: Baseline
  colors: Record<MetricId, SeriesColor>
}) {
  if (!active || !payload?.length) return null
  const p = payload[0].payload as OverlayPoint
  const perDay = interval !== 'daily'

  return (
    <div className="tooltip" role="status">
      <div className="tooltip-title">{bucketLabel(p.start, p.end, interval)}</div>
      {shown.map((id) => {
        const pct = p.pct[id] ?? null
        const bucket = p.buckets[id]
        const state = hovered === null ? '' : hovered === id ? 'is-hovered' : 'is-dimmed'
        return (
          <div key={id} className={`tooltip-row tooltip-row-wide ${state}`}>
            <span className="swatch" style={{ background: colors[id].fill }} aria-hidden />
            <span>{METRICS[id].rowLabel(perDay)}</span>
            <strong>{pct === null || !bucket ? '—' : METRICS[id].formatValue(bucket.averagePerDay)}</strong>
            <span className="tooltip-pct">{pct === null ? '' : formatPercent(pct, baseline)}</span>
          </div>
        )
      })}
      <div className="tooltip-muted">
        {baseline === 'goal' ? '% of daily goal' : 'vs. average (mean) for the selected period'}
        {perDay ? ', per-day averages' : ''}
      </div>
    </div>
  )
}
