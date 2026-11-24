import { isDue } from './scheduler';
import { buildLines, drillableMoves, type RepGraph } from './tree';
import type { CardState, Move, Repertoire } from './types';

export type PracticeMode = 'daily' | 'due' | 'mistakes' | 'cram' | 'subtree' | 'moves';

export interface PracticeOptions {
  mode: PracticeMode;
  side: 'w' | 'b' | 'both';
  /** Restrict to one repertoire. */
  repId?: string;
  /** Subtree mode: start position (normalized FEN). */
  fen?: string;
  /** 'moves' mode: explicit move ids. */
  moveIds?: string[];
  dailySize: number;
  mistakesSize?: number;
  now?: number;
}

export interface DrillLine {
  repId: string;
  side: 'w' | 'b';
  moves: Move[];
  /** Move ids in this line that are quizzed. */
  targets: string[];
}

interface Candidate {
  move: Move;
  card: CardState;
  rep: Repertoire;
  /** Breadth-first rank inside its repertoire (shallower = earlier). */
  depth: number;
}

/** Picks the moves to quiz, in priority order. */
export function selectTargets(
  reps: { rep: Repertoire; graph: RepGraph }[],
  cardFor: (m: Move) => CardState,
  opts: PracticeOptions,
): Candidate[] {
  const now = opts.now ?? Date.now();
  const pool: Candidate[] = [];
  for (const { rep, graph } of reps) {
    if (opts.side !== 'both' && rep.side !== opts.side) continue;
    if (opts.repId && rep.id !== opts.repId) continue;
    const start = opts.mode === 'subtree' && opts.fen ? opts.fen : graph.root;
    drillableMoves(graph, start).forEach((move, depth) => pool.push({ move, card: cardFor(move), rep, depth }));
  }

  const byDue = (a: Candidate, b: Candidate) => {
    // Cards already in review first (most overdue first), then new cards in tree order.
    const an = a.card.state === 0 ? 1 : 0;
    const bn = b.card.state === 0 ? 1 : 0;
    if (an !== bn) return an - bn;
    if (an) return a.depth - b.depth || a.move.createdAt - b.move.createdAt;
    return a.card.due - b.card.due;
  };

  switch (opts.mode) {
    case 'daily':
      return pool.filter((c) => isDue(c.card, now)).sort(byDue).slice(0, Math.max(1, opts.dailySize));
    case 'due':
      return pool.filter((c) => isDue(c.card, now)).sort(byDue);
    case 'mistakes': {
      const rate = (c: CardState) => c.wrong / Math.max(1, c.wrong + c.right);
      return pool
        .filter((c) => c.card.wrong > 0)
        .sort((a, b) => rate(b.card) - rate(a.card) || b.card.wrong - a.card.wrong)
        .slice(0, opts.mistakesSize ?? 20);
    }
    case 'moves': {
      const ids = new Set(opts.moveIds ?? []);
      return pool.filter((c) => ids.has(c.move.id));
    }
    case 'cram':
    case 'subtree':
    default:
      return pool.sort((a, b) => a.depth - b.depth);
  }
}

/** Turns targets into whole lines from the start position, grouped per repertoire. */
export function buildSession(
  reps: { rep: Repertoire; graph: RepGraph }[],
  cardFor: (m: Move) => CardState,
  opts: PracticeOptions,
): DrillLine[] {
  const targets = selectTargets(reps, cardFor, opts);
  const out: DrillLine[] = [];
  for (const { rep, graph } of reps) {
    const ids = targets.filter((t) => t.rep.id === rep.id).map((t) => t.move.id);
    if (!ids.length) continue;
    const set = new Set(ids);
    const used = new Set<string>();
    for (const line of buildLines(graph, ids, set)) {
      // A move shared by several lines (e.g. 1.e4) is only quizzed the first time.
      const lineTargets = line.filter((m) => set.has(m.id) && !used.has(m.id)).map((m) => m.id);
      lineTargets.forEach((id) => used.add(id));
      out.push({ repId: rep.id, side: rep.side, moves: line, targets: lineTargets });
    }
  }
  return out;
}

export function countTargets(lines: DrillLine[]): number {
  return lines.reduce((n, l) => n + l.targets.length, 0);
}
