export type Side = 'w' | 'b';

export interface Repertoire {
  id: string;
  name: string;
  side: Side;
  createdAt: number;
  /** Normalized FEN the tree starts from (default: the standard start position). */
  startFen?: string;
  /** 'position' = hidden line set belonging to a saved position (Mode B). */
  kind?: 'opening' | 'position';
  positionId?: string;
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
  /** Include saved positions in Daily practice. */
  positionsInDaily: boolean;
  /** Share of the daily size given to positions (0..1). */
  positionsRatio: number;
  /** Move-quality feedback during play-outs. */
  playoutFeedback: 'immediate' | 'end' | 'off';
  playoutFeedbackDepth: number;
  /** Engine depth for the defending side in play-outs (raised automatically with few pieces). */
  defenderDepth: number;
  /** Use the Lichess tablebase (≤ 7 pieces) when online. */
  useTablebase: boolean;
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
  positionsInDaily: true,
  positionsRatio: 0.2,
  playoutFeedback: 'immediate',
  playoutFeedbackDepth: 12,
  defenderDepth: 18,
  useTablebase: true,
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

// ---------------------------------------------------------------- v3: positions & endgame training

export type PositionGoal = 'win' | 'draw' | 'bestMove';
export type PracticeKind = 'playOut' | 'lines';
export type PositionSource = 'editor' | 'fen' | 'pgn' | 'lichess' | 'line' | 'playout';

export interface Position {
  id: string;
  /** Full FEN (clocks kept: the halfmove clock matters for the 50-move rule). */
  fen: string;
  title: string;
  note: string;
  tags: string[];
  collectionId: string | null;
  goal: PositionGoal;
  mySide: Side;
  practiceModes: PracticeKind[];
  source: PositionSource;
  /** Hidden repertoire holding this position's Mode B lines (created on demand). */
  repertoireId?: string;
  createdAt: number;
}

export interface Collection {
  id: string;
  name: string;
  createdAt: number;
}

export type RunResult = 'win' | 'draw' | 'loss' | 'fail' | 'gaveUp' | 'solved' | 'wrong';

export interface PracticeRun {
  id: string;
  positionId?: string;
  startFen: string;
  /** All moves of the game in UCI, both sides, from startFen. */
  moves: string[];
  result: RunResult;
  /** Why it ended, e.g. "Checkmate", "Stalemate!", "50-move rule — draw". */
  reason: string;
  success: boolean;
  hintsUsed: number;
  /** Number of my moves. */
  movesTaken: number;
  /** Engine's (or tablebase's) mate distance in moves from the start, when known. */
  engineDtm?: number;
  /** Eval notes per ply (from my point of view, centipawns; mate = ±10000∓n). */
  evals?: (number | null)[];
  grade?: 'again' | 'hard' | 'good';
  finishedAt: number;
}

export const POS_CARD_PREFIX = 'pos:';
/** Card key of a saved position's Mode A (play it out) card. */
export const positionCardId = (positionId: string) => POS_CARD_PREFIX + positionId;
