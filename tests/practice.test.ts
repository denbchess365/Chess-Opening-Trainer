import { describe, expect, it } from 'vitest';
import { buildSession, countTargets, planDaily, selectTargets } from '../src/core/practice';
import { playMove } from '../src/core/fen';
import { newCard, review } from '../src/core/scheduler';
import { RepGraph } from '../src/core/tree';
import type { CardState, Move, Repertoire } from '../src/core/types';
import { buildMoves } from './helpers';

const T0 = Date.UTC(2026, 0, 1);
const white: Repertoire = { id: 'w1', name: 'White', side: 'w', createdAt: 0 };
const black: Repertoire = { id: 'b1', name: 'Black', side: 'b', createdAt: 0 };

function setup() {
  const wm = buildMoves('w', ['e4 e5 Nf3 Nc6 Bb5', 'e4 c5 Nf3 d6 d4'], 'w1');
  const bm = buildMoves('b', ['e4 c5 Nf3 d6', 'd4 Nf6 c4 e6'], 'b1');
  const reps = [
    { rep: white, graph: new RepGraph('w', wm) },
    { rep: black, graph: new RepGraph('b', bm) },
  ];
  const cards = new Map<string, CardState>();
  const cardFor = (m: Move) => cards.get(m.id) ?? newCard(m.id, m.repertoireId, T0);
  return { reps, cards, cardFor, wm, bm };
}

describe('practice session', () => {
  it('daily practice caps the number of moves', () => {
    const { reps, cardFor } = setup();
    const t = selectTargets(reps, cardFor, { mode: 'daily', side: 'both', dailySize: 3, now: T0 });
    expect(t).toHaveLength(3);
  });

  it('quizzes a move shared by several lines only once', () => {
    const { reps, cardFor } = setup();
    const lines = buildSession(reps, cardFor, { mode: 'cram', side: 'w', dailySize: 99, now: T0 });
    expect(lines.length).toBe(2);
    expect(countTargets(lines)).toBe(5); // e4, Nf3, Bb5, Nf3 (vs c5), d4
    const all = lines.flatMap((l) => l.targets);
    expect(new Set(all).size).toBe(all.length);
  });

  it('side filter restricts repertoires', () => {
    const { reps, cardFor } = setup();
    const lines = buildSession(reps, cardFor, { mode: 'due', side: 'b', dailySize: 99, now: T0 });
    expect(lines.every((l) => l.repId === 'b1')).toBe(true);
    expect(countTargets(lines)).toBe(4); // c5, d6, Nf6, e6
  });

  it('cards not yet due are skipped by due modes but included in cram', () => {
    const { reps, cards, cardFor, wm } = setup();
    const e4 = wm.find((m) => m.san === 'e4')!;
    let c = review(newCard(e4.id, 'w1', T0), 'good', T0, { fuzz: false });
    c = review(c, 'good', c.due, { fuzz: false });
    cards.set(e4.id, c);
    const due = selectTargets(reps, cardFor, { mode: 'due', side: 'w', dailySize: 99, now: T0 + 1000 });
    expect(due.map((x) => x.move.san)).not.toContain('e4');
    const cram = selectTargets(reps, cardFor, { mode: 'cram', side: 'w', dailySize: 99, now: T0 + 1000 });
    expect(cram.map((x) => x.move.san)).toContain('e4');
  });

  it('mistakes mode orders by error rate', () => {
    const { reps, cards, cardFor, bm } = setup();
    const c5 = bm.find((m) => m.san === 'c5')!;
    const nf6 = bm.find((m) => m.san === 'Nf6')!;
    cards.set(c5.id, { ...newCard(c5.id, 'b1', T0), wrong: 1, right: 3 });
    cards.set(nf6.id, { ...newCard(nf6.id, 'b1', T0), wrong: 3, right: 1 });
    const t = selectTargets(reps, cardFor, { mode: 'mistakes', side: 'both', dailySize: 10, now: T0 });
    expect(t.map((x) => x.move.san)).toEqual(['Nf6', 'c5']);
  });

  it('subtree mode only quizzes moves below the chosen position, inside full lines', () => {
    const { reps, cardFor, wm } = setup();
    const c5 = wm.find((m) => m.san === 'c5')!;
    const lines = buildSession(reps, cardFor, { mode: 'subtree', side: 'both', repId: 'w1', fen: c5.toFen, dailySize: 10 });
    expect(lines).toHaveLength(1);
    expect(lines[0].moves.map((m) => m.san)).toEqual(['e4', 'c5', 'Nf3', 'd6', 'd4']);
    expect(lines[0].targets.map((id) => wm.find((m) => m.id === id)!.san)).toEqual(['Nf3', 'd4']);
  });
});

