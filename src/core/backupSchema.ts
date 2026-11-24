import { playMove, turnOf } from './fen';
import type { CardState, GameFinding, LichessGame, Move, Repertoire, ReviewLog } from './types';

export const BACKUP_APP = 'repertoire-trainer';
/** Version of the backup file format (matches the IndexedDB schema version it was made from). */
export const BACKUP_SCHEMA = 2;

export interface BackupData {
  repertoires: Repertoire[];
  moves: Move[];
  cards: CardState[];
  reviewLogs: ReviewLog[];
  kv: Record<string, unknown>;
  lichessGames: LichessGame[];
  findings: GameFinding[];
}

export interface BackupFile {
  app: typeof BACKUP_APP;
  schemaVersion: number;
  appVersion: string;
  exportedAt: string;
  deviceLabel: string;
  /** False when raw Lichess games were left out to keep the file small. */
  gamesIncluded: boolean;
  data: BackupData;
}

export class BackupError extends Error {
  constructor(public problems: string[]) {
    super(problems.length === 1 ? problems[0] : `${problems.length} problems found:\n• ${problems.slice(0, 8).join('\n• ')}`);
    this.name = 'BackupError';
  }
}

const isLocalKey = (k: string) => k.startsWith('secret:') || k.startsWith('local:');

export function makeBackup(
  data: BackupData,
  opts: { appVersion: string; deviceLabel: string; includeGames?: boolean },
): string {
  const includeGames = opts.includeGames !== false;
  const kv: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(data.kv)) if (!isLocalKey(k)) kv[k] = v; // never export secrets
  const file: BackupFile = {
    app: BACKUP_APP,
    schemaVersion: BACKUP_SCHEMA,
    appVersion: opts.appVersion,
    exportedAt: new Date().toISOString(),
    deviceLabel: opts.deviceLabel,
    gamesIncluded: includeGames,
    data: { ...data, kv, lichessGames: includeGames ? data.lichessGames : [] },
  };
  return JSON.stringify(file);
}

export function summarize(d: Pick<BackupData, 'repertoires' | 'moves' | 'cards' | 'lichessGames'>): string {
  const p = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;
  return [p(d.repertoires.length, 'repertoire'), p(d.moves.length, 'move'), p(d.cards.length, 'card'), p(d.lichessGames.length, 'game')].join(' · ');
}

// ---------------------------------------------------------------- migrations

/** MIGRATE[n] upgrades backup data from format n to n + 1. Never remove old steps. */
const MIGRATE: Record<number, (d: any) => any> = {
  1: (d) => ({ ...d, lichessGames: [], findings: [] }),
};

// ---------------------------------------------------------------- validation

const FEN4 = /^([pnbrqkPNBRQK1-8]{1,8}\/){7}[pnbrqkPNBRQK1-8]{1,8} [wb] (-|[KQkq]{1,4}) (-|[a-h][36])$/;
const UCI = /^[a-h][1-8][a-h][1-8][qrbn]?$/;
const str = (v: unknown) => typeof v === 'string';
const num = (v: unknown) => typeof v === 'number' && Number.isFinite(v);
const bool = (v: unknown) => typeof v === 'boolean';

export interface ParsedBackup {
  data: BackupData;
  meta: { schemaVersion: number; appVersion: string; exportedAt: string; deviceLabel: string; gamesIncluded: boolean };
  /** Non-fatal clean-ups that were applied (orphan cards dropped, etc.). */
  warnings: string[];
}

/**
 * Parses, migrates and fully validates a backup BEFORE anything is written.
 * Throws BackupError listing every problem; never returns partially valid data.
 */
