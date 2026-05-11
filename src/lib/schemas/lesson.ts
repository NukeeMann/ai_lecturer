import { z } from 'zod';
import { TheoryDataSchema } from '@/widgets/Theory/schema';
import { QuizDataSchema } from '@/widgets/Quiz/schema';
import { CodeDataSchema } from '@/widgets/Code/schema';
import { CodeClozeDataSchema } from '@/widgets/CodeCloze/schema';
import { DataTableDataSchema } from '@/widgets/DataTable/schema';
import { DemoDataSchema } from '@/widgets/Demo/schema';
import { DragMatchDataSchema } from '@/widgets/DragMatch/schema';
import { SandboxDataSchema } from '@/widgets/Sandbox/schema';
import { HistogramDataSchema } from '@/widgets/Histogram/schema';
import { ParametricExplorerDataSchema } from '@/widgets/ParametricExplorer/schema';
import { PlotImageDataSchema } from '@/widgets/PlotImage/schema';
import { VideoDataSchema } from '@/widgets/Video/schema';
import { AudioPlayerDataSchema } from '@/widgets/AudioPlayer/schema';
import { SttDemoDataSchema } from '@/widgets/SttDemo/schema';
import { TranscriptClozeDataSchema } from '@/widgets/TranscriptCloze/schema';
import { TtsDemoDataSchema } from '@/widgets/TtsDemo/schema';

export const SourceKindSchema = z.enum(['paper', 'video', 'article', 'book']);

export const SourceSchema = z.object({
  url: z.string().url(),
  title: z.string().min(1),
  kind: SourceKindSchema,
  author: z.string().optional(),
  year: z.number().int().optional(),
});

export type SourceKind = z.infer<typeof SourceKindSchema>;
export type Source = z.infer<typeof SourceSchema>;

const sectionBase = {
  id: z.string(),
  title: z.string(),
  description: z.string().optional(),
  sources: z.array(SourceSchema).optional(),
};

export const TheorySectionSchema = z.object({
  ...sectionBase,
  type: z.literal('theory'),
  data: TheoryDataSchema,
});

export const QuizSectionSchema = z.object({
  ...sectionBase,
  type: z.literal('quiz'),
  data: QuizDataSchema,
});

export const CodeSectionSchema = z.object({
  ...sectionBase,
  type: z.literal('code'),
  data: CodeDataSchema,
});

export const CodeClozeSectionSchema = z.object({
  ...sectionBase,
  type: z.literal('codeCloze'),
  data: CodeClozeDataSchema,
});

export const DemoSectionSchema = z.object({
  ...sectionBase,
  type: z.literal('demo'),
  data: DemoDataSchema,
});

export const SandboxSectionSchema = z.object({
  ...sectionBase,
  type: z.literal('sandbox'),
  data: SandboxDataSchema,
});

export const HistogramSectionSchema = z.object({
  ...sectionBase,
  type: z.literal('histogram'),
  data: HistogramDataSchema,
});

export const PlotImageSectionSchema = z.object({
  ...sectionBase,
  type: z.literal('plotImage'),
  data: PlotImageDataSchema,
});

export const ParametricExplorerSectionSchema = z.object({
  ...sectionBase,
  type: z.literal('parametricExplorer'),
  data: ParametricExplorerDataSchema,
});

export const DragMatchSectionSchema = z.object({
  ...sectionBase,
  type: z.literal('dragMatch'),
  data: DragMatchDataSchema,
});

export const DataTableSectionSchema = z.object({
  ...sectionBase,
  type: z.literal('dataTable'),
  data: DataTableDataSchema,
});

export const VideoSectionSchema = z.object({
  ...sectionBase,
  type: z.literal('video'),
  data: VideoDataSchema,
});

// US-157: sentinel value the generation pipeline emits in place of a real
// audioPath while it queues a TTS job. The post-processor replaces it with a
// real relative path before the lesson is written to disk; the public schema
// (below) refuses to accept it so a leaked sentinel never reaches the widget
// renderer or the API route.
export const AUTO_TTS_SENTINEL = 'AUTO_TTS';

const AudioPlayerDataPublicSchema = AudioPlayerDataSchema.refine(
  (d) => d.audioPath !== AUTO_TTS_SENTINEL,
  {
    message: `audioPath cannot be the sentinel value '${AUTO_TTS_SENTINEL}' — TTS post-processing must replace it with a real relative path before write`,
    path: ['audioPath'],
  },
);

const TranscriptClozeDataPublicSchema = TranscriptClozeDataSchema.refine(
  (d) => d.audioPath !== AUTO_TTS_SENTINEL,
  {
    message: `audioPath cannot be the sentinel value '${AUTO_TTS_SENTINEL}' — TTS post-processing must replace it with a real relative path before write`,
    path: ['audioPath'],
  },
);

