import { useEffect, useState } from 'react'

/** The user's choice; 'system' follows the OS light/dark setting. */
export type Theme = 'system' | 'light' | 'dark'

export const THEMES: { value: Theme; label: string }[] = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
]

// Stored as a bare string (not JSON) so the inline script in index.html can read it before first paint.
const THEME_KEY = 'ouraviz.theme'

const isTheme = (value: unknown): value is Theme => THEMES.some((t) => t.value === value)

function loadTheme(): Theme {
  try {
    const stored = localStorage.getItem(THEME_KEY)
    return isTheme(stored) ? stored : 'system'
  } catch {
    return 'system'
  }
}

const darkQuery = () => window.matchMedia('(prefers-color-scheme: dark)')

/** Sets data-theme on <html> to the theme actually shown, which index.css keys the dark tokens on. */
function applyTheme(theme: Theme) {
  const resolved = theme === 'system' ? (darkQuery().matches ? 'dark' : 'light') : theme
  document.documentElement.dataset.theme = resolved
}

/** The current theme choice and a setter that applies and remembers it. */
export function useTheme() {
  const [theme, setTheme] = useState<Theme>(loadTheme)

  useEffect(() => {
    applyTheme(theme)
    if (theme !== 'system') return
    // Follow the OS while on 'system', e.g. when it switches to dark at sunset.
    const query = darkQuery()
    const onChange = () => applyTheme('system')
    query.addEventListener('change', onChange)
    return () => query.removeEventListener('change', onChange)
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
