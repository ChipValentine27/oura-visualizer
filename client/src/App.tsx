import { Fragment, useCallback, useEffect, useState } from 'react'
import {
  api,
  type BatteryResponse,
  type DataRange,
  type Interval,
  type MetricId,
  type OuraStatus,
  type SeriesResponse,
  type Tag,
} from './api'
import { COLORS, isColorId, seriesColor, type ColorId } from './colors'
import { BatteryChart, chartInterval, MAX_READING_DAYS, showsReadings } from './components/BatteryChart'
import { ColorPicker } from './components/ColorPicker'
import { GoalInput } from './components/GoalInput'
import { MetricPicker, type PickerGroup } from './components/MetricPicker'
import {
  formatBar,
  OverlayChart,
  toOverlayPoints,
  type Baseline,
  type References,
  type VisibleSeries,
} from './components/OverlayChart'
import { ThemeToggle } from './components/ThemeToggle'
import { addDays, bucketLabel, dayBounds, formatNumber, today } from './dates'
import { CATEGORIES, MAX_VISIBLE_METRICS, METRIC_IDS, METRICS, UNITS, unitLabel, type UnitId } from './metrics'

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
  { value: 'unit', label: 'Unit' },
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

/**
 * There are more metrics than colors, so colors only need to differ among the metrics on the
 * chart. Gives any shown metric that shares a color with an earlier one the first free color.
 */
function withDistinctColors(colors: SeriesColors, visible: VisibleSeries): SeriesColors {
  const next = { ...colors }
  const used = new Set<ColorId>()
  for (const id of METRIC_IDS.filter((m) => visible[m])) {
    if (used.has(next[id])) {
      next[id] = [METRICS[id].defaultColor, ...COLORS.map((c) => c.id)].find((c) => !used.has(c))!
    }
    used.add(next[id])
  }
  return next
}

