import { useState } from 'preact/hooks';
import { Chess } from 'chess.js';
import { formatLine } from '../../core/fen';
import { checkPosition, materialSignature } from '../../core/positions';
import { settings, updateSettings } from '../../state/store';
import { Board } from '../Board';
import { EnginePanel } from '../EnginePanel';
import { playOutFrom, savePositionFrom } from '../launch';
import { MoveList } from '../MoveList';
import { playMoveSound } from '../sound';

/** Free analysis board from any position. Moves are not saved anywhere. */
export function Analysis(props: { params: Record<string, string> }) {
  const chk = checkPosition(props.params.fen ?? '');
  const start = chk.ok ? chk.fen : 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
  const [fens, setFens] = useState<string[]>([start]);
  const [sans, setSans] = useState<string[]>([]);
  const [ucis, setUcis] = useState<string[]>([]);
  const [cursor, setCursor] = useState(0);
  const [orient, setOrient] = useState<'white' | 'black'>(props.params.orient === 'b' ? 'black' : 'white');
  const fen = fens[cursor];
  const side = fen.split(' ')[1] as 'w' | 'b';
  const startTurn = start.split(' ')[1] === 'b' ? 'b' : 'w';
  const s = settings.value;
  const last = cursor ? ucis[cursor - 1] : null;

  const play = (from: string, to: string, promotion?: string) => {
    const c = new Chess(fen);
    let m;
    try {
      m = c.move({ from, to, promotion });
    } catch {
      return;
    }
    playMoveSound(m.san);
    setFens([...fens.slice(0, cursor + 1), c.fen()]);
    setSans([...sans.slice(0, cursor), m.san]);
    setUcis([...ucis.slice(0, cursor), from + to + (promotion ?? '')]);
    setCursor(cursor + 1);
  };

  return (
    <div class="screen">
      <div class="topbar">
        <button class="btn icon ghost" aria-label="Back" onClick={() => history.back()}>‹</button>
        <h1>Analysis · {materialSignature(fen)}</h1>
        <button class={`btn icon ${s.engineOn ? 'primary' : 'ghost'}`} aria-label="Engine" onClick={() => updateSettings({ engineOn: !s.engineOn })}>⚙︎</button>
        <button class="btn icon ghost" aria-label="Flip board" onClick={() => setOrient(orient === 'white' ? 'black' : 'white')}>⇅</button>
      </div>
      <Board fen={fen} orientation={orient} lastMove={last ? [last.slice(0, 2), last.slice(2, 4)] : null} onMove={play} />
      <div class="controls">
        <button class="btn" aria-label="Start" disabled={!cursor} onClick={() => setCursor(0)}>⏮</button>
        <button class="btn" aria-label="Back" disabled={!cursor} onClick={() => setCursor(cursor - 1)}>◀</button>
        <button class="btn" aria-label="Forward" disabled={cursor >= sans.length} onClick={() => setCursor(cursor + 1)}>▶</button>
        <button class="btn" aria-label="End" disabled={cursor >= sans.length} onClick={() => setCursor(sans.length)}>⏭</button>
      </div>
      <div class="scroll">
        {s.engineOn && <EnginePanel fen={fen} ply={cursor + (startTurn === 'b' ? 1 : 0)} onPlay={(u) => play(u.slice(0, 2), u.slice(2, 4), u[4])} />}
        <MoveList entries={sans.map((x) => ({ san: x, saved: true }))} cursor={cursor} onJump={setCursor} startTurn={startTurn} />
        {!chk.ok && props.params.fen && <p class="pad small" style="color:var(--red)">{chk.errors[0]}</p>}
        <div class="pad row wrap" style="gap:8px">
          <button class="btn grow" onClick={() => playOutFrom(fen, orient === 'white' ? 'w' : 'b')}>⚔︎ Play it out</button>
          <button class="btn grow" onClick={() => savePositionFrom(fen, 'editor', '', orient === 'white' ? 'w' : 'b')}>💾 Save position</button>
        </div>
        <p class="pad small muted">
          Free analysis — moves here aren’t saved. {side === 'w' ? 'White' : 'Black'} to move. {sans.length ? formatLine(sans, startTurn) : ''}
        </p>
      </div>
    </div>
  );
}
