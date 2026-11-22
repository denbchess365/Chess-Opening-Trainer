import { Chess } from 'chess.js';

export const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

/**
 * Normalizes a FEN so transpositions merge: drops the halfmove/fullmove clocks
 * and clears the en-passant square unless an en-passant capture is actually legal.
 */
export function normalizeFen(fen: string): string {
  const parts = fen.trim().split(/\s+/);
  const [board, turn = 'w', castling = '-', ep = '-'] = parts;
  let e = ep;
  if (e !== '-') {
    try {
      const c = new Chess(`${board} ${turn} ${castling} ${ep} 0 1`);
      if (!c.moves({ verbose: true }).some((m) => m.flags.includes('e'))) e = '-';
    } catch {
      e = '-';
    }
  }
  return `${board} ${turn} ${castling} ${e}`;
}

export const ROOT = normalizeFen(START_FEN);

/** Expands a normalized FEN back into a full FEN that chess.js accepts. */
export function fullFen(nfen: string): string {
  return nfen.split(' ').length === 4 ? `${nfen} 0 1` : nfen;
}

export function turnOf(nfen: string): 'w' | 'b' {
  return nfen.split(' ')[1] === 'b' ? 'b' : 'w';
}

export interface PlayedMove {
  san: string;
  uci: string;
  from: string;
  to: string;
  fromFen: string;
  toFen: string;
}

/** Plays a move (SAN or {from,to,promotion}) from a normalized FEN. Returns null if illegal. */
export function playMove(
  nfen: string,
  move: string | { from: string; to: string; promotion?: string },
): PlayedMove | null {
  const c = new Chess(fullFen(nfen));
  try {
    const m = c.move(move as any);
    if (!m) return null;
    return {
      san: m.san,
      uci: m.from + m.to + (m.promotion ?? ''),
      from: m.from,
      to: m.to,
      fromFen: nfen,
      toFen: normalizeFen(c.fen()),
    };
  } catch {
    return null;
  }
}

export function uciToMove(uci: string) {
  return { from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci.length > 4 ? uci[4] : undefined };
}

/** Legal destinations map for chessground. */
export function legalDests(nfen: string): Map<string, string[]> {
  const c = new Chess(fullFen(nfen));
  const dests = new Map<string, string[]>();
  for (const m of c.moves({ verbose: true })) {
    const arr = dests.get(m.from);
    if (arr) {
      if (!arr.includes(m.to)) arr.push(m.to);
    } else dests.set(m.from, [m.to]);
  }
  return dests;
}

export function inCheck(nfen: string): boolean {
  return new Chess(fullFen(nfen)).inCheck();
}

export function isPromotion(nfen: string, from: string, to: string): boolean {
  const c = new Chess(fullFen(nfen));
  return c.moves({ verbose: true }).some((m) => m.from === from && m.to === to && !!m.promotion);
}

/** Formats a sequence of SANs with move numbers, e.g. "1. d4 Nf6 2. Bf4". */
export function formatLine(sans: string[], startTurn: 'w' | 'b' = 'w', startNo = 1): string {
  let out = '';
  let no = startNo;
  let turn = startTurn;
  sans.forEach((san, i) => {
    if (turn === 'w') out += `${no}. `;
    else if (i === 0) out += `${no}... `;
    out += san + ' ';
    if (turn === 'b') no++;
    turn = turn === 'w' ? 'b' : 'w';
  });
  return out.trim();
}
