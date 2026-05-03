import { z } from 'zod';

export const CodeClozeSlotValidationSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('exact'), value: z.string() }),
  z.object({ kind: z.literal('regex'), pattern: z.string() }),
  z.object({ kind: z.literal('oneOf'), values: z.array(z.string()).min(1) }),
]);

export const CodeClozeSlotSchema = z.object({
  id: z.string().min(1),
  hint: z.string().optional(),
  validation: CodeClozeSlotValidationSchema,
});

export const CodeClozeFinalTestSchema = z.object({
  name: z.string(),
  body: z.string(),
  hidden: z.boolean().default(true),
});

export const CodeClozeProgressiveHintSchema = z.object({
  revealAfterAttempts: z.number().int().nonnegative(),
  markdown: z.string(),
});

export const CodeClozeDataSchema = z.object({
  taskMarkdown: z.string().optional(),
  template: z.string(),
  slots: z.array(CodeClozeSlotSchema),
  finalTests: z.array(CodeClozeFinalTestSchema).optional(),
  hints: z.array(CodeClozeProgressiveHintSchema).optional(),
});

export type CodeClozeSlotValidation = z.infer<typeof CodeClozeSlotValidationSchema>;
export type CodeClozeSlot = z.infer<typeof CodeClozeSlotSchema>;
export type CodeClozeFinalTest = z.infer<typeof CodeClozeFinalTestSchema>;
export type CodeClozeProgressiveHint = z.infer<typeof CodeClozeProgressiveHintSchema>;
export type CodeClozeData = z.infer<typeof CodeClozeDataSchema>;

export function validateSlotValue(
  validation: CodeClozeSlotValidation,
  value: string,
): boolean {
  if (validation.kind === 'exact') return value === validation.value;
  if (validation.kind === 'oneOf') return validation.values.includes(value);
  try {
    return new RegExp(`^(?:${validation.pattern})$`).test(value);
  } catch {
    return false;
  }
}

export function extractSlotIds(template: string): string[] {
  const out: string[] = [];
  const re = /\{\{\s*([A-Za-z_][\w-]*)\s*\}\}/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(template)) !== null) {
    out.push(match[1]);
  }
  return out;
}
