import { playMove, ROOT, turnOf } from './fen';
import type { RepGraph } from './tree';
import type { FindingType, GameFinding, LichessGame, Severity } from './types';

export interface Comparison {
  type: FindingType;
  /** Position before the flagged move (or the last position reached, for 'followed'). */
  fen: string;
  /** 0-based ply of the flagged move; for 'followed' the number of plies that matched the repertoire. */
  ply: number;
  playedSan: string;
  playedUci?: string;
  expectedSan?: string;
  /** How many plies of the game stayed inside the repertoire (used to pick the best repertoire). */
  matched: number;
}

/**
 * Walks a game from the start against one repertoire and stops at the first event:
 *  - deviation:  my turn, the repertoire has a main move here, I played something else
 *  - gap:        opponent's turn, they played a move my repertoire doesn't cover
 *                (but I had prepared other replies there)
 *  - outOfBook:  my turn, and the repertoire has no move for this position
 *  - followed:   the game stayed in the repertoire until my prepared line ran out (or the game ended)
 * Positions are compared by normalized FEN, so transpositions count as being in book.
 * Playing one of my saved alternative moves counts as staying in book.
 */
export function compareGame(sans: string[], myColor: 'w' | 'b', g: RepGraph): Comparison {
  let fen = ROOT;
  for (let ply = 0; ply < sans.length; ply++) {
    const p = playMove(fen, sans[ply]);
    if (!p) break; // unreadable move: treat what we have as followed
    const known = g.findByUci(fen, p.uci);
    const myTurn = turnOf(fen) === myColor;
    if (myTurn) {
      if (!known) {
        const main = g.primary(fen);
        if (main) return { type: 'deviation', fen, ply, playedSan: p.san, playedUci: p.uci, expectedSan: main.san, matched: ply };
        return { type: 'outOfBook', fen, ply, playedSan: p.san, playedUci: p.uci, matched: ply };
      }
    } else if (!known) {
      // Opponent left my lines. If my line simply ended here (I played into this position), that's
      // a success. At the very start with nothing prepared, it's an unprepared reply (a gap).
      if (g.children(fen).length === 0 && ply > 0) return { type: 'followed', fen, ply, playedSan: p.san, playedUci: p.uci, matched: ply };
      return { type: 'gap', fen, ply, playedSan: p.san, playedUci: p.uci, matched: ply };
    }
    fen = p.toFen;
  }
  return { type: 'followed', fen, ply: sans.length, playedSan: '', matched: sans.length };
}

/** Picks the repertoire for the game's colour that follows the game the longest. */
export function analyzeGame(
  game: LichessGame,
  reps: { id: string; side: 'w' | 'b'; graph: RepGraph }[],
  now = Date.now(),
): GameFinding | null {
  const sans = game.moves.split(/\s+/).filter(Boolean);
  let best: { rep: (typeof reps)[number]; c: Comparison } | null = null;
  for (const rep of reps) {
    if (rep.side !== game.myColor) continue;
    const c = compareGame(sans, game.myColor, rep.graph);
    if (!best || c.matched > best.c.matched) best = { rep, c };
  }
  if (!best) return null;
  const { rep, c } = best;
  return {
    id: game.id,
    gameId: game.id,
    repertoireId: rep.id,
    fen: c.fen,
    ply: c.ply,
    type: c.type,
    playedSan: c.playedSan,
    playedUci: c.playedUci,
    expectedSan: c.expectedSan,
    status: 'new',
    createdAt: now,
  };
}

/** Keeps the user's decision (drilled/added/dismissed) when the same event is found again. */
export function mergeFinding(prev: GameFinding | undefined, next: GameFinding): GameFinding {
  if (!prev) return next;
  const same = prev.type === next.type && prev.ply === next.ply && prev.playedSan === next.playedSan && prev.repertoireId === next.repertoireId;
  if (!same) return next;
  return {
    ...next,
    status: prev.status,
    createdAt: prev.createdAt,
    evalPlayed: prev.evalPlayed,
    evalBest: prev.evalBest,
    bestSan: prev.bestSan,
    severity: prev.severity,
    evalSource: prev.evalSource,
  };
}

// ---------------------------------------------------------------- evaluations

export const MATE_CP = 10000;

/** Centipawn loss → severity, per the usual thresholds (0.5 / 1.0 / 2.0 pawns). */
export function severityOf(lossCp: number): Severity {
  if (lossCp > 200) return 'blunder';
  if (lossCp > 100) return 'mistake';
  if (lossCp > 50) return 'inaccuracy';
  return 'ok';
}

function toCp(e: { cp?: number; mate?: number } | null | undefined): number | null {
  if (!e) return null;
  if (typeof e.mate === 'number') return e.mate > 0 ? MATE_CP - e.mate : -MATE_CP - e.mate;
  return typeof e.cp === 'number' ? e.cp : null;
}

/**
 * Evaluation from Lichess's own analysis, if the game was analysed. evals[i] is the
 * evaluation (White's view) after ply i, so the position before ply k is evals[k-1].
 * Returns values from MY point of view, or null if not available.
 */
export function lichessEval(game: LichessGame, ply: number): { evalBest: number; evalPlayed: number } | null {
  if (!game.evals || ply < 1 || ply >= game.evals.length) return null;
  const before = toCp(game.evals[ply - 1]);
  const after = toCp(game.evals[ply]);
  if (before === null || after === null) return null;
  const s = game.myColor === 'w' ? 1 : -1;
  return { evalBest: before * s, evalPlayed: after * s };
}

/** Loss in centipawns, capped so mate scores don't produce silly numbers. */
export function lossCp(evalBest: number, evalPlayed: number): number {
  const cap = (x: number) => Math.max(-1500, Math.min(1500, x));
  return Math.max(0, cap(evalBest) - cap(evalPlayed));
}

// ---------------------------------------------------------------- performance by opening

export interface OpeningPerf {
  key: string;
  label: string;
  games: number;
  wins: number;
  draws: number;
  losses: number;
  /** Average score 0..1 (win 1, draw 0.5, loss 0). */
  score: number;
}

/** Groups games by a key and sorts weakest first (lowest score, then most games). */
export function performance(
  games: LichessGame[],
  keyOf: (g: LichessGame) => { key: string; label: string } | null,
  minGames = 1,
): OpeningPerf[] {
  const map = new Map<string, OpeningPerf>();
  for (const g of games) {
    if (g.result === 'unknown') continue;
    const k = keyOf(g);
    if (!k) continue;
    let p = map.get(k.key);
    if (!p) map.set(k.key, (p = { key: k.key, label: k.label, games: 0, wins: 0, draws: 0, losses: 0, score: 0 }));
    p.games++;
    if (g.result === 'win') p.wins++;
    else if (g.result === 'draw') p.draws++;
    else p.losses++;
  }
  return [...map.values()]
    .filter((p) => p.games >= minGames)
    .map((p) => ({ ...p, score: (p.wins + p.draws / 2) / p.games }))
    .sort((a, b) => a.score - b.score || b.games - a.games);
}
