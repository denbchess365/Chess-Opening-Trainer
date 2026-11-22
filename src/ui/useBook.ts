import { signal } from '@preact/signals';
import { loadBook, type Book } from '../core/openings';

export const book = signal<Book | null>(null);
let started = false;

/** Returns the opening book once loaded (triggers the lazy load on first use). */
export function useBook(): Book | null {
  if (!started) {
    started = true;
    loadBook().then((b) => (book.value = b)).catch(() => {});
  }
  return book.value;
}
