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
