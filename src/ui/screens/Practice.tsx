import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { DrawShape } from '@lichess-org/chessground/draw';
import type { Key } from '@lichess-org/chessground/types';
import { formatLine, playMove, ROOT } from '../../core/fen';
import { buildSession, countTargets, type DrillLine, type PracticeMode, type PracticeOptions } from '../../core/practice';
import { activeBfs } from '../../core/tree';
import type { Move } from '../../core/types';
import { cardFor, graphOf, recordReview, repertoireById, repertoires, settings } from '../../state/store';
import { Board } from '../Board';
import { toast } from '../dialogs';
import { go } from '../router';
import { playBad, playGood, playMoveSound } from '../sound';
import { useBook } from '../useBook';

const MODES: { id: PracticeMode; label: string; help: string }[] = [
  { id: 'daily', label: 'Daily practice', help: 'Due moves, capped at your daily size.' },
  { id: 'due', label: 'Everything due', help: 'Every move that is due now.' },
  { id: 'mistakes', label: 'Often wrong', help: 'The moves you miss most.' },
  { id: 'cram', label: 'All moves (cram)', help: 'Every move. Correct answers don’t push due dates out.' },
  { id: 'subtree', label: 'One opening', help: 'Every move below a chosen position.' },
];

function optionsFrom(params: Record<string, string>): PracticeOptions {
  return {
    mode: (params.mode as PracticeMode) || 'daily',
    side: (params.side as 'w' | 'b' | 'both') || 'both',
    repId: params.rep || undefined,
    fen: params.fen || undefined,
    moveIds: params.moves ? params.moves.split(',') : undefined,
    dailySize: settings.value.dailySize,
  };
}

function allReps() {
  return repertoires.value.map((rep) => ({ rep, graph: graphOf(rep.id) }));
}

export function Practice(props: { params?: Record<string, string> }) {
  const params = props.params ?? {};
  const [opts, setOpts] = useState<PracticeOptions>(() => optionsFrom(params));
  const [lines, setLines] = useState<DrillLine[] | null>(() =>
    params.auto ? buildSession(allReps(), cardFor, optionsFrom(params)) : null,
  );

  if (lines) {
    if (!lines.length)
      return (
        <Shell title="Practice">
          <div class="card">
            <p>Nothing to practice with these settings. 🎉</p>
            <button class="btn block" onClick={() => setLines(null)}>Change settings</button>
          </div>
        </Shell>
      );
    return <Drill lines={lines} onExit={() => go('')} />;
  }
  return <Setup opts={opts} setOpts={setOpts} onStart={(l) => setLines(l)} />;
}

function Shell(props: { title: string; right?: any; children: any }) {
  return (
    <div class="screen">
      <div class="topbar">
        <button class="btn icon ghost" aria-label="Home" onClick={() => go('')}>‹</button>
        <h1>{props.title}</h1>
        {props.right}
      </div>
      <div class="scroll">{props.children}</div>
    </div>
  );
}

