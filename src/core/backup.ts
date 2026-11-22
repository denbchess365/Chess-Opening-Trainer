import type { CardState, Move, Repertoire, ReviewLog } from './types';

export const BACKUP_APP = 'repertoire-trainer';

export interface BackupData {
  repertoires: Repertoire[];
  moves: Move[];
  cards: CardState[];
  reviewLogs: ReviewLog[];
  kv: Record<string, unknown>;
}

export interface BackupFile {
  app: typeof BACKUP_APP;
  schemaVersion: number;
  exportedAt: string;
  data: BackupData;
}

export function makeBackup(data: BackupData, schemaVersion: number): string {
  const file: BackupFile = { app: BACKUP_APP, schemaVersion, exportedAt: new Date().toISOString(), data };
  return JSON.stringify(file);
}

/**
 * Validates a backup file and upgrades older formats. Throws a readable error
 * if the file isn't a Repertoire Trainer backup or comes from a newer app version.
 */
export function parseBackup(text: string, currentSchema: number): BackupData {
  let f: any;
  try {
    f = JSON.parse(text);
  } catch {
    throw new Error('This file is not valid JSON.');
  }
  if (!f || f.app !== BACKUP_APP || !f.data) throw new Error('This is not a Repertoire Trainer backup file.');
  if (typeof f.schemaVersion !== 'number' || f.schemaVersion > currentSchema)
    throw new Error('This backup was made by a newer version of the app. Update the app first.');
  const d = f.data;
  for (const k of ['repertoires', 'moves', 'cards', 'reviewLogs'])
    if (!Array.isArray(d[k])) throw new Error(`Backup is missing "${k}".`);
  // Future format upgrades go here: if (f.schemaVersion < 2) { ... }
  const repIds = new Set(d.repertoires.map((r: Repertoire) => r.id));
  return {
    repertoires: d.repertoires,
    moves: d.moves.filter((m: Move) => repIds.has(m.repertoireId)),
    cards: d.cards.filter((c: CardState) => repIds.has(c.repertoireId)),
    reviewLogs: d.reviewLogs,
    kv: d.kv && typeof d.kv === 'object' ? d.kv : {},
  };
}
