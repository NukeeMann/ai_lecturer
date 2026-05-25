/**
 * Wizard Clarification helpers (US-091).
 *
 * Prompt assembly + JSON-response parsing for the Claude-driven question
 * generator that runs between Refine (Stage 2) and Structure (Stage 3).
 */
import { z } from 'zod';

import type { ResolvedSourcePath } from '@/lib/server/sources';

export const RefineDraftSchema = z.object({
  level: z.enum(['beginner', 'intermediate', 'advanced']).nullable(),
  durationTarget: z
    .enum(['short', 'standard', 'extensive', 'comprehensive'])
    .nullable(),
  theoryPracticeRatio: z.number().min(0).max(100),
});

export const ClarifyRequestSchema = z.object({
  topic: z.string().min(1),
  /**
   * Optional learner-provided description of what they want from the course
   * (US-123). Empty strings are treated as omitted so the prompt only mentions
   * a description block when there's actual content.
   */
  description: z.string().optional(),
  refine: RefineDraftSchema,
  /**
   * Optional staged-uploads draft id (US-125). When present, the route loads
   * `<draftsRoot>/<draftId>/sources/` and appends the readable content into
   * the user message so the clarification questions reflect what the learner
   * uploaded.
   */
  draftId: z.string().optional(),
});

export type ClarifyRequest = z.infer<typeof ClarifyRequestSchema>;
export type RefineDraft = z.infer<typeof RefineDraftSchema>;

export const ClarificationQuestionSchema = z.object({
  id: z.string().min(1),
  text: z.string().min(1),
});

export const ClarifyResponseSchema = z.object({
  questions: z.array(ClarificationQuestionSchema).max(10),
});

export type ClarifyResponse = z.infer<typeof ClarifyResponseSchema>;
export type ClarificationQuestion = z.infer<typeof ClarificationQuestionSchema>;

export const CLARIFY_SYSTEM_PROMPT = [
  'You are an expert curriculum designer helping a learner clarify what they want from an upcoming course.',
  'Given a draft topic, level, length target, and theory/practice mix, propose up to 10 short, targeted clarification questions that will sharpen the eventual course outline.',
  'Questions must be open-ended, learner-facing, and never require external research to answer (no "do you have sources for…?").',
  'Respond with STRICT JSON only — no prose, no markdown fences. Schema: {"questions":[{"id":"q1","text":"…"}, ...]}.',
  'Each question id must be unique within the response (e.g. q1, q2, …). Each text must be one sentence, under 200 characters.',
  'Return at most 10 questions; fewer is fine if the topic is narrow.',
  'If learner-uploaded source materials are listed in the user message, use the Read tool to inspect each listed path BEFORE drafting questions. Prioritise questions that fill gaps the materials do NOT already answer — do not ask about facts already stated in those files.',
].join('\n');

function ratioLabel(n: number): string {
  if (n < 34) return 'mostly theory';
  if (n > 66) return 'mostly practice';
  return 'balanced theory/practice';
}

function durationLabel(d: RefineDraft['durationTarget']): string {
  switch (d) {
    case 'short':
      return 'short course (3–5 lessons)';
    case 'standard':
      return 'standard course (8–12 lessons)';
    case 'extensive':
      return 'extensive course (20–30 lessons)';
    case 'comprehensive':
      return 'comprehensive course (40+ lessons)';
    default:
      return 'unspecified length';
  }
}

export function buildClarifyUserMessage(
  req: ClarifyRequest,
  sources?: readonly ResolvedSourcePath[],
): string {
  const { topic, description, refine } = req;
  const trimmedDescription = (description ?? '').trim();
  const lines = [
    'Draft course spec so far:',
    `- Topic: ${topic.trim()}`,
  ];
  if (trimmedDescription.length > 0) {
    lines.push(`- Description: ${trimmedDescription}`);
  }
  lines.push(
    `- Learner level: ${refine.level ?? 'unspecified'}`,
    `- Length: ${durationLabel(refine.durationTarget)}`,
    `- Mix: ${ratioLabel(refine.theoryPracticeRatio)} (${refine.theoryPracticeRatio}/100)`,
  );

  if (sources && sources.length > 0) {
    // Hand the model absolute paths and let it Read each file through the
    // built-in tool. Previous versions inlined the extracted text — for a
    // typical multi-PDF upload that pushed the prompt past 150 KB and broke
    // generation with spawn E2BIG. The agent now decides which files to
    // open and how much to skim.
    lines.push(
      '',
      'Learner-uploaded source materials (Read each path with the Read tool BEFORE drafting questions; do not ask about facts these files already cover):',
    );
    for (const s of sources) {
      lines.push(
        s.extractedFrom
          ? `- ${s.readPath} (extracted text from ${s.extractedFrom})`
          : `- ${s.readPath}`,
      );
    }
  }

  lines.push(
    '',
    'Generate up to 10 clarification questions to ask the learner before drafting modules and lessons. Return JSON only.',
  );
  return lines.join('\n');
}

/**
 * Extract a JSON object from a Claude response. Tolerates leading/trailing
 * whitespace, ```json fences, and stray prose around the object — but the
 * primary path is a clean JSON.parse.
 */
export function extractJsonPayload(raw: string): unknown {
  const trimmed = raw.trim();

  // Strip ```json … ``` or ``` … ``` fences.
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```\s*$/i.exec(trimmed);
  if (fenced) {
    return JSON.parse(fenced[1]);
  }

  try {
    return JSON.parse(trimmed);
  } catch {
    // Fall through to brace-scan.
  }

  // Last-resort: locate the outermost {...} block.
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) {
    throw new Error('No JSON object found in response');
  }
  return JSON.parse(trimmed.slice(start, end + 1));
}

/**
 * Parse and validate a connector reply into a `ClarifyResponse`. Throws on
 * any problem so the route can decide whether to retry or surface the error.
 *
 * - Caps the questions array at 10 (the AC's "up to 10").
 * - Auto-fills missing ids with `q<n>` so a sloppy model output doesn't fail
 *   validation outright; ordering is preserved.
 */
export function parseClarifyResponse(raw: string): ClarifyResponse {
  const payload = extractJsonPayload(raw);
  if (!payload || typeof payload !== 'object') {
    throw new Error('Response is not a JSON object');
  }
  const obj = payload as { questions?: unknown };
  if (!Array.isArray(obj.questions)) {
    throw new Error('Response missing `questions` array');
  }

  const seen = new Set<string>();
  const normalised: ClarificationQuestion[] = [];
  for (let i = 0; i < obj.questions.length && normalised.length < 10; i++) {
    const q = obj.questions[i] as { id?: unknown; text?: unknown };
    if (!q || typeof q !== 'object') continue;
    const text = typeof q.text === 'string' ? q.text.trim() : '';
    if (!text) continue;
    let id =
      typeof q.id === 'string' && q.id.trim().length > 0
        ? q.id.trim()
        : `q${i + 1}`;
    let dedupe = 1;
    while (seen.has(id)) {
      dedupe += 1;
      id = `q${i + 1}-${dedupe}`;
    }
    seen.add(id);
    normalised.push({ id, text });
  }

  if (normalised.length === 0) {
    throw new Error('Response contained no valid questions');
  }

  return ClarifyResponseSchema.parse({ questions: normalised });
}
