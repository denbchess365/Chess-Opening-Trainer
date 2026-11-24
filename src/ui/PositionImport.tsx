import { useState } from 'preact/hooks';
import { formatLine } from '../core/fen';
import { pgnMainline, type Mainline } from '../core/pgn';
import { checkPosition } from '../core/positions';
import { Board } from './Board';
import { openModal } from './dialogs';
import { pickTextFile } from './files';
import { go } from './router';

/** Opens the editor with a FEN (the editor validates and shows any problems). */
export function openEditorWith(fen: string, source: string) {
  go(`position/new?fen=${encodeURIComponent(fen)}&source=${source}`);
}

function FenPaste(props: { close: () => void }) {
  const [text, setText] = useState('');
  const chk = text.trim() ? checkPosition(text) : null;
  return (
    <div>
      <h3>Paste a FEN</h3>
      <textarea style="min-height:80px" placeholder="8/8/8/4k3/8/8/8/3BNK2 w - - 0 1" value={text} onInput={(e) => setText((e.target as HTMLTextAreaElement).value)} />
      {chk && !chk.ok && (
        <ul class="small" style="color:var(--red);padding-left:18px">
          {chk.errors.map((e) => (
            <li>{e}</li>
          ))}
        </ul>
      )}
      {chk?.ok && chk.warnings.length > 0 && <p class="small" style="color:var(--orange)">{chk.warnings.join(' ')}</p>}
      <div class="row" style="margin-top:10px">
        <button class="btn grow" onClick={props.close}>Cancel</button>
        <button class="btn primary grow" disabled={!chk?.ok} onClick={() => (props.close(), openEditorWith(chk!.fen, 'fen'))}>
          Continue
        </button>
      </div>
    </div>
  );
}

function PgnPick(props: { close: () => void }) {
  const [text, setText] = useState('');
  const [ml, setMl] = useState<Mainline | null>(null);
  const [error, setError] = useState('');
  const [ply, setPly] = useState(0);

  const read = (t: string) => {
    setText(t);
    setError('');
    try {
      const m = pgnMainline(t);
      if (!m.sans.length) throw new Error('No moves found in this PGN.');
      setMl(m);
      setPly(m.sans.length); // default: the final position
    } catch (e) {
      setMl(null);
      setError((e as Error).message);
    }
  };

  if (!ml)
    return (
      <div>
        <h3>Position from a PGN</h3>
        <p class="small muted">Uses the main line of the first game. You can pick any move afterwards.</p>
        <button class="btn block" onClick={async () => { const t = await pickTextFile('.pgn,text/plain,application/x-chess-pgn'); if (t) read(t); }}>
          Choose .pgn file…
        </button>
        <textarea style="margin-top:8px" placeholder="Paste PGN here" value={text} onInput={(e) => setText((e.target as HTMLTextAreaElement).value)} />
        {error && <p class="small" style="color:var(--red)">{error}</p>}
        <div class="row" style="margin-top:10px">
          <button class="btn grow" onClick={props.close}>Cancel</button>
          <button class="btn primary grow" disabled={!text.trim()} onClick={() => read(text)}>Read PGN</button>
        </div>
      </div>
    );

  const fen = ply === 0 ? ml.startFen : ml.fens[ply - 1];
  const startTurn = ml.startFen.split(' ')[1] === 'b' ? 'b' : 'w';
  const startNo = Number(ml.startFen.split(' ')[5]) || 1;
  return (
    <div>
      <h3>Pick the position</h3>
      <Board fen={fen} orientation={fen.split(' ')[1] === 'b' ? 'black' : 'white'} movableColor={null} />
      <p class="small" style="margin:8px 0">
        {ply === 0 ? 'Start of the game' : `After ${formatLine(ml.sans.slice(0, ply), startTurn, startNo).split(' ').slice(-2).join(' ')}`}
        {ply === ml.sans.length ? ' (final position)' : ''}
      </p>
      <input type="range" min={0} max={ml.sans.length} value={ply} style="width:100%" onInput={(e) => setPly(Number((e.target as HTMLInputElement).value))} />
      <div class="row" style="margin-top:6px">
        <button class="btn small" disabled={ply === 0} onClick={() => setPly(ply - 1)}>◀</button>
        <button class="btn small" disabled={ply === ml.sans.length} onClick={() => setPly(ply + 1)}>▶</button>
        <span class="grow" />
        <button class="btn small ghost" onClick={() => setMl(null)}>Other PGN</button>
      </div>
      <div class="row" style="margin-top:10px">
        <button class="btn grow" onClick={props.close}>Cancel</button>
        <button class="btn primary grow" onClick={() => (props.close(), openEditorWith(fen, 'pgn'))}>Use this position</button>
      </div>
    </div>
  );
}

export const openFenPaste = () => openModal((close) => <FenPaste close={close} />);
export const openPgnPick = () => openModal((close) => <PgnPick close={close} />);
