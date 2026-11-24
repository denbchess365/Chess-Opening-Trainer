import { Chess } from 'chess.js';
import { pieceCount } from '../core/positions';
import { probe, TB_MAX_PIECES, tbScore } from '../net/tablebase';
import { engine, type EngineLine } from './stockfish';

const MATE = 10000;

export interface Analysis {
  /** Best move for the side to move (UCI), if any. */
  best: string | null;
  bestSan?: string;
  /** Score from WHITE's point of view (mate in n = ±(10000 − n)). null if unknown. */
  white: number | null;
  source: 'tablebase' | 'engine';
  /** Search was cut short (e.g. the screen was left). */
  incomplete?: boolean;
}

function lineScore(l: EngineLine | null): number | null {
  if (!l) return null;
  if (l.mate !== undefined) return l.mate > 0 ? MATE - l.mate : -MATE - l.mate;
  return l.cp ?? null;
}

/**
 * Best move + evaluation for a position: Lichess tablebase when enabled, online and
 * ≤ 7 pieces; otherwise Stockfish. With ≤ 5 pieces Stockfish searches deeper so its
 * defence is accurate.
 */
export async function analyse(fen: string, opts: { depth: number; useTablebase: boolean; maxMs?: number }): Promise<Analysis> {
  const pieces = pieceCount(fen);
  const turnWhite = fen.split(' ')[1] !== 'b';
  if (opts.useTablebase && pieces <= TB_MAX_PIECES) {
    const tb = await probe(fen);
    if (tb) {
      const s = tbScore(tb.category, tb.dtm);
      return { best: tb.moves[0]?.uci ?? null, bestSan: tb.moves[0]?.san, white: turnWhite ? s : -s, source: 'tablebase' };
    }
  }
  const depth = pieces <= 5 ? Math.max(opts.depth, 24) : opts.depth;
  const maxMs = opts.maxMs ?? (pieces <= 5 ? 4000 : 3000);
  const r = await engine.evaluate(fen, depth, maxMs);
  let bestSan: string | undefined;
  const best = r.line?.pv[0] ?? null;
  if (best) {
    try {
      bestSan = new Chess(fen).move({ from: best.slice(0, 2), to: best.slice(2, 4), promotion: best[4] }).san;
    } catch {
      /* ignore */
    }
  }
  return { best, bestSan, white: lineScore(r.line), source: 'engine', incomplete: !r.complete && !r.line };
}

/** Converts a white-POV score to a given side's POV. */
export function povScore(white: number | null, side: 'w' | 'b'): number | null {
  return white === null ? null : side === 'w' ? white : -white;
}
