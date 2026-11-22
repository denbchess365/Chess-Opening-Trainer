import { describe, expect, it } from 'vitest';
import { buildSession, countTargets, selectTargets } from '../src/core/practice';
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
