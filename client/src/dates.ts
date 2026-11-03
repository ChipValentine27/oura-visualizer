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

/** An instant as ISO 8601 with the local offset ("2025-03-01T00:00:00-05:00"). */
function toIsoInstant(d: Date) {
  const offset = -d.getTimezoneOffset()
  const sign = offset >= 0 ? '+' : '-'
  const abs = Math.abs(offset)
  const hh = String(Math.floor(abs / 60)).padStart(2, '0')
  const mm = String(abs % 60).padStart(2, '0')
  const time = [d.getHours(), d.getMinutes(), d.getSeconds()].map((n) => String(n).padStart(2, '0')).join(':')
  return `${toIso(d)}T${time}${sign}${hh}:${mm}`
}

/** Local midnight at the start of `start` to local midnight after `end`, as ISO instants. */
export function dayBounds(start: string, end: string) {
  return {
    from: toIsoInstant(new Date(`${start}T00:00:00`)),
    to: toIsoInstant(new Date(`${addDays(end, 1)}T00:00:00`)),
  }
}

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

/** "Oct 19". */
export const shortDay = (iso: string) => dayMonth.format(parseDay(iso))

export const formatNumber =(n: number) => n.toLocaleString()

const clock = fmt({ hour: 'numeric', minute: '2-digit' })

/**
 * Seconds from local midnight as a clock time in the user's locale ("11:24 PM"). Wraps
 * around midnight, so −1,800 (the evening before) reads as 11:30 PM.
 */
export function formatClock(seconds: number) {
  const minutes = ((Math.round(seconds / 60) % 1440) + 1440) % 1440
  return clock.format(new Date(2000, 0, 1, Math.floor(minutes / 60), minutes % 60))
}

/** Seconds as "7h 32m"; long totals drop the minutes ("1,240h"). */
export function formatDuration(seconds: number) {
  const totalMinutes = Math.round(seconds / 60)
  const h = Math.floor(totalMinutes / 60)
  const m = totalMinutes % 60
  if (h >= 100) return `${Math.round(seconds / 3600).toLocaleString()}h`
  if (h === 0) return `${m}m`
  return m === 0 ? `${h}h` : `${h}h ${m}m`
}
