import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { gamesUrl, mapGame } from '../src/core/lichess';
import { readNdjson } from '../src/core/ndjson';
import { DEFAULT_LICHESS } from '../src/core/types';

const sample = readFileSync(new URL('./fixtures/lichess-games.ndjson', import.meta.url));

/** A stream that delivers `bytes` in the given chunk sizes (to split lines and characters). */
function streamOf(bytes: Uint8Array, chunk: number) {
  let i = 0;
  return new ReadableStream<Uint8Array>({
    pull(c) {
      if (i >= bytes.length) return c.close();
      c.enqueue(bytes.slice(i, i + chunk));
      i += chunk;
    },
  });
}
async function collect<T>(it: AsyncGenerator<T>) {
  const out: T[] = [];
  for await (const x of it) out.push(x);
  return out;
}

describe('ndjson streaming', () => {
  it.each([1, 7, 64, 100000])('parses the real Lichess sample in %i-byte chunks', async (chunk) => {
    const games = await collect(readNdjson<any>(streamOf(new Uint8Array(sample), chunk)));
    expect(games.map((g) => g.id)).toEqual(['HqjDTU4A', 'iVshKPMF', 'J3C5rR4Z']);
  });

  it('handles CRLF, blank keep-alive lines, a missing final newline and multi-byte characters split across chunks', async () => {
    const text = '{"a":"é😀"}\r\n\n\n{"b":2}\r\n{"c":3}';
    const out = await collect(readNdjson(streamOf(new TextEncoder().encode(text), 1)));
    expect(out).toEqual([{ a: 'é😀' }, { b: 2 }, { c: 3 }]);
  });

  it('skips and reports invalid lines without stopping', async () => {
    const bad: string[] = [];
    const out = await collect(readNdjson(streamOf(new TextEncoder().encode('{"a":1}\n{oops\n{"b":2}\n'), 5), (l) => bad.push(l)));
    expect(out).toEqual([{ a: 1 }, { b: 2 }]);
    expect(bad).toEqual(['{oops']);
  });
});

describe('Lichess mapping', () => {
  const raw = sample.toString().trim().split('\n').map((l) => JSON.parse(l));

  it('maps games from my point of view', () => {
    const [g1, g2] = raw.map((g) => mapGame(g, 'DrNykterstein')!);
    expect(g1).toMatchObject({ id: 'HqjDTU4A', myColor: 'w', result: 'win', opponent: 'Opponent1', speed: 'blitz', eco: expect.any(String) });
    expect(g2.myColor).toBe('b');
    expect(g1.evals!.length).toBe(g1.moves.split(' ').length);
    expect(g1.user).toBe('drnykterstein');
  });

  it('skips games that are not mine, variants, custom starts and aborted games', () => {
    expect(mapGame(raw[0], 'someoneelse')).toBeNull();
    expect(mapGame({ ...raw[0], variant: 'chess960' }, 'DrNykterstein')).toBeNull();
    expect(mapGame({ ...raw[0], initialFen: '8/8/8/8/8/8/8/8 w - - 0 1' }, 'DrNykterstein')).toBeNull();
    expect(mapGame({ ...raw[0], status: 'aborted' }, 'DrNykterstein')).toBeNull();
    expect(mapGame({ ...raw[0], id: '../../x' }, 'DrNykterstein')).toBeNull();
  });

  it('draws and losses', () => {
    expect(mapGame({ ...raw[0], winner: undefined, status: 'draw' }, 'DrNykterstein')!.result).toBe('draw');
    expect(mapGame({ ...raw[0], winner: 'black' }, 'DrNykterstein')!.result).toBe('loss');
  });

  it('builds the request with the user’s options', () => {
    const u = new URL(gamesUrl({ ...DEFAULT_LICHESS, username: 'Some_User', maxGames: 500 }, 1700000000000));
    expect(u.origin + u.pathname).toBe('https://lichess.org/api/games/user/Some_User');
    expect(Object.fromEntries(u.searchParams)).toEqual({
      max: '200',
      perfType: 'blitz,rapid,classical',
      rated: 'true',
      since: '1700000000000',
      opening: 'true',
      evals: 'true',
      clocks: 'false',
    });
    expect(() => gamesUrl({ ...DEFAULT_LICHESS, username: '../evil' })).toThrow();
  });
});
