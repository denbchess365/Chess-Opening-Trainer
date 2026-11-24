import { useEffect, useState } from 'preact/hooks';
import { formatLine, playMove, ROOT, type PlayedMove } from '../../core/fen';
import { findGaps } from '../../core/tree';
import type { Move } from '../../core/types';
import {
  addLine,
  deleteCount,
  deleteMove,
  graphOf,
  repertoireById,
  repertoires,
  setComment,
  setPrimary,
  settings,
  updateSettings,
} from '../../state/store';
import { Board } from '../Board';
import { actionSheet, confirmDialog, promptDialog, toast } from '../dialogs';
import { MoveList } from '../MoveList';
import { go } from '../router';
import { playMoveSound } from '../sound';
import { useBook } from '../useBook';
import { EnginePanel } from '../EnginePanel';
import { requestAutoBackup } from '../../state/gistBackup';

export function moveToPlayed(m: Move): PlayedMove {
  return { san: m.san, uci: m.uci, from: m.uci.slice(0, 2), to: m.uci.slice(2, 4), fromFen: m.fromFen, toFen: m.toFen };
}

/** Remembers where you were in each repertoire while the app is open. */
const memory = new Map<string, { path: PlayedMove[]; cursor: number }>();

/** Replays a comma-separated list of UCI moves from the start (used to open a position from a game). */
function pathFromUci(line: string | undefined): PlayedMove[] | null {
  if (!line) return null;
  const out: PlayedMove[] = [];
  let f = ROOT;
  for (const uci of line.split(',').slice(0, 300)) {
    if (!/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(uci)) return null;
    const p = playMove(f, { from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
    if (!p) return null;
    out.push(p);
    f = p.toFen;
  }
  return out;
}

export function Build(props: { repId: string; fen?: string; line?: string }) {
  const rep = repertoireById(props.repId);
  const g = graphOf(props.repId);
  const remembered = memory.get(props.repId);
  const fromGame = pathFromUci(props.line);
  const [path, setPath] = useState<PlayedMove[]>(fromGame ?? remembered?.path ?? []);
  const [cursor, setCursor] = useState(fromGame ? fromGame.length : (remembered?.cursor ?? 0));
  const [flipped, setFlipped] = useState(false);
  const [tab, setTab] = useState<'moves' | 'book' | 'gaps'>('moves');
  const bk = useBook();
  const s = settings.value;

  useEffect(() => {
    memory.set(props.repId, { path, cursor });
  }, [path, cursor, props.repId]);
  useEffect(() => () => requestAutoBackup(), []); // end of a build session

  if (!rep)
    return (
      <div class="screen">
        <div class="topbar">
          <button class="btn icon ghost" onClick={() => go('')}>‹</button>
          <h1>Not found</h1>
        </div>
      </div>
    );

  const fen = cursor ? path[cursor - 1].toFen : ROOT;
  const lastMove: [string, string] | null = cursor ? [path[cursor - 1].from, path[cursor - 1].to] : null;
  const myTurn = g.isMyTurn(fen);
  const children = g.children(fen);
  const current = cursor ? g.findByUci(path[cursor - 1].fromFen, path[cursor - 1].uci) : undefined;
  const opening = bk?.nameForLine([ROOT, ...path.slice(0, cursor).map((p) => p.toFen)]);
  const gaps = findGaps(g);
  const entries = path.map((p) => ({ san: p.san, saved: !!g.findByUci(p.fromFen, p.uci) }));
  const unsaved = entries.slice(0, cursor).filter((e) => !e.saved).length;
  const orientation = (rep.side === 'w') !== flipped ? 'white' : 'black';

  async function play(p: PlayedMove) {
    playMoveSound(p.san);
    const next = path[cursor];
    if (next && next.fromFen === p.fromFen && next.uci === p.uci) {
      setCursor(cursor + 1);
      return;
    }
    setPath([...path.slice(0, cursor), p]);
    setCursor(cursor + 1);
    if (settings.value.autoSave && !g.findByUci(p.fromFen, p.uci)) {
      // Save the whole line up to here, so moves opened from a game (shown as unsaved) become reachable.
      const saved = await addLine(rep!.id, [...path.slice(0, cursor), p]);
      const m = saved[saved.length - 1];
      if (m.isMine && !m.isPrimary)
        toast(`Saved ${m.san} as an alternative (not drilled). Tap ⋯ on it to make it your main move.`, 4000);
    }
  }

  function onBoardMove(from: string, to: string, promotion?: string) {
    const p = playMove(fen, { from, to, promotion });
    if (p) play(p);
  }

  function mainChild(f: string): Move | undefined {
    const kids = g.children(f);
    return g.isMyTurn(f) ? (g.primary(f) ?? kids[0]) : kids[0];
  }

  function forward() {
    if (cursor < path.length) setCursor(cursor + 1);
    else {
      const m = mainChild(fen);
      if (m) play(moveToPlayed(m));
    }
  }

  function toEnd() {
    let p = path.slice();
    let c = cursor;
    let f = fen;
    const seen = new Set<string>();
    for (let i = 0; i < 300; i++) {
      if (c < p.length) {
        f = p[c].toFen;
        c++;
        continue;
      }
      const m = mainChild(f);
      if (!m || seen.has(m.toFen)) break;
      seen.add(m.toFen);
      p.push(moveToPlayed(m));
      c++;
      f = m.toFen;
    }
    setPath(p);
    setCursor(c);
  }

  function jumpToLine(moves: Move[]) {
    setPath(moves.map(moveToPlayed));
    setCursor(moves.length);
  }

  async function onDelete(m: Move) {
    const n = deleteCount(m.id);
    const ok = await confirmDialog(
      n > 1 ? `Delete ${m.san} and the ${n - 1} move${n > 2 ? 's' : ''} that follow it?` : `Delete ${m.san}?`,
      { ok: 'Delete', danger: true },
    );
    if (!ok) return;
    await deleteMove(m.id);
    const idx = path.findIndex((p) => p.fromFen === m.fromFen && p.uci === m.uci);
    if (idx >= 0) {
      setPath(path.slice(0, idx));
      setCursor(Math.min(cursor, idx));
    }
  }

  async function editComment(m: Move) {
    const c = await promptDialog(`Comment on ${m.san}`, m.comment, { multiline: true, placeholder: 'Ideas, plans, traps…' });
    if (c !== null) await setComment(m.id, c.trim());
  }

  function moveMenu(m: Move) {
    actionSheet(m.san, [
      ...(m.isMine && !m.isPrimary ? [{ label: '★ Make this my main move', run: () => setPrimary(m.id) }] : []),
      { label: m.comment ? 'Edit comment' : 'Add comment', run: () => editComment(m) },
      { label: 'Delete move…', danger: true, run: () => onDelete(m) },
    ]);
  }

  function menu() {
    actionSheet(rep!.name, [
      { label: '🎯 Drill from this position', run: () => go(`practice?mode=subtree&rep=${rep!.id}&fen=${encodeURIComponent(fen)}&auto=1`) },
      {
        label: settings.value.autoSave ? 'Auto-save moves: ON (tap to turn off)' : 'Auto-save moves: OFF (tap to turn on)',
        run: () => updateSettings({ autoSave: !settings.value.autoSave }),
      },
      { label: 'Gaps to prepare', run: () => setTab('gaps') },
    ]);
  }

  async function saveLine() {
    await addLine(rep!.id, path.slice(0, cursor));
    toast('Line saved');
  }

  let status: string;
  if (myTurn) {
    const p = g.primary(fen);
    status = p ? `Your move here: ${p.san}` : 'Your turn — play the move you want to drill.';
  } else {
    const n = children.length;
    status = n ? `Opponent to move — ${n} repl${n === 1 ? 'y' : 'ies'} prepared.` : 'Opponent to move — add the replies you want to prepare.';
  }

  return (
    <div class="screen">
      <div class="topbar">
        <button class="btn icon ghost" aria-label="Home" onClick={() => go('')}>‹</button>
        <select
          class="grow"
          style="min-width:0;font-weight:600"
          value={rep.id}
          onChange={(e) => go(`build/${(e.target as HTMLSelectElement).value}`)}
        >
          {repertoires.value.map((r) => (
            <option value={r.id}>{r.name}</option>
          ))}
        </select>
        <button
          class={`btn icon ${s.engineOn ? 'primary' : 'ghost'}`}
          aria-label="Engine"
          onClick={() => updateSettings({ engineOn: !s.engineOn })}
        >
          ⚙︎
        </button>
        <button class="btn icon ghost" aria-label="Flip board" onClick={() => setFlipped(!flipped)}>⇅</button>
        <button class="btn icon ghost" aria-label="Menu" onClick={menu}>⋯</button>
      </div>

      <Board fen={fen} orientation={orientation} lastMove={lastMove} onMove={onBoardMove} />
      <div class="opening-name">
        {opening ? (
          <>
            <b>{opening.eco}</b> {opening.name}
          </>
        ) : (
          cursor > 0 && <span>Unnamed position</span>
        )}
      </div>

      <div class="controls">
        <button class="btn" aria-label="Start" disabled={cursor === 0} onClick={() => setCursor(0)}>⏮</button>
        <button class="btn" aria-label="Back" disabled={cursor === 0} onClick={() => setCursor(cursor - 1)}>◀</button>
        <button class="btn" aria-label="Forward" onClick={forward}>▶</button>
        <button class="btn" aria-label="End" onClick={toEnd}>⏭</button>
      </div>

      <div class="scroll">
        {s.engineOn && (
          <EnginePanel
            fen={fen}
            ply={cursor}
            onPlay={(uci) => {
              const p = playMove(fen, { from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
              if (p) play(p);
            }}
          />
        )}
        <MoveList entries={entries} cursor={cursor} onJump={setCursor} />
        {unsaved > 0 && (
          <div class="pad" style="margin-bottom:8px">
            <button class="btn primary block" onClick={saveLine}>
              Save {unsaved} unsaved move{unsaved > 1 ? 's' : ''}
            </button>
          </div>
        )}
        {current && (
          <div class="pad small" style="margin-bottom:8px">
            {current.comment ? (
              <span onClick={() => editComment(current)}>💬 {current.comment}</span>
            ) : (
              <button class="btn small ghost" onClick={() => editComment(current)}>+ Comment on {current.san}</button>
            )}
          </div>
        )}
        <div class="pad muted small">{status}</div>

        <div class="tabs" style="margin-top:8px">
          <button class={tab === 'moves' ? 'on' : ''} onClick={() => setTab('moves')}>
            Moves {children.length > 0 && <span class="badge grey">{children.length}</span>}
          </button>
          <button class={tab === 'book' ? 'on' : ''} onClick={() => setTab('book')}>Book</button>
          <button class={tab === 'gaps' ? 'on' : ''} onClick={() => setTab('gaps')}>
            Gaps {gaps.length > 0 && <span class="badge orange">{gaps.length}</span>}
          </button>
        </div>

        {tab === 'moves' && (
          <div class="pad">
            {children.length === 0 && <p class="muted small">No saved moves from this position yet.</p>}
            {children.map((m) => {
              const name = bk?.nameAt(m.toFen);
              return (
                <div class="list-item" key={m.id}>
                  <div class="grow" onClick={() => play(moveToPlayed(m))} style="cursor:pointer">
                    <div class="row">
                      <b style="font-size:17px">{m.san}</b>
                      {m.isMine ? (
                        m.isPrimary ? <span class="src-tag mine">★ my move</span> : <span class="src-tag alt">alternative</span>
                      ) : (
                        <span class="src-tag opp">reply</span>
                      )}
                    </div>
                    {name && <div class="small muted">{name.name}</div>}
                    {m.comment && <div class="small">💬 {m.comment}</div>}
                  </div>
                  <button class="btn icon ghost" aria-label={`Options for ${m.san}`} onClick={() => moveMenu(m)}>⋯</button>
                </div>
              );
            })}
          </div>
        )}

        {tab === 'book' && <BookTab fen={fen} myTurn={myTurn} saved={children} onPlay={(san) => { const p = playMove(fen, san); if (p) play(p); }} />}

        {tab === 'gaps' && (
          <div class="pad">
            {gaps.length === 0 ? (
              <p class="muted small">No gaps — every opponent reply in your lines has an answer. 🎉</p>
            ) : (
              <>
                <p class="muted small">Opponent moves in your lines that you haven't prepared an answer for. Tap one to go there.</p>
                {gaps.map((gp) => (
                  <div class="list-item" style="cursor:pointer" onClick={() => jumpToLine(gp.path)}>
                    <span class="badge orange">!</span>
                    <span class="grow">{gp.path.length ? formatLine(gp.path.map((m) => m.san)) : 'Starting position — choose your first move'}</span>
                    <span class="muted">›</span>
                  </div>
                ))}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function BookTab(props: { fen: string; myTurn: boolean; saved: Move[]; onPlay: (san: string) => void }) {
  const bk = useBook();
  if (!bk) return <p class="pad muted small">Loading opening book…</p>;
  const moves = bk.moves(props.fen);
  const max = Math.max(1, ...moves.map((m) => m.count));
  return (
    <div class="pad">
      <p class="muted small">
        <span class="src-tag book">book</span> Named lines from the offline opening book
        {props.myTurn ? '.' : ' — common replies to prepare for.'} Bars show how many named variations continue with each
        move. Turn on the engine (⚙︎) for <span class="src-tag engine">engine</span> suggestions.
      </p>
      {moves.length === 0 && <p class="muted small">Out of book: no named lines continue from here.</p>}
      {moves.map((m) => {
        const isSaved = props.saved.some((s) => s.san === m.san);
        return (
          <div class="list-item" style="cursor:pointer" onClick={() => props.onPlay(m.san)}>
            <b style="min-width:56px;font-size:17px">{m.san}</b>
            <div class="grow" style="min-width:0">
              <div class="small" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">{m.name?.name ?? ''}</div>
              <div class="progress" style="margin-top:4px">
                <div style={`width:${(m.count / max) * 100}%;background:#6a4fb0`} />
              </div>
            </div>
            {isSaved ? <span class="badge green">✓</span> : <span class="muted">+</span>}
          </div>
        );
      })}
    </div>
  );
}
