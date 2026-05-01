import { z } from 'zod';
import { TheoryDataSchema } from '@/widgets/Theory/schema';
import { QuizDataSchema } from '@/widgets/Quiz/schema';
import { CodeDataSchema } from '@/widgets/Code/schema';
import { DemoDataSchema } from '@/widgets/Demo/schema';
import { SandboxDataSchema } from '@/widgets/Sandbox/schema';
import { HistogramDataSchema } from '@/widgets/Histogram/schema';

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

export const CustomSectionSchema = z.object({
  ...sectionBase,
  type: z.literal('custom'),
  data: z.record(z.unknown()),
});

export const SectionSchema = z.discriminatedUnion('type', [
  TheorySectionSchema,
  QuizSectionSchema,
  CodeSectionSchema,
  DemoSectionSchema,
  SandboxSectionSchema,
  HistogramSectionSchema,
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
