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
import type { Bucket, Interval, MetricId, Tag } from '../api'
import type { SeriesColor } from '../colors'
import { addDays, bucketLabel, parseDay, tickLabel } from '../dates'
import { formatSignedPercent, METRICS, percentFromMean, percentOfGoal, unitLabel, type UnitId } from '../metrics'

/**
 * What each bar is measured against:
 * - goal: % of the metric's daily goal (0% up, goal at 100%)
 * - average: ± % from the metric's mean for the selected range (diverging around 0)
 * - unit: the actual values, for metrics that share one unit and so one axis
 */
export type Baseline = 'goal' | 'average' | 'unit'

export interface OverlayPoint {
  start: string
  end: string
  /** Each metric's bucket for this period. */
  buckets: Partial<Record<MetricId, Bucket>>
  /**
   * The bar height per metric: the per-day average as a percentage per the chosen
   * {@link Baseline}, or in Unit mode the per-day average itself.
   */
  pct: Partial<Record<MetricId, number | null>>
}

export type VisibleSeries = Record<MetricId, boolean>
/** Per metric, the daily goal or the period mean that bars are measured against. */
export type References = Partial<Record<MetricId, number>>

function toPercent(id: MetricId, b: Bucket, baseline: Baseline, reference: number) {
  if (baseline === 'unit') return b.daysWithData === 0 ? null : b.averagePerDay
  return baseline === 'goal'
    ? percentOfGoal(b.averagePerDay, b.daysWithData, reference)
    : percentFromMean(id, b.averagePerDay, b.daysWithData, reference)
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
      pct[id] = toPercent(id, b, baseline, references[id] ?? 0)
    }
    return { start: anchor.start, end: anchor.end, buckets, pct }
  })
}

/** "87%" against a goal, "+12%" / "−8%" against the average. */
export const formatPercent = (pct: number, baseline: Baseline) =>
  baseline === 'goal' ? `${pct}%` : formatSignedPercent(pct)

/** A bar's height as text: a percentage, or in Unit mode the value in the metric's unit. */
export const formatBar = (id: MetricId, value: number, baseline: Baseline) =>
  baseline === 'unit' ? METRICS[id].formatValue(value) : formatPercent(value, baseline)

/** One tag name in a period, and on how many of the period's days it was logged. */
export interface TagSummary {
  label: string
  days: number
  /** Comments on the tag's entries in the period, without repeats. */
  comments: string[]
}

/**
 * The tags logged during [start, end], most frequent first. A tag spanning several days counts
 * each of its days in the period; the same tag twice on one day counts that day once.
 */
export function summarizeTags(tags: Tag[], start: string, end: string): TagSummary[] {
  const byLabel = new Map<string, { days: Set<string>; comments: Set<string> }>()
  for (const t of tags) {
    if (t.startDay > end || t.endDay < start) continue
    const entry = byLabel.get(t.label) ?? { days: new Set(), comments: new Set() }
    byLabel.set(t.label, entry)
    const last = t.endDay < end ? t.endDay : end
    for (let d = t.startDay > start ? t.startDay : start; d <= last; d = addDays(d, 1)) entry.days.add(d)
    if (t.comment?.trim()) entry.comments.add(t.comment.trim())
  }
  return [...byLabel]
    .map(([label, e]) => ({ label, days: e.days.size, comments: [...e.comments] }))
    .sort((a, b) => b.days - a.days || a.label.localeCompare(b.label))
}

/** Tooltip rows before the rest are folded into "+N more", so it stays inside the chart. */
const MAX_TAG_ROWS = 6

const DIMMED_OPACITY = 0.3
const NICE_STEPS = [5, 10, 20, 25, 50, 100, 200]

/** Symmetric ticks around 0 at a round step, at most ~4 per side. */
function symmetricTicks(maxAbs: number) {
  const step = NICE_STEPS.find((s) => maxAbs / s <= 4) ?? NICE_STEPS.at(-1)!
  const top = Math.max(step, Math.ceil(maxAbs / step) * step)
  return { domain: [-top, top], ticks: Array.from({ length: (2 * top) / step + 1 }, (_, i) => -top + i * step) }
}

const HOUR = 3600
const HOUR_STEPS = [0.25, 0.5, 1, 2, 3, 4, 6, 12, 24, 48, 96, 168].map((h) => h * HOUR)

/** The smallest of `steps` that covers `span` in at most ~5 intervals. */
const stepFor = (span: number, steps: number[]) => steps.find((s) => span / s <= 5) ?? steps.at(-1)!

/** 1, 2, 2.5 or 5 times a power of ten. */
function niceSteps(span: number) {
  const magnitude = 10 ** Math.floor(Math.log10(Math.max(span, 1e-9) / 5))
  return [1, 2, 2.5, 5, 10, 20].map((m) => m * magnitude)
}

