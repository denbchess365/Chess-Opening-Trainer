import { ROOT, turnOf } from './fen';
import type { Move, Side } from './types';

/**
 * In-memory view of one repertoire: a directed graph whose nodes are normalized
 * FENs and whose edges are moves. Transpositions merge automatically because two
 * move orders that reach the same position share the same FEN key.
 */
export class RepGraph {
  readonly side: Side;
  /** Normalized FEN the tree starts from (the standard start position for openings). */
  readonly root: string;
  readonly byFrom = new Map<string, Move[]>();
  readonly byId = new Map<string, Move>();

  constructor(side: Side, moves: Iterable<Move>, root: string = ROOT) {
    this.side = side;
    this.root = root;
    for (const m of moves) this.add(m);
    for (const list of this.byFrom.values()) list.sort(moveOrder);
  }

  private add(m: Move) {
    this.byId.set(m.id, m);
    const list = this.byFrom.get(m.fromFen);
    if (list) list.push(m);
    else this.byFrom.set(m.fromFen, [m]);
  }

  get size() {
    return this.byId.size;
  }

  children(fen: string): Move[] {
    return this.byFrom.get(fen) ?? [];
  }

  /** My drilled move at a position (if it's my turn there). */
  primary(fen: string): Move | undefined {
    return this.children(fen).find((m) => m.isMine && m.isPrimary);
  }

  findByUci(fen: string, uci: string): Move | undefined {
    return this.children(fen).find((m) => m.uci === uci);
  }

  isMyTurn(fen: string): boolean {
    return turnOf(fen) === this.side;
  }

  /** Children that belong to the "active" repertoire: my primary move, or every opponent reply. */
  activeChildren(fen: string): Move[] {
    if (this.isMyTurn(fen)) {
      const p = this.primary(fen);
      return p ? [p] : [];
    }
    return this.children(fen).filter((m) => !m.isMine);
  }
}

function moveOrder(a: Move, b: Move): number {
  const rank = (m: Move) => (m.isMine ? (m.isPrimary ? 0 : 1) : 0);
  return rank(a) - rank(b) || a.createdAt - b.createdAt;
}

/**
 * Breadth-first walk over the active repertoire (my primary moves + all
 * opponent replies). Returns, for each reached position, the move used to
 * reach it first (giving shortest paths).
 */
export function activeBfs(g: RepGraph, start = g.root): Map<string, Move | null> {
  const parent = new Map<string, Move | null>([[start, null]]);
  const queue = [start];
  while (queue.length) {
    const fen = queue.shift()!;
    for (const m of g.activeChildren(fen)) {
      if (!parent.has(m.toFen)) {
        parent.set(m.toFen, m);
        queue.push(m.toFen);
      }
    }
  }
  return parent;
}

/** Same as activeBfs but over every saved move (alternatives included). */
export function fullBfs(g: RepGraph, start = g.root): Map<string, Move | null> {
  const parent = new Map<string, Move | null>([[start, null]]);
  const queue = [start];
  while (queue.length) {
    const fen = queue.shift()!;
    for (const m of g.children(fen)) {
      if (!parent.has(m.toFen)) {
        parent.set(m.toFen, m);
        queue.push(m.toFen);
      }
    }
  }
  return parent;
}

export function pathFromParents(parents: Map<string, Move | null>, fen: string): Move[] | null {
  if (!parents.has(fen)) return null;
  const path: Move[] = [];
  let cur = parents.get(fen);
  let guard = 0;
  while (cur && guard++ < 10000) {
    path.push(cur);
    cur = parents.get(cur.fromFen) ?? null;
  }
  return path.reverse();
}

/** Shortest path of moves from the root to `fen` (active repertoire first, then any saved moves). */
export function pathTo(g: RepGraph, fen: string): Move[] | null {
  return pathFromParents(activeBfs(g), fen) ?? pathFromParents(fullBfs(g), fen);
}

/** My primary moves at positions reachable in the active repertoire: these are the drillable cards. */
export function drillableMoves(g: RepGraph, start = g.root): Move[] {
  const out: Move[] = [];
  for (const fen of activeBfs(g, start).keys()) {
    if (g.isMyTurn(fen)) {
      const p = g.primary(fen);
      if (p) out.push(p);
    }
  }
  return out;
}

export interface Gap {
  fen: string;
  path: Move[];
}

