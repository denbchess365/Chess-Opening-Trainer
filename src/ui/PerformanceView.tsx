import { useState } from 'preact/hooks';
import { formatLine } from '../core/fen';
import { performance, type OpeningPerf } from '../core/review';
import type { LichessGame } from '../core/types';
import { gameLineUci, myGames } from '../state/review';
import { findings, repertoireById } from '../state/store';
import { go } from './router';

/** How many plies of the game identify a "repertoire line" (keeps groups meaningful). */
const LINE_PLIES = 8;

function Row(props: { p: OpeningPerf; onClick?: () => void }) {
  const { p } = props;
  const pct = Math.round(p.score * 100);
  const color = pct < 40 ? 'var(--red)' : pct < 55 ? 'var(--orange)' : 'var(--green)';
  return (
    <div class="list-item" style={props.onClick ? 'cursor:pointer' : ''} onClick={props.onClick}>
      <div class="grow" style="min-width:0">
        <div class="small" style="font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">{p.label}</div>
        <div class="small muted">
          {p.games} game{p.games === 1 ? '' : 's'} · +{p.wins} ={p.draws} −{p.losses}
        </div>
        <div class="progress" style="margin-top:4px">
          <div style={`width:${pct}%;background:${color}`} />
        </div>
      </div>
      <b style={`color:${color};min-width:44px;text-align:right`}>{pct}%</b>
    </div>
  );
}

export function PerformanceView() {
  const [by, setBy] = useState<'line' | 'eco'>('line');
  const [color, setColor] = useState<'all' | 'w' | 'b'>('all');
  const games = myGames.value.filter((g) => color === 'all' || g.myColor === color);
  const fByGame = new Map(findings.value.map((f) => [f.gameId, f]));
  const total = performance(games, () => ({ key: 'all', label: 'All games' }))[0];

  // Repertoire line = the in-book part of the game (until it left the repertoire), first few moves.
  const lineKey = (g: LichessGame) => {
    const f = fByGame.get(g.id);
    if (!f) return null;
    const rep = repertoireById(f.repertoireId);
    if (!rep) return null;
    const inBook = Math.min(f.ply, LINE_PLIES);
    const sans = g.moves.split(/\s+/).slice(0, inBook);
    return { key: `${rep.id}|${sans.join(' ')}`, label: `${rep.name}: ${formatLine(sans) || 'start'}` };
  };
  const rows =
    by === 'eco'
      ? performance(games, (g) => (g.eco || g.openingName ? { key: g.eco + g.openingName, label: `${g.eco} ${g.openingName}`.trim() } : null))
      : performance(games, lineKey);

  const openLine = (key: string) => {
    const [repId, sanStr] = key.split('|');
    const g = games.find((x) => lineKey(x)?.key === key);
    if (!g) return;
    go(`build/${repId}?line=${gameLineUci(g, sanStr ? sanStr.split(' ').length : 0).join(',')}`);
  };

  if (!myGames.value.length) return <p class="pad muted small">Sync your Lichess games first.</p>;
  return (
    <div>
      <div class="card">
        {total && (
          <div class="row">
            <div class="grow">
              <b>{total.games} games</b> · +{total.wins} ={total.draws} −{total.losses}
            </div>
            <b>{Math.round(total.score * 100)}%</b>
          </div>
        )}
        <div class="chips" style="margin-top:10px">
          <button class={`chip ${by === 'line' ? 'on' : ''}`} onClick={() => setBy('line')}>By repertoire line</button>
          <button class={`chip ${by === 'eco' ? 'on' : ''}`} onClick={() => setBy('eco')}>By opening (ECO)</button>
        </div>
        <div class="chips" style="margin-top:8px">
          {(['all', 'w', 'b'] as const).map((c) => (
            <button class={`chip ${color === c ? 'on' : ''}`} onClick={() => setColor(c)}>
              {c === 'all' ? 'Both colours' : c === 'w' ? 'As White' : 'As Black'}
            </button>
          ))}
        </div>
        <p class="small muted">Weakest first. Score = (wins + ½ draws) ÷ games.{by === 'line' ? ' Tap a line to open it in Build.' : ''}</p>
      </div>
      <div class="card">
        {rows.length === 0 && <p class="muted small">No games in this view.</p>}
        {rows.map((p) => (
          <Row p={p} onClick={by === 'line' ? () => openLine(p.key) : undefined} />
        ))}
      </div>
    </div>
  );
}