export function parseBackup(input: string | unknown, currentSchema = BACKUP_SCHEMA): ParsedBackup {
  let f: any = input;
  if (typeof input === 'string') {
    try {
      f = JSON.parse(input);
    } catch {
      throw new BackupError(['This file is not valid JSON.']);
    }
  }
  if (!f || typeof f !== 'object' || f.app !== BACKUP_APP || !f.data || typeof f.data !== 'object')
    throw new BackupError(['This is not a Repertoire Trainer backup file.']);
  if (!Number.isInteger(f.schemaVersion) || f.schemaVersion < 1)
    throw new BackupError(['The backup has no valid schema version.']);
  if (f.schemaVersion > currentSchema)
    throw new BackupError(['This backup was made by a newer version of the app. Update the app first (reopen it while online).']);

  let d = f.data;
  for (let v = f.schemaVersion; v < currentSchema; v++) d = MIGRATE[v](d);

  const problems: string[] = [];
  const warnings: string[] = [];
  const bad = (msg: string) => problems.length < 50 && problems.push(msg);

  for (const k of ['repertoires', 'moves', 'cards', 'reviewLogs', 'lichessGames', 'findings'])
    if (!Array.isArray(d[k])) bad(`"${k}" is missing or not a list.`);
  if (d.kv !== undefined && (typeof d.kv !== 'object' || d.kv === null || Array.isArray(d.kv))) bad('"kv" is not an object.');
  if (problems.length) throw new BackupError(problems);

  // Repertoires
  const reps = new Map<string, Repertoire>();
  d.repertoires.forEach((r: any, i: number) => {
    if (!r || !str(r.id) || !r.id || !str(r.name) || (r.side !== 'w' && r.side !== 'b') || !num(r.createdAt))
      return bad(`Repertoire #${i + 1} is malformed.`);
    if (reps.has(r.id)) return bad(`Repertoire id "${r.id}" appears twice.`);
    reps.set(r.id, r);
  });

  // Moves: structure, ownership, and that each move really leads from fromFen to toFen.
  const moveIds = new Set<string>();
  const primaries = new Map<string, Move>();
  const moves: Move[] = [];
  d.moves.forEach((m: any, i: number) => {
    const where = `Move #${i + 1}${m && str(m.san) ? ` (${m.san})` : ''}`;
    if (!m || !str(m.id) || !m.id || !str(m.repertoireId) || !str(m.fromFen) || !str(m.toFen) || !str(m.san) || !str(m.uci))
      return bad(`${where} is malformed.`);
    if (!bool(m.isMine) || !bool(m.isPrimary) || !num(m.createdAt)) return bad(`${where} is malformed.`);
    if (moveIds.has(m.id)) return bad(`${where}: id appears twice.`);
    const rep = reps.get(m.repertoireId);
    if (!rep) return bad(`${where} belongs to a repertoire that isn't in the backup.`);
    if (!FEN4.test(m.fromFen) || !FEN4.test(m.toFen) || !UCI.test(m.uci)) return bad(`${where} has an invalid position or move.`);
    const p = playMove(m.fromFen, { from: m.uci.slice(0, 2), to: m.uci.slice(2, 4), promotion: m.uci[4] });
    if (!p || p.toFen !== m.toFen) return bad(`${where} is not a legal move from its position.`);
    if (m.isMine !== (turnOf(m.fromFen) === rep.side)) return bad(`${where} has the wrong side to move.`);
    moveIds.add(m.id);
    const mv: Move = { ...m, comment: str(m.comment) ? m.comment : '', san: p.san };
    if (mv.isMine && mv.isPrimary) {
      const key = mv.repertoireId + '|' + mv.fromFen;
      if (primaries.has(key)) {
        mv.isPrimary = false; // repair: only one drilled move per position
        warnings.push(`Two main moves at one position — kept the first, made ${mv.san} an alternative.`);
      } else primaries.set(key, mv);
    }
    moves.push(mv);
  });

  // Cards
  const cards: CardState[] = [];
  let orphanCards = 0;
  d.cards.forEach((c: any, i: number) => {
    if (!c || !str(c.moveId) || !str(c.repertoireId)) return bad(`Card #${i + 1} is malformed.`);
    for (const k of ['due', 'stability', 'difficulty', 'scheduledDays', 'reps', 'lapses', 'state'])
      if (!num(c[k])) return bad(`Card #${i + 1} has an invalid "${k}".`);
    if (c.lastReview !== null && c.lastReview !== undefined && !num(c.lastReview)) return bad(`Card #${i + 1} has an invalid "lastReview".`);
    if (!moveIds.has(c.moveId)) return void orphanCards++;
    cards.push({ learningSteps: 0, wrong: 0, right: 0, lastReview: null, ...c });
  });
  if (orphanCards) warnings.push(`Dropped ${orphanCards} practice card(s) for moves that no longer exist.`);

  // Review logs
  const reviewLogs: ReviewLog[] = [];
  d.reviewLogs.forEach((l: any, i: number) => {
    if (!l || !str(l.moveId) || !str(l.repertoireId) || !num(l.ts) || !['again', 'hard', 'good'].includes(l.grade))
      return bad(`Review log #${i + 1} is malformed.`);
    reviewLogs.push(l);
  });

  // Lichess games
  const gameIds = new Set<string>();
  const lichessGames: LichessGame[] = [];
  d.lichessGames.forEach((g: any, i: number) => {
    if (!g || !str(g.id) || !/^[A-Za-z0-9]{8,12}$/.test(g.id) || !num(g.playedAt) || (g.myColor !== 'w' && g.myColor !== 'b') || !str(g.moves))
      return bad(`Game #${i + 1} is malformed.`);
    if (!['win', 'draw', 'loss', 'unknown'].includes(g.result)) return bad(`Game #${i + 1} has an invalid result.`);
    if (gameIds.has(g.id)) return;
    gameIds.add(g.id);
    lichessGames.push({
      ...g,
      opponent: str(g.opponent) ? g.opponent : '?',
      eco: str(g.eco) ? g.eco : '',
      openingName: str(g.openingName) ? g.openingName : '',
      speed: str(g.speed) ? g.speed : '',
      rated: bool(g.rated) ? g.rated : true,
      myRating: num(g.myRating) ? g.myRating : null,
      oppRating: num(g.oppRating) ? g.oppRating : null,
      analyzedAt: num(g.analyzedAt) ? g.analyzedAt : null,
      user: str(g.user) ? g.user : undefined,
      evals: Array.isArray(g.evals)
        ? g.evals.map((e: any) =>
            e && (num(e.cp) || num(e.mate)) ? { cp: num(e.cp) ? e.cp : undefined, mate: num(e.mate) ? e.mate : undefined } : null,
          )
        : undefined,
    });
  });

  // Findings
  const findings: GameFinding[] = [];
  d.findings.forEach((x: any, i: number) => {
    if (!x || !str(x.id) || !str(x.gameId) || !str(x.repertoireId) || !str(x.fen) || !num(x.ply) || !str(x.playedSan))
      return bad(`Finding #${i + 1} is malformed.`);
    if (!['deviation', 'gap', 'outOfBook', 'followed'].includes(x.type) || !['new', 'drilled', 'added', 'dismissed'].includes(x.status))
      return bad(`Finding #${i + 1} has an invalid type or status.`);
    if (!FEN4.test(x.fen)) return bad(`Finding #${i + 1} has an invalid position.`);
    if (!reps.has(x.repertoireId)) return; // repertoire was deleted: drop silently
    findings.push({ createdAt: 0, ...x });
  });

  if (problems.length) throw new BackupError(problems);

  const kv: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(d.kv ?? {})) if (!isLocalKey(k)) kv[k] = v;

  return {
    data: { repertoires: [...reps.values()], moves, cards, reviewLogs, kv, lichessGames, findings },
    meta: {
      schemaVersion: f.schemaVersion,
      appVersion: str(f.appVersion) ? f.appVersion : 'unknown',
      exportedAt: str(f.exportedAt) ? f.exportedAt : '',
      deviceLabel: str(f.deviceLabel) ? f.deviceLabel : '',
      gamesIncluded: f.gamesIncluded !== false,
    },
    warnings,
  };
}
