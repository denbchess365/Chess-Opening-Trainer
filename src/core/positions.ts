import { Chess, validateFen } from 'chess.js';
import { normalizeFen } from './fen';

export const START_FULL = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
export const EMPTY_BOARD = '8/8/8/8/8/8/8/8';

export interface PositionCheck {
  ok: boolean;
  /** Problems that make the position unusable. */
  errors: string[];
  /** Things that were corrected automatically (e.g. impossible castling rights removed). */
  warnings: string[];
  /** Cleaned-up full FEN (only meaningful when ok). */
  fen: string;
}

const FILES = 'abcdefgh';

/** Parses the piece-placement field into a map square → piece letter. Returns null if malformed. */
export function parseBoard(placement: string): Map<string, string> | null {
  const rows = placement.split('/');
  if (rows.length !== 8) return null;
  const out = new Map<string, string>();
  for (let r = 0; r < 8; r++) {
    let f = 0;
    for (const ch of rows[r]) {
      if (/[1-8]/.test(ch)) f += Number(ch);
      else if (/[pnbrqkPNBRQK]/.test(ch)) {
        if (f > 7) return null;
        out.set(FILES[f] + (8 - r), ch);
        f++;
      } else return null;
    }
    if (f !== 8) return null;
  }
  return out;
}

export function boardToPlacement(board: Map<string, string>): string {
  let s = '';
  for (let r = 8; r >= 1; r--) {
    let empty = 0;
    for (const f of FILES) {
      const p = board.get(f + r);
      if (p) {
        if (empty) s += empty;
        empty = 0;
        s += p;
      } else empty++;
    }
    if (empty) s += empty;
    if (r > 1) s += '/';
  }
  return s;
}

/** Castling rights that are possible given where the kings and rooks stand. */
export function possibleCastling(board: Map<string, string>): string {
  let c = '';
  if (board.get('e1') === 'K') {
    if (board.get('h1') === 'R') c += 'K';
    if (board.get('a1') === 'R') c += 'Q';
  }
  if (board.get('e8') === 'k') {
    if (board.get('h8') === 'r') c += 'k';
    if (board.get('a8') === 'r') c += 'q';
  }
  return c;
}

/** En-passant target squares that are consistent with the board and side to move. */
export function possibleEpSquares(board: Map<string, string>, turn: 'w' | 'b'): string[] {
  const out: string[] = [];
  for (const f of FILES) {
    if (turn === 'w') {
      // Black just played …f7-f5: pawn on f5, f6 and f7 empty.
      if (board.get(f + '5') === 'p' && !board.get(f + '6') && !board.get(f + '7')) out.push(f + '6');
    } else if (board.get(f + '4') === 'P' && !board.get(f + '3') && !board.get(f + '2')) out.push(f + '3');
  }
  return out;
}

/**
 * Validates a position (full or 4-field FEN) with clear, human error messages:
 * exactly one king each, the side NOT to move must not be in check, no pawns on the
 * 1st/8th rank, at most 8 pawns and 16 pieces per side. Impossible castling rights and
 * en-passant squares are removed with a warning.
 */
