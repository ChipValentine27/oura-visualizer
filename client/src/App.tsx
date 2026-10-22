import { Fragment, useCallback, useEffect, useState } from 'react'
import { api, type DataRange, type Interval, type MetricId, type OuraStatus, type SeriesResponse } from './api'
import { isColorId, seriesColor, type ColorId } from './colors'
import { ColorPicker } from './components/ColorPicker'
import { GoalInput } from './components/GoalInput'
import {
  formatPercent,
  OverlayChart,
  toOverlayPoints,
  type Baseline,
  type References,
  type VisibleSeries,
} from './components/OverlayChart'
import { ThemeToggle } from './components/ThemeToggle'
import { addDays, bucketLabel, formatNumber, today } from './dates'
import { MAX_VISIBLE_METRICS, METRIC_IDS, METRICS } from './metrics'

const INTERVALS: { value: Interval; label: string }[] = [
  { value: 'daily', label: 'Daily' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'monthly', label: 'Monthly' },
  { value: 'yearly', label: 'Yearly' },
]

const UNIT: Record<Interval, string> = { daily: 'day', weekly: 'week', monthly: 'month', yearly: 'year' }

const PRESETS: { label: string; days: number }[] = [
  { label: '30D', days: 30 },
  { label: '90D', days: 90 },
  { label: '1Y', days: 365 },
  { label: '3Y', days: 365 * 3 },
]

const BASELINES: { value: Baseline; label: string }[] = [
  { value: 'goal', label: 'Daily goal' },
  { value: 'average', label: 'Average' },
]

const byMetric = <T,>(value: (id: MetricId) => T) =>
  Object.fromEntries(METRIC_IDS.map((id) => [id, value(id)])) as Record<MetricId, T>

/** Reads a JSON object from localStorage; any failure (private window, bad data) gives {}. */
function loadStored(key: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(localStorage.getItem(key) ?? '{}')
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

function store(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // Storage unavailable; the choice still applies for this visit.
  }
}

/** A goal the user typed, or null to use the metric's default (average or fixed). */
type CustomGoals = Record<MetricId, number | null>
const GOALS_KEY = 'ouraviz.customGoals'

function loadCustomGoals(): CustomGoals {
  const stored = loadStored(GOALS_KEY)
  return byMetric((id) => {
    const v = stored[id]
    return typeof v === 'number' && v > 0 ? v : null
  })
}

type SeriesColors = Record<MetricId, ColorId>
const COLORS_KEY = 'ouraviz.seriesColors'

function loadSeriesColors(): SeriesColors {
  const defaults = byMetric((id) => METRICS[id].defaultColor)
  const stored = loadStored(COLORS_KEY)
  const colors = byMetric((id) => (isColorId(stored[id]) ? (stored[id] as ColorId) : defaults[id]))
  // Two metrics in one color would be unreadable; fall back rather than trust bad storage.
  return new Set(Object.values(colors)).size === METRIC_IDS.length ? colors : defaults
}

const VISIBLE_KEY = 'ouraviz.visibleMetrics'

function loadVisible(): VisibleSeries {
  const stored = loadStored(VISIBLE_KEY)
  const visible = byMetric((id) => (typeof stored[id] === 'boolean' ? (stored[id] as boolean) : false))
  const count = METRIC_IDS.filter((id) => visible[id]).length
  return count >= 1 && count <= MAX_VISIBLE_METRICS
    ? visible
    : byMetric((id) => id === 'steps' || id === 'sleep')
}

type Series = Record<MetricId, SeriesResponse>

