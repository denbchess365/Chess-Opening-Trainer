import { useMemo, useState } from 'preact/hooks';
import type { DrawShape } from '@lichess-org/chessground/draw';
import type { Key } from '@lichess-org/chessground/types';
import { formatLine, playMove } from '../../core/fen';
import { gameUrl } from '../../core/lichess';
import type { GameFinding, Severity } from '../../core/types';
import {
  adoptPlayedMove,
  drillFinding,
  expectedMove,
  gameLineUci,
  gameOf,
  setFindingStatus,
  toReview,
} from '../../state/review';
import { findings, repertoireById } from '../../state/store';
import { Board } from '../Board';
import { confirmDialog, toast } from '../dialogs';
import { EnginePanel } from '../EnginePanel';
import { go } from '../router';
import { useBook } from '../useBook';
import { PerformanceView } from '../PerformanceView';

const TYPE_LABEL: Record<string, string> = {
  deviation: 'You left your repertoire',
  gap: 'Opponent surprise',
  outOfBook: 'New position to prepare',
};
const SEV_COLOR: Record<Severity, string> = { ok: 'var(--green)', inaccuracy: 'var(--yellow)', mistake: 'var(--orange)', blunder: 'var(--red)' };

const arrow = (uci: string | undefined, brush: string): DrawShape[] =>
  uci ? [{ orig: uci.slice(0, 2) as Key, dest: uci.slice(2, 4) as Key, brush }] : [];

export function fmtEval(cp: number | undefined): string {
  if (cp === undefined) return '?';
  if (Math.abs(cp) > 9000) return cp > 0 ? '#' : '-#';
  return (cp > 0 ? '+' : '') + (cp / 100).toFixed(1);
}

export function Review(props: { params?: Record<string, string> }) {
  const [tab, setTab] = useState<'mistakes' | 'perf'>(props.params?.tab === 'perf' ? 'perf' : 'mistakes');
  // Freeze the list when the screen opens so items don't jump while you work through them.
  const ids = useMemo(() => toReview.value.map((f) => f.id), []);
  const [idx, setIdx] = useState(0);
  const list = ids.map((id) => findings.value.find((f) => f.id === id)).filter((f): f is GameFinding => !!f);
  const remaining = list.filter((f) => f.status === 'new');
  const current = list[idx];

  const next = () => {
    const after = list.findIndex((f, i) => i > idx && f.status === 'new');
    const first = list.findIndex((f) => f.status === 'new');
    setIdx(after >= 0 ? after : first >= 0 ? first : list.length);
  };

  return (
    <div class="screen">
      <div class="topbar">
        <button class="btn icon ghost" aria-label="Home" onClick={() => go('')}>‹</button>
        <h1>Online games</h1>
      </div>
      <div class="tabs">
        <button class={tab === 'mistakes' ? 'on' : ''} onClick={() => setTab('mistakes')}>
          Opening mistakes {remaining.length > 0 && <span class="badge orange">{remaining.length}</span>}
        </button>
        <button class={tab === 'perf' ? 'on' : ''} onClick={() => setTab('perf')}>Performance</button>
      </div>
      {tab === 'perf' ? (
        <div class="scroll">
          <PerformanceView />
        </div>
      ) : !current || current.status !== 'new' ? (
        <div class="scroll">
          <div class="card center">
            <div style="font-size:40px">✓</div>
            <p>{ids.length ? 'All reviewed — nice work!' : 'No opening mistakes to review.'}</p>
            <button class="btn block" onClick={() => go('')}>Done</button>
          </div>
        </div>
      ) : (
        <FindingView key={current.id} f={current} pos={idx + 1} total={list.length} onNext={next} />
      )}
    </div>
  );
}

