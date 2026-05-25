import type { Draft, StructureDraft } from './Stage3Cascade';

// Strip client-side ids and serialize draft into a CourseSpec payload.
//
// US-191 — quiz-only mode tags the spec with `['quiz']` and omits both `level`
// and `theoryPracticeRatio` entirely (no fallback values, so the generation
// pipeline can detect them as truly absent rather than as defaulted-to-zero).
export function buildCourseSpec(
  draft: Draft,
  structure: StructureDraft,
): Record<string, unknown> {
  const spec: Record<string, unknown> = {
    topic: draft.topic.trim(),
    durationTarget: draft.durationTarget,
    draftStructure: {
      courseTitle: structure.courseTitle.trim(),
      courseDescription: structure.courseDescription.trim(),
      modules: structure.modules.map((m) => ({
        title: m.title.trim(),
        lessons: m.lessons.map((l) => ({
          title: l.title.trim(),
          summary: l.summary.trim(),
          estimatedMinutes: l.estimatedMinutes,
        })),
      })),
    },
    createdAt: new Date().toISOString(),
  };

  if (draft.quizOnly) {
    spec.tags = ['quiz'];
  } else {
    spec.level = draft.level;
    spec.theoryPracticeRatio = clampRatio(draft.theoryPracticeRatio / 100);
  }

  const trimmedDescription = draft.description.trim();
  if (trimmedDescription.length > 0) {
    spec.description = trimmedDescription;
  }

  if (draft.clarificationQuestions && draft.clarificationQuestions.length > 0) {
    const answers = draft.clarification ?? {};
    const trimmed: Record<string, string> = {};
    for (const q of draft.clarificationQuestions) {
      const a = (answers[q.id] ?? '').trim();
      if (a.length > 0) trimmed[`${q.id}: ${q.text}`] = a;
    }
    if (Object.keys(trimmed).length > 0) {
      spec.clarification = trimmed;
    }
  }

  return spec;
}

export function clampRatio(n: number): number {
  if (Number.isNaN(n)) return 0.5;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}
