import { describe, it, expect } from 'vitest';
import {
  visibleLessonSlots,
  computeSliderEdges,
  type LessonSlotStatus,
} from './lessonSlots';

interface TestLesson {
  slug: string;
  title: string;
  index: number;
}

const lessons: TestLesson[] = [
  { slug: 'a', title: 'A', index: 0 },
  { slug: 'b', title: 'B', index: 1 },
  { slug: 'c', title: 'C', index: 2 },
  { slug: 'd', title: 'D', index: 3 },
];

const statuses = (entries: Array<[string, LessonSlotStatus]>) =>
  new Map<string, LessonSlotStatus>(entries);

describe('visibleLessonSlots (US-109)', () => {
  it('hides lessons that are still in the pending state', () => {
    const result = visibleLessonSlots(
      lessons,
      statuses([
        ['a', 'done'],
        ['b', 'started'],
      ]),
    );
    expect(result.map((l) => l.slug)).toEqual(['a', 'b']);
  });

  it('hides lessons with no status entry (default = pending)', () => {
    const result = visibleLessonSlots(lessons, statuses([['a', 'done']]));
    expect(result.map((l) => l.slug)).toEqual(['a']);
  });

  it('keeps started, done, and error states', () => {
    const result = visibleLessonSlots(
      lessons,
      statuses([
        ['a', 'started'],
        ['b', 'done'],
        ['c', 'error'],
        ['d', 'pending'],
      ]),
    );
    expect(result.map((l) => l.slug)).toEqual(['a', 'b', 'c']);
  });

  it('preserves the source ordering', () => {
    const result = visibleLessonSlots(
      lessons,
      statuses([
        ['d', 'started'],
        ['a', 'done'],
        ['c', 'started'],
      ]),
    );
    expect(result.map((l) => l.slug)).toEqual(['a', 'c', 'd']);
  });

  it('returns an empty array when nothing has started yet (regression: pending must not leak)', () => {
    // This is the failing-test reproducer for the pre-US-109 bug: the
    // previous slider rendered every lesson, including pending ones, which
    // is what we are explicitly removing here.
    const result = visibleLessonSlots(
      lessons,
      statuses([
        ['a', 'pending'],
        ['b', 'pending'],
      ]),
    );
    expect(result).toEqual([]);
  });
});

describe('computeSliderEdges (US-109)', () => {
  it('reports both edges when the content fits the viewport', () => {
    expect(computeSliderEdges(0, 100, 200)).toEqual({
      atStart: true,
      atEnd: true,
    });
  });

  it('reports atStart when scrollLeft is 0 and content overflows', () => {
    expect(computeSliderEdges(0, 800, 200)).toEqual({
      atStart: true,
      atEnd: false,
    });
  });

  it('reports atEnd when scrollLeft is at the maximum', () => {
    expect(computeSliderEdges(600, 800, 200)).toEqual({
      atStart: false,
      atEnd: true,
    });
  });

  it('reports neither edge when scrolled to the middle', () => {
    expect(computeSliderEdges(300, 800, 200)).toEqual({
      atStart: false,
      atEnd: false,
    });
  });

  it('absorbs sub-pixel rounding inside the tolerance band', () => {
    expect(computeSliderEdges(1.4, 800, 200)).toEqual({
      atStart: true,
      atEnd: false,
    });
    expect(computeSliderEdges(599, 800, 200, 2)).toEqual({
      atStart: false,
      atEnd: true,
    });
  });
});
