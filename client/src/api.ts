export type Interval = 'daily' | 'weekly' | 'monthly' | 'yearly'

export interface StepBucket {
  start: string
  end: string
  totalSteps: number
  daysWithData: number
  averageDailySteps: number
}

export interface StepsResponse {
  start: string
  end: string
  interval: Interval
  buckets: StepBucket[]
  totalSteps: number
  daysWithData: number
  averageDailySteps: number
}

export interface DataRange {
  firstDay: string | null
  lastDay: string | null
  dayCount: number
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
  steps: (start: string, end: string, interval: Interval, signal?: AbortSignal) =>
    request<StepsResponse>(`/api/steps?${new URLSearchParams({ start, end, interval })}`, { signal }),
  range: () => request<DataRange>('/api/steps/range'),
  ouraStatus: () => request<OuraStatus>('/api/oura/status'),
  /** A full-page navigation, not fetch: the server redirects the browser to Oura's consent page. */
  ouraConnectUrl: '/api/oura/connect',
  ouraDisconnect: async () => {
    const res = await fetch('/api/oura/disconnect', { method: 'POST' })
    if (!res.ok) throw new Error(`Disconnect failed (${res.status})`)
  },
  syncOura: (start: string, end: string) =>
    request<{ daysSynced: number }>(`/api/sync/oura?${new URLSearchParams({ start, end })}`, { method: 'POST' }),
  seedDemo: (start: string, end: string) =>
    request<{ daysSeeded: number }>(`/api/sync/demo?${new URLSearchParams({ start, end })}`, { method: 'POST' }),
}
