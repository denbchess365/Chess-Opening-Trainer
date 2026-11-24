import { makeBackup, parseBackup, summarize, type ParsedBackup } from '../core/backupSchema';
import { exportPgn, parsePgn } from '../core/pgn';
import { computed, signal } from '@preact/signals';
import * as repo from '../db/repo';
import { normalizeFen, ROOT, turnOf, type PlayedMove } from '../core/fen';
import { localDay, previousDay, uid } from '../core/ids';
import { isDue, isMastered, newCard, review } from '../core/scheduler';
import { completeness, drillableMoves, RepGraph, subtreeToDelete } from '../core/tree';
import {
  DEFAULT_LICHESS,
  DEFAULT_SETTINGS,
  type LichessSettings,
  type CardState,
  type GameFinding,
  type Grade,
  type LichessGame,
  type Collection,
  type Position,
  type PracticeRun,
  positionCardId,
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
export const lichessGames = signal<LichessGame[]>([]);
export const positions = signal<Position[]>([]);
export const collections = signal<Collection[]>([]);
export const practiceRuns = signal<PracticeRun[]>([]);
/** Lichess preferences (synced with backups). */
export const lichessSettings = signal<LichessSettings>({ ...DEFAULT_LICHESS });
export const findings = signal<GameFinding[]>([]);
/** Device-local key/values (token, Gist id, sync state). Never exported. */
export const localKv = signal<Record<string, unknown>>({});
/** Result of navigator.storage.persist(): true, false, or null when unsupported. */
export const storagePersisted = signal<boolean | null>(null);
/** Increments on every change to user data. */
export const changeSeq = signal(0);
repo.onDataWrite(() => changeSeq.value++);

export const APP_VERSION: string = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : 'dev';

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
  for (const r of repertoires.value) out.set(r.id, new RepGraph(r.side, byRep.get(r.id) ?? [], r.startFen ?? ROOT));
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

/** Due opening moves (position line sets are counted under positionsDue). */
export const totalDue = computed(() => {
  let n = 0;
  for (const r of repertoires.value) if (r.kind !== 'position') n += stats.value.get(r.id)?.due ?? 0;
  return n;
});

/** Due position items: play-out cards plus moves in position line sets. */
export const positionsDue = computed(() => {
  const t = Math.max(now.value, Date.now());
  let playouts = 0;
  let lineMoves = 0;
  for (const p of positions.value) {
    if (p.practiceModes.includes('playOut') && isDue(positionCard(p), t)) playouts++;
    if (p.practiceModes.includes('lines') && p.repertoireId) lineMoves += stats.value.get(p.repertoireId)?.due ?? 0;
  }
  return { playouts, lineMoves, total: playouts + lineMoves };
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
    lichessSettings.value = { ...DEFAULT_LICHESS, ...((data.kv.lichess as Partial<LichessSettings>) ?? {}) };
    repertoires.value = data.repertoires.sort((a, b) => a.createdAt - b.createdAt);
    moves.value = data.moves;
    cards.value = new Map(data.cards.map((c) => [c.moveId, c]));
    lichessGames.value = data.lichessGames.sort((a, b) => b.playedAt - a.playedAt);
    findings.value = data.findings;
    positions.value = data.positions.sort((a, b) => b.createdAt - a.createdAt);
    collections.value = data.collections.sort((a, b) => a.name.localeCompare(b.name));
    practiceRuns.value = data.practiceRuns.sort((a, b) => a.finishedAt - b.finishedAt);
    localKv.value = await repo.loadLocalKv();
    if (!data.kv.initialized) {
      await createRepertoire('White openings', 'w');
      await createRepertoire('Black openings', 'b');
      await repo.putKv('initialized', true);
    }
    applyTheme();
    ready.value = true;
    requestPersistence();
  } catch (e) {
    loadError.value = String(e);
  }
}

/** Asks the browser not to evict our data. Safari grants this mostly to installed home-screen apps. */
export async function requestPersistence() {
  try {
    if (!navigator.storage?.persist) {
      storagePersisted.value = null;
      return;
    }
    storagePersisted.value = (await navigator.storage.persisted?.()) || (await navigator.storage.persist());
  } catch {
    storagePersisted.value = false;
  }
}

export async function setLocal(key: string, value: unknown) {
  if (!key.startsWith('local:') && !key.startsWith('secret:')) throw new Error('not a local key');
  localKv.value = { ...localKv.value, [key]: value };
  await repo.putKv(key, value);
}

export async function removeLocal(key: string) {
  const next = { ...localKv.value };
  delete next[key];
  localKv.value = next;
  await repo.deleteKv(key);
}

export function deviceLabel(): string {
  const saved = localKv.value['local:deviceLabel'];
  if (typeof saved === 'string' && saved) return saved;
  const ua = navigator.userAgent;
  return /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Android/.test(ua) ? 'Android' : /Mac/.test(ua) ? 'Mac' : 'Browser';
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

export async function updateLichessSettings(patch: Partial<LichessSettings>) {
  lichessSettings.value = { ...lichessSettings.value, ...patch };
  await repo.putKv('lichess', lichessSettings.value);
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
  await takeSnapshot(`Before deleting “${repertoireById(id)?.name ?? 'repertoire'}”`);
  await repo.deleteRepertoire(id);
  await repo.deleteFindingsForRepertoire(id);
  findings.value = findings.value.filter((f) => f.repertoireId !== id);
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

/** Deleting at least this many moves at once counts as a bulk delete (a snapshot is taken first). */
const BULK_DELETE = 5;

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
  if (ids.length >= BULK_DELETE) await takeSnapshot(`Before deleting ${m.san} and ${ids.length - 1} following moves`);
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
  await reviewCard(cardFor(m), grade);
}

/** Applies a grade to any card (opening move, position line move or play-out card) and updates the streak. */
async function reviewCard(card: CardState, grade: Grade) {
  const t = Date.now();
  const next = review(card, grade, t);
  cards.value = new Map(cards.value).set(card.moveId, next);
  await repo.putCard(next);
  await repo.addReviewLog({ moveId: card.moveId, repertoireId: card.repertoireId, ts: t, grade });
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

// ---------------------------------------------------------------- import / export


export interface PgnImportResult {
  games: number;
  added: number;
  errors: string[];
  /** True when nothing was written because the file had errors and partial import wasn't allowed. */
  aborted: boolean;
}

/**
 * Imports PGN all-or-nothing: if any move is illegal nothing is written, unless
 * `allowPartial` is set (then the bad lines are skipped). A snapshot is taken first.
 */
export async function importPgnText(repId: string, text: string, opts: { allowPartial?: boolean } = {}): Promise<PgnImportResult> {
  const r = parsePgn(text);
  if (!repertoireById(repId)) return { games: r.games, added: 0, errors: ['Repertoire not found.'], aborted: true };
  if (r.errors.length && !opts.allowPartial) return { games: r.games, added: 0, errors: r.errors, aborted: true };
  if (!r.edges.length) return { games: r.games, added: 0, errors: [...r.errors, 'No moves found in this PGN.'], aborted: true };
  await takeSnapshot('Before PGN import');
  const before = moves.value.length;
  await addLine(
    repId,
    r.edges.map((e) => e.played),
    r.edges.map((e) => e.comment || undefined),
  );
  return { games: r.games, added: moves.value.length - before, errors: r.errors, aborted: false };
}

export function exportPgnText(repId: string): string {
  const r = repertoireById(repId);
  return exportPgn(graphOf(repId), r?.name ?? 'Repertoire');
}

export async function backupText(opts: { includeGames?: boolean } = {}): Promise<string> {
  return makeBackup(await repo.loadAll(), { appVersion: APP_VERSION, deviceLabel: deviceLabel(), ...opts });
}

// ---------------------------------------------------------------- snapshots & restore

/** Saves the current data as a local snapshot (the newest 5 are kept). */
export async function takeSnapshot(reason: string) {
  const data = await repo.loadAll();
  await repo.addSnapshot({
    createdAt: Date.now(),
    reason,
    json: makeBackup(data, { appVersion: APP_VERSION, deviceLabel: deviceLabel() }),
    summary: summarize(data),
  });
}

/** Validates a backup (JSON text or parsed object) without writing anything. */
export function validateBackup(input: string | unknown): ParsedBackup {
  return parseBackup(input);
}

/**
 * Restores validated backup data. A snapshot of the current data is taken first
 * so the restore can be undone. All writes happen in one transaction.
 * Backups made without raw games keep the games already on this device.
 */
export async function restoreParsed(parsed: ParsedBackup, reason: string) {
  await takeSnapshot(reason);
  const d = parsed.data;
  const games = parsed.meta.gamesIncluded ? d.lichessGames : (await repo.loadAll()).lichessGames;
  await repo.replaceAll({ ...d, lichessGames: games, kv: { ...d.kv, initialized: true } });
  await reload();
}

export async function restoreBackup(text: string) {
  const parsed = parseBackup(text);
  await restoreParsed(parsed, 'Before restoring a backup file');
  return parsed;
}

export async function restoreSnapshot(id: number) {
  const snap = await repo.getSnapshot(id);
  if (!snap) throw new Error('Snapshot not found.');
  const parsed = parseBackup(snap.json);
  await restoreParsed(parsed, 'Before restoring a snapshot');
}

// ---------------------------------------------------------------- backup reminder

export const BACKUP_REMINDER_DAYS = 7;

/** Most recent successful backup of any kind (manual export or Gist). */
export const lastAnyBackup = computed(() => {
  const gist = localKv.value['local:gist'] as { lastSuccessAt?: number } | undefined;
  return Math.max(meta.value.lastBackupAt ?? 0, gist?.lastSuccessAt ?? 0) || null;
});

export const showBackupReminder = computed(() => {
  if (!moves.value.length) return false;
  const t = Math.max(now.value, Date.now());
  const last = lastAnyBackup.value;
  if (last && t - last < BACKUP_REMINDER_DAYS * 86400_000) return false;
  const dismissed = localKv.value['local:reminderDismissedAt'];
  // A dismissal snoozes the banner for a day.
  return !(typeof dismissed === 'number' && t - dismissed < 86400_000);
});

export function dismissBackupReminder() {
  return setLocal('local:reminderDismissedAt', Date.now());
}

// ---------------------------------------------------------------- positions & collections

/** Opening repertoires only (position line sets are hidden from the repertoire lists). */
export const openingRepertoires = computed(() => repertoires.value.filter((r) => r.kind !== 'position'));

export function positionById(id: string): Position | undefined {
  return positions.value.find((p) => p.id === id);
}

/** The play-out (Mode A) card of a position. New positions are due immediately. */
export function positionCard(p: Position): CardState {
  return cards.value.get(positionCardId(p.id)) ?? newCard(positionCardId(p.id), 'positions', p.createdAt);
}

export async function savePosition(p: Position) {
  await repo.putPosition(p);
  const rest = positions.value.filter((x) => x.id !== p.id);
  positions.value = [p, ...rest].sort((a, b) => b.createdAt - a.createdAt);
  // Keep the hidden line set's name/side in sync.
  if (p.repertoireId) {
    const r = repertoireById(p.repertoireId);
    if (r && (r.name !== p.title || r.side !== p.mySide)) {
      const next = { ...r, name: p.title || 'Position', side: p.mySide };
      await repo.putRepertoire(next);
      repertoires.value = repertoires.value.map((x) => (x.id === r.id ? next : x));
    }
  }
  return p;
}

export function newPosition(fen: string, patch: Partial<Position> = {}): Position {
  const turn = fen.split(' ')[1] === 'b' ? 'b' : 'w';
  return {
    id: uid(),
    fen,
    title: '',
    note: '',
    tags: [],
    collectionId: null,
    goal: 'win',
    mySide: turn,
    practiceModes: ['playOut'],
    source: 'editor',
    createdAt: Date.now(),
    ...patch,
  };
}

export async function removePosition(p: Position) {
  await takeSnapshot(`Before deleting position “${p.title || p.fen.split(' ')[0]}”`);
  await repo.deletePosition(p);
  positions.value = positions.value.filter((x) => x.id !== p.id);
  practiceRuns.value = practiceRuns.value.filter((r) => r.positionId !== p.id);
  const gone = new Set([positionCardId(p.id)]);
  if (p.repertoireId) {
    repertoires.value = repertoires.value.filter((r) => r.id !== p.repertoireId);
    for (const m of moves.value) if (m.repertoireId === p.repertoireId) gone.add(m.id);
    moves.value = moves.value.filter((m) => m.repertoireId !== p.repertoireId);
  }
  cards.value = new Map([...cards.value].filter(([id]) => !gone.has(id)));
}

export async function createCollection(name: string): Promise<Collection> {
  const c: Collection = { id: uid(), name: name.trim(), createdAt: Date.now() };
  await repo.putCollection(c);
  collections.value = [...collections.value, c].sort((a, b) => a.name.localeCompare(b.name));
  return c;
}

export async function renameCollection(id: string, name: string) {
  const c = collections.value.find((x) => x.id === id);
  if (!c) return;
  const next = { ...c, name: name.trim() };
  await repo.putCollection(next);
  collections.value = collections.value.map((x) => (x.id === id ? next : x)).sort((a, b) => a.name.localeCompare(b.name));
}

export async function deleteCollection(id: string) {
  await repo.deleteCollection(id);
  collections.value = collections.value.filter((c) => c.id !== id);
  positions.value = positions.value.map((p) => (p.collectionId === id ? { ...p, collectionId: null } : p));
}

/** All tags in use, for filters and suggestions. */
export const allTags = computed(() => [...new Set(positions.value.flatMap((p) => p.tags))].sort());

// ---------------------------------------------------------------- play-outs (Mode A)

/** Saves a finished play-out; for a saved position also grades its play-out card. */
export async function finishRun(run: PracticeRun, opts: { grade?: Grade } = {}) {
  const withGrade = { ...run, grade: opts.grade };
  await repo.putRun(withGrade);
  practiceRuns.value = [...practiceRuns.value, withGrade];
  const p = run.positionId ? positionById(run.positionId) : undefined;
  if (p && opts.grade) await reviewCard(positionCard(p), opts.grade);
  return withGrade;
}

export function runsFor(positionId: string): PracticeRun[] {
  return practiceRuns.value.filter((r) => r.positionId === positionId);
}

/**
 * Returns the hidden repertoire that holds a position's Mode B lines, creating it (and
 * turning on "Drill lines") if needed. The tree starts at the position's FEN.
 */
export async function ensureLinesRepertoire(p: Position): Promise<Repertoire> {
  const existing = p.repertoireId ? repertoireById(p.repertoireId) : undefined;
  if (existing) {
    if (!p.practiceModes.includes('lines')) await savePosition({ ...p, practiceModes: [...p.practiceModes, 'lines'] });
    return existing;
  }
  const r: Repertoire = {
    id: uid(),
    name: p.title || 'Position',
    side: p.mySide,
    createdAt: Date.now(),
    startFen: normalizeFen(p.fen),
    kind: 'position',
    positionId: p.id,
  };
  await repo.putRepertoire(r);
  repertoires.value = [...repertoires.value, r];
  await savePosition({ ...p, repertoireId: r.id, practiceModes: p.practiceModes.includes('lines') ? p.practiceModes : [...p.practiceModes, 'lines'] });
  return r;
}

/** Finds a saved position with the same placement/side/castling/ep (clocks ignored). */
export function findPositionByFen(fen: string): Position | undefined {
  const key = normalizeFen(fen);
  return positions.value.find((p) => normalizeFen(p.fen) === key);
}
