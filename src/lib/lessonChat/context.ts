/**
 * LessonChat prompt context builder.
 *
 * Ships the full lesson page (header + every section's serialized body) so the
 * tutor can answer questions that span the whole page. When `currentSectionId`
 * is given, that section is tagged `[ACTIVE …]` so the model knows what the
 * learner is currently looking at.
 *
 * Total context is capped at CONTEXT_CHAR_LIMIT chars; if exceeded we truncate
 * the assembled body tail and append '… [truncated]'. The live state of the
 * active widget (≤ LIVE_STATE_MAX_CHARS, see liveState.ts) is appended after
 * that, outside the cap, so truncation never drops it.
 */
import type { Lesson, Section } from '@/lib/schemas/lesson';
import { renderLiveStateBlock } from './liveState';
import {
  serializeEegCase,
  serializeFigureSequence,
  serializeEegFigureMark,
  serializeEegViewer,
  serializeMontageLab,
  serializePatternDrill,
} from './eegSerialize';

export interface BuildPromptContextInput {
  lesson: Lesson;
  currentSectionId?: string;
  /**
   * What the widget in `currentSectionId` currently shows, as the widget
   * published it through the TutorBridge. It is appended after the lesson body
   * (truncation can never cut it) and capped at LIVE_STATE_MAX_CHARS.
   */
  activeWidgetState?: string;
  /** The tutor has web tools this turn → append the source-rigor rules. */
  research?: boolean;
  /** The learner attached images → append the image-reading rules. */
  learnerImages?: boolean;
}

export interface BuildPromptContextResult {
  systemPrompt: string;
  contextBlock: string;
}

export const SYSTEM_PROMPT = [
  'You are an AI tutor for an interactive online course. Answer concisely (≤200 words unless code is needed; image captions and the source list do not count). Stay focused on the lesson topic. If asked off-topic, redirect politely.',
  '',
  "Response style — obey the learner's intent:",
  '- DEFAULT (open-ended question, no explicit ask for the answer): teach by guiding. Prefer a Socratic style — ask a focused follow-up question, offer a hint, or walk through one step at a time so the learner reaches the answer themselves.',
  '- OVERRIDE (the learner explicitly asks for the answer or the solution — e.g. "just give me the answer", "tell me the solution", "show me the correct code", "what\'s the right option", "stop hinting, answer it"): give the direct answer immediately, then add a one- or two-sentence explanation of why. Do not refuse, do not deflect, do not lecture about learning before answering. The learner\'s explicit request always wins over the default guiding mode.',
].join('\n');

/**
 * Appended when the tutor has web tools (WebSearch, WebFetch and the
 * fetch_web_image MCP tool). The image rules are also enforced in code: the
 * chat only renders images from the lesson or from the verified media store,
 * and draws the source caption from the stored provenance.
 */
export const RESEARCH_PROMPT = [
  'Web research tools: WebSearch, WebFetch, and mcp__tutor__fetch_web_image (images).',
  '- Use the web only when it adds something the lesson lacks: the learner asks for examples, images, cases, current guidelines or sources, asks you to verify a claim, or the question goes beyond the lesson and you are not certain. Do not search for what the lesson already covers.',
  '- Do the research first, then write ONE answer. Do not narrate tool use ("let me search…").',
  '',
  'Source rigor — non-negotiable, and strictest for medical and scientific content:',
  '- Source hierarchy; always look for a higher tier before settling:',
  '  HIGH: official guidelines, classifications and standards; professional societies (in medicine e.g. ILAE, IFCN, AAN, ACNS, AASM, AAP, national societies); peer-reviewed journals (PubMed/PMC, publisher sites); academic textbooks; official documentation and specifications (for software/engineering topics); teaching material from universities or academic hospitals with named authors.',
  '  MEDIUM: curated references with editorial review and named authors (e.g. Radiopaedia, NCBI Bookshelf/StatPearls, Medscape, well-maintained technical references), and Wikipedia/Wikimedia Commons files with a clear author, description and provenance. Community content is never HIGH.',
  '  LOW (last resort): blogs, forums, Q&A sites, social media, stock or commercial sites, pages without author or date, anything of unclear origin.',
  '- Use a LOW source only when a genuine search found nothing better, and say so explicitly with the reason, e.g. "⚠️ Niepewne źródło: blog bez autora, brak recenzji".',
  '- Cite every claim taken from the web with a markdown link to the page you actually opened or that the search returned. Never invent, guess or reconstruct URLs, titles, authors, DOIs, figure numbers or quotes. If you could not verify something, say so.',
  '- When sources disagree, prefer the higher tier and mention the discrepancy.',
  '- End every answer that used the web with a short "Źródła" / "Sources" list (in the learner\'s language): link, and the tier with its reason when not HIGH.',
  '',
  'Images from the web:',
  '- Markdown images with external URLs are NOT displayed by this chat. The only way to show a web image is mcp__tutor__fetch_web_image.',
  '- Before calling it, open the source page with WebFetch and confirm from its caption/description what the image shows; pass that page as sourcePageUrl.',
  '- The tool returns the image itself: LOOK at it. Embed it (with the exact markdown the tool returns) only if it clearly shows what you claim. If the learner wants real recordings/photos, reject schematics, drawings and AI-generated pictures — or, if nothing else exists, label them plainly as schematic.',
  '- Under every image name the source (link), author and licence when known, and the reliability tier with its reason when not HIGH. The app also prints the stored provenance under the image.',
  '- If no trustworthy image exists, say so and point to where verified examples can be found. Never substitute a "similar-looking" image, and never present an image as showing something you did not verify.',
  '- Lesson illustrations (/api/courses/…/assets/…) can still be embedded as before.',
].join('\n');

