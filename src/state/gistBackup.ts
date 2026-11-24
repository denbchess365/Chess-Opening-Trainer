import { computed, signal } from '@preact/signals';
import { summarize } from '../core/backupSchema';
import * as gh from '../net/github';
import * as repo from '../db/repo';
import { backupText, changeSeq, localKv, removeLocal, setLocal } from './store';

export const TOKEN_KEY = 'secret:githubToken';
export const GIST_KEY = 'local:gist';
/** At most one automatic backup per this interval. */
export const MIN_INTERVAL_MS = 5 * 60_000;
const DEBOUNCE_MS = 3_000;

export interface GistState {
  gistId?: string;
  htmlUrl?: string;
  includeGames?: boolean;
  lastSuccessAt?: number;
  lastAttemptAt?: number;
  /** Data changed since the last successful backup (persisted across app restarts). */
  dirty?: boolean;
  lastError?: { kind: gh.GistErrorKind; message: string; at: number; resetAt?: number } | null;
}

export const gistState = computed<GistState>(() => (localKv.value[GIST_KEY] as GistState) ?? {});
export const hasToken = computed(() => typeof localKv.value[TOKEN_KEY] === 'string' && !!localKv.value[TOKEN_KEY]);
export const backupRunning = signal(false);

function token(): string {
  return (localKv.value[TOKEN_KEY] as string) ?? '';
}

async function patch(p: Partial<GistState>) {
  await setLocal(GIST_KEY, { ...gistState.value, ...p });
}

/** Masked display: never shows more than the last 4 characters. */
export function maskedToken(): string {
  const t = token();
  return t ? `${t.startsWith('github_pat_') ? 'github_pat_' : ''}••••••••${t.slice(-4)}` : '';
}

/**
 * Checks the token with GitHub first and only saves it if it works. When offline it
 * is saved anyway (and checked on the next backup). Returns a status message.
 */
export async function saveToken(t: string): Promise<string> {
  const v = t.trim();
  if (!v) throw new gh.GistError('auth', 'Paste a token first.');
  if (/\s/.test(v)) throw new gh.GistError('auth', 'That doesn’t look like a token (it contains spaces).');
  try {
    await gh.testConnection(v);
  } catch (e) {
    if (e instanceof gh.GistError && e.kind === 'offline') {
      await setLocal(TOKEN_KEY, v);
      return 'Saved. You’re offline, so the token will be checked on the first backup.';
    }
    throw e;
  }
  await setLocal(TOKEN_KEY, v);
  await patch({ lastError: null });
  return 'Connected to GitHub ✓ — token saved.';
}

export async function removeToken() {
  await removeLocal(TOKEN_KEY);
  await patch({ lastError: null });
}

export async function testToken(): Promise<string> {
  await gh.testConnection(token());
  return 'Connected to GitHub ✓ — the token can read and write Gists.';
}

// ---------------------------------------------------------------- change tracking

let backedUpSeq = -1;
let lastSeen = 0;
changeSeq.subscribe((n) => {
  if (n === lastSeen) return;
  lastSeen = n;
  if (n > 0 && !gistState.value.dirty && hasToken.value) patch({ dirty: true }).catch(() => {});
});

function isDirty() {
  return !!gistState.value.dirty || (changeSeq.value !== backedUpSeq && changeSeq.value > 0);
}

// ---------------------------------------------------------------- running a backup

let timer: ReturnType<typeof setTimeout> | undefined;

/**
 * Called at the end of practice/build sessions and when the app is hidden.
 * Only backs up if data changed, debounced, and at most once every 5 minutes.
 */
export function requestAutoBackup(opts: { immediate?: boolean } = {}) {
  if (!hasToken.value || !isDirty()) return;
  clearTimeout(timer);
  const since = Date.now() - (gistState.value.lastAttemptAt ?? 0);
  const wait = Math.max(opts.immediate ? 0 : DEBOUNCE_MS, MIN_INTERVAL_MS - since);
  timer = setTimeout(() => backupNow({ auto: true }).catch(() => {}), wait);
}

/** Runs a backup now. Manual runs ignore the 5-minute limit. Errors are stored for display and rethrown. */
export async function backupNow(opts: { auto?: boolean } = {}): Promise<void> {
  if (backupRunning.value) return;
  if (!hasToken.value) throw new gh.GistError('auth', 'Add a GitHub token first.');
  const st = gistState.value;
  if (opts.auto && st.lastError?.kind === 'rate' && st.lastError.resetAt && Date.now() < st.lastError.resetAt) return;
  backupRunning.value = true;
  const seqAtStart = changeSeq.value;
  try {
    await patch({ lastAttemptAt: Date.now() });
    const text = await backupText({ includeGames: !!st.includeGames });
    const data = await repo.loadAll();
    const summary = summarize({ ...data, lichessGames: st.includeGames ? data.lichessGames : [] });
    let gist;
    if (st.gistId) gist = await gh.updateGist(token(), st.gistId, text, summary);
    else {
      // Re-use an existing backup Gist (e.g. after reinstalling) instead of creating duplicates.
      const existing = await gh.findBackupGist(token());
      gist = existing ? await gh.updateGist(token(), existing.id, text, summary) : await gh.createGist(token(), text, summary);
    }
    backedUpSeq = seqAtStart;
    await patch({
      gistId: gist.id,
      htmlUrl: gist.html_url,
      lastSuccessAt: Date.now(),
      lastError: null,
      dirty: changeSeq.value !== seqAtStart,
    });
  } catch (e) {
    const err = e instanceof gh.GistError ? e : new gh.GistError('other', String((e as Error).message ?? e));
    await patch({ lastError: { kind: err.kind, message: err.message, at: Date.now(), resetAt: err.resetAt } });
    throw err;
  } finally {
    backupRunning.value = false;
  }
}

/** Forget the linked Gist (the next backup creates or finds one again). */
export async function unlinkGist() {
  await patch({ gistId: undefined, htmlUrl: undefined });
}

// ---------------------------------------------------------------- restore

export interface RevisionInfo {
  version: string;
  date: number;
  changes: number;
}

export async function revisions(): Promise<RevisionInfo[]> {
  let id = gistState.value.gistId;
  if (!id) {
    const found = await gh.findBackupGist(token());
    if (!found) throw new gh.GistError('notfound', 'No backup Gist found for this token.');
    id = found.id;
    await patch({ gistId: found.id, htmlUrl: found.html_url });
  }
  const list = await gh.listRevisions(token(), id);
  return list.map((r) => ({ version: r.version, date: Date.parse(r.committed_at), changes: r.change_status?.total ?? 0 }));
}

export async function revisionText(version: string): Promise<string> {
  return gh.getRevisionText(token(), gistState.value.gistId!, version);
}

// ---------------------------------------------------------------- triggers

/** Back up when the app goes to the background (best effort: iOS may suspend us mid-upload). */
export function installAutoBackupTriggers() {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') requestAutoBackup({ immediate: true });
  });
  // Retry when the connection comes back.
  window.addEventListener('online', () => requestAutoBackup());
}

export function relTime(t: number, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 60) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} minute${m === 1 ? '' : 's'} ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} hour${h === 1 ? '' : 's'} ago`;
  const d = Math.round(h / 24);
  return `${d} day${d === 1 ? '' : 's'} ago`;
}
