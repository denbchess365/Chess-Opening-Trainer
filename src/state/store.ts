import { computed, signal } from '@preact/signals';
import * as repo from '../db/repo';
import { turnOf, type PlayedMove } from '../core/fen';
import { localDay, previousDay, uid } from '../core/ids';
import { isDue, isMastered, newCard, review } from '../core/scheduler';
import { completeness, drillableMoves, RepGraph, subtreeToDelete } from '../core/tree';
import {
  DEFAULT_SETTINGS,
  type CardState,
  type Grade,
  type Meta,
  type Move,
  type Repertoire,
  type Settings,
  type Side,
} from '../core/types';

export const ready = signal(false);
export const loadError = signal<string | null>(null);
export const repertoires = signal<Repertoire[]>([]);
export const moves = signal<Move[]>([]);
export const cards = signal<Map<string, CardState>>(new Map());
export const settings = signal<Settings>({ ...DEFAULT_SETTINGS });
export const meta = signal<Meta>({ streak: 0, lastPracticeDay: null, lastBackupAt: null });
/** Ticks every minute so "due" counts refresh. */
export const now = signal(Date.now());
setInterval(() => (now.value = Date.now()), 60_000);

export const graphs = computed(() => {
  const byRep = new Map<string, Move[]>();
  for (const m of moves.value) {
    const l = byRep.get(m.repertoireId);
    if (l) l.push(m);
    else byRep.set(m.repertoireId, [m]);
  }
  const out = new Map<string, RepGraph>();
  for (const r of repertoires.value) out.set(r.id, new RepGraph(r.side, byRep.get(r.id) ?? []));
  return out;
});

export function graphOf(repId: string): RepGraph {
  return graphs.value.get(repId) ?? new RepGraph('w', []);
}

export function repertoireById(id: string): Repertoire | undefined {
  return repertoires.value.find((r) => r.id === id);
}

/** The card for one of my moves; unreviewed moves get a fresh card that is due from creation. */
export function cardFor(m: Move): CardState {
  return cards.value.get(m.id) ?? newCard(m.id, m.repertoireId, m.createdAt);
}

export interface RepStats {
  total: number;
  due: number;
  mastered: number;
  masteredRatio: number;
  prepared: number;
  gaps: number;
  completeRatio: number;
}

export const stats = computed(() => {
  // Subscribe to the minute tick, but always compare against the real clock.
  const t = Math.max(now.value, Date.now());
  const out = new Map<string, RepStats>();
  for (const r of repertoires.value) {
    const g = graphOf(r.id);
    const drill = drillableMoves(g);
    let due = 0;
    let mastered = 0;
    for (const m of drill) {
      const c = cardFor(m);
      if (isDue(c, t)) due++;
      if (isMastered(c)) mastered++;
    }
    const comp = completeness(g);
    out.set(r.id, {
      total: drill.length,
      due,
      mastered,
      masteredRatio: drill.length ? mastered / drill.length : 0,
      prepared: comp.prepared,
      gaps: comp.gaps,
      completeRatio: comp.ratio,
    });
  }
  return out;
});

export const totalDue = computed(() => {
  let n = 0;
  for (const s of stats.value.values()) n += s.due;
  return n;
});

export const currentStreak = computed(() => {
  const m = meta.value;
  const today = localDay(now.value);
  if (m.lastPracticeDay === today || m.lastPracticeDay === previousDay(today)) return m.streak;
  return 0;
});

// ---------------------------------------------------------------- lifecycle

export async function init() {
  try {
    const data = await repo.loadAll();
    settings.value = { ...DEFAULT_SETTINGS, ...((data.kv.settings as Partial<Settings>) ?? {}) };
    meta.value = { ...meta.value, ...((data.kv.meta as Partial<Meta>) ?? {}) };
    repertoires.value = data.repertoires.sort((a, b) => a.createdAt - b.createdAt);
    moves.value = data.moves;
    cards.value = new Map(data.cards.map((c) => [c.moveId, c]));
    if (!data.kv.initialized) {
      await createRepertoire('White openings', 'w');
      await createRepertoire('Black openings', 'b');
      await repo.putKv('initialized', true);
    }
    applyTheme();
    // Ask the browser not to evict our data (best effort; Safari may ignore it).
    navigator.storage?.persist?.().catch(() => {});
    ready.value = true;
  } catch (e) {
    loadError.value = String(e);
  }
}

export function applyTheme() {
  document.documentElement.classList.toggle('light', settings.value.theme === 'light');
  const meta = document.querySelector('meta[name="theme-color"]');
  meta?.setAttribute('content', settings.value.theme === 'light' ? '#f3f1ec' : '#161512');
}

export async function updateSettings(patch: Partial<Settings>) {
  settings.value = { ...settings.value, ...patch };
  applyTheme();
  await repo.putKv('settings', settings.value);
}

async function saveMeta(patch: Partial<Meta>) {
  meta.value = { ...meta.value, ...patch };
  await repo.putKv('meta', meta.value);
}

export function markBackedUp() {
  return saveMeta({ lastBackupAt: Date.now() });
}

// ---------------------------------------------------------------- repertoires

export async function createRepertoire(name: string, side: Side): Promise<Repertoire> {
  const r: Repertoire = { id: uid(), name, side, createdAt: Date.now() };
  await repo.putRepertoire(r);
  repertoires.value = [...repertoires.value, r];
  return r;
}

export async function renameRepertoire(id: string, name: string) {
  const r = repertoireById(id);
  if (!r) return;
  const next = { ...r, name };
  await repo.putRepertoire(next);
  repertoires.value = repertoires.value.map((x) => (x.id === id ? next : x));
}

