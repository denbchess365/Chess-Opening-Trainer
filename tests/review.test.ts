import { describe, expect, it } from 'vitest';
import { analyzeGame, compareGame, lichessEval, lossCp, mergeFinding, performance, severityOf } from '../src/core/review';
import { RepGraph } from '../src/core/tree';
import type { LichessGame } from '../src/core/types';
import { buildMoves } from './helpers';

const white = new RepGraph('w', buildMoves('w', ['e4 e5 Nf3 Nc6 Bb5', 'e4 c5 Nf3 d6 d4', 'e4 e6 d4 d5', 'd4 d5 c4'], 'w1'));
const black = new RepGraph('b', buildMoves('b', ['e4 c5 Nf3 d6', 'e4 c5 Nc3 Nc6', 'd4 Nf6 c4 e6'], 'b1'));
const sans = (s: string) => s.split(' ');

function game(moves: string, myColor: 'w' | 'b', extra: Partial<LichessGame> = {}): LichessGame {
  return { id: 'Game0001', playedAt: 1, myColor, opponent: 'x', myRating: 1500, oppRating: 1500, result: 'win', speed: 'blitz', rated: true, eco: '', openingName: '', moves, analyzedAt: null, ...extra };
}

describe('compareGame', () => {
  it('followed: the game stays in book until my line runs out', () => {
    const c = compareGame(sans('e4 e5 Nf3 Nc6 Bb5 a6 Ba4'), 'w', white);
    expect(c).toMatchObject({ type: 'followed', ply: 5 });
  });

  it('followed: the game ends while still in book', () => {
    expect(compareGame(sans('e4 e5 Nf3'), 'w', white)).toMatchObject({ type: 'followed', ply: 3 });
  });

  it('deviation: I played something other than my main move', () => {
    const c = compareGame(sans('e4 e5 Bc4 Nf6'), 'w', white);
    expect(c).toMatchObject({ type: 'deviation', ply: 2, playedSan: 'Bc4', expectedSan: 'Nf3', playedUci: 'f1c4' });
  });

  it('a saved alternative is not a deviation (1.d4 is my alternative to 1.e4)', () => {
    expect(compareGame(sans('d4 d5 c4 e6'), 'w', white)).toMatchObject({ type: 'followed', ply: 3 });
  });

  it('gap: the opponent played a reply I have not prepared', () => {
    const c = compareGame(sans('e4 d5 exd5'), 'w', white);
    expect(c).toMatchObject({ type: 'gap', ply: 1, playedSan: 'd5' });
    expect(c.expectedSan).toBeUndefined();
  });

  it('outOfBook: my move in a position the repertoire has no answer for', () => {
    // Black repertoire: after 1.d4 Nf6 2.Nf3 (opponent move, also not covered) → gap, but after 1.d4 Nf6 2.c4 e6 3.Nc3 it's the end of my line.
    expect(compareGame(sans('d4 Nf6 Nf3 e6'), 'b', black)).toMatchObject({ type: 'gap', ply: 2, playedSan: 'Nf3' });
    // White repertoire with nothing for the start would be outOfBook at ply 0:
    expect(compareGame(sans('e4 e5'), 'w', new RepGraph('w', []))).toMatchObject({ type: 'outOfBook', ply: 0, playedSan: 'e4' });
    // A position reached through a saved opponent move but with no answer yet:
    const g = new RepGraph('w', buildMoves('w', ['e4 e5 Nf3', 'e4 c6'], 'w1'));
    expect(compareGame(sans('e4 c6 d4 d5'), 'w', g)).toMatchObject({ type: 'outOfBook', ply: 2, playedSan: 'd4' });
  });

  it('handles transpositions through normalized FEN', () => {
    // Repertoire has 1.e4 e5 2.Nf3 Nc6 3.Bb5. The game reaches the same position via 1.Nf3 Nc6 2.e4 e5.
    // 1.Nf3 is not in the repertoire, so that would be a deviation; give the repertoire that move order too:
    const g = new RepGraph('w', buildMoves('w', ['e4 e5 Nf3 Nc6 Bb5', 'Nf3 Nc6 e4 e5'], 'w1'));
    expect(compareGame(sans('Nf3 Nc6 e4 e5 Bb5 a6'), 'w', g)).toMatchObject({ type: 'followed', ply: 5 });
    expect(compareGame(sans('Nf3 Nc6 e4 e5 Bc4'), 'w', g)).toMatchObject({ type: 'deviation', ply: 4, expectedSan: 'Bb5' });
  });

  it('an empty black repertoire is a gap at the first move, not a success', () => {
    expect(compareGame(sans('e4 e5'), 'b', new RepGraph('b', []))).toMatchObject({ type: 'gap', ply: 0, playedSan: 'e4' });
  });

  it('black repertoire: deviation and gap', () => {
    expect(compareGame(sans('e4 e5'), 'b', black)).toMatchObject({ type: 'deviation', ply: 1, expectedSan: 'c5' });
    expect(compareGame(sans('e4 c5 c3'), 'b', black)).toMatchObject({ type: 'gap', ply: 2, playedSan: 'c3' });
    expect(compareGame(sans('c4 e5'), 'b', black)).toMatchObject({ type: 'gap', ply: 0, playedSan: 'c4' });
  });
});