function loadSeriesColors(visible: VisibleSeries): SeriesColors {
  const stored = loadStored(COLORS_KEY)
  const colors = byMetric((id) => (isColorId(stored[id]) ? (stored[id] as ColorId) : METRICS[id].defaultColor))
  return withDistinctColors(colors, visible)
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

type View = 'health' | 'battery'

const VIEWS: { value: View; label: string }[] = [
  { value: 'health', label: 'Health Visualizer' },
  { value: 'battery', label: 'Battery Life' },
]

const VIEW_KEY = 'ouraviz.view'

function loadView(): View {
  try {
    return localStorage.getItem(VIEW_KEY) === '"battery"' ? 'battery' : 'health'
  } catch {
    return 'health'
  }
}

/** Metrics fed by each optional Oura collection, for naming what a skipped collection leaves empty. */
const COLLECTION_METRICS: Record<string, string[]> = {
  daily_spo2: ['Blood oxygen (SpO₂)', 'Breathing disturbance'],
  daily_stress: ['High stress time', 'High recovery time'],
  heartrate: ['24h heart rate'],
}

type Series = Partial<Record<MetricId, SeriesResponse>>

/** Loaded series for one date range and interval (the key); others load as metrics are shown. */
interface SeriesCache {
  key: string
  interval: Interval
  data: Series
}

export default function App() {
  const [range, setRange] = useState<DataRange | null>(null)
  const [start, setStart] = useState(() => addDays(today(), -89))
  const [end, setEnd] = useState(today)
  const [interval, setInterval] = useState<Interval>('daily')
  const [visible, setVisible] = useState<VisibleSeries>(loadVisible)
  const [baseline, setBaseline] = useState<Baseline>('average')
  const [customGoals, setCustomGoals] = useState<CustomGoals>(loadCustomGoals)
  const [seriesColors, setSeriesColors] = useState<SeriesColors>(() => loadSeriesColors(loadVisible()))
  const [showTable, setShowTable] = useState(false)
  const [series, setSeries] = useState<SeriesCache | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [oura, setOura] = useState<OuraStatus | null>(null)
  const [notice, setNotice] = useState<{ kind: 'success' | 'error'; text: string } | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)
  const [battery, setBattery] = useState<BatteryResponse | null>(null)
  const [batteryLoading, setBatteryLoading] = useState(false)
  const [batteryReloadKey, setBatteryReloadKey] = useState(0)
  const [showBatteryTable, setShowBatteryTable] = useState(false)
  const [view, setView] = useState<View>(loadView)
  const [tags, setTags] = useState<Tag[]>([])
  const [tagsReloadKey, setTagsReloadKey] = useState(0)

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

  // Fetch only the shown metrics, and only those not loaded yet for this range and interval.
  // The previous range's series stay on screen until the new ones arrive.
  const queryKey = `${start}|${end}|${interval}|${reloadKey}`
  const shownKey = METRIC_IDS.filter((id) => visible[id]).join(',')
  const isLoaded = (id: MetricId) => series?.key === queryKey && series.data[id] !== undefined
  const loading = !error && start <= end && (shownKey.split(',') as MetricId[]).some((id) => !isLoaded(id))
  useEffect(() => {
    if (start > end) return
    const have = series?.key === queryKey ? series.data : {}
    const missing = shownKey.split(',').filter((id) => !have[id as MetricId]) as MetricId[]
    if (missing.length === 0) return
    const ctrl = new AbortController()
    Promise.all(missing.map((id) => api.series(id, start, end, interval, ctrl.signal)))
      .then((responses) => {
        setSeries((prev) => ({
          key: queryKey,
          interval,
          data: {
            ...(prev?.key === queryKey ? prev.data : {}),
            ...Object.fromEntries(missing.map((id, i) => [id, responses[i]])),
          },
        }))
        setError(null)
      })
      .catch((e: Error) => {
        if (e.name !== 'AbortError') setError(e.message)
      })
    return () => ctrl.abort()
  }, [queryKey, shownKey, series, start, end, interval])

  // Battery is fetched on its own, only while its tab is open, so syncing it never refetches the
  // health metrics and vice versa. It shares the date range and interval with the health view.
  useEffect(() => {
    if (view !== 'battery' || start > end) return
    const ctrl = new AbortController()
    setBatteryLoading(true)
    api
      .battery(start, end, chartInterval(start, end, interval), showsReadings(start, end), ctrl.signal)
      .then((b) => {
        setBattery(b)
        setError(null)
      })
      .catch((e: Error) => {
        if (e.name !== 'AbortError') setError(e.message)
      })
      .finally(() => setBatteryLoading(false))
    return () => ctrl.abort()
  }, [view, start, end, interval, batteryReloadKey])

  // Tags load with the health view, for its tooltips. They have their own sync, so syncing them
  // never refetches the metrics; demo data (reloadKey) includes tags, so it reloads them too.
  useEffect(() => {
    if (view !== 'health' || start > end) return
    const ctrl = new AbortController()
    api
      .tags(start, end, ctrl.signal)
      .then(setTags)
      .catch((e: Error) => {
        if (e.name !== 'AbortError') setError(e.message)
      })
    return () => ctrl.abort()
  }, [view, start, end, reloadKey, tagsReloadKey])

  const selectView = (next: View) => {
    setView(next)
    store(VIEW_KEY, next)
  }

  const applyPreset = (days: number) => {
    setStart(addDays(end, -(days - 1)))
  }

  const setSeriesColor = (id: MetricId, color: ColorId) => {
    setSeriesColors((c) => {
      const next = { ...c, [id]: color }
      store(COLORS_KEY, next)
      return next
    })
  }

  const toggleMetric = (id: MetricId) => {
    const next = { ...visible, [id]: !visible[id] }
    setVisible(next)
    store(VISIBLE_KEY, next)
    // A metric joining the chart may share a color with one already on it.
    const distinct = withDistinctColors(seriesColors, next)
    if (distinct[id] !== seriesColors[id]) setSeriesColor(id, distinct[id])
  }

  /** Shows just this metric, as when Unit mode switches the chart to another unit. */
  const showOnly = (id: MetricId) => {
    const next = byMetric((m) => m === id)
    setVisible(next)
    store(VISIBLE_KEY, next)
  }

  const setCustomGoal = (id: MetricId, value: number | null) => {
    setCustomGoals((g) => {
      const next = { ...g, [id]: value }
      store(GOALS_KEY, next)
      return next
    })
  }

  /** Runs a header action, then reloads the data it touched (the health metrics by default). */
  const runAction = async (
    label: string,
    action: () => Promise<unknown>,
    reload: () => void = () => setReloadKey((k) => k + 1),
  ) => {
    setBusy(label)
    setError(null)
    setNotice(null)
    try {
      await action()
      reload()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      // Refresh even on failure: a failed sync may have cleared a dead Oura connection.
      await loadMeta().catch(() => {})
      setBusy(null)
    }
  }

  const reloadBattery = () => setBatteryReloadKey((k) => k + 1)

  const syncBattery = () =>
    runAction(
      'battery',
      async () => {
        const { from, to } = dayBounds(start, end)
        const { readings } = await api.syncBattery(from, to)
        setNotice({
          kind: 'success',
          text:
            readings === 0
              ? `Oura returned no battery readings for ${start} to ${end}.`
              : `Synced ${formatNumber(readings)} battery readings for ${start} to ${end}.`,
        })
      },
      reloadBattery,
    )

  const syncTags = () =>
    runAction(
      'tags',
      async () => {
        const { tags } = await api.syncTags(start, end)
        setNotice({
          kind: 'success',
          text:
            tags === 0
              ? `Oura returned no tags for ${start} to ${end}.`
              : `Synced ${formatNumber(tags)} ${tags === 1 ? 'tag' : 'tags'} for ${start} to ${end}. Hover the chart to see them.`,
        })
      },
      () => setTagsReloadKey((k) => k + 1),
    )

  const seedBatteryDemo = () => {
    const { from, to } = dayBounds(addDays(today(), -364), today())
    return runAction('batteryDemo', () => api.seedBatteryDemo(from, to), reloadBattery)
  }

  const syncOura = async () => {
    const result = await api.syncOura(start, end)
    if (result.skipped.length === 0) return
    // Everything else synced; say which metrics are missing and why, since reconnecting alone
    // doesn't help when the Oura app registration doesn't offer the scope.
    const missing = result.skipped.flatMap((c) => COLLECTION_METRICS[c] ?? [c])
    const granted = (await api.ouraStatus().catch(() => null))?.scope
      ?.split(' ')
      .map((s) => s.replace(/^extapi:/, ''))
      .join(', ')
    setNotice({
      kind: 'success',
      text:
        `Synced. ${listOf(missing)} stay empty: Oura didn't give this app access to ${result.skipped.join(', ')}` +
        (granted ? ` (your connection has: ${granted})` : '') +
        '. Turn that data on for your app at cloud.ouraring.com/oauth/applications, then disconnect and connect Oura again.',
    })
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
                title={`Sync every metric for ${start} to ${end} from Oura`}
                onClick={() => runAction('oura', syncOura)}
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

      <nav className="tabs" role="tablist" aria-label="View">
        {VIEWS.map((v) => (
          <button
            key={v.value}
            role="tab"
            id={`tab-${v.value}`}
            aria-selected={view === v.value}
            aria-controls="view-panel"
            className={view === v.value ? 'selected' : ''}
            onClick={() => selectView(v.value)}
          >
            {v.label}
          </button>
        ))}
        {view === 'health' && (
          // Tags sync on its own too: they need a scope of their own.
          <div className="actions tab-actions">
            <button
              className="btn btn-small btn-primary"
              disabled={!!busy || rangeInvalid || !oura?.connected}
              title={oura?.connected ? `Sync the tags you added in the Oura app for ${start} to ${end}` : 'Connect Oura first'}
              onClick={syncTags}
            >
              {busy === 'tags' ? 'Syncing…' : 'Sync tags'}
            </button>
          </div>
        )}
        {view === 'battery' && (
          // Battery syncs on its own, apart from "Sync from Oura" in the page header.
          <div className="actions tab-actions">
            <button className="btn btn-small" disabled={!!busy} onClick={seedBatteryDemo}>
              {busy === 'batteryDemo' ? 'Loading…' : 'Load demo battery'}
            </button>
            <button
              className="btn btn-small btn-primary"
              disabled={!!busy || rangeInvalid || !oura?.connected}
              title={oura?.connected ? `Sync ring battery levels for ${start} to ${end} from Oura` : 'Connect Oura first'}
              onClick={syncBattery}
            >
              {busy === 'battery' ? 'Syncing…' : 'Sync battery'}
            </button>
          </div>
        )}
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

      <div id="view-panel" role="tabpanel" aria-labelledby={`tab-${view}`} className="view-panel">
        {view === 'health' && series && (
          <HealthView
            data={series.data}
            interval={series.interval}
            tags={tags}
            visible={visible}
            onToggleMetric={toggleMetric}
            onShowOnly={showOnly}
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
        {view === 'battery' && battery && (
          <BatteryView
            data={battery}
            chosenInterval={interval}
            loading={batteryLoading}
            showTable={showBatteryTable}
            onToggleTable={() => setShowBatteryTable((s) => !s)}
          />
        )}
      </div>
    </main>
  )
}

interface HealthViewProps {
  data: Series
  interval: Interval
  /** Tags in the selected range, listed in the tooltip of each bar they fall in. */
  tags: Tag[]
  visible: VisibleSeries
  onToggleMetric: (id: MetricId) => void
  onShowOnly: (id: MetricId) => void
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

const NOT_VS_GOAL = 'Clock times and temperature deviations can’t be compared to a daily goal. Switch “Compare to” to Average to chart them.'

/** Why a selected metric of another unit sits out the chart in Unit mode. */
const otherUnit = (unit: UnitId) =>
  `In Unit mode the chart shows one unit at a time (${unitLabel(unit)} now). Pick a metric of another unit to switch to it.`

const CATEGORY_GROUPS: PickerGroup[] = CATEGORIES.map((c) => ({
  id: c.id,
  label: c.label,
  ids: METRIC_IDS.filter((id) => METRICS[id].category === c.id),
}))

// Unit mode is for comparing metrics that share a unit, so a unit with a single metric
// (steps, breaths per minute, the breathing disturbance index) gets no tab.
const UNIT_GROUPS: PickerGroup[] = UNITS.map((u) => ({
  id: u.id,
  label: u.label,
  ids: METRIC_IDS.filter((id) => METRICS[id].unit === u.id),
})).filter((g) => g.ids.length > 1)

function HealthView({
  data,
  interval,
  tags,
  visible,
  onToggleMetric,
  onShowOnly,
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
  const [pickerOpen, setPickerOpen] = useState(false)
  const selected = METRIC_IDS.filter((id) => visible[id])
  // Selected metrics whose data has arrived (a newly picked one joins once it loads).
  const loaded = selected.filter((id) => data[id] !== undefined)
  // In Unit mode the chart has one axis, so it takes the unit of the first selected metric.
  const activeUnit = baseline === 'unit' && selected.length > 0 ? METRICS[selected[0]].unit : null
  // Why a metric can't be on the chart right now: against a goal, clock times and temperatures
  // can't be measured; in Unit mode, other units don't fit the axis. Selected ones stay
  // selected but sit out the chart until the mode changes.
  const sitOutReason = (id: MetricId) =>
    baseline === 'goal' && METRICS[id].goal === null
      ? NOT_VS_GOAL
      : activeUnit !== null && METRICS[id].unit !== activeUnit
        ? otherUnit(activeUnit)
        : undefined
  const drawn = loaded.filter((id) => sitOutReason(id) === undefined)
  const means = byMetric((id) => data[id]?.averagePerDay ?? 0)
  // Until the user types a goal, a metric uses its default: the period average, or a fixed
  // value (100 for the 0–100 scores and percentages).
  const goals = byMetric((id) => {
    const fallback = METRICS[id].goal?.defaultGoal ?? 'average'
    return customGoals[id] ?? (fallback === 'average' ? means[id] : fallback)
  })
  const references: References = baseline === 'goal' ? goals : means
  // At most a few thousand buckets, so recomputing on each render is cheap.
  const points = toOverlayPoints(
    byMetric((id) => data[id]?.buckets ?? []),
    drawn,
    baseline,
    references,
  )
  const noData = drawn.every((id) => data[id]!.daysWithData === 0)
  const perDay = interval !== 'daily'
  const atMax = selected.length >= MAX_VISIBLE_METRICS
  // In Unit mode, picking a metric of another unit switches the chart to that unit: it replaces
  // the metrics shown, since at least one must stay on and the two units can't share the axis.
  const switchesUnit = (id: MetricId) => activeUnit !== null && !visible[id] && METRICS[id].unit !== activeUnit
  const reasonFor = (id: MetricId) =>
    visible[id]
      ? selected.length === 1
        ? 'At least one metric must be shown'
        : undefined
      : baseline === 'goal' && METRICS[id].goal === null
        ? NOT_VS_GOAL
        : switchesUnit(id)
          ? undefined
          : atMax
            ? `Up to ${MAX_VISIBLE_METRICS} metrics at a time; turn one off first`
            : undefined
  const colors = byMetric((id) => seriesColor(seriesColors[id]))
  const describe = (values: Record<MetricId, number>) =>
    drawn.map((id) => `${METRICS[id].formatValue(values[id])} ${METRICS[id].describeUnit}`).join(', ')
  // Clock times and temperatures are compared by difference, not ratio; say what 100% means.
  const scales = [...new Set(drawn.map((id) => METRICS[id].offsetScale?.label).filter((l) => l !== undefined))]
  const scaleNote =
    baseline === 'average' && scales.length > 0
      ? ` Clock times and temperatures show the difference from the average, where ±100% = ${listOf(scales)}.`
      : ''

  return (
    <>
      <section className="stats stats-even" aria-label="Summary">
        {loaded.map((id) => (
          <Stat
            key={id}
            label={METRICS[id].statLabel}
            value={data[id]!.daysWithData === 0 ? '—' : METRICS[id].formatValue(data[id]!.averagePerDay)}
            note={`${formatNumber(data[id]!.daysWithData)} ${METRICS[id].dayNoun} with data`}
            swatch={colors[id].fill}
          />
        ))}
      </section>

      <section className="card" aria-busy={loading}>
        <div className="card-header">
          <div>
            <h2>
              {drawn.length === 0
                ? 'Nothing to compare to a daily goal'
                : baseline === 'unit'
                  ? `${listOf(drawn.map((id) => METRICS[id].label))}, by ${UNIT[interval]}`
                  : `${listOf(drawn.map((id) => METRICS[id].label))} vs. ${baseline === 'goal' ? 'daily goal' : 'average'}, by ${UNIT[interval]}`}
            </h2>
            {drawn.length > 0 && (
              <p className="card-sub">
                {baseline === 'goal'
                  ? `As a percentage of your daily goal (${describe(goals)})`
                  : baseline === 'average'
                    ? `Above (+) or below (−) the average (mean) for the selected period (${describe(means)})`
                    : `Actual values on a shared ${unitLabel(METRICS[drawn[0]].unit).toLowerCase()} axis`}
                {perDay ? (baseline === 'unit' ? ', as per-day averages' : ', comparing per-day averages') : ''}
                {drawn.length > 1 && baseline !== 'unit' ? ', so all share one scale.' : '.'}
                {scaleNote}
              </p>
            )}
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
            <button
              type="button"
              className="link"
              aria-expanded={pickerOpen}
              aria-controls="metric-picker"
              onClick={() => setPickerOpen((o) => !o)}
            >
              {pickerOpen ? 'Hide metrics' : 'Show metrics'}
            </button>
            <button type="button" className="link" aria-expanded={showTable} onClick={onToggleTable}>
              {showTable ? 'Hide records' : 'Show records'}
            </button>
          </div>
        </div>

        <fieldset className="series-toggles">
          <legend className="visually-hidden">Metrics on the chart, up to {MAX_VISIBLE_METRICS}</legend>
          {selected.map((id) => {
            const m = METRICS[id]
            const isLastOn = selected.length === 1
            const sitsOut = sitOutReason(id)
            const takenBy = Object.fromEntries(
              selected.filter((other) => other !== id).map((other) => [seriesColors[other], METRICS[other].label]),
            )
            return (
              <div key={id} className={`series-toggle ${sitsOut ? 'is-off' : ''}`}>
                <label title={isLastOn ? 'At least one metric must be shown' : `Remove ${m.label} from the chart`}>
                  <input
                    type="checkbox"
                    checked
                    disabled={isLastOn}
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
                {sitsOut && baseline === 'unit' && (
                  <span className="goal-field goal-source" title={sitsOut}>
                    Different unit
                  </span>
                )}
                {baseline === 'goal' &&
                  (m.goal ? (
                    <GoalInput
                      metric={m}
                      config={m.goal}
                      goal={goals[id]}
                      isCustom={customGoals[id] !== null}
                      onChange={(value) => onCustomGoal(id, value)}
                    />
                  ) : (
                    <span className="goal-field goal-source" title={NOT_VS_GOAL}>
                      Not compared to a goal
                    </span>
                  ))}
              </div>
            )
          })}
          <span className={`series-limit ${atMax ? 'is-at-max' : ''}`}>
            {selected.length} of {MAX_VISIBLE_METRICS} max
          </span>
        </fieldset>

        {pickerOpen && (
          <MetricPicker
            id="metric-picker"
            groups={baseline === 'unit' ? UNIT_GROUPS : CATEGORY_GROUPS}
            visible={visible}
            colors={colors}
            reasonFor={reasonFor}
            tagFor={(id) =>
              baseline !== 'unit' && METRICS[id].goal === null
                ? { text: 'avg only', title: 'Not compared to a daily goal' }
                : undefined
            }
            noteFor={(group) =>
              baseline === 'goal' && group.ids.some((id) => METRICS[id].goal === null)
                ? NOT_VS_GOAL
                : activeUnit !== null && group.id !== activeUnit
                  ? `Picking one of these switches the chart to ${group.label.toLowerCase()} and replaces the metrics shown.`
                  : undefined
            }
            onToggle={(id) => (switchesUnit(id) ? onShowOnly(id) : onToggleMetric(id))}
          />
        )}

        {drawn.length === 0 && selected.length > loaded.length ? (
          <div className="empty">Loading…</div>
        ) : drawn.length === 0 ? (
          <div className="empty">{NOT_VS_GOAL}</div>
        ) : noData ? (
          <div className="empty">No data in this range.</div>
        ) : (
          <OverlayChart
            points={points}
            interval={interval}
            shown={drawn}
            baseline={baseline}
            colors={colors}
            tags={tags}
          />
        )}

        {showTable && drawn.length > 0 && (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Period</th>
                  {drawn.map((id) => (
                    <Fragment key={id}>
                      <th className="num">{METRICS[id].rowLabel(perDay)}</th>
                      {baseline !== 'unit' && (
                        <th className="num">{baseline === 'goal' ? '% of goal' : 'vs. average'}</th>
                      )}
                    </Fragment>
                  ))}
                </tr>
              </thead>
              <tbody>
                {points.map((p) => (
                  <tr key={p.start}>
                    <td>{bucketLabel(p.start, p.end, interval)}</td>
                    {drawn.map((id) => {
                      const pct = p.pct[id] ?? null
                      const bucket = p.buckets[id]
                      return (
                        <Fragment key={id}>
                          <td className="num">
                            {pct === null || !bucket ? '—' : METRICS[id].formatValue(bucket.averagePerDay)}
                          </td>
                          {baseline !== 'unit' && (
                            <td className="num">{pct === null ? '—' : formatBar(id, pct, baseline)}</td>
                          )}
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

const BATTERY_COLOR = seriesColor('blue')

const batteryTime = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })

const percent = (v: number | null) => (v === null ? '—' : `${Math.round(v)}%`)

interface BatteryViewProps {
  data: BatteryResponse
  /** The interval picked in the filters; data.interval may be coarser (see chartInterval). */
  chosenInterval: Interval
  loading: boolean
  showTable: boolean
  onToggleTable: () => void
}

function BatteryView({ data, chosenInterval, loading, showTable, onToggleTable }: BatteryViewProps) {
  const { latest, interval } = data
  const readings = `${formatNumber(data.readingCount)} readings`
  const everyReading = showsReadings(data.start, data.end)
  const coarsened = !everyReading && interval !== chosenInterval

  return (
    <>
      <section className="stats stats-even" aria-label="Battery summary">
        <Stat
          label="Latest"
          value={percent(latest?.level ?? null)}
          note={latest ? batteryTime.format(new Date(latest.timestamp)) : 'No readings'}
        />
        <Stat label="Average" value={percent(data.averageLevel)} note={readings} />
        <Stat label="Lowest" value={percent(data.minLevel)} />
        <Stat label="Highest" value={percent(data.maxLevel)} />
      </section>

      <section className="card" aria-busy={loading}>
        <div className="card-header">
          <div>
            <h2>{everyReading ? 'Battery level' : `Battery level by ${UNIT[interval]}`}</h2>
            <p className="card-sub">
              {everyReading
                ? `Each reading Oura reported, labelled by ${UNIT[interval]}.`
                : `Each ${UNIT[interval]}'s average reading, with a band from its lowest to highest. Ranges up to ${MAX_READING_DAYS} days show every reading.`}{' '}
              Gaps mean no readings.
              {coarsened &&
                ` This range has too many ${UNIT[chosenInterval]}s to tell apart, so it's shown by ${UNIT[interval]}; pick a shorter range to see each ${UNIT[chosenInterval]}.`}
              {data.thinned &&
                ` To fit, the chart shows the lowest and highest of each short stretch (${formatNumber(data.readings.length)} of ${readings}).`}
            </p>
          </div>
          <div className="card-tools">
            <button className="link" onClick={onToggleTable}>
              {showTable ? 'Hide table' : 'Show table'}
            </button>
          </div>
        </div>

        {data.readingCount === 0 ? (
          <div className="empty">No battery data in this range. Click “Sync battery” to pull it from Oura.</div>
        ) : (
          <BatteryChart
            readings={data.readings}
            buckets={data.buckets}
            start={data.start}
            end={data.end}
            from={data.from}
            to={data.to}
            interval={interval}
            color={BATTERY_COLOR}
          />
        )}

        {showTable && (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Period</th>
                  <th className="num">Average</th>
                  <th className="num">Lowest</th>
                  <th className="num">Highest</th>
                  <th className="num">Readings</th>
                </tr>
              </thead>
              <tbody>
                {data.buckets.map((b) => (
                  <tr key={b.start}>
                    <td>{bucketLabel(b.start, b.end, interval)}</td>
                    <td className="num">{percent(b.averageLevel)}</td>
                    <td className="num">{percent(b.minLevel)}</td>
                    <td className="num">{percent(b.maxLevel)}</td>
                    <td className="num">{formatNumber(b.readings)}</td>
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
