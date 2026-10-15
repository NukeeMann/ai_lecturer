import { describe, it, expect } from 'vitest';
import {
  areAllSectionsDone,
  autoAdvanceRequestBody,
  buildAutoAdvancePatch,
  countDoneSections,
  isSectionDone,
  mergeSectionStates,
  pathForAdvanceTarget,
  resolveAdvanceTarget,
} from './advance';
import { applyProgressPatch, ProgressPatchSchema } from '@/lib/server/progress';
import type { Progress } from '@/lib/schemas/progress';

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

describe('buildAutoAdvancePatch (US-081)', () => {
  it('marks status finished and persists every live-auto-done section as done', () => {
    expect(
      buildAutoAdvancePatch(
        [{ id: 's1' }, { id: 's2' }],
        { liveAutoDone: { s1: true, s2: true } },
      ),
    ).toEqual({
      status: 'finished',
      sectionState: { s1: { done: true }, s2: { done: true } },
    });
  });

  it('skips sections whose persisted done flag is already true', () => {
    expect(
      buildAutoAdvancePatch(
        [{ id: 's1' }, { id: 's2' }],
        {
          persistedSectionState: { s1: { done: true } },
          liveAutoDone: { s2: true },
        },
      ),
    ).toEqual({
      status: 'finished',
      sectionState: { s2: { done: true } },
    });
  });

  it('persists manuallyCompleted sections that have no persisted done yet', () => {
    expect(
      buildAutoAdvancePatch([{ id: 's1' }], {
        manuallyCompleted: { s1: true },
      }),
    ).toEqual({
      status: 'finished',
      sectionState: { s1: { done: true } },
    });
  });

  it('returns status:finished with empty sectionState when nothing needs patching', () => {
    expect(
      buildAutoAdvancePatch([{ id: 's1' }], {
        persistedSectionState: { s1: { done: true } },
      }),
    ).toEqual({ status: 'finished', sectionState: {} });
  });

  it('does not include sections that are not done by any source', () => {
    expect(
      buildAutoAdvancePatch(
        [{ id: 's1' }, { id: 's2' }],
        { liveAutoDone: { s1: true } },
      ),
    ).toEqual({
      status: 'finished',
      sectionState: { s1: { done: true } },
    });
  });
});

describe('auto-advance keeps widget state when marking done', () => {
  const widgetState = { v: 1, marks: [{ t: 3.2 }], submitted: true };
  const score = { correct: 1, total: 2 };

  it('mergeSectionStates sets done and keeps widgetState/score/userCode', () => {
    const existing = {
      s1: { widgetState, score },
      s2: { userCode: 'print(1)' },
      s3: { done: true },
    };
    const merged = mergeSectionStates(existing, {
      s1: { done: true },
      s2: { done: true },
      s4: { done: true },
    });
    expect(merged).toEqual({
      s1: { done: true, widgetState, score },
      s2: { done: true, userCode: 'print(1)' },
      s3: { done: true },
      s4: { done: true },
    });
    // Pure: the input is untouched.
    expect(existing.s1).toEqual({ widgetState, score });
  });

  it('mergeSectionStates handles a lesson without any stored section state', () => {
    expect(mergeSectionStates(undefined, { s1: { done: true } })).toEqual({
      s1: { done: true },
    });
  });

  it('autoAdvanceRequestBody sends the sections as a merge, never as a replacement', () => {
    const patch = buildAutoAdvancePatch([{ id: 's1' }], {
      liveAutoDone: { s1: true },
    });
    const body = autoAdvanceRequestBody('c', 'l', patch);
    expect(body).toEqual({
      courseSlug: 'c',
      lessonSlug: 'l',
      status: 'finished',
      mergeSectionState: { s1: { done: true } },
    });
    expect('sectionState' in body).toBe(false);
  });

  it('server state written by a widget survives the auto-advance PATCH even when the page copy is stale', () => {
    // The widget PATCHed its full state straight to the server; the page
    // never saw it (its persisted copy has nothing for s1), so the auto-advance
    // patch includes s1. The server must merge, not replace.
    const server: Progress = {
      courses: {
        c: {
          lessons: {
            l: {
              status: 'started',
              sectionState: { s1: { done: true, widgetState, score } },
            },
          },
        },
      },
    };
    const patch = buildAutoAdvancePatch([{ id: 's1' }, { id: 's2' }], {
      persistedSectionState: {},
      liveAutoDone: { s1: true, s2: true },
    });
    const body = ProgressPatchSchema.parse(autoAdvanceRequestBody('c', 'l', patch));
    const next = applyProgressPatch(server, body, '2026-10-15T10:00:00.000Z');
    expect(next.courses.c.lessons.l.status).toBe('finished');
    expect(next.courses.c.lessons.l.sectionState).toEqual({
      s1: { done: true, widgetState, score },
      s2: { done: true },
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
