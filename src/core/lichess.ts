import type { LichessGame, LichessSettings, Speed } from './types';

export const LICHESS = 'https://lichess.org';
export const MAX_GAMES_LIMIT = 200;

export function validUsername(u: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9_-]{1,29}$/.test(u);
}

/** URL for GET /api/games/user/{username} with the options from Settings. */
export function gamesUrl(s: Pick<LichessSettings, 'username' | 'speeds' | 'ratedOnly' | 'maxGames'>, since?: number): string {
  if (!validUsername(s.username)) throw new Error('Invalid Lichess username.');
  const p = new URLSearchParams();
  p.set('max', String(Math.max(1, Math.min(MAX_GAMES_LIMIT, Math.round(s.maxGames)))));
  if (s.speeds.length) p.set('perfType', s.speeds.join(','));
  if (s.ratedOnly) p.set('rated', 'true');
  if (since) p.set('since', String(since));
  p.set('opening', 'true');
  p.set('evals', 'true');
  p.set('clocks', 'false');
  return `${LICHESS}/api/games/user/${encodeURIComponent(s.username)}?${p}`;
}

export function gameUrl(id: string, color?: 'w' | 'b'): string {
  return `${LICHESS}/${encodeURIComponent(id)}${color === 'b' ? '/black' : ''}`;
}

/** Shape of one game in Lichess's ndjson export (only the fields we use). */
export interface LichessApiGame {
  id: string;
  rated?: boolean;
  variant?: string;
  speed?: string;
  createdAt?: number;
  status?: string;
  winner?: 'white' | 'black';
  players?: Record<'white' | 'black', { user?: { id?: string; name?: string }; rating?: number; aiLevel?: number }>;
  opening?: { eco?: string; name?: string };
  moves?: string;
  initialFen?: string;
  analysis?: { eval?: number; mate?: number }[];
}

const SKIP_STATUS = new Set(['created', 'started', 'aborted', 'noStart', 'unknownFinish']);

/**
 * Converts a Lichess API game into our stored form, from `username`'s point of view.
 * Returns null for games we can't use (variants, custom start positions, aborted…).
 */
export function mapGame(g: LichessApiGame, username: string): LichessGame | null {
  if (!g || typeof g.id !== 'string' || !/^[A-Za-z0-9]{8,12}$/.test(g.id)) return null;
  if (g.variant && g.variant !== 'standard') return null;
  if (g.initialFen) return null;
  if (!g.moves || typeof g.moves !== 'string' || (g.status && SKIP_STATUS.has(g.status))) return null;
  const me = username.toLowerCase();
  const w = g.players?.white;
  const b = g.players?.black;
  const myColor = w?.user?.id === me ? 'w' : b?.user?.id === me ? 'b' : null;
  if (!myColor) return null;
  const mine = myColor === 'w' ? w : b;
  const opp = myColor === 'w' ? b : w;
  const opponent = opp?.user?.name ?? (opp?.aiLevel ? `Stockfish level ${opp.aiLevel}` : 'Anonymous');
  const myName = myColor === 'w' ? 'white' : 'black';
  const result: LichessGame['result'] = g.winner ? (g.winner === myName ? 'win' : 'loss') : g.status ? 'draw' : 'unknown';
  return {
    id: g.id,
    user: me,
    playedAt: typeof g.createdAt === 'number' ? g.createdAt : Date.now(),
    myColor,
    opponent: String(opponent).slice(0, 60),
    myRating: typeof mine?.rating === 'number' ? mine.rating : null,
    oppRating: typeof opp?.rating === 'number' ? opp.rating : null,
    result,
    speed: String(g.speed ?? ''),
    rated: g.rated !== false,
    eco: String(g.opening?.eco ?? '').slice(0, 4),
    openingName: String(g.opening?.name ?? '').slice(0, 120),
    moves: g.moves.trim(),
    evals: Array.isArray(g.analysis)
      ? g.analysis.map((a) => (a && (typeof a.eval === 'number' || typeof a.mate === 'number') ? { cp: a.eval, mate: a.mate } : null))
      : undefined,
    analyzedAt: null,
  };
}

export const ALL_SPEEDS: Speed[] = ['bullet', 'blitz', 'rapid', 'classical', 'correspondence'];
