import { z } from 'zod';

export const CodeTestSchema = z.object({
  name: z.string(),
  body: z.string(),
  hidden: z.boolean().default(true),
});

export const CodeInputSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('image'),
    src: z.string().min(1),
    alt: z.string().optional(),
    caption: z.string().optional(),
  }),
  z.object({
    kind: z.literal('video'),
    src: z.string().min(1),
    caption: z.string().optional(),
  }),
  z.object({
    kind: z.literal('file'),
    src: z.string().min(1),
    filename: z.string().min(1),
    caption: z.string().optional(),
  }),
  z.object({
    kind: z.literal('text'),
    content: z.string(),
    label: z.string().optional(),
  }),
]);

export const CodeOutputMediaSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('image'),
    src: z.string().min(1),
    alt: z.string().optional(),
    caption: z.string().optional(),
  }),
  z.object({
    kind: z.literal('video'),
    src: z.string().min(1),
    caption: z.string().optional(),
  }),
]);

export const CodeDataSchema = z.object({
  taskMarkdown: z.string(),
  starterCode: z.string(),
  tests: z.array(CodeTestSchema),
  solution: z.string().optional(),
  inputs: z.array(CodeInputSchema).optional(),
  outputMedia: CodeOutputMediaSchema.optional(),
});

export type CodeTest = z.infer<typeof CodeTestSchema>;
export type CodeInput = z.infer<typeof CodeInputSchema>;
export type CodeOutputMedia = z.infer<typeof CodeOutputMediaSchema>;
export type CodeData = z.infer<typeof CodeDataSchema>;
