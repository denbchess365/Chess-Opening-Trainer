import { playMove } from './fen';

export interface BookData {
  names: [string, string][];
  pos: Record<string, [number, [string, number][]]>;
}

export interface OpeningName {
  eco: string;
  name: string;
}

export interface BookMove {
  san: string;
  /** Number of named openings that continue with this move (popularity proxy). */
  count: number;
  /** Name of the resulting position, if it has one. */
  name: OpeningName | null;
}

export class Book {
  constructor(private data: BookData) {}

  nameAt(fen: string): OpeningName | null {
    const e = this.data.pos[fen];
    if (!e || e[0] < 0) return null;
    const [eco, name] = this.data.names[e[0]];
    return { eco, name };
  }

  /** Deepest named position along a sequence of FENs (e.g. the current line). */
  nameForLine(fens: string[]): OpeningName | null {
    for (let i = fens.length - 1; i >= 0; i--) {
      const n = this.nameAt(fens[i]);
      if (n) return n;
    }
    return null;
  }

  moves(fen: string): BookMove[] {
    const e = this.data.pos[fen];
    if (!e) return [];
    return e[1].map(([san, count]) => {
      const p = playMove(fen, san);
      return { san, count, name: p ? this.nameAt(p.toFen) : null };
    });
  }
}

let bookPromise: Promise<Book> | null = null;

/** Lazily loads the bundled opening book (a separate chunk, cached by the service worker). */
export function loadBook(): Promise<Book> {
  bookPromise ??= import('../data/openings.json').then((m) => new Book((m.default ?? m) as unknown as BookData));
  return bookPromise;
}
