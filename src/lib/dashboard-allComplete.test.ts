import { describe, it, expect } from 'vitest';
import { allCoursesComplete } from './dashboard';
import type { Course } from '@/lib/schemas/course';
import type { Progress } from '@/lib/schemas/progress';

function course(slug: string, lessonSlugs: string[]): Course {
  return {
    schemaVersion: 1,
    slug,
    title: slug,
    description: '',
    accentColor: 'default',
    icon: 'book-open',
    modules: [
      {
        id: 'm1',
        title: 'm1',
        summary: '',
        lessons: lessonSlugs.map((s) => ({ slug: s, title: s, estimatedMinutes: 10 })),
      },
    ],
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  };
}

function progressFor(
  entries: Record<string, Record<string, 'not_started' | 'started' | 'finished'>>,
): Progress {
  const courses: Progress['courses'] = {};
  for (const [courseSlug, lessons] of Object.entries(entries)) {
    courses[courseSlug] = {
      lessons: Object.fromEntries(
        Object.entries(lessons).map(([k, v]) => [k, { status: v }]),
      ),
    };
  }
  return { courses };
}

describe('allCoursesComplete', () => {
  it('returns false when there are zero courses', () => {
    expect(allCoursesComplete([], { courses: {} })).toBe(false);
  });

  it('returns false when progress is null', () => {
    expect(allCoursesComplete([course('a', ['l1'])], null)).toBe(false);
  });

  it('returns false when a course has no progress entry at all', () => {
    expect(
      allCoursesComplete([course('a', ['l1'])], { courses: {} }),
    ).toBe(false);
  });

  it('returns false when a course has zero lessons', () => {
    expect(
      allCoursesComplete([course('a', [])], progressFor({ a: {} })),
    ).toBe(false);
  });

  it('returns false when one lesson is started (not finished)', () => {
    expect(
      allCoursesComplete(
        [course('a', ['l1', 'l2'])],
        progressFor({ a: { l1: 'finished', l2: 'started' } }),
      ),
    ).toBe(false);
  });

  it('returns false when one lesson is missing from progress', () => {
    expect(
      allCoursesComplete(
        [course('a', ['l1', 'l2'])],
        progressFor({ a: { l1: 'finished' } }),
      ),
    ).toBe(false);
  });

  it('returns true when every lesson of every course is finished', () => {
    expect(
      allCoursesComplete(
        [course('a', ['l1', 'l2']), course('b', ['l3'])],
        progressFor({
          a: { l1: 'finished', l2: 'finished' },
          b: { l3: 'finished' },
        }),
      ),
    ).toBe(true);
  });

  it('returns false when one of two courses has an unfinished lesson', () => {
    expect(
      allCoursesComplete(
        [course('a', ['l1']), course('b', ['l2', 'l3'])],
        progressFor({
          a: { l1: 'finished' },
          b: { l2: 'finished', l3: 'not_started' },
        }),
      ),
    ).toBe(false);
  });
});
