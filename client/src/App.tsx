import { useCallback, useEffect, useState } from 'react'
import { api, type DataRange, type Interval, type OuraStatus, type StepsResponse } from './api'
import { StepsChart, type Metric } from './components/StepsChart'
import { addDays, bucketLabel, formatNumber, today } from './dates'

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

const DAILY_GOAL = 10_000

export default function App() {
  const [range, setRange] = useState<DataRange | null>(null)
  const [start, setStart] = useState(() => addDays(today(), -89))
  const [end, setEnd] = useState(today)
  const [interval, setInterval] = useState<Interval>('daily')
  const [metric, setMetric] = useState<Metric>('total')
  const [showTable, setShowTable] = useState(false)
  const [data, setData] = useState<StepsResponse | null>(null)
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
    api
      .steps(start, end, interval, ctrl.signal)
      .then((d) => {
        setData(d)
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

  const hasAnyData = (range?.dayCount ?? 0) > 0
  const rangeInvalid = start > end

  return (
    <main className="page">
      <header className="page-header">
        <div>
          <h1>Steps</h1>
          <p className="subtle">
            {hasAnyData
              ? `${formatNumber(range!.dayCount)} days stored · ${range!.firstDay} to ${range!.lastDay}`
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
              <button
                className="btn"
                disabled={!!busy}
                onClick={() => runAction('disconnect', api.ouraDisconnect)}
              >
                {busy === 'disconnect' ? 'Disconnecting…' : 'Disconnect Oura'}
              </button>
              <button
                className="btn btn-primary"
                disabled={!!busy || rangeInvalid}
                title={`Sync ${start} to ${end} from Oura`}
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
        <>
          <section className="stats" aria-label="Summary">
            <Stat label="Total steps" value={formatNumber(data.totalSteps)} hero />
            <Stat label="Daily average" value={formatNumber(data.averageDailySteps)} />
            <Stat label="Days with data" value={`${formatNumber(data.daysWithData)}`} />
          </section>

          <section className="card" aria-busy={loading}>
            <div className="card-header">
              <h2>{metric === 'total' ? 'Total steps' : 'Average steps per day'} by {UNIT[interval]}</h2>
              <div className="card-tools">
                {interval !== 'daily' && (
                  <div className="segmented small" role="radiogroup" aria-label="Metric">
                    <button role="radio" aria-checked={metric === 'total'} className={metric === 'total' ? 'selected' : ''} onClick={() => setMetric('total')}>
                      Total
                    </button>
                    <button role="radio" aria-checked={metric === 'average'} className={metric === 'average' ? 'selected' : ''} onClick={() => setMetric('average')}>
                      Daily avg
                    </button>
                  </div>
                )}
                <button className="link" onClick={() => setShowTable((s) => !s)}>
                  {showTable ? 'Hide table' : 'Show table'}
                </button>
              </div>
            </div>

            {data.daysWithData === 0 ? (
              <div className="empty">No step data in this range.</div>
            ) : (
              <StepsChart
                buckets={data.buckets}
                interval={data.interval}
                metric={data.interval === 'daily' ? 'total' : metric}
                goal={DAILY_GOAL}
              />
            )}

            {showTable && (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Period</th>
                      <th className="num">Total steps</th>
                      <th className="num">Daily average</th>
                      <th className="num">Days with data</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.buckets.map((b) => (
                      <tr key={b.start}>
                        <td>{bucketLabel(b.start, b.end, data.interval)}</td>
                        <td className="num">{formatNumber(b.totalSteps)}</td>
                        <td className="num">{formatNumber(b.averageDailySteps)}</td>
                        <td className="num">{b.daysWithData}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}
    </main>
  )
}

function Stat({ label, value, hero }: { label: string; value: string; hero?: boolean }) {
  return (
    <div className={`stat ${hero ? 'stat-hero' : ''}`}>
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
    </div>
  )
}
