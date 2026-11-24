import { useEffect, useRef, useState } from 'preact/hooks';
import { Chess } from 'chess.js';
import type { DrawShape } from '@lichess-org/chessground/draw';
import type { Key } from '@lichess-org/chessground/types';
import { formatLine } from '../../core/fen';
import { fiftyMoveCount, gradeRun, mateIn, moveFeedback, outcome, winThrownAway, type Feedback, type Outcome } from '../../core/playout';
import { checkPosition, goalText, materialSignature } from '../../core/positions';
import { uid } from '../../core/ids';
import type { Grade, PositionGoal, PracticeRun } from '../../core/types';
import { analyse, povScore } from '../../engine/bestMove';
import { engineUsers } from '../../engine/evalQueue';
import { engine } from '../../engine/stockfish';
import { finishRun, positionById, positionCard, settings } from '../../state/store';
import { Board } from '../Board';
import { confirmDialog } from '../dialogs';
import { playBad, playGood, playMoveSound } from '../sound';
import { PlayOutExtras } from '../PlayOutExtras';


export interface PlayOutSetup {
  startFen: string;
  goal: PositionGoal;
  mySide: 'w' | 'b';
  title: string;
  positionId?: string;
}

const ENGINE_DELAY_MS = 650;
const GRADE_TEXT: Record<Grade, string> = { good: 'Good', hard: 'Hard', again: 'Again' };

function setupFrom(params: Record<string, string>): PlayOutSetup | string {
  if (params.pos) {
    const p = positionById(params.pos);
    if (!p) return 'This position no longer exists.';
    return { startFen: p.fen, goal: p.goal, mySide: p.mySide, title: p.title || materialSignature(p.fen), positionId: p.id };
  }
  const chk = checkPosition(params.fen ?? '');
  if (!chk.ok) return `Can’t play this position: ${chk.errors[0] ?? 'invalid FEN'}`;
  const goal = (['win', 'draw', 'bestMove'].includes(params.goal) ? params.goal : 'win') as PositionGoal;
  const mySide = params.side === 'b' || params.side === 'w' ? params.side : (chk.fen.split(' ')[1] as 'w' | 'b');
  return { startFen: chk.fen, goal, mySide, title: params.title || materialSignature(chk.fen) };
}

const fmt = (cp: number | null | undefined) => {
  if (cp == null) return '?';
  const m = mateIn(cp);
  if (m !== null) return m > 0 ? `#${m}` : `#-${-m}`;
  return (cp > 0 ? '+' : '') + (cp / 100).toFixed(1);
};

/** Play-out screen. Pass `setup` + `onExit` to embed it (e.g. inside a drill, which keeps its state). */
export function PlayOut(props: { params: Record<string, string>; setup?: PlayOutSetup; onExit?: () => void }) {
  const [setup, setSetup] = useState<PlayOutSetup | string>(() => props.setup ?? setupFrom(props.params));
  if (typeof setup === 'string')
    return (
      <div class="screen">
        <div class="topbar">
          <button class="btn icon ghost" onClick={() => history.back()}>‹</button>
          <h1>Play it out</h1>
        </div>
        <div class="card">{setup}</div>
      </div>
    );
  return <Game key={setup.startFen + setup.goal + setup.mySide} setup={setup} params={props.params} onSetup={setSetup} onExit={props.onExit} />;
}