/**
 * Gaps: positions in my active lines where it's my turn but I haven't chosen
 * a move yet — i.e. opponent replies I haven't prepared for.
 * The empty starting position of a White repertoire is reported as a gap too.
 */
export function findGaps(g: RepGraph): Gap[] {
  const parents = activeBfs(g);
  const gaps: Gap[] = [];
  for (const fen of parents.keys()) {
    if (g.isMyTurn(fen) && !g.primary(fen)) {
      gaps.push({ fen, path: pathFromParents(parents, fen) ?? [] });
    }
  }
  return gaps.sort((a, b) => a.path.length - b.path.length);
}

export interface Completeness {
  prepared: number;
  gaps: number;
  /** 0..1 */
  ratio: number;
}

export function completeness(g: RepGraph): Completeness {
  let prepared = 0;
  let gaps = 0;
  for (const fen of activeBfs(g).keys()) {
    if (!g.isMyTurn(fen)) continue;
    if (g.primary(fen)) prepared++;
    else gaps++;
  }
  const total = prepared + gaps;
  return { prepared, gaps, ratio: total === 0 ? 0 : prepared / total };
}

/**
 * Ids of the moves to delete when removing `moveId`: the move itself plus every
 * move that is no longer reachable from the root once it's gone. Positions that
 * are still reachable through a transposition are kept.
 */
export function subtreeToDelete(g: RepGraph, moveId: string): string[] {
  const target = g.byId.get(moveId);
  if (!target) return [];
  const reachable = new Set<string>([g.root]);
  const queue = [g.root];
  while (queue.length) {
    const fen = queue.shift()!;
    for (const m of g.children(fen)) {
      if (m.id === moveId) continue;
      if (!reachable.has(m.toFen)) {
        reachable.add(m.toFen);
        queue.push(m.toFen);
      }
    }
  }
  const out = [moveId];
  for (const m of g.byId.values()) {
    if (m.id !== moveId && !reachable.has(m.fromFen)) out.push(m.id);
  }
  return out;
}

/** Number of target move ids in the active subtree below `fen` (each position counted once). */
export function countTargetsBelow(g: RepGraph, fen: string, targets: Set<string>, seen = new Set<string>()): number {
  if (seen.has(fen)) return 0;
  seen.add(fen);
  let n = 0;
  for (const m of g.activeChildren(fen)) {
    if (targets.has(m.id)) n++;
    n += countTargetsBelow(g, m.toFen, targets, seen);
  }
  return n;
}

/**
 * Builds drill lines that cover all target moves, preferring whole lines so moves
 * are practiced in context. Each line starts at the root. `order` decides which
 * targets get lines first (e.g. most overdue first).
 */
export function buildLines(g: RepGraph, order: string[], targets = new Set(order)): Move[][] {
  const remaining = new Set(targets);
  const parents = activeBfs(g);
  const lines: Move[][] = [];
  for (const id of order) {
    if (!remaining.has(id)) continue;
    const mv = g.byId.get(id);
    if (!mv) {
      remaining.delete(id);
      continue;
    }
    const prefix = pathFromParents(parents, mv.fromFen);
    if (!prefix) {
      remaining.delete(id);
      continue;
    }
    const line = [...prefix, mv];
    // Extend down the branch holding the most remaining targets.
    const onLine = new Set(line.map((m) => m.fromFen));
    let fen = mv.toFen;
    for (let guard = 0; guard < 400; guard++) {
      onLine.add(fen);
      const kids = g.activeChildren(fen).filter((k) => !onLine.has(k.toFen));
      if (!kids.length) break;
      const lineIds = new Set(line.map((m) => m.id));
      const pending = new Set([...remaining].filter((x) => !lineIds.has(x)));
      let best: Move | null = null;
      let bestN = 0;
      for (const k of kids) {
        const n = (pending.has(k.id) ? 1 : 0) + countTargetsBelow(g, k.toFen, pending, new Set(onLine));
        if (n > bestN) {
          best = k;
          bestN = n;
        }
      }
      if (!best) break;
      line.push(best);
      fen = best.toFen;
    }
    // Trim the tail after the last target so lines end where the quizzing ends.
    let last = -1;
    line.forEach((m, i) => {
      if (remaining.has(m.id)) last = i;
    });
    const trimmed = line.slice(0, last + 1);
    for (const m of trimmed) remaining.delete(m.id);
    if (trimmed.length) lines.push(trimmed);
  }
  return lines;
}
