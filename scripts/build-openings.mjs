// Converts the vendored lichess-org/chess-openings TSV files (CC0) into a
// compact JSON book keyed by normalized FEN (piece placement, side, castling, ep).
//   names:  [[eco, name], ...]
//   pos:    { fen: [nameIndex | -1, [[san, count], ...]] }
// `count` = how many named openings pass through that move (a popularity proxy).
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { Chess } from 'chess.js';

const files = ['a', 'b', 'c', 'd', 'e'];
const names = [];
const pos = new Map();

function norm(chess) {
  const [board, turn, castling, ep] = chess.fen().split(' ');
  let e = ep;
  if (e !== '-' && !chess.moves({ verbose: true }).some((m) => m.flags.includes('e'))) e = '-';
  return `${board} ${turn} ${castling} ${e}`;
}
function entry(fen) {
  let p = pos.get(fen);
  if (!p) { p = [-1, new Map()]; pos.set(fen, p); }
  return p;
}

for (const f of files) {
  const lines = readFileSync(`data/chess-openings/${f}.tsv`, 'utf8').split('\n').slice(1);
  for (const line of lines) {
    if (!line.trim()) continue;
    const [eco, name, pgn] = line.split('\t');
    const chess = new Chess();
    const sans = pgn.replace(/\d+\.(\.\.)?/g, ' ').trim().split(/\s+/);
    for (const san of sans) {
      const before = norm(chess);
      const mv = chess.move(san);
      const children = entry(before)[1];
      children.set(mv.san, (children.get(mv.san) ?? 0) + 1);
    }
    const idx = names.push([eco, name]) - 1;
    const e = entry(norm(chess));
    // Prefer the shortest / first name for a position (later entries are usually sub-variations of transpositions).
    if (e[0] === -1) e[0] = idx;
  }
}

const out = { names, pos: {} };
for (const [fen, [n, children]] of pos) {
  out.pos[fen] = [n, [...children].sort((a, b) => b[1] - a[1])];
}
mkdirSync('src/data', { recursive: true });
writeFileSync('src/data/openings.json', JSON.stringify(out));
console.log(`openings: ${names.length} names, ${pos.size} positions`);
