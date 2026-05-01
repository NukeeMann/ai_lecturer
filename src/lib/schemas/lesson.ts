import { z } from 'zod';
import { TheoryDataSchema } from '@/widgets/Theory/schema';
import { QuizDataSchema } from '@/widgets/Quiz/schema';
import { CodeDataSchema } from '@/widgets/Code/schema';
import { DemoDataSchema } from '@/widgets/Demo/schema';
import { SandboxDataSchema } from '@/widgets/Sandbox/schema';
import { HistogramDataSchema } from '@/widgets/Histogram/schema';

const sectionBase = {
  id: z.string(),
  title: z.string(),
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
  slug: z.string(),
  courseSlug: z.string(),
  moduleId: z.string(),
  title: z.string(),
  eyebrow: z.string(),
  description: z.string(),
  estimatedMinutes: z.number().int().positive(),
  sections: z.array(SectionSchema),
});

export type Lesson = z.infer<typeof LessonSchema>;