export async function deleteRepertoire(id: string) {
  await repo.deleteRepertoire(id);
  repertoires.value = repertoires.value.filter((r) => r.id !== id);
  moves.value = moves.value.filter((m) => m.repertoireId !== id);
  cards.value = new Map([...cards.value].filter(([, c]) => c.repertoireId !== id));
}

export async function resetProgress(id: string) {
  await repo.resetProgress(id);
  cards.value = new Map([...cards.value].filter(([, c]) => c.repertoireId !== id));
}

// ---------------------------------------------------------------- moves

function makeMove(repId: string, side: Side, p: PlayedMove, g: RepGraph, pending: Move[]): Move {
  const isMine = turnOf(p.fromFen) === side;
  const hasPrimary =
    !!g.primary(p.fromFen) || pending.some((x) => x.fromFen === p.fromFen && x.isMine && x.isPrimary);
  return {
    id: uid(),
    repertoireId: repId,
    fromFen: p.fromFen,
    toFen: p.toFen,
    san: p.san,
    uci: p.uci,
    isMine,
    isPrimary: !isMine || !hasPrimary,
    comment: '',
    createdAt: Date.now(),
  };
}

/**
 * Adds a sequence of moves (a line) to a repertoire, skipping those already saved.
 * Returns the saved Move for each played move, in order.
 */
export async function addLine(repId: string, line: PlayedMove[], comments?: (string | undefined)[]): Promise<Move[]> {
  const r = repertoireById(repId);
  if (!r) return [];
  const g = graphOf(repId);
  const created: Move[] = [];
  const updated: Move[] = [];
  const result: Move[] = [];
  line.forEach((p, i) => {
    const comment = comments?.[i];
    const existing =
      g.findByUci(p.fromFen, p.uci) ?? created.find((m) => m.fromFen === p.fromFen && m.uci === p.uci);
    if (existing) {
      if (comment && !existing.comment.includes(comment)) {
        const u = { ...existing, comment: existing.comment ? `${existing.comment} ${comment}` : comment };
        updated.push(u);
        const ci = created.indexOf(existing);
        if (ci >= 0) created[ci] = u;
        result.push(u);
      } else result.push(existing);
      return;
    }
    const m = makeMove(repId, r.side, p, g, created);
    if (comment) m.comment = comment;
    created.push(m);
    result.push(m);
  });
  const toSave = [...created, ...updated.filter((u) => !created.includes(u))];
  if (toSave.length) {
    await repo.putMoves(toSave);
    const ids = new Set(toSave.map((m) => m.id));
    moves.value = [...moves.value.filter((m) => !ids.has(m.id)), ...toSave];
  }
  return result;
}

export async function addMove(repId: string, p: PlayedMove): Promise<Move> {
  return (await addLine(repId, [p]))[0];
}

/** Bulk insert of already-built Move objects (used by PGN import). */
export async function insertMoves(list: Move[]) {
  if (!list.length) return;
  await repo.putMoves(list);
  const ids = new Set(list.map((m) => m.id));
  moves.value = [...moves.value.filter((m) => !ids.has(m.id)), ...list];
}

async function updateMoves(changed: Move[]) {
  if (!changed.length) return;
  await repo.putMoves(changed);
  const map = new Map(changed.map((m) => [m.id, m]));
  moves.value = moves.value.map((m) => map.get(m.id) ?? m);
}

/** Makes one of my moves the drilled ("main") move at its position. */
export async function setPrimary(moveId: string) {
  const m = moves.value.find((x) => x.id === moveId);
  if (!m || !m.isMine) return;
  const changed = moves.value
    .filter((x) => x.repertoireId === m.repertoireId && x.fromFen === m.fromFen && x.isMine)
    .filter((x) => x.isPrimary !== (x.id === moveId))
    .map((x) => ({ ...x, isPrimary: x.id === moveId }));
  await updateMoves(changed);
}

export async function setComment(moveId: string, comment: string) {
  const m = moves.value.find((x) => x.id === moveId);
  if (m) await updateMoves([{ ...m, comment }]);
}

/** Number of moves that deleting `moveId` would remove. */
export function deleteCount(moveId: string): number {
  const m = moves.value.find((x) => x.id === moveId);
  if (!m) return 0;
  return subtreeToDelete(graphOf(m.repertoireId), moveId).length;
}

export async function deleteMove(moveId: string) {
  const m = moves.value.find((x) => x.id === moveId);
  if (!m) return;
  const ids = subtreeToDelete(graphOf(m.repertoireId), moveId);
  await repo.deleteMoves(ids);
  const gone = new Set(ids);
  moves.value = moves.value.filter((x) => !gone.has(x.id));
  cards.value = new Map([...cards.value].filter(([id]) => !gone.has(id)));
  // If the drilled move was deleted, promote the oldest alternative.
  if (m.isMine && m.isPrimary) {
    const alt = moves.value
      .filter((x) => x.repertoireId === m.repertoireId && x.fromFen === m.fromFen && x.isMine)
      .sort((a, b) => a.createdAt - b.createdAt)[0];
    if (alt) await setPrimary(alt.id);
  }
}

// ---------------------------------------------------------------- reviews

export async function recordReview(m: Move, grade: Grade) {
  const t = Date.now();
  const next = review(cardFor(m), grade, t);
  cards.value = new Map(cards.value).set(m.id, next);
  await repo.putCard(next);
  await repo.addReviewLog({ moveId: m.id, repertoireId: m.repertoireId, ts: t, grade });
  const today = localDay(t);
  const mt = meta.value;
  if (mt.lastPracticeDay !== today) {
    const streak = mt.lastPracticeDay === previousDay(today) ? mt.streak + 1 : 1;
    await saveMeta({ streak, lastPracticeDay: today });
  }
}

/** Reloads everything from IndexedDB (after a restore). */
export async function reload() {
  ready.value = false;
  await init();
}
