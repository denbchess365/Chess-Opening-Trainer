import { computed, signal } from '@preact/signals';
import * as repo from '../db/repo';
import type { LichessGame } from '../core/types';
import { fetchGames, LichessError } from '../net/lichessClient';
import { lichessGames, lichessSettings, localKv, setLocal } from './store';

export const SYNC_KEY = 'local:lichessSync';
/** Automatic syncs happen at most once per hour. */
export const AUTO_SYNC_INTERVAL_MS = 60 * 60_000;

export interface SyncState {
  lastSyncAt?: number;
  lastAdded?: number;
  /** Don't contact Lichess before this time (after HTTP 429). */
  cooldownUntil?: number;
  lastError?: { message: string; at: number } | null;
}

export const syncState = computed<SyncState>(() => (localKv.value[SYNC_KEY] as SyncState) ?? {});
export const syncing = signal(false);
export const syncProgress = signal(0);

async function patchSync(p: Partial<SyncState>) {
  await setLocal(SYNC_KEY, { ...syncState.value, ...p });
}

/** Hooks run after new games are stored (analysis is registered by the review module). */
const afterSync: ((games: LichessGame[]) => Promise<void> | void)[] = [];
export function onGamesSynced(fn: (games: LichessGame[]) => Promise<void> | void) {
  afterSync.push(fn);
}

/**
 * Fetches new games since the newest stored game for this user and stores those not
 * already saved. Never throws for network problems: the error is recorded and returned.
 */
export async function syncGames(): Promise<{ added: number; error?: string }> {
  const s = lichessSettings.value;
  if (syncing.value) return { added: 0, error: 'A sync is already running.' };
  const cd = syncState.value.cooldownUntil;
  if (cd && Date.now() < cd) return { added: 0, error: `Lichess asked us to wait — try again after ${new Date(cd).toLocaleTimeString()}.` };
  syncing.value = true;
  syncProgress.value = 0;
  const user = s.username.toLowerCase();
  const known = new Set(lichessGames.value.map((g) => g.id));
  const newest = Math.max(0, ...lichessGames.value.filter((g) => (g.user ?? user) === user).map((g) => g.playedAt));
  const fresh: LichessGame[] = [];
  try {
    await fetchGames(s, newest ? newest + 1 : undefined, (g) => {
      if (known.has(g.id)) return;
      known.add(g.id);
      fresh.push(g);
      syncProgress.value = fresh.length;
    });
    if (fresh.length) {
      await repo.putGames(fresh);
      lichessGames.value = [...fresh, ...lichessGames.value].sort((a, b) => b.playedAt - a.playedAt);
      for (const fn of afterSync) await fn(fresh);
    }
    await patchSync({ lastSyncAt: Date.now(), lastAdded: fresh.length, lastError: null });
    return { added: fresh.length };
  } catch (e) {
    // Keep whatever arrived before the failure.
    if (fresh.length) {
      await repo.putGames(fresh);
      lichessGames.value = [...fresh, ...lichessGames.value].sort((a, b) => b.playedAt - a.playedAt);
      for (const fn of afterSync) await fn(fresh);
    }
    const err = e instanceof LichessError ? e : new LichessError('other', String((e as Error).message ?? e));
    await patchSync({
      lastError: { message: err.message, at: Date.now() },
      ...(err.kind === 'rate' ? { cooldownUntil: err.retryAt } : {}),
    });
    return { added: fresh.length, error: err.message };
  } finally {
    syncing.value = false;
  }
}

/** On app open: sync if enabled and the last sync was more than an hour ago. */
export function maybeAutoSync() {
  const s = lichessSettings.value;
  const last = syncState.value.lastSyncAt ?? 0;
  if (!s.autoSync || !s.username || !navigator.onLine) return;
  if (Date.now() - last < AUTO_SYNC_INTERVAL_MS) return;
  syncGames();
}
