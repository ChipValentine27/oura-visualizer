import { useEffect, useState } from 'react'

export type Theme = 'light' | 'dark'

export const THEMES: { value: Theme; label: string }[] = [
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
]

// Stored as a bare string (not JSON) so the inline script in index.html can read it before first paint.
const THEME_KEY = 'ouraviz.theme'

const isTheme = (value: unknown): value is Theme => THEMES.some((t) => t.value === value)

/** The stored choice, or the OS light/dark setting until the user picks one. */
function loadTheme(): Theme {
  try {
    const stored = localStorage.getItem(THEME_KEY)
    if (isTheme(stored)) return stored
  } catch {
    // Storage unavailable; fall back to the OS setting.
  }
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

/** The current theme and a setter that applies and remembers it. */
export function useTheme() {
  const [theme, setTheme] = useState<Theme>(loadTheme)

  useEffect(() => {
    // index.css keys the dark tokens on this attribute.
    document.documentElement.dataset.theme = theme
  }, [theme])

  const chooseTheme = (next: Theme) => {
    setTheme(next)
    try {
      localStorage.setItem(THEME_KEY, next)
    } catch {
      // Storage unavailable; the choice still applies for this visit.
    }
  }

  return [theme, chooseTheme] as const
}