/** Appended when the learner attached images to the conversation. */
export const IMAGE_INPUT_PROMPT = [
  'The learner attached image(s); each is labelled with where it came from. Look at them carefully:',
  '- Describe what you actually see before interpreting it; refer to concrete regions (e.g. channel, time point, area of the image).',
  '- State the limits plainly: resolution, cropping, missing context (for EEG: montage, sensitivity, time base, filters, clinical state). Do not over-read.',
  '- This is teaching, not a clinical report: never present an interpretation as a diagnosis for a real patient.',
].join('\n');

export const CONTEXT_CHAR_LIMIT = 30_000;
const TRUNCATION_SUFFIX = '… [truncated]';

export function buildPromptContext(
  input: BuildPromptContextInput,
): BuildPromptContextResult {
  const { lesson, currentSectionId, activeWidgetState, research, learnerImages } =
    input;

  const header = renderLessonHeader(lesson);
  const body = renderAllSections(lesson, currentSectionId);

  const assembled = `${header}\n\n${body}`;
  const lessonBlock =
    assembled.length <= CONTEXT_CHAR_LIMIT
      ? assembled
      : truncateBody(header, body);
  const liveState = renderLiveStateBlock({
    lesson,
    sectionId: currentSectionId,
    state: activeWidgetState,
  });
  const contextBlock =
    liveState.length > 0 ? `${lessonBlock}\n\n${liveState}` : lessonBlock;

  const systemPrompt = [
    SYSTEM_PROMPT,
    ...(research ? [RESEARCH_PROMPT] : []),
    ...(learnerImages ? [IMAGE_INPUT_PROMPT] : []),
  ].join('\n\n');
  return { systemPrompt, contextBlock };
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
      // The learner sees these options shuffled and lettered A, B, C…, so
      // their letters do not map onto these numbers.
      return (
        `Question: ${section.data.question}\nOptions (authored order; the learner sees them ` +
        `shuffled and lettered A, B, C… — match the learner's letter references by option text, ` +
        `never by position):\n${options}`
      );
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
    case 'sttDemo': {
      const parts: string[] = [
        `STT Demo (max ${section.data.maxDurationSeconds}s)`,
      ];
      if (section.data.prompt) parts.push(`Prompt: ${section.data.prompt}`);
      return parts.join('\n');
    }
    case 'ttsDemo': {
      const parts: string[] = ['TTS demo widget (runtime synthesis via /api/tts).'];
      if (section.data.defaultText) parts.push(`Default text: ${section.data.defaultText}`);
      if (section.data.placeholderText)
        parts.push(`Placeholder: ${section.data.placeholderText}`);
      return parts.join('\n');
    }
    case 'eegViewer':
      return serializeEegViewer(section.data);
    case 'montageLab':
      return serializeMontageLab(section.data);
    case 'eegFigureMark':
      return serializeEegFigureMark(section.data);
    case 'patternDrill':
      return serializePatternDrill(section.data);
    case 'eegCase':
      return serializeEegCase(section.data);
    case 'figureSequence':
      return serializeFigureSequence(section.data);
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
