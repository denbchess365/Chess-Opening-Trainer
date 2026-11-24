import { useState } from 'preact/hooks';

export interface ChartPoint {
  /** Moves taken in that successful run. */
  value: number;
  at: number;
  hints: number;
}

/**
 * Moves-to-mate per successful run over time (one series, so no legend; the heading
 * names it). Dashed line = the engine's mate distance from the start. Tap a point for details.
 */
export function MovesChart(props: { points: ChartPoint[]; reference?: number }) {
  const { points, reference } = props;
  const [sel, setSel] = useState<number | null>(points.length - 1);
  if (points.length < 2) return null;
  const W = 320;
  const H = 96;
  const pad = { l: 26, r: 12, t: 14, b: 14 };
  const vals = points.map((p) => p.value);
  const lo = Math.max(0, Math.min(...vals, reference ?? Infinity) - 2);
  const hi = Math.max(...vals, reference ?? 0) + 2;
  const x = (i: number) => pad.l + (i * (W - pad.l - pad.r)) / Math.max(1, points.length - 1);
  const y = (v: number) => pad.t + ((hi - v) * (H - pad.t - pad.b)) / Math.max(1, hi - lo);
  const path = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(' ');
  const s = sel !== null ? points[sel] : null;
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="Moves to mate per successful attempt">
        {[lo, Math.round((lo + hi) / 2), hi].map((v) => (
          <g>
            <line x1={pad.l} x2={W - pad.r} y1={y(v)} y2={y(v)} stroke="var(--line)" stroke-width="1" />
            <text x={pad.l - 4} y={y(v) + 3} text-anchor="end" font-size="9" fill="var(--muted)">{Math.round(v)}</text>
          </g>
        ))}
        {reference && (
          <g>
            <line x1={pad.l} x2={W - pad.r} y1={y(reference)} y2={y(reference)} stroke="var(--chart-ref)" stroke-width="1.5" stroke-dasharray="4 3" />
            <text x={pad.l + 4} y={y(reference) + 11} text-anchor="start" font-size="9" fill="var(--muted)">engine {reference}</text>
          </g>
        )}
        <path d={path} fill="none" stroke="var(--chart-line)" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" />
        {points.map((p, i) => (
          <g style="cursor:pointer" onClick={() => setSel(i)}>
            <circle cx={x(i)} cy={y(p.value)} r="12" fill="transparent" />
            <circle cx={x(i)} cy={y(p.value)} r={sel === i ? 5 : 4} fill="var(--chart-line)" stroke="var(--bg2)" stroke-width="2">
              <title>{`${p.value} moves · ${new Date(p.at).toLocaleDateString()}${p.hints ? ` · ${p.hints} hint(s)` : ''}`}</title>
            </circle>
          </g>
        ))}
      </svg>
      {s && (
        <div class="small muted">
          Attempt {sel! + 1}: <b style="color:var(--text)">{s.value} moves</b> · {new Date(s.at).toLocaleDateString()}
          {s.hints ? ` · ${s.hints} hint${s.hints === 1 ? '' : 's'}` : ''}
        </div>
      )}
    </div>
  );
}
