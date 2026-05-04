import { describe, it, expect } from 'vitest';
import {
  wizardDependencies,
  computeStageInputHash,
  computeAllStageHashes,
  isStageStale,
  staleStages,
  hasUserEdits,
  snapshotUpstreamHashes,
  type HashableDraft,
  type StageCacheRecord,
  type WizardCaches,
} from './dependencies';

const baseDraft: HashableDraft = {
  topic: 'Backpropagation',
  level: 'beginner',
  durationTarget: 'standard',
  theoryPracticeRatio: 50,
  clarificationQuestions: [
    { id: 'q1', text: 'Why are you learning this?' },
    { id: 'q2', text: 'How do you prefer to learn?' },
  ],
  clarification: { q1: '', q2: '' },
  structure: {
    courseTitle: 'Backprop',
    courseDescription: 'Intro',
    modules: [
      {
        id: 'm1',
        title: 'Module 1',
        lessons: [
          { id: 'l1', title: 'Lesson 1', summary: 'sum', estimatedMinutes: 10 },
        ],
      },
    ],
  },
};

function buildFreshCaches(draft: HashableDraft): WizardCaches {
  const hashes = computeAllStageHashes(draft);
  return {
    clarification: {
      upstreamHashes: snapshotUpstreamHashes('clarification', draft),
      generatedHash: hashes.clarification,
    },
    structure: {
      upstreamHashes: snapshotUpstreamHashes('structure', draft),
      generatedHash: hashes.structure,
    },
    approval: {
      upstreamHashes: snapshotUpstreamHashes('approval', draft),
      generatedHash: hashes.structure,
    },
  };
}

describe('wizardDependencies map', () => {
  it('topic has no upstream', () => {
    expect(wizardDependencies.topic).toEqual([]);
  });
  it('refine depends on topic', () => {
    expect(wizardDependencies.refine).toEqual(['topic']);
  });
  it('clarification depends on topic + refine', () => {
    expect(wizardDependencies.clarification).toEqual(['topic', 'refine']);
  });
  it('structure depends on topic + refine + clarification', () => {
    expect(wizardDependencies.structure).toEqual([
      'topic',
      'refine',
      'clarification',
    ]);
  });
  it('approval depends on the full chain', () => {
    expect(wizardDependencies.approval).toEqual([
      'topic',
      'refine',
      'clarification',
      'structure',
    ]);
  });
});

describe('computeStageInputHash', () => {
  it('is deterministic for identical inputs', () => {
    expect(computeStageInputHash('topic', baseDraft)).toBe(
      computeStageInputHash('topic', baseDraft),
    );
    expect(computeStageInputHash('structure', baseDraft)).toBe(
      computeStageInputHash('structure', baseDraft),
    );
  });

  it('topic hash changes when topic content changes', () => {
    const a = computeStageInputHash('topic', baseDraft);
    const b = computeStageInputHash('topic', { ...baseDraft, topic: 'Different' });
    expect(a).not.toBe(b);
  });

  it('topic hash ignores leading/trailing whitespace', () => {
    const a = computeStageInputHash('topic', baseDraft);
    const b = computeStageInputHash('topic', {
      ...baseDraft,
      topic: '  Backpropagation  ',
    });
    expect(a).toBe(b);
  });

  it('refine hash changes with level', () => {
    const a = computeStageInputHash('refine', baseDraft);
    const b = computeStageInputHash('refine', { ...baseDraft, level: 'advanced' });
    expect(a).not.toBe(b);
  });

  it('refine hash changes with durationTarget', () => {
    const a = computeStageInputHash('refine', baseDraft);
    const b = computeStageInputHash('refine', {
      ...baseDraft,
      durationTarget: 'extensive',
    });
    expect(a).not.toBe(b);
  });

  it('refine hash changes with theory/practice ratio', () => {
    const a = computeStageInputHash('refine', baseDraft);
    const b = computeStageInputHash('refine', {
      ...baseDraft,
      theoryPracticeRatio: 75,
    });
    expect(a).not.toBe(b);
  });

  it('clarification hash changes when answers change', () => {
    const a = computeStageInputHash('clarification', baseDraft);
    const b = computeStageInputHash('clarification', {
      ...baseDraft,
      clarification: { q1: 'because i love it', q2: '' },
    });
    expect(a).not.toBe(b);
  });

  it('clarification hash unaffected by answer-key insertion order', () => {
    const a = computeStageInputHash('clarification', {
      ...baseDraft,
      clarification: { q1: 'one', q2: 'two' },
    });
    const b = computeStageInputHash('clarification', {
      ...baseDraft,
      clarification: { q2: 'two', q1: 'one' },
    });
    expect(a).toBe(b);
  });

  it('structure hash changes when module title changes', () => {
    const s = baseDraft.structure!;
    const altered: HashableDraft = {
      ...baseDraft,
      structure: {
        ...s,
        modules: [{ ...s.modules[0], title: 'Renamed module' }],
      },
    };
    expect(computeStageInputHash('structure', baseDraft)).not.toBe(
      computeStageInputHash('structure', altered),
    );
  });

  it('structure hash changes when lesson estimatedMinutes change', () => {
    const s = baseDraft.structure!;
    const altered: HashableDraft = {
      ...baseDraft,
      structure: {
        ...s,
        modules: [
          {
            ...s.modules[0],
            lessons: [{ ...s.modules[0].lessons[0], estimatedMinutes: 99 }],
          },
        ],
      },
    };
    expect(computeStageInputHash('structure', baseDraft)).not.toBe(
      computeStageInputHash('structure', altered),
    );
  });

  it('structure hash ignores ID-only changes (so re-mounting with same content is stable)', () => {
    const s = baseDraft.structure!;
    const reIded: HashableDraft = {
      ...baseDraft,
      structure: {
        ...s,
        modules: [
          {
            ...s.modules[0],
            id: 'different-mod-id',
            lessons: [
              { ...s.modules[0].lessons[0], id: 'different-lesson-id' },
            ],
          },
        ],
      },
    };
    expect(computeStageInputHash('structure', baseDraft)).toBe(
      computeStageInputHash('structure', reIded),
    );
  });

  it('approval hash equals structure hash', () => {
    expect(computeStageInputHash('approval', baseDraft)).toBe(
      computeStageInputHash('structure', baseDraft),
    );
  });
});

