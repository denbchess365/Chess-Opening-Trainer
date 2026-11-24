import { Chess } from 'chess.js';
import { playMove, normalizeFen, type PlayedMove } from './fen';
import type { Grade, PositionGoal, RunResult } from './types';

export const MATE = 10000;

export interface Outcome {
  over: boolean;
  success: boolean;
  result: RunResult;
  reason: string;
}

const ONGOING: Outcome = { over: false, success: false, result: 'fail', reason: '' };

/**
 * Checks whether the game is over and whether that counts as success for the goal.
 *  - win:  success only by checkmating; stalemate, insufficient material, threefold
 *          repetition and the 50-move rule are fails; being mated is a fail.
 *  - draw: success by stalemate, threefold repetition, insufficient material or the
 *          50-move rule (or by mating the opponent); being mated is a fail.
 */
export function outcome(fen: string, goal: PositionGoal, mySide: 'w' | 'b', history: string[] = []): Outcome {
  const c = new Chess(fen);
  const toMove = c.turn();
  if (c.isCheckmate()) {
    const iWon = toMove !== mySide;
    return iWon
      ? { over: true, success: true, result: 'win', reason: 'Checkmate!' }
      : { over: true, success: false, result: 'loss', reason: 'You were checkmated.' };
  }
  let draw = '';
  if (c.isStalemate()) draw = 'Stalemate!';
  else if (c.isInsufficientMaterial()) draw = 'Insufficient material — draw';
  else if (isThreefold(fen, history)) draw = 'Threefold repetition — draw';
  else if (c.isDrawByFiftyMoves()) draw = '50-move rule — draw';
  if (draw) return { over: true, success: goal === 'draw', result: goal === 'draw' ? 'draw' : 'fail', reason: draw };
  return ONGOING;
}

/** Threefold repetition over the positions of this game (normalized FENs, current included). */
export function isThreefold(fen: string, history: string[]): boolean {
  const key = normalizeFen(fen);
  return [...history, fen].filter((f) => normalizeFen(f) === key).length >= 3;
}

/** Moves left before the 50-move rule triggers (from the halfmove clock). */
export function fiftyMoveCount(fen: string): number {
  return Math.floor((Number(fen.split(' ')[4]) || 0) / 2);
}

/** Mate distance in moves from a my-point-of-view score, or null if not a mate score. */
export function mateIn(cp: number | null | undefined): number | null {
  if (cp == null || Math.abs(cp) < MATE - 500) return null;
  return cp > 0 ? MATE - cp : -(MATE + cp);
}

export interface Feedback {
  level: 'good' | 'slower' | 'inaccurate' | 'lost';
  text: string;
}

/**
 * Gentle move-quality feedback from evaluations (my point of view, centipawns,
 * mate = ±(10000 − n)) before and after my move.
 */
export function moveFeedback(goal: PositionGoal, before: number | null, after: number | null): Feedback | null {
  if (after != null && after >= MATE) return { level: 'good', text: 'Checkmate!' };
  if (before == null || after == null) return null;
  const mb = mateIn(before);
  const ma = mateIn(after);
  if (goal === 'win' || (mb !== null && mb > 0)) {
    if (mb !== null && mb > 0) {
      if (ma === null || ma <= 0) {
        if (after < 200) return { level: 'lost', text: 'That throws away the win.' };
        return { level: 'inaccurate', text: `The forced mate is gone (eval ${(after / 100).toFixed(1)}).` };
      }
      // With best play the mate shortens by one each move (mate in N → N−1).
      // Two or more moves worse than that is "noticeably longer".
      if (ma > mb) return { level: 'slower', text: `Slower: mate in ${mb} → mate in ${ma}.` };
      return { level: 'good', text: ma < mb ? `Good — mate in ${ma}.` : 'Good.' };
    }
    if (before - after > 150) return { level: 'inaccurate', text: `That cost about ${((before - after) / 100).toFixed(1)} pawns.` };
    return null;
  }
  if (goal === 'draw') {
    if (before > -150 && after < -300) return { level: 'lost', text: 'Careful — this position may now be lost.' };
    if (before - after > 150) return { level: 'inaccurate', text: 'That makes the defence harder.' };
  }
  return null;
}

/** True when a win goal can no longer be reached (mate disappeared and the eval dropped below +2). */
export function winThrownAway(before: number | null, after: number | null): boolean {
  const mb = mateIn(before);
  return mb !== null && mb > 0 && after !== null && mateIn(after) === null && after < 200;
}

export interface GradeInput {
  success: boolean;
  hintsUsed: number;
  movesTaken: number;
  engineDtm?: number | null;
}

/** Slack allowed over the engine's mate distance before a win counts as "took much longer". */
export function slack(dtm: number): number {
  return Math.max(3, Math.ceil(dtm * 0.25));
}

/**
 * Mode A grading: failed = Again; won/held with hints or much slower than the engine = Hard;
 * clean = Good.
 */
export function gradeRun(r: GradeInput): Grade {
  if (!r.success) return 'again';
  if (r.hintsUsed > 0) return 'hard';
  if (r.engineDtm && r.movesTaken > r.engineDtm + slack(r.engineDtm)) return 'hard';
  return 'good';
}

/** Replays UCI moves from a full FEN into played moves (normalized FENs) for saving as a line. */
export function playoutToLine(startFen: string, uci: string[]): PlayedMove[] {
  const out: PlayedMove[] = [];
  let fen = normalizeFen(startFen);
  for (const u of uci) {
    const p = playMove(fen, { from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] });
    if (!p) break;
    out.push(p);
    fen = p.toFen;
  }
  return out;
}

/** Full FENs after each move (clocks included), for repetition and the 50-move rule. */
export function replayFull(startFen: string, uci: string[]): string[] {
  const c = new Chess(startFen);
  const out: string[] = [];
  for (const u of uci) {
    c.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] });
    out.push(c.fen());
  }
  return out;
}
