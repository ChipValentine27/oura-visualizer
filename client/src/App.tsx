import { Fragment, useCallback, useEffect, useMemo, useState } from 'react'
import { api, type DataRange, type Interval, type MetricId, type OuraStatus, type SeriesResponse } from './api'
import { isColorId, seriesColor, type ColorId } from './colors'
import { ColorPicker } from './components/ColorPicker'
import { GoalInput } from './components/GoalInput'
import {
  formatPercent,
  OverlayChart,
  toOverlayPoints,
  type Baseline,
  type OverlayPoint,
  type VisibleSeries,
} from './components/OverlayChart'
import { addDays, bucketLabel, formatNumber, today } from './dates'
import { METRICS } from './metrics'

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

const SERIES: MetricId[] = ['steps', 'sleep']

const BASELINES: { value: Baseline; label: string }[] = [
  { value: 'goal', label: 'Daily goal' },
  { value: 'average', label: 'Average' },
]

/** A goal the user typed, or null to follow the average for the selected period. */
type CustomGoals = Record<MetricId, number | null>

const GOALS_STORAGE_KEY = 'ouraviz.customGoals'

function loadCustomGoals(): CustomGoals {
  try {
    const stored = JSON.parse(localStorage.getItem(GOALS_STORAGE_KEY) ?? '{}')
    const valid = (v: unknown) => (typeof v === 'number' && v > 0 ? v : null)
    return { steps: valid(stored.steps), sleep: valid(stored.sleep) }
  } catch {
    return { steps: null, sleep: null }
  }
}

function saveCustomGoals(goals: CustomGoals) {
  try {
    localStorage.setItem(GOALS_STORAGE_KEY, JSON.stringify(goals))
  } catch {
    // Storage unavailable (private window etc.); goals still work for this visit.
  }
}

type SeriesColors = Record<MetricId, ColorId>

const COLORS_STORAGE_KEY = 'ouraviz.seriesColors'

function loadSeriesColors(): SeriesColors {
  const defaults: SeriesColors = { steps: METRICS.steps.defaultColor, sleep: METRICS.sleep.defaultColor }
  try {
    const stored = JSON.parse(localStorage.getItem(COLORS_STORAGE_KEY) ?? '{}')
    const colors = {
      steps: isColorId(stored.steps) ? stored.steps : defaults.steps,
      sleep: isColorId(stored.sleep) ? stored.sleep : defaults.sleep,
    }
    // Two series in one color would be unreadable; fall back rather than trust bad storage.
    return colors.steps === colors.sleep ? defaults : colors
  } catch {
    return defaults
  }
}

function saveSeriesColors(colors: SeriesColors) {
  try {
    localStorage.setItem(COLORS_STORAGE_KEY, JSON.stringify(colors))
  } catch {
    // Storage unavailable; the choice still applies for this visit.
  }
}

interface Series {
  steps: SeriesResponse
  sleep: SeriesResponse
}

