import { useMemo, useState } from 'preact/hooks';
import { buildSession, countTargets } from '../../core/practice';
import { materialSignature } from '../../core/positions';
import { isDue } from '../../core/scheduler';
import { cardFor, collections, graphOf, positionCard, positions, repertoireById } from '../../state/store';
import { go } from '../router';
import { Drill, startPlayouts } from './Practice';

/** "Practice positions": play-outs and/or position lines, filtered by collection, tag, goal and material. */
export function PositionPractice(props: { params: Record<string, string> }) {
  const p0 = props.params;
  const [coll, setColl] = useState(p0.coll || 'all');
  const [tag] = useState(p0.tag || '');
  const [goal] = useState(p0.goal || '');
  const [sig] = useState(p0.sig || '');
  const [mode, setMode] = useState<'due' | 'all'>('due');
  const [what, setWhat] = useState<'both' | 'playOut' | 'lines'>('both');
  const [running, setRunning] = useState(false);

  const filtered = positions.value.filter(
    (p) =>
      (coll === 'all' || (coll === 'none' ? !p.collectionId : p.collectionId === coll)) &&
      (!tag || p.tags.includes(tag)) &&
      (!goal || p.goal === goal) &&
      (!sig || materialSignature(p.fen) === sig),
  );
  const session = useMemo(() => {
    const reps = what === 'playOut' ? [] : filtered.filter((p) => p.practiceModes.includes('lines') && p.repertoireId).map((p) => repertoireById(p.repertoireId!)).filter((r) => !!r);
    const lines = buildSession(
      reps.map((rep) => ({ rep: rep!, graph: graphOf(rep!.id) })),
      cardFor,
      { mode: mode === 'due' ? 'due' : 'cram', side: 'both', dailySize: 999 },
    );
    const playouts =
      what === 'lines' ? [] : filtered.filter((p) => p.practiceModes.includes('playOut') && (mode === 'all' || isDue(positionCard(p)))).map((p) => p.id);
    return { lines, playouts };
  }, [coll, mode, what, positions.value]);

  if (running && session.lines.length) return <Drill lines={session.lines} playouts={session.playouts} doneTo="positions" onExit={() => go('positions')} />;

  const nMoves = countTargets(session.lines);
  const n = nMoves + session.playouts.length;
  const filterText = [tag && `tag “${tag}”`, goal && `goal ${goal}`, sig].filter(Boolean).join(' · ');
  return (
    <div class="screen">
      <div class="topbar">
        <button class="btn icon ghost" aria-label="Back" onClick={() => go('positions')}>‹</button>
        <h1>Practice positions</h1>
      </div>
      <div class="scroll">
        <div class="card">
          <h2>Collection</h2>
          <div class="chips">
            <button class={`chip ${coll === 'all' ? 'on' : ''}`} onClick={() => setColl('all')}>All</button>
            {collections.value.map((c) => (
              <button class={`chip ${coll === c.id ? 'on' : ''}`} onClick={() => setColl(c.id)}>{c.name}</button>
            ))}
          </div>
          {filterText && <p class="small muted">Also filtered by {filterText} (change on the Positions screen).</p>}
          <h2 style="margin-top:14px">What</h2>
          <div class="chips">
            {([['both', 'Both'], ['playOut', '⚔︎ Play it out'], ['lines', '📖 Drill lines']] as const).map(([v, l]) => (
              <button class={`chip ${what === v ? 'on' : ''}`} onClick={() => setWhat(v)}>{l}</button>
            ))}
          </div>
          <h2 style="margin-top:14px">Which</h2>
          <div class="chips">
            <button class={`chip ${mode === 'due' ? 'on' : ''}`} onClick={() => setMode('due')}>Due now</button>
            <button class={`chip ${mode === 'all' ? 'on' : ''}`} onClick={() => setMode('all')}>All (cram)</button>
          </div>
        </div>
        <div class="pad">
          <button
            class="btn primary block"
            disabled={!n}
            onClick={() => (session.lines.length ? setRunning(true) : startPlayouts(session.playouts, 'positions'))}
          >
            {n
              ? `Start · ${[nMoves ? `${nMoves} line move${nMoves === 1 ? '' : 's'}` : '', session.playouts.length ? `${session.playouts.length} play-out${session.playouts.length === 1 ? '' : 's'}` : ''].filter(Boolean).join(' + ')}`
              : 'Nothing to practise here'}
          </button>
          <p class="small muted center">Lines are drilled first, then each position is played out against the engine.</p>
        </div>
      </div>
    </div>
  );
}