function Game(props: { setup: PlayOutSetup; params: Record<string, string>; onSetup: (s: PlayOutSetup) => void; onExit?: () => void }) {
  const { setup } = props;
  const s = settings.value;
  const [fens, setFens] = useState<string[]>([setup.startFen]);
  const [moves, setMoves] = useState<string[]>([]);
  /** Eval (my point of view) of each position in `fens`. */
  const [evals, setEvals] = useState<(number | null)[]>([null]);
  const [feedback, setFeedback] = useState<Record<number, Feedback>>({});
  const [hints, setHints] = useState(0);
  const [thinking, setThinking] = useState(true);
  const [arrow, setArrow] = useState<DrawShape[]>([]);
  const [over, setOver] = useState<(Outcome & { run?: PracticeRun; grade?: Grade }) | null>(null);
  const [dtm, setDtm] = useState<number | null>(null);
  const [startBest, setStartBest] = useState<{ uci: string | null; san?: string } | null>(null);
  const [source, setSource] = useState<'tablebase' | 'engine' | ''>('');
  const [reviewing, setReviewing] = useState<number | null>(null);
  const alive = useRef(true);
  const fensRef = useRef(fens);
  fensRef.current = fens;

  const fen = fens[fens.length - 1];
  const toMove = fen.split(' ')[1] as 'w' | 'b';
  const myTurn = toMove === setup.mySide && !over && !thinking;
  const myMoves = Math.ceil((moves.length - (setup.startFen.split(' ')[1] === setup.mySide ? 0 : 1)) / 2);
  const useTb = s.useTablebase;
  const defDepth = s.defenderDepth;

  useEffect(() => {
    engineUsers.value++;
    alive.current = true;
    return () => {
      alive.current = false;
      engineUsers.value--;
      engine.stop();
    };
  }, []);

  // Start: evaluate the position (mate distance) and let the engine move first if it's its turn.
  useEffect(() => {
    (async () => {
      setThinking(true);
      const a = await analyse(setup.startFen, { depth: Math.max(defDepth, 22), useTablebase: useTb, maxMs: 6000 });
      if (!alive.current) return;
      const mine = povScore(a.white, setup.mySide);
      setEvals([mine]);
      setSource(a.source);
      const m = mateIn(mine);
      setDtm(m !== null && m > 0 ? m : null);
      if (toMove === setup.mySide) {
        setStartBest({ uci: a.best, san: a.bestSan });
        setThinking(false);
      } else await engineReply([setup.startFen], [], [mine], a.best);
    })();
  }, []);

  async function finish(o: Outcome, allMoves: string[], allEvals: (number | null)[], hintCount: number) {
    const taken = Math.ceil((allMoves.length - (setup.startFen.split(' ')[1] === setup.mySide ? 0 : 1)) / 2);
    const grade =
      setup.goal === 'bestMove'
        ? o.success
          ? hintCount
            ? 'hard'
            : 'good'
          : 'again'
        : gradeRun({ success: o.success, hintsUsed: hintCount, movesTaken: taken, engineDtm: dtm });
    const run: PracticeRun = {
      id: uid(),
      positionId: setup.positionId,
      startFen: setup.startFen,
      moves: allMoves,
      result: o.result,
      reason: o.reason,
      success: o.success,
      hintsUsed: hintCount,
      movesTaken: taken,
      engineDtm: dtm ?? undefined,
      evals: allEvals,
      finishedAt: Date.now(),
    };
    const saved = await finishRun(run, { grade: setup.positionId ? grade : undefined });
    if (!alive.current) return;
    o.success ? playGood() : playBad();
    setOver({ ...o, run: saved, grade });
    setThinking(false);
  }

  /** Engine (defender) plays the best move in the current position. */
  async function engineReply(curFens: string[], curMoves: string[], curEvals: (number | null)[], known?: string | null) {
    setThinking(true);
    const t0 = Date.now();
    let best = known;
    let white: number | null = null;
    if (!best) {
      const a = await analyse(curFens[curFens.length - 1], { depth: defDepth, useTablebase: useTb });
      if (!alive.current) return;
      best = a.best;
      white = a.white;
      setSource(a.source);
    }
    if (!best) {
      setThinking(false);
      return;
    }
    await new Promise((r) => setTimeout(r, Math.max(0, ENGINE_DELAY_MS - (Date.now() - t0))));
    if (!alive.current) return;
    const c = new Chess(curFens[curFens.length - 1]);
    const mv = c.move({ from: best.slice(0, 2), to: best.slice(2, 4), promotion: best[4] });
    playMoveSound(mv.san);
    const nf = [...curFens, c.fen()];
    const nm = [...curMoves, best];
    const ne = [...curEvals, white !== null ? povScore(white, setup.mySide) : curEvals[curEvals.length - 1]];
    setFens(nf);
    setMoves(nm);
    setEvals(ne);
    const o = outcome(c.fen(), setup.goal, setup.mySide, nf.slice(0, -1));
    if (o.over) return finish(o, nm, ne, hints);
    setThinking(false);
  }

  async function onMove(from: string, to: string, promotion?: string) {
    if (!myTurn) return;
    const c = new Chess(fen);
    let mv;
    try {
      mv = c.move({ from, to, promotion });
    } catch {
      return;
    }
    playMoveSound(mv.san);
    setArrow([]);
    const uci = from + to + (promotion ?? '');
    const nf = [...fens, c.fen()];
    const nm = [...moves, uci];
    setFens(nf);
    setMoves(nm);
    setThinking(true);
    const o = outcome(c.fen(), setup.goal, setup.mySide, fens);
    // Evaluate the position after my move (this is also the defender's search).
    const a = o.over ? null : await analyse(c.fen(), { depth: defDepth, useTablebase: useTb });
    if (!alive.current) return;
    const before = evals[evals.length - 1];
    const after = a ? povScore(a.white, setup.mySide) : o.success ? 10000 : null;
    const ne = [...evals, after];
    setEvals(ne);
    if (a) setSource(a.source);
    const fb = moveFeedback(setup.goal, before, after);
    if (fb) setFeedback((f) => ({ ...f, [nm.length - 1]: fb }));

    if (setup.goal === 'bestMove') {
      const best = startBest?.uci;
      const loss = before !== null && after !== null ? before - after : null;
      const mb = mateIn(before);
      const ma = mateIn(after);
      const ok = uci === best || (loss !== null && loss <= 30) || (mb !== null && mb > 0 && ma !== null && ma > 0 && ma < mb);
      return finish(
        ok
          ? { over: true, success: true, result: 'solved', reason: uci === best ? 'Best move!' : 'Correct — that works too.' }
          : { over: true, success: false, result: 'wrong', reason: `Not the best move. Best was ${startBest?.san ?? best}.` },
        nm,
        ne,
        hints,
      );
    }
    if (o.over) return finish(o, nm, ne, hints);
    if (setup.goal === 'win' && winThrownAway(before, after))
      return finish({ over: true, success: false, result: 'fail', reason: 'The win is gone — no forced mate any more.' }, nm, ne, hints);
    await engineReply(nf, nm, ne, a?.best);
  }

  async function hint() {
    if (!myTurn) return;
    setThinking(true);
    const a = await analyse(fen, { depth: s.playoutFeedbackDepth, useTablebase: useTb, maxMs: 2500 });
    if (!alive.current) return;
    setThinking(false);
    if (!a.best) return;
    setHints(hints + 1);
    setArrow([{ orig: a.best.slice(0, 2) as Key, dest: a.best.slice(2, 4) as Key, brush: 'paleGreen' }]);
  }

  function takeback() {
    if (thinking || over || moves.length === 0) return;
    // Undo my last move and the engine's reply.
    const n = toMove === setup.mySide ? 2 : 1;
    if (moves.length < n) return;
    setFens(fens.slice(0, -n));
    setMoves(moves.slice(0, -n));
    setEvals(evals.slice(0, -n));
    setHints(hints + 1);
    setArrow([]);
  }

  function restart() {
    if (thinking) return;
    setFens([setup.startFen]);
    setMoves([]);
    setEvals([evals[0]]);
    setFeedback({});
    setOver(null);
    setArrow([]);
    setReviewing(null);
    // Hints used so far still count for this attempt.
    if (setup.startFen.split(' ')[1] !== setup.mySide) engineReply([setup.startFen], [], [evals[0]]);
    else setThinking(false);
  }

  async function giveUp() {
    if (over || !(await confirmDialog('Give up this position? It counts as a fail.', { ok: 'Give up', danger: true }))) return;
    engine.stop();
    finish({ over: true, success: false, result: 'gaveUp', reason: 'You gave up.' }, moves, evals, hints);
  }

  const orientation = setup.mySide === 'w' ? 'white' : 'black';
  const last = moves[moves.length - 1];
  const fb = feedback[moves.length - (toMove === setup.mySide ? 2 : 1)];
  const startTurn = setup.startFen.split(' ')[1] as 'w' | 'b';
  const startNo = Number(setup.startFen.split(' ')[5]) || 1;

  // ----- review mode
  if (reviewing !== null && over) {
    const i = reviewing;
    const sans = replaySans(setup.startFen, moves);
    const lastI = i > 0 ? moves[i - 1] : null;
    const f = i > 0 ? feedback[i - 1] : undefined;
    return (
      <div class="screen">
        <div class="topbar">
          <button class="btn icon ghost" aria-label="Back to result" onClick={() => setReviewing(null)}>‹</button>
          <h1>Review game</h1>
        </div>
        <Board fen={fens[i]} orientation={orientation} lastMove={lastI ? [lastI.slice(0, 2), lastI.slice(2, 4)] : null} movableColor={null} />
        <div class="controls">
          <button class="btn" disabled={i === 0} onClick={() => setReviewing(0)}>⏮</button>
          <button class="btn" disabled={i === 0} onClick={() => setReviewing(i - 1)}>◀</button>
          <button class="btn" disabled={i === moves.length} onClick={() => setReviewing(i + 1)}>▶</button>
          <button class="btn" disabled={i === moves.length} onClick={() => setReviewing(moves.length)}>⏭</button>
        </div>
        <div class="scroll">
          <div class="pad">
            <div class="small">
              {i === 0 ? 'Start position' : formatLine(sans.slice(0, i), startTurn, startNo).split(' ').slice(-2).join(' ')} · eval {fmt(evals[i])}
            </div>
            {f && (
              <div class="small" style={`margin-top:4px;color:${f.level === 'good' ? 'var(--green)' : f.level === 'lost' ? 'var(--red)' : 'var(--orange)'}`}>
                {f.text}
              </div>
            )}
            <p class="small muted">{formatLine(sans, startTurn, startNo)}</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div class="screen">
      <div class="topbar">
        <button class="btn icon ghost" aria-label="Back" onClick={() => (props.onExit ? props.onExit() : history.back())}>‹</button>
        <h1 style="font-size:16px">{setup.title}</h1>
        <span class="small muted">{source === 'tablebase' ? 'Tablebase' : source === 'engine' ? 'Stockfish' : ''}</span>
      </div>
      <div class="pad" style="padding-top:2px;padding-bottom:6px;font-weight:700">{goalText(setup.goal, setup.mySide, setup.startFen)}</div>
      <Board
        fen={fen}
        orientation={orientation}
        lastMove={last ? [last.slice(0, 2), last.slice(2, 4)] : null}
        movableColor={myTurn ? orientation : null}
        onMove={onMove}
        shapes={arrow}
        animation={250}
      />
      <div class="scroll">
        {!over && (
          <>
            <div class="pad row small" style="margin-top:6px">
              <span class="grow">
                Move {myMoves}
                {dtm ? ` · engine mates in ${dtm}` : ''} · 50-move: {fiftyMoveCount(fen)}/50
              </span>
              <span class="muted">{thinking ? 'Engine thinking…' : myTurn ? 'Your move' : ''}</span>
            </div>
            {s.playoutFeedback === 'immediate' && fb && (
              <div class="pad small" style={`margin-top:4px;color:${fb.level === 'good' ? 'var(--green)' : fb.level === 'lost' ? 'var(--red)' : 'var(--orange)'}`}>
                {fb.text}
              </div>
            )}
            <div class="controls">
              <button class="btn" disabled={!myTurn} onClick={hint}>💡 Hint</button>
              <button class="btn" disabled={thinking || !moves.length} onClick={takeback}>↶ Takeback</button>
            </div>
            <div class="controls" style="padding-top:0">
              <button class="btn" disabled={thinking} onClick={restart}>⟲ Restart</button>
              <button class="btn" onClick={giveUp}>⚑ Give up</button>
            </div>
            <p class="pad small muted">Hints and takebacks count as hints and lower the grade.{hints ? ` Hints used: ${hints}.` : ''}</p>
          </>
        )}
        {over && (
          <div class="card center">
            <div style={`font-size:28px;font-weight:800;color:${over.success ? 'var(--green)' : 'var(--red)'}`}>
              {over.success ? '✓ ' : '✗ '}
              {over.reason}
            </div>
            <p class="small">
              {setup.goal !== 'bestMove' && (
                <>
                  You played {myMoves} move{myMoves === 1 ? '' : 's'}
                  {dtm ? ` · engine’s mate distance from the start: ${dtm}` : ''}
                  <br />
                </>
              )}
              Hints: {hints}
              {setup.positionId && over.grade && (
                <>
                  {' '}· Graded <b>{GRADE_TEXT[over.grade]}</b> · next review {nextReviewText(setup.positionId)}
                </>
              )}
            </p>
            {s.playoutFeedback !== 'off' && Object.values(feedback).some((x) => x.level !== 'good') && (
              <p class="small" style="color:var(--orange)">
                {Object.values(feedback).filter((x) => x.level !== 'good').length} move(s) flagged — see Review game.
              </p>
            )}
            <div class="row wrap" style="gap:8px">
              <button class="btn grow" disabled={!moves.length} onClick={() => setReviewing(moves.length)}>Review game</button>
              <button class="btn grow" onClick={restart}>Try again</button>
            </div>
            <PlayOutExtras setup={setup} moves={moves} params={props.params} onExit={props.onExit} />
          </div>
        )}
      </div>
    </div>
  );
}

function replaySans(start: string, uci: string[]): string[] {
  const c = new Chess(start);
  return uci.map((u) => c.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] }).san);
}

function nextReviewText(positionId: string): string {
  const p = positionById(positionId);
  if (!p) return '';
  const due = positionCard(p).due;
  const mins = Math.max(0, Math.round((due - Date.now()) / 60000));
  if (mins < 60) return mins <= 1 ? 'now' : `in ${mins} min`;
  const h = Math.round(mins / 60);
  if (h < 24) return `in ${h} h`;
  return `in ${Math.round(h / 24)} days`;
}
