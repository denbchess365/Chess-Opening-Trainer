import { createEmptyCard, fsrs, generatorParameters, Rating, type Card, type Grade as FsrsGrade } from 'ts-fsrs';
import type { CardState, Grade } from './types';

export const MASTERED_DAYS = 21;

const scheduler = fsrs(generatorParameters({ enable_fuzz: true, request_retention: 0.9 }));
const deterministic = fsrs(generatorParameters({ enable_fuzz: false, request_retention: 0.9 }));

export function newCard(moveId: string, repertoireId: string, now = Date.now()): CardState {
  return fromFsrs(createEmptyCard(new Date(now)), moveId, repertoireId, 0, 0);
}

function toFsrs(c: CardState): Card {
  return {
    due: new Date(c.due),
    stability: c.stability,
    difficulty: c.difficulty,
    scheduled_days: c.scheduledDays,
    learning_steps: c.learningSteps,
    reps: c.reps,
    lapses: c.lapses,
    state: c.state,
    last_review: c.lastReview == null ? undefined : new Date(c.lastReview),
  } as Card;
}

function fromFsrs(c: Card, moveId: string, repertoireId: string, wrong: number, right: number): CardState {
  return {
    moveId,
    repertoireId,
    due: c.due.getTime(),
    stability: c.stability,
    difficulty: c.difficulty,
    scheduledDays: c.scheduled_days,
    learningSteps: c.learning_steps ?? 0,
    reps: c.reps,
    lapses: c.lapses,
    state: c.state,
    lastReview: c.last_review ? new Date(c.last_review).getTime() : null,
    wrong,
    right,
  };
}

const RATING: Record<Grade, FsrsGrade> = {
  again: Rating.Again,
  hard: Rating.Hard,
  good: Rating.Good,
};

export function isDue(c: CardState, now = Date.now()): boolean {
  return c.due <= now;
}

export function isMastered(c: CardState | undefined): boolean {
  return !!c && c.state === 2 && c.scheduledDays >= MASTERED_DAYS;
}

/**
 * Applies a review. Wrong answers always reschedule (a lapse is a lapse, even when
 * cramming). Correct answers only move the schedule when the card is actually due,
 * so cramming doesn't inflate intervals.
 */
export function review(c: CardState, grade: Grade, now = Date.now(), opts: { fuzz?: boolean } = {}): CardState {
  const wrong = c.wrong + (grade === 'again' ? 1 : 0);
  const right = c.right + (grade === 'again' ? 0 : 1);
  if (grade !== 'again' && !isDue(c, now)) return { ...c, wrong, right };
  const f = opts.fuzz === false ? deterministic : scheduler;
  const next = f.next(toFsrs(c), new Date(now), RATING[grade]).card;
  return fromFsrs(next, c.moveId, c.repertoireId, wrong, right);
}