function Setup(props: { opts: PracticeOptions; setOpts: (o: PracticeOptions) => void; onStart: (l: DrillLine[]) => void }) {
  const { opts, setOpts } = props;
  const set = (patch: Partial<PracticeOptions>) => setOpts({ ...opts, ...patch });
  const lines = useMemo(() => buildSession(allReps(), cardFor, opts), [JSON.stringify(opts)]);
  const n = countTargets(lines);
  const bk = useBook();
  const reps = repertoires.value.filter((r) => opts.side === 'both' || r.side === opts.side);

  // Named positions in the selected repertoire, for "one opening".
  const openings = useMemo(() => {
    if (opts.mode !== 'subtree' || !bk) return [];
    const out: { repId: string; fen: string; label: string; line: string }[] = [];
    for (const r of reps) {
      if (opts.repId && r.id !== opts.repId) continue;
      const parents = activeBfs(graphOf(r.id));
      const seen = new Set<string>();
      for (const fen of parents.keys()) {
        const name = bk.nameAt(fen);
        if (!name || seen.has(name.name)) continue;
        seen.add(name.name);
        const path: Move[] = [];
        let cur = parents.get(fen);
        while (cur) {
          path.unshift(cur);
          cur = parents.get(cur.fromFen) ?? null;
        }
        out.push({ repId: r.id, fen, label: `${r.name}: ${name.name}`, line: formatLine(path.map((m) => m.san)) });
      }
    }
    return out;
  }, [opts.mode, opts.repId, opts.side, bk]);

  return (
    <Shell title="Practice">
      <div class="card">
        <h2>Mode</h2>
        <div class="chips">
          {MODES.map((m) => (
            <button class={`chip ${opts.mode === m.id ? 'on' : ''}`} onClick={() => set({ mode: m.id })}>
              {m.label}
            </button>
          ))}
        </div>
        <p class="muted small">{MODES.find((m) => m.id === opts.mode)?.help}</p>
      </div>
      <div class="card">
        <h2>Side</h2>
        <div class="chips">
          {(['both', 'w', 'b'] as const).map((s) => (
            <button class={`chip ${opts.side === s ? 'on' : ''}`} onClick={() => set({ side: s, repId: undefined, fen: undefined })}>
              {s === 'both' ? 'Both' : s === 'w' ? 'White' : 'Black'}
            </button>
          ))}
        </div>
        <h2 style="margin-top:14px">Repertoire</h2>
        <div class="chips">
          <button class={`chip ${!opts.repId ? 'on' : ''}`} onClick={() => set({ repId: undefined, fen: undefined })}>All</button>
          {reps.map((r) => (
            <button class={`chip ${opts.repId === r.id ? 'on' : ''}`} onClick={() => set({ repId: r.id, fen: undefined })}>
              {r.name}
            </button>
          ))}
        </div>
      </div>
      {opts.mode === 'subtree' && (
        <div class="card">
          <h2>Opening</h2>
          {opts.fen && opts.repId && (
            <p class="small">
              Selected: <b>{openings.find((o) => o.fen === opts.fen)?.label ?? 'position from Build'}</b>
            </p>
          )}
          {!bk && <p class="muted small">Loading…</p>}
          {bk && openings.length === 0 && <p class="muted small">No named openings in your lines yet.</p>}
          {openings.map((o) => (
            <div
              class="list-item"
              style="cursor:pointer"
              onClick={() => set({ repId: o.repId, fen: o.fen })}
            >
              <div class="grow">
                <div style={opts.fen === o.fen ? 'color:var(--accent);font-weight:700' : ''}>{o.label}</div>
                <div class="muted small">{o.line}</div>
              </div>
            </div>
          ))}
          <p class="muted small">Tip: in Build, use ⋯ → “Drill from this position” for any position.</p>
        </div>
      )}
      <div class="pad">
        <button class="btn primary block" disabled={!n} onClick={() => props.onStart(lines)}>
          {n ? `Start · ${n} move${n === 1 ? '' : 's'} in ${lines.length} line${lines.length === 1 ? '' : 's'}` : 'Nothing to practice'}
        </button>
        {opts.mode === 'daily' && <p class="muted small center">Daily size: {settings.value.dailySize} (change in Settings)</p>}
      </div>
    </Shell>
  );
}

type Phase = 'auto' | 'await' | 'fix' | 'between';

interface Result {
  move: Move;
  line: Move[];
  grade: 'again' | 'hard' | 'good';
}

