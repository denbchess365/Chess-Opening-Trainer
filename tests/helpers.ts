import { playMove, ROOT } from '../src/core/fen';
import { RepGraph } from '../src/core/tree';
import type { Move, Side } from '../src/core/types';

let n = 0;

/**
 * Builds moves from SAN lines like "e4 e5 Nf3". The first time a move of mine is
 * seen at a position it becomes primary; later different moves there are alternatives.
 */
export function buildMoves(side: Side, lines: string[], repertoireId = 'r1'): Move[] {
  const out: Move[] = [];
  for (const line of lines) {
    let fen = ROOT;
    for (const san of line.trim().split(/\s+/).filter(Boolean)) {
      const p = playMove(fen, san);
      if (!p) throw new Error(`illegal ${san} in ${line}`);
      let m = out.find((x) => x.fromFen === p.fromFen && x.uci === p.uci);
      if (!m) {
        const isMine = fen.split(' ')[1] === side;
        m = {
          id: `m${++n}`,
          repertoireId,
          fromFen: p.fromFen,
          toFen: p.toFen,
          san: p.san,
          uci: p.uci,
          isMine,
          isPrimary: !isMine || !out.some((x) => x.fromFen === p.fromFen && x.isMine && x.isPrimary),
          comment: '',
          createdAt: n,
        };
        out.push(m);
      }
      fen = p.toFen;
    }
  }
  return out;
}

export function graph(side: Side, lines: string[]) {
  return new RepGraph(side, buildMoves(side, lines));
}
