import { getDb } from './schema';
import type { CardState, GameFinding, LichessGame, Move, Repertoire, ReviewLog, Snapshot } from '../core/types';

export interface AllData {
  repertoires: Repertoire[];
  moves: Move[];
  cards: CardState[];
  reviewLogs: ReviewLog[];
  /** Synced settings/meta. Device-local keys (see isLocalKey) are never included. */
  kv: Record<string, unknown>;
  lichessGames: LichessGame[];
  findings: GameFinding[];
}

/**
 * Keys that belong to this device only: secrets (the GitHub token) and device state
 * such as the Gist id or sync timestamps. They are never exported, backed up,
 * snapshotted or overwritten by a restore.
 */
export function isLocalKey(key: string): boolean {
  return key.startsWith('secret:') || key.startsWith('local:');
}

let writeListener: (() => void) | null = null;
/** Registers a callback fired on every change to user data (drives auto-backup). */
export function onDataWrite(fn: () => void) {
  writeListener = fn;
}
function touch() {
  writeListener?.();
}

export async function loadAll(): Promise<AllData> {
  const db = await getDb();
  const [repertoires, moves, cards, reviewLogs, kvRows, lichessGames, findings] = await Promise.all([
    db.getAll('repertoires'),
    db.getAll('moves'),
    db.getAll('cards'),
    db.getAll('reviewLogs'),
    db.getAll('kv'),
    db.getAll('lichessGames'),
    db.getAll('findings'),
  ]);
  const kv: Record<string, unknown> = {};
  for (const r of kvRows) if (!isLocalKey(r.key)) kv[r.key] = r.value;
  return { repertoires, moves, cards, reviewLogs, kv, lichessGames, findings };
}

/** Device-local key/values (including secrets). Never exported. */
export async function loadLocalKv(): Promise<Record<string, unknown>> {
  const db = await getDb();
  const out: Record<string, unknown> = {};
  for (const r of await db.getAll('kv')) if (isLocalKey(r.key)) out[r.key] = r.value;
  return out;
}

export async function deleteKv(key: string) {
  await (await getDb()).delete('kv', key);
}

export async function putRepertoire(r: Repertoire) {
  touch();
  await (await getDb()).put('repertoires', r);
}

export async function putMoves(moves: Move[]) {
  touch();
  const db = await getDb();
  const tx = db.transaction('moves', 'readwrite');
  await Promise.all([...moves.map((m) => tx.store.put(m)), tx.done]);
}

export async function deleteMoves(ids: string[]) {
  touch();
  const db = await getDb();
  const tx = db.transaction(['moves', 'cards'], 'readwrite');
  const moves = tx.objectStore('moves');
  const cards = tx.objectStore('cards');
  await Promise.all([...ids.flatMap((id) => [moves.delete(id), cards.delete(id)]), tx.done]);
}

export async function putCard(c: CardState) {
  touch();
  await (await getDb()).put('cards', c);
}

export async function addReviewLog(l: ReviewLog): Promise<number> {
  touch();
  return (await getDb()).add('reviewLogs', l);
}

export async function putKv(key: string, value: unknown) {
  if (!isLocalKey(key)) touch();
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
  touch();
  await deleteByRepertoire('cards', repertoireId);
  await deleteByRepertoire('reviewLogs', repertoireId);
}

export async function deleteRepertoire(repertoireId: string) {
  touch();
  await resetProgress(repertoireId);
  await deleteByRepertoire('moves', repertoireId);
  await (await getDb()).delete('repertoires', repertoireId);
}

/**
 * Replaces all user data in ONE transaction (used by restores). If any write
 * fails the transaction aborts and the database is left exactly as it was.
 * Device-local keys (token, Gist id…) and snapshots are kept.
 */
export async function replaceAll(data: AllData) {
  const db = await getDb();
  const stores = ['repertoires', 'moves', 'cards', 'reviewLogs', 'kv', 'lichessGames', 'findings'] as const;
  const tx = db.transaction(stores, 'readwrite');
  const ops: Promise<unknown>[] = [];
  touch();
  try {
    for (const s of stores) if (s !== 'kv') ops.push(tx.objectStore(s).clear());
    const kvStore = tx.objectStore('kv');
    for (const key of await kvStore.getAllKeys()) if (!isLocalKey(key)) ops.push(kvStore.delete(key));
    for (const r of data.repertoires) ops.push(tx.objectStore('repertoires').put(r));
    for (const m of data.moves) ops.push(tx.objectStore('moves').put(m));
    for (const c of data.cards) ops.push(tx.objectStore('cards').put(c));
    for (const l of data.reviewLogs) ops.push(tx.objectStore('reviewLogs').put(l));
    for (const g of data.lichessGames) ops.push(tx.objectStore('lichessGames').put(g));
    for (const f of data.findings) ops.push(tx.objectStore('findings').put(f));
    for (const [key, value] of Object.entries(data.kv)) if (!isLocalKey(key)) ops.push(kvStore.put({ key, value }));
    await Promise.all([...ops, tx.done]);
  } catch (e) {
    for (const op of ops) op.catch(() => {}); // pending writes reject once the transaction aborts
    try {
      tx.abort();
    } catch {
      /* already aborted */
    }
    await tx.done.catch(() => {});
    throw e;
  }
}

// ---------------------------------------------------------------- snapshots

export const MAX_SNAPSHOTS = 5;

export async function addSnapshot(s: Snapshot) {
  const db = await getDb();
  const tx = db.transaction('snapshots', 'readwrite');
  await tx.store.add(s);
  const keys = await tx.store.getAllKeys();
  for (const k of keys.slice(0, Math.max(0, keys.length - MAX_SNAPSHOTS))) await tx.store.delete(k);
  await tx.done;
}

export async function listSnapshots(): Promise<Snapshot[]> {
  return (await (await getDb()).getAll('snapshots')).sort((a, b) => b.createdAt - a.createdAt);
}

export async function getSnapshot(id: number): Promise<Snapshot | undefined> {
  return (await getDb()).get('snapshots', id);
}

// ---------------------------------------------------------------- Lichess

export async function putGames(games: LichessGame[]) {
  touch();
  const db = await getDb();
  const tx = db.transaction('lichessGames', 'readwrite');
  await Promise.all([...games.map((g) => tx.store.put(g)), tx.done]);
}

export async function putFindings(list: GameFinding[]) {
  touch();
  const db = await getDb();
  const tx = db.transaction('findings', 'readwrite');
  await Promise.all([...list.map((f) => tx.store.put(f)), tx.done]);
}

export async function deleteFindingsForRepertoire(repertoireId: string) {
  touch();
  const db = await getDb();
  const tx = db.transaction('findings', 'readwrite');
  for (const f of await tx.store.getAll()) if (f.repertoireId === repertoireId) await tx.store.delete(f.id);
  await tx.done;
}