function Drill(props: { lines: DrillLine[]; onExit: () => void }) {
  const { lines } = props;
  const total = countTargets(lines);
  const [li, setLi] = useState(0);
  const [ply, setPly] = useState(0);
  const [phase, setPhase] = useState<Phase>('auto');
  const [flash, setFlash] = useState<'good' | 'bad' | null>(null);
  const [shapes, setShapes] = useState<DrawShape[]>([]);
  const [hinted, setHinted] = useState(false);
  const [results, setResults] = useState<Result[]>([]);
  const [done, setDone] = useState(false);
  const [boardFen, setBoardFen] = useState<string | null>(null); // temporary wrong-move display
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const bk = useBook();

  const line = lines[li];
  const rep = line ? repertoireById(line.repId) : undefined;
  const fen = ply === 0 ? ROOT : line.moves[ply - 1].toFen;
  const orientation = line?.side === 'b' ? 'black' : 'white';
  const reviewed = new Set(results.map((r) => r.move.id));
  const correct = results.filter((r) => r.grade !== 'again').length;
  const wrong = results.length - correct;
  const expected = line?.moves[ply];
  const lastPlayed = ply > 0 ? line.moves[ply - 1] : null;

  const isTarget = (m: Move | undefined) => !!m && line.targets.includes(m.id) && !reviewed.has(m.id);

  // Drive the line forward: auto-play until the next quizzed move.
  useEffect(() => {
    if (done || !line || phase !== 'auto') return;
    if (ply >= line.moves.length) {
      timer.current = setTimeout(() => {
        if (li + 1 >= lines.length) setDone(true);
        else {
          setLi(li + 1);
          setPly(0);
        }
      }, 700);
      return () => clearTimeout(timer.current);
    }
    const m = line.moves[ply];
    if (isTarget(m)) {
      setPhase('await');
      setHinted(false);
      return;
    }
    timer.current = setTimeout(
      () => {
        playMoveSound(m.san);
        setPly(ply + 1);
      },
      ply === 0 ? 450 : m.isMine ? 300 : 550,
    );
    return () => clearTimeout(timer.current);
  }, [li, ply, phase, done]);

  useEffect(() => () => clearTimeout(timer.current), []);

  function flashFor(kind: 'good' | 'bad') {
    setFlash(kind);
    setTimeout(() => setFlash(null), 450);
  }

  function arrowFor(m: Move): DrawShape[] {
    return [{ orig: m.uci.slice(0, 2) as Key, dest: m.uci.slice(2, 4) as Key, brush: 'green' }];
  }

  async function grade(g: 'again' | 'hard' | 'good') {
    const m = expected!;
    setResults((r) => [...r, { move: m, line: line.moves.slice(0, ply + 1), grade: g }]);
    await recordReview(m, g);
  }

  async function onMove(from: string, to: string, promotion?: string) {
    if (!expected || (phase !== 'await' && phase !== 'fix')) return;
    const p = playMove(fen, { from, to, promotion });
    if (!p) return;
    if (p.uci === expected.uci) {
      playMoveSound(p.san);
      setShapes([]);
      setBoardFen(null);
      if (phase === 'await') {
        playGood();
        flashFor('good');
        await grade(hinted ? 'hard' : 'good');
      }
      setPly(ply + 1);
      setPhase('auto');
      return;
    }
    const alt = graphOf(line.repId)
      .children(fen)
      .find((m) => m.isMine && m.uci === p.uci);
    if (alt && phase === 'await') {
      toast(`${alt.san} is one of your alternatives — play your main move.`);
      setBoardFen(p.toFen);
      setTimeout(() => setBoardFen(null), 600);
      return;
    }
    // Wrong: show it briefly, then the correct move as an arrow.
    playBad();
    flashFor('bad');
    setBoardFen(p.toFen);
    setTimeout(() => setBoardFen(null), 600);
    setShapes(arrowFor(expected));
    if (phase === 'await') {
      await grade('again');
      setPhase('fix');
    }
  }

  function hint() {
    if (!expected) return;
    setHinted(true);
    setShapes([{ orig: expected.uci.slice(0, 2) as Key, brush: 'yellow' }]);
  }

  async function showAnswer() {
    if (!expected || phase !== 'await') return;
    setShapes(arrowFor(expected));
    await grade('again');
    setPhase('fix');
  }

  if (done || !line) return <Summary results={results} onExit={props.onExit} />;

  const opening = bk?.nameForLine([ROOT, ...line.moves.slice(0, ply).map((m) => m.toFen)]);
  const comment = phase === 'auto' || phase === 'between' ? lastPlayed?.comment : '';
  const lastMove: [string, string] | null = boardFen
    ? null
    : lastPlayed
      ? [lastPlayed.uci.slice(0, 2), lastPlayed.uci.slice(2, 4)]
      : null;

  return (
    <div class="screen">
      <div class="topbar">
        <button class="btn icon ghost" aria-label="End session" onClick={() => setDone(true)}>✕</button>
        <h1 class="small" style="font-size:15px">{rep?.name}</h1>
        <div class="counters">
          <span class="due" title="Remaining">● {total - results.length}</span>
          <span class="ok" title="Correct">✓ {correct}</span>
          <span class="bad" title="Wrong">✗ {wrong}</span>
        </div>
      </div>
      <Board
        fen={boardFen ?? fen}
        orientation={orientation}
        lastMove={lastMove}
        movableColor={phase === 'await' || phase === 'fix' ? orientation : null}
        onMove={onMove}
        shapes={shapes}
        flash={flash}
        animation={250}
      />
      <div class="opening-name">{opening ? <><b>{opening.eco}</b> {opening.name}</> : ' '}</div>
      <div class="scroll">
        <div class="pad" style="margin-top:8px">
          {phase === 'await' && <div style="font-weight:700;font-size:18px">Your move</div>}
          {phase === 'fix' && (
            <div style="font-weight:700;font-size:18px;color:var(--red)">
              The move is {expected?.san} — play it to continue.
            </div>
          )}
          {phase === 'auto' && <div class="muted">Line {li + 1} of {lines.length}</div>}
          <div class="muted small" style="margin-top:4px">
            {formatLine(line.moves.slice(0, ply).map((m) => m.san)) || 'Starting position'}
          </div>
          {comment && <div class="small" style="margin-top:6px">💬 {comment}</div>}
          {phase === 'fix' && expected?.comment && <div class="small" style="margin-top:6px">💬 {expected.comment}</div>}
        </div>
        <div class="controls">
          <button class="btn" disabled={phase !== 'await' || hinted} onClick={hint}>💡 Hint</button>
          <button class="btn" disabled={phase !== 'await'} onClick={showAnswer}>I don’t know — show me</button>
        </div>
        <p class="pad muted small">Correct = Good · correct after a hint = Hard · wrong or “show me” = Again.</p>
      </div>
    </div>
  );
}

