/**
 * Lichess endgame tablebase (https://tablebase.lichess.ovh), ≤ 7 pieces.
 * Optional (Settings), used only during play-outs. One request at a time; after HTTP 429
 * we wait at least 60 s and fall back to Stockfish meanwhile. Offline → Stockfish.
 */
export const TABLEBASE = 'https://tablebase.lichess.ovh';
export const TB_MAX_PIECES = 7;

export type TbCategory =
  | 'win'
  | 'unknown'
  | 'syzygy-win'
  | 'maybe-win'
  | 'cursed-win'
  | 'draw'
  | 'blessed-loss'
  | 'maybe-loss'
  | 'syzygy-loss'
  | 'loss';

export interface TbMove {
  uci: string;
  san: string;
  /** From the point of view of the side to move AFTER this move. */
  category: TbCategory;
  dtm: number | null;
  dtz: number | null;
}

export interface TbResult {
  /** From the point of view of the side to move. */
  category: TbCategory;
  /** Depth to mate in plies (signed: positive = side to move wins), if known. */
  dtm: number | null;
  dtz: number | null;
  /** Sorted best-first for the side to move (for a losing side: the longest defence first). */
  moves: TbMove[];
}

let busy: Promise<unknown> = Promise.resolve();
let cooldownUntil = 0;

export function tablebaseAvailable(): boolean {
  return navigator.onLine && Date.now() >= cooldownUntil;
}

/** Probes one position. Returns null when unavailable (offline, rate-limited, error). */
export function probe(fen: string): Promise<TbResult | null> {
  const run = async (): Promise<TbResult | null> => {
    if (!tablebaseAvailable()) return null;
    try {
      const res = await fetch(`${TABLEBASE}/standard?fen=${encodeURIComponent(fen.trim().replace(/ /g, '_'))}`, {
        credentials: 'omit',
        referrerPolicy: 'no-referrer',
      });
      if (res.status === 429) {
        cooldownUntil = Date.now() + 60_000;
        return null;
      }
      if (!res.ok) return null;
      const d = await res.json();
      if (!d || typeof d.category !== 'string' || !Array.isArray(d.moves)) return null;
      return {
        category: d.category,
        dtm: typeof d.dtm === 'number' ? d.dtm : null,
        dtz: typeof d.dtz === 'number' ? d.dtz : null,
        moves: d.moves
          .filter((m: any) => m && typeof m.uci === 'string' && /^[a-h][1-8][a-h][1-8][qrbn]?$/.test(m.uci))
          .map((m: any) => ({ uci: m.uci, san: String(m.san ?? ''), category: m.category, dtm: typeof m.dtm === 'number' ? m.dtm : null, dtz: typeof m.dtz === 'number' ? m.dtz : null })),
      };
    } catch {
      return null;
    }
  };
  // Serialize: never more than one request in flight.
  const p = busy.then(run, run);
  busy = p.catch(() => null);
  return p;
}

const MATE = 10000;

/**
 * Score of a tablebase result from the side-to-move's point of view, in the app's
 * centipawn scale (mate in n moves = 10000 − n). Unknown distances use ±5000.
 */
export function tbScore(category: TbCategory, dtm: number | null): number {
  const moves = dtm === null ? null : Math.ceil(Math.abs(dtm) / 2);
  switch (category) {
    case 'win':
    case 'syzygy-win':
      return moves !== null ? MATE - moves : 5000;
    case 'loss':
    case 'syzygy-loss':
      return moves !== null ? -(MATE - moves) : -5000;
    case 'maybe-win':
      return 3000;
    case 'maybe-loss':
      return -3000;
    default:
      return 0; // draw, cursed-win, blessed-loss (drawn under the 50-move rule), unknown
  }
}
