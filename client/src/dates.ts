import type { Interval } from './api'

/** Dates travel as ISO yyyy-MM-dd strings; parse at noon local to dodge DST edges. */
export const parseDay = (iso: string) => new Date(`${iso}T12:00:00`)

export const toIso = (d: Date) => {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export const addDays = (iso: string, days: number) => {
  const d = parseDay(iso)
  d.setDate(d.getDate() + days)
  return toIso(d)
}

export const today = () => toIso(new Date())

const fmt = (opts: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat(undefined, opts)
const dayMonth = fmt({ month: 'short', day: 'numeric' })
const dayMonthYear = fmt({ month: 'short', day: 'numeric', year: 'numeric' })
const monthYear = fmt({ month: 'short', year: 'numeric' })
const monthShort = fmt({ month: 'short' })
const weekday = fmt({ weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })

/** Compact axis tick label for a bucket start. */
export function tickLabel(iso: string, interval: Interval, spansYears: boolean) {
  const d = parseDay(iso)
  switch (interval) {
    case 'daily':
    case 'weekly':
      return spansYears ? dayMonthYear.format(d) : dayMonth.format(d)
    case 'monthly':
      return spansYears ? monthYear.format(d) : monthShort.format(d)
    case 'yearly':
      return String(d.getFullYear())
  }
}

/** Full label for a bucket in the tooltip and table. */
export function bucketLabel(start: string, end: string, interval: Interval) {
  const s = parseDay(start)
  switch (interval) {
    case 'daily':
      return weekday.format(s)
    case 'weekly':
      return `${dayMonth.format(s)} – ${dayMonthYear.format(parseDay(end))}`
    case 'monthly':
      return fmt({ month: 'long', year: 'numeric' }).format(s)
    case 'yearly':
      return String(s.getFullYear())
  }
}

export const formatNumber = (n: number) => n.toLocaleString()

export const formatCompact = (n: number) =>
  new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 }).format(n)

/** Seconds as "7h 32m"; long totals drop the minutes ("1,240h"). */
export function formatDuration(seconds: number) {
  const totalMinutes = Math.round(seconds / 60)
  const h = Math.floor(totalMinutes / 60)
  const m = totalMinutes % 60
  if (h >= 100) return `${Math.round(seconds / 3600).toLocaleString()}h`
  if (h === 0) return `${m}m`
  return m === 0 ? `${h}h` : `${h}h ${m}m`
}

/** Axis tick for a value already in hours. */
export const formatHours = (hours: number) => `${hours.toLocaleString(undefined, { maximumFractionDigits: 1 })}h`