describe('daily mix with positions', () => {
  const T = Date.UTC(2026, 5, 1);
  const kbnRoot = '8/8/8/4k3/8/8/8/3BNK2 w - -';
  function posRep() {
    // A position line set: 1.Ke2 Kd4 2.Kd2 from the KBN start (my side White).
    const moves = [
      { san: 'Ke2', uci: 'f1e2' },
      { san: 'Kd4', uci: 'e5d4' },
      { san: 'Kd2', uci: 'e2d2' },
    ];
    let fen = kbnRoot;
    const out: Move[] = moves.map((m, i) => {
      const from = fen;
      const p = playMove(from, m.uci.length ? { from: m.uci.slice(0, 2), to: m.uci.slice(2, 4) } : m.san)!;
      fen = p.toFen;
      return { id: `pm${i}`, repertoireId: 'pr', fromFen: from, toFen: p.toFen, san: p.san, uci: p.uci, isMine: i % 2 === 0, isPrimary: true, comment: '', createdAt: i };
    });
    return { rep: { id: 'pr', name: 'KBN', side: 'w' as const, createdAt: 0, kind: 'position' as const, startFen: kbnRoot }, graph: new RepGraph('w', out, kbnRoot) };
  }
  const playouts = (n: number) =>
    Array.from({ length: n }, (_, i) => ({ positionId: `p${i}`, side: 'w' as const, card: newCard(`pos:p${i}`, 'positions', T - 1000 + i) }));

  it('splits the daily size by the ratio', () => {
    const { reps, cardFor } = setup();
    const plan = planDaily(reps, [posRep()], cardFor, playouts(5), { dailySize: 10, includePositions: true, ratio: 0.2, side: 'both', now: T });
    // 9 opening moves are due in total; 8 slots for openings, 2 for positions.
    expect(plan.openingMoves).toBe(8);
    expect(plan.positionItems).toBe(2);
  });

  it('fills from the other side when one runs short', () => {
    const { reps, cardFor } = setup();
    const many = planDaily(reps, [posRep()], cardFor, playouts(10), { dailySize: 15, includePositions: true, ratio: 0.2, side: 'both', now: T });
    expect(many.openingMoves).toBe(9); // all 9 due opening moves
    expect(many.positionItems).toBe(6); // 3 + the 3 openings couldn't fill
    const fewPos = planDaily(reps, [], cardFor, [], { dailySize: 10, includePositions: true, ratio: 0.5, side: 'both', now: T });
    expect(fewPos.openingMoves).toBe(9);
    expect(fewPos.playouts).toEqual([]);
  });

  it('can exclude positions', () => {
    const { reps, cardFor } = setup();
    const plan = planDaily(reps, [posRep()], cardFor, playouts(5), { dailySize: 10, includePositions: false, ratio: 0.5, side: 'both', now: T });
    expect(plan.positionItems).toBe(0);
    expect(plan.lines.every((l) => l.repId !== 'pr')).toBe(true);
  });

  it('position lines start from their custom FEN', () => {
    const plan = planDaily([], [posRep()], (m) => newCard(m.id, m.repertoireId, T - 1), [], { dailySize: 10, includePositions: true, ratio: 1, side: 'both', now: T });
    expect(plan.lines).toHaveLength(1);
    expect(plan.lines[0].moves[0].fromFen).toBe(kbnRoot);
    expect(plan.lines[0].moves.map((m) => m.san)).toEqual(['Ke2', 'Kd4', 'Kd2']);
  });
});
