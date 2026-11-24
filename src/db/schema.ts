import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { CardState, GameFinding, LichessGame, Move, Repertoire, ReviewLog, Snapshot } from '../core/types';

export const DB_NAME = 'repertoire-trainer';
/** Bump when the object stores change, and add a step to MIGRATIONS. Never remove old steps. */
export const DB_VERSION = 2;

export interface KV {
  key: string;
  value: unknown;
}

export interface TrainerDB extends DBSchema {
  repertoires: { key: string; value: Repertoire };
  moves: { key: string; value: Move; indexes: { repertoireId: string } };
  cards: { key: string; value: CardState; indexes: { repertoireId: string } };
  reviewLogs: { key: number; value: ReviewLog; indexes: { moveId: string; repertoireId: string } };
  kv: { key: string; value: KV };
  lichessGames: { key: string; value: LichessGame; indexes: { playedAt: number } };
  findings: { key: string; value: GameFinding; indexes: { gameId: string; status: string } };
  snapshots: { key: number; value: Snapshot };
}

type Upgrade = (db: IDBPDatabase<TrainerDB>) => void;

/** MIGRATIONS[n] upgrades a database from version n to n + 1. They only ever add, never drop user data. */
const MIGRATIONS: Upgrade[] = [
  // 0 -> 1: initial schema
  (db) => {
    db.createObjectStore('repertoires', { keyPath: 'id' });
    const moves = db.createObjectStore('moves', { keyPath: 'id' });
    moves.createIndex('repertoireId', 'repertoireId');
    const cards = db.createObjectStore('cards', { keyPath: 'moveId' });
    cards.createIndex('repertoireId', 'repertoireId');
    const logs = db.createObjectStore('reviewLogs', { keyPath: 'id', autoIncrement: true });
    logs.createIndex('moveId', 'moveId');
    logs.createIndex('repertoireId', 'repertoireId');
    db.createObjectStore('kv', { keyPath: 'key' });
  },
  // 1 -> 2: Lichess game review + local snapshots
  (db) => {
    const games = db.createObjectStore('lichessGames', { keyPath: 'id' });
    games.createIndex('playedAt', 'playedAt');
    const findings = db.createObjectStore('findings', { keyPath: 'id' });
    findings.createIndex('gameId', 'gameId');
    findings.createIndex('status', 'status');
    db.createObjectStore('snapshots', { keyPath: 'id', autoIncrement: true });
  },
];

let dbPromise: Promise<IDBPDatabase<TrainerDB>> | null = null;

export function setDbName(name: string) {
  dbName = name;
  dbPromise = null;
}
let dbName = DB_NAME;

export function getDb(name = dbName): Promise<IDBPDatabase<TrainerDB>> {
  if (!dbPromise) {
    dbPromise = openDB<TrainerDB>(name, DB_VERSION, {
      upgrade(db, oldVersion) {
        for (let v = oldVersion; v < DB_VERSION; v++) MIGRATIONS[v](db);
      },
      blocking() {
        // A newer version of the app opened the DB in another tab: release it.
        dbPromise?.then((d) => d.close());
        dbPromise = null;
      },
    });
  }
  return dbPromise;
}

/** For tests. */
export function resetDbHandle() {
  dbPromise = null;
}
