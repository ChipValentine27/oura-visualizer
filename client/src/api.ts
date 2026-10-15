export type Interval = 'daily' | 'weekly' | 'monthly' | 'yearly'

/** Every metric the API serves, as /api/metrics/{id}. Grouped and labelled in metrics.ts. */
export type MetricId =
  // Activity
  | 'steps'
  | 'activityScore'
  | 'highActivityTime'
  | 'mediumActivityTime'
  | 'lowActivityTime'
  | 'sedentaryTime'
  | 'restingTime'
  | 'nonWearTime'
  | 'walkingDistance'
  | 'targetMeters'
  | 'metersToTarget'
  // Sleep
  | 'sleep'
  | 'sleepScore'
  | 'deepSleep'
  | 'lightSleep'
  | 'remSleep'
  | 'awakeTime'
  | 'timeInBed'
  | 'latency'
  | 'efficiency'
  | 'bedtimeStart'
  | 'bedtimeEnd'
  // Readiness
  | 'readinessScore'
  | 'temperatureDeviation'
  | 'temperatureTrendDeviation'
  | 'stressHigh'
  | 'recoveryHigh'
  // Heart and breathing
  | 'heartRate'
  | 'heartRateMin'
  | 'heartRateMax'
  | 'sleepLowestHeartRate'
  | 'sleepAverageHeartRate'
  | 'sleepMaxHeartRate'
  | 'sleepAverageHrv'
  | 'sleepMaxHrv'
  | 'averageBreath'
  | 'spo2'
  | 'breathingDisturbanceIndex'

/**
 * timeOfDay values are seconds from local midnight (negative the evening before);
 * celsius values are deviations from the user's baseline.
 */
export type Unit =
  | 'steps'
  | 'seconds'
  | 'timeOfDay'
  | 'score'
  | 'percent'
  | 'bpm'
  | 'ms'
  | 'breathsPerMinute'
  | 'celsius'
  | 'index'
  | 'meters'

export interface Bucket {
  start: string
  end: string
  /** Sum of the bucket's daily values, in the metric's unit (use averagePerDay to compare). */
  total: number
  daysWithData: number
  averagePerDay: number
}

export interface SeriesResponse {
  metric: MetricId
  unit: Unit
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
  healthDays: number
  /** Oura collections the connection couldn't read (usually a scope that wasn't granted). */
  skipped: string[]
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
}