/**
 * Unit mode: an axis in the metrics' own unit that always includes 0, so bars start at a
 * true baseline. Durations and clock times step in whole hours (or quarter/half hours), the
 * rest in round numbers.
 */
function valueTicks(min: number, max: number, unit: UnitId) {
  const lo = Math.min(0, min)
  const hi = Math.max(0, max)
  const span = hi - lo || 1
  const step = stepFor(span, unit === 'duration' || unit === 'clock' ? HOUR_STEPS : niceSteps(span))
  const bottom = Math.floor(lo / step) * step
  const top = Math.max(Math.ceil(hi / step) * step, bottom + step)
  const ticks = Array.from({ length: Math.round((top - bottom) / step) + 1 }, (_, i) => bottom + i * step)
  return { domain: [bottom, top], ticks }
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
  /** Tags in the range; the tooltip lists those logged during the hovered period. */
  tags: Tag[]
}

/**
 * Up to four metrics as grouped bars on one shared scale: % of each metric's daily goal, ± %
 * from each metric's mean for the selected range, or (Unit mode, where every shown metric
 * has the same unit) the actual values. Indexing every metric to its own baseline, or charting
 * only one unit at a time, avoids a multi-axis chart.
 *
 * Hovering a bar emphasizes its metric: that bar darkens, the other metrics fade across the
 * chart, and the tooltip highlights the matching row.
 */
export function OverlayChart({ points, interval, shown, baseline, colors, tags }: Props) {
  const [hovered, setHovered] = useState<MetricId | null>(null)

  const first = points[0]?.start
  const last = points.at(-1)?.start
  const spansYears = !!first && !!last && parseDay(first).getFullYear() !== parseDay(last).getFullYear()

  const values = points.flatMap((p) => shown.map((id) => p.pct[id] ?? 0))
  const { domain, ticks } =
    baseline === 'unit'
      ? valueTicks(Math.min(...values), Math.max(...values), METRICS[shown[0]].unit)
      : baseline === 'goal'
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
          axisLine={baseline === 'average' ? false : { stroke: 'var(--axis)' }}
          tickLine={false}
          minTickGap={24}
        />
        <YAxis
          tickFormatter={(v: number) =>
            // formatDuration(0) is "0m", which reads oddly at the foot of an hours axis.
            baseline === 'unit' && v === 0 && METRICS[shown[0]].unit === 'duration' ? '0h' : formatBar(shown[0], v, baseline)
          }
          tick={{ fill: 'var(--text-secondary)', fontSize: 12 }}
          axisLine={false}
          tickLine={false}
          width={baseline === 'unit' ? 76 : 52}
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
              tags={tags}
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
        ) : baseline === 'average' ? (
          <ReferenceLine
            y={0}
            stroke="var(--axis)"
            label={{ value: 'Average', position: 'right', fill: 'var(--text-secondary)', fontSize: 12 }}
          />
        ) : (
          // Values can dip below zero (an evening bedtime, a cool temperature); mark zero.
          domain[0] < 0 && <ReferenceLine y={0} stroke="var(--axis)" />
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
  tags,
}: TooltipContentProps & {
  interval: Interval
  shown: MetricId[]
  hovered: MetricId | null
  baseline: Baseline
  colors: Record<MetricId, SeriesColor>
  tags: Tag[]
}) {
  if (!active || !payload?.length) return null
  const p = payload[0].payload as OverlayPoint
  const perDay = interval !== 'daily'
  const tagSummary = summarizeTags(tags, p.start, p.end)
  const hiddenTags = tagSummary.length - MAX_TAG_ROWS

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
            <span className="tooltip-pct">{pct === null || baseline === 'unit' ? '' : formatPercent(pct, baseline)}</span>
          </div>
        )
      })}
      <div className="tooltip-muted">
        {baseline === 'goal'
          ? '% of daily goal'
          : baseline === 'average'
            ? 'vs. average (mean) for the selected period'
            : `Actual values, ${unitLabel(METRICS[shown[0]].unit).toLowerCase()} axis`}
        {perDay ? ', per-day averages' : ''}
      </div>
      {tagSummary.length > 0 && (
        <div className="tooltip-tags">
          <div className="tooltip-tags-title">Tags</div>
          {tagSummary.slice(0, MAX_TAG_ROWS).map((t) => (
            <div key={t.label} className="tooltip-tag">
              <span className="tooltip-tag-label">
                {t.label}
                {/* A single day has room for what was noted; longer periods just count days. */}
                {!perDay && t.comments.length > 0 && (
                  <span className="tooltip-tag-comment"> · {t.comments.join('; ')}</span>
                )}
              </span>
              {perDay && (
                <span className="tooltip-tag-days">
                  {t.days} {t.days === 1 ? 'day' : 'days'}
                </span>
              )}
            </div>
          ))}
          {hiddenTags > 0 && <div className="tooltip-muted">+{hiddenTags} more</div>}
        </div>
      )}
    </div>
  )
}
