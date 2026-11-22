import { getDb } from './schema';
import type { CardState, Move, Repertoire, ReviewLog } from '../core/types';

export interface AllData {
  repertoires: Repertoire[];
  moves: Move[];
  cards: CardState[];
  reviewLogs: ReviewLog[];
  kv: Record<string, unknown>;
}

export async function loadAll(): Promise<AllData> {
  const db = await getDb();
  const [repertoires, moves, cards, reviewLogs, kvRows] = await Promise.all([
    db.getAll('repertoires'),
    db.getAll('moves'),
    db.getAll('cards'),
    db.getAll('reviewLogs'),
    db.getAll('kv'),
  ]);
  const kv: Record<string, unknown> = {};
  for (const r of kvRows) kv[r.key] = r.value;
  return { repertoires, moves, cards, reviewLogs, kv };
}

export async function putRepertoire(r: Repertoire) {
  await (await getDb()).put('repertoires', r);
}

export async function putMoves(moves: Move[]) {
  const db = await getDb();
  const tx = db.transaction('moves', 'readwrite');
  await Promise.all([...moves.map((m) => tx.store.put(m)), tx.done]);
}

export async function deleteMoves(ids: string[]) {
  const db = await getDb();
  const tx = db.transaction(['moves', 'cards'], 'readwrite');
  const moves = tx.objectStore('moves');
  const cards = tx.objectStore('cards');
  await Promise.all([...ids.flatMap((id) => [moves.delete(id), cards.delete(id)]), tx.done]);
}

export async function putCard(c: CardState) {
  await (await getDb()).put('cards', c);
}

export async function addReviewLog(l: ReviewLog): Promise<number> {
  return (await getDb()).add('reviewLogs', l);
}

export async function putKv(key: string, value: unknown) {
  await (await getDb()).put('kv', { key, value });
}

async function deleteByRepertoire(store: 'moves' | 'cards' | 'reviewLogs', repertoireId: string) {
  const db = await getDb();
  const tx = db.transaction(store, 'readwrite');
  const index = tx.store.index('repertoireId');
  let cursor = await index.openCursor(IDBKeyRange.only(repertoireId));
  while (cursor) {
    await cursor.delete();
    cursor = await cursor.continue();
  }
  await tx.done;
}

/** Reset progress: keeps the moves, clears scheduling and review history. */
export async function resetProgress(repertoireId: string) {
  await deleteByRepertoire('cards', repertoireId);
  await deleteByRepertoire('reviewLogs', repertoireId);
}

export async function deleteRepertoire(repertoireId: string) {
  await resetProgress(repertoireId);
  await deleteByRepertoire('moves', repertoireId);
  await (await getDb()).delete('repertoires', repertoireId);
}

/** Replaces the entire database contents (used by backup restore). */
export async function replaceAll(data: AllData) {
  const db = await getDb();
  const stores = ['repertoires', 'moves', 'cards', 'reviewLogs', 'kv'] as const;
  const tx = db.transaction(stores, 'readwrite');
  await Promise.all(stores.map((s) => tx.objectStore(s).clear()));
  const ops: Promise<unknown>[] = [];
  for (const r of data.repertoires) ops.push(tx.objectStore('repertoires').put(r));
  for (const m of data.moves) ops.push(tx.objectStore('moves').put(m));
  for (const c of data.cards) ops.push(tx.objectStore('cards').put(c));
  for (const l of data.reviewLogs) ops.push(tx.objectStore('reviewLogs').put(l));
  for (const [key, value] of Object.entries(data.kv)) ops.push(tx.objectStore('kv').put({ key, value }));
  await Promise.all([...ops, tx.done]);
}
