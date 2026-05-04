import { describe, it, expect } from 'vitest';
import {
  areAllSectionsDone,
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
