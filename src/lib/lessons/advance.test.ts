import { describe, it, expect } from 'vitest';
import {
  areAllSectionsDone,
  countDoneSections,
  isSectionDone,
  pathForAdvanceTarget,
  resolveAdvanceTarget,
} from './advance';

const lessonWith = (sectionIds: string[]) => ({
  sections: sectionIds.map((id) => ({ id })) as Array<{ id: string }>,
}) as unknown as Parameters<typeof areAllSectionsDone>[0];

describe('isSectionDone (US-067)', () => {
  it('returns true when persistedSectionState[id].done is true', () => {
    expect(
      isSectionDone('s1', {
        persistedSectionState: { s1: { done: true } },
      }),
    ).toBe(true);
  });
  it('returns true when manuallyCompleted[id] is true', () => {
    expect(
      isSectionDone('s2', { manuallyCompleted: { s2: true } }),
    ).toBe(true);
  });
  it('returns true when liveAutoDone[id] is true', () => {
    expect(
      isSectionDone('s3', { liveAutoDone: { s3: true } }),
    ).toBe(true);
  });
  it('returns false when no flag is set', () => {
    expect(isSectionDone('s1', {})).toBe(false);
    expect(
      isSectionDone('s1', {
        persistedSectionState: { s1: { done: false } },
        manuallyCompleted: { s1: false },
        liveAutoDone: { s1: false },
      }),
    ).toBe(false);
  });
});

describe('areAllSectionsDone (US-067)', () => {
  it('returns false for empty section list', () => {
    expect(areAllSectionsDone(lessonWith([]), {})).toBe(false);
  });
  it('returns false when one section is undone', () => {
    expect(
      areAllSectionsDone(lessonWith(['s1', 's2']), {
        manuallyCompleted: { s1: true },
      }),
    ).toBe(false);
  });
  it('returns true when every section is satisfied across mixed sources', () => {
    expect(
      areAllSectionsDone(lessonWith(['s1', 's2', 's3']), {
        persistedSectionState: { s1: { done: true } },
        manuallyCompleted: { s2: true },
        liveAutoDone: { s3: true },
      }),
    ).toBe(true);
  });
});

describe('countDoneSections (US-079)', () => {
  it('reports 0 of 2 when nothing is marked', () => {
    expect(countDoneSections(lessonWith(['s1', 's2']), {})).toEqual({
      total: 2,
      done: 0,
    });
  });

  it('updates from 0/2 to 1/2 when a section becomes liveAutoDone (the bug)', () => {
    // Reproduces US-079: a widget firing onComplete() only flips
    // liveAutoDone, but the pill counter must reflect that immediately.
    expect(
      countDoneSections(lessonWith(['s1', 's2']), {
        liveAutoDone: { s1: true },
      }),
    ).toEqual({ total: 2, done: 1 });
  });

  it('counts manuallyCompleted sections', () => {
    expect(
      countDoneSections(lessonWith(['s1', 's2']), {
        manuallyCompleted: { s2: true },
      }),
    ).toEqual({ total: 2, done: 1 });
  });

  it('counts mixed completion sources without double-counting', () => {
    expect(
      countDoneSections(lessonWith(['s1', 's2', 's3']), {
        persistedSectionState: { s1: { done: true } },
        manuallyCompleted: { s1: true, s2: true },
        liveAutoDone: { s3: true },
      }),
    ).toEqual({ total: 3, done: 3 });
  });

  it('denominator reflects the current lesson section count', () => {
    expect(countDoneSections(lessonWith(['a', 'b', 'c', 'd']), {})).toEqual({
      total: 4,
      done: 0,
    });
    expect(countDoneSections(lessonWith([]), {})).toEqual({
      total: 0,
      done: 0,
    });
  });
});

describe('resolveAdvanceTarget (US-067)', () => {
  const courseTwoModules = {
    slug: 'demo',
    modules: [
      { lessons: [{ slug: 'l1' }, { slug: 'l2' }] },
      { lessons: [{ slug: 'l3' }] },
    ],
  } as unknown as Parameters<typeof resolveAdvanceTarget>[0];

  it('returns the next lesson when there is a successor (within same module)', () => {
    expect(resolveAdvanceTarget(courseTwoModules, 'l1')).toEqual({
      kind: 'next-lesson',
      courseSlug: 'demo',
      lessonSlug: 'l2',
    });
  });
  it('crosses module boundaries to find the next lesson', () => {
    expect(resolveAdvanceTarget(courseTwoModules, 'l2')).toEqual({
      kind: 'next-lesson',
      courseSlug: 'demo',
      lessonSlug: 'l3',
    });
  });
  it('returns my-courses when finishing the last lesson in the course', () => {
    expect(resolveAdvanceTarget(courseTwoModules, 'l3')).toEqual({
      kind: 'my-courses',
    });
  });
  it('returns my-courses when the lesson slug is unknown', () => {
    expect(resolveAdvanceTarget(courseTwoModules, 'missing')).toEqual({
      kind: 'my-courses',
    });
  });
});

describe('pathForAdvanceTarget (US-067)', () => {
  it('formats next-lesson target as /courses/<slug>/lessons/<lessonSlug>', () => {
    expect(
      pathForAdvanceTarget({
        kind: 'next-lesson',
        courseSlug: 'demo',
        lessonSlug: 'l2',
      }),
    ).toBe('/courses/demo/lessons/l2');
  });
  it('formats my-courses target as /', () => {
    expect(pathForAdvanceTarget({ kind: 'my-courses' })).toBe('/');
  });
});
