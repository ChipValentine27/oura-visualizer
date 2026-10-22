export type Interval = 'daily' | 'weekly' | 'monthly' | 'yearly'
export type MetricId = 'steps' | 'sleep' | 'sleepScore' | 'readinessScore' | 'activityScore'

export interface Bucket {
  start: string
  end: string
  /** Steps are counts; sleep is seconds; scores are summed 0–100 values (use averagePerDay). */
  total: number
  daysWithData: number
  averagePerDay: number
}

export interface SeriesResponse {
  metric: MetricId
  unit: 'steps' | 'seconds' | 'score'
  start: string
  end: string
  interval: Interval
  buckets: Bucket[]
  total: number
  daysWithData: number
  /** Mean of the daily values in the range (days without data are skipped). */
  averagePerDay: number
}

export interface DataRange {
  firstDay: string | null
  lastDay: string | null
  activityDays: number
  sleepDays: number
}

export interface SyncResult {
  activityDays: number
  sleepDays: number
  scoreDays: number
}

/** One time bucket of ring battery samples. Timestamps are Unix milliseconds; levels 0–100%. */
export interface BatteryPoint {
  timestamp: number
  /** Mean level of the bucket's samples. */
  level: number
  min: number
  max: number
  /** The ring was charging (or sat in its charger) at some point in the bucket. */
  charging: boolean
}

export interface BatteryResponse {
  from: number
  to: number
  bucketMs: number
  /** Buckets with samples only; a missing stretch means no data, not 0%. */
  points: BatteryPoint[]
  readings: number
  averageLevel: number | null
  minLevel: number | null
  latest: { timestamp: number; level: number; charging: boolean } | null
  chargeCount: number
}

export interface BatterySyncResult {
  readings: number
}

export interface OuraStatus {
  configured: boolean
  connected: boolean
  expiresAt: string | null
  connectedAt: string | null
  scope: string | null
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init)
  if (!res.ok) {
    const text = await res.text()
    let message = text
    try {
      const body = JSON.parse(text)
      message = body.detail ?? body.title ?? text
    } catch {
      // plain-text error body
    }
    throw new Error(message || `${res.status} ${res.statusText}`)
  }
  return res.json() as Promise<T>
}

export const api = {
  series: (metric: MetricId, start: string, end: string, interval: Interval, signal?: AbortSignal) =>
    request<SeriesResponse>(`/api/metrics/${metric}?${new URLSearchParams({ start, end, interval })}`, { signal }),
  range: () => request<DataRange>('/api/metrics/range'),
  ouraStatus: () => request<OuraStatus>('/api/oura/status'),
  /** A full-page navigation, not fetch: the server redirects the browser to Oura's consent page. */
  ouraConnectUrl: '/api/oura/connect',
  ouraDisconnect: async () => {
    const res = await fetch('/api/oura/disconnect', { method: 'POST' })
    if (!res.ok) throw new Error(`Disconnect failed (${res.status})`)
  },
  syncOura: (start: string, end: string) =>
    request<SyncResult>(`/api/sync/oura?${new URLSearchParams({ start, end })}`, { method: 'POST' }),
  seedDemo: (start: string, end: string) =>
    request<SyncResult>(`/api/sync/demo?${new URLSearchParams({ start, end })}`, { method: 'POST' }),
  /** `from`/`to` are ISO instants (`dayBounds` in dates.ts); battery is a time series, not daily. */
  battery: (from: string, to: string, signal?: AbortSignal) =>
    request<BatteryResponse>(`/api/battery?${new URLSearchParams({ from, to })}`, { signal }),
  syncBattery: (from: string, to: string) =>
    request<BatterySyncResult>(`/api/sync/battery?${new URLSearchParams({ from, to })}`, { method: 'POST' }),
  seedBatteryDemo: (from: string, to: string) =>
    request<BatterySyncResult>(`/api/sync/battery/demo?${new URLSearchParams({ from, to })}`, { method: 'POST' }),
}