export function checkPosition(input: string): PositionCheck {
  const errors: string[] = [];
  const warnings: string[] = [];
  const parts = input.trim().split(/\s+/);
  if (!parts[0]) return { ok: false, errors: ['Enter a FEN.'], warnings, fen: '' };
  const board = parseBoard(parts[0]);
  if (!board) return { ok: false, errors: ['The piece placement is not valid FEN (8 ranks of 8 squares).'], warnings, fen: '' };
  const turn = (parts[1] ?? 'w') as 'w' | 'b';
  if (turn !== 'w' && turn !== 'b') errors.push('Side to move must be "w" or "b".');

  const count = (p: string) => [...board.values()].filter((x) => x === p).length;
  for (const [side, k] of [['White', 'K'], ['Black', 'k']] as const) {
    const n = count(k);
    if (n === 0) errors.push(`${side} has no king.`);
    if (n > 1) errors.push(`${side} has ${n} kings — exactly one is allowed.`);
  }
  for (const [sq, p] of board) {
    if (/p/i.test(p) && (sq[1] === '1' || sq[1] === '8')) errors.push(`Pawn on ${sq}: pawns can’t stand on the 1st or 8th rank.`);
  }
  for (const [side, isSide] of [['White', (p: string) => p === p.toUpperCase()], ['Black', (p: string) => p === p.toLowerCase()]] as const) {
    const mine = [...board.values()].filter(isSide);
    const pawns = mine.filter((p) => /p/i.test(p)).length;
    if (pawns > 8) errors.push(`${side} has ${pawns} pawns (max 8).`);
    if (mine.length > 16) errors.push(`${side} has ${mine.length} pieces (max 16).`);
  }

  // Castling and en passant: drop what's impossible.
  const possible = possibleCastling(board);
  const requested = parts[2] && parts[2] !== '-' ? parts[2] : '';
  const castling = [...requested].filter((c) => possible.includes(c) && 'KQkq'.includes(c)).join('');
  if (castling !== requested.replace(/[^KQkq]/g, '') || /[^KQkq-]/.test(parts[2] ?? '-'))
    warnings.push('Removed castling rights that aren’t possible with the kings and rooks where they are.');
  let ep = parts[3] ?? '-';
  if (ep !== '-' && !possibleEpSquares(board, turn).includes(ep)) {
    warnings.push(`Removed the en-passant square ${ep}: no pawn could have just moved past it.`);
    ep = '-';
  }
  const half = /^\d+$/.test(parts[4] ?? '') ? Number(parts[4]) : 0;
  const full = /^\d+$/.test(parts[5] ?? '') && Number(parts[5]) > 0 ? Number(parts[5]) : 1;
  if (half > 150) errors.push('The halfmove clock is too large.');

  const fen = `${boardToPlacement(board)} ${turn} ${castling || '-'} ${ep} ${half} ${full}`;
  if (!errors.length) {
    // The side that is NOT to move must not be in check (it would mean the last move was illegal).
    try {
      const c = new Chess(fen, { skipValidation: true });
      const notToMove = turn === 'w' ? 'b' : 'w';
      const kingSq = [...board].find(([, p]) => p === (notToMove === 'w' ? 'K' : 'k'))?.[0];
      if (kingSq && c.isAttacked(kingSq as any, turn)) {
        errors.push(`${notToMove === 'w' ? 'White' : 'Black'} is in check but it’s ${turn === 'w' ? 'White' : 'Black'}’s move — that can’t happen. Change the side to move or the pieces.`);
      }
    } catch {
      errors.push('chess.js could not read this position.');
    }
  }
  if (!errors.length) {
    const v = validateFen(fen);
    if (!v.ok) errors.push(v.error?.replace(/^Invalid FEN: /, '') ?? 'Invalid position.');
  }
  if (!errors.length) {
    const c = new Chess(fen);
    if (c.isCheckmate()) warnings.push('This position is already checkmate.');
    else if (c.isStalemate()) warnings.push('This position is already stalemate.');
  }
  return { ok: errors.length === 0, errors, warnings, fen };
}

/** Material signature with the stronger side first, e.g. "KBNvK", "KRPvKR". */
export function materialSignature(fen: string): string {
  const board = parseBoard(fen.split(' ')[0]) ?? new Map();
  const order = 'kqrbnp';
  const side = (upper: boolean) =>
    [...board.values()]
      .filter((p) => (p === p.toUpperCase()) === upper)
      .map((p) => p.toLowerCase())
      .sort((a, b) => order.indexOf(a) - order.indexOf(b))
      .join('')
      .toUpperCase();
  const value = (s: string) => [...s].reduce((n, c) => n + ({ Q: 9, R: 5, B: 3, N: 3, P: 1 } as Record<string, number>)[c] || n, 0);
  const w = side(true);
  const b = side(false);
  return value(w) >= value(b) ? `${w}v${b}` : `${b}v${w}`;
}

export function pieceCount(fen: string): number {
  return (fen.split(' ')[0].match(/[a-zA-Z]/g) ?? []).length;
}

/** "White to move — mate the king" style goal line. */
export function goalText(goal: 'win' | 'draw' | 'bestMove', mySide: 'w' | 'b', fen: string): string {
  const toMove = fen.split(' ')[1] === 'b' ? 'Black' : 'White';
  const me = mySide === 'w' ? 'White' : 'Black';
  const mine = toMove === me;
  if (goal === 'win') return `${toMove} to move — ${mine ? 'mate the king' : `${me} mates`}`;
  if (goal === 'draw') return `${toMove} to move — ${mine ? 'hold the draw' : `${me} holds the draw`}`;
  return `${toMove} to move — find the best move`;
}

/** Normalized (4-field) key of a position, used to find duplicates and line roots. */
export function positionKey(fen: string): string {
  return normalizeFen(fen);
}
