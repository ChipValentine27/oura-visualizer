import { THEMES, useTheme } from '../theme'

/** Light / Dark switch for the page header. */
export function ThemeToggle() {
  const [theme, setTheme] = useTheme()

  return (
    <div className="segmented small" role="radiogroup" aria-label="Theme">
      {THEMES.map((t) => (
        <button
          key={t.value}
          role="radio"
          aria-checked={theme === t.value}
          className={theme === t.value ? 'selected' : ''}
          onClick={() => setTheme(t.value)}
        >
          {t.label}
        </button>
      ))}
    </div>
  )
}
