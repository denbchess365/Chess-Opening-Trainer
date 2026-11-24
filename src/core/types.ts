export type Side = 'w' | 'b';

export interface Repertoire {
  id: string;
  name: string;
  side: Side;
  createdAt: number;
}

/** An edge in the repertoire graph. Positions (nodes) are implied by normalized FENs. */
export interface Move {
  id: string;
  repertoireId: string;
  fromFen: string;
  toFen: string;
  san: string;
  uci: string;
  /** True when it is the repertoire owner's move (side to move at fromFen === repertoire.side). */
  isMine: boolean;
  /** For my moves: the one move I'm drilled on at this position. Opponent moves are always primary. */
  isPrimary: boolean;
  comment: string;
  createdAt: number;
}

/** Spaced-repetition state for one of my primary moves (FSRS). Dates are epoch ms. */
export interface CardState {
  moveId: string;
  repertoireId: string;
  due: number;
  stability: number;
  difficulty: number;
  scheduledDays: number;
  learningSteps: number;
  reps: number;
  lapses: number;
  /** 0 New, 1 Learning, 2 Review, 3 Relearning */
  state: number;
  lastReview: number | null;
  /** Lifetime counters used for "moves I often get wrong". */
  wrong: number;
  right: number;
}

export type Grade = 'again' | 'hard' | 'good';

export interface ReviewLog {
  id?: number;
  moveId: string;
  repertoireId: string;
  ts: number;
  grade: Grade;
}

export interface Settings {
  boardTheme: 'green' | 'brown' | 'blue';
  pieceSet: 'cburnett' | 'merida' | 'chessnut';
  sound: boolean;
  theme: 'dark' | 'light';
  engineDepth: number;
  /** 0 = no time limit */
  engineMaxSeconds: number;
  engineOn: boolean;
  dailySize: number;
  autoSave: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  boardTheme: 'green',
  pieceSet: 'cburnett',
  sound: true,
  theme: 'dark',
  engineDepth: 18,
  engineMaxSeconds: 0,
  engineOn: false,
  dailySize: 15,
  autoSave: true,
};

export interface Meta {
  streak: number;
  lastPracticeDay: string | null;
  lastBackupAt: number | null;
}

// ---------------------------------------------------------------- v2: Lichess review

export type Speed = 'ultraBullet' | 'bullet' | 'blitz' | 'rapid' | 'classical' | 'correspondence';

export interface LichessGame {
  id: string;
  /** Lowercase Lichess id of the account the game was synced for. */
  user?: string;
  playedAt: number;
  myColor: Side;
  opponent: string;
  myRating: number | null;
  oppRating: number | null;
  /** From my point of view. */
  result: 'win' | 'draw' | 'loss' | 'unknown';
  speed: string;
  rated: boolean;
  eco: string;
  openingName: string;
  /** SAN moves separated by spaces, as Lichess sends them. */
  moves: string;
  /** Lichess server analysis, one entry per ply (White's point of view), when the game was analysed. */
  evals?: ({ cp?: number; mate?: number } | null)[];
  analyzedAt: number | null;
}

export type FindingType = 'deviation' | 'gap' | 'outOfBook' | 'followed';
export type FindingStatus = 'new' | 'drilled' | 'added' | 'dismissed';
export type Severity = 'ok' | 'inaccuracy' | 'mistake' | 'blunder';

export interface GameFinding {
  id: string;
  gameId: string;
  repertoireId: string;
  /** Normalized FEN of the critical position (before the flagged move). */
  fen: string;
  /** 0-based ply index of the flagged move; for 'followed', the number of plies that matched. */
  ply: number;
  type: FindingType;
  playedSan: string;
  playedUci?: string;
  expectedSan?: string;
  /** Evaluations in centipawns from MY point of view (mate mapped to ±10000). */
  evalPlayed?: number;
  evalBest?: number;
  bestSan?: string;
  severity?: Severity;
  evalSource?: 'lichess' | 'engine';
  status: FindingStatus;
  createdAt: number;
}

export interface LichessSettings {
  username: string;
  speeds: Speed[];
  ratedOnly: boolean;
  maxGames: number;
  autoSync: boolean;
  engineCheck: boolean;
  engineDepth: number;
}

export const DEFAULT_LICHESS: LichessSettings = {
  username: '',
  speeds: ['blitz', 'rapid', 'classical'],
  ratedOnly: true,
  maxGames: 50,
  autoSync: false,
  engineCheck: true,
  engineDepth: 15,
};

export interface Snapshot {
  id?: number;
  createdAt: number;
  reason: string;
  /** Serialized backup (same format as the export file). */
  json: string;
  summary: string;
}