function Summary(props: { results: Result[]; onExit: () => void }) {
  const { results } = props;
  const correct = results.filter((r) => r.grade !== 'again').length;
  const missed = results.filter((r) => r.grade === 'again');
  const pct = results.length ? Math.round((correct / results.length) * 100) : 0;
  return (
    <Shell title="Session complete">
      <div class="card center">
        <div style="font-size:44px;font-weight:800">{pct}%</div>
        <div class="counters" style="justify-content:center;margin-top:6px">
          <span class="ok">✓ {correct}</span>
          <span class="bad">✗ {missed.length}</span>
        </div>
        <p class="muted small">{results.length} move{results.length === 1 ? '' : 's'} reviewed</p>
      </div>
      {missed.length > 0 && (
        <div class="card">
          <h2>To review</h2>
          {missed.map((r) => (
            <div class="list-item">
              <span class="bad" style="color:var(--red)">✗</span>
              <div class="grow small">
                {formatLine(r.line.slice(0, -1).map((m) => m.san))} → <b>{r.move.san}</b>
              </div>
            </div>
          ))}
          <button class="btn block" style="margin-top:8px" onClick={() => go(`practice?mode=moves&moves=${missed.map((r) => r.move.id).join(',')}&auto=1&t=${Date.now()}`)}>
            Drill these again
          </button>
        </div>
      )}
      <div class="pad">
        <button class="btn primary block" onClick={props.onExit}>Done</button>
      </div>
    </Shell>
  );
}
