import { describe, expect, it } from 'vitest';
import { ROOT } from '../src/core/fen';
import { exportPgn, parsePgn } from '../src/core/pgn';
import { RepGraph } from '../src/core/tree';
import type { Move, Side } from '../src/core/types';
import { buildMoves } from './helpers';

/** Mimics the store's import: first move of mine seen at a position becomes primary. */
function importEdges(side: Side, text: string): Move[] {
  const { edges } = parsePgn(text);
  const out: Move[] = [];
  let n = 0;
  for (const e of edges) {
    const p = e.played;
    const existing = out.find((m) => m.fromFen === p.fromFen && m.uci === p.uci);
    if (existing) {
      if (e.comment) existing.comment = e.comment;
      continue;
    }
    const isMine = p.fromFen.split(' ')[1] === side;
    out.push({
      id: `i${++n}`,
      repertoireId: 'r',
      fromFen: p.fromFen,
      toFen: p.toFen,
      san: p.san,
      uci: p.uci,
      isMine,
      isPrimary: !isMine || !out.some((m) => m.fromFen === p.fromFen && m.isMine && m.isPrimary),
      comment: e.comment,
      createdAt: n,
    });
  }
  return out;
}

const key = (m: Move) => `${m.fromFen}|${m.uci}|${m.isPrimary}|${m.comment}`;

describe('parsePgn', () => {
  it('reads headers, move numbers, comments, NAGs and nested variations', () => {
    const pgn = `[Event "Test"]
[White "Me"]

1. e4 {King pawn} e5 (1... c5 2. Nf3 (2. c3 d5) d6 $1) (1... e6) 2. Nf3!? Nc6 3.Bb5 a6 *`;
    const r = parsePgn(pgn);
    expect(r.errors).toEqual([]);
    expect(r.games).toBe(1);
    expect(r.edges.map((e) => e.played.san)).toEqual(['e4', 'e5', 'c5', 'Nf3', 'c3', 'd5', 'd6', 'e6', 'Nf3', 'Nc6', 'Bb5', 'a6']);
    expect(r.edges[0].comment).toBe('King pawn');
    // c5 and e6 are alternatives to e5 from the same position
    expect(r.edges[2].played.fromFen).toBe(r.edges[1].played.fromFen);
    expect(r.edges[7].played.fromFen).toBe(r.edges[1].played.fromFen);
    // 2.c3 is an alternative to 2.Nf3 in the Sicilian
    expect(r.edges[4].played.fromFen).toBe(r.edges[3].played.fromFen);
  });

  it('handles multiple games and castling with zeros', () => {
    const pgn = `[Event "A"]\n\n1. e4 e5 2. Nf3 Nc6 3. Bc4 Bc5 4. 0-0 *\n\n[Event "B"]\n\n1. d4 d5 1-0`;
    const r = parsePgn(pgn);
    expect(r.games).toBe(2);
    expect(r.edges.map((e) => e.played.san)).toContain('O-O');
    expect(r.edges.at(-1)!.played.san).toBe('d5');
    expect(r.edges.at(-2)!.played.fromFen).toBe(ROOT);
  });

  it('reports illegal moves and skips the rest of that line only', () => {
    const r = parsePgn('1. e4 e5 (1... Qh4 2. Nf3) 2. Nf3 *');
    expect(r.errors.length).toBe(1);
    expect(r.edges.map((e) => e.played.san)).toEqual(['e4', 'e5', 'Nf3']);
  });

  it('skips games from custom positions', () => {
    const r = parsePgn('[FEN "8/8/8/8/8/8/4K3/4k3 w - - 0 1"]\n[SetUp "1"]\n\n1. Kd3 *');
    expect(r.edges).toHaveLength(0);
    expect(r.errors.length).toBe(1);
  });
});

describe('PGN round trip', () => {
  it('export then import reproduces the repertoire, including alternatives and comments', () => {
    const moves = buildMoves('w', [
      'e4 e5 Nf3 Nc6 Bb5 a6 Ba4',
      'e4 e5 Nf3 d6 d4',
      'e4 c5 Nf3 d6 d4',
      'e4 c5 Nf3 Nc6 d4',
      'd4 d5 c4', // alternative first move (e4 is primary)
      'e4 e6 d4 d5 Nc3',
    ]);
    moves.find((m) => m.san === 'Bb5')!.comment = 'Ruy {Lopez} main';
    const g = new RepGraph('w', moves);
    const pgn = exportPgn(g, 'My "White"');
    expect(pgn).toContain('[Event "My \'White\'"]');
    expect(pgn).toContain('{[alternative]}');
    const back = importEdges('w', pgn);
    const want = moves.map((m) => key({ ...m, comment: m.comment.replace(/[{}]/g, '') })).sort();
    const got = back.map((m) => key({ ...m, comment: m.comment.replace('[alternative]', '').trim() })).sort();
    expect(got).toEqual(want);
  });

  it('exports transpositions once', () => {
    const moves = buildMoves('w', ['e4 e5 Nf3 Nc6 Bb5', 'Nf3 Nc6 e4 e5']);
    const pgn = exportPgn(new RepGraph('w', moves), 'T');
    expect(pgn.match(/Bb5/g)).toHaveLength(1);
    expect(pgn).toContain('{transposes}');
    const back = importEdges('w', pgn);
    expect(back.map((m) => m.uci + m.fromFen).sort()).toEqual(moves.map((m) => m.uci + m.fromFen).sort());
  });

  it('exports an empty repertoire as a valid empty game', () => {
    const pgn = exportPgn(new RepGraph('b', []), 'Empty');
    expect(parsePgn(pgn)).toMatchObject({ games: 1, edges: [], errors: [] });
  });
});