export default function App() {
  const [range, setRange] = useState<DataRange | null>(null)
  const [start, setStart] = useState(() => addDays(today(), -89))
  const [end, setEnd] = useState(today)
  const [interval, setInterval] = useState<Interval>('daily')
  const [visibleSeries, setVisibleSeries] = useState<VisibleSeries>({ steps: true, sleep: true })
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

  useEffect(() => {
    if (start > end) return
    const ctrl = new AbortController()
    setLoading(true)
    Promise.all([
      api.series('steps', start, end, interval, ctrl.signal),
      api.series('sleep', start, end, interval, ctrl.signal),
    ])
      .then(([steps, sleep]) => {
        setData({ steps, sleep })
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

  const setSeriesColor = (id: MetricId, color: ColorId) => {
    setSeriesColors((c) => {
      const next = { ...c, [id]: color }
      saveSeriesColors(next)
      return next
    })
  }

  const setCustomGoal = (id: MetricId, value: number | null) => {
    setCustomGoals((g) => {
      const next = { ...g, [id]: value }
      saveCustomGoals(next)
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
                title={`Sync steps and sleep for ${start} to ${end} from Oura`}
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

      {/* A single tab for now; more views (heart rate, HRV, ...) can join it here. */}
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
          visible={visibleSeries}
          onToggleSeries={(id) => setVisibleSeries((v) => ({ ...v, [id]: !v[id] }))}
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
  onToggleSeries: (id: MetricId) => void
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

function HealthView({
  data,
  interval,
  visible,
  onToggleSeries,
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
  const means: Record<MetricId, number> = { steps: data.steps.averagePerDay, sleep: data.sleep.averagePerDay }
  // Until the user types a goal, it follows the average for the selected period.
  const goals: Record<MetricId, number> = {
    steps: customGoals.steps ?? means.steps,
    sleep: customGoals.sleep ?? means.sleep,
  }
  const refSteps = baseline === 'goal' ? goals.steps : means.steps
  const refSleep = baseline === 'goal' ? goals.sleep : means.sleep

  const points = useMemo(
    () => toOverlayPoints(data.steps.buckets, data.sleep.buckets, baseline, { steps: refSteps, sleep: refSleep }),
    [data, baseline, refSteps, refSleep],
  )
  const shown = SERIES.filter((id) => visible[id])
  const noData = shown.every((id) => data[id].daysWithData === 0)
  const perDay = interval !== 'daily'
  const describe = (values: Record<MetricId, number>) =>
    shown
      .map((id) => `${METRICS[id].formatValue(values[id])} ${id === 'steps' ? 'steps/day' : 'sleep/night'}`)
      .join(', ')
  const pctOf = (p: OverlayPoint, id: MetricId) => (id === 'steps' ? p.stepsPct : p.sleepPct)
  const colors = { steps: seriesColor(seriesColors.steps), sleep: seriesColor(seriesColors.sleep) }
  const other = (id: MetricId): MetricId => (id === 'steps' ? 'sleep' : 'steps')

  return (
    <>
      <section className="stats stats-even" aria-label="Summary">
        {shown.map((id) => (
          <Stat
            key={id}
            label={id === 'steps' ? 'Steps, daily average' : 'Sleep, nightly average'}
            value={METRICS[id].formatValue(data[id].averagePerDay)}
            swatch={colors[id].fill}
          />
        ))}
        <Stat
          label={capitalize(shown.map((id) => METRICS[id].dayNoun).join(' / ')) + ' with data'}
          value={shown.map((id) => formatNumber(data[id].daysWithData)).join(' / ')}
        />
      </section>

      <section className="card" aria-busy={loading}>
        <div className="card-header">
          <div>
            <h2>
              {shown.map((id) => METRICS[id].label).join(' and ')} vs. {baseline === 'goal' ? 'daily goal' : 'average'}, by{' '}
              {UNIT[interval]}
            </h2>
            <p className="card-sub">
              {baseline === 'goal'
                ? `As a percentage of your daily goal (${describe(goals)})`
                : `Above (+) or below (−) the average (mean) for the selected period (${describe(means)})`}
              {perDay ? ', comparing per-day averages' : ''}
              {shown.length > 1 ? ', so both share one scale.' : '.'}
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
          <legend className="visually-hidden">Series shown on the chart</legend>
          {SERIES.map((id) => {
            const m = METRICS[id]
            // Keep at least one series on the chart.
            const isLastOn = visible[id] && shown.length === 1
            return (
              <div key={id} className={`series-toggle ${visible[id] ? '' : 'is-off'}`}>
                <label title={isLastOn ? 'At least one series must be shown' : undefined}>
                  <input
                    type="checkbox"
                    checked={visible[id]}
                    disabled={isLastOn}
                    onChange={() => onToggleSeries(id)}
                    style={{ accentColor: colors[id].fill }}
                  />
                  {m.label}
                </label>
                <ColorPicker
                  seriesLabel={m.label}
                  value={seriesColors[id]}
                  otherColor={seriesColors[other(id)]}
                  otherLabel={METRICS[other(id)].label}
                  onChange={(color) => onSeriesColor(id, color)}
                />
                {baseline === 'goal' && (
                  <GoalInput
                    metric={m}
                    goal={goals[id]}
                    isCustom={customGoals[id] !== null}
                    disabled={!visible[id]}
                    onChange={(value) => onCustomGoal(id, value)}
                  />
                )}
              </div>
            )
          })}
        </fieldset>

        {noData ? (
          <div className="empty">No data in this range.</div>
        ) : (
          <OverlayChart points={points} interval={interval} visible={visible} baseline={baseline} colors={colors} />
        )}

        {showTable && (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Period</th>
                  {shown.map((id) => (
                    <Fragment key={id}>
                      <th className="num">{id === 'steps' ? (perDay ? 'Steps / day' : 'Steps') : perDay ? 'Sleep / night' : 'Sleep'}</th>
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
                      const pct = pctOf(p, id)
                      return (
                        <Fragment key={id}>
                          <td className="num">{pct === null ? '—' : METRICS[id].formatValue(p[id].averagePerDay)}</td>
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

function Stat({ label, value, swatch }: { label: string; value: string; swatch?: string }) {
  return (
    <div className="stat">
      <div className="stat-label">
        {swatch && <span className="swatch" style={{ background: swatch }} aria-hidden />}
        {label}
      </div>
      <div className="stat-value">{value}</div>
    </div>
  )
}

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)