export default function App() {
  const [range, setRange] = useState<DataRange | null>(null)
  const [start, setStart] = useState(() => addDays(today(), -89))
  const [end, setEnd] = useState(today)
  const [interval, setInterval] = useState<Interval>('daily')
  const [visible, setVisible] = useState<VisibleSeries>(loadVisible)
  const [baseline, setBaseline] = useState<Baseline>('average')
  const [customGoals, setCustomGoals] = useState<CustomGoals>(loadCustomGoals)
  const [seriesColors, setSeriesColors] = useState<SeriesColors>(loadSeriesColors)
  const [showTable, setShowTable] = useState(false)
  const [data, setData] = useState<Series | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [oura, setOura] = useState<OuraStatus | null>(null)
  const [notice, setNotice] = useState<{ kind: 'success' | 'error'; text: string } | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)

  const loadMeta = useCallback(async () => {
    const [r, s] = await Promise.all([api.range(), api.ouraStatus()])
    setRange(r)
    setOura(s)
    return r
  }, [])

  // The server's OAuth callback lands back here with ?oura=connected|error; show it once.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const result = params.get('oura')
    if (!result) return
    setNotice(
      result === 'connected'
        ? { kind: 'success', text: 'Oura connected. Pick a date range and click “Sync from Oura”.' }
        : { kind: 'error', text: params.get('message') ?? 'Connecting to Oura failed.' },
    )
    window.history.replaceState(null, '', window.location.pathname)
  }, [])

  // On first load, snap the end date to the latest day we actually have.
  useEffect(() => {
    loadMeta()
      .then((r) => {
        if (r.lastDay) {
          setEnd(r.lastDay)
          setStart(addDays(r.lastDay, -89))
        }
      })
      .catch((e: Error) => setError(e.message))
  }, [loadMeta])

  // Every metric is small, so fetch them all together; toggling metrics is then instant.
  useEffect(() => {
    if (start > end) return
    const ctrl = new AbortController()
    setLoading(true)
    Promise.all(METRIC_IDS.map((id) => api.series(id, start, end, interval, ctrl.signal)))
      .then((responses) => {
        setData(byMetric((id) => responses[METRIC_IDS.indexOf(id)]))
        setError(null)
      })
      .catch((e: Error) => {
        if (e.name !== 'AbortError') setError(e.message)
      })
      .finally(() => setLoading(false))
    return () => ctrl.abort()
  }, [start, end, interval, reloadKey])

  const applyPreset = (days: number) => {
    setStart(addDays(end, -(days - 1)))
  }

  const toggleMetric = (id: MetricId) => {
    setVisible((v) => {
      const next = { ...v, [id]: !v[id] }
      store(VISIBLE_KEY, next)
      return next
    })
  }

  const setSeriesColor = (id: MetricId, color: ColorId) => {
    setSeriesColors((c) => {
      const next = { ...c, [id]: color }
      store(COLORS_KEY, next)
      return next
    })
  }

  const setCustomGoal = (id: MetricId, value: number | null) => {
    setCustomGoals((g) => {
      const next = { ...g, [id]: value }
      store(GOALS_KEY, next)
      return next
    })
  }

  const runAction = async (label: string, action: () => Promise<unknown>) => {
    setBusy(label)
    setError(null)
    setNotice(null)
    try {
      await action()
      setReloadKey((k) => k + 1)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      // Refresh even on failure: a failed sync may have cleared a dead Oura connection.
      await loadMeta().catch(() => {})
      setBusy(null)
    }
  }

  const hasAnyData = (range?.activityDays ?? 0) + (range?.sleepDays ?? 0) > 0
  const rangeInvalid = start > end

  return (
    <main className="page">
      <header className="page-header">
        <div>
          <h1>Oura Visualizer</h1>
          <p className="subtle">
            {hasAnyData
              ? `${formatNumber(range!.activityDays)} days of activity · ${formatNumber(range!.sleepDays)} nights of sleep · ${range!.firstDay} to ${range!.lastDay}`
              : 'No data yet. Load demo data or connect Oura to get started.'}
          </p>
        </div>
        <div className="actions">
          <ThemeToggle />
          <button
            className="btn"
            disabled={!!busy}
            onClick={() => runAction('demo', () => api.seedDemo(addDays(today(), -365 * 3), today()))}
          >
            {busy === 'demo' ? 'Loading…' : 'Load demo data'}
          </button>
          {oura?.connected ? (
            <>
              <button className="btn" disabled={!!busy} onClick={() => runAction('disconnect', api.ouraDisconnect)}>
                {busy === 'disconnect' ? 'Disconnecting…' : 'Disconnect Oura'}
              </button>
              <button
                className="btn btn-primary"
                disabled={!!busy || rangeInvalid}
                title={`Sync activity, sleep and scores for ${start} to ${end} from Oura`}
                onClick={() => runAction('oura', () => api.syncOura(start, end))}
              >
                {busy === 'oura' ? 'Syncing…' : 'Sync from Oura'}
              </button>
            </>
          ) : oura?.configured ? (
            <a className="btn btn-primary" href={api.ouraConnectUrl}>
              Connect Oura
            </a>
          ) : (
            <button
              className="btn btn-primary"
              disabled
              title="Set Oura:ClientId and Oura:ClientSecret on the server first (see README)"
            >
              Connect Oura
            </button>
          )}
        </div>
      </header>

      {notice && (
        <div className={notice.kind === 'error' ? 'error' : 'notice'} role={notice.kind === 'error' ? 'alert' : 'status'}>
          {notice.text}
        </div>
      )}

      {/* A single tab for now; more views can join it here. */}
      <nav className="tabs" role="tablist" aria-label="View">
        <button role="tab" aria-selected className="selected">
          Health Visualizer
        </button>
      </nav>

      <section className="filters" aria-label="Filters">
        <label className="field">
          <span>From</span>
          <input type="date" value={start} max={end} onChange={(e) => e.target.value && setStart(e.target.value)} />
        </label>
        <label className="field">
          <span>To</span>
          <input type="date" value={end} min={start} onChange={(e) => e.target.value && setEnd(e.target.value)} />
        </label>
        <div className="segmented" role="group" aria-label="Quick range">
          {PRESETS.map((p) => (
            <button key={p.label} onClick={() => applyPreset(p.days)}>
              {p.label}
            </button>
          ))}
        </div>
        <div className="spacer" />
        <div className="segmented" role="radiogroup" aria-label="Interval">
          {INTERVALS.map((i) => (
            <button
              key={i.value}
              role="radio"
              aria-checked={interval === i.value}
              className={interval === i.value ? 'selected' : ''}
              onClick={() => setInterval(i.value)}
            >
              {i.label}
            </button>
          ))}
        </div>
      </section>

      {error && <div className="error" role="alert">{error}</div>}
      {rangeInvalid && <div className="error" role="alert">“From” must be on or before “To”.</div>}

      {data && (
        <HealthView
          data={data}
          interval={data.steps.interval}
          visible={visible}
          onToggleMetric={toggleMetric}
          baseline={baseline}
          onBaseline={setBaseline}
          customGoals={customGoals}
          onCustomGoal={setCustomGoal}
          seriesColors={seriesColors}
          onSeriesColor={setSeriesColor}
          loading={loading}
          showTable={showTable}
          onToggleTable={() => setShowTable((s) => !s)}
        />
      )}
    </main>
  )
}

