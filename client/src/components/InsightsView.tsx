import { useState } from 'react'
import {
  ComposedChart,
  Line,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import type { MetricId, SeriesResponse, Tag } from '../api'
import type { SeriesColor } from '../colors'
import { addDays, shortDay } from '../dates'
import { analyze, MAX_INSIGHT_METRICS, TIMEFRAMES, toDaily, type DayValue, type Insight, type MetricInsights } from '../insights'
import { TogetherSection } from './TogetherSection'
import { CATEGORIES, METRIC_IDS, METRICS } from '../metrics'
import { MetricPicker, type PickerGroup } from './MetricPicker'
import { summarizeTags, type VisibleSeries } from './OverlayChart'

const GROUPS: PickerGroup[] = CATEGORIES.map((c) => ({
  id: c.id,
  label: c.label,
  ids: METRIC_IDS.filter((id) => METRICS[id].category === c.id),
}))

const FRAME_KEY = 'ouraviz.insightFrame'

function loadFrame() {
  try {
    const stored = Number(localStorage.getItem(FRAME_KEY))
    return TIMEFRAMES.some((t) => t.days === stored) ? stored : TIMEFRAMES[0].days
  } catch {
    return TIMEFRAMES[0].days
  }
}

interface Props {
  /** Daily series ending at `asOf`, {@link HISTORY_DAYS} long, for the selected metrics. */
  data: Partial<Record<MetricId, SeriesResponse>>
  asOf: string
  /** Tags covering the longest window; marked on the charts and listed in their tooltips. */
  tags: Tag[]
  selected: VisibleSeries
  onToggle: (id: MetricId) => void
  colors: Record<MetricId, SeriesColor>
  loading: boolean
}

export function InsightsView({ data, asOf, tags, selected, onToggle, colors, loading }: Props) {
  const [pickerOpen, setPickerOpen] = useState(false)
  const ids = METRIC_IDS.filter((id) => selected[id])
  const loaded = ids.filter((id) => data[id] !== undefined)
  const histories: Partial<Record<MetricId, DayValue[]>> = Object.fromEntries(
    loaded.map((id) => [id, toDaily(data[id]!.buckets)]),
  )
  const [frameDays, setFrameDays] = useState(loadFrame)
  const frame = TIMEFRAMES.find((t) => t.days === frameDays) ?? TIMEFRAMES[0]
  const selectFrame = (days: number) => {
    setFrameDays(days)
    try {
      localStorage.setItem(FRAME_KEY, String(days))
    } catch {
      // Storage unavailable; the choice still applies for this visit.
    }
  }
  const atMax = ids.length >= MAX_INSIGHT_METRICS
  const reasonFor = (id: MetricId) =>
    selected[id]
      ? ids.length === 1
        ? 'At least one metric must be picked'
        : undefined
      : atMax
        ? `Up to ${MAX_INSIGHT_METRICS} metrics at a time; turn one off first`
        : undefined

  return (
    <>
      <section className="card">
        <div className="card-header">
          <div>
            <h2>Insights as of {shortDay(asOf)}</h2>
            <p className="card-sub">
              Your normal range, real trends, momentum, weekly rhythm, streaks and records for up to{' '}
              {MAX_INSIGHT_METRICS} metrics. Only what stands out is listed. Hover a chart to see a day’s value
              and tags.
            </p>
          </div>
          <div className="card-tools">
            <button
              type="button"
              className="link"
              aria-expanded={pickerOpen}
              aria-controls="insight-picker"
              onClick={() => setPickerOpen((o) => !o)}
            >
              {pickerOpen ? 'Hide metrics' : 'Choose metrics'}
            </button>
          </div>
        </div>
        <div className="series-toggles">
          {ids.map((id) => (
            <div key={id} className="series-toggle">
              <label title={ids.length === 1 ? 'At least one metric must be picked' : `Remove ${METRICS[id].label}`}>
                <input
                  type="checkbox"
                  checked
                  disabled={ids.length === 1}
                  onChange={() => onToggle(id)}
                  style={{ accentColor: colors[id].fill }}
                />
                {METRICS[id].label}
              </label>
            </div>
          ))}
          <span className={`series-limit ${atMax ? 'is-at-max' : ''}`}>
            {ids.length} of {MAX_INSIGHT_METRICS} max
          </span>
        </div>
        {pickerOpen && (
          <MetricPicker
            id="insight-picker"
            groups={GROUPS}
            visible={selected}
            colors={colors}
            reasonFor={reasonFor}
            onToggle={onToggle}
          />
        )}
      </section>

      <section className="insight-frame" aria-busy={loading} aria-labelledby="insight-frame-title">
        <div className="insight-frame-header">
          <h2 id="insight-frame-title">
            {frame.label}
            <span className="insight-frame-range">
              {shortDay(addDays(asOf, -(frame.days - 1)))} – {shortDay(asOf)}
            </span>
          </h2>
          <div className="segmented small" role="radiogroup" aria-label="Timeframe">
            {TIMEFRAMES.map((t) => (
              <button
                key={t.days}
                role="radio"
                aria-checked={frame.days === t.days}
                className={frame.days === t.days ? 'selected' : ''}
                onClick={() => selectFrame(t.days)}
              >
                {t.days} days
              </button>
            ))}
          </div>
        </div>
        <div className="insight-grid">
          {loaded.map((id) => (
            <MetricCard key={id} result={analyze(id, frame, histories[id]!)} color={colors[id]} tags={tags} />
          ))}
          {loaded.length < ids.length && <div className="insight-card insight-loading">Loading…</div>}
        </div>
      </section>

      <section className="insight-frame" aria-busy={loading} aria-labelledby="together-title">
        <h2 id="together-title">
          Combined insights
          <span className="insight-frame-range">How your metrics move with and ahead of each other</span>
        </h2>
        {ids.length < 2 ? (
          <div className="insight-card insight-empty">Pick at least 2 metrics to compare them.</div>
        ) : loaded.length < ids.length ? (
          <div className="insight-card insight-loading">Loading…</div>
        ) : (
          <TogetherSection ids={ids} frame={frame} histories={histories} colors={colors} tags={tags} />
        )}
      </section>

      <p className="insight-method">
        How these are found: your normal is the median and middle half of the period. Trends use a Theil-Sen slope
        with a Mann-Kendall test (p &lt; 0.01) after removing your weekday pattern, and must add up to at least half
        your usual day-to-day spread. Weekly rhythms must pass a permutation test (p &lt; 0.05). Momentum is a short
        average crossing a long one in the last few weeks. Links between metrics are rank correlations of each day's
        difference from that metric's rolling median, after removing its weekday pattern, tested with an effective sample size that allows for
        day-to-day carryover, and corrected for the number of pairs and offsets tried. Shared turning points are level
        shifts (permutation test, p &lt; 0.01) in two or more metrics within a few days of each other. Links show what
        tends to happen together, not what causes what, and these describe your data; they aren't medical advice.
      </p>
    </>
  )
}

const ARROW: Record<'up' | 'down', string> = { up: '↑', down: '↓' }

function MetricCard({ result, color, tags }: { result: MetricInsights; color: SeriesColor; tags: Tag[] }) {
  const m = METRICS[result.metric]
  const { normal, insights, daysWithData, needed, timeframe } = result
  const enough = daysWithData >= needed

  return (
    <article className="insight-card">
      <header className="insight-card-header">
        <h3>
          <span className="swatch" style={{ background: color.fill }} aria-hidden />
          {m.label}
        </h3>
        {normal && (
          <p className="insight-normal">
            Normal {m.formatValue(normal.median)}
            <span>
              {' '}
              · usually {m.formatValue(normal.low)}–{m.formatValue(normal.high)}
            </span>
          </p>
        )}
      </header>

      {daysWithData > 0 && <Sparkline result={result} color={color} tags={tags} />}

      {!enough ? (
        <p className="insight-empty">
          Not enough data: {daysWithData} of {timeframe.days} days have a value (needs {needed}).
        </p>
      ) : insights.length === 0 ? (
        <p className="insight-empty">Nothing stands out. Steady within your normal range.</p>
      ) : (
        <ul className="insight-list">
          {insights.map((i) => (
            <InsightRow key={i.kind} insight={i} />
          ))}
        </ul>
      )}
    </article>
  )
}

function InsightRow({ insight }: { insight: Insight }) {
  return (
    <li className={`insight insight-${insight.tone}`}>
      <span className="insight-icon" aria-hidden>
        {insight.direction ? ARROW[insight.direction] : '◷'}
      </span>
      <div>
        <strong>{insight.title}</strong>
        <span className="insight-detail">{insight.detail}</span>
      </div>
    </li>
  )
}

function Sparkline({ result, color, tags }: { result: MetricInsights; color: SeriesColor; tags: Tag[] }) {
  const m = METRICS[result.metric]
  const { normal } = result
  const hasTrend = result.days.some((d) => d.trend !== null)
  // The hovered day is read out under the chart, so nothing covers the line.
  const [hovered, setHovered] = useState<string | null>(null)
  const day = result.days.find((d) => d.day === hovered)
  const dayTags = day ? summarizeTags(tags, day.day, day.day) : []

  return (
    <div className="insight-chart">
      <ResponsiveContainer width="100%" height={110}>
        <ComposedChart
          data={result.days}
          margin={{ top: 6, right: 4, bottom: 0, left: 4 }}
          onMouseMove={(state) => setHovered(state.activeLabel == null ? null : String(state.activeLabel))}
          onMouseLeave={() => setHovered(null)}
        >
          <XAxis dataKey="day" hide />
          <YAxis hide domain={['auto', 'auto']} />
          {normal && (
            <>
              <ReferenceArea y1={normal.low} y2={normal.high} fill="var(--hover-band)" fillOpacity={1} stroke="none" />
              <ReferenceLine y={normal.median} stroke="var(--axis)" strokeDasharray="3 3" />
            </>
          )}
          <Line
            dataKey="value"
            stroke={color.fill}
            strokeWidth={1.5}
            dot={false}
            connectNulls={false}
            isAnimationActive={false}
          />
          {hasTrend && (
            <Line
              dataKey="trend"
              stroke="var(--text-primary)"
              strokeWidth={1.5}
              strokeDasharray="5 3"
              dot={false}
              isAnimationActive={false}
            />
          )}
          {/* Only for the hover cursor; the details show in the readout below. */}
          <Tooltip content={() => null} cursor={{ stroke: 'var(--axis)' }} />
        </ComposedChart>
      </ResponsiveContainer>
      <p className="insight-readout" aria-live="polite">
        {day && (
          <>
            <strong>{shortDay(day.day)}</strong> · {day.value === null ? 'No data' : m.formatValue(day.value)}
            {dayTags.length > 0 && <span className="insight-readout-tags"> · {dayTags.map((t) => t.label).join(', ')}</span>}
          </>
        )}
      </p>
    </div>
  )
}