function FindingView(props: { f: GameFinding; pos: number; total: number; onNext: () => void }) {
  const { f } = props;
  const game = gameOf(f);
  const bk = useBook();
  const rep = repertoireById(f.repertoireId);
  if (!game || !rep)
    return (
      <div class="card">
        Game or repertoire no longer available. <button class="btn small" onClick={() => setFindingStatus(f, 'dismissed').then(props.onNext)}>Skip</button>
      </div>
    );
  const sans = game.moves.split(/\s+/);
  const orientation = game.myColor === 'w' ? 'white' : 'black';
  const before = sans.slice(0, f.ply);
  const lineTokens = f.playedSan ? formatLine([...before, f.playedSan]).split(' ') : formatLine(before).split(' ');
  const prevUci = gameLineUci(game, f.ply).at(-1);
  const expected = expectedMove(f);
  const played = f.playedUci;
  // For an opponent surprise, the position to prepare is the one after their move.
  const after = f.type === 'gap' && played ? playMove(f.fen, { from: played.slice(0, 2), to: played.slice(2, 4), promotion: played[4] }) : null;
  const prepFen = after ? after.toFen : f.fen;
  const prepLine = gameLineUci(game, f.ply + (f.type === 'gap' ? 1 : 0));
  const shapes: DrawShape[] =
    f.type === 'deviation' ? [...arrow(played, 'red'), ...arrow(expected?.uci, 'green')] : f.type === 'gap' ? arrow(played, 'red') : arrow(played, 'blue');

  const done = async (fn: () => Promise<unknown>) => {
    await fn();
    props.onNext();
  };

  const openBuild = (extra?: string) => {
    setFindingStatus(f, 'added');
    go(`build/${f.repertoireId}?line=${[...prepLine, ...(extra ? [extra] : [])].join(',')}`);
  };

  const result = game.result === 'win' ? '1–0 win' : game.result === 'loss' ? 'loss' : game.result === 'draw' ? 'draw' : '';
  return (
    <>
      <Board fen={f.fen} orientation={orientation} lastMove={prevUci ? [prevUci.slice(0, 2), prevUci.slice(2, 4)] : null} movableColor={null} shapes={shapes} />
      <div class="scroll">
        <div class="pad" style="margin-top:8px">
          <div class="row">
            <b class="grow">{TYPE_LABEL[f.type]}</b>
            {f.severity && f.severity !== 'ok' && (
              <span class="badge" style={`background:${SEV_COLOR[f.severity]};color:#fff`}>{f.severity}</span>
            )}
            <span class="muted small">{props.pos} / {props.total}</span>
          </div>
          <div class="small muted" style="margin-top:4px">
            {lineTokens.slice(0, -1).join(' ')} <b style="color:var(--text)">{lineTokens.at(-1)}</b>
          </div>
          <div class="small" style="margin-top:6px">
            vs <b>{game.opponent}</b>
            {game.oppRating ? ` (${game.oppRating})` : ''} · {game.speed} · {result} · {new Date(game.playedAt).toLocaleDateString()}
          </div>
          {game.openingName && <div class="small muted">{game.eco} {game.openingName}</div>}
          <a class="small" href={`${gameUrl(game.id, game.myColor)}#${f.ply + 1}`} target="_blank" rel="noopener noreferrer" style="color:var(--blue)">
            Open game on lichess.org ↗
          </a>
        </div>

        {f.type === 'deviation' && (
          <div class="card">
            <p style="margin-top:0">
              You played <b style="color:var(--red)">{f.playedSan}</b>, your repertoire says <b style="color:var(--green)">{expected?.san ?? f.expectedSan}</b>.
            </p>
            {f.evalBest !== undefined && f.evalPlayed !== undefined && (
              <p class="small muted">
                Engine{f.evalSource === 'lichess' ? ' (Lichess analysis)' : ''}: your move {fmtEval(f.evalPlayed)}, best {fmtEval(f.evalBest)}
                {f.bestSan ? ` (${f.bestSan})` : ''}.
              </p>
            )}
            <button
              class="btn primary block"
              onClick={() =>
                done(async () => {
                  const m = await drillFinding(f);
                  if (m) go(`practice?mode=moves&moves=${m.id}&auto=1&t=${Date.now()}`);
                })
              }
            >
              Drill this
            </button>
            <button
              class="btn block"
              style="margin-top:8px"
              onClick={async () => {
                if (
                  await confirmDialog(
                    `Make ${f.playedSan} your main move here? ${expected?.san ?? 'The current move'} stays saved as an alternative.`,
                    { ok: 'Update repertoire', title: 'My move was better' },
                  )
                )
                  await done(async () => {
                    await adoptPlayedMove(f);
                    toast(`${f.playedSan} is now your main move`);
                  });
              }}
            >
              My move was better: update repertoire
            </button>
            <button class="btn block ghost" style="margin-top:8px" onClick={() => done(() => setFindingStatus(f, 'dismissed'))}>
              Dismiss
            </button>
          </div>
        )}

        {(f.type === 'gap' || f.type === 'outOfBook') && (
          <div class="card">
            <p style="margin-top:0">
              {f.type === 'gap' ? (
                <>
                  Your opponent played <b>{f.playedSan}</b>, which your repertoire doesn’t cover. What will you play next time?
                </>
              ) : (
                <>
                  Your repertoire has no move here. You played <b>{f.playedSan}</b>
                  {f.severity ? ` (${f.severity === 'ok' ? 'fine' : f.severity})` : ''}.
                </>
              )}
            </p>
            <EnginePanel fen={prepFen} ply={f.ply + (f.type === 'gap' ? 1 : 0)} onPlay={(uci) => openBuild(uci)} />
            {bk && bk.moves(prepFen).length > 0 && (
              <div style="margin-top:8px">
                <div class="small muted" style="margin-bottom:4px">
                  <span class="src-tag book">book</span> Named lines
                </div>
                <div class="chips">
                  {bk.moves(prepFen).slice(0, 6).map((m) => {
                    const p = playMove(prepFen, m.san);
                    return (
                      <button class="chip" onClick={() => p && openBuild(p.uci)} title={m.name?.name}>
                        {m.san}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
            <button class="btn primary block" style="margin-top:10px" onClick={() => openBuild()}>
              Add to repertoire
            </button>
            <button class="btn block ghost" style="margin-top:8px" onClick={() => done(() => setFindingStatus(f, 'dismissed'))}>
              Dismiss
            </button>
          </div>
        )}
        <div class="pad">
          <button class="btn block ghost" onClick={props.onNext}>Skip for now ›</button>
        </div>
      </div>
    </>
  );
}
