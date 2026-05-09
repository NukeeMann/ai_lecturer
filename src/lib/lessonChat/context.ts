/**
 * LessonChat prompt context builder.
 *
 * Ships the full lesson page (header + every section's serialized body) so the
 * tutor can answer questions that span the whole page. When `currentSectionId`
 * is given, that section is tagged `[ACTIVE …]` so the model knows what the
 * learner is currently looking at.
 *
 * Total context is capped at CONTEXT_CHAR_LIMIT chars; if exceeded we truncate
 * the assembled body tail and append '… [truncated]'.
 */
import type { Lesson, Section } from '@/lib/schemas/lesson';

export interface BuildPromptContextInput {
  lesson: Lesson;
  currentSectionId?: string;
}

export interface BuildPromptContextResult {
  systemPrompt: string;
  contextBlock: string;
}

export const SYSTEM_PROMPT = [
  'You are an AI tutor for an interactive online course. Answer concisely (≤200 words unless code is needed). Stay focused on the lesson topic. If asked off-topic, redirect politely.',
  '',
  "Response style — obey the learner's intent:",
  '- DEFAULT (open-ended question, no explicit ask for the answer): teach by guiding. Prefer a Socratic style — ask a focused follow-up question, offer a hint, or walk through one step at a time so the learner reaches the answer themselves.',
  '- OVERRIDE (the learner explicitly asks for the answer or the solution — e.g. "just give me the answer", "tell me the solution", "show me the correct code", "what\'s the right option", "stop hinting, answer it"): give the direct answer immediately, then add a one- or two-sentence explanation of why. Do not refuse, do not deflect, do not lecture about learning before answering. The learner\'s explicit request always wins over the default guiding mode.',
].join('\n');

export const CONTEXT_CHAR_LIMIT = 30_000;
const TRUNCATION_SUFFIX = '… [truncated]';

export function buildPromptContext(
  input: BuildPromptContextInput,
): BuildPromptContextResult {
  const { lesson, currentSectionId } = input;

  const header = renderLessonHeader(lesson);
  const body = renderAllSections(lesson, currentSectionId);

  const assembled = `${header}\n\n${body}`;
  const contextBlock =
    assembled.length <= CONTEXT_CHAR_LIMIT
      ? assembled
      : truncateBody(header, body);

  return { systemPrompt: SYSTEM_PROMPT, contextBlock };
}

function renderLessonHeader(lesson: Lesson): string {
  const lines: string[] = [];
  lines.push(`Lesson title: ${lesson.title}`);
  lines.push(`Eyebrow: ${lesson.eyebrow}`);
  lines.push(`Description: ${lesson.description}`);
  lines.push(`Estimated minutes: ${lesson.estimatedMinutes}`);
  return lines.join('\n');
}

function renderAllSections(lesson: Lesson, currentSectionId?: string): string {
  if (lesson.sections.length === 0) {
    return 'Lesson sections: (this lesson has no sections)';
  }
  const lines: string[] = ['Lesson sections (full page content):'];
  for (let i = 0; i < lesson.sections.length; i++) {
    const s = lesson.sections[i];
    const isActive = currentSectionId !== undefined && s.id === currentSectionId;
    const marker = isActive ? ' [ACTIVE — learner is currently viewing this]' : '';
    lines.push('');
    lines.push(`Section ${i + 1} [${s.type}]: ${s.title}${marker}`);
    const sectionBody = serializeSectionBody(s);
    if (sectionBody.length > 0) {
      lines.push(sectionBody);
    }
  }
  return lines.join('\n');
}

function serializeSectionBody(section: Section): string {
  switch (section.type) {
    case 'theory':
      return section.data.markdown;
    case 'quiz': {
      const options = section.data.options
        .map((opt, i) => `${i + 1}. ${opt}`)
        .join('\n');
      return `Question: ${section.data.question}\nOptions:\n${options}`;
    }
    case 'code': {
      const parts: string[] = [];
      parts.push(`Task:\n${section.data.taskMarkdown}`);
      if (section.data.starterCode) {
        parts.push(`Starter code:\n${section.data.starterCode}`);
      }
      return parts.join('\n\n');
    }
    case 'codeCloze': {
      const parts: string[] = [];
      if (section.data.taskMarkdown) {
        parts.push(`Task:\n${section.data.taskMarkdown}`);
      }
      parts.push(`Template:\n${section.data.template}`);
      return parts.join('\n\n');
    }
    case 'sandbox':
      return `Starter code:\n${section.data.starterCode}\n\nEncouragement: ${section.data.encouragement}`;
    case 'demo':
      return `Demo: ${section.data.demoType}`;
    case 'histogram':
      return `Histogram: ${section.data.counts.length} bins`;
    case 'plotImage': {
      const parts: string[] = [`Image: ${section.data.alt}`];
      if (section.data.caption) parts.push(`Caption: ${section.data.caption}`);
      return parts.join('\n');
    }
    case 'parametricExplorer': {
      const params = section.data.params
        .map((p) => `- ${p.name} (${p.type})`)
        .join('\n');
      return `Parametric explorer params:\n${params}`;
    }
    case 'dragMatch': {
      const items = section.data.items.map((i) => `- ${i.label}`).join('\n');
      const zones = section.data.zones.map((z) => `- ${z.label}`).join('\n');
      return `Prompt: ${section.data.prompt}\nItems:\n${items}\nZones:\n${zones}`;
    }
    case 'dataTable': {
      const cols = section.data.columns.map((c) => c.label).join(', ');
      return `Columns: ${cols}\nRows: ${section.data.rows.length}`;
    }
    case 'video': {
      const parts: string[] = [`Video (${section.data.kind}): ${section.data.src}`];
      if (section.data.title) parts.push(`Title: ${section.data.title}`);
      return parts.join('\n');
    }
    case 'audioPlayer': {
      const parts: string[] = [`Audio: ${section.data.audioPath}`];
      if (section.data.title) parts.push(`Title: ${section.data.title}`);
      if (section.data.transcript) parts.push(`Transcript: ${section.data.transcript}`);
      return parts.join('\n');
    }
    case 'transcriptCloze': {
      const parts: string[] = [`Audio: ${section.data.audioPath}`];
      if (section.data.title) parts.push(`Title: ${section.data.title}`);
      if (section.data.instructions)
        parts.push(`Instructions: ${section.data.instructions}`);
      parts.push(`Transcript: ${section.data.transcript}`);
      const blanks = section.data.blanks
        .map((b) => `- wordIndex=${b.wordIndex}, answer=${b.answer}`)
        .join('\n');
      parts.push(`Blanks:\n${blanks}`);
      return parts.join('\n');
    }
    case 'custom':
      return `Custom widget: ${JSON.stringify(section.data)}`;
    default: {
      const _exhaustive: never = section;
      void _exhaustive;
      return '';
    }
  }
}

function truncateBody(header: string, body: string): string {
  const overhead = header.length + 2; // 2 = '\n\n'
  const suffixLen = TRUNCATION_SUFFIX.length;
  const budget = CONTEXT_CHAR_LIMIT - overhead - suffixLen;
  if (budget <= 0) {
    // Header alone already exceeds the cap; return header capped + suffix.
    const headerBudget = Math.max(0, CONTEXT_CHAR_LIMIT - suffixLen);
    return `${header.slice(0, headerBudget)}${TRUNCATION_SUFFIX}`;
  }
  const truncatedBody = body.slice(0, budget);
  return `${header}\n\n${truncatedBody}${TRUNCATION_SUFFIX}`;
}
