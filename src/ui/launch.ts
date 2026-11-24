import { checkPosition } from '../core/positions';
import type { PositionGoal, PositionSource } from '../core/types';
import { findPositionByFen } from '../state/store';
import { actionSheet, toast } from './dialogs';
import { go } from './router';

function full(fen: string): string | null {
  const c = checkPosition(fen);
  if (!c.ok) {
    toast(c.errors[0] ?? 'This position can’t be used.');
    return null;
  }
  return c.fen;
}

/** Asks for the play-out goal, then calls back (used where the play-out opens in place). */
export function chooseGoal(side: 'w' | 'b', onPick: (goal: PositionGoal) => void) {
  actionSheet(`Play it out as ${side === 'w' ? 'White' : 'Black'}`, [
    { label: '♚ Goal: win (mate the king)', run: () => onPick('win') },
    { label: '½ Goal: hold the draw', run: () => onPick('draw') },
    { label: '★ Goal: find the best move', run: () => onPick('bestMove') },
  ]);
}

/** Full, validated FEN for a (possibly normalized) FEN, or null with a toast. */
export function fullOrToast(fen: string): string | null {
  return full(fen);
}

/** Starts a play-out from any position. A saved position uses its own goal; otherwise you pick one. */
export function playOutFrom(fen: string, side: 'w' | 'b', title = '') {
  const f = full(fen);
  if (!f) return;
  const saved = findPositionByFen(f);
  const start = (goal: PositionGoal) =>
    go(`playout?fen=${encodeURIComponent(f)}&side=${side}&goal=${goal}&title=${encodeURIComponent(title)}&t=${Date.now()}`);
  actionSheet(`Play it out as ${side === 'w' ? 'White' : 'Black'}`, [
    ...(saved ? [{ label: `▶︎ Saved position “${saved.title || 'untitled'}” (its goal)`, run: () => go(`playout?pos=${saved.id}&t=${Date.now()}`) }] : []),
    { label: '♚ Goal: win (mate the king)', run: () => start('win') },
    { label: '½ Goal: hold the draw', run: () => start('draw') },
    { label: '★ Goal: find the best move', run: () => start('bestMove') },
  ]);
}

/** Opens the position editor pre-filled with this position (you can adjust and save it). */
export function savePositionFrom(fen: string, source: PositionSource, title = '', side?: 'w' | 'b') {
  const f = full(fen);
  if (!f) return;
  const saved = findPositionByFen(f);
  if (saved) {
    toast('This position is already saved.');
    go(`position/${saved.id}`);
    return;
  }
  go(`position/new?fen=${encodeURIComponent(f)}&source=${source}&title=${encodeURIComponent(title)}${side ? `&side=${side}` : ''}`);
}

export function analysisFrom(fen: string, side: 'w' | 'b') {
  const f = full(fen);
  if (f) go(`analysis?fen=${encodeURIComponent(f)}&orient=${side}`);
}