interface HealthViewProps {
  data: Series
  interval: Interval
  visible: VisibleSeries
  onToggleMetric: (id: MetricId) => void
  baseline: Baseline
  onBaseline: (b: Baseline) => void
  customGoals: CustomGoals
  onCustomGoal: (id: MetricId, value: number | null) => void
  seriesColors: SeriesColors
  onSeriesColor: (id: MetricId, color: ColorId) => void
  loading: boolean
  showTable: boolean
  onToggleTable: () => void
}

/** "A", "A and B", "A, B and C". */
const listOf = (items: string[]) =>
  items.length <= 1 ? (items[0] ?? '') : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`

function HealthView({
  data,
  interval,
  visible,
  onToggleMetric,
  baseline,
  onBaseline,
  customGoals,
  onCustomGoal,
  seriesColors,
  onSeriesColor,
  loading,
  showTable,
  onToggleTable,
}: HealthViewProps) {
  const shown = METRIC_IDS.filter((id) => visible[id])
  const means = byMetric((id) => data[id].averagePerDay)
  // Until the user types a goal, a metric uses its default: the period average, or a fixed
  // value (100 for the 0–100 scores).
  const goals = byMetric((id) => {
    const fallback = METRICS[id].defaultGoal
    return customGoals[id] ?? (fallback === 'average' ? means[id] : fallback)
  })
  const references: References = baseline === 'goal' ? goals : means
  // At most a few thousand buckets, so recomputing on each render is cheap.
  const points = toOverlayPoints(
    byMetric((id) => data[id].buckets),
    shown,
    baseline,
    references,
  )
  const noData = shown.every((id) => data[id].daysWithData === 0)
  const perDay = interval !== 'daily'
  const atMax = shown.length >= MAX_VISIBLE_METRICS
  const colors = byMetric((id) => seriesColor(seriesColors[id]))
  const describe = (values: Record<MetricId, number>) =>
    shown.map((id) => `${METRICS[id].formatValue(values[id])} ${METRICS[id].describeUnit}`).join(', ')

  return (
    <>
      <section className="stats stats-even" aria-label="Summary">
        {shown.map((id) => (
          <Stat
            key={id}
            label={METRICS[id].statLabel}
            value={METRICS[id].formatValue(data[id].averagePerDay)}
            note={`${formatNumber(data[id].daysWithData)} ${METRICS[id].dayNoun} with data`}
            swatch={colors[id].fill}
          />
        ))}
      </section>

      <section className="card" aria-busy={loading}>
        <div className="card-header">
          <div>
            <h2>
              {listOf(shown.map((id) => METRICS[id].label))} vs. {baseline === 'goal' ? 'daily goal' : 'average'}, by{' '}
              {UNIT[interval]}
            </h2>
            <p className="card-sub">
              {baseline === 'goal'
                ? `As a percentage of your daily goal (${describe(goals)})`
                : `Above (+) or below (−) the average (mean) for the selected period (${describe(means)})`}
              {perDay ? ', comparing per-day averages' : ''}
              {shown.length > 1 ? ', so all share one scale.' : '.'}
            </p>
          </div>
          <div className="card-tools">
            <div className="segmented small" role="radiogroup" aria-label="Compare to">
              {BASELINES.map((b) => (
                <button
                  key={b.value}
                  role="radio"
                  aria-checked={baseline === b.value}
                  className={baseline === b.value ? 'selected' : ''}
                  onClick={() => onBaseline(b.value)}
                >
                  {b.label}
                </button>
              ))}
            </div>
            <button className="link" onClick={onToggleTable}>
              {showTable ? 'Hide table' : 'Show table'}
            </button>
          </div>
        </div>

        <fieldset className="series-toggles">
          <legend className="visually-hidden">Metrics shown on the chart, up to {MAX_VISIBLE_METRICS}</legend>
          {METRIC_IDS.map((id) => {
            const m = METRICS[id]
            const isLastOn = visible[id] && shown.length === 1
            const blockedByMax = !visible[id] && atMax
            const takenBy = Object.fromEntries(
              METRIC_IDS.filter((other) => other !== id).map((other) => [seriesColors[other], METRICS[other].label]),
            )
            return (
              <div key={id} className={`series-toggle ${visible[id] ? '' : 'is-off'}`}>
                <label
                  title={
                    isLastOn
                      ? 'At least one metric must be shown'
                      : blockedByMax
                        ? `Up to ${MAX_VISIBLE_METRICS} metrics at a time; turn one off first`
                        : undefined
                  }
                >
                  <input
                    type="checkbox"
                    checked={visible[id]}
                    disabled={isLastOn || blockedByMax}
                    onChange={() => onToggleMetric(id)}
                    style={{ accentColor: colors[id].fill }}
                  />
                  {m.label}
                </label>
                <ColorPicker
                  seriesLabel={m.label}
                  value={seriesColors[id]}
                  takenBy={takenBy}
                  onChange={(color) => onSeriesColor(id, color)}
                />
                {baseline === 'goal' && visible[id] && (
                  <GoalInput
                    metric={m}
                    goal={goals[id]}
                    isCustom={customGoals[id] !== null}
                    onChange={(value) => onCustomGoal(id, value)}
                  />
                )}
              </div>
            )
          })}
          <span className={`series-limit ${atMax ? 'is-at-max' : ''}`}>
            {shown.length} of {MAX_VISIBLE_METRICS} max
          </span>
        </fieldset>

        {noData ? (
          <div className="empty">No data in this range.</div>
        ) : (
          <OverlayChart points={points} interval={interval} shown={shown} baseline={baseline} colors={colors} />
        )}

        {showTable && (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Period</th>
                  {shown.map((id) => (
                    <Fragment key={id}>
                      <th className="num">{METRICS[id].rowLabel(perDay)}</th>
                      <th className="num">{baseline === 'goal' ? '% of goal' : 'vs. average'}</th>
                    </Fragment>
                  ))}
                </tr>
              </thead>
              <tbody>
                {points.map((p) => (
                  <tr key={p.start}>
                    <td>{bucketLabel(p.start, p.end, interval)}</td>
                    {shown.map((id) => {
                      const pct = p.pct[id] ?? null
                      const bucket = p.buckets[id]
                      return (
                        <Fragment key={id}>
                          <td className="num">
                            {pct === null || !bucket ? '—' : METRICS[id].formatValue(bucket.averagePerDay)}
                          </td>
                          <td className="num">{pct === null ? '—' : formatPercent(pct, baseline)}</td>
                        </Fragment>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  )
}

function Stat({ label, value, note, swatch }: { label: string; value: string; note?: string; swatch?: string }) {
  return (
    <div className="stat">
      <div className="stat-label">
        {swatch && <span className="swatch" style={{ background: swatch }} aria-hidden />}
        {label}
      </div>
      <div className="stat-value">{value}</div>
      {note && <div className="stat-note">{note}</div>}
    </div>
  )
}
