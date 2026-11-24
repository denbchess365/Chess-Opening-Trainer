import { gamesUrl, mapGame, validUsername, type LichessApiGame } from '../core/lichess';
import { readNdjson } from '../core/ndjson';
import type { LichessGame, LichessSettings } from '../core/types';

export type LichessErrorKind = 'offline' | 'rate' | 'notfound' | 'blocked' | 'other';

export class LichessError extends Error {
  constructor(
    public kind: LichessErrorKind,
    message: string,
    public retryAt?: number,
  ) {
    super(message);
    this.name = 'LichessError';
  }
}

/** Lichess asks clients to wait at least a minute after HTTP 429. */
export const RATE_LIMIT_WAIT_MS = 60_000;

let inFlight = false;

/**
 * Streams the user's games from Lichess (one request at a time). Each usable game
 * is passed to `onGame` as soon as its line arrives.
 * Browsers don't let pages set User-Agent, and a custom header would force a CORS
 * preflight, so only the standard Accept header is sent.
 */
export async function fetchGames(
  s: LichessSettings,
  since: number | undefined,
  onGame: (g: LichessGame) => void | Promise<void>,
  signal?: AbortSignal,
): Promise<{ received: number; usable: number }> {
  if (!validUsername(s.username)) throw new LichessError('notfound', 'Enter a valid Lichess username in Settings.');
  if (inFlight) throw new LichessError('other', 'A sync is already running.');
  inFlight = true;
  try {
    let res: Response;
    try {
      res = await fetch(gamesUrl(s, since), {
        headers: { Accept: 'application/x-ndjson' },
        credentials: 'omit',
        cache: 'no-store',
        referrerPolicy: 'no-referrer',
        signal,
      });
    } catch (e) {
      if ((e as Error).name === 'AbortError') throw e;
      throw new LichessError('offline', 'Couldn’t reach Lichess — check your connection and try again.');
    }
    if (res.status === 429) {
      const ra = Number(res.headers.get('retry-after')) * 1000 || 0;
      throw new LichessError('rate', 'Lichess asked us to slow down. Try again in a minute.', Date.now() + Math.max(RATE_LIMIT_WAIT_MS, ra));
    }
    if (res.status === 404) throw new LichessError('notfound', `Lichess user “${s.username}” wasn’t found.`);
    if (!res.ok || !res.body) throw new LichessError('other', `Lichess returned an error (${res.status}).`);
    let received = 0;
    let usable = 0;
    for await (const raw of readNdjson<LichessApiGame>(res.body)) {
      received++;
      const g = mapGame(raw, s.username);
      if (g) {
        usable++;
        await onGame(g);
      }
    }
    return { received, usable };
  } finally {
    inFlight = false;
  }
}

/** Quick connectivity/CORS check used by the "Test Lichess connection" button. */
export async function testLichess(username: string): Promise<string> {
  let n = 0;
  await fetchGames(
    { username, speeds: [], ratedOnly: false, maxGames: 1, autoSync: false, engineCheck: false, engineDepth: 0 },
    undefined,
    () => void n++,
  );
  return n ? `Connected to Lichess ✓ — found games for ${username}.` : `Connected to Lichess ✓ — no standard games found for ${username} yet.`;
}
