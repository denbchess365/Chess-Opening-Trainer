import { Chess } from 'chess.js';
import { normalizeFen, playMove, ROOT, type PlayedMove } from './fen';
import type { RepGraph } from './tree';
import type { Move } from './types';

export interface PgnEdge {
  played: PlayedMove;
  comment: string;
}

export interface PgnParseResult {
  games: number;
  /** Every move in the file (main lines and variations), in file order — main line first at each position. */
  edges: PgnEdge[];
  errors: string[];
}

type Token =
  | { t: 'tag'; name: string; value: string }
  | { t: 'comment'; text: string }
  | { t: 'open' }
  | { t: 'close' }
  | { t: 'move'; san: string }
  | { t: 'result' };

function tokenize(text: string): Token[] {
  const out: Token[] = [];
  let i = 0;
  const n = text.length;
  while (i < n) {
    const c = text[i];
    if (/\s/.test(c)) {
      i++;
    } else if (c === '[') {
      const end = text.indexOf(']', i);
      const body = text.slice(i + 1, end < 0 ? n : end);
      const m = body.match(/^\s*(\w+)\s+"((?:[^"\\]|\\.)*)"/);
      if (m) out.push({ t: 'tag', name: m[1], value: m[2].replace(/\\(.)/g, '$1') });
      i = end < 0 ? n : end + 1;
    } else if (c === '{') {
      const end = text.indexOf('}', i);
      out.push({ t: 'comment', text: text.slice(i + 1, end < 0 ? n : end).replace(/\s+/g, ' ').trim() });
      i = end < 0 ? n : end + 1;
    } else if (c === ';') {
      const end = text.indexOf('\n', i);
      out.push({ t: 'comment', text: text.slice(i + 1, end < 0 ? n : end).trim() });
      i = end < 0 ? n : end + 1;
    } else if (c === '%' && (i === 0 || text[i - 1] === '\n')) {
      const end = text.indexOf('\n', i);
      i = end < 0 ? n : end + 1;
    } else if (c === '(') {
      out.push({ t: 'open' });
      i++;
    } else if (c === ')') {
      out.push({ t: 'close' });
      i++;
    } else {
      let j = i;
      while (j < n && !/[\s(){};[\]]/.test(text[j])) j++;
      const word = text.slice(i, j);
      i = j === i ? i + 1 : j;
      if (/^(1-0|0-1|1\/2-1\/2|\*)$/.test(word)) out.push({ t: 'result' });
      else if (/^\$\d+$/.test(word)) continue; // NAG
      else {
        // Strip move numbers ("12." / "12...") glued to the move, and annotation glyphs.
        const san = word.replace(/^\d+\.+/, '').replace(/[!?]+$/, '');
        if (san && !/^\d+\.*$/.test(san) && san !== '..') out.push({ t: 'move', san: san === '0-0' ? 'O-O' : san === '0-0-0' ? 'O-O-O' : san });
      }
    }
  }
  return out;
}

/** Parses one or more PGN games including nested variations (RAV) and comments. */
export function parsePgn(text: string): PgnParseResult {
  const tokens = tokenize(text);
  const edges: PgnEdge[] = [];
  const errors: string[] = [];
  let games = 0;

  let startFen = ROOT;
  let cur = ROOT;
  let prev: string | null = null;
  let last: PgnEdge | null = null;
  let stack: { cur: string; prev: string | null; last: PgnEdge | null }[] = [];
  let inGame = false;
  let sawMove = false;
  let skipDepth = -1; // when a move is illegal, skip the rest of that (sub)variation
  let skipGame = false;
  let pendingComment = '';

  const endGame = () => {
    if (inGame) games++;
    inGame = false;
    sawMove = false;
    startFen = ROOT;
    cur = ROOT;
    prev = null;
    last = null;
    stack = [];
    skipDepth = -1;
    skipGame = false;
    pendingComment = '';
  };

  for (const tok of tokens) {
    switch (tok.t) {
      case 'tag':
        if (sawMove) endGame();
        inGame = true;
        if (tok.name === 'FEN') {
          startFen = normalizeFen(tok.value);
          cur = startFen;
          if (startFen !== ROOT) {
            skipGame = true;
            errors.push('Skipped a game that starts from a custom position (only the standard start is supported).');
          }
        }
        break;
      case 'result':
        endGame();
        break;
      case 'comment':
        if (skipGame || skipDepth >= 0) break;
        if (last) last.comment = last.comment ? `${last.comment} ${tok.text}` : tok.text;
        else pendingComment = tok.text;
        break;
      case 'open':
        stack.push({ cur, prev, last });
        if (skipDepth < 0) {
          // A variation replaces the last move: continue from the position before it.
          if (prev !== null) cur = prev;
          last = null;
        }
        break;
      case 'close': {
        const s = stack.pop();
        if (s) ({ cur, prev, last } = s);
        if (skipDepth > stack.length) skipDepth = -1;
        break;
      }
      case 'move': {
        inGame = true;
        sawMove = true;
        if (skipGame || skipDepth >= 0) break;
        const p = playMove(cur, tok.san);
        if (!p) {
          errors.push(`Illegal or unreadable move "${tok.san}" — skipped the rest of that line.`);
          skipDepth = stack.length;
          break;
        }
        const e: PgnEdge = { played: p, comment: '' };
        if (pendingComment && !last) {
          // A comment before the first move isn't attached to a move; drop it.
          pendingComment = '';
        }
        edges.push(e);
        prev = cur;
        cur = p.toFen;
        last = e;
        break;
      }
    }
  }
  if (inGame) games++;
  return { games, edges, errors };
}

