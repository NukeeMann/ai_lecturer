'use client';

// Self-parsing of widget data (spec §0): the static exporter passes raw
// lesson JSON, so every EEG widget safeParses its own `data` (defaults
// applied) and renders <DataErrorCard> instead of crashing.
//
//   const parsed = useParsedData(EegViewerDataSchema, props.data);
//   if (!parsed.ok) return <DataErrorCard title="Invalid EEG viewer data" error={parsed.error} />;

import { useMemo } from 'react';
import type { ZodError, ZodType, ZodTypeDef } from 'zod';

export type ParsedData<T> = { ok: true; data: T } | { ok: false; error: ZodError };

export function useParsedData<T>(schema: ZodType<T, ZodTypeDef, unknown>, raw: unknown): ParsedData<T> {
  return useMemo(() => {
    const r = schema.safeParse(raw);
    return r.success ? { ok: true as const, data: r.data } : { ok: false as const, error: r.error };
  }, [schema, raw]);
}
