import { describe, expect, it } from 'vitest';
import { Chess } from 'chess.js';
import { fiftyMoveCount, gradeRun, isThreefold, mateIn, MATE, moveFeedback, outcome, playoutToLine, replayFull, winThrownAway } from '../src/core/playout';
import { normalizeFen } from '../src/core/fen';
import { buildLines, RepGraph } from '../src/core/tree';
import type { Move } from '../src/core/types';

describe('outcome detection', () => {
  it('checkmate: success when I mate, fail when I am mated', () => {
    const mated = '7k/6Q1/6K1/8/8/8/8/8 b - - 0 1';
    expect(outcome(mated, 'win', 'w')).toMatchObject({ over: true, success: true, reason: 'Checkmate!' });
    expect(outcome(mated, 'draw', 'b')).toMatchObject({ over: true, success: false, result: 'loss' });
  });

  it('stalemate fails a win goal and holds a draw goal', () => {
    const st = '7k/5Q2/6K1/8/8/8/8/8 b - - 0 1';
    expect(outcome(st, 'win', 'w')).toMatchObject({ over: true, success: false, reason: 'Stalemate!' });
    expect(outcome(st, 'draw', 'b')).toMatchObject({ over: true, success: true, result: 'draw' });
  });

  it('50-move rule', () => {
    const f = '8/8/8/4k3/8/8/8/3BNK2 w - - 100 80';
    expect(outcome(f, 'win', 'w')).toMatchObject({ over: true, success: false, reason: '50-move rule — draw' });
    expect(outcome(f, 'draw', 'b').success).toBe(true);
    expect(outcome('8/8/8/4k3/8/8/8/3BNK2 w - - 99 80', 'win', 'w').over).toBe(false);
    expect(fiftyMoveCount('8/8/8/4k3/8/8/8/3BNK2 w - - 37 80')).toBe(18);
  });

  it('insufficient material (e.g. the bishop was lost)', () => {
    expect(outcome('8/8/8/4k3/8/8/8/4NK2 w - - 0 1', 'win', 'w')).toMatchObject({ over: true, success: false, reason: /Insufficient/ });
  });

  it('threefold repetition over the game history', () => {
    const start = '8/8/8/4k3/8/8/8/3BNK2 w - - 0 1';
    const moves = ['f1f2', 'e5e4', 'f2f1', 'e4e5', 'f1f2', 'e5e4', 'f2f1', 'e4e5'];
    const fens = [start, ...replayFull(start, moves)];
    expect(isThreefold(fens.at(-1)!, fens.slice(0, -1))).toBe(true);
    expect(outcome(fens.at(-1)!, 'win', 'w', fens.slice(0, -1))).toMatchObject({ over: true, success: false, reason: /Threefold/ });
    expect(isThreefold(fens[4], fens.slice(0, 4))).toBe(false);
  });

  it('ongoing positions are not over', () => {
    expect(outcome('8/8/8/4k3/8/8/8/3BNK2 w - - 0 1', 'win', 'w').over).toBe(false);
  });
});

describe('move feedback', () => {
  it('flags a slower mate and a thrown-away win, praises the best move', () => {
    expect(mateIn(MATE - 12)).toBe(12);
    expect(moveFeedback('win', MATE - 12, MATE - 11)!.level).toBe('good');
    expect(moveFeedback('win', MATE - 12, MATE - 12)!.level).toBe('good');
    expect(moveFeedback('win', MATE - 12, MATE - 15)).toMatchObject({ level: 'slower', text: 'Slower: mate in 12 → mate in 15.' });
    expect(moveFeedback('win', MATE - 12, 0)!.level).toBe('lost');
    expect(moveFeedback('win', MATE - 1, MATE)!.level).toBe('good'); // delivering mate
    expect(winThrownAway(MATE - 12, 50)).toBe(true);
    expect(winThrownAway(MATE - 12, MATE - 20)).toBe(false);
  });
  it('warns when a draw becomes lost', () => {
    expect(moveFeedback('draw', 0, -500)!.level).toBe('lost');
    expect(moveFeedback('draw', 0, -20)).toBeNull();
  });
});

describe('Mode A grading', () => {
  it.each([
    [{ success: false, hintsUsed: 0, movesTaken: 10 }, 'again'],
    [{ success: true, hintsUsed: 1, movesTaken: 10 }, 'hard'],
    [{ success: true, hintsUsed: 0, movesTaken: 40, engineDtm: 20 }, 'hard'],
    [{ success: true, hintsUsed: 0, movesTaken: 25, engineDtm: 20 }, 'good'],
    [{ success: true, hintsUsed: 0, movesTaken: 6, engineDtm: 2 }, 'hard'],
    [{ success: true, hintsUsed: 0, movesTaken: 5, engineDtm: 2 }, 'good'],
    [{ success: true, hintsUsed: 0, movesTaken: 60 }, 'good'],
  ])('%o → %s', (input, grade) => {
    expect(gradeRun(input)).toBe(grade);
  });
});

describe('play-out → line', () => {
  it('converts the moves into a line from the custom start that the tree can drill', () => {
    const start = '8/8/8/4k3/8/8/8/3BNK2 w - - 0 1';
    const line = playoutToLine(start, ['f1e2', 'e5d4', 'e2d2']);
    expect(line.map((m) => m.san)).toEqual(['Ke2', 'Kd4', 'Kd2']);
    expect(line[0].fromFen).toBe(normalizeFen(start));
    const moves: Move[] = line.map((p, i) => ({
      id: `m${i}`, repertoireId: 'r', fromFen: p.fromFen, toFen: p.toFen, san: p.san, uci: p.uci,
      isMine: i % 2 === 0, isPrimary: true, comment: '', createdAt: i,
    }));
    const g = new RepGraph('w', moves, normalizeFen(start));
    const lines = buildLines(g, ['m0', 'm2']);
    expect(lines).toHaveLength(1);
    expect(lines[0].map((m) => m.san)).toEqual(['Ke2', 'Kd4', 'Kd2']);
  });

  it('stops at an illegal move', () => {
    expect(playoutToLine(new Chess().fen(), ['e2e4', 'e2e4']).length).toBe(1);
  });
});

describe('tablebase eligibility', () => {
  it('uses the tablebase only with ≤ 7 pieces and no castling rights', async () => {
    const { tablebaseApplies } = await import('../src/net/tablebase');
    expect(tablebaseApplies('8/8/8/4k3/8/8/8/3BNK2 w - - 0 1')).toBe(true);
    expect(tablebaseApplies('r3k3/8/8/8/8/8/8/4K2R w K - 0 1')).toBe(false); // White may still castle
    expect(tablebaseApplies('r3k3/8/8/8/8/8/8/4K2R w - - 0 1')).toBe(true); // king moved and came back: no rights
    expect(tablebaseApplies('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w - - 0 1')).toBe(false); // too many pieces
  });
});
