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
