import { describe, expect, it } from 'vitest';
import { isDue, isMastered, MASTERED_DAYS, newCard, review } from '../src/core/scheduler';

const DAY = 86400_000;
const T0 = Date.UTC(2026, 0, 1, 12);

describe('scheduler (FSRS)', () => {
  it('new cards are due immediately', () => {
    const c = newCard('m', 'r', T0);
    expect(isDue(c, T0)).toBe(true);
    expect(c.state).toBe(0);
  });

  it('good answers grow the interval until mastered', () => {
    let c = newCard('m', 'r', T0);
    let t = T0;
    const intervals: number[] = [];
    for (let i = 0; i < 8 && !isMastered(c); i++) {
      c = review(c, 'good', t, { fuzz: false });
      intervals.push(c.scheduledDays);
      t = c.due;
    }
    expect(isMastered(c)).toBe(true);
    expect(c.scheduledDays).toBeGreaterThanOrEqual(MASTERED_DAYS);
    for (let i = 1; i < intervals.length; i++) expect(intervals[i]).toBeGreaterThanOrEqual(intervals[i - 1]);
    expect(c.right).toBe(intervals.length);
  });

  it('a wrong answer is a lapse and makes the card due soon', () => {
    let c = newCard('m', 'r', T0);
    let t = T0;
    for (let i = 0; i < 4; i++) {
      c = review(c, 'good', t, { fuzz: false });
      t = c.due;
    }
    expect(c.state).toBe(2);
    const before = c.scheduledDays;
    c = review(c, 'again', t, { fuzz: false });
    expect(c.lapses).toBe(1);
    expect(c.wrong).toBe(1);
    expect(c.due - t).toBeLessThan(DAY);
    expect(c.scheduledDays).toBeLessThan(before);
  });

  it('hard schedules sooner than good', () => {
    let c = newCard('m', 'r', T0);
    c = review(c, 'good', T0, { fuzz: false });
    c = review(c, 'good', c.due, { fuzz: false });
    const hard = review(c, 'hard', c.due, { fuzz: false });
    const good = review(c, 'good', c.due, { fuzz: false });
    expect(hard.due).toBeLessThan(good.due);
  });

  it('correct answers on cards that are not due (cramming) do not move the schedule', () => {
    let c = newCard('m', 'r', T0);
    c = review(c, 'good', T0, { fuzz: false });
    c = review(c, 'good', c.due, { fuzz: false });
    const early = review(c, 'good', c.due - DAY, { fuzz: false });
    expect(early.due).toBe(c.due);
    expect(early.right).toBe(c.right + 1);
    const wrongEarly = review(c, 'again', c.due - DAY, { fuzz: false });
    expect(wrongEarly.due).toBeLessThan(c.due);
  });
});
