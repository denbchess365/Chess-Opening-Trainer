import { describe, expect, it } from 'vitest';
import { normalizeFen, playMove, ROOT } from '../src/core/fen';
import {
  buildLines,
  completeness,
  drillableMoves,
  findGaps,
  pathTo,
  RepGraph,
  subtreeToDelete,
} from '../src/core/tree';
import { buildMoves, graph } from './helpers';

describe('normalizeFen', () => {
  it('drops move clocks', () => {
    expect(normalizeFen('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1')).toBe(
      'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq -',
    );
  });
  it('clears an en-passant square when no capture is possible', () => {
    const after = playMove(ROOT, 'e4')!.toFen;
    expect(after.endsWith(' -')).toBe(true);
  });
  it('keeps an en-passant square when the capture is legal', () => {
    let fen = ROOT;
    for (const san of ['e4', 'a6', 'e5', 'd5']) fen = playMove(fen, san)!.toFen;
    expect(fen.endsWith(' d6')).toBe(true);
  });
});

describe('transpositions', () => {
  it('merges different move orders into one position', () => {
    const g = graph('w', ['e4 e5 Nf3 Nc6 Bb5', 'Nf3 Nc6 e4 e5']);
    const viaA = pathTo(g, playMove(playMove(playMove(playMove(ROOT, 'e4')!.toFen, 'e5')!.toFen, 'Nf3')!.toFen, 'Nc6')!.toFen);
    expect(viaA).not.toBeNull();
    // Position after 1.Nf3 Nc6 2.e4 e5 is the same node, so Bb5 is reachable as its child.
    let fen = ROOT;
    for (const san of ['Nf3', 'Nc6', 'e4', 'e5']) fen = playMove(fen, san)!.toFen;
    expect(g.children(fen).map((m) => m.san)).toEqual(['Bb5']);
  });

  it('does not duplicate drillable cards for a transposed position', () => {
    const g = graph('w', ['e4 e5 Nf3 Nc6 Bb5', 'Nf3 Nc6 e4 e5']);
    // My moves: e4 (root primary), Nf3 (after e4 e5), Bb5. 'Nf3' at root is an alternative (e4 came first).
    const drill = drillableMoves(g).map((m) => m.san).sort();
    expect(drill).toEqual(['Bb5', 'Nf3', 'e4'].sort());
  });
});

describe('gaps and completeness', () => {
  it('reports opponent replies without an answer', () => {
    const g = graph('w', ['e4 e5 Nf3', 'e4 c5', 'e4 e6 d4']);
    const gaps = findGaps(g);
    expect(gaps.map((x) => x.path.map((m) => m.san).join(' '))).toEqual(['e4 c5']);
    const c = completeness(g);
    expect(c.prepared).toBe(3); // root, after e5, after e6
    expect(c.gaps).toBe(1);
    expect(c.ratio).toBeCloseTo(0.75);
  });

  it('treats an empty white repertoire as a gap at the start', () => {
    const g = new RepGraph('w', []);
    expect(findGaps(g)).toHaveLength(1);
    expect(completeness(g).ratio).toBe(0);
  });

  it('ignores lines behind my alternative moves', () => {
    // Black repertoire: vs e4 I play c5 (main) and e5 (alternative). Lines after e5 aren't active.
    const g = graph('b', ['e4 c5 Nf3 d6', 'e4 e5 Nf3']);
    expect(findGaps(g)).toHaveLength(0);
    expect(drillableMoves(g).map((m) => m.san).sort()).toEqual(['c5', 'd6']);
  });

  it('a black repertoire with no moves has no gaps (white moves first)', () => {
    expect(findGaps(new RepGraph('b', []))).toHaveLength(0);
  });
});

describe('subtreeToDelete', () => {
  it('removes the move and everything only reachable through it', () => {
    const moves = buildMoves('w', ['e4 e5 Nf3 Nc6 Bb5', 'e4 c5 Nf3 d6 d4']);
    const g = new RepGraph('w', moves);
    const c5 = moves.find((m) => m.san === 'c5')!;
    const del = subtreeToDelete(g, c5.id).map((id) => g.byId.get(id)!.san).sort();
    expect(del).toEqual(['Nf3', 'c5', 'd4', 'd6'].sort());
  });

  it('keeps positions still reachable by transposition', () => {
    const moves = buildMoves('w', ['e4 e5 Nf3 Nc6 Bb5', 'Nf3 Nc6 e4 e5']);
    const g = new RepGraph('w', moves);
    // Delete the 1.Nf3 move order: the shared position (and Bb5) must survive via 1.e4.
    const nf3 = moves.find((m) => m.san === 'Nf3' && m.fromFen === ROOT)!;
    const del = subtreeToDelete(g, nf3.id).map((id) => g.byId.get(id)!.san).sort();
    // 1.Nf3, 1...Nc6, 2.e4 and 2...e5 (in that move order) go; the merged position and Bb5 stay.
    expect(del).toEqual(['Nc6', 'Nf3', 'e4', 'e5'].sort());
    const kept = moves.filter((m) => !subtreeToDelete(g, nf3.id).includes(m.id)).map((m) => m.san);
    expect(kept).toEqual(['e4', 'e5', 'Nf3', 'Nc6', 'Bb5']);
  });
});

describe('buildLines', () => {
  it('covers every target, starting from the root, ending at the last target', () => {
    const moves = buildMoves('w', ['e4 e5 Nf3 Nc6 Bb5', 'e4 c5 Nf3 d6 d4', 'e4 e6 d4']);
    const g = new RepGraph('w', moves);
    const targets = drillableMoves(g).map((m) => m.id);
    const lines = buildLines(g, targets);
    const covered = new Set(lines.flat().map((m) => m.id));
    for (const t of targets) expect(covered.has(t)).toBe(true);
    for (const l of lines) {
      expect(l[0].fromFen).toBe(ROOT);
      expect(targets).toContain(l[l.length - 1].id);
    }
    // e4 is shared by all three lines but only needs quizzing once.
    expect(lines.length).toBe(3);
  });

  it('only quizzes the requested targets but plays the context before them', () => {
    const moves = buildMoves('w', ['e4 e5 Nf3 Nc6 Bb5 a6 Ba4']);
    const g = new RepGraph('w', moves);
    const bb5 = moves.find((m) => m.san === 'Bb5')!;
    const lines = buildLines(g, [bb5.id]);
    expect(lines).toHaveLength(1);
    expect(lines[0].map((m) => m.san)).toEqual(['e4', 'e5', 'Nf3', 'Nc6', 'Bb5']);
  });
});
