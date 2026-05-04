/**
 * Wizard stage dependency map + draft hashing for downstream-cache invalidation
 * (US-093).
 *
 * Each stage has a deterministic input hash. Cached/derived stages
 * (clarification, structure, approval) record the upstream input hashes that
 * produced their output. When the user navigates back and edits an upstream
 * stage, the recorded hashes diverge from the current ones and the downstream
 * stage is marked stale. Reopening a stale stage triggers regeneration.
 */

export type WizardStage = 'topic' | 'refine' | 'clarification' | 'structure' | 'approval';
export type CachedStage = 'clarification' | 'structure' | 'approval';

/**
 * For each stage, the DIRECT upstream stages whose inputs feed into its
 * generation. Transitive staleness propagates automatically because each
 * upstream stage's hash already reflects ITS upstream when recomputed.
 */
export const wizardDependencies: Record<WizardStage, WizardStage[]> = {
  topic: [],
  refine: ['topic'],
  clarification: ['topic', 'refine'],
  structure: ['topic', 'refine', 'clarification'],
  approval: ['topic', 'refine', 'clarification', 'structure'],
};

export interface HashableLesson {
  id: string;
  title: string;
  summary: string;
  estimatedMinutes: number;
}

export interface HashableModule {
  id: string;
  title: string;
  lessons: HashableLesson[];
}

export interface HashableStructure {
  courseTitle: string;
  courseDescription: string;
  modules: HashableModule[];
}

export interface HashableClarificationQuestion {
  id: string;
  text: string;
}

export interface HashableDraft {
  topic: string;
  level: string | null;
  durationTarget: string | null;
  theoryPracticeRatio: number;
  clarificationQuestions?: HashableClarificationQuestion[];
  clarification?: Record<string, string>;
  structure: HashableStructure | null;
}

export interface StageCacheRecord {
  /** Upstream stage input-hashes captured at the time this stage was generated. */
  upstreamHashes: Partial<Record<WizardStage, string>>;
  /**
   * Hash of the auto-generated output at the time of generation. Used to
   * detect whether the user has manually edited the cached output since.
   */
  generatedHash: string;
}

export type WizardCaches = Partial<Record<CachedStage, StageCacheRecord>>;

export function computeStageInputHash(stage: WizardStage, draft: HashableDraft): string {
  switch (stage) {
    case 'topic':
      return fnv1a32(stableJSON({ topic: draft.topic.trim() }));
    case 'refine':
      return fnv1a32(
        stableJSON({
          level: draft.level,
          durationTarget: draft.durationTarget,
          theoryPracticeRatio: draft.theoryPracticeRatio,
        }),
      );
    case 'clarification': {
      const questions = (draft.clarificationQuestions ?? []).map((q) => ({
        id: q.id,
        text: q.text,
      }));
      const answers = draft.clarification ?? {};
      const sortedAnswerEntries = Object.keys(answers)
        .sort()
        .map((k) => [k, (answers[k] ?? '').trim()] as const);
      return fnv1a32(stableJSON({ questions, answers: sortedAnswerEntries }));
    }
    case 'structure': {
      const s = draft.structure;
      if (!s) return fnv1a32('null-structure');
      return fnv1a32(
        stableJSON({
          title: s.courseTitle,
          description: s.courseDescription,
          modules: s.modules.map((m) => ({
            title: m.title,
            lessons: m.lessons.map((l) => ({
              title: l.title,
              summary: l.summary,
              min: l.estimatedMinutes,
            })),
          })),
        }),
      );
    }
    case 'approval':
      // Approval has no inputs of its own — its summary is derived from the
      // structure, so its "input hash" is just the structure hash.
      return computeStageInputHash('structure', draft);
  }
}

export function computeAllStageHashes(draft: HashableDraft): Record<WizardStage, string> {
  return {
    topic: computeStageInputHash('topic', draft),
    refine: computeStageInputHash('refine', draft),
    clarification: computeStageInputHash('clarification', draft),
    structure: computeStageInputHash('structure', draft),
    approval: computeStageInputHash('approval', draft),
  };
}

/**
 * True if any direct upstream input hash has changed since the cache was
 * populated.
 */
export function isStageStale(
  stage: CachedStage,
  draft: HashableDraft,
  cache: StageCacheRecord | undefined,
): boolean {
  if (!cache) return false;
  for (const upstream of wizardDependencies[stage]) {
    const current = computeStageInputHash(upstream, draft);
    if (cache.upstreamHashes[upstream] !== current) return true;
  }
  return false;
}

export function staleStages(
  draft: HashableDraft,
  caches: WizardCaches | undefined,
): Set<CachedStage> {
  const out = new Set<CachedStage>();
  if (!caches) return out;
  (['clarification', 'structure', 'approval'] as const).forEach((k) => {
    if (isStageStale(k, draft, caches[k])) out.add(k);
  });
  return out;
}

/**
 * True if the cached output has diverged from the auto-generated baseline
 * — e.g. the learner renamed a module on Structure, or typed a clarification
 * answer. Used to gate the "your edits will be lost" confirm dialog.
 */
export function hasUserEdits(
  stage: CachedStage,
  draft: HashableDraft,
  cache: StageCacheRecord | undefined,
): boolean {
  if (!cache) return false;
  if (stage === 'clarification') {
    const answers = draft.clarification ?? {};
    return Object.values(answers).some((a) => (a ?? '').trim().length > 0);
  }
  // structure / approval — compare current structure hash to the seed snapshot
  const current = computeStageInputHash('structure', draft);
  return current !== cache.generatedHash;
}

/**
 * Builds an upstreamHashes map for the given stage at the current draft state.
 * Use this when caching freshly generated output.
 */
export function snapshotUpstreamHashes(
  stage: CachedStage,
  draft: HashableDraft,
): Partial<Record<WizardStage, string>> {
  const out: Partial<Record<WizardStage, string>> = {};
  for (const u of wizardDependencies[stage]) {
    out[u] = computeStageInputHash(u, draft);
  }
  return out;
}

// ─── helpers ──────────────────────────────────────────────────────────────────

function stableJSON(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(stableJSON).join(',') + ']';
  const keys = Object.keys(value as Record<string, unknown>).sort();
  return (
    '{' +
    keys
      .map(
        (k) =>
          JSON.stringify(k) + ':' + stableJSON((value as Record<string, unknown>)[k]),
      )
      .join(',') +
    '}'
  );
}

function fnv1a32(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}