function sanitizeComment(c: string): string {
  return c.replace(/[{}]/g, '').trim();
}

/** Ordered children for export: my main move first, then alternatives; opponent replies by creation. */
function exportChildren(g: RepGraph, fen: string): Move[] {
  return [...g.children(fen)].sort((a, b) => {
    const ra = a.isMine && a.isPrimary ? 0 : 1;
    const rb = b.isMine && b.isPrimary ? 0 : 1;
    return ra - rb || a.createdAt - b.createdAt;
  });
}

/**
 * Exports a repertoire as one PGN game with variations. Positions reached twice
 * (transpositions) are only expanded the first time and marked with a comment.
 */
export function exportPgn(g: RepGraph, title: string, date = new Date()): string {
  const visited = new Set<string>([ROOT]);
  const num = (ply: number, force: boolean) =>
    ply % 2 === 0 ? `${ply / 2 + 1}. ` : force ? `${(ply - 1) / 2 + 1}... ` : '';
  const comment = (m: Move) => {
    const parts: string[] = [];
    if (m.isMine && !m.isPrimary) parts.push('[alternative]');
    if (m.comment) parts.push(sanitizeComment(m.comment));
    return parts.length ? ` {${parts.join(' ')}}` : '';
  };

  function continuation(fen: string, ply: number, force: boolean): string {
    const kids = exportChildren(g, fen);
    if (!kids.length) return '';
    const [main, ...others] = kids;
    let out = `${num(ply, force)}${main.san}${comment(main)}`;
    const mainNew = !visited.has(main.toFen);
    visited.add(main.toFen);
    for (const o of others) {
      let v = `${num(ply, true)}${o.san}${comment(o)}`;
      if (visited.has(o.toFen)) v += ' {transposes}';
      else {
        visited.add(o.toFen);
        const rest = continuation(o.toFen, ply + 1, !!o.comment);
        if (rest) v += ' ' + rest;
      }
      out += ` (${v})`;
    }
    if (!mainNew) return out + ' {transposes}';
    const rest = continuation(main.toFen, ply + 1, others.length > 0 || !!main.comment);
    return rest ? `${out} ${rest}` : out;
  }

  const d = `${date.getFullYear()}.${String(date.getMonth() + 1).padStart(2, '0')}.${String(date.getDate()).padStart(2, '0')}`;
  const headers = [
    `[Event "${title.replace(/"/g, "'")}"]`,
    `[Site "Repertoire Trainer"]`,
    `[Date "${d}"]`,
    `[White "${g.side === 'w' ? 'Me' : '?'}"]`,
    `[Black "${g.side === 'b' ? 'Me' : '?'}"]`,
    `[Result "*"]`,
  ].join('\n');
  const body = continuation(ROOT, 0, false);
  return `${headers}\n\n${wrap(body ? body + ' *' : '*')}\n`;
}

function wrap(text: string, width = 80): string {
  const words = text.split(' ');
  const lines: string[] = [];
  let line = '';
  for (const w of words) {
    if (line && line.length + 1 + w.length > width) {
      lines.push(line);
      line = w;
    } else line = line ? `${line} ${w}` : w;
  }
  if (line) lines.push(line);
  return lines.join('\n');
}

export interface Mainline {
  /** Full FEN before the first move. */
  startFen: string;
  sans: string[];
  /** Full FEN after each ply (same length as sans). */
  fens: string[];
  headers: Record<string, string>;
}

/**
 * Main line of the FIRST game in a PGN (variations ignored), with full FENs so a
 * position can be picked at any move. Supports [SetUp]/[FEN] starts. Throws a readable error.
 */
export function pgnMainline(text: string): Mainline {
  const first = text.trim().split(/\n\s*\n(?=\s*\[)/).find((g) => /\S/.test(g.replace(/\[[^\]]*\]/g, ''))) ?? text;
  const c = new Chess();
  try {
    c.loadPgn(first);
  } catch (e) {
    throw new Error(`Couldn’t read this PGN: ${(e as Error).message}`);
  }
  const hist = c.history({ verbose: true });
  const headers = c.getHeaders() as Record<string, string>;
  return {
    startFen: hist.length ? hist[0].before : c.fen(),
    sans: hist.map((m) => m.san),
    fens: hist.map((m) => m.after),
    headers,
  };
}
