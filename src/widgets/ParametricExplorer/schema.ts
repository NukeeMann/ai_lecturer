import { z } from 'zod';

export const ParametricExplorerParamSchema = z.object({
  name: z.string().min(1),
  label: z.string().min(1),
  type: z.enum(['slider', 'select', 'toggle']),
  min: z.number().optional(),
  max: z.number().optional(),
  step: z.number().optional(),
  default: z.union([z.number(), z.string(), z.boolean()]),
  options: z.array(z.string()).optional(),
});

export const ParametricExplorerDataSchema = z.object({
  setupCode: z.string(),
  renderCode: z.string(),
  params: z.array(ParametricExplorerParamSchema),
  outputType: z.enum(['plot', 'value', 'both']),
  debounceMs: z.number().int().positive().optional(),
});

export type ParametricExplorerParam = z.infer<typeof ParametricExplorerParamSchema>;
export type ParametricExplorerData = z.infer<typeof ParametricExplorerDataSchema>;
