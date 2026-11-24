import { effect, signal } from '@preact/signals';
import { Chess } from 'chess.js';
import { fullFen, playMove } from '../core/fen';
import { lichessEval, lossCp, MATE_CP, severityOf } from '../core/review';
import type { GameFinding } from '../core/types';
import { engine, type EngineLine } from './stockfish';

/** Number of engine panels on screen. The background queue pauses while you use the engine yourself. */
export const engineUsers = signal(0);
export const queueRunning = signal(false);
export const queueRemaining = signal(0);

export interface EvalDeps {
  candidates: () => GameFinding[];
  gameOf: (f: GameFinding) => import('../core/types').LichessGame | undefined;
  update: (f: GameFinding, patch: Partial<GameFinding>) => Promise<unknown>;
  settings: () => { engineCheck: boolean; engineDepth: number };
}

let deps: EvalDeps | null = null;
let running = false;
let again = false;

/** White-POV centipawns of an engine line (mate mapped to ±MATE_CP). */
function cpOf(l: EngineLine | null): number | null {
  if (!l) return null;
  if (l.mate !== undefined) return l.mate > 0 ? MATE_CP - l.mate : -MATE_CP - l.mate;
  return l.cp ?? null;
}

function sanOf(fen: string, uci: string | undefined): string | undefined {
  if (!uci) return undefined;
  try {
    return new Chess(fullFen(fen)).move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] }).san;
  } catch {
    return undefined;
  }
}

/** Findings that still need an evaluation. */
function pending(): GameFinding[] {
  if (!deps) return [];
  return deps.candidates().filter((f) => (f.type === 'deviation' || f.type === 'outOfBook') && f.status === 'new' && !f.evalSource && f.playedUci);
}

/**
 * Processes findings one at a time. Lichess's own analysis is used when the game has it;
 * otherwise Stockfish (in its Web Worker, so the UI never blocks) evaluates the position
 * before the move (best move + eval) and after my move.
 */
export async function runQueue() {
  if (!deps) return;
  if (running) {
    again = true;
    return;
  }
  running = true;
  queueRunning.value = true;
  try {
    for (;;) {
      const s = deps.settings();
      const list = pending();
      queueRemaining.value = list.length;
      if (!list.length || !s.engineCheck) break;
      if (engineUsers.value > 0) break; // resumes when the panel closes
      const f = list[0];
      const game = deps.gameOf(f);
      const le = game ? lichessEval(game, f.ply) : null;
      if (le) {
        await deps.update(f, { ...le, severity: severityOf(lossCp(le.evalBest, le.evalPlayed)), evalSource: 'lichess' });
        continue;
      }
      const myColor = game?.myColor ?? (f.fen.split(' ')[1] as 'w' | 'b');
      const sign = myColor === 'w' ? 1 : -1;
      const p = playMove(f.fen, { from: f.playedUci!.slice(0, 2), to: f.playedUci!.slice(2, 4), promotion: f.playedUci![4] });
      if (!p) {
        await deps.update(f, { evalSource: 'engine' }); // unreadable: don't retry forever
        continue;
      }
      const before = await engine.evaluate(f.fen, s.engineDepth);
      if (!before.complete || engineUsers.value > 0) break;
      const after = await engine.evaluate(p.toFen, s.engineDepth);
      if (!after.complete || engineUsers.value > 0) break;
      const best = cpOf(before.line);
      const played = cpOf(after.line);
      if (best === null || played === null) {
        await deps.update(f, { evalSource: 'engine' });
        continue;
      }
      const evalBest = best * sign;
      const evalPlayed = played * sign;
      await deps.update(f, {
        evalBest,
        evalPlayed,
        bestSan: sanOf(f.fen, before.line?.pv[0]),
        severity: severityOf(lossCp(evalBest, evalPlayed)),
        evalSource: 'engine',
      });
    }
  } finally {
    running = false;
    queueRunning.value = false;
    if (again) {
      again = false;
      setTimeout(runQueue, 0);
    }
  }
}

/** Wires the queue to the app state and restarts it whenever the engine becomes free. */
export function setupEvalQueue(d: EvalDeps) {
  deps = d;
  effect(() => {
    if (engineUsers.value === 0) setTimeout(runQueue, 1500);
  });
}
