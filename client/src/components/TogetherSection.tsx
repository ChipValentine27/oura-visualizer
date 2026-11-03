import { useState } from 'react'
import { ComposedChart, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { MetricId, Tag } from '../api'
import type { SeriesColor } from '../colors'
import { analyzeCombined, standardized, type Link } from '../combined'
import { shortDay } from '../dates'
import type { DayValue, Timeframe } from '../insights'
import { METRICS } from '../metrics'
import { summarizeTags } from './OverlayChart'

interface Props {
  ids: MetricId[]
  frame: Timeframe
  histories: Partial<Record<MetricId, DayValue[]>>
  colors: Record<MetricId, SeriesColor>
  tags: Tag[]
}

/** Options 1–4 across the chosen metrics: shared turning points on one chart, then each pair's links. */
export function TogetherSection({ ids, frame, histories, colors, tags }: Props) {
  const result = analyzeCombined(ids, frame, histories)
  const rows = standardized(ids, frame, histories)
  const [hovered, setHovered] = useState<string | null>(null)
  const row = rows.find((r) => r.day === hovered)
  const dayTags = row ? summarizeTags(tags, String(row.day), String(row.day)) : []

  return (
    <>
      <article className="insight-card">
        <header className="insight-card-header">
          <p className="insight-normal">
            <span>
              Each metric’s {frame.days >= 90 ? '7' : '3'}-day average, in steps of its usual spread from its median (0).
              Solid lines mark shared turning points.
            </span>
          </p>
          <ul className="chart-legend" aria-label="Legend">
            {ids.map((id) => (
              <li key={id}>
                <span className="legend-line" style={{ background: colors[id].fill }} aria-hidden />
                {METRICS[id].label}
              </li>
            ))}
            <li>
              <span className="legend-line legend-dashed" aria-hidden />
              Your usual (median)
            </li>
            {result.shifts.length > 0 && (
              <li>
                <span className="legend-line legend-vertical" aria-hidden />
                Shared turning point
              </li>
            )}
          </ul>
        </header>
        <div className="insight-chart">
          <ResponsiveContainer width="100%" height={170}>
            <ComposedChart
              data={rows}
              margin={{ top: 6, right: 4, bottom: 0, left: 4 }}
              onMouseMove={(state) => setHovered(state.activeLabel == null ? null : String(state.activeLabel))}
              onMouseLeave={() => setHovered(null)}
            >
              <XAxis dataKey="day" hide />
              <YAxis hide domain={['auto', 'auto']} />
              <ReferenceLine y={0} stroke="var(--axis)" strokeDasharray="3 3" />
              {result.shifts.map((s) => (
                <ReferenceLine key={s.day} x={s.day} stroke="var(--text-secondary)" />
              ))}
              {ids.map((id) => (
                <Line
                  key={id}
                  dataKey={id}
                  stroke={colors[id].fill}
                  strokeWidth={1.75}
                  dot={false}
                  connectNulls={false}
                  isAnimationActive={false}
                />
              ))}
              <Tooltip content={() => null} cursor={{ stroke: 'var(--axis)' }} />
            </ComposedChart>
          </ResponsiveContainer>
          <p className="insight-readout" aria-live="polite">
            {row && (
              <>
                <strong>{shortDay(String(row.day))}</strong>
                {ids.map((id) => {
                  const v = histories[id]!.find((d) => d.day === row.day)?.value ?? null
                  return (
                    <span key={id}>
                      {' · '}
                      {METRICS[id].label} {v === null ? '—' : METRICS[id].formatValue(v)}
                    </span>
                  )
                })}
                {dayTags.length > 0 && (
                  <span className="insight-readout-tags"> · {dayTags.map((t) => t.label).join(', ')}</span>
                )}
              </>
            )}
          </p>
        </div>
        {result.shifts.length === 0 ? (
          <p className="insight-empty">No shared turning points: none of these shifted level at the same time.</p>
        ) : (
          <ul className="insight-list">
            {result.shifts.map((s) => (
              <li key={s.day} className="insight insight-neutral">
                <span className="insight-icon" aria-hidden>
                  ⇅
                </span>
                <div>
                  <strong>{s.title}</strong>
                  <span className="insight-detail">{s.detail}</span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </article>

      <div className="insight-grid">
        {result.pairs.map((pair) => (
          <article key={`${pair.a}-${pair.b}`} className="insight-card">
            <header className="insight-card-header">
              <h3>
                <span className="swatch" style={{ background: colors[pair.a].fill }} aria-hidden />
                {METRICS[pair.a].label}
                <span className="pair-x">×</span>
                <span className="swatch" style={{ background: colors[pair.b].fill }} aria-hidden />
                {METRICS[pair.b].label}
              </h3>
            </header>
            {pair.missing ? (
              <p className="insight-empty">{pair.missing}</p>
            ) : pair.links.length === 0 ? (
              <p className="insight-empty">No clear link in this period, on the same day or a day or two apart.</p>
            ) : (
              <ul className="insight-list">
                {pair.links.map((l) => (
                  <LinkRow key={l.kind} link={l} />
                ))}
              </ul>
            )}
          </article>
        ))}
      </div>
    </>
  )
}

function LinkRow({ link }: { link: Link }) {
  const { compare } = link
  // Bars from zero only make sense for amounts; clock times and temperature offsets get none.
  const unit = METRICS[link.follower].unit
  const bars = compare && unit !== 'clock' && unit !== 'celsius' && compare.every((c) => c.value > 0)
  const max = compare ? Math.max(...compare.map((c) => c.value)) : 0
  return (
    <li className="insight insight-neutral">
      <span className="insight-icon" aria-hidden>
        {link.kind === 'leads' ? '→' : link.rho > 0 ? '⇈' : '⇅'}
      </span>
      <div className="link-body">
        <strong>{link.title}</strong>
        <span className="link-summary">{link.summary}</span>
        {compare && (
          <dl className="link-compare">
            {compare.map((c, i) => (
              <div key={c.label} className={i === 0 ? 'is-high' : 'is-low'}>
                <dt title={`Your ${i === 0 ? 'top' : 'bottom'} third of days for ${METRICS[link.leader].label}, compared with your usual level`}>
                  {c.label}
                </dt>
                <dd>
                  {bars && (
                    <span className="link-bar" aria-hidden>
                      <span style={{ width: `${(c.value / max) * 100}%` }} />
                    </span>
                  )}
                  <span className="link-value">{c.text}</span>
                </dd>
              </div>
            ))}
          </dl>
        )}
        <span className="link-meta" title={`Spearman r = ${link.rho.toFixed(2)}`}>
          {link.strength}
          {link.builtIn && ` · Built in: ${link.builtIn}`}
        </span>
      </div>
    </li>
  )
}
