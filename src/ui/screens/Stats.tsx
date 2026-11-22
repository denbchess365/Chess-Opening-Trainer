import { formatLine } from '../../core/fen';
import { drillableMoves, pathTo } from '../../core/tree';
import type { Move } from '../../core/types';
import { cardFor, currentStreak, graphOf, repertoires, stats } from '../../state/store';
import { go } from '../router';
import { pct } from './Home';

export function Stats() {
  const missed: { m: Move; wrong: number; right: number; line: string; rep: string }[] = [];
  for (const r of repertoires.value) {
    const g = graphOf(r.id);
    for (const m of drillableMoves(g)) {
      const c = cardFor(m);
      if (c.wrong > 0) {
        const path = pathTo(g, m.fromFen) ?? [];
        missed.push({ m, wrong: c.wrong, right: c.right, line: formatLine(path.map((x) => x.san)), rep: r.name });
      }
    }
  }
  missed.sort((a, b) => b.wrong - a.wrong || a.right - b.right);
  const top = missed.slice(0, 20);
  const drill = (ids: string[]) => go(`practice?mode=moves&moves=${ids.join(',')}&auto=1&t=${Date.now()}`);

  return (
    <div class="screen">
      <div class="topbar">
        <button class="btn icon ghost" aria-label="Home" onClick={() => go('')}>‹</button>
        <h1>Stats</h1>
        <span class="badge grey" style="font-size:15px">🔥 {currentStreak.value}</span>
      </div>
      <div class="scroll">
        {repertoires.value.map((r) => {
          const s = stats.value.get(r.id)!;
          return (
            <div class="card">
              <h2>{r.side === 'w' ? '♔' : '♚'} {r.name}</h2>
              <div class="stat-grid">
                <div class="stat">
                  <div class="v">{pct(s.completeRatio)}</div>
                  <div class="l">complete · {s.prepared} prepared / {s.gaps} gaps</div>
                </div>
                <div class="stat">
                  <div class="v">{pct(s.masteredRatio)}</div>
                  <div class="l">mastered · {s.mastered} of {s.total}</div>
                </div>
                <div class="stat">
                  <div class="v" style="color:var(--orange)">{s.due}</div>
                  <div class="l">due now</div>
                </div>
                <div class="stat">
                  <div class="v">{s.total}</div>
                  <div class="l">moves to drill</div>
                </div>
              </div>
              <div class="row" style="margin-top:10px">
                {s.gaps > 0 && <button class="btn small grow" onClick={() => go(`build/${r.id}`)}>Fill {s.gaps} gap{s.gaps > 1 ? 's' : ''}</button>}
                {s.due > 0 && <button class="btn small primary grow" onClick={() => go(`practice?mode=due&rep=${r.id}&auto=1`)}>Practice {s.due} due</button>}
              </div>
            </div>
          );
        })}

        <div class="card">
          <h2>Most-missed moves</h2>
          {top.length === 0 ? (
            <p class="muted small">No mistakes recorded yet.</p>
          ) : (
            <>
              {top.map((x) => (
                <div class="list-item" style="cursor:pointer" onClick={() => drill([x.m.id])}>
                  <div class="grow" style="min-width:0">
                    <div class="small muted" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">
                      {x.rep}: {x.line || 'start'}
                    </div>
                    <div>
                      → <b>{x.m.san}</b>
                    </div>
                  </div>
                  <span class="badge" style="background:var(--red);color:#fff">✗ {x.wrong}</span>
                  <span class="badge green">✓ {x.right}</span>
                </div>
              ))}
              <button class="btn block" style="margin-top:10px" onClick={() => drill(top.map((x) => x.m.id))}>
                Drill all {top.length}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
