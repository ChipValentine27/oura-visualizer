/**
 * The colors a series can be shown in. The first eight are the validated categorical palette
 * (in its fixed order); lime and cyan were added to make ten. Each has a light- and dark-theme
 * value plus a hover ("active") step, defined as CSS custom properties in index.css.
 */
export const COLORS = [
  { id: 'blue', label: 'Blue' },
  { id: 'orange', label: 'Orange' },
  { id: 'aqua', label: 'Aqua' },
  { id: 'yellow', label: 'Yellow' },
  { id: 'magenta', label: 'Magenta' },
  { id: 'green', label: 'Green' },
  { id: 'violet', label: 'Violet' },
  { id: 'red', label: 'Red' },
  { id: 'lime', label: 'Lime' },
  { id: 'cyan', label: 'Cyan' },
] as const

export type ColorId = (typeof COLORS)[number]['id']

export interface SeriesColor {
  fill: string
  active: string
}

export const seriesColor = (id: ColorId): SeriesColor => ({
  fill: `var(--color-${id})`,
  active: `var(--color-${id}-active)`,
})

export const isColorId = (value: unknown): value is ColorId => COLORS.some((c) => c.id === value)

export const colorLabel = (id: ColorId) => COLORS.find((c) => c.id === id)!.label