export const AudioPlayerSectionSchema = z.object({
  ...sectionBase,
  type: z.literal('audioPlayer'),
  data: AudioPlayerDataPublicSchema,
});

export const TranscriptClozeSectionSchema = z.object({
  ...sectionBase,
  type: z.literal('transcriptCloze'),
  data: TranscriptClozeDataPublicSchema,
});

export const SttDemoSectionSchema = z.object({
  ...sectionBase,
  type: z.literal('sttDemo'),
  data: SttDemoDataSchema,
});

export const TtsDemoSectionSchema = z.object({
  ...sectionBase,
  type: z.literal('ttsDemo'),
  data: TtsDemoDataSchema,
});

export const CustomSectionSchema = z.object({
  ...sectionBase,
  type: z.literal('custom'),
  data: z.record(z.unknown()),
});

export const SectionSchema = z.discriminatedUnion('type', [
  TheorySectionSchema,
  QuizSectionSchema,
  CodeSectionSchema,
  CodeClozeSectionSchema,
  DemoSectionSchema,
  SandboxSectionSchema,
  HistogramSectionSchema,
  PlotImageSectionSchema,
  ParametricExplorerSectionSchema,
  DragMatchSectionSchema,
  DataTableSectionSchema,
  VideoSectionSchema,
  AudioPlayerSectionSchema,
  TranscriptClozeSectionSchema,
  SttDemoSectionSchema,
  TtsDemoSectionSchema,
  CustomSectionSchema,
]);

export type Section = z.infer<typeof SectionSchema>;

export const LessonSchema = z.object({
  schemaVersion: z.number().int().default(1),
  slug: z.string(),
  courseSlug: z.string(),
  moduleId: z.string(),
  title: z.string(),
  eyebrow: z.string(),
  description: z.string(),
  estimatedMinutes: z.number().int().positive(),
  pythonSession: z.enum(['shared', 'isolated']).optional(),
  sections: z.array(SectionSchema),
  sources: z.array(SourceSchema).optional(),
});

export type Lesson = z.infer<typeof LessonSchema>;

// US-157: pipeline-internal schema variant used by the post-processor. Allows
// `audioPath: 'AUTO_TTS'` plus an extra `audioSourceText` field on AudioPlayer
// sections so the generation agent can defer audio synthesis to a server-side
// TTS pass. Once post-processing has replaced the sentinel with a real
// relative path, the lesson is re-validated against the public LessonSchema
// before write — the sentinel never lands on disk.
//
// The sentinel data shape duplicates AudioPlayerDataSchema's fields rather
// than extending it via `.extend()` because `extend` would clone the base
// schema's defaults (e.g. `autoplay`) into a new object, and we want the
// audioSourceText addition to be a strict superset.
const AudioPlayerDataWithSentinelSchema = z.object({
  audioPath: z.string().min(1),
  transcript: z.string().optional(),
  autoplay: z.boolean().default(false),
  title: z.string().optional(),
  audioSourceText: z.string().optional(),
});

const AudioPlayerSectionWithSentinelSchema = z.object({
  ...sectionBase,
  type: z.literal('audioPlayer'),
  data: AudioPlayerDataWithSentinelSchema,
});

const TranscriptClozeSectionWithSentinelSchema = z.object({
  ...sectionBase,
  type: z.literal('transcriptCloze'),
  data: TranscriptClozeDataSchema,
});

export const SectionSchemaWithSentinel = z.discriminatedUnion('type', [
  TheorySectionSchema,
  QuizSectionSchema,
  CodeSectionSchema,
  CodeClozeSectionSchema,
  DemoSectionSchema,
  SandboxSectionSchema,
  HistogramSectionSchema,
  PlotImageSectionSchema,
  ParametricExplorerSectionSchema,
  DragMatchSectionSchema,
  DataTableSectionSchema,
  VideoSectionSchema,
  AudioPlayerSectionWithSentinelSchema,
  TranscriptClozeSectionWithSentinelSchema,
  SttDemoSectionSchema,
  TtsDemoSectionSchema,
  CustomSectionSchema,
]);

export const LessonSchemaWithSentinel = z.object({
  schemaVersion: z.number().int().default(1),
  slug: z.string(),
  courseSlug: z.string(),
  moduleId: z.string(),
  title: z.string(),
  eyebrow: z.string(),
  description: z.string(),
  estimatedMinutes: z.number().int().positive(),
  pythonSession: z.enum(['shared', 'isolated']).optional(),
  sections: z.array(SectionSchemaWithSentinel),
  sources: z.array(SourceSchema).optional(),
});

export type LessonWithSentinel = z.infer<typeof LessonSchemaWithSentinel>;