describe('isStageStale and staleStages', () => {
  it('no caches → no stale stages', () => {
    expect(staleStages(baseDraft, undefined).size).toBe(0);
    expect(staleStages(baseDraft, {}).size).toBe(0);
  });

  it('untouched fresh caches → no stale stages', () => {
    expect(staleStages(baseDraft, buildFreshCaches(baseDraft)).size).toBe(0);
  });

  it('editing topic marks all transitive downstream stages stale', () => {
    const caches = buildFreshCaches(baseDraft);
    const newDraft: HashableDraft = { ...baseDraft, topic: 'Different topic' };
    const stale = staleStages(newDraft, caches);
    expect(stale.has('clarification')).toBe(true);
    expect(stale.has('structure')).toBe(true);
    expect(stale.has('approval')).toBe(true);
  });

  it('editing refine marks clarification + structure + approval stale', () => {
    const caches = buildFreshCaches(baseDraft);
    const newDraft: HashableDraft = { ...baseDraft, level: 'advanced' };
    const stale = staleStages(newDraft, caches);
    expect(stale.has('clarification')).toBe(true);
    expect(stale.has('structure')).toBe(true);
    expect(stale.has('approval')).toBe(true);
  });

  it('editing clarification answers marks structure + approval stale, NOT clarification itself', () => {
    const caches = buildFreshCaches(baseDraft);
    const newDraft: HashableDraft = {
      ...baseDraft,
      clarification: { q1: 'a fresh answer', q2: '' },
    };
    const stale = staleStages(newDraft, caches);
    expect(stale.has('clarification')).toBe(false);
    expect(stale.has('structure')).toBe(true);
    expect(stale.has('approval')).toBe(true);
  });

  it('editing structure marks only approval stale', () => {
    const caches = buildFreshCaches(baseDraft);
    const s = baseDraft.structure!;
    const newDraft: HashableDraft = {
      ...baseDraft,
      structure: { ...s, courseTitle: 'A different title' },
    };
    const stale = staleStages(newDraft, caches);
    expect(stale.has('clarification')).toBe(false);
    expect(stale.has('structure')).toBe(false);
    expect(stale.has('approval')).toBe(true);
  });

  it('isStageStale returns false when there is no cache record', () => {
    expect(isStageStale('clarification', baseDraft, undefined)).toBe(false);
    expect(isStageStale('structure', baseDraft, undefined)).toBe(false);
  });
});

describe('hasUserEdits', () => {
  const dummyCache: StageCacheRecord = {
    upstreamHashes: {},
    generatedHash: 'placeholder',
  };

  it('clarification: false if all answers blank', () => {
    expect(hasUserEdits('clarification', baseDraft, dummyCache)).toBe(false);
  });

  it('clarification: true if any answer is non-empty after trim', () => {
    expect(
      hasUserEdits(
        'clarification',
        { ...baseDraft, clarification: { q1: 'yes', q2: '' } },
        dummyCache,
      ),
    ).toBe(true);
  });

  it('clarification: false for whitespace-only answers', () => {
    expect(
      hasUserEdits(
        'clarification',
        { ...baseDraft, clarification: { q1: '   ', q2: '' } },
        dummyCache,
      ),
    ).toBe(false);
  });

  it('structure: false if hash matches the recorded seed hash', () => {
    const seed = computeStageInputHash('structure', baseDraft);
    expect(
      hasUserEdits('structure', baseDraft, {
        upstreamHashes: {},
        generatedHash: seed,
      }),
    ).toBe(false);
  });

  it('structure: true if structure has been modified since seed', () => {
    const seed = computeStageInputHash('structure', baseDraft);
    const s = baseDraft.structure!;
    const edited: HashableDraft = {
      ...baseDraft,
      structure: { ...s, courseTitle: 'Edited' },
    };
    expect(
      hasUserEdits('structure', edited, {
        upstreamHashes: {},
        generatedHash: seed,
      }),
    ).toBe(true);
  });

  it('returns false when there is no cache record at all', () => {
    expect(hasUserEdits('structure', baseDraft, undefined)).toBe(false);
    expect(hasUserEdits('clarification', baseDraft, undefined)).toBe(false);
  });
});

describe('snapshotUpstreamHashes', () => {
  it('captures only direct upstream hashes for the given stage', () => {
    const snap = snapshotUpstreamHashes('clarification', baseDraft);
    expect(Object.keys(snap).sort()).toEqual(['refine', 'topic']);
    expect(snap.topic).toBe(computeStageInputHash('topic', baseDraft));
    expect(snap.refine).toBe(computeStageInputHash('refine', baseDraft));
  });

  it('captures topic + refine + clarification for structure', () => {
    const snap = snapshotUpstreamHashes('structure', baseDraft);
    expect(Object.keys(snap).sort()).toEqual([
      'clarification',
      'refine',
      'topic',
    ]);
  });
});