describe('analyzeGame', () => {
  it('uses the repertoire for my colour that follows the game longest', () => {
    const reps = [
      { id: 'w1', side: 'w' as const, graph: white },
      { id: 'w2', side: 'w' as const, graph: new RepGraph('w', buildMoves('w', ['e4 d5 exd5 Qxd5 Nc3'], 'w2')) },
      { id: 'b1', side: 'b' as const, graph: black },
    ];
    const f = analyzeGame(game('e4 d5 exd5 Qxd5 Nc3 Qa5 d4', 'w'), reps)!;
    expect(f).toMatchObject({ repertoireId: 'w2', type: 'followed', status: 'new', gameId: 'Game0001' });
    expect(analyzeGame(game('e4 e5', 'b'), reps)!.repertoireId).toBe('b1');
    expect(analyzeGame(game('e4', 'b'), [reps[0]])).toBeNull();
  });

  it('keeps my decision when the same finding is produced again', () => {
    const reps = [{ id: 'w1', side: 'w' as const, graph: white }];
    const a = { ...analyzeGame(game('e4 e5 Bc4', 'w'), reps)!, status: 'dismissed' as const };
    const b = analyzeGame(game('e4 e5 Bc4', 'w'), reps)!;
    expect(mergeFinding(a, b).status).toBe('dismissed');
    const changed = analyzeGame(game('e4 e5 Nf3 Nc6 Bc4', 'w'), reps)!;
    expect(mergeFinding(a, changed).status).toBe('new');
  });
});

describe('evaluations', () => {
  it('reads Lichess evals from my point of view', () => {
    const g = game('e4 e5 Bc4', 'b', { evals: [{ cp: 20 }, { cp: 30 }, { cp: 250 }] });
    expect(lichessEval(g, 2)).toEqual({ evalBest: -30, evalPlayed: -250 });
    expect(lichessEval(g, 0)).toBeNull(); // no eval of the starting position
    expect(lichessEval(game('e4', 'w'), 0)).toBeNull();
  });

  it('maps mate scores and grades losses', () => {
    const g = game('e4 e5', 'w', { evals: [{ cp: 0 }, { mate: -3 }] });
    const e = lichessEval(g, 1)!;
    expect(e.evalPlayed).toBeLessThan(-9000);
    expect(severityOf(lossCp(e.evalBest, e.evalPlayed))).toBe('blunder');
    expect(severityOf(40)).toBe('ok');
    expect(severityOf(60)).toBe('inaccuracy');
    expect(severityOf(150)).toBe('mistake');
    expect(severityOf(201)).toBe('blunder');
  });
});

describe('performance by opening', () => {
  it('sorts weakest first', () => {
    const gs = [
      game('e4', 'w', { id: 'a0000001', eco: 'B20', openingName: 'Sicilian', result: 'loss' }),
      game('e4', 'w', { id: 'a0000002', eco: 'B20', openingName: 'Sicilian', result: 'draw' }),
      game('e4', 'w', { id: 'a0000003', eco: 'C60', openingName: 'Ruy Lopez', result: 'win' }),
    ];
    const p = performance(gs, (g) => ({ key: g.eco, label: g.openingName }));
    expect(p.map((x) => [x.label, x.games, x.score])).toEqual([
      ['Sicilian', 2, 0.25],
      ['Ruy Lopez', 1, 1],
    ]);
  });
});
