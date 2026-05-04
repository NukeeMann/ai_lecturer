import { describe, it, expect } from 'vitest';
import type { Course } from '@/lib/schemas/course';
import type { CourseProgress } from '@/lib/schemas/progress';
import { pickEntryLessonSlug } from './entryRedirect';

const courseWith = (lessonSlugs: string[][]): Pick<Course, 'modules'> => ({
  modules: lessonSlugs.map((slugs, mi) => ({
    id: `m${mi + 1}`,
    title: `Module ${mi + 1}`,
    summary: '',
    lessons: slugs.map((slug) => ({ slug, title: slug, estimatedMinutes: 5 })),
  })),
});

describe('pickEntryLessonSlug (US-088)', () => {
  it('returns null when the course has no lessons', () => {
    expect(pickEntryLessonSlug({ modules: [] }, undefined)).toBeNull();
  });

  it('returns the first lesson when no progress exists for the course', () => {
    const course = courseWith([['a', 'b', 'c']]);
    expect(pickEntryLessonSlug(course, undefined)).toBe('a');
  });

  it('returns the first lesson when progress exists but no lessons are recorded', () => {
    const course = courseWith([['a', 'b']]);
    const cp: CourseProgress = { lessons: {} };
    expect(pickEntryLessonSlug(course, cp)).toBe('a');
  });

  it('returns the earliest lesson whose status is not finished', () => {
    const course = courseWith([['a', 'b', 'c']]);
    const cp: CourseProgress = {
      lessons: {
        a: { status: 'finished' },
        b: { status: 'started' },
      },
    };
    expect(pickEntryLessonSlug(course, cp)).toBe('b');
  });

  it('treats not_started status as not-completed', () => {
    const course = courseWith([['a', 'b']]);
    const cp: CourseProgress = {
      lessons: {
        a: { status: 'finished' },
        b: { status: 'not_started' },
      },
    };
    expect(pickEntryLessonSlug(course, cp)).toBe('b');
  });

  it('returns the last lesson when every lesson is finished', () => {
    const course = courseWith([['a', 'b', 'c']]);
    const cp: CourseProgress = {
      lessons: {
        a: { status: 'finished' },
        b: { status: 'finished' },
        c: { status: 'finished' },
      },
    };
    expect(pickEntryLessonSlug(course, cp)).toBe('c');
  });

  it('walks across module boundaries in flat order', () => {
    const course = courseWith([
      ['a', 'b'],
      ['c', 'd'],
    ]);
    const cp: CourseProgress = {
      lessons: {
        a: { status: 'finished' },
        b: { status: 'finished' },
      },
    };
    expect(pickEntryLessonSlug(course, cp)).toBe('c');
  });

  it('skips finished lessons even when later modules contain only finished ones', () => {
    const course = courseWith([['a'], ['b', 'c']]);
    const cp: CourseProgress = {
      lessons: {
        a: { status: 'finished' },
        b: { status: 'finished' },
        c: { status: 'started' },
      },
    };
    expect(pickEntryLessonSlug(course, cp)).toBe('c');
  });
});
